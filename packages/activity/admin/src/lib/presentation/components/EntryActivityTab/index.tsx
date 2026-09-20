import { defineMessages, useIntl } from 'react-intl';
import { Spinner } from '@orthacms/design-system';
import type { EntryTabContext } from '@orthacms/content-admin';
import { useHasPermission } from '@orthacms/identity-admin';
import { useEntryActivity } from '../../../application/useEntryActivity';
import { formatActivityAction } from '../../activityMessages';
import { activityDateTime } from '../../activityDateTime';

/**
 * How many rows the tab shows.
 *
 * A tab is a page, not a corner of a rail: the six rows this used to show were
 * sized for a 240px column, and the first question anyone asks of a record's
 * history — "when did this last go live, and who did it?" — is regularly older
 * than six actions on a record being worked on.
 */
const TAB_PAGE_SIZE = 25;

/** Intl descriptors for {@link EntryActivityTab}, co-located here. */
const messages = defineMessages({
    heading: {
        id: 'activity.entryTab.heading',
        defaultMessage: 'What happened to this record'
    },
    count: {
        id: 'activity.entryTab.count',
        defaultMessage:
            '{total, plural, =0 {Nothing recorded yet} one {# recorded action} other {# recorded actions}}'
    },
    empty: {
        id: 'activity.entryTab.empty',
        defaultMessage: 'Nothing has been recorded for this record yet.'
    },
    notSaved: {
        id: 'activity.entryTab.notSaved',
        defaultMessage:
            'This record has not been saved yet, so there is nothing to have happened to it.'
    },
    failed: {
        id: 'activity.entryTab.failed',
        defaultMessage:
            'The history could not be loaded, so this is not a record of nothing having happened.'
    },
    system: {
        id: 'activity.entryTab.system',
        defaultMessage: 'System'
    }
});

/**
 * The entry editor's **Activity** tab — who did what to the record that is
 * open.
 *
 * It answers what the built-in History tab cannot. History is the **revision**
 * timeline: what the words were at each save. It cannot say who published the
 * entry, who took it down, who deleted and restored it, or who changed which
 * audiences may read it — none of those are snapshots of a document. The
 * deployment-wide Activity page has them and is `activity:read`, admin-only, so
 * the person most likely to ask was the one person who could not.
 *
 * This reads the entry-scoped route instead, gated on `content:read`: every row
 * it can return is about a record the reader may already open, so it needs no
 * authority beyond having opened it.
 *
 * **It was a section of the Properties rail until ORT-198.** A rail 240px wide
 * shared by six widgets from four plugins is the wrong home for a list that
 * grows: it showed six rows, wrapped every actor's email, and disappeared
 * wholesale whenever the reader collapsed the panel. A tab is a route, so the
 * open one also survives the navigations this editor does not control — a
 * locale switch re-targets it at the sibling record — and it can be linked to.
 *
 * Read-only, so it takes nothing from the tab context's form bridge.
 */
export function EntryActivityTab({ entry, isCreate }: EntryTabContext) {
    const intl = useIntl();
    const canRead = useHasPermission('content:read');

    // A record being created has no id yet, so there is no history to have and
    // no request worth making.
    const entryId = !isCreate ? entry?.id : undefined;
    const { data, isPending, isError } = useEntryActivity(
        entryId,
        TAB_PAGE_SIZE,
        canRead
    );

    if (!canRead) return null;

    // Unlike the rail widget, the tab cannot render nothing: its trigger is on
    // screen, so a reader who opens it on a create form has to be told why it
    // is empty rather than shown a blank panel.
    if (!entryId) {
        return (
            <p className="text-sm text-muted-foreground">
                {intl.formatMessage(messages.notSaved)}
            </p>
        );
    }

    return (
        <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <h3 className="text-sm font-medium">
                    {intl.formatMessage(messages.heading)}
                </h3>
                {!isPending && !isError ? (
                    <p className="text-sm text-muted-foreground">
                        {intl.formatMessage(messages.count, {
                            total: data?.total ?? 0
                        })}
                    </p>
                ) : null}
            </div>

            {isPending ? <Spinner /> : null}

            {isError ? (
                // Not the empty state: "nothing happened" and "we could not
                // find out" read identically, and only one of them is a fact.
                <p className="text-sm text-muted-foreground">
                    {intl.formatMessage(messages.failed)}
                </p>
            ) : null}

            {!isPending && !isError && (data?.items.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">
                    {intl.formatMessage(messages.empty)}
                </p>
            ) : null}

            {data && data.items.length > 0 ? (
                <ul className="divide-y rounded-lg border">
                    {data.items.map((event) => (
                        <li
                            key={event.id}
                            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
                        >
                            <div className="flex min-w-0 flex-col gap-0.5">
                                <span className="text-sm font-medium">
                                    {formatActivityAction(intl, event.kind)}
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                    {/* The actor's frozen email snapshot — or
                                        "System" for an action nobody performed,
                                        and for a token's write the token's own
                                        label. */}
                                    {event.actor?.email ??
                                        intl.formatMessage(messages.system)}
                                </span>
                            </div>
                            <time
                                // Through the shared guard, never
                                // `toISOString()` directly: `at` may be an
                                // Invalid Date (the mapper deliberately invents
                                // no fallback instant for an audit row), and
                                // `toISOString` throws on one.
                                dateTime={activityDateTime(event.at)}
                                className="shrink-0 text-xs tabular-nums text-muted-foreground"
                            >
                                {intl.formatDate(event.at, {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                })}
                            </time>
                        </li>
                    ))}
                </ul>
            ) : null}
        </section>
    );
}
