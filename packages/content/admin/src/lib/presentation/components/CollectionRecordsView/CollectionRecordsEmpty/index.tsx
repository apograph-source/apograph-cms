import { defineMessages, useIntl } from 'react-intl';
import { Inbox, Plus } from 'lucide-react';
import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@orthacms/design-system';

/** Intl descriptors for {@link CollectionRecordsEmpty}, co-located. */
const messages = defineMessages({
    filteredTitle: {
        id: 'content.records.empty.filtered.title',
        defaultMessage: 'No records match'
    },
    filteredDescription: {
        id: 'content.records.empty.filtered.description',
        defaultMessage: 'Try a different search, or clear the filters.'
    },
    clear: {
        id: 'content.records.empty.clear',
        defaultMessage: 'Clear filters'
    },
    emptyTitle: {
        id: 'content.records.empty.none.title',
        defaultMessage: 'No records yet'
    },
    emptyDescription: {
        id: 'content.records.empty.none.description',
        defaultMessage: 'Add the first record to this collection.'
    },
    add: { id: 'content.records.empty.add', defaultMessage: 'Add record' },
    trashTitle: {
        id: 'content.records.empty.trash.title',
        defaultMessage: 'Trash is empty'
    },
    trashDescription: {
        id: 'content.records.empty.trash.description',
        defaultMessage: 'Deleted records will appear here.'
    }
});

/**
 * The empty state under the records toolbar. A search/filter miss offers to
 * clear the filters; a genuinely empty collection offers to add the first
 * record (when the signed-in user may create).
 */
export function CollectionRecordsEmpty({
    filtered,
    trashed = false,
    onClear,
    onAdd
}: {
    /** Whether a search/filter is currently narrowing the list. */
    filtered: boolean;
    /** Whether this is the trash view (changes the unfiltered empty copy). */
    trashed?: boolean;
    /** Clears the search + filter. */
    onClear: () => void;
    /** Opens the create flow. Omitted when the user lacks create permission. */
    onAdd?: () => void;
}) {
    const intl = useIntl();

    const title = filtered
        ? messages.filteredTitle
        : trashed
          ? messages.trashTitle
          : messages.emptyTitle;
    const description = filtered
        ? messages.filteredDescription
        : trashed
          ? messages.trashDescription
          : messages.emptyDescription;

    return (
        <Empty className="border">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <Inbox />
                </EmptyMedia>
                <EmptyTitle>{intl.formatMessage(title)}</EmptyTitle>
                <EmptyDescription>
                    {intl.formatMessage(description)}
                </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                {filtered ? (
                    <Button
                        variant="outline"
                        className="shadow-none"
                        onClick={onClear}
                    >
                        {intl.formatMessage(messages.clear)}
                    </Button>
                ) : onAdd ? (
                    <Button onClick={onAdd}>
                        <Plus />
                        {intl.formatMessage(messages.add)}
                    </Button>
                ) : null}
            </EmptyContent>
        </Empty>
    );
}
