import { defineMessages, useIntl } from 'react-intl';
import { Alert, AlertDescription, AlertTitle } from '@orthacms/design-system';
import { ShieldAlert } from 'lucide-react';

const messages = defineMessages({
    title: {
        id: 'alarms.noAccess.title',
        defaultMessage: 'You cannot view alarms'
    },
    body: {
        id: 'alarms.noAccess.body',
        defaultMessage:
            'Viewing content alarms needs the alarms:read permission. Ask a workspace administrator to grant it.'
    }
});

/** Shown in place of the page when the caller lacks `alarms:read`. */
export function AlarmsNoAccess() {
    const intl = useIntl();
    return (
        <Alert>
            <ShieldAlert aria-hidden="true" />
            <AlertTitle>{intl.formatMessage(messages.title)}</AlertTitle>
            <AlertDescription>
                {intl.formatMessage(messages.body)}
            </AlertDescription>
        </Alert>
    );
}
