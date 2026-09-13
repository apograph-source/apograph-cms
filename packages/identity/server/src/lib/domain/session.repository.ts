import type { SessionContext } from './session';

/** A freshly created session: the opaque token for the client and its expiry. */
export interface CreatedSession {
    /**
     * Opaque random token handed to the client (the cookie value). Only its
     * **hash** is persisted, so this value never appears in the database.
     */
    token: string;
    /** Absolute expiry, derived from the configured TTL. */
    expiresAt: Date;
}

/** The owner an opaque token resolves to on a valid-session lookup. */
export interface ResolvedSession {
    /** The session owner's id. */
    userId: string;
    /** When the session was last used — the throttle input for a refresh. */
    lastUsedAt: Date;
}

/**
 * One live session as the admin user-detail "Sessions" tab renders it. Carries
 * only display/audit metadata — never the token or its hash beyond the opaque
 * row `id`, which the client treats as a handle for revocation.
 */
export interface UserSessionView {
    /** The session row id (SHA-256 of the token); a revocation handle. */
    id: string;
    /** Originating `User-Agent`, if captured. */
    userAgent: string | null;
    /** Originating IP, if captured. */
    ipAddress: string | null;
    /** When the session was opened. */
    createdAt: Date;
    /** Last authenticated request seen on this session. */
    lastUsedAt: Date;
    /** Absolute expiry. */
    expiresAt: Date;
}

/**
 * The persistence **port** for server-side sessions. The auth use-cases and the
 * read paths depend on this interface; the infrastructure layer binds a
 * Drizzle-backed adapter to {@link SESSION_REPOSITORY} over identity's
 * `sessions` table.
 *
 * The session token is application-generated high-entropy randomness; only its
 * SHA-256 is stored (the adapter's concern), so a read-only DB/backup leak
 * yields no usable tokens.
 */
/** How a session differs from the ordinary password-opened one. */
export interface IssueSessionOptions {
    /**
     * Shorter (or longer) lifetime for this session alone. Used for SSO
     * sessions, whose subject can be disabled at the identity provider without
     * the CMS hearing about it unless back-channel logout is in play.
     */
    ttlSeconds?: number;
    /** The SSO provider this session was opened through. */
    ssoProvider?: string | null;
    /**
     * The provider's own session identifier, when it issued one — what makes a
     * back-channel logout precise rather than "sign them out everywhere".
     */
    ssoSessionId?: string | null;
}

export interface SessionRepository {
    /**
     * Opens a session for `userId`, returning the opaque token and its expiry.
     * The expiry comes from the {@link SessionPolicy}; the token is minted and
     * hashed by the adapter. Joins the active unit of work when inside one.
     */
    issue(
        userId: string,
        context: SessionContext,
        options?: IssueSessionOptions
    ): Promise<CreatedSession>;

    /**
     * Revokes every live session opened from one identity-provider session,
     * returning how many were revoked.
     *
     * Scoped to `provider` as well as the session id, so a notification from
     * one directory can never end sessions opened through another — provider
     * session ids are opaque strings with no shared namespace, and two
     * providers colliding on one is not something to leave to luck.
     */
    revokeBySsoSession(provider: string, ssoSessionId: string): Promise<number>;

    /**
     * Resolves an opaque token to its owner, or `null` when the session is
     * unknown, revoked, or past its expiry. A pure read — never writes.
     */
    resolveActive(token: string): Promise<ResolvedSession | null>;

    /**
     * Writes back `lastUsedAt = at` for the session identified by `token`. The
     * caller decides *whether* to call this (via the {@link SessionPolicy}
     * throttle); this only performs the update.
     */
    touchLastUsed(token: string, at: Date): Promise<void>;

    /**
     * Revokes a single session by its opaque token, idempotently — an unknown or
     * already-revoked token is a no-op. Returns the revoked session's owner, or
     * `null` when nothing was revoked, so the caller can skip a phantom event.
     */
    revokeByToken(token: string): Promise<{ userId: string } | null>;

    /**
     * Lists a user's currently-valid sessions (not revoked, not expired),
     * most-recently-used first, for the admin "Sessions" tab. Display metadata
     * only — never the raw token.
     */
    listForUser(userId: string): Promise<UserSessionView[]>;

    /**
     * Revokes one of a user's sessions by its row id, idempotently. Scoped to
     * `userId` so an admin only revokes sessions that belong to the target
     * member. Returns whether a live session was revoked.
     */
    revokeById(userId: string, sessionId: string): Promise<boolean>;

    /**
     * Revokes **every** live session a user holds, returning how many were
     * revoked. The credential-rotation primitive: a password change has to
     * invalidate the sessions the old password opened, or "I changed my
     * password" fails to evict whoever knew the old one.
     *
     * `exceptSessionId` keeps one session alive — the caller's own, so a user
     * who changes their password from a signed-in device is not logged out of
     * the device they just used. Pass the session **row id** (the token's
     * SHA-256), the same handle {@link listForUser} returns.
     *
     * Joins the active unit of work, so the revocations commit with the
     * credential change and can never be left half-applied.
     */
    revokeAllForUser(
        userId: string,
        options?: { exceptSessionId?: string }
    ): Promise<number>;
}

/**
 * DI token the infrastructure adapter binds to a {@link SessionRepository}.
 * A plain `Symbol`, so the domain declares it without importing `@nestjs/*`.
 */
export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');
