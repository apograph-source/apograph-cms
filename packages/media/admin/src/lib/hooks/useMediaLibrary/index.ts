import { useCallback, useEffect, useMemo, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    keepPreviousData,
    useMutation,
    useQuery,
    useQueryClient
} from '@tanstack/react-query';
import { toast } from '@orthacms/design-system';
import { useDebouncedValue } from '@orthacms/utils-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import {
    DEFAULT_ASSETS_PAGE_SIZE,
    KIND_FILTER_ALL,
    MEDIA_SORT,
    ROOT_FOLDER_ID,
    SEARCH_DEBOUNCE_MS,
    type MediaKind,
    type MediaSort
} from '../../constants';
import type { MediaFolder } from '../../types/mediaFolder';
import { mediaKeys } from '../../infrastructure/mediaKeys';
import { httpMediaGateway } from '../../infrastructure/httpMediaGateway';
import { apiMessage } from '../../infrastructure/apiMessage';
import { useUploadQueue } from '../useUploadQueue';

/** The selected kind filter — a {@link MediaKind} or the "all" sentinel. */
export type KindFilter = MediaKind | typeof KIND_FILTER_ALL;

/** Per-surface tuning for {@link useMediaLibrary}. */
export type MediaLibraryOptions = {
    /**
     * Assets per request. The library page lets the user choose; a surface with
     * no pager of its own (the picker dialog) passes a large one and browses by
     * searching instead.
     */
    pageSize?: number;
};

/**
 * Resolves a mutation to whether it **succeeded**, so a caller can hold its
 * confirmation until the server has agreed.
 *
 * Every action below returns this. Firing a success toast at dispatch time is
 * what produced "Renamed to “a/b.txt”" beside "Request failed with status code
 * 400" on the same screen: the rejection is already handled by `onError`, so
 * the failure branch here only has to swallow it.
 */
function settle(promise: Promise<unknown>): Promise<boolean> {
    return promise.then(
        () => true,
        () => false
    );
}

/** Intl descriptor for a failed media mutation. */
const messages = defineMessages({
    error: {
        id: 'media.error.mutation',
        defaultMessage: 'Something went wrong. Please try again.'
    }
});

/**
 * The Media Library's data layer and every action the UI can take. Folders and
 * the open folder's assets are fetched from `@orthacms/media-server` via the
 * gateway (TanStack Query); mutations post to the API and invalidate the cache.
 * View/search/sort/filter/selection/navigation stay local UI state. The returned
 * shape mirrors the former mock store exactly, so no component changed.
 *
 * @param enabled - gates the reads (false until the caller confirms `media:read`).
 */
export function useMediaLibrary(
    enabled = true,
    {
        pageSize: initialPageSize = DEFAULT_ASSETS_PAGE_SIZE
    }: MediaLibraryOptions = {}
) {
    const intl = useIntl();
    const workspaceId = useCurrentWorkspace().id;
    const queryClient = useQueryClient();

    const [currentFolderId, setCurrentFolderId] = useState(ROOT_FOLDER_ID);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(
        () => new Set()
    );
    const [search, setSearchState] = useState('');
    const [sort, setSortState] = useState<MediaSort>(MEDIA_SORT.Newest);
    const [kindFilter, setKindFilterState] =
        useState<KindFilter>(KIND_FILTER_ALL);
    const [detailAssetId, setDetailAssetId] = useState<string | null>(null);
    const [page, setPageState] = useState(1);
    const [pageSize, setPageSizeState] = useState(initialPageSize);

    // The box updates on every keystroke; the request waits for a pause. Search
    // is a round trip now, so without this every letter typed is a query — and
    // the results would flicker through the prefixes on the way to the word.
    const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

    const foldersQuery = useQuery({
        queryKey: mediaKeys.folders(workspaceId),
        queryFn: () => httpMediaGateway.listFolders(),
        enabled
    });
    // Everything the server filters, orders and pages by, in one object — used
    // as both the request and the cache key, so the two cannot disagree.
    const listParams = useMemo(
        () => ({
            search: debouncedSearch.trim(),
            kind: kindFilter,
            sort,
            page,
            pageSize
        }),
        [debouncedSearch, kindFilter, sort, page, pageSize]
    );

    const assetsQuery = useQuery({
        queryKey: mediaKeys.assets(workspaceId, currentFolderId, listParams),
        queryFn: () =>
            httpMediaGateway.listAssets({
                folderId: currentFolderId,
                ...listParams
            }),
        // Paging without this blanks the grid between pages, which on a fast
        // connection reads as a flicker and on a slow one as a broken folder.
        placeholderData: keepPreviousData,
        enabled
    });

    const folders = useMemo(
        () => foldersQuery.data?.folders ?? [],
        [foldersQuery.data]
    );
    /** The assets on the open page — already searched, filtered and sorted. */
    const assets = useMemo(
        () => assetsQuery.data?.items ?? [],
        [assetsQuery.data]
    );
    /** How many assets match across the whole folder, not just this page. */
    const total = assetsQuery.data?.total ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const folderCounts = useMemo(
        () => foldersQuery.data?.folderCounts ?? new Map<string, number>(),
        [foldersQuery.data]
    );

    /** Refetch folders + the visible assets after any mutation. */
    const invalidate = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: mediaKeys.all(workspaceId) });
    }, [queryClient, workspaceId]);

    /**
     * Surfaces a mutation failure and resyncs from the server. The API's own
     * sentence wins over our generic copy — `apiMessage` reads it off the
     * response body, because `ApiError.message` is only the transport's
     * "Request failed with status code 400".
     */
    const onError = useCallback(
        (error: unknown) => {
            toast.error(
                apiMessage(error) ?? intl.formatMessage(messages.error)
            );
            invalidate();
        },
        [intl, invalidate]
    );

    /** The open folder record, or `null` at the synthetic root. */
    const currentFolder = useMemo(
        () => folders.find((f) => f.id === currentFolderId) ?? null,
        [folders, currentFolderId]
    );

    /** Ancestor chain (root → current), used by the breadcrumbs. */
    const breadcrumbs = useMemo(() => {
        const chain: MediaFolder[] = [];
        let cursor = currentFolder;
        while (cursor) {
            chain.unshift(cursor);
            const parentId = cursor.parentId;
            cursor =
                parentId === ROOT_FOLDER_ID
                    ? null
                    : (folders.find((f) => f.id === parentId) ?? null);
        }
        return chain;
    }, [currentFolder, folders]);

    /** Folders directly inside the open folder. */
    const childFolders = useMemo(
        () =>
            folders
                .filter((f) => f.parentId === currentFolderId)
                .sort((a, b) => a.name.localeCompare(b.name)),
        [folders, currentFolderId]
    );

    /**
     * The assets to draw. The server has already searched, filtered, sorted and
     * paged them, so this is the page as it came back.
     *
     * It used to be a `filter` + `sort` over one fixed page of 100, which is
     * what made "oldest first" return the newest hundred in ascending order and
     * let a search miss a file that plainly existed. Neither is fixable in the
     * browser: the answer depends on rows the browser was never sent.
     */
    const visibleAssets = assets;

    /** The asset backing the detail drawer, if open. */
    const detailAsset = useMemo(
        () => assets.find((a) => a.id === detailAssetId) ?? null,
        [assets, detailAssetId]
    );

    /** Currently selected assets (within the open folder). */
    const selectedAssets = useMemo(
        () => assets.filter((a) => selectedIds.has(a.id)),
        [assets, selectedIds]
    );

    const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

    /**
     * Moves to another page, and drops the selection with it.
     *
     * A selection that outlived the page it was made on would be invisible and
     * still armed: the bar counts only what is on screen (`selectedAssets` is
     * derived from the loaded page), so ids left behind on page 1 would vanish
     * from the count on page 2 and silently return later — and Delete would
     * take files the user could not see. Every control that changes *which*
     * assets are listed clears it, for the same reason.
     */
    const setPage = useCallback(
        (next: number) => {
            setPageState(next);
            clearSelection();
        },
        [clearSelection]
    );

    /** Re-pages the listing from the top; a new size makes old page numbers meaningless. */
    const setPageSize = useCallback(
        (next: number) => {
            setPageSizeState(next);
            setPageState(1);
            clearSelection();
        },
        [clearSelection]
    );

    /**
     * Narrowing the list invalidates the page you were on — page 4 of an
     * unfiltered folder is usually past the end of the filtered one, and the
     * user would land on an empty grid having just typed a search that matches.
     */
    const setSearch = useCallback(
        (next: string) => {
            setSearchState(next);
            setPageState(1);
            clearSelection();
        },
        [clearSelection]
    );
    const setKindFilter = useCallback(
        (next: KindFilter) => {
            setKindFilterState(next);
            setPageState(1);
            clearSelection();
        },
        [clearSelection]
    );
    /** Re-orders the whole result set, so page 2 is a different two dozen assets. */
    const setSort = useCallback(
        (next: MediaSort) => {
            setSortState(next);
            setPageState(1);
            clearSelection();
        },
        [clearSelection]
    );

    /** Navigate into a folder (or root), back to page 1, dropping the selection. */
    const navigateTo = useCallback(
        (folderId: string) => {
            setCurrentFolderId(folderId);
            setPageState(1);
            clearSelection();
        },
        [clearSelection]
    );

    /**
     * Pulls the page back into range when the result set shrinks under it.
     *
     * Deleting the last three assets on page 5, or a search narrowing to two
     * pages, otherwise leaves the pager on a page the server answers with an
     * empty `items` — a folder that reads as empty while its own header says it
     * holds ninety files. Guarded on `isFetching` so it settles on the response
     * rather than on the stale `keepPreviousData` total mid-flight.
     */
    useEffect(() => {
        if (assetsQuery.isFetching) return;
        if (page > pageCount) setPageState(pageCount);
    }, [page, pageCount, assetsQuery.isFetching]);

    const toggleSelect = useCallback((id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const openDetail = useCallback((id: string) => setDetailAssetId(id), []);
    const closeDetail = useCallback(() => setDetailAssetId(null), []);

    // --- Mutations (post to the API, then invalidate the cache) ---------------

    const createFolderM = useMutation({
        mutationFn: httpMediaGateway.createFolder,
        onSuccess: invalidate,
        onError
    });
    const renameFolderM = useMutation({
        mutationFn: httpMediaGateway.renameFolder,
        onSuccess: invalidate,
        onError
    });
    const deleteFolderM = useMutation({
        mutationFn: httpMediaGateway.deleteFolder,
        onSuccess: invalidate,
        onError
    });
    const renameAssetM = useMutation({
        mutationFn: httpMediaGateway.renameAsset,
        onSuccess: invalidate,
        onError
    });
    const moveAssetsM = useMutation({
        mutationFn: httpMediaGateway.moveAssets,
        onSuccess: invalidate,
        onError
    });
    const duplicateAssetsM = useMutation({
        mutationFn: httpMediaGateway.duplicateAssets,
        onSuccess: invalidate,
        onError
    });
    const deleteAssetsM = useMutation({
        mutationFn: httpMediaGateway.deleteAssets,
        onSuccess: invalidate,
        onError
    });
    const updateAssetM = useMutation({
        mutationFn: httpMediaGateway.updateAsset,
        onSuccess: invalidate,
        onError
    });
    // Uploads don't go through `useMutation`: the banner needs per-file progress
    // and independent per-file failure, which a single mutation can't express.
    const uploads = useUploadQueue(currentFolderId, invalidate);

    const createFolder = useCallback(
        (name: string, parentId: string = currentFolderId) =>
            settle(createFolderM.mutateAsync({ name, parentId })),
        [createFolderM, currentFolderId]
    );
    const renameFolder = useCallback(
        (id: string, name: string) =>
            settle(renameFolderM.mutateAsync({ id, name })),
        [renameFolderM]
    );
    const deleteFolder = useCallback(
        (id: string) => settle(deleteFolderM.mutateAsync(id)),
        [deleteFolderM]
    );
    const renameAsset = useCallback(
        (id: string, name: string) =>
            settle(renameAssetM.mutateAsync({ id, name })),
        [renameAssetM]
    );
    const setAssetAlt = useCallback(
        (id: string, alt: string) =>
            settle(updateAssetM.mutateAsync({ id, alt })),
        [updateAssetM]
    );
    const moveAssets = useCallback(
        (ids: string[], folderId: string) =>
            settle(moveAssetsM.mutateAsync({ ids, folderId })),
        [moveAssetsM]
    );
    const duplicateAssets = useCallback(
        (ids: string[]) => settle(duplicateAssetsM.mutateAsync(ids)),
        [duplicateAssetsM]
    );
    const deleteAssets = useCallback(
        (ids: string[]) => {
            const done = settle(deleteAssetsM.mutateAsync(ids));
            // Drop them from the selection; the drawer closes on its own once the
            // refetch removes the row (detailAsset derives to null).
            setSelectedIds((prev) => {
                const next = new Set(prev);
                ids.forEach((id) => next.delete(id));
                return next;
            });
            return done;
        },
        [deleteAssetsM]
    );
    const uploadFiles = uploads.enqueue;

    return {
        // data
        folders,
        assets,
        currentFolderId,
        currentFolder,
        breadcrumbs,
        childFolders,
        visibleAssets,
        folderCounts,
        // paging
        total,
        page,
        pageCount,
        pageSize,
        setPage,
        setPageSize,
        // load state
        isLoading: foldersQuery.isPending || assetsQuery.isPending,
        /**
         * True while the grid on screen is not yet the answer to the controls
         * as they now read — the debounce window, then the request.
         *
         * `isFetching` alone is a poor cue for a search box: it only goes true
         * *after* the debounce commits, so for the first 300ms of typing
         * nothing visible happens at all and the old results sit there looking
         * like the new ones. Or-ing in the un-committed keystrokes is what
         * makes the grid say "not this, yet" from the first letter.
         */
        isRefreshing:
            assetsQuery.isFetching || search.trim() !== debouncedSearch.trim(),
        isError: foldersQuery.isError || assetsQuery.isError,
        reload: invalidate,
        // selection
        selectedIds,
        selectedAssets,
        toggleSelect,
        clearSelection,
        // detail drawer
        detailAsset,
        openDetail,
        closeDetail,
        // browse controls
        search,
        setSearch,
        sort,
        setSort,
        kindFilter,
        setKindFilter,
        // navigation
        navigateTo,
        // mutations
        createFolder,
        renameFolder,
        renameAsset,
        setAssetAlt,
        deleteAssets,
        deleteFolder,
        duplicateAssets,
        moveAssets,
        uploadFiles,
        // upload queue (progress banner)
        uploadItems: uploads.items,
        uploadSummary: uploads.summary,
        retryUpload: uploads.retry,
        cancelUpload: uploads.cancel,
        dismissUploads: uploads.dismissSettled
    };
}

/** The full store + actions returned by {@link useMediaLibrary}. */
export type MediaLibraryStore = ReturnType<typeof useMediaLibrary>;
