import { defineMessages, useIntl } from 'react-intl';
import { StatWidget } from '@orthacms/insights-admin';
import { useContentTotals } from '../../../application/useContentInsights';

/** Intl descriptors for the published stat tile, co-located here. */
const messages = defineMessages({
    label: {
        id: 'content.insights.published.label',
        defaultMessage: 'Published'
    },
    delta: {
        id: 'content.insights.published.delta',
        defaultMessage: '+{count, number} this period'
    },
    flat: {
        id: 'content.insights.published.flat',
        defaultMessage: 'Nothing published'
    }
});

/**
 * Entries currently live, with how many went live inside the selected range.
 *
 * Shares its query with the other content stat tiles — same key, so TanStack
 * Query issues one request for all three while each keeps its own loading and
 * error state.
 */
export function ContentPublishedStat() {
    const intl = useIntl();
    const { data, isPending, isError } = useContentTotals();

    const delta = data?.publishedDelta ?? 0;

    return (
        <StatWidget
            label={intl.formatMessage(messages.label)}
            value={intl.formatNumber(data?.published ?? 0)}
            delta={
                delta > 0
                    ? intl.formatMessage(messages.delta, { count: delta })
                    : intl.formatMessage(messages.flat)
            }
            deltaTone={delta > 0 ? 'up' : 'flat'}
            history={data?.publishedHistory}
            isPending={isPending}
            isError={isError}
        />
    );
}
