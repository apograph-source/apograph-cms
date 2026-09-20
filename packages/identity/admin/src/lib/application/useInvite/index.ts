import { useQuery } from '@tanstack/react-query';
import { STALE_TIME, type ApiError } from '@orthacms/utils-admin';
import { httpAuthGateway } from '../../infrastructure/httpAuthGateway';
import type { InviteDetails } from '../../../types/auth';

/** Query key for one invite link's details, scoped by its raw token. */
export const inviteKey = (token: string) => ['auth', 'invite', token] as const;

/**
 * TanStack Query wrapper for "who is this invite for?", fetched through the
 * {@link AuthGateway} (`GET /api/auth/invite/:token`). Read-only — the token is
 * not spent by looking at it, so reloading the accept page is safe.
 *
 * Disabled when there is no token at all (a link with no `?token=`), so the
 * page can render its "this link looks broken" state without a pointless
 * request. Retries are off: a `404` here means the link is dead, and retrying a
 * dead link only delays telling the user. Failures that are *not* a `404` say
 * nothing about the token, so the page renders its outage state and hands the
 * retry to the invitee (`refetch`) rather than looping on their behalf.
 */
export function useInvite(token: string) {
    return useQuery<InviteDetails, ApiError>({
        queryKey: inviteKey(token),
        queryFn: () => httpAuthGateway.describeInvite(token),
        enabled: token.length > 0,
        retry: false,
        // The invite's email and name are fixed for the life of the link, so
        // there is nothing to refetch while the page is open.
        staleTime: STALE_TIME.Forever
    });
}
