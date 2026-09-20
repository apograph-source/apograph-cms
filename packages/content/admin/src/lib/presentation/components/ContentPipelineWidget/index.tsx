import { defineMessages, useIntl } from 'react-intl';
import {
    BarRows,
    WidgetCard,
    toneBackground,
    type BarRowSpec
} from '@orthacms/insights-admin';
import { useContentPipeline } from '../../../application/useContentInsights';

/** Intl descriptors for the pipeline widget, co-located here. */
const messages = defineMessages({
    title: {
        id: 'content.insights.pipeline.title',
        defaultMessage: 'Draft and published, by type'
    },
    description: {
        id: 'content.insights.pipeline.description',
        defaultMessage: "Where the workspace's weight sits"
    },
    published: {
        id: 'content.insights.pipeline.published',
        defaultMessage: 'Published'
    },
    drafts: {
        id: 'content.insights.pipeline.drafts',
        defaultMessage: 'Draft'
    },
    tipPublished: {
        id: 'content.insights.pipeline.tipPublished',
        defaultMessage: '{type} — {count, number} published'
    },
    tipDrafts: {
        id: 'content.insights.pipeline.tipDrafts',
        defaultMessage: '{type} — {count, number} draft'
    }
});

/**
 * The draft/published split for each content type that has entries.
 *
 * The two series are the only categorical pair in the palette, and both counts
 * are printed in the readout column rather than inside the fills — a small draft
 * segment can be a couple of pixels wide, far too narrow to carry a number, and
 * pushing the label outside keeps every row legible regardless of the split.
 */
export function ContentPipelineWidget() {
    const intl = useIntl();
    const { data, isPending, isError } = useContentPipeline();

    const types = data?.types ?? [];
    const max = Math.max(
        ...types.map((type) => type.published + type.drafts),
        0
    );

    const rows: BarRowSpec[] = types.map((type) => ({
        id: type.name,
        label: type.label,
        segments: [
            {
                id: 'published',
                value: type.published,
                tone: 'series-1',
                label: intl.formatMessage(messages.tipPublished, {
                    type: type.label,
                    count: type.published
                })
            },
            {
                id: 'drafts',
                value: type.drafts,
                tone: 'series-2',
                label: intl.formatMessage(messages.tipDrafts, {
                    type: type.label,
                    count: type.drafts
                })
            }
        ],
        readout: (
            <>
                {intl.formatNumber(type.published)}
                <span className="text-muted-foreground">
                    {' / '}
                    {intl.formatNumber(type.drafts)}
                </span>
            </>
        )
    }));

    return (
        <WidgetCard
            title={intl.formatMessage(messages.title)}
            description={intl.formatMessage(messages.description)}
            isPending={isPending}
            isError={isError}
            isEmpty={types.length === 0}
            skeletonRows={5}
        >
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                        <span
                            className={`block size-2 rounded-[2px] ${toneBackground('series-1')}`}
                        />
                        {intl.formatMessage(messages.published)}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span
                            className={`block size-2 rounded-[2px] ${toneBackground('series-2')}`}
                        />
                        {intl.formatMessage(messages.drafts)}
                    </span>
                </div>
                <BarRows rows={rows} max={max} />
            </div>
        </WidgetCard>
    );
}
