import request from 'supertest';
import type { Response } from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    countUserSessions,
    resetDb,
    seedActiveUser,
    seedUser,
    type SeededUser
} from '../../support/seed';
import { TEST_ALLOWED_ORIGIN } from '../../support/test-config';

const EMAIL = 'login-test@example.com';
const PASSWORD = 'SecurePass123!';

/** Pull the `orthacms_session` cookie (name=value, no attributes) from a response. */
function sessionCookie(res: Response): string | undefined {
    const setCookie = res.headers['set-cookie'] as unknown as
        | string[]
        | undefined;
    return setCookie
        ?.find((c) => c.startsWith('orthacms_session='))
        ?.split(';')[0];
}

/**
 * `POST /api/auth/login`. Success is 201 (Nest's `@Post` default; the
 * controller sets no `@HttpCode`). The e2e app runs with a relaxed rate limit,
 * so this suite can be exhaustive without self-throttling — the 429 path is
 * covered separately in `auth-login-throttle.spec.ts`.
 */
describe('POST /api/auth/login', () => {
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

    const post = () => request(harness.server).post('/api/auth/login');

    describe('valid credentials', () => {
        it('returns 201 with { ok: true }', async () => {
            const res = await post()
                .send({ email: EMAIL, password: PASSWORD })
                .expect(201);
            expect(res.body).toEqual({ ok: true });
        });

        it('sets an httpOnly session cookie', async () => {
            const res = await post()
                .send({ email: EMAIL, password: PASSWORD })
                .expect(201);
            const cookie = sessionCookie(res);
            expect(cookie).toBeDefined();
            expect(cookie).toMatch(/^orthacms_session=.+/);
        });

        it('cookie carries the configured attributes (HttpOnly, Lax, Path, Max-Age, not Secure)', async () => {
            const res = await post()
                .send({ email: EMAIL, password: PASSWORD })
                .expect(201);
            const setCookie = res.headers['set-cookie'] as unknown as string[];
            const raw = setCookie.find((c) =>
                c.startsWith('orthacms_session=')
            );
            expect(raw).toBeDefined();
            expect(raw).toMatch(/HttpOnly/i);
            expect(raw).toMatch(/SameSite=Lax/i);
            expect(raw).toMatch(/Path=\//i);
            expect(raw).toMatch(/Max-Age=604800/);
            // cookieSecure is false in the test config (plain HTTP).
            expect(raw).not.toMatch(/Secure/i);
        });

        it('persists exactly one session row', async () => {
            await post().send({ email: EMAIL, password: PASSWORD }).expect(201);
            expect(await countUserSessions(user.id)).toBe(1);
        });

        it('opens a distinct session on each login', async () => {
            await post().send({ email: EMAIL, password: PASSWORD }).expect(201);
            await post().send({ email: EMAIL, password: PASSWORD }).expect(201);
            expect(await countUserSessions(user.id)).toBe(2);
        });

        it('matches the email case-insensitively', async () => {
            await post()
                .send({ email: EMAIL.toUpperCase(), password: PASSWORD })
                .expect(201);
        });
    });

    describe('rejected credentials (generic 401, no cookie)', () => {
        const expect401 = (res: Response) => {
            expect(res.status).toBe(401);
            expect(res.body.message).toBe('Invalid credentials');
            expect(res.headers['set-cookie']).toBeUndefined();
        };

        it('rejects an unknown email [identity:I-03]', async () => {
            expect401(
                await post().send({
                    email: 'nobody@example.com',
                    password: PASSWORD
                })
            );
        });

        it('rejects a wrong password', async () => {
            expect401(
                await post().send({ email: EMAIL, password: 'wrong-password!' })
            );
        });

        it('rejects a pending (not-yet-active) user [identity:I-02]', async () => {
            await seedUser(harness.app, {
                email: 'pending@example.com',
                password: PASSWORD,
                role: 'viewer',
                status: 'pending'
            });
            expect401(
                await post().send({
                    email: 'pending@example.com',
                    password: PASSWORD
                })
            );
        });

        it('rejects a disabled user', async () => {
            await seedUser(harness.app, {
                email: 'disabled@example.com',
                password: PASSWORD,
                role: 'viewer',
                status: 'disabled'
            });
            expect401(
                await post().send({
                    email: 'disabled@example.com',
                    password: PASSWORD
                })
            );
        });

        it('rejects a user with no password set (invite pending)', async () => {
            await seedUser(harness.app, {
                email: 'invited@example.com',
                role: 'viewer',
                status: 'active' // active but null hash
            });
            expect401(
                await post().send({
                    email: 'invited@example.com',
                    password: PASSWORD
                })
            );
        });

        it('creates no session for a failed login', async () => {
            await post()
                .send({ email: EMAIL, password: 'wrong-password!' })
                .expect(401);
            expect(await countUserSessions(user.id)).toBe(0);
        });
    });

    describe('request validation (400)', () => {
        it('rejects a missing email', async () => {
            const res = await post().send({ password: PASSWORD }).expect(400);
            expect(res.body.message).toEqual(
                expect.arrayContaining([expect.stringContaining('email')])
            );
        });

        it('rejects a missing password', async () => {
            const res = await post().send({ email: EMAIL }).expect(400);
            expect(res.body.message).toEqual(
                expect.arrayContaining([expect.stringContaining('password')])
            );
        });

        it('rejects an empty body', async () => {
            await post().send({}).expect(400);
        });

        it('rejects a malformed email', async () => {
            await post()
                .send({ email: 'not-an-email', password: PASSWORD })
                .expect(400);
        });

        it('rejects an empty password string', async () => {
            await post().send({ email: EMAIL, password: '' }).expect(400);
        });

        it('rejects a non-string password', async () => {
            await post().send({ email: EMAIL, password: 12345 }).expect(400);
        });

        it('rejects a non-string email', async () => {
            await post().send({ email: 42, password: PASSWORD }).expect(400);
        });

        it('rejects a null email', async () => {
            await post().send({ email: null, password: PASSWORD }).expect(400);
        });

        it('rejects an unknown extra field (forbidNonWhitelisted)', async () => {
            const res = await post()
                .send({ email: EMAIL, password: PASSWORD, role: 'admin' })
                .expect(400);
            expect(res.body.message).toEqual(
                expect.arrayContaining([expect.stringContaining('role')])
            );
        });

        it('rejects an email with leading or trailing whitespace', async () => {
            await post()
                .send({ email: ` ${EMAIL}`, password: PASSWORD })
                .expect(400);
            await post()
                .send({ email: `${EMAIL} `, password: PASSWORD })
                .expect(400);
        });

        it('rejects an oversized body with 413 rather than parsing it', async () => {
            // Express caps JSON at 100 kb. The point is that a 10 MB body is
            // refused at the transport, so an unauthenticated caller cannot
            // make the server allocate it — the login route is public.
            await post()
                .send({ email: EMAIL, password: 'x'.repeat(10 * 1024 * 1024) })
                .expect(413);
        });

        it('treats SQL metacharacters in the email as data, not syntax', async () => {
            // Every query is a parameterised Drizzle builder, so this can only
            // ever be a failed lookup. The assertion is a regression guard: a
            // 500 here would mean someone had started concatenating SQL.
            for (const email of [
                "a' OR '1'='1@example.com",
                'a";DROP TABLE users;--@example.com',
                '%_@example.com'
            ]) {
                const res = await post().send({ email, password: PASSWORD });
                expect([400, 401]).toContain(res.status);
            }

            // And the table is still there.
            await post().send({ email: EMAIL, password: PASSWORD }).expect(201);
        });
    });

    describe('OriginGuard (login CSRF defense)', () => {
        it('rejects a disallowed Origin with 403', async () => {
            await post()
                .set('Origin', 'http://evil.example')
                .send({ email: EMAIL, password: PASSWORD })
                .expect(403);
        });

        it('allows the configured Origin', async () => {
            await post()
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({ email: EMAIL, password: PASSWORD })
                .expect(201);
        });

        it('allows a request with no Origin header', async () => {
            await post().send({ email: EMAIL, password: PASSWORD }).expect(201);
        });

        it('runs before body validation (bad Origin + bad body → 403)', async () => {
            await post()
                .set('Origin', 'http://evil.example')
                .send({})
                .expect(403);
        });
    });
});
