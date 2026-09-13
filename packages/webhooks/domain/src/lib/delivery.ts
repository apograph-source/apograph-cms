/**
 * The vocabulary of one delivery: its status, and the headers it travels with.
 *
 * Shared by the server (which writes the rows and sends the request) and the
 * admin (which renders them), so the two cannot disagree about what `dead`
 * means or which header carries the delivery id.
 */

/** Every state a delivery row can be in. */
export const DELIVERY_STATUSES = [
    /** Queued, waiting for a worker. */
    'pending',
    /** Claimed by a worker; the request is in flight. */
    'delivering',
    /** A 2xx came back. Terminal. */
    'succeeded',
    /** The last attempt failed and another is scheduled. */
    'failed',
    /** Given up on — attempts exhausted, or a fatal response. Terminal. */
    'dead'
] as const;

/** One of {@link DELIVERY_STATUSES}. */
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Whether a status means the delivery will not be tried again on its own. */
export function isTerminal(status: DeliveryStatus): boolean {
    return status === 'succeeded' || status === 'dead';
}

/** The headers every delivery carries, beyond `Content-Type`. */
export const DELIVERY_HEADERS = {
    /** The event kind, so a receiver can route without parsing the body. */
    EVENT: 'X-Apograph-Event',
    /** This delivery's id — a redelivery gets a new one. */
    DELIVERY: 'X-Apograph-Delivery',
    /** The originating event's id — **stable across redeliveries**, so this is
     * the one a receiver deduplicates on. */
    EVENT_ID: 'X-Apograph-Event-Id',
    /** The owning workspace, omitted when the event has none. */
    WORKSPACE: 'X-Apograph-Workspace',
    /** Which attempt this is, 1-based. */
    ATTEMPT: 'X-Apograph-Attempt',
    /** `t=<unix seconds>,v1=<hex hmac>`. */
    SIGNATURE: 'X-Apograph-Signature'
} as const;

/**
 * The pre-rename spelling of {@link DELIVERY_HEADERS}, sent **alongside** it.
 *
 * A receiver verifies the signature against a header name it was written
 * against, so renaming the prefix in place would have every existing endpoint
 * start rejecting deliveries at the moment this ships — silently, because a
 * failed signature check looks exactly like an attack. Both sets carry the same
 * values, so a receiver can move at its own pace and drop the old one when it
 * has.
 *
 * Deprecated: remove one major version after the rename, once receivers have
 * had a release to move to `X-Apograph-*`.
 *
 * @deprecated Read `DELIVERY_HEADERS` instead.
 */
export const LEGACY_DELIVERY_HEADERS = {
    EVENT: 'X-apograph-Event',
    DELIVERY: 'X-apograph-Delivery',
    EVENT_ID: 'X-apograph-Event-Id',
    WORKSPACE: 'X-apograph-Workspace',
    ATTEMPT: 'X-apograph-Attempt',
    SIGNATURE: 'X-apograph-Signature'
} as const satisfies Record<keyof typeof DELIVERY_HEADERS, string>;

/** The User-Agent every delivery is sent with. */
export const DELIVERY_USER_AGENT = 'Apograph-Webhooks/1';

/**
 * Header names an endpoint's custom headers may never set.
 *
 * Without this an operator could overwrite `X-Apograph-Event` or the signature and
 * make a delivery claim to be something it is not — and `Host` is how a request
 * aimed at one virtual host is served by another.
 *
 * `x-apograph-` stays reserved for as long as {@link LEGACY_DELIVERY_HEADERS} is
 * sent: it is still a delivery's own metadata, and letting an endpoint set it
 * would be the same forgery under the older name.
 */
export const RESERVED_HEADER_PREFIXES: readonly string[] = [
    'x-apograph-',
    'x-apograph-'
];

/** Header names an endpoint's custom headers may never set, in full. */
export const RESERVED_HEADER_NAMES: readonly string[] = [
    'host',
    'content-type',
    'content-length',
    'transfer-encoding',
    'connection',
    'user-agent'
];

/** Whether `name` is a header an endpoint is allowed to add. */
export function isAllowedCustomHeader(name: string): boolean {
    const lower = name.trim().toLowerCase();
    if (lower.length === 0) return false;
    // A header name that is not a valid token would be rejected by the client
    // anyway; refusing it here turns a 500 in the worker into a 422 in the form.
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(lower)) return false;
    if (RESERVED_HEADER_NAMES.includes(lower)) return false;
    return !RESERVED_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix));
}
