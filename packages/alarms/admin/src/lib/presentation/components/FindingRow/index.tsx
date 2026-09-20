import { Link } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type { AlarmFinding } from '../../../types/alarm';

const messages = defineMessages({
    openRecord: {
        id: 'alarms.finding.openRecord',
        defaultMessage: 'Open record {id}'
    },
    since: {
        id: 'alarms.finding.since',
        defaultMessage: 'Open since {date}'
    }
});

/** Props for {@link FindingRow}. */
export type FindingRowProps = {
    /** The finding this row is about. */
    finding: AlarmFinding;
};

/**
 * One flagged record, inside its alarm's group.
 *
 * The group header already carries the alarm, the sentence editors read on the
 * record, and the severity — so the row is one dense line of what differs
 * between records: which one, and how long it has been flagged.
 *
 * **There is no record title to show.** A finding carries the entry's id and
 * nothing else, and content types declare no display field for the server to
 * join, so the id is the honest identifier — in tabular figures, because a
 * column of them is read by scanning rather than by reading. Giving a finding a
 * human title is a server change worth making, not something to fake here.
 *
 * There is no action either. Muting one record at a time is gone: an alarm is
 * either right about a record or wrong about it, and the answer to a wrong one
 * is to narrow or disable the alarm, where the next person can see the decision.
 */
export function FindingRow({ finding }: FindingRowProps) {
    const intl = useIntl();
    const workspace = useCurrentWorkspace();
    const entryPath = `/workspaces/${workspace.id}/content/${finding.contentType}/${finding.entryId}`;

    return (
        <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 pl-11 pr-4 sm:pr-5">
            <Link
                to={entryPath}
                className="min-w-0 flex-1 truncate text-sm tabular-nums hover:underline"
                aria-label={intl.formatMessage(messages.openRecord, {
                    id: finding.entryId
                })}
            >
                <span className="text-muted-foreground">
                    {finding.contentType}
                </span>{' '}
                <span className="font-medium">{finding.entryId}</span>
            </Link>

            <span className="shrink-0 text-xs text-muted-foreground">
                {intl.formatMessage(messages.since, {
                    date: intl.formatDate(finding.firstSeenAt, {
                        dateStyle: 'medium'
                    })
                })}
            </span>
        </li>
    );
}
