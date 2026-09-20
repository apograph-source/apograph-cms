import { sql } from 'drizzle-orm';
import {
    index,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid
} from 'drizzle-orm/pg-core';
import { webhookEndpoints } from './webhook-endpoints';

/**
 * One event's journey to one endpoint — the queue and the log at once.
 *
 * **Why this table exists at all.** `OutboxDispatcher` delivers to subscribers
 * *inside* the transaction that claims the batch. A subscriber that made an
 * outgoing HTTP request would hold that transaction and its pool client open
 * for the whole round trip, stalling every other subscriber behind a stranger's
 * server; worse, a thrown error would count against the **outbox row's**
 * attempt budget and eventually dead-letter an event the activity log and the
 * alarms evaluator also needed. So the subscriber only writes rows here, and a
 * worker does the network with no transaction open.
 *
 * The partial unique index on `(endpoint_id, event_id)` is the idempotency:
 * outbox delivery is at-least-once, and a re-delivered event must not queue the
 * same webhook twice. It is *partial* so that a deliberate redelivery — which
 * carries the same `event_id` on purpose, because that is what a receiver
 * deduplicates on — is exempt from it.
 */
export const webhookDeliveries = pgTable(
    'webhook_deliveries',
    {
        /** Primary key, and the value sent as `X-Ortha-Delivery`. */
        id: uuid('id').primaryKey().defaultRandom(),
        endpointId: uuid('endpoint_id')
            .notNull()
            .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
        /**
         * The originating outbox event. Sent as `X-Ortha-Event-Id` and stable
         * across redeliveries, so it is the value a receiver deduplicates on.
         * For a `ping` there is no outbox row, so this is a fresh uuid.
         */
        eventId: uuid('event_id').notNull(),
        eventKind: text('event_kind').notNull(),
        /** Denormalised for the log's filters; null when the event has none. */
        workspaceId: uuid('workspace_id'),
        /** Denormalised for the log's filters; null for a non-content event. */
        contentType: text('content_type'),
        /**
         * The body, frozen when the row was queued. A redelivery sends exactly
         * what the first attempt sent — reassembling it later would quietly
         * send a *different* payload under the same event id.
         */
        payload: jsonb('payload').notNull(),
        /** One of `pending | delivering | succeeded | failed | dead`. */
        status: text('status').notNull().default('pending'),
        attempts: integer('attempts').notNull().default(0),
        /** When the next attempt may be claimed; null means "now". */
        nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
        /**
         * When a worker claimed this row. The reaper uses it to recover rows
         * left in `delivering` by a process that died mid-request — without it
         * such a row is stuck forever with no error and no retry.
         */
        claimedAt: timestamp('claimed_at', { withTimezone: true }),
        lastStatusCode: integer('last_status_code'),
        lastError: text('last_error'),
        /** The first couple of kilobytes of the response, for the log. */
        responseSnippet: text('response_snippet'),
        durationMs: integer('duration_ms'),
        /**
         * The delivery this one repeats, when an operator pressed "Send again".
         *
         * It is also what exempts the row from the unique index below: a
         * redelivery keeps the original `event_id` (so the receiver still
         * recognises the repeat) and would otherwise collide with the row it is
         * repeating.
         */
        redeliveryOf: uuid('redelivery_of'),
        createdAt: timestamp('created_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
        completedAt: timestamp('completed_at', { withTimezone: true })
    },
    (table) => [
        uniqueIndex('webhook_deliveries_endpoint_event_unique')
            .on(table.endpointId, table.eventId)
            .where(sql`${table.redeliveryOf} is null`),
        // The worker's claim: `WHERE status IN ('pending','failed') ORDER BY
        // next_attempt_at LIMIT n`. Partial and keyed on the sort column, like
        // `outbox_events_pending_idx` — it serves the filter, the order and the
        // limit together, and stays small because completed rows drop out of it.
        index('webhook_deliveries_claimable_idx')
            .on(table.nextAttemptAt)
            .where(sql`${table.status} in ('pending', 'failed')`),
        // The delivery log for one endpoint, newest first.
        index('webhook_deliveries_endpoint_idx').on(
            table.endpointId,
            table.createdAt
        ),
        // The retention sweep: completed rows older than the cutoff.
        index('webhook_deliveries_completed_idx').on(table.completedAt)
    ]
);
