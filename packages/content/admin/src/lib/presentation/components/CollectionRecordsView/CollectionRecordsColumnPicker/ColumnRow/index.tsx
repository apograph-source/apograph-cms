import type { CSSProperties, ReactNode } from 'react';
import { Checkbox, cn } from '@orthacms/design-system';
import type { EntryColumn } from '../../../../../domain/entryColumns';

/**
 * One row in the column picker: a checkbox toggling visibility plus its label.
 * The `handle` slot holds either a drag handle (visible, reorderable columns) or
 * a spacer (hidden columns) so both align. The label is tied to the checkbox so
 * a click anywhere on it toggles, and the row reads as one control to assistive
 * tech.
 */
export function ColumnRow({
    column,
    label,
    checked,
    disabled,
    onToggle,
    handle,
    dragging,
    rowRef,
    style
}: {
    column: EntryColumn;
    label: string;
    checked: boolean;
    disabled?: boolean;
    onToggle: () => void;
    handle: ReactNode;
    dragging?: boolean;
    rowRef?: (node: HTMLElement | null) => void;
    style?: CSSProperties;
}) {
    const checkboxId = `column-toggle-${column.id}`;
    return (
        <div
            ref={rowRef}
            style={style}
            className={cn(
                'flex items-center gap-2 rounded-md px-1 py-1.5 text-sm',
                dragging && 'bg-muted'
            )}
        >
            {handle}
            <Checkbox
                id={checkboxId}
                checked={checked}
                disabled={disabled}
                onCheckedChange={onToggle}
            />
            <label
                htmlFor={checkboxId}
                className="flex-1 cursor-pointer select-none"
            >
                {label}
            </label>
        </div>
    );
}
