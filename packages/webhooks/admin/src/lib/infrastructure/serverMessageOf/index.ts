import { ApiError } from '@orthacms/utils-admin';

/**
 * The message the **server** wrote, when it wrote one.
 *
 * `ApiError.message` is axios's own text ("Request failed with status code
 * 422"), which is useless in a form. The server's message — the one written for
 * whoever typed the URL — is in the parsed body, which `ApiError` deliberately
 * leaves opaque as `details` so the transport layer does not decide what an
 * endpoint's error shape means.
 *
 * This decides it for this endpoint: NestJS's exception filter puts a human
 * message on `message`, and a `ValidationPipe` failure puts an array there
 * instead. An array is not shown — those are field-level messages the form
 * already renders — so the caller falls back to its own copy.
 */
export function serverMessageOf(error: unknown): string | null {
    if (!(error instanceof ApiError)) return null;

    const details = error.details;
    if (typeof details !== 'object' || details === null) return null;

    const message = (details as Record<string, unknown>)['message'];
    return typeof message === 'string' && message.length > 0 ? message : null;
}
