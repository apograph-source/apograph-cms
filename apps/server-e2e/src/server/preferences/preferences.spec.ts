import request from 'supertest';
import type { Response } from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { resetDb, seedActiveUser } from '../../support/seed';
import { TEST_ALLOWED_ORIGIN } from '../../support/test-config';

const EMAIL = 'preferences-test@example.com';
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

/**
 * `GET`/`PUT /api/preferences` — the current user's own appearance preferences
 * (the theme behind the account Preferences tab). Self-service: every request
 * reads/writes the caller's own row, keyed off the session, so there is no RBAC
 * to exercise here — only auth, validation, the origin guard, and the upsert.
 */
describe('/api/preferences', () => {
    let harness: TestApp;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        // A signed-in caller — the endpoint keys off the session, not a passed
        // id, so we only need valid credentials, not the returned row.
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

    describe('GET (read)', () => {
        it('defaults to the system theme before anything is saved', async () => {
            const res = await request(harness.server)
                .get('/api/preferences')
                .set('Cookie', await login())
                .expect(200);
            expect(res.body).toEqual({ theme: 'system' });
        });

        it('returns only the theme (no userId/timestamps leak)', async () => {
            const res = await request(harness.server)
                .get('/api/preferences')
                .set('Cookie', await login())
                .expect(200);
            expect(Object.keys(res.body)).toEqual(['theme']);
        });

        it('rejects an unauthenticated read with 401', async () => {
            await request(harness.server).get('/api/preferences').expect(401);
        });
    });

    describe('PUT (upsert)', () => {
        it('creates the row on first save and returns the new theme', async () => {
            const agent = request.agent(harness.server);
            await agent
                .post('/api/auth/login')
                .send({ email: EMAIL, password: PASSWORD })
                .expect(201);

            const put = await agent
                .put('/api/preferences')
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({ theme: 'dark' })
                .expect(200);
            expect(put.body).toEqual({ theme: 'dark' });

            // The change is durable — a fresh read reflects it.
            const get = await agent.get('/api/preferences').expect(200);
            expect(get.body).toEqual({ theme: 'dark' });
        });

        it('updates the existing row on a second save (no duplicate)', async () => {
            const agent = request.agent(harness.server);
            await agent
                .post('/api/auth/login')
                .send({ email: EMAIL, password: PASSWORD })
                .expect(201);
            const save = (theme: string) =>
                agent
                    .put('/api/preferences')
                    .set('Origin', TEST_ALLOWED_ORIGIN)
                    .send({ theme })
                    .expect(200);

            await save('dark');
            const second = await save('light');
            expect(second.body).toEqual({ theme: 'light' });

            const get = await agent.get('/api/preferences').expect(200);
            expect(get.body).toEqual({ theme: 'light' });
        });

        it('accepts each valid theme', async () => {
            const cookie = await login();
            for (const theme of ['light', 'dark', 'system'] as const) {
                const res = await request(harness.server)
                    .put('/api/preferences')
                    .set('Cookie', cookie)
                    .set('Origin', TEST_ALLOWED_ORIGIN)
                    .send({ theme })
                    .expect(200);
                expect(res.body).toEqual({ theme });
            }
        });

        it('rejects an unauthenticated write with 401', async () => {
            await request(harness.server)
                .put('/api/preferences')
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({ theme: 'dark' })
                .expect(401);
        });

        describe('validation (400)', () => {
            it('rejects a theme outside the enum', async () => {
                await request(harness.server)
                    .put('/api/preferences')
                    .set('Cookie', await login())
                    .set('Origin', TEST_ALLOWED_ORIGIN)
                    .send({ theme: 'neon' })
                    .expect(400);
            });

            it('rejects a missing theme', async () => {
                await request(harness.server)
                    .put('/api/preferences')
                    .set('Cookie', await login())
                    .set('Origin', TEST_ALLOWED_ORIGIN)
                    .send({})
                    .expect(400);
            });

            it('rejects a non-string theme', async () => {
                await request(harness.server)
                    .put('/api/preferences')
                    .set('Cookie', await login())
                    .set('Origin', TEST_ALLOWED_ORIGIN)
                    .send({ theme: 3 })
                    .expect(400);
            });

            it('rejects an unknown extra field (forbidNonWhitelisted)', async () => {
                await request(harness.server)
                    .put('/api/preferences')
                    .set('Cookie', await login())
                    .set('Origin', TEST_ALLOWED_ORIGIN)
                    .send({ theme: 'dark', density: 'compact' })
                    .expect(400);
            });
        });

        describe('OriginGuard (CSRF defense)', () => {
            it('rejects a disallowed Origin with 403', async () => {
                await request(harness.server)
                    .put('/api/preferences')
                    .set('Cookie', await login())
                    .set('Origin', 'http://evil.example')
                    .send({ theme: 'dark' })
                    .expect(403);
            });

            it('allows the configured Origin', async () => {
                await request(harness.server)
                    .put('/api/preferences')
                    .set('Cookie', await login())
                    .set('Origin', TEST_ALLOWED_ORIGIN)
                    .send({ theme: 'dark' })
                    .expect(200);
            });

            it('allows a request with no Origin header', async () => {
                await request(harness.server)
                    .put('/api/preferences')
                    .set('Cookie', await login())
                    .send({ theme: 'dark' })
                    .expect(200);
            });
        });
    });
});
