import { Suspense, lazy } from 'react';
import type { AdminPlugin } from '@orthacms/bootstrap-admin';
import { HOME_SECTION_SLOT, SIDEBAR_NAV_SLOT } from '@orthacms/shell-admin';
import { ENTRY_TAB, ENTRY_TAB_SLOT } from '@orthacms/content-admin';
import { Activity } from 'lucide-react';
import { ActivityLogPageSkeleton } from '../components/ActivityLogSkeleton';
import { RecentActivityPanel } from '../components/RecentActivityPanel';
import { EntryActivityTab } from '../components/EntryActivityTab';

// Lazy-loaded so the Activity Log page is code-split into its own chunk,
// fetched only when a signed-in user first navigates to `/activity`.
const ActivityLogPage = lazy(() =>
    import('../pages/ActivityLogPage').then((module) => ({
        default: module.ActivityLogPage
    }))
);

/**
 * Admin-side activity plugin shape. A thin alias of {@link AdminPlugin}, kept
 * named so future config (a per-user detail tab, slots) has a home.
 */
export type ActivityAdminPlugin = AdminPlugin;

/**
 * Creates the admin-side activity plugin. It owns the audit-log feature: the
 * private `/activity` route (the Activity Log page, rendered inside the
 * shell's authenticated layout) and its toolbar nav entry, contributed to the
 * shell's {@link NAVBAR_START_SLOT} at `order: 35` (after Members). The page
 * itself gates on the `activity:read` permission, so the nav entry is hidden
 * for users who lack it.
 *
 * @example
 * ```typescript
 * createAdmin({
 *   plugins: [
 *     IdentityPlugin(),
 *     ShellPlugin(),
 *     WorkspacesPlugin(),
 *     UsersPlugin(),
 *     ActivityPlugin(),
 *   ],
 * });
 * ```
 */
export function ActivityPlugin(): ActivityAdminPlugin {
    return {
        name: 'activity',
        routes: [
            {
                path: '/activity',
                element: (
                    <Suspense fallback={<ActivityLogPageSkeleton />}>
                        <ActivityLogPage />
                    </Suspense>
                )
            }
        ],
        slots: [
            {
                slot: SIDEBAR_NAV_SLOT,
                items: [
                    {
                        labelId: 'activity.nav.label',
                        defaultLabel: 'Activity',
                        to: '/activity',
                        group: 'overview',
                        order: 20,
                        icon: Activity,
                        iconColor: 'text-nav-blue',
                        permission: 'activity:read'
                    }
                ]
            },
            {
                // The entry editor's **Activity** tab: who did what to the open
                // record. The built-in History tab is the **revision**
                // timeline — what the words were at each save — and cannot say
                // who published it, who took it down, or who changed who may
                // read it. Those rows exist and were reachable only from the
                // admin-only Activity page, so the person most likely to ask
                // was the one who could not.
                //
                // A tab rather than a section of the Properties rail
                // (`ORT-198`): the list grows, the rail is 240px wide and
                // shared by four plugins, and collapsing the panel took the
                // record's whole history with it. Tabs are routes here, so the
                // open one also survives the remounts this editor takes from
                // navigations it does not own.
                //
                // Not mounted, and not requested, unless the reader holds
                // `content:read` — the same key the scoped route is gated on.
                slot: ENTRY_TAB_SLOT,
                items: [
                    {
                        id: 'activity.entry.history',
                        slug: ENTRY_TAB.Activity,
                        label: {
                            id: 'activity.entryTab.label',
                            defaultMessage: 'Activity'
                        },
                        // After Access (20) and before the built-in History,
                        // which the tab strip always renders last: the two are
                        // neighbours because readers reach for either when
                        // asking "what happened here".
                        order: 30,
                        // Every type. Any record can be acted on, and a schema
                        // says nothing about whether it has been.
                        appliesTo: () => true,
                        Component: EntryActivityTab
                    }
                ]
            },
            {
                // Home dashboard: the recent-activity panel.
                slot: HOME_SECTION_SLOT,
                items: [
                    {
                        id: 'activity.home.recent',
                        region: 'panel',
                        order: 20,
                        Component: RecentActivityPanel
                    }
                ]
            }
        ]
    };
}
