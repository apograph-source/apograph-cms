import { defineMessages, useIntl } from 'react-intl';
import {
    SegmentedControl,
    SegmentedControlItem
} from '@orthacms/design-system';

/** Which axis the coverage card breaks its bars down by. */
export type CoverageMode = 'locale' | 'type';

/** Intl descriptors for the mode toggle, co-located here. */
const messages = defineMessages({
    label: {
        id: 'i18n.insights.coverage.mode.label',
        defaultMessage: 'Break down by'
    },
    locale: {
        id: 'i18n.insights.coverage.mode.locale',
        defaultMessage: 'By language'
    },
    type: {
        id: 'i18n.insights.coverage.mode.type',
        defaultMessage: 'By type'
    }
});

/** Props for {@link CoverageModeToggle}. */
export type CoverageModeToggleProps = {
    /** The active axis. */
    value: CoverageMode;
    /** Called with the newly picked axis. */
    onChange: (mode: CoverageMode) => void;
};

/**
 * Switches the coverage card between its two breakdowns.
 *
 * They answer different questions off one payload — "which language is behind?"
 * and "which content type is the work in?" — so this is a view swap rather than
 * a second request or a second card. The headline figures above it are
 * workspace-wide and deliberately don't move when the axis does.
 */
export function CoverageModeToggle({
    value,
    onChange
}: CoverageModeToggleProps) {
    const intl = useIntl();

    return (
        <SegmentedControl
            value={value}
            onValueChange={(next) => {
                // Radix clears the value when the active item is re-pressed,
                // which would leave the card with no breakdown at all.
                if (next) onChange(next as CoverageMode);
            }}
            aria-label={intl.formatMessage(messages.label)}
        >
            <SegmentedControlItem value="locale">
                {intl.formatMessage(messages.locale)}
            </SegmentedControlItem>
            <SegmentedControlItem value="type">
                {intl.formatMessage(messages.type)}
            </SegmentedControlItem>
        </SegmentedControl>
    );
}
