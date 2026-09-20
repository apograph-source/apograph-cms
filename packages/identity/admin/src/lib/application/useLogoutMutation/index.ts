import { useMutation, useQueryClient } from '@tanstack/react-query';
import { defineMessages, useIntl } from 'react-intl';
import { toast } from '@orthacms/design-system';
import type { ApiError } from '@orthacms/utils-admin';
import { httpAuthGateway } from '../../infrastructure/httpAuthGateway';
import { currentUserKey } from '../useCurrentUser';
import { resetSessionCache } from '../resetSessionCache';
import { markExpectedSignOut } from '../sessionEnded';

/** Intl descriptors for {@link useLogoutMutation}, co-located with the hook. */
const messages = defineMessages({
    failed: {
        id: 'identity.logout.failed',
        defaultMessage:
            'We couldn’t sign you out — you are still signed in on this device. Check your connection and try again.'
    }
});

/**
 * TanStack Query mutation for signing out. Delegates to the {@link AuthGateway}
 * (`POST /api/auth/logout`); on success it settles the current-user probe
 * ({@link currentUserKey}) on "nobody" and drops everything else the session
 * cached, so `AuthProvider` reports "unauthenticated", the route gate redirects
 * to the sign-in page, and nothing of the outgoing account is left behind.
 * Callers just call `mutate()`.
 *
 * A failed logout is reported here rather than left to each call site: the
 * request failing means the session was **not** revoked, so the UI both stays
 * signed in (the truthful state — pretending otherwise would leave someone on a
 * shared machine believing they had left) and says so, instead of swallowing
 * the click.
 */
export function useLogoutMutation() {
    const intl = useIntl();
    const queryClient = useQueryClient();
    return useMutation<void, ApiError, void>({
        mutationFn: () => httpAuthGateway.logout(),
        onSuccess: () => {
            // Say so before clearing the user, not after. `AuthProvider`
            // announces a lost session by watching the published state fall
            // from authenticated to unauthenticated, and the write below is
            // exactly that fall — so without this the visitor would be told
            // their session "has ended" in reply to their own Sign out click.
            markExpectedSignOut();

            // Write `null` rather than invalidating: the session is gone, so a
            // refetch could only 401 its way to the same answer, and the write
            // settles the gate in this tick. It also has to happen *before* the
            // sweep below — the probe query is the one thing `AuthProvider` is
            // observing, and removing a query out from under a mounted observer
            // leaves it holding the value it already had.
            queryClient.setQueryData(currentUserKey, null);
            resetSessionCache(queryClient);
        },
        onError: () => toast.error(intl.formatMessage(messages.failed))
    });
}
