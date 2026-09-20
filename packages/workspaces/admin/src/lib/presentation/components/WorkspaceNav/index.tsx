import { Link } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { ArrowLeft } from 'lucide-react';
import { AuthStatus, useAuth } from '@orthacms/identity-admin';
import {
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarTrigger
} from '@orthacms/design-system';
import { byOrder } from '@orthacms/utils-admin';
import { useWorkspaces } from '../../../application/useWorkspaces';
import {
    WORKSPACE_NAV_SLOT,
    WORKSPACE_SECTION_SLOT
} from '../../slots/workspaceSlots';
import { WorkspaceNavButton } from './WorkspaceNavButton';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import type { WorkspaceNavItem } from '../../slots/workspaceSlots';
import type { Workspace } from '../../../domain/types/workspace';

/** Intl descriptors for the workspace sidebar nav, co-located here. */
const messages = defineMessages({
    hideNav: {
        id: 'workspaces.nav.hide',
        defaultMessage: 'Hide navigation'
    },
    back: {
        id: 'workspaces.nav.back',
        defaultMessage: 'Home'
    },
    workspaceGroup: {
        id: 'workspaces.nav.groupLabel',
        defaultMessage: 'Tools'
    }
});

/**
 * The per-workspace sidebar content, injected into the app sidebar's contextual
 * region by {@link WorkspaceShell} while a workspace is open. It replaces the
 * global nav with: a back link to the top-level app, the workspace switcher, a
 * search trigger, any custom sections (the Content Library's content-type list,
 * from {@link WORKSPACE_SECTION_SLOT}), and the "Workspace" section (Media,
 * Insights, Settings, from {@link WORKSPACE_NAV_SLOT}). The persistent account
 * footer stays below, owned by the shell.
 */
export function WorkspaceNav({ workspace }: { workspace: Workspace }) {
    const intl = useIntl();
    const { data: workspaces = [] } = useWorkspaces();
    const sections = byOrder(WORKSPACE_SECTION_SLOT.getItems());
    const navItems = byOrder(WORKSPACE_NAV_SLOT.getItems());

    // Mirror the exact visibility rule `WorkspaceNavButton` applies per row: an
    // item with no `permission` is always visible, one with a `permission` only
    // when the signed-in user holds it. Reading the permission set once lets the
    // group decide whether to render at all, so the "Tools" label never sits
    // over an empty body when every entry is gated out.
    const auth = useAuth();
    const permissions =
        auth.status === AuthStatus.Authenticated ? auth.user.permissions : [];
    const isVisible = (item: WorkspaceNavItem) =>
        !item.permission || permissions.includes(item.permission);
    const visibleNavItems = navItems.filter(isVisible);

    return (
        <>
            <SidebarHeader className="gap-2 px-2 pt-2">
                <div className="flex items-center justify-between gap-1">
                    <Link
                        to="/"
                        className="flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                    >
                        <ArrowLeft className="size-4" aria-hidden />
                        {intl.formatMessage(messages.back)}
                    </Link>
                    {/* Only reachable while the sidebar is open, so it always
                        *hides* — and it says so in the session's own language
                        rather than the design system's English default
                        (`ORT-159`). */}
                    <SidebarTrigger
                        label={intl.formatMessage(messages.hideNav)}
                        className="text-sidebar-foreground/70"
                    />
                </div>
                <WorkspaceSwitcher
                    current={workspace}
                    workspaces={workspaces}
                />
            </SidebarHeader>
            <SidebarContent>
                {sections.map(({ id, Component }) => (
                    <Component key={id} />
                ))}
                {visibleNavItems.length > 0 ? (
                    <SidebarGroup>
                        <SidebarGroupLabel>
                            {intl.formatMessage(messages.workspaceGroup)}
                        </SidebarGroupLabel>
                        <SidebarGroupContent>
                            <nav
                                aria-label={intl.formatMessage(
                                    messages.workspaceGroup
                                )}
                            >
                                <SidebarMenu>
                                    {visibleNavItems.map((item) => (
                                        <WorkspaceNavButton
                                            key={item.to}
                                            item={item}
                                        />
                                    ))}
                                </SidebarMenu>
                            </nav>
                        </SidebarGroupContent>
                    </SidebarGroup>
                ) : null}
            </SidebarContent>
        </>
    );
}
