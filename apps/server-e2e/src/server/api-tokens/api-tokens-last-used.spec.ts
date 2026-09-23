import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    backdateApiTokenLastUsed,
    getActivityRows,
    getApiTokenLastUsed,
    resetDb,
    seedActiveUser,
    seedContentGrants,
    seedWorkspace
} from '../../support/seed';

const ADMIN_EMAIL = 'token-lastused-admin@example.com';
const PASSWORD = 'SecurePass123!';

/** `LAST_USED_TOUCH_INTERVAL_MS` in `ApiTokenService`, as the throttle uses it. */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * `last_used_at`, and the `token.used` audit row that shares its schedule.
 *
 * Both are written by a **throttled, fire-and-forget** touch inside
 * `ApiTokenService.verify`: at most one write per token per minute, never
 * awaited, so a failed touch can't fail the request it was authenticating.
 * That throttle is what bounds the audit volume — a busy integration
 * authenticates thousands of times an hour, and the question an operator asks
 * after a key leaks is "was this credential in use, and over what period",
 * which needs a row a minute and is actively hidden by a row per request.
 *
 * The suite drives the real `/api/v1` surface rather than the service, because
 * the throttle is only worth anything if it survives the path a client actually
 * takes.
 */
describe('API token last-used tracking', () => {
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

    /** Mints a token through the real management API. */
    async function mintToken(): Promise<{ id: string; secret: string }> {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email: ADMIN_EMAIL, password: PASSWORD })
            .expect(201);
        const res = await agent
            .post('/api/api-tokens')
            .send({ name: 'ci', workspaceIds: [workspaceId], scope: 'read' })
            .expect(201);
        return { id: res.body.id as string, secret: res.body.secret as string };
    }

    /** One authenticated read on the public API — the thing that touches. */
    async function useToken(secret: string): Promise<void> {
        await request(harness.server)
            .get('/api/v1/content-types')
            .set('Authorization', `Bearer ${secret}`)
            .expect(200);
    }

    /** Every `token.used` audit row currently in the log. */
    async function usedRows() {
        return (await getActivityRows()).filter(
            (row) => row.kind === 'token.used'
        );
    }

    /**
     * Wait until at least `count` `token.used` rows have landed.
     *
     * The touch is deliberately not awaited by the request, so the row arrives
     * a moment after the response. Polling rather than sleeping a fixed span
     * keeps the test fast and, more to the point, makes the *next* request
     * deterministic: the throttle compares against the stored value, so a
     * second request racing the first commit would touch again and the suite
     * would fail on a timing accident rather than on the behaviour.
     */
    async function waitForUsedRows(count: number): Promise<void> {
        const deadline = Date.now() + 5_000;
        for (;;) {
            const rows = await usedRows();
            if (rows.length >= count) {
                return;
            }
            if (Date.now() > deadline) {
                throw new Error(
                    `timed out waiting for ${count} token.used rows; saw ${rows.length}`
                );
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }

    it('records the first use of a token, on the row and in the log', async () => {
        const { id, secret } = await mintToken();
        expect(await getApiTokenLastUsed(id)).toBeNull();

        await useToken(secret);
        await waitForUsedRows(1);

        const lastUsed = await getApiTokenLastUsed(id);
        expect(lastUsed).not.toBeNull();

        const [row] = await usedRows();
        expect(row).toMatchObject({
            kind: 'token.used',
            subjectType: 'api_token',
            subjectId: id,
            // A token acts as itself — the minting user's grants are never
            // consulted, so naming them here would attribute the request to a
            // person who may have left the company. `api_tokens.created_by` is
            // where "who minted it" already lives.
            actorId: null,
            actorEmail: null
        });
        // Never used before, so there is no quiet period to report.
        expect(
            (row.meta as { previousUseAt: string | null }).previousUseAt
        ).toBeNull();
    });

    it('writes one row for two requests inside the same minute [activity:I-36] [api-tokens:I-21]', async () => {
        const { id, secret } = await mintToken();

        await useToken(secret);
        await waitForUsedRows(1);
        const afterFirst = await getApiTokenLastUsed(id);

        await useToken(secret);

        // No settle window is needed for the negative: the throttle decides
        // synchronously, before `verify` returns, so if it skipped there is no
        // pending work that could still arrive and contradict this.
        expect(await usedRows()).toHaveLength(1);
        expect(await getApiTokenLastUsed(id)).toEqual(afterFirst);
    });

    it('writes a second row once the throttle window has passed [activity:I-36]', async () => {
        const { id, secret } = await mintToken();

        await useToken(secret);
        await waitForUsedRows(1);
        const afterFirst = await getApiTokenLastUsed(id);

        // Back-date rather than sleep out the real minute: the column is the
        // only input to the throttle, so moving it is exactly equivalent to
        // waiting, and a test that waits a minute is a test nobody runs.
        await backdateApiTokenLastUsed(id, TOUCH_INTERVAL_MS * 2);
        const backdated = await getApiTokenLastUsed(id);

        await useToken(secret);
        await waitForUsedRows(2);

        const rows = await usedRows();
        expect(rows).toHaveLength(2);
        expect(rows.every((row) => row.subjectId === id)).toBe(true);

        // The column moved forward again, past both the back-dated value and
        // the first genuine touch.
        const afterSecond = await getApiTokenLastUsed(id);
        expect(afterSecond).not.toBeNull();
        expect((afterSecond as Date).getTime()).toBeGreaterThan(
            (backdated as Date).getTime()
        );
        expect((afterSecond as Date).getTime()).toBeGreaterThanOrEqual(
            (afterFirst as Date).getTime()
        );

        // `previousUseAt` is the point of the second row: the touch overwrote
        // the only copy of how long the credential had been quiet, and a token
        // dormant for six months that woke up on Tuesday is the case this
        // exists to make visible. The first row has none; the second carries
        // the value the touch was about to destroy.
        const gaps = rows.map(
            (row) =>
                (row.meta as { previousUseAt: string | null }).previousUseAt
        );
        expect(gaps.filter((gap) => gap === null)).toHaveLength(1);
        const reported = gaps.find((gap) => gap !== null);
        expect(new Date(reported as string).getTime()).toBe(
            (backdated as Date).getTime()
        );
    });

    it('records nothing for a request the token could not authenticate', async () => {
        // The touch hangs off a *successful* resolve. A row for a rejected
        // bearer would let anyone with the endpoint write into the audit log.
        await request(harness.server)
            .get('/api/v1/content-types')
            .set('Authorization', 'Bearer orthacms_not-a-real-token')
            .expect(401);

        expect(await usedRows()).toEqual([]);
    });
});
