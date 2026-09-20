import { join } from 'node:path';
import type { ServerPlugin } from '@orthacms/bootstrap-server';
import { WorkspacesModule } from '../workspaces.module';
import { describeWorkspacesApi } from '../docs/describe-workspaces-api';

/**
 * Server plugin for workspaces (the tenancy bounded context). Carries no config
 * of its own, so it is exactly the standard {@link ServerPlugin} shape.
 */
export type WorkspacesServerPlugin = ServerPlugin;

/**
 * Creates the workspaces plugin. Register it **after** `IdentityPlugin` and
 * **before** `ContentPlugin` in the `plugins` array:
 *
 * - after identity, because the `memberships` table carries an FK to identity's
 *   `users`, so that table must be migrated first, and the workspace services
 *   read identity's `users` / `roles`;
 * - before content, because content scopes its routes with this plugin's
 *   `WorkspaceGuard` and binds its `CONTENT_CATALOG` / `CONTENT_ENTRY_COUNTER`
 *   ports.
 *
 * @example
 * ```typescript
 * createServer({
 *   plugins: [
 *     DatabasePlugin({ connectionString: config.database.url }),
 *     IdentityPlugin(config.plugins.identity),
 *     WorkspacesPlugin(),
 *   ],
 * });
 * ```
 */
export function WorkspacesPlugin(): WorkspacesServerPlugin {
    return {
        name: 'workspaces',
        module: WorkspacesModule.forRoot(),
        migrations: {
            // Lazy — only called at migrate time, never at boot. Source
            // layout: src/lib/utils → ../../../migrations = <pkg>/migrations.
            dir: () => join(__dirname, '../../../migrations'),
            table: '__drizzle_migrations_workspaces'
        },
        // Every response here is a plain `interface`, which the swagger scanner
        // cannot see — so the workspace shapes are written onto the document
        // directly rather than through decorators it has nothing to reflect.
        docs: {
            decorate: (document) => describeWorkspacesApi(document)
        }
    };
}
