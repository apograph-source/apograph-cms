/**
 * The response schemas of the activity plugin's four routes — its three reads
 * and the one write — as plain OpenAPI objects.
 *
 * `ActivityEventView`, `ActivityListView`, `DeadLetterListView` and
 * `DeadLetterRetryView` are TypeScript `interface`s (the last one a type
 * alias), so the OpenAPI scanner emits a bare
 * `{ '200': { description: '' } }` for all four — see
 * `packages/bootstrap/server/AGENTS.md` → "The response-schema gap". These are
 * what the `decorate` pass writes in their place.
 *
 * Pure: no document, no Nest, no database.
 */

/** A JSON Schema fragment, as it appears in the OpenAPI document. */
export type OpenApiSchema = Record<string, unknown>;

/** A `$ref` to one of {@link ACTIVITY_SCHEMAS}. */
export function ref(name: string): OpenApiSchema {
    return { $ref: `#/components/schemas/${name}` };
}

/**
 * The paging envelope both log routes answer in. Written twice rather than
 * `$ref`-ed into one, because the two routes are two different questions and
 * the envelope is the only thing they share.
 */
const PAGE_PROPERTIES: Record<string, OpenApiSchema> = {
    total: {
        type: 'integer',
        description:
            'Events matching the filters across every page, not just this one.'
    },
    page: { type: 'integer', description: 'The 1-based page number, echoed.' },
    pageSize: { type: 'integer', description: 'The page size, echoed.' }
};

/** The activity plugin's response schemas, keyed by component name. */
export const ACTIVITY_SCHEMAS: Record<string, OpenApiSchema> = {
    ActivityEvent: {
        type: 'object',
        description:
            'One recorded action. Mirrors the `activity_events` row minus `createdAt` — the immutable write time is an internal detail and never reaches the wire.',
        properties: {
            id: { type: 'string', format: 'uuid' },
            kind: {
                type: 'string',
                description:
                    'The `domain.action` kind, e.g. `user.signed_in` or `content.published`. Deliberately an open string: each emitting plugin owns its own kinds, so this is not an enum the document can close.'
            },
            subjectType: {
                type: 'string',
                description:
                    'What kind of thing was acted upon, e.g. `user`, `workspace`, `content_entry`.'
            },
            subjectId: {
                type: 'string',
                description:
                    'The acted-upon entity’s id. **Text, not a uuid** — subjects are not always uuid-keyed.'
            },
            actorId: {
                type: 'string',
                format: 'uuid',
                nullable: true,
                description:
                    'Who performed it, or `null` for a system-initiated event. Carries no foreign key: the actor may be deleted, and the audit row must outlive them.'
            },
            actorType: {
                type: 'string',
                nullable: true,
                description:
                    'What `actorId` names — `user` for a person, `api_token` for an external credential, `null` when there is no actor. Not constrained to those two: the column is open text, and a row written before it existed carries `null`.'
            },
            actorEmail: {
                type: 'string',
                nullable: true,
                description:
                    'Frozen email snapshot of the actor at record time, so the trail stays readable after the user row is gone. For an `api_token` actor this carries the token’s **label** instead — a token has no email.'
            },
            workspaceId: {
                type: 'string',
                format: 'uuid',
                nullable: true,
                description:
                    'The workspace the action happened in, or `null` when it belongs to none — an invite, a role change, the creation of a workspace itself.'
            },
            meta: {
                type: 'object',
                additionalProperties: true,
                nullable: true,
                description:
                    'Open per-kind payload, owned by the emitting plugin. No shape is promised here; a consumer branches on `kind` first.'
            },
            at: {
                type: 'string',
                format: 'date-time',
                description: 'Logical event time — what the list sorts on.'
            }
        },
        required: [
            'id',
            'kind',
            'subjectType',
            'subjectId',
            'actorId',
            'actorType',
            'actorEmail',
            'workspaceId',
            'meta',
            'at'
        ]
    },
    ActivityListView: {
        type: 'object',
        description: 'One page of audit events, newest first by default.',
        properties: {
            items: { type: 'array', items: ref('ActivityEvent') },
            ...PAGE_PROPERTIES
        },
        required: ['items', 'total', 'page', 'pageSize']
    },
    ActivityDeadLetter: {
        type: 'object',
        description:
            'One outbox event that exhausted its delivery attempts and is no longer retried. **The payload is deliberately absent** — it is arbitrary domain data, some of it user-authored, and this route answers "what is stuck", not "replay it".',
        properties: {
            id: {
                type: 'string',
                format: 'uuid',
                description:
                    'The event id — the handle `POST /activity/dead-letters/{id}/retry` takes.'
            },
            kind: {
                type: 'string',
                description: 'The event kind that could not be delivered.'
            },
            aggregateType: {
                type: 'string',
                description: 'The aggregate root’s type.'
            },
            aggregateId: {
                type: 'string',
                description: 'The aggregate root’s id.'
            },
            occurredAt: {
                type: 'string',
                format: 'date-time',
                description: 'When the fact occurred. The list orders on it.'
            },
            attempts: {
                type: 'integer',
                description:
                    'Delivery attempts spent before it parked — at or above the dispatcher’s ceiling, which is what makes it a dead letter.'
            },
            lastError: {
                type: 'string',
                nullable: true,
                description:
                    'Why the last attempt failed, truncated to roughly a line. Stack traces stay in the logs.'
            }
        },
        required: [
            'id',
            'kind',
            'aggregateType',
            'aggregateId',
            'occurredAt',
            'attempts',
            'lastError'
        ]
    },
    ActivityDeadLetterRetryView: {
        type: 'object',
        description:
            'A dead letter as it stands after a successful retry: the same fields the list carries, plus the delivery schedule. `attempts` is always `0` and `nextAttemptAt` always `null` — together they are what makes the row claimable again, and clearing only the first would leave it refused by the schedule. `lastError` is deliberately **preserved**: it is the only surviving record of why the event parked.',
        properties: {
            id: {
                type: 'string',
                format: 'uuid',
                description:
                    'The event id, unchanged — the row is reset in place rather than re-enqueued, because that id is the idempotency key every subscriber deduplicates on.'
            },
            kind: {
                type: 'string',
                description: 'The event kind that could not be delivered.'
            },
            aggregateType: {
                type: 'string',
                description: 'The aggregate root\u2019s type.'
            },
            aggregateId: {
                type: 'string',
                description: 'The aggregate root\u2019s id.'
            },
            occurredAt: {
                type: 'string',
                format: 'date-time',
                description:
                    'When the fact occurred. Untouched by the retry \u2014 the row returns to the head of an `ORDER BY occurred_at` claim.'
            },
            attempts: {
                type: 'integer',
                description: 'Always `0` after a successful retry.'
            },
            nextAttemptAt: {
                type: 'string',
                format: 'date-time',
                nullable: true,
                description:
                    'Earliest time the row may be claimed again; always `null` after a retry, which means "now".'
            },
            lastError: {
                type: 'string',
                nullable: true,
                description:
                    'Why the last attempt failed, kept rather than cleared.'
            }
        },
        required: [
            'id',
            'kind',
            'aggregateType',
            'aggregateId',
            'occurredAt',
            'attempts',
            'nextAttemptAt',
            'lastError'
        ]
    },
    ActivityDeadLetterListView: {
        type: 'object',
        description:
            'The parked events. A non-zero `total` means the audit trail is incomplete.',
        properties: {
            total: {
                type: 'integer',
                description:
                    'How many events have given up in total, ignoring `limit`.'
            },
            items: { type: 'array', items: ref('ActivityDeadLetter') }
        },
        required: ['total', 'items']
    }
};
