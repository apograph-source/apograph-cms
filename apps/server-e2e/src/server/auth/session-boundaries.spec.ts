import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    backdateSessionLastUsed,
    expireUserSessionsAt,
    getUserByEmail,
    getUserSessions,
    resetDb,
    seedActiveUser,
    sessionRowsContainToken,
    type SeededUser
} from '../../support/seed';

const EMAIL = 'session-bounds@example.com';
const PASSWORD = 'SecurePass123!';

/** The `ortha_session=<token>` pair from a login response. */
function sessionCookie(res: request.Response): string {
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    const cookie = setCookie
        .find((c) => c.startsWith('ortha_session='))
        ?.split(';')[0];
    if (!cookie) {
        throw new Error('login did not set a session cookie');
    }
    return cookie;
}

/**
 * The exact boundaries of a session's lifetime — the conditions the artifact
 * called out as correct-by-construction but unasserted, so a later refactor
 * cannot quietly move them.
 */
describe('Session lifetime boundaries', () => {
    let harness: TestApp;
    let user: SeededUser;

    beforeAll(async () => {
        harness = await createTestApp();
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

    /** Logs in and returns the raw cookie pair. */
    async function login(): Promise<string> {
        const res = await request(harness.server)
            .post('/api/auth/login')
            .send({ email: EMAIL, password: PASSWORD })
            .expect(201);
        return sessionCookie(res);
    }

    describe('lastUsedAt refresh throttle', () => {
        it('does not write on every authenticated request', async () => {
            const cookie = await login();
            const [before] = await getUserSessions(user.id);

            for (let i = 0; i < 5; i++) {
                await request(harness.server)
                    .get('/api/auth/me')
                    .set('Cookie', cookie)
                    .expect(200);
            }

            const [after] = await getUserSessions(user.id);
            expect(after.lastUsedAt.getTime()).toBe(
                before.lastUsedAt.getTime()
            );
        });

        it('writes once the throttle window has elapsed, then throttles again', async () => {
            const cookie = await login();
            // Back-date rather than sleeping out the real 60s window.
            await backdateSessionLastUsed(user.id, 61_000);
            const [stale] = await getUserSessions(user.id);

            await request(harness.server)
                .get('/api/auth/me')
                .set('Cookie', cookie)
                .expect(200);

            const [refreshed] = await getUserSessions(user.id);
            expect(refreshed.lastUsedAt.getTime()).toBeGreaterThan(
                stale.lastUsedAt.getTime()
            );

            // And the window closes again behind it — the next hits are reads.
            await request(harness.server)
                .get('/api/auth/me')
                .set('Cookie', cookie)
                .expect(200);
            const [again] = await getUserSessions(user.id);
            expect(again.lastUsedAt.getTime()).toBe(
                refreshed.lastUsedAt.getTime()
            );
        });
    });

    describe('expiry instant', () => {
        it('rejects a session at exactly its expiry, not just past it', async () => {
            // The predicate is a strict `expires_at > now()`, so the instant of
            // expiry is already invalid. Asserting it pins the inequality: a
            // `>=` would hand out a session that has run out.
            const cookie = await login();
            await request(harness.server)
                .get('/api/auth/me')
                .set('Cookie', cookie)
                .expect(200);

            await expireUserSessionsAt(user.id, new Date());

            await request(harness.server)
                .get('/api/auth/me')
                .set('Cookie', cookie)
                .expect(401);
        });

        it('keeps a session valid a moment before its expiry', async () => {
            const cookie = await login();
            await expireUserSessionsAt(user.id, new Date(Date.now() + 5_000));

            await request(harness.server)
                .get('/api/auth/me')
                .set('Cookie', cookie)
                .expect(200);
        });
    });

    describe('secrets at rest', () => {
        it('stores the session token’s digest, never the token [identity:I-09]', async () => {
            const cookie = await login();
            const token = cookie.split('=')[1];

            expect(await sessionRowsContainToken(token)).toBe(false);
            const [row] = await getUserSessions(user.id);
            expect(row.id).toMatch(/^[0-9a-f]{64}$/);
            expect(row.id).not.toBe(token);
        });

        it('stores a password as bcrypt at cost 12 [identity:I-09]', async () => {
            // The cost is a security parameter; lowering it is a silent
            // downgrade that no functional test would notice.
            expect((await getUserByEmail(EMAIL))?.passwordHash).toMatch(
                /^\$2[aby]\$12\$/
            );
        });
    });

    describe('Cookie header parsing', () => {
        it('finds the session among two hundred other cookies', async () => {
            // The lookup is a linear scan; this is the guard against a
            // pathological header turning into a pathological parse.
            const cookie = await login();
            const noise = Array.from(
                { length: 200 },
                (_, i) => `pad${i}=value${i}`
            ).join('; ');

            await request(harness.server)
                .get('/api/auth/me')
                .set('Cookie', `${noise}; ${cookie}`)
                .expect(200);
        });

        it('401s on a malformed header rather than failing', async () => {
            await request(harness.server)
                .get('/api/auth/me')
                .set('Cookie', 'garbage-with-no-equals')
                .expect(401);
        });

        it('401s on an empty session value', async () => {
            await request(harness.server)
                .get('/api/auth/me')
                .set('Cookie', 'ortha_session=')
                .expect(401);
        });

        it('401s when the token arrives under a different cookie name', async () => {
            const token = (await login()).split('=')[1];
            await request(harness.server)
                .get('/api/auth/me')
                .set('Cookie', `other_session=${token}`)
                .expect(401);
        });
    });
});
