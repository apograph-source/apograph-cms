/**
 * `@orthacms/webhooks-domain` — the framework-free kernel behind outgoing
 * webhooks.
 *
 * Everything a delivery *means* lives here: which events can be subscribed to,
 * whether one belongs to an endpoint, what the posted body looks like, how it
 * is signed, when a failed attempt is retried, and which URLs this server may
 * be talked into reaching. None of it imports NestJS, Drizzle or React, so all
 * of it is testable without a database, a socket or a clock.
 */

export {
    WEBHOOK_EVENTS,
    WEBHOOK_EVENT_GROUPS,
    WEBHOOK_EVENT_KINDS,
    SUBSCRIBABLE_OUTBOX_KINDS,
    describeEvent,
    isKnownEventKind,
    type WebhookEventDescriptor,
    type WebhookEventGroup
} from './lib/event-catalogue';

export {
    buildEnvelope,
    type WebhookActor,
    type WebhookEnvelope,
    type WebhookSourceEvent
} from './lib/envelope';

export {
    matches,
    type WebhookRoutableEvent,
    type WebhookSubscription
} from './lib/subscription';

export {
    DEFAULT_TOLERANCE_SECONDS,
    SIGNATURE_HEADER,
    computeSignature,
    parseSignatureHeader,
    signatureHeader,
    signedPayload,
    verifySignature,
    type ParsedSignature
} from './lib/signature';

export {
    DEFAULT_MAX_ATTEMPTS,
    JITTER_RATIO,
    MAX_RETRY_AFTER_MS,
    RETRY_SCHEDULE_MS,
    classifyStatus,
    isExhausted,
    nextAttemptDelayMs,
    parseRetryAfter,
    type DeliveryVerdict
} from './lib/retry-policy';

export {
    DEFAULT_URL_POLICY,
    WebhookUrlRejectedError,
    assertAddressAllowed,
    assertUrlShape,
    hostname,
    isIpLiteral,
    isPrivateAddress,
    type WebhookUrlPolicy
} from './lib/url-policy';

export {
    DELIVERY_HEADERS,
    DELIVERY_STATUSES,
    DELIVERY_USER_AGENT,
    RESERVED_HEADER_NAMES,
    RESERVED_HEADER_PREFIXES,
    isAllowedCustomHeader,
    isTerminal,
    type DeliveryStatus
} from './lib/delivery';
