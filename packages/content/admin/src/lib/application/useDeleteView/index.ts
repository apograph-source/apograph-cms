import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { savedViewsKey } from '../../infrastructure/savedViewsKeys';
import { httpSavedViewsGateway } from '../../infrastructure/httpSavedViewsGateway';

/**
 * Deletes a view the caller owns.
 *
 * Invalidates rather than filtering the cached array: deleting a view that was
 * somebody's default clears that pointer server-side too, so the surviving rows'
 * `isDefault` flags are only trustworthy after a refetch.
 */
export function useDeleteView(scope: string) {
    const workspace = useCurrentWorkspace();
    const queryClient = useQueryClient();
    return useMutation<void, Error, string>({
        mutationFn: (id) => httpSavedViewsGateway.remove(id),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: savedViewsKey(workspace.id, scope)
            });
        }
    });
}
