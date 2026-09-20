import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiError } from '@orthacms/utils-admin';
import { httpMemberGateway } from '../../infrastructure/httpMemberGateway';
import type { RevokeSessionInput } from '../../infrastructure/memberGateway';
import { membersKeys } from '../../infrastructure/membersKeys';

export type { RevokeSessionInput } from '../../infrastructure/memberGateway';

/**
 * Revokes a member's session from the Sessions tab via the gateway. Invalidates
 * that member's sessions query on success so the revoked row drops off. Errors
 * normalize to {@link ApiError}.
 */
export function useRevokeSession() {
    const queryClient = useQueryClient();
    return useMutation<void, ApiError, RevokeSessionInput>({
        mutationFn: (input) => httpMemberGateway.revokeSession(input),
        onSuccess: (_data, { userId }) => {
            queryClient.invalidateQueries({
                queryKey: membersKeys.sessions(userId)
            });
        }
    });
}
