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
    type SeededUser,
    type SeededWorkspace
} from '../../support/seed';

const PASSWORD = 'SecurePass123!';
const AUTHOR = 'guard-author@example.com';
const REVIEWER = 'guard-reviewer@example.com';
const SECOND_REVIEWER = 'guard-second@example.com';
const ADMIN = 'guard-admin@example.com';
const RULE_ADMIN = 'guard-rule-admin@example.com';

/**
 * `CONTENT_PUBLISH_GUARD` end to end — the PR in which a protection rule stops
 * being a stored preference and starts refusing publishes.
 *
 * The three things worth testing here are the ones no unit can reach:
 *
 * - **The gate order.** `content:publish` → the publish gate → protection, and a
 *   bypass passes only the third. An incomplete entry stays unpublishable for an
 *   administrator, which is the difference between "authorizes" and "validates"
 *   and the whole reason ADR-0015 refused a second opinion on the same question.
 * - **The reach.** One port, consulted from the publish path, so the admin
 *   button and the token-authenticated public API meet the same rule without
 *   either being wired up individually.
 * - **The trail.** A bypass writes exactly one row, or the publish does not
 *   happen — the auditor is the buyer.
 */
describe('the publish guard', () => {
    let harness: TestApp;
    let workspace: SeededWorkspace;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    /**
     * Logged-in sessions by email, for the length of one test.
     *
     * Several helpers here want the same administrator — `protect()` writes the
     * rule and `mintToken()` mints a key — and seeding one email twice inside a
     * test is a unique-constraint violation that surfaces, confusingly, as the
     * *next* test reporting a user that survived `resetDb`. Memoizing is
     * cheaper than threading one session through every helper, and it is
     * cleared per test so nothing leaks across the reset.
     */
    let sessions: Map<
        string,
        { user: SeededUser; agent: ReturnType<typeof request.agent> }
    >;

    beforeEach(async () => {
        await resetDb();
        sessions = new Map();
        workspace = await seedWorkspace({ name: 'Press', slug: 'press' });
        await seedContentGrants(workspace.id, ['test_article']);
    });

    async function member(
        email: string,
        role: 'admin' | 'contributor' | 'viewer'
    ): Promise<{ user: SeededUser; agent: ReturnType<typeof request.agent> }> {
        const existing = sessions.get(email);
        if (existing) return existing;

        const user = await seedActiveUser(harness.app, {
            email,
            password: PASSWORD,
            role
        });
        await seedMembership(user.id, workspace.id);
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', workspace.id);
        const session = { user, agent };
        sessions.set(email, session);
        return session;
    }

    /** Write the rule for `test_article`, as an administrator of its own. */
    async function protect(fields: Record<string, unknown>): Promise<void> {
        const { agent } = await member(RULE_ADMIN, 'admin');
        await agent
            .put('/api/protection/rules/collection/test_article')
            .send(fields)
            .expect(200);
    }

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

    /** Approve the entry's head as `email`, through the real review route. */
    async function approve(email: string, entryId: string): Promise<void> {
        const { agent } = await member(email, 'contributor');
        await agent
            .post(`/api/protection/entries/test_article/${entryId}/approve`)
            .expect(201);
    }

    async function statusOf(entryId: string): Promise<string> {
        const { rows } = await getPool().query<{ status: string }>(
            `SELECT status FROM content_test_article WHERE id = $1`,
            [entryId]
        );
        return rows[0].status;
    }

    async function openRequests(entryId: string): Promise<number> {
        const { rows } = await getPool().query<{ count: string }>(
            `SELECT count(*)::text AS count FROM review_requests
             WHERE entry_id = $1 AND resolved_at IS NULL`,
            [entryId]
        );
        return Number(rows[0].count);
    }

    /**
     * Audit rows of one kind for one subject, polled — the dispatcher drains
     * after the commit, so asserting immediately would be a race, not a check.
     */
    async function auditFor(
        subjectId: string,
        kind: string
    ): Promise<{ actorId: string | null; meta: Record<string, unknown> }[]> {
        for (let attempt = 0; attempt < 40; attempt += 1) {
            const { rows } = await getPool().query(
                `SELECT actor_id AS "actorId", meta FROM activity_events
                 WHERE subject_id = $1 AND kind = $2`,
                [subjectId, kind]
            );
            if (rows.length) return rows;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return [];
    }

    /** How many audit rows of `kind` exist for `subjectId`, without waiting. */
    async function auditCount(
        subjectId: string,
        kind: string
    ): Promise<number> {
        const { rows } = await getPool().query<{ count: string }>(
            `SELECT count(*)::text AS count FROM activity_events
             WHERE subject_id = $1 AND kind = $2`,
            [subjectId, kind]
        );
        return Number(rows[0].count);
    }

    describe('with no rule', () => {
        /**
         * Invariant I-04. The plugin is registered in this harness, so this is
         * the real claim: registering it changes nothing until somebody writes
         * a rule, which is the state every existing installation is in.
         */
        it('publishes exactly as it did before the port existed [protection:I-04]', async () => {
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);

            await agent
                .post(`/api/content/test_article/${id}/publish`)
                .expect(201);

            expect(await statusOf(id)).toBe('published');
        });

        it('publishes when a rule exists but is switched off', async () => {
            await protect({ enabled: false, requiredApprovals: 2 });
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);

            await agent
                .post(`/api/content/test_article/${id}/publish`)
                .expect(201);

            expect(await statusOf(id)).toBe('published');
        });
    });

    describe('with a rule in force', () => {
        beforeEach(async () => {
            await protect({ enabled: true, requiredApprovals: 2 });
        });

        it('refuses with 409 and says what is missing', async () => {
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);

            const res = await agent
                .post(`/api/content/test_article/${id}/publish`)
                .expect(409);

            expect(res.body).toMatchObject({
                code: 'protection.insufficient_approvals',
                required: 2,
                given: 0,
                bypassable: false
            });
            expect(await statusOf(id)).toBe('draft');
        });

        it('publishes once the head has the approvals it asks for', async () => {
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);
            await approve(REVIEWER, id);
            await approve(SECOND_REVIEWER, id);

            await agent
                .post(`/api/content/test_article/${id}/publish`)
                .expect(201);

            expect(await statusOf(id)).toBe('published');
        });

        /**
         * The feature's whole claim, end to end: nothing about the approvals
         * changed, and a save moved the head out from under them.
         */
        it('refuses again after a save invalidates the approvals', async () => {
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);
            await approve(REVIEWER, id);
            await approve(SECOND_REVIEWER, id);

            await agent
                .patch(`/api/content/test_article/${id}`)
                .send({ values: { text: 'Second draft', select: 'article' } })
                .expect(200);

            const res = await agent
                .post(`/api/content/test_article/${id}/publish`)
                .expect(409);

            expect(res.body).toMatchObject({ given: 0, stale: 2 });
            expect(await statusOf(id)).toBe('draft');
        });

        /** Closing the ask is what keeps the reviewer's queue worth opening. */
        it('closes the open review request when the entry goes out', async () => {
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);
            const { rows } = await getPool().query<{ id: string }>(
                'SELECT id FROM users WHERE email = $1',
                [RULE_ADMIN]
            );
            await agent
                .post(`/api/protection/entries/test_article/${id}/request`)
                .send({ reviewerIds: [rows[0].id] })
                .expect(201);
            expect(await openRequests(id)).toBe(1);

            await approve(REVIEWER, id);
            await approve(SECOND_REVIEWER, id);
            await agent
                .post(`/api/content/test_article/${id}/publish`)
                .expect(201);

            for (let attempt = 0; attempt < 40; attempt += 1) {
                if ((await openRequests(id)) === 0) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            expect(await openRequests(id)).toBe(0);
        });
    });

    describe('the gate order', () => {
        /**
         * ⭐ The assertion this PR is most likely to regress, and the one that
         * separates "authorizes" from "validates". An administrator with a
         * bypass in hand still cannot publish an entry the publish gate refuses:
         * the 422 comes from the gate, and protection is never consulted — so
         * no `entry.publish_bypassed` row appears either.
         */
        it('answers 422 from the publish gate before protection is reached', async () => {
            await protect({ enabled: true, requiredApprovals: 2 });
            const { agent } = await member(ADMIN, 'admin');
            const id = await createEntry(agent);

            // Empty the required `text`, so the stored row no longer passes.
            await agent
                .patch(`/api/content/test_article/${id}`)
                .send({ values: { text: '' } })
                .expect(200);

            const res = await agent
                .post(`/api/content/test_article/${id}/publish`)
                .send({ bypass: true })
                .expect(422);

            expect(res.body.message).toBe('Entry validation failed');
            expect(await statusOf(id)).toBe('draft');
            // Protection never ran, so nothing was excused.
            expect(await auditCount(id, 'entry.publish_bypassed')).toBe(0);
        });
    });

    describe('the bypass', () => {
        beforeEach(async () => {
            await protect({ enabled: true, requiredApprovals: 2 });
        });

        it('publishes and writes exactly one row [protection:I-13]', async () => {
            const { user, agent } = await member(ADMIN, 'admin');
            const id = await createEntry(agent);

            await agent
                .post(`/api/content/test_article/${id}/publish`)
                .send({ bypass: true })
                .expect(201);

            expect(await statusOf(id)).toBe('published');

            const rows = await auditFor(id, 'entry.publish_bypassed');
            expect(rows).toHaveLength(1);
            expect(rows[0].actorId).toBe(user.id);
            expect(rows[0].meta).toMatchObject({ required: 2, given: 0 });
            expect(rows[0].meta).not.toHaveProperty('reason');
        });

        /** The reason field is gone; a client still sending one has to hear so. */
        it('rejects a bypass reason, and publishes and logs nothing', async () => {
            const { agent } = await member(ADMIN, 'admin');
            const id = await createEntry(agent);

            await agent
                .post(`/api/content/test_article/${id}/publish`)
                .send({ bypass: true, bypassReason: 'numbers corrected' })
                .expect(400);

            expect(await statusOf(id)).toBe('draft');
            expect(await auditCount(id, 'entry.publish_bypassed')).toBe(0);
        });

        /**
         * The `code` is the assertion, not the status. Three different guards
         * can answer 403 on this route — the permission guard, the origin
         * guard, and this one — so a bare `.expect(403)` passes for a
         * regression that never reached the publish guard at all, and passes
         * equally if the two bypass refusals below swap their branches.
         */
        it('is 403 for a contributor, who may publish but may not excuse one', async () => {
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);

            const res = await agent
                .post(`/api/content/test_article/${id}/publish`)
                .send({ bypass: true })
                .expect(403);

            expect(res.body).toMatchObject({
                code: 'protection.bypass_refused',
                message: expect.stringContaining('protection:manage')
            });
            expect(await statusOf(id)).toBe('draft');
        });

        it('is 403 when the rule allows no bypass at all', async () => {
            await protect({
                enabled: true,
                requiredApprovals: 2,
                adminBypass: false
            });
            const { agent } = await member(ADMIN, 'admin');
            const id = await createEntry(agent);

            const res = await agent
                .post(`/api/content/test_article/${id}/publish`)
                .send({ bypass: true })
                .expect(403);

            // The same code as above, the other message: this refusal is about
            // the rule, the one above is about the caller. A single assertion
            // on the status cannot tell them apart, and they are the two halves
            // of "refusable" that the rule's `admin_bypass` switch decides.
            expect(res.body).toMatchObject({
                code: 'protection.bypass_refused',
                message: expect.stringContaining('no bypass')
            });
            expect(await statusOf(id)).toBe('draft');
        });

        it('tells an administrator a bypass is available', async () => {
            const { agent } = await member(ADMIN, 'admin');
            const id = await createEntry(agent);

            const res = await agent
                .post(`/api/content/test_article/${id}/publish`)
                .expect(409);

            expect(res.body).toMatchObject({ bypassable: true });
        });
    });

    describe('a bearer token', () => {
        /** Mint a write-scoped token through the real management API. */
        async function mintToken(): Promise<string> {
            const { agent } = await member(RULE_ADMIN, 'admin');
            const res = await agent
                .post('/api/api-tokens')
                .send({
                    name: 'guard-token',
                    workspaceIds: [workspace.id],
                    scope: 'full'
                })
                .expect(201);
            return res.body.secret as string;
        }

        /**
         * The port's reach: nothing here wired the public API up to protection,
         * and it is guarded anyway, because both routes publish through the
         * same use-case.
         */
        it('is refused on a protected type, with its own code', async () => {
            await protect({ enabled: true, requiredApprovals: 1 });
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);
            const secret = await mintToken();

            const res = await request(harness.server)
                .post(`/api/v1/content/test_article/${id}/publish`)
                .set('Authorization', `Bearer ${secret}`)
                .set('X-Workspace-Id', workspace.id)
                .expect(409);

            expect(res.body).toMatchObject({
                code: 'protection.token_refused'
            });
            expect(await statusOf(id)).toBe('draft');
        });

        it('publishes once the rule opts tokens in and the approvals are there', async () => {
            await protect({
                enabled: true,
                requiredApprovals: 1,
                allowTokenPublish: true
            });
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);
            await approve(REVIEWER, id);
            const secret = await mintToken();

            await request(harness.server)
                .post(`/api/v1/content/test_article/${id}/publish`)
                .set('Authorization', `Bearer ${secret}`)
                .set('X-Workspace-Id', workspace.id)
                .expect(201);

            expect(await statusOf(id)).toBe('published');
        });

        /**
         * `allow_token_publish` lets a token *reach* the count; it does not
         * exempt it from one. Decided in the kernel (#255) and asserted here
         * because it is the reading a reviewer is most likely to want changed.
         */
        it('is still held to the approval count once opted in', async () => {
            await protect({
                enabled: true,
                requiredApprovals: 2,
                allowTokenPublish: true
            });
            const { agent } = await member(AUTHOR, 'contributor');
            const id = await createEntry(agent);
            await approve(REVIEWER, id);
            const secret = await mintToken();

            const res = await request(harness.server)
                .post(`/api/v1/content/test_article/${id}/publish`)
                .set('Authorization', `Bearer ${secret}`)
                .set('X-Workspace-Id', workspace.id)
                .expect(409);

            expect(res.body).toMatchObject({
                code: 'protection.insufficient_approvals',
                // No human, so no bypass to offer.
                bypassable: false
            });
        });
    });

    describe('a bulk publish', () => {
        /**
         * The per-record answer, which is also the per-**locale** answer: the
         * i18n menu's "publish all locales" sends the sibling ids as one bulk
         * publish, so a caller learns which translations are held up instead of
         * watching the whole action refuse with nothing to point at.
         */
        it('publishes what it may and reports the rest as refused', async () => {
            await protect({ enabled: true, requiredApprovals: 1 });
            const { agent } = await member(AUTHOR, 'contributor');
            const allowed = await createEntry(agent, 'Approved one');
            const refused = await createEntry(agent, 'Unapproved one');
            await approve(REVIEWER, allowed);

            const res = await agent
                .post('/api/content/test_article/bulk/publish')
                // The bulk route carries an explicit @HttpCode(200) — it is a
                // partial-success report, not a creation.
                .send({ ids: [allowed, refused] })
                .expect(200);

            expect(res.body.published).toEqual([allowed]);
            expect(res.body.skipped).toContainEqual({
                id: refused,
                reason: 'guard-refused'
            });
            expect(await statusOf(allowed)).toBe('published');
            expect(await statusOf(refused)).toBe('draft');
        });
    });
});
