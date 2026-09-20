import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { AppLoader } from '@orthacms/design-system';
import { AuthStatus, useAuth } from '../authContext';
import { AuthUnavailable } from '../../components/AuthUnavailable';

/** Where the gate sends unauthenticated users; identity owns its sign-in path. */
const DEFAULT_SIGN_IN_PATH = '/identity/signin';

/** Intl descriptors for {@link RequireAuth}, co-located with the component. */
const messages = defineMessages({
    loading: {
        id: 'identity.requireAuth.loading',
        defaultMessage: 'Loading…'
    }
});

/** Props for {@link RequireAuth}. */
type RequireAuthProps = {
    /** The protected subtree (typically the authenticated shell). */
    children: ReactNode;
    /** Override the redirect target; defaults to identity's sign-in page. */
    signInPath?: string;
};

/**
 * Gates its children on authentication. While auth is resolving it shows the
 * branded {@link AppLoader} (the "root" boot load) rather than the sign-in page,
 * so that page never flashes for a logged-in user; once resolved it either
 * renders the children or redirects to the sign-in page, preserving the
 * attempted location in router state so the sign-in flow can return the user
 * there.
 *
 * "Resolved" has two failure shapes, and only one of them is a redirect. The
 * server answering "nobody is signed in" sends the visitor to sign in; the
 * server not answering at all renders {@link AuthUnavailable}, because an
 * outage is not a sign-out and the sign-in form would fail against the same
 * API.
 *
 * Composed by the shell into its `layout` (wrapped in {@link AuthProvider}), so
 * one check guards the whole authenticated area. It must render under an
 * `AuthProvider`, which supplies the state it reads via `useAuth`.
 */
export function RequireAuth({
    children,
    signInPath = DEFAULT_SIGN_IN_PATH
}: RequireAuthProps) {
    const intl = useIntl();
    const { status } = useAuth();
    const location = useLocation();

    if (status === AuthStatus.Loading) {
        return <AppLoader label={intl.formatMessage(messages.loading)} />;
    }

    // The probe failed rather than answering "nobody": say so and offer a
    // retry. Redirecting here would report an API outage as a sign-out, and
    // send the user to a form whose submit hits the same dead endpoint.
    if (status === AuthStatus.Unavailable) {
        return <AuthUnavailable />;
    }

    if (status === AuthStatus.Unauthenticated) {
        return <Navigate to={signInPath} replace state={{ from: location }} />;
    }

    return <>{children}</>;
}
