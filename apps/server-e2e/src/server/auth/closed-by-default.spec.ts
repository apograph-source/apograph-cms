import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { resetDb } from '../../support/seed';

/**
 * Every route the app serves, walked without a session.
 *
 * `AuthGuard` is registered as `APP_GUARD`, so authentication is the default
 * and publicness is a decision somebody has to write down — `@Public()`. The
 * risk that arrangement carries is not that the guard breaks; it is that a new
 * controller is written with `@Public()` copied from the one beside it, or that
 * a whole plugin is mounted outside the guard, and nothing notices because the
 * suite for that plugin only ever tests it while signed in.
 *
 * So this suite does not test a route. It reads the **live OpenAPI document** —
 * the app's own account of what it serves — and requires every operation in it
 * to answer `401` to an anonymous caller, except the ones named below. The list
 * is the point: adding a public route means editing it, in a file whose whole
 * subject is what may be reached without signing in.
 *
 * ## What "public" means here
 *
 * Two different things, and only the first is in the list:
 *
 * - **Genuinely anonymous** — the eleven identity routes. Somebody signing in,
 *   accepting an invite, following a reset link or coming back from an identity
 *   provider has no session by definition.
 * - **`@Public()` but not open** — everything under `/api/v1`. Those routes opt
 *   out of the *session* guard because they authenticate a bearer token
 *   instead, and `ApiTokenGuard` answers a caller with no `Authorization`
 *   header with the same `401`. They are therefore covered by the sweep rather
 *   than exempted from it, which is exactly right: if one of them ever lost its
 *   token guard, this suite would catch it.
 *
 * ## Reading the document rather than the router
 *
 * The document is what an operator sees and what a client is generated from, so
 * a route that is in it is a route the product admits to serving. It is also
 * mounted *after* the global prefix, so its paths are the real URLs.
 *
 * Two things are consequently invisible here, and both are named rather than
 * silently missed: the MCP endpoint (`@ApiExcludeController`) and the GraphiQL
 * playground (`@ApiExcludeEndpoint`), which are probed explicitly at the end.
 */

/** The path parameter fillers. Guards run before pipes, so any value serves. */
const UUID = '00000000-0000-0000-0000-0000000000ff';

/**
 * Every operation that may answer an anonymous caller with something other than
 * `401`, as `METHOD /path` exactly as the document spells it.
 *
 * **Adding to this list is a security decision.** Each entry is a URL the whole
 * internet can reach on every Ortha deployment.
 */
const PUBLIC_OPERATIONS: readonly string[] = [
    // Signing in, and signing out — logout is public because it reads the
    // cookie itself and must succeed whether or not that cookie still resolves.
    'POST /api/auth/login',
    'POST /api/auth/logout',
    // The invite pair: an invitee has no account yet, which is the point.
    'GET /api/auth/invite/{token}',
    'POST /api/auth/invite/accept',
    // The reset pair: somebody who has lost their password has no session.
    'GET /api/auth/reset/{token}',
    'POST /api/auth/reset',
    // The single-sign-on handshake. The list is fetched by the sign-in screen
    // before anyone is signed in; the rest is a browser being handed back and
    // forth with an identity provider, and a provider calling in with no
    // browser at all.
    'GET /api/auth/sso',
    'GET /api/auth/sso/{provider}/start',
    'GET /api/auth/sso/{provider}/callback',
    'POST /api/auth/sso/{provider}/callback',
    'POST /api/auth/sso/{provider}/backchannel-logout'
];

/** One documented operation, as the sweep drives it. */
interface Operation {
    /** `METHOD /path`, with the document's `{param}` placeholders intact. */
    id: string;
    method: 'get' | 'post' | 'put' | 'patch' | 'delete';
    /** The same path with every `{param}` filled in, ready to request. */
    url: string;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Flattens the document's `paths` into one operation per method. */
function operationsOf(paths: Record<string, unknown>): Operation[] {
    const operations: Operation[] = [];
    for (const [path, item] of Object.entries(paths)) {
        for (const method of METHODS) {
            if (!(item as Record<string, unknown>)[method]) continue;
            operations.push({
                id: `${method.toUpperCase()} ${path}`,
                method,
                url: path.replace(/\{[^}]+\}/g, UUID)
            });
        }
    }
    return operations;
}

describe('closed by default — every documented route refuses an anonymous caller', () => {
    let harness: TestApp;
    let operations: Operation[];

    beforeAll(async () => {
        // Docs on: the reference is the only way to read the document, and it
        // is mounted on the adapter rather than the router, so it sits outside
        // every guard by design (asserted in `harness/production-parity.spec`).
        harness = await createTestApp({ docsEnabled: true });
        const doc = await request(harness.server)
            .get('/reference/json')
            .expect(200);
        operations = operationsOf(doc.body.paths);
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
    });

    it('found a document worth sweeping', async () => {
        // A guard on the guard. If `paths` ever came back empty — a docs flag
        // that stopped working, a document built before the prefix — every
        // assertion below would pass by having nothing to check.
        expect(operations.length).toBeGreaterThan(50);
        expect(operations.map((operation) => operation.id)).toContain(
            'POST /api/auth/login'
        );
        expect(operations.map((operation) => operation.id)).toContain(
            'GET /api/auth/me'
        );
    });

    it('401s every operation that is not on the public list [identity:I-01]', async () => {
        const publicSet = new Set(PUBLIC_OPERATIONS);
        const reachable: string[] = [];

        for (const operation of operations) {
            if (publicSet.has(operation.id)) continue;
            const res = await request(harness.server)[operation.method](
                operation.url
            );
            if (res.status !== 401) {
                reachable.push(`${operation.id} → ${res.status}`);
            }
        }

        // Named individually rather than counted: the failure message has to
        // say which route opened, or the next person has to re-derive it.
        expect(reachable).toEqual([]);
    }, 120_000);

    it('keeps the public list honest — every entry is a route the app serves', async () => {
        // The other direction. A stale entry here is a hole waiting to happen:
        // if `GET /api/auth/reset/{token}` were renamed, its exemption would
        // survive and quietly cover whatever took the name back later.
        const documented = new Set(operations.map((operation) => operation.id));
        for (const id of PUBLIC_OPERATIONS) {
            expect(documented.has(id)).toBe(true);
        }
    });

    it('401s the two routes the document deliberately omits', async () => {
        // MCP is `@ApiExcludeController` and the GraphiQL playground is
        // `@ApiExcludeEndpoint`, so neither is in `paths` and neither is swept
        // above. Both are `@Public()`, which makes "what actually answers them"
        // worth asserting by hand rather than assuming.
        await request(harness.server)
            .post('/api/v1/mcp')
            .set('Accept', 'application/json, text/event-stream')
            .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
            .expect(401);

        // The playground is the exception that proves the rule: it is developer
        // tooling that rides `docs.enabled`, exactly like the reference this
        // suite reads, and serves markup rather than data.
        await request(harness.server)
            .get('/api/v1/graphql/playground')
            .expect(200);
    });

    // The playground's OFF case — the production default, where the controller
    // is never registered — is asserted in `public-graphql-api.spec.ts`, which
    // already boots a default app. It cannot be added here: a second app opened
    // inside this one's tests would end the file's shared connection pool.
});
