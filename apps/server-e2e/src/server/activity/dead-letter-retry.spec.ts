import request from 'supertest';
import { MAX_DELIVERY_ATTEMPTS, OutboxDispatcher } from '@orthacms/database';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { TEST_ALLOWED_ORIGIN } from '../../support/test-config';
import {
    countOutbox,
    insertOutboxRow,
    parkEvent,
    readOutboxRow
} from '../../support/outbox';
import {
    getActivityRows,
    resetDb,
    seedActiveUser,
    seedContentGrants,
    seedWorkspace,
    type SeededUser
} from '../../support/seed';

const ADMIN_EMAIL = 'dead-letter-admin@example.com';
const PASSWORD = 'SecurePass123!';
const EVIL_ORIGIN = 'https://evil.example';

/**
 * `POST /api/activity/dead-letters/:id/retry` — the whole route surface.
 *
 * It is the **first writing route in the activity plugin**, and the only one,
 * so nothing else in this package's suites exercises a `@Post`, an
 * `OriginGuard`, or a permission other than `activity:read`. Everything the
 * route's shape rests on is asserted here rather than assumed from the class
 * decorators, because the decorator stack is exactly the thing that looks
 * complete while missing a guard.
 *
 * Two of the answers are deliberately lossy and worth reading twice. An unknown
 * id and an **already delivered** one both answer 404, so a caller cannot use
 * the difference to discover that an event exists. A row that is undelivered
 * but still climbing its backoff answers 409, not 404 — it exists and the
 * caller may see it, there is simply nothing to un-park.
 */
describe('POST /api/activity/dead-letters/:id/retry', () => {
    let harness: TestApp;
    let admin: SeededUser;
    let dispatcher: OutboxDispatcher;

    beforeAll(async () => {
        harness = await createTestApp();
        dispatcher = harness.app.get(OutboxDispatcher);
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        // The poll backstop would drain the row this suite just un-parked,
        // mid-assertion. The app's own teardown re-arms it.
        dispatcher.onModuleDestroy();
        admin = await seedActiveUser(harness.app, {
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

    /** A dead letter, ready to be acted on. */
    async function seedDeadLetter(kind = 'qa.route.parked') {
        const id = await insertOutboxRow({ kind });
        await parkEvent(id);
        return id;
    }

    describe('the happy path', () => {
        it('answers 200 with the reset row, and the row really is claimable', async () => {
            const id = await seedDeadLetter();
            const agent = await login();

            const res = await agent
                .post(`/api/activity/dead-letters/${id}/retry`)
                .expect(200);

            // The exact key set, so a future field cannot arrive unnoticed —
            // and so the payload, which the list route withholds on purpose,
            // stays withheld here too.
            expect(Object.keys(res.body).sort()).toEqual([
                'aggregateId',
                'aggregateType',
                'attempts',
                'id',
                'kind',
                'lastError',
                'nextAttemptAt',
                'occurredAt'
            ]);
            expect(res.body).toMatchObject({
                id,
                kind: 'qa.route.parked',
                attempts: 0,
                nextAttemptAt: null
            });
            expect(typeof res.body.occurredAt).toBe('string');
            // Preserved, never cleared: the only surviving evidence of why the
            // event parked in the first place.
            expect(res.body.lastError).not.toBeNull();

            const row = await readOutboxRow(id);
            expect(row?.attempts).toBe(0);
            // The predicted defect: clearing `attempts` while leaving a
            // schedule up to five minutes out produces a row the claim still
            // refuses, so the operator presses retry and nothing happens.
            expect(row?.nextAttemptAt).toBeNull();
            expect(row?.lastError).not.toBeNull();

            // And claimable is the claim that matters — asserted here with
            // **no drain of our own**, deliberately. The poll backstop is
            // stopped for this suite, so the only thing that can have delivered
            // this row is the drain `UnitOfWork.run` awaits after the route's
            // transaction commits. That is what makes the effect visible to the
            // operator immediately instead of at the next five-second tick, and
            // it is the reason the route needs no `drain()` call of its own; a
            // second one would run after this had already delivered the event.
            expect((await readOutboxRow(id))?.dispatchedAt).not.toBeNull();
        });

        it('resets in place — one row, same id, no copy [database:I-12]', async () => {
            const id = await seedDeadLetter('qa.route.nocopy');
            const agent = await login();

            await agent
                .post(`/api/activity/dead-letters/${id}/retry`)
                .expect(200);

            expect(await countOutbox('qa.route.nocopy')).toBe(1);
        });

        it('records the retry in the audit log', async () => {
            const id = await seedDeadLetter('qa.route.audited');
            const agent = await login();

            await agent
                .post(`/api/activity/dead-letters/${id}/retry`)
                .expect(200);
            // The audit event travels through the outbox like everybody
            // else's, so it needs a drain before it is a row.
            await dispatcher.drain();

            const rows = (await getActivityRows()).filter(
                (row) => row.kind === 'outbox.event_retried'
            );
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                subjectType: 'outbox_event',
                subjectId: id,
                actorId: admin.id,
                actorEmail: ADMIN_EMAIL
            });
            expect(rows[0].meta).toMatchObject({
                eventKind: 'qa.route.audited',
                attempts: MAX_DELIVERY_ATTEMPTS
            });
        });
    });

    describe('what it refuses', () => {
        it('rejects a non-uuid id with 400', async () => {
            const agent = await login();
            await agent
                .post('/api/activity/dead-letters/not-a-uuid/retry')
                .expect(400);
        });

        it('answers 404 for an unknown id', async () => {
            const agent = await login();
            await agent
                .post(
                    '/api/activity/dead-letters/00000000-0000-4000-8000-0000000000ff/retry'
                )
                .expect(404);
        });

        it('answers 404 for an event that has already been delivered', async () => {
            // Indistinguishable from the unknown id above, on purpose.
            const id = await insertOutboxRow({
                kind: 'qa.route.delivered',
                dispatched: true
            });
            const agent = await login();

            await agent
                .post(`/api/activity/dead-letters/${id}/retry`)
                .expect(404);

            expect((await readOutboxRow(id))?.dispatchedAt).not.toBeNull();
        });

        it('answers 409 for a row that is undelivered but not parked', async () => {
            // Log in **first**. A login commits a unit of work, and a unit of
            // work drains the outbox post-commit — which would deliver a
            // pending row with no subscriber and turn this case into the 404
            // one. Only a parked row is safe to seed before a request.
            const agent = await login();
            const id = await insertOutboxRow({ kind: 'qa.route.climbing' });

            await agent
                .post(`/api/activity/dead-letters/${id}/retry`)
                .expect(409);

            // Left exactly as it was: a backoff in progress is not something a
            // retry may cancel.
            expect((await readOutboxRow(id))?.attempts).toBe(0);
        });

        it('leaves no audit row behind a refusal', async () => {
            const agent = await login();
            const id = await insertOutboxRow({ kind: 'qa.route.norow' });

            await agent
                .post(`/api/activity/dead-letters/${id}/retry`)
                .expect(409);
            await dispatcher.drain();

            expect(
                (await getActivityRows()).filter(
                    (row) => row.kind === 'outbox.event_retried'
                )
            ).toHaveLength(0);
        });
    });

    /**
     * Authorisation. `activity:manage` is admin-only and, unlike every other
     * route in this plugin, is **not** `activity:read` — a contributor who
     * could somehow read the list still may not re-run what is on it.
     */
    describe('authorisation [activity:I-14]', () => {
        it('rejects an unauthenticated request with 401', async () => {
            const id = await seedDeadLetter();
            await request(harness.server)
                .post(`/api/activity/dead-letters/${id}/retry`)
                .expect(401);
        });

        it('forbids a contributor with 403', async () => {
            const id = await seedDeadLetter();
            await seedActiveUser(harness.app, {
                email: 'retry-contributor@example.com',
                password: PASSWORD,
                role: 'contributor'
            });
            const agent = await login('retry-contributor@example.com');
            await agent
                .post(`/api/activity/dead-letters/${id}/retry`)
                .expect(403);
        });

        it('forbids a viewer with 403', async () => {
            const id = await seedDeadLetter();
            await seedActiveUser(harness.app, {
                email: 'retry-viewer@example.com',
                password: PASSWORD,
                role: 'viewer'
            });
            const agent = await login('retry-viewer@example.com');
            await agent
                .post(`/api/activity/dead-letters/${id}/retry`)
                .expect(403);
        });

        it('answers no bearer token, however it is scoped', async () => {
            // `activity:manage` is in no API-token scope at all, so this is
            // unreachable with a long-lived credential in somebody's CI
            // config. The token is proven live against the API it *is* for
            // first, so the 401 is the credential being refused rather than a
            // dead secret answering for itself.
            const id = await seedDeadLetter();
            const workspace = await seedWorkspace({
                name: 'Retry tokens',
                slug: 'retry-tokens'
            });
            await seedContentGrants(workspace.id, ['test_article']);

            const agent = await login();
            const minted = await agent
                .post('/api/api-tokens')
                .send({
                    name: 'ci',
                    workspaceIds: [workspace.id],
                    scope: 'full'
                })
                .expect(201);
            const secret = minted.body.secret as string;

            await request(harness.server)
                .get('/api/v1/content-types')
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            await request(harness.server)
                .post(`/api/activity/dead-letters/${id}/retry`)
                .set('Authorization', `Bearer ${secret}`)
                .set('X-Workspace-Id', workspace.id)
                .expect(401);

            expect((await readOutboxRow(id))?.attempts).toBe(
                MAX_DELIVERY_ATTEMPTS
            );
        });
    });

    /**
     * `OriginGuard`, three ways — hostile Origin refused, the configured app
     * origin allowed, no Origin allowed (a non-browser client). The shape is
     * `users/origin-guard.spec.ts`'s, and the reason is the same: a
     * state-changing route that quietly loses the guard, or one over-tightened
     * into breaking `curl`, are both invisible from the happy path.
     */
    describe('OriginGuard', () => {
        it('rejects a disallowed Origin with 403', async () => {
            const id = await seedDeadLetter();
            const agent = await login();

            await agent
                .post(`/api/activity/dead-letters/${id}/retry`)
                .set('Origin', EVIL_ORIGIN)
                .expect(403);

            // And nothing moved.
            expect((await readOutboxRow(id))?.attempts).toBe(
                MAX_DELIVERY_ATTEMPTS
            );
        });

        it('allows the configured app origin', async () => {
            const id = await seedDeadLetter();
            const agent = await login();

            await agent
                .post(`/api/activity/dead-letters/${id}/retry`)
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .expect(200);
        });

        it('allows a request with no Origin (non-browser client)', async () => {
            const id = await seedDeadLetter();
            const agent = await login();

            await agent
                .post(`/api/activity/dead-letters/${id}/retry`)
                .expect(200);
        });
    });
});
