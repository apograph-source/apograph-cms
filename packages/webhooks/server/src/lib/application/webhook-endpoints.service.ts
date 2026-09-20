import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
    assertUrlShape,
    buildEnvelope,
    isAllowedCustomHeader,
    WebhookUrlRejectedError
} from '@orthacms/webhooks-domain';
import {
    WebhookDeliveryNotFoundError,
    WebhookEndpointNotFoundError
} from '../domain/errors';
import { generateSecret } from '../domain/webhook-secret';
import type {
    WebhookDeliveryDetailView,
    WebhookDeliveryPage,
    WebhookDeliveryView,
    WebhookEndpointView,
    WebhookTestResult
} from '../domain/webhook-views';
import {
    WebhookDeliveryRepository,
    type DeliveryListQuery
} from '../infrastructure/webhook-delivery.repository';
import {
    WebhookEndpointRepository,
    type EndpointWriteModel
} from '../infrastructure/webhook-endpoint.repository';
import { WebhookHttpClient } from '../infrastructure/webhook-http.client';
import { InjectWebhooksConfig } from '../webhooks.tokens';
import type { ResolvedWebhooksConfig } from '../types/webhooks-config';

/** An endpoint plus the secret, returned only from create and rotate. */
export interface WebhookEndpointWithSecret {
    endpoint: WebhookEndpointView;
    /** The plaintext signing secret. This is the only time it is ever returned. */
    secret: string;
}

/** Orchestration over the two repositories. */
@Injectable()
export class WebhookEndpointsService {
    constructor(
        private readonly endpoints: WebhookEndpointRepository,
        private readonly deliveries: WebhookDeliveryRepository,
        private readonly http: WebhookHttpClient,
        @InjectWebhooksConfig()
        private readonly config: ResolvedWebhooksConfig
    ) {}

    /** Every endpoint, newest first. */
    list(): Promise<WebhookEndpointView[]> {
        return this.endpoints.list();
    }

    /** One endpoint. Throws {@link WebhookEndpointNotFoundError} when absent. */
    async get(id: string): Promise<WebhookEndpointView> {
        const endpoint = await this.endpoints.findById(id);
        if (!endpoint) throw new WebhookEndpointNotFoundError(id);
        return endpoint;
    }

    /**
     * Creates an endpoint and mints its secret.
     *
     * The URL is checked here as well as in the worker so a typo is refused in
     * the dialog rather than discovered in the delivery log an hour later.
     */
    async create(
        model: EndpointWriteModel,
        createdBy: string | null
    ): Promise<WebhookEndpointWithSecret> {
        this.assertWritable(model);

        const { secret } = generateSecret();
        const id = await this.endpoints.create(model, secret, createdBy);
        return { endpoint: await this.get(id), secret };
    }

    /** Applies a full write model to an existing endpoint. */
    async update(
        id: string,
        model: EndpointWriteModel
    ): Promise<WebhookEndpointView> {
        if (!(await this.endpoints.exists(id))) {
            throw new WebhookEndpointNotFoundError(id);
        }
        this.assertWritable(model);

        await this.endpoints.update(id, model);
        return this.get(id);
    }

    /** Deletes the endpoint and, by cascade, its delivery log. */
    async delete(id: string): Promise<void> {
        if (!(await this.endpoints.exists(id))) {
            throw new WebhookEndpointNotFoundError(id);
        }
        await this.endpoints.delete(id);
    }

    /**
     * Rotates the signing secret.
     *
     * The new secret takes effect immediately, including for deliveries already
     * queued — they are signed when they are sent, not when they were queued.
     * A receiver therefore needs the new secret in place before rotating, which
     * is what the dialog says.
     */
    async rotateSecret(id: string): Promise<WebhookEndpointWithSecret> {
        if (!(await this.endpoints.exists(id))) {
            throw new WebhookEndpointNotFoundError(id);
        }

        const { secret } = generateSecret();
        await this.endpoints.replaceSecret(id, secret);
        return { endpoint: await this.get(id), secret };
    }

    /**
     * Sends a synthetic `ping` and reports the result **synchronously**.
     *
     * Deliberately not queued: the person pressing "Send test" is waiting for
     * an answer, and a row in the log they would have to go and find is not
     * one. It is also why a test never counts against the endpoint's
     * consecutive-failure budget — it is a probe, not traffic.
     */
    async sendTest(id: string): Promise<WebhookTestResult> {
        const endpoint = await this.endpoints.findForDelivery(id);
        if (!endpoint) throw new WebhookEndpointNotFoundError(id);

        const deliveryId = randomUUID();
        const eventId = randomUUID();
        const envelope = buildEnvelope(deliveryId, {
            eventId,
            kind: 'ping',
            occurredAt: new Date(),
            workspaceId: null,
            aggregateType: 'webhook_endpoint',
            aggregateId: id,
            data: { endpointName: endpoint.name },
            actor: null
        });

        const response = await this.http.send({
            url: endpoint.url,
            secret: endpoint.secret,
            headers: endpoint.headers,
            body: envelope,
            eventKind: 'ping',
            deliveryId,
            eventId,
            workspaceId: null,
            attempt: 1
        });

        return {
            ok:
                response.statusCode !== null &&
                response.statusCode >= 200 &&
                response.statusCode < 300,
            statusCode: response.statusCode,
            error: response.error,
            durationMs: response.durationMs,
            responseSnippet: response.responseSnippet
        };
    }

    /** One page of an endpoint's delivery log. */
    async listDeliveries(
        endpointId: string,
        query: DeliveryListQuery
    ): Promise<WebhookDeliveryPage> {
        if (!(await this.endpoints.exists(endpointId))) {
            throw new WebhookEndpointNotFoundError(endpointId);
        }
        return this.deliveries.list(endpointId, query);
    }

    /** One delivery with its bodies. */
    async getDelivery(
        endpointId: string,
        deliveryId: string
    ): Promise<WebhookDeliveryDetailView> {
        const delivery = await this.deliveries.findDetail(
            endpointId,
            deliveryId
        );
        if (!delivery) throw new WebhookDeliveryNotFoundError(deliveryId);
        return delivery;
    }

    /**
     * Queues the same event again as a fresh delivery.
     *
     * The body is copied rather than rebuilt, so the receiver gets exactly what
     * it was sent before — with one substitution: `id` becomes the new delivery
     * id, because that is also what the `X-Ortha-Delivery` header will say, and
     * a body naming a different delivery than its own header is a bug waiting
     * to be found by whoever writes the receiver.
     *
     * `eventId` is kept, so a receiver that deduplicates on it correctly
     * ignores the repeat — which is exactly what a redelivery is *for* when the
     * receiver, not the event, was the thing that was broken. Keeping it is
     * only possible because `redeliveryOf` exempts the row from the partial
     * unique index that makes fan-out idempotent.
     */
    async redeliver(
        endpointId: string,
        deliveryId: string
    ): Promise<WebhookDeliveryView> {
        const original = await this.getDelivery(endpointId, deliveryId);

        const id = randomUUID();
        await this.deliveries.enqueueOne({
            id,
            endpointId,
            eventId: original.eventId,
            eventKind: original.eventKind,
            workspaceId: original.workspaceId,
            contentType: original.contentType,
            payload: withDeliveryId(original.payload, id),
            // Points at the delivery this repeats — both as provenance in the
            // log and as the exemption from the fan-out unique index.
            redeliveryOf: original.id
        });

        const queued = await this.deliveries.findDetail(endpointId, id);
        // The row was just written in the same request; its absence would mean
        // the endpoint was deleted underneath us.
        if (!queued) throw new WebhookEndpointNotFoundError(endpointId);
        return queued;
    }

    /**
     * Refuses a write that the delivery path would only reject later.
     *
     * Both checks are also enforced downstream — the URL on every send, the
     * headers when the request is built — because a row can predate a policy
     * change. Doing them here is what turns a silent failure in the log into a
     * message in the form.
     */
    private assertWritable(model: EndpointWriteModel): void {
        assertUrlShape(model.url, {
            allowInsecureUrls: this.config.allowInsecureUrls,
            allowPrivateNetworks: this.config.allowPrivateNetworks
        });

        for (const name of Object.keys(model.headers)) {
            if (!isAllowedCustomHeader(name)) {
                throw new WebhookUrlRejectedError(
                    `The header "${name}" cannot be set on a webhook — it is reserved for the delivery's own metadata.`
                );
            }
        }
    }
}

/**
 * The stored envelope with its `id` swapped for this delivery's, leaving
 * everything else — `eventId` above all — exactly as it was sent.
 */
function withDeliveryId(payload: unknown, deliveryId: string): unknown {
    if (typeof payload !== 'object' || payload === null) return payload;
    return { ...(payload as Record<string, unknown>), id: deliveryId };
}
