import { defineMessages, useIntl } from 'react-intl';
import { AlertCircle, Check } from 'lucide-react';
import {
    WidgetCard,
    WidgetChip,
    toneBackground
} from '@orthacms/insights-admin';
import { useMediaAltCoverage } from '../../hooks/useMediaInsights';

/** Intl descriptors for the alt-text widget, co-located here. */
const messages = defineMessages({
    title: {
        id: 'media.insights.alt.title',
        defaultMessage: 'Images missing alt text'
    },
    description: {
        id: 'media.insights.alt.description',
        defaultMessage: 'Accessibility debt in the library'
    },
    covered: {
        id: 'media.insights.alt.covered',
        defaultMessage: 'All covered'
    },
    share: {
        id: 'media.insights.alt.share',
        defaultMessage: '{percent}% uncovered'
    },
    summary: {
        id: 'media.insights.alt.summary',
        defaultMessage: 'of {images, number} images'
    },
    hasAlt: {
        id: 'media.insights.alt.hasAlt',
        defaultMessage: 'Has alt · {count, number}'
    },
    missing: {
        id: 'media.insights.alt.missing',
        defaultMessage: 'Missing · {count, number}'
    },
    meter: {
        id: 'media.insights.alt.meter',
        defaultMessage:
            '{percent}% of images have alt text; {missing, number} do not.'
    }
});

/**
 * How many of the workspace's images carry alt text.
 *
 * The missing count is the headline rather than the coverage percentage: "794
 * images need alt text" is a job someone can pick up, where "68% covered" is a
 * score. The meter carries the proportion for context.
 */
export function MediaAltTextWidget() {
    const intl = useIntl();
    const { data, isPending, isError } = useMediaAltCoverage();

    const images = data?.images ?? 0;
    const missing = data?.missing ?? 0;
    const withAlt = data?.withAlt ?? 0;
    const missingPercent =
        images > 0 ? Math.round((missing / images) * 100) : 0;
    const coveredPercent = 100 - missingPercent;

    return (
        <WidgetCard
            title={intl.formatMessage(messages.title)}
            description={intl.formatMessage(messages.description)}
            action={
                missing === 0 ? (
                    <WidgetChip tone="ok" icon={Check}>
                        {intl.formatMessage(messages.covered)}
                    </WidgetChip>
                ) : (
                    <WidgetChip tone="warn" icon={AlertCircle}>
                        {intl.formatMessage(messages.share, {
                            percent: missingPercent
                        })}
                    </WidgetChip>
                )
            }
            isPending={isPending}
            isError={isError}
            isEmpty={images === 0}
            skeletonRows={3}
        >
            <div className="flex flex-col gap-3">
                <div>
                    <div className="text-3xl font-semibold tracking-[-0.025em] tabular-nums">
                        {intl.formatNumber(missing)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                        {intl.formatMessage(messages.summary, { images })}
                    </div>
                </div>

                <div
                    className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={intl.formatMessage(messages.meter, {
                        percent: coveredPercent,
                        missing
                    })}
                >
                    <span
                        className={`block rounded-full ${toneBackground('series-1')}`}
                        style={{ width: `${coveredPercent}%` }}
                    />
                    <span
                        className="block rounded-full bg-warning"
                        style={{ width: `${missingPercent}%` }}
                    />
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                        <span
                            className={`block size-2 rounded-[2px] ${toneBackground('series-1')}`}
                        />
                        {intl.formatMessage(messages.hasAlt, {
                            count: withAlt
                        })}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="block size-2 rounded-[2px] bg-warning" />
                        {intl.formatMessage(messages.missing, {
                            count: missing
                        })}
                    </span>
                </div>
            </div>
        </WidgetCard>
    );
}
