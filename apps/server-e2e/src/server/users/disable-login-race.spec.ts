import request from 'supertest';
import type { Response } from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { TEST_ALLOWED_ORIGIN } from '../../support/test-config';
import {
    countLiveUserSessions,
    countUserSessions,
    getUserByEmail,
    resetDb,
    seedActiveUser
} from '../../support/seed';

const ADMIN_EMAIL = 'race-admin@example.com';
const PASSWORD = 'SecurePass123!';

/** The `ortha_session=value` pair from a login response, if one was set. */
function sessionCookie(res: Response): string | null {
    const setCookie = res.headers['set-cookie'] as unknown as
        | string[]
        | undefined;
    return (
        setCookie
            ?.find((cookie) => cookie.startsWith('ortha_session='))
            ?.split(';')[0] ?? null
    );
}

/**
 * Suspending an account while its owner is signing in.
 *
 * This is the window the whole "status is re-checked on every request" rule
 * exists for. `POST /users/:id/disable` does two things in one transaction —
 * writes `status = 'disabled'` and revokes the account's live sessions — and a
 * login that commits a moment later writes a session row that the revocation
 * has already run past. Nothing is corrupt; the row is simply newer than the
 * sweep that was meant to catch it.
 *
 * There are therefore **three** places this can be stopped, and only the third
 * is unconditional:
 *
 * 1. The login's own status check, if the disable committed first.
 * 2. The disable's session revocation, if the login committed first.
 * 3. `AuthGuard` resolving the cookie on the **next** request, which reads the
 *    account's current status rather than trusting the session row.
 *
 * An implementation that authenticated from the session row alone would pass
 * (1) and (2) and hand a suspended person a working week-long credential. So
 * the assertion is not about which side wins — it is that whatever the race
 * produces, the very next request is refused.
 */
describe('disabling an account while it is signing in', () => {
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
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
    });

    /** Logs in as the admin and returns a cookie-bearing agent. */
    async function loginAsAdmin() {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email: ADMIN_EMAIL, password: PASSWORD })
            .expect(201);
        return agent;
    }

    it('leaves no usable credential behind, whichever side wins [users:I-03]', async () => {
        // Several rounds, because the winner is genuinely a race — a single
        // round would silently only ever exercise whichever side happens to be
        // faster on the machine running it, and the point is that both
        // orderings end the same way.
        const outcomes: number[] = [];

        for (let round = 0; round < 6; round += 1) {
            const email = `race-target-${round}@example.com`;
            const target = await seedActiveUser(harness.app, {
                email,
                password: PASSWORD,
                role: 'contributor'
            });
            const admin = await loginAsAdmin();

            const [disabled, signedIn] = await Promise.all([
                admin
                    .post(`/api/users/${target.id}/disable`)
                    .set('Origin', TEST_ALLOWED_ORIGIN),
                request(harness.server)
                    .post('/api/auth/login')
                    .set('Origin', TEST_ALLOWED_ORIGIN)
                    .send({ email, password: PASSWORD })
            ]);

            expect(disabled.status).toBe(201);
            // The login either got in or did not; both are legitimate results
            // of a race, and neither may leave access behind.
            expect([201, 401]).toContain(signedIn.status);
            outcomes.push(signedIn.status);

            expect((await getUserByEmail(email))?.status).toBe('disabled');

            const cookie = sessionCookie(signedIn);
            if (signedIn.status === 401) {
                expect(cookie).toBeNull();
                continue;
            }

            // The login won: it holds a cookie the revocation never saw. The
            // third checkpoint is the one that has to catch it.
            expect(cookie).not.toBeNull();
            await request(harness.server)
                .get('/api/auth/me')
                .set('Cookie', cookie as string)
                .expect(401);
            // …and it stays refused, so this is a rule rather than a cache miss.
            await request(harness.server)
                .get('/api/auth/me')
                .set('Cookie', cookie as string)
                .expect(401);
        }

        // Not an assertion about the scheduler — just a record that the loop
        // produced statuses at all, so a future reader can see from the failure
        // output which ordering the machine reproduced.
        expect(outcomes).toHaveLength(6);
    }, 60_000);

    it('refuses a session opened a moment before the suspension', async () => {
        // The deterministic half of the same claim, so a machine that always
        // resolves the race one way still covers the other ordering: sign in
        // first, suspend second, and the already-issued cookie must die.
        const target = await seedActiveUser(harness.app, {
            email: 'race-sequential@example.com',
            password: PASSWORD,
            role: 'contributor'
        });
        const victim = request.agent(harness.server);
        await victim
            .post('/api/auth/login')
            .send({ email: target.email, password: PASSWORD })
            .expect(201);
        await victim.get('/api/auth/me').expect(200);

        const admin = await loginAsAdmin();
        await admin
            .post(`/api/users/${target.id}/disable`)
            .set('Origin', TEST_ALLOWED_ORIGIN)
            .expect(201);

        await victim.get('/api/auth/me').expect(401);
        // The endpoint revoked the session as well, so this is belt *and*
        // braces rather than only the per-request status check. Revocation is
        // a soft one — `revoked_at` is stamped and the row stays put, which is
        // what lets an admin still see that the session existed — so count the
        // sessions that could still be presented, not the rows.
        expect(await countLiveUserSessions(target.id)).toBe(0);
        expect(await countUserSessions(target.id)).toBe(1);
    });

    it('refuses a new sign-in once the account is suspended', async () => {
        const target = await seedActiveUser(harness.app, {
            email: 'race-after@example.com',
            password: PASSWORD,
            role: 'contributor'
        });
        const admin = await loginAsAdmin();
        await admin
            .post(`/api/users/${target.id}/disable`)
            .set('Origin', TEST_ALLOWED_ORIGIN)
            .expect(201);

        await request(harness.server)
            .post('/api/auth/login')
            .set('Origin', TEST_ALLOWED_ORIGIN)
            .send({ email: target.email, password: PASSWORD })
            .expect(401);
        expect(await countUserSessions(target.id)).toBe(0);
    });
});
