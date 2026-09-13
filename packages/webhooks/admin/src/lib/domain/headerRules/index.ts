/**
 * Which custom headers an endpoint may set.
 *
 * A **deliberate copy** of `@apograph/webhooks-domain`'s `isAllowedCustomHeader`
 * rather than an import: that package's barrel reaches `node:crypto` through
 * the signature helpers, and pulling it into the browser bundle takes the whole
 * admin down at load. The server enforces the same rule on every write — this
 * copy only turns a `422` into an error beside the field that caused it.
 */

/**
 * Header prefixes reserved for the delivery's own metadata.
 *
 * `x-ortha-` is the pre-rename prefix, still sent alongside the new one — see
 * `LEGACY_DELIVERY_HEADERS`. It stays reserved for as long as it is sent, or an
 * endpoint could overwrite the older spelling of the signature and forge a
 * delivery under the name half the receivers are still reading.
 */
const RESERVED_PREFIXES = ['x-apograph-', 'x-ortha-'];

/** Headers the transport owns, which an endpoint may never overwrite. */
const RESERVED_NAMES = [
    'host',
    'content-type',
    'content-length',
    'transfer-encoding',
    'connection',
    'user-agent'
];

/** A valid HTTP field name (RFC 9110 token characters). */
const TOKEN = /^[a-z0-9!#$%&'*+.^_`|~-]+$/;

/** Why a header name was refused, or `null` when it is fine. */
export type HeaderRejection = 'malformed' | 'reserved';

/**
 * Checks one header name.
 *
 * Overwriting `X-Apograph-Signature` or `X-Apograph-Event` would let a delivery claim
 * to be something it is not, and `Host` is how a request aimed at one virtual
 * host gets served by another — so both are refused rather than silently
 * dropped at send time.
 */
export function rejectionFor(name: string): HeaderRejection | null {
    const lower = name.trim().toLowerCase();
    if (lower.length === 0 || !TOKEN.test(lower)) return 'malformed';
    if (RESERVED_NAMES.includes(lower)) return 'reserved';
    if (RESERVED_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
        return 'reserved';
    }
    return null;
}

/** One row of the headers editor. A row keeps its identity while it is edited. */
export type HeaderRow = { key: string; name: string; value: string };

/** Turns the stored map into rows, in a stable order. */
export function toHeaderRows(headers: Record<string, string>): HeaderRow[] {
    return Object.entries(headers).map(([name, value], index) => ({
        key: `${index}-${name}`,
        name,
        value
    }));
}

/**
 * Turns rows back into the map the API takes.
 *
 * Blank rows are dropped — an editor that has one empty row open is not
 * expressing "send an empty header" — and a later row of the same name wins,
 * because that is what the map would have done anyway.
 */
export function fromHeaderRows(
    rows: readonly HeaderRow[]
): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const row of rows) {
        const name = row.name.trim();
        if (name.length === 0) continue;
        headers[name] = row.value.trim();
    }
    return headers;
}
