import type { DomainEvent } from '@orthacms/database';
import type {
    WebhookActor,
    WebhookRoutableEvent,
    WebhookSourceEvent
} from '@orthacms/webhooks-domain';

/**
 * Turns an outbox `DomainEvent` into the shapes the webhooks domain works in.
 *
 * This is the only file that knows both vocabularies. Keeping it at the edge is
 * what lets `@orthacms/webhooks-domain` — and therefore the contract external
 * receivers depend on — stay ignorant of how the outbox happens to store an
 * event today.
 */

/** The payload keys that are envelope metadata rather than event data. */
const ENVELOPE_KEYS = new Set(['actor', 'workspaceId']);

/** The routing facts, for the subscription filters. */
export function toRoutableEvent(event: DomainEvent): WebhookRoutableEvent {
    return {
        kind: event.kind,
        workspaceId: readString(event.payload, 'workspaceId'),
        contentType: readString(event.payload, 'contentType')
    };
}

/**
 * The full source event, for the envelope.
 *
 * `actor` and `workspaceId` are lifted out of the payload into the envelope's
 * own fields, so `data` carries what the event kind is *about* and nothing that
 * every event has.
 */
export function toSourceEvent(event: DomainEvent): WebhookSourceEvent {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event.payload)) {
        if (!ENVELOPE_KEYS.has(key)) data[key] = value;
    }

    return {
        eventId: event.eventId,
        kind: event.kind,
        occurredAt: event.occurredAt,
        workspaceId: readString(event.payload, 'workspaceId'),
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        data,
        actor: readActor(event.payload)
    };
}

/** A string payload key, or `null` when it is absent or the wrong shape. */
function readString(
    payload: Record<string, unknown>,
    key: string
): string | null {
    const value = payload[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The acting user off the payload, as `attachActor` wrote it.
 *
 * Absent for a write made with an API token or by the system, and `null` is the
 * honest answer there — naming a user who did not do it would be worse than
 * saying nothing.
 */
function readActor(payload: Record<string, unknown>): WebhookActor | null {
    const actor = payload['actor'];
    if (typeof actor !== 'object' || actor === null) return null;

    const record = actor as Record<string, unknown>;
    const id = record['id'];
    if (typeof id !== 'string') return null;

    const email = record['email'];
    return { id, email: typeof email === 'string' ? email : null };
}
