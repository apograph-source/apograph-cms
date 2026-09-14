/**
 * Which SMTP failures will never succeed.
 *
 * The split is the whole reason the port has one: without it a typo in an
 * address spends the message's entire attempt budget over twenty minutes and
 * lands in the dead letters beside a real outage, where an operator cannot tell
 * the two apart.
 *
 * **Permanent** is a reply the server will give again: a 5xx response, or
 * nodemailer's own `EENVELOPE` / `EMESSAGE`, which mean the envelope or the
 * message itself was refused.
 *
 * **Retryable** is everything else, and that deliberately includes `EAUTH`. Bad
 * credentials are not fixable by retrying either — but they are a property of
 * the *deployment*, not of the message, and a credential rotation that flaps
 * for a minute should not kill every queued invitation at once. It dead-letters
 * through the ordinary budget instead, which is where an operator is looking.
 */

/** The fields nodemailer puts on the errors it rejects with. */
interface SmtpErrorShape {
    /** The numeric SMTP reply, when the failure came from the server. */
    responseCode?: unknown;
    /** nodemailer's own classification, e.g. `EENVELOPE`, `ECONNECTION`. */
    code?: unknown;
    /** The server's reply text, when there was one. */
    response?: unknown;
}

/** nodemailer codes that mean the message itself was refused. */
const PERMANENT_CODES = new Set(['EENVELOPE', 'EMESSAGE']);

/** Whether this rejection is worth another attempt. */
export function isPermanentSmtpError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const { responseCode, code } = error as SmtpErrorShape;

    if (typeof responseCode === 'number') {
        // A 5xx is the server saying no on its own behalf; a 4xx explicitly
        // means "not now", which is the definition of retryable.
        return responseCode >= 500 && responseCode < 600;
    }

    return typeof code === 'string' && PERMANENT_CODES.has(code);
}

/**
 * A one-line description of the failure for the delivery row's `last_error`.
 *
 * The server's own reply text is the useful half — "550 5.1.1 recipient
 * rejected" tells an operator what to fix, where "Error" does not — so it is
 * preferred over the generic message when nodemailer carries one.
 */
export function describeSmtpError(error: unknown): string {
    if (!error || typeof error !== 'object') return String(error);
    const { response, code } = error as SmtpErrorShape;
    const text =
        typeof response === 'string' && response.trim()
            ? response.trim()
            : error instanceof Error
              ? error.message
              : String(error);
    return typeof code === 'string' ? `${code}: ${text}` : text;
}
