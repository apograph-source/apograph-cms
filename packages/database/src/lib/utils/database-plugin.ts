import { join } from 'node:path';
import type { ServerPlugin } from '@apograph/bootstrap-server';
import type { DatabasePluginConfig } from '../types';
import { DatabaseModule } from '../database.module';
import { initDatabase } from './db';

/**
 * Server plugin for the database, carrying its config alongside the
 * standard plugin shape.
 */
export interface DatabaseServerPlugin extends ServerPlugin {
    /** Database configuration. */
    databaseConfig: DatabasePluginConfig;
}

/**
 * Creates the database plugin. The connection is opened eagerly in
 * `onPluginInit` (before the Nest app is created), so list it first in
 * the `plugins` array — every other plugin can then assume a live db.
 *
 * @example
 * ```typescript
 * createServer({
 *   plugins: [
 *     DatabasePlugin({ connectionString: config.database.url }),
 *   ],
 * });
 * ```
 */
export function DatabasePlugin(
    config: DatabasePluginConfig
): DatabaseServerPlugin {
    return {
        name: 'database',
        module: DatabaseModule.forRoot({
            outboxRetentionDays: config.outboxRetentionDays
        }),
        databaseConfig: config,
        onPluginInit() {
            initDatabase(config);
        },
        // This plugin owns exactly one table, the transactional outbox — the
        // sanctioned exception to "database owns no schema". Lazy — only
        // called at migrate time, never at boot. Source layout:
        // src/lib/utils → ../../../migrations = <pkg>/migrations.
        migrations: {
            dir: () => join(__dirname, '../../../migrations'),
            table: '__drizzle_migrations_database'
        }
    };
}
