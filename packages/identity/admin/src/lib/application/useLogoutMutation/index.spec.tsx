import { toast } from '@orthacms/design-system';
import { ApiError } from '@orthacms/utils-admin';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '../../../types/auth';
import { httpAuthGateway } from '../../infrastructure/httpAuthGateway';
import { resetSessionCache } from '../resetSessionCache';
import { currentUserKey } from '../useCurrentUser';
import { useLogoutMutation } from './index';

vi.mock('../../infrastructure/httpAuthGateway', () => ({
    httpAuthGateway: { logout: vi.fn() }
}));

// Mocked so the sweep can be *observed* rather than performed: the order of the
// two cache writes is the invariant, and a real sweep would erase the evidence.
vi.mock('../resetSessionCache', () => ({ resetSessionCache: vi.fn() }));

vi.mock('@orthacms/design-system', () => ({
    toast: { error: vi.fn(), success: vi.fn() }
}));

const logout = vi.mocked(httpAuthGateway.logout);
const sweep = vi.mocked(resetSessionCache);
const errorToast = vi.mocked(toast.error);

const signedIn: CurrentUser = {
    id: 'usr_1',
    email: 'ada@ortha.dev',
    name: 'Ada Lovelace',
    roleId: 'role_admin',
    status: 'Active',
    permissions: []
};

/**
 * A client already holding a signed-in session, plus the providers the hook
 * needs: the query client it writes to and the intl the failure copy comes from.
 */
function withSignedInSession() {
    const queryClient = new QueryClient({
        defaultOptions: { mutations: { retry: false } }
    });
    queryClient.setQueryData(currentUserKey, signedIn);
    queryClient.setQueryData(['workspaces'], [{ id: 'ws_1' }]);

    return {
        queryClient,
        wrapper: ({ children }: { children: ReactNode }) => (
            <IntlProvider locale="en" onError={() => undefined}>
                <QueryClientProvider client={queryClient}>
                    {children}
                </QueryClientProvider>
            </IntlProvider>
        )
    };
}

/**
 * Signing out — the one flow where the cache writes have to happen in a
 * particular order, and the one where a failure must *not* be papered over.
 *
 * The probe (`['auth','me']`) is the query `AuthProvider` observes, so it is
 * settled on `null` **before** the sweep runs: removing a query out from under
 * a mounted observer leaves that observer holding the value it already had, and
 * the shell would go on reporting the signed-out user as signed in. Writing
 * `null` rather than invalidating is the same reasoning — the session is gone,
 * so a refetch could only `401` its way to the same answer, a round trip later.
 *
 * The failure path is the mirror image. A logout request that fails means the
 * session was **not** revoked, so the UI has to stay signed in and say so:
 * showing someone on a shared machine a signed-out screen while their session
 * is still live is the one outcome worse than a visible error.
 */
describe('useLogoutMutation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('revokes the session through the gateway', async () => {
        logout.mockResolvedValue(undefined);
        const { wrapper } = withSignedInSession();

        const { result } = renderHook(() => useLogoutMutation(), { wrapper });
        result.current.mutate();

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(logout).toHaveBeenCalledOnce();
    });

    it('settles the current-user probe on "nobody" before sweeping the rest', async () => {
        logout.mockResolvedValue(undefined);
        const { queryClient, wrapper } = withSignedInSession();

        // What the probe held at the moment the sweep was called — the sweep
        // running first would capture the outgoing user instead of `null`.
        let probeWhenSwept: unknown = 'sweep was never called';
        sweep.mockImplementation((client) => {
            probeWhenSwept = client.getQueryData(currentUserKey);
        });
        const setQueryData = vi.spyOn(queryClient, 'setQueryData');

        const { result } = renderHook(() => useLogoutMutation(), { wrapper });
        result.current.mutate();

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(setQueryData).toHaveBeenCalledWith(currentUserKey, null);
        expect(sweep).toHaveBeenCalledExactlyOnceWith(queryClient);
        expect(setQueryData.mock.invocationCallOrder[0]).toBeLessThan(
            sweep.mock.invocationCallOrder[0]
        );
        expect(probeWhenSwept).toBeNull();
    });

    it('leaves the probe holding null once it settles', async () => {
        logout.mockResolvedValue(undefined);
        const { queryClient, wrapper } = withSignedInSession();

        const { result } = renderHook(() => useLogoutMutation(), { wrapper });
        result.current.mutate();

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(queryClient.getQueryData(currentUserKey)).toBeNull();
    });

    describe('when the request fails', () => {
        it('keeps the visitor signed in — the session was never revoked', async () => {
            logout.mockRejectedValue(new ApiError(null, 'Network error'));
            const { queryClient, wrapper } = withSignedInSession();

            const { result } = renderHook(() => useLogoutMutation(), {
                wrapper
            });
            result.current.mutate();

            await waitFor(() => expect(result.current.isError).toBe(true));

            expect(queryClient.getQueryData(currentUserKey)).toEqual(signedIn);
            expect(sweep).not.toHaveBeenCalled();
            // And the rest of the session's cache is still there with it.
            expect(queryClient.getQueryData(['workspaces'])).toEqual([
                { id: 'ws_1' }
            ]);
        });

        // Reported here rather than at each call site: the sign-out control is
        // in the shell's user menu, and swallowing the click would leave
        // someone believing they had left.
        it('says so, instead of swallowing the click', async () => {
            logout.mockRejectedValue(new ApiError(500));
            const { wrapper } = withSignedInSession();

            const { result } = renderHook(() => useLogoutMutation(), {
                wrapper
            });
            result.current.mutate();

            await waitFor(() => expect(result.current.isError).toBe(true));

            expect(errorToast).toHaveBeenCalledOnce();
            expect(errorToast.mock.calls[0][0]).toContain(
                'you are still signed in on this device'
            );
        });
    });
});
