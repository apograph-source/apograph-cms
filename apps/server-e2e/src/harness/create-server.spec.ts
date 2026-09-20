import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
    createServer,
    setupApiDocs,
    type ApiDocsOptions,
    type ServerPlugin
} from '@orthacms/bootstrap-server';
import { closeDatabase } from '@orthacms/database';
import request from 'supertest';
import { buildTestPlugins } from '../support/plugins';
import { resolveDatabaseUrl } from '../support/db-url';
import {
    buildTestConfig,
    type TestConfigOverrides
} from '../support/test-config';

/**
 * `createServer` itself — the composition root — driven end to end.
 *
 * Every other suite goes through `createTestApp`, which *mirrors*
 * `createServer` but stops at `app.init()`. That mirroring is what makes the
 * host's own defects invisible here: they are deployment-shaped (a body cap
 * inherited from a dependency, a boot failure that reports no plugin name, a
 * SIGTERM that drops in-flight requests), and a harness that reimplements the
 * bootstrap cannot fail on any of them. So this file calls the real thing,
 * listens on an ephemeral port, and closes it again — which is why
 * `createServer` returns the application at all.
 */
describe('createServer (the host bootstrap)', () => {
    const apps: NestExpressApplication[] = [];

    beforeAll(() => {
        // `createServer` builds its own Nest app and takes no logger option,
        // so this is the only way to keep a full boot banner per test out of
        // the run's output. `Logger.error` spies still see their calls.
        Logger.overrideLogger(false);
    });

    afterEach(async () => {
        while (apps.length > 0) {
            await apps.pop()?.close();
        }
        jest.restoreAllMocks();
    });

    afterAll(async () => {
        // `app.close()` does not end the pool — nothing binds a shutdown hook
        // to it — so the file closes it, exactly as `closeTestApp` does.
        await closeDatabase();
    });

    /** Boots the real host on an ephemeral port, tracked for teardown. */
    async function boot(
        overrides: TestConfigOverrides = {},
        extraPlugins: ServerPlugin[] = [],
        docs?: ApiDocsOptions,
        staticDir?: string
    ): Promise<NestExpressApplication> {
        const config = buildTestConfig(resolveDatabaseUrl(), overrides);
        const app = await createServer({
            plugins: [...buildTestPlugins(config), ...extraPlugins],
            port: 0,
            // Bind the address supertest dials. A wildcard `listen(0)`
            // succeeds on a port another process already holds on
            // `127.0.0.1`, and every request in this file would then be
            // answered by that process — see `support/test-app.ts`
            // (`listenOnLoopback`) for the whole mechanism.
            host: '127.0.0.1',
            globalPrefix: config.globalPrefix,
            trustProxy: config.trustProxy,
            bodyLimit: config.bodyLimit,
            docs: docs ?? config.docs,
            staticDir
        });
        apps.push(app);
        return app;
    }

    describe('the address it binds', () => {
        it('binds the host it is given, rather than the wildcard', async () => {
            // `host` exists because a wildcard `listen(0)` is handed ports
            // other processes already hold on `127.0.0.1` — Node sets
            // `SO_REUSEADDR` — and the loopback request that follows is
            // answered by them. `harness-binding.spec.ts` demonstrates that
            // hazard; this pins that the option actually reaches `listen`.
            const app = await boot();
            const address = app.getHttpServer().address() as {
                address: string;
            };
            expect(address.address).toBe('127.0.0.1');
        });
    });

    describe('the request body cap is configured, not inherited', () => {
        // Before this, nothing set a limit, so `express.json()`'s 100 kB
        // default applied to every `/api` route — measured at exactly 102 400
        // bytes, which a long-form entry with embedded rich text exceeds. The
        // parser answers 413 before any controller or guard runs, so the cap
        // decides how large a piece of content this CMS can accept.

        /** A syntactically valid login body padded to `bytes` bytes. */
        function bodyOf(bytes: number): string {
            const envelope = JSON.stringify({
                email: 'body-cap@example.com',
                password: ''
            });
            return JSON.stringify({
                email: 'body-cap@example.com',
                password: 'x'.repeat(Math.max(0, bytes - envelope.length))
            });
        }

        it('accepts a body well past express’s inherited 100 kB default [bootstrap:I-05]', async () => {
            const app = await boot();
            // 401 from the credential check, not 413 from the parser: the
            // point is that a 300 kB request reached a controller at all.
            await request(app.getHttpServer())
                .post('/api/auth/login')
                .set('Content-Type', 'application/json')
                .send(bodyOf(300_000))
                .expect(401);
        });

        it('refuses a body over the configured cap with 413 [bootstrap:I-05]', async () => {
            const app = await boot({ bodyLimit: '20kb' });
            await request(app.getHttpServer())
                .post('/api/auth/login')
                .set('Content-Type', 'application/json')
                .send(bodyOf(30_000))
                .expect(413);
        });

        it('still accepts a body under the configured cap', async () => {
            const app = await boot({ bodyLimit: '20kb' });
            await request(app.getHttpServer())
                .post('/api/auth/login')
                .set('Content-Type', 'application/json')
                .send(bodyOf(10_000))
                .expect(401);
        });
    });

    describe('a boot failure says which plugin failed', () => {
        it('names the plugin whose onPluginInit throws, and rejects [bootstrap:I-03]', async () => {
            const error = jest
                .spyOn(Logger, 'error')
                .mockImplementation(() => undefined);
            const config = buildTestConfig(resolveDatabaseUrl());
            const faulty: ServerPlugin = {
                name: 'faulty-under-test',
                module: buildTestPlugins(config)[0].module,
                onPluginInit: () => {
                    throw new Error('boom');
                }
            };

            await expect(
                createServer({
                    plugins: [...buildTestPlugins(config), faulty],
                    port: 0,
                    docs: { enabled: false }
                })
            ).rejects.toThrow('boom');

            // The whole finding: unwrapped, this reached the operator as a bare
            // stack trace with nothing in it identifying which of a dozen
            // registered plugins refused to start.
            expect(error).toHaveBeenCalledWith(
                expect.stringContaining('faulty-under-test'),
                expect.any(String)
            );
        });
    });

    describe('one plugin’s bad docs pass does not take the API down', () => {
        it('logs the plugin and still serves both the API and the reference [bootstrap:I-11]', async () => {
            const error = jest
                .spyOn(Logger, 'error')
                .mockImplementation(() => undefined);
            const config = buildTestConfig(resolveDatabaseUrl(), {
                docsEnabled: true
            });
            const app = await boot({ docsEnabled: true }, [
                {
                    name: 'bad-decorator',
                    module: buildTestPlugins(config)[0].module,
                    docs: {
                        decorate: () => {
                            throw new Error('decorate boom');
                        }
                    }
                }
            ]);

            expect(error).toHaveBeenCalledWith(
                expect.stringContaining('bad-decorator'),
                expect.any(String)
            );
            // The reference is developer tooling; a plugin that throws while
            // describing itself costs its own contribution, not the server.
            await request(app.getHttpServer())
                .get('/reference/json')
                .expect(200);
            await request(app.getHttpServer()).get('/api/auth/me').expect(401);
        });
    });

    describe('the docs mount paths', () => {
        // `setupApiDocs` is exported so a host can build its own
        // `INestApplication` and still get the reference, which makes its
        // return value and its path handling part of this package's contract
        // — and nothing exercised either. Note the return value is only
        // reachable by calling it directly, while the *routes* have to be
        // asserted through `createServer`: registering on the http adapter
        // after `app.init()` has run appends a layer the Nest router already
        // shadows, so a direct call on a listening app returns the paths and
        // serves nothing. That ordering constraint is why `createServer` calls
        // it before `listen`, and it is now written down in `AGENTS.md`.

        it('returns null, and mounts nothing, when docs are disabled [bootstrap:I-10]', async () => {
            const app = await boot();
            const config = buildTestConfig(resolveDatabaseUrl());
            expect(
                setupApiDocs(app, buildTestPlugins(config), { enabled: false })
            ).toBeNull();
            await request(app.getHttpServer()).get('/reference').expect(404);
            await request(app.getHttpServer())
                .get('/reference/json')
                .expect(404);
        });

        it('returns both mount paths normalised', async () => {
            const app = await boot();
            const config = buildTestConfig(resolveDatabaseUrl());
            expect(
                setupApiDocs(
                    app,
                    buildTestPlugins(config),
                    { enabled: true, path: 'ref', jsonPath: 'ref/raw' },
                    'api'
                )
            ).toEqual({ path: '/ref', jsonPath: '/ref/raw' });
        });

        it('serves both routes at a path configured without a leading slash', async () => {
            const app = await boot({ docsEnabled: true }, [], {
                enabled: true,
                path: 'ref',
                jsonPath: 'ref/raw'
            });
            await request(app.getHttpServer())
                .get('/ref')
                .expect(200)
                .expect('content-type', /text\/html/);
            await request(app.getHttpServer())
                .get('/ref/raw')
                .expect(200)
                .expect('content-type', /application\/json/);
            // And nothing is left on the defaults.
            await request(app.getHttpServer()).get('/reference').expect(404);
        });

        it('registers the JSON route first, so it wins a path collision [bootstrap:I-09]', async () => {
            // The default has the document living *under* the UI mount, and
            // express answers with whichever handler was registered first — so
            // the ordering inside `setupApiDocs` is the whole reason
            // `/reference/json` is not swallowed by the Scalar page. Pinning it
            // on an exact collision is the sharpest form of that claim.
            const app = await boot({ docsEnabled: true }, [], {
                enabled: true,
                path: 'clash',
                jsonPath: 'clash'
            });
            await request(app.getHttpServer())
                .get('/clash')
                .expect(200)
                .expect('content-type', /application\/json/);
        });
    });

    describe('SIGTERM is handled rather than fatal', () => {
        it('installs shutdown listeners so in-flight requests are not dropped [bootstrap:I-16]', async () => {
            const before = process.listenerCount('SIGTERM');
            const app = await boot();
            // Without `enableShutdownHooks`, node's default SIGTERM handling
            // tears the process down where it stands: measured against the
            // built bundle, six concurrent in-flight logins all died with a
            // reset connection, and all six completed once the hooks were on.
            expect(process.listenerCount('SIGTERM')).toBeGreaterThan(before);

            await app.close();
            apps.pop();
            // covers: bootstrap:I-17
            expect(process.listenerCount('SIGTERM')).toBe(before);
        });
    });

    /**
     * `staticDir` — serving a built admin from the same process, so the API
     * and the UI share one origin (which is what identity's `SameSite=lax`
     * session cookie requires of a deployment without a dev proxy).
     *
     * The interesting half is not that assets serve; it is everything the SPA
     * fallback must **refuse**. A fallback applied indiscriminately answers a
     * mistyped endpoint with `200` and a page of HTML, so every client sees a
     * success and a JSON parse error, and nothing says the route is gone.
     */
    describe('serving the admin bundle from staticDir', () => {
        let bundle: string;

        beforeEach(() => {
            bundle = mkdtempSync(join(tmpdir(), 'ortha-admin-'));
            writeFileSync(join(bundle, 'index.html'), '<!doctype html>ADMIN');
            mkdirSync(join(bundle, 'assets'));
            writeFileSync(join(bundle, 'assets/app.js'), 'export const x = 1;');
        });

        afterEach(() => rmSync(bundle, { recursive: true, force: true }));

        it('serves a real asset from the bundle', async () => {
            const app = await boot({}, [], undefined, bundle);

            await request(app.getHttpServer())
                .get('/assets/app.js')
                .expect(200)
                .expect((response) =>
                    expect(response.text).toContain('export const x = 1;')
                );
        });

        it('falls back to index.html for a deep client-side route', async () => {
            const app = await boot({}, [], undefined, bundle);

            await request(app.getHttpServer())
                .get('/workspaces/1/entries/2')
                .set('Accept', 'text/html')
                .expect(200)
                .expect((response) => expect(response.text).toContain('ADMIN'));
        });

        /**
         * The regression the reserved-prefix list exists for: without it this
         * returns 200 and HTML, and an API client's "route not found" becomes
         * an unexplained JSON parse error.
         */
        it('leaves an unknown API path as a JSON 404 [bootstrap:I-13]', async () => {
            const app = await boot({}, [], undefined, bundle);

            const response = await request(app.getHttpServer())
                .get('/api/not-a-real-endpoint')
                .set('Accept', 'text/html')
                .expect(404);

            expect(response.text).not.toContain('ADMIN');
        });

        it('does not swallow a non-GET request [bootstrap:I-13]', async () => {
            const app = await boot({}, [], undefined, bundle);

            await request(app.getHttpServer())
                .post('/workspaces/1')
                .set('Accept', 'text/html')
                .expect(404);
        });

        /**
         * A missing hashed chunk must keep 404ing. Answered with `index.html`
         * the browser reports a MIME-type error instead, which reads as a
         * bundler bug rather than the stale deploy it actually is.
         */
        it('404s a missing asset instead of returning the page', async () => {
            const app = await boot({}, [], undefined, bundle);

            // No `Accept` override on purpose. A browser fetches scripts with
            // `Accept: */*`, and `accepts('html')` answers `'html'` to that —
            // so an `Accept`-only guard lets this request through and returns
            // 200 with the page. Measured against a real build before the
            // extension check was added.
            await request(app.getHttpServer())
                .get('/assets/deleted-chunk.js')
                .expect(404);
        });

        it('404s a missing asset even when the client accepts HTML [bootstrap:I-13]', async () => {
            const app = await boot({}, [], undefined, bundle);

            await request(app.getHttpServer())
                .get('/assets/deleted-chunk.js')
                .set('Accept', 'text/html')
                .expect(404);
        });

        it('gives a JSON client a 404 it can parse, not a page [bootstrap:I-13]', async () => {
            const app = await boot({}, [], undefined, bundle);

            await request(app.getHttpServer())
                .get('/workspaces/1')
                .set('Accept', 'application/json')
                .expect(404);
        });

        it('serves the API only, without failing boot, when the bundle is absent [bootstrap:I-14]', async () => {
            const warn = jest
                .spyOn(Logger, 'warn')
                .mockImplementation(() => undefined);

            const app = await boot({}, [], undefined, join(bundle, 'nope'));

            await request(app.getHttpServer())
                .get('/api/not-a-real-endpoint')
                .expect(404);
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('No admin bundle at'),
                'ServeAdmin'
            );
        });

        it('serves nothing extra when staticDir is omitted', async () => {
            const app = await boot();

            await request(app.getHttpServer())
                .get('/workspaces/1/entries/2')
                .set('Accept', 'text/html')
                .expect(404);
        });
    });
});
