import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { resetDb } from '../../support/seed';

/**
 * The SSO routes on a deployment that registers **no** identity provider —
 * which is the default install, and therefore the configuration almost every
 * Ortha runs.
 *
 * The claim worth pinning is that the feature is *absent*, not *broken*. The
 * routes stay mounted and `GET /auth/sso` answers an empty list: the sign-in
 * page fetches that list on every load, and a 404 (or a 500 from a module that
 * refused to register) would be an error the page has to decide how to render,
 * for a feature this deployment does not have. `[]` is the shape that renders
 * as nothing.
 *
 * Its own spec file rather than a `describe` inside `sso.spec.ts`: the provider
 * list is fixed when the plugin list is built, so this needs a second app —
 * and `closeTestApp` ends the file's shared database pool, so a second app
 * opened *inside* another one's tests takes it down with it.
 */
describe('SSO with no provider registered', () => {
    let harness: TestApp;

    beforeAll(async () => {
        harness = await createTestApp({ ssoProviders: 'none' });
    });
    afterAll(async () => {
        await closeTestApp(harness);
    });
    beforeEach(async () => {
        await resetDb();
    });

    it('answers an empty list rather than a 404', async () => {
        const res = await request(harness.server)
            .get('/api/auth/sso')
            .expect(200);

        expect(res.body).toEqual([]);
    });

    it('is still public — the sign-in page asks before anyone is signed in', async () => {
        // Anonymous, no cookie: the same request the sign-in screen makes.
        await request(harness.server)
            .get('/api/auth/sso')
            .expect(200)
            .expect((res) => {
                expect(Array.isArray(res.body)).toBe(true);
            });
    });

    it('404s a start for a name nothing resolves', async () => {
        // Nothing can be *started*, because no name resolves — which is a
        // different answer from the list route's, and the right one: this URL
        // genuinely does not exist here.
        await request(harness.server)
            .get('/api/auth/sso/fake/start')
            .expect(404);
    });

    it('404s a callback for the same reason', async () => {
        await request(harness.server)
            .get('/api/auth/sso/fake/callback?state=x&code=y')
            .expect(404);
    });

    it('leaves the password path untouched', async () => {
        // The point of the empty list is that this deployment signs in exactly
        // the way it did before SSO existed.
        await request(harness.server)
            .post('/api/auth/login')
            .send({ email: 'nobody@example.com', password: 'SecurePass123!' })
            .expect(401);
    });
});
