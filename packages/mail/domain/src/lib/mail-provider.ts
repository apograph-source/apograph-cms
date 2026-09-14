/**
 * The mail boundary — **one** implementation per deployment, constructed at the
 * composition root and handed to `MailServerPlugin` as a plain object
 * (`@apograph/mail-provider-smtp`, `-console`, …). The mail core depends only on
 * this interface and never on a concrete backend.
 *
 * The shape is deliberately `StorageProvider`'s: an `id` recorded on the row
 * that was handed over, declared capabilities rather than detected ones, and an
 * optional `verify()` so a bad sender or credential refuses the boot instead of
 * surfacing on somebody's first invitation.
 */

/** A message, already rendered. Nothing here is assembled later. */
export interface MailMessage {
    /** The recipient's address. One per message — this is not a bulk port. */
    to: string;
    /**
     * The sender, as the deployment configured it (`from` in the plugin's
     * config). It travels on the message rather than being baked into the
     * adapter so that the sender identity is one setting an operator reads in
     * their own config, not a value split across a factory and a plugin.
     */
    from: string;
    /** Where a reply should go, when the deployment set one. */
    replyTo?: string;
    subject: string;
    /**
     * The plain-text body. **Always present**, and first in this interface for
     * the same reason: a text part always renders, and for a message whose
     * whole content is one link, HTML is decoration.
     */
    text: string;
    /** Optional HTML part. `text` is never omitted in its favour. */
    html?: string;
    /** Extra headers the provider should set verbatim. */
    headers?: Record<string, string>;
}

/** What a backend can do, so the core never assumes the weakest one. */
export interface MailCapabilities {
    /**
     * Whether the provider returns an id of its own for a handed-over message.
     * Declared rather than detected: the worker records it on nothing when it
     * is absent, and an operator chasing a message needs to know which of the
     * two situations they are in.
     */
    messageId: boolean;
    /**
     * Whether {@link MailProvider.verify} actually reaches the backend. A
     * console adapter has nothing to check and says so, rather than passing a
     * boot check that proves nothing.
     */
    verifiable: boolean;
}

/** What a provider gives back once it has accepted a message. */
export interface MailReceipt {
    /** The provider's own id for the message, when it gives one. */
    providerMessageId?: string;
}

/**
 * A failure that will never succeed — a malformed address, a sender the backend
 * refuses, a payload it rejects.
 *
 * The retryable/permanent split is the provider's judgement and part of the
 * contract: without it a typo in an address consumes the whole attempt budget
 * over several hours and lands in the dead letters beside real outages, where
 * an operator cannot tell the two apart.
 */
export class MailPermanentError extends Error {
    constructor(
        message: string,
        /** The underlying error, when the adapter had one. */
        override readonly cause?: unknown
    ) {
        super(message);
        this.name = 'MailPermanentError';
    }
}

/**
 * The port every adapter implements.
 *
 * `send` resolves on **hand-off**, not on delivery: we learn that the backend
 * accepted the message, never that a mailbox received it. Bounce handling is a
 * named gap (ADR-0018), not a pending feature.
 */
export interface MailProvider {
    /**
     * Stable identifier for this backend, owned by the provider itself.
     * Stamped on the delivery row the moment it is handed over, so it is data
     * rather than a label: renaming it after rows exist makes the log lie about
     * which backend a message went through.
     */
    readonly id: string;
    /** What this backend can do. Declared, never guessed. */
    readonly capabilities: MailCapabilities;
    /**
     * Hands one message over. Rejects with {@link MailPermanentError} for a
     * failure that will never succeed; any other rejection is retryable.
     */
    send(message: MailMessage): Promise<MailReceipt>;
    /**
     * Optional boot check — a bad credential or a sender the backend will not
     * accept refuses startup, where it is cheapest to diagnose.
     */
    verify?(): Promise<void>;
}

/** DI token the mail plugin binds the deployment's one provider under. */
export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');
