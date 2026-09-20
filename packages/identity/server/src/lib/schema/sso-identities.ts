import {
    index,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid
} from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * The link between an Ortha account and a person at an external identity
 * provider — the row that turns "this IdP says subject X signed in" into "sign
 * in user Y".
 *
 * Two unique constraints, and both are load-bearing:
 *
 * - **`(provider, subject)`** is the sign-in lookup and the reason a subject is
 *   never an email address (see `SsoProfile.subject`): a person's address can
 *   be reassigned to a colleague, and a link keyed on it would hand over the
 *   account with the mailbox. It is unique so one provider identity can never
 *   resolve to two Ortha accounts.
 * - **`(provider, user_id)`** caps an account at one identity per provider.
 *   Without it a mis-firing link path could accumulate rows, and "which Google
 *   account is this user?" would stop having an answer.
 */
export const ssoIdentities = pgTable(
    'sso_identities',
    {
        /** Primary key. */
        id: uuid('id').primaryKey().defaultRandom(),
        /** The account this identity signs in. */
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        /**
         * The provider's registered name (`google`, `entra`), as it appears in
         * the composition root and in the route. Stable: renaming a
         * registration orphans every row that names it.
         */
        provider: text('provider').notNull(),
        /**
         * The provider's stable identifier for the person. Never their email —
         * see the table doc.
         */
        subject: text('subject').notNull(),
        /**
         * The address the provider reported at the last sign-in, lower-cased.
         * Display and support only: the account's own `users.email` is what
         * the CMS treats as their address, and this is never used to look an
         * account up after the link exists.
         */
        email: text('email'),
        /**
         * When this identity was last used to sign in. Null until the first
         * sign-in through it, which is possible when a link is created by an
         * admin rather than by a login.
         */
        lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
        /** Row creation timestamp. */
        createdAt: timestamp('created_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
        /** Last-modified timestamp; refreshed on every update. */
        updatedAt: timestamp('updated_at', { withTimezone: true })
            .notNull()
            .defaultNow()
            .$onUpdate(() => new Date())
    },
    (table) => [
        uniqueIndex('sso_identities_provider_subject_unique').on(
            table.provider,
            table.subject
        ),
        uniqueIndex('sso_identities_provider_user_unique').on(
            table.provider,
            table.userId
        ),
        // "show me this user's connected accounts" and the cascade on delete.
        index('sso_identities_user_id_idx').on(table.userId)
    ]
);
