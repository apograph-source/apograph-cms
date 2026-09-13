import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@apograph/database';
import type { PublicUser } from '@apograph/identity-server';
import type { Asset } from '../../domain/asset';
import { FolderId } from '../../domain/value-objects/folder-id';
import { FolderNotFoundError } from '../../domain/errors/folder-not-found.error';
import {
    ASSET_REPOSITORY,
    type AssetRepository
} from '../../domain/asset.repository';
import {
    FOLDER_REPOSITORY,
    type FolderRepository
} from '../../domain/folder.repository';
import { STORAGE_PROVIDER, type StorageProvider } from '@apograph/media-domain';
import { reclaimManyAssetBlobs } from '../reclaim-asset-blobs';

/** What a cascading folder delete removed. */
export interface DeletedFolderTree {
    /** Folders removed, including the one named. */
    folders: number;
    /** Assets removed from anywhere in the subtree. */
    assets: number;
}

/**
 * Deletes a folder **and everything inside it** — every descendant folder and
 * every asset in any of them — as one transaction, then reclaims the blobs.
 *
 * This used to refuse a non-empty folder with a 409, which left the only way to
 * remove a populated tree as emptying it by hand, level by level. Deleting a
 * folder means deleting what it holds, as it does in every file manager; the
 * safeguard belongs in the UI's confirmation (which names the counts), not in a
 * server that can't be asked.
 *
 * Ordering and locking: the target is locked `FOR UPDATE`, then the whole
 * subtree is locked the same way and returned deepest-first, so a concurrent
 * upload/move/create-subfolder (each takes `FOR SHARE` on its destination)
 * serializes against the delete instead of orphaning a row, and no parent is
 * removed before its children. Blobs are reclaimed **post-commit**, so a
 * rolled-back delete never destroys bytes a surviving row points at.
 */
@Injectable()
export class DeleteFolderUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        @Inject(FOLDER_REPOSITORY) private readonly folders: FolderRepository,
        @Inject(ASSET_REPOSITORY) private readonly assets: AssetRepository,
        @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider
    ) {}

    /** Runs the cascade. Throws only when the folder itself is absent. */
    async execute(
        folderId: string,
        workspaceId: string,
        actor: PublicUser
    ): Promise<DeletedFolderTree> {
        const id = FolderId.create(folderId);

        const { removedAssets, folderCount } = await this.uow.run(async () => {
            const folder = await this.folders.findByIdForUpdate(
                id,
                workspaceId
            );
            if (!folder) {
                throw new FolderNotFoundError(folderId);
            }

            // Deepest-first, so children are always removed before parents.
            const descendants = await this.folders.findDescendantsForUpdate(
                id,
                workspaceId
            );
            const tree = [...descendants, folder];

            const assets = await this.assets.findManyByFolderIds(
                tree.map((each) => each.id),
                workspaceId
            );
            for (const asset of assets) {
                asset.markDeleted();
                await this.assets.delete(asset);
                await this.outbox.append(
                    attachActor(asset.pullEvents(), actor)
                );
            }

            for (const each of tree) {
                each.markDeleted();
                await this.folders.delete(each);
                await this.outbox.append(attachActor(each.pullEvents(), actor));
            }

            return { removedAssets: assets, folderCount: tree.length };
        });

        await this.reclaimAll(removedAssets);
        return { folders: folderCount, assets: removedAssets.length };
    }

    /**
     * Best-effort blob reclamation for every asset the cascade removed, with a
     * bounded number of provider calls in flight — a folder holding thousands
     * of assets must not open one file descriptor per blob at once.
     */
    private async reclaimAll(assets: Asset[]): Promise<void> {
        await reclaimManyAssetBlobs(this.provider, assets);
    }
}
