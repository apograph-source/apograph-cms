/**
 * Getting an archive's files into the media library.
 *
 * Two things make this more than "upload each one".
 *
 * **Dedup comes first.** An import that re-uploaded every byte would duplicate
 * a media library on the second run of the same file, and content teams re-run
 * imports constantly. The checksum is the match: identical bytes are the same
 * asset, whatever the file was called. Only when nothing matches do the bytes
 * move.
 *
 * **Storage is not transactional.** The row writes join the import's
 * transaction and roll back with it; the blob does not. So every key written
 * during a run is remembered, and a failed run deletes them — otherwise a
 * rolled-back import leaves orphaned bytes in the bucket that nothing
 * references and nothing will ever collect.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Readable } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import type { EventActor } from '@orthacms/database';
import { mediaAsset } from '@orthacms/media-server';
import { UploadAssetUseCase } from '@orthacms/media-server';
import {
    TransferAssetMap,
    type ImportCounts,
    type TransferAssetRef
} from '@orthacms/transfer-domain';

/**
 * One import run's media bookkeeping.
 *
 * Owned by the caller rather than the service, because the service is a
 * singleton: parking a run's uploaded-asset list on `this` would let two
 * concurrent imports share it, and the first one to fail would roll back the
 * other's files.
 */
export interface ImportMediaRun {
    /** Asset ids created during this run, in order, for rollback. */
    uploaded: string[];
}

/** Starts a run's bookkeeping. */
export function beginMediaRun(): ImportMediaRun {
    return { uploaded: [] };
}

@Injectable()
export class ImportMediaService {
    private readonly logger = new Logger(ImportMediaService.name);

    constructor(
        @InjectDatabase() private readonly db: Database,
        // Absent when the media plugin isn't registered: an import then keeps
        // every non-media field and reports the assets as missing, rather than
        // refusing a file whose text content is perfectly importable.
        @Optional()
        @Inject(UploadAssetUseCase)
        private readonly upload?: UploadAssetUseCase
    ) {}

    /**
     * The target workspace's asset id for one reference, uploading the bytes
     * only if nothing already matches.
     *
     * Returns `undefined` when the asset can be neither matched nor created —
     * the caller drops the field rather than writing an id that names nothing.
     */
    async resolveAsset(
        ref: TransferAssetRef,
        archive: ReadonlyMap<string, Buffer>,
        seen: TransferAssetMap,
        workspaceId: string,
        dryRun: boolean,
        actor: EventActor | null,
        counts: ImportCounts,
        run: ImportMediaRun
    ): Promise<string | undefined> {
        const already = seen.resolve(ref.$id, ref.checksum);
        if (already) return already;

        const existing = await this.findByChecksum(ref.checksum, workspaceId);
        if (existing) {
            counts.assetsReused += 1;
            seen.remember(ref.$id, existing, ref.checksum);
            return existing;
        }

        const bytes = ref.path ? archive.get(ref.path) : undefined;
        if (!bytes) {
            // No bytes and no match. In a file-less format this is expected —
            // the record still names an asset that only exists at the source.
            return undefined;
        }

        counts.assetsNew += 1;
        if (dryRun || !this.upload) return undefined;

        if (!actor) {
            // The media use case stamps `uploaded_by`, which is NOT NULL. A
            // token-authenticated import has no session user, so rather than
            // invent one, the asset is reported missing and the rest imports.
            return undefined;
        }

        const created = await this.upload.execute(
            {
                workspaceId,
                folderId: null,
                fileName: ref.name,
                // The archive's claim about the type is not trusted on its own;
                // the media plugin's own upload path re-derives the asset kind
                // from it and applies its own rules, which is exactly why this
                // goes through that use case rather than inserting a row.
                contentType: ref.mimeType,
                body: Readable.from([bytes]),
                alt: ref.alt ?? null
            },
            actor
        );
        seen.remember(ref.$id, created, ref.checksum);
        run.uploaded.push(created);
        return created;
    }

    /**
     * Deletes the blobs a failed run wrote.
     *
     * Best-effort and deliberately silent about individual failures: the import
     * has already failed, and turning cleanup trouble into the error the user
     * sees would hide the real one. What is left behind is logged instead.
     */
    async rollbackRun(run: ImportMediaRun): Promise<void> {
        const ids = run.uploaded.splice(0);
        if (ids.length === 0) return;
        for (const id of ids) {
            try {
                await this.db.delete(mediaAsset).where(eq(mediaAsset.id, id));
            } catch (error) {
                this.logger.warn(
                    `Import rolled back but asset ${id} could not be removed: ${
                        error instanceof Error ? error.message : 'unknown error'
                    }`
                );
            }
        }
    }

    /**
     * An asset in this workspace with these exact bytes.
     *
     * Workspace-scoped, which matters: matching on checksum alone would let an
     * import in workspace A silently link a record to workspace B's asset,
     * because identical files are common (a shared logo, a stock photo).
     */
    private async findByChecksum(
        checksum: string | undefined,
        workspaceId: string
    ): Promise<string | undefined> {
        if (!checksum) return undefined;
        const rows = (await this.db
            .select({ id: mediaAsset.id })
            .from(mediaAsset)
            .where(
                and(
                    eq(mediaAsset.checksum, checksum),
                    eq(mediaAsset.workspaceId, workspaceId)
                )
            )
            .limit(1)) as { id: string }[];
        return rows[0]?.id;
    }
}
