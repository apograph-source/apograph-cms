import type { ComponentType } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@orthacms/design-system';

type ContentSidebarLinkProps = {
    /** Absolute path this row links to. */
    to: string;
    /** Visible label. */
    label: string;
    /** Leading icon. */
    icon: ComponentType<{ className?: string }>;
};

/**
 * A static (non-content-type) nav row in the content sidebar — e.g. History or
 * Trash. Styled like a `SidebarMenuButton`: an icon-led `NavLink` whose active
 * state fills it the neutral `--accent`, matching the content-type rows but
 * without a pin affordance.
 */
export function ContentSidebarLink({
    to,
    label,
    icon: Icon
}: ContentSidebarLinkProps) {
    return (
        <NavLink
            to={to}
            className={({ isActive }) =>
                cn(
                    'flex h-8 w-full items-center gap-2 overflow-hidden rounded-md px-2 text-sm outline-none transition-colors duration-[120ms] focus-visible:ring-2 focus-visible:ring-ring',
                    isActive
                        ? 'bg-sidebar-accent font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
                )
            }
        >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{label}</span>
        </NavLink>
    );
}
