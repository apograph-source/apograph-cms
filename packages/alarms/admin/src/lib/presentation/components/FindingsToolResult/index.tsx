import { Link } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import type { CopilotToolResultContext } from '@orthacms/copilot-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { severityLook } from '../../severityLook';
import { FindingAgeBar } from './FindingAgeBar';
import { oldestOf, readToolFindings } from './toolOutput';

const messages = defineMessages({
    header: {
        id: 'alarms.toolResult.header',
        defaultMessage:
            '{total, plural, =0 {Nothing flagged} one {# record flagged} other {# records flagged}}'
    },
    tally: {
        id: 'alarms.toolResult.tally',
        defaultMessage:
            '{error, plural, =0 {} one {# error} other {# errors}}{errorSep}{warn, plural, =0 {} one {# warning} other {# warnings}}{warnSep}{info, plural, =0 {} one {# note} other {# notes}}'
    },
    clean: {
        id: 'alarms.toolResult.clean',
        defaultMessage: 'No alarm flags anything in this workspace right now.'
    },
    context: {
        id: 'alarms.toolResult.context',
        defaultMessage: '{rule} · {contentType}'
    },
    age: {
        id: 'alarms.toolResult.age',
        defaultMessage:
            '{days, plural, =0 {flagged today} one {open for # day} other {open for # days}}'
    },
    more: {
        id: 'alarms.toolResult.more',
        defaultMessage:
            '{count, plural, one {# more not shown} other {# more not shown}}'
    },
    listLabel: {
        id: 'alarms.toolResult.listLabel',
        defaultMessage: 'Flagged records'
    },
    open: {
        id: 'alarms.toolResult.open',
        defaultMessage: 'Open {title} on {contentType}'
    }
});

/**
 * `admin_alarms_findings`, rendered as something a person can act on.
 *
 * Most tool results are provenance — the answer is the assistant's prose and
 * the call is the receipt. This one is different: a list of flagged records
 * **is** the answer, and every row has somewhere to go. So it renders as rows
 * with links rather than as JSON, and the raw payload stays right below it
 * (`ToolStep` keeps both) for anyone checking what the model actually saw.
 *
 * ### The one thing here that exists nowhere else in the product
 *
 * **How long each finding has been open**, as a bar. The alarms page shows a
 * date; the entry rail shows none. Neither answers the question a person
 * actually has when handed a list of problems — *which of these have been
 * rotting?* — and that question is what turns a list into a priority. The bars
 * are scaled to the oldest finding in this result, so the comparison is between
 * the rows on screen (see `ageBarWidth`).
 *
 * The bar is a single neutral colour on purpose. Length already carries
 * magnitude; colouring it by severity would put two encodings on one mark and,
 * worse, lean on exactly the red/orange pair that a colourblind reader cannot
 * separate. Severity is the glyph at the start of the row instead.
 */
export function FindingsToolResult({ output }: CopilotToolResultContext) {
    const intl = useIntl();
    const workspace = useCurrentWorkspace();
    const findings = readToolFindings(output);

    // Not this tool's shape — an older payload, or a result the tool no longer
    // produces. `ToolStep` still renders the raw output below, so falling
    // through costs the reader nothing and a crash inside a transcript would
    // cost them the whole conversation.
    if (!findings) return null;

    if (findings.items.length === 0) {
        return (
            <p className="text-muted-foreground text-xs">
                {intl.formatMessage(messages.clean)}
            </p>
        );
    }

    const { error, warn, info } = findings.bySeverity;
    const oldest = oldestOf(findings.items);
    const hidden = Math.max(0, findings.total - findings.items.length);

    return (
        <div className="space-y-2">
            <p className="text-xs font-medium">
                {intl.formatMessage(messages.header, { total: findings.total })}
                {error + warn + info > 0 ? (
                    <span className="text-muted-foreground font-normal">
                        {' · '}
                        {intl.formatMessage(messages.tally, {
                            error,
                            warn,
                            info,
                            // Separators as arguments rather than a second
                            // message: a comma between two present clauses and
                            // nothing when one is absent is not something a
                            // plural rule can express, and building the string
                            // by concatenation outside `formatMessage` is how a
                            // translation loses its word order.
                            errorSep: error > 0 && warn + info > 0 ? ', ' : '',
                            warnSep: warn > 0 && info > 0 ? ', ' : ''
                        })}
                    </span>
                ) : null}
            </p>

            <ul
                className="divide-border/60 divide-y"
                aria-label={intl.formatMessage(messages.listLabel)}
            >
                {findings.items.map((finding) => {
                    const { Icon, ink, label } = severityLook(finding.severity);
                    const to = `/workspaces/${workspace.id}/content/${finding.contentType}/${finding.entryId}`;
                    return (
                        <li
                            key={`${finding.rule}:${finding.entryId}`}
                            className="flex items-start gap-2 py-1.5"
                        >
                            <Icon
                                aria-hidden="true"
                                className={`mt-0.5 size-3.5 shrink-0 ${ink}`}
                            />
                            {/* The severity in words, for anyone the glyph and
                                its colour do not reach. */}
                            <span className="sr-only">
                                {intl.formatMessage(label)}
                            </span>

                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <Link
                                    to={to}
                                    className="truncate text-xs font-medium hover:underline"
                                    aria-label={intl.formatMessage(
                                        messages.open,
                                        {
                                            title: finding.title,
                                            contentType: finding.contentType
                                        }
                                    )}
                                >
                                    {finding.title}
                                </Link>
                                <span className="text-muted-foreground truncate text-[11px]">
                                    {intl.formatMessage(messages.context, {
                                        rule: finding.rule,
                                        contentType: finding.contentType
                                    })}
                                </span>
                            </span>

                            <FindingAgeBar
                                days={finding.openForDays}
                                oldestDays={oldest}
                                label={intl.formatMessage(messages.age, {
                                    days: finding.openForDays
                                })}
                            />
                        </li>
                    );
                })}
            </ul>

            {hidden > 0 ? (
                <p className="text-muted-foreground text-[11px]">
                    {intl.formatMessage(messages.more, { count: hidden })}
                </p>
            ) : null}
        </div>
    );
}
