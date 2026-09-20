import type { ReactNode } from 'react';
import {
    QueryClient,
    QueryClientProvider,
    useQuery
} from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaAltCoverage, useMediaStorage, useMediaUploads } from './index';

/**
 * The media half of two Insights-page invariants.
 *
 * `insights:I-16` ("every Insights request sets `retry: 1`") and `insights:I-17`
 * ("every widget's cache key contains the workspace id") are stated for the
 * page, but the queries belong to the plugins that own the data — so content's
 * six are pinned in `packages/content/admin`, and these three were pinned
 * nowhere. Reverting all three `retry: 1` lines to the default, or dropping
 * `workspace.id` out of `mediaInsightsKeys`, broke no test in the repo.
 *
 * Neither is reachable from `apps/admin-e2e`. It can see a card that failed but
 * not how many requests were spent getting there, and it drives one workspace
 * at a time — the whole point of the key is what happens when a second one is
 * opened.
 *
 * The workspace case matters more than a key assertion looks. The workspace
 * reaches the server **only** as an ambient `X-Workspace-Id` header, and a cache
 * hit sends no request at all — so a key missing the id does not fetch the
 * wrong workspace, it silently shows the previous one's numbers and never
 * refetches.
 */

const gateway = vi.hoisted(() => ({
    storage: vi.fn(),
    uploads: vi.fn(),
    altCoverage: vi.fn()
}));

vi.mock('../../infrastructure/httpMediaInsightsGateway', () => ({
    httpMediaInsightsGateway: gateway
}));

/** The open workspace, swapped between renders by the cache-key cases. */
const open = vi.hoisted(() => ({ id: 'ws-alpha' }));

vi.mock('@orthacms/workspaces-admin', () => ({
    useCurrentWorkspace: () => ({ id: open.id, name: open.id })
}));

vi.mock('@orthacms/identity-admin', () => ({
    useHasPermission: () => true
}));

/** The selected window, swapped by the `days` case. */
const window_ = vi.hoisted(() => ({ days: 30 }));

vi.mock('@orthacms/insights-admin', () => ({
    useInsightsRange: () => ({
        range: '30d',
        days: window_.days,
        setRange: () => undefined
    })
}));

/**
 * A client that keeps TanStack's own `retry` default (three) and only collapses
 * the backoff, so the number of attempts is the hook's decision and the test
 * still finishes in milliseconds.
 */
function client() {
    return new QueryClient({
        defaultOptions: { queries: { retryDelay: 0 } }
    });
}

const wrapper = (queryClient: QueryClient) =>
    function Wrapper({ children }: { children: ReactNode }) {
        return (
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        );
    };

const hooks = [
    ['storage', useMediaStorage, gateway.storage],
    ['uploads', useMediaUploads, gateway.uploads],
    ['alt coverage', useMediaAltCoverage, gateway.altCoverage]
] as const;

beforeEach(() => {
    open.id = 'ws-alpha';
    window_.days = 30;
    for (const fn of Object.values(gateway)) fn.mockReset();
});

describe('media Insights queries', () => {
    it.each(hooks)(
        '%s asks twice and then reports failure [insights:I-16]',
        async (_name, hook, request) => {
            request.mockRejectedValue(new Error('insights endpoint is down'));
            const queryClient = client();

            const { result } = renderHook(() => hook(), {
                wrapper: wrapper(queryClient)
            });

            await waitFor(() => expect(result.current.isError).toBe(true));

            // One initial attempt plus one retry. Four would be TanStack's
            // default, and the card would still be on its skeleton.
            expect(request).toHaveBeenCalledTimes(2);
        }
    );

    it('is measured against a client that would otherwise retry three times [insights:I-16]', async () => {
        // The control the counts above depend on: a QueryClient that had
        // disabled retries itself would make every one of them read 1 attempt
        // and pass for a reason that has nothing to do with the hooks.
        const queryClient = client();
        const request = vi
            .fn()
            .mockRejectedValue(new Error('insights endpoint is down'));

        const { result } = renderHook(
            () => useQuery({ queryKey: ['control'], queryFn: request }),
            { wrapper: wrapper(queryClient) }
        );

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(request).toHaveBeenCalledTimes(4);
    });

    it.each(hooks)(
        '%s refetches when a different workspace is opened [insights:I-17]',
        async (_name, hook, request) => {
            request.mockResolvedValue({});
            // One client across both renders — a fresh one per workspace would
            // refetch whatever the key said, which is exactly the mistake this
            // case exists to catch.
            const queryClient = client();

            const first = renderHook(() => hook(), {
                wrapper: wrapper(queryClient)
            });
            await waitFor(() =>
                expect(first.result.current.isSuccess).toBe(true)
            );
            expect(request).toHaveBeenCalledTimes(1);

            // The control: re-rendering the same workspace is a cache hit, so
            // the second call below is the workspace and not remounting.
            const same = renderHook(() => hook(), {
                wrapper: wrapper(queryClient)
            });
            await waitFor(() =>
                expect(same.result.current.isSuccess).toBe(true)
            );
            expect(request).toHaveBeenCalledTimes(1);

            open.id = 'ws-beta';
            const second = renderHook(() => hook(), {
                wrapper: wrapper(queryClient)
            });
            await waitFor(() =>
                expect(second.result.current.isSuccess).toBe(true)
            );

            expect(request).toHaveBeenCalledTimes(2);
        }
    );

    it('refetches uploads when the range changes, and only uploads [insights:I-17]', async () => {
        // The second half of I-17: a period-dependent key also carries `days`.
        // Storage and alt coverage take no range on purpose — accessibility
        // debt is a standing total — so a `days` in *their* keys would refetch
        // them on every range change for nothing.
        gateway.uploads.mockResolvedValue({});
        gateway.storage.mockResolvedValue({});
        const queryClient = client();

        // Named `use…` because it *is* a hook — it calls two of them, and the
        // rules-of-hooks lint is right to insist.
        const useBoth = () => {
            useMediaStorage();
            return useMediaUploads();
        };

        const first = renderHook(useBoth, { wrapper: wrapper(queryClient) });
        await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
        expect(gateway.uploads).toHaveBeenCalledTimes(1);
        expect(gateway.uploads).toHaveBeenLastCalledWith(30);

        window_.days = 90;
        const second = renderHook(useBoth, { wrapper: wrapper(queryClient) });
        await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

        expect(gateway.uploads).toHaveBeenCalledTimes(2);
        expect(gateway.uploads).toHaveBeenLastCalledWith(90);
        expect(gateway.storage).toHaveBeenCalledTimes(1);
    });
});
