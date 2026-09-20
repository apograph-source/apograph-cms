import type { CSSProperties } from 'react';
import {
    Avatar,
    AvatarFallback,
    avatarColorVar,
    cn,
    type AvatarColor
} from '@orthacms/design-system';

type WorkspaceAvatarProps = {
    /** Initials rendered as the avatar content. */
    initials: string;
    /** Accent color tinting the avatar background. */
    color: AvatarColor;
    /** Extra classes (size, radius, border). */
    className?: string;
    /** Extra inline styles (e.g. overlap margin in a stack). */
    style?: CSSProperties;
};

/**
 * An initials avatar tinted with one of the shared accent colors, sized via
 * `className`. Shape comes from the design-system `Avatar` default (rounded
 * square), shared by workspaces and members.
 */
export function WorkspaceAvatar({
    initials,
    color,
    className,
    style
}: WorkspaceAvatarProps) {
    return (
        <Avatar
            className={cn(className)}
            style={{ backgroundColor: avatarColorVar(color), ...style }}
        >
            <AvatarFallback className="rounded-[inherit] bg-transparent font-semibold text-white">
                {initials}
            </AvatarFallback>
        </Avatar>
    );
}
