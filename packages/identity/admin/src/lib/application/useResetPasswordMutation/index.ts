import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiError } from '@orthacms/utils-admin';
import { httpAuthGateway } from '../../infrastructure/httpAuthGateway';
import { resetSessionCache } from '../resetSessionCache';
import type { ResetPasswordInput } from '../../../types/auth';

/**
 * TanStack Query mutation for redeeming a password-reset link. Delegates to the
 * {@link AuthGateway} (`POST /api/auth/reset`); on success the server has set
 * the new credential and revoked **every** session on the account, so this
 * resolves with no value and the caller is *not* signed in — they continue to
 * the login form.
 *
 * The thrown error is an {@link ApiError}, so callers can branch on
 * `error.status` (`HTTP_STATUS.NOT_FOUND` = the link is dead,
 * `HTTP_STATUS.BAD_REQUEST` = the password was rejected server-side).
 *
 * The cache is cleared on success for the same reason signing in clears it, and
 * one more: a session that *was* open in this tab has just been revoked
 * server-side, so everything it cached is both stale and no longer authorized —
 * leaving it in memory would show the previous session's data to whoever is
 * standing at this browser.
 */
export function useResetPasswordMutation() {
    const queryClient = useQueryClient();
    return useMutation<void, ApiError, ResetPasswordInput>({
        mutationFn: (input) => httpAuthGateway.resetPassword(input),
        onSuccess: () => resetSessionCache(queryClient)
    });
}
