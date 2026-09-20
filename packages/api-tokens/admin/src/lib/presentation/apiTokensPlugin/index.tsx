import { Suspense, lazy } from 'react';
import type { AdminPlugin } from '@orthacms/bootstrap-admin';
import { SIDEBAR_NAV_SLOT } from '@orthacms/shell-admin';
import { KeyRound } from 'lucide-react';
import { ApiTokensPageSkeleton } from '../components/ApiTokensSkeleton';

// Lazy-loaded so the page is code-split into its own chunk, fetched only when a
// signed-in user first navigates to `/api-tokens`.
const ApiTokensPage = lazy(() =>
    import('../pages/ApiTokensPage').then((module) => ({
        default: module.ApiTokensPage
    }))
);

/**
 * Admin-side API-tokens plugin shape. A thin alias of {@link AdminPlugin}, kept
 * named so future config has a home.
 */
export type ApiTokensAdminPlugin = AdminPlugin;

/**
 * Creates the admin-side API-tokens plugin. It owns the global token-management
 * feature: the private `/api-tokens` route (rendered inside the shell's
 * authenticated layout) and its entry in the **global** sidebar's `directory`
 * group (alongside Workspaces and Members), so it is reachable without selecting
 * a workspace. The nav row and the page both gate on `tokens:read`.
 *
 * @example
 * ```typescript
 * createAdmin({
 *   plugins: [
 *     IdentityPlugin(),
 *     ShellPlugin(),
 *     WorkspacesPlugin(),
 *     UsersPlugin(),
 *     ApiTokensPlugin(),
 *   ],
 * });
 * ```
 */
export function ApiTokensPlugin(): ApiTokensAdminPlugin {
    return {
        name: 'api-tokens',
        routes: [
            {
                path: '/api-tokens',
                element: (
                    <Suspense fallback={<ApiTokensPageSkeleton />}>
                        <ApiTokensPage />
                    </Suspense>
                )
            }
        ],
        slots: [
            {
                slot: SIDEBAR_NAV_SLOT,
                items: [
                    {
                        labelId: 'apiTokens.nav.label',
                        defaultLabel: 'API Tokens',
                        to: '/api-tokens',
                        group: 'directory',
                        order: 30,
                        icon: KeyRound,
                        iconColor: 'text-nav-orange',
                        permission: 'tokens:read'
                    }
                ]
            }
        ]
    };
}
