import { NavLink } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { cn } from '@orthacms/design-system';
import { Pin, PinOff } from 'lucide-react';
import type { ContentType } from '../../../../domain/types/contentType';

/** Intl descriptors for a sidebar content-type row, co-located here. */
const messages = defineMessages({
    pin: {
        id: 'content.sidebar.pin',
        defaultMessage: 'Pin {label}'
    },
    unpin: {
        id: 'content.sidebar.unpin',
        defaultMessage: 'Unpin {label}'
    }
});

type ContentSidebarItemProps = {
    /** The content type this row links to. */
    type: ContentType;
    /** Absolute base path for the library (`/workspaces/:id/content`). */
    basePath: string;
    /** Whether this type is currently pinned. */
    pinned: boolean;
    /** Pin / unpin this type. */
    onTogglePin: (name: string) => void;
};

/**
 * One selectable content type, styled after the shadcn `SidebarMenuSubButton`:
 * a compact, icon-less `NavLink` that sits on the group's left border line
 * (active state fills it the neutral `--accent`, echoing the workspace rail),
 * with a trailing pin toggle. The pin button is a **sibling** of the link — not
 * nested inside the anchor — and reveals on hover/focus, staying visible when
 * pinned.
 */
export function ContentSidebarItem({
    type,
    basePath,
    pinned,
    onTogglePin
}: ContentSidebarItemProps) {
    const intl = useIntl();
    const pinLabel = intl.formatMessage(
        pinned ? messages.unpin : messages.pin,
        { label: type.label }
    );

    return (
        <div className="group/item relative">
            <NavLink
                to={`${basePath}/${type.name}`}
                className={({ isActive }) =>
                    cn(
                        'flex h-7 min-w-0 -translate-x-px items-center overflow-hidden rounded-md px-2 text-sm outline-none transition-colors duration-[120ms] focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                        pinned ? 'pr-8' : 'pr-2',
                        isActive
                            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
                    )
                }
            >
                <span className="truncate">{type.label}</span>
            </NavLink>
            <button
                type="button"
                aria-label={pinLabel}
                aria-pressed={pinned}
                onClick={() => onTogglePin(type.name)}
                className={cn(
                    'absolute inset-y-0 right-1 my-auto flex size-6 items-center justify-center rounded-md text-sidebar-foreground/70 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                    pinned
                        ? 'opacity-100'
                        : 'opacity-0 group-hover/item:opacity-100 group-focus-within/item:opacity-100'
                )}
            >
                {pinned ? (
                    <PinOff className="size-3.5" />
                ) : (
                    <Pin className="size-3.5" />
                )}
            </button>
        </div>
    );
}
