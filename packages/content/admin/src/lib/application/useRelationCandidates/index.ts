import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import {
    treeToJsonFilter,
    type FilterGroup
} from '@orthacms/query-builder-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type { ContentField } from '../../domain/types/contentType';
import { relationLabel } from '../../domain/relationLabel';
import { relationCandidatesKey } from '../../infrastructure/contentKeys';
import { httpContentGateway } from '../../infrastructure/httpContentGateway';

export {
    RELATION_CANDIDATES_MAX_PAGE_SIZE,
    RELATION_CANDIDATES_PAGE_SIZE
} from '../../infrastructure/httpContentGateway';
export { relationCandidatesKey } from '../../infrastructure/contentKeys';

/** One assignable related record, ready for the picker (title pre-derived). */
export type RelationCandidate = {
    id: string;
    /** Display title (first text/select field, else id). */
    title: string;
    /** Publish status — present only for publishable target types. */
    status?: 'draft' | 'published';
    /** The record's field values, keyed by field name. */
    values: Record<string, unknown>;
};

/** Params narrowing the candidate list — the picker's search + query builder. */
export type RelationCandidatesParams = {
    /** Free-text search across the record's string values. */
    search?: string;
    /** The composed query-builder tree, or null when no rules are set. */
    filter?: FilterGroup | null;
    /**
     * Slot-contributed list params (e.g. locale scoping from the entry-params
     * slot), forwarded to the request verbatim and keyed into the cache.
     */
    extra?: Record<string, string>;
};

/** The paginated candidate envelope: the loaded matches, the full count, more-flag. */
export type RelationCandidatesResult = {
    items: RelationCandidate[];
    /** Total matches across the whole (filtered) set, not just what's loaded. */
    total: number;
    /** Whether more matches exist beyond the loaded pages (drives lazy load). */
    hasMore: boolean;
    /** Whether the first page is still loading (no data yet). */
    isPending: boolean;
    /** Whether the candidate query failed. */
    isError: boolean;
    /**
     * Whether **any** candidate request is in flight, including a re-search that
     * keeps the previous rows on screen. Drives the search box's busy cue — the
     * picker searches server-side, so without it the box looks inert.
     */
    isFetching: boolean;
    /** Whether a further page is currently loading (drives the load-more spinner). */
    isFetchingNextPage: boolean;
    /** Fetch the next page of matches (lazy infinite scroll). */
    fetchNextPage: () => void;
};

/**
 * The assignable records for a relation's target type, served via the content
 * gateway (`GET /content/:type` — the same server pipeline the records table
 * uses, so the picker's `search` and query-builder `filter` run **server-side**).
 * `schemaFields` derives each row's title (mirroring the server's `entryTitle`);
 * the list grows by **real pagination** (`fetchNextPage`, lazy infinite scroll) —
 * there is no artificial window cap, so a type with more than one page of entries
 * is fully reachable. Returns the stable `{ items, total, hasMore, … }` envelope
 * the dialog renders. Disabled (via `enabled`) until the picker opens.
 */
export function useRelationCandidates(
    targetName: string,
    schemaFields: readonly ContentField[],
    params: RelationCandidatesParams,
    enabled = true
): RelationCandidatesResult {
    const { search = '', filter = null, extra = {} } = params;
    const workspace = useCurrentWorkspace();
    // Serialize the query-builder tree to the `?filter=` wire JSON the server
    // parses (null when the tree has no complete rules).
    const filterJson = filter ? treeToJsonFilter(filter) : null;

    const query = useInfiniteQuery({
        queryKey: relationCandidatesKey(workspace.id, targetName, {
            search,
            filter: filterJson,
            ...(Object.keys(extra).length ? { extra } : {})
        }),
        enabled: enabled && !!targetName,
        placeholderData: keepPreviousData,
        initialPageParam: 1,
        queryFn: ({ pageParam }) =>
            httpContentGateway.listRelationCandidates(targetName, {
                search,
                filter: filterJson,
                page: pageParam,
                extra
            }),
        // Another page exists while fewer rows are loaded than the total match
        // count; the next page is the following offset.
        getNextPageParam: (last, pages) => {
            const loaded = pages.reduce((n, p) => n + p.items.length, 0);
            return loaded < last.total ? pages.length + 1 : undefined;
        }
    });

    const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
    const items: RelationCandidate[] = rows.map((record) => ({
        id: record.id,
        title: relationLabel(record.values, schemaFields, record.id),
        status: record.status,
        values: record.values
    }));
    const total = query.data?.pages[0]?.total ?? 0;

    return {
        items,
        total,
        hasMore: query.hasNextPage,
        isPending: enabled && query.isPending,
        isError: query.isError,
        isFetching: query.isFetching,
        isFetchingNextPage: query.isFetchingNextPage,
        fetchNextPage: query.fetchNextPage
    };
}
