import type { DomainEvent } from '@orthacms/database';
import { WebhookFanoutSubscriber } from './webhook-fanout.subscriber';
import type {
    DeliveryToQueue,
    WebhookDeliveryRepository
} from './webhook-delivery.repository';
import type {
    EndpointSubscriptionRow,
    WebhookEndpointRepository
} from './webhook-endpoint.repository';

const WORKSPACE = '11111111-1111-1111-1111-111111111111';
const OTHER_WORKSPACE = '22222222-2222-2222-2222-222222222222';

function subscription(
    overrides: Partial<EndpointSubscriptionRow> = {}
): EndpointSubscriptionRow {
    return {
        id: 'endpoint-1',
        enabled: true,
        allWorkspaces: false,
        workspaceIds: [WORKSPACE],
        eventKinds: [],
        contentTypes: [],
        ...overrides
    };
}

function event(overrides: Partial<DomainEvent> = {}): DomainEvent {
    return {
        eventId: 'event-1',
        kind: 'entry.published',
        aggregateType: 'content_entry',
        aggregateId: 'entry-1',
        occurredAt: new Date('2026-08-29T10:00:00.000Z'),
        payload: {
            contentType: 'article',
            workspaceId: WORKSPACE,
            actor: { id: 'user-1', email: 'editor@example.com' }
        },
        ...overrides
    };
}

/** The subscriber under test, plus the queue it wrote to. */
function build(subscriptions: EndpointSubscriptionRow[]) {
    const queued: DeliveryToQueue[][] = [];

    const endpoints = {
        listSubscriptions: jest.fn().mockResolvedValue(subscriptions)
    } as unknown as WebhookEndpointRepository;

    const deliveries = {
        enqueue: jest.fn(async (rows: DeliveryToQueue[]) => {
            queued.push(rows);
            return rows.length;
        })
    } as unknown as WebhookDeliveryRepository;

    const dispatcher = { register: jest.fn() };

    const subscriber = new WebhookFanoutSubscriber(
        dispatcher as never,
        endpoints,
        deliveries
    );

    return { subscriber, deliveries, dispatcher, queued };
}

describe('WebhookFanoutSubscriber', () => {
    it('registers itself with the dispatcher on bootstrap', () => {
        const { subscriber, dispatcher } = build([]);
        subscriber.onApplicationBootstrap();
        expect(dispatcher.register).toHaveBeenCalledWith(subscriber);
    });

    it('subscribes to the catalogue but never to ping [webhooks:I-05]', () => {
        const { subscriber } = build([]);
        expect(subscriber.kinds).toContain('entry.published');
        // `ping` is addressed to one endpoint by hand and never reaches the
        // outbox; subscribing to it would be dead code at best.
        expect(subscriber.kinds).not.toContain('ping');
    });

    it('queues one delivery per interested endpoint [webhooks:I-01]', async () => {
        const { subscriber, queued } = build([
            subscription({ id: 'a' }),
            subscription({ id: 'b', allWorkspaces: true, workspaceIds: [] })
        ]);

        await subscriber.handle(event());

        expect(queued[0].map((row) => row.endpointId)).toEqual(['a', 'b']);
    });

    it('leaves out an endpoint the event does not match', async () => {
        const { subscriber, queued } = build([
            subscription({ id: 'a', workspaceIds: [OTHER_WORKSPACE] }),
            subscription({ id: 'b', eventKinds: ['entry.deleted'] }),
            subscription({ id: 'c', contentTypes: ['product'] })
        ]);

        await subscriber.handle(event());

        expect(queued).toEqual([]);
    });

    it('does not touch the queue when nothing is configured', async () => {
        const { subscriber, deliveries } = build([]);
        await subscriber.handle(event());
        expect(deliveries.enqueue).not.toHaveBeenCalled();
    });

    describe('the envelope it freezes', () => {
        it('carries the delivery id that the row will have', async () => {
            const { subscriber, queued } = build([subscription()]);
            await subscriber.handle(event());

            const [row] = queued[0];
            expect((row.payload as { id: string }).id).toBe(row.id);
        });

        it('lifts the actor and workspace out of data', async () => {
            const { subscriber, queued } = build([subscription()]);
            await subscriber.handle(event());

            expect(queued[0][0].payload).toEqual({
                id: expect.any(String),
                event: 'entry.published',
                eventId: 'event-1',
                occurredAt: '2026-08-29T10:00:00.000Z',
                workspaceId: WORKSPACE,
                actor: { id: 'user-1', email: 'editor@example.com' },
                data: {
                    kind: 'content_entry',
                    id: 'entry-1',
                    contentType: 'article'
                }
            });
        });

        it('reports no actor rather than a wrong one for a token write', async () => {
            const { subscriber, queued } = build([subscription()]);
            await subscriber.handle(
                event({
                    payload: { contentType: 'article', workspaceId: WORKSPACE }
                })
            );

            expect(
                (queued[0][0].payload as { actor: unknown }).actor
            ).toBeNull();
        });
    });

    it('gives each endpoint its own delivery id', async () => {
        const { subscriber, queued } = build([
            subscription({ id: 'a' }),
            subscription({ id: 'b' })
        ]);

        await subscriber.handle(event());

        const [first, second] = queued[0];
        expect(first.id).not.toBe(second.id);
        // …but the same event id, which is what a receiver deduplicates on and
        // what makes a re-delivered outbox event a no-op.
        expect(first.eventId).toBe(second.eventId);
    });

    it('denormalises the routing columns onto the row', async () => {
        const { subscriber, queued } = build([subscription()]);
        await subscriber.handle(event());

        expect(queued[0][0]).toMatchObject({
            eventKind: 'entry.published',
            workspaceId: WORKSPACE,
            contentType: 'article'
        });
    });

    it('routes an entry with no workspace only to an all-workspaces endpoint [webhooks:I-04]', async () => {
        const { subscriber, queued } = build([
            subscription({ id: 'named' }),
            subscription({ id: 'all', allWorkspaces: true, workspaceIds: [] })
        ]);

        await subscriber.handle(event({ payload: { contentType: 'article' } }));

        expect(queued[0].map((row) => row.endpointId)).toEqual(['all']);
    });
});
