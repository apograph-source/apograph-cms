import {
    Injectable,
    Logger,
    type OnApplicationBootstrap
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
    OutboxDispatcher,
    type DomainEvent,
    type DomainEventSubscriber
} from '@orthacms/database';
import {
    SUBSCRIBABLE_OUTBOX_KINDS,
    buildEnvelope,
    matches
} from '@orthacms/webhooks-domain';
import { WebhookDeliveryRepository } from './webhook-delivery.repository';
import { WebhookEndpointRepository } from './webhook-endpoint.repository';
import { toRoutableEvent, toSourceEvent } from './event-mapping';

/**
 * Turns a domain event into queued deliveries — and does **nothing else**.
 *
 * This subscriber runs inside `OutboxDispatcher`'s claim transaction, which is
 * the single most important fact about it. One `SELECT` over the endpoints and
 * one batched `INSERT` is all it may cost: an outgoing HTTP request here would
 * hold that transaction and its pool client open for a stranger's response
 * time, and a thrown error would count against the **outbox row's** attempt
 * budget, eventually dead-lettering an event the activity log and the alarms
 * evaluator were also waiting for.
 *
 * The actual sending is {@link WebhookDeliveryWorker}'s job, with no
 * transaction open.
 *
 * Delivery from the outbox is at-least-once, so this may see the same event
 * twice; `unique(endpoint_id, event_id)` on the delivery row makes the repeat a
 * no-op rather than a second POST.
 */
@Injectable()
export class WebhookFanoutSubscriber
    implements DomainEventSubscriber, OnApplicationBootstrap
{
    private readonly logger = new Logger(WebhookFanoutSubscriber.name);

    /** The dispatcher's delivery allow-list — the catalogue, minus `ping`. */
    readonly kinds = SUBSCRIBABLE_OUTBOX_KINDS;

    constructor(
        private readonly dispatcher: OutboxDispatcher,
        private readonly endpoints: WebhookEndpointRepository,
        private readonly deliveries: WebhookDeliveryRepository
    ) {}

    /** Registers with the dispatcher once the app is up. */
    onApplicationBootstrap(): void {
        this.dispatcher.register(this);
    }

    /** Queues one delivery per endpoint that subscribes to this event. */
    async handle(event: DomainEvent): Promise<void> {
        const subscriptions = await this.endpoints.listSubscriptions();
        if (subscriptions.length === 0) return;

        const routable = toRoutableEvent(event);
        const interested = subscriptions.filter((subscription) =>
            matches(subscription, routable)
        );
        if (interested.length === 0) return;

        const source = toSourceEvent(event);
        const queued = await this.deliveries.enqueue(
            interested.map((subscription) => {
                // The id is minted here rather than by the database because the
                // envelope carries it: the body and the `X-Ortha-Delivery`
                // header have to name the same delivery.
                const deliveryId = randomUUID();
                return {
                    id: deliveryId,
                    endpointId: subscription.id,
                    eventId: event.eventId,
                    eventKind: event.kind,
                    workspaceId: routable.workspaceId,
                    contentType: routable.contentType,
                    payload: buildEnvelope(deliveryId, source)
                };
            })
        );

        if (queued > 0) {
            this.logger.debug(
                `Queued ${queued} webhook deliver${queued === 1 ? 'y' : 'ies'} for ${event.kind}.`
            );
        }
    }
}
