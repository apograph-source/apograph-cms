import { defineMessages, useIntl } from 'react-intl';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { WidgetCard } from '@orthacms/insights-admin';
import { useProtectionInsights } from '../../../application/hooks';

const messages = defineMessages({
    title: {
        id: 'protection.insights.title',
        defaultMessage: 'Waiting on review'
    },
    description: {
        id: 'protection.insights.description',
        defaultMessage: 'Open review requests in this workspace'
    },
    open: {
        id: 'protection.insights.open',
        defaultMessage: 'open'
    },
    overdue: {
        id: 'protection.insights.overdue',
        defaultMessage:
            '{count} waiting longer than {days, plural, one {# day} other {# days}}'
    },
    none: {
        id: 'protection.insights.none',
        defaultMessage: 'Nothing is waiting on a review.'
    }
});

/**
 * How much review is outstanding, and how much of it has waited too long.
 *
 * Half of Insights' widgets already report debts rather than achievements — a
 * stalled review is one more, and it belongs beside them rather than on a page
 * somebody would have to think to open.
 *
 * **The four-branch state ladder is `WidgetCard`'s, not this component's.**
 * That is the whole reason the shell owns it: a failed load rendered as an empty
 * state is the most misleading thing a dashboard can do here — "nothing is
 * waiting on a review" and "we could not ask" look identical and mean opposite
 * things, and the second one tells a reviewer they are free when they are not.
 *
 * The overdue threshold arrives **with** the figure rather than being restated
 * here, so the caption cannot come to say "3 days" over a number counted against
 * something else.
 */
export function ProtectionInsightsCard() {
    const intl = useIntl();
    const workspace = useCurrentWorkspace();
    const { data, isPending, isError } = useProtectionInsights(workspace.id);

    return (
        <WidgetCard
            title={intl.formatMessage(messages.title)}
            description={intl.formatMessage(messages.description)}
            isPending={isPending}
            isError={isError}
            isEmpty={!!data && data.open === 0}
            emptyMessage={intl.formatMessage(messages.none)}
            skeletonRows={2}
        >
            {data && (
                <div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-semibold tabular-nums">
                            {data.open}
                        </span>
                        <span className="text-muted-foreground text-sm">
                            {intl.formatMessage(messages.open)}
                        </span>
                    </div>
                    {data.overdue > 0 && (
                        // The count is in the sentence, not only in the tone: a
                        // warning colour alone says nothing to a reader who
                        // cannot see it, and "2 waiting longer than 3 days" is
                        // the whole fact anyway.
                        <p className="text-warning-soft-foreground mt-1 text-sm">
                            {intl.formatMessage(messages.overdue, {
                                count: data.overdue,
                                days: data.overdueAfterDays
                            })}
                        </p>
                    )}
                </div>
            )}
        </WidgetCard>
    );
}
