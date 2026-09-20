import { join } from 'node:path';
import type { ServerPlugin } from '@orthacms/bootstrap-server';
import { ActivityModule } from '../activity.module';
import { describeActivityApi } from '../docs/describe-activity-api';

/**
 * Server plugin for the audit log. A plain {@link ServerPlugin} — the feature
 * carries no host config.
 *
 * Owns the `activity_events` schema and **ships its own migrations**, so the
 * `migrations` descriptor points the host's `db:migrate` at this package's
 * committed SQL, tracked under its own table. Conventionally registered
 * **after** `DatabasePlugin` (whose client it injects) and `IdentityPlugin`
 * (whose guards gate its read API and whose `activity:read` permission it
 * relies on).
 *
 * @example
 * ```typescript
 * createServer({
 *   plugins: [
 *     DatabasePlugin({ connectionString: config.database.url }),
 *     IdentityPlugin(config.plugins.identity),
 *     ActivityPlugin(),
 *     UsersPlugin(),
 *   ],
 * });
 * ```
 */
export function ActivityPlugin(): ServerPlugin {
    return {
        name: 'activity',
        module: ActivityModule.forRoot(),
        migrations: {
            dir: () => join(__dirname, '../../../migrations'),
            table: '__drizzle_migrations_activity'
        },
        // The three read routes answer plain `interface`s, which the OpenAPI
        // scanner cannot see and no configuration switch can infer.
        docs: { decorate: describeActivityApi }
    };
}
