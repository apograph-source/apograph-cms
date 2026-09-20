import { defineMessages, useIntl } from 'react-intl';
import { DatePicker, DateTimePicker } from '@orthacms/design-system';

const messages = defineMessages({
    datePlaceholder: {
        id: 'content.form.datePlaceholder',
        defaultMessage: 'Select date'
    },
    dateTimePlaceholder: {
        id: 'content.form.dateTimePlaceholder',
        defaultMessage: 'Select date & time'
    },
    time: { id: 'content.form.time', defaultMessage: 'Time' }
});

/** Zero-pads to two digits. */
function pad(n: number): string {
    return String(n).padStart(2, '0');
}

/** A `Date` → `YYYY-MM-DD` (local calendar date, no timezone shift). */
function toISODate(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A `Date` → `YYYY-MM-DDTHH:mm` (local, no timezone shift). */
function toISODateTime(date: Date): string {
    return `${toISODate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Whether an ISO string carries an explicit zone (`Z`, `+02:00`, `-0500`). */
function hasTimezone(value: string): boolean {
    return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim());
}

/**
 * The field's ISO string → the `Date` the picker should show, or undefined.
 *
 * A **datetime** the server round-trips comes back with an explicit zone
 * (`2026-07-15T12:30:00.000Z`). That is an *instant*, not a wall clock, so it is
 * parsed as one and the picker renders it in the viewer's local time. Reading
 * its calendar fields literally — as the naive branch below does — re-labels
 * 12:30 UTC as 12:30 local, which is why a time saved as 2:30 PM came back
 * reading 12:30 PM.
 *
 * Everything else is a **naive local** string the field itself wrote
 * (`YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`) and is read field-by-field, with no shift.
 * A `date` field always takes that path: it has no time of day to convert, and
 * converting one would risk moving the calendar day across midnight.
 */
function parseValue(value: string, withTime: boolean): Date | undefined {
    if (withTime && hasTimezone(value)) {
        const instant = new Date(value);
        return Number.isNaN(instant.getTime()) ? undefined : instant;
    }
    const match =
        /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(
            value
        );
    if (!match) return undefined;
    const [, y, mo, d, h, mi, s] = match;
    return new Date(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(h ?? 0),
        Number(mi ?? 0),
        Number(s ?? 0)
    );
}

/**
 * The control for a `date` / `datetime` field: a thin adapter over the
 * design-system {@link DatePicker} / {@link DateTimePicker} (single trigger; the
 * datetime variant carries the calendar + a time input as two sections of one
 * dropdown). Converts between the field's ISO string (`YYYY-MM-DD`, or
 * `YYYY-MM-DDTHH:mm` for datetime) and the picker's `Date`, with no timezone
 * shift.
 */
export function DateField({
    id,
    value,
    onChange,
    onBlur,
    withTime,
    invalid,
    disabled,
    'aria-describedby': ariaDescribedby
}: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    onBlur?: () => void;
    withTime: boolean;
    invalid?: boolean;
    /**
     * Render the trigger inert (a read-only editor). A picker has no `readOnly`
     * to fall back on the way a text input does — its value is only reachable
     * through the popover — so the formatted date stays on the trigger and only
     * the popover is closed off.
     */
    disabled?: boolean;
    /** Ids of the hint/error elements describing the trigger. */
    'aria-describedby'?: string;
}) {
    const intl = useIntl();
    const date = parseValue(value, withTime);

    if (withTime) {
        return (
            <DateTimePicker
                id={id}
                value={date}
                onChange={(next) => onChange(next ? toISODateTime(next) : '')}
                onBlur={onBlur}
                invalid={invalid}
                disabled={disabled}
                aria-describedby={ariaDescribedby}
                placeholder={intl.formatMessage(messages.dateTimePlaceholder)}
                timeLabel={intl.formatMessage(messages.time)}
            />
        );
    }

    return (
        <DatePicker
            id={id}
            value={date}
            onChange={(next) => onChange(next ? toISODate(next) : '')}
            onBlur={onBlur}
            invalid={invalid}
            disabled={disabled}
            aria-describedby={ariaDescribedby}
            placeholder={intl.formatMessage(messages.datePlaceholder)}
        />
    );
}
