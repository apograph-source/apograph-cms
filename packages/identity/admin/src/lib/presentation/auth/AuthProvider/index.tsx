import { useEffect, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { defineMessages, useIntl } from 'react-intl';
import { toast } from '@apograph/design-system';
import { setUnauthorizedHandler } from '@apograph/utils-admin';
import {
    currentUserKey,
    useCurrentUser
} from '../../../application/useCurrentUser';
import {
    markSessionEnded,
    takeExpectedSignOut
} from '../../../application/sessionEnded';
import {
    AuthProviderContext,
    AuthStatus,
    type AuthState
} from '../authContext';

/** Intl descriptors for {@link AuthProvider}, co-located with the component. */
const messages = defineMessages({
    sessionEnded: {
        id: 'identity.auth.sessionEnded',
        defaultMessage: 'Your session has ended. Please sign in again.'
    }
});

/** What {@link AuthProvider} reads off the current-user query. */
type CurrentUserQuery = ReturnType<typeof useCurrentUser>;

/**
 * Maps the probe's query state onto the published {@link AuthState}.
 *
 * `data` present → authenticated. Otherwise, while a probe is in flight — the
 * initial load or a post-login/logout refetch — hold in `loading` so the gate
 * doesn't redirect on the stale "no user" gap between invalidating the query
 * and the fresh response landing.
 *
 * A settled probe then splits two ways, and the split matters: the gateway
 * turns a `401` into `data === null` (nobody is signed in — the ordinary signed
 * out state), and rethrows everything else. A `500`, a timeout or a dropped
 * connection therefore lands on `unavailable`, not `unauthenticated`, because
 * it tells us nothing about the session. Treating the two alike is what made an
 * API outage sign a perfectly valid session out.
 */
function toAuthState({
    data,
    isPending,
    isFetching,
    isError
}: CurrentUserQuery): AuthState {
    if (data) {
        return {
            status: AuthStatus.Authenticated,
            user: {
                id: data.id,
                email: data.email,
                name: data.name,
                permissions: data.permissions
            }
        };
    }
    if (isPending || isFetching) {
        return { status: AuthStatus.Loading, user: null };
    }
    if (isError) {
        return { status: AuthStatus.Unavailable, user: null };
    }
    return { status: AuthStatus.Unauthenticated, user: null };
}

/**
 * Resolves the current user via `GET /api/auth/me` and publishes it into the
 * auth context, so {@link RequireAuth} can gate routes. The shell composes this
 * around `RequireAuth` in its `layout`, so it wraps the private area (not the
 * public sign-in page); the host renders that layout without knowing any of this
 * exists.
 *
 * It also owns the **session-lost** reaction: while mounted it installs the
 * shared client's `401` handler, so a session that dies mid-visit — revoked from
 * another device, expired, or the account suspended by an admin — drops the
 * cached user and lands the visitor on the sign-in page instead of leaving a
 * shell that 401s on every request.
 *
 * And it **says so**, which is the part the redirect alone never did. React
 * Router replaces the whole view with the sign-in page: focus was on a control
 * that no longer exists so the browser resets it to `<body>`, a screen reader's
 * virtual buffer still holds the unmounted page, and anything typed into a form
 * is gone — with no message anywhere explaining why (WCAG 4.1.3 Status
 * Messages, 2.4.3 Focus Order). The toast is a real announcement in the host's
 * live region and survives the route change; the flag it sets is what lets the
 * sign-in page repeat the explanation in a place the visitor can still read
 * after the toast has gone.
 *
 * The transport seam stays meaning-free on purpose — `setUnauthorizedHandler`
 * exists so `utils-admin` does not decide what a `401` means, and that package
 * owns no user-facing strings — so the message belongs here.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
    const currentUser = useCurrentUser();
    const queryClient = useQueryClient();
    const intl = useIntl();

    useEffect(() => {
        setUnauthorizedHandler(() => {
            // Answer the probe with "no user" rather than invalidating it: the
            // session is gone, so a refetch would only 401 again, and the null
            // settles the gate on `unauthenticated` at once. Deliberately not
            // `removeQueries`/`clear` — evicting queries that still have mounted
            // observers makes them refetch, and each refetch 401s straight back
            // into this handler. The redirect unmounts the private tree instead,
            // leaving its data inactive for the cache's own GC.
            //
            // Saying so is NOT done here: this handler sees only the `401`s the
            // transport routes to it, and the auth probe's own is exempt (the
            // sign-in page polls that endpoint, where a `401` is the ordinary
            // answer). The announcement watches the published state instead —
            // see below — so it covers every way the session can end.
            queryClient.setQueryData(currentUserKey, null);
        });
        return () => setUnauthorizedHandler(null);
    }, [queryClient]);

    const state = toAuthState(currentUser);

    // Whether this tab has ever held a session. It is what separates "the
    // session you were using has ended" from the ordinary signed-out state —
    // a bookmark opened in a fresh tab reaches `unauthenticated` too, and
    // telling that visitor something of theirs was taken away would be a lie.
    const hadSession = useRef(false);

    useEffect(() => {
        if (state.status === AuthStatus.Authenticated) {
            hadSession.current = true;
            return;
        }
        if (state.status !== AuthStatus.Unauthenticated) return;
        if (!hadSession.current) return;

        // Lowered before announcing, so `StrictMode`'s second pass over this
        // effect finds nothing left to say rather than raising a second toast.
        hadSession.current = false;

        // A sign-out the visitor asked for lands here as the same fall from
        // authenticated to unauthenticated. Reporting it back to them as a
        // session that "has ended" would dress their own click up as a fault.
        if (takeExpectedSignOut()) return;

        // Two audiences, one fact. The toast is announced now, in the live
        // region the host mounts outside the router — so it survives the view
        // being replaced; the flag is what the sign-in page reads to keep the
        // explanation on screen once the toast has expired.
        markSessionEnded();
        toast.warning(intl.formatMessage(messages.sessionEnded));
    }, [state.status, intl]);

    return <AuthProviderContext value={state}>{children}</AuthProviderContext>;
}
