import { ApiError } from '@orthacms/utils-admin';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { httpAuthGateway } from '../../infrastructure/httpAuthGateway';
import { resetSessionCache } from '../resetSessionCache';
import { useLoginMutation } from './index';

vi.mock('../../infrastructure/httpAuthGateway', () => ({
    httpAuthGateway: { login: vi.fn() }
}));

// The sweep is a collaborator here, not the unit — what it removes is covered
// by its own spec. This asks only whether signing in reaches for it.
vi.mock('../resetSessionCache', () => ({ resetSessionCache: vi.fn() }));

const login = vi.mocked(httpAuthGateway.login);
const sweep = vi.mocked(resetSessionCache);

/** A client and a wrapper publishing it, as the admin shell would. */
function withQueryClient() {
    const queryClient = new QueryClient({
        defaultOptions: { mutations: { retry: false } }
    });

    return {
        queryClient,
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        )
    };
}

const credentials = { email: 'ada@ortha.dev', password: 'correct horse' };

/**
 * Signing in. The request itself is the gateway's business; what belongs to
 * this hook is the tab's bookkeeping around it.
 *
 * A tab holds one identity at a time, and the cache is filled on behalf of
 * whoever is signed in. Sign-out already sweeps on the way out — but a session
 * can also end *without* a sign-out (revoked from another device, expired, the
 * account suspended), and that path only nulls the current-user probe. So the
 * sweep has to happen on the way in as well, or the next person to sign in on
 * this tab inherits the previous account's workspaces, roster and activity
 * until each query happens to refetch.
 */
describe('useLoginMutation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('signs in with the credentials it was given', async () => {
        login.mockResolvedValue(undefined);
        const { wrapper } = withQueryClient();

        const { result } = renderHook(() => useLoginMutation(), { wrapper });
        result.current.mutate(credentials);

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(login).toHaveBeenCalledWith(credentials);
    });

    it('clears whatever the previous occupant of the tab cached', async () => {
        login.mockResolvedValue(undefined);
        const { queryClient, wrapper } = withQueryClient();

        const { result } = renderHook(() => useLoginMutation(), { wrapper });
        result.current.mutate(credentials);

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(sweep).toHaveBeenCalledExactlyOnceWith(queryClient);
    });

    // Nothing changed identity, so nothing should be thrown away — a wrong
    // password must not cost the signed-in user their cached data.
    it('leaves the cache alone when the credentials are refused', async () => {
        login.mockRejectedValue(new ApiError(401));
        const { wrapper } = withQueryClient();

        const { result } = renderHook(() => useLoginMutation(), { wrapper });
        result.current.mutate(credentials);

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(sweep).not.toHaveBeenCalled();
        expect(result.current.error?.status).toBe(401);
    });
});
