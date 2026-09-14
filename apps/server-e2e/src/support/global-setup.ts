/* eslint-disable */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { buildTestPlugins } from './plugins';
import { buildTestConfig } from './test-config';
import { publishDatabaseUrl } from './db-url';
import {
    assertDisposableExternalDatabase,
    assertSerialExecution,
    availableMemoryBytes,
    heapCeilingBytes,
    warnOnLowHeapCeiling,
    warnOnLowMemory
} from './preflight';

/**
 * One Postgres testcontainer for the whole e2e run, migrated once with the
 * per-plugin migration descriptors from {@link buildTestPlugins}. We apply each
 * plugin's `migrations` ({ dir, table }) exactly as `server:db:migrate` does, so
 * the schema under test is the real shipped schema for every plugin — except
 * content, whose tables come from the e2e-owned model (`src/support/content`),
 * decoupling the run from `apps/server`'s collections.
 *
 * The container handle is stashed on `globalThis` for teardown; the
 * connection string is published for the worker via {@link publishDatabaseUrl}.
 */
module.exports = async function (globalConfig?: { maxWorkers?: number }) {
    // Before anything else: this suite is only correct run serially, and the
    // config that pins that is overridable from the CLI. Fail here, loudly,
    // rather than 20 minutes later as cross-suite data corruption.
    assertSerialExecution(globalConfig?.maxWorkers);

    // Advisory, not a gate. If the run goes red in its back half, this line is
    // the difference between "memory" and a 20-minute misdiagnosis.
    warnOnLowMemory(availableMemoryBytes());

    // Same idea, different resource. Memory the machine *has* is one thing; the
    // ceiling this process is allowed to grow its heap to is another, and the
    // second one is what a full run actually dies on. Both advisory.
    warnOnLowHeapCeiling(heapCeilingBytes());

    // `E2E_DATABASE_URL` points the run at an already-running Postgres instead
    // of starting a container. Deliberately its OWN variable rather than
    // reusing `DATABASE_URL`: this suite truncates every table between tests,
    // and `DATABASE_URL` is routinely set in a developer's `.env` pointing at
    // their working database. An opt-in name cannot be triggered by accident.
    //
    // The database it names must be disposable. This exists so the suite can
    // run where Docker is unavailable (a sandbox, a Docker-less CI runner);
    // the container remains the default and the thing CI normally uses.
    const external = process.env['E2E_DATABASE_URL'];

    let container:
        | Awaited<ReturnType<PostgreSqlContainer['start']>>
        | undefined;
    let connectionString: string;

    if (external) {
        // "Its own variable" is a convention, not a guard — nothing stops the
        // two being set to the same URL. Check before the first TRUNCATE, not
        // after.
        assertDisposableExternalDatabase(external, process.env['DATABASE_URL']);
        console.log('\n[e2e] using E2E_DATABASE_URL (no testcontainer)…');
        connectionString = external;
    } else {
        console.log('\n[e2e] starting Postgres testcontainer…');
        container = await new PostgreSqlContainer('postgres:16-alpine').start();
        // Stashed immediately. Jest does NOT run `globalTeardown` when
        // `globalSetup` throws, so the `catch` below is what actually stops the
        // container on a migration failure — but publishing the handle first
        // keeps the two ways of finding it from disagreeing.
        (globalThis as any).__PG_CONTAINER__ = container;
        connectionString = container.getConnectionUri();
    }

    try {
        // Apply every plugin's migrations against the fresh container. We build
        // the plugin list from the e2e factory so order and descriptors match
        // the boot; only the migration metadata is consumed here.
        // `mail: 'testkit'` here and nowhere else: the migration pass has to
        // create `mail_deliveries` even though almost every suite boots without
        // the plugin, or the one suite that does boot it would find no table.
        const plugins = buildTestPlugins(buildTestConfig(connectionString), {
            mail: 'testkit'
        });
        const pool = new Pool({ connectionString });
        try {
            const db = drizzle(pool);
            for (const plugin of plugins) {
                if (!plugin.migrations) continue;
                console.log(`[e2e] migrating "${plugin.name}"…`);
                try {
                    await migrate(db, {
                        migrationsFolder: plugin.migrations.dir(),
                        migrationsTable: plugin.migrations.table
                    });
                } catch (error) {
                    // Plugin order in `plugins.ts` is load-bearing (a plugin's
                    // tables FK an earlier plugin's), and a raw
                    // `relation "workspaces" does not exist` names neither the
                    // plugin nor the cause. Say both.
                    throw new Error(
                        `[e2e] migrating plugin "${plugin.name}" failed: ${
                            (error as Error).message
                        }\n\n` +
                            'If this is a missing relation, the likely cause is plugin ORDER in\n' +
                            "`src/support/plugins.ts` — a plugin's migrations run before those of\n" +
                            'every plugin listed after it, so a table it references must belong to a\n' +
                            'plugin listed before it.',
                        { cause: error }
                    );
                }
            }
        } finally {
            await pool.end();
        }

        publishDatabaseUrl(connectionString);
    } catch (error) {
        // Jest skips `globalTeardown` when `globalSetup` throws, so without this
        // the container survives the run — one orphaned `postgres:16-alpine`
        // per failed setup, forever, which is how a developer machine ends up
        // out of memory (and how this suite then "fails" for unrelated reasons).
        if (container) {
            await container.stop().catch(() => undefined);
            (globalThis as any).__PG_CONTAINER__ = undefined;
            console.log('[e2e] testcontainer stopped after a failed setup.');
        }
        throw error;
    }

    console.log(
        `[e2e] database ready${container ? ' (testcontainer)' : ''}.\n`
    );
};
