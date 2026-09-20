import { Suspense, lazy } from 'react';
import type { AdminPlugin } from '@orthacms/bootstrap-admin';
import { SIDEBAR_FOOTER_SLOT } from '@orthacms/shell-admin';
import {
    WORKSPACE_ROUTE_SLOT,
    WORKSPACE_SECTION_SLOT
} from '@orthacms/workspaces-admin';
import { AGENTS_SEGMENT, SKILLS_SEGMENT } from '../../domain/agentsRoute';
import { AgentsPageSkeleton, SkillsPageSkeleton } from '../AgentsSkeleton';
import { CopilotLauncher } from '../CopilotLauncher';
import { ViewSwitcher } from '../ViewSwitcher';

const AgentsPage = lazy(() =>
    import('../AgentsPage').then((module) => ({
        default: module.AgentsPage
    }))
);

const SkillsPage = lazy(() =>
    import('../SkillsPage').then((module) => ({
        default: module.SkillsPage
    }))
);

/**
 * Admin-side copilot plugin shape. A thin alias of {@link AdminPlugin}, kept
 * named so the panel's future options (default surface, keyboard shortcut) have
 * a home.
 */
export type CopilotAdminPlugin = AdminPlugin;

/**
 * Creates the admin-side copilot plugin — **two surfaces onto one chat**.
 *
 * - The **docked panel**, from the shell's sidebar footer (or `⌘J`): a window
 *   over whatever page you are on, for a question *about that page*. Several can
 *   run at once behind the dock.
 * - The **Agents view**, a full page inside the workspace at
 *   `/workspaces/:id/agents`: history as a column, the transcript with room to
 *   render a table or a diff, for the work where the conversation *is* the task.
 *   The `ViewSwitcher` at the top of the workspace sidebar moves between it and
 *   the CMS in one click, in both directions.
 *
 * It contributes **no top-level route and no global nav entry**. Runs are
 * workspace-scoped (`X-Workspace-Id` is required by `WorkspaceGuard`), so every
 * surface here lives strictly inside a workspace — the launcher renders nothing
 * outside one, and the page and the switcher are contributed to the workspace
 * shell's own slots.
 *
 * The Agents route carries a **high `order`**, so it is not the workspace's
 * default landing: the Content Library (order 10) stays what
 * `/workspaces/:id` redirects to. Reaching the copilot is a choice.
 *
 * Register it **after** `ShellPlugin()` (whose footer slot it fills) and
 * `WorkspacesPlugin()` (whose route and section slots it fills).
 *
 * @example
 * ```typescript
 * createAdmin({
 *   plugins: [
 *     IdentityPlugin(),
 *     ShellPlugin(),
 *     WorkspacesPlugin(),
 *     CopilotPlugin(),
 *   ],
 * });
 * ```
 */
export function CopilotPlugin(): CopilotAdminPlugin {
    return {
        name: 'copilot',
        slots: [
            {
                slot: SIDEBAR_FOOTER_SLOT,
                // Before the account menu (which sits at a higher order): the
                // copilot is a tool you reach for, not an identity control.
                items: [
                    { id: 'copilot', order: 10, Component: CopilotLauncher }
                ]
            },
            {
                slot: WORKSPACE_SECTION_SLOT,
                // The lowest order in the region, so the mode switch sits
                // directly under the workspace switcher and above the Content
                // nav — it governs which of the two views everything below it
                // belongs to.
                items: [
                    {
                        id: 'copilot.viewSwitcher',
                        order: 5,
                        Component: ViewSwitcher
                    }
                ]
            },
            {
                slot: WORKSPACE_ROUTE_SLOT,
                items: [
                    {
                        // **Before the wildcard below**, and a literal path
                        // rather than a segment the Agents page interprets:
                        // React Router ranks a static segment above a splat, so
                        // `agents/skills` lands here and never on the thread
                        // page — which would otherwise try to open a
                        // conversation called "skills".
                        path: `${AGENTS_SEGMENT}/${SKILLS_SEGMENT}`,
                        order: 49,
                        element: (
                            <Suspense fallback={<SkillsPageSkeleton />}>
                                <SkillsPage />
                            </Suspense>
                        )
                    },
                    {
                        // A trailing `/*` because the page reads the open thread
                        // out of the path itself (`/agents/:conversationId`)
                        // rather than through a nested route — see
                        // `readAgentThreadId` for why that seam matters.
                        path: `${AGENTS_SEGMENT}/*`,
                        order: 50,
                        element: (
                            <Suspense fallback={<AgentsPageSkeleton />}>
                                <AgentsPage />
                            </Suspense>
                        )
                    }
                ]
            }
        ]
    };
}
