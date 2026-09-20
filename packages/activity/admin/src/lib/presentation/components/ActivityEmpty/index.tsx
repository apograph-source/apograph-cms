import { defineMessages, useIntl } from 'react-intl';
import { Activity } from 'lucide-react';
import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@orthacms/design-system';

/** Intl descriptors for {@link ActivityEmpty}, co-located with the component. */
const messages = defineMessages({
    filteredTitle: {
        id: 'activity.empty.filtered.title',
        defaultMessage: 'No activity matches'
    },
    filteredDescription: {
        id: 'activity.empty.filtered.description',
        defaultMessage: 'Try a different action, actor, or date range.'
    },
    clear: {
        id: 'activity.empty.clear',
        defaultMessage: 'Clear filters'
    },
    emptyTitle: {
        id: 'activity.empty.none.title',
        defaultMessage: 'No activity yet'
    },
    emptyDescription: {
        id: 'activity.empty.none.description',
        // Deployment-wide, not workspace-scoped: `activity_events` has no
        // workspace column and this page sends no workspace context, so
        // promising a workspace scope here would misstate what the reader is
        // looking at. See the plugin's AGENTS.md.
        defaultMessage:
            'Actions across this deployment will appear here — every workspace, and the actions that belong to none.'
    }
});

/**
 * The empty state under the toolbar. A filtered miss offers to clear the
 * filters; a genuinely empty log explains that activity will appear as actions
 * are taken.
 */
export function ActivityEmpty({
    filtered,
    onClear
}: {
    /** Whether any filter is currently narrowing the log. */
    filtered: boolean;
    /** Clears every filter. */
    onClear: () => void;
}) {
    const intl = useIntl();

    return (
        <Empty className="border">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <Activity />
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
            {filtered ? (
                <EmptyContent>
                    <Button
                        variant="outline"
                        className="shadow-none"
                        onClick={onClear}
                    >
                        {intl.formatMessage(messages.clear)}
                    </Button>
                </EmptyContent>
            ) : null}
        </Empty>
    );
}
