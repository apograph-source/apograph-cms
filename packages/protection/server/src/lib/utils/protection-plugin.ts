import { join } from 'node:path';
import type { ServerPlugin } from '@orthacms/bootstrap-server';
import { ProtectionModule } from '../protection.module';
import { describeProtectionApi } from '../docs/describe-protection-api';

/**
 * The publication-protection plugin — a per-content-type rule requiring N
 * approvals before an entry may be published.
 *
 * Register it after `ContentPlugin`, whose registry and workspace grants it
 * reads, and after `WorkspacesPlugin`, whose guard scopes its routes and whose
 * purge registry clears its rows:
 *
 * ```typescript
 * createServer({
 *   plugins: [
 *     ContentPlugin(config.plugins.content),
 *     ProtectionPlugin()
 *   ],
 * });
 * ```
 *
 * **Registering it changes nothing on its own.** With no rule written in the
 * admin, publication behaves byte for byte as it does with the plugin
 * uninstalled — no predicate, no extra query on the publish path, no chip in
 * the interface. Every existing installation is in that state, and it is the
 * first property to keep true when changing anything here.
 *
 * It takes no configuration, deliberately: the rule table is the whole
 * configuration surface and its empty state is the off state.
 */
export function ProtectionPlugin(): ServerPlugin {
    return {
        name: 'protection',
        module: ProtectionModule.forRoot(),
        // Its own folder and its own journal table, like every other plugin
        // that owns tables: the host applies each plugin's pending migrations
        // independently, so installing this one later disturbs nothing already
        // applied. The path is a thunk so it resolves at migrate time and works
        // whether the package is consumed from source or installed from npm.
        migrations: {
            dir: () => join(__dirname, '..', '..', '..', 'migrations'),
            table: '__drizzle_migrations_protection'
        },
        // The response view is an `interface`, erased at compile time, so the
        // swagger scanner sees the paths and the request body but arrives at
        // every operation with a bare 2xx and no content. This fills those in.
        docs: { decorate: describeProtectionApi }
    };
}
