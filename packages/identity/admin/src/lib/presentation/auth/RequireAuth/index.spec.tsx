import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntlProvider } from 'react-intl';
import {
    MemoryRouter,
    Route,
    Routes,
    useLocation,
    useNavigationType
} from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
    AuthProviderContext,
    AuthStatus,
    type AuthState,
    type AuthUser
} from '../authContext';
import { RequireAuth } from './index';

/** The private page the gate is protecting in these tests. */
const PRIVATE_PATH = '/workspaces';

/** A resolved user; the gate only branches on `status`, never on the fields. */
function signedInUser(): AuthUser {
    return {
        id: 'usr_1',
        email: 'ada@ortha.dev',
        name: 'Ada Lovelace',
        permissions: []
    };
}

/**
 * Stands in for the sign-in page: reports where the redirect landed, what it
 * carried in router state, and whether it replaced the private entry or pushed
 * on top of it.
 */
function SignInProbe() {
    const location = useLocation();
    const navigationType = useNavigationType();
    const state = location.state as { from?: { pathname: string } } | null;

    return (
        <div>
            <p data-testid="signin">signed out</p>
            <p data-testid="from">{state?.from?.pathname ?? 'nothing'}</p>
            <p data-testid="navigation-type">{navigationType}</p>
        </div>
    );
}

/** Mounts the gate over a private route, with the auth state under test. */
function renderGate(auth: AuthState, signInPath?: string) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });

    return render(
        <QueryClientProvider client={queryClient}>
            <IntlProvider locale="en">
                <AuthProviderContext value={auth}>
                    <MemoryRouter initialEntries={[PRIVATE_PATH]}>
                        <Routes>
                            <Route
                                path={PRIVATE_PATH}
                                element={
                                    <RequireAuth signInPath={signInPath}>
                                        <p data-testid="private">
                                            private content
                                        </p>
                                    </RequireAuth>
                                }
                            />
                            <Route
                                path="/identity/signin"
                                element={<SignInProbe />}
                            />
                            <Route
                                path="/elsewhere/signin"
                                element={<SignInProbe />}
                            />
                        </Routes>
                    </MemoryRouter>
                </AuthProviderContext>
            </IntlProvider>
        </QueryClientProvider>
    );
}

/**
 * The route gate. It has four states and only one of them renders the app, so
 * every other branch is a decision about what to show someone who cannot see
 * the page — and each of the three is wrong in a different way if it collapses
 * into another.
 *
 * Showing the sign-in page while the probe is still in flight flashes a login
 * form at a user who is signed in, on every cold load. Redirecting on an outage
 * tells that user they were signed out, and sends them to a form that posts to
 * the same dead API — so `Unavailable` gets its own screen, not a redirect.
 * And the genuine redirect has to carry the attempted location, or signing in
 * lands everyone on the dashboard instead of the page they asked for.
 */
describe('RequireAuth', () => {
    it('renders the children once a user is resolved', () => {
        renderGate({
            status: AuthStatus.Authenticated,
            user: signedInUser()
        });

        expect(screen.getByTestId('private')).toBeDefined();
        expect(screen.queryByTestId('signin')).toBeNull();
    });

    // The branded boot loader, not the sign-in page: this is the state every
    // cold load starts in, and it is indistinguishable from "signed out" until
    // the probe answers.
    it('shows the boot loader while auth is still resolving', () => {
        renderGate({ status: AuthStatus.Loading, user: null });

        // The loader announces itself once, through its `role="status"`
        // region, with the label `RequireAuth` translated.
        expect(screen.getByRole('status').textContent).toContain('Loading…');
        expect(screen.queryByTestId('private')).toBeNull();
        expect(screen.queryByTestId('signin')).toBeNull();
    });

    // An outage is not a sign-out. This branch renders the retry screen and
    // stays on the route, so the user's location — and their perfectly valid
    // session cookie — survive the API coming back.
    it('shows the outage screen without redirecting when the probe failed', () => {
        renderGate({ status: AuthStatus.Unavailable, user: null });

        expect(
            screen.getByRole('heading', {
                level: 1,
                name: 'We can’t reach the server'
            })
        ).toBeDefined();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
        expect(screen.queryByTestId('signin')).toBeNull();
        expect(screen.queryByTestId('private')).toBeNull();
    });

    it('redirects to sign-in when the server says nobody is signed in', () => {
        renderGate({ status: AuthStatus.Unauthenticated, user: null });

        expect(screen.getByTestId('signin')).toBeDefined();
        expect(screen.queryByTestId('private')).toBeNull();
    });

    // The attempted location rides along in router state so the sign-in flow
    // can return the user to the page they actually asked for.
    it('carries the attempted location in router state', () => {
        renderGate({ status: AuthStatus.Unauthenticated, user: null });

        expect(screen.getByTestId('from').textContent).toBe(PRIVATE_PATH);
    });

    // A push would leave the private URL in history, so the browser's Back
    // button walks straight back into the gate and bounces forward again.
    it('replaces the private entry rather than pushing over it', () => {
        renderGate({ status: AuthStatus.Unauthenticated, user: null });

        expect(screen.getByTestId('navigation-type').textContent).toBe(
            'REPLACE'
        );
    });

    // Identity owns the default path, but the gate is composed by the shell,
    // which may mount it elsewhere.
    it('honours an overridden sign-in path', () => {
        renderGate(
            { status: AuthStatus.Unauthenticated, user: null },
            '/elsewhere/signin'
        );

        expect(screen.getByTestId('signin')).toBeDefined();
        expect(screen.getByTestId('from').textContent).toBe(PRIVATE_PATH);
    });
});
