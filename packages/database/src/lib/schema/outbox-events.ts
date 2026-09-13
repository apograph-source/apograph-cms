import { sql } from 'drizzle-orm';
import {
    index,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    uuid
} from 'drizzle-orm/pg-core';

/**
 * The transactional outbox. A state change and the events it emits are
 * written here in the **same** transaction, so the row commits iff the
 * change does. The `OutboxDispatcher` later drains undispatched rows and
 * delivers them to subscribers — decoupling side effects from the write
 * without a two-phase commit.
 *
 * This is the **one** table `@apograph/database` owns (the sanctioned
 * exception to "database owns no schema"): the outbox is infrastructure
 * shared by every bounded context, not any one domain's data.
 */
export const outboxEvents = pgTable(
    'outbox_events',
    {
        /** Primary key — the event's `eventId`, doubling as the idempotency key. */
        id: uuid('id').primaryKey().defaultRandom(),
        /** Event kind, e.g. `'workspace.created'`. */
        kind: text('kind').notNull(),
        /** The aggregate root's type. */
        aggregateType: text('aggregate_type').notNull(),
        /** The aggregate root's id. */
        aggregateId: text('aggregate_id').notNull(),
        /** Event-specific JSON payload. */
        payload: jsonb('payload').notNull(),
        /** When the fact occurred (domain time). Drives the drain order. */
        occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
        /** When the event was delivered to all subscribers; null until then. */
        dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
        /** Failed delivery attempts, for observability and backoff. */
        attempts: integer('attempts').notNull().default(0),
        /**
         * Earliest time a failed row may be claimed again; null means "now".
         * Set on every failure so the retry ceiling is a window of wall-clock
         * time rather than a burst — without it, drains run as fast as traffic
         * commits and a transient subscriber failure would exhaust every
         * attempt in milliseconds.
         */
        nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
        /**
         * Why the most recent delivery attempt failed, or null if none has.
         *
         * The row it belongs to is a **dead letter** once `attempts` reaches
         * the ceiling: an event that should have been recorded and could not
         * be. That parking is logged, but a log line is only loud to somebody
         * tailing logs at that moment — afterwards the single question worth
         * asking ("is anything parked, and why") had no answer short of a
         * `psql` session, which is exactly how a gap in the audit trail stays
         * invisible. Storing it is what lets the dead-letter route answer it.
         *
         * Truncated on write: this is diagnostic text from an arbitrary
         * subscriber, and a stack trace does not need a whole column.
         */
        lastError: text('last_error')
    },
    (table) => [
        // The drain claims `WHERE dispatched_at IS NULL ORDER BY occurred_at
        // LIMIT 100`. A plain index on `dispatched_at` serves the filter and
        // then leaves Postgres to sort the matches; a **partial** index keyed
        // on `occurred_at` over exactly the pending rows serves the filter,
        // the order and the limit together, and stays small because delivered
        // rows drop out of it as they are stamped — which is what keeps the
        // drain cheap on a table nothing prunes.
        index('outbox_events_pending_idx')
            .on(table.occurredAt)
            .where(sql`${table.dispatchedAt} is null`)
    ]
);
