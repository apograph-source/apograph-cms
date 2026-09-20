import type { INestApplication } from '@nestjs/common';
import { getPool, OutboxDispatcher } from '@ortha/database';

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
