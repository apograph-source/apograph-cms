import 'reflect-metadata';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    BadRequestException,
    Logger,
    Module,
    ValidationPipe
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createServer } from './create-server';
import type { ServerPlugin } from './types/server-plugin';

/**
 * The composition root's **ordering and its one-time settings**, asserted
 * against the real `createServer` with a recording application in Nest's place.
 *
 * `apps/server-e2e/src/harness/create-server.spec.ts` boots the genuine host on
 * a port and is the right place for everything a request can observe. It cannot
 * see any of this: whether a plugin hook ran *before* the app was created,
 * whether `trust proxy` was applied at all or applied twice, which of the two
 * mounts went on first. Those are decisions this file makes between
 * `NestFactory.create` and `listen`, and the only witness is the sequence of
 * calls the host makes on the application object — so that is what is recorded.
 *
 * Two of these were previously asserted only against `createTestApp`, which
 * *re-implements* the bootstrap (`apps/server-e2e/src/support/test-app.ts`).
 * Deleting the `trust proxy` line or a `ValidationPipe` flag from the real
 * `create-server.ts` left the whole suite green, because the copy still carried
 * both. The pipe below is the object the host actually constructs, and it is
 * exercised rather than introspected.
 */

/**
 * `NestFactory.create` is the seam: everything under test happens on the
 * application it returns. The rest of `@nestjs/core` is left real — Swagger
 * reaches into it, and a wholesale replacement makes the import graph collapse
 * long before an assertion runs.
 */
jest.mock('@nestjs/core', () => ({
    ...jest.requireActual('@nestjs/core'),
    NestFactory: { create: jest.fn() }
}));

/**
 * The document scanner, stubbed to hand back the `DocumentBuilder` config it
 * was given plus an empty `paths`.
 *
 * `createDocument` walks a live Nest container, which a recording application
 * does not have. Nothing here asserts anything about the *scanned* half of the
 * document — the paths and their schemas are `apps/server-e2e`'s business. What
 * the stub preserves is the half the host itself composes: the builder's
 * output, which is where a security scheme would come from.
 */
jest.mock('@nestjs/swagger', () => ({
    ...jest.requireActual('@nestjs/swagger'),
    SwaggerModule: {
        createDocument: jest.fn((_app: unknown, config: object) => ({
            ...config,
            paths: {}
        }))
    }
}));

/** One call the host made on the application, in the order it made it. */
interface RecordedCall {
    name: string;
    args: unknown[];
}

/** A stand-in application that records what the host does to it. */
interface Recording {
    /** Every call, in order. */
    calls: RecordedCall[];
    /** Index of the first call by that name, or `-1`. */
    at(name: string): number;
    /** Every call by that name. */
    all(name: string): RecordedCall[];
    /** Index of the *last* call by that name, or `-1`. */
    lastAt(name: string): number;
    /** The object handed to `createServer` as its Nest application. */
    app: NestExpressApplication;
}

function recordingApp(): Recording {
    const calls: RecordedCall[] = [];
    const record =
        (name: string) =>
        (...args: unknown[]) => {
            calls.push({ name, args });
            return undefined;
        };

    const adapter = { get: record('adapter.get') };
    const app = {
        set: record('set'),
        useBodyParser: record('useBodyParser'),
        setGlobalPrefix: record('setGlobalPrefix'),
        useGlobalPipes: record('useGlobalPipes'),
        getHttpAdapter: () => adapter,
        useStaticAssets: record('useStaticAssets'),
        use: record('use'),
        enableShutdownHooks: record('enableShutdownHooks'),
        listen: async (...args: unknown[]) => {
            calls.push({ name: 'listen', args });
        }
    };

    return {
        calls,
        at: (name) => calls.findIndex((call) => call.name === name),
        all: (name) => calls.filter((call) => call.name === name),
        lastAt: (name) =>
            calls.reduce(
                (last, call, index) => (call.name === name ? index : last),
                -1
            ),
        app: app as unknown as NestExpressApplication
    };
}

/** A plugin carrying a module the host can put in `ServerModule.forRoot`. */
@Module({})
class NoopModule {}

function plugin(overrides: Partial<ServerPlugin> = {}): ServerPlugin {
    return { name: 'noop', module: NoopModule, ...overrides };
}

describe('createServer (the composition root)', () => {
    let recording: Recording;
    const created = NestFactory.create as jest.Mock;

    beforeAll(() => {
        // The host builds its own Nest app and takes no logger option, so this
        // is the only way to keep its start-up lines out of the report.
        Logger.overrideLogger(false);
    });

    beforeEach(() => {
        recording = recordingApp();
        created.mockReset();
        created.mockImplementation(async () => {
            recording.calls.push({ name: 'NestFactory.create', args: [] });
            return recording.app;
        });
    });

    describe('plugin hooks run before the application exists', () => {
        it('awaits every onPluginInit, in array order, before NestFactory.create [bootstrap:I-02]', async () => {
            // The hooks record into the same stream as the calls on the
            // application, so one sequence carries all three clauses at once.
            const mark = (name: string) => () => {
                recording.calls.push({ name, args: [] });
            };

            await createServer({
                plugins: [
                    plugin({
                        name: 'first',
                        // Yields to the event loop before recording. That is
                        // the whole fixture: with the host's `await`, `first`
                        // still lands before `second`; without it the loop runs
                        // on and `second` records first. A hook that pushed
                        // synchronously could not tell the two apart.
                        onPluginInit: async () => {
                            await new Promise((resolve) =>
                                setTimeout(resolve, 5)
                            );
                            mark('init:first')();
                        }
                    }),
                    plugin({
                        name: 'second',
                        onPluginInit: mark('init:second')
                    }),
                    // No hook at all: the optional call must not throw, and must
                    // not consume a turn that reorders anything.
                    plugin({ name: 'third' })
                ],
                port: 0,
                docs: { enabled: false }
            });

            expect(
                recording.calls.slice(0, 3).map((call) => call.name)
            ).toEqual(['init:first', 'init:second', 'NestFactory.create']);
            expect(created).toHaveBeenCalledTimes(1);
        });
    });

    describe('proxy trust is applied, and only when configured', () => {
        it('applies the configured trust proxy before the port opens [bootstrap:I-04]', async () => {
            await createServer({
                plugins: [plugin()],
                port: 0,
                trustProxy: 2,
                docs: { enabled: false }
            });

            // `set` is used for nothing else in the host, so this is the whole
            // of what it configures on the Express adapter.
            expect(recording.all('set')).toEqual([
                { name: 'set', args: ['trust proxy', 2] }
            ]);
            // Before `listen`: nothing can read `req.ip` until the port is
            // open, so that is the deadline the invariant is really about.
            expect(recording.at('set')).toBeLessThan(recording.at('listen'));
        });

        it('leaves the setting untouched when none was given [bootstrap:I-04]', async () => {
            await createServer({
                plugins: [plugin()],
                port: 0,
                docs: { enabled: false }
            });

            // Not `set('trust proxy', undefined)` and not `set('trust proxy',
            // false)`: Express distinguishes "never configured" from a falsy
            // value in its own defaults, and the host's contract is that an
            // omitted option changes nothing.
            expect(recording.all('set')).toEqual([]);
        });
    });

    describe('the one global ValidationPipe', () => {
        /** The pipe the host actually installed. */
        async function installedPipe(): Promise<ValidationPipe> {
            await createServer({
                plugins: [plugin()],
                port: 0,
                docs: { enabled: false }
            });
            const [call] = recording.all('useGlobalPipes');
            const [pipe] = call.args;
            expect(pipe).toBeInstanceOf(ValidationPipe);
            return pipe as ValidationPipe;
        }

        /** A DTO-shaped class with no validation metadata of its own. */
        class Body {
            declared?: string;
        }

        it('refuses a property the DTO does not declare [bootstrap:I-06]', async () => {
            const pipe = await installedPipe();

            // Both flags are pinned by this one case, because they only work as
            // a pair: `class-validator` collects the undeclared properties only
            // when `whitelist` is on, and `forbidNonWhitelisted` decides whether
            // they are deleted or refused. Drop either from `create-server.ts`
            // and the pipe stops throwing — with `whitelist` gone the value
            // passes through untouched, with `forbidNonWhitelisted` gone it comes
            // back stripped.
            const refused = pipe.transform(
                { undeclared: 'x' },
                { type: 'body', metatype: Body }
            );

            await expect(refused).rejects.toBeInstanceOf(BadRequestException);
            await expect(refused).rejects.toMatchObject({
                response: {
                    message: ['property undeclared should not exist']
                }
            });
        });

        it('hands the handler an instance of the DTO, not the parsed JSON [bootstrap:I-06]', async () => {
            const pipe = await installedPipe();

            const value = await pipe.transform(
                {},
                { type: 'body', metatype: Body }
            );

            // Without `transform`, the pipe returns the plain object it was
            // given (`classToPlain` of the entity) — every `@Type`-coerced
            // number in every DTO in the codebase arrives as a string instead.
            expect(value).toBeInstanceOf(Body);
        });
    });

    describe('the API document is built at the right moment', () => {
        it('is generated after the prefix and the pipe, and before the port opens [bootstrap:I-07]', async () => {
            await createServer({
                plugins: [plugin()],
                port: 0,
                docs: { enabled: true }
            });

            // `production-parity.spec.ts` pins the prefix clause by reading the
            // document's paths. The other two are unobservable through a
            // request — a reference generated after `listen` still answers
            // correctly a moment later, and one generated before the pipe looks
            // identical — so they are pinned by position here.
            const mounted = recording.at('adapter.get');
            expect(recording.at('setGlobalPrefix')).toBeLessThan(mounted);
            expect(recording.at('useGlobalPipes')).toBeLessThan(mounted);
            expect(mounted).toBeLessThan(recording.at('listen'));
        });
    });

    describe('the reference routes bypass Nest’s router', () => {
        it('mounts them on the http adapter, outside the prefix, the guards and the pipe [bootstrap:I-08]', async () => {
            await createServer({
                plugins: [plugin()],
                port: 0,
                globalPrefix: 'api',
                docs: { enabled: true }
            });

            // `production-parity.spec.ts` pins two of the three clauses through
            // real requests: the paths answer without the `/api` prefix, and an
            // unauthenticated request reaches them. The pipe clause has no
            // request that can show it — a global pipe runs per *parameter* of a
            // Nest handler, and a route with nothing to validate looks identical
            // whichever router it is on — so what is pinned here is the single
            // fact all three follow from: these are handlers on the Express
            // adapter, and Nest's router has never heard of them.
            //
            // Move `setupApiDocs` to an `@Controller('reference')` — the tidy
            // refactor this rules out — and all three clauses break at once:
            // the paths acquire the prefix, every global guard runs on them, and
            // the pipe joins their pipeline. Here, `adapter.get` simply stops
            // being called.
            expect(
                recording.all('adapter.get').map((call) => call.args[0])
            ).toEqual(['/reference/json', '/reference']);

            // Both are installed, and installed *first*: the point is not that
            // the host forgot to configure them, it is that configuring them
            // cannot reach a route registered this way.
            expect(recording.all('setGlobalPrefix')).toEqual([
                { name: 'setGlobalPrefix', args: ['api'] }
            ]);
            expect(recording.all('useGlobalPipes')).toHaveLength(1);
            expect(recording.at('setGlobalPrefix')).toBeLessThan(
                recording.at('adapter.get')
            );
            expect(recording.at('useGlobalPipes')).toBeLessThan(
                recording.at('adapter.get')
            );
        });
    });

    describe('shutdown hooks are installed while the port is still closed', () => {
        it('calls enableShutdownHooks exactly once, before listen [bootstrap:I-16]', async () => {
            await createServer({
                plugins: [plugin()],
                port: 0,
                docs: { enabled: false }
            });

            // The ordering half of the invariant, which
            // `apps/server-e2e/src/harness/create-server.spec.ts` cannot see: it
            // counts `SIGTERM` listeners on an app that has already listened, so
            // a host that installed the hooks *after* `listen` would look the
            // same to it — and the window it opens is exactly the one that
            // matters, a pod signalled during roll-out before the first request
            // has finished.
            expect(recording.all('enableShutdownHooks')).toHaveLength(1);
            expect(recording.at('enableShutdownHooks')).toBeLessThan(
                recording.at('listen')
            );
        });
    });

    describe('a plugin’s migrations folder is resolved lazily', () => {
        it('never calls migrations.dir while booting [bootstrap:I-18]', async () => {
            // A thunk that would take the process down if the host touched it.
            // `packages/cli/src/lib/migrate.spec.ts` pins the other half — that
            // `migrate` calls it and passes the result as `migrationsFolder` —
            // so between them the thunk is called at migration time and at no
            // other time.
            const dir = jest.fn(() => {
                throw new Error(
                    'migrations.dir was resolved at boot; it must only be called by `migrate`'
                );
            });

            await expect(
                createServer({
                    plugins: [
                        plugin({
                            name: 'identity',
                            migrations: {
                                dir,
                                table: '__drizzle_migrations_identity'
                            }
                        })
                    ],
                    port: 0,
                    docs: { enabled: false }
                })
            ).resolves.toBeDefined();

            // The count, not merely the absence of a throw: a host that called
            // the thunk inside a `try` would still boot, and would still have
            // resolved a path that, for a plugin installed from npm, may not
            // exist in the deployed tarball at all.
            expect(dir).not.toHaveBeenCalled();
        });
    });

    describe('the admin bundle is mounted last', () => {
        let staticDir: string;

        beforeEach(() => {
            staticDir = mkdtempSync(join(tmpdir(), 'ortha-bootstrap-'));
            writeFileSync(join(staticDir, 'index.html'), '<!doctype html>');
        });

        afterEach(() => {
            rmSync(staticDir, { recursive: true, force: true });
        });

        it('registers the SPA fallback after the controllers and both reference routes [bootstrap:I-15]', async () => {
            await createServer({
                plugins: [plugin()],
                port: 0,
                staticDir,
                docs: { enabled: true }
            });

            const referenceRoutes = recording
                .all('adapter.get')
                .map((call) => call.args[0]);
            expect(referenceRoutes).toEqual(['/reference/json', '/reference']);

            // The controllers are registered by `NestFactory.create`; the
            // reference by `setupApiDocs`. The static handler and the fallback
            // must come after both, because the fallback answers whatever none
            // of them claimed — mounted earlier it would shadow them and turn a
            // mistyped API path into a 200 with a page of HTML.
            const lastReference = recording.lastAt('adapter.get');
            expect(recording.at('NestFactory.create')).toBeLessThan(
                lastReference
            );
            expect(lastReference).toBeLessThan(recording.at('useStaticAssets'));
            expect(recording.at('useStaticAssets')).toBeLessThan(
                recording.at('use')
            );
            // And still before the port opens, so nothing is served half-mounted.
            expect(recording.at('use')).toBeLessThan(recording.at('listen'));
        });

        it('refuses to answer for the reference it was mounted behind [bootstrap:I-13]', async () => {
            await createServer({
                plugins: [plugin()],
                port: 0,
                staticDir,
                docs: { enabled: true }
            });

            const [mounted] = recording.all('use');
            const fallback = mounted.args[0] as (
                request: unknown,
                response: unknown,
                next: () => void
            ) => unknown;

            /** Runs the fallback and reports which way it went. */
            const ask = (path: string) => {
                const sent: string[] = [];
                let passed = false;
                fallback(
                    { method: 'GET', path, accepts: () => 'html' },
                    { sendFile: (file: string) => sent.push(file) },
                    () => {
                        passed = true;
                    }
                );
                return { passed, sent };
            };

            // The control: a client-side route is exactly what the fallback is
            // for, and without it this case would pass against a fallback that
            // answers nothing at all.
            expect(ask('/workspaces/1/entries/2').sent).toHaveLength(1);

            // `/reference` and `/reference/json` are registered on the adapter
            // *before* this middleware, so a fallback that claimed them would
            // never be reached in a running server — until the paths are
            // configured elsewhere, or the reference is disabled, at which point
            // the API map turns into a page of admin HTML with a 200 on it.
            expect(ask('/reference')).toEqual({ passed: true, sent: [] });
            expect(ask('/reference/json')).toEqual({ passed: true, sent: [] });
            // The API prefix, for the same reason, is added at call time.
            expect(ask('/api/not-a-real-endpoint')).toEqual({
                passed: true,
                sent: []
            });
        });
    });
});
