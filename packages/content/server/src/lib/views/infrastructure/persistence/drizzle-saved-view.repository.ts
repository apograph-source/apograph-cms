import { Injectable } from '@nestjs/common';
import { UnitOfWork, type Database } from '@orthacms/database';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import { savedViewDefaults, savedViews } from '../schema/saved-views';
import type {
    NewSavedView,
    SavedViewPatch,
    SavedViewRecord,
    SavedViewRepository
} from '../../domain/saved-view.repository';
import type { ViewVisibility } from '../../domain/saved-view';
import { VIEW_VISIBILITY } from '../../domain/saved-view';
import { SavedViewNotFoundError } from '../../domain/errors';

/** The columns every read of this table projects. */
const COLUMNS = {
    id: savedViews.id,
    workspaceId: savedViews.workspaceId,
    scope: savedViews.scope,
    ownerId: savedViews.ownerId,
    visibility: savedViews.visibility,
    name: savedViews.name,
    payload: savedViews.payload,
    position: savedViews.position,
    updatedAt: savedViews.updatedAt
};

/** Narrows the enum column's `string` back to the domain union. */
function toRecord(row: {
    id: string;
    workspaceId: string;
    scope: string;
    ownerId: string;
    visibility: string;
    name: string;
    payload: SavedViewRecord['payload'];
    position: number;
    updatedAt: Date;
}): SavedViewRecord {
    return { ...row, visibility: row.visibility as ViewVisibility };
}

/** Drizzle adapter for {@link SavedViewRepository}. */
@Injectable()
export class DrizzleSavedViewRepository implements SavedViewRepository {
    constructor(private readonly uow: UnitOfWork) {}

    /**
     * The executor to run against: the ambient transaction when a caller opened
     * one, the base connection otherwise.
     *
     * It exists so a view write and the `saved_view.*` event describing it
     * commit together. Outside a unit of work this is the old behaviour
     * exactly — `UnitOfWork.current()` falls back to the pool.
     */
    private get db(): Database {
        return this.uow.current();
    }

    async listVisible(
        workspaceId: string,
        scope: string,
        readerId: string
    ): Promise<SavedViewRecord[]> {
        const rows = await this.db
            .select(COLUMNS)
            .from(savedViews)
            .where(
                and(
                    eq(savedViews.workspaceId, workspaceId),
                    eq(savedViews.scope, scope),
                    // Own views at any visibility, plus everyone's shared ones.
                    or(
                        eq(savedViews.ownerId, readerId),
                        eq(savedViews.visibility, VIEW_VISIBILITY.Workspace)
                    )
                )
            )
            .orderBy(
                asc(savedViews.position),
                asc(savedViews.createdAt),
                asc(savedViews.id)
            );
        return rows.map(toRecord);
    }

    async findById(id: string): Promise<SavedViewRecord | null> {
        const [row] = await this.db
            .select(COLUMNS)
            .from(savedViews)
            .where(eq(savedViews.id, id))
            .limit(1);
        return row ? toRecord(row) : null;
    }

    async countForOwner(
        workspaceId: string,
        scope: string,
        ownerId: string
    ): Promise<number> {
        const [row] = await this.db
            .select({ count: sql<number>`count(*)::int` })
            .from(savedViews)
            .where(
                and(
                    eq(savedViews.workspaceId, workspaceId),
                    eq(savedViews.scope, scope),
                    eq(savedViews.ownerId, ownerId)
                )
            );
        return row?.count ?? 0;
    }

    async create(view: NewSavedView): Promise<SavedViewRecord> {
        const [row] = await this.db
            .insert(savedViews)
            .values({
                workspaceId: view.workspaceId,
                scope: view.scope,
                ownerId: view.ownerId,
                visibility: view.visibility,
                name: view.name,
                payload: view.payload
            })
            .returning(COLUMNS);
        return toRecord(row);
    }

    async update(id: string, patch: SavedViewPatch): Promise<SavedViewRecord> {
        const [row] = await this.db
            .update(savedViews)
            .set({
                ...(patch.name !== undefined ? { name: patch.name } : {}),
                ...(patch.visibility !== undefined
                    ? { visibility: patch.visibility }
                    : {}),
                ...(patch.payload !== undefined
                    ? { payload: patch.payload }
                    : {})
            })
            .where(eq(savedViews.id, id))
            .returning(COLUMNS);
        // The use-case reads the row before patching, so a miss here means it
        // was deleted in between — surface the same not-found the read would.
        if (!row) throw new SavedViewNotFoundError(id);
        return toRecord(row);
    }

    async delete(id: string): Promise<void> {
        await this.db.delete(savedViews).where(eq(savedViews.id, id));
    }

    async findDefaultId(userId: string, scope: string): Promise<string | null> {
        const [row] = await this.db
            .select({ viewId: savedViewDefaults.viewId })
            .from(savedViewDefaults)
            .where(
                and(
                    eq(savedViewDefaults.userId, userId),
                    eq(savedViewDefaults.scope, scope)
                )
            )
            .limit(1);
        return row?.viewId ?? null;
    }

    async setDefault(
        userId: string,
        scope: string,
        viewId: string
    ): Promise<void> {
        await this.db
            .insert(savedViewDefaults)
            .values({ userId, scope, viewId })
            // One row per (user, scope) — re-pointing the default is an upsert,
            // not a delete-then-insert that could lose the row on a crash.
            .onConflictDoUpdate({
                target: [savedViewDefaults.userId, savedViewDefaults.scope],
                set: { viewId }
            });
    }

    async clearDefault(userId: string, scope: string): Promise<void> {
        await this.db
            .delete(savedViewDefaults)
            .where(
                and(
                    eq(savedViewDefaults.userId, userId),
                    eq(savedViewDefaults.scope, scope)
                )
            );
    }
}
