/** Parameters accepted by `GET /api/activity` — the log's search and paging. */
export type ActivityListParams = {
    /** Case-insensitive actor-email substring; omit for no filter. */
    actorEmail?: string;
    /** Query-builder filter tree as a JSON string; omit for no structured filter. */
    filter?: string;
    /** 1-based page number; the server defaults to 1. */
    page?: number;
    /** Rows per page; the server defaults to its own page size. */
    pageSize?: number;
    /**
     * Sort column; the server defaults to `at`.
     *
     * **No UI control sets this today.** The server whitelists `at`/`kind` and
     * the field is carried so a future sortable header has somewhere to write,
     * but the Activity table has no sortable column and `users-admin`'s per-user
     * tab sends no sort either — so every list is the server's default
     * newest-first. Don't read a `sort` in this type as evidence that a control
     * exists (`♿ A11Y-activity-admin-08` records that the absent `aria-sort` is
     * correct precisely because nothing is sortable).
     */
    sort?: 'at' | 'kind';
    /** Sort direction; the server defaults to `desc`. Also unset by any UI. */
    order?: 'asc' | 'desc';
};

/**
 * Prefix shared by every dead-letter query, whatever page size asked for it.
 *
 * The retry mutation invalidates **this** and nothing wider: the banner and the
 * dialog hold two different pages of the same list and both must refresh, while
 * the activity log itself must not. The retried event has not been delivered
 * yet, so invalidating `activityKeys.all` would refetch every cached log page
 * for a change that has not happened.
 */
const DEAD_LETTERS_ROOT = ['activity', 'dead-letters'] as const;

/**
 * Query keys for the activity cache. The list endpoint lives under
 * `activityKeys.list(params)`; the root `activityKeys.all` covers every query
 * (audit events are append-only, so there are no mutations to invalidate here,
 * but new writes elsewhere can be reflected by invalidating the root).
 */
export const activityKeys = {
    /** Root key covering every activity query. */
    all: ['activity'] as const,
    /** One list page for the given params. */
    list: (params: ActivityListParams) => ['activity', 'list', params] as const,
    /** Every dead-letter page, whatever its limit — what a retry invalidates. */
    deadLettersRoot: DEAD_LETTERS_ROOT,
    /**
     * The events that could not be recorded — how complete the log is.
     *
     * **Keyed by `limit`, and that is load-bearing.** The key used to take no
     * parameters while the request hard-coded `limit: 5`, so a second caller
     * asking for a larger page wrote its answer into the banner's cache entry —
     * and the banner computes its "most recent kinds" line from `items`, so its
     * copy changed depending on whether the dialog had been opened.
     */
    deadLetters: (limit: number) => [...DEAD_LETTERS_ROOT, limit] as const,
    /**
     * One entry's own trail. Keyed separately from `list` because it is a
     * different route with a different permission, and a `content:read` editor
     * caching under the admin log's key would be confusing to reason about.
     */
    entry: (entryId: string, pageSize: number) =>
        ['activity', 'entry', entryId, pageSize] as const
};
