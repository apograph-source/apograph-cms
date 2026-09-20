import { ApiError } from '@orthacms/utils-admin';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { httpAuthGateway } from '../../infrastructure/httpAuthGateway';
import { resetSessionCache } from '../resetSessionCache';
import { useAcceptInviteMutation } from './index';

vi.mock('../../infrastructure/httpAuthGateway', () => ({
    httpAuthGateway: { acceptInvite: vi.fn() }
}));

// A collaborator, not the unit — what the sweep removes is its own spec's job.
vi.mock('../resetSessionCache', () => ({ resetSessionCache: vi.fn() }));

const acceptInvite = vi.mocked(httpAuthGateway.acceptInvite);
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

const input = {
    token: 'tok_1',
    password: 'correct horse battery',
    confirmPassword: 'correct horse battery'
};

/**
 * Redeeming an invite. On success the server activates the account and sets the
 * session cookie, so the invitee is signed in the moment this resolves — which
 * makes it an identity change on this tab, exactly like signing in.
 *
 * That is easy to overlook precisely because it does not look like a sign-in:
 * the page is an invite link, not the sign-in form. But the cookie the server
 * sends back is the invitee's, whoever was signed in on this tab a moment ago,
 * so the same sweep has to run or one account finishes the flow holding
 * another's cached data.
 */
describe('useAcceptInviteMutation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('accepts the invite it was given', async () => {
        acceptInvite.mockResolvedValue(undefined);
        const { wrapper } = withQueryClient();

        const { result } = renderHook(() => useAcceptInviteMutation(), {
            wrapper
        });
        result.current.mutate(input);

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(acceptInvite).toHaveBeenCalledWith(input);
    });

    it('clears whatever the previous occupant of the tab cached', async () => {
        acceptInvite.mockResolvedValue(undefined);
        const { queryClient, wrapper } = withQueryClient();

        const { result } = renderHook(() => useAcceptInviteMutation(), {
            wrapper
        });
        result.current.mutate(input);

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(sweep).toHaveBeenCalledExactlyOnceWith(queryClient);
    });

    // A dead link (404) or a server-rejected password (400) changes nobody's
    // identity, so nothing may be swept — the page still has an invite to show
    // and, if someone was signed in, a session to keep.
    it('leaves the cache alone when the link is dead', async () => {
        acceptInvite.mockRejectedValue(new ApiError(404));
        const { wrapper } = withQueryClient();

        const { result } = renderHook(() => useAcceptInviteMutation(), {
            wrapper
        });
        result.current.mutate(input);

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(sweep).not.toHaveBeenCalled();
        expect(result.current.error?.status).toBe(404);
    });
});
