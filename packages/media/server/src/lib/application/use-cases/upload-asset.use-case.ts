import { Inject, Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import { attachActor, OutboxWriter, UnitOfWork } from '@apograph/database';
import type { EventActor } from '@apograph/database';
import { Asset, type AssetMedia, type AssetVariants } from '../../domain/asset';
import { AssetId } from '../../domain/value-objects/asset-id';
import { FolderId } from '../../domain/value-objects/folder-id';
import { FileName } from '../../domain/value-objects/file-name';
import { MediaKind } from '../../domain/value-objects/media-kind';
import { StorageKey } from '../../domain/value-objects/storage-key';
import { FolderNotFoundError } from '../../domain/errors/folder-not-found.error';
import {
    IMAGE_PROCESSOR,
    type ImageProcessor
} from '../../domain/image-processor';
import {
    ASSET_REPOSITORY,
    type AssetRepository
} from '../../domain/asset.repository';
import {
    FOLDER_REPOSITORY,
    type FolderRepository
} from '../../domain/folder.repository';
import { STORAGE_PROVIDER, type StorageProvider } from '@apograph/media-domain';

/** Inputs for one upload — the file stream plus its metadata. */
export interface UploadAssetCommand {
    workspaceId: string;
    /** Destination folder id, or `null`/absent for the workspace root. */
    folderId: string | null;
    fileName: string;
    contentType: string;
    body: Readable;
    /**
     * Alternative text supplied with the upload. Optional, and normalized to
     * `null` when blank — it exists so a text alternative can be given when the
     * asset is created, rather than only by a later PATCH nobody makes.
     */
    alt?: string | null;
}

/** Buffers a readable fully into memory (bounded by the upload size cap). */
async function collect(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
}

/**
 * Uploads one asset: the bytes stream to the deployment's storage provider,
 * then the row + audit event commit atomically. The provider's `id` is recorded
 * on the asset, so a later deployment pointed at a different backend can be
 * told (at boot) that these bytes are not its own.
 *
 * For images, the bytes are buffered so the {@link ImageProcessor} can read the
 * dimensions and generate `thumb`/`preview` derivatives, each stored as its own
 * blob under the same provider. Derivative generation is best-effort — a source
 * the processor can't handle just yields no derivatives, never a failed upload.
 * Every blob written (original + derivatives) is reclaimed if the transaction
 * rolls back, so a failed upload leaves nothing behind.
 */
@Injectable()
export class UploadAssetUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider,
        @Inject(IMAGE_PROCESSOR) private readonly processor: ImageProcessor,
        @Inject(ASSET_REPOSITORY) private readonly assets: AssetRepository,
        @Inject(FOLDER_REPOSITORY) private readonly folders: FolderRepository
    ) {}

    /** Runs the upload. Returns the new asset id. */
    async execute(
        command: UploadAssetCommand,
        // `EventActor` rather than `PublicUser`: this use case only ever reads
        // `id` (for `uploaded_by`) and hands the pair to `attachActor`, and a
        // token-authenticated upload has no session user to supply the rest.
        // A `PublicUser` still satisfies it, so the session route is unchanged.
        actor: EventActor
    ): Promise<string> {
        const folderId = command.folderId
            ? FolderId.create(command.folderId)
            : null;
        const fileName = FileName.create(command.fileName);
        const kind = MediaKind.fromMime(command.contentType);
        const assetId = AssetId.generate();

        const provider = this.provider;
        // Images are buffered once so both the original write and the processor
        // can read the same bytes (a stream is single-use); other kinds are
        // passed straight through.
        //
        // Note this is *not* the whole story today: both HTTP upload routes use
        // multer's `memoryStorage` and hand us a `Readable.from(file.buffer)`,
        // so every upload is already fully in memory by the time it gets here,
        // whatever its kind. The cap (`maxUploadBytes`) is what bounds that.
        // Streaming end-to-end means moving the routes off `memoryStorage`,
        // which is a bigger change than this use case.
        const buffered =
            kind.value === 'image' ? await collect(command.body) : null;

        // Track every blob written so any failure — storage or transaction —
        // reclaims all of them, never just the original.
        const written: string[] = [];
        try {
            const original = await provider.put({
                workspaceId: command.workspaceId,
                assetId: assetId.value,
                fileName: fileName.value,
                contentType: command.contentType,
                body: buffered ? Readable.from(buffered) : command.body
            });
            written.push(original.storageKey);

            let media: Partial<AssetMedia> | undefined;
            let variants: AssetVariants = {};
            if (buffered) {
                ({ media, variants } = await this.deriveImage(
                    provider,
                    command,
                    assetId,
                    buffered,
                    written
                ));
            }

            return await this.uow.run(async () => {
                if (
                    folderId &&
                    // FOR SHARE on the destination folder: serializes against a
                    // concurrent delete so the new asset can't be orphaned into
                    // a folder that is being removed.
                    !(await this.folders.existsForShare(
                        folderId,
                        command.workspaceId
                    ))
                ) {
                    throw new FolderNotFoundError(folderId.value);
                }
                const asset = Asset.create({
                    id: assetId,
                    workspaceId: command.workspaceId,
                    folderId,
                    name: fileName,
                    storageKey: StorageKey.create(original.storageKey),
                    storageProvider: provider.id,
                    kind,
                    mimeType: command.contentType,
                    size: original.size,
                    checksum: original.checksum,
                    uploadedBy: actor.id,
                    media,
                    variants,
                    alt: command.alt ?? null
                });
                await this.assets.save(asset);
                await this.outbox.append(
                    attachActor(asset.pullEvents(), actor)
                );
                return asset.id.value;
            });
        } catch (error) {
            // Storage or the transaction failed after some blobs landed —
            // reclaim every one so a failed upload leaves nothing behind.
            await Promise.all(
                written.map((key) =>
                    provider.remove(key).catch(() => undefined)
                )
            );
            throw error;
        }
    }

    /**
     * Probes the buffered image's dimensions and stores each generated
     * derivative as its own blob (appending the keys to `written`).
     */
    private async deriveImage(
        provider: StorageProvider,
        command: UploadAssetCommand,
        assetId: AssetId,
        bytes: Buffer,
        written: string[]
    ): Promise<{ media?: Partial<AssetMedia>; variants: AssetVariants }> {
        const processed = await this.processor.process({
            body: bytes,
            contentType: command.contentType
        });
        if (!processed) {
            return { variants: {} };
        }

        const variants: AssetVariants = {};
        for (const derivative of processed.derivatives) {
            const put = await provider.put({
                workspaceId: command.workspaceId,
                assetId: assetId.value,
                fileName: `${derivative.name}.webp`,
                contentType: derivative.contentType,
                body: Readable.from(derivative.body),
                isVariant: true
            });
            written.push(put.storageKey);
            variants[derivative.name] = {
                key: put.storageKey,
                width: derivative.width,
                height: derivative.height,
                size: put.size
            };
        }
        return {
            media: { width: processed.width, height: processed.height },
            variants
        };
    }
}
