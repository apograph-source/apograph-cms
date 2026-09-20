import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { EventActor } from '@orthacms/database';
import type { StoredMediaTrack } from '../../infrastructure/schema/media-asset';
import { AssetId } from '../../domain/value-objects/asset-id';
import { FolderId } from '../../domain/value-objects/folder-id';
import { AssetNotFoundError } from '../../domain/errors/asset-not-found.error';
import { FolderNotFoundError } from '../../domain/errors/folder-not-found.error';
import {
    ASSET_REPOSITORY,
    type AssetRepository
} from '../../domain/asset.repository';
import {
    FOLDER_REPOSITORY,
    type FolderRepository
} from '../../domain/folder.repository';

/** A partial asset edit. `folderId: null` moves the asset to the root. */
export interface UpdateAssetPatch {
    name?: string;
    folderId?: string | null;
    tags?: string[];
    alt?: string;
    /** Timed-text tracks, replacing the asset's current set (`ORT-92`). */
    tracks?: StoredMediaTrack[];
}

/** Applies a partial edit to an asset (rename / move / retag / set alt). */
@Injectable()
export class UpdateAssetUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        @Inject(ASSET_REPOSITORY) private readonly assets: AssetRepository,
        @Inject(FOLDER_REPOSITORY) private readonly folders: FolderRepository
    ) {}

    /** Runs the edit. Throws when the asset (or a move target) is absent. */
    async execute(
        assetId: string,
        workspaceId: string,
        patch: UpdateAssetPatch,
        // `EventActor` (`{ id, email }`) rather than `PublicUser`: that is all
        // `attachActor` reads, and stating the narrower need lets a caller that
        // legitimately has only those two — the copilot's proposal applier —
        // reach this use-case instead of building a fake user to satisfy a
        // wider type. Every existing caller passes a `PublicUser`, which
        // satisfies it.
        actor: EventActor
    ): Promise<void> {
        const id = AssetId.create(assetId);

        return this.uow.run(async () => {
            const asset = await this.assets.findById(id, workspaceId);
            if (!asset) {
                throw new AssetNotFoundError(assetId);
            }

            if (patch.folderId !== undefined) {
                if (patch.folderId === null) {
                    asset.moveTo(null);
                } else {
                    const target = FolderId.create(patch.folderId);
                    // FOR SHARE on the destination: serializes against a
                    // concurrent delete of that folder so the moved asset can't
                    // land in a folder that is being removed.
                    if (
                        !(await this.folders.existsForShare(
                            target,
                            workspaceId
                        ))
                    ) {
                        throw new FolderNotFoundError(patch.folderId);
                    }
                    asset.moveTo(target);
                }
            }
            if (patch.name !== undefined) asset.rename(patch.name);
            if (patch.tags !== undefined) asset.retag(patch.tags);
            if (patch.alt !== undefined) asset.setAlt(patch.alt);
            if (patch.tracks !== undefined) asset.setTracks(patch.tracks);

            await this.assets.save(asset);
            await this.outbox.append(attachActor(asset.pullEvents(), actor));
        });
    }
}
