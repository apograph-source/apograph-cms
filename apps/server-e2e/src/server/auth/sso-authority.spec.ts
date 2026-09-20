import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    getUserByEmail,
    resetDb,
    seedActiveUser,
    type SeededUser
} from '../../support/seed';
import {
    fakeSsoProvider,
    resetSsoRole,
    scriptSsoRole,
    SSO_EMAILS,
    SSO_SUBJECTS
} from '../../support/sso';
import { drainOutbox } from '../../support/outbox';
import { TEST_ALLOWED_ORIGIN } from '../../support/test-config';

const PASSWORD = 'SecurePass123!';
const FAILURE = `${TEST_ALLOWED_ORIGIN}/identity/signin?error=sso`;

/**
 * What an SSO sign-in is allowed to *do* — create accounts, and change roles.
 *
 * Kept separate from `sso.spec.ts` because these need a differently-configured
 * app: provisioning is off in the shipped default, and a suite that turned it on
 * for everyone would stop asserting the default at all.
 */
describe('SSO authority', () => {
    /** Runs `/start` and returns the agent plus the callback to follow. */
    async function handshake(harness: TestApp) {
        const agent = request.agent(harness.server);
        const started = await agent.get('/api/auth/sso/fake/start').expect(302);
        const location = new URL(started.headers['location']);
        return {
            agent,
            callback: `${location.pathname}${location.search}`
        };
    }

    describe('just-in-time provisioning, off (the default)', () => {
        let harness: TestApp;

        beforeAll(async () => {
            harness = await createTestApp();
        });
        afterAll(async () => {
            await closeTestApp(harness);
        });
        beforeEach(async () => {
            await resetDb();
            resetSsoRole();
            fakeSsoProvider.signInAs(SSO_SUBJECTS.stranger);
        });

        it('creates nobody, however verified the address is', async () => {
            const { agent, callback } = await handshake(harness);

            const done = await agent.get(callback).expect(302);

            expect(done.headers['location']).toBe(FAILURE);
            expect(await getUserByEmail(SSO_EMAILS.stranger)).toBeNull();
        });
    });

    describe('just-in-time provisioning, on', () => {
        let harness: TestApp;

        beforeAll(async () => {
            harness = await createTestApp({
                sso: {
                    provisioning: {
                        // `example.com` is the domain the scripted people are
                        // in; `stranger` is the one with no Ortha account.
                        domains: ['example.com'],
                        defaultRole: 'viewer'
                    }
                }
            });
        });
        afterAll(async () => {
            await closeTestApp(harness);
        });
        beforeEach(async () => {
            await resetDb();
            resetSsoRole();
            fakeSsoProvider.signInAs(SSO_SUBJECTS.stranger);
        });

        it('creates an active account on the configured role', async () => {
            const { agent, callback } = await handshake(harness);

            const done = await agent.get(callback).expect(302);
            expect(done.headers['location']).toBe(`${TEST_ALLOWED_ORIGIN}/`);

            const created = await getUserByEmail(SSO_EMAILS.stranger);
            expect(created).toMatchObject({ status: 'active' });

            const me = await agent.get('/api/auth/me').expect(200);
            expect(me.body.email).toBe(SSO_EMAILS.stranger);
        });

        it('refuses a domain that merely ends with an allowed one', async () => {
            // The suffix attack. `evil-example.com` passes
            // `endsWith('example.com')`, which is the implementation everybody
            // reaches for first — and it hands every account at a domain an
            // attacker can register a seat in this CMS. Matching has to be
            // exact on the domain, so this is refused by the same app that
            // provisions `stranger@example.com` in the test above.
            fakeSsoProvider.signInAs(SSO_SUBJECTS.suffix);
            expect(SSO_EMAILS.suffix.endsWith('example.com')).toBe(true);

            const { agent, callback } = await handshake(harness);
            const done = await agent.get(callback).expect(302);

            expect(done.headers['location']).toBe(FAILURE);
            expect(await getUserByEmail(SSO_EMAILS.suffix)).toBeNull();
            // Not signed in either — the refusal is complete, not partial.
            await agent.get('/api/auth/me').expect(401);
        });

        it('gives the account no password, so only the provider can open it', async () => {
            const { agent, callback } = await handshake(harness);
            await agent.get(callback).expect(302);

            // The account exists and is active, and the password path still
            // refuses it — there is no credential to present.
            await request(harness.server)
                .post('/api/auth/login')
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({ email: SSO_EMAILS.stranger, password: PASSWORD })
                .expect(401);
        });

        it('records the provisioning as its own audit fact', async () => {
            const { agent, callback } = await handshake(harness);
            await agent.get(callback).expect(302);

            // Reading the log needs `activity:read`, which the provisioned
            // viewer does not hold — so an admin looks instead.
            const admin = await seedActiveUser(harness.app, {
                email: 'sso-audit-admin@example.com',
                password: PASSWORD,
                role: 'admin'
            });
            expect(admin.id).toBeTruthy();
            const adminAgent = request.agent(harness.server);
            await adminAgent
                .post('/api/auth/login')
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({
                    email: 'sso-audit-admin@example.com',
                    password: PASSWORD
                })
                .expect(201);

            // The audit rows are written by the outbox subscriber. `run`
            // drains post-commit, but draining explicitly is what makes the
            // assertion about the mapping rather than about timing.
            await drainOutbox(harness.app);

            const log = await adminAgent.get('/api/activity').expect(200);
            const kinds = (log.body.items as { kind: string }[]).map(
                (row) => row.kind
            );

            // Three separate facts. "Somebody signed in" cannot answer "where
            // did this account come from?", which is the question a review of
            // an SSO deployment actually asks.
            expect(kinds).toContain('user.sso_provisioned');
            expect(kinds).toContain('user.sso_linked');
            expect(kinds).toContain('user.signed_in');
        });

        it("lets a role-mapping handler choose the new account's role", async () => {
            scriptSsoRole(({ isNewAccount }) =>
                isNewAccount ? 'contributor' : null
            );

            const { agent, callback } = await handshake(harness);
            await agent.get(callback).expect(302);

            const me = await agent.get('/api/auth/me').expect(200);
            expect(me.body.permissions).toContain('content:create');
        });

        it('falls back to the configured role when the handler names an unknown one', async () => {
            // A typo in a handler must not lock a directory out of the CMS.
            scriptSsoRole(() => 'editor-in-chief');

            const { agent, callback } = await handshake(harness);
            await agent.get(callback).expect(302);

            const me = await agent.get('/api/auth/me').expect(200);
            expect(me.body.permissions).not.toContain('content:create');
        });
    });

    describe('just-in-time provisioning, on for a different domain', () => {
        let harness: TestApp;

        // Its own app, and its own describe, because `closeTestApp` ends the
        // shared database pool: a second app opened *inside* another one's
        // tests takes the pool down with it when it closes, and every later
        // test in the file fails with "Database not initialized". Two apps in
        // sequence are fine; two open at once are not.
        beforeAll(async () => {
            harness = await createTestApp({
                sso: {
                    provisioning: {
                        domains: ['acme.com'],
                        defaultRole: 'viewer'
                    }
                }
            });
        });
        afterAll(async () => {
            await closeTestApp(harness);
        });
        beforeEach(async () => {
            await resetDb();
            resetSsoRole();
            fakeSsoProvider.signInAs(SSO_SUBJECTS.stranger);
        });

        it('refuses an address outside the allowed domains', async () => {
            // The same provider and the same verified claim as the suite above
            // — only the domain differs. This is the check that stops "sign in
            // with Google" from meaning "the internet has an account here".
            const { agent, callback } = await handshake(harness);

            const done = await agent.get(callback).expect(302);

            expect(done.headers['location']).toBe(FAILURE);
            expect(await getUserByEmail(SSO_EMAILS.stranger)).toBeNull();
        });
    });

    describe('role mapping on an account that already exists', () => {
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
            resetSsoRole();
            fakeSsoProvider.signInAs(SSO_SUBJECTS.linked);
            user = await seedActiveUser(harness.app, {
                email: SSO_EMAILS.linked,
                password: PASSWORD,
                role: 'viewer'
            });
        });

        it('leaves the role alone when no handler is configured', async () => {
            const { agent, callback } = await handshake(harness);
            await agent.get(callback).expect(302);

            const me = await agent.get('/api/auth/me').expect(200);
            expect(me.body.permissions).not.toContain('content:create');
        });

        it('promotes when the handler says so', async () => {
            scriptSsoRole(({ profile }) =>
                profile.email === SSO_EMAILS.linked ? 'contributor' : null
            );

            const { agent, callback } = await handshake(harness);
            await agent.get(callback).expect(302);

            const me = await agent.get('/api/auth/me').expect(200);
            expect(me.body.permissions).toContain('content:create');
            expect(me.body.id).toBe(user.id);
        });

        it('never demotes an administrator', async () => {
            // Administrator is a deliberate grant and a directory group is not.
            // Without this rule, one group edit nobody thought of as dangerous
            // could lock every administrator out of the CMS — and last-admin
            // protection lives in the users context, which does not run here.
            await resetDb();
            const admin = await seedActiveUser(harness.app, {
                email: SSO_EMAILS.linked,
                password: PASSWORD,
                role: 'admin'
            });
            scriptSsoRole(() => 'viewer');

            const { agent, callback } = await handshake(harness);
            await agent.get(callback).expect(302);

            const me = await agent.get('/api/auth/me').expect(200);
            expect(me.body.id).toBe(admin.id);
            expect(me.body.permissions).toContain('users:delete');
        });
    });

    describe('accepting an invitation with a work account', () => {
        const ADMIN_EMAIL = 'sso-invite-admin@example.com';
        let harness: TestApp;

        beforeAll(async () => {
            harness = await createTestApp();
        });
        afterAll(async () => {
            await closeTestApp(harness);
        });
        beforeEach(async () => {
            await resetDb();
            resetSsoRole();
            fakeSsoProvider.signInAs(SSO_SUBJECTS.linked);
            await seedActiveUser(harness.app, {
                email: ADMIN_EMAIL,
                password: PASSWORD,
                role: 'admin'
            });
        });

        /** Invite `email` and hand back the raw one-time token. */
        async function invite(email: string): Promise<string> {
            const agent = request.agent(harness.server);
            await agent
                .post('/api/auth/login')
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({ email: ADMIN_EMAIL, password: PASSWORD })
                .expect(201);
            const response = await agent
                .post('/api/users/invites')
                .send({ email, name: 'Invited', role: 'contributor' })
                .expect(201);
            return response.body.inviteToken as string;
        }

        /** Start an attempt carrying an invite token. */
        async function handshakeWithInvite(token: string) {
            const agent = request.agent(harness.server);
            const started = await agent
                .get('/api/auth/sso/fake/start')
                .query({ invite: token })
                .expect(302);
            const location = new URL(started.headers['location']);
            return {
                agent,
                callback: `${location.pathname}${location.search}`
            };
        }

        it('activates the invited account and signs them in', async () => {
            const token = await invite(SSO_EMAILS.linked);

            const { agent, callback } = await handshakeWithInvite(token);
            const done = await agent.get(callback).expect(302);

            expect(done.headers['location']).toBe(`${TEST_ALLOWED_ORIGIN}/`);
            expect(await getUserByEmail(SSO_EMAILS.linked)).toMatchObject({
                status: 'active'
            });

            const me = await agent.get('/api/auth/me').expect(200);
            expect(me.body.email).toBe(SSO_EMAILS.linked);
            // The role the admin chose, not one the provider decided.
            expect(me.body.permissions).toContain('content:create');
        });

        it('sets no password, so the provider stays the only way in', async () => {
            const token = await invite(SSO_EMAILS.linked);
            const { agent, callback } = await handshakeWithInvite(token);
            await agent.get(callback).expect(302);

            await request(harness.server)
                .post('/api/auth/login')
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({ email: SSO_EMAILS.linked, password: PASSWORD })
                .expect(401);
        });

        it('just signs the same person in when they follow the link again', async () => {
            // Not a failure, and worth stating: by the second visit the
            // identity link exists, so the invite token is never consulted —
            // they are recognised the way any returning person is. Refusing
            // here would punish someone for re-opening an email.
            const token = await invite(SSO_EMAILS.linked);
            const first = await handshakeWithInvite(token);
            await first.agent.get(first.callback).expect(302);

            const second = await handshakeWithInvite(token);
            const done = await second.agent.get(second.callback).expect(302);

            expect(done.headers['location']).toBe(`${TEST_ALLOWED_ORIGIN}/`);
        });

        it('is spent for anybody else — the one-time guarantee', async () => {
            // The case that actually matters. A spent link forwarded to, or
            // intercepted by, a different person finds no identity link, falls
            // to the invite path, and the burned token stops it there.
            const token = await invite(SSO_EMAILS.linked);
            const first = await handshakeWithInvite(token);
            await first.agent.get(first.callback).expect(302);

            fakeSsoProvider.signInAs(SSO_SUBJECTS.stranger);
            const second = await handshakeWithInvite(token);
            const done = await second.agent.get(second.callback).expect(302);

            expect(done.headers['location']).toBe(FAILURE);
            expect(await getUserByEmail(SSO_EMAILS.stranger)).toBeNull();
        });

        it('refuses a link addressed to somebody else', async () => {
            // The whole reason the address is checked. Otherwise anyone holding
            // an invite link could redeem it with an account of their own and
            // walk away with the role an admin granted to someone else.
            const token = await invite('someone-else@example.com');

            const { agent, callback } = await handshakeWithInvite(token);
            const done = await agent.get(callback).expect(302);

            expect(done.headers['location']).toBe(FAILURE);
            expect(
                await getUserByEmail('someone-else@example.com')
            ).toMatchObject({ status: 'pending' });
        });

        it('refuses an unverified address, however real the invite is', async () => {
            const token = await invite(SSO_EMAILS.unverified);
            fakeSsoProvider.signInAs(SSO_SUBJECTS.unverified);

            const { agent, callback } = await handshakeWithInvite(token);
            const done = await agent.get(callback).expect(302);

            expect(done.headers['location']).toBe(FAILURE);
            expect(await getUserByEmail(SSO_EMAILS.unverified)).toMatchObject({
                status: 'pending'
            });
        });

        it('refuses a token that is not an invite at all', async () => {
            const { agent, callback } =
                await handshakeWithInvite('not-a-real-token');
            const done = await agent.get(callback).expect(302);

            expect(done.headers['location']).toBe(FAILURE);
        });
    });

    describe('passwords turned off', () => {
        const ROOT_EMAIL = 'root@example.com';
        let harness: TestApp;

        beforeAll(async () => {
            harness = await createTestApp({
                sso: { allowPasswordLogin: false },
                rootAdmin: {
                    email: ROOT_EMAIL,
                    password: PASSWORD,
                    name: 'Root'
                }
            });
        });
        afterAll(async () => {
            await closeTestApp(harness);
        });
        beforeEach(async () => {
            await resetDb();
            resetSsoRole();
        });

        it('refuses a password sign-in for an ordinary account', async () => {
            await seedActiveUser(harness.app, {
                email: SSO_EMAILS.linked,
                password: PASSWORD,
                role: 'contributor'
            });

            await request(harness.server)
                .post('/api/auth/login')
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({ email: SSO_EMAILS.linked, password: PASSWORD })
                .expect(401);
        });

        it('still accepts the root administrator — the break-glass path', async () => {
            // Without this exemption, an operator who mis-scopes their identity
            // provider is locked out of their own CMS with no way back that
            // does not involve a database client.
            await seedActiveUser(harness.app, {
                email: ROOT_EMAIL,
                password: PASSWORD,
                role: 'admin'
            });

            await request(harness.server)
                .post('/api/auth/login')
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({ email: ROOT_EMAIL, password: PASSWORD })
                .expect(201);
        });

        it('leaves the SSO path working', async () => {
            await seedActiveUser(harness.app, {
                email: SSO_EMAILS.linked,
                password: PASSWORD,
                role: 'contributor'
            });
            fakeSsoProvider.signInAs(SSO_SUBJECTS.linked);

            const { agent, callback } = await handshake(harness);
            const done = await agent.get(callback).expect(302);

            expect(done.headers['location']).toBe(`${TEST_ALLOWED_ORIGIN}/`);
        });
    });
});
