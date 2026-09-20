import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { drainOutbox } from '../../support/outbox';
import {
    resetDb,
    seedActiveUser,
    seedAllContentGrants,
    seedMembership,
    seedWorkspace
} from '../../support/seed';
import {
    deliverWebhooks,
    getDeliveries,
    observeDeliveryRow,
    recordWebhookSends,
    startWebhookReceiver,
    type DeliveryRowObservation,
    type WebhookReceiver
} from '../../support/webhooks';

const ADMIN_EMAIL = 'webhook-boundary-admin@example.com';
const PASSWORD = 'SecurePass123!';

/** The values every fixture article needs in order to publish at all. */
const REQUIRED_VALUES = { text: 'A body', select: 'article' };

let harness: TestApp;

beforeAll(async () => {
    harness = await createTestApp();
});

afterAll(async () => {
    await closeTestApp(harness);
});

/**
 * ADR-0016's structural rule, observed rather than asserted about.
 *
 * The rule has two halves and they fail in different places, so they are pinned
 * separately. **Fan-out** runs inside `OutboxDispatcher`'s claim transaction —
 * so it must make no request at all, because one would hold that transaction
 * and its pool client for a stranger's response time and, on a throw, spend the
 * *outbox row's* attempt budget on someone else's downtime. **Delivery** is the
 * mirror image: the claim commits first, and the POST happens with nothing open.
 *
 * Both halves are invisible to the ordinary suites, which only ever look at the
 * end state — a row that says `succeeded` says nothing about what was open
 * while it was being sent. What makes these two tests different is that they
 * look from *outside* the connection doing the work: a second connection can
 * see a committed claim and cannot see an uncommitted one, and `FOR UPDATE
 * NOWAIT` fails outright against a transaction that still holds the row.
 */
describe('The webhook transaction boundary', () => {
    let workspaceId: string;
    let receiver: WebhookReceiver | null = null;

    beforeEach(async () => {
        await resetDb();
        const admin = await seedActiveUser(harness.app, {
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
        const workspace = await seedWorkspace({
            name: 'Boundary',
            slug: 'boundary'
        });
        workspaceId = workspace.id;
        await seedMembership(admin.id, workspaceId);
        await seedAllContentGrants(workspaceId);
        receiver = null;
    });

    afterEach(async () => {
        await receiver?.close();
    });

    /** A logged-in agent carrying the workspace header the content routes need. */
    async function api() {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email: ADMIN_EMAIL, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', workspaceId);
        return agent;
    }

    /** Registers an endpoint pointed at the fixture receiver. */
    async function createEndpoint(
        client: Awaited<ReturnType<typeof api>>,
        url: string
    ): Promise<string> {
        const { body } = await client
            .post('/api/webhooks')
            .send({
                name: 'Receiver',
                url,
                allWorkspaces: true,
                eventKinds: ['entry.published']
            })
            .expect(201);
        return body.endpoint.id;
    }

    /** Creates an article and publishes it. */
    async function publishArticle(
        client: Awaited<ReturnType<typeof api>>
    ): Promise<void> {
        const created = await client
            .post('/api/content/test_article')
            .send({ values: REQUIRED_VALUES })
            .expect(201);
        await client
            .post(`/api/content/test_article/${created.body.id}/publish`)
            .expect(201);
    }

    it('queues from inside the drain without making a request [webhooks:I-02]', async () => {
        const hook = await startWebhookReceiver();
        receiver = hook;

        // Armed before anything is published: `UnitOfWork.run` drains the
        // outbox as soon as the publish commits, so fan-out has already
        // happened by the time the request returns. A recorder installed
        // afterwards would be watching the wrong window.
        const sends = recordWebhookSends(harness.app);

        try {
            const client = await api();
            const endpointId = await createEndpoint(client, hook.url);
            await publishArticle(client);
            await drainOutbox(harness.app);

            // The two ways the subscriber could have reached the network: the
            // sanctioned client, and a socket of its own. Neither, and the
            // distinction matters — "the receiver saw nothing" alone would also
            // be true of a subscriber that tried and failed, which is the case
            // that costs the outbox row an attempt.
            expect(sends.sent).toEqual([]);
            expect(hook.received).toEqual([]);

            const [queued] = await getDeliveries(endpointId);
            expect(queued.status).toBe('pending');

            // …and the fixture is not vacuous. The very same row reaches the
            // receiver the moment the worker — which holds no transaction —
            // runs, so "no request" above is the subscriber declining to make
            // one rather than there having been nothing to send.
            await deliverWebhooks(harness.app);

            expect(sends.sent).toEqual([queued.id]);
            expect(hook.received).toHaveLength(1);
        } finally {
            sends.restore();
        }
    });

    it('has committed the claim before the receiver answers [webhooks:I-02]', async () => {
        const observations: DeliveryRowObservation[] = [];

        // Observed from the far end of a real socket, while the worker is
        // blocked on `await request()` — the one moment "no transaction is open
        // while a receiver is answering" is a statement about the present.
        const hook = await startWebhookReceiver({
            onRequest: async (delivery) => {
                observations.push(
                    await observeDeliveryRow(
                        delivery.headers['x-ortha-delivery'] as string
                    )
                );
            }
        });
        receiver = hook;

        const client = await api();
        const endpointId = await createEndpoint(client, hook.url);
        await publishArticle(client);
        await drainOutbox(harness.app);
        await deliverWebhooks(harness.app);

        expect(observations).toHaveLength(1);
        const [observed] = observations;

        // Committed: `delivering` is written by the claim's own transaction, so
        // a second connection can only read it once that transaction ended.
        // Were the send moved inside the claim, this would still read
        // `pending` — the row's last committed version.
        expect(observed.status).toBe('delivering');
        expect(observed.claimed).toBe(true);

        // Closed, not merely committed: `FOR UPDATE NOWAIT` raises 55P03
        // against a transaction that still holds the row, so this fails even
        // for an implementation that contrived to make the status visible.
        expect(observed.lockError).toBeNull();
        expect(observed.lockable).toBe(true);

        // And the delivery really did happen — otherwise the hook above could
        // have been fired by anything.
        const [row] = await getDeliveries(endpointId);
        expect(row.status).toBe('succeeded');
    });
});
