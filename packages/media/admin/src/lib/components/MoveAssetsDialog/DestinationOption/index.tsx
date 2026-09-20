import type { ReactNode } from 'react';
import { Label, RadioGroupItem, cn } from '@orthacms/design-system';

/**
 * One selectable destination row inside {@link MoveAssetsDialog}'s radio list —
 * an indented label wrapping a radio, a folder icon, and the name. The assets'
 * current folder renders dimmed to signal it's a no-op target.
 */
export function DestinationOption({
    value,
    depth,
    icon,
    label,
    current
}: {
    /** Folder id (or root id) this option selects. */
    value: string;
    /** Indent level below the root. */
    depth: number;
    /** Leading glyph (home for root, folder otherwise). */
    icon: ReactNode;
    /** Folder name. */
    label: string;
    /** Whether this is the assets' current folder (dimmed, no-op). */
    current: boolean;
}) {
    return (
        <Label
            htmlFor={`media-move-${value}`}
            className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm font-normal hover:bg-accent',
                current && 'opacity-60'
            )}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
            <RadioGroupItem id={`media-move-${value}`} value={value} />
            {icon}
            <span className="truncate">{label}</span>
        </Label>
    );
}
