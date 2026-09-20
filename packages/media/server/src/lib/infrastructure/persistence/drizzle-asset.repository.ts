import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import { Asset } from '../../domain/asset';
import type { AssetId } from '../../domain/value-objects/asset-id';
import type { FolderId } from '../../domain/value-objects/folder-id';
import type { AssetRepository } from '../../domain/asset.repository';
import { mediaAsset } from '../schema/media-asset';
import { AssetMapper } from './asset.mapper';

/**
 * Drizzle-backed {@link AssetRepository}. Runs every statement through
 * {@link UnitOfWork.current} so it transparently joins the use-case's
 * transaction. Updates touch only the user-editable columns (name, folder,
 * tags, alt); the stored-blob facts are immutable.
 */
@Injectable()
export class DrizzleAssetRepository implements AssetRepository {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly mapper: AssetMapper
    ) {}

    /** {@inheritDoc AssetRepository.findById} */
    async findById(id: AssetId, workspaceId: string): Promise<Asset | null> {
        const [row] = await this.uow
            .current()
            .select()
            .from(mediaAsset)
            .where(
                and(
                    eq(mediaAsset.id, id.value),
                    eq(mediaAsset.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return row ? this.mapper.toDomain(row) : null;
    }

    /** {@inheritDoc AssetRepository.findManyByIds} */
    async findManyByIds(ids: AssetId[], workspaceId: string): Promise<Asset[]> {
        if (ids.length === 0) return [];
        const rows = await this.uow
            .current()
            .select()
            .from(mediaAsset)
            .where(
                and(
                    eq(mediaAsset.workspaceId, workspaceId),
                    inArray(
                        mediaAsset.id,
                        ids.map((id) => id.value)
                    )
                )
            );
        return rows.map((row) => this.mapper.toDomain(row));
    }

    /** {@inheritDoc AssetRepository.findManyByFolderIds} */
    async findManyByFolderIds(
        folderIds: FolderId[],
        workspaceId: string
    ): Promise<Asset[]> {
        if (folderIds.length === 0) return [];
        const rows = await this.uow
            .current()
            .select()
            .from(mediaAsset)
            .where(
                and(
                    eq(mediaAsset.workspaceId, workspaceId),
                    inArray(
                        mediaAsset.folderId,
                        folderIds.map((id) => id.value)
                    )
                )
            );
        return rows.map((row) => this.mapper.toDomain(row));
    }

    /** {@inheritDoc AssetRepository.save} */
    async save(asset: Asset): Promise<void> {
        const executor = this.uow.current();
        if (asset.isNew) {
            await executor
                .insert(mediaAsset)
                .values(this.mapper.toInsertRow(asset));
            return;
        }
        await executor
            .update(mediaAsset)
            .set({
                name: asset.name.value,
                folderId: asset.folderId?.value ?? null,
                tags: asset.tags,
                alt: asset.alt
            })
            .where(
                and(
                    eq(mediaAsset.id, asset.id.value),
                    eq(mediaAsset.workspaceId, asset.workspaceId)
                )
            );
    }

    /** {@inheritDoc AssetRepository.delete} */
    async delete(asset: Asset): Promise<void> {
        await this.uow
            .current()
            .delete(mediaAsset)
            .where(
                and(
                    eq(mediaAsset.id, asset.id.value),
                    eq(mediaAsset.workspaceId, asset.workspaceId)
                )
            );
    }
}
