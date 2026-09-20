import { defineMessages, useIntl } from 'react-intl';
import { Check, PencilLine } from 'lucide-react';
import {
    BarRows,
    WidgetCard,
    WidgetChip,
    type BarRowSpec
} from '@orthacms/insights-admin';
import { useContentUnshipped } from '../../../application/useContentInsights';

/** Intl descriptors for the unshipped-changes widget, co-located here. */
const messages = defineMessages({
    title: {
        id: 'content.insights.unshipped.title',
        defaultMessage: 'Waiting to go live'
    },
    description: {
        id: 'content.insights.unshipped.description',
        defaultMessage: 'Published records carrying unpublished edits'
    },
    shipped: {
        id: 'content.insights.unshipped.shipped',
        defaultMessage: 'All shipped'
    },
    share: {
        id: 'content.insights.unshipped.share',
        defaultMessage: '{percent}% of live'
    },
    summary: {
        id: 'content.insights.unshipped.summary',
        defaultMessage:
            'of {live, number} {live, plural, one {live record} other {live records}}'
    },
    drafts: {
        id: 'content.insights.unshipped.drafts',
        defaultMessage:
            '{count, number} never-published {count, plural, one {draft} other {drafts}} besides these.'
    },
    none: {
        id: 'content.insights.unshipped.none',
        defaultMessage: 'Everything live is up to date.'
    },
    row: {
        id: 'content.insights.unshipped.row',
        defaultMessage: '{type} — {count, number} with unpublished edits'
    }
});

/**
 * Records that are live but whose live version is behind what an editor saved.
 *
 * This is the one state the CMS stores as two values and displays as three: a
 * save on a published record moves it back to `draft` while `published_at`
 * survives, so `status` alone would count these with drafts nobody ever
 * shipped. Those are opposite jobs — one is finishing a piece of writing, this
 * one is pressing publish — so the never-published count is a footnote rather
 * than part of the headline.
 *
 * The denominator is **live records**, not every record. "12 of 340 live
 * records have pending edits" is a backlog someone can clear; the same 12
 * against a workspace's whole content set says nothing about how far behind
 * the site is.
 */
export function UnshippedChangesWidget() {
    const intl = useIntl();
    const { data, isPending, isError } = useContentUnshipped();

    const modified = data?.modified ?? 0;
    const live = data?.live ?? 0;
    const neverPublished = data?.neverPublished ?? 0;
    const types = data?.types ?? [];
    const percent = live > 0 ? Math.round((modified / live) * 100) : 0;
    const max = Math.max(...types.map((type) => type.modified), 0);

    const rows: BarRowSpec[] = types.map((type) => ({
        id: type.name,
        label: type.label,
        segments: [
            {
                id: 'modified',
                value: type.modified,
                tone: 'series-2',
                label: intl.formatMessage(messages.row, {
                    type: type.label,
                    count: type.modified
                })
            }
        ],
        readout: intl.formatNumber(type.modified)
    }));

    return (
        <WidgetCard
            title={intl.formatMessage(messages.title)}
            description={intl.formatMessage(messages.description)}
            action={
                modified === 0 ? (
                    <WidgetChip tone="ok" icon={Check}>
                        {intl.formatMessage(messages.shipped)}
                    </WidgetChip>
                ) : (
                    <WidgetChip tone="warn" icon={PencilLine}>
                        {intl.formatMessage(messages.share, { percent })}
                    </WidgetChip>
                )
            }
            footer={
                neverPublished > 0
                    ? intl.formatMessage(messages.drafts, {
                          count: neverPublished
                      })
                    : undefined
            }
            isPending={isPending}
            isError={isError}
            // Nothing has ever gone live, so there is no such thing as a
            // pending edit yet — distinct from "0 pending", which is a real and
            // reassuring answer about a workspace that publishes.
            isEmpty={live === 0}
            skeletonRows={3}
        >
            <div className="flex flex-col gap-3">
                <div>
                    <div className="text-3xl font-semibold tracking-[-0.025em] tabular-nums">
                        {intl.formatNumber(modified)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                        {intl.formatMessage(messages.summary, { live })}
                    </div>
                </div>

                {rows.length > 0 ? (
                    <BarRows rows={rows} max={max} />
                ) : (
                    <p className="text-xs text-muted-foreground">
                        {intl.formatMessage(messages.none)}
                    </p>
                )}
            </div>
        </WidgetCard>
    );
}
