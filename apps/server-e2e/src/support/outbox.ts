import type { INestApplication } from '@nestjs/common';
import {
    getPool,
    MAX_DELIVERY_ATTEMPTS,
    OutboxDispatcher
} from '@orthacms/database';

/** One `outbox_events` row, as the durability assertions read it. */
export interface OutboxRow {
    id: string;
    kind: string;
    aggregateId: string;
    dispatchedAt: Date | null;
    attempts: number;
}

/**
 * Take the outbox dispatcher out of service, and return the undo.
 *
 * Two things have to stop, because there are two paths that drain: the
 * **post-commit** call `UnitOfWork.run` makes, and the **poll backstop**
 * interval started at bootstrap. Stubbing `drain` covers the first; clearing
 * the timer (via the real teardown hook) covers the second — without it a
 * background tick would deliver the events a moment after the assertion and
 * make the test flaky rather than wrong.
 *
 * This is how a subscriber process being down is simulated: `run` swallows a
 * failed drain by design, so the mutation still commits and the rows simply
 * stay undispatched — which is the whole point of an outbox and exactly what
 * the recovery assertion then exercises.
 */
export function suspendOutboxDispatch(app: INestApplication): () => void {
    const dispatcher = app.get(OutboxDispatcher);
    const realDrain = dispatcher.drain.bind(dispatcher);

    // Stop the interval. Idempotent, and the app's own teardown re-runs it.
    dispatcher.onModuleDestroy();
    dispatcher.drain = async () => {
        throw new Error('outbox dispatcher is down (test)');
    };

    return () => {
        dispatcher.drain = realDrain;
    };
}

/** Drain the outbox now — "the dispatcher came back". */
export async function drainOutbox(app: INestApplication): Promise<void> {
    await app.get(OutboxDispatcher).drain();
}

/**
 * Every outbox row for one aggregate, oldest first.
 *
 * Scoped by aggregate rather than read wholesale so an assertion says what it
 * means — "this mutation wrote these events" — independently of anything else
 * the same test did. (`resetDb` does truncate `outbox_events`, so rows never
 * cross a test boundary; the scoping is about clarity, not isolation.)
 */
export async function getOutboxRows(aggregateId: string): Promise<OutboxRow[]> {
    const { rows } = await getPool().query<OutboxRow>(
        `SELECT id, kind, aggregate_id AS "aggregateId",
                dispatched_at AS "dispatchedAt", attempts
         FROM outbox_events
         WHERE aggregate_id = $1
         ORDER BY occurred_at, id`,
        [aggregateId]
    );
    return rows;
}

/**
 * Park an outbox row by hand: spend its whole attempt budget and clear its
 * schedule, so the dead-letter query finds it.
 *
 * A shortcut, and only legitimate where the parked *state* is the fixture
 * rather than the thing under test — the route suites, which need a dead letter
 * to act on and do not care how it got there. The dispatcher suite reaches the
 * same state by failing a real subscriber fifteen times through the real drain,
 * because a test that parks a row with its own `UPDATE` and then un-parks it
 * proves the `UPDATE`.
 */
export async function parkEvent(id: string): Promise<void> {
    await getPool().query(
        `UPDATE outbox_events
         SET attempts = $2, next_attempt_at = NULL,
             last_error = COALESCE(last_error, 'Error: parked by the test harness')
         WHERE id = $1`,
        [id, MAX_DELIVERY_ATTEMPTS]
    );
}

/**
 * Move a delivered row's `dispatched_at` back by `days`.
 *
 * Backdating with an `UPDATE` rather than faking a clock: the cutoff is
 * computed in the process but compared in the database, so a mocked `Date`
 * would only move one of the two. The idiom is `outbox-dispatcher.spec.ts`'s.
 */
export async function backdateDispatched(
    id: string,
    days: number
): Promise<void> {
    await getPool().query(
        `UPDATE outbox_events
         SET dispatched_at = now() - ($2 || ' days')::interval
         WHERE id = $1`,
        [id, String(days)]
    );
}

/**
 * Move a row's `occurred_at` back by `days`, leaving `dispatched_at` alone.
 *
 * The retention sweep must cut on delivery time, never on domain time: an event
 * can be raised long before it is delivered, and cutting on `occurred_at` would
 * delete a row that went out this morning because the fact it carries is old.
 * That is only assertable with a row whose two timestamps disagree.
 */
export async function backdateOccurred(
    id: string,
    days: number
): Promise<void> {
    await getPool().query(
        `UPDATE outbox_events
         SET occurred_at = now() - ($2 || ' days')::interval
         WHERE id = $1`,
        [id, String(days)]
    );
}

/** How many `outbox_events` rows there are, optionally narrowed to one kind. */
export async function countOutbox(kind?: string): Promise<number> {
    const { rows } = kind
        ? await getPool().query<{ c: number }>(
              `SELECT count(*)::int AS c FROM outbox_events WHERE kind = $1`,
              [kind]
          )
        : await getPool().query<{ c: number }>(
              `SELECT count(*)::int AS c FROM outbox_events`
          );
    return rows[0].c;
}

/** Does a row with this id still exist? */
export async function outboxRowExists(id: string): Promise<boolean> {
    const { rowCount } = await getPool().query(
        `SELECT 1 FROM outbox_events WHERE id = $1`,
        [id]
    );
    return (rowCount ?? 0) > 0;
}

/** One row read back in full, for the assertions that need every column. */
export async function readOutboxRow(id: string): Promise<{
    attempts: number;
    dispatchedAt: Date | null;
    nextAttemptAt: Date | null;
    lastError: string | null;
} | null> {
    const { rows } = await getPool().query<{
        attempts: number;
        dispatchedAt: Date | null;
        nextAttemptAt: Date | null;
        lastError: string | null;
    }>(
        `SELECT attempts,
                dispatched_at AS "dispatchedAt",
                next_attempt_at AS "nextAttemptAt",
                last_error AS "lastError"
         FROM outbox_events WHERE id = $1`,
        [id]
    );
    return rows[0] ?? null;
}

/**
 * Insert one outbox row directly and answer its id.
 *
 * Bypasses `OutboxWriter` on purpose: these suites are about the *rows*, and
 * going through a unit of work would drag a post-commit drain in with it.
 */
export async function insertOutboxRow(options: {
    kind: string;
    aggregateId?: string;
    dispatched?: boolean;
}): Promise<string> {
    const { rows } = await getPool().query<{ id: string }>(
        `INSERT INTO outbox_events
             (kind, aggregate_type, aggregate_id, payload, occurred_at, dispatched_at)
         VALUES ($1, 'qa-outbox', $2, '{}'::jsonb, now(), $3)
         RETURNING id`,
        [
            options.kind,
            options.aggregateId ?? 'qa-1',
            options.dispatched ? new Date() : null
        ]
    );
    return rows[0].id;
}
