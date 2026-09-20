import type { CSSProperties } from 'react';
import {
    Avatar,
    AvatarFallback,
    avatarColorVar,
    cn,
    type AvatarColor
} from '@orthacms/design-system';

type MemberAvatarProps = {
    /** Initials rendered as the avatar content. */
    initials: string;
    /** Accent color tinting the avatar background. */
    color: AvatarColor;
    /** Extra classes (size, border). */
    className?: string;
    /** Extra inline styles (e.g. overlap margin in a stack). */
    style?: CSSProperties;
};

/**
 * An initials avatar tinted with one of the shared accent colors — members in
 * the table, and the smaller workspace chips in the Workspaces column, both
 * sized via `className`. Shape comes from the design-system `Avatar` default
 * (rounded square). Purely decorative: the member/workspace
 * name is always rendered as adjacent text (or an `aria-label` on the
 * enclosing control), so the initials are hidden from assistive tech to avoid
 * a meaningless "J D A B" reading.
 */
export function MemberAvatar({
    initials,
    color,
    className,
    style
}: MemberAvatarProps) {
    return (
        <Avatar
            aria-hidden
            className={cn(className)}
            style={{ backgroundColor: avatarColorVar(color), ...style }}
        >
            <AvatarFallback className="rounded-[inherit] bg-transparent font-semibold text-white">
                {initials}
            </AvatarFallback>
        </Avatar>
    );
}
