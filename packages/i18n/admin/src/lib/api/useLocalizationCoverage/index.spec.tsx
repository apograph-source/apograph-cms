import type { ReactNode } from 'react';
import {
    QueryClient,
    QueryClientProvider,
    useQuery
} from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18N_COVERAGE_PATH } from '../../constants';
import { useLocalizationCoverage } from './index';

/**
 * The last unpinned Insights query.
 *
 * `insights:I-16` ("every Insights request sets `retry: 1` rather than the
 * default three") is stated for the page, but the queries belong to the plugins
 * that own the data. Content's six are pinned in `packages/content/admin` and
 * media's three in `packages/media/admin`; this one was pinned by nothing,
 * because the package had no test target at all — reverting the `retry: 1`
 * below broke no test in the repo.
 *
 * `apps/admin-e2e` cannot reach it: it can see a widget that failed, but not
 * how many requests were spent getting there, and the difference between one
 * retry and three is about seven seconds of skeleton on a page whose whole
 * premise is that a broken card *says* so.
 *
 * `insights:I-17`'s workspace clause comes along for the ride, and for the same
 * reason it matters everywhere else: the workspace reaches the server only as
 * an ambient `X-Workspace-Id` header, and a cache hit sends no request — so a
 * key missing the id shows the previous workspace's coverage forever.
 */

const get = vi.hoisted(() => vi.fn());

vi.mock('@orthacms/utils-admin', () => ({
    apiClient: { get },
    STALE_TIME: { Standard: 30_000 },
    toApiError: (error: unknown) => error
}));

/** The open workspace, swapped between renders by the cache-key case. */
const open = vi.hoisted(() => ({ id: 'ws-alpha' }));

vi.mock('@orthacms/workspaces-admin', () => ({
    useCurrentWorkspace: () => ({ id: open.id, name: open.id })
}));

vi.mock('@orthacms/identity-admin', () => ({
    useHasPermission: () => true
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

beforeEach(() => {
    open.id = 'ws-alpha';
    get.mockReset();
});

describe('useLocalizationCoverage', () => {
    it('asks twice and then reports failure [insights:I-16]', async () => {
        get.mockRejectedValue(new Error('coverage endpoint is down'));
        const queryClient = client();

        const { result } = renderHook(() => useLocalizationCoverage(), {
            wrapper: wrapper(queryClient)
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        // One initial attempt plus one retry. Four would be TanStack's default.
        expect(get).toHaveBeenCalledTimes(2);
        expect(get).toHaveBeenLastCalledWith(I18N_COVERAGE_PATH);
    });

    it('is measured against a client that would otherwise retry three times [insights:I-16]', async () => {
        // The control the count above depends on: a QueryClient that had
        // disabled retries itself would make it read 1 attempt and pass for a
        // reason that has nothing to do with the hook.
        const queryClient = client();
        const request = vi
            .fn()
            .mockRejectedValue(new Error('coverage endpoint is down'));

        const { result } = renderHook(
            () => useQuery({ queryKey: ['control'], queryFn: request }),
            { wrapper: wrapper(queryClient) }
        );

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(request).toHaveBeenCalledTimes(4);
    });

    it('refetches when a different workspace is opened [insights:I-17]', async () => {
        get.mockResolvedValue({ data: { locales: [] } });
        // One client across all three renders — a fresh one per workspace would
        // refetch whatever the key said, which is the mistake this catches.
        const queryClient = client();

        const first = renderHook(() => useLocalizationCoverage(), {
            wrapper: wrapper(queryClient)
        });
        await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
        expect(get).toHaveBeenCalledTimes(1);

        // The control: the same workspace again is a cache hit, so the third
        // render's request is the workspace and not remounting.
        const same = renderHook(() => useLocalizationCoverage(), {
            wrapper: wrapper(queryClient)
        });
        await waitFor(() => expect(same.result.current.isSuccess).toBe(true));
        expect(get).toHaveBeenCalledTimes(1);

        open.id = 'ws-beta';
        const second = renderHook(() => useLocalizationCoverage(), {
            wrapper: wrapper(queryClient)
        });
        await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

        expect(get).toHaveBeenCalledTimes(2);
    });
});
