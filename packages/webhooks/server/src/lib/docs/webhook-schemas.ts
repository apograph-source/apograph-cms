/**
 * The OpenAPI schemas the webhooks plugin contributes.
 *
 * Every response view in this package is a TypeScript `interface`, which is
 * erased before `@nestjs/swagger` ever runs — so the scanner emits an empty
 * `200` for each route and a reader learns nothing. These are the same shapes
 * written as plain schema objects, attached to the finished document by
 * {@link describeWebhooksApi}.
 *
 * The vocabularies (`DELIVERY_STATUSES`, the event catalogue) are **imported**
 * from `@orthacms/webhooks-domain` rather than restated: an enum in the
 * reference that drifts from the one the server validates against is worse
 * than a bare string, because it looks authoritative.
 */

import {
    DELIVERY_STATUSES,
    WEBHOOK_EVENT_GROUPS,
    WEBHOOK_EVENT_KINDS
} from '@orthacms/webhooks-domain';

/** A JSON Schema fragment, as it appears in the OpenAPI document. */
export type OpenApiSchema = Record<string, unknown>;

/** `#/components/schemas/<name>`. */
export function ref(name: string): OpenApiSchema {
    return { $ref: `#/components/schemas/${name}` };
}

const UUID: OpenApiSchema = { type: 'string', format: 'uuid' };
const DATE_TIME: OpenApiSchema = { type: 'string', format: 'date-time' };

/** A nullable `date-time`, which several delivery timestamps are. */
const NULLABLE_DATE_TIME: OpenApiSchema = {
    type: 'string',
    format: 'date-time',
    nullable: true
};

/** The delivery state vocabulary, straight from the domain. */
const DELIVERY_STATUS: OpenApiSchema = {
    type: 'string',
    enum: [...DELIVERY_STATUSES],
    description:
        '`succeeded` and `dead` are terminal; a `failed` delivery has another attempt scheduled.'
};

/**
 * The endpoint as every read returns it.
 *
 * The absent property is the point: there is no `secret` here, and no route
 * that answers with this schema can produce one. `secretHint` is the trailing
 * four characters, which is enough to tell two secrets apart and far too little
 * to shorten an attack on a 256-bit key.
 */
const ENDPOINT: OpenApiSchema = {
    type: 'object',
    description:
        'A configured webhook endpoint. Never carries the signing secret — see WebhookEndpointWithSecret.',
    required: [
        'id',
        'name',
        'url',
        'secretHint',
        'enabled',
        'eventKinds',
        'contentTypes',
        'allWorkspaces',
        'workspaceIds',
        'headers',
        'disabledReason',
        'consecutiveFailures',
        'createdAt',
        'updatedAt',
        'lastDelivery'
    ],
    properties: {
        id: UUID,
        name: { type: 'string' },
        url: {
            type: 'string',
            format: 'uri',
            description: 'Where deliveries are POSTed.'
        },
        secretHint: {
            type: 'string',
            description:
                'The last four characters of the signing secret. The secret itself is returned only on create and rotate.'
        },
        enabled: { type: 'boolean' },
        eventKinds: {
            type: 'array',
            items: { type: 'string', enum: [...WEBHOOK_EVENT_KINDS] },
            description:
                'The subscribed kinds. **Empty means every kind, including ones added later.**'
        },
        contentTypes: {
            type: 'array',
            items: { type: 'string' },
            description:
                'Content types this endpoint is scoped to. Empty means every type, including ones that do not exist yet.'
        },
        allWorkspaces: {
            type: 'boolean',
            description: 'True when the endpoint spans every workspace.'
        },
        workspaceIds: {
            type: 'array',
            items: UUID,
            description: 'Empty when `allWorkspaces` is true.'
        },
        headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Extra request headers sent with every delivery.'
        },
        disabledReason: {
            type: 'string',
            nullable: true,
            description:
                'Set when the endpoint switched itself off after consecutive failures; null otherwise.'
        },
        consecutiveFailures: { type: 'integer' },
        createdAt: DATE_TIME,
        updatedAt: DATE_TIME,
        // A bare `$ref`: OpenAPI 3.0 ignores keywords written beside one, so
        // "or null" lives on the referenced schema (`nullable`) rather than in
        // a sibling `description` that no reader would ever be shown.
        lastDelivery: ref('WebhookLastDelivery')
    }
};

/**
 * The one-line delivery summary the list column renders.
 *
 * Nullable through the property that references it rather than here: OpenAPI
 * 3.0 ignores sibling keywords next to a `$ref`, so `lastDelivery` is described
 * as `allOf`-free and this schema itself carries the `nullable`.
 */
const LAST_DELIVERY: OpenApiSchema = {
    type: 'object',
    nullable: true,
    required: ['id', 'status', 'eventKind', 'statusCode', 'createdAt'],
    properties: {
        id: UUID,
        status: DELIVERY_STATUS,
        eventKind: { type: 'string' },
        statusCode: {
            type: 'integer',
            nullable: true,
            description:
                'The receiver’s HTTP status, or null if nothing answered.'
        },
        createdAt: DATE_TIME
    }
};

/**
 * Create and rotate — and **only** those two — answer with the endpoint plus
 * the secret.
 *
 * A separate schema rather than an optional `secret` on {@link ENDPOINT}: an
 * optional field says "sometimes present, look and see", which is exactly the
 * belief that makes someone build a UI that reads it on a `GET` and shows an
 * empty box forever. Two schemas say which two responses carry it.
 */
const ENDPOINT_WITH_SECRET: OpenApiSchema = {
    type: 'object',
    description:
        'Returned by POST /webhooks and POST /webhooks/{id}/secret only. The secret is shown once and is never retrievable again — not by any read, and not by whoever created it.',
    required: ['endpoint', 'secret'],
    properties: {
        endpoint: ref('WebhookEndpoint'),
        secret: {
            type: 'string',
            pattern: '^whsec_',
            description:
                'The signing secret: `whsec_` followed by 32 random bytes, base64url-encoded. Store it now; every later read returns only `secretHint`.',
            example: 'whsec_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
        }
    }
};

/** The delivery row, without the bodies. */
const DELIVERY: OpenApiSchema = {
    type: 'object',
    description: 'One queued or completed delivery attempt-set.',
    required: [
        'id',
        'endpointId',
        'eventId',
        'eventKind',
        'workspaceId',
        'contentType',
        'status',
        'attempts',
        'nextAttemptAt',
        'statusCode',
        'error',
        'durationMs',
        'createdAt',
        'completedAt'
    ],
    properties: {
        id: {
            ...UUID,
            description:
                'The delivery’s own id, sent as `X-Ortha-Delivery`. A redelivery gets a new one.'
        },
        endpointId: UUID,
        eventId: {
            ...UUID,
            description:
                'The originating outbox event, sent as `X-Ortha-Event-Id`. Stable across every redelivery — this is the key a receiver deduplicates on.'
        },
        eventKind: { type: 'string' },
        workspaceId: { ...UUID, nullable: true },
        contentType: { type: 'string', nullable: true },
        status: DELIVERY_STATUS,
        attempts: { type: 'integer' },
        nextAttemptAt: {
            ...NULLABLE_DATE_TIME,
            description:
                'When the next attempt is due; null when none is scheduled.'
        },
        statusCode: { type: 'integer', nullable: true },
        error: { type: 'string', nullable: true },
        durationMs: { type: 'integer', nullable: true },
        createdAt: DATE_TIME,
        completedAt: NULLABLE_DATE_TIME
    }
};

/** The delivery row with the frozen request body and the response snippet. */
const DELIVERY_DETAIL: OpenApiSchema = {
    allOf: [
        ref('WebhookDelivery'),
        {
            type: 'object',
            required: ['payload', 'responseSnippet'],
            properties: {
                payload: ref('WebhookEnvelope'),
                responseSnippet: {
                    type: 'string',
                    nullable: true,
                    description:
                        'The first couple of kilobytes of the receiver’s response body, or null when nothing answered.'
                }
            }
        }
    ],
    description: 'A delivery with the exact body that was, or will be, posted.'
};

/**
 * The body a receiver is sent.
 *
 * Described here because it is frozen onto the delivery row and handed back by
 * the detail route, so the reference is where an integrator reads what their
 * own handler will be parsing. It carries **references, not content**: a
 * receiver reads the record back through the public API with its own token, so
 * the read still passes through visibility rules and audience entitlements.
 */
const ENVELOPE: OpenApiSchema = {
    type: 'object',
    description:
        'The JSON body POSTed to a receiver, signed with the endpoint’s secret in `X-Ortha-Signature`.',
    required: [
        'id',
        'event',
        'eventId',
        'occurredAt',
        'workspaceId',
        'actor',
        'data'
    ],
    properties: {
        id: {
            ...UUID,
            description: 'The delivery id. Changes on a redelivery.'
        },
        event: { type: 'string', description: 'The event kind.' },
        eventId: {
            ...UUID,
            description:
                'The outbox event id — stable across redeliveries, and the receiver’s deduplication key.'
        },
        occurredAt: {
            ...DATE_TIME,
            description:
                'Domain time: when the fact happened, not when it was sent.'
        },
        workspaceId: { ...UUID, nullable: true },
        actor: {
            type: 'object',
            nullable: true,
            description:
                'Who did it, or null for a token-authenticated or system write.',
            required: ['id', 'email'],
            properties: {
                id: UUID,
                email: { type: 'string', nullable: true }
            }
        },
        data: {
            type: 'object',
            description:
                'What the event is about: the aggregate’s `kind` and `id`, plus whatever else the kind carries.',
            required: ['kind', 'id'],
            properties: {
                kind: {
                    type: 'string',
                    description: 'The aggregate type, e.g. `content_entry`.',
                    example: 'content_entry'
                },
                id: UUID
            },
            additionalProperties: true
        }
    }
};

/** One page of the delivery log. */
const DELIVERY_PAGE: OpenApiSchema = {
    type: 'object',
    required: ['items', 'total', 'page', 'pageSize', 'pageCount'],
    properties: {
        items: { type: 'array', items: ref('WebhookDelivery') },
        total: { type: 'integer' },
        page: { type: 'integer' },
        pageSize: { type: 'integer' },
        pageCount: { type: 'integer' }
    }
};

/** What "Send test" reports. Synchronous — nothing is queued. */
const TEST_RESULT: OpenApiSchema = {
    type: 'object',
    description:
        'The outcome of a synthetic `ping`, reported synchronously. It is not queued and does not count towards automatic disabling.',
    required: ['ok', 'statusCode', 'error', 'durationMs', 'responseSnippet'],
    properties: {
        ok: {
            type: 'boolean',
            description: 'Whether the receiver answered 2xx.'
        },
        statusCode: { type: 'integer', nullable: true },
        error: {
            type: 'string',
            nullable: true,
            description: 'Why it failed, when it did.'
        },
        durationMs: { type: 'integer' },
        responseSnippet: { type: 'string', nullable: true }
    }
};

/** One entry of the subscribable-event catalogue. */
const EVENT_DESCRIPTOR: OpenApiSchema = {
    type: 'object',
    description:
        'One kind an endpoint may subscribe to. Read this rather than compiling a list into a client: a newer server offers the kinds it actually knows about.',
    required: [
        'kind',
        'group',
        'label',
        'scopedByContentType',
        'carriesWorkspace'
    ],
    properties: {
        kind: { type: 'string', enum: [...WEBHOOK_EVENT_KINDS] },
        group: { type: 'string', enum: [...WEBHOOK_EVENT_GROUPS] },
        label: { type: 'string', description: 'Default English label.' },
        scopedByContentType: {
            type: 'boolean',
            description:
                'Whether an endpoint’s content-type filter applies to this kind.'
        },
        carriesWorkspace: {
            type: 'boolean',
            description:
                'Whether an endpoint’s workspace filter applies to this kind.'
        }
    }
};

/** Every schema this plugin adds, keyed by component name. */
export function buildWebhookSchemas(): Record<string, OpenApiSchema> {
    return {
        WebhookEndpoint: ENDPOINT,
        WebhookLastDelivery: LAST_DELIVERY,
        WebhookEndpointWithSecret: ENDPOINT_WITH_SECRET,
        WebhookDelivery: DELIVERY,
        WebhookDeliveryDetail: DELIVERY_DETAIL,
        WebhookDeliveryPage: DELIVERY_PAGE,
        WebhookEnvelope: ENVELOPE,
        WebhookTestResult: TEST_RESULT,
        WebhookEventDescriptor: EVENT_DESCRIPTOR
    };
}
