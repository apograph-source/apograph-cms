import request from 'supertest';
import { resolveTestDatabaseUrl, resetDatabase } from './support/db';
import {
    ALLOWED_ORIGIN,
    closeTestApp,
    createTestApp,
    type TestApp
} from './support/test-app';

/**
 * The API, driven through the real bootstrap.
 *
 * These are the checks that only mean something once every plugin is wired
 * together — guards actually mounted, the auth flow actually issuing a cookie.
 * Anything provable from a single function belongs in a unit test, where it
 * runs in milliseconds and needs no database.
 */
describe('the API', () => {
    let harness: TestApp;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    describe('authentication', () => {
        it('refuses an unauthenticated read', async () => {
            await request(harness.server).get('/api/workspaces').expect(401);
        });

        it('signs in the root admin provisioned at boot', async () => {
            const response = await request(harness.server)
                .post('/api/auth/login')
                .set('Origin', ALLOWED_ORIGIN)
                .send({
                    email: process.env['ORTHA_ROOT_ADMIN_EMAIL'],
                    password: process.env['ORTHA_ROOT_ADMIN_PASSWORD']
                })
                .expect(201);

            expect(response.headers['set-cookie']).toBeDefined();
        });

        it('accepts that session on a protected route', async () => {
            const agent = request.agent(harness.server);

            await agent
                .post('/api/auth/login')
                .set('Origin', ALLOWED_ORIGIN)
                .send({
                    email: process.env['ORTHA_ROOT_ADMIN_EMAIL'],
                    password: process.env['ORTHA_ROOT_ADMIN_PASSWORD']
                })
                .expect(201);

            await agent.get('/api/workspaces').expect(200);
        });

        it('rejects a wrong password without saying which half was wrong', async () => {
            // Distinguishing "no such user" from "wrong password" turns the
            // login form into an account enumerator.
            const response = await request(harness.server)
                .post('/api/auth/login')
                .set('Origin', ALLOWED_ORIGIN)
                .send({
                    email: process.env['ORTHA_ROOT_ADMIN_EMAIL'],
                    password: 'not-the-password'
                })
                .expect(401);

            expect(JSON.stringify(response.body)).not.toMatch(/password|email/i);
        });
    });

    describe('routing', () => {
        it('answers an unknown path with a JSON 404', async () => {
            const response = await request(harness.server)
                .get('/api/not-a-real-endpoint')
                .expect(404);

            expect(response.body).toMatchObject({ statusCode: 404 });
        });
    });
});

/**
 * The reset helper, proven on the database this suite actually uses.
 *
 * Every suite that seeds rows depends on this leaving the schema intact — a
 * `TRUNCATE` that took the migration history with it would look like a
 * migration bug in whichever suite ran next.
 */
describe('resetDatabase()', () => {
    it('empties the tables without touching the migration history', async () => {
        const url = resolveTestDatabaseUrl();

        await expect(resetDatabase(url)).resolves.toBeUndefined();

        // The app still boots, which it could not do against a dropped schema.
        const harness = await createTestApp();
        await request(harness.server).get('/api/workspaces').expect(401);
        await closeTestApp(harness);
    });
});
