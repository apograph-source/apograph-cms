import request from 'supertest';
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
const AUTHOR = 'filter-author@example.com';
const REVIEWER = 'filter-reviewer@example.com';
const OUTSIDER = 'filter-outsider@example.com';

/**
 * `reviewState` in the records list's own filter tree.
 *
 * The provider's unit spec builds its predicate against a recorder and says, in
 * its header, that "the e2e covers the rendering". **It did not** — there was no
 * e2e for this field at all, which left the one thing a recorder cannot see
 * untested: that the subquery this plugin splices into content's query builder
 * is a subquery Postgres accepts, correlates to the outer row, and is scoped to
 * the workspace asking.
 *
 * That last one is the reason this file exists rather than another unit test. A
 * virtual field is a subquery over a table `content-server` has never heard of;
 * one that forgot the workspace turns a filter into a cross-tenant read, and a
 * filter that is merely *wrong* still returns rows, so nothing about the screen
 * would say so.
 */
describe('records filter — reviewState', () => {
    let harness: TestApp;
    let workspace: SeededWorkspace;

    const rule = (op: string, value: unknown) =>
        JSON.stringify({ field: 'reviewState', op, value });

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

    /** The texts a filtered list came back with, sorted — order is not the claim. */
    async function listWith(
        agent: ReturnType<typeof request.agent>,
        filter?: string
    ): Promise<string[]> {
        const res = await agent
            .get('/api/content/test_article')
            .query(filter ? { filter } : {})
            .expect(200);
        return (res.body.items as { values: { text: string } }[])
            .map((item) => String(item.values.text))
            .sort();
    }

    it('narrows the list to entries somebody asked about', async () => {
        const { agent } = await member(AUTHOR, 'contributor');
        const { user: reviewer } = await member(REVIEWER, 'contributor');
        const asked = await createEntry(agent, 'Asked');
        await createEntry(agent, 'Quiet');
        await agent
            .post(`/api/protection/entries/test_article/${asked}/request`)
            .send({ reviewerIds: [reviewer.id] })
            .expect(201);

        expect(await listWith(agent, rule('eq', 'awaiting'))).toEqual([
            'Asked'
        ]);
        expect(await listWith(agent, rule('eq', 'not_requested'))).toEqual([
            'Quiet'
        ]);
    });

    /**
     * The two states partition the collection, so asking for both is every row
     * — the provider short-circuits that to `true` rather than an `or` the
     * planner then has to see through, and this is what says the shortcut still
     * means what the long way means.
     */
    it('returns every row when both states are asked for', async () => {
        const { agent } = await member(AUTHOR, 'contributor');
        const { user: reviewer } = await member(REVIEWER, 'contributor');
        const asked = await createEntry(agent, 'Asked');
        await createEntry(agent, 'Quiet');
        await agent
            .post(`/api/protection/entries/test_article/${asked}/request`)
            .send({ reviewerIds: [reviewer.id] })
            .expect(201);

        const both = await listWith(
            agent,
            rule('in', ['awaiting', 'not_requested'])
        );
        expect(both).toEqual(['Asked', 'Quiet']);
        // …and the same list the collection gives with no filter at all.
        expect(both).toEqual(await listWith(agent));
    });

    /** A withdrawn ask resolves the row, so the entry leaves the awaiting list. */
    it('drops an entry once the request is withdrawn', async () => {
        const { agent } = await member(AUTHOR, 'contributor');
        const { user: reviewer } = await member(REVIEWER, 'contributor');
        const asked = await createEntry(agent, 'Asked');
        await agent
            .post(`/api/protection/entries/test_article/${asked}/request`)
            .send({ reviewerIds: [reviewer.id] })
            .expect(201);

        expect(await listWith(agent, rule('eq', 'awaiting'))).toEqual([
            'Asked'
        ]);

        await agent
            .delete(`/api/protection/entries/test_article/${asked}/request`)
            .expect(204);

        expect(await listWith(agent, rule('eq', 'awaiting'))).toEqual([]);
        expect(await listWith(agent, rule('eq', 'not_requested'))).toEqual([
            'Asked'
        ]);
    });

    /**
     * **The workspace boundary.** Another workspace's open request must not make
     * this workspace's entry look asked-about, and it cannot be caught by
     * reading the predicate: a subquery missing its workspace term builds, runs,
     * and returns rows.
     */
    it('does not see another workspace’s open requests', async () => {
        const { agent } = await member(AUTHOR, 'contributor');
        const mine = await createEntry(agent, 'Ours');

        const other = await seedWorkspace({ name: 'Other', slug: 'other' });
        await seedContentGrants(other.id, ['test_article']);
        const { agent: outsider } = await member(
            OUTSIDER,
            'contributor',
            other
        );
        const { user: theirReviewer } = await member(
            'filter-their-reviewer@example.com',
            'contributor',
            other
        );
        const theirs = await createEntry(outsider, 'Theirs');
        await outsider
            .post(`/api/protection/entries/test_article/${theirs}/request`)
            .send({ reviewerIds: [theirReviewer.id] })
            .expect(201);
        // Their ask is open; ours is not. Each side sees only its own rows at
        // all, and the state of the other side's entry changes neither list.
        expect(await listWith(agent, rule('eq', 'awaiting'))).toEqual([]);
        expect(await listWith(agent, rule('eq', 'not_requested'))).toEqual([
            'Ours'
        ]);
        expect(await listWith(outsider, rule('eq', 'awaiting'))).toEqual([
            'Theirs'
        ]);
        expect(mine).not.toBe(theirs);
    });

    /**
     * The refusals. Both are `BadRequestException`s raised from inside the
     * resolver, and what this pins is that they reach the caller as a 400
     * rather than as a 500 from a query that never built.
     */
    it('refuses an operator it cannot answer, and an empty list', async () => {
        const { agent } = await member(AUTHOR, 'contributor');
        await createEntry(agent, 'Any');

        await agent
            .get('/api/content/test_article')
            .query({ filter: rule('ilike', '%await%') })
            .expect(400);
        await agent
            .get('/api/content/test_article')
            .query({ filter: rule('in', []) })
            .expect(400);
    });

    /**
     * The field is offered on every publishable type, protected or not: an open
     * request is real on an unprotected type too, and a picker whose entries
     * appeared and vanished with a settings toggle would break every saved view
     * that named one. No rule is written anywhere in this file.
     */
    it('works on a type nobody has protected', async () => {
        const { agent } = await member(AUTHOR, 'contributor');
        await createEntry(agent, 'Unruled');

        expect(await listWith(agent, rule('eq', 'not_requested'))).toEqual([
            'Unruled'
        ]);
    });
});
