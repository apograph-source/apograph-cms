import { defineMessages, useIntl } from 'react-intl';
import {
    Alert,
    AlertDescription,
    AlertTitle,
    Badge,
    Button,
    Spinner
} from '@orthacms/design-system';
import { Pencil, RefreshCw, TriangleAlert, Trash2 } from 'lucide-react';
import type { AlarmRule } from '../../../../types/alarm';
import { SeverityBadge } from '../../SeverityBadge';

const messages = defineMessages({
    open: {
        id: 'alarms.rule.open',
        defaultMessage:
            '{count, plural, =0 {Nothing flagged} one {# record flagged} other {# records flagged}}'
    },
    disabled: { id: 'alarms.rule.disabled', defaultMessage: 'Off' },
    lastScan: {
        id: 'alarms.rule.lastScan',
        defaultMessage: 'Last checked {date}'
    },
    neverScanned: {
        id: 'alarms.rule.neverScanned',
        defaultMessage: 'Not checked yet'
    },
    brokenTitle: {
        id: 'alarms.rule.brokenTitle',
        defaultMessage: 'This alarm no longer matches the content type'
    },
    brokenBody: {
        id: 'alarms.rule.brokenBody',
        defaultMessage:
            'It is not being evaluated, so it is reporting nothing rather than reporting all clear. Edit the condition to fix it. ({reason})'
    },
    rescan: { id: 'alarms.rule.rescan', defaultMessage: 'Check now' },
    rescanLabel: {
        id: 'alarms.rule.rescanLabel',
        defaultMessage: 'Check “{name}” across its collection now'
    },
    edit: { id: 'alarms.rule.edit', defaultMessage: 'Edit' },
    editLabel: { id: 'alarms.rule.editLabel', defaultMessage: 'Edit “{name}”' },
    remove: { id: 'alarms.rule.remove', defaultMessage: 'Delete' },
    removeLabel: {
        id: 'alarms.rule.removeLabel',
        defaultMessage: 'Delete “{name}”'
    },
    showFindings: {
        id: 'alarms.rule.showFindings',
        defaultMessage: 'Show flagged records'
    }
});

/** Props for {@link RuleCard}. */
export type RuleCardProps = {
    /** The rule this card is about. */
    rule: AlarmRule;
    /** Whether the caller holds `alarms:manage`. */
    canManage: boolean;
    /** A rescan of this rule is in flight. */
    isRescanning: boolean;
    onRescan: (rule: AlarmRule) => void;
    onEdit: (rule: AlarmRule) => void;
    onDelete: (rule: AlarmRule) => void;
    onShowFindings: (rule: AlarmRule) => void;
};

/**
 * One rule: what it watches, how much it currently flags, and whether it is
 * actually working.
 *
 * That last part is the reason the card exists rather than a table row. A rule
 * whose stored condition stopped parsing is **not evaluated**, and it looks
 * exactly like a rule that found nothing — so the broken state is called out in
 * full, in place, rather than reduced to an icon.
 */
export function RuleCard({
    rule,
    canManage,
    isRescanning,
    onRescan,
    onEdit,
    onDelete,
    onShowFindings
}: RuleCardProps) {
    const intl = useIntl();

    return (
        <li className="flex flex-col gap-3 rounded-md border p-4">
            <div className="flex flex-wrap items-start gap-3">
                <SeverityBadge severity={rule.severity} className="mt-0.5" />

                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-medium">{rule.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                        {rule.contentType}
                        {rule.description ? ` · ${rule.description}` : ''}
                    </span>
                    <span className="text-xs text-muted-foreground">
                        {rule.lastScanAt
                            ? intl.formatMessage(messages.lastScan, {
                                  date: intl.formatDate(rule.lastScanAt, {
                                      dateStyle: 'medium',
                                      timeStyle: 'short'
                                  })
                              })
                            : intl.formatMessage(messages.neverScanned)}
                    </span>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {rule.enabled ? null : (
                        <Badge variant="outline">
                            {intl.formatMessage(messages.disabled)}
                        </Badge>
                    )}
                    <Button
                        variant={rule.openCount > 0 ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => onShowFindings(rule)}
                        aria-label={intl.formatMessage(messages.showFindings)}
                    >
                        {intl.formatMessage(messages.open, {
                            count: rule.openCount
                        })}
                    </Button>
                </div>
            </div>

            {rule.brokenReason ? (
                <Alert variant="destructive">
                    <TriangleAlert aria-hidden="true" />
                    <AlertTitle>
                        {intl.formatMessage(messages.brokenTitle)}
                    </AlertTitle>
                    <AlertDescription>
                        {intl.formatMessage(messages.brokenBody, {
                            reason: rule.brokenReason
                        })}
                    </AlertDescription>
                </Alert>
            ) : null}

            {canManage ? (
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={isRescanning}
                        onClick={() => onRescan(rule)}
                        aria-label={intl.formatMessage(messages.rescanLabel, {
                            name: rule.name
                        })}
                    >
                        {isRescanning ? (
                            <Spinner />
                        ) : (
                            <RefreshCw aria-hidden="true" />
                        )}
                        {intl.formatMessage(messages.rescan)}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(rule)}
                        aria-label={intl.formatMessage(messages.editLabel, {
                            name: rule.name
                        })}
                    >
                        <Pencil aria-hidden="true" />
                        {intl.formatMessage(messages.edit)}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(rule)}
                        aria-label={intl.formatMessage(messages.removeLabel, {
                            name: rule.name
                        })}
                    >
                        <Trash2 aria-hidden="true" />
                        {intl.formatMessage(messages.remove)}
                    </Button>
                </div>
            ) : null}
        </li>
    );
}
