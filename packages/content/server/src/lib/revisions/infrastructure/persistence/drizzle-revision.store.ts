import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, max, ne, sql } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import type {
    RevisionExecutor,
    RevisionHead,
    RevisionStore
} from '../../application/ports/revision-store';
import type { Revision } from '../../domain/revision';
import type { RevisionStatus } from '../../domain/revision-status';
import { REVISION_STATUS } from '../../domain/revision-status';
import type {
    RevisionDetail,
    RevisionListView,
    RevisionSnapshot,
    RevisionSummary
} from '../../types/revision-view';
import { contentEntryRevisions as revisions } from './revision-table';

/** A `content_entry_revisions` row seen as a value bag. */
type RevisionRow = typeof revisions.$inferSelect;

/**
 * A private advisory-lock class namespacing the per-entry revision-append locks,
 * so their hashed keys can't collide with any other advisory lock the app takes
 * (identity's per-workspace lock, the relation-append locks). Arbitrary but fixed.
 */
const REVISION_APPEND_LOCK_CLASS = 0x5245; // 'RE'

/**
 * The Drizzle-backed {@link RevisionStore}. Writes are executor-parameterized so
 * a snapshot commits atomically with the save it records (via the
 * `EntryWriterService` transaction); reads run on the base connection.
 */
@Injectable()
export class DrizzleRevisionStore implements RevisionStore {
    constructor(@InjectDatabase() private readonly db: Database) {}

    async lockEntry(exec: RevisionExecutor, entryId: string): Promise<void> {
        await exec.execute(
            sql`select pg_advisory_xact_lock(${REVISION_APPEND_LOCK_CLASS}, hashtext(${entryId}))`
        );
    }

    async nextNumber(exec: RevisionExecutor, entryId: string): Promise<number> {
        const [row] = await exec
            .select({ max: max(revisions.revisionNumber) })
            .from(revisions)
            .where(eq(revisions.entryId, entryId));
        const current = row?.max;
        return current == null ? 1 : Number(current) + 1;
    }

    async append(
        exec: RevisionExecutor,
        revision: Revision
    ): Promise<RevisionSummary> {
        const record = revision.toPersistence();
        const [inserted] = await exec
            .insert(revisions)
            .values({
                contentType: record.contentType,
                entryId: record.entryId,
                workspaceId: record.workspaceId,
                localeGroupId: record.localeGroupId,
                locale: record.locale,
                revisionNumber: record.revisionNumber,
                status: record.status,
                snapshot: record.snapshot,
                createdBy: record.createdBy
            })
            .returning();
        // A freshly appended draft is by construction the newest revision; it is
        // never the published one (publish is a separate transition).
        return this.toSummary(inserted as RevisionRow, {
            latestNumber: record.revisionNumber
        });
    }

    async markPublished(
        exec: RevisionExecutor,
        entryId: string,
        workspaceId: string,
        revisionNumber?: number
    ): Promise<void> {
        const scope = and(
            eq(revisions.entryId, entryId),
            eq(revisions.workspaceId, workspaceId)
        );
        let target = revisionNumber;
        if (target == null) {
            const [row] = await exec
                .select({ max: max(revisions.revisionNumber) })
                .from(revisions)
                .where(scope);
            target = row?.max == null ? 0 : Number(row.max);
        }
        if (target === 0) return;
        // Demote a previously-published version (there's at most one, and it
        // isn't the one we're about to promote) so the timeline keeps a
        // single live row. Its `published_at` is left as the historical record
        // of when it was live.
        await exec
            .update(revisions)
            .set({ status: REVISION_STATUS.Superseded })
            .where(
                and(
                    scope,
                    eq(revisions.status, REVISION_STATUS.Published),
                    ne(revisions.revisionNumber, target)
                )
            );
        // Promote the target version — its snapshot is exactly the live row that
        // was just published (the latest after a save, or the earlier version
        // whose content the publish just re-applied). Re-stamps on an idempotent
        // re-publish, mirroring the entry row's `markPublished`.
        await exec
            .update(revisions)
            .set({
                status: REVISION_STATUS.Published,
                publishedAt: new Date()
            })
            .where(and(scope, eq(revisions.revisionNumber, target)));
    }

    async markUnpublished(
        exec: RevisionExecutor,
        entryId: string,
        workspaceId: string
    ): Promise<void> {
        await exec
            .update(revisions)
            .set({ status: REVISION_STATUS.Draft, publishedAt: null })
            .where(
                and(
                    eq(revisions.entryId, entryId),
                    eq(revisions.workspaceId, workspaceId),
                    eq(revisions.status, REVISION_STATUS.Published)
                )
            );
    }

    async list(
        contentType: string,
        entryId: string,
        workspaceId: string,
        page: number,
        pageSize: number
    ): Promise<RevisionListView> {
        const where = this.scope(contentType, entryId, workspaceId);
        const offset = (page - 1) * pageSize;
        const [rows, [{ total }], latestNumber] = await Promise.all([
            this.db
                .select()
                .from(revisions)
                .where(where)
                .orderBy(desc(revisions.revisionNumber))
                .limit(pageSize)
                .offset(offset),
            this.db.select({ total: count() }).from(revisions).where(where),
            this.latestNumber(contentType, entryId, workspaceId)
        ]);
        return {
            items: (rows as RevisionRow[]).map((row) =>
                this.toSummary(row, { latestNumber })
            ),
            total: Number(total)
        };
    }

    /**
     * One query for a whole page's heads, whatever the page holds.
     *
     * `DISTINCT ON (entry_id) … ORDER BY entry_id, revision_number DESC` is
     * Postgres' own "greatest row per group": the planner walks the
     * `(entry_id, revision_number)` unique index and takes the first row of each
     * group, so the cost is one index scan rather than a scan per entry. The
     * ordering clause is not cosmetic — `DISTINCT ON` keeps whichever row sorts
     * first, so dropping the `DESC` would silently return version 1 of every
     * entry.
     */
    async heads(
        contentType: string,
        entryIds: readonly string[],
        workspaceId: string
    ): Promise<RevisionHead[]> {
        // An empty `IN ()` is not valid SQL, and asking about no entries is a
        // question with an answer — the caller's page held no rows.
        if (!entryIds.length) return [];
        const rows = await this.db
            .selectDistinctOn([revisions.entryId], {
                entryId: revisions.entryId,
                id: revisions.id,
                number: revisions.revisionNumber,
                authorId: revisions.createdBy
            })
            .from(revisions)
            .where(
                and(
                    eq(revisions.contentType, contentType),
                    eq(revisions.workspaceId, workspaceId),
                    inArray(revisions.entryId, [...entryIds])
                )
            )
            .orderBy(revisions.entryId, desc(revisions.revisionNumber));
        return rows.map((row) => ({
            entryId: row.entryId,
            id: row.id,
            number: row.number,
            authorId: row.authorId ?? null
        }));
    }

    async get(
        contentType: string,
        entryId: string,
        workspaceId: string,
        number: number
    ): Promise<RevisionDetail | undefined> {
        const [row, latestNumber] = await Promise.all([
            this.db
                .select()
                .from(revisions)
                .where(
                    and(
                        this.scope(contentType, entryId, workspaceId),
                        eq(revisions.revisionNumber, number)
                    )
                )
                .limit(1)
                .then((r) => r[0] as RevisionRow | undefined),
            this.latestNumber(contentType, entryId, workspaceId)
        ]);
        if (!row) return undefined;
        return {
            ...this.toSummary(row, { latestNumber }),
            snapshot: row.snapshot as RevisionSnapshot
        };
    }

    /** The highest version number for an entry, or 0 if it has no revisions. */
    private async latestNumber(
        contentType: string,
        entryId: string,
        workspaceId: string
    ): Promise<number> {
        const [row] = await this.db
            .select({ max: max(revisions.revisionNumber) })
            .from(revisions)
            .where(this.scope(contentType, entryId, workspaceId));
        return row?.max == null ? 0 : Number(row.max);
    }

    /**
     * The read scope every timeline query shares: one entry, in one workspace,
     * **of one content type**. All types share `content_entry_revisions`, and
     * the routes address an entry as `:typeName/:id` — so leaving the type out
     * means the `:typeName` in the URL is never checked against the revision it
     * returns, and any registered type name serves any entry's history.
     */
    private scope(contentType: string, entryId: string, workspaceId: string) {
        return and(
            eq(revisions.contentType, contentType),
            eq(revisions.entryId, entryId),
            eq(revisions.workspaceId, workspaceId)
        );
    }

    /** Map a row to the metadata view, deriving the `isLatest`/`isPublished` flags. */
    private toSummary(
        row: RevisionRow,
        ctx: { latestNumber: number }
    ): RevisionSummary {
        const status = row.status as RevisionStatus;
        const summary: RevisionSummary = {
            id: row.id,
            number: row.revisionNumber,
            status,
            isPublished: status === REVISION_STATUS.Published,
            isLatest: row.revisionNumber === ctx.latestNumber,
            createdAt: row.createdAt.toISOString()
        };
        if (row.publishedAt)
            summary.publishedAt = row.publishedAt.toISOString();
        if (row.createdBy) summary.authorId = row.createdBy;
        return summary;
    }
}
