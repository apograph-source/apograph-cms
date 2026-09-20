import { useMemo } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Spinner } from '@orthacms/design-system';
import {
    EntrySidebarSection,
    type EntrySlotContext
} from '@orthacms/content-admin';
import { useHasPermission } from '@orthacms/identity-admin';
import { useFindingsByEntry } from '../../../application/useFindingsByEntry';
import type { AlarmFinding } from '../../../types/alarm';
import { SeverityBadge } from '../SeverityBadge';

const messages = defineMessages({
    title: { id: 'alarms.widget.title', defaultMessage: 'Checks' },
    counts: {
        id: 'alarms.widget.counts',
        defaultMessage:
            '{open, plural, =0 {Nothing flagged} one {# open} other {# open}}'
    },
    clean: {
        id: 'alarms.widget.clean',
        defaultMessage: 'No alarm flags this record.'
    },
    failed: {
        id: 'alarms.widget.failed',
        defaultMessage:
            'Checks could not be loaded, so this record has not been checked.'
    }
});

/**
 * The entry editor's checks block — findings for the record currently open.
 *
 * This is the surface the whole feature exists for. An editor never has to know
 * a rule exists: they open an article and the problem is sitting beside it, on
 * the page where it gets fixed.
 *
 * Rendered into `ENTRY_SIDEBAR_WIDGET_SLOT`, so `content-admin` needs no
 * knowledge of alarms at all. It draws no chrome of its own —
 * `EntrySidebarSection` is exported for exactly this reason, and a widget with
 * its own card border would be the one floating box in a flat rail.
 */
export function EntryAlarmsWidget({ entry, isCreate }: EntrySlotContext) {
    const intl = useIntl();
    const canRead = useHasPermission('alarms:read');

    // A record being created has no id yet, so there is nothing to have found —
    // and no request worth making.
    const entryIds = useMemo(
        () => (entry?.id && !isCreate ? [entry.id] : []),
        [entry?.id, isCreate]
    );
    const { data, isPending, isError } = useFindingsByEntry(
        entryIds,
        canRead && entryIds.length > 0
    );
    const findings = useMemo<AlarmFinding[]>(
        () => (entry?.id ? (data?.[entry.id] ?? []) : []),
        [data, entry?.id]
    );

    if (!canRead || entryIds.length === 0) return null;

    const open = findings.filter((finding) => finding.state === 'open');

    return (
        <EntrySidebarSection
            title={intl.formatMessage(messages.title)}
            description={
                isPending
                    ? undefined
                    : intl.formatMessage(messages.counts, {
                          open: open.length
                      })
            }
        >
            {isPending ? <Spinner /> : null}

            {isError ? (
                // Not an empty state: "nothing flagged" and "we could not check"
                // read identically, and only one of them is reassuring.
                <p className="text-xs text-muted-foreground">
                    {intl.formatMessage(messages.failed)}
                </p>
            ) : null}

            {!isPending && !isError && findings.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                    {intl.formatMessage(messages.clean)}
                </p>
            ) : null}

            {findings.length > 0 ? (
                <ul className="flex flex-col gap-3">
                    {open.map((finding) => (
                        <li
                            key={`${finding.ruleId}:${finding.entryId}`}
                            className="flex flex-col gap-1"
                        >
                            <div className="flex items-start gap-2">
                                <SeverityBadge
                                    severity={finding.severity}
                                    className="mt-0.5 shrink-0"
                                />
                                <span className="text-sm font-medium">
                                    {finding.title}
                                </span>
                            </div>
                            {/* The alarm's name, in the language of editorial
                                policy — so an editor who wants to know why this
                                is being asked of them has somewhere to start. */}
                            <span className="text-xs text-muted-foreground">
                                {finding.ruleName}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : null}
        </EntrySidebarSection>
    );
}
