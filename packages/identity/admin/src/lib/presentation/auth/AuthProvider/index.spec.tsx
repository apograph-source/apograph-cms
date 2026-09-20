import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntlProvider } from 'react-intl';
import { act, render, screen } from '@testing-library/react';
import { toast } from '@orthacms/design-system';
import { setUnauthorizedHandler } from '@orthacms/utils-admin';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    currentUserKey,
    useCurrentUser
} from '../../../application/useCurrentUser';
import {
    markSessionEnded,
    takeExpectedSignOut
} from '../../../application/sessionEnded';
import { AuthStatus, useAuth, type AuthState } from '../authContext';
import { AuthProvider } from './index';

// The probe itself is not under test here — what the provider makes of its
// query state is — so it is replaced by a hand-held state object.
vi.mock('../../../application/useCurrentUser', async (importOriginal) => ({
    ...(await importOriginal<
        typeof import('../../../application/useCurrentUser')
    >()),
    useCurrentUser: vi.fn()
}));

// Module-scope flag with no React state to observe; a mock is how we see it set.
vi.mock('../../../application/sessionEnded', () => ({
    markSessionEnded: vi.fn(),
    takeSessionEnded: vi.fn(),
    markExpectedSignOut: vi.fn(),
    takeExpectedSignOut: vi.fn(() => false)
}));

// The transport seam. Mocking it is what gives the test a handle on the `401`
// callback the provider installs, without driving a real axios request.
vi.mock('@orthacms/utils-admin', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@orthacms/utils-admin')>()),
    setUnauthorizedHandler: vi.fn()
}));

/** The current-user query fields {@link AuthProvider} reads, all defaulted. */
type QueryState = {
    data?: {
        id: string;
        email: string;
        name: string | null;
        permissions: string[];
    } | null;
    isPending?: boolean;
    isFetching?: boolean;
    isError?: boolean;
};

/** Points the mocked `useCurrentUser` at one query state for this test. */
function probeReturns(state: QueryState): void {
    vi.mocked(useCurrentUser).mockReturnValue({
        data: state.data ?? null,
        isPending: state.isPending ?? false,
        isFetching: state.isFetching ?? false,
        isError: state.isError ?? false
    } as unknown as ReturnType<typeof useCurrentUser>);
}

/** Publishes whatever the provider resolved, so a test can read it back. */
function AuthStateProbe() {
    return <pre data-testid="auth-state">{JSON.stringify(useAuth())}</pre>;
}

/** Mounts the provider over a probe, with the two contexts it depends on. */
function renderProvider(children: ReactNode = <AuthStateProbe />) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });
    const view = render(
        <QueryClientProvider client={queryClient}>
            <IntlProvider locale="en">
                <AuthProvider>{children}</AuthProvider>
            </IntlProvider>
        </QueryClientProvider>
    );
    return { ...view, queryClient };
}

/** The auth state the provider published, as the probe rendered it. */
function publishedState(): AuthState {
    return JSON.parse(screen.getByTestId('auth-state').textContent ?? '');
}

/**
 * The one `401` callback the provider installed. Asserting a single non-null
 * installation is part of the point: two live handlers would double every
 * session-lost toast.
 */
function installedHandler(): () => void {
    const handlers = vi
        .mocked(setUnauthorizedHandler)
        .mock.calls.map(([handler]) => handler)
        .filter((handler): handler is () => void => handler !== null);

    expect(handlers).toHaveLength(1);
    return handlers[0];
}

beforeEach(() => {
    vi.clearAllMocks();
    probeReturns({ isPending: true, isFetching: true });
});

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * `AuthProvider` is where two unrelated facts become one published auth state,
 * and both halves are load-bearing in a way that has bitten before.
 *
 * The first is the mapping from the probe's query state. Its whole reason for
 * existing is that "the server says nobody is signed in" and "we could not ask
 * the server" are different answers: a `401` reaches the provider as
 * `data === null`, everything else reaches it as an error, and collapsing the
 * two makes every API hiccup present itself to a signed-in admin as a sign-out.
 * The in-flight cases matter for the opposite reason — reporting "no user"
 * during a refetch flashes the sign-in page (or the root loader) at someone who
 * never left.
 *
 * The second is the session-lost reaction: a `401` on a live session has to
 * both close the gate and *say so*, but only when a session actually existed —
 * telling a visitor who never signed in that their session ended is a lie, and
 * a confusing one.
 */
describe('AuthProvider', () => {
    describe('the auth state it publishes', () => {
        it('reports a resolved user as authenticated, passing permissions through', () => {
            probeReturns({
                data: {
                    id: 'usr_1',
                    email: 'ada@ortha.dev',
                    name: 'Ada Lovelace',
                    permissions: ['workspaces:read', 'workspaces:create']
                }
            });

            renderProvider();

            expect(publishedState()).toEqual({
                status: AuthStatus.Authenticated,
                user: {
                    id: 'usr_1',
                    email: 'ada@ortha.dev',
                    name: 'Ada Lovelace',
                    permissions: ['workspaces:read', 'workspaces:create']
                }
            });
        });

        // Nobody resolved *yet* is not the same as nobody signed in. The gap
        // between invalidating the query after login/logout and the fresh
        // answer landing is exactly when a naive mapping would report
        // `unauthenticated` and bounce the user to the sign-in page they just
        // successfully used.
        it.each([
            [
                'the initial probe is pending',
                { isPending: true, isFetching: true }
            ],
            ['a refetch is in flight with no cached user', { isFetching: true }]
        ])('holds in loading while %s', (_case, state) => {
            probeReturns(state);

            renderProvider();

            expect(publishedState()).toEqual({
                status: AuthStatus.Loading,
                user: null
            });
        });

        // The distinction the whole enum exists for. The gateway turns a `401`
        // into `null` and rethrows everything else, so an error here means a
        // `500`, a timeout, or a dropped connection — none of which say
        // anything about the session. `RequireAuth` reads this and shows the
        // outage screen instead of redirecting.
        it('reports a failed probe as unavailable, not unauthenticated [identity:I-28]', () => {
            probeReturns({ isError: true });

            renderProvider();

            expect(publishedState()).toEqual({
                status: AuthStatus.Unavailable,
                user: null
            });
        });

        // The ordinary signed-out state: the request succeeded and the answer
        // was "nobody".
        it('reports a settled probe with no user as unauthenticated', () => {
            probeReturns({ data: null });

            renderProvider();

            expect(publishedState()).toEqual({
                status: AuthStatus.Unauthenticated,
                user: null
            });
        });

        // `useCurrentUser` re-probes on window focus, so this runs every time
        // an admin comes back to the tab. Reporting `loading` because a
        // background fetch is in flight would blank the whole shell behind the
        // root loader for someone who never went anywhere — hence `data` wins
        // over `isFetching`.
        it('keeps reporting the cached user through a background refetch', () => {
            probeReturns({
                data: {
                    id: 'usr_1',
                    email: 'ada@ortha.dev',
                    name: null,
                    permissions: []
                },
                isFetching: true
            });

            renderProvider();

            expect(publishedState().status).toBe(AuthStatus.Authenticated);
        });
    });

    describe('the 401 handler', () => {
        // The handler's whole job is the cache write. It deliberately does not
        // announce anything: it only ever sees the `401`s the transport routes
        // to it, and `/auth/me`'s own is exempt — so an announcement made here
        // would miss the focus re-check, which is the very path that catches an
        // idle tab whose account was suspended.
        it('settles the gate by answering the probe with "nobody"', () => {
            const warn = vi.spyOn(toast, 'warning');
            const { queryClient } = renderProvider();
            queryClient.setQueryData(currentUserKey, {
                id: 'usr_1',
                email: 'ada@ortha.dev',
                name: 'Ada Lovelace',
                permissions: []
            });

            act(() => installedHandler()());

            expect(queryClient.getQueryData(currentUserKey)).toBeNull();
            expect(warn).not.toHaveBeenCalled();
        });

        /**
         * The announcement rides the published state, not the transport.
         *
         * A session can end in three ways that reach this component
         * differently: a `401` on some other request (the handler above), the
         * auth probe's own `401` on a focus re-check (exempt from that handler,
         * because the sign-in page polls the same endpoint), and an
         * administrator suspending the account between two navigations. All
         * three land as the same fall — a resolved user giving way to nobody —
         * so that fall is what is watched.
         */
        describe('announcing a session that ended', () => {
            /** Re-renders the provider with a fresh probe state. */
            function reprobe(view: { rerender: (ui: ReactNode) => void }) {
                act(() => {
                    view.rerender(
                        <QueryClientProvider client={new QueryClient()}>
                            <IntlProvider locale="en">
                                <AuthProvider>
                                    <AuthStateProbe />
                                </AuthProvider>
                            </IntlProvider>
                        </QueryClientProvider>
                    );
                });
            }

            it('announces when a resolved user gives way to nobody', () => {
                const warn = vi.spyOn(toast, 'warning');
                probeReturns({
                    data: {
                        id: 'usr_1',
                        email: 'ada@ortha.dev',
                        name: 'Ada Lovelace',
                        permissions: []
                    }
                });
                const view = renderProvider();

                probeReturns({ data: null });
                reprobe(view);

                expect(markSessionEnded).toHaveBeenCalledTimes(1);
                expect(warn).toHaveBeenCalledTimes(1);
                expect(warn).toHaveBeenCalledWith(
                    'Your session has ended. Please sign in again.'
                );
            });

            // The ordinary signed-out state: a bookmark opened in a fresh tab
            // reaches `unauthenticated` too. Announcing here would tell someone
            // who never signed in that something of theirs was taken away.
            it('stays silent on a tab that never held a session', () => {
                const warn = vi.spyOn(toast, 'warning');
                probeReturns({ data: null });

                renderProvider();

                expect(markSessionEnded).not.toHaveBeenCalled();
                expect(warn).not.toHaveBeenCalled();
            });

            // Signing out produces the identical fall. Reporting it back as a
            // session that "has ended" would dress the visitor's own click up
            // as a fault, so the sign-out path raises a flag this consumes.
            it('stays silent when the visitor asked to sign out', () => {
                const warn = vi.spyOn(toast, 'warning');
                vi.mocked(takeExpectedSignOut).mockReturnValueOnce(true);
                probeReturns({
                    data: {
                        id: 'usr_1',
                        email: 'ada@ortha.dev',
                        name: null,
                        permissions: []
                    }
                });
                const view = renderProvider();

                probeReturns({ data: null });
                reprobe(view);

                expect(markSessionEnded).not.toHaveBeenCalled();
                expect(warn).not.toHaveBeenCalled();
            });

            // An outage is not a sign-out: `unavailable` keeps the visitor
            // where they are behind a retry card, so there is nothing to
            // announce and nothing for the sign-in page to repeat.
            it('stays silent when the probe failed rather than refused', () => {
                const warn = vi.spyOn(toast, 'warning');
                probeReturns({
                    data: {
                        id: 'usr_1',
                        email: 'ada@ortha.dev',
                        name: null,
                        permissions: []
                    }
                });
                const view = renderProvider();

                probeReturns({ data: null, isError: true });
                reprobe(view);

                expect(markSessionEnded).not.toHaveBeenCalled();
                expect(warn).not.toHaveBeenCalled();
            });

            // One loss, one announcement. The effect keys on a status that
            // stays `unauthenticated` across every later render, so without the
            // latch each one would raise another toast.
            it('announces once, however many renders follow', () => {
                const warn = vi.spyOn(toast, 'warning');
                probeReturns({
                    data: {
                        id: 'usr_1',
                        email: 'ada@ortha.dev',
                        name: null,
                        permissions: []
                    }
                });
                const view = renderProvider();

                probeReturns({ data: null });
                reprobe(view);
                reprobe(view);
                reprobe(view);

                expect(markSessionEnded).toHaveBeenCalledTimes(1);
                expect(warn).toHaveBeenCalledTimes(1);
            });
        });

        // The handler closes over this provider's query client. Leaving it
        // installed past unmount would have a `401` on the public tree writing
        // into a cache nobody reads, and would keep the whole private tree
        // alive through the closure.
        it('uninstalls the handler when the provider unmounts', () => {
            const { unmount } = renderProvider();

            expect(setUnauthorizedHandler).toHaveBeenCalledTimes(1);

            unmount();

            expect(setUnauthorizedHandler).toHaveBeenCalledTimes(2);
            expect(setUnauthorizedHandler).toHaveBeenLastCalledWith(null);
        });
    });
});
