import { useQuery } from '@tanstack/react-query';
import { STALE_TIME } from '@orthacms/utils-admin';
import { httpAuthGateway } from '../../infrastructure/httpAuthGateway';

/**
 * Query key for the current-user fetch. Exported so the login/logout flows can
 * invalidate it and flip the host's auth state.
 */
export const currentUserKey = ['auth', 'me'] as const;

/**
 * TanStack Query wrapper for the current user, fetched through the
 * {@link AuthGateway} (`GET /api/auth/me`). `data === null` means
 * unauthenticated — a `401` resolves to `null` in the gateway rather than
 * throwing. The session lives in the `httpOnly` cookie, so the probe is cheap
 * and is refreshed by invalidating {@link currentUserKey} after login/logout.
 *
 * It also **re-checks on window focus** rather than resolving once for the
 * lifetime of the tab: a session can die while the tab sits idle (an admin
 * suspends the account, or another device revokes the session), and a
 * background probe that comes back empty settles the gate on "unauthenticated"
 * and redirects. `staleTime` bounds that to one probe a minute, and the refetch
 * is invisible — `AuthProvider` keeps reporting the cached user while it is in
 * flight, so returning to the tab never flashes the root loader.
 */
export function useCurrentUser() {
    return useQuery({
        queryKey: currentUserKey,
        queryFn: () => httpAuthGateway.getCurrentUser(),
        retry: false,
        staleTime: STALE_TIME.Standard,
        refetchOnWindowFocus: true
    });
}
