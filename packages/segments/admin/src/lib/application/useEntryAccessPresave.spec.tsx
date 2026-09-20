import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { EntryPresaveResult } from '@orthacms/content-admin';
import { segmentsKeys } from '../infrastructure/segmentsGateway';
import type { EntryAccessStaging } from '../domain/types';
import { useEntryAccessPresave } from './useEntryAccessPresave';

/**
 * The staging handle. `EntryPresave.handle` is `unknown` by design — content
 * carries it without knowing what a plugin puts in it — so the tab casts it
 * exactly like this.
 */
function staging(handle: unknown): EntryAccessStaging {
    return handle as EntryAccessStaging;
}

const WORKSPACE = 'w1';

vi.mock('@orthacms/workspaces-admin', () => ({
    useCurrentWorkspace: vi.fn(() => ({ id: WORKSPACE }))
}));

/** A client and the provider the admin shell publishes it through. */
function withQueryClient() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
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

/** What `ContentEntryView` hands `settle` after the write returned. */
function saved(id: string, updatedAt: string): EntryPresaveResult {
    return {
        entry: { id, updatedAt },
        schema: {},
        created: false,
        published: true
    } as unknown as EntryPresaveResult;
}

describe('the entry-access cache key', () => {
    /**
     * The workspace is in the key because it reaches the server **only** as an
     * ambient `X-Workspace-Id` header — which is not sent on a cache hit. A key
     * without it would serve one workspace the other's answer, and the answer in
     * question is "who may read this".
     */
    it('does not share an entry between workspaces [segments:I-29]', () => {
        const { queryClient } = withQueryClient();
        const access = { allow: ['s1'], deny: [] };

        queryClient.setQueryData(segmentsKeys.entry('w1', 'e1', 'v1'), access);

        expect(
            queryClient.getQueryData(segmentsKeys.entry('w2', 'e1', 'v1'))
        ).toBeUndefined();
    });

    /**
     * The row's `updatedAt` is in it because access is written by the entry's
     * **own save** now, so it moves on paths this plugin has no hook into — a
     * restore above all, which puts back that version's audiences through
     * content's use-case. A key that ignored the version would answer a restored
     * entry with the access it had before the restore, indefinitely.
     */
    it('does not survive the row moving on [segments:I-29]', () => {
        const { queryClient } = withQueryClient();

        queryClient.setQueryData(segmentsKeys.entry(WORKSPACE, 'e1', 'v1'), {
            allow: ['s1'],
            deny: []
        });

        expect(
            queryClient.getQueryData(segmentsKeys.entry(WORKSPACE, 'e1', 'v2'))
        ).toBeUndefined();
    });
});

describe('useEntryAccessPresave.settle', () => {
    /**
     * The save carried these lists and the server stored them in the same
     * transaction, so seeding is telling the cache what it already knows.
     * Refetching instead would blank the control the editor is still looking at
     * — and on a **create** there is no query to refetch under the old, id-less
     * key at all.
     */
    it('seeds the saved row under its new version [segments:I-29]', async () => {
        const { queryClient, wrapper } = withQueryClient();
        const { result } = renderHook(() => useEntryAccessPresave(), {
            wrapper
        });

        const staged = { allow: ['s1'], deny: ['s2'] };
        act(() => staging(result.current.handle).stage(staged));
        await act(async () => {
            await result.current.settle?.(saved('e1', 'v2'));
        });

        expect(
            queryClient.getQueryData(segmentsKeys.entry(WORKSPACE, 'e1', 'v2'))
        ).toEqual(staged);
        // …and the staging is cleared, so the next save of an untouched Access
        // tab sends no key at all.
        expect(staging(result.current.handle).draft).toBeNull();
    });

    /**
     * The other half, and the one that is invisible until somebody switches
     * language: the server wrote the record's whole **locale group**, but a
     * sibling's `updatedAt` did not move — so its key is unchanged and its
     * cached answer is now wrong. Without the sweep, switching locale shows the
     * audiences that locale used to have.
     */
    it('invalidates every other cached entry, and only those [segments:I-29]', async () => {
        const { queryClient, wrapper } = withQueryClient();

        const sibling = segmentsKeys.entry(WORKSPACE, 'e2', 'v1');
        const otherWorkspace = segmentsKeys.entry('w2', 'e9', 'v1');
        const directory = segmentsKeys.list({ workspaceId: WORKSPACE });
        for (const key of [sibling, otherWorkspace, directory]) {
            queryClient.setQueryData(key, { allow: [], deny: [] });
        }

        const { result } = renderHook(() => useEntryAccessPresave(), {
            wrapper
        });
        act(() =>
            staging(result.current.handle).stage({ allow: ['s1'], deny: [] })
        );
        await act(async () => {
            await result.current.settle?.(saved('e1', 'v2'));
        });

        const invalidated = (key: readonly unknown[]) =>
            queryClient.getQueryState(key)?.isInvalidated;

        expect(invalidated(sibling)).toBe(true);
        expect(invalidated(otherWorkspace)).toBe(true);
        // The row just seeded is excluded, so the control the editor is still
        // looking at is not put back in flight over an answer it already has.
        expect(invalidated(segmentsKeys.entry(WORKSPACE, 'e1', 'v2'))).toBe(
            false
        );
        // And the directory is not an entry — a sweep that took the whole
        // `segments` root would refetch the audience list on every save.
        expect(invalidated(directory)).toBe(false);
    });

    it('does nothing at all when nothing was staged [segments:I-29]', async () => {
        // An editor who never opened the Access tab pays nothing: no seed, no
        // invalidation, no request.
        const { queryClient, wrapper } = withQueryClient();
        const sibling = segmentsKeys.entry(WORKSPACE, 'e2', 'v1');
        queryClient.setQueryData(sibling, { allow: [], deny: [] });

        const { result } = renderHook(() => useEntryAccessPresave(), {
            wrapper
        });
        await act(async () => {
            await result.current.settle?.(saved('e1', 'v2'));
        });

        expect(queryClient.getQueryState(sibling)?.isInvalidated).toBe(false);
        expect(
            queryClient.getQueryData(segmentsKeys.entry(WORKSPACE, 'e1', 'v2'))
        ).toBeUndefined();
    });
});

describe('useEntryAccessPresave.extensions', () => {
    it('sends the staged lists under the key the server reads', () => {
        // The bag the entry save carries, which is the whole write path.
        const { wrapper } = withQueryClient();
        const { result } = renderHook(() => useEntryAccessPresave(), {
            wrapper
        });

        expect(result.current.extensions?.()).toBeUndefined();

        act(() =>
            staging(result.current.handle).stage({ allow: ['s1'], deny: [] })
        );

        expect(result.current.extensions?.()).toEqual({
            access: { allow: ['s1'], deny: [] }
        });
    });
});
