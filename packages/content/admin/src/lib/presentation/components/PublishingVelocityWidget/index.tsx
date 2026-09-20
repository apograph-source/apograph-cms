import { defineMessages, useIntl } from 'react-intl';
import { TrendingUp } from 'lucide-react';
import {
    AreaTrend,
    WidgetCard,
    WidgetChip,
    type TrendPoint
} from '@orthacms/insights-admin';
import { useContentVelocity } from '../../../application/useContentInsights';

/** Intl descriptors for the velocity widget, co-located here. */
const messages = defineMessages({
    title: {
        id: 'content.insights.velocity.title',
        defaultMessage: 'Publishing velocity'
    },
    descriptionDay: {
        id: 'content.insights.velocity.descriptionDay',
        defaultMessage: 'Entries published per day'
    },
    descriptionWeek: {
        id: 'content.insights.velocity.descriptionWeek',
        defaultMessage: 'Entries published per week'
    },
    descriptionMonth: {
        id: 'content.insights.velocity.descriptionMonth',
        defaultMessage: 'Entries published per month'
    },
    chip: {
        id: 'content.insights.velocity.chip',
        defaultMessage: '{count, number} this period'
    },
    valueHeading: {
        id: 'content.insights.velocity.valueHeading',
        defaultMessage: 'Published'
    },
    ariaLabel: {
        id: 'content.insights.velocity.ariaLabel',
        defaultMessage:
            'Entries published over time, {total, number} in total across {points, number} periods.'
    }
});

/** Description per bucket width, so the subtitle matches what is plotted. */
const DESCRIPTION = {
    day: messages.descriptionDay,
    week: messages.descriptionWeek,
    month: messages.descriptionMonth
} as const;

/** Date format per bucket width. A month bucket labelled `12 Mar` reads wrong. */
const LABEL_FORMAT = {
    day: { day: 'numeric', month: 'short' },
    week: { day: 'numeric', month: 'short' },
    month: { month: 'short', year: '2-digit' }
} as const;

/**
 * Entries published per bucket across the selected range.
 *
 * The server chooses the bucket width from the range, and this widget takes it
 * from the response rather than re-deriving it — two places computing the same
 * rule is two places to get it wrong, and the axis would silently mislabel.
 */
export function PublishingVelocityWidget() {
    const intl = useIntl();
    const { data, isPending, isError } = useContentVelocity();

    const granularity = data?.granularity ?? 'week';
    const points: TrendPoint[] = (data?.points ?? []).map((point) => ({
        label: intl.formatDate(point.bucket, LABEL_FORMAT[granularity]),
        value: point.value
    }));
    const total = points.reduce((sum, point) => sum + point.value, 0);

    return (
        <WidgetCard
            title={intl.formatMessage(messages.title)}
            description={intl.formatMessage(DESCRIPTION[granularity])}
            action={
                total > 0 ? (
                    <WidgetChip tone="ok" icon={TrendingUp}>
                        {intl.formatMessage(messages.chip, { count: total })}
                    </WidgetChip>
                ) : undefined
            }
            isPending={isPending}
            isError={isError}
            isEmpty={points.length === 0}
            skeletonRows={6}
        >
            <AreaTrend
                points={points}
                valueHeading={intl.formatMessage(messages.valueHeading)}
                ariaLabel={intl.formatMessage(messages.ariaLabel, {
                    total,
                    points: points.length
                })}
            />
        </WidgetCard>
    );
}
