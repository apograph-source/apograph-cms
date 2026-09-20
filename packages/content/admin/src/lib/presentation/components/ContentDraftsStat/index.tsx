import { defineMessages, useIntl } from 'react-intl';
import { StatWidget } from '@orthacms/insights-admin';
import { useContentTotals } from '../../../application/useContentInsights';

/** Intl descriptors for the drafts stat tile, co-located here. */
const messages = defineMessages({
    label: {
        id: 'content.insights.drafts.label',
        defaultMessage: 'Drafts'
    },
    share: {
        id: 'content.insights.drafts.share',
        defaultMessage: '{percent}% of all entries'
    }
});

/**
 * Entries currently in draft.
 *
 * Carries a share of the total rather than a change figure. Nothing records
 * when an entry moves *back* to draft — `published_at` says when something went
 * live and never that it stopped — so a "+N this period" here would be a number
 * with no source behind it. The share is a fact we actually hold.
 */
export function ContentDraftsStat() {
    const intl = useIntl();
    const { data, isPending, isError } = useContentTotals();

    const drafts = data?.drafts ?? 0;
    const entries = data?.entries ?? 0;
    const percent = entries > 0 ? Math.round((drafts / entries) * 100) : 0;

    return (
        <StatWidget
            label={intl.formatMessage(messages.label)}
            value={intl.formatNumber(drafts)}
            delta={intl.formatMessage(messages.share, { percent })}
            deltaTone="flat"
            isPending={isPending}
            isError={isError}
        />
    );
}
