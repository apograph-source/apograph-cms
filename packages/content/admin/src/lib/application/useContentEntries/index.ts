import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type { ContentTypeDetail } from '../../domain/types/contentType';
import {
    contentEntriesKey,
    type ContentEntriesParams
} from '../../infrastructure/contentKeys';
import { httpContentGateway } from '../../infrastructure/httpContentGateway';

export {
    contentEntriesKey,
    contentEntriesPrefix,
    type ContentEntriesParams
} from '../../infrastructure/contentKeys';
export type { ContentEntriesResult } from '../../infrastructure/contentGateway';

/**
 * Loads a collection's records page via the content gateway. The schema gates the
 * request (the query is disabled until it resolves) and supplies the type name;
 * everything else (search/filter/sort/paginate) happens server-side.
 * `keepPreviousData` keeps the table populated across paging and sorting. The
 * cache key is workspace-scoped, so two workspaces never share an entry.
 */
export function useContentEntries(
    schema: ContentTypeDetail | undefined,
    params: ContentEntriesParams,
    enabled = true
) {
    const workspace = useCurrentWorkspace();
    return useQuery({
        queryKey: contentEntriesKey(workspace.id, schema?.name ?? '', params),
        enabled: enabled && !!schema,
        placeholderData: keepPreviousData,
        // Guarded by `enabled: !!schema`, so the name is always defined here.
        queryFn: () =>
            httpContentGateway.listEntries(
                (schema as ContentTypeDetail).name,
                params
            )
    });
}
