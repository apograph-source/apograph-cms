import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiError } from '@orthacms/utils-admin';
import { httpAuthGateway } from '../../infrastructure/httpAuthGateway';
import { resetSessionCache } from '../resetSessionCache';
import type { LoginCredentials } from '../../../types/auth';

/**
 * TanStack Query mutation for signing in. Delegates to the {@link AuthGateway}
 * (`POST /api/auth/login`); on success the server sets the `httpOnly` session
 * cookie and this resolves with no value — the cookie is the auth state. The
 * thrown error is an {@link ApiError}, so callers can branch on `error.status`
 * (e.g. `HTTP_STATUS.UNAUTHORIZED`). Navigation/UI is left to the caller via
 * `mutate(credentials, { onSuccess })`.
 *
 * Signing in also clears whatever the *previous* occupant of this tab cached.
 * `useLogoutMutation` already does that on the way out, but a session can also
 * end without a logout — revoked from another device, expired, or the account
 * suspended — and that path only nulls the current-user probe. Sweeping here
 * too means no sign-in can inherit another account's data.
 */
export function useLoginMutation() {
    const queryClient = useQueryClient();
    return useMutation<void, ApiError, LoginCredentials>({
        mutationFn: (credentials) => httpAuthGateway.login(credentials),
        onSuccess: () => resetSessionCache(queryClient)
    });
}
