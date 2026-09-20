import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import type { ServerPlugin } from '@orthacms/bootstrap-server';

/**
 * `host:port/database` for a connection string, with the credentials removed.
 *
 * Applying migrations is the most destructive thing this workspace's tooling
 * does, and the log used to say only which plugin was running — never *where*.
 * An unparseable URL is reported as such rather than guessed at; it is a label
 * for a human, so being vague beats being wrong.
 */
export function describeTarget(databaseUrl: string): string {
    try {
        const url = new URL(databaseUrl);
        const port = url.port ? `:${url.port}` : '';
        const database = url.pathname.replace(/^\//, '') || '(default)';

        return `${url.hostname}${port}/${database}`;
    } catch {
        return '(unparseable DATABASE_URL)';
    }
}

/**
 * Applies every registered plugin's shipped migrations. Each plugin is
 * tracked in its own table so plugins version independently. Source
 * plugins and npm-installed plugins go through the identical path — each
 * just advertises its own `migrations.dir`.
 *
 * The plugins are applied in the order the host listed them, and that order is
 * load-bearing: a plugin's tables may FK-reference an earlier plugin's
 * (workspaces' `memberships` references identity's `users`). Nothing declares
 * that dependency, so when a migration fails the order is the first thing to
 * suspect — which is why the failure says so, along with how far the run got.
 */
export async function applyPluginMigrations(
    plugins: ServerPlugin[],
    databaseUrl: string
): Promise<void> {
    const withMigrations = plugins.filter((plugin) => plugin.migrations);

    if (withMigrations.length === 0) {
        console.log('No plugin migrations to apply.');
        return;
    }

    const total = withMigrations.length;
    console.log(
        `Applying migrations for ${total} plugin(s) to ${describeTarget(databaseUrl)}`
    );

    const pool = new Pool({ connectionString: databaseUrl });
    const db = drizzle(pool);
    let applied = 0;

    try {
        for (const plugin of withMigrations) {
            const migrations = plugin.migrations;
            if (!migrations) {
                continue;
            }
            console.log(
                `Applying migrations: ${plugin.name} → ${migrations.table}`
            );
            try {
                await migrate(db, {
                    migrationsFolder: migrations.dir(),
                    migrationsTable: migrations.table
                });
            } catch (error) {
                throw new Error(migrationFailure(plugin.name, applied, total), {
                    cause: error
                });
            }
            applied += 1;
        }
        console.log('Migrations complete.');
    } finally {
        await pool.end();
    }
}

/**
 * What the operator needs and a raw `relation "users" does not exist` does not
 * give them: which plugin failed, which ones already committed (they are not
 * rolled back — each plugin's migrations commit as they go), and the one cause
 * that explains most missing-relation failures.
 */
function migrationFailure(
    pluginName: string,
    applied: number,
    total: number
): string {
    return (
        `Migrating plugin "${pluginName}" failed — applied ${applied} of ${total} ` +
        `plugin(s) before it; the rest were not attempted.\n\n` +
        `Nothing is rolled back: the ${applied} plugin(s) above are committed, and ` +
        `re-running db:migrate resumes from "${pluginName}" once the cause is fixed.\n\n` +
        `If this is a missing relation, the likely cause is plugin ORDER in the ` +
        `host's plugins.ts — a plugin's migrations run before those of every plugin ` +
        `listed after it, so a table it references must belong to a plugin listed ` +
        `before it.`
    );
}
