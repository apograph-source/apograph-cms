import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useHasPermission } from '@orthacms/identity-admin';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    cn
} from '@orthacms/design-system';
import { initialsOf } from '@orthacms/utils-admin';
import { WorkspaceAvatar } from '../../WorkspaceAvatar';
import { WORKSPACES_CREATE } from '../../../../domain/permissions';
import type { Workspace } from '../../../../domain/types/workspace';

/** Intl descriptors for the sidebar workspace switcher, co-located here. */
const messages = defineMessages({
    trigger: {
        id: 'workspaces.switcher.trigger',
        defaultMessage: 'Switch workspace, current: {name}'
    },
    role: {
        id: 'workspaces.switcher.role',
        defaultMessage: 'Workspace'
    },
    currentWorkspace: {
        id: 'workspaces.switcher.currentWorkspace',
        defaultMessage: 'Current workspace'
    },
    heading: {
        id: 'workspaces.switcher.heading',
        defaultMessage: 'Switch workspace'
    },
    sub: {
        id: 'workspaces.switcher.sub',
        defaultMessage:
            '{count, plural, one {# member} other {# members}} · {status}'
    },
    create: {
        id: 'workspaces.switcher.create',
        defaultMessage: 'New workspace'
    }
});

type WorkspaceSwitcherProps = {
    /** The workspace currently open. */
    current: Workspace;
    /** Every workspace the switcher can jump to. */
    workspaces: Workspace[];
};

/**
 * The workspace sidebar's header control: a full-width row showing the current
 * workspace (avatar + name + "Workspace" label) that opens a popover listing
 * every workspace to jump to, plus a "New workspace" action. Switching
 * navigates to the target's base, which redirects to its first section.
 */
export function WorkspaceSwitcher({
    current,
    workspaces
}: WorkspaceSwitcherProps) {
    const intl = useIntl();
    const navigate = useNavigate();
    const canCreate = useHasPermission(WORKSPACES_CREATE);
    const [open, setOpen] = useState(false);
    const headingId = useId();

    const go = (path: string) => {
        setOpen(false);
        navigate(path);
    };

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <SidebarMenuButton
                            size="lg"
                            aria-label={intl.formatMessage(messages.trigger, {
                                name: current.name
                            })}
                        >
                            <WorkspaceAvatar
                                initials={initialsOf(current.name)}
                                color={current.color}
                                className="size-8 rounded-lg text-xs"
                            />
                            <span className="flex min-w-0 flex-1 flex-col text-left">
                                <span className="truncate text-sm font-semibold">
                                    {current.name}
                                </span>
                                <span className="truncate text-xs text-sidebar-foreground/70">
                                    {intl.formatMessage(messages.role)}
                                </span>
                            </span>
                            <ChevronsUpDown className="ml-auto" aria-hidden />
                        </SidebarMenuButton>
                    </PopoverTrigger>
                    <PopoverContent
                        align="start"
                        // Radix renders this as a `role="dialog"`; without a
                        // name it announces as an anonymous "dialog". The
                        // heading below is a styled <p>, so it is promoted to
                        // the popover's label by id rather than by role.
                        aria-labelledby={headingId}
                        // `w-[--radix-popover-trigger-width]` is the Tailwind
                        // **v3** spelling: v4 no longer unwraps a bare `--var`
                        // in brackets, so it emitted the invalid declaration
                        // `width: --radix-popover-trigger-width` — which the
                        // browser drops, while tailwind-merge had already
                        // removed `PopoverContent`'s default `w-72`. The
                        // popover therefore had no width rule at all and grew
                        // to whatever the longest workspace name needed. v4
                        // wants the `var()` spelled out (every other call site
                        // in the repo already does).
                        className="w-[var(--radix-popover-trigger-width)] min-w-64 p-2"
                    >
                        <p
                            id={headingId}
                            className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground"
                        >
                            {intl.formatMessage(messages.heading)}
                        </p>
                        {/* Only the list scrolls — the heading above and the
                            "New workspace" action below are siblings, so
                            scrolling the whole popover would carry both of them
                            away. Sized against the *unfiltered* membership
                            list (this switcher has no search box), so a user in
                            thirty workspaces gets a bounded panel instead of
                            one taller than the viewport. */}
                        <div className="max-h-72 overflow-y-auto">
                            {workspaces.map((workspace) => {
                                const isCurrent = workspace.id === current.id;
                                return (
                                    <button
                                        key={workspace.id}
                                        type="button"
                                        // The open workspace was marked only by
                                        // a background tint plus an unlabelled
                                        // check glyph — both invisible to a
                                        // screen reader, and the tint alone is
                                        // flattened under forced-colors, so
                                        // every row read alike.
                                        aria-current={
                                            isCurrent ? 'true' : undefined
                                        }
                                        onClick={() =>
                                            go(`/workspaces/${workspace.id}`)
                                        }
                                        // `ring-inset`: the row now sits in a
                                        // clipping scroll container, and an
                                        // outset focus ring on the first or
                                        // last row would be drawn outside it
                                        // and never seen.
                                        className={cn(
                                            'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                                            isCurrent && 'bg-accent'
                                        )}
                                    >
                                        <WorkspaceAvatar
                                            initials={initialsOf(
                                                workspace.name
                                            )}
                                            color={workspace.color}
                                            className="size-7 shrink-0 rounded-md text-[11px]"
                                        />
                                        {/* `min-w-0` on this flex item is what
                                            lets the two `truncate` spans below
                                            clip: without it the item's
                                            automatic minimum size is its
                                            content, so a long name would push
                                            the row wider instead of
                                            ellipsising. */}
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-[13.5px] font-medium">
                                                {workspace.name}
                                            </span>
                                            <span className="block truncate text-xs text-muted-foreground">
                                                {intl.formatMessage(
                                                    messages.sub,
                                                    {
                                                        count: workspace.members
                                                            .length,
                                                        status: workspace.status
                                                    }
                                                )}
                                            </span>
                                        </span>
                                        {isCurrent ? (
                                            <>
                                                <Check
                                                    aria-hidden
                                                    className="size-4 shrink-0 text-muted-foreground"
                                                />
                                                <span className="sr-only">
                                                    {intl.formatMessage(
                                                        messages.currentWorkspace
                                                    )}
                                                </span>
                                            </>
                                        ) : null}
                                    </button>
                                );
                            })}
                        </div>
                        {canCreate ? (
                            <>
                                <div className="my-1 h-px bg-border" />
                                <button
                                    type="button"
                                    onClick={() => go('/workspaces/new')}
                                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    <span
                                        aria-hidden
                                        className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground"
                                    >
                                        <Plus className="size-4" />
                                    </span>
                                    <span className="text-[13.5px] font-medium">
                                        {intl.formatMessage(messages.create)}
                                    </span>
                                </button>
                            </>
                        ) : null}
                    </PopoverContent>
                </Popover>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
