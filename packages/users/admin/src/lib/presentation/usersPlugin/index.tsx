import { Suspense, lazy } from 'react';
import type { AdminPlugin } from '@orthacms/bootstrap-admin';
import { SIDEBAR_FOOTER_SLOT, SIDEBAR_NAV_SLOT } from '@orthacms/shell-admin';
import { Users } from 'lucide-react';
import {
    InviteMemberPageSkeleton,
    MembersPageSkeleton
} from '../components/MembersSkeleton';
import { AccountMenu } from '../components/AccountMenu';
import { ThemeSync } from '../components/ThemeSync';

// Lazy-loaded so the Members page is code-split into its own chunk, fetched
// only when a signed-in user first navigates to `/users`.
const MembersPage = lazy(() =>
    import('../pages/MembersPage').then((module) => ({
        default: module.MembersPage
    }))
);

const InviteMemberPage = lazy(() =>
    import('../pages/InviteMemberPage').then((module) => ({
        default: module.InviteMemberPage
    }))
);

// The detail page (its nested tab router) is its own chunk, fetched only when a
// member row is opened.
const UserDetailRouter = lazy(() =>
    import('../components/UserDetailRouter').then((module) => ({
        default: module.UserDetailRouter
    }))
);

/**
 * Admin-side users plugin shape. A thin alias of {@link AdminPlugin}, kept
 * named so future config (sub-routes, slots) has a home.
 */
export type UsersAdminPlugin = AdminPlugin;

/**
 * Creates the admin-side users plugin. It owns the members feature: three
 * private routes — `/users` (the Members page), `/users/invite` (the invite
 * wizard) and `/users/:id/*` (the member card's own nested router) — rendered
 * inside the shell's authenticated layout.
 *
 * It contributes to two slots. The nav entry goes to {@link SIDEBAR_NAV_SLOT}
 * with `group: 'directory'`, `order: 20` and `permission: 'users:read'` —
 * declared so the entry disappears for someone the page would refuse, rather
 * than promising a screen that answers "no access". {@link ThemeSync} and
 * {@link AccountMenu} go to {@link SIDEBAR_FOOTER_SLOT}, the one region the
 * shell keeps mounted in both the global and the workspace sidebar.
 *
 * The static `/users/invite` route is declared **before** the `/users/:id/*`
 * splat, so "invite" is never parsed as a member id.
 *
 * @example
 * ```typescript
 * createAdmin({
 *   plugins: [
 *     IdentityPlugin(),
 *     ShellPlugin(),
 *     WorkspacesPlugin(),
 *     UsersPlugin(),
 *   ],
 * });
 * ```
 */
export function UsersPlugin(): UsersAdminPlugin {
    return {
        name: 'users',
        routes: [
            {
                path: '/users',
                element: (
                    <Suspense fallback={<MembersPageSkeleton />}>
                        <MembersPage />
                    </Suspense>
                )
            },
            {
                path: '/users/invite',
                element: (
                    <Suspense fallback={<InviteMemberPageSkeleton />}>
                        <InviteMemberPage />
                    </Suspense>
                )
            },
            {
                // Splat so the detail page owns its nested tab routes
                // (`general`, `roles`, …). `/users/invite` outranks `/users/:id`
                // in the router, so the static invite route is unaffected.
                path: '/users/:id/*',
                element: (
                    <Suspense fallback={<MembersPageSkeleton />}>
                        <UserDetailRouter />
                    </Suspense>
                )
            }
        ],
        slots: [
            {
                slot: SIDEBAR_NAV_SLOT,
                items: [
                    {
                        labelId: 'users.nav.label',
                        defaultLabel: 'Members',
                        to: '/users',
                        group: 'directory',
                        order: 20,
                        icon: Users,
                        iconColor: 'text-nav-green',
                        // Without this the entry is a dead link for anyone who
                        // can't read the directory: the page renders its
                        // no-access state, so the nav promises a destination it
                        // won't deliver. The sibling plugins gate the same way
                        // (`activity:read`, `tokens:read`).
                        permission: 'users:read'
                    }
                ]
            },
            {
                // The account menu pinned to the sidebar footer, plus an
                // invisible theme hydrator (renders null) that pulls the
                // signed-in user's saved theme from the server so it takes
                // effect app-wide without opening the Preferences tab.
                //
                // The hydrator lives in the FOOTER, not SIDEBAR_SECTION_SLOT:
                // the section slot belongs to `GlobalSidebar`, which a route can
                // replace wholesale via `useSidebarContent` (the workspace shell
                // does). Mounted there, a user who deep-links straight into a
                // workspace route would never hydrate their theme. The footer is
                // the region the shell keeps mounted in *both* contexts.
                slot: SIDEBAR_FOOTER_SLOT,
                items: [
                    {
                        id: 'users.themeSync',
                        order: 0,
                        Component: ThemeSync
                    },
                    {
                        id: 'users.account',
                        order: 10,
                        Component: AccountMenu
                    }
                ]
            }
        ]
    };
}
