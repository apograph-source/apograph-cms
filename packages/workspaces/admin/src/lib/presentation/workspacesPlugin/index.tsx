import { Suspense, lazy } from 'react';
import type { AdminPlugin } from '@orthacms/bootstrap-admin';
import {
    COMMAND_SLOT,
    HOME_SECTION_SLOT,
    SIDEBAR_NAV_SLOT,
    SIDEBAR_SECTION_SLOT
} from '@orthacms/shell-admin';
import { Layers, Settings } from 'lucide-react';
import {
    CreateWorkspacePageSkeleton,
    WorkspaceSettingsPageSkeleton,
    WorkspaceShellSkeleton,
    WorkspacesPageSkeleton
} from '../components/WorkspacesSkeleton';
import { WorkspacesNavSection } from '../components/WorkspacesNavSection';
import { WorkspaceStats } from '../components/WorkspaceStats';
import { WorkspacesHomePanel } from '../components/WorkspacesHomePanel';
import { WorkspaceCommands } from '../components/WorkspaceCommands';
import {
    WORKSPACE_ROUTE_SLOT,
    WORKSPACE_NAV_SLOT
} from '../slots/workspaceSlots';

// Lazy-loaded so each page is code-split into its own chunk, fetched only when
// a signed-in user first navigates to it.
const WorkspacesPage = lazy(() =>
    import('../pages/WorkspacesPage').then((module) => ({
        default: module.WorkspacesPage
    }))
);

const CreateWorkspacePage = lazy(() =>
    import('../pages/CreateWorkspacePage').then((module) => ({
        default: module.CreateWorkspacePage
    }))
);

const WorkspaceShell = lazy(() =>
    import('../components/WorkspaceShell').then((module) => ({
        default: module.WorkspaceShell
    }))
);

const WorkspaceSettingsPage = lazy(() =>
    import('../pages/WorkspaceSettingsPage').then((module) => ({
        default: module.WorkspaceSettingsPage
    }))
);

/**
 * Admin-side workspaces plugin shape. A thin alias of {@link AdminPlugin}, kept
 * named so future config (sub-routes, slots) has a home.
 */
export type WorkspacesAdminPlugin = AdminPlugin;

/**
 * Creates the admin-side workspaces plugin. It owns two areas and fills six
 * slots.
 *
 * 1. **The workspaces management area** — the private `/workspaces` list and
 *    `/workspaces/new` create wizard, plus the `Layers` entry contributed to
 *    {@link SIDEBAR_NAV_SLOT} at `order: 10`.
 * 2. **The workspace shell** — the `/workspaces/:id/*` layout (left rail +
 *    switcher) that opens when a workspace row is clicked. The plugin owns the
 *    rail slots ({@link WORKSPACE_NAV_SLOT}, {@link WORKSPACE_ROUTE_SLOT});
 *    feature plugins (Content/Media/Insights) contribute their rail buttons +
 *    routes there. Workspaces itself contributes the last-section **Settings**
 *    entry + its `/workspaces/:id/settings` page.
 *
 * It also reaches two surfaces outside those areas: the workspace quick-list
 * and switcher in {@link SIDEBAR_SECTION_SLOT}, and the command palette's
 * workspace results in {@link COMMAND_SLOT}, plus the home tiles and panel in
 * {@link HOME_SECTION_SLOT}.
 *
 * @example
 * ```typescript
 * createAdmin({
 *   plugins: [
 *     IdentityPlugin(),
 *     ShellPlugin(),
 *     WorkspacesPlugin(),
 *   ],
 * });
 * ```
 */
export function WorkspacesPlugin(): WorkspacesAdminPlugin {
    return {
        name: 'workspaces',
        routes: [
            {
                path: '/workspaces',
                element: (
                    <Suspense fallback={<WorkspacesPageSkeleton />}>
                        <WorkspacesPage />
                    </Suspense>
                )
            },
            {
                path: '/workspaces/new',
                element: (
                    <Suspense fallback={<CreateWorkspacePageSkeleton />}>
                        <CreateWorkspacePage />
                    </Suspense>
                )
            },
            {
                // The workspace shell. `/workspaces/new` is statically more
                // specific, so React Router ranks it ahead of this dynamic
                // segment regardless of declaration order.
                path: '/workspaces/:id/*',
                element: (
                    <Suspense fallback={<WorkspaceShellSkeleton />}>
                        <WorkspaceShell />
                    </Suspense>
                )
            }
        ],
        slots: [
            {
                slot: SIDEBAR_NAV_SLOT,
                items: [
                    {
                        labelId: 'workspaces.nav.label',
                        defaultLabel: 'Workspaces',
                        to: '/workspaces',
                        group: 'directory',
                        order: 10,
                        icon: Layers,
                        iconColor: 'text-nav-violet'
                    }
                ]
            },
            {
                // The Workspaces quick-list below the primary nav.
                slot: SIDEBAR_SECTION_SLOT,
                items: [
                    {
                        id: 'workspaces.quicklist',
                        order: 10,
                        Component: WorkspacesNavSection
                    }
                ]
            },
            {
                // Command palette: jump into any active workspace.
                slot: COMMAND_SLOT,
                items: [
                    {
                        id: 'workspaces.command',
                        order: 10,
                        Component: WorkspaceCommands
                    }
                ]
            },
            {
                // Home dashboard: the workspace stat tiles + a workspaces panel.
                slot: HOME_SECTION_SLOT,
                items: [
                    {
                        id: 'workspaces.home.stats',
                        region: 'stat',
                        order: 10,
                        Component: WorkspaceStats
                    },
                    {
                        id: 'workspaces.home.panel',
                        region: 'panel',
                        order: 10,
                        Component: WorkspacesHomePanel
                    }
                ]
            },
            {
                // Settings is the last entry in the "Workspace" section.
                slot: WORKSPACE_NAV_SLOT,
                items: [
                    {
                        labelId: 'workspaces.settings.nav',
                        defaultLabel: 'Settings',
                        to: 'settings',
                        order: 100,
                        icon: Settings
                    }
                ]
            },
            {
                slot: WORKSPACE_ROUTE_SLOT,
                items: [
                    {
                        // A wildcard so the page owns its own nested section
                        // routes (`settings/general`, `/members`, …) behind the
                        // left rail — same shape as the content library's
                        // `content/*`.
                        path: 'settings/*',
                        element: (
                            <Suspense
                                fallback={<WorkspaceSettingsPageSkeleton />}
                            >
                                <WorkspaceSettingsPage />
                            </Suspense>
                        )
                    }
                ]
            }
        ]
    };
}
