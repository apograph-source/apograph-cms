import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { resetDb, seedActiveUser, type SeededUser } from '../../support/seed';

const ADMIN_EMAIL = 'activity-filter-admin@example.com';
const PASSWORD = 'SecurePass123!';

/**
 * `GET /api/activity?filter=<json>` — the structured query-builder filter
 * wired through `@orthacms/utils-server`. Covers scalar ops, OR groups, and
 * an `at` date range, plus the security boundary (field whitelist) — and that
 * it AND-composes with the existing structured params.
 */
describe('GET /api/activity (query-builder filter)', () => {
    let harness: TestApp;
    let admin: SeededUser;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        admin = await seedActiveUser(harness.app, {
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
    });

    async function login(email: string) {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password: PASSWORD })
            .expect(201);
        return agent;
    }

    /**
     * Produces three events for the admin: signed_in (login) + suspended +
     * reactivated (disabling then re-enabling a member).
     */
    async function seedEvents() {
        const member = await seedActiveUser(harness.app, {
            email: 'member@example.com',
            password: PASSWORD,
            role: 'contributor'
        });
        const agent = await login(ADMIN_EMAIL);
        await agent.post(`/api/users/${member.id}/disable`).expect(201);
        await agent.post(`/api/users/${member.id}/enable`).expect(201);
        return { agent, member };
    }

    function getFiltered(agent: request.Agent, tree: unknown) {
        return agent
            .get('/api/activity')
            .query({ filter: JSON.stringify(tree) });
    }

    it('filters by a scalar kind rule (eq)', async () => {
        const { agent } = await seedEvents();

        const res = await getFiltered(agent, {
            field: 'kind',
            op: 'eq',
            value: 'user.suspended'
        }).expect(200);

        expect(res.body.total).toBe(1);
        expect(res.body.items[0].kind).toBe('user.suspended');
    });

    it('combines kinds with an OR group', async () => {
        const { agent } = await seedEvents();

        const res = await getFiltered(agent, {
            or: [
                { field: 'kind', op: 'eq', value: 'user.suspended' },
                { field: 'kind', op: 'eq', value: 'user.reactivated' }
            ]
        }).expect(200);

        const kinds = res.body.items
            .map((item: { kind: string }) => item.kind)
            .sort();
        expect(kinds).toEqual(['user.reactivated', 'user.suspended']);
    });

    it('filters by an `at` lower bound (gte)', async () => {
        const { agent } = await seedEvents();

        const future = await getFiltered(agent, {
            field: 'at',
            op: 'gte',
            value: '2999-01-01'
        }).expect(200);
        expect(future.body.total).toBe(0);

        const past = await getFiltered(agent, {
            field: 'at',
            op: 'gte',
            value: '2000-01-01'
        }).expect(200);
        expect(past.body.total).toBe(3);
    });

    it('AND-composes the filter with the existing kind param [activity:I-15]', async () => {
        const { agent } = await seedEvents();

        // kind=user.suspended (param) AND actorEmail eq admin (filter)
        const res = await agent
            .get('/api/activity')
            .query({
                kind: 'user.suspended',
                filter: JSON.stringify({
                    field: 'actorEmail',
                    op: 'eq',
                    value: ADMIN_EMAIL
                })
            })
            .expect(200);

        expect(res.body.total).toBe(1);
        expect(res.body.items[0]).toMatchObject({
            kind: 'user.suspended',
            actorId: admin.id
        });
    });

    it('rejects an unknown field with 400 (whitelist) [activity:I-16]', async () => {
        const agent = await login(ADMIN_EMAIL);
        await getFiltered(agent, {
            field: 'meta',
            op: 'eq',
            value: 'x'
        }).expect(400);
    });

    it('rejects malformed JSON with 400', async () => {
        const agent = await login(ADMIN_EMAIL);
        await agent
            .get('/api/activity')
            .query({ filter: '{not json' })
            .expect(400);
    });
});
