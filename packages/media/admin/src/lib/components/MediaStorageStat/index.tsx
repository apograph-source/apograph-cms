import { defineMessages, useIntl } from 'react-intl';
import { StatWidget } from '@orthacms/insights-admin';
import { useMediaStorage } from '../../hooks/useMediaInsights';
import { formatBytes } from '../../utils/formatBytes';

/** Intl descriptors for the storage stat tile, co-located here. */
const messages = defineMessages({
    label: {
        id: 'media.insights.storage.label',
        defaultMessage: 'Media storage'
    },
    assets: {
        id: 'media.insights.storage.assets',
        defaultMessage: '{count, number} assets'
    }
});

/**
 * Total media storage for the workspace.
 *
 * `formatBytes` returns a value and its unit as one string, so the figure and
 * the unit are split here rather than passed to `unit` — keeping the number in
 * the tabular figure style while the unit stays secondary.
 */
export function MediaStorageStat() {
    const intl = useIntl();
    const { data, isPending, isError } = useMediaStorage();

    const [amount, unit] = formatBytes(data?.totalBytes ?? 0).split(' ');

    return (
        <StatWidget
            label={intl.formatMessage(messages.label)}
            value={amount}
            unit={unit}
            delta={intl.formatMessage(messages.assets, {
                count: data?.totalCount ?? 0
            })}
            deltaTone="flat"
            isPending={isPending}
            isError={isError}
        />
    );
}
