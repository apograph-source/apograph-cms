import { defineMessages, useIntl } from 'react-intl';
import type { RecordsColumnCellContext } from '@orthacms/content-admin';
import { Badge } from '@orthacms/design-system';
import type { EntryReviewStatus } from '../../../domain/types';

const messages = defineMessages({
    blocked: {
        id: 'protection.column.blocked',
        defaultMessage: '{given} of {required}'
    },
    ready: {
        id: 'protection.column.ready',
        defaultMessage: 'Ready'
    },
    notRequested: {
        id: 'protection.column.notRequested',
        defaultMessage: 'Not requested'
    },
    unprotected: {
        id: 'protection.column.unprotected',
        defaultMessage: 'No review'
    },
    /**
     * The cell's accessible name. A bare "1 of 2" in a row of numbers says
     * nothing about what was counted — a screen-reader user arrives at it with
     * only the column header for context, and headers are not always announced
     * on every cell.
     */
    blockedLabel: {
        id: 'protection.column.blockedLabel',
        defaultMessage: '{given} of {required} approvals; publishing is held'
    },
    readyLabel: {
        id: 'protection.column.readyLabel',
        defaultMessage: 'Approved — {given} of {required}, ready to publish'
    },
    notRequestedLabel: {
        id: 'protection.column.notRequestedLabel',
        defaultMessage:
            'No review requested; {required, plural, one {# approval} other {# approvals}} needed to publish'
    },
    unprotectedLabel: {
        id: 'protection.column.unprotectedLabel',
        defaultMessage: 'This type does not require review'
    }
});

/**
 * One row's review state in the records list.
 *
 * **It counts nothing.** The numbers arrive from
 * `GET /protection/entries/:type/status`, which reads them through the same
 * kernel call the publish gate obeys — so a row saying "2 of 2" and a Publish
 * button that then refuses cannot happen. A cell that tallied votes itself would
 * agree until somebody switched on `countStaleApprovals`.
 *
 * Every state carries its meaning in **text**, and the tone is a second signal
 * rather than the only one.
 */
export function ReviewColumnCell({ entry, data }: RecordsColumnCellContext) {
    const intl = useIntl();
    const byEntry = data as
        | { data?: Record<string, EntryReviewStatus> }
        | undefined;
    const status = byEntry?.data?.[entry.id];

    // Absent means the column is switched off, the read is still in flight, or
    // this row has no revision under this type. An empty cell is the honest
    // answer to all three: a placeholder would claim the row is unprotected,
    // which is a different fact from "we have not asked".
    if (!status) return null;

    if (!status.protected) {
        return (
            <span
                className="text-muted-foreground text-xs"
                aria-label={intl.formatMessage(messages.unprotectedLabel)}
            >
                {intl.formatMessage(messages.unprotected)}
            </span>
        );
    }

    const values = { given: status.given, required: status.required };

    if (!status.blocked) {
        return (
            <Badge
                variant="outline"
                className="border-success text-success-soft-foreground"
                aria-label={intl.formatMessage(messages.readyLabel, values)}
            >
                {intl.formatMessage(messages.ready)}
            </Badge>
        );
    }

    if (!status.requested && status.given === 0) {
        return (
            <span
                className="text-muted-foreground text-xs"
                aria-label={intl.formatMessage(
                    messages.notRequestedLabel,
                    values
                )}
            >
                {intl.formatMessage(messages.notRequested)}
            </span>
        );
    }

    return (
        <Badge
            variant="outline"
            className={
                status.given === 0
                    ? 'border-destructive text-destructive'
                    : 'border-warning text-warning-soft-foreground'
            }
            aria-label={intl.formatMessage(messages.blockedLabel, values)}
        >
            {intl.formatMessage(messages.blocked, values)}
        </Badge>
    );
}
