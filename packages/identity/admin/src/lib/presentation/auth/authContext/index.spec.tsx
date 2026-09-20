import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
    AuthProviderContext,
    AuthStatus,
    useAuth,
    useHasPermission,
    type AuthState,
    type AuthUser
} from './index';

/** A signed-in user holding exactly `permissions`, with the rest filled in. */
function signedInUser(permissions: string[]): AuthUser {
    return {
        id: 'usr_1',
        email: 'ada@ortha.dev',
        name: 'Ada Lovelace',
        permissions
    };
}

/** Wraps a hook in a provider publishing `state`. */
function withState(state: AuthState) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return (
            <AuthProviderContext value={state}>{children}</AuthProviderContext>
        );
    };
}

/**
 * The read side of the auth context — the two hooks every permission-gated
 * control in the admin goes through.
 *
 * Both are deliberately **fail-closed**, and that is the whole point of these
 * tests: a hook that guesses "probably allowed" while the probe is in flight,
 * or that throws (and so gets wrapped in a `try`/default-true somewhere) when no
 * provider is mounted, turns a missing provider or a slow API into UI that
 * offers actions the server will refuse. The server enforces the same
 * permissions either way, so the only thing at stake here is whether the UI
 * lies — but it lies to an admin about what they are allowed to do, which is
 * exactly the kind of confusion a permission model exists to prevent.
 */
describe('authContext', () => {
    describe('useAuth', () => {
        // No provider is not an error state to recover from — it is the state
        // the app is in before `AuthProvider` has mounted, and `Loading` is the
        // only answer that keeps the gate shut without claiming the user is
        // signed out.
        it('falls back to loading with no user when no provider is mounted', () => {
            const { result } = renderHook(() => useAuth());

            expect(result.current).toEqual({
                status: AuthStatus.Loading,
                user: null
            });
        });

        it('publishes the state the provider supplies', () => {
            const user = signedInUser(['workspaces:create']);
            const { result } = renderHook(() => useAuth(), {
                wrapper: withState({
                    status: AuthStatus.Authenticated,
                    user
                })
            });

            expect(result.current).toEqual({
                status: AuthStatus.Authenticated,
                user
            });
        });
    });

    describe('useHasPermission', () => {
        it('grants a permission the authenticated user holds', () => {
            const { result } = renderHook(
                () => useHasPermission('workspaces:create'),
                {
                    wrapper: withState({
                        status: AuthStatus.Authenticated,
                        user: signedInUser([
                            'workspaces:read',
                            'workspaces:create'
                        ])
                    })
                }
            );

            expect(result.current).toBe(true);
        });

        it('refuses a permission the authenticated user does not hold', () => {
            const { result } = renderHook(
                () => useHasPermission('workspaces:delete'),
                {
                    wrapper: withState({
                        status: AuthStatus.Authenticated,
                        user: signedInUser([
                            'workspaces:read',
                            'workspaces:create'
                        ])
                    })
                }
            );

            expect(result.current).toBe(false);
        });

        // The permission list is matched whole: `workspaces:read` must not be
        // satisfied by holding `workspaces:read:own`, and holding a prefix must
        // not open the parent.
        it('matches permission keys whole, not by prefix', () => {
            const { result } = renderHook(
                () => useHasPermission('workspaces:read'),
                {
                    wrapper: withState({
                        status: AuthStatus.Authenticated,
                        user: signedInUser(['workspaces:read:own'])
                    })
                }
            );

            expect(result.current).toBe(false);
        });

        // Every non-`Authenticated` status carries `user: null`, so there is no
        // permission list to consult; the answer has to be `false` rather than
        // an optimistic default or a crash. `Unavailable` is the one worth
        // staring at: the user may well be signed in and entitled, but we could
        // not confirm it, and hiding a button we cannot justify is the safe
        // direction.
        it.each([
            [AuthStatus.Loading],
            [AuthStatus.Unauthenticated],
            [AuthStatus.Unavailable]
            // covers: identity:I-29
        ])('refuses every permission while %s', (status) => {
            const { result } = renderHook(
                () => useHasPermission('workspaces:create'),
                {
                    wrapper: withState({ status, user: null } as AuthState)
                }
            );

            expect(result.current).toBe(false);
        });

        // The gate is closed by default, not opened by default: a component
        // rendered outside `AuthProvider` (a test harness, a slot mounted in
        // the public tree, a future refactor that moves a page out of the
        // private area) gets `false`, because `useAuth` falls back to
        // `Loading`.
        it('refuses every permission when no provider is mounted at all', () => {
            const { result } = renderHook(() =>
                useHasPermission('workspaces:create')
            );

            expect(result.current).toBe(false);
        });

        // `SidebarNavButton` passes `item.permission ?? ''` for a nav item that
        // needs no permission, so the empty string reaches this hook as a real
        // argument. It must not be treated as "no permission required" here —
        // the call site decides that — and since no role grants `''`, the
        // honest answer is `false`.
        it('refuses the empty permission key when the user does not hold it', () => {
            const { result } = renderHook(() => useHasPermission(''), {
                wrapper: withState({
                    status: AuthStatus.Authenticated,
                    user: signedInUser(['workspaces:read'])
                })
            });

            expect(result.current).toBe(false);
        });
    });
});
