import type { AdminPlugin } from '@orthacms/bootstrap-admin';
import { IdentityRouter } from '../router';

/**
 * Admin-side identity plugin shape. Mirrors `IdentityServerPlugin`; carries no
 * extra fields yet — kept as a named type so future config (slots, nav) has a
 * home.
 */
export type IdentityAdminPlugin = AdminPlugin;

/**
 * Creates the admin-side identity plugin. It mounts the auth screens: a single
 * wildcard route `/identity/*` whose nested router owns the sub-paths; today it
 * serves the login UI at `/identity/signin`. The route is `public` — sign-in
 * must be reachable while logged out, so it sits outside the authenticated
 * shell.
 *
 * Auth *state* and the route *gate* also live in this plugin
 * ({@link AuthProvider}, {@link RequireAuth}), but they are not contributed via
 * a slot — the shell imports and composes them into its `layout`.
 *
 * @example
 * ```typescript
 * createAdmin({
 *   plugins: [
 *     IdentityPlugin(),
 *   ],
 * });
 * ```
 */
export function IdentityPlugin(): IdentityAdminPlugin {
    return {
        name: 'identity',
        routes: [
            { path: '/identity/*', element: <IdentityRouter />, public: true }
        ]
    };
}
