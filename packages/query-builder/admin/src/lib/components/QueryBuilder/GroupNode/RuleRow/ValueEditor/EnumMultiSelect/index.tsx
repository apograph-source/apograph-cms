import { useIntl } from 'react-intl';
import { Checkbox } from '@orthacms/design-system';
import type { FilterEnumValue } from '../../../../../../types/filter-field.type';

/** Props for {@link EnumMultiSelect}. */
export type EnumMultiSelectProps = {
    /** The declared enum members the user may pick from. */
    options: readonly FilterEnumValue[];
    /** Currently selected wire values. */
    value: string[];
    /** Called with the next selected set on every toggle. */
    onChange: (next: string[]) => void;
    /** Accessible group label (no visible legend sits beside the row). */
    label: string;
    /**
     * Marks each checkbox `aria-invalid` when the rule fails validation.
     *
     * On the **checkboxes**, not on the group. `aria-invalid` is a widget
     * attribute for inputs and ARIA 1.2 does not list it on `role="group"`, so
     * putting it there conveyed the invalid state to nobody at all — the group
     * ignored it and the individual controls carried nothing (`ORT-157`).
     */
    invalid?: boolean;
    /** Id of the rule's error message, wired as `aria-describedby`. */
    describedById?: string;
};

/**
 * Checkbox group for the `is_one_of` operator on an enum field. Selection is
 * constrained to the declared members, so the emitted array is always
 * server-valid — unlike a free-text input, the user can't produce a value the
 * BE rejects with `FILTER_INVALID_VALUE`.
 */
export function EnumMultiSelect({
    options,
    value,
    onChange,
    label,
    invalid,
    describedById
}: EnumMultiSelectProps) {
    const intl = useIntl();
    const toggle = (optValue: string, checked: boolean) => {
        if (checked) {
            if (!value.includes(optValue)) onChange([...value, optValue]);
        } else {
            onChange(value.filter((v) => v !== optValue));
        }
    };

    return (
        <div
            role="group"
            aria-label={label}
            aria-describedby={describedById}
            className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-input px-3 py-1.5"
        >
            {options.map((opt) => {
                const optLabel = intl.formatMessage(opt.label);
                return (
                    <label
                        key={opt.value}
                        className="flex items-center gap-1.5 text-sm"
                    >
                        <Checkbox
                            checked={value.includes(opt.value)}
                            onCheckedChange={(checked) =>
                                toggle(opt.value, checked === true)
                            }
                            aria-label={optLabel}
                            aria-invalid={invalid || undefined}
                        />
                        {optLabel}
                    </label>
                );
            })}
        </div>
    );
}
