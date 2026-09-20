import { useQuery } from '@tanstack/react-query';
import { STALE_TIME, type ApiError } from '@orthacms/utils-admin';
import { httpAuthGateway } from '../../infrastructure/httpAuthGateway';
import type { PasswordResetDetails } from '../../../types/auth';

/** Query key for one reset link's details, scoped by its raw token. */
export const passwordResetKey = (token: string) =>
    ['auth', 'reset', token] as const;

/**
 * TanStack Query wrapper for "which account does this reset link belong to?",
 * fetched through the {@link AuthGateway} (`GET /api/auth/reset/:token`).
 * Read-only — the token is not spent by looking at it, so reloading the reset
 * page is safe.
 *
 * Disabled when there is no token at all (a link with no `?token=`), so the
 * page can render its "this link looks broken" state without a pointless
 * request. Retries are off: a `404` here means the link is dead, and retrying a
 * dead link only delays telling the user. Failures that are *not* a `404` say
 * nothing about the token, so the page renders its outage state and hands the
 * retry to the user (`refetch`) rather than looping on their behalf.
 */
export function usePasswordReset(token: string) {
    return useQuery<PasswordResetDetails, ApiError>({
        queryKey: passwordResetKey(token),
        queryFn: () => httpAuthGateway.describePasswordReset(token),
        enabled: token.length > 0,
        retry: false,
        // The account behind the link is fixed for the life of the link, so
        // there is nothing to refetch while the page is open.
        staleTime: STALE_TIME.Forever
    });
}
