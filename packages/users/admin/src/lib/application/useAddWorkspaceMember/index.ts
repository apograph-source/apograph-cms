import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiError } from '@orthacms/utils-admin';
import { httpMemberGateway } from '../../infrastructure/httpMemberGateway';
import type { AddWorkspaceMemberInput } from '../../infrastructure/memberGateway';
import { membersKeys } from '../../infrastructure/membersKeys';

export type { AddWorkspaceMemberInput } from '../../infrastructure/memberGateway';

/**
 * Adds a member to a workspace from the Workspaces tab via the gateway. The
 * endpoint is idempotent (re-adding is a no-op). Invalidates the member's detail
 * (its `workspaces` list) and the members list (its Workspaces column) on
 * success. Errors normalize to {@link ApiError}.
 */
export function useAddWorkspaceMember() {
    const queryClient = useQueryClient();
    return useMutation<void, ApiError, AddWorkspaceMemberInput>({
        mutationFn: (input) => httpMemberGateway.addWorkspace(input),
        onSuccess: (_data, { userId }) => {
            queryClient.invalidateQueries({
                queryKey: membersKeys.detail(userId)
            });
            queryClient.invalidateQueries({ queryKey: membersKeys.all });
        }
    });
}
