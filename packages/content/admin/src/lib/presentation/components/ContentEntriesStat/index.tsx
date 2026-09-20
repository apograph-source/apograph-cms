import { defineMessages, useIntl } from 'react-intl';
import { StatWidget } from '@orthacms/insights-admin';
import { useContentTotals } from '../../../application/useContentInsights';

/** Intl descriptors for the entries stat tile, co-located here. */
const messages = defineMessages({
    label: {
        id: 'content.insights.entries.label',
        defaultMessage: 'Entries'
    },
    delta: {
        id: 'content.insights.entries.delta',
        defaultMessage: '+{count, number} this period'
    },
    flat: {
        id: 'content.insights.entries.flat',
        defaultMessage: 'No new entries'
    }
});

/**
 * Total entries in the workspace, with the number created inside the selected
 * range and a sparkline of how the total got there.
 */
export function ContentEntriesStat() {
    const intl = useIntl();
    const { data, isPending, isError } = useContentTotals();

    const delta = data?.entriesDelta ?? 0;

    return (
        <StatWidget
            label={intl.formatMessage(messages.label)}
            value={intl.formatNumber(data?.entries ?? 0)}
            delta={
                delta > 0
                    ? intl.formatMessage(messages.delta, { count: delta })
                    : intl.formatMessage(messages.flat)
            }
            deltaTone={delta > 0 ? 'up' : 'flat'}
            history={data?.entriesHistory}
            isPending={isPending}
            isError={isError}
        />
    );
}
