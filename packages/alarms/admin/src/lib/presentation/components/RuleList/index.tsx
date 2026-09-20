import { defineMessages, useIntl } from 'react-intl';
import { Alert, AlertDescription, AlertTitle } from '@orthacms/design-system';
import { Bell, TriangleAlert } from 'lucide-react';
import type { AlarmRule } from '../../../types/alarm';
import { RuleCard } from './RuleCard';

const messages = defineMessages({
    errorTitle: {
        id: 'alarms.rules.errorTitle',
        defaultMessage: "Couldn't load alarms"
    },
    errorBody: {
        id: 'alarms.rules.errorBody',
        defaultMessage:
            'The request failed, so this is not a statement that the workspace has no alarms. Try again.'
    },
    emptyTitle: {
        id: 'alarms.rules.emptyTitle',
        defaultMessage: 'No alarms yet'
    },
    emptyBody: {
        id: 'alarms.rules.emptyBody',
        defaultMessage:
            'Filter a content list down to the records that look wrong, then use “Save as alarm” to have the CMS watch for them — or start one from New alarm above.'
    },
    listLabel: { id: 'alarms.rules.listLabel', defaultMessage: 'Alarms' }
});

/** Props for {@link RuleList}. */
export type RuleListProps = {
    /** The rules to render. */
    rules: readonly AlarmRule[];
    /** The request failed — rendered instead of the empty state. */
    isError: boolean;
    /** Whether the caller holds `alarms:manage`. */
    canManage: boolean;
    /** Re-run this rule across its collection. */
    onRescan: (rule: AlarmRule) => void;
    /** Open this rule for editing. */
    onEdit: (rule: AlarmRule) => void;
    /** Delete this rule. */
    onDelete: (rule: AlarmRule) => void;
    /** Show this rule's findings. */
    onShowFindings: (rule: AlarmRule) => void;
    /** Ids of rules with a rescan in flight. */
    rescanningIds: ReadonlySet<string>;
};

/**
 * The workspace's rules, one card each.
 *
 * As with the findings list, `isError` gets its own state: "no rules" and
 * "could not load the rules" both render as nothing, and only one of them means
 * the workspace is unwatched.
 */
export function RuleList({
    rules,
    isError,
    canManage,
    onRescan,
    onEdit,
    onDelete,
    onShowFindings,
    rescanningIds
}: RuleListProps) {
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

    if (rules.length === 0) {
        return (
            <Alert>
                <Bell aria-hidden="true" />
                <AlertTitle>
                    {intl.formatMessage(messages.emptyTitle)}
                </AlertTitle>
                <AlertDescription>
                    {intl.formatMessage(messages.emptyBody)}
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <ul
            className="flex flex-col gap-3"
            aria-label={intl.formatMessage(messages.listLabel)}
        >
            {rules.map((rule) => (
                <RuleCard
                    key={rule.id}
                    rule={rule}
                    canManage={canManage}
                    isRescanning={rescanningIds.has(rule.id)}
                    onRescan={onRescan}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onShowFindings={onShowFindings}
                />
            ))}
        </ul>
    );
}
