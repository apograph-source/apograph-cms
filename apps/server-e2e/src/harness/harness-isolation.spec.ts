import request from 'supertest';
import { getPool } from '@apograph/database';
import { closeTestApp, createTestApp, type TestApp } from '../support/test-app';
import {
    resetDb,
    seedActiveUser,
    seedUserWithEmptyRole,
    seedWorkspace
} from '../support/seed';
import { getOutboxRows } from '../support/outbox';
import { TEST_ALLOWED_ORIGIN } from '../support/test-config';

const EMAIL = 'harness-isolation@example.com';
const PASSWORD = 'SecurePass123!';

/**
 * The isolation guarantees every other suite is written on top of.
 *
 * `resetDb()` is asserted by 1000-odd cases *implicitly* — they pass, so it must
 * work. The failure mode this suite exists for is the opposite one: a table that
 * `resetDb` misses leaks state into a later test in the same worker, and the
 * consequence lands somewhere else entirely as an off-by-one count or a unique
 * violation in a test about authorization. Those are the failures that get
 * misread as product regressions, so the isolation contract is asserted here
 * directly rather than inferred.
 */
describe('harness isolation (resetDb)', () => {
    let harness: TestApp;

    beforeAll(async () => {
        harness = await createTestApp();
    });
    afterAll(async () => {
        await closeTestApp(harness);
    });
    beforeEach(async () => {
        await resetDb();
    });

    it('clears outbox_events, so an undispatched row cannot be retried inside a later test', async () => {
        // `outbox_events` declares no foreign keys at all, so no `CASCADE` from
        // `users` or `workspaces` ever reaches it. Before it was truncated
        // explicitly, a row whose subscriber threw stayed `dispatched_at IS
        // NULL` and the dispatcher's 5-second poll backstop retried it in a
        // later test — writing an `activity_events` row into a window some
        // other suite was counting, with the explanatory log suppressed by
        // `logger: false`.
        const admin = await seedActiveUser(harness.app, {
            email: EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email: EMAIL, password: PASSWORD })
            .expect(201);

        const created = await agent
            .post('/api/workspaces')
            .set('Origin', TEST_ALLOWED_ORIGIN)
            .send({
                name: 'Outbox WS',
                slug: 'outbox-ws',
                description: 'Writes a domain event.',
                color: 'violet',
                members: [],
                content: { mode: 'all' }
            })
            .expect(201);

        // The mutation really did write to the outbox — otherwise the next
        // assertion would pass vacuously.
        expect(await getOutboxRows(created.body.id)).not.toHaveLength(0);
        expect(admin.id).toBeDefined();

        await resetDb();

        const { rows } = await getPool().query<{ total: number }>(
            'SELECT count(*)::int AS total FROM outbox_events'
        );
        expect(rows[0].total).toBe(0);
    });

    it('clears non-system roles, so a seeded role key can be reused', async () => {
        // `roles` deliberately survives for the system roles users FK — but
        // `seedUserWithEmptyRole` inserts a NON-system role, and that surviving
        // is what made the permission-less-principal suites retry-hostile: a
        // second attempt at the same test died on a unique violation on
        // `roles.key` instead of on what it was asserting.
        await seedUserWithEmptyRole(harness.app, {
            email: 'empty-role-a@example.com',
            password: PASSWORD,
            roleKey: 'harness-isolation-empty'
        });

        await resetDb();

        // The same key again. Before the fix this threw 23505.
        await expect(
            seedUserWithEmptyRole(harness.app, {
                email: 'empty-role-a@example.com',
                password: PASSWORD,
                roleKey: 'harness-isolation-empty'
            })
        ).resolves.toMatchObject({ email: 'empty-role-a@example.com' });
    });

    it('leaves the system roles alone, because users FK them', async () => {
        // The other half of the contract. `SystemRolesSeeder` runs once per app
        // at bootstrap; if `resetDb` took the system roles with it, every seed
        // after the first test in a file would fail to resolve a role id.
        await resetDb();
        const { rows } = await getPool().query<{ key: string }>(
            'SELECT key FROM roles WHERE is_system = true ORDER BY key'
        );
        expect(rows.map((row) => row.key)).toEqual(
            expect.arrayContaining(['admin', 'contributor', 'viewer'])
        );
    });

    it('leaves no workspace behind', async () => {
        await seedWorkspace({ name: 'Leftover', slug: 'leftover' });
        await resetDb();
        const { rows } = await getPool().query<{ total: number }>(
            'SELECT count(*)::int AS total FROM workspaces'
        );
        expect(rows[0].total).toBe(0);
    });
});

/**
 * Two apps, one file, in sequence.
 *
 * `closeTestApp` used to end the `@apograph/database` pool without clearing
 * `initDatabase`'s memo, so the second `createTestApp` in a file silently reused
 * the **ended** pool and every query threw "Cannot use a pool after calling end
 * on the pool" — a message naming neither the caller nor the cause. No suite did
 * this, and nothing stopped one from trying. This is that suite.
 */
describe('harness lifecycle (a second app in one file)', () => {
    it('boots a usable app after a previous one was closed', async () => {
        const first = await createTestApp();
        await resetDb();
        await request(first.server).get('/api/auth/me').expect(401);
        await closeTestApp(first);

        const second = await createTestApp();
        try {
            // A query, not just a boot: the ended-pool failure only shows up
            // when something actually talks to the database.
            await resetDb();
            await seedActiveUser(second.app, {
                email: 'second-app@example.com',
                password: PASSWORD,
                role: 'admin'
            });
            await request(second.server)
                .post('/api/auth/login')
                .send({ email: 'second-app@example.com', password: PASSWORD })
                .expect(201);
        } finally {
            await closeTestApp(second);
        }
    });
});
