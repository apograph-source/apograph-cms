import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Table,
    TableBody,
    TableHead,
    TableHeader,
    TableRow
} from '@orthacms/design-system';
import { ActivityRow } from './ActivityRow';
import type { ActivityEvent } from '../../../types/activityEvent';

/** Intl descriptors for {@link ActivityTable}, co-located with the component. */
const messages = defineMessages({
    when: { id: 'activity.table.when', defaultMessage: 'When' },
    actor: { id: 'activity.table.actor', defaultMessage: 'Actor' },
    action: { id: 'activity.table.action', defaultMessage: 'Action' },
    subject: { id: 'activity.table.subject', defaultMessage: 'Subject' },
    details: { id: 'activity.table.details', defaultMessage: 'Details' },
    caption: { id: 'activity.table.caption', defaultMessage: 'Activity log' }
});

/**
 * The audit-log table: when an action happened, who did it, what it was, and
 * the subject it targeted. Each row expands (with a small animation) to a
 * details panel — the full subject, actor, exact time, and raw metadata. The
 * log is read-only; the only row interaction is expand/collapse.
 */
export function ActivityTable({ events }: { events: ActivityEvent[] }) {
    const intl = useIntl();
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(
        () => new Set()
    );

    const toggle = (id: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });

    return (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
            <Table aria-label={intl.formatMessage(messages.caption)}>
                <TableHeader>
                    <TableRow>
                        {/* The disclosure column. An empty <th> reads as
                            "blank" as the first cell of every row in a screen
                            reader's column-header mode, so it carries a
                            sr-only name that also says what its buttons do. */}
                        <TableHead scope="col" className="w-8">
                            <span className="sr-only">
                                {intl.formatMessage(messages.details)}
                            </span>
                        </TableHead>
                        <TableHead scope="col">
                            {intl.formatMessage(messages.when)}
                        </TableHead>
                        <TableHead scope="col">
                            {intl.formatMessage(messages.actor)}
                        </TableHead>
                        <TableHead scope="col">
                            {intl.formatMessage(messages.action)}
                        </TableHead>
                        <TableHead scope="col">
                            {intl.formatMessage(messages.subject)}
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {events.map((event) => {
                        const open = expanded.has(event.id);
                        const panelId = `activity-detail-${event.id}`;
                        return (
                            <ActivityRow
                                key={event.id}
                                event={event}
                                open={open}
                                panelId={panelId}
                                onToggle={() => toggle(event.id)}
                            />
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
