import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiError } from '@orthacms/utils-admin';
import { httpMemberGateway } from '../../infrastructure/httpMemberGateway';
import type { RemoveWorkspaceMemberInput } from '../../infrastructure/memberGateway';
import { membersKeys } from '../../infrastructure/membersKeys';

export type { RemoveWorkspaceMemberInput } from '../../infrastructure/memberGateway';

/**
 * Removes a member from a workspace from the Workspaces tab via the gateway.
 * Invalidates the member's detail (its `workspaces` list) and the members list
 * (its Workspaces column) on success. Errors normalize to {@link ApiError}.
 */
export function useRemoveWorkspaceMember() {
    const queryClient = useQueryClient();
    return useMutation<void, ApiError, RemoveWorkspaceMemberInput>({
        mutationFn: (input) => httpMemberGateway.removeWorkspace(input),
        onSuccess: (_data, { userId }) => {
            queryClient.invalidateQueries({
                queryKey: membersKeys.detail(userId)
            });
            queryClient.invalidateQueries({ queryKey: membersKeys.all });
        }
    });
}
