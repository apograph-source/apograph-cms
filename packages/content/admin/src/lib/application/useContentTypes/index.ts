import { useQuery } from '@tanstack/react-query';
import { STALE_TIME } from '@orthacms/utils-admin';
import { contentTypesKey } from '../../infrastructure/contentKeys';
import { httpContentGateway } from '../../infrastructure/httpContentGateway';

export { contentTypesKey } from '../../infrastructure/contentKeys';

/**
 * Loads the content-type catalogue for the Content Library sidebar and search
 * palette via the content gateway (`GET /content-schema` — the global,
 * code-defined list, not the workspace wizard's mock). Pass `enabled = false` to
 * defer the request until the caller has confirmed read permission. Returns the
 * standard TanStack Query result.
 */
export function useContentTypes(enabled = true) {
    return useQuery({
        queryKey: contentTypesKey,
        queryFn: () => httpContentGateway.listTypes(),
        staleTime: STALE_TIME.Standard,
        enabled
    });
}
