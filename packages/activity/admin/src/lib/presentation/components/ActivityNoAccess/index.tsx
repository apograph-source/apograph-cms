import { defineMessages, useIntl } from 'react-intl';
import { Lock } from 'lucide-react';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@orthacms/design-system';

/** Intl descriptors for {@link ActivityNoAccess}, co-located. */
const messages = defineMessages({
    title: {
        id: 'activity.noAccess.title',
        defaultMessage: 'You don’t have access to the activity log'
    },
    description: {
        id: 'activity.noAccess.description',
        defaultMessage:
            'Viewing the activity log requires the activity:read permission. Ask an admin if you think you should have it.'
    }
});

/**
 * Shown in place of the Activity Log when the signed-in user lacks
 * `activity:read` — the route still resolves, but no data is fetched (and the
 * server would refuse it regardless).
 */
export function ActivityNoAccess() {
    const intl = useIntl();

    return (
        <Empty className="border">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <Lock />
                </EmptyMedia>
                <EmptyTitle>{intl.formatMessage(messages.title)}</EmptyTitle>
                <EmptyDescription>
                    {intl.formatMessage(messages.description)}
                </EmptyDescription>
            </EmptyHeader>
        </Empty>
    );
}
