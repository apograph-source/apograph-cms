import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type { RelationFieldView } from '../../domain/types/contentType';
import {
    entryRelationsKey,
    relationFieldLinksKey
} from '../../infrastructure/contentKeys';
import { httpContentGateway } from '../../infrastructure/httpContentGateway';

export {
    relationFieldLinksKey,
    relationFieldLinksPrefix
} from '../../infrastructure/contentKeys';
export { RELATION_LINKS_PAGE_SIZE } from '../../infrastructure/httpContentGateway';

/**
 * Infinite-scroll a many/inverse relation field's assigned links via the content
 * gateway (`GET /content/:name/:id/relations/:field`) — a relation with thousands
 * of links is paged, never loaded whole. Returns the flattened `items` (ordered by
 * position), the `total`, and the standard `fetchNextPage`/`hasNextPage`. Disabled
 * until there's an entry id (create mode has none).
 */
export function useRelationFieldLinks(
    name: string,
    id: string | undefined,
    field: string,
    enabled = true
) {
    const workspace = useCurrentWorkspace();
    const queryClient = useQueryClient();
    const query = useInfiniteQuery({
        queryKey: relationFieldLinksKey(workspace.id, name, id ?? '', field),
        enabled: enabled && !!id && !!field,
        initialPageParam: 1,
        queryFn: ({ pageParam }) =>
            httpContentGateway.getRelationField(
                name,
                id as string,
                field,
                pageParam
            ),
        getNextPageParam: (last, pages) => {
            const loaded = pages.reduce((n, p) => n + p.items.length, 0);
            return loaded < last.total ? pages.length + 1 : undefined;
        },
        // Seed page one from the aggregate relations read (`GET …/relations`),
        // already loaded when the Relations tab opened, so this field doesn't
        // re-fetch its first page. `staleTime` + the aggregate's own fetch time
        // keep the seeded page from being refetched immediately; a save still
        // invalidates it (overriding staleTime) to re-read the canonical set.
        initialData: () => {
            const agg = id
                ? queryClient.getQueryData<Record<string, RelationFieldView>>(
                      entryRelationsKey(workspace.id, name, id)
                  )
                : undefined;
            const view = agg?.[field];
            return view ? { pages: [view], pageParams: [1] } : undefined;
        },
        initialDataUpdatedAt: () =>
            id
                ? queryClient.getQueryState(
                      entryRelationsKey(workspace.id, name, id)
                  )?.dataUpdatedAt
                : undefined,
        staleTime: 30_000
    });
    const items = query.data?.pages.flatMap((p) => p.items) ?? [];
    return {
        ...query,
        items,
        total: query.data?.pages[0]?.total ?? 0
    };
}
