import { defineMessages, useIntl } from 'react-intl';
import type { DeliveryStatus } from '../../../domain/types/webhook';
import { Badge } from '@orthacms/design-system';

const messages = defineMessages({
    pending: { id: 'webhooks.status.pending', defaultMessage: 'Queued' },
    delivering: { id: 'webhooks.status.delivering', defaultMessage: 'Sending' },
    succeeded: { id: 'webhooks.status.succeeded', defaultMessage: 'Delivered' },
    failed: { id: 'webhooks.status.failed', defaultMessage: 'Retrying' },
    dead: { id: 'webhooks.status.dead', defaultMessage: 'Failed' }
});

/**
 * How each state reads and looks.
 *
 * The wording is the point: `failed` on a row that will be tried again says
 * **Retrying**, and only `dead` — the state nothing will act on again — says
 * "Failed". Calling both of them "failed" is what makes an operator chase a
 * delivery that was about to succeed on its own.
 */
const LOOK: Record<
    DeliveryStatus,
    { variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
    pending: { variant: 'outline' },
    delivering: { variant: 'secondary' },
    succeeded: { variant: 'default' },
    failed: { variant: 'secondary' },
    dead: { variant: 'destructive' }
};

/** The state of one delivery, as a chip. */
export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
    const intl = useIntl();
    return (
        <Badge variant={LOOK[status].variant}>
            {intl.formatMessage(messages[status])}
        </Badge>
    );
}
