import request from 'supertest';
import { closeTestApp, createTestApp, type TestApp } from '../support/test-app';
import { resetDb, seedActiveUser } from '../support/seed';

const EMAIL = 'parity@example.com';
const PASSWORD = 'SecurePass123!';

/**
 * The places `createTestApp` used to diverge from `createServer`.
 *
 * The harness's whole claim is that it boots the real app, so every silent
 * omission is a hole in a claim the rest of the suite rests on. Two of them
 * mattered, and both are about something being *reachable in production and
 * unreachable here* — the direction in which a test suite cannot help you.
 */
describe('production parity', () => {
    describe('the API reference rides the docs flag (setupApiDocs)', () => {
        // `createTestApp` used to skip `setupApiDocs` entirely, which made the
        // security-relevant half of the flag — "off unless the operator asks" —
        // assertable nowhere. Two apps, one flag, both directions.
        // Both routes are registered on the http adapter, so they sit OUTSIDE
        // the global `api` prefix — `/reference`, not `/api/reference`.
        it('is not mounted with docs disabled (the production default) [bootstrap:I-10]', async () => {
            const harness = await createTestApp();
            try {
                await request(harness.server).get('/reference').expect(404);
                await request(harness.server)
                    .get('/reference/json')
                    .expect(404);
            } finally {
                await closeTestApp(harness);
            }
        });

        it('is mounted, and describes the prefixed routes, with docs enabled [bootstrap:I-07]', async () => {
            const harness = await createTestApp({ docsEnabled: true });
            try {
                // covers: bootstrap:I-08
                await request(harness.server).get('/reference').expect(200);
                const doc = await request(harness.server)
                    .get('/reference/json')
                    .expect(200);
                // The document must describe the real URLs — the prefix is
                // applied before `setupApiDocs` runs, exactly as in
                // `createServer`, and getting that order wrong yields a
                // reference that documents paths nothing serves.
                expect(Object.keys(doc.body.paths)).toContain(
                    '/api/auth/login'
                );
            } finally {
                await closeTestApp(harness);
            }
        });

        it('sits outside every guard, as an unauthenticated request proves [bootstrap:I-08]', async () => {
            // The reference is mounted on the adapter, not the Nest router, so
            // no `AuthGuard` sees it. That is deliberate and worth pinning: it
            // is also why `docs.enabled` is the *only* thing standing between a
            // production deployment and a public API map.
            const harness = await createTestApp({ docsEnabled: true });
            try {
                await request(harness.server)
                    .get('/reference/json')
                    .expect(200);
                await request(harness.server).get('/api/auth/me').expect(401);
            } finally {
                await closeTestApp(harness);
            }
        });
    });

    describe('session cookie attributes follow the configured shape', () => {
        // The one assertion on cookie attributes pins the *test* value
        // (`not Secure`), because the deployed shape was unreachable:
        // `TestConfigOverrides` had no `session` key and the config hard-coded
        // `cookieSecure: false`. A production misconfiguration therefore could
        // not fail a test.
        async function loginSetCookie(harness: TestApp): Promise<string> {
            await resetDb();
            await seedActiveUser(harness.app, {
                email: EMAIL,
                password: PASSWORD,
                role: 'viewer'
            });
            const res = await request(harness.server)
                .post('/api/auth/login')
                .send({ email: EMAIL, password: PASSWORD })
                .expect(201);
            const header = res.headers['set-cookie'] as unknown as string[];
            return (
                header.find((value) => value.startsWith('apograph_session=')) ??
                ''
            );
        }

        it('emits Secure + SameSite=None when the deployment configures them', async () => {
            const harness = await createTestApp({
                session: { cookieSecure: true, cookieSameSite: 'none' }
            });
            try {
                const cookie = await loginSetCookie(harness);
                expect(cookie).toMatch(/;\s*Secure/i);
                expect(cookie).toMatch(/SameSite=None/i);
                // Still non-negotiable regardless of the rest.
                expect(cookie).toMatch(/HttpOnly/i);
            } finally {
                await closeTestApp(harness);
            }
        });

        it('emits neither when the deployment does not (the test default)', async () => {
            const harness = await createTestApp();
            try {
                const cookie = await loginSetCookie(harness);
                expect(cookie).not.toMatch(/;\s*Secure/i);
                expect(cookie).toMatch(/SameSite=Lax/i);
            } finally {
                await closeTestApp(harness);
            }
        });
    });
});
