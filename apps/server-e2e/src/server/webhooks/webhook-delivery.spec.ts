import request from 'supertest';
import { verifySignature } from '@orthacms/webhooks-domain';
import { WEBHOOKS_DEFAULTS } from '@orthacms/webhooks-server';
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
    seedWorkspace,
    type SeededUser
} from '../../support/seed';
import {
    deliverWebhooks,
    getDeliveries,
    makeDeliveryDue,
    replayOutbox,
    startWebhookReceiver,
    type WebhookReceiver
} from '../../support/webhooks';

const ADMIN_EMAIL = 'webhook-delivery-admin@example.com';
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
 * The whole path, end to end: a content write raises a domain event, the outbox
 * fans it out into a delivery row, and the worker posts it to a real socket.
 *
 * This is the half no unit test reaches. The fan-out subscriber's own spec can
 * prove which endpoints it picks, and the worker's can prove what it does with
 * a status code — but only a booted app proves that the two hops are actually
 * connected, and only a real request proves that the signature covers the bytes
 * that went out rather than the object they were built from.
 */
describe('Webhook delivery', () => {
    let admin: SeededUser;
    let workspaceId: string;
    let receiver: WebhookReceiver;

    beforeEach(async () => {
        await resetDb();
        admin = await seedActiveUser(harness.app, {
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
        const workspace = await seedWorkspace({
            name: 'Delivery',
            slug: 'delivery'
        });
        workspaceId = workspace.id;
        await seedMembership(admin.id, workspaceId);
        await seedAllContentGrants(workspaceId);
        receiver = await startWebhookReceiver();
    });

    afterEach(async () => {
        await receiver.close();
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
        overrides: Record<string, unknown> = {}
    ): Promise<{ id: string; secret: string }> {
        const { body } = await client
            .post('/api/webhooks')
            .send({
                name: 'Receiver',
                url: receiver.url,
                allWorkspaces: true,
                ...overrides
            })
            .expect(201);
        return { id: body.endpoint.id, secret: body.secret };
    }

    /** Creates an article and publishes it. */
    async function publishArticle(
        client: Awaited<ReturnType<typeof api>>
    ): Promise<string> {
        const created = await client
            .post('/api/content/test_article')
            .send({ values: REQUIRED_VALUES })
            .expect(201);
        const id = created.body.id as string;
        await client
            .post(`/api/content/test_article/${id}/publish`)
            .expect(201);
        return id;
    }

    describe('a published entry', () => {
        it('reaches the receiver, signed, with its delivery headers', async () => {
            const client = await api();
            const { id: endpointId, secret } = await createEndpoint(client, {
                eventKinds: ['entry.published']
            });

            const entryId = await publishArticle(client);
            await drainOutbox(harness.app);
            await deliverWebhooks(harness.app);

            expect(receiver.received).toHaveLength(1);
            const [delivery] = receiver.received;

            expect(delivery.headers['x-orthacms-event']).toBe(
                'entry.published'
            );
            expect(delivery.headers['x-orthacms-workspace']).toBe(workspaceId);
            expect(delivery.headers['x-orthacms-attempt']).toBe('1');
            expect(delivery.headers['content-type']).toContain(
                'application/json'
            );

            // Verified against the raw bytes, which is the only thing a real
            // receiver has: a signature checked against a re-serialised object
            // would pass here and fail in the field on key order alone.
            expect(
                verifySignature(
                    secret,
                    delivery.headers['x-orthacms-signature'] as string,
                    delivery.raw
                )
            ).toBe(true);

            expect(delivery.body).toMatchObject({
                event: 'entry.published',
                workspaceId,
                actor: { id: admin.id, email: ADMIN_EMAIL },
                data: {
                    kind: 'content_entry',
                    id: entryId,
                    contentType: 'test_article'
                }
            });

            const [row] = await getDeliveries(endpointId);
            expect(row.status).toBe('succeeded');
            expect(row.lastStatusCode).toBe(200);
            expect(row.attempts).toBe(1);
        });

        it('carries a body that names its own delivery and event ids [webhooks:I-06]', async () => {
            const client = await api();
            const { id: endpointId } = await createEndpoint(client);

            await publishArticle(client);
            await drainOutbox(harness.app);
            await deliverWebhooks(harness.app);

            const rows = await getDeliveries(endpointId);
            const published = rows.find(
                (row) => row.eventKind === 'entry.published'
            );
            const sent = receiver.received.find(
                (delivery) => delivery.body['event'] === 'entry.published'
            );

            expect(sent?.body['id']).toBe(published?.id);
            expect(sent?.headers['x-orthacms-delivery']).toBe(published?.id);
            expect(sent?.headers['x-orthacms-event-id']).toBe(
                published?.eventId
            );
        });
    });

    describe('the subscription filters', () => {
        it('leaves out an event the endpoint did not subscribe to', async () => {
            const client = await api();
            const { id: endpointId } = await createEndpoint(client, {
                eventKinds: ['entry.deleted']
            });

            await publishArticle(client);
            await drainOutbox(harness.app);
            await deliverWebhooks(harness.app);

            expect(await getDeliveries(endpointId)).toEqual([]);
            expect(receiver.received).toEqual([]);
        });

        it('leaves out a content type the endpoint did not subscribe to', async () => {
            const client = await api();
            const { id: endpointId } = await createEndpoint(client, {
                contentTypes: ['test_author']
            });

            await publishArticle(client);
            await drainOutbox(harness.app);

            expect(await getDeliveries(endpointId)).toEqual([]);
        });

        it('leaves out a workspace the endpoint did not name', async () => {
            const client = await api();
            const other = await seedWorkspace({ name: 'Other', slug: 'other' });
            const { id: endpointId } = await createEndpoint(client, {
                allWorkspaces: false,
                workspaceIds: [other.id]
            });

            await publishArticle(client);
            await drainOutbox(harness.app);

            expect(await getDeliveries(endpointId)).toEqual([]);
        });

        it('never sends to a disabled endpoint', async () => {
            const client = await api();
            const { id: endpointId } = await createEndpoint(client, {
                enabled: false
            });

            await publishArticle(client);
            await drainOutbox(harness.app);
            await deliverWebhooks(harness.app);

            expect(await getDeliveries(endpointId)).toEqual([]);
            expect(receiver.received).toEqual([]);
        });
    });

    describe('idempotency', () => {
        it('queues nothing extra when the same event is delivered twice [webhooks:I-08]', async () => {
            const client = await api();
            const { id: endpointId } = await createEndpoint(client, {
                eventKinds: ['entry.published']
            });

            const entryId = await publishArticle(client);
            await drainOutbox(harness.app);
            const afterFirst = await getDeliveries(endpointId);
            expect(afterFirst).toHaveLength(1);

            // Outbox delivery is at-least-once, so a second delivery of the
            // same event is the ordinary consequence of a retry, not a
            // contrivance — and the fan-out's unique index is what has to make
            // it a no-op.
            await replayOutbox(entryId);
            await drainOutbox(harness.app);

            expect(await getDeliveries(endpointId)).toHaveLength(1);
        });
    });

    describe('a failing receiver', () => {
        it('is retried after a 500, then succeeds', async () => {
            const client = await api();
            const { id: endpointId } = await createEndpoint(client, {
                eventKinds: ['entry.published']
            });
            receiver.respondWith(500);

            await publishArticle(client);
            await drainOutbox(harness.app);
            await deliverWebhooks(harness.app);

            const [failed] = await getDeliveries(endpointId);
            expect(failed.status).toBe('failed');
            expect(failed.attempts).toBe(1);
            expect(failed.lastStatusCode).toBe(500);

            // The retry is scheduled minutes out by design; move it forward
            // rather than waiting, and let the attempt itself be real.
            await makeDeliveryDue(failed.id);
            await deliverWebhooks(harness.app);

            const [recovered] = await getDeliveries(endpointId);
            expect(recovered.status).toBe('succeeded');
            expect(recovered.attempts).toBe(2);
            expect(receiver.received[1].headers['x-orthacms-attempt']).toBe(
                '2'
            );
        });

        it('gives up immediately on a 404 rather than spending five more attempts', async () => {
            const client = await api();
            const { id: endpointId } = await createEndpoint(client, {
                eventKinds: ['entry.published']
            });
            receiver.respondWith(404);

            await publishArticle(client);
            await drainOutbox(harness.app);
            await deliverWebhooks(harness.app);

            const [row] = await getDeliveries(endpointId);
            expect(row.status).toBe('dead');
            expect(row.attempts).toBe(1);
        });
    });

    describe('the delivery log', () => {
        it('lists deliveries and serves one with its bodies', async () => {
            const client = await api();
            const { id: endpointId } = await createEndpoint(client, {
                eventKinds: ['entry.published']
            });

            await publishArticle(client);
            await drainOutbox(harness.app);
            await deliverWebhooks(harness.app);

            const { body: page } = await client
                .get(`/api/webhooks/${endpointId}/deliveries`)
                .expect(200);

            expect(page).toMatchObject({
                total: 1,
                page: 1,
                pageCount: 1
            });
            expect(page.items[0]).toMatchObject({
                eventKind: 'entry.published',
                status: 'succeeded',
                statusCode: 200
            });

            const { body: detail } = await client
                .get(
                    `/api/webhooks/${endpointId}/deliveries/${page.items[0].id}`
                )
                .expect(200);

            expect(detail.payload).toMatchObject({ event: 'entry.published' });
            expect(detail.responseSnippet).toBe('received');
        });

        it('keeps only the first responseSnippetBytes of the answer [webhooks:I-17]', async () => {
            const client = await api();
            const { id: endpointId } = await createEndpoint(client, {
                eventKinds: ['entry.published']
            });

            // Comfortably past the shipped 2 KiB cap, and a single repeated
            // character so the assertion is about length rather than encoding.
            // A receiver that answers with a gigabyte is otherwise able to
            // exhaust this process's memory from the far end of a connection
            // we initiated, which is what the cap exists for — so the fixture
            // has to be bigger than the cap or it proves nothing.
            const oversized = 'x'.repeat(10_000);
            receiver.respondWithBody(oversized);

            await publishArticle(client);
            await drainOutbox(harness.app);
            await deliverWebhooks(harness.app);

            const [row] = await getDeliveries(endpointId);
            const { body: detail } = await client
                .get(`/api/webhooks/${endpointId}/deliveries/${row.id}`)
                .expect(200);

            expect(detail.responseSnippet).toBe(
                'x'.repeat(WEBHOOKS_DEFAULTS.responseSnippetBytes)
            );
        });

        it('filters by state', async () => {
            const client = await api();
            const { id: endpointId } = await createEndpoint(client, {
                eventKinds: ['entry.published']
            });
            receiver.respondWith(404);

            await publishArticle(client);
            await drainOutbox(harness.app);
            await deliverWebhooks(harness.app);

            const { body: dead } = await client
                .get(`/api/webhooks/${endpointId}/deliveries?status=dead`)
                .expect(200);
            const { body: succeeded } = await client
                .get(`/api/webhooks/${endpointId}/deliveries?status=succeeded`)
                .expect(200);

            expect(dead.total).toBe(1);
            expect(succeeded.total).toBe(0);
        });

        it('does not resolve a delivery id belonging to another endpoint', async () => {
            const client = await api();
            const { id: first } = await createEndpoint(client, {
                eventKinds: ['entry.published']
            });
            const { body: secondCreated } = await client
                .post('/api/webhooks')
                .send({
                    name: 'Second',
                    url: receiver.url,
                    allWorkspaces: true,
                    eventKinds: ['entry.deleted']
                })
                .expect(201);

            await publishArticle(client);
            await drainOutbox(harness.app);
            const [delivery] = await getDeliveries(first);

            // Scoped to the endpoint in the path, so the log cannot be used to
            // probe for ids across endpoints.
            await client
                .get(
                    `/api/webhooks/${secondCreated.endpoint.id}/deliveries/${delivery.id}`
                )
                .expect(404);
        });
    });

    describe('sending one again', () => {
        it('queues a fresh delivery keeping the original event id [webhooks:I-06] [webhooks:I-08]', async () => {
            const client = await api();
            const { id: endpointId } = await createEndpoint(client, {
                eventKinds: ['entry.published']
            });

            await publishArticle(client);
            await drainOutbox(harness.app);
            await deliverWebhooks(harness.app);

            const [original] = await getDeliveries(endpointId);
            const { body: repeat } = await client
                .post(
                    `/api/webhooks/${endpointId}/deliveries/${original.id}/redeliver`
                )
                .expect(201);

            expect(repeat.id).not.toBe(original.id);
            // The event id is what a receiver deduplicates on, so a redelivery
            // it already handled is correctly ignored — which is the point of
            // the button when the receiver was the thing that was broken.
            expect(repeat.eventId).toBe(original.eventId);

            await deliverWebhooks(harness.app);
            expect(receiver.received).toHaveLength(2);
            expect(receiver.received[1].body['eventId']).toBe(original.eventId);
            expect(receiver.received[1].body['id']).toBe(repeat.id);
        });
    });

    describe('the test button', () => {
        it('posts a ping and reports the response without queuing anything', async () => {
            const client = await api();
            const { id: endpointId, secret } = await createEndpoint(client);

            const { body } = await client
                .post(`/api/webhooks/${endpointId}/test`)
                .expect(200);

            expect(body).toMatchObject({ ok: true, statusCode: 200 });
            expect(receiver.received).toHaveLength(1);
            expect(receiver.received[0].body['event']).toBe('ping');
            expect(
                verifySignature(
                    secret,
                    receiver.received[0].headers[
                        'x-orthacms-signature'
                    ] as string,
                    receiver.received[0].raw
                )
            ).toBe(true);

            // The person who pressed the button is waiting for the answer, so
            // it is sent synchronously and never becomes a log row they would
            // have to go and find.
            expect(await getDeliveries(endpointId)).toEqual([]);
        });

        it('reports a failing receiver rather than throwing', async () => {
            const client = await api();
            const { id: endpointId } = await createEndpoint(client);
            receiver.respondWith(503);

            const { body } = await client
                .post(`/api/webhooks/${endpointId}/test`)
                .expect(200);

            expect(body).toMatchObject({ ok: false, statusCode: 503 });
        });
    });
});
