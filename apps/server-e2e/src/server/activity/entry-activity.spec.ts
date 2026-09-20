import request from 'supertest';
import { getPool } from '@orthacms/database';
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
    seedUserWithEmptyRole,
    seedUserWithPermissions,
    seedWorkspace,
    type SeededUser,
    type SeededWorkspace
} from '../../support/seed';

const ADMIN = 'entry-activity-admin@example.com';
const PASSWORD = 'SecurePass123!';

/** One audit row as the assertions here read it. */
interface TrailRow {
    kind: string;
    subjectId: string;
    meta: Record<string, unknown> | null;
}

/**
 * `GET /api/activity/entries/:entryId` — one entry's own audit trail, the route
 * the entry editor's rail calls.
 *
 * It is the **only** read in this plugin that is scoped by workspace, and the
 * only one gated on `content:read` rather than `activity:read`: the full log is
 * deployment-wide and admin-only, so this route deliberately answers a narrower
 * question with a weaker key. That trade only holds if the narrowing is real,
 * which is what this suite exists to say. Nothing asserted it before — an
 * implementation that dropped the `workspace_id` predicate would have served an
 * editor in one workspace the history of an entry in another, and every test
 * would still have passed.
 *
 * The rule fails **closed** in both directions: an entry id from another
 * workspace reads as an empty history rather than as somebody else's, and a row
 * whose `workspace_id` is null (written before the column existed) is excluded
 * rather than assumed harmless. Losing old history on this narrow route is the
 * side to err on; the full log still has those rows.
 */
describe('Entry activity (GET /api/activity/entries/:entryId)', () => {
    let harness: TestApp;
    let admin: SeededUser;
    let home: SeededWorkspace;
    let other: SeededWorkspace;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        admin = await seedActiveUser(harness.app, {
            email: ADMIN,
            password: PASSWORD,
            role: 'admin'
        });
        home = await seedWorkspace({ name: 'Home', slug: 'home' });
        other = await seedWorkspace({ name: 'Other', slug: 'other' });
        // A member of **both**, so what refuses the cross-workspace read is the
        // route's own predicate rather than the membership guard in front of it.
        await seedMembership(admin.id, home.id);
        await seedMembership(admin.id, other.id);
        await seedAllContentGrants(home.id);
        await seedAllContentGrants(other.id);
    });

    /** A signed-in agent with one workspace open. */
    async function login(workspaceId: string) {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email: ADMIN, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', workspaceId);
        return agent;
    }

    /** Create a draft `test_article` in the agent's open workspace. */
    async function createArticle(agent: request.Agent): Promise<string> {
        const res = await agent
            .post('/api/content/test_article')
            .send({ values: { text: 'Draft one', select: 'article' } })
            .expect(201);
        return res.body.id as string;
    }

    /** This entry's trail as one workspace sees it. */
    async function trail(
        agent: request.Agent,
        entryId: string
    ): Promise<{ items: TrailRow[]; total: number }> {
        const res = await agent
            .get(`/api/activity/entries/${entryId}`)
            .expect(200);
        return res.body;
    }

    it('serves an entry’s own trail to its workspace and nobody else’s [activity:I-33]', async () => {
        const inHome = await login(home.id);
        const entryId = await createArticle(inHome);
        await inHome
            .patch(`/api/content/test_article/${entryId}`)
            .send({ values: { text: 'Draft two', select: 'article' } })
            .expect(200);

        // Both halves in one case on purpose. "Empty for the other workspace"
        // is worthless on its own — an entry with no recorded history at all
        // reads exactly the same — so the populated read is what makes the
        // empty one mean something.
        const mine = await trail(inHome, entryId);
        expect(mine.items.map((row) => row.kind).sort()).toEqual([
            'entry.created',
            'entry.updated'
        ]);
        for (const row of mine.items) {
            expect(row.subjectId).toBe(entryId);
        }

        const inOther = await login(other.id);
        const theirs = await trail(inOther, entryId);
        expect(theirs.items).toEqual([]);
        expect(theirs.total).toBe(0);
    });

    it('excludes a row that belongs to no workspace [activity:I-33]', async () => {
        const inHome = await login(home.id);
        const entryId = await createArticle(inHome);

        // A row from before `workspace_id` existed: the same subject, the same
        // entry, no workspace. Written straight to the table because no producer
        // can emit one any more — which is the point, since the rows that look
        // like this in a real deployment were written by a version of the code
        // that no longer exists.
        await getPool().query(
            `INSERT INTO activity_events
                 (kind, subject_type, subject_id, actor_id, actor_email,
                  workspace_id, meta, at)
             VALUES ('entry.published', 'content_entry', $1, NULL,
                     'legacy@example.com', NULL, NULL, now())`,
            [entryId]
        );

        const mine = await trail(inHome, entryId);

        // `entry.created` is still there, so the query is running and matching —
        // and the legacy row is not, so a null workspace is a miss rather than a
        // wildcard. A predicate written as "workspace matches OR is null" passes
        // every other assertion in this file and fails this one.
        expect(mine.items.map((row) => row.kind)).toEqual(['entry.created']);
        expect(mine.total).toBe(1);
    });

    it('refuses a pageSize above the 100-row maximum here too [activity:I-18]', async () => {
        // `EntryActivityQueryDto` carries its own `@Max(MAX_PAGE_SIZE)`; a cap
        // added to the full log's query object and not to this one is the shape
        // of the mistake. The guards pass first (a member, with `content:read`,
        // and a real workspace header), so the 400 can only come from the pipe.
        const inHome = await login(home.id);
        const entryId = await createArticle(inHome);

        await inHome
            .get(`/api/activity/entries/${entryId}?pageSize=101`)
            .expect(400);
        await inHome
            .get(`/api/activity/entries/${entryId}?pageSize=100`)
            .expect(200);
    });

    /**
     * The two keys this route turns on, neither of which any other case here
     * exercises: every test above signs in as an administrator who is a member
     * of both workspaces, so it holds `content:read` and passes
     * `WorkspaceGuard` without either being asserted.
     *
     * They are checked against the **same** entry and the same header, so the
     * only thing that differs between a 403 and a 200 is the caller — a route
     * that had lost its `@RequirePermissions`, or the `WorkspaceGuard` off its
     * `@UseGuards` list, changes exactly one of these answers.
     */
    it('takes content:read and membership of the header’s workspace [activity:I-14]', async () => {
        const inHome = await login(home.id);
        const entryId = await createArticle(inHome);

        /** A signed-in agent for a seeded principal, with `home` open. */
        async function agentFor(email: string) {
            const agent = request.agent(harness.server);
            await agent
                .post('/api/auth/login')
                .send({ email, password: PASSWORD })
                .expect(201);
            agent.set('X-Workspace-Id', home.id);
            return agent;
        }

        // A member of the workspace holding no permission at all. Membership
        // is not the bar: an entry's trail says who published it and who
        // changed who may read it.
        const noPermission = await seedUserWithEmptyRole(harness.app, {
            email: 'entry-activity-nothing@example.com',
            password: PASSWORD,
            roleKey: 'entry-activity-nothing'
        });
        await seedMembership(noPermission.id, home.id);
        await (await agentFor('entry-activity-nothing@example.com'))
            .get(`/api/activity/entries/${entryId}`)
            .expect(403);

        // The mirror image: `content:read`, and no membership of the workspace
        // it is naming in the header.
        const outsider = await seedUserWithPermissions(harness.app, {
            email: 'entry-activity-outsider@example.com',
            password: PASSWORD,
            roleKey: 'entry-activity-outsider',
            permissions: ['content:read']
        });
        const outsiderAgent = await agentFor(
            'entry-activity-outsider@example.com'
        );
        await outsiderAgent.get(`/api/activity/entries/${entryId}`).expect(403);

        // Give that same principal the membership it was missing and the same
        // request succeeds — so the 403 above was the membership and nothing
        // else about the fixture.
        await seedMembership(outsider.id, home.id);
        const allowed = await outsiderAgent
            .get(`/api/activity/entries/${entryId}`)
            .expect(200);
        expect(allowed.body.items.map((row: TrailRow) => row.kind)).toEqual([
            'entry.created'
        ]);
    });
});
