import request from 'supertest';
import { ChangePasswordUseCase } from '@orthacms/identity-server';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    countUserSessions,
    getActivityRows,
    getUserByEmail,
    resetDb,
    seedActiveUser,
    type SeededUser
} from '../../support/seed';

const EMAIL = 'change-password@example.com';
const OTHER_EMAIL = 'change-password-other@example.com';
const PASSWORD = 'SecurePass123!';
const NEW_PASSWORD = 'AnEntirelyNewPassphrase!';

/**
 * `ChangePasswordUseCase` — credential rotation. It has **no HTTP route** yet
 * (self-service change / password reset land later), so this suite drives it
 * out of the app's DI container against the real database, which is the only
 * way to exercise it end to end.
 *
 * The behaviour under test is BUG-identity-server-05: a password change used to
 * rewrite the hash and stop there, leaving every session the *old* password had
 * opened signed in for its full seven-day TTL, and writing nothing at all to
 * the audit log.
 */
describe('Change password (ChangePasswordUseCase)', () => {
    let harness: TestApp;
    let user: SeededUser;
    let useCase: ChangePasswordUseCase;

    beforeAll(async () => {
        harness = await createTestApp();
        useCase = harness.app.get(ChangePasswordUseCase);
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        user = await seedActiveUser(harness.app, {
            email: EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
    });

    /** Logs in and returns the cookie-bearing agent (each login opens a session). */
    async function login(email = EMAIL, password = PASSWORD) {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password })
            .expect(201);
        return agent;
    }

    it('replaces the stored credential', async () => {
        const before = (await getUserByEmail(EMAIL))?.passwordHash;

        await useCase.execute(user.id, NEW_PASSWORD);

        const after = (await getUserByEmail(EMAIL))?.passwordHash;
        expect(after).not.toBe(before);
        expect(after).toMatch(/^\$2[aby]\$12\$/);

        await request(harness.server)
            .post('/api/auth/login')
            .send({ email: EMAIL, password: NEW_PASSWORD })
            .expect(201);
        await request(harness.server)
            .post('/api/auth/login')
            .send({ email: EMAIL, password: PASSWORD })
            .expect(401);
    });

    it('signs out every device the old password had signed in [identity:I-08]', async () => {
        const deviceA = await login();
        const deviceB = await login();
        await deviceA.get('/api/auth/me').expect(200);
        await deviceB.get('/api/auth/me').expect(200);

        const revoked = await useCase.execute(user.id, NEW_PASSWORD);

        expect(revoked).toBe(2);
        await deviceA.get('/api/auth/me').expect(401);
        await deviceB.get('/api/auth/me').expect(401);
        // Revocation is soft, so the rows survive for audit — they just stop
        // authenticating.
        expect(await countUserSessions(user.id)).toBe(2);
    });

    it('keeps the caller’s own session alive when one is named [identity:I-08]', async () => {
        const keeper = await login();
        const other = await login();

        // The row id is the SHA-256 of the token; read it back off the admin
        // session list rather than recomputing it here.
        const sessions = await keeper
            .get(`/api/users/${user.id}/sessions`)
            .expect(200);
        const mine = sessions.body.find(
            (row: { current: boolean }) => row.current
        );
        expect(mine).toBeDefined();

        const revoked = await useCase.execute(user.id, NEW_PASSWORD, {
            keepSessionId: mine.id
        });

        expect(revoked).toBe(1);
        await keeper.get('/api/auth/me').expect(200);
        await other.get('/api/auth/me').expect(401);
    });

    it('touches nobody else’s sessions', async () => {
        const other = await seedActiveUser(harness.app, {
            email: OTHER_EMAIL,
            password: PASSWORD,
            role: 'viewer'
        });
        const bystander = await login(OTHER_EMAIL);
        await login();

        const revoked = await useCase.execute(user.id, NEW_PASSWORD);

        expect(revoked).toBe(1);
        await bystander.get('/api/auth/me').expect(200);
        expect(await countUserSessions(other.id)).toBe(1);
    });

    it('writes a user.password_changed audit row naming the actor and the eviction count', async () => {
        await login();
        await login();

        await useCase.execute(user.id, NEW_PASSWORD);

        const rows = await getActivityRows();
        const changed = rows.filter(
            (row) => row.kind === 'user.password_changed'
        );
        expect(changed).toHaveLength(1);
        expect(changed[0]).toMatchObject({
            kind: 'user.password_changed',
            subjectType: 'user',
            subjectId: user.id,
            actorId: user.id,
            actorEmail: EMAIL,
            meta: { sessionsRevoked: 2 }
        });
    });

    it('audits a change that evicted nothing rather than staying silent', async () => {
        await useCase.execute(user.id, NEW_PASSWORD);

        const rows = await getActivityRows();
        const changed = rows.filter(
            (row) => row.kind === 'user.password_changed'
        );
        expect(changed).toHaveLength(1);
        expect(changed[0].meta).toMatchObject({ sessionsRevoked: 0 });
    });

    it('leaves the credential and the sessions alone when the account is unknown', async () => {
        const agent = await login();

        await expect(
            useCase.execute(
                '11111111-1111-4111-8111-111111111111',
                NEW_PASSWORD
            )
        ).rejects.toThrow();

        await agent.get('/api/auth/me').expect(200);
        const rows = await getActivityRows();
        expect(
            rows.filter((row) => row.kind === 'user.password_changed')
        ).toHaveLength(0);
    });

    it('refuses a password past bcrypt’s byte ceiling instead of truncating it', async () => {
        // No DTO guards this path, so the refusal has to come from the hashing
        // service — otherwise a 144-byte passphrase would be stored as its
        // first 72 bytes (BUG-identity-server-03).
        const before = (await getUserByEmail(EMAIL))?.passwordHash;

        await expect(useCase.execute(user.id, 'é'.repeat(72))).rejects.toThrow(
            /72 bytes/
        );

        expect((await getUserByEmail(EMAIL))?.passwordHash).toBe(before);
    });
});
