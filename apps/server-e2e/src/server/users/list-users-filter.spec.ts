import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { resetDb, seedActiveUser, seedUser } from '../../support/seed';

const ADMIN_EMAIL = 'filter-admin@example.com';
const PASSWORD = 'SecurePass123!';

/**
 * `GET /api/users?filter=<json>` — the structured query-builder filter wired
 * through `@orthacms/utils-server`. Covers the functional path (scalar ops,
 * the `role` relation EXISTS subquery, OR groups) and the security boundary
 * (field/operator whitelist, depth/node caps) — a malformed or out-of-schema
 * filter must 400, never silently widen the result.
 */
describe('GET /api/users (query-builder filter)', () => {
    let harness: TestApp;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        await seedActiveUser(harness.app, {
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin',
            name: 'Ada Admin'
        });
    });

    async function adminAgent() {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email: ADMIN_EMAIL, password: PASSWORD })
            .expect(201);
        return agent;
    }

    /** GET /api/users with `filter` set to the JSON-encoded tree. */
    function getFiltered(agent: request.Agent, tree: unknown) {
        return agent.get('/api/users').query({ filter: JSON.stringify(tree) });
    }

    it('filters by a scalar email rule (ilike, %v%)', async () => {
        await seedUser(harness.app, {
            email: 'grace@example.com',
            role: 'viewer',
            status: 'active',
            name: 'Grace Hopper'
        });
        const agent = await adminAgent();

        const res = await getFiltered(agent, {
            field: 'email',
            op: 'ilike',
            value: '%grace%'
        }).expect(200);

        expect(res.body.total).toBe(1);
        expect(res.body.items[0].email).toBe('grace@example.com');
    });

    it('filters by the role relation (role.key eq) via an EXISTS subquery', async () => {
        await seedUser(harness.app, {
            email: 'viewer@example.com',
            role: 'viewer',
            status: 'active'
        });
        await seedUser(harness.app, {
            email: 'contributor@example.com',
            role: 'contributor',
            status: 'active'
        });
        const agent = await adminAgent();

        const res = await getFiltered(agent, {
            field: 'role.key',
            op: 'eq',
            value: 'viewer'
        }).expect(200);

        expect(res.body.total).toBe(1);
        expect(res.body.items[0].email).toBe('viewer@example.com');
        expect(res.body.items[0].role.key).toBe('viewer');
    });

    it('combines rules with an OR group', async () => {
        await seedUser(harness.app, {
            email: 'grace@example.com',
            role: 'viewer',
            status: 'active'
        });
        await seedUser(harness.app, {
            email: 'linus@example.com',
            role: 'contributor',
            status: 'active'
        });
        const agent = await adminAgent();

        const res = await getFiltered(agent, {
            or: [
                { field: 'email', op: 'ilike', value: '%grace%' },
                { field: 'email', op: 'ilike', value: '%linus%' }
            ]
        }).expect(200);

        const emails = res.body.items
            .map((m: { email: string }) => m.email)
            .sort();
        expect(emails).toEqual(['grace@example.com', 'linus@example.com']);
    });

    it('AND-composes the filter with the existing status param', async () => {
        await seedUser(harness.app, {
            email: 'pending-viewer@example.com',
            role: 'viewer',
            status: 'pending'
        });
        await seedUser(harness.app, {
            email: 'active-viewer@example.com',
            role: 'viewer',
            status: 'active'
        });
        const agent = await adminAgent();

        // role.key=viewer (filter) AND status=active (structured param)
        const res = await agent
            .get('/api/users')
            .query({
                status: 'active',
                filter: JSON.stringify({
                    field: 'role.key',
                    op: 'eq',
                    value: 'viewer'
                })
            })
            .expect(200);

        expect(res.body.total).toBe(1);
        expect(res.body.items[0].email).toBe('active-viewer@example.com');
    });

    it('AND-composes the filter with the existing search param', async () => {
        // `status` is covered above; `search` is the other structured param
        // and it composes differently — it is an ILIKE over two columns rather
        // than an equality. Both members below satisfy the filter on their
        // own, so a `search` the filter replaced (rather than intersected)
        // would return two.
        await seedUser(harness.app, {
            email: 'grace@example.com',
            role: 'viewer',
            status: 'active',
            name: 'Grace Hopper'
        });
        await seedUser(harness.app, {
            email: 'linus@example.com',
            role: 'viewer',
            status: 'active',
            name: 'Linus Torvalds'
        });
        const agent = await adminAgent();

        const res = await agent
            .get('/api/users')
            .query({
                search: 'hopper',
                filter: JSON.stringify({
                    field: 'role.key',
                    op: 'eq',
                    value: 'viewer'
                })
            })
            .expect(200);

        expect(res.body.total).toBe(1);
        expect(res.body.items[0].email).toBe('grace@example.com');
    });

    it('rejects a filter past the DTO length cap with 400', async () => {
        const agent = await adminAgent();
        // The same tree twice, so only its length differs: the short one is a
        // 200, which is what makes the long one's 400 a statement about
        // `@MaxLength(4096)` rather than about the tree being malformed.
        // Kept just over the cap — a query string past Node's ~16KB header
        // limit resets the socket before any handler runs, the same caveat the
        // oversized-`in` case notes.
        await getFiltered(agent, {
            field: 'email',
            op: 'eq',
            value: 'nobody@example.com'
        }).expect(200);

        const res = await getFiltered(agent, {
            field: 'email',
            op: 'eq',
            value: 'x'.repeat(4100)
        }).expect(400);

        // The DTO refused it before the filter engine saw it: every rejection
        // from the engine carries a `FILTER_*` code, and this one carries no
        // code at all.
        expect(res.body.code).toBeUndefined();
    });

    it('rejects an unknown field with 400 (whitelist)', async () => {
        const agent = await adminAgent();
        await getFiltered(agent, {
            field: 'passwordHash',
            op: 'eq',
            value: 'x'
        }).expect(400);
    });

    it('rejects an inherited Object.prototype name with 400, not a 500', async () => {
        // The field/relation whitelists are plain object maps, so a bare
        // `fields[seg]` lookup finds `constructor` / `toString` /
        // `hasOwnProperty` on Object.prototype and treats them as declared.
        // Before the `Object.hasOwn` guard the leaf sailed through the parser
        // and reached SQL as a non-column, emitting `$1 = ` — a Postgres
        // syntax error, i.e. a user-triggerable 500 on every filterable
        // endpoint. A relation-shaped one (`toString.constructor`) was worse:
        // it translated to `undefined` and the filter was silently dropped.
        const agent = await adminAgent();
        for (const field of [
            'constructor',
            'toString',
            'hasOwnProperty',
            'toString.constructor',
            'valueOf.key'
        ]) {
            const res = await getFiltered(agent, {
                field,
                op: 'eq',
                value: 'x'
            });
            expect([field, res.status]).toEqual([field, 400]);
            expect(res.body.code).toMatch(/^FILTER_UNKNOWN_(FIELD|RELATION)$/);
        }
    });

    it('rejects an unknown operator with 400', async () => {
        const agent = await adminAgent();
        await getFiltered(agent, {
            field: 'email',
            op: 'totallybogus',
            value: 'x'
        }).expect(400);
    });

    it('rejects malformed JSON with 400', async () => {
        const agent = await adminAgent();
        await agent
            .get('/api/users')
            .query({ filter: '{not json' })
            .expect(400);
    });

    it('rejects a tree nested past the group-depth cap with 400', async () => {
        const agent = await adminAgent();
        let inner: unknown = { field: 'email', op: 'eq', value: 'a@b.com' };
        for (let i = 0; i < 10; i++) inner = { and: [inner] };
        await getFiltered(agent, inner).expect(400);
    });

    it('rejects an empty `in` list with 400 (never silently matches all)', async () => {
        // An empty list would translate to `IN ()` / `NOT IN ()`, which
        // Drizzle emits as `false` / `true` — a silent no-op or inverted
        // filter. The engine must reject it instead.
        await seedUser(harness.app, {
            email: 'present@example.com',
            role: 'viewer',
            status: 'active'
        });
        const agent = await adminAgent();

        await getFiltered(agent, {
            field: 'status',
            op: 'in',
            value: []
        }).expect(400);
        await getFiltered(agent, {
            field: 'status',
            op: 'nin',
            value: []
        }).expect(400);
    });

    it('rejects an oversized `in` list with 400 (DoS guard)', async () => {
        const agent = await adminAgent();
        // Just over the engine's 100-element cap (DEFAULT_MAX_IN_LIST) so the
        // request reaches the guard and 400s. A far larger list would overflow
        // Node's 16KB max-http-header-size and reset the socket (ECONNRESET)
        // before the guard ever runs.
        const huge = Array.from({ length: 101 }, (_, i) => `v${i}`);
        await getFiltered(agent, {
            field: 'email',
            op: 'in',
            value: huge
        }).expect(400);
    });

    it('treats an empty filter as no filter (returns all)', async () => {
        await seedUser(harness.app, {
            email: 'someone@example.com',
            role: 'viewer',
            status: 'active'
        });
        const agent = await adminAgent();

        const res = await agent
            .get('/api/users')
            .query({ filter: '' })
            .expect(200);
        expect(res.body.total).toBe(2); // admin + someone
    });
});
