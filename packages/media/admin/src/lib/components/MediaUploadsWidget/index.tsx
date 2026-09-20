import { defineMessages, useIntl } from 'react-intl';
import {
    ColumnTrend,
    WidgetCard,
    type TrendPoint
} from '@orthacms/insights-admin';
import { useMediaUploads } from '../../hooks/useMediaInsights';

/** Intl descriptors for the uploads widget, co-located here. */
const messages = defineMessages({
    title: {
        id: 'media.insights.uploads.title',
        defaultMessage: 'Uploads'
    },
    descriptionDay: {
        id: 'media.insights.uploads.descriptionDay',
        defaultMessage: 'Assets added per day'
    },
    descriptionWeek: {
        id: 'media.insights.uploads.descriptionWeek',
        defaultMessage: 'Assets added per week'
    },
    descriptionMonth: {
        id: 'media.insights.uploads.descriptionMonth',
        defaultMessage: 'Assets added per month'
    },
    tip: {
        id: 'media.insights.uploads.tip',
        defaultMessage: '{period} — {count, number} uploads'
    },
    ariaLabel: {
        id: 'media.insights.uploads.ariaLabel',
        defaultMessage:
            'Assets uploaded over time, {total, number} across {points, number} periods.'
    },
    footer: {
        id: 'media.insights.uploads.footer',
        defaultMessage: '{total, number} uploaded this period.'
    }
});

/** Description per bucket width, so the subtitle matches what is plotted. */
const DESCRIPTION = {
    day: messages.descriptionDay,
    week: messages.descriptionWeek,
    month: messages.descriptionMonth
} as const;

/** Date format per bucket width — a month bucket labelled `12 Mar` reads wrong. */
const LABEL_FORMAT = {
    day: { day: 'numeric', month: 'short' },
    week: { day: 'numeric', month: 'short' },
    month: { month: 'short', year: '2-digit' }
} as const;

/**
 * Assets added per time bucket. Columns rather than a line: uploads are discrete
 * tallies, and a line between two weekly counts would imply values that were
 * never measured.
 */
export function MediaUploadsWidget() {
    const intl = useIntl();
    const { data, isPending, isError } = useMediaUploads();

    const granularity = data?.granularity ?? 'week';
    const points: TrendPoint[] = (data?.points ?? []).map((point) => ({
        label: intl.formatDate(point.bucket, LABEL_FORMAT[granularity]),
        value: point.value
    }));

    return (
        <WidgetCard
            title={intl.formatMessage(messages.title)}
            description={intl.formatMessage(DESCRIPTION[granularity])}
            footer={intl.formatMessage(messages.footer, {
                total: data?.total ?? 0
            })}
            isPending={isPending}
            isError={isError}
            isEmpty={points.length === 0}
            skeletonRows={5}
        >
            <ColumnTrend
                points={points}
                ariaLabel={intl.formatMessage(messages.ariaLabel, {
                    total: data?.total ?? 0,
                    points: points.length
                })}
                describe={(point) =>
                    intl.formatMessage(messages.tip, {
                        period: point.label,
                        count: point.value
                    })
                }
            />
        </WidgetCard>
    );
}
