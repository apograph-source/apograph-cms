import { Suspense, lazy } from 'react';
import type { AdminPlugin } from '@orthacms/bootstrap-admin';
import { SIDEBAR_NAV_SLOT } from '@orthacms/shell-admin';
import { Spinner } from '@orthacms/design-system';
import { Webhook } from 'lucide-react';
import { WebhooksPageSkeleton } from '../../presentation/components/WebhooksSkeleton';

// Lazy-loaded so each page is code-split into its own chunk, fetched only when
// someone first navigates to it.
const WebhooksPage = lazy(() =>
    import('../../presentation/pages/WebhooksPage').then((module) => ({
        default: module.WebhooksPage
    }))
);

const WebhookEditorPage = lazy(() =>
    import('../../presentation/pages/WebhookEditorPage').then((module) => ({
        default: module.WebhookEditorPage
    }))
);

const WebhookDetailPage = lazy(() =>
    import('../../presentation/pages/WebhookDetailPage').then((module) => ({
        default: module.WebhookDetailPage
    }))
);

/**
 * Admin-side webhooks plugin shape. A thin alias of {@link AdminPlugin}, kept
 * named so future config has a home.
 */
export type WebhooksAdminPlugin = AdminPlugin;

/**
 * Creates the admin-side webhooks plugin.
 *
 * It owns the global webhook-management feature — `/webhooks`,
 * `/webhooks/new`, `/webhooks/:id` and `/webhooks/:id/edit` — rendered inside
 * the shell's authenticated layout, plus an
 * entry in the **global** sidebar's `directory` group alongside Workspaces,
 * Members and API tokens — reachable without selecting a workspace, because an
 * endpoint is not scoped to one.
 *
 * The nav row and both pages gate on `webhooks:read`, which is
 * administrator-only: the rows hold a signing secret and reach across every
 * workspace they name.
 *
 * @example
 * ```typescript
 * createAdmin({
 *   plugins: [
 *     IdentityPlugin(),
 *     ShellPlugin(),
 *     WorkspacesPlugin(),
 *     ApiTokensPlugin(),
 *     WebhooksPlugin(),
 *   ],
 * });
 * ```
 */
export function WebhooksPlugin(): WebhooksAdminPlugin {
    return {
        name: 'webhooks',
        routes: [
            {
                path: '/webhooks',
                element: (
                    <Suspense fallback={<WebhooksPageSkeleton />}>
                        <WebhooksPage />
                    </Suspense>
                )
            },
            {
                // Before the `:id` route for readability only — the router
                // ranks a static segment above a dynamic one either way.
                path: '/webhooks/new',
                element: (
                    <Suspense fallback={<Spinner />}>
                        <WebhookEditorPage mode="create" />
                    </Suspense>
                )
            },
            {
                path: '/webhooks/:id',
                element: (
                    <Suspense fallback={<Spinner />}>
                        <WebhookDetailPage />
                    </Suspense>
                )
            },
            {
                path: '/webhooks/:id/edit',
                element: (
                    <Suspense fallback={<Spinner />}>
                        <WebhookEditorPage mode="edit" />
                    </Suspense>
                )
            }
        ],
        slots: [
            {
                slot: SIDEBAR_NAV_SLOT,
                items: [
                    {
                        labelId: 'webhooks.nav.label',
                        defaultLabel: 'Webhooks',
                        to: '/webhooks',
                        group: 'directory',
                        // After API tokens (30): both are integration surfaces,
                        // and a webhook is the one you reach for second.
                        order: 40,
                        icon: Webhook,
                        iconColor: 'text-nav-purple',
                        permission: 'webhooks:read'
                    }
                ]
            }
        ]
    };
}
