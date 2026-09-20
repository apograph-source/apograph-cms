import { defineMessages, useIntl } from 'react-intl';
import { Lock } from 'lucide-react';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@orthacms/design-system';

/** Intl descriptors for {@link MembersNoAccess}, co-located with the component. */
const messages = defineMessages({
    title: {
        id: 'users.noAccess.title',
        defaultMessage: 'You don’t have access to members'
    },
    description: {
        id: 'users.noAccess.description',
        defaultMessage:
            'Viewing members requires the users:read permission. Ask an admin if you think you should have it.'
    }
});

/**
 * Shown in place of the Members page when the signed-in user lacks
 * `users:read` — the route still resolves, but no member data is fetched or
 * rendered (and the server would refuse it regardless).
 */
export function MembersNoAccess() {
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
