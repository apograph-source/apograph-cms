import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@orthacms/design-system';
import { FileSearch, ImagePlus, UploadCloud } from 'lucide-react';

/** Intl descriptors for {@link MediaEmptyState}, co-located. */
const messages = defineMessages({
    emptyTitle: {
        id: 'media.empty.emptyTitle',
        defaultMessage: 'This folder is empty'
    },
    emptyBody: {
        id: 'media.empty.emptyBody',
        defaultMessage:
            'Upload images, video, audio, or documents to get started.'
    },
    upload: { id: 'media.empty.upload', defaultMessage: 'Upload assets' },
    noResultsTitle: {
        id: 'media.empty.noResultsTitle',
        defaultMessage: 'No matching assets'
    },
    noResultsBody: {
        id: 'media.empty.noResultsBody',
        defaultMessage: 'Try a different search term or clear the filters.'
    },
    clear: { id: 'media.empty.clear', defaultMessage: 'Clear filters' }
});

/**
 * The browser's empty state. When a search/filter is active it offers to clear
 * them; otherwise (a genuinely empty folder) it invites an upload — the upload
 * CTA shows only when the user may create. The page decides which variant via
 * `hasFilters`.
 */
export function MediaEmptyState({
    hasFilters,
    canCreate,
    onUpload,
    onClearFilters
}: {
    hasFilters: boolean;
    canCreate: boolean;
    onUpload: () => void;
    onClearFilters: () => void;
}) {
    const intl = useIntl();

    if (hasFilters) {
        return (
            <Empty className="py-16">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <FileSearch aria-hidden />
                    </EmptyMedia>
                    <EmptyTitle>
                        {intl.formatMessage(messages.noResultsTitle)}
                    </EmptyTitle>
                    <EmptyDescription>
                        {intl.formatMessage(messages.noResultsBody)}
                    </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                    <Button
                        variant="outline"
                        className="shadow-none"
                        onClick={onClearFilters}
                    >
                        {intl.formatMessage(messages.clear)}
                    </Button>
                </EmptyContent>
            </Empty>
        );
    }

    return (
        <Empty className="py-16">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <ImagePlus aria-hidden />
                </EmptyMedia>
                <EmptyTitle>
                    {intl.formatMessage(messages.emptyTitle)}
                </EmptyTitle>
                <EmptyDescription>
                    {intl.formatMessage(messages.emptyBody)}
                </EmptyDescription>
            </EmptyHeader>
            {canCreate ? (
                <EmptyContent>
                    <Button onClick={onUpload}>
                        <UploadCloud aria-hidden />
                        {intl.formatMessage(messages.upload)}
                    </Button>
                </EmptyContent>
            ) : null}
        </Empty>
    );
}
