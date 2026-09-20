import { useQuery } from '@tanstack/react-query';
import { STALE_TIME } from '@orthacms/utils-admin';
import { contentSchemaKey } from '../../infrastructure/contentKeys';
import { httpContentGateway } from '../../infrastructure/httpContentGateway';

export { contentSchemaKey } from '../../infrastructure/contentKeys';

/**
 * Loads one content type's full field schema for the records table (columns,
 * filter fields, cell rendering) via the content gateway
 * (`GET /content-schema/:name`). Pass `enabled = false` to defer until the caller
 * has resolved the type. Returns the standard TanStack Query result.
 */
export function useContentSchema(name: string, enabled = true) {
    return useQuery({
        queryKey: contentSchemaKey(name),
        queryFn: () => httpContentGateway.getSchema(name),
        staleTime: STALE_TIME.Standard,
        enabled
    });
}
