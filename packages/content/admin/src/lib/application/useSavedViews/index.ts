import { useQuery } from '@tanstack/react-query';
import { STALE_TIME } from '@orthacms/utils-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { savedViewsKey } from '../../infrastructure/savedViewsKeys';
import { httpSavedViewsGateway } from '../../infrastructure/httpSavedViewsGateway';

export {
    savedViewsKey,
    contentScope
} from '../../infrastructure/savedViewsKeys';

/**
 * Loads the saved views for one list. Workspace-scoped cache key, so switching
 * workspaces never shows the other's views from cache.
 *
 * Pass `enabled = false` to defer until the caller has confirmed `content:read`
 * — a member without it has no records page to save a view over.
 */
export function useSavedViews(scope: string, enabled = true) {
    const workspace = useCurrentWorkspace();
    return useQuery({
        queryKey: savedViewsKey(workspace.id, scope),
        queryFn: () => httpSavedViewsGateway.list(scope),
        staleTime: STALE_TIME.Standard,
        enabled
    });
}
