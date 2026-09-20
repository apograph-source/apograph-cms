import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type { SavedView } from '../../domain/types/savedView';
import { savedViewsKey } from '../../infrastructure/savedViewsKeys';
import { httpSavedViewsGateway } from '../../infrastructure/httpSavedViewsGateway';
import type { UpdateViewInput } from '../../infrastructure/savedViewsGateway';

export type { UpdateViewInput } from '../../infrastructure/savedViewsGateway';

/** What {@link useUpdateView} submits: which view, and what changes. */
export type UpdateViewVariables = UpdateViewInput & {
    /** The view to change. */
    id: string;
};

/**
 * Renames, re-shares, or re-captures a view the caller owns.
 *
 * Places the returned row into the cached list instead of invalidating it: the
 * response *is* the updated view, and a refetch here would flash the switcher
 * closed mid-interaction. Falls back to an invalidation when the list isn't
 * cached (a direct link opened straight into the dialog).
 */
export function useUpdateView(scope: string) {
    const workspace = useCurrentWorkspace();
    const queryClient = useQueryClient();
    return useMutation<SavedView, Error, UpdateViewVariables>({
        mutationFn: ({ id, ...input }) =>
            httpSavedViewsGateway.update(id, input),
        onSuccess: (updated) => {
            const key = savedViewsKey(workspace.id, scope);
            const cached = queryClient.getQueryData<SavedView[]>(key);
            if (!cached) {
                queryClient.invalidateQueries({ queryKey: key });
                return;
            }
            queryClient.setQueryData<SavedView[]>(
                key,
                cached.map((view) => (view.id === updated.id ? updated : view))
            );
        }
    });
}
