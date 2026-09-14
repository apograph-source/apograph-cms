/**
 * The seam a use case that issues a secret uses to get a message sent.
 *
 * It exists because of *where* the message has to be built. The raw token
 * returned by `InviteTokenService.rotate` exists exactly once, inside the
 * transaction that saved the member, and is unrecoverable afterwards — so the
 * message cannot be assembled later by an outbox subscriber, and the enqueue
 * has to happen inline. This port is what lets `users-server` do that without
 * depending on the mail plugin: it injects the token `@Optional()`, and a
 * deployment that configured no provider simply has nothing bound.
 *
 * That absence is also the switch the API reads. With nothing bound, the invite
 * and reset routes return the raw token exactly as they do today; with a
 * dispatcher bound they stop, because two copies of an account-takeover secret
 * are worse than one (ADR-0018 §4).
 */

/** The messages the CMS sends. One per action somebody actually took. */
export const MAIL_KINDS = {
    /** A person was invited. */
    INVITE: 'invite',
    /** An administrator re-sent an outstanding invitation. */
    INVITE_RESENT: 'invite_resent',
    /** An administrator issued a password reset for a member. */
    PASSWORD_RESET: 'password_reset'
} as const;

/**
 * What a queued message is, for the dead-letter surface and the audit trail.
 *
 * `password_recovery` — the self-service form's message — is deliberately
 * absent: the route arrives in phase 2 (ADR-0018 §7), and a kind nothing can
 * produce would be a template and a branch nobody executes.
 */
export type MailKind = (typeof MAIL_KINDS)[keyof typeof MAIL_KINDS];

/** Everything a transactional message needs, apart from the copy itself. */
export interface TransactionalMail {
    /** Which message this is. */
    kind: MailKind;
    /** Who it goes to. */
    to: string;
    /** The member it concerns, for the audit trail and `reveal-link`. */
    userId: string;
    /** Their display name, when they have one — the greeting uses it. */
    recipientName?: string | null;
    /**
     * The raw token. The only moment it exists in readable form, which is why
     * this call belongs inside the caller's transaction.
     */
    token: string;
    /**
     * When the token stops working. A row past it is swept unsent: delivering a
     * dead link is worse than delivering nothing.
     */
    expiresAt: Date;
    /** Who performed the action, when a template names them. */
    actorName?: string | null;
}

/** An undelivered message's link, as `reveal-link` hands it back. */
export interface RevealableLink {
    /** Which message it belongs to. */
    kind: MailKind;
    /** The link itself — the secret. */
    link: string;
    /** When the message was queued, so the caller can say how old it is. */
    queuedAt: Date;
    /** How many hand-off attempts have failed so far. */
    attempts: number;
    /** The last error, when there has been one. */
    lastError: string | null;
}

/**
 * Queues transactional messages, and hands back the link of one that did not
 * get through.
 */
export interface MailDispatcher {
    /**
     * Whether the deployment is in link-revealing mode — `revealLinks` on, a
     * delivery-debugging setting, which keeps the raw token in the API response
     * *as well as* sending the message.
     */
    readonly revealsLinks: boolean;

    /**
     * Renders `mail` and writes it to the queue **in the caller's open
     * transaction**, so the message cannot survive a rolled-back invite and an
     * invite cannot commit without its message.
     */
    enqueue(mail: TransactionalMail): Promise<void>;

    /**
     * The link of the newest message to this user that has not been handed over
     * yet, or `null` when there is none.
     *
     * Only an *undelivered* message has one: a delivered row is deleted, secret
     * and all, so once a message is on its way the link is gone from here as
     * well. That is the point of the reveal action — it is for the message that
     * did not arrive, not a second copy of one that did.
     */
    revealableLink(userId: string): Promise<RevealableLink | null>;
}

/** DI token `users-server` injects the dispatcher under, optionally. */
export const MAIL_DISPATCHER = Symbol('MAIL_DISPATCHER');
