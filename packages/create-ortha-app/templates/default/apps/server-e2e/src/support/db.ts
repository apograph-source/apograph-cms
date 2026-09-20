import { existsSync } from 'node:fs';
import { Pool } from 'pg';

/**
 * Loads `.env` into `process.env`.
 *
 * Jest loads nothing — not in the main process where `globalSetup` runs, and
 * not in the workers. `ortha.config.ts` reads `process.env` at import time and
 * refuses to load without `DATABASE_URL`, so every entry point into this suite
 * has to call this **before** anything reaches the config.
 *
 * Values already exported in the shell win, which is what lets CI set the
 * database without a file.
 */
export function loadDotEnv(): void {
    if (existsSync('.env') && typeof process.loadEnvFile === 'function') {
        process.loadEnvFile('.env');
    }
}

/**
 * The database the server e2e suite runs against.
 *
 * **Never your development database.** This suite truncates every table
 * between tests, and `DATABASE_URL` is routinely set in a `.env` pointing at
 * the database you are actually working in. So the URL is derived into a
 * separate `<name>_e2e`, and `E2E_DATABASE_URL` overrides it — an opt-in name
 * that cannot be triggered by accident.
 */
const SUFFIX = '_e2e';

export function resolveTestDatabaseUrl(): string {
    const explicit = process.env['E2E_DATABASE_URL']?.trim();
    if (explicit) return explicit;

    const base = process.env['DATABASE_URL']?.trim();
    if (!base) {
        throw new Error(
            'Neither E2E_DATABASE_URL nor DATABASE_URL is set — the e2e suite ' +
                'needs to know which database to create and truncate.'
        );
    }

    const url = new URL(base);
    const database = url.pathname.replace(/^\//, '');

    // **Idempotent.** `global-setup` runs in Jest's main process and points
    // `DATABASE_URL` at the test database; workers fork from it and inherit
    // that value, so a naive append derives `app_e2e_e2e` in the worker and
    // every test then fails against a database nobody created.
    if (database.endsWith(SUFFIX)) return base;

    url.pathname = `/${database}${SUFFIX}`;

    return url.toString();
}

/**
 * Refuses to run against the database `DATABASE_URL` names.
 *
 * The derivation above makes a collision unlikely, but `E2E_DATABASE_URL` can
 * be set to anything — and the first thing this suite does to whatever it is
 * handed is delete every row. Check before the first `TRUNCATE`, not after.
 */
export function assertDisposable(testUrl: string): void {
    const development = process.env['DATABASE_URL']?.trim();

    if (development && new URL(testUrl).href === new URL(development).href) {
        throw new Error(
            'E2E_DATABASE_URL points at the same database as DATABASE_URL. ' +
                'This suite truncates every table — point it somewhere disposable.'
        );
    }
}

/** Opens a pool against the `postgres` maintenance database on the same host. */
function maintenancePool(testUrl: string): Pool {
    const url = new URL(testUrl);
    const database = url.pathname.replace(/^\//, '');
    url.pathname = '/postgres';

    return Object.assign(new Pool({ connectionString: url.toString() }), {
        targetDatabase: database
    });
}

/**
 * Creates the test database if it is not there yet.
 *
 * `CREATE DATABASE` cannot run inside a transaction and has no `IF NOT
 * EXISTS`, so this asks first. Losing the race with another runner is fine —
 * `42P04` means someone else created it, which is the outcome we wanted.
 */
export async function ensureDatabase(testUrl: string): Promise<void> {
    const pool = maintenancePool(testUrl);
    const database = (pool as Pool & { targetDatabase: string })
        .targetDatabase;

    try {
        const { rowCount } = await pool.query(
            'SELECT 1 FROM pg_database WHERE datname = $1',
            [database]
        );
        if (rowCount === 0) {
            // The name comes from our own derivation, not from user input, and
            // CREATE DATABASE takes no parameters.
            await pool.query(`CREATE DATABASE "${database}"`);
        }
    } catch (error) {
        if ((error as { code?: string }).code !== '42P04') throw error;
    } finally {
        await pool.end();
    }
}

/**
 * Empties every table, leaving the schema and the migration history alone.
 *
 * One `TRUNCATE … CASCADE` rather than a delete per table: it ignores foreign
 * keys, so the suite never has to know which order its own content types
 * depend on each other in. `RESTART IDENTITY` keeps sequences from drifting
 * across a run, so an id asserted in one test means the same thing in the next.
 */
export async function resetDatabase(testUrl: string): Promise<void> {
    const pool = new Pool({ connectionString: testUrl });

    try {
        const { rows } = await pool.query<{ tables: string[] }>(`
            SELECT array_agg(format('%I.%I', schemaname, tablename)) AS tables
            FROM pg_tables
            WHERE schemaname = 'public'
              AND tablename NOT LIKE '\\_\\_drizzle%'
        `);
        const tables = rows[0]?.tables;
        if (!tables?.length) return;

        await pool.query(
            `TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`
        );
    } finally {
        await pool.end();
    }
}
