import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Hand-off channel for the testcontainer's connection string.
 *
 * `global-setup` runs in Jest's main process; specs run in a worker. The
 * worker inherits `process.env` at fork time, so the URI normally arrives
 * via `DATABASE_URL`. We also persist it to a temp file as a fallback for
 * runners/modes where that inheritance doesn't hold, and read whichever is
 * present. One source of truth, two delivery paths.
 *
 * The filename is keyed by this checkout's path so two worktrees running the
 * suite at once (the parallel-stack workflow in `docs/parallel-stacks.md`)
 * cannot hand each other the wrong container's URI — and teardown removes only
 * the file it wrote, never the shared directory, so finishing first cannot
 * delete another run's handoff out from under it.
 */
const URL_DIR = join(tmpdir(), 'ortha-server-e2e');
const URL_FILE = join(
    URL_DIR,
    `database-url-${createHash('sha256')
        .update(join(__dirname, '..', '..'))
        .digest('hex')
        .slice(0, 12)}`
);

/** Publish the connection string for workers to pick up. Called by setup. */
export function publishDatabaseUrl(connectionString: string): void {
    process.env['DATABASE_URL'] = connectionString;
    mkdirSync(dirname(URL_FILE), { recursive: true });
    writeFileSync(URL_FILE, connectionString, 'utf8');
}

/** Resolve the connection string in a worker. Env first, file fallback. */
export function resolveDatabaseUrl(): string {
    const fromEnv = process.env['DATABASE_URL'];
    if (fromEnv) {
        return fromEnv;
    }
    try {
        return readFileSync(URL_FILE, 'utf8').trim();
    } catch {
        throw new Error(
            'No DATABASE_URL available — is the e2e global-setup running the Postgres testcontainer?'
        );
    }
}

/** Remove this run's handoff file. Called by teardown. */
export function clearDatabaseUrl(): void {
    rmSync(URL_FILE, { force: true });
}
