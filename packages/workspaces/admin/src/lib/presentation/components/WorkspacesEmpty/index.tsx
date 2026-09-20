import { defineMessages, useIntl } from 'react-intl';
import { Layers, Plus } from 'lucide-react';
import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@orthacms/design-system';

/** Intl descriptors for {@link WorkspacesEmpty}, co-located with the component. */
const messages = defineMessages({
    filteredTitle: {
        id: 'workspaces.empty.filtered.title',
        defaultMessage: 'No workspaces match'
    },
    filteredDescription: {
        id: 'workspaces.empty.filtered.description',
        defaultMessage:
            'Try a different search, or clear the filters to see them all.'
    },
    clear: {
        id: 'workspaces.empty.clear',
        defaultMessage: 'Clear filters'
    },
    emptyTitle: {
        id: 'workspaces.empty.none.title',
        defaultMessage: 'No workspaces yet'
    },
    emptyDescription: {
        id: 'workspaces.empty.none.description',
        defaultMessage:
            'Create your first workspace to group content, members, and plugins.'
    },
    create: {
        id: 'workspaces.empty.create',
        defaultMessage: 'New workspace'
    }
});

type WorkspacesEmptyProps = {
    /** Whether a search or non-default filter is currently narrowing the list. */
    filtered: boolean;
    /** Whether the user may create a workspace (gates the create CTA). */
    canCreate: boolean;
    /** Resets the search and status filter back to their defaults. */
    onClear: () => void;
    /** Opens the create-workspace flow. */
    onCreate: () => void;
};

/**
 * The empty state for the table. When filters are active it offers to clear
 * them; otherwise it invites creating the first workspace — but only when the
 * user holds `workspaces:create`.
 */
export function WorkspacesEmpty({
    filtered,
    canCreate,
    onClear,
    onCreate
}: WorkspacesEmptyProps) {
    const intl = useIntl();

    return (
        <Empty className="border">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <Layers />
                </EmptyMedia>
                <EmptyTitle>
                    {intl.formatMessage(
                        filtered ? messages.filteredTitle : messages.emptyTitle
                    )}
                </EmptyTitle>
                <EmptyDescription>
                    {intl.formatMessage(
                        filtered
                            ? messages.filteredDescription
                            : messages.emptyDescription
                    )}
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
                ) : canCreate ? (
                    <Button onClick={onCreate}>
                        <Plus />
                        {intl.formatMessage(messages.create)}
                    </Button>
                ) : null}
            </EmptyContent>
        </Empty>
    );
}
