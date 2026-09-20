import { Link, useMatch } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { ChevronRight, Plus } from 'lucide-react';
import { useHasPermission } from '@orthacms/identity-admin';
import { initialsOf } from '@orthacms/utils-admin';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    SidebarGroup,
    SidebarGroupAction,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem
} from '@orthacms/design-system';
import { useWorkspaces } from '../../../application/useWorkspaces';
import { isActiveWorkspace } from '../../../domain/isActiveWorkspace';
import { WORKSPACES_CREATE } from '../../../domain/permissions';
import { WorkspaceAvatar } from '../WorkspaceAvatar';
import type { Workspace } from '../../../domain/types/workspace';

/** Intl descriptors for {@link WorkspacesNavSection}, co-located here. */
const messages = defineMessages({
    heading: {
        id: 'workspaces.sidebar.heading',
        defaultMessage: 'Workspaces'
    },
    newWorkspace: {
        id: 'workspaces.sidebar.newWorkspace',
        defaultMessage: 'New workspace'
    },
    unavailable: {
        id: 'workspaces.sidebar.unavailable',
        defaultMessage: 'Couldn’t load your workspaces.'
    }
});

/** One workspace row: a link to the workspace, active on any of its sub-paths. */
function WorkspaceNavRow({ workspace }: { workspace: Workspace }) {
    const match = useMatch(`/workspaces/${workspace.id}/*`);

    return (
        <SidebarMenuItem>
            <SidebarMenuButton
                asChild
                isActive={Boolean(match)}
                tooltip={workspace.name}
            >
                <Link
                    to={`/workspaces/${workspace.id}`}
                    aria-current={match ? 'page' : undefined}
                >
                    <WorkspaceAvatar
                        initials={initialsOf(workspace.name)}
                        color={workspace.color}
                        className="size-5 rounded-[5px] text-[10px]"
                    />
                    <span>{workspace.name}</span>
                </Link>
            </SidebarMenuButton>
        </SidebarMenuItem>
    );
}

/**
 * The "Workspaces" quick-list in the global sidebar: the active workspaces as
 * direct links, so a member can jump into one without the Workspaces list page.
 * Contributed to the shell's `SIDEBAR_SECTION_SLOT` by `workspaces-admin`.
 * Renders nothing while loading or when there are no active workspaces, so it
 * never shows an empty section.
 *
 * The heading doubles as a **collapse trigger** (Radix `Collapsible`, so
 * `aria-expanded` + `data-state` come for free), open by default: with a long
 * membership the list crowded out the sections below it in the sidebar. With no
 * rows to reveal — loading, or create permission but no workspaces yet — the
 * heading stays a plain label and no `Collapsible` is rendered at all.
 */
export function WorkspacesNavSection() {
    const intl = useIntl();
    const { data: workspaces, isError } = useWorkspaces();
    const canCreate = useHasPermission(WORKSPACES_CREATE);

    const active = (workspaces ?? []).filter(isActiveWorkspace);
    const heading = intl.formatMessage(messages.heading);
    const newWorkspace = intl.formatMessage(messages.newWorkspace);
    const createAction = canCreate ? (
        <SidebarGroupAction asChild title={newWorkspace}>
            <Link to="/workspaces/new" aria-label={newWorkspace}>
                <Plus />
            </Link>
        </SidebarGroupAction>
    ) : null;

    // A failed read must not read as an empty membership. On error `data` is
    // undefined, so every branch below would render exactly what someone who
    // genuinely belongs to no workspace sees — the section vanishing, or a bare
    // heading — and the person is told they have no workspaces when in fact we
    // could not find out. Every other surface reading this query already says
    // so (the page, the home panel, the stats strip, the workspace shell); this
    // one is a nav aid, so it says it in one quiet line rather than an alert.
    if (isError) {
        return (
            <SidebarGroup>
                <SidebarGroupLabel>{heading}</SidebarGroupLabel>
                {/* Keep the "+" here too: failing to read the list says
                    nothing about whether this person may create one, and
                    taking the action away would make an outage look like a
                    loss of permission. */}
                {createAction}
                <SidebarGroupContent>
                    {/* `text-sidebar-foreground`, not `muted-foreground`:
                        the muted pair is calibrated against the main
                        surface, and on `bg-sidebar` it fails the contrast
                        floor — which the api-tokens axe scan caught, since
                        it is the one that renders this state. */}
                    <p className="px-2 text-xs text-sidebar-foreground">
                        {intl.formatMessage(messages.unavailable)}
                    </p>
                </SidebarGroupContent>
            </SidebarGroup>
        );
    }

    // Nothing to show and nothing to do → skip the section entirely. With create
    // permission we still show it (the "+" invites creating the first one).
    if (active.length === 0 && !canCreate) {
        return null;
    }

    // Nothing to reveal (create permission but no workspaces yet, and every
    // moment the list query is still in flight) → a plain heading, no
    // Collapsible at all. Two reasons, and the second is the load-bearing one:
    //
    // 1. A disclosure whose body is empty is not a control.
    // 2. Radix puts `aria-controls={contentId}` on the trigger **whenever it is
    //    open** — and this group is `defaultOpen`. With the content not
    //    mounted that idref dangles, which axe flags as `aria-valid-attr-value`
    //    (critical) on every page carrying the sidebar. Marking the trigger
    //    `disabled` does not help: Radix keys the attribute off `open`, not off
    //    `disabled`. The closed case is safe for the same reason — closed means
    //    no `aria-controls` at all.
    if (active.length === 0) {
        return (
            <SidebarGroup>
                <SidebarGroupLabel>{heading}</SidebarGroupLabel>
                {createAction}
            </SidebarGroup>
        );
    }

    return (
        // `defaultOpen`: the quick-list is a primary nav aid, so it starts
        // expanded and the collapse is an opt-out. The choice is deliberately
        // **not** persisted — the shell already owns one cookie-backed sidebar
        // state, and a second, per-section one is scope this section doesn't
        // need.
        <Collapsible defaultOpen className="group/workspaces">
            <SidebarGroup>
                {/* `asChild`: `SidebarGroupLabel` is a <div>, so wrapping it in
                    a trigger without this would nest a div inside a button.
                    `w-fit` keeps the trigger's hit area clear of the "+"
                    action, which `SidebarGroupAction` positions absolutely over
                    the right-hand end of this same row. */}
                <SidebarGroupLabel
                    asChild
                    className="w-fit gap-1 pr-1 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:size-3.5"
                >
                    <CollapsibleTrigger>
                        <ChevronRight
                            aria-hidden
                            className="transition-transform duration-200 group-data-[state=open]/workspaces:rotate-90"
                        />
                        {heading}
                    </CollapsibleTrigger>
                </SidebarGroupLabel>
                {createAction}
                {/* Mounted unconditionally, which is what keeps the trigger's
                    `aria-controls` pointing at something real. Radix still
                    unmounts it while *closed*, so the collapsed rows are not
                    merely invisible — they leave the tab order and the
                    accessibility tree, and the <nav> landmark goes with them
                    rather than being left empty; the trigger drops
                    `aria-controls` in that same state. */}
                <CollapsibleContent>
                    <SidebarGroupContent>
                        <nav aria-label={heading}>
                            <SidebarMenu>
                                {active.map((workspace) => (
                                    <WorkspaceNavRow
                                        key={workspace.id}
                                        workspace={workspace}
                                    />
                                ))}
                            </SidebarMenu>
                        </nav>
                    </SidebarGroupContent>
                </CollapsibleContent>
            </SidebarGroup>
        </Collapsible>
    );
}
