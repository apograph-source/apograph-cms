import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiError } from '@orthacms/utils-admin';
import { httpAuthGateway } from '../../infrastructure/httpAuthGateway';
import { resetSessionCache } from '../resetSessionCache';
import type { AcceptInviteInput } from '../../../types/auth';

/**
 * TanStack Query mutation for accepting an invite. Delegates to the
 * {@link AuthGateway} (`POST /api/auth/invite/accept`); on success the server
 * activates the account and sets the `httpOnly` session cookie, so this
 * resolves with no value and the invitee is already signed in — the caller only
 * has to refresh the current user and navigate.
 *
 * The thrown error is an {@link ApiError}, so callers can branch on
 * `error.status` (`HTTP_STATUS.NOT_FOUND` = the link is dead,
 * `HTTP_STATUS.BAD_REQUEST` = the password was rejected server-side).
 *
 * Accepting swaps the identity behind this tab — the server's new cookie is for
 * the invitee, whoever was signed in before — so it clears the cache on the way
 * in, like signing in does.
 */
export function useAcceptInviteMutation() {
    const queryClient = useQueryClient();
    return useMutation<void, ApiError, AcceptInviteInput>({
        mutationFn: (input) => httpAuthGateway.acceptInvite(input),
        onSuccess: () => resetSessionCache(queryClient)
    });
}
