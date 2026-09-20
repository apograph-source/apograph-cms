import { defineMessages, useIntl } from 'react-intl';
import { ChevronRight } from 'lucide-react';
import { cn, TableCell, TableRow } from '@orthacms/design-system';
import { ActivityActionCell } from '../ActivityActionCell';
import { ActivityActorCell } from '../ActivityActorCell';
import { ActivitySubjectCell } from '../ActivitySubjectCell';
import { DetailRow } from './DetailRow';
import { activityDateTime } from '../../../activityDateTime';
import { formatActivityDetails } from '../../../activityMessages';
import type { ActivityEvent } from '../../../../types/activityEvent';

/** Intl descriptors for {@link ActivityRow}, co-located with the component. */
const messages = defineMessages({
    expand: {
        id: 'activity.table.expand',
        defaultMessage: 'Show details'
    },
    collapse: {
        id: 'activity.table.collapse',
        defaultMessage: 'Hide details'
    },
    detailSummary: {
        id: 'activity.table.detail.summary',
        defaultMessage: 'Details'
    },
    detailSubject: {
        id: 'activity.table.detail.subject',
        defaultMessage: 'Subject'
    },
    detailActor: {
        id: 'activity.table.detail.actor',
        defaultMessage: 'Actor'
    },
    detailTime: { id: 'activity.table.detail.time', defaultMessage: 'Time' },
    detailMeta: {
        id: 'activity.table.detail.meta',
        defaultMessage: 'Metadata'
    },
    system: { id: 'activity.table.detail.system', defaultMessage: 'System' }
});

/** Total column count (expand toggle + 4 data columns) for the detail colSpan. */
const COLUMN_COUNT = 5;

/**
 * A single audit-log row plus its expandable details panel. Renders the data
 * cells (when, actor, action, subject) and, below them, a panel revealing the
 * full subject, actor, exact time, and raw metadata — animated via a grid-rows
 * `0fr↔1fr` transition, and `aria-hidden` + `inert` on the whole detail `<tr>`
 * when collapsed so the table's row count matches its event count.
 */
export function ActivityRow({
    event,
    open,
    panelId,
    onToggle
}: {
    event: ActivityEvent;
    open: boolean;
    panelId: string;
    onToggle: () => void;
}) {
    const intl = useIntl();
    const details = formatActivityDetails(intl, event);

    // The whole row is a click target (a deliberately generous one), but this
    // is an audit log and the ids in it get copied. A click that ends a
    // text-selection drag would otherwise collapse the row out from under the
    // selection on mouseup, so a click with live selected text is ignored.
    const onRowClick = () => {
        if (window.getSelection()?.toString()) return;
        onToggle();
    };

    return (
        <>
            <TableRow onClick={onRowClick} className="cursor-pointer">
                <TableCell>
                    <button
                        type="button"
                        // The row already toggles on click; stop the bubble so
                        // the button doesn't toggle twice. It stays the
                        // keyboard-accessible control (aria-expanded).
                        onClick={(event) => {
                            event.stopPropagation();
                            onToggle();
                        }}
                        aria-expanded={open}
                        aria-controls={panelId}
                        aria-label={intl.formatMessage(
                            open ? messages.collapse : messages.expand
                        )}
                        className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                        <ChevronRight
                            className={cn(
                                'size-4 transition-transform duration-200 motion-reduce:transition-none',
                                open && 'rotate-90'
                            )}
                        />
                    </button>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {/* A real <time>, so the exact instant is machine-readable
                        to AT, translation tools and user scripts — the home
                        panel already did this and the table did not. */}
                    <time dateTime={activityDateTime(event.at)}>
                        {intl.formatDate(event.at, {
                            dateStyle: 'medium',
                            timeStyle: 'short'
                        })}
                    </time>
                </TableCell>
                <TableCell>
                    <ActivityActorCell actor={event.actor} />
                </TableCell>
                <TableCell>
                    <ActivityActionCell kind={event.kind} />
                </TableCell>
                <TableCell>
                    <ActivitySubjectCell event={event} />
                </TableCell>
            </TableRow>
            {/* The detail row exists in the DOM at all times so the disclosure
                can animate open, but while collapsed it is removed from the
                accessibility tree entirely (`aria-hidden` + `inert`) rather
                than only marking the inner <dl> inert. Without that, a 25-event
                page announced as a **50**-row table with an empty row between
                every pair of events. */}
            <TableRow
                className="border-0 hover:bg-transparent"
                aria-hidden={open ? undefined : true}
                inert={open ? undefined : true}
            >
                <TableCell colSpan={COLUMN_COUNT} className="p-0">
                    <div
                        className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
                        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
                    >
                        <div className="overflow-hidden">
                            <dl
                                id={panelId}
                                className="grid gap-x-6 gap-y-2 border-t bg-muted/30 px-4 py-3 text-sm sm:grid-cols-[auto_1fr]"
                            >
                                {details ? (
                                    <DetailRow
                                        label={intl.formatMessage(
                                            messages.detailSummary
                                        )}
                                        value={details}
                                    />
                                ) : null}
                                <DetailRow
                                    label={intl.formatMessage(
                                        messages.detailSubject
                                    )}
                                    value={`${event.subjectType} · ${event.subjectId}`}
                                    mono
                                />
                                <DetailRow
                                    label={intl.formatMessage(
                                        messages.detailActor
                                    )}
                                    value={
                                        event.actor
                                            ? (event.actor.email ??
                                              event.actor.id)
                                            : intl.formatMessage(
                                                  messages.system
                                              )
                                    }
                                />
                                <DetailRow
                                    label={intl.formatMessage(
                                        messages.detailTime
                                    )}
                                    value={intl.formatDate(event.at, {
                                        dateStyle: 'long',
                                        timeStyle: 'medium'
                                    })}
                                />
                                {event.meta &&
                                Object.keys(event.meta).length > 0 ? (
                                    <DetailRow
                                        label={intl.formatMessage(
                                            messages.detailMeta
                                        )}
                                        value={renderMeta(event.meta)}
                                        mono
                                    />
                                ) : null}
                            </dl>
                        </div>
                    </div>
                </TableCell>
            </TableRow>
        </>
    );
}

/** Flattens the open `meta` record to a compact `key: value` string. */
function renderMeta(meta: Record<string, unknown>): string {
    return Object.entries(meta)
        .map(([key, value]) => `${key}: ${formatValue(value)}`)
        .join('  ·  ');
}

/** Renders a single meta value for display. */
function formatValue(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}
