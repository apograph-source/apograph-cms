import { avatarColorVar, cn, type AvatarColor } from '@orthacms/design-system';
import { initialsOf } from '@orthacms/utils-admin';

/** Props for {@link Monogram}. */
export type MonogramProps = {
    /** Name the initials are derived from. */
    name: string;
    /** Accent color tinting the tile. */
    color: AvatarColor;
    /** Extra classes — set the size here (defaults to a 44px tile). */
    className?: string;
};

/**
 * A rounded-square initials tile in the workspace accent color, white text.
 * Distinct from the round member `Avatar` — this represents the workspace
 * identity in the basics step and updates live as the name/color change.
 */
export function Monogram({ name, color, className }: MonogramProps) {
    return (
        <div
            aria-hidden
            className={cn(
                'flex size-11 shrink-0 items-center justify-center rounded-xl text-base font-semibold text-white',
                className
            )}
            style={{ backgroundColor: avatarColorVar(color) }}
        >
            {initialsOf(name) || '—'}
        </div>
    );
}
