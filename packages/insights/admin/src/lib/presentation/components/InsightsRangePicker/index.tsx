import { defineMessages, useIntl } from 'react-intl';
import {
    SegmentedControl,
    SegmentedControlItem
} from '@orthacms/design-system';
import {
    INSIGHTS_RANGES,
    useInsightsRange,
    type InsightsRange
} from '../../../hooks/useInsightsRange';

/** Intl descriptors for the range picker, co-located here. */
const messages = defineMessages({
    label: {
        id: 'insights.range.label',
        defaultMessage: 'Time range'
    }
});

/** The unit each short label abbreviates, read only by assistive tech. */
const unitMessages = defineMessages({
    days: { id: 'insights.range.unit.days', defaultMessage: 'days' },
    months: { id: 'insights.range.unit.months', defaultMessage: 'months' }
});

/** Compact visible labels — the control is narrow. */
const SHORT_LABEL: Record<InsightsRange, string> = {
    '7d': '7d',
    '30d': '30d',
    '90d': '90d',
    '12m': '12m'
};

/**
 * The unit the short label abbreviates, added as `sr-only` text rather than an
 * `aria-label`.
 *
 * `2.5.3 Label in Name` requires the accessible name to **contain** the
 * visible one. An `aria-label` of "90 days" replaced the visible "90d"
 * outright, so a speech-input user saying "click 90d" matched nothing — and
 * the rule that would have caught it (`label-content-name-mismatch`) is
 * best-practice, excluded from the harness's WCAG tag set. Composing the name
 * out of the visible text plus a hidden suffix gives "90d days": still spoken
 * in full, and still containing what is on screen.
 */
const UNIT_SUFFIX: Record<InsightsRange, keyof typeof unitMessages> = {
    '7d': 'days',
    '30d': 'days',
    '90d': 'days',
    '12m': 'months'
};

/**
 * Selects the window every widget on the page reports against.
 *
 * One picker for the whole page rather than per widget: a dashboard where each
 * card covers a different period invites false comparisons between them.
 */
export function InsightsRangePicker() {
    const intl = useIntl();
    const { range, setRange } = useInsightsRange();

    return (
        <SegmentedControl
            value={range}
            onValueChange={(next) => {
                // Radix clears the value when the active item is re-pressed;
                // an empty selection would leave widgets with no window at all.
                if (next) setRange(next as InsightsRange);
            }}
            aria-label={intl.formatMessage(messages.label)}
        >
            {INSIGHTS_RANGES.map((option) => (
                <SegmentedControlItem key={option} value={option}>
                    {SHORT_LABEL[option]}
                    <span className="sr-only">
                        {' '}
                        {intl.formatMessage(unitMessages[UNIT_SUFFIX[option]])}
                    </span>
                </SegmentedControlItem>
            ))}
        </SegmentedControl>
    );
}
