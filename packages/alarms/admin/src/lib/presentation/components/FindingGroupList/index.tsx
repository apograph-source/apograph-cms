import { defineMessages, useIntl } from 'react-intl';
import { Alert, AlertDescription, AlertTitle } from '@orthacms/design-system';
import { BellOff, CircleCheck, TriangleAlert } from 'lucide-react';
import type { AlarmRule } from '../../../types/alarm';
import { AlarmsEmpty } from '../AlarmsEmpty';
import { FindingGroup } from './FindingGroup';

const messages = defineMessages({
    errorTitle: {
        id: 'alarms.findings.errorTitle',
        defaultMessage: "Couldn't load findings"
    },
    errorBody: {
        id: 'alarms.findings.errorBody',
        defaultMessage:
            'The request failed. Nothing here reflects the current state of your content until it succeeds.'
    },
    emptyOpenTitle: {
        id: 'alarms.findings.emptyOpenTitle',
        defaultMessage: 'Nothing is flagged'
    },
    emptyOpenBody: {
        id: 'alarms.findings.emptyOpenBody',
        defaultMessage:
            'No record currently matches any of this workspace’s alarms. This is what a clean workspace looks like.'
    },
    noAlarmsTitle: {
        id: 'alarms.findings.noAlarmsTitle',
        defaultMessage: 'No alarms yet'
    },
    noAlarmsBody: {
        id: 'alarms.findings.noAlarmsBody',
        defaultMessage:
            'An alarm watches a collection and flags whatever matches its conditions. Filter a content list down to the records that look wrong and use “Save as alarm”, or start one here.'
    },
    emptyMutedBody: {
        id: 'alarms.findings.emptyMutedBody',
        defaultMessage:
            'Muting a flagged record silences it until someone unmutes it. Nobody has done that here.'
    }
});

/** Props for {@link FindingGroupList}. */
export type FindingGroupListProps = {
    /** Every alarm in the workspace, with its live counts. */
    rules: readonly AlarmRule[];
    /** The rules request failed — rendered instead of an empty state. */
    isError: boolean;
    /** Whether the caller may rescan (i.e. holds `alarms:manage`). */
    canManage: boolean;
    /** Re-run one alarm over its whole collection. */
    onRescan: (rule: AlarmRule) => void;
    /** Ids of alarms with a rescan in flight. */
    rescanningIds: ReadonlySet<string>;
    /** Start a new alarm — offered from the "no alarms yet" state. */
    onCreate?: () => void;
    /** Expand this alarm's group on arrival (from an alarm card's count). */
    focusRuleId?: string;
};

/**
 * The flagged and muted views: one collapsible group per alarm that has
 * records, ordered loudest first.
 *
 * **The groups come from the alarms, not from a page of findings.** Each
 * alarm row already carries its own `openCount` / `mutedCount`, so the list of
 * groups and the number on each header are exact without reading a single
 * finding — and grouping a *page* of findings client-side would have produced
 * headers describing whichever twenty-five rows happened to come back.
 *
 * **Only alarms with something to show are rendered.** An alarm sitting at zero
 * belongs on the Alarms tab; here it would be a row that exists to say nothing.
 */
export function FindingGroupList({
    rules,
    isError,
    canManage,
    onRescan,
    rescanningIds,
    onCreate,
    focusRuleId
}: FindingGroupListProps) {
    const intl = useIntl();

    if (isError) {
        return (
            <Alert variant="destructive">
                <TriangleAlert aria-hidden="true" />
                <AlertTitle>
                    {intl.formatMessage(messages.errorTitle)}
                </AlertTitle>
                <AlertDescription>
                    {intl.formatMessage(messages.errorBody)}
                </AlertDescription>
            </Alert>
        );
    }

    const countOf = (rule: AlarmRule) => rule.openCount;

    const groups = rules
        .filter((rule) => countOf(rule) > 0)
        // Loudest first, then biggest: an editor scanning this wants the errors
        // and the pile-ups at the top, not whatever the API happened to sort by.
        .slice()
        .sort((a, b) => {
            const order = { error: 0, warn: 1, info: 2 } as const;
            if (order[a.severity] !== order[b.severity]) {
                return order[a.severity] - order[b.severity];
            }
            return countOf(b) - countOf(a);
        });

    if (groups.length === 0) {
        // "No alarms at all" and "alarms exist and nothing matches" are
        // different facts, and only the second is reassuring. Told apart here
        // because the first has something for the reader to do about it.
        if (rules.length === 0) {
            return (
                <AlarmsEmpty
                    icon={BellOff}
                    title={intl.formatMessage(messages.noAlarmsTitle)}
                    description={intl.formatMessage(messages.noAlarmsBody)}
                    onCreate={onCreate}
                />
            );
        }
        return (
            <AlarmsEmpty
                icon={CircleCheck}
                title={intl.formatMessage(messages.emptyOpenTitle)}
                description={intl.formatMessage(messages.emptyOpenBody)}
            />
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {groups.map((rule) => (
                <FindingGroup
                    key={rule.id}
                    rule={rule}
                    count={countOf(rule)}
                    // One group is its own answer — making the reader click to
                    // see the only thing on the page is a click for nothing.
                    // Otherwise everything starts closed and the page is a
                    // summary you drill into.
                    defaultOpen={groups.length === 1 || rule.id === focusRuleId}
                    canManage={canManage}
                    onRescan={onRescan}
                    isRescanning={rescanningIds.has(rule.id)}
                />
            ))}
        </div>
    );
}
