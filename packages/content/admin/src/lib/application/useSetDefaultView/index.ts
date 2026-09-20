import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { savedViewsKey } from '../../infrastructure/savedViewsKeys';
import { httpSavedViewsGateway } from '../../infrastructure/httpSavedViewsGateway';

/** What {@link useSetDefaultView} submits. */
export type SetDefaultVariables = {
    /** The view to point the default at, or to clear it from. */
    id: string;
    /** `true` makes it the default, `false` clears it. */
    isDefault: boolean;
};

/**
 * Points the caller's default for a list at a view, or clears it.
 *
 * Invalidates the whole list: a default is exclusive per person, so setting one
 * necessarily unsets another, and only the server knows which row that was.
 */
export function useSetDefaultView(scope: string) {
    const workspace = useCurrentWorkspace();
    const queryClient = useQueryClient();
    return useMutation<void, Error, SetDefaultVariables>({
        mutationFn: ({ id, isDefault }) =>
            isDefault
                ? httpSavedViewsGateway.setDefault(id)
                : httpSavedViewsGateway.clearDefault(id),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: savedViewsKey(workspace.id, scope)
            });
        }
    });
}
