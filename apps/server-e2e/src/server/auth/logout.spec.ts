import request from 'supertest';
import type { Response } from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { resetDb, seedActiveUser } from '../../support/seed';
import { TEST_ALLOWED_ORIGIN } from '../../support/test-config';

const EMAIL = 'logout-test@example.com';
const PASSWORD = 'SecurePass123!';

/** Extract the `ortha_session=value` pair from a login response. */
function sessionCookie(res: Response): string {
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    const cookie = setCookie
        .find((c) => c.startsWith('ortha_session='))
        ?.split(';')[0];
    if (!cookie) {
        throw new Error('login did not set a session cookie');
    }
    return cookie;
}

/** Grab the raw Set-Cookie string for `ortha_session` (with attributes). */
function rawSetCookie(res: Response): string | undefined {
    const setCookie = res.headers['set-cookie'] as unknown as
        | string[]
        | undefined;
    return setCookie?.find((c) => c.startsWith('ortha_session='));
}

/** `POST /api/auth/logout` — revokes the current session and clears the cookie. */
describe('POST /api/auth/logout', () => {
    let harness: TestApp;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        await seedActiveUser(harness.app, {
            email: EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
    });

    /** Log in and return the raw session cookie pair. */
    async function login(): Promise<string> {
        const res = await request(harness.server)
            .post('/api/auth/login')
            .send({ email: EMAIL, password: PASSWORD })
            .expect(201);
        return sessionCookie(res);
    }

    const logout = () => request(harness.server).post('/api/auth/logout');
    const me = () => request(harness.server).get('/api/auth/me');

    it('returns 201 { ok: true } and clears the cookie', async () => {
        const cookie = await login();
        const res = await logout().set('Cookie', cookie).expect(201);

        expect(res.body).toEqual({ ok: true });
        const cleared = rawSetCookie(res);
        expect(cleared).toBeDefined();
        // Emptied value + a past expiry is how the browser is told to drop it.
        expect(cleared).toMatch(/^ortha_session=;/);
        expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);
    });

    it('revokes the session so the cookie no longer authenticates', async () => {
        const cookie = await login();
        await me().set('Cookie', cookie).expect(200); // valid before
        await logout().set('Cookie', cookie).expect(201);
        await me().set('Cookie', cookie).expect(401); // dead after
    });

    it('is idempotent with no session cookie', async () => {
        const res = await logout().expect(201);
        expect(res.body).toEqual({ ok: true });
        expect(rawSetCookie(res)).toBeDefined();
    });

    it('is idempotent with a bogus session cookie [identity:I-07]', async () => {
        const res = await logout()
            .set('Cookie', 'ortha_session=not-a-real-token')
            .expect(201);
        expect(res.body).toEqual({ ok: true });
    });

    it('can be called twice with the same cookie (second is a no-op)', async () => {
        const cookie = await login();
        await logout().set('Cookie', cookie).expect(201);
        await logout().set('Cookie', cookie).expect(201);
    });

    it('revokes only the presented session, not the user’s others [identity:I-07]', async () => {
        const cookieA = await login();
        const cookieB = await login();

        await logout().set('Cookie', cookieA).expect(201);

        await me().set('Cookie', cookieA).expect(401); // logged-out device
        await me().set('Cookie', cookieB).expect(200); // other device still in
    });

    describe('OriginGuard (CSRF defense)', () => {
        it('rejects a disallowed Origin with 403 and keeps the session alive', async () => {
            const cookie = await login();
            await logout()
                .set('Cookie', cookie)
                .set('Origin', 'http://evil.example')
                .expect(403);
            // The guard ran before the handler, so nothing was revoked.
            await me().set('Cookie', cookie).expect(200);
        });

        it('allows the configured Origin', async () => {
            const cookie = await login();
            await logout()
                .set('Cookie', cookie)
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .expect(201);
        });
    });
});
