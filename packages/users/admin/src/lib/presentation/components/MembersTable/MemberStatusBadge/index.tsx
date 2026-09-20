import { defineMessages, useIntl } from 'react-intl';
import { Badge, cn } from '@orthacms/design-system';
import type { MemberStatus } from '../../../../domain/types/member';

/** Intl descriptors for {@link MemberStatusBadge}, co-located with the component. */
const messages = defineMessages({
    active: {
        id: 'users.status.active',
        defaultMessage: 'Active'
    },
    invited: {
        id: 'users.status.invited',
        defaultMessage: 'Invited'
    },
    disabled: {
        id: 'users.status.disabled',
        defaultMessage: 'Disabled'
    }
});

/**
 * Dot color, pill variant, and label per status; the label keeps color from
 * being the sole signal.
 */
const APPEARANCE = {
    active: {
        dot: 'bg-status-active',
        variant: 'success',
        message: messages.active
    },
    pending: {
        dot: 'bg-status-invited',
        variant: 'warning',
        message: messages.invited
    },
    disabled: {
        dot: 'bg-muted-foreground',
        variant: 'secondary',
        message: messages.disabled
    }
} as const;

/**
 * The Status column's pill: a leading colored dot plus the status label —
 * green "Active", amber "Invited" (a sent, unaccepted invite), muted
 * "Disabled".
 */
export function MemberStatusBadge({ status }: { status: MemberStatus }) {
    const intl = useIntl();
    const appearance = APPEARANCE[status];

    return (
        <Badge
            variant={appearance.variant}
            className={cn(
                'gap-1.5 rounded-xl',
                status === 'disabled' && 'border-border'
            )}
        >
            <span
                aria-hidden
                className={cn('size-1.5 rounded-full', appearance.dot)}
            />
            <span
                className={cn(status === 'disabled' && 'text-muted-foreground')}
            >
                {intl.formatMessage(appearance.message)}
            </span>
        </Badge>
    );
}
