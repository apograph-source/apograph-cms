import { Injectable } from '@nestjs/common';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import { Folder } from '../../domain/folder';
import type { FolderId } from '../../domain/value-objects/folder-id';
import type { FolderRepository } from '../../domain/folder.repository';
import { mediaAsset } from '../schema/media-asset';
import { mediaFolder } from '../schema/media-folder';
import { FolderMapper } from './folder.mapper';

/**
 * Drizzle-backed {@link FolderRepository}. Runs through {@link UnitOfWork} so
 * writes join the ambient transaction; the count helpers report a folder's
 * contents and `findDescendantsForUpdate` walks the subtree a delete cascades
 * over.
 */
/** How many times a cascading delete re-walks a subtree that keeps moving. */
const SUBTREE_WALK_ROUNDS = 5;

@Injectable()
export class DrizzleFolderRepository implements FolderRepository {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly mapper: FolderMapper
    ) {}

    /** {@inheritDoc FolderRepository.findById} */
    async findById(id: FolderId, workspaceId: string): Promise<Folder | null> {
        const [row] = await this.uow
            .current()
            .select()
            .from(mediaFolder)
            .where(
                and(
                    eq(mediaFolder.id, id.value),
                    eq(mediaFolder.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return row ? this.mapper.toDomain(row) : null;
    }

    /** {@inheritDoc FolderRepository.findByIdForUpdate} */
    async findByIdForUpdate(
        id: FolderId,
        workspaceId: string
    ): Promise<Folder | null> {
        const [row] = await this.uow
            .current()
            .select()
            .from(mediaFolder)
            .where(
                and(
                    eq(mediaFolder.id, id.value),
                    eq(mediaFolder.workspaceId, workspaceId)
                )
            )
            .limit(1)
            .for('update');
        return row ? this.mapper.toDomain(row) : null;
    }

    /** {@inheritDoc FolderRepository.existsForShare} */
    async existsForShare(id: FolderId, workspaceId: string): Promise<boolean> {
        const [row] = await this.uow
            .current()
            .select({ id: mediaFolder.id })
            .from(mediaFolder)
            .where(
                and(
                    eq(mediaFolder.id, id.value),
                    eq(mediaFolder.workspaceId, workspaceId)
                )
            )
            .limit(1)
            .for('share');
        return !!row;
    }

    /** {@inheritDoc FolderRepository.save} */
    async save(folder: Folder): Promise<void> {
        const executor = this.uow.current();
        if (folder.isNew) {
            await executor
                .insert(mediaFolder)
                .values(this.mapper.toInsertRow(folder));
            return;
        }
        await executor
            .update(mediaFolder)
            .set({ name: folder.name })
            .where(
                and(
                    eq(mediaFolder.id, folder.id.value),
                    eq(mediaFolder.workspaceId, folder.workspaceId)
                )
            );
    }

    /** {@inheritDoc FolderRepository.delete} */
    async delete(folder: Folder): Promise<void> {
        await this.uow
            .current()
            .delete(mediaFolder)
            .where(
                and(
                    eq(mediaFolder.id, folder.id.value),
                    eq(mediaFolder.workspaceId, folder.workspaceId)
                )
            );
    }

    /** {@inheritDoc FolderRepository.countChildFolders} */
    async countChildFolders(
        id: FolderId,
        workspaceId: string
    ): Promise<number> {
        const [row] = await this.uow
            .current()
            .select({ value: count() })
            .from(mediaFolder)
            .where(
                and(
                    eq(mediaFolder.parentId, id.value),
                    eq(mediaFolder.workspaceId, workspaceId)
                )
            );
        return row?.value ?? 0;
    }

    /** {@inheritDoc FolderRepository.findDescendantsForUpdate} */
    async findDescendantsForUpdate(
        id: FolderId,
        workspaceId: string
    ): Promise<Folder[]> {
        // A recursive walk down `parent_id`, carrying the depth so the caller
        // can delete children before parents. `FOR UPDATE` can't be applied to
        // a recursive CTE's own SELECT (Postgres rejects it there), so the walk
        // only *finds* the subtree and a second statement takes the locks.
        const rows = (await this.walkSubtree(id, workspaceId)).map((rowId) => ({
            id: rowId
        }));
        let ids = rows.map((row) => row.id);
        if (!ids.length) return [];

        // Re-read the rows under lock, then restore the depth-first order the
        // CTE established (a plain `IN` query has no order of its own).
        //
        // Walking again after the lock is what closes the window the lock can't:
        // the CTE takes no locks, so a subfolder created under a *descendant*
        // between the two statements wouldn't be in `ids` — it would survive its
        // own parent's deletion and be left dangling. Once every id we know
        // about is locked, a re-walk either agrees (done) or reveals the new
        // child, which we then lock too. It converges because each round can
        // only find folders whose parent is already locked, and those inserts
        // now block on us.
        for (let round = 0; ; round += 1) {
            const locked = await this.uow
                .current()
                .select()
                .from(mediaFolder)
                .where(
                    and(
                        inArray(mediaFolder.id, ids),
                        eq(mediaFolder.workspaceId, workspaceId)
                    )
                )
                .for('update');
            const recheck = await this.walkSubtree(id, workspaceId);
            const known = new Set(ids);
            if (
                recheck.length === ids.length &&
                recheck.every((each) => known.has(each))
            ) {
                const byId = new Map(locked.map((row) => [row.id, row]));
                return ids
                    .map((rowId) => byId.get(rowId))
                    .filter((row) => !!row)
                    .map((row) => this.mapper.toDomain(row));
            }
            // A safety valve: the loop is bounded by the tree's depth in
            // practice, and a caller starving forever would hold locks.
            if (round >= SUBTREE_WALK_ROUNDS) {
                throw new Error(
                    `folder subtree kept changing under a delete (${id.value})`
                );
            }
            ids = recheck;
        }
    }

    /** The subtree's ids, deepest-first. Takes no locks — see the caller. */
    private async walkSubtree(
        id: FolderId,
        workspaceId: string
    ): Promise<string[]> {
        const { rows } = await this.uow.current().execute<{ id: string }>(sql`
            WITH RECURSIVE subtree AS (
                SELECT id, 1 AS depth
                FROM ${mediaFolder}
                WHERE ${mediaFolder.parentId} = ${id.value}
                  AND ${mediaFolder.workspaceId} = ${workspaceId}
                UNION ALL
                SELECT child.id, parent.depth + 1
                FROM ${mediaFolder} AS child
                JOIN subtree AS parent ON child.parent_id = parent.id
                WHERE child.workspace_id = ${workspaceId}
            )
            SELECT id FROM subtree ORDER BY depth DESC
        `);
        return rows.map((row) => row.id);
    }

    /** {@inheritDoc FolderRepository.countAssets} */
    async countAssets(id: FolderId, workspaceId: string): Promise<number> {
        const [row] = await this.uow
            .current()
            .select({ value: count() })
            .from(mediaAsset)
            .where(
                and(
                    eq(mediaAsset.folderId, id.value),
                    eq(mediaAsset.workspaceId, workspaceId)
                )
            );
        return row?.value ?? 0;
    }
}
