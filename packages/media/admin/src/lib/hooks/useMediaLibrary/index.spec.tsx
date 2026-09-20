import type { ReactNode } from 'react';
import { IntlProvider } from 'react-intl';
import {
    QueryClient,
    QueryClientProvider,
    type QueryKey
} from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_SORT, ROOT_FOLDER_ID } from '../../constants';
import type { MediaAsset } from '../../types/mediaAsset';
import { httpMediaGateway } from '../../infrastructure/httpMediaGateway';
import { useMediaLibrary } from './index';

// The requests belong to the gateway; what belongs to this hook is the state
// algebra on top of them — which control clears what, and which cache key the
// answer lands under.
vi.mock('../../infrastructure/httpMediaGateway', () => ({
    httpMediaGateway: {
        listFolders: vi.fn(),
        listAssets: vi.fn(),
        createFolder: vi.fn(),
        renameFolder: vi.fn(),
        deleteFolder: vi.fn(),
        uploadFile: vi.fn(),
        renameAsset: vi.fn(),
        updateAsset: vi.fn(),
        moveAssets: vi.fn(),
        duplicateAssets: vi.fn(),
        deleteAssets: vi.fn()
    }
}));

vi.mock('@orthacms/design-system', () => ({
    toast: { error: vi.fn(), success: vi.fn() }
}));

/** The open workspace, swapped between renders by the cache-key cases. */
let workspaceId = 'ws-alpha';

vi.mock('@orthacms/workspaces-admin', () => ({
    useCurrentWorkspace: () => ({ id: workspaceId, name: 'Alpha', slug: 'a' })
}));

const listFolders = vi.mocked(httpMediaGateway.listFolders);
const listAssets = vi.mocked(httpMediaGateway.listAssets);

const asset = (id: string): MediaAsset => ({
    id,
    name: `${id}.png`,
    kind: 'image',
    url: `/api/media/assets/${id}/raw`,
    mimeType: 'image/png',
    size: 1024,
    folderId: ROOT_FOLDER_ID,
    tags: [],
    uploadedBy: 'Ada',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
});

/** How many assets the folder currently holds, across every page. */
let total = 90;

/**
 * A client per test, and the providers the shell supplies. Retries off so a
 * rejection settles on the first attempt; `gcTime: 0` is deliberately *not*
 * set — the cache-key cases read the keys the queries left behind.
 */
function harness() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
        <IntlProvider locale="en">
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        </IntlProvider>
    );

    return { queryClient, wrapper };
}

beforeEach(() => {
    vi.clearAllMocks();
    workspaceId = 'ws-alpha';
    total = 90;
    listFolders.mockResolvedValue({
        folders: [
            {
                id: 'folder-1',
                name: 'Press',
                parentId: ROOT_FOLDER_ID,
                createdAt: '2026-01-01T00:00:00.000Z'
            }
        ],
        folderCounts: new Map([[ROOT_FOLDER_ID, 90]])
    });
    listAssets.mockImplementation(({ page, pageSize }) =>
        Promise.resolve({
            items: [asset('a-1'), asset('a-2'), asset('a-3')],
            total,
            page,
            pageSize
        })
    );
});

/**
 * The Media Library's store, at the seams a browser cannot reach cheaply.
 *
 * Both invariants here are about state that is *invisible* when it is wrong.
 * A selection that survives a page change is not on screen — the bar counts
 * only the loaded page — but it is still armed, so Delete takes files the user
 * cannot see. A page left past the end of a shrunken result answers with an
 * empty grid under a header that says the folder holds ninety files. Neither
 * shows up as an error.
 */
describe('useMediaLibrary', () => {
    /** Renders the hook and waits for the first folders + assets answer. */
    async function mounted() {
        const { queryClient, wrapper } = harness();
        const { result, rerender } = renderHook(() => useMediaLibrary(), {
            wrapper
        });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        return { queryClient, result, rerender };
    }

    /** Selects two of the three assets on the loaded page. */
    function selectTwo(select: (id: string) => void) {
        act(() => {
            select('a-1');
            select('a-2');
        });
    }

    // The six controls that change *which* assets are listed. Each is given
    // the hook's current store, so the callback identity is always fresh.
    const CONTROLS: [
        string,
        (store: ReturnType<typeof useMediaLibrary>) => void
    ][] = [
        ['page', (store) => store.setPage(2)],
        ['page size', (store) => store.setPageSize(48)],
        ['search', (store) => store.setSearch('logo')],
        ['kind filter', (store) => store.setKindFilter('video')],
        ['sort', (store) => store.setSort(MEDIA_SORT.Oldest)],
        ['folder', (store) => store.navigateTo('folder-1')]
    ];

    // covers: media:I-37
    it.each(CONTROLS)(
        'clears the selection when the %s changes',
        async (_label, change) => {
            const { result } = await mounted();

            selectTwo(result.current.toggleSelect);
            // The fixture has to start armed, or "cleared" is indistinguishable
            // from "never set".
            expect(result.current.selectedIds.size).toBe(2);
            expect(result.current.selectedAssets).toHaveLength(2);

            act(() => change(result.current));

            expect(result.current.selectedIds.size).toBe(0);
            expect(result.current.selectedAssets).toEqual([]);
        }
    );

    // covers: media:I-37
    it('pulls the page back into range when the result shrank under it', async () => {
        const { result } = await mounted();

        // 90 assets at 24 a page is four pages; sit on the third.
        expect(result.current.pageCount).toBe(4);
        act(() => result.current.setPage(3));
        await waitFor(() => expect(result.current.isRefreshing).toBe(false));
        expect(result.current.page).toBe(3);

        // Someone deletes most of the folder — one page left, and the pager is
        // two pages past the end of it.
        total = 24;
        act(() => result.current.reload());

        await waitFor(() => expect(result.current.pageCount).toBe(1));
        await waitFor(() => expect(result.current.page).toBe(1));
    });

    // covers: media:I-37
    it('leaves the page alone while the result still reaches it', async () => {
        // The other direction: a clamp that fired on any refetch would drag a
        // reader off page 3 every time the library refreshed.
        const { result } = await mounted();

        act(() => result.current.setPage(3));
        await waitFor(() => expect(result.current.isRefreshing).toBe(false));

        act(() => result.current.reload());
        await waitFor(() => expect(result.current.isRefreshing).toBe(false));

        expect(result.current.page).toBe(3);
    });

    // covers: media:I-36
    it('starts no query at all while the reader has no media:read', async () => {
        // `enabled` is the page's `useHasPermission('media:read')`. A gate that
        // only hid the results would still send both requests and have them
        // 403 — a reader who cannot browse the library must not be the reason
        // the server logs a pair of refusals per page view.
        const { wrapper } = harness();
        const { result } = renderHook(() => useMediaLibrary(false), {
            wrapper
        });

        await waitFor(() => expect(result.current.isLoading).toBe(true));

        expect(listFolders).not.toHaveBeenCalled();
        expect(listAssets).not.toHaveBeenCalled();
    });

    /**
     * The workspace reaches the server as an ambient `X-Workspace-Id` header,
     * which is never sent on a cache hit. A key without the id would therefore
     * serve the previous workspace's folders and assets and never refetch —
     * a cross-tenant read that looks exactly like a fast one.
     */
    describe('cache keys', () => {
        const keysIn = (queryClient: QueryClient): QueryKey[] =>
            queryClient
                .getQueryCache()
                .getAll()
                .map((query) => query.queryKey);

        // covers: media:I-40
        it('carry the workspace id, every one of them', async () => {
            const { queryClient } = await mounted();

            const keys = keysIn(queryClient);
            // Folders and the open folder's assets — a cache with one entry
            // would leave half the claim untested.
            expect(keys.length).toBeGreaterThanOrEqual(2);
            for (const key of keys) {
                expect(key).toContain('ws-alpha');
            }
        });

        // covers: media:I-40
        it('never let a second workspace land on the first one’s entry', async () => {
            const { queryClient, result, rerender } = await mounted();
            const before = keysIn(queryClient).map((key) =>
                JSON.stringify(key)
            );

            workspaceId = 'ws-beta';
            rerender();
            await waitFor(() =>
                expect(result.current.isRefreshing).toBe(false)
            );

            const after = keysIn(queryClient).map((key) => JSON.stringify(key));
            // Every key the first workspace made is still there, and the
            // second made its own — nothing was reused.
            expect(after).toEqual(expect.arrayContaining(before));
            expect(after.length).toBeGreaterThan(before.length);
            for (const key of keysIn(queryClient)) {
                expect(
                    key.includes('ws-alpha') || key.includes('ws-beta')
                ).toBe(true);
            }
        });
    });
});
