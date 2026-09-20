import { useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    ConfirmDialog,
    Drawer,
    DrawerContent,
    DrawerTitle,
    cn,
    toast
} from '@orthacms/design-system';
import { PanelLeft } from 'lucide-react';
import { useHasPermission } from '@orthacms/identity-admin';
import {
    MEDIA_CREATE,
    MEDIA_DELETE,
    MEDIA_READ,
    MEDIA_UPDATE,
    ROOT_FOLDER_ID
} from '../../constants';
import { useMediaLibrary } from '../../hooks/useMediaLibrary';
import type { MediaAsset } from '../../types/mediaAsset';
import type { MediaFolder } from '../../types/mediaFolder';
import type { AssetActionKind } from '../../components/AssetActionsMenu';
import { MediaFoldersNav } from '../../components/MediaFoldersNav';
import { MediaTopBar } from '../../components/MediaTopBar';
import { MediaToolbar } from '../../components/MediaToolbar';
import { MediaSelectionBar } from '../../components/MediaSelectionBar';
import { MediaUploadBanner } from '../../components/MediaUploadBanner';
import { MediaGrid } from '../../components/MediaGrid';
import { MediaPagination } from '../../components/MediaPagination';
import { MediaEmptyState } from '../../components/MediaEmptyState';
import { AssetDetailDrawer } from '../../components/AssetDetailDrawer';
import { NewFolderDialog } from '../../components/NewFolderDialog';
import { RenameDialog } from '../../components/RenameDialog';
import { MoveAssetsDialog } from '../../components/MoveAssetsDialog';
import { UploadDialog } from '../../components/UploadDialog';
import { folderContents } from '../../utils/folderContents';
import { useDocumentTitle } from '@orthacms/utils-admin';

/** Intl descriptors for the Media Library page + its toasts, co-located. */
const messages = defineMessages({
    title: { id: 'media.page.title', defaultMessage: 'Media Library' },
    subtitle: {
        id: 'media.page.subtitle',
        defaultMessage:
            '{count, plural, one {# item} other {# items}} in {location}'
    },
    allMedia: { id: 'media.page.allMedia', defaultMessage: 'All media' },
    noAccess: {
        id: 'media.page.noAccess',
        defaultMessage: 'You don’t have permission to view the media library.'
    },
    loadError: {
        id: 'media.page.loadError',
        defaultMessage: 'We couldn’t load the media library.'
    },
    retry: { id: 'media.page.retry', defaultMessage: 'Try again' },
    openNav: { id: 'media.page.openNav', defaultMessage: 'Folders' },
    navTitle: {
        id: 'media.page.navTitle',
        defaultMessage: 'Folder navigation'
    },
    selection: {
        id: 'media.page.selection',
        defaultMessage:
            '{count, plural, =0 {No items selected} one {# item selected} other {# items selected}}'
    },
    deleteAssetsTitle: {
        id: 'media.page.deleteAssetsTitle',
        defaultMessage: 'Delete {count, plural, one {# item} other {# items}}?'
    },
    deleteAssetsBody: {
        id: 'media.page.deleteAssetsBody',
        defaultMessage:
            'This can’t be undone. The selected assets will be permanently removed.'
    },
    deleteFolderTitle: {
        id: 'media.page.deleteFolderTitle',
        defaultMessage: 'Delete “{name}”?'
    },
    deleteFolderTitleFull: {
        id: 'media.page.deleteFolderTitleFull',
        defaultMessage: 'Delete “{name}” and everything inside?'
    },
    deleteFolderBody: {
        id: 'media.page.deleteFolderBody',
        defaultMessage:
            'This folder is empty. It will be permanently removed — this can’t be undone.'
    },
    /**
     * Names exactly what goes with the folder. Both counts are always spelled
     * out (`=0` included) so the sentence reads the same shape however the
     * folder is filled, and nobody has to infer that "3 assets" also means the
     * subfolders they sit in.
     */
    deleteFolderBodyFull: {
        id: 'media.page.deleteFolderBodyFull',
        defaultMessage:
            'Deleting it also deletes {assets, plural, =0 {no assets} one {# asset} other {# assets}} and {folders, plural, =0 {no subfolders} one {# subfolder} other {# subfolders}} inside it. This can’t be undone.'
    },
    confirmDelete: { id: 'media.page.confirmDelete', defaultMessage: 'Delete' },
    // toasts
    tCreated: {
        id: 'media.page.toast.created',
        defaultMessage: 'Folder “{name}” created'
    },
    tRenamed: {
        id: 'media.page.toast.renamed',
        defaultMessage: 'Renamed to “{name}”'
    },
    tDuplicated: {
        id: 'media.page.toast.duplicated',
        defaultMessage:
            '{count, plural, one {# asset duplicated} other {# assets duplicated}}'
    },
    tMoved: {
        id: 'media.page.toast.moved',
        defaultMessage:
            '{count, plural, one {# asset moved} other {# assets moved}}'
    },
    tDeletedAssets: {
        id: 'media.page.toast.deletedAssets',
        defaultMessage:
            '{count, plural, one {# asset deleted} other {# assets deleted}}'
    },
    tDeletedFolder: {
        id: 'media.page.toast.deletedFolder',
        defaultMessage: 'Folder “{name}” deleted'
    },
    tDownload: {
        id: 'media.page.toast.download',
        defaultMessage: 'Downloading “{name}”'
    },
    tCopied: {
        id: 'media.page.toast.copied',
        defaultMessage: 'Link copied to clipboard'
    },
    tCopyFailed: {
        id: 'media.page.toast.copyFailed',
        defaultMessage: 'Couldn’t copy the link'
    },
    tAltSaved: {
        id: 'media.page.toast.altSaved',
        defaultMessage: 'Alt text saved'
    },
    assetsRegion: { id: 'media.page.assetsRegion', defaultMessage: 'Assets' }
});

/**
 * How long a confirmed delete keeps trying to hold focus on the grid.
 *
 * Two overlays unwind after a delete and each restores focus to its own
 * trigger, both of which sat on the tile that just went away — so whichever
 * settles last can drop focus on `<body>` well after the dialog closed. The
 * window is generous because that timing moves with machine load; nothing is
 * taken from a control the user actually focused, so a long window costs
 * nothing.
 */
const FOCUS_RECLAIM_MS = 1_000;

/** A pending rename, tagged by whether it targets an asset or a folder. */
type RenameTarget =
    | { kind: 'asset'; id: string; name: string }
    | { kind: 'folder'; id: string; name: string };

/** A pending delete awaiting confirmation. */
type DeleteTarget =
    | { kind: 'assets'; ids: string[] }
    | { kind: 'folder'; folder: MediaFolder };

/**
 * The Media Library, mounted inside the workspace shell at
 * `/workspaces/:id/media`. `useMediaLibrary` is the store — folders and the open
 * folder's assets come from `@orthacms/media-server`, and every action (browse
 * folders, upload, create folder, rename, duplicate, move, delete, filter, sort,
 * open the detail drawer) runs against the API, firing a toast per action —
 * except uploads, whose status lives in the `MediaUploadBanner`. Controls gate
 * on the real `media:*` matrix via `useHasPermission`.
 *
 * A sticky `MediaTopBar` heads the page (the shared icon-tile + breadcrumb
 * header every admin page carries), spanning both panes. Below it sits a
 * two-pane layout — a folders sidebar beside the asset browser — plus the detail
 * drawer and the create/rename/move/upload dialogs. Both panes sit
 * **flush on the canvas** (no muted board, no bordered island), mirroring the
 * Content Library's work area: the sidebar is divided by a hairline `border-r`
 * and each pane scrolls independently. Sized with `flex-1` against the workspace
 * shell's `min-h-svh` column — NOT its own `svh` calc — so there is exactly one
 * viewport measurement in the chain; a second, independently rounded one can end
 * up a pixel taller (visible at browser zoom ≠ 100%) and give the document a
 * phantom scrollbar beside the pane's own.
 */
export function MediaLibraryPage() {
    const intl = useIntl();
    // Names this route in the tab strip, the window list, the history
    // and a screen reader's window announcement. Every private route but
    // Workspaces was still titled a bare "Admin" (WCAG 2.4.2, `ORT-140`).
    useDocumentTitle(intl.formatMessage(messages.title));
    // Mirror the server's RBAC: reads gate the queries, writes gate controls.
    const canRead = useHasPermission(MEDIA_READ);
    const canCreate = useHasPermission(MEDIA_CREATE);
    const canUpdate = useHasPermission(MEDIA_UPDATE);
    const canDelete = useHasPermission(MEDIA_DELETE);
    const store = useMediaLibrary(canRead);

    /** Focus target after a delete removes the tile whose menu opened it. */
    const gridRef = useRef<HTMLElement>(null);
    /** Set by a confirmed delete, read once by the dialog's close-focus hook. */
    const focusGridOnCloseRef = useRef(false);

    const [navOpen, setNavOpen] = useState(false);
    const [newFolderOpen, setNewFolderOpen] = useState(false);
    const [uploadOpen, setUploadOpen] = useState(false);
    const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
    const [moveIds, setMoveIds] = useState<string[] | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

    /**
     * Puts focus on the grid and **keeps** it there for a few frames.
     *
     * A delete travels through two overlays — the tile's ⋯ menu and the confirm
     * dialog — and each restores focus to its own trigger when it closes, on its
     * own schedule. Both triggers live on the tile the delete just removed, so
     * whichever lands last drops focus on `<body>`. Claiming the dialog's
     * `onCloseAutoFocus` handles one of them; this reclaims from the other,
     * bounded so it can never fight a focus the user chose themselves (it only
     * acts while nothing at all is focused).
     */
    const focusGrid = () => {
        const deadline = Date.now() + FOCUS_RECLAIM_MS;
        const reclaim = () => {
            // Re-read the ref every tick: a refetch can re-render the region.
            const grid = gridRef.current;
            if (!grid || document.activeElement === grid) return;
            const active = document.activeElement;
            // Only step in when nothing holds focus: `<body>` after a layer
            // gave up, or a node that has since left the document. A control
            // the user actually moved to is left alone.
            if (!active || active === document.body || !active.isConnected) {
                grid.focus();
            }
            if (Date.now() < deadline) window.setTimeout(reclaim, 32);
        };
        reclaim();
    };

    const locationLabel = store.currentFolder
        ? store.currentFolder.name
        : intl.formatMessage(messages.allMedia);

    const hasFilters = store.search.trim() !== '' || store.kindFilter !== 'all';

    // Sub-folders belong to the folder, not to a page of its assets, so they are
    // drawn once on the first page rather than repeating above every page of
    // files. On any later page the grid is assets alone.
    const showFolders = store.page === 1;
    const visibleFolders = showFolders ? store.childFolders : [];

    // Emptiness is now a fact about the whole folder, not about what happened to
    // load: `total` counts every asset matching the search and filter across it.
    const isEmpty = visibleFolders.length === 0 && store.total === 0;

    // Triggers a browser download for one asset (its bytes stream from the
    // `media:read`-gated raw route). Shared by the row action and bulk download.
    const downloadAsset = (asset: MediaAsset) => {
        const link = document.createElement('a');
        link.href = asset.url;
        link.download = asset.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    // A single dispatcher every card / row / drawer forwards asset actions to.
    const handleAssetAction = (kind: AssetActionKind, asset: MediaAsset) => {
        switch (kind) {
            case 'open':
                store.openDetail(asset.id);
                break;
            case 'download': {
                downloadAsset(asset);
                toast.success(
                    intl.formatMessage(messages.tDownload, { name: asset.name })
                );
                break;
            }
            case 'copyLink':
                // Confirm only once the clipboard actually took it — a denied
                // permission used to still say "Link copied".
                void navigator.clipboard
                    ?.writeText(new URL(asset.url, window.location.origin).href)
                    .then(
                        () =>
                            toast.success(intl.formatMessage(messages.tCopied)),
                        () =>
                            toast.error(
                                intl.formatMessage(messages.tCopyFailed)
                            )
                    );
                break;
            case 'duplicate': {
                void store.duplicateAssets([asset.id]).then((ok) => {
                    if (ok) {
                        toast.success(
                            intl.formatMessage(messages.tDuplicated, {
                                count: 1
                            })
                        );
                    }
                });
                break;
            }
            case 'rename':
                setRenameTarget({
                    kind: 'asset',
                    id: asset.id,
                    name: asset.name
                });
                break;
            case 'move':
                setMoveIds([asset.id]);
                break;
            case 'delete':
                setDeleteTarget({ kind: 'assets', ids: [asset.id] });
                break;
        }
    };

    const handleRenameFolder = (folder: MediaFolder) =>
        setRenameTarget({ kind: 'folder', id: folder.id, name: folder.name });

    const handleDeleteFolder = (folder: MediaFolder) =>
        setDeleteTarget({ kind: 'folder', folder });

    const submitRename = (name: string) => {
        if (!renameTarget) return;
        const done =
            renameTarget.kind === 'asset'
                ? store.renameAsset(renameTarget.id, name)
                : store.renameFolder(renameTarget.id, name);
        void done.then((ok) => {
            if (ok) {
                toast.success(intl.formatMessage(messages.tRenamed, { name }));
            }
        });
    };

    const submitMove = (folderId: string) => {
        if (!moveIds) return;
        const count = moveIds.length;
        void store.moveAssets(moveIds, folderId).then((ok) => {
            if (ok) {
                toast.success(intl.formatMessage(messages.tMoved, { count }));
            }
        });
        store.clearSelection();
    };

    const confirmDelete = () => {
        if (!deleteTarget) return;
        if (deleteTarget.kind === 'assets') {
            const count = deleteTarget.ids.length;
            void store.deleteAssets(deleteTarget.ids).then((ok) => {
                if (ok) {
                    toast.success(
                        intl.formatMessage(messages.tDeletedAssets, { count })
                    );
                }
            });
        } else {
            const name = deleteTarget.folder.name;
            void store.deleteFolder(deleteTarget.folder.id).then((ok) => {
                if (ok) {
                    toast.success(
                        intl.formatMessage(messages.tDeletedFolder, { name })
                    );
                }
            });
        }
        setDeleteTarget(null);
        // The dialog restores focus to whatever opened it — a tile's ⋯ trigger
        // the delete is about to remove from the DOM, leaving focus on `<body>`.
        // Claim the close so it lands on the grid instead. Cancelling leaves the
        // flag false, so the trigger (which still exists) keeps focus.
        focusGridOnCloseRef.current = true;
    };

    // What the pending folder delete would take with it, so the confirmation
    // can say so — a folder delete cascades now, and an unqualified "Delete?"
    // over a populated tree is the kind of prompt people regret answering.
    const doomed =
        deleteTarget?.kind === 'folder'
            ? folderContents(
                  store.folders,
                  store.folderCounts,
                  deleteTarget.folder.id
              )
            : null;
    const isEmptyFolder = !!doomed && !doomed.assets && !doomed.folders;

    const selectedIds = store.selectedAssets.map((asset) => asset.id);

    if (!canRead) {
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
                <p className="max-w-sm text-sm text-muted-foreground">
                    {intl.formatMessage(messages.noAccess)}
                </p>
            </div>
        );
    }

    // A failed load gets its own state with a retry — never the empty state,
    // which would misread a server error as "this folder is empty".
    if (store.isError) {
        return (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                <p
                    className="max-w-sm text-sm text-muted-foreground"
                    role="alert"
                >
                    {intl.formatMessage(messages.loadError)}
                </p>
                <Button variant="outline" onClick={store.reload}>
                    {intl.formatMessage(messages.retry)}
                </Button>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <MediaTopBar
                breadcrumbs={store.breadcrumbs}
                onNavigate={store.navigateTo}
            />

            <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
                <div className="border-b p-3 lg:hidden">
                    <Button
                        variant="outline"
                        size="sm"
                        className="shadow-none"
                        onClick={() => setNavOpen(true)}
                    >
                        <PanelLeft aria-hidden />
                        {intl.formatMessage(messages.openNav)}
                    </Button>
                </div>

                <MediaFoldersNav
                    className="hidden lg:flex lg:border-r"
                    folders={store.folders}
                    currentFolderId={store.currentFolderId}
                    counts={store.folderCounts}
                    rootCount={store.folderCounts.get(ROOT_FOLDER_ID) ?? 0}
                    onNavigate={store.navigateTo}
                    onNewFolder={() => setNewFolderOpen(true)}
                    canCreate={canCreate}
                />

                {/* A `div`, not a `main`: the host shell already renders the
                    page's one `<main id="main-content">` and this sits inside
                    it, so a second one gave the document two "main content"
                    landmarks — neither of which is the page. "Jump to main"
                    then lands somewhere arbitrary. Caught by
                    `landmark-no-duplicate-main` once admin-e2e's axe fixture
                    stopped omitting the whole `best-practice` ruleset. */}
                <div className="min-w-0 flex-1 overflow-auto">
                    <div className="p-4 sm:p-6">
                        <div className="mb-4">
                            <h1 className="text-2xl font-semibold tracking-[-0.01em]">
                                {store.currentFolder
                                    ? store.currentFolder.name
                                    : intl.formatMessage(messages.title)}
                            </h1>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                                {intl.formatMessage(messages.subtitle, {
                                    count: store.total,
                                    location: locationLabel
                                })}
                            </p>
                        </div>

                        <MediaToolbar
                            search={store.search}
                            onSearchChange={store.setSearch}
                            kindFilter={store.kindFilter}
                            onKindFilterChange={store.setKindFilter}
                            sort={store.sort}
                            onSortChange={store.setSort}
                            onNewFolder={() => setNewFolderOpen(true)}
                            onUpload={() => setUploadOpen(true)}
                            canCreate={canCreate}
                        />

                        <p className="sr-only" aria-live="polite">
                            {intl.formatMessage(messages.selection, {
                                count: selectedIds.length
                            })}
                        </p>

                        <MediaUploadBanner
                            items={store.uploadItems}
                            summary={store.uploadSummary}
                            onRetry={store.retryUpload}
                            onCancel={store.cancelUpload}
                            onDismiss={store.dismissUploads}
                        />

                        {selectedIds.length > 0 ? (
                            <MediaSelectionBar
                                count={selectedIds.length}
                                onDownload={() => {
                                    store.selectedAssets.forEach(downloadAsset);
                                    toast.success(
                                        intl.formatMessage(messages.tDownload, {
                                            name: `${selectedIds.length} files`
                                        })
                                    );
                                }}
                                onDuplicate={() => {
                                    const count = selectedIds.length;
                                    void store
                                        .duplicateAssets(selectedIds)
                                        .then((ok) => {
                                            if (ok) {
                                                toast.success(
                                                    intl.formatMessage(
                                                        messages.tDuplicated,
                                                        { count }
                                                    )
                                                );
                                            }
                                        });
                                }}
                                onMove={() => setMoveIds(selectedIds)}
                                onDelete={() =>
                                    setDeleteTarget({
                                        kind: 'assets',
                                        ids: selectedIds
                                    })
                                }
                                onClear={store.clearSelection}
                                canCreate={canCreate}
                                canUpdate={canUpdate}
                                canDelete={canDelete}
                            />
                        ) : null}

                        {/* Focusable (but not tab-stop) so a destructive action
                            can hand focus back to the content it changed. */}
                        {/* Dimmed and `aria-busy` while the grid is answering
                            an older set of controls than the ones on screen —
                            searching and paging are round trips now, and
                            `keepPreviousData` deliberately leaves the previous
                            page up rather than blanking it. Without this the
                            stale results are indistinguishable from the new
                            ones. Opacity rather than a spinner in place of the
                            grid, so nothing moves and the tiles stay clickable
                            for the moment they remain correct. */}
                        <section
                            ref={gridRef}
                            tabIndex={-1}
                            aria-label={intl.formatMessage(
                                messages.assetsRegion
                            )}
                            aria-busy={store.isRefreshing}
                            className={cn(
                                'transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                store.isRefreshing && 'opacity-60'
                            )}
                        >
                            {isEmpty ? (
                                <MediaEmptyState
                                    hasFilters={hasFilters}
                                    canCreate={canCreate}
                                    onUpload={() => setUploadOpen(true)}
                                    onClearFilters={() => {
                                        store.setSearch('');
                                        store.setKindFilter('all');
                                    }}
                                />
                            ) : (
                                <MediaGrid
                                    folders={visibleFolders}
                                    assets={store.visibleAssets}
                                    folderCounts={store.folderCounts}
                                    selectedIds={store.selectedIds}
                                    onOpenFolder={store.navigateTo}
                                    onRenameFolder={handleRenameFolder}
                                    onDeleteFolder={handleDeleteFolder}
                                    onToggleSelect={store.toggleSelect}
                                    onAssetAction={handleAssetAction}
                                    canCreate={canCreate}
                                    canUpdate={canUpdate}
                                    canDelete={canDelete}
                                />
                            )}
                        </section>

                        {/* Keyed off the assets, not off emptiness: a folder
                            holding only sub-folders is not empty, and a pager
                            reading "0–0 of 0" under it says nothing. */}
                        {store.total > 0 ? (
                            <MediaPagination
                                page={store.page}
                                pageCount={store.pageCount}
                                pageSize={store.pageSize}
                                total={store.total}
                                onPageChange={store.setPage}
                                onPageSizeChange={store.setPageSize}
                            />
                        ) : null}
                    </div>
                </div>
            </div>

            {/* Mobile-only folder navigation, mirroring the inline sidebar. */}
            <Drawer
                direction="left"
                open={navOpen}
                onOpenChange={setNavOpen}
                shouldScaleBackground={false}
            >
                <DrawerContent className="data-[vaul-drawer-direction=left]:w-72">
                    <DrawerTitle className="sr-only">
                        {intl.formatMessage(messages.navTitle)}
                    </DrawerTitle>
                    <MediaFoldersNav
                        className="w-full"
                        folders={store.folders}
                        currentFolderId={store.currentFolderId}
                        counts={store.folderCounts}
                        rootCount={store.folderCounts.get(ROOT_FOLDER_ID) ?? 0}
                        onNavigate={(folderId) => {
                            store.navigateTo(folderId);
                            setNavOpen(false);
                        }}
                        onNewFolder={() => {
                            setNavOpen(false);
                            setNewFolderOpen(true);
                        }}
                        canCreate={canCreate}
                    />
                </DrawerContent>
            </Drawer>

            <AssetDetailDrawer
                asset={store.detailAsset}
                locationLabel={locationLabel}
                onOpenChange={(open) => {
                    if (!open) store.closeDetail();
                }}
                onAction={handleAssetAction}
                onSaveAlt={(id, alt) =>
                    store.setAssetAlt(id, alt).then((ok) => {
                        if (ok) {
                            toast.success(
                                intl.formatMessage(messages.tAltSaved)
                            );
                        }
                        return ok;
                    })
                }
                canCreate={canCreate}
                canUpdate={canUpdate}
                canDelete={canDelete}
            />

            <NewFolderDialog
                open={newFolderOpen}
                onOpenChange={setNewFolderOpen}
                locationLabel={locationLabel}
                onCreate={(name) => {
                    void store.createFolder(name).then((ok) => {
                        if (ok) {
                            toast.success(
                                intl.formatMessage(messages.tCreated, { name })
                            );
                        }
                    });
                }}
            />

            <UploadDialog
                open={uploadOpen}
                onOpenChange={setUploadOpen}
                locationLabel={locationLabel}
                // No toast here: the upload has only been *queued*. Progress and
                // the per-file outcome are the banner's job — a success toast
                // fired at submit time would claim a result nobody has yet.
                onUpload={store.uploadFiles}
                // The library's queue forwards alt to the API, so this is the
                // one caller that may ask the author to describe the image.
                collectAlt
            />

            <RenameDialog
                open={renameTarget !== null}
                onOpenChange={(open) => {
                    if (!open) setRenameTarget(null);
                }}
                currentName={renameTarget?.name ?? ''}
                onRename={submitRename}
            />

            <MoveAssetsDialog
                open={moveIds !== null}
                onOpenChange={(open) => {
                    if (!open) setMoveIds(null);
                }}
                folders={store.folders}
                count={moveIds?.length ?? 0}
                currentFolderId={store.currentFolderId}
                onMove={submitMove}
            />

            <ConfirmDialog
                open={deleteTarget !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteTarget(null);
                }}
                title={
                    deleteTarget?.kind === 'folder'
                        ? intl.formatMessage(
                              isEmptyFolder
                                  ? messages.deleteFolderTitle
                                  : messages.deleteFolderTitleFull,
                              { name: deleteTarget.folder.name }
                          )
                        : intl.formatMessage(messages.deleteAssetsTitle, {
                              count:
                                  deleteTarget?.kind === 'assets'
                                      ? deleteTarget.ids.length
                                      : 0
                          })
                }
                description={
                    deleteTarget?.kind === 'folder'
                        ? isEmptyFolder
                            ? intl.formatMessage(messages.deleteFolderBody)
                            : intl.formatMessage(
                                  messages.deleteFolderBodyFull,
                                  {
                                      assets: doomed?.assets ?? 0,
                                      folders: doomed?.folders ?? 0
                                  }
                              )
                        : intl.formatMessage(messages.deleteAssetsBody)
                }
                confirmLabel={intl.formatMessage(messages.confirmDelete)}
                confirmVariant="destructive"
                onCloseAutoFocus={(event) => {
                    if (!focusGridOnCloseRef.current) return;
                    focusGridOnCloseRef.current = false;
                    event.preventDefault();
                    focusGrid();
                }}
                onConfirm={confirmDelete}
            />
        </div>
    );
}
