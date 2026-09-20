import { Injectable } from '@nestjs/common';
import { count, eq, type AnyColumn } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import type { ContentEntryCounter } from '@orthacms/workspaces-server';
import { InjectContentRegistry } from '../../../content.tokens';
import type { ContentTypeRegistry } from '../../../registry/content-type-registry';
import type { AnyContentType } from '../../../types/content-type';

/** A generated content table seen as a bag of columns by property name. */
type ContentTable = Record<string, AnyColumn>;

/**
 * Implements identity's {@link ContentEntryCounter} port over the generated
 * `content_<name>` tables: counts how many entries of a content type a
 * workspace holds. Bound to `CONTENT_ENTRY_COUNTER` in {@link ContentModule},
 * so identity's "revoke a content-type grant only when empty" rule resolves
 * against the real stored entries.
 */
@Injectable()
export class EntryCounterService implements ContentEntryCounter {
    constructor(
        @InjectDatabase() private readonly db: Database,
        @InjectContentRegistry() private readonly registry: ContentTypeRegistry
    ) {}

    /**
     * Every stored row of content type `slug` in `workspaceId`. Counts the
     * whole workspace slice of the type's table — including soft-deleted rows
     * for paranoid types (data that still exists must keep the grant). An
     * unknown slug (no such content type) counts as `0`.
     */
    async countEntries(workspaceId: string, slug: string): Promise<number> {
        const type = this.registry.get(slug);
        if (!type) return 0;
        return this.countTable(type, workspaceId);
    }

    /**
     * Every stored row the workspace holds across **all** content types —
     * summed over each type's table. Backs the workspace-delete guard (delete is
     * refused until this is zero). The per-type counts run concurrently.
     *
     * Deliberately **not** narrowed to the workspace's `workspace_content`
     * grants, even though every read/write surface now is
     * (`ContentGrantGuard`). This is a data-safety guard, not an access-control
     * surface, and the two want opposite defaults: counting only granted types
     * would let a workspace be deleted while rows of an ungranted type still
     * sat in its slice — exactly the orphaned records the guard exists to
     * prevent. Such rows are no longer *creatable* through the API, but a grant
     * revoked between two deployments, or data written before the grant check
     * landed, still has to hold the delete. Counting everything can only ever
     * refuse a delete too often, which is the safe direction to be wrong in.
     */
    async countWorkspaceEntries(workspaceId: string): Promise<number> {
        const counts = await Promise.all(
            this.registry
                .all()
                .map((type) => this.countTable(type, workspaceId))
        );
        return counts.reduce((sum, n) => sum + n, 0);
    }

    /** Counts a single content type's rows in a workspace. */
    private async countTable(
        type: AnyContentType,
        workspaceId: string
    ): Promise<number> {
        const table = type.table as unknown as ContentTable;
        const [{ total }] = await this.db
            .select({ total: count() })
            .from(type.table)
            .where(eq(table['workspaceId'], workspaceId));
        return total;
    }
}
