import { useMemo, useState } from 'react';
import { defineMessages, useIntl, type MessageDescriptor } from 'react-intl';
import { FileSearch, Folder, Search, TriangleAlert } from 'lucide-react';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    InputGroup,
    InputGroupAddon,
    InputGroupInput,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Skeleton
} from '@orthacms/design-system';
import {
    KIND_FILTER_ALL,
    MEDIA_KIND,
    MEDIA_SORT,
    PICKER_ASSETS_PAGE_SIZE,
    ROOT_FOLDER_ID,
    type MediaKind,
    type MediaSort
} from '../../constants';
import { useMediaLibrary, type KindFilter } from '../../hooks/useMediaLibrary';
import type { MediaAsset } from '../../types/mediaAsset';
import { acceptsAsset, type MediaAccept } from '../../utils/mediaAccept';
import { MediaPickerTile } from './MediaPickerTile';

const messages = defineMessages({
    titleSingle: {
        id: 'media.picker.titleSingle',
        defaultMessage: 'Select an asset'
    },
    titleMultiple: {
        id: 'media.picker.titleMultiple',
        defaultMessage: 'Select assets'
    },
    descriptionSingle: {
        id: 'media.picker.descriptionSingle',
        defaultMessage:
            'Browse the Media Library and pick the asset for this field.'
    },
    descriptionMultiple: {
        id: 'media.picker.descriptionMultiple',
        defaultMessage:
            'Browse the Media Library and pick every asset to attach — they are added in the order you select them.'
    },
    search: { id: 'media.picker.search', defaultMessage: 'Search assets' },
    searchPlaceholder: {
        id: 'media.picker.searchPlaceholder',
        defaultMessage: 'Search name or tag…'
    },
    root: { id: 'media.picker.root', defaultMessage: 'All media' },
    breadcrumb: {
        id: 'media.picker.breadcrumb',
        defaultMessage: 'Folder path'
    },
    folders: { id: 'media.picker.folders', defaultMessage: 'Folders' },
    kindLabel: {
        id: 'media.picker.kindLabel',
        defaultMessage: 'Filter by type'
    },
    kindAll: { id: 'media.picker.kindAll', defaultMessage: 'All types' },
    kindImage: { id: 'media.picker.kindImage', defaultMessage: 'Images' },
    kindVideo: { id: 'media.picker.kindVideo', defaultMessage: 'Videos' },
    kindAudio: { id: 'media.picker.kindAudio', defaultMessage: 'Audio' },
    kindDocument: {
        id: 'media.picker.kindDocument',
        defaultMessage: 'Documents'
    },
    kindArchive: { id: 'media.picker.kindArchive', defaultMessage: 'Archives' },
    sortLabel: { id: 'media.picker.sortLabel', defaultMessage: 'Sort' },
    sortNewest: {
        id: 'media.picker.sortNewest',
        defaultMessage: 'Newest first'
    },
    sortOldest: {
        id: 'media.picker.sortOldest',
        defaultMessage: 'Oldest first'
    },
    sortNameAsc: { id: 'media.picker.sortNameAsc', defaultMessage: 'Name A–Z' },
    sortNameDesc: {
        id: 'media.picker.sortNameDesc',
        defaultMessage: 'Name Z–A'
    },
    emptyTitle: {
        id: 'media.picker.emptyTitle',
        defaultMessage: 'Nothing to pick here'
    },
    emptyBody: {
        id: 'media.picker.emptyBody',
        defaultMessage:
            'This folder has no asset this field accepts. Try another folder, or upload a file from the field.'
    },
    filteredTitle: {
        id: 'media.picker.filteredTitle',
        defaultMessage: 'No matching assets'
    },
    filteredBody: {
        id: 'media.picker.filteredBody',
        defaultMessage: 'Try a different search term or clear the filters.'
    },
    clear: { id: 'media.picker.clear', defaultMessage: 'Clear filters' },
    errorTitle: {
        id: 'media.picker.errorTitle',
        defaultMessage: 'Couldn’t load the library'
    },
    errorBody: {
        id: 'media.picker.errorBody',
        defaultMessage:
            'The Media Library didn’t load — this isn’t the same as having no assets. Try again, or check that you have access to it.'
    },
    retry: { id: 'media.picker.retry', defaultMessage: 'Try again' },
    cancel: { id: 'media.picker.cancel', defaultMessage: 'Cancel' },
    confirmSingle: {
        id: 'media.picker.confirmSingle',
        defaultMessage: 'Select asset'
    },
    confirmMultiple: {
        id: 'media.picker.confirmMultiple',
        defaultMessage: 'Add selected'
    },
    selected: {
        id: 'media.picker.selected',
        defaultMessage:
            '{count, plural, one {# asset selected} other {# assets selected}}'
    },
    nothingSelected: {
        id: 'media.picker.nothingSelected',
        defaultMessage: 'Nothing selected yet'
    }
});

/** The filter label for each asset kind, so the select can list only allowed ones. */
const KIND_LABEL: Record<MediaKind, MessageDescriptor> = {
    [MEDIA_KIND.Image]: messages.kindImage,
    [MEDIA_KIND.Video]: messages.kindVideo,
    [MEDIA_KIND.Audio]: messages.kindAudio,
    [MEDIA_KIND.Document]: messages.kindDocument,
    [MEDIA_KIND.Archive]: messages.kindArchive
};

/** How many placeholder tiles stand in for the first, unknown-size page. */
const SKELETON_TILES = 8;

/**
 * A modal picker over the Media Library for a content record's media field.
 * Reuses {@link useMediaLibrary} for browsing — a breadcrumb + folder chips to
 * walk the tree in **both** directions, plus search, a type filter, and a sort —
 * and narrows the candidates to the field's `accept` restriction. Single mode
 * selects exactly one (confirming on pick is avoided so the user can preview);
 * multiple accumulates a set, marking what the field already holds. Fully
 * controlled — the caller owns the field value.
 */
export function MediaPickerDialog({
    open,
    onOpenChange,
    multiple,
    accept,
    attachedIds,
    onConfirm
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    multiple: boolean;
    accept?: MediaAccept;
    /** Ids already on the field — marked in the grid so a pick isn't a duplicate. */
    attachedIds?: string[];
    onConfirm: (assets: MediaAsset[]) => void;
}) {
    const intl = useIntl();
    // No pager in this dialog: it is a picker, and the way you narrow it is by
    // typing. One large page keeps that true — and the search reaching it is now
    // the server's, so it finds a file anywhere in the folder rather than only
    // among the ones that happened to load.
    const library = useMediaLibrary(open, {
        pageSize: PICKER_ASSETS_PAGE_SIZE
    });
    const [picked, setPicked] = useState<Map<string, MediaAsset>>(new Map());

    const attached = useMemo(() => new Set(attachedIds ?? []), [attachedIds]);

    // Candidates: the folder's search/kind-filtered assets, further restricted
    // to what the field accepts (the server enforces this too, on save).
    const candidates = useMemo(
        () => library.visibleAssets.filter((a) => acceptsAsset(accept, a)),
        [library.visibleAssets, accept]
    );

    // Only the kinds this field can hold are worth filtering by; a field pinned
    // to one kind gets no select at all (it would have a single option).
    const kindOptions = useMemo<MediaKind[]>(() => {
        const all = Object.values(MEDIA_KIND);
        if (accept?.mimeTypes?.length || !accept?.kinds?.length) return all;
        const allowed = accept.kinds;
        return all.filter((kind) => allowed.includes(kind));
    }, [accept]);

    const hasFilters =
        !!library.search.trim() || library.kindFilter !== KIND_FILTER_ALL;

    const clearFilters = () => {
        library.setSearch('');
        library.setKindFilter(KIND_FILTER_ALL);
    };

    const toggle = (asset: MediaAsset) => {
        setPicked((current) => {
            const next = new Map(multiple ? current : []);
            if (next.has(asset.id)) next.delete(asset.id);
            else next.set(asset.id, asset);
            return next;
        });
    };

    const close = () => {
        setPicked(new Map());
        // A search left over from the last visit would silently hide the library
        // the next time the dialog opens.
        clearFilters();
        onOpenChange(false);
    };

    const confirm = () => {
        onConfirm([...picked.values()]);
        close();
    };

    const crumbs = [
        { id: ROOT_FOLDER_ID, name: intl.formatMessage(messages.root) },
        ...library.breadcrumbs.map((folder) => ({
            id: folder.id,
            name: folder.name
        }))
    ];
    const lastCrumb = crumbs.length - 1;

    return (
        <Dialog open={open} onOpenChange={(next) => (next ? null : close())}>
            <DialogContent className="flex max-h-[85vh] w-[min(56rem,92vw)] max-w-none flex-col gap-4 overflow-hidden">
                <DialogHeader>
                    <DialogTitle>
                        {intl.formatMessage(
                            multiple
                                ? messages.titleMultiple
                                : messages.titleSingle
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {intl.formatMessage(
                            multiple
                                ? messages.descriptionMultiple
                                : messages.descriptionSingle
                        )}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-wrap items-center gap-2">
                    <InputGroup className="w-full shadow-none sm:w-auto sm:min-w-[16rem] sm:flex-1">
                        <InputGroupAddon>
                            <Search />
                        </InputGroupAddon>
                        <InputGroupInput
                            type="search"
                            value={library.search}
                            onChange={(event) =>
                                library.setSearch(event.target.value)
                            }
                            aria-label={intl.formatMessage(messages.search)}
                            placeholder={intl.formatMessage(
                                messages.searchPlaceholder
                            )}
                        />
                    </InputGroup>

                    {kindOptions.length > 1 ? (
                        <Select
                            value={library.kindFilter}
                            onValueChange={(value) =>
                                library.setKindFilter(value as KindFilter)
                            }
                        >
                            <SelectTrigger
                                className="w-[9.5rem] shadow-none"
                                aria-label={intl.formatMessage(
                                    messages.kindLabel
                                )}
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={KIND_FILTER_ALL}>
                                    {intl.formatMessage(messages.kindAll)}
                                </SelectItem>
                                {kindOptions.map((kind) => (
                                    <SelectItem key={kind} value={kind}>
                                        {intl.formatMessage(KIND_LABEL[kind])}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : null}

                    <Select
                        value={library.sort}
                        onValueChange={(value) =>
                            library.setSort(value as MediaSort)
                        }
                    >
                        <SelectTrigger
                            className="w-[9.5rem] shadow-none"
                            aria-label={intl.formatMessage(messages.sortLabel)}
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={MEDIA_SORT.Newest}>
                                {intl.formatMessage(messages.sortNewest)}
                            </SelectItem>
                            <SelectItem value={MEDIA_SORT.Oldest}>
                                {intl.formatMessage(messages.sortOldest)}
                            </SelectItem>
                            <SelectItem value={MEDIA_SORT.NameAsc}>
                                {intl.formatMessage(messages.sortNameAsc)}
                            </SelectItem>
                            <SelectItem value={MEDIA_SORT.NameDesc}>
                                {intl.formatMessage(messages.sortNameDesc)}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Walk the tree both ways: crumbs go up, the chips below descend. */}
                <Breadcrumb
                    aria-label={intl.formatMessage(messages.breadcrumb)}
                    className="min-h-8"
                >
                    <BreadcrumbList className="text-xs">
                        {crumbs.map((crumb, index) => [
                            index > 0 ? (
                                <BreadcrumbSeparator key={`${crumb.id}-sep`} />
                            ) : null,
                            <BreadcrumbItem
                                key={crumb.id}
                                className="min-w-0 whitespace-nowrap"
                            >
                                {index === lastCrumb ? (
                                    <BreadcrumbPage className="font-medium">
                                        {crumb.name}
                                    </BreadcrumbPage>
                                ) : (
                                    <BreadcrumbLink asChild>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                library.navigateTo(crumb.id)
                                            }
                                        >
                                            {crumb.name}
                                        </button>
                                    </BreadcrumbLink>
                                )}
                            </BreadcrumbItem>
                        ])}
                    </BreadcrumbList>
                </Breadcrumb>

                <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-muted/20 p-3">
                    {library.childFolders.length > 0 ? (
                        <ul
                            aria-label={intl.formatMessage(messages.folders)}
                            className="mb-3 flex flex-wrap gap-1.5"
                        >
                            {library.childFolders.map((folder) => (
                                <li key={folder.id}>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="bg-card shadow-none"
                                        onClick={() =>
                                            library.navigateTo(folder.id)
                                        }
                                    >
                                        <Folder
                                            className="size-3.5"
                                            aria-hidden
                                        />
                                        {folder.name}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    ) : null}

                    {library.isError ? (
                        /* An error is NOT the empty state: telling someone the
                           folder has nothing they can pick, when the read
                           actually failed (or they lack `media:read`), sends
                           them off to hunt for assets that are right there. */
                        <Empty className="py-10">
                            <EmptyHeader>
                                <EmptyMedia variant="icon">
                                    <TriangleAlert aria-hidden />
                                </EmptyMedia>
                                <EmptyTitle className="text-base">
                                    {intl.formatMessage(messages.errorTitle)}
                                </EmptyTitle>
                                <EmptyDescription role="alert">
                                    {intl.formatMessage(messages.errorBody)}
                                </EmptyDescription>
                            </EmptyHeader>
                            <EmptyContent>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="shadow-none"
                                    onClick={library.reload}
                                >
                                    {intl.formatMessage(messages.retry)}
                                </Button>
                            </EmptyContent>
                        </Empty>
                    ) : library.isLoading ? (
                        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                            {Array.from(
                                { length: SKELETON_TILES },
                                (_, index) => (
                                    <li key={index}>
                                        <Skeleton className="aspect-[4/3] w-full rounded-lg" />
                                    </li>
                                )
                            )}
                        </ul>
                    ) : candidates.length === 0 ? (
                        <Empty className="py-10">
                            <EmptyHeader>
                                <EmptyMedia variant="icon">
                                    <FileSearch aria-hidden />
                                </EmptyMedia>
                                <EmptyTitle className="text-base">
                                    {intl.formatMessage(
                                        hasFilters
                                            ? messages.filteredTitle
                                            : messages.emptyTitle
                                    )}
                                </EmptyTitle>
                                <EmptyDescription>
                                    {intl.formatMessage(
                                        hasFilters
                                            ? messages.filteredBody
                                            : messages.emptyBody
                                    )}
                                </EmptyDescription>
                            </EmptyHeader>
                            {hasFilters ? (
                                <EmptyContent>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="shadow-none"
                                        onClick={clearFilters}
                                    >
                                        {intl.formatMessage(messages.clear)}
                                    </Button>
                                </EmptyContent>
                            ) : null}
                        </Empty>
                    ) : (
                        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                            {candidates.map((asset) => (
                                <li key={asset.id}>
                                    <MediaPickerTile
                                        asset={asset}
                                        picked={picked.has(asset.id)}
                                        attached={attached.has(asset.id)}
                                        onToggle={() => toggle(asset)}
                                    />
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <DialogFooter className="items-center sm:justify-between">
                    <p className="text-sm text-muted-foreground">
                        {picked.size > 0
                            ? intl.formatMessage(messages.selected, {
                                  count: picked.size
                              })
                            : intl.formatMessage(messages.nothingSelected)}
                    </p>
                    <div className="flex gap-2">
                        <Button type="button" variant="ghost" onClick={close}>
                            {intl.formatMessage(messages.cancel)}
                        </Button>
                        <Button
                            type="button"
                            onClick={confirm}
                            disabled={picked.size === 0}
                        >
                            {intl.formatMessage(
                                multiple
                                    ? messages.confirmMultiple
                                    : messages.confirmSingle
                            )}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
