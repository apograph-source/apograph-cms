import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type { SavedView } from '../../domain/types/savedView';
import { savedViewsKey } from '../../infrastructure/savedViewsKeys';
import { httpSavedViewsGateway } from '../../infrastructure/httpSavedViewsGateway';
import type { CreateViewInput } from '../../infrastructure/savedViewsGateway';

export type { CreateViewInput } from '../../infrastructure/savedViewsGateway';

/**
 * Saves the current slice as a new view, then refreshes that list's switcher.
 *
 * Invalidates rather than writing the row into the cache by hand: creating with
 * `makeDefault` also moves the default *off* whichever view held it, and that
 * second change is not in this response. Placing one and missing the other
 * would leave two rows both claiming to be the default.
 */
export function useSaveView(scope: string) {
    const workspace = useCurrentWorkspace();
    const queryClient = useQueryClient();
    return useMutation<SavedView, Error, CreateViewInput>({
        mutationFn: (input) => httpSavedViewsGateway.create(input),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: savedViewsKey(workspace.id, scope)
            });
        }
    });
}
