import { Logger, Module, type INestApplication } from '@nestjs/common';
import { setupApiDocs } from './setup-api-docs';
import type { ServerPlugin } from '../types/server-plugin';

/**
 * Where the reference's authentication comes from.
 *
 * The host has no guards, so it has nothing to describe: every security scheme
 * in the document is a plugin's contribution through `ServerPlugin.docs`. That
 * is a claim about what is *absent*, and absence is only observable against a
 * document generated with no contributor at all — which is why the second case
 * below matters more than the first.
 *
 * `apps/server-e2e` serves this document over HTTP and can assert the schemes
 * identity contributes are present; it always boots with identity registered,
 * so it can never show that the host adds nothing of its own.
 */

/**
 * The scanner, stubbed to hand back the `DocumentBuilder` config plus whatever
 * `paths` the test asked for. It walks a live Nest container, which no unit
 * test has — so stubbing it is what makes both halves of this file reachable:
 * the builder's output, which is the only place a security scheme is written,
 * and the scanned paths, which are the only thing the tagging pass touches.
 *
 * A `mock`-prefixed name so jest's factory hoisting allows the reference; reset
 * to empty before each test by the hook below.
 */
const mockPaths: { current: Record<string, unknown> } = { current: {} };

jest.mock('@nestjs/swagger', () => ({
    ...jest.requireActual('@nestjs/swagger'),
    SwaggerModule: {
        createDocument: jest.fn((_app: unknown, config: object) => ({
            ...config,
            paths: mockPaths.current
        }))
    }
}));

/** Sets the paths the next `setupApiDocs` call will tag. */
function scanned(paths: Record<string, unknown>): void {
    mockPaths.current = paths;
}

beforeEach(() => scanned({}));

@Module({})
class NoopModule {}

/** Captures the document the JSON route would serve. */
function docsHarness() {
    const routes = new Map<string, (req: unknown, res: unknown) => unknown>();
    const app = {
        getHttpAdapter: () => ({
            get: (
                path: string,
                handler: (req: unknown, res: unknown) => unknown
            ) => {
                routes.set(path, handler);
            }
        })
    } as unknown as INestApplication;

    /** The OpenAPI document as `GET /reference/json` would answer it. */
    const served = (): Record<string, unknown> => {
        let body: unknown;
        routes.get('/reference/json')?.(
            {},
            { json: (value: unknown) => (body = value) }
        );
        return body as Record<string, unknown>;
    };

    return { app, served };
}

function plugin(overrides: Partial<ServerPlugin>): ServerPlugin {
    return { name: 'anonymous', module: NoopModule, ...overrides };
}

describe('setupApiDocs — the document’s authentication', () => {
    beforeAll(() => Logger.overrideLogger(false));

    it('publishes exactly the schemes the plugins contributed [bootstrap:I-21]', () => {
        const harness = docsHarness();

        setupApiDocs(
            harness.app,
            [
                plugin({
                    name: 'identity',
                    docs: {
                        securitySchemes: {
                            session: {
                                type: 'apiKey',
                                in: 'cookie',
                                name: 'ortha_session'
                            },
                            apiToken: { type: 'http', scheme: 'bearer' }
                        },
                        defaultSecurity: ['session', 'apiToken']
                    }
                }),
                plugin({ name: 'content' })
            ],
            { enabled: true }
        );

        const document = harness.served();
        const components = document['components'] as {
            securitySchemes?: Record<string, unknown>;
        };
        // `toEqual` on the key set rather than `toContain`: a scheme the host
        // invented would be an extra key, and a subset assertion would not see
        // it.
        expect(Object.keys(components.securitySchemes ?? {})).toEqual([
            'session',
            'apiToken'
        ]);
        expect(document['security']).toEqual([
            { session: [] },
            { apiToken: [] }
        ]);
    });

    it('declares no scheme at all when no plugin describes one [bootstrap:I-21]', () => {
        const harness = docsHarness();

        setupApiDocs(
            harness.app,
            [plugin({ name: 'content' }), plugin({ name: 'media' })],
            { enabled: true }
        );

        const document = harness.served();
        const components = document['components'] as {
            securitySchemes?: Record<string, unknown>;
        };
        // The one that can actually fail: add an `addBearerAuth()` or an
        // `addCookieAuth()` to `setupApiDocs` — the shape every Nest tutorial
        // reaches for — and the reference starts advertising an auth mechanism
        // no guard in the process implements.
        expect(components.securitySchemes).toBeUndefined();
        expect(document['security']).toBeUndefined();
    });

    it('keeps the later plugins’ contributions when one decorate throws [bootstrap:I-11]', () => {
        const harness = docsHarness();
        const logged = jest
            .spyOn(Logger, 'error')
            .mockImplementation(() => undefined);

        setupApiDocs(
            harness.app,
            [
                plugin({
                    name: 'faulty',
                    docs: {
                        decorate: () => {
                            throw new Error('boom');
                        }
                    }
                }),
                plugin({
                    name: 'content',
                    docs: {
                        decorate: (document) => {
                            (document as unknown as Record<string, unknown>)[
                                'x-content-types'
                            ] = ['article'];
                        }
                    }
                })
            ],
            { enabled: true }
        );

        // `create-server.spec.ts` in `apps/server-e2e` pins that the boot
        // survives — the reference still answers 200. What a 200 cannot show is
        // whether the *rest* of the document survived with it: the loop is
        // guarded per plugin precisely so one plugin's failure costs only its
        // own contribution, and a `try` around the whole loop would answer 200
        // just the same with every later plugin's work missing.
        expect(harness.served()['x-content-types']).toEqual(['article']);
        expect(logged).toHaveBeenCalledWith(
            expect.stringContaining('"faulty"'),
            expect.any(String)
        );
    });
});

/**
 * Where the operation tags go — and, more to the point, where they do not.
 *
 * A path item is not a map of operations. Alongside the eight HTTP methods it
 * may carry `parameters` (an **array**), `$ref`, `summary`, `description` and
 * `servers`, none of which take a `tags` property. The natural way to write
 * the grouping pass — walk `Object.values(item)` and set `.tags` on everything
 * object-shaped — writes one onto that array, and the document stops
 * validating.
 *
 * The judgment this block retires said no harness could get such a key into the
 * document, because its only source is `SwaggerModule.createDocument` and Nest
 * emits none today. That is a fact about the *scanner*, not about the harness:
 * the scanner has been stubbed at the top of this file since the security-scheme
 * cases were written, so the document is whatever a test says it is. Nothing had
 * to be exported to reach the branch.
 */
describe('setupApiDocs — where operation tags are written', () => {
    beforeAll(() => Logger.overrideLogger(false));

    /** A path item shaped like the ones the spec permits but Nest never emits. */
    const pathItem = () => ({
        // Shared across every operation on the path — an array, so `.tags` on
        // it is not merely useless, it is invalid.
        parameters: [
            { name: 'workspaceId', in: 'header', required: true }
        ] as unknown[],
        $ref: '#/components/pathItems/shared',
        summary: 'Entries',
        servers: [{ url: 'https://api.example.com' }] as unknown[],
        get: { operationId: 'listEntries' } as Record<string, unknown>,
        post: { operationId: 'createEntry' } as Record<string, unknown>
    });

    it('tags the operations and nothing else on the path item [bootstrap:I-12]', () => {
        const harness = docsHarness();
        const item = pathItem();
        scanned({ '/api/content/entries': item });

        setupApiDocs(harness.app, [], { enabled: true });

        const served = harness.served()['paths'] as Record<
            string,
            ReturnType<typeof pathItem>
        >;
        const tagged = served['/api/content/entries'];

        // The operations are grouped by resource, which is the point of the
        // pass at all.
        expect(tagged.get['tags']).toEqual(['content']);
        expect(tagged.post['tags']).toEqual(['content']);

        // …and the non-operation keys came through byte for byte. `toEqual`
        // against a freshly built copy rather than `not.toHaveProperty('tags')`
        // on each: the failure mode is *any* mutation of these, and an array
        // that grew a `tags` property compares unequal.
        const untouched = pathItem();
        expect(tagged.parameters).toEqual(untouched.parameters);
        expect(tagged.$ref).toEqual(untouched.$ref);
        expect(tagged.summary).toEqual(untouched.summary);
        expect(tagged.servers).toEqual(untouched.servers);
    });

    it('leaves a path item that is only a $ref alone [bootstrap:I-12]', () => {
        // The degenerate case the allow-list also has to survive: no method key
        // at all. A pass that assumed every value under a path was an operation
        // would tag the string, or throw on it.
        const harness = docsHarness();
        scanned({ '/api/media/assets': { $ref: '#/components/pathItems/m' } });

        setupApiDocs(harness.app, [], { enabled: true });

        const served = harness.served()['paths'] as Record<string, unknown>;
        expect(served['/api/media/assets']).toEqual({
            $ref: '#/components/pathItems/m'
        });
        // The resource is still declared at the document level — the tag list
        // is derived from the route, not from the operations found under it.
        expect(harness.served()['tags']).toEqual([{ name: 'media' }]);
    });
});
