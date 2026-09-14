/**
 * Stable machine codes for the member domain's failures.
 *
 * The domain already distinguishes these precisely — `SelfActionError` is not
 * `LastAdminProtectedError` — but HTTP flattens every one of them to a `409`
 * whose only distinguishing feature was an English sentence. A client that
 * wants to say something useful ("promote another admin first") could then only
 * string-match that sentence, so `users-admin` showed one generic message for
 * every conflict and the actionable reason never reached the user in any
 * language (WCAG 3.3.1 / 3.3.3).
 *
 * These codes are part of the wire contract: **append, never rename**. The
 * English `message` stays alongside as a developer-facing fallback.
 */
export const MEMBER_ERROR_CODES = {
    /** The email already belongs to an account. */
    EMAIL_TAKEN: 'EMAIL_TAKEN',
    /** The last remaining active admin cannot be demoted or disabled. */
    LAST_ADMIN_PROTECTED: 'LAST_ADMIN_PROTECTED',
    /** You cannot re-role or disable your own account. */
    SELF_ACTION: 'SELF_ACTION',
    /** The member's status forbids this transition (e.g. resend on an active member). */
    INVALID_MEMBER_STATE: 'INVALID_MEMBER_STATE',
    /** An invite was issued moments ago; rotating again would kill a live link. */
    INVITE_RECENTLY_SENT: 'INVITE_RECENTLY_SENT',
    /** A reset link was issued moments ago; issuing again would kill a live link. */
    PASSWORD_RESET_RECENTLY_SENT: 'PASSWORD_RESET_RECENTLY_SENT',
    /** No undelivered message exists, so there is no link left to reveal. */
    NO_REVEALABLE_LINK: 'NO_REVEALABLE_LINK',
    /** The deployment sends no mail, so no link is being withheld. */
    MAIL_NOT_CONFIGURED: 'MAIL_NOT_CONFIGURED'
} as const;

/** One of {@link MEMBER_ERROR_CODES}. */
export type MemberErrorCode =
    (typeof MEMBER_ERROR_CODES)[keyof typeof MEMBER_ERROR_CODES];
