import { defineMessages, useIntl } from 'react-intl';
import { AlertCircle } from 'lucide-react';
import {
    BarRows,
    WidgetCard,
    WidgetChip,
    type BarRowSpec,
    type ChartTone
} from '@orthacms/insights-admin';
import { useContentStale } from '../../../application/useContentInsights';

/** Intl descriptors for the stale-content widget, co-located here. */
const messages = defineMessages({
    title: {
        id: 'content.insights.stale.title',
        defaultMessage: 'Gone quiet'
    },
    description: {
        id: 'content.insights.stale.description',
        defaultMessage: 'Published entries by time since last edit'
    },
    chip: {
        id: 'content.insights.stale.chip',
        defaultMessage: '{count, number} over a year'
    },
    footer: {
        id: 'content.insights.stale.footer',
        defaultMessage: 'Colour intensifies with age.'
    },
    d30: { id: 'content.insights.stale.d30', defaultMessage: 'Under 30 days' },
    d90: { id: 'content.insights.stale.d90', defaultMessage: '31 – 90 days' },
    d180: {
        id: 'content.insights.stale.d180',
        defaultMessage: '91 – 180 days'
    },
    d365: {
        id: 'content.insights.stale.d365',
        defaultMessage: '181 – 365 days'
    },
    older: {
        id: 'content.insights.stale.older',
        defaultMessage: 'Over a year'
    },
    tip: {
        id: 'content.insights.stale.tip',
        defaultMessage: '{bucket} — {count, number} entries ({percent}%)'
    }
});

/**
 * Bucket ids in display order, each pinned to a ramp step.
 *
 * The tone is assigned by **bucket**, not by size: the ramp encodes age, so the
 * oldest bucket keeps the deepest step even when it holds the fewest entries.
 * Ordering the colours by count instead would make the ramp mean nothing.
 */
const BUCKETS: { id: keyof typeof messages & string; tone: ChartTone }[] = [
    { id: 'd30', tone: 'q1' },
    { id: 'd90', tone: 'q2' },
    { id: 'd180', tone: 'q3' },
    { id: 'd365', tone: 'q4' },
    { id: 'older', tone: 'q5' }
];

/**
 * Published entries grouped by how long they have sat untouched — the page's
 * "what needs attention" widget.
 */
export function StaleEntriesWidget() {
    const intl = useIntl();
    const { data, isPending, isError } = useContentStale();

    const total = data?.total ?? 0;
    const counts = new Map(
        (data?.buckets ?? []).map((bucket) => [bucket.id, bucket.count])
    );
    const overAYear = counts.get('older') ?? 0;

    // Bars are scaled against the largest bucket, not the total: with five
    // buckets summing to 100%, scaling by total would leave every bar stubby
    // and the differences between them unreadable.
    const max = Math.max(...counts.values(), 0);

    const rows: BarRowSpec[] = BUCKETS.map((bucket) => {
        const count = counts.get(bucket.id) ?? 0;
        const percent = total > 0 ? Math.round((count / total) * 100) : 0;
        const label = intl.formatMessage(messages[bucket.id]);
        return {
            id: bucket.id,
            label,
            segments: [
                {
                    id: bucket.id,
                    value: count,
                    tone: bucket.tone,
                    label: intl.formatMessage(messages.tip, {
                        bucket: label,
                        count,
                        percent
                    })
                }
            ],
            readout: intl.formatNumber(count),
            secondary: `${percent}%`
        };
    });

    return (
        <WidgetCard
            title={intl.formatMessage(messages.title)}
            description={intl.formatMessage(messages.description)}
            action={
                overAYear > 0 ? (
                    <WidgetChip tone="warn" icon={AlertCircle}>
                        {intl.formatMessage(messages.chip, {
                            count: overAYear
                        })}
                    </WidgetChip>
                ) : undefined
            }
            footer={intl.formatMessage(messages.footer)}
            isPending={isPending}
            isError={isError}
            isEmpty={total === 0}
            skeletonRows={5}
        >
            <BarRows rows={rows} max={max} />
        </WidgetCard>
    );
}
