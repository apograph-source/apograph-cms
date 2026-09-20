import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { defineMessages, useIntl } from 'react-intl';
import { HTTP_STATUS, useDocumentTitle } from '@orthacms/utils-admin';
import { AuthLayout } from '../../components/AuthLayout';
import { LoginForm } from '../../components/LoginForm';
import type { LoginCredentials } from '../../../../types/auth';
import { useLoginMutation } from '../../../application/useLoginMutation';
import { currentUserKey } from '../../../application/useCurrentUser';
import { takeSessionEnded } from '../../../application/sessionEnded';
import { rateLimitMessage } from '../../rateLimitMessage';

/** Router state `RequireAuth` attaches when it bounces a user to sign-in. */
type FromState = { from?: { pathname?: string } };

/** Intl descriptors for {@link LoginPage}, co-located with the component. */
const messages = defineMessages({
    documentTitle: {
        id: 'identity.login.documentTitle',
        defaultMessage: 'Sign in'
    },
    invalidCredentials: {
        id: 'identity.login.error.invalidCredentials',
        defaultMessage:
            'The email or password you entered is incorrect. Please double-check your credentials and try again.'
    },
    generic: {
        id: 'identity.login.error.generic',
        defaultMessage: 'Something went wrong. Please try again.'
    },
    sessionEnded: {
        id: 'identity.login.sessionEnded',
        defaultMessage:
            'Your session has ended, so you were signed out. Please sign in again to continue where you left off.'
    },
    ssoFailed: {
        id: 'identity.login.ssoFailed',
        defaultMessage:
            'That sign-in did not complete. Try again, or sign in with your email and password.'
    }
});

/**
 * Login page — the route container the identity router mounts at
 * `/identity/signin`. Runs `useLoginMutation` (`POST /api/auth/login`), maps its
 * `isPending`/`error` onto the presentational {@link LoginForm}, and on success
 * refreshes the current user (so the host's auth context flips to authenticated)
 * before navigating to wherever the user was headed — the location `RequireAuth`
 * stashed, or `/` by default. The session lives in the `httpOnly` cookie the
 * server sets, so there is nothing to persist client-side here.
 *
 * It also **says why the visitor is here** when they did not choose to be. A
 * session revoked from another device replaces whatever page they were on with
 * this one; `AuthProvider` announces that through the host's toast region as it
 * happens, and the flag it leaves behind is read here so the explanation is
 * still on screen once the toast has gone — next to the heading `AuthLayout`
 * put focus on. Without it a keyboard user resumed tabbing from the top of a
 * page they were never told they had reached, with anything they had typed
 * gone.
 */
export function LoginPage() {
    const intl = useIntl();
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();
    const { mutate, isPending, error } = useLoginMutation();

    useDocumentTitle(intl.formatMessage(messages.documentTitle));

    // Whether this visit is a forced sign-out rather than an ordinary arrival.
    // Latched into state on mount and never cleared by a later render: the flag
    // is one-shot, so re-reading it on every render would drop the explanation
    // the first time the visitor types into a field. Assigning the result would
    // also break under `StrictMode`, whose second effect pass finds the flag
    // already spent — hence the `if`, which only ever raises the latch.
    const [sessionEnded, setSessionEnded] = useState(false);
    useEffect(() => {
        if (takeSessionEnded()) setSessionEnded(true);
    }, []);

    const from = (location.state as FromState | null)?.from?.pathname ?? '/';

    // The single-sign-on routes redirect here with `?error=sso` when a sign-in
    // did not complete. Every reason collapses to that one flag on purpose:
    // the person arriving is anonymous, the identity provider is not, and
    // spelling out which step failed would tell anyone who can authenticate at
    // a public provider which addresses hold accounts here. The real reason is
    // in the server log.
    const ssoFailed =
        new URLSearchParams(location.search).get('error') === 'sso';

    const handleSubmit = (credentials: LoginCredentials) => {
        mutate(credentials, {
            onSuccess: async () => {
                await queryClient.invalidateQueries({
                    queryKey: currentUserKey
                });
                navigate(from, { replace: true });
            }
        });
    };

    // A failed submission wins over the redirect flag: the flag describes how
    // the visitor arrived, and once they have tried a password the result of
    // that attempt is the thing they are waiting to hear about.
    const errorMessage = error
        ? // A throttled attempt gets its own answer before the generic one: the
          // route carries `ThrottlerGuard`, and someone who mistyped a password
          // a few times is exactly who reaches it — for whom "please try again"
          // is the one thing that cannot work.
          (rateLimitMessage(intl, error) ??
          intl.formatMessage(
              error.status === HTTP_STATUS.UNAUTHORIZED
                  ? messages.invalidCredentials
                  : messages.generic
          ))
        : ssoFailed
          ? intl.formatMessage(messages.ssoFailed)
          : undefined;

    return (
        <AuthLayout surface="signin">
            <LoginForm
                onSubmit={handleSubmit}
                isPending={isPending}
                error={errorMessage}
                notice={
                    sessionEnded
                        ? intl.formatMessage(messages.sessionEnded)
                        : undefined
                }
                redirectTo={from}
            />
        </AuthLayout>
    );
}
