import { useId } from 'react';
import { Label, RadioGroupItem } from '@orthacms/design-system';
import type { ViewVisibility } from '../../../../../domain/types/savedView';

/** Props for {@link VisibilityChoice}. */
export type VisibilityChoiceProps = {
    /** The visibility this option selects. */
    value: ViewVisibility;
    /** Localized option label. */
    label: string;
    /** Localized supporting line — or, when disabled, why it is unavailable. */
    hint: string;
    /** Whether the option is unavailable to this caller. */
    disabled?: boolean;
};

/**
 * One visibility option in the save dialog: the radio, its label, and the hint
 * that explains what the choice means.
 *
 * The hint is wired with `aria-describedby` rather than being folded into the
 * label, so a screen reader announces "Shared, radio button" and then the
 * explanation — including the reason the option is disabled, which is the one
 * case where the hint is the only thing that tells you why you cannot pick it.
 */
export function VisibilityChoice({
    value,
    label,
    hint,
    disabled = false
}: VisibilityChoiceProps) {
    const id = useId();
    const hintId = useId();
    return (
        <div className="flex flex-1 items-start gap-2 rounded-md border p-3">
            <RadioGroupItem
                id={id}
                value={value}
                disabled={disabled}
                aria-describedby={hintId}
                className="mt-0.5"
            />
            <Label htmlFor={id} className="flex flex-col items-start gap-0.5">
                <span className="text-sm font-medium">{label}</span>
                <span
                    id={hintId}
                    className="text-xs font-normal text-muted-foreground"
                >
                    {hint}
                </span>
            </Label>
        </div>
    );
}
