import { useRef, type KeyboardEvent } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Check } from 'lucide-react';
import {
    AVATAR_COLORS,
    avatarColorVar,
    cn,
    type AvatarColor
} from '@orthacms/design-system';

const messages = defineMessages({
    label: {
        id: 'workspaces.create.basics.colorLabel',
        defaultMessage: 'Avatar color'
    },
    swatch: {
        id: 'workspaces.create.basics.colorSwatch',
        defaultMessage: 'Use the {color} accent'
    }
});

/** Props for {@link ColorSwatchRow}. */
export type ColorSwatchRowProps = {
    /** Currently selected accent. */
    value: AvatarColor;
    /** Called when a swatch is chosen. */
    onChange: (color: AvatarColor) => void;
};

/**
 * The accent-color picker for the basics step: a single-select row of the
 * shared avatar palette, exposed as a radio group for keyboard + screen-reader
 * users. The selected swatch shows a check.
 *
 * It implements the **roving tabindex** the `radiogroup` role promises: the
 * group is a single tab stop (only the checked swatch is tabbable) and ←/→/↑/↓
 * move the selection, wrapping, with Home/End jumping to the ends. Without that
 * the role was a promise the widget didn't keep — seven separate tab stops, and
 * arrow keys that did nothing for the screen-reader users the role tells to
 * reach for them.
 */
export function ColorSwatchRow({ value, onChange }: ColorSwatchRowProps) {
    const intl = useIntl();
    const label = intl.formatMessage(messages.label);
    const refs = useRef<(HTMLButtonElement | null)[]>([]);

    // Moving the selection also moves focus, which is what a radio group does:
    // arrowing through the options *is* choosing between them.
    const move = (from: number, delta: number) => {
        const next =
            (from + delta + AVATAR_COLORS.length) % AVATAR_COLORS.length;
        onChange(AVATAR_COLORS[next]);
        refs.current[next]?.focus();
    };

    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, i: number) => {
        const jump: Record<string, number | undefined> = {
            ArrowRight: 1,
            ArrowDown: 1,
            ArrowLeft: -1,
            ArrowUp: -1
        };
        const delta = jump[event.key];
        if (delta !== undefined) {
            event.preventDefault();
            move(i, delta);
            return;
        }
        if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            const target = event.key === 'Home' ? 0 : AVATAR_COLORS.length - 1;
            onChange(AVATAR_COLORS[target]);
            refs.current[target]?.focus();
        }
    };

    // A group with nothing selected still needs one reachable stop, or Tab
    // would skip the control entirely.
    const activeIndex = Math.max(0, AVATAR_COLORS.indexOf(value));

    return (
        <div className="flex flex-col gap-2">
            <span className="text-sm font-medium leading-snug">{label}</span>
            <div
                role="radiogroup"
                aria-label={label}
                className="flex flex-wrap gap-2"
            >
                {AVATAR_COLORS.map((color, i) => {
                    const selected = value === color;
                    return (
                        <button
                            key={color}
                            ref={(node) => {
                                refs.current[i] = node;
                            }}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            tabIndex={i === activeIndex ? 0 : -1}
                            aria-label={intl.formatMessage(messages.swatch, {
                                color
                            })}
                            onClick={() => onChange(color)}
                            onKeyDown={(event) => onKeyDown(event, i)}
                            className={cn(
                                'flex size-9 items-center justify-center rounded-xl text-white transition-colors',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                                selected && 'ring-2 ring-ring ring-offset-2'
                            )}
                            style={{ backgroundColor: avatarColorVar(color) }}
                        >
                            {selected ? <Check className="size-4" /> : null}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
