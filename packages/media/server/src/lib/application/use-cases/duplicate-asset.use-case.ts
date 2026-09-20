import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@ortha/database';
import type { PublicUser } from '@ortha/identity-server';
import { Asset, type AssetVariants } from '../../domain/asset';
import { AssetId } from '../../domain/value-objects/asset-id';
import { FileName } from '../../domain/value-objects/file-name';
import { StorageKey } from '../../domain/value-objects/storage-key';
import { AssetNotFoundError } from '../../domain/errors/asset-not-found.error';
import {
    ASSET_REPOSITORY,
    type AssetRepository
} from '../../domain/asset.repository';
import { STORAGE_PROVIDER, type StorageProvider } from '@ortha/media-domain';

/** Inserts " copy" before the extension (or appends it when there is none). */
function duplicateName(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0
        ? `${name.slice(0, dot)} copy${name.slice(dot)}`
        : `${name} copy`;
}

/**
 * Duplicates an asset — copies the bytes to a fresh key through the
 * deployment's storage provider and inserts a new row in the same folder,
 * carrying over kind/mime/tags/alt/dims. Returns the new asset id.
 */
@Injectable()
export class DuplicateAssetUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider,
        @Inject(ASSET_REPOSITORY) private readonly assets: AssetRepository
    ) {}

    /** Runs the duplicate. Throws when the source asset is absent. */
    async execute(
        assetId: string,
        workspaceId: string,
        actor: PublicUser
    ): Promise<string> {
        const source = await this.assets.findById(
            AssetId.create(assetId),
            workspaceId
        );
        if (!source) {
            throw new AssetNotFoundError(assetId);
        }

        // Built as a `FileName` **before** anything touches storage: `" copy"`
        // can push a 255-char name over the limit, and the value object is the
        // only thing that says so. Left until the transaction, the over-long
        // name reached the provider first and blew up as an unmapped
        // `ENAMETOOLONG` — a 500 for what is a 400.
        const copyName = FileName.create(duplicateName(source.name.value));
        const newId = AssetId.generate();
        const provider = this.provider;
        // The copy reads and writes through the same provider, so a source
        // written by a different backend is refused rather than half-copied:
        // `get` would be handed a key that means nothing here. The boot check
        // makes this unreachable in a healthy deployment.
        if (source.storageProvider !== provider.id) {
            throw new Error(
                `Asset ${assetId} is stored by provider "${source.storageProvider}", but this ` +
                    `deployment runs "${provider.id}". Its bytes are in the other backend.`
            );
        }

        // Track every copied blob so a rolled-back duplicate reclaims all of
        // them, not just the original.
        const written: string[] = [];
        try {
            const sourceStream = await provider.get(source.storageKey.value);
            const stored = await provider.put({
                workspaceId,
                assetId: newId.value,
                fileName: copyName.value,
                contentType: source.mimeType,
                body: sourceStream
            });
            written.push(stored.storageKey);

            // Copy each derivative to the new asset, keeping the same variant
            // names + dimensions so the copy renders without re-processing.
            const variants: AssetVariants = {};
            for (const [name, variant] of Object.entries(source.variants)) {
                const put = await provider.put({
                    workspaceId,
                    assetId: newId.value,
                    fileName: `${name}.webp`,
                    contentType: 'image/webp',
                    body: await provider.get(variant.key),
                    isVariant: true
                });
                written.push(put.storageKey);
                variants[name] = {
                    key: put.storageKey,
                    width: variant.width,
                    height: variant.height,
                    size: put.size
                };
            }

            return await this.uow.run(async () => {
                const copy = Asset.create({
                    id: newId,
                    workspaceId,
                    folderId: source.folderId,
                    name: copyName,
                    storageKey: StorageKey.create(stored.storageKey),
                    storageProvider: provider.id,
                    kind: source.kind,
                    mimeType: source.mimeType,
                    size: stored.size,
                    checksum: stored.checksum,
                    uploadedBy: actor.id,
                    media: source.media,
                    variants
                });
                if (source.tags.length > 0) copy.retag(source.tags);
                if (source.alt) copy.setAlt(source.alt);
                await this.assets.save(copy);
                await this.outbox.append(attachActor(copy.pullEvents(), actor));
                return copy.id.value;
            });
        } catch (error) {
            await Promise.all(
                written.map((key) =>
                    provider.remove(key).catch(() => undefined)
                )
            );
            throw error;
        }
    }
}
