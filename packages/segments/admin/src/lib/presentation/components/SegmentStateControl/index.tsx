import { defineMessages, useIntl } from 'react-intl';
import {
    SegmentedControl,
    SegmentedControlItem
} from '@orthacms/design-system';
import { SEGMENT_STATE, type SegmentState } from '../../../domain/types';

const messages = defineMessages({
    label: {
        id: 'segments.state.label',
        defaultMessage: 'Access for {name}'
    },
    unset: { id: 'segments.state.unset', defaultMessage: 'Not set' },
    allow: { id: 'segments.state.allow', defaultMessage: 'Can see' },
    deny: { id: 'segments.state.deny', defaultMessage: 'Cannot see' }
});

/** Props for {@link SegmentStateControl}. */
type SegmentStateControlProps = {
    /** The segment this row is about — used for the accessible name. */
    name: string;
    /** What it is set to. */
    value: SegmentState;
    /** Sets it. */
    onChange: (state: SegmentState) => void;
    /** Whether the caller may change it. */
    disabled: boolean;
};

/**
 * The one control this whole feature is for: what a segment may do with an
 * entry.
 *
 * **Three states, not a checkbox.** "Not set" is a real, distinct answer — a
 * segment nobody mentioned reads the entry when nothing else is allowed, and
 * does not when something else is. A two-state control would make those two
 * outcomes look identical on screen and leave "not mentioned" unreachable once
 * a row had been touched.
 *
 * A segmented control rather than a dropdown because all three answers matter
 * and there are exactly three: the current one is legible without opening
 * anything, and changing it is one click rather than two.
 */
export function SegmentStateControl({
    name,
    value,
    onChange,
    disabled
}: SegmentStateControlProps) {
    const intl = useIntl();

    return (
        <SegmentedControl
            value={value}
            disabled={disabled}
            aria-label={intl.formatMessage(messages.label, { name })}
            onValueChange={(next) => {
                // Radix clears the value when the pressed item is re-selected;
                // an empty string there means "unchanged", not "unset".
                if (next) onChange(next as SegmentState);
            }}
        >
            <SegmentedControlItem value={SEGMENT_STATE.Unset}>
                {intl.formatMessage(messages.unset)}
            </SegmentedControlItem>
            <SegmentedControlItem value={SEGMENT_STATE.Allow}>
                {intl.formatMessage(messages.allow)}
            </SegmentedControlItem>
            <SegmentedControlItem value={SEGMENT_STATE.Deny}>
                {intl.formatMessage(messages.deny)}
            </SegmentedControlItem>
        </SegmentedControl>
    );
}
