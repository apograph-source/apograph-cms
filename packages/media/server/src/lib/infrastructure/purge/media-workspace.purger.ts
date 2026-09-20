import {
    Inject,
    Injectable,
    Logger,
    OnModuleInit,
    Optional
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { UnitOfWork } from '@ortha/database';
import {
    WorkspacePurgeRegistry,
    type WorkspacePurger,
    type WorkspacePurgeOutcome
} from '@ortha/workspaces-server';
import { STORAGE_PROVIDER, type StorageProvider } from '@ortha/media-domain';
import { mediaAsset } from '../schema/media-asset';
import { mediaFolder } from '../schema/media-folder';

/**
 * Removes a deleted workspace's media — every asset row, every folder row, and
 * the stored bytes behind them.
 *
 * `media_asset.workspace_id` and `media_folder.workspace_id` are plain uuids
 * with no FK to `workspaces` (that table belongs to another plugin), so nothing
 * used to remove them: deleting a workspace left the rows behind *and* stranded
 * their blobs, which no later request could reach to reclaim — the folder
 * cascade and the bulk delete both need a live workspace to route through.
 * This closes both, and registers itself with the workspaces plugin rather than
 * that plugin knowing media exists.
 *
 * **Set-based, and deliberately event-free.** Unlike `DeleteAssetsUseCase` and
 * `DeleteFolderUseCase` this does not load aggregates or emit one
 * `media.asset.deleted` per asset: a workspace can hold tens of thousands of
 * assets, and their individual deletions are not separately meaningful — the
 * `workspace.deleted` audit row is the event that happened. What the blob
 * reclaim needs is the storage columns, so the delete returns exactly those.
 *
 * No locking here beyond the transaction: the workspace delete already holds
 * the workspace's exclusive advisory lock, and media routes are unreachable for
 * a workspace whose membership is being torn down in that same transaction.
 */
@Injectable()
export class MediaWorkspacePurger implements WorkspacePurger, OnModuleInit {
    readonly purgeName = 'media:assets-and-folders';

    private readonly logger = new Logger(MediaWorkspacePurger.name);

    constructor(
        private readonly uow: UnitOfWork,
        @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
        @Optional() private readonly registry?: WorkspacePurgeRegistry
    ) {}

    /**
     * Join the purge registry once the DI graph is built. `@Optional()` because
     * media may run without the workspaces plugin present.
     */
    onModuleInit(): void {
        this.registry?.register(this);
    }

    /** {@inheritDoc WorkspacePurger.purge} */
    async purge(workspaceId: string): Promise<WorkspacePurgeOutcome> {
        const executor = this.uow.current();

        const assets = await executor
            .delete(mediaAsset)
            .where(eq(mediaAsset.workspaceId, workspaceId))
            .returning({
                storageKey: mediaAsset.storageKey,
                storageProvider: mediaAsset.storageProvider,
                variants: mediaAsset.variants
            });

        // Folders go after the assets: `media_asset.folder_id` has no FK either,
        // but deleting the containers first would briefly leave rows pointing at
        // folders that no longer exist, which is the state this exists to avoid.
        const folders = await executor
            .delete(mediaFolder)
            .where(eq(mediaFolder.workspaceId, workspaceId))
            .returning({ id: mediaFolder.id });

        return {
            rows: assets.length + folders.length,
            reclaim: () => this.reclaim(assets)
        };
    }

    /**
     * Best-effort blob removal, post-commit — the original plus every generated
     * derivative, through this deployment's provider. A row written by another
     * provider is skipped: those bytes are in a backend this process is not
     * connected to (and the boot check refuses that state anyway).
     *
     * A failure leaves an unreferenced
     * blob for a GC sweep, which is strictly better than the previous behaviour
     * (bytes stranded behind a row nobody could find), so it is logged, not
     * raised: the rows are committed and the caller has nothing to retry.
     */
    private async reclaim(
        assets: {
            storageKey: string;
            storageProvider: string;
            variants: Record<string, { key: string }>;
        }[]
    ): Promise<void> {
        let failed = 0;

        await Promise.all(
            assets.map(async (asset) => {
                const keys = [
                    asset.storageKey,
                    ...Object.values(asset.variants ?? {}).map(
                        (variant) => variant.key
                    )
                ];
                if (asset.storageProvider !== this.storage.id) {
                    failed += 1;
                    return;
                }
                try {
                    await Promise.all(
                        keys.map((key) => this.storage.remove(key))
                    );
                } catch {
                    failed += 1;
                }
            })
        );

        if (failed > 0) {
            this.logger.warn(
                `${failed} of ${assets.length} purged assets left blobs behind; their rows are deleted, so the bytes are unreferenced and awaiting GC.`
            );
        }
    }
}
