import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { TEST_ALLOWED_ORIGIN } from '../../support/test-config';
import {
    apiTokenExists,
    resetDb,
    seedActiveUser,
    seedContentGrants,
    seedWorkspace
} from '../../support/seed';

const ADMIN_EMAIL = 'bearer-admin@example.com';
const PASSWORD = 'SecurePass123!';

/**
 * `/api/api-tokens` is reachable **by an administrator's session and by nothing
 * else** — in particular, never by one of the bearer tokens it mints.
 *
 * The separation is the whole containment story for an external credential. A
 * token is a long-lived secret that lives in someone else's CI config; if it
 * could reach the management routes, one leaked token would be able to mint
 * itself a fresh one, widen its own workspace bucket, and revoke the token an
 * operator was about to rotate — so revoking the leaked one would no longer end
 * the incident. Sessions expire and are revocable from the Members page; tokens
 * are not, which is precisely why they must not be able to reissue themselves.
 *
 * The token used here is **live** and proven live against the public content
 * API in the same test, so a `401` on the management route is the guard
 * refusing the credential rather than a dead secret answering for it.
 */
describe('API token management refuses bearer tokens (/api/api-tokens)', () => {
    let harness: TestApp;
    let workspaceId: string;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        await seedActiveUser(harness.app, {
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
        workspaceId = (await seedWorkspace({ name: 'WS A', slug: 'ws-a' })).id;
        await seedContentGrants(workspaceId, ['test_article']);
    });

    /** Logs in as the admin and returns a cookie-bearing agent. */
    async function login() {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email: ADMIN_EMAIL, password: PASSWORD })
            .expect(201);
        return agent;
    }

    /** Mints a token through the real management API and returns it. */
    async function mintToken(
        scope: 'read' | 'full' = 'full'
    ): Promise<{ id: string; secret: string }> {
        const agent = await login();
        const res = await agent
            .post('/api/api-tokens')
            .send({ name: 'ci', workspaceIds: [workspaceId], scope })
            .expect(201);
        return { id: res.body.id as string, secret: res.body.secret as string };
    }

    it('proves the minted token is live before anything is asserted about it', async () => {
        const { secret } = await mintToken();

        // The control for every refusal below: this exact credential opens the
        // API it is *for*. Without it a passing suite would be consistent with
        // the mint being broken.
        await request(harness.server)
            .get('/api/v1/content-types')
            .set('Authorization', `Bearer ${secret}`)
            .expect(200);
    });

    it('401s a bearer token minting another token — no self-issue [api-tokens:I-14] [identity:I-19]', async () => {
        const { secret } = await mintToken();

        await request(harness.server)
            .post('/api/api-tokens')
            .set('Authorization', `Bearer ${secret}`)
            .set('Origin', TEST_ALLOWED_ORIGIN)
            .send({
                name: 'escalated',
                workspaceIds: [workspaceId],
                scope: 'full'
            })
            .expect(401);

        // And nothing was created behind the refusal: the admin still sees the
        // one token they minted.
        const agent = await login();
        const list = await agent.get('/api/api-tokens').expect(200);
        expect(list.body.total).toBe(1);
    });

    it('401s a bearer token listing the tokens', async () => {
        const { secret } = await mintToken();

        await request(harness.server)
            .get('/api/api-tokens')
            .set('Authorization', `Bearer ${secret}`)
            .expect(401);
    });

    it('401s a bearer token revoking a token, which stays live', async () => {
        const { id, secret } = await mintToken();

        await request(harness.server)
            .delete(`/api/api-tokens/${id}`)
            .set('Authorization', `Bearer ${secret}`)
            .set('Origin', TEST_ALLOWED_ORIGIN)
            .expect(401);

        expect(await apiTokenExists(id)).toBe(true);
        // Still usable, so the refusal did not half-happen.
        await request(harness.server)
            .get('/api/v1/content-types')
            .set('Authorization', `Bearer ${secret}`)
            .expect(200);
    });

    it('401s a bearer token revoking somebody else’s token', async () => {
        const victim = await mintToken();
        const attacker = await mintToken('read');

        await request(harness.server)
            .delete(`/api/api-tokens/${victim.id}`)
            .set('Authorization', `Bearer ${attacker.secret}`)
            .set('Origin', TEST_ALLOWED_ORIGIN)
            .expect(401);

        expect(await apiTokenExists(victim.id)).toBe(true);
    });

    it('401s a bearer token even alongside a session cookie header it forged', async () => {
        // A caller who holds a token but no session cannot manufacture one by
        // presenting the token in both places.
        const { secret } = await mintToken();

        await request(harness.server)
            .get('/api/api-tokens')
            .set('Authorization', `Bearer ${secret}`)
            .set('Cookie', `ortha_session=${secret}`)
            .expect(401);
    });

    it('leaves the session path working, so the refusal is about the credential', async () => {
        await mintToken();
        const agent = await login();

        await agent.get('/api/api-tokens').expect(200);
    });
});
