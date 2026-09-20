import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    ConfirmDialog,
    Container,
    ContainerHeader,
    SegmentedControl,
    SegmentedControlCount,
    SegmentedControlItem,
    toast
} from '@orthacms/design-system';
import { useHasPermission } from '@orthacms/identity-admin';
import { PageTopBar } from '@orthacms/shell-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { BellRing, Plus } from 'lucide-react';
import { useAlarmRules } from '../../../application/useAlarmRules';
import { useAlarmSummary } from '../../../application/useAlarmSummary';
import {
    useDeleteAlarmRule,
    useRescanAlarmRule
} from '../../../application/useAlarmRuleMutations';
import type { AlarmRule } from '../../../types/alarm';
import { AlarmsNoAccess } from '../../components/AlarmsNoAccess';
import { AlarmsSkeleton } from '../../components/AlarmsSkeleton';
import { FindingGroupList } from '../../components/FindingGroupList';
import { RuleList } from '../../components/RuleList';

const messages = defineMessages({
    title: { id: 'alarms.page.title', defaultMessage: 'Alarms' },
    subtitle: {
        id: 'alarms.page.subtitle',
        defaultMessage:
            'Rules that watch this workspace’s content. They flag problems; they never block a save or a publish.'
    },
    tabOpen: { id: 'alarms.page.tabOpen', defaultMessage: 'Flagged' },
    // "Alarms" rather than "Rules": the object a person creates here is an
    // alarm, and "rule" meant nothing outside this page — the records
    // toolbar's button was the complaint that surfaced it. It repeats the
    // section name, which is mild and unambiguous: the tab lists the alarms.
    tabRules: { id: 'alarms.page.tabRules', defaultMessage: 'Alarms' },
    tabsLabel: { id: 'alarms.page.tabsLabel', defaultMessage: 'Alarms view' },
    crumb: { id: 'alarms.page.crumb', defaultMessage: 'Alarms' },
    newAlarm: { id: 'alarms.page.newAlarm', defaultMessage: 'New alarm' },
    rescanned: {
        id: 'alarms.page.rescanned',
        defaultMessage:
            '{name}: checked {scanned}, {open, plural, =0 {nothing flagged} one {# flagged} other {# flagged}}, {resolved} cleared.'
    },
    rescanFailed: {
        id: 'alarms.page.rescanFailed',
        defaultMessage: 'The check failed: {reason}'
    },
    deleteTitle: {
        id: 'alarms.page.deleteTitle',
        defaultMessage: 'Delete this alarm?'
    },
    deleteBody: {
        id: 'alarms.page.deleteBody',
        defaultMessage:
            '“{name}” and everything it has flagged will be removed. Records themselves are untouched.'
    },
    deleteConfirm: {
        id: 'alarms.page.deleteConfirm',
        defaultMessage: 'Delete alarm'
    },
    deleted: { id: 'alarms.page.deleted', defaultMessage: 'Alarm deleted.' }
});

/** Which of the three views the page is showing. */
type AlarmsTab = 'open' | 'rules';

/**
 * The workspace's alarms: what is flagged, what has been silenced, and the
 * rules behind both.
 *
 * Findings are grouped **by rule** rather than by record, because that is how
 * they get fixed — an editor handed "fourteen articles link to a draft author"
 * does one pass, while fourteen separate rows about fourteen articles is
 * fourteen context switches.
 */
export function AlarmsPage() {
    const intl = useIntl();
    const navigate = useNavigate();
    const workspace = useCurrentWorkspace();
    const canRead = useHasPermission('alarms:read');
    const canManage = useHasPermission('alarms:manage');

    const [tab, setTab] = useState<AlarmsTab>('open');
    // Which alarm's group to open on arrival, set by an alarm card's "N records
    // flagged". Not a filter any more: grouping already separates the alarms,
    // so narrowing to one would hide the rest for no gain.
    const [focusRuleId, setFocusRuleId] = useState<string | undefined>();
    const [pendingDelete, setPendingDelete] = useState<AlarmRule | null>(null);
    const [rescanning, setRescanning] = useState<ReadonlySet<string>>(
        () => new Set()
    );

    const summary = useAlarmSummary(canRead);
    const rules = useAlarmRules(canRead);

    const rescan = useRescanAlarmRule();
    const remove = useDeleteAlarmRule();

    const crumbs = [
        { key: 'alarms', label: intl.formatMessage(messages.crumb) }
    ];

    if (!canRead) {
        return (
            <>
                <PageTopBar icon={BellRing} crumbs={crumbs} />
                <Container>
                    <ContainerHeader
                        title={intl.formatMessage(messages.title)}
                        subtitle={intl.formatMessage(messages.subtitle)}
                    />
                    <AlarmsNoAccess />
                </Container>
            </>
        );
    }

    if (summary.isPending && rules.isPending) return <AlarmsSkeleton />;

    const onRescan = (rule: AlarmRule) => {
        setRescanning((current) => new Set(current).add(rule.id));
        rescan.mutate(rule.id, {
            onSuccess: (result) =>
                toast.success(
                    intl.formatMessage(messages.rescanned, {
                        name: rule.name,
                        scanned: result.scanned,
                        open: result.open,
                        resolved: result.resolved
                    })
                ),
            onError: (error) =>
                toast.error(
                    intl.formatMessage(messages.rescanFailed, {
                        reason: (error as Error).message
                    })
                ),
            onSettled: () =>
                setRescanning((current) => {
                    const next = new Set(current);
                    next.delete(rule.id);
                    return next;
                })
        });
    };

    const showFindings = (rule: AlarmRule) => {
        setFocusRuleId(rule.id);
        setTab('open');
    };

    const openTotal = summary.data?.openTotal ?? 0;

    return (
        <>
            <PageTopBar icon={BellRing} crumbs={crumbs} />
            <Container>
                <ContainerHeader
                    title={intl.formatMessage(messages.title)}
                    subtitle={intl.formatMessage(messages.subtitle)}
                    actions={
                        canManage ? (
                            <Button
                                onClick={() =>
                                    navigate(
                                        `/workspaces/${workspace.id}/alarms/rules/new`
                                    )
                                }
                            >
                                <Plus />
                                {intl.formatMessage(messages.newAlarm)}
                            </Button>
                        ) : undefined
                    }
                />

                {/* The page's own vertical rhythm. `Container` sets padding but
                    no gap, and `ContainerHeader`'s `mb-6` is the only margin in
                    play — so without this the tab strip and whatever it selects
                    sat flush against each other and the page read as one
                    undifferentiated block. */}
                <div className="flex flex-col items-stretch gap-6">
                    <SegmentedControl
                        // `self-start`, because a flex column stretches its
                        // children: without it the tab strip spanned the full
                        // width of the page and read as a header band rather
                        // than as three tabs.
                        className="self-start"
                        aria-label={intl.formatMessage(messages.tabsLabel)}
                        value={tab}
                        onValueChange={(next) => {
                            setTab(next as AlarmsTab);
                            setFocusRuleId(undefined);
                        }}
                    >
                        <SegmentedControlItem value="open">
                            {intl.formatMessage(messages.tabOpen)}
                            <SegmentedControlCount>
                                {openTotal}
                            </SegmentedControlCount>
                        </SegmentedControlItem>
                        <SegmentedControlItem value="rules">
                            {intl.formatMessage(messages.tabRules)}
                            <SegmentedControlCount>
                                {rules.data?.length ?? 0}
                            </SegmentedControlCount>
                        </SegmentedControlItem>
                    </SegmentedControl>

                    {tab === 'rules' ? (
                        <RuleList
                            rules={rules.data ?? []}
                            isError={rules.isError}
                            canManage={canManage}
                            rescanningIds={rescanning}
                            onRescan={onRescan}
                            onEdit={(rule) =>
                                navigate(
                                    `/workspaces/${workspace.id}/alarms/rules/${rule.id}`
                                )
                            }
                            onDelete={setPendingDelete}
                            onShowFindings={showFindings}
                        />
                    ) : (
                        <FindingGroupList
                            rules={rules.data ?? []}
                            isError={rules.isError}
                            canManage={canManage}
                            onRescan={onRescan}
                            rescanningIds={rescanning}
                            onCreate={
                                canManage
                                    ? () =>
                                          navigate(
                                              `/workspaces/${workspace.id}/alarms/rules/new`
                                          )
                                    : undefined
                            }
                            focusRuleId={focusRuleId}
                        />
                    )}
                </div>

                <ConfirmDialog
                    open={pendingDelete !== null}
                    onOpenChange={(next) => {
                        if (!next) setPendingDelete(null);
                    }}
                    title={intl.formatMessage(messages.deleteTitle)}
                    description={intl.formatMessage(messages.deleteBody, {
                        name: pendingDelete?.name ?? ''
                    })}
                    confirmLabel={intl.formatMessage(messages.deleteConfirm)}
                    confirmVariant="destructive"
                    onConfirm={() => {
                        if (!pendingDelete) return;
                        remove.mutate(pendingDelete.id, {
                            onSuccess: () =>
                                toast.success(
                                    intl.formatMessage(messages.deleted)
                                )
                        });
                        setPendingDelete(null);
                    }}
                />
            </Container>
        </>
    );
}
