import { defineMessages, useIntl } from 'react-intl';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@apograph/design-system';
import { useDeadLetters } from '../../../application/useDeadLetters';

/** Intl descriptors for {@link DeadLetterNotice}, co-located here. */
const messages = defineMessages({
    title: {
        id: 'activity.deadLetters.title',
        defaultMessage:
            '{count, plural, one {# action was not recorded} other {# actions were not recorded}}'
    },
    body: {
        id: 'activity.deadLetters.body',
        defaultMessage:
            'The log below is incomplete. These events were retried and gave up, so what happened is not in it. Most recent: {kinds}.'
    }
});

/**
 * Says, on the page whose whole job is being the record of record, that the
 * record has holes in it.
 *
 * An event that exhausted its delivery attempts is very often an audit row that
 * was never written. The dispatcher logs the moment one parks, but a log line is
 * loud only to somebody tailing logs right then — afterwards the question "is
 * anything missing from this log" had no answer short of a `psql` session, and
 * a gap only visible to a person who thinks to go looking is barely a gap that
 * has been noticed. This is that answer, in front of the reader who cares.
 *
 * **Renders nothing when there is nothing to say**, which is the normal case:
 * no placeholder, no "0 problems" row, no reserved space. It also renders
 * nothing while loading or on error — a caveat about a list must never be the
 * reason the page looks broken, and a failed *warning* is not itself news.
 */
export function DeadLetterNotice() {
    const intl = useIntl();
    const { data } = useDeadLetters();

    if (!data || data.total === 0) {
        return null;
    }

    // The distinct kinds, so the notice says *what* is missing rather than only
    // how much — "3 actions were not recorded" is an alarm, "…: entry.updated,
    // media.asset.uploaded" is a lead.
    const kinds = [...new Set(data.items.map((item) => item.kind))].join(', ');

    return (
        <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" className="size-4" />
            <AlertTitle>
                {intl.formatMessage(messages.title, { count: data.total })}
            </AlertTitle>
            <AlertDescription>
                {intl.formatMessage(messages.body, { kinds })}
            </AlertDescription>
        </Alert>
    );
}
