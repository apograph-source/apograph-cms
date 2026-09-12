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
    type SeededUser,
    type SeededWorkspace
} from '../../support/seed';

const PASSWORD = 'SecurePass123!';
const AUTHOR = 'queue-author@example.com';
const OTHER_AUTHOR = 'queue-other-author@example.com';
const REVIEWER = 'queue-reviewer@example.com';
/** Asked on every request — a member who can approve, never logged in. */
const STANDING_REVIEWER = 'queue-standing-reviewer@example.com';

/**
 * `GET /api/protection/queue` — how a reviewer learns there is work.
 *
 * Without it approvals exist and nobody knows they are wanted. It spans every
 * content type in the workspace, which is why it is a page of its own rather
 * than a saved view of one collection's records list.
 */
describe('/api/protection/queue', () => {
    let harness: TestApp;
    let workspace: SeededWorkspace;
    let standingReviewerId: string;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        workspace = await seedWorkspace({ name: 'Press', slug: 'press' });
        await seedContentGrants(workspace.id, ['test_article', 'test_author']);
        const standing = await seedActiveUser(harness.app, {
            email: STANDING_REVIEWER,
            password: PASSWORD,
            role: 'contributor'
        });
        await seedMembership(standing.id, workspace.id);
        standingReviewerId = standing.id;
    });

    async function member(
        email: string,
        role: 'admin' | 'contributor' | 'viewer',
        ws: SeededWorkspace = workspace
    ): Promise<{ user: SeededUser; agent: ReturnType<typeof request.agent> }> {
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

    /** Create an entry of `type` and open a review request on it. */
    async function askFor(
        agent: ReturnType<typeof request.agent>,
        type: 'test_article' | 'test_author',
        values: Record<string, unknown>
    ): Promise<string> {
        const created = await agent
            .post(`/api/content/${type}`)
            .send({ values })
            .expect(201);
        const id = created.body.id as string;
        await agent
            .post(`/api/protection/entries/${type}/${id}/request`)
            .send({ reviewerIds: [standingReviewerId] })
            .expect(201);
        return id;
    }

    /**
     * An empty page, **and nothing else** — `toEqual` rather than
     * `toMatchObject` on purpose, so a field appearing in this response is a
     * decision somebody has to make here rather than something that arrives
     * unnoticed. `overdueAfterDays` is one: the queue carries the server's
     * overdue cut with its rows instead of the client restating it, and it is
     * present on an empty page too, because the page draws the threshold
     * whether or not it has anything to draw it against.
     */
    const EMPTY_QUEUE = { items: [], total: 0, overdueAfterDays: 3 };

    it('is empty when nobody has asked for anything', async () => {
        const { agent } = await member(REVIEWER, 'contributor');
        const response = await agent.get('/api/protection/queue').expect(200);
        expect(response.body).toEqual(EMPTY_QUEUE);
    });

    it('lists open requests across every content type in the workspace', async () => {
        const { agent: author } = await member(AUTHOR, 'contributor');
        const articleId = await askFor(author, 'test_article', {
            text: 'Quarterly results',
            select: 'article'
        });
        const authorId = await askFor(author, 'test_author', {
            text: 'A new byline'
        });

        const { agent: reviewer } = await member(REVIEWER, 'contributor');
        const response = await reviewer
            .get('/api/protection/queue')
            .expect(200);

        expect(response.body.total).toBe(2);
        const ids = response.body.items.map(
            (item: { entryId: string }) => item.entryId
        );
        expect(ids.sort()).toEqual([articleId, authorId].sort());
        expect(Object.keys(response.body.items[0]).sort()).toEqual([
            'contentType',
            'createdAt',
            'entryId',
            'given',
            'id',
            'requestedBy',
            'required',
            'reviewerIds'
        ]);
        expect(response.body.items[0].reviewerIds).toEqual([
            standingReviewerId
        ]);
    });

    /**
     * `?mine=1` is "what did I send", not "what is waiting on me". The second
     * is answered by the client from each line's `reviewerIds` and its own
     * identity, over the same window.
     */
    it('narrows to the caller’s own requests with ?mine=1', async () => {
        const { agent: mine } = await member(AUTHOR, 'contributor');
        const myEntry = await askFor(mine, 'test_article', {
            text: 'Mine',
            select: 'article'
        });

        const { agent: theirs } = await member(OTHER_AUTHOR, 'contributor');
        await askFor(theirs, 'test_article', {
            text: 'Theirs',
            select: 'article'
        });

        const all = await mine.get('/api/protection/queue').expect(200);
        expect(all.body.total).toBe(2);

        const onlyMine = await mine
            .get('/api/protection/queue?mine=1')
            .expect(200);
        expect(onlyMine.body.total).toBe(1);
        expect(onlyMine.body.items[0].entryId).toBe(myEntry);
    });

    it('drops a request once it is withdrawn', async () => {
        const { agent } = await member(AUTHOR, 'contributor');
        const id = await askFor(agent, 'test_article', {
            text: 'Withdrawn',
            select: 'article'
        });

        await agent
            .delete(`/api/protection/entries/test_article/${id}/request`)
            .expect(204);

        const response = await agent.get('/api/protection/queue').expect(200);
        expect(response.body).toEqual(EMPTY_QUEUE);
    });

    it('does not leak another workspace’s queue', async () => {
        const { agent } = await member(AUTHOR, 'contributor');
        await askFor(agent, 'test_article', {
            text: 'Press only',
            select: 'article'
        });

        const other = await seedWorkspace({ name: 'Other', slug: 'other' });
        await seedContentGrants(other.id, ['test_article']);
        const { agent: outsider } = await member(
            REVIEWER,
            'contributor',
            other
        );

        const response = await outsider
            .get('/api/protection/queue')
            .expect(200);
        expect(response.body).toEqual(EMPTY_QUEUE);
    });

    it('is refused without a session', async () => {
        await request(harness.server)
            .get('/api/protection/queue')
            .set('X-Workspace-Id', workspace.id)
            .expect(401);
    });

    it('rejects an unknown query parameter', async () => {
        const { agent } = await member(REVIEWER, 'contributor');
        await agent.get('/api/protection/queue?urgent=1').expect(400);
    });
});
