import { Inject } from '@nestjs/common';
import type { Database } from '@orthacms/database';
import type { DbTransaction } from '../../../entries/infrastructure/persistence/relation-link.service';
import type { Revision } from '../../domain/revision';
import type {
    RevisionDetail,
    RevisionListView,
    RevisionSummary
} from '../../types/revision-view';

/** An executor that may be the base connection or an ambient transaction. */
export type RevisionExecutor = Database | DbTransaction;

/**
 * One entry's current version, as {@link RevisionStore.heads} reports it.
 *
 * Deliberately narrower than {@link RevisionSummary}: the batched read answers
 * "which version is live and who wrote it" for a page of entries, and the
 * summary's derived flags (`isLatest`, `isPublished`) each cost a second query
 * per entry to compute — which is the cost this read exists to avoid.
 */
export interface RevisionHead {
    /** The live `content_<name>` row this head belongs to. */
    entryId: string;
    /** The revision row id — what an approval binds to. */
    id: string;
    /** Its 1-based version number within the entry. */
    number: number;
    /**
     * The acting user, or `null` for a write with nobody behind it — a bearer
     * token, an import, a migration. Absent means "nobody to exclude" to a
     * caller applying a four-eyes rule.
     */
    authorId: string | null;
}

/**
 * The persistence port for entry revisions. Write primitives are
 * **executor-parameterized** so `EntryWriterService` can append a revision on
 * its own save transaction (atomic with the row + relation writes); reads run on
 * the base connection.
 */
export interface RevisionStore {
    /**
     * The next version number for an entry: `max(revision_number) + 1`, else 1.
     * Runs on the write executor so it sees the entry's own uncommitted rows.
     * The caller serializes concurrent savers with an advisory lock so two
     * appends can't allocate the same number.
     */
    nextNumber(exec: RevisionExecutor, entryId: string): Promise<number>;

    /**
     * Take the entry's transaction-scoped append lock, so concurrent saves of the
     * same entry allocate distinct version numbers instead of colliding.
     */
    lockEntry(exec: RevisionExecutor, entryId: string): Promise<void>;

    /** Insert a revision on `exec`, returning its summary view. */
    append(
        exec: RevisionExecutor,
        revision: Revision
    ): Promise<RevisionSummary>;

    /**
     * Promote one revision to `published` (stamping `published_at`) and demote
     * any previously-published revision to `superseded`, on `exec`. This is the
     * publish transition the snapshot-on-save defers — every revision is born a
     * `draft`, so without it the timeline never shows a version as live.
     * Idempotent, and a no-op for an entry with no revisions.
     *
     * `revisionNumber` names the version to promote; omitted, it targets the
     * **latest**, which is exactly the just-published live row (every save
     * appends one). It is passed only when publishing a *specific* earlier
     * version, whose content the caller has already re-applied to the live row —
     * that version becomes live in place instead of being copied to a new one.
     */
    markPublished(
        exec: RevisionExecutor,
        entryId: string,
        workspaceId: string,
        revisionNumber?: number
    ): Promise<void>;

    /**
     * Demote the entry's currently-published revision back to `draft` (clearing
     * `published_at`) on `exec` — the unpublish counterpart. At most one
     * revision is published, so this transitions exactly that one; a no-op if
     * none is.
     */
    markUnpublished(
        exec: RevisionExecutor,
        entryId: string,
        workspaceId: string
    ): Promise<void>;

    /**
     * One page of an entry's revisions, newest first, scoped to the content
     * type + entry + workspace.
     *
     * `contentType` is part of the key, not decoration: every content type's
     * rows live in one shared `content_entry_revisions` table, so without it a
     * caller who names a *different* registered type in the route
     * (`GET /api/content/author/:articleId/revisions`) reads the entry's real
     * history anyway — the route param would be checked against nothing.
     */
    list(
        contentType: string,
        entryId: string,
        workspaceId: string,
        page: number,
        pageSize: number
    ): Promise<RevisionListView>;

    /**
     * The head revision of **many** entries at once, scoped to the content type
     * + workspace.
     *
     * The batched form of "page 1, size 1" of {@link list}. It exists because a
     * caller that wants the head of a whole records page — a contributed column,
     * a per-page aggregate — would otherwise issue one `list` per row, and
     * `list` is three queries: an N+1 that grows with the page size. This is one
     * query whatever the page holds, and `revision-heads.spec.ts` pins that.
     *
     * Returns **one row per entry that has a revision**, in no guaranteed order.
     * An id with no revision under this type in this workspace is simply
     * **absent** rather than an error or a null entry: to a caller the two
     * reasons are the same fact — there is no head here to read — and reporting
     * them apart would let a caller distinguish "the entry is not yours" from
     * "the entry does not exist". An empty `entryIds` reads nothing at all.
     *
     * See {@link list} for why `contentType` is part of the key, and not
     * decoration: every content type's rows share one table.
     */
    heads(
        contentType: string,
        entryIds: readonly string[],
        workspaceId: string
    ): Promise<RevisionHead[]>;

    /**
     * One revision (with its snapshot) by version number, scoped to the content
     * type + entry + workspace — or undefined if absent. See {@link list} for
     * why `contentType` is part of the key.
     */
    get(
        contentType: string,
        entryId: string,
        workspaceId: string,
        number: number
    ): Promise<RevisionDetail | undefined>;
}

/** DI token the {@link RevisionStore} is bound under. */
export const REVISION_STORE = Symbol('REVISION_STORE');

/** Injects the {@link RevisionStore}. */
export const InjectRevisionStore = (): ParameterDecorator =>
    Inject(REVISION_STORE);
