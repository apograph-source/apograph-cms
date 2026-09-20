import type { ServerPlugin } from '@orthacms/bootstrap-server';
import { UsersModule } from '../users.module';
import { describeUsersApi } from '../docs/describe-users-api';

/**
 * Server plugin for member management. A plain {@link ServerPlugin} — the
 * feature carries no config, so (unlike identity) there is nothing to attach.
 */
export type UsersServerPlugin = ServerPlugin;

/**
 * Creates the users plugin: the member-management API (`/api/users`) the
 * admin's Members page drives — list/search/paginate, invite, edit name and
 * role, disable/enable, and resend/revoke invites.
 *
 * Conventionally registered **after** `IdentityPlugin`, whose user/role/
 * membership/token tables it reads and writes and whose migrations must be
 * applied for the routes to work. (Identity's `AuthGuard` is an `APP_GUARD`,
 * collected globally regardless of plugin order; identity's global module
 * also provides the `PermissionsService` this plugin's route guards inject.)
 *
 * Ships **no migrations**: it owns no schema (every table it touches is
 * migrated by identity).
 *
 * @example
 * ```typescript
 * createServer({
 *   plugins: [
 *     DatabasePlugin({ connectionString: config.database.url }),
 *     IdentityPlugin(config.plugins.identity),
 *     WorkspacesPlugin(),
 *     UsersPlugin(),
 *   ],
 * });
 * ```
 */
export function UsersPlugin(): UsersServerPlugin {
    return {
        name: 'users',
        module: UsersModule.forRoot(),
        // The member views are TypeScript `interface`s, so `@nestjs/swagger`
        // emits a status code and no payload for every route here. This hook
        // writes the response schemas back on. See
        // `packages/bootstrap/server/AGENTS.md` → "The response-schema gap".
        docs: { decorate: (document) => describeUsersApi(document) }
    };
}
