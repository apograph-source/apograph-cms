import { createDomainEvent, type DomainEvent } from '@orthacms/database';

/**
 * The domain event kinds the identity context raises. Three families:
 *
 * - `user.*` — {@link UserAccount} lifecycle/credential facts, raised by the
 *   aggregate;
 * - `auth.*` — session facts (sign-in / sign-out), raised by the auth
 *   use-cases (a sign-in mutates no `UserAccount`, so its fact is minted by the
 *   flow rather than drained from an aggregate);
 * - `api_token.*` — external-API bearer token lifecycle, raised by
 *   `ApiTokenService`. Their aggregate is the **token**, not a user, so they are
 *   built with {@link apiTokenEvent}.
 *
 * These are **distinct** from the `user.*` audit kinds
 * ({@link IDENTITY_ACTIVITY_KINDS}) the activity recorder writes in-band: like
 * the users context, the two catalogues are kept separate, so Wave 3's move of
 * auditing onto an outbox subscriber maps between them rather than reusing the
 * same strings. Emitting these to the outbox is harmless until that subscriber
 * exists (no subscriber ⇒ the rows auto-mark dispatched).
 */
export const IDENTITY_EVENT_KINDS = {
    USER_ACTIVATED: 'user.activated',
    USER_DISABLED: 'user.disabled',
    USER_ENABLED: 'user.enabled',
    PASSWORD_CHANGED: 'user.password_changed',
    SIGNED_IN: 'auth.signed_in',
    SIGNED_OUT: 'auth.signed_out',
    /**
     * A password sign-in was refused.
     *
     * The one authentication fact the log did not record. `auth.signed_in` is
     * raised on success only, and there was no kind for a failure at all — so
     * the trail could show that an account signed in, and never that four
     * hundred attempts on it were rejected first. That is the first question a
     * security review asks and the log could not answer it.
     *
     * The **response** to a failed sign-in stays a flat 401 with no detail, as
     * it must: the `reason` recorded here (see {@link SignInFailureReason})
     * distinguishes an unknown address from a wrong password, and the whole
     * point is that this distinction exists in an `activity:read` store an
     * administrator reads and nowhere a caller can observe.
     */
    SIGN_IN_FAILED: 'auth.sign_in_failed',
    /**
     * An administrator revoked one of another member's sessions. Distinct from
     * `auth.signed_out`, which is somebody ending their own session: the
     * subject here is the member who was signed out and the actor is the admin
     * who did it, and telling those apart is the only reason to record either.
     */
    SESSION_REVOKED: 'user.session_revoked',
    /**
     * An identity provider's subject was linked to an account. Raised once per
     * link, not per sign-in — the interesting fact is that a second way into
     * the account now exists.
     */
    SSO_LINKED: 'user.sso_linked',
    /**
     * An account was created from a verified profile, with no invite and no
     * password. This is the one SSO fact a security review will look for
     * first, because it is the only path in this product that produces an
     * account nobody explicitly invited.
     */
    SSO_PROVISIONED: 'user.sso_provisioned',
    /**
     * A role-mapping handler moved an account to a different role. Raised only
     * when the role actually changed, so an unchanged mapping does not write a
     * row on every sign-in for the rest of the account's life.
     */
    SSO_ROLE_MAPPED: 'user.sso_role_mapped',
    API_TOKEN_CREATED: 'api_token.created',
    API_TOKEN_REVOKED: 'api_token.revoked',
    /**
     * An API token authenticated a request.
     *
     * **Throttled, not per request.** It is raised on the same schedule as the
     * token's `last_used_at` touch — at most once per
     * `LAST_USED_TOUCH_INTERVAL_MS` per token — because the question worth
     * answering is "was this credential in use, and when did it stop", not "how
     * many requests did it make". A row per request would be a metric, and it
     * would drown every other kind in the log within a day of a busy
     * integration.
     *
     * `last_used_at` on the token row already answers "when was this last
     * used". What it cannot answer is the shape over time — a token that was
     * dormant for six months and woke up last Tuesday reads identically to one
     * in daily use — which is exactly the question asked after a key leaks.
     */
    API_TOKEN_USED: 'api_token.used'
} as const;

/** A domain event kind raised by the identity context. */
export type IdentityEventKind =
    (typeof IDENTITY_EVENT_KINDS)[keyof typeof IDENTITY_EVENT_KINDS];

/** The aggregate type stamped on identity's `user.*` / `auth.*` events. */
const AGGREGATE_TYPE = 'user';

/** The aggregate type stamped on identity's `api_token.*` events. */
const API_TOKEN_AGGREGATE_TYPE = 'api_token';

/**
 * Builds an identity {@link DomainEvent} of `kind` for `userId`, carrying
 * `payload`. Keeps aggregates and use-cases free of the event envelope's
 * plumbing — the caller names the fact and its data; this stamps the
 * `aggregateType`/id.
 */
export function identityEvent(
    kind: string,
    userId: string,
    payload: Record<string, unknown> = {}
): DomainEvent {
    return createDomainEvent({
        kind,
        aggregateType: AGGREGATE_TYPE,
        aggregateId: userId,
        payload
    });
}

/**
 * Builds an identity {@link DomainEvent} of `kind` for the API token `tokenId`,
 * carrying `payload`. The sibling of {@link identityEvent} for the one identity
 * concern whose aggregate is not a user: an API token has its own lifecycle
 * (minted, revoked) and its own id, and the acting admin rides on the payload
 * as the actor rather than being the subject.
 *
 * `payload` must never carry the token's plaintext or its hash — the audit log
 * is a lower-trust store than `api_tokens`, and the whole point of hashing at
 * rest is that a read of another table yields no usable credential. The
 * non-secret `lookupPrefix` is what identifies a token in a log line.
 */
export function apiTokenEvent(
    kind: string,
    tokenId: string,
    payload: Record<string, unknown> = {}
): DomainEvent {
    return createDomainEvent({
        kind,
        aggregateType: API_TOKEN_AGGREGATE_TYPE,
        aggregateId: tokenId,
        payload
    });
}

/**
 * Why a password sign-in was refused, as recorded on
 * `auth.sign_in_failed`.
 *
 * These buckets are the reason the event is worth writing: "someone is guessing
 * addresses" and "a real person keeps mistyping their password" are the same
 * flat 401 to the caller and completely different facts to an operator, and
 * only the second one has an account behind it to warn. They are deliberately
 * coarse — the exact predicate that failed is of no use to a reviewer and would
 * only invite reading the log as a credential oracle.
 */
export const SIGN_IN_FAILURE_REASON = {
    /** No account holds this address. */
    UnknownAccount: 'unknown_account',
    /** The account exists and the password did not match. */
    BadPassword: 'bad_password',
    /**
     * The account exists but cannot sign in — a `pending` invite that was never
     * accepted (so it holds no credential), or a `disabled` account. Kept as one
     * bucket: both mean "this address is not a way in right now", and splitting
     * them would report an account's lifecycle state to whoever reads the log
     * without telling an operator anything they cannot see on the member page.
     */
    NotActive: 'not_active',
    /** This deployment has turned password sign-in off for this address. */
    PasswordLoginDisabled: 'password_login_disabled'
} as const;

/** Why a password sign-in was refused. */
export type SignInFailureReason =
    (typeof SIGN_IN_FAILURE_REASON)[keyof typeof SIGN_IN_FAILURE_REASON];

/** The aggregate type stamped on `auth.sign_in_failed`. */
const SIGN_IN_ATTEMPT_AGGREGATE_TYPE = 'login_attempt';

/**
 * Builds the `auth.sign_in_failed` event for an attempt on `email`.
 *
 * The aggregate is the **address**, not a user — which is the only thing that
 * works, since the most interesting failures are the ones where no account
 * exists to key on. `activity_events.subject_id` is `text` precisely so a
 * subject need not be a uuid, and keying every attempt on one address is what
 * makes "show me what has been tried against this login" a single indexed read
 * rather than a scan of a jsonb column.
 *
 * `email` is lowercased and trimmed so `Ada@Example.com` and `ada@example.com`
 * are one subject; an attempt with a blank address raises nothing (there is no
 * subject to key on, and the DTO rejects it before this anyway).
 */
export function signInAttemptEvent(
    email: string,
    payload: Record<string, unknown> = {}
): DomainEvent {
    return createDomainEvent({
        kind: IDENTITY_EVENT_KINDS.SIGN_IN_FAILED,
        aggregateType: SIGN_IN_ATTEMPT_AGGREGATE_TYPE,
        aggregateId: email.trim().toLowerCase(),
        payload
    });
}
