import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { STALE_TIME } from '@orthacms/utils-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type { FilterField } from '@orthacms/query-builder-admin';
import { filterFieldsKey } from '../../infrastructure/contentKeys';
import { httpContentGateway } from '../../infrastructure/httpContentGateway';
import { toFilterField } from '../../infrastructure/contentMapper';

export { filterFieldsKey } from '../../infrastructure/contentKeys';

/**
 * What {@link useFilterFields} returns. The load state is part of the
 * contract, not something callers infer from an empty `fields` array: an
 * empty surface, a still-loading surface, and a failed request are three
 * different things, and the query builder's Apply gate rejects every rule
 * whose field it cannot resolve. Collapsing them makes Apply a silent no-op
 * with nothing on screen explaining why.
 */
export type FilterFieldsResult = {
    /** The mapped filterable paths. Empty while pending and on error. */
    fields: FilterField[];
    /** The surface has not loaded yet. */
    isPending: boolean;
    /** The request failed — render an error state, not an empty picker. */
    isError: boolean;
    /** Retry after a failure. */
    refetch: () => void;
};

/**
 * The type's filterable paths — the type's own fields plus, recursively, its
 * relations' fields (`author.name`) — served by the API and mapped to the
 * query-builder's `FilterField`.
 *
 * Deliberately **not** derived from `useContentSchema`: the surface is
 * recursive and the server owns the whitelist that decides which paths reach
 * SQL. Deriving it client-side would reintroduce the flat
 * `filterFieldsFromSchema` mirror — with a graph to walk, that drift becomes
 * user-visible 400s. Content types are code-defined, so the result only
 * changes on deploy (a standard staleTime avoids refetch churn).
 *
 * Returns the server-derived fields alongside the load state; callers append
 * their own slot-contributed fields (`RECORDS_FILTER_FIELDS_SLOT`), keeping
 * the rules-of-hooks-sensitive slot loop at the call site where it already
 * lives.
 */
export function useFilterFields(
    typeName: string | undefined
): FilterFieldsResult {
    const workspace = useCurrentWorkspace();
    const query = useQuery({
        queryKey: filterFieldsKey(workspace.id, typeName ?? ''),
        queryFn: () => httpContentGateway.listFilterFields(typeName as string),
        enabled: Boolean(typeName),
        staleTime: STALE_TIME.Standard
    });
    const fields = useMemo(
        () => (query.data ?? []).map((f) => toFilterField(typeName ?? '', f)),
        [query.data, typeName]
    );
    const { isPending, isError, refetch } = query;
    return useMemo(
        () => ({
            fields,
            // A disabled query reports `isPending` forever; with no type name
            // there is nothing to wait for, so it is neither pending nor failed.
            isPending: Boolean(typeName) && isPending,
            isError,
            refetch
        }),
        [fields, typeName, isPending, isError, refetch]
    );
}
