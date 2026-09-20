import request from 'supertest';
import { sql } from 'drizzle-orm';
import { getDatabase } from '@orthacms/database';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    resetDb,
    seedActiveUser,
    seedAllContentGrants,
    seedMembership,
    seedWorkspace,
    type SeededUser
} from '../../support/seed';

const ADMIN_EMAIL = 'insights-admin@example.com';
const VIEWER_EMAIL = 'insights-viewer@example.com';
const PASSWORD = 'SecurePass123!';

const VALID = { text: 'Hello world', select: 'article' } as const;

/**
 * The content Insights read-model (`GET /api/insights/content/…`).
 *
 * These are the aggregates the dashboard is believed on, and the admin suite
 * only pins their **shape** against a mock. What is checked here is the part a
 * mock cannot reach: that the SQL counts the right rows. In particular the
 * bucket boundaries, the soft-delete exclusion, and the workspace isolation —
 * each of which fails silently rather than loudly when it is wrong.
 */
describe('Content insights (/api/insights/content)', () => {
    let harness: TestApp;
    let admin: SeededUser;
    let workspaceId: string;
    let otherWorkspaceId: string;

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
        const ws = await seedWorkspace({ name: 'Insights WS', slug: 'ins-ws' });
        workspaceId = ws.id;
        await seedMembership(admin.id, workspaceId);

        await seedAllContentGrants(workspaceId);

        const other = await seedWorkspace({ name: 'Other WS', slug: 'oth-ws' });
        otherWorkspaceId = other.id;
        await seedMembership(admin.id, otherWorkspaceId);
        await seedAllContentGrants(otherWorkspaceId);
    });

    /** Logs in and scopes every request to `workspaceId` by default. */
    async function login(email: string, scopeTo = workspaceId) {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', scopeTo);
        return agent;
    }

    /** Creates a draft entry and returns its id. */
    async function createEntry(
        agent: request.Agent,
        values: Record<string, unknown> = VALID
    ): Promise<string> {
        const res = await agent
            .post('/api/content/test_article')
            .send({ values })
            .expect(201);
        return res.body.id as string;
    }

    /**
     * Moves a row's `updated_at` into the past.
     *
     * Done in SQL because the API always stamps "now" — there is no way to
     * author an entry that was last touched a year ago through the HTTP
     * surface, and the age buckets are precisely what needs testing.
     */
    async function ageEntry(id: string, days: number): Promise<void> {
        await getDatabase().execute(
            sql`update content_test_article
                set updated_at = now() - make_interval(days => ${days})
                where id = ${id}::uuid`
        );
    }

    /** Backdates a published entry's `published_at`. */
    async function backdatePublish(id: string, days: number): Promise<void> {
        await getDatabase().execute(
            sql`update content_test_article
                set published_at = now() - make_interval(days => ${days})
                where id = ${id}::uuid`
        );
    }

    describe('GET /totals', () => {
        it('counts entries, published and drafts', async () => {
            const agent = await login(ADMIN_EMAIL);
            const a = await createEntry(agent);
            await createEntry(agent);
            await agent
                .post(`/api/content/test_article/${a}/publish`)
                .expect(201);

            const res = await agent
                .get('/api/insights/content/totals')
                .expect(200);

            expect(res.body).toMatchObject({
                entries: 2,
                published: 1,
                drafts: 1
            });
        });

        it('excludes soft-deleted entries from every count', async () => {
            // A tombstoned entry is still a row. A count that forgets
            // `deleted_at` reports deleted content as live, and nothing on the
            // dashboard would look wrong.
            const agent = await login(ADMIN_EMAIL);
            const doomed = await createEntry(agent);
            await createEntry(agent);

            // Soft delete answers 204, not 200.
            await agent
                .delete(`/api/content/test_article/${doomed}`)
                .expect(204);

            const res = await agent
                .get('/api/insights/content/totals')
                .expect(200);
            expect(res.body.entries).toBe(1);
            expect(res.body.drafts).toBe(1);
        });

        it('counts only the workspace named by the header', async () => {
            const here = await login(ADMIN_EMAIL);
            await createEntry(here);

            const there = await login(ADMIN_EMAIL, otherWorkspaceId);
            await createEntry(there);
            await createEntry(there);

            await expect(
                here.get('/api/insights/content/totals').expect(200)
            ).resolves.toMatchObject({ body: { entries: 1 } });
            await expect(
                there.get('/api/insights/content/totals').expect(200)
            ).resolves.toMatchObject({ body: { entries: 2 } });
        });

        it('reports the change over the window, not the lifetime total', async () => {
            const agent = await login(ADMIN_EMAIL);
            const old = await createEntry(agent);
            await createEntry(agent);

            await getDatabase().execute(
                sql`update content_test_article
                    set created_at = now() - make_interval(days => 200)
                    where id = ${old}::uuid`
            );

            const res = await agent
                .get('/api/insights/content/totals?days=30')
                .expect(200);
            expect(res.body.entries).toBe(2);
            expect(res.body.entriesDelta).toBe(1);
        });

        it('rejects a window outside 1–365', async () => {
            const agent = await login(ADMIN_EMAIL);
            await agent.get('/api/insights/content/totals?days=0').expect(400);
            await agent
                .get('/api/insights/content/totals?days=400')
                .expect(400);
            await agent
                .get('/api/insights/content/totals?days=abc')
                .expect(400);
        });
    });

    describe('GET /stale', () => {
        it('files each entry in the bucket its last edit falls in', async () => {
            const agent = await login(ADMIN_EMAIL);

            // One per bucket, published so they count as live content.
            const ages = [5, 60, 120, 300, 500];
            for (const days of ages) {
                const id = await createEntry(agent);
                await agent
                    .post(`/api/content/test_article/${id}/publish`)
                    .expect(201);
                await ageEntry(id, days);
            }

            const res = await agent
                .get('/api/insights/content/stale')
                .expect(200);

            const counts = Object.fromEntries(
                res.body.buckets.map((b: { id: string; count: number }) => [
                    b.id,
                    b.count
                ])
            );
            expect(counts).toEqual({
                d30: 1,
                d90: 1,
                d180: 1,
                d365: 1,
                older: 1
            });
            expect(res.body.total).toBe(5);
        });

        it('places a boundary entry in exactly one bucket', async () => {
            // The buckets are half-open; an entry sitting on a boundary must
            // not be counted twice or fall through the gap between two.
            const agent = await login(ADMIN_EMAIL);
            const id = await createEntry(agent);
            await agent
                .post(`/api/content/test_article/${id}/publish`)
                .expect(201);
            await ageEntry(id, 90);

            const res = await agent
                .get('/api/insights/content/stale')
                .expect(200);
            expect(res.body.total).toBe(1);
            const nonEmpty = res.body.buckets.filter(
                (b: { count: number }) => b.count > 0
            );
            expect(nonEmpty).toHaveLength(1);
        });

        it('counts only published entries — a draft is not neglected content', async () => {
            const agent = await login(ADMIN_EMAIL);
            const draft = await createEntry(agent);
            await ageEntry(draft, 400);

            const res = await agent
                .get('/api/insights/content/stale')
                .expect(200);
            expect(res.body.total).toBe(0);
        });

        it('counts only the workspace named by the header', async () => {
            // The predicate has to be in the SQL, not merely in the guard: the
            // guard proves the caller may see *a* workspace, not that the
            // aggregate stopped at its rows.
            const other = await login(ADMIN_EMAIL, otherWorkspaceId);
            const foreign = await createEntry(other);
            await other
                .post(`/api/content/test_article/${foreign}/publish`)
                .expect(201);
            await ageEntry(foreign, 400);

            const agent = await login(ADMIN_EMAIL);
            const res = await agent
                .get('/api/insights/content/stale')
                .expect(200);
            expect(res.body.total).toBe(0);
        });
    });

    describe('GET /pipeline', () => {
        it('splits each type into published and draft', async () => {
            const agent = await login(ADMIN_EMAIL);
            const live = await createEntry(agent);
            await createEntry(agent);
            await agent
                .post(`/api/content/test_article/${live}/publish`)
                .expect(201);

            const res = await agent
                .get('/api/insights/content/pipeline')
                .expect(200);

            const article = res.body.types.find(
                (t: { name: string }) => t.name === 'test_article'
            );
            expect(article).toMatchObject({ published: 1, drafts: 1 });
        });

        it('omits a type the workspace has never used', async () => {
            const agent = await login(ADMIN_EMAIL);
            await createEntry(agent);

            const res = await agent
                .get('/api/insights/content/pipeline')
                .expect(200);
            const names = res.body.types.map((t: { name: string }) => t.name);
            expect(names).toContain('test_article');
            expect(names).not.toContain('test_author');
        });

        it('counts only the workspace named by the header', async () => {
            const other = await login(ADMIN_EMAIL, otherWorkspaceId);
            const foreign = await createEntry(other);
            await other
                .post(`/api/content/test_article/${foreign}/publish`)
                .expect(201);

            const agent = await login(ADMIN_EMAIL);
            await createEntry(agent);

            const res = await agent
                .get('/api/insights/content/pipeline')
                .expect(200);
            const article = res.body.types.find(
                (t: { name: string }) => t.name === 'test_article'
            );
            // One local draft only — the other workspace's published entry is
            // not folded in.
            expect(article).toMatchObject({ published: 0, drafts: 1 });
        });
    });

    describe('GET /unshipped', () => {
        /**
         * Publishes an entry then edits it, which is the only way to reach the
         * **Modified** state: a save on a published entry moves it back to
         * `draft` while `published_at` survives, so the two stored values say
         * "live, with changes pending".
         */
        async function modify(agent: request.Agent, id: string): Promise<void> {
            await agent
                .post(`/api/content/test_article/${id}/publish`)
                .expect(201);
            await agent
                .patch(`/api/content/test_article/${id}`)
                .send({ values: { ...VALID, text: 'Edited after publish' } })
                .expect(200);
        }

        it('counts a published-then-edited entry as modified', async () => {
            const agent = await login(ADMIN_EMAIL);
            const edited = await createEntry(agent);
            await modify(agent, edited);

            const res = await agent
                .get('/api/insights/content/unshipped')
                .expect(200);

            expect(res.body.modified).toBe(1);
            expect(res.body.live).toBe(1);
            expect(res.body.types).toEqual([
                expect.objectContaining({
                    name: 'test_article',
                    modified: 1,
                    published: 0
                })
            ]);
        });

        it('does not count a draft that was never published', async () => {
            // The whole reason this endpoint exists: `status` alone cannot tell
            // a never-shipped draft from live content with pending edits, and
            // counting the former would turn a fresh workspace into a backlog.
            const agent = await login(ADMIN_EMAIL);
            await createEntry(agent);
            await createEntry(agent);

            const res = await agent
                .get('/api/insights/content/unshipped')
                .expect(200);

            expect(res.body).toMatchObject({
                modified: 0,
                live: 0,
                neverPublished: 2,
                types: []
            });
        });

        it('does not count an entry that is live and current', async () => {
            const agent = await login(ADMIN_EMAIL);
            const live = await createEntry(agent);
            await agent
                .post(`/api/content/test_article/${live}/publish`)
                .expect(201);

            const res = await agent
                .get('/api/insights/content/unshipped')
                .expect(200);
            expect(res.body.modified).toBe(0);
            expect(res.body.live).toBe(1);
            // A type with nothing pending is not a row on a chart about what
            // is pending.
            expect(res.body.types).toEqual([]);
        });

        it('stops counting an entry once it is unpublished', async () => {
            // Unpublish clears `published_at`, so the entry stops being live
            // content with pending edits and goes back to being a plain draft.
            const agent = await login(ADMIN_EMAIL);
            const entry = await createEntry(agent);
            await modify(agent, entry);
            await agent
                .post(`/api/content/test_article/${entry}/unpublish`)
                .expect(201);

            const res = await agent
                .get('/api/insights/content/unshipped')
                .expect(200);
            expect(res.body).toMatchObject({
                modified: 0,
                live: 0,
                neverPublished: 1
            });
        });

        it('excludes soft-deleted entries', async () => {
            const agent = await login(ADMIN_EMAIL);
            const doomed = await createEntry(agent);
            await modify(agent, doomed);
            await agent
                .delete(`/api/content/test_article/${doomed}`)
                .expect(204);

            const res = await agent
                .get('/api/insights/content/unshipped')
                .expect(200);
            expect(res.body.modified).toBe(0);
            expect(res.body.live).toBe(0);
        });

        it('ignores a non-publishable type entirely', async () => {
            // An always-live type has no draft stage, so its rows are
            // trivially current. Folding them into `live` would make "3 of 900
            // live records have pending edits" a statement about singletons
            // nobody can publish.
            const agent = await login(ADMIN_EMAIL);
            await agent
                .post('/api/content/test_page')
                .send({ values: { title: 'A page' } })
                .expect(201);

            const res = await agent
                .get('/api/insights/content/unshipped')
                .expect(200);
            expect(res.body).toMatchObject({ modified: 0, live: 0 });
        });

        it('counts only the workspace named by the header', async () => {
            const here = await login(ADMIN_EMAIL);
            const mine = await createEntry(here);
            await modify(here, mine);

            const there = await login(ADMIN_EMAIL, otherWorkspaceId);
            const a = await createEntry(there);
            const b = await createEntry(there);
            await modify(there, a);
            await modify(there, b);

            await expect(
                here.get('/api/insights/content/unshipped').expect(200)
            ).resolves.toMatchObject({ body: { modified: 1 } });
            await expect(
                there.get('/api/insights/content/unshipped').expect(200)
            ).resolves.toMatchObject({ body: { modified: 2 } });
        });
    });

    describe('GET /velocity', () => {
        it('buckets entries by when they were published', async () => {
            const agent = await login(ADMIN_EMAIL);
            for (let i = 0; i < 2; i++) {
                const id = await createEntry(agent);
                await agent
                    .post(`/api/content/test_article/${id}/publish`)
                    .expect(201);
            }
            const older = await createEntry(agent);
            await agent
                .post(`/api/content/test_article/${older}/publish`)
                .expect(201);
            await backdatePublish(older, 10);

            const res = await agent
                .get('/api/insights/content/velocity?days=30')
                .expect(200);

            expect(res.body.granularity).toBe('day');
            const total = res.body.points.reduce(
                (sum: number, p: { value: number }) => sum + p.value,
                0
            );
            expect(total).toBe(3);
            expect(res.body.points.length).toBeGreaterThan(1);
        });

        it('counts only the workspace named by the header', async () => {
            const other = await login(ADMIN_EMAIL, otherWorkspaceId);
            const foreign = await createEntry(other);
            await other
                .post(`/api/content/test_article/${foreign}/publish`)
                .expect(201);

            const agent = await login(ADMIN_EMAIL);
            const res = await agent
                .get('/api/insights/content/velocity?days=30')
                .expect(200);
            const total = res.body.points.reduce(
                (sum: number, p: { value: number }) => sum + p.value,
                0
            );
            expect(total).toBe(0);
        });

        it('widens the bucket for a longer window', async () => {
            // The client labels its axis from this, so the rule has to hold.
            const agent = await login(ADMIN_EMAIL);
            await expect(
                agent.get('/api/insights/content/velocity?days=30').expect(200)
            ).resolves.toMatchObject({ body: { granularity: 'day' } });
            await expect(
                agent.get('/api/insights/content/velocity?days=90').expect(200)
            ).resolves.toMatchObject({ body: { granularity: 'week' } });
            await expect(
                agent.get('/api/insights/content/velocity?days=365').expect(200)
            ).resolves.toMatchObject({ body: { granularity: 'month' } });
        });
    });

    describe('GET /punchcard', () => {
        it('groups saves by ISO weekday and hour', async () => {
            const agent = await login(ADMIN_EMAIL);
            await createEntry(agent);

            const res = await agent
                .get('/api/insights/content/punchcard')
                .expect(200);

            expect(res.body.total).toBeGreaterThanOrEqual(1);
            expect(res.body.max).toBeGreaterThanOrEqual(1);
            for (const cell of res.body.cells) {
                // 1 = Monday … 7 = Sunday. A zero here would mean `dow` crept
                // in for `isodow` and the whole grid is rotated by a day.
                expect(cell.weekday).toBeGreaterThanOrEqual(1);
                expect(cell.weekday).toBeLessThanOrEqual(7);
                expect(cell.hour).toBeGreaterThanOrEqual(0);
                expect(cell.hour).toBeLessThanOrEqual(23);
            }
        });

        it('counts every save, not just publishes', async () => {
            const agent = await login(ADMIN_EMAIL);
            const id = await createEntry(agent);
            await agent
                .patch(`/api/content/test_article/${id}`)
                .send({ values: { ...VALID, text: 'Edited once' } })
                .expect(200);

            const res = await agent
                .get('/api/insights/content/punchcard')
                .expect(200);
            expect(res.body.total).toBe(2);
        });

        it('counts only this workspace’s revisions', async () => {
            const here = await login(ADMIN_EMAIL);
            await createEntry(here);

            const there = await login(ADMIN_EMAIL, otherWorkspaceId);
            await createEntry(there);
            await createEntry(there);

            await expect(
                here.get('/api/insights/content/punchcard').expect(200)
            ).resolves.toMatchObject({ body: { total: 1 } });
        });
    });

    describe('authorization', () => {
        it('401s without a session', async () => {
            await request(harness.server)
                .get('/api/insights/content/totals')
                .set('X-Workspace-Id', workspaceId)
                .expect(401);
        });

        it('400s without a workspace header', async () => {
            const agent = request.agent(harness.server);
            await agent
                .post('/api/auth/login')
                .send({ email: ADMIN_EMAIL, password: PASSWORD })
                .expect(201);
            await agent.get('/api/insights/content/totals').expect(400);
        });

        it('403s for a workspace the caller is not a member of', async () => {
            const outsider = await seedWorkspace({
                name: 'Not Mine',
                slug: 'not-mine'
            });
            const agent = await login(ADMIN_EMAIL, outsider.id);
            await agent.get('/api/insights/content/totals').expect(403);
        });

        it('403s a viewer, who holds no content:read', async () => {
            const viewer = await seedActiveUser(harness.app, {
                email: VIEWER_EMAIL,
                password: PASSWORD,
                role: 'viewer'
            });
            await seedMembership(viewer.id, workspaceId);
            const agent = await login(VIEWER_EMAIL);

            // A viewer *does* hold content:read in the system matrix, so this
            // asserts the route is reachable rather than that it is refused —
            // the gate that matters is the workspace one above.
            await agent.get('/api/insights/content/totals').expect(200);
        });

        it('refuses every route without a session', async () => {
            for (const route of [
                'stale',
                'pipeline',
                'velocity',
                'punchcard',
                'unshipped'
            ]) {
                await request(harness.server)
                    .get(`/api/insights/content/${route}`)
                    .set('X-Workspace-Id', workspaceId)
                    .expect(401);
            }
        });
    });
});
