import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ServerModule, setupApiDocs } from '@apograph/bootstrap-server';
import { closeDatabase } from '@apograph/database';
import type { Server } from 'node:http';
import { buildTestPlugins } from './plugins';
import { buildTestConfig, type TestConfigOverrides } from './test-config';
import { resolveDatabaseUrl } from './db-url';
import {
    assertDatabaseReachable,
    withDatabaseDiagnostics
} from './infra-error';

export interface TestApp {
    app: INestApplication;
    /** Raw HTTP server to hand to supertest: `request(harness.server)`. */
    server: Server;
}

/**
 * The address the harness binds — and the one supertest dials.
 *
 * `supertest` builds every URL as `http://127.0.0.1:<port>` (hard-coded, see
 * `Test.serverAddress`), so this is not a preference: it is the other half of
 * an equation that has to balance. See {@link listenOnLoopback}.
 */
const LOOPBACK = '127.0.0.1';

/**
 * Boots the real server in-process against the e2e testcontainer and returns
 * it listening on an ephemeral **loopback** port, which is what supertest
 * drives. This mirrors `createServer` (same plugins via `buildTestPlugins`,
 * same global prefix, `ValidationPipe` and `setupApiDocs`); the only
 * differences from production are the silenced logger and the bound address.
 * `app.init()` also runs the `OnApplicationBootstrap` seeders (system roles),
 * exactly as a real boot.
 *
 * Migrations are NOT run here — `global-setup` already migrated the shared
 * container once.
 */
export async function createTestApp(
    overrides: TestConfigOverrides = {}
): Promise<TestApp> {
    const config = buildTestConfig(resolveDatabaseUrl(), overrides);
    const plugins = buildTestPlugins(config, {
        localMediaRoot: overrides.localMediaRoot,
        signingProvider: overrides.directServe === 'signed-url',
        ssoProviders: overrides.ssoProviders,
        omitContent: overrides.omitContent
    });

    return withDatabaseDiagnostics('booting the test app', () =>
        bootTestApp(config, plugins)
    );
}

async function bootTestApp(
    config: ReturnType<typeof buildTestConfig>,
    plugins: ReturnType<typeof buildTestPlugins>
): Promise<TestApp> {
    // Mirror createServer: plugin init hooks run before the app is created so
    // the database connection is open before any provider is instantiated.
    for (const plugin of plugins) {
        await plugin.onPluginInit?.();
    }

    // One `SELECT 1` before Nest instantiates a single provider. If the shared
    // container has died, this is where the run says so — rather than whichever
    // bootstrap seeder happened to notice first, reported as that suite's own
    // failure.
    await assertDatabaseReachable();

    // Silent by default — 70 suites each booting an app would otherwise bury the
    // report under Nest's start-up banner. `E2E_LOG=1` puts the real logger
    // back, which is the only way to see *why* a request 500ed: the
    // `ExceptionsHandler` line carries the failing query and the driver's own
    // message, and without it a suite can only report the status code. A
    // `malformed array literal` from a hand-written SQL fragment is exactly that
    // shape — invisible in the assertion, one line long in the log.
    const app = await NestFactory.create<NestExpressApplication>(
        ServerModule.forRoot(plugins),
        { logger: process.env['E2E_LOG'] ? undefined : false }
    );
    // Mirrors `createServer`, and before anything reads `req.ip`: the login
    // throttle buckets on it, so a suite that asserts per-client limiting has
    // to boot with the same proxy trust a real deployment configures.
    if (config.trustProxy !== undefined) {
        app.set('trust proxy', config.trustProxy);
    }
    // Mirrors `createServer`: an explicit body cap, rather than express's
    // inherited 100 kB. Registered here as well so a suite can assert the
    // boundary — the number is a decision now, and a decision nothing checks
    // is one a refactor can silently drop.
    app.useBodyParser('json', { limit: config.bodyLimit });
    app.useBodyParser('urlencoded', {
        limit: config.bodyLimit,
        extended: true
    });

    app.setGlobalPrefix('api');
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
        })
    );

    // After the prefix + pipe, exactly as `createServer` does it, so a suite can
    // assert the reference is mounted when `docsEnabled` is on and absent when
    // it is off — the production-parity claim that used to be untestable
    // because the harness skipped this call entirely. A no-op (returns `null`)
    // for every suite that leaves docs disabled, which is all but one.
    setupApiDocs(app, plugins, config.docs, 'api');

    await app.init();

    const server = app.getHttpServer() as Server;
    await listenOnLoopback(server);
    return { app, server };
}

/**
 * Binds the app's HTTP server to an ephemeral port **on `127.0.0.1`**, once,
 * before any test touches it.
 *
 * ## Why this exists
 *
 * Left unlistened, supertest listens for us — and it does it wrong in a way
 * that cost this suite roughly two tests per full run, on a different pair
 * every time, for as long as anyone has run it end to end:
 *
 * ```js
 * // supertest/lib/test.js
 * serverAddress(app, path) {
 *     const addr = app.address();
 *     if (!addr) this._server = app.listen(0);      // binds the WILDCARD
 *     const port = app.address().port;
 *     return 'http://127.0.0.1:' + port + path;      // dials LOOPBACK
 * }
 * ```
 *
 * `listen(0)` with no host binds `0.0.0.0`/`::`, and Node sets `SO_REUSEADDR`,
 * which on **BSD/macOS** lets that bind **succeed on a port another process
 * already holds bound to `127.0.0.1` specifically**. The more specific socket
 * wins for loopback traffic, so the request that follows is answered by the
 * stranger. On a developer machine those strangers are ordinary: a JetBrains
 * IDE's built-in server (`127.0.0.1:63342`), the JetBrains toolbox, an Electron
 * app's local bridge. They answer `403`, or `301`, or hang up — which is
 * exactly the shape the failures took (a content write "refused" 403, a
 * `read ECONNRESET`).
 *
 * Linux refuses the overlap (`SO_REUSEADDR` there only covers `TIME_WAIT`), so
 * a Linux runner never saw this — which is worth knowing before a CI gate is
 * read as proof the developer machines are fine.
 *
 * It was rare-but-inevitable rather than random because supertest **closes the
 * server again after every request** (`Test.end` → `server.close()`), so the
 * old harness re-bound a fresh ephemeral port for *each* of the ~35 000
 * requests a full run makes. macOS hands out 49152–65535 and each request burns
 * two (the listener and the client's source port), so a full run cycles the
 * whole range about four times and lands on every occupied port about four
 * times. A per-directory run never gets far enough round the ring to hit one,
 * which is why the instability was invisible until someone ran the suite whole.
 *
 * Naming the address closes it completely: the kernel will not hand a
 * `127.0.0.1` listen a port that is already bound on `127.0.0.1` (it answers
 * `EADDRINUSE` and picks another), so a collision cannot be constructed. Doing
 * it here also means `app.address()` is already set when supertest looks, so it
 * neither listens nor closes — one bind per spec file instead of one per
 * request, and connections stay keep-alive across a file.
 *
 * `harness-binding.spec.ts` pins both halves.
 */
async function listenOnLoopback(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once('error', onError);
        server.listen(0, LOOPBACK, () => {
            server.removeListener('error', onError);
            resolve();
        });
    });
}

/**
 * Tears down a harness: closes the Nest app and the database pool. Jest
 * isolates module registries per spec file, so the `@apograph/database`
 * singleton pool is per-file — closing it here keeps the worker free of
 * open handles between files.
 *
 * `closeDatabase` rather than `getPool().end()`: ending the pool alone leaves
 * `initDatabase`'s memo populated, so a *second* `createTestApp` in the same
 * file would silently reuse the ended pool and every query would throw "Cannot
 * use a pool after calling end on the pool".
 */
export async function closeTestApp(harness: TestApp): Promise<void> {
    await harness.app.close();
    await closeDatabase();
}
