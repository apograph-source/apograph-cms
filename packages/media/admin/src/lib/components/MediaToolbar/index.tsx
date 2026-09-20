import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    InputGroup,
    InputGroupAddon,
    InputGroupInput,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@orthacms/design-system';
import { FolderPlus, Search, UploadCloud } from 'lucide-react';
import {
    KIND_FILTER_ALL,
    MEDIA_KIND,
    MEDIA_SORT,
    type MediaSort
} from '../../constants';
import type { KindFilter } from '../../hooks/useMediaLibrary';

/** Intl descriptors for {@link MediaToolbar}, co-located. */
const messages = defineMessages({
    search: { id: 'media.toolbar.search', defaultMessage: 'Search assets' },
    searchPlaceholder: {
        id: 'media.toolbar.searchPlaceholder',
        defaultMessage: 'Search name or tag…'
    },
    kindLabel: {
        id: 'media.toolbar.kindLabel',
        defaultMessage: 'Filter by type'
    },
    kindAll: { id: 'media.toolbar.kindAll', defaultMessage: 'All types' },
    kindImage: { id: 'media.toolbar.kindImage', defaultMessage: 'Images' },
    kindVideo: { id: 'media.toolbar.kindVideo', defaultMessage: 'Videos' },
    kindAudio: { id: 'media.toolbar.kindAudio', defaultMessage: 'Audio' },
    kindDocument: {
        id: 'media.toolbar.kindDocument',
        defaultMessage: 'Documents'
    },
    kindArchive: {
        id: 'media.toolbar.kindArchive',
        defaultMessage: 'Archives'
    },
    sortLabel: { id: 'media.toolbar.sortLabel', defaultMessage: 'Sort' },
    sortNewest: {
        id: 'media.toolbar.sortNewest',
        defaultMessage: 'Newest first'
    },
    sortOldest: {
        id: 'media.toolbar.sortOldest',
        defaultMessage: 'Oldest first'
    },
    sortNameAsc: {
        id: 'media.toolbar.sortNameAsc',
        defaultMessage: 'Name A–Z'
    },
    sortNameDesc: {
        id: 'media.toolbar.sortNameDesc',
        defaultMessage: 'Name Z–A'
    },
    sortLargest: { id: 'media.toolbar.sortLargest', defaultMessage: 'Largest' },
    sortSmallest: {
        id: 'media.toolbar.sortSmallest',
        defaultMessage: 'Smallest'
    },
    newFolder: { id: 'media.toolbar.newFolder', defaultMessage: 'New folder' },
    upload: { id: 'media.toolbar.upload', defaultMessage: 'Upload' }
});

/**
 * The Media Library's control bar — a search box, a type filter, a sort select,
 * and (permission-gated) New folder + Upload actions. Fully controlled: every
 * value lives in the page's store and changes dispatch straight back up.
 */
export function MediaToolbar({
    search,
    onSearchChange,
    kindFilter,
    onKindFilterChange,
    sort,
    onSortChange,
    onNewFolder,
    onUpload,
    canCreate
}: {
    search: string;
    onSearchChange: (value: string) => void;
    kindFilter: KindFilter;
    onKindFilterChange: (value: KindFilter) => void;
    sort: MediaSort;
    onSortChange: (value: MediaSort) => void;
    onNewFolder: () => void;
    onUpload: () => void;
    canCreate: boolean;
}) {
    const intl = useIntl();

    return (
        <div className="mb-4 flex flex-wrap items-center gap-2 sm:gap-3">
            <InputGroup className="w-full shadow-none sm:w-auto sm:max-w-[280px] sm:flex-1">
                <InputGroupAddon>
                    <Search />
                </InputGroupAddon>
                <InputGroupInput
                    type="search"
                    value={search}
                    onChange={(event) => onSearchChange(event.target.value)}
                    aria-label={intl.formatMessage(messages.search)}
                    placeholder={intl.formatMessage(messages.searchPlaceholder)}
                />
            </InputGroup>

            <Select
                value={kindFilter}
                onValueChange={(value) =>
                    onKindFilterChange(value as KindFilter)
                }
            >
                <SelectTrigger
                    className="w-[150px] shadow-none"
                    aria-label={intl.formatMessage(messages.kindLabel)}
                >
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={KIND_FILTER_ALL}>
                        {intl.formatMessage(messages.kindAll)}
                    </SelectItem>
                    <SelectItem value={MEDIA_KIND.Image}>
                        {intl.formatMessage(messages.kindImage)}
                    </SelectItem>
                    <SelectItem value={MEDIA_KIND.Video}>
                        {intl.formatMessage(messages.kindVideo)}
                    </SelectItem>
                    <SelectItem value={MEDIA_KIND.Audio}>
                        {intl.formatMessage(messages.kindAudio)}
                    </SelectItem>
                    <SelectItem value={MEDIA_KIND.Document}>
                        {intl.formatMessage(messages.kindDocument)}
                    </SelectItem>
                    <SelectItem value={MEDIA_KIND.Archive}>
                        {intl.formatMessage(messages.kindArchive)}
                    </SelectItem>
                </SelectContent>
            </Select>

            <Select
                value={sort}
                onValueChange={(value) => onSortChange(value as MediaSort)}
            >
                <SelectTrigger
                    className="w-[150px] shadow-none"
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
                    <SelectItem value={MEDIA_SORT.Largest}>
                        {intl.formatMessage(messages.sortLargest)}
                    </SelectItem>
                    <SelectItem value={MEDIA_SORT.Smallest}>
                        {intl.formatMessage(messages.sortSmallest)}
                    </SelectItem>
                </SelectContent>
            </Select>

            <div className="ml-auto flex items-center gap-2 sm:gap-3">
                {canCreate ? (
                    <>
                        <Button
                            variant="outline"
                            className="shadow-none"
                            onClick={onNewFolder}
                        >
                            <FolderPlus aria-hidden />
                            <span className="hidden sm:inline">
                                {intl.formatMessage(messages.newFolder)}
                            </span>
                        </Button>
                        <Button onClick={onUpload}>
                            <UploadCloud aria-hidden />
                            {intl.formatMessage(messages.upload)}
                        </Button>
                    </>
                ) : null}
            </div>
        </div>
    );
}
