import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Server-side, revocable session (FR-4). `id` is the SHA-256 of the opaque
 * random token handed to the client (application-generated, never derived or
 * predictable). The raw token lives only in the client's cookie and is never
 * stored, so a read-only DB/backup leak yields no usable session tokens.
 */
export const sessions = pgTable(
    'sessions',
    {
        /** SHA-256 (hex) of the app-generated session token. Not a uuid. */
        id: text('id').primaryKey(),
        /** References the session owner. */
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        /** Absolute expiry. */
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        /** Set when revoked; null while active. */
        revokedAt: timestamp('revoked_at', { withTimezone: true }),
        /** Row creation timestamp. */
        createdAt: timestamp('created_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
        /** Updated on each authenticated request. */
        lastUsedAt: timestamp('last_used_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
        /** Optional client metadata for audit/display. */
        userAgent: text('user_agent'),
        /** Optional originating IP for audit/display. */
        ipAddress: text('ip_address'),
        /**
         * The SSO provider this session was opened through, or null for a
         * password sign-in. Recorded so a back-channel logout from one provider
         * cannot end sessions opened through another.
         */
        ssoProvider: text('sso_provider'),
        /**
         * The provider's own session identifier (`sid` in OIDC, `SessionIndex`
         * in SAML), when it issued one.
         *
         * This is what makes a back-channel logout **precise**: the provider
         * says "session X ended" and only the Ortha sessions opened from it are
         * revoked, rather than every session the person holds on every device.
         */
        ssoSessionId: text('sso_session_id')
    },
    (table) => [
        // "revoke all sessions for a user" would otherwise seq-scan.
        index('sessions_user_id_idx').on(table.userId),
        // The back-channel logout lookup: "which sessions did this provider
        // session open?" — a full scan of a live sessions table otherwise, on a
        // route an identity provider calls without a browser to wait for it.
        index('sessions_sso_session_idx').on(
            table.ssoProvider,
            table.ssoSessionId
        )
    ]
);
