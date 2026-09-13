import request from 'supertest';
import { getPool } from '@apograph/database';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { TEST_ALLOWED_ORIGIN } from '../../support/test-config';
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
const AUTHOR = 'review-author@example.com';
const REVIEWER = 'review-reviewer@example.com';
const SECOND_REVIEWER = 'review-second@example.com';
const ADMIN = 'review-admin@example.com';
/**
 * A second administrator, used only to write the rule under test.
 *
 * Separate from `ADMIN` so a test that needs an administrator of its own — to
 * withdraw somebody else's request, or to be refused a self-approval — is not
 * seeding the same email twice.
 */
const RULE_ADMIN = 'review-rule-admin@example.com';
const VIEWER = 'review-viewer@example.com';
const OUTSIDER = 'review-outsider@example.com';

/**
 * `/api/protection/entries/:type/:id` — the review surface.
 *
 * Almost every assertion here is a sentence from the design document that
 * nothing else enforces: that an approval is bound to a **revision** so a save
 * invalidates it without any dismissal logic, that the author of the head
 * cannot approve it, that requesting changes is zero votes plus an explanation
 * rather than a veto, and that asking for review twice updates one row instead
 * of stacking a second into somebody's queue.
 *
 * The counting itself is `evaluateProtection` in `@apograph/protection-domain`
 * and is unit-tested there. What is tested here is that the server hands it the
 * right head revision and the right votes — the half a pure function cannot
 * check.
 */
describe('/api/protection/entries', () => {
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
        workspace = await seedWorkspace({ name: 'Press', slug: 'press' });
        await seedContentGrants(workspace.id, ['test_article']);
    });

    /** Seed a member of `role`, log them in, and scope the agent to the workspace. */
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

    /** Write the rule for `test_article`, as an administrator. */
    async function protect(fields: Record<string, unknown>): Promise<void> {
        const { agent } = await member(RULE_ADMIN, 'admin');
        await agent
            .put('/api/protection/rules/collection/test_article')
            .send(fields)
            .expect(200);
    }

    /** Create an entry through the real content API and return its id. */
    async function createEntry(
        agent: ReturnType<typeof request.agent>,
        text = 'First draft'
    ): Promise<string> {
        const created = await agent
            .post('/api/content/test_article')
            .send({ values: { text, select: 'article' } })
            .expect(201);
        return created.body.id as string;
    }

    /** Save the entry again, which appends a new revision and moves the head. */
    async function editEntry(
        agent: ReturnType<typeof request.agent>,
        id: string,
        text: string
    ): Promise<void> {
        await agent
            .patch(`/api/content/test_article/${id}`)
            .send({ values: { text } })
            .expect(200);
    }

    /**
     * Save the entry with every value the publish gate requires, so a publish
     * that follows is judged by the guard alone.
     */
    async function saveComplete(
        agent: ReturnType<typeof request.agent>,
        id: string,
        text: string
    ): Promise<void> {
        await agent
            .patch(`/api/content/test_article/${id}`)
            .send({ values: { text, select: 'article' } })
            .expect(200);
    }

    /**
     * The id of the administrator `protect()` seeded — a member holding
     * `content:approve`, so somebody a request may name without seeding a
     * reviewer the test is not about.
     */
    async function ruleAdminId(): Promise<string> {
        const { rows } = await getPool().query<{ id: string }>(
            'SELECT id FROM users WHERE email = $1',
            [RULE_ADMIN]
        );
        return rows[0].id;
    }

    /** Ask `reviewerIds` to review, as `agent`. */
    function ask(
        agent: ReturnType<typeof request.agent>,
        id: string,
        reviewerIds: string[]
    ) {
        return agent
            .post(`/api/protection/entries/test_article/${id}/request`)
            .send({ reviewerIds });
    }

    /** The entry's revisions, oldest first. */
    async function revisionsOf(
        entryId: string
    ): Promise<{ id: string; number: number }[]> {
        const { rows } = await getPool().query<{ id: string; number: number }>(
            `SELECT id, revision_number AS number
             FROM content_entry_revisions
             WHERE entry_id = $1 ORDER BY revision_number`,
            [entryId]
        );
        return rows;
    }

    /** Open review requests for one entry. */
    async function openRequests(entryId: string): Promise<number> {
        const { rows } = await getPool().query<{ count: string }>(
            `SELECT count(*)::text AS count FROM review_requests
             WHERE entry_id = $1 AND resolved_at IS NULL`,
            [entryId]
        );
        return Number(rows[0].count);
    }

    /** Every review request row for one entry, open or not. */
    async function allRequests(entryId: string): Promise<number> {
        const { rows } = await getPool().query<{ count: string }>(
            `SELECT count(*)::text AS count FROM review_requests WHERE entry_id = $1`,
            [entryId]
        );
        return Number(rows[0].count);
    }

    /** Approval rows for one entry. */
    async function approvalRows(
        entryId: string
    ): Promise<{ userId: string; revisionId: string }[]> {
        const { rows } = await getPool().query(
            `SELECT user_id AS "userId", revision_id AS "revisionId"
             FROM review_approvals WHERE entry_id = $1 ORDER BY created_at`,
            [entryId]
        );
        return rows;
    }

    /**
     * Audit rows for one subject, polled — the outbox dispatcher drains on
     * commit, but the drain is a separate transaction and asserting on it
     * immediately makes the test a race rather than a check.
     */
    async function auditFor(
        subjectId: string,
        kinds: readonly string[],
        expected = 1
    ): Promise<{ kind: string; actorId: string | null; meta: unknown }[]> {
        for (let attempt = 0; attempt < 40; attempt += 1) {
            const { rows } = await getPool().query(
                `SELECT kind, actor_id AS "actorId", meta
                 FROM activity_events
                 WHERE subject_id = $1 AND kind = ANY($2::text[])
                 ORDER BY at, id`,
                [subjectId, [...kinds]]
            );
            if (rows.length >= expected) return rows;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return [];
    }

    describe('GET /entries/:type/:id', () => {
        it('reports an unprotected type as needing nothing', async () => {
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);

            const response = await agent
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200);

            expect(response.body).toMatchObject({
                protected: false,
                required: 0,
                given: 0,
                stale: 0,
                blocked: false,
                afterSave: {
                    required: 0,
                    given: 0,
                    blocked: false,
                    bypassable: false
                },
                approvals: [],
                request: null
            });
        });

        /**
         * The read is `content:read`, deliberately — `protection:manage` is
         * administrator-only, and a contributor still has to see "0 of 2" on
         * the entry they are editing.
         */
        it('is readable by a contributor, who cannot read the rule table', async () => {
            await protect({ enabled: true, requiredApprovals: 2 });
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);

            await agent
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200)
                .expect((res) => {
                    expect(res.body).toMatchObject({
                        protected: true,
                        required: 2,
                        given: 0,
                        blocked: true
                    });
                });

            // The same person cannot read the workspace's rules.
            await agent.get('/api/protection/rules').expect(403);
        });

        /**
         * The editor's Publish saves unsaved changes first, and that save moves
         * the head — so the verdict on the stored head is not the one such a
         * publish meets. `afterSave` is that second verdict, and it is what
         * stops the button offering an ordinary publish the API then refuses.
         */
        /**
         * ⭐ The prediction is only worth anything if the guard then agrees
         * with it — in both directions, because a prediction that always said
         * "held" would pass a one-sided check.
         */
        it('[protection:I-18] predicts the guard when a save will hold the publish', async () => {
            await protect({ enabled: true, requiredApprovals: 1 });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const { agent: reviewer } = await member(REVIEWER, 'contributor');
            const id = await createEntry(author);
            await reviewer
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(201);

            const state = await author
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200);
            expect(state.body.afterSave.blocked).toBe(true);

            // The only approval is on the version this save replaces. The
            // whole document, so the publish gate passes and the answer is the
            // guard's — the admin PATCH replaces rather than merges.
            await saveComplete(author, id, 'Edited after approval');
            await author
                .post(`/api/content/test_article/${id}/publish`)
                .expect(409);
        });

        it('[protection:I-18] predicts the guard when a save will let the publish through', async () => {
            // A stale-counting rule, so the reviewer's vote survives the save.
            await protect({
                enabled: true,
                requiredApprovals: 1,
                countStaleApprovals: true
            });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const { agent: reviewer } = await member(REVIEWER, 'contributor');
            const id = await createEntry(author);
            await reviewer
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(201);

            const state = await author
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200);
            expect(state.body.afterSave.blocked).toBe(false);

            await saveComplete(author, id, 'Edited, still approved');
            await author
                .post(`/api/content/test_article/${id}/publish`)
                .expect(201);
        });

        it('[protection:I-18] reports the verdict a save by the caller would meet', async () => {
            await protect({ enabled: true, requiredApprovals: 1 });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);
            const { agent: reviewer } = await member(REVIEWER, 'contributor');
            await reviewer
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(201);

            const state = await author
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200);
            expect(state.body).toMatchObject({ given: 1, blocked: false });
            expect(state.body.afterSave).toEqual({
                required: 1,
                given: 0,
                blocked: true,
                bypassable: false
            });

            // The same prediction offers an administrator the way through.
            const { agent: admin } = await member(ADMIN, 'admin');
            const asAdmin = await admin
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200);
            expect(asAdmin.body.afterSave).toMatchObject({
                blocked: true,
                bypassable: true
            });
        });

        it('[protection:I-18] keeps stale-counted votes in that prediction, minus the caller’s own', async () => {
            await protect({
                enabled: true,
                requiredApprovals: 1,
                countStaleApprovals: true
            });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);
            const { agent: reviewer } = await member(REVIEWER, 'contributor');
            await reviewer
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(201);

            const byAuthor = await author
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200);
            expect(byAuthor.body.afterSave).toMatchObject({
                given: 1,
                blocked: false
            });

            // Were the reviewer to save, they would write the head — and the
            // four-eyes switch takes their own vote out of the count.
            const byReviewer = await reviewer
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200);
            expect(byReviewer.body.afterSave).toMatchObject({
                given: 0,
                blocked: true
            });
        });

        it('is refused without a session', async () => {
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);

            await request(harness.server)
                .get(`/api/protection/entries/test_article/${id}`)
                .set('X-Workspace-Id', workspace.id)
                .expect(401);
        });

        it('404s for an entry in another workspace', async () => {
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);

            const other = await seedWorkspace({ name: 'Other', slug: 'other' });
            await seedContentGrants(other.id, ['test_article']);
            await seedMembership(
                (
                    await seedActiveUser(harness.app, {
                        email: 'elsewhere@example.com',
                        password: PASSWORD,
                        role: 'admin'
                    })
                ).id,
                other.id
            );

            const outsider = request.agent(harness.server);
            await outsider
                .post('/api/auth/login')
                .send({ email: 'elsewhere@example.com', password: PASSWORD })
                .expect(201);

            await outsider
                .get(`/api/protection/entries/test_article/${id}`)
                .set('X-Workspace-Id', other.id)
                .expect(404);
        });

        it('404s for a content type the workspace was not granted', async () => {
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);

            // `test_author` exists but this workspace holds no grant for it —
            // the same answer a type that does not exist gets.
            await agent
                .get(`/api/protection/entries/test_author/${id}`)
                .expect(404);
            await agent
                .get(`/api/protection/entries/no_such_type/${id}`)
                .expect(404);
        });
    });

    describe('GET /entries/:type/:id/reviewers', () => {
        /**
         * One list for both ends of the request: exactly who the request route
         * accepts. A viewer is not on it — they could never approve — and
         * neither is the person asking.
         */
        it('[protection:I-22] lists the other members who can approve, and nobody else', async () => {
            await protect({ enabled: true });
            const { agent, user: author } = await member(AUTHOR, 'contributor');
            const { user: reviewer } = await member(REVIEWER, 'contributor');
            const { user: viewer } = await member(VIEWER, 'viewer');
            const id = await createEntry(agent);

            const response = await agent
                .get(`/api/protection/entries/test_article/${id}/reviewers`)
                .expect(200);
            const ids = response.body.candidates.map(
                (candidate: { userId: string }) => candidate.userId
            );

            expect(ids).toEqual(
                expect.arrayContaining([reviewer.id, await ruleAdminId()])
            );
            expect(ids).not.toContain(author.id);
            expect(ids).not.toContain(viewer.id);
            expect(response.body.candidates[0]).toEqual({
                userId: expect.any(String),
                email: expect.any(String)
            });
        });

        it('is refused to a viewer, who cannot ask for review', async () => {
            await protect({ enabled: true });
            const { agent: authorAgent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(authorAgent);
            const { agent } = await member(VIEWER, 'viewer');

            await agent
                .get(`/api/protection/entries/test_article/${id}/reviewers`)
                .expect(403);
        });
    });

    describe('POST /entries/:type/:id/request', () => {
        it('opens a request naming its reviewers, and records who asked', async () => {
            await protect({ enabled: true, requiredApprovals: 1 });
            const { agent, user } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);
            const reviewer = await ruleAdminId();

            await ask(agent, id, [reviewer]).expect(201);

            const state = await agent
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200);
            expect(state.body.request).toMatchObject({
                requestedBy: user.id,
                reviewerIds: [reviewer]
            });
            expect(state.body.request).not.toHaveProperty('note');
            expect(await openRequests(id)).toBe(1);
        });

        /**
         * The partial unique index means a second ask is an update. A 409 here
         * would make "I forgot to ask Anna too" a thing the product refuses for
         * no reason a person would recognise.
         */
        it('replaces the reviewers on the open request rather than stacking a second', async () => {
            await protect({ enabled: true });
            const { agent } = await member(AUTHOR, 'contributor');
            const { user: reviewer } = await member(REVIEWER, 'contributor');
            const id = await createEntry(agent);
            const admin = await ruleAdminId();

            await ask(agent, id, [admin]).expect(201);
            await ask(agent, id, [reviewer.id, admin]).expect(201);

            expect(await openRequests(id)).toBe(1);
            const state = await agent
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200);
            expect(state.body.request.reviewerIds).toEqual([
                reviewer.id,
                admin
            ]);
        });

        it('survives a save — the request outlives the revision it was opened on', async () => {
            await protect({ enabled: true });
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);
            await ask(agent, id, [await ruleAdminId()]).expect(201);

            await editEntry(agent, id, 'A typo fixed after asking');

            // An author who fixes a typo after asking has not withdrawn the
            // request; re-opening one on every save would churn the queue.
            expect(await openRequests(id)).toBe(1);
        });

        it('is refused to a viewer, who cannot update content', async () => {
            await protect({ enabled: true });
            const { agent: authorAgent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(authorAgent);

            const { agent } = await member(VIEWER, 'viewer');
            await ask(agent, id, [await ruleAdminId()]).expect(403);
        });

        it('is refused from a disallowed origin', async () => {
            await protect({ enabled: true });
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);
            const reviewerIds = [await ruleAdminId()];

            await agent
                .post(`/api/protection/entries/test_article/${id}/request`)
                .set('Origin', 'https://evil.example')
                .send({ reviewerIds })
                .expect(403);

            await agent
                .post(`/api/protection/entries/test_article/${id}/request`)
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({ reviewerIds })
                .expect(201);
        });

        /** Notes are gone: a body carrying one is a body this route does not take. */
        it('rejects a note, and any other unknown field', async () => {
            await protect({ enabled: true });
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);
            const reviewerIds = [await ruleAdminId()];

            await agent
                .post(`/api/protection/entries/test_article/${id}/request`)
                .send({ reviewerIds, note: 'have a look' })
                .expect(400);
            await agent
                .post(`/api/protection/entries/test_article/${id}/request`)
                .send({ reviewerIds, urgency: 'high' })
                .expect(400);
        });

        it('rejects a request naming nobody', async () => {
            await protect({ enabled: true });
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);

            await ask(agent, id, []).expect(400);
            await agent
                .post(`/api/protection/entries/test_article/${id}/request`)
                .send({})
                .expect(400);
            expect(await openRequests(id)).toBe(0);
        });

        /**
         * Nobody may be left in a request as a pending reviewer with no way to
         * approve: a viewer, the person asking, somebody who belongs to another
         * workspace, or an id nobody owns. One 422 for all four, naming nobody.
         *
         * The **outsider** is the case worth seeding properly. A made-up uuid is
         * refused by any implementation that so much as resolves the id against
         * `users`; the person who could actually be smuggled into a
         * `reviewer_ids` array is a real, active account holding
         * `content:approve` — who is simply a member somewhere else. Only that
         * one exercises the `memberships` join in `ReviewerCandidatesQuery`.
         */
        it('[protection:I-22] 422s a reviewer who could never approve it', async () => {
            await protect({ enabled: true });
            const { agent, user: author } = await member(AUTHOR, 'contributor');
            const { user: viewer } = await member(VIEWER, 'viewer');
            const id = await createEntry(agent);

            const elsewhere = await seedWorkspace({
                name: 'Elsewhere',
                slug: 'elsewhere'
            });
            const { user: outsider } = await member(
                OUTSIDER,
                'contributor',
                elsewhere
            );
            const nobody = '00000000-0000-4000-8000-000000000001';

            for (const reviewerIds of [
                [viewer.id],
                [author.id],
                [outsider.id],
                [nobody]
            ]) {
                const response = await ask(agent, id, reviewerIds).expect(422);
                expect(response.body.code).toBe(
                    'protection.reviewer_not_eligible'
                );
            }
            expect(await openRequests(id)).toBe(0);
        });

        it('writes a review.requested audit row naming the reviewers', async () => {
            await protect({ enabled: true });
            const { agent, user } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);
            const reviewer = await ruleAdminId();

            await ask(agent, id, [reviewer]).expect(201);

            const rows = await auditFor(id, ['review.requested']);
            expect(rows).toHaveLength(1);
            expect(rows[0].actorId).toBe(user.id);
            expect(rows[0].meta).toMatchObject({
                contentType: 'test_article',
                reviewerIds: [reviewer]
            });
        });
    });

    describe('DELETE /entries/:type/:id/request', () => {
        it('lets the requester withdraw, resolving the row rather than deleting it', async () => {
            await protect({ enabled: true });
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);
            await ask(agent, id, [await ruleAdminId()]).expect(201);

            await agent
                .delete(`/api/protection/entries/test_article/${id}/request`)
                .expect(204);

            expect(await openRequests(id)).toBe(0);
            // Resolved, not gone: the trail keeps that it was asked for.
            expect(await allRequests(id)).toBe(1);
        });

        it('lets an administrator withdraw somebody else’s request', async () => {
            await protect({ enabled: true });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);
            await ask(author, id, [await ruleAdminId()]).expect(201);

            const { agent: admin } = await member(ADMIN, 'admin');
            await admin
                .delete(`/api/protection/entries/test_article/${id}/request`)
                .expect(204);
            expect(await openRequests(id)).toBe(0);
        });

        it('refuses a different contributor', async () => {
            await protect({ enabled: true });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);
            await ask(author, id, [await ruleAdminId()]).expect(201);

            const { agent: other } = await member(REVIEWER, 'contributor');
            await other
                .delete(`/api/protection/entries/test_article/${id}/request`)
                .expect(403);
            expect(await openRequests(id)).toBe(1);
        });

        it('404s when there is nothing open to withdraw', async () => {
            await protect({ enabled: true });
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);

            await agent
                .delete(`/api/protection/entries/test_article/${id}/request`)
                .expect(404);
        });
    });

    describe('POST /entries/:type/:id/approve', () => {
        it('records an approval and satisfies the rule', async () => {
            await protect({ enabled: true, requiredApprovals: 1 });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);

            const { agent: reviewer, user } = await member(
                REVIEWER,
                'contributor'
            );
            await reviewer
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(201);

            const state = await author
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200);
            expect(state.body).toMatchObject({
                required: 1,
                given: 1,
                stale: 0,
                blocked: false
            });
            expect(state.body.approvals).toHaveLength(1);
            expect(state.body.approvals[0]).toMatchObject({
                userId: user.id,
                isStale: false
            });
            expect(state.body.approvals[0]).not.toHaveProperty('note');
            expect(state.body.approvals[0]).not.toHaveProperty('decision');
        });

        /**
         * ⭐ The feature's whole point, end to end. The approval is not deleted
         * and no dismissal code runs — the head simply moved, and the vote that
         * counted is now attached to a version nobody is publishing.
         */
        it('stops counting after a save, and says which version it was given on', async () => {
            await protect({ enabled: true, requiredApprovals: 1 });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);

            const { agent: reviewer } = await member(REVIEWER, 'contributor');
            await reviewer
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(201);

            const before = await author
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200);
            expect(before.body).toMatchObject({ given: 1, blocked: false });

            await editEntry(author, id, 'Second draft');

            const after = await author
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200);
            expect(after.body).toMatchObject({
                given: 0,
                stale: 1,
                blocked: true
            });
            // Nothing was deleted — the row survives so the panel can strike it
            // through and name its version.
            expect(await approvalRows(id)).toHaveLength(1);
            expect(after.body.approvals[0]).toMatchObject({
                isStale: true,
                revisionNumber: 1
            });
        });

        it('counts the stale vote again when the rule says to', async () => {
            await protect({
                enabled: true,
                requiredApprovals: 1,
                countStaleApprovals: true
            });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);
            const { agent: reviewer } = await member(REVIEWER, 'contributor');
            await reviewer
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(201);

            await editEntry(author, id, 'Second draft');

            const after = await author
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200);
            expect(after.body).toMatchObject({
                given: 1,
                stale: 0,
                blocked: false
            });
        });

        /** ⭐ Four eyes: the author of the head cannot be one of them. */
        it('409s when the caller wrote the head revision', async () => {
            await protect({
                enabled: true,
                requiredApprovals: 1,
                requireOtherPerson: true
            });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);

            const response = await author
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(409);
            expect(response.body.code).toBe('protection.self_approval_refused');
            expect(await approvalRows(id)).toHaveLength(0);
        });

        it('409s for an administrator who wrote the head, too', async () => {
            await protect({ enabled: true, requireOtherPerson: true });
            const { agent } = await member(ADMIN, 'admin');
            const id = await createEntry(agent);

            await agent
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(409);
        });

        it('lets the author approve once the switch is off', async () => {
            await protect({
                enabled: true,
                requiredApprovals: 1,
                requireOtherPerson: false
            });
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);

            await agent
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(201);
        });

        /**
         * The author of the *head*, not of the entry. Somebody else saving
         * means the original author is no longer the person being checked.
         */
        it('lets the original author approve after somebody else saved', async () => {
            await protect({
                enabled: true,
                requiredApprovals: 1,
                requireOtherPerson: true
            });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);

            const { agent: editor } = await member(REVIEWER, 'contributor');
            await editEntry(editor, id, 'Edited by somebody else');

            await author
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(201);
        });

        it('keeps one row when the same person approves twice', async () => {
            await protect({ enabled: true, requiredApprovals: 1 });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);
            const { agent: reviewer } = await member(REVIEWER, 'contributor');

            for (let attempt = 0; attempt < 2; attempt += 1) {
                await reviewer
                    .post(`/api/protection/entries/test_article/${id}/approve`)
                    .expect(201);
            }

            expect(await approvalRows(id)).toHaveLength(1);
        });

        /** Approving takes no body now; a note is refused rather than dropped. */
        it('rejects a note', async () => {
            await protect({ enabled: true });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);
            const { agent: reviewer } = await member(REVIEWER, 'contributor');

            await reviewer
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .send({ note: 'reads fine' })
                .expect(400);
        });

        /** Asking for approval is how the rail knows there is nothing left to press. */
        it('tells the caller they already approved the current version', async () => {
            await protect({ enabled: true, requiredApprovals: 2 });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);
            const { agent: reviewer } = await member(REVIEWER, 'contributor');

            const before = await reviewer
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200);
            expect(before.body.callerApprovedHead).toBe(false);

            await reviewer
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(201);
            const after = await reviewer
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200);
            expect(after.body.callerApprovedHead).toBe(true);

            // A save moves the head: their approval is on a version nobody is
            // publishing, and there is something to press again.
            await editEntry(author, id, 'Second draft');
            const edited = await reviewer
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200);
            expect(edited.body.callerApprovedHead).toBe(false);
        });

        it('needs content:approve, which a viewer does not hold', async () => {
            await protect({ enabled: true });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);

            const { agent } = await member(VIEWER, 'viewer');
            await agent
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(403);
        });

        it('writes a review.approved audit row naming the version', async () => {
            await protect({ enabled: true });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);
            const { agent: reviewer, user } = await member(
                REVIEWER,
                'contributor'
            );

            await reviewer
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(201);

            const rows = await auditFor(id, ['review.approved']);
            expect(rows).toHaveLength(1);
            expect(rows[0].actorId).toBe(user.id);
            // The revision number is what makes the trail survive later edits:
            // "approved" with nothing to say what was approved is not a trail.
            expect(rows[0].meta).toMatchObject({
                contentType: 'test_article',
                revisionNumber: 1
            });
        });
    });

    describe('POST /entries/:type/:id/changes', () => {
        /** Requesting changes was removed with notes; the route is gone. */
        it('no longer exists', async () => {
            await protect({ enabled: true });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);
            const { agent: reviewer } = await member(REVIEWER, 'contributor');

            await reviewer
                .post(`/api/protection/entries/test_article/${id}/changes`)
                .expect(404);
        });
    });

    describe('DELETE /entries/:type/:id/approve', () => {
        it('withdraws the caller’s own vote', async () => {
            await protect({ enabled: true, requiredApprovals: 1 });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);
            const { agent: reviewer } = await member(REVIEWER, 'contributor');
            await reviewer
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(201);

            await reviewer
                .delete(`/api/protection/entries/test_article/${id}/approve`)
                .expect(204);

            expect(await approvalRows(id)).toHaveLength(0);
            const state = await author
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200);
            expect(state.body).toMatchObject({ given: 0, blocked: true });
        });

        it('leaves another reviewer’s vote alone', async () => {
            await protect({ enabled: true, requiredApprovals: 2 });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);
            const { agent: first } = await member(REVIEWER, 'contributor');
            const { agent: second, user: secondUser } = await member(
                SECOND_REVIEWER,
                'contributor'
            );
            await first
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(201);
            await second
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(201);

            await first
                .delete(`/api/protection/entries/test_article/${id}/approve`)
                .expect(204);

            const rows = await approvalRows(id);
            expect(rows).toHaveLength(1);
            expect(rows[0].userId).toBe(secondUser.id);
        });

        it('is idempotent when there is no vote to withdraw', async () => {
            await protect({ enabled: true });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);
            const { agent: reviewer } = await member(REVIEWER, 'contributor');

            await reviewer
                .delete(`/api/protection/entries/test_article/${id}/approve`)
                .expect(204);
        });

        /**
         * A withdrawal only reaches the head. A vote on an older revision is
         * already not counting, and deleting it would erase the struck-through
         * line that explains why the number moved.
         */
        it('does not reach back to a stale vote', async () => {
            await protect({ enabled: true });
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);
            const { agent: reviewer } = await member(REVIEWER, 'contributor');
            await reviewer
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(201);

            await editEntry(author, id, 'Second draft');
            expect((await revisionsOf(id)).length).toBeGreaterThan(1);

            await reviewer
                .delete(`/api/protection/entries/test_article/${id}/approve`)
                .expect(204);

            expect(await approvalRows(id)).toHaveLength(1);
        });
    });

    describe('an unprotected type still records review', () => {
        /**
         * Asking for a second pair of eyes on a type nobody protected is a
         * reasonable thing to do, and refusing it would make the queue a
         * function of the settings tab rather than of what people asked for.
         * What an unprotected type does not do is *block*.
         */
        it('accepts a request and an approval, and blocks nothing', async () => {
            const { agent: author } = await member(AUTHOR, 'contributor');
            const id = await createEntry(author);
            const { agent: reviewer, user } = await member(
                REVIEWER,
                'contributor'
            );
            await ask(author, id, [user.id]).expect(201);

            await reviewer
                .post(`/api/protection/entries/test_article/${id}/approve`)
                .expect(201);

            const state = await author
                .get(`/api/protection/entries/test_article/${id}`)
                .expect(200);
            expect(state.body).toMatchObject({
                protected: false,
                required: 0,
                blocked: false
            });
            expect(state.body.approvals).toHaveLength(1);
        });
    });
});
