import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useImportApply } from './index';

/**
 * **`transfer:I-41`** — "after an import the cache of every type named in the
 * verdicts is refreshed, plus the collection's type, plus the media library."
 *
 * Only the middle clause was pinned, by `apps/admin-e2e`'s "an import re-reads
 * the collection it wrote into". The other two are **not observable in a
 * browser**, and the reason is worth stating because it makes the assertion
 * look redundant when it is not: `invalidateQueries` refetches only queries
 * that are currently *mounted*, the import dialog is reachable only from the
 * collection you are already looking at, and the entry list's `staleTime` is 0
 * — so the second type's list and the media library are always unmounted, and
 * navigating to either afterwards refetches whether or not it was invalidated.
 * A browser test therefore passes with the whole `touched` set deleted.
 *
 * It is exactly the case the design exists for: one import creates an article
 * **and** the author it points at, and refreshing only the article list leaves
 * the authors list showing pre-import data with nothing to say it is stale.
 *
 * `refreshEntryCaches` is content's own one-pass refresh and is mocked here
 * rather than reimplemented — the claim is *which types are refreshed*, not
 * which key roots the content library uses, which is that function's own test.
 */

const refreshEntryCaches = vi.hoisted(() => vi.fn());

vi.mock('@orthacms/content-admin', () => ({ refreshEntryCaches }));

const post = vi.hoisted(() => vi.fn());

vi.mock('@orthacms/utils-admin', () => ({ apiClient: { post } }));

vi.mock('../useImportPreview', () => ({
    importFormData: () => new FormData()
}));

const WORKSPACE = '11111111-1111-4111-8111-111111111111';

function wrapper(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return (
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        );
    };
}

/** Runs one apply and returns what it refreshed. */
async function apply(verdictTypes: string[]) {
    post.mockResolvedValue({
        data: { verdicts: verdictTypes.map(($type) => ({ $type })) }
    });

    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });
    const invalidated: unknown[] = [];
    const original = queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = ((filters?: { queryKey?: unknown }) => {
        invalidated.push(filters?.queryKey);
        return original(filters as never);
    }) as typeof queryClient.invalidateQueries;

    const { result } = renderHook(() => useImportApply(), {
        wrapper: wrapper(queryClient)
    });

    result.current.mutate({
        typeName: 'article',
        workspaceId: WORKSPACE,
        file: new File(['{}'], 'import.json'),
        dryRun: false
    } as never);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    return {
        refreshed: refreshEntryCaches.mock.calls.map((call) => call[2]),
        workspaces: refreshEntryCaches.mock.calls.map((call) => call[1]),
        invalidated
    };
}

beforeEach(() => {
    refreshEntryCaches.mockReset();
    post.mockReset();
});

describe('what an import refreshes', () => {
    it('refreshes every type the verdicts name [transfer:I-41]', async () => {
        // The graph case: an article import that also created the author it
        // points at. `author` is never the collection being imported into, so
        // it can only get here from the verdicts.
        const { refreshed, workspaces } = await apply([
            'article',
            'author',
            'author',
            'tag'
        ]);

        expect([...refreshed].sort()).toEqual(['article', 'author', 'tag']);
        // Once per type, not once per verdict — three refreshes for four rows.
        expect(refreshed).toHaveLength(3);
        // Scoped to the open workspace, which is what makes the keys match the
        // lists the reader is looking at.
        expect(new Set(workspaces)).toEqual(new Set([WORKSPACE]));
    });

    it('refreshes the collection even when the run wrote nothing [transfer:I-41]', async () => {
        // The clause the browser test pins, kept here as the control for the
        // one above: with no verdicts at all the imported collection is still
        // refreshed, so "article appears in that list" is not merely an
        // accident of it having been named in the verdicts.
        const { refreshed } = await apply([]);

        expect(refreshed).toEqual(['article']);
    });

    it('re-reads the media library too [transfer:I-41]', async () => {
        // An archive import uploads assets, so the library is stale in a way
        // no entry-cache key covers. A plain `['media']` prefix, which — unlike
        // the `['content']` this hook once used — actually matches.
        const { invalidated } = await apply(['article']);

        expect(invalidated).toContainEqual(['media']);
    });
});
