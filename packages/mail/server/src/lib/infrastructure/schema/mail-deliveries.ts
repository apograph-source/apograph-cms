import { sql } from 'drizzle-orm';
import {
    index,
    integer,
    pgTable,
    text,
    timestamp,
    uuid
} from 'drizzle-orm/pg-core';

/**
 * One message on its way out — the queue, and the dead-letter log at once.
 *
 * **Why the row carries a rendered body.** The raw token exists exactly once,
 * inside the transaction that issued it; afterwards only its SHA-256 is stored.
 * So unlike a webhook, whose body an outbox subscriber can rebuild from the
 * event, this message **cannot be assembled later** — it is rendered inline and
 * written here, in the same transaction, or it does not exist at all
 * (ADR-0018 §2). That is the divergence from ADR-0016's fan-out shape, and it
 * is only the enqueue: the worker still claims a row, commits, and opens a
 * socket with nothing held.
 *
 * **Why a delivered row is deleted rather than stamped.** It holds an
 * account-takeover secret. It exists to survive a crash between commit and
 * send, and has no reason to outlive the send — the exact opposite of
 * `outbox_events`, which is stamped and never pruned, and exactly why a secret
 * must not be put there.
 */
export const mailDeliveries = pgTable(
    'mail_deliveries',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        /**
         * What this message is — `invite`, `invite_resent`, `password_reset`.
         * Text rather than an enum: a new message kind should be a template and
         * a use case, not a migration.
         */
        kind: text('kind').notNull(),
        toAddress: text('to_address').notNull(),
        subject: text('subject').notNull(),
        /** The rendered plain-text part. Carries the link. */
        bodyText: text('body_text').notNull(),
        /** The rendered HTML part, when the template produced one. */
        bodyHtml: text('body_html'),
        /**
         * The link on its own, so `reveal-link` can hand back the secret
         * without parsing a rendered body — which would make the copy and a
         * security-relevant route quietly load-bearing on each other.
         *
         * It is the same secret the body already carries: storing it twice in
         * one row costs nothing and is deleted at the same moment.
         */
        link: text('link'),
        /**
         * Who the message concerns, for the audit trail and for `reveal-link`.
         * Nullable because a self-service recovery request for an address
         * nobody holds writes no row at all — when that route lands, this stays
         * as it is.
         */
        userId: uuid('user_id'),
        /** Stamped by the worker when a provider accepted the hand-off. */
        providerId: text('provider_id'),
        attempts: integer('attempts').notNull().default(0),
        /**
         * When the next attempt may be claimed — the claim's ordering column,
         * and its lease: claiming pushes this forward, so a second worker skips
         * the row and a worker that died mid-send releases it by timeout.
         */
        nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
        /**
         * The token's own expiry. A row past it is swept **unsent**: delivering
         * a dead link is worse than delivering nothing, because the recipient
         * cannot tell which of the two happened.
         */
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        /**
         * When the message was given up on — the attempt budget spent, or a
         * permanent rejection.
         *
         * A column rather than "attempts at the cap" because of the permanent
         * case: a typo'd address stops on its **first** attempt, with its
         * budget untouched, and the two situations must still both read as dead
         * letters.
         */
        deadAt: timestamp('dead_at', { withTimezone: true }),
        lastError: text('last_error'),
        createdAt: timestamp('created_at', { withTimezone: true })
            .notNull()
            .defaultNow()
    },
    (table) => [
        // The worker's claim: `WHERE dead_at IS NULL ORDER BY next_attempt_at
        // LIMIT n`. Partial and keyed on the sort column, like
        // `outbox_events_pending_idx` — it serves the filter, the order and the
        // limit together, and dead rows drop out of it.
        index('mail_deliveries_claimable_idx')
            .on(table.nextAttemptAt)
            .where(sql`${table.deadAt} is null`),
        // The expiry sweep.
        index('mail_deliveries_expires_idx').on(table.expiresAt),
        // `reveal-link`, and the member's "this never left" notice: the newest
        // undelivered message for one person.
        index('mail_deliveries_user_idx').on(table.userId, table.createdAt)
    ]
);
