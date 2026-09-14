import request from 'supertest';
import { getPool } from '@apograph/database';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { drainOutbox } from '../../support/outbox';
import { drainMail, resetMail, testMailProvider } from '../../support/mail';
import {
    ageInviteTokens,
    getActivityRows,
    resetDb,
    seedActiveUser
} from '../../support/seed';

const ADMIN_EMAIL = 'mail-admin@example.com';
const PASSWORD = 'SecurePass123!';

/** Rows still in the queue, newest first. */
async function mailRows(): Promise<
    {
        kind: string;
        toAddress: string;
        link: string | null;
        attempts: number;
        deadAt: Date | null;
        lastError: string | null;
    }[]
> {
    const { rows } = await getPool().query(
        `SELECT kind, to_address AS "toAddress", link, attempts,
                dead_at AS "deadAt", last_error AS "lastError"
         FROM mail_deliveries
         ORDER BY created_at DESC`
    );
    return rows;
}

/**
 * The mailer, end to end — booted **with** a provider, which is the half of
 * ADR-0018 no other suite sees.
 *
 * Every other users suite boots without one and reads the raw token out of the
 * invite response; that is still the shipped behaviour of an unconfigured
 * deployment, and `manage-invites.spec.ts` is what pins it. This suite is the
 * other configuration: the message carries the link, the response does not, and
 * the row that held the secret is deleted the moment a provider accepts it.
 */
describe('outgoing mail', () => {
    let harness: TestApp;

    beforeAll(async () => {
        harness = await createTestApp({ mail: {} });
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        resetMail();
        await seedActiveUser(harness.app, {
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
    });

    async function login(email = ADMIN_EMAIL) {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password: PASSWORD })
            .expect(201);
        return agent;
    }

    async function invite(email: string, agent?: request.Agent) {
        const caller = agent ?? (await login());
        return caller
            .post('/api/users/invites')
            .send({ email, role: 'viewer' })
            .expect(201);
    }

    describe('inviting', () => {
        it('queues the message and returns no token at all [mail:I-02]', async () => {
            const res = await invite('ada@example.com');

            // Absent, not empty: a client that reads it blindly should fail
            // rather than build a link ending in `undefined`.
            expect(res.body).not.toHaveProperty('inviteToken');

            const [row] = await mailRows();
            expect(row).toMatchObject({
                kind: 'invite',
                toAddress: 'ada@example.com',
                attempts: 0,
                deadAt: null
            });
            expect(row.link).toContain('/identity/accept-invite?token=');
        });

        it('builds the link from appUrl, never from the request host [mail:I-11]', async () => {
            const agent = await login();
            await agent
                .post('/api/users/invites')
                .set('Host', 'evil.example.com')
                .send({ email: 'ada@example.com', role: 'viewer' })
                .expect(201);

            const [row] = await mailRows();
            expect(row.link).toContain('https://cms.test/');
            expect(row.link).not.toContain('evil.example.com');
        });

        it('sends the queued message and then deletes the row [mail:I-05]', async () => {
            await invite('ada@example.com');

            const sent = await drainMail(harness.app);

            expect(sent).toHaveLength(1);
            expect(sent[0]).toMatchObject({
                to: 'ada@example.com',
                from: 'Apograph <no-reply@cms.test>'
            });
            expect(sent[0].text).toContain('/identity/accept-invite?token=');
            // The row existed only to survive a crash between commit and send.
            expect(await mailRows()).toHaveLength(0);
        });

        it('queues nothing when the invite itself is refused', async () => {
            const agent = await login();
            await invite('ada@example.com', agent);
            await drainMail(harness.app);
            resetMail();

            // A duplicate email is refused before anything is written.
            await agent
                .post('/api/users/invites')
                .send({ email: 'ada@example.com', role: 'viewer' })
                .expect(409);

            expect(await mailRows()).toHaveLength(0);
        });
    });

    describe('resending and resetting', () => {
        it('queues a resend under its own kind, with the fresh link', async () => {
            const created = await invite('ada@example.com');
            await drainMail(harness.app);
            resetMail();
            await ageInviteTokens(created.body.id);

            const agent = await login();
            const res = await agent
                .post(`/api/users/${created.body.id}/invites/resend`)
                .expect(201);

            expect(res.body).not.toHaveProperty('inviteToken');
            const [row] = await mailRows();
            expect(row.kind).toBe('invite_resent');

            const sent = await drainMail(harness.app);
            expect(sent[0].subject).toContain('invitation');
        });

        it('queues a password reset pointing at the reset route', async () => {
            const member = await seedActiveUser(harness.app, {
                email: 'grace@example.com',
                password: PASSWORD,
                role: 'viewer'
            });

            const agent = await login();
            const res = await agent
                .post(`/api/users/${member.id}/password-reset`)
                .expect(201);

            expect(res.body).not.toHaveProperty('resetToken');
            const [row] = await mailRows();
            expect(row.kind).toBe('password_reset');
            expect(row.link).toContain('/identity/reset-password?token=');
        });
    });

    describe('when a message does not get through', () => {
        it('backs the row off and keeps it, with the same body next time [mail:I-06]', async () => {
            await invite('ada@example.com');
            testMailProvider.failNext(1, 'connection refused');

            await drainMail(harness.app);

            const [row] = await mailRows();
            expect(row.attempts).toBe(1);
            expect(row.deadAt).toBeNull();
            expect(row.lastError).toContain('connection refused');
        });

        it('stops at once on a permanent rejection, budget untouched [mail:I-08]', async () => {
            await invite('ada@example.com');
            testMailProvider.failPermanently('550 5.1.1 unknown recipient');

            await drainMail(harness.app);

            const [row] = await mailRows();
            // One attempt spent, and dead: a typo'd address does not sit in the
            // queue for twenty minutes pretending it might still land.
            expect(row.attempts).toBe(1);
            expect(row.deadAt).not.toBeNull();
            expect(row.lastError).toContain('unknown recipient');
        });

        it('hands the link back through reveal-link, and audits it [mail:I-02]', async () => {
            const created = await invite('ada@example.com');
            testMailProvider.failPermanently('550 5.1.1 unknown recipient');
            await drainMail(harness.app);

            const agent = await login();
            const res = await agent
                .post(`/api/users/${created.body.id}/reveal-link`)
                .expect(201);

            expect(res.body.kind).toBe('invite');
            expect(res.body.link).toContain('/identity/accept-invite?token=');
            expect(res.body.attempts).toBe(1);

            await drainOutbox(harness.app);
            const audit = await getActivityRows();
            const revealed = audit.find(
                (row) => row.kind === 'user.invite_link_revealed'
            );
            expect(revealed).toBeDefined();
            expect(revealed?.actorEmail).toBe(ADMIN_EMAIL);
            // The kind, never the secret: this table is stamped and never
            // pruned.
            expect(JSON.stringify(revealed?.meta)).not.toContain('token=');
        });

        it('has nothing to reveal once the message went out', async () => {
            const created = await invite('ada@example.com');
            await drainMail(harness.app);

            const agent = await login();
            const res = await agent
                .post(`/api/users/${created.body.id}/reveal-link`)
                .expect(409);

            expect(res.body.code).toBe('NO_REVEALABLE_LINK');
        });

        it('refuses reveal-link to a caller without users:manage', async () => {
            const created = await invite('ada@example.com');
            await seedActiveUser(harness.app, {
                email: 'contributor@example.com',
                password: PASSWORD,
                role: 'contributor'
            });

            const agent = await login('contributor@example.com');
            await agent
                .post(`/api/users/${created.body.id}/reveal-link`)
                .expect(403);
        });
    });
});
