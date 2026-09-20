/**
 * How a receiver knows a delivery came from this CMS.
 *
 * HMAC-SHA256 over `"{timestamp}.{raw body}"`, carried as
 * `X-Ortha-Signature: t=<unix seconds>,v1=<hex>`. The timestamp is **inside**
 * the signed string, not merely beside it: signing the body alone would let
 * anyone who captured one delivery replay it verbatim for as long as the secret
 * lives, and the receiver would have no way to tell.
 *
 * The `v1=` prefix is what makes a future scheme change possible without
 * breaking every receiver on the day it ships.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** The header a delivery carries its signature in. */
export const SIGNATURE_HEADER = 'x-ortha-signature';

/** How old a signed timestamp may be before a receiver should reject it. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** A parsed `t=…,v1=…` header. */
export interface ParsedSignature {
    /** The unix-seconds timestamp that was signed with the body. */
    timestamp: number;
    /** The hex digest. */
    signature: string;
}

/** The exact bytes the HMAC is computed over. */
export function signedPayload(timestamp: number, body: string): string {
    return `${timestamp}.${body}`;
}

/** The hex HMAC-SHA256 of `signedPayload(timestamp, body)` under `secret`. */
export function computeSignature(
    secret: string,
    timestamp: number,
    body: string
): string {
    return createHmac('sha256', secret)
        .update(signedPayload(timestamp, body))
        .digest('hex');
}

/** The full `X-Ortha-Signature` header value for one delivery. */
export function signatureHeader(
    secret: string,
    timestamp: number,
    body: string
): string {
    return `t=${timestamp},v1=${computeSignature(secret, timestamp, body)}`;
}

/** Parses a `t=…,v1=…` header, or returns `null` when it is malformed. */
export function parseSignatureHeader(header: string): ParsedSignature | null {
    let timestamp: number | null = null;
    let signature: string | null = null;

    for (const part of header.split(',')) {
        const [key, value] = part.trim().split('=');
        if (key === 't' && value && /^\d+$/.test(value)) {
            timestamp = Number(value);
        } else if (key === 'v1' && value && /^[0-9a-f]+$/i.test(value)) {
            signature = value.toLowerCase();
        }
    }

    return timestamp !== null && signature !== null
        ? { timestamp, signature }
        : null;
}

/**
 * Verifies a received delivery. Shipped so the documented receiver snippet and
 * our own tests check the signature with the same code that produced it — a
 * verifier written twice is a verifier that disagrees with itself eventually.
 *
 * Compared with {@link timingSafeEqual} over equal-length buffers; a length
 * mismatch short-circuits, which leaks only the digest length, a constant.
 */
export function verifySignature(
    secret: string,
    header: string,
    body: string,
    now: Date = new Date(),
    toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS
): boolean {
    const parsed = parseSignatureHeader(header);
    if (!parsed) return false;

    const age = Math.abs(Math.floor(now.getTime() / 1000) - parsed.timestamp);
    if (age > toleranceSeconds) return false;

    const expected = computeSignature(secret, parsed.timestamp, body);
    if (expected.length !== parsed.signature.length) return false;

    return timingSafeEqual(
        Buffer.from(expected, 'utf8'),
        Buffer.from(parsed.signature, 'utf8')
    );
}
