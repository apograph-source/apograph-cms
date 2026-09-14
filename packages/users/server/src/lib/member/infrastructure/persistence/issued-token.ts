/**
 * What rotating a one-time token produces.
 *
 * The expiry rides along with the secret because the caller has one more thing
 * to do with it than hand it over: a queued message is swept unsent once its
 * link has died, so the mail row needs exactly the instant the `tokens` insert
 * wrote — not a second computation of it from the same TTL, which is one
 * refactor away from disagreeing.
 */
export interface IssuedToken {
    /** The raw token — the secret half of the link, readable only here. */
    raw: string;
    /** When it stops working, as written to `tokens.expires_at`. */
    expiresAt: Date;
}
