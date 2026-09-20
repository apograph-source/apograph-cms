import request from 'supertest';
import { getPool } from '@ortha/database';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    resetDb,
    seedActiveUser,
    seedContentGrants,
    seedMembership,
    seedWorkspace,
    type SeededWorkspace
} from '../../support/seed';

const PASSWORD = 'SecurePass123!';
const ADMIN = 'status-admin@example.com';
const AUTHOR = 'status-author@example.com';
const REVIEWER = 'status-reviewer@example.com';

/**
 * `GET /api/protection/entries/:typeName/status` — the records column's read.
 *
 * The load-bearing assertion is the last one: this read is **batched**, so its
 * query count is flat in the number of entries asked about. A column built on
 * the single-entry review route would pass every other test in this file and
 * turn a page of twenty-five into seventy-five queries, which is exactly the
 * N+1 `RevisionStore.heads` was added to prevent.
 */
describe('/api/protection/entries/:typeName/status', () => {
    let harness: TestApp;
    let workspace: SeededWorkspace;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        workspace = await seedWorkspace({ name: 'Desk', slug: 'desk' });
        await seedContentGrants(workspace.id, ['test_article']);
    });

    async function member(
        email: string,
        role: 'admin' | 'contributor' | 'viewer',
        ws: SeededWorkspace = workspace
    ) {
        const user = await seedActiveUser(harness.app, {
            email,
            password: PASSWORD,
            role
        });
        await seedMembership(user.id, ws.id);
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', ws.id);
        return { user, agent };
    }

    async function protect(fields: Record<string, unknown>): Promise<void> {
        const { agent } = await member(ADMIN, 'admin');
        await agent
            .put('/api/protection/rules/collection/test_article')
            .send(fields)
            .expect(200);
    }

    async function createEntry(
        agent: ReturnType<typeof request.agent>,
        text: string
    ): Promise<string> {
        const created = await agent
            .post('/api/content/test_article')
            .send({ values: { text, select: 'article' } })
            .expect(201);
        return created.body.id as string;
    }

    /** Read the column's status map for a set of ids. */
    async function statusOf(
        agent: ReturnType<typeof request.agent>,
        ids: string[]
    ) {
        const res = await agent
            .get('/api/protection/entries/test_article/status')
            .query({ ids: ids.join(',') })
            .expect(200);
        return res.body.byEntry as Record<
            string,
            {
                protected: boolean;
                required: number;
                given: number;
                stale: number;
                requested: boolean;
                blocked: boolean;
            }
        >;
    }

    it('reports an unprotected type as unprotected, with no requirement', async () => {
        const { agent } = await member(AUTHOR, 'contributor');
        const id = await createEntry(agent, 'Unruled');

        const byEntry = await statusOf(agent, [id]);

        expect(byEntry[id]).toMatchObject({
            protected: false,
            required: 0,
            blocked: false
        });
    });

    it('reports the requirement and the tally on a protected type', async () => {
        await protect({ enabled: true, requiredApprovals: 2 });
        const { agent } = await member(AUTHOR, 'contributor');
        const id = await createEntry(agent, 'Ruled');

        const { agent: reviewer } = await member(REVIEWER, 'contributor');
        await reviewer
            .post(`/api/protection/entries/test_article/${id}/approve`)
            .send({})
            .expect(201);

        const byEntry = await statusOf(agent, [id]);

        expect(byEntry[id]).toMatchObject({
            protected: true,
            required: 2,
            given: 1,
            blocked: true
        });
    });

    /**
     * The counter moving on a save is the feature's whole point, and the column
     * has to show the same movement the panel does — both read the kernel, so
     * this is really a check that the column reads the *head*, not a stored
     * tally.
     */
    it('drops the tally and reports the stale vote once the entry is saved', async () => {
        await protect({ enabled: true, requiredApprovals: 1 });
        const { agent } = await member(AUTHOR, 'contributor');
        const id = await createEntry(agent, 'First');

        const { agent: reviewer } = await member(REVIEWER, 'contributor');
        await reviewer
            .post(`/api/protection/entries/test_article/${id}/approve`)
            .send({})
            .expect(201);
        expect((await statusOf(agent, [id]))[id]).toMatchObject({
            given: 1,
            stale: 0,
            blocked: false
        });

        await agent
            .patch(`/api/content/test_article/${id}`)
            .send({ values: { text: 'Second' } })
            .expect(200);

        expect((await statusOf(agent, [id]))[id]).toMatchObject({
            given: 0,
            stale: 1,
            blocked: true
        });
    });

    it('reports an open request, and an id it cannot reach is simply absent', async () => {
        await protect({ enabled: true, requiredApprovals: 1 });
        const { agent } = await member(AUTHOR, 'contributor');
        const asked = await createEntry(agent, 'Asked');
        const quiet = await createEntry(agent, 'Quiet');
        const { user: reviewer } = await member(REVIEWER, 'contributor');
        await agent
            .post(`/api/protection/entries/test_article/${asked}/request`)
            .send({ reviewerIds: [reviewer.id] })
            .expect(201);

        const unknown = '11111111-1111-4111-8111-111111111111';
        const byEntry = await statusOf(agent, [asked, quiet, unknown]);

        expect(byEntry[asked]).toMatchObject({ requested: true });
        expect(byEntry[quiet]).toMatchObject({ requested: false });
        // Absent, not reported as unprotected: "there is no head here to read"
        // and "this type has no rule" are different facts.
        expect(byEntry[unknown]).toBeUndefined();
    });

    /**
     * The **workspace** boundary, which the absent-id assertion above does not
     * touch: an id nobody owns is absent from any implementation, scoped or
     * not. This one asks for an entry that really exists, of a type both
     * workspaces hold, from a session in the other workspace — and it is the
     * only test here that fails if `ReviewStatusQuery` stops passing the
     * workspace down to `RevisionStore.heads`, which is where all of its
     * scoping lives.
     */
    it('does not report an entry that belongs to another workspace', async () => {
        await protect({ enabled: true, requiredApprovals: 1 });
        const { agent } = await member(AUTHOR, 'contributor');
        const mine = await createEntry(agent, 'Ours');

        const other = await seedWorkspace({ name: 'Other', slug: 'other' });
        await seedContentGrants(other.id, ['test_article']);
        const { agent: outsider } = await member(
            REVIEWER,
            'contributor',
            other
        );
        const theirs = await createEntry(outsider, 'Theirs');

        // Each side asks about both ids; each side may only see its own.
        expect(await statusOf(agent, [mine, theirs])).toEqual({
            [mine]: expect.objectContaining({ protected: true })
        });
        expect(await statusOf(outsider, [mine, theirs])).toEqual({
            [theirs]: expect.objectContaining({ protected: false })
        });
    });

    /**
     * **The N+1 guard.** `ReviewStatusQuery` issues a constant number of
     * queries — the heads, the votes, the rules — whatever the page holds, so
     * growing the page must not grow the count. Building the column on the
     * single-entry review route instead would make this scale with rows and
     * fail here.
     */
    it('issues the same number of queries for 1 entry and 10', async () => {
        await protect({ enabled: true, requiredApprovals: 2 });
        const { agent } = await member(AUTHOR, 'contributor');
        const ids: string[] = [];
        for (let index = 0; index < 10; index += 1) {
            ids.push(await createEntry(agent, `Row ${index}`));
        }
        // Votes on every row, so a per-row implementation would have plenty to
        // fan out over rather than short-circuiting on empty results.
        const { agent: reviewer } = await member(REVIEWER, 'contributor');
        for (const id of ids) {
            await reviewer
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .send({})
                .expect(201);
        }

        const pool = getPool();
        const original = pool.query.bind(pool);
        let queries = 0;
        (pool as { query: unknown }).query = (...args: unknown[]) => {
            queries += 1;
            return (original as (...a: unknown[]) => unknown)(...args);
        };

        try {
            const measure = async (page: string[]) => {
                queries = 0;
                await agent
                    .get('/api/protection/entries/test_article/status')
                    .query({ ids: page.join(',') })
                    .expect(200);
                return queries;
            };

            const one = await measure(ids.slice(0, 1));
            const ten = await measure(ids);
            expect(ten).toBe(one);
        } finally {
            (pool as { query: unknown }).query = original;
        }
    });
});
