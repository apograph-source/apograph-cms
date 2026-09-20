/**
 * The body a webhook POST carries, and how one is built from a domain event.
 *
 * Framework-free on purpose: the server maps `@orthacms/database`'s
 * `DomainEvent` into {@link WebhookSourceEvent} at the edge, so this file — and
 * therefore the contract external receivers depend on — never learns what the
 * outbox looks like.
 */

/** The acting user, as it reaches a receiver. */
export interface WebhookActor {
    /** The user's id. */
    id: string;
    /** The user's email, or `null` when unknown. */
    email: string | null;
}

/** The event data a webhook is built from — a domain event, minus the plumbing. */
export interface WebhookSourceEvent {
    /** The outbox event's id. Doubles as the receiver's deduplication key. */
    eventId: string;
    /** The dotted kind, e.g. `entry.published`. */
    kind: string;
    /** When the fact occurred (domain time, not delivery time). */
    occurredAt: Date;
    /** The owning workspace, or `null` for an entry that has none. */
    workspaceId: string | null;
    /** The aggregate the event is about, e.g. `content_entry`. */
    aggregateType: string;
    /** The aggregate's id. */
    aggregateId: string;
    /** Everything else the event kind carries, already stripped of `actor`. */
    data: Record<string, unknown>;
    /** Who did it, or `null` for a token-authenticated or system write. */
    actor: WebhookActor | null;
}

/** The JSON body posted to a receiver. */
export interface WebhookEnvelope {
    /** The delivery's id — changes on a redelivery, unlike `eventId`. */
    id: string;
    /** The event kind. */
    event: string;
    /** The originating outbox event's id — stable across every redelivery. */
    eventId: string;
    /** ISO-8601 domain time. */
    occurredAt: string;
    /** Owning workspace, or `null`. */
    workspaceId: string | null;
    /** Acting user, or `null`. */
    actor: WebhookActor | null;
    /** What the event is about. */
    data: {
        /** The aggregate type, e.g. `content_entry`. */
        kind: string;
        /** The aggregate's id. */
        id: string;
        /** Everything the event kind carries beyond the envelope. */
        [key: string]: unknown;
    };
}

/**
 * Builds the body for one delivery.
 *
 * `deliveryId` is passed in rather than generated here so the envelope frozen
 * on the delivery row and the `X-Ortha-Delivery` header cannot disagree.
 *
 * The envelope carries **references, not content**: a receiver reads the record
 * back through the public API with its own token, so the read passes through
 * the visibility rules and audience entitlements an editor set on the entry.
 * Inlining field values here would route around all of them at once.
 */
export function buildEnvelope(
    deliveryId: string,
    event: WebhookSourceEvent
): WebhookEnvelope {
    return {
        id: deliveryId,
        event: event.kind,
        eventId: event.eventId,
        occurredAt: event.occurredAt.toISOString(),
        workspaceId: event.workspaceId,
        actor: event.actor,
        data: {
            ...event.data,
            kind: event.aggregateType,
            id: event.aggregateId
        }
    };
}
