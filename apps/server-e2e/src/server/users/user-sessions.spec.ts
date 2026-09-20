import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    countUserSessions,
    resetDb,
    seedActiveUser,
    type SeededUser
} from '../../support/seed';

const ADMIN_EMAIL = 'sessions-admin@example.com';
const TARGET_EMAIL = 'sessions-target@example.com';
const PASSWORD = 'SecurePass123!';

/** `GET/DELETE /api/users/:id/sessions` — admin session management. */
describe('User sessions (admin)', () => {
    let harness: TestApp;
    let admin: SeededUser;
    let target: SeededUser;

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
        target = await seedActiveUser(harness.app, {
            email: TARGET_EMAIL,
            password: PASSWORD,
            role: 'viewer'
        });
    });

    /** Logs in and returns the cookie-bearing agent (each login opens a session). */
    async function login(email: string) {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password: PASSWORD })
            .expect(201);
        return agent;
    }

    it('rejects unauthenticated access with 401', async () => {
        await request(harness.server)
            .get(`/api/users/${target.id}/sessions`)
            .expect(401);
    });

    it('lists a member’s live sessions [identity:I-17]', async () => {
        await login(TARGET_EMAIL); // opens one session for the target
        const adminAgent = await login(ADMIN_EMAIL);

        const res = await adminAgent
            .get(`/api/users/${target.id}/sessions`)
            .expect(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0]).toMatchObject({ current: false });
        expect(res.body[0].id).toEqual(expect.any(String));
    });

    it('marks the caller’s own session as current [identity:I-17]', async () => {
        const adminAgent = await login(ADMIN_EMAIL);
        const res = await adminAgent
            .get(`/api/users/${admin.id}/sessions`)
            .expect(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].current).toBe(true);
    });

    it('revokes a session and drops it from the list', async () => {
        await login(TARGET_EMAIL);
        const adminAgent = await login(ADMIN_EMAIL);

        const list = await adminAgent
            .get(`/api/users/${target.id}/sessions`)
            .expect(200);
        const sessionId = list.body[0].id as string;

        await adminAgent
            .delete(`/api/users/${target.id}/sessions/${sessionId}`)
            .expect(204);

        const after = await adminAgent
            .get(`/api/users/${target.id}/sessions`)
            .expect(200);
        expect(after.body).toHaveLength(0);
        // Revocation is soft (sets `revokedAt`), so the row is kept for audit —
        // it just drops out of the live listing above.
        expect(await countUserSessions(target.id)).toBe(1);
    });

    it('is idempotent — revoking an unknown session still 204s', async () => {
        const adminAgent = await login(ADMIN_EMAIL);
        await adminAgent
            .delete(`/api/users/${target.id}/sessions/does-not-exist`)
            .expect(204);
    });

    it('403s a viewer on both routes — a session list is not `users:read` data', async () => {
        // BUG-identity-server-04. A session row carries the member's IP address
        // and User-Agent, so listing one used to hand every signed-in account
        // (viewer included, since every role holds `users:read`) a colleague's
        // whereabouts. Both routes now take `users:update`.
        await login(TARGET_EMAIL);
        const adminAgent = await login(ADMIN_EMAIL);
        const list = await adminAgent
            .get(`/api/users/${target.id}/sessions`)
            .expect(200);
        const sessionId = list.body[0].id as string;

        const viewerAgent = await login(TARGET_EMAIL); // viewer role
        await viewerAgent.get(`/api/users/${target.id}/sessions`).expect(403);
        await viewerAgent
            .delete(`/api/users/${target.id}/sessions/${sessionId}`)
            .expect(403);
    });

    it('403s a viewer reading even their OWN session list [identity:I-16]', async () => {
        // There is no self-service exception: nothing exposes "my sessions"
        // today, and a route that did would be scoped by the cookie rather than
        // by a path id anyone can substitute.
        const viewerAgent = await login(TARGET_EMAIL);
        await viewerAgent.get(`/api/users/${target.id}/sessions`).expect(403);
    });

    it('403s a contributor — the gate is the permission, not the role', async () => {
        const contributor = await seedActiveUser(harness.app, {
            email: 'sessions-contributor@example.com',
            password: PASSWORD,
            role: 'contributor'
        });
        const agent = await login(contributor.email);
        await agent.get(`/api/users/${target.id}/sessions`).expect(403);
    });

    it('never exposes a session token beyond the revocation handle', async () => {
        // Log in raw so the cookie value is readable, then compare it against
        // what the list hands a reader.
        const res = await request(harness.server)
            .post('/api/auth/login')
            .send({ email: TARGET_EMAIL, password: PASSWORD })
            .expect(201);
        const token = /ortha_session=([^;]+)/.exec(
            res.get('Set-Cookie')?.[0] ?? ''
        )?.[1];
        expect(token).toBeTruthy();

        const adminAgent = await login(ADMIN_EMAIL);
        const list = await adminAgent
            .get(`/api/users/${target.id}/sessions`)
            .expect(200);

        expect(Object.keys(list.body[0]).sort()).toEqual([
            'createdAt',
            'current',
            'expiresAt',
            'id',
            'ipAddress',
            'lastUsedAt',
            'userAgent'
        ]);
        // The `id` is the SHA-256 of the token, so it is a revocation handle
        // rather than a credential a reader of this list could replay.
        expect(list.body[0].id).toMatch(/^[0-9a-f]{64}$/);
        expect(list.body[0].id).not.toBe(token);
    });

    it('returns 400 for a non-uuid user id', async () => {
        const adminAgent = await login(ADMIN_EMAIL);
        await adminAgent.get('/api/users/not-a-uuid/sessions').expect(400);
    });

    it('returns an empty list for a member with no live sessions', async () => {
        // The target never logged in. `200 []`, not `404` — the endpoint has
        // nothing to say about whether the member has been active.
        const adminAgent = await login(ADMIN_EMAIL);
        const res = await adminAgent
            .get(`/api/users/${target.id}/sessions`)
            .expect(200);
        expect(res.body).toEqual([]);
    });

    it('returns an empty list for a user id that does not exist', async () => {
        // Deliberately indistinguishable from "exists but is idle" above: this
        // route is not an account-existence oracle.
        const adminAgent = await login(ADMIN_EMAIL);
        const res = await adminAgent
            .get('/api/users/11111111-1111-4111-8111-111111111111/sessions')
            .expect(200);
        expect(res.body).toEqual([]);
    });

    it('scopes a revoke to :id — a session belonging to someone else survives', async () => {
        // `revokeById` filters on `user_id`, so a mismatched (user, session)
        // pair is a silent no-op. It still 204s (the route is idempotent and
        // leaks nothing), but the other member's session must stay live.
        await login(TARGET_EMAIL);
        const adminAgent = await login(ADMIN_EMAIL);

        const targetSessions = await adminAgent
            .get(`/api/users/${target.id}/sessions`)
            .expect(200);
        const targetSessionId = targetSessions.body[0].id as string;

        // Ask to revoke the target's session while naming the ADMIN as owner.
        await adminAgent
            .delete(`/api/users/${admin.id}/sessions/${targetSessionId}`)
            .expect(204);

        const after = await adminAgent
            .get(`/api/users/${target.id}/sessions`)
            .expect(200);
        expect(after.body).toHaveLength(1);
        expect(after.body[0].id).toBe(targetSessionId);
    });

    it('is idempotent — revoking the same session twice still 204s', async () => {
        await login(TARGET_EMAIL);
        const adminAgent = await login(ADMIN_EMAIL);
        const list = await adminAgent
            .get(`/api/users/${target.id}/sessions`)
            .expect(200);
        const sessionId = list.body[0].id as string;

        await adminAgent
            .delete(`/api/users/${target.id}/sessions/${sessionId}`)
            .expect(204);
        await adminAgent
            .delete(`/api/users/${target.id}/sessions/${sessionId}`)
            .expect(204);
    });

    it('takes effect on the member’s very next request, with no cache TTL', async () => {
        const targetAgent = await login(TARGET_EMAIL);
        await targetAgent.get('/api/auth/me').expect(200);

        const adminAgent = await login(ADMIN_EMAIL);
        const list = await adminAgent
            .get(`/api/users/${target.id}/sessions`)
            .expect(200);
        await adminAgent
            .delete(`/api/users/${target.id}/sessions/${list.body[0].id}`)
            .expect(204);

        await targetAgent.get('/api/auth/me').expect(401);
    });
});
