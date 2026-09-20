import type { NestExpressApplication } from '@nestjs/platform-express';
import { createServer } from '@orthacms/bootstrap-server';
import { closeDatabase } from '@orthacms/database';
import type { Server } from 'node:http';
import config from '../../../server/ortha.config';
import { buildPlugins } from '../../../server/src/plugins';

/**
 * An origin the login route accepts.
 *
 * Login is guarded against cross-site POSTs by an allow-list, so a request
 * with no `Origin` — or the wrong one — is refused with `403` before the
 * credentials are ever looked at. Read from the config rather than hardcoded:
 * the list follows `ADMIN_PORT`, so a hardcoded `:4200` fails on any app whose
 * admin runs somewhere else, and fails as a confusing `403` rather than
 * "wrong origin".
 */
export const ALLOWED_ORIGIN =
    config.plugins.identity.allowedOrigins?.[0] ?? 'http://localhost:4200';

/** A booted app plus the raw server to hand to supertest. */
export interface TestApp {
    app: NestExpressApplication;
    server: Server;
}

/**
 * Boots **this app** — the real `buildPlugins`, the real config — on an
 * ephemeral port.
 *
 * Deliberately `createServer` rather than a hand-assembled Nest app: a harness
 * that mirrors the bootstrap can never fail on a bootstrap defect, and this
 * suite exists to catch exactly the things that only appear once everything is
 * wired together. Port `0` keeps parallel runs from colliding; supertest is
 * handed the server object, so nothing depends on the number.
 *
 * `createServer` also runs the `OnApplicationBootstrap` seeders, so the system
 * roles and the root admin from `.env.e2e` exist by the time a test runs.
 */
export async function createTestApp(): Promise<TestApp> {
    const app = await createServer({
        plugins: buildPlugins(config),
        port: 0,
        globalPrefix: config.globalPrefix,
        bodyLimit: config.bodyLimit,
        // The reference is developer tooling and adds a route surface these
        // tests do not describe. Off, whatever the environment says.
        docs: { ...config.docs, enabled: false }
    });

    return { app, server: app.getHttpServer() as Server };
}

/**
 * Closes the app and the database pool.
 *
 * `app.close()` does not end the pool — nothing binds a shutdown hook to it —
 * so without `closeDatabase` the Jest worker stays alive on an open handle and
 * the run hangs after the last assertion passes.
 */
export async function closeTestApp(harness: TestApp): Promise<void> {
    await harness.app.close();
    await closeDatabase();
}
