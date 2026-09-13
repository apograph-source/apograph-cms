import { sql } from 'drizzle-orm';
import {
    createDomainEvent,
    getPool,
    DATABASE_TOKEN,
    MAX_DELIVERY_ATTEMPTS,
    OutboxDispatcher,
    OutboxWriter,
    UnitOfWork,
    type Database,
    type DomainEvent,
    type DomainEventSubscriber
} from '@apograph/database';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { resetDb } from '../../support/seed';

/** Collects what it was handed. Scoped to test-only kinds so it sees nothing else. */
class Collector implements DomainEventSubscriber {
    readonly seen: string[] = [];
    constructor(readonly kinds: readonly string[] | '*') {}
    async handle(event: DomainEvent): Promise<void> {
        this.seen.push(event.eventId);
    }
}

/** Never succeeds — the poison message the retry ceiling exists for. */
class AlwaysFails implements DomainEventSubscriber {
    calls = 0;
    constructor(readonly kinds: readonly string[] | '*') {}
    async handle(): Promise<void> {
        this.calls += 1;
        throw new Error('this subscriber can never succeed');
    }
}

const BASE = Date.parse('2026-01-01T00:00:00Z');

/**
 * The outbox drain: what it claims, what it retries, what it gives up on, and
 * how many of it may run at once.
 *
 * The last one is not a performance question. A drain holds a pool client for
 * its whole batch while the subscribers it calls acquire clients of their own,
 * so unbounded drain concurrency is a pool deadlock — reproduced from a dozen
 * concurrent requests over a backlog, and unrecoverable when it happens.
 */
describe('OutboxDispatcher (drain, retry ceiling, concurrency)', () => {
    let harness: TestApp;
    let dispatcher: OutboxDispatcher;
    let uow: UnitOfWork;
    let outbox: OutboxWriter;
    let db: Database;

    /** Insert `count` pending rows of `kind`, one second apart, oldest first. */
    async function seedPending(
        count: number,
        kind: string,
        firstOccurredAt = BASE
    ): Promise<void> {
        const values: string[] = [];
        const params: unknown[] = [];
        for (let i = 0; i < count; i += 1) {
            params.push(
                kind,
                String(i),
                new Date(firstOccurredAt + i * 1000).toISOString()
            );
            const at = params.length;
            values.push(
                `($${at - 2}::text, 'qa-outbox', $${at - 1}::text, '{}'::jsonb, $${at}::timestamptz)`
            );
        }
        await getPool().query(
            `INSERT INTO outbox_events (kind, aggregate_type, aggregate_id, payload, occurred_at)
             VALUES ${values.join(',')}`,
            params
        );
    }

    /**
     * Make every failed row eligible again right now.
     *
     * Retries are spaced by a doubling backoff, which is the point of the
     * ceiling — so a test that wants to reach it has to move time rather than
     * loop faster. Clearing the schedule is the honest way to do that without
     * faking a clock the database also reads.
     */
    const makeRetriesDue = () =>
        getPool().query(
            `UPDATE outbox_events SET next_attempt_at = NULL WHERE dispatched_at IS NULL`
        );

    const countWhere = async (predicate: string, kind: string) =>
        Number(
            (
                await getPool().query(
                    `SELECT count(*)::int AS c FROM outbox_events WHERE kind = $1 AND ${predicate}`,
                    [kind]
                )
            ).rows[0].c
        );

    beforeAll(async () => {
        harness = await createTestApp();
        dispatcher = harness.app.get(OutboxDispatcher);
        uow = harness.app.get(UnitOfWork);
        outbox = harness.app.get(OutboxWriter);
        db = harness.app.get<Database>(DATABASE_TOKEN);
    });
    afterAll(async () => {
        await closeTestApp(harness);
    });
    beforeEach(async () => {
        await resetDb();
        // Stop the 5-second poll backstop for the duration of each test, so the
        // only drains are the ones the test asks for. Without this a background
        // tick lands between the arrange and the assert and the suite is flaky
        // rather than wrong. The app's own teardown re-runs this hook.
        dispatcher.onModuleDestroy();
    });

    it('claims the oldest batch, delivers it, and stamps what it delivered [database:I-14]', async () => {
        const collector = new Collector(['qa.batch']);
        dispatcher.register(collector);
        await seedPending(150, 'qa.batch');

        await dispatcher.drain();

        expect(collector.seen).toHaveLength(100);
        expect(await countWhere('dispatched_at IS NOT NULL', 'qa.batch')).toBe(
            100
        );

        // The 100 it took are the 100 oldest: every delivered row is older than
        // every row still waiting.
        const { rows } = await getPool().query(
            `SELECT max(occurred_at) FILTER (WHERE dispatched_at IS NOT NULL) AS newest_done,
                    min(occurred_at) FILTER (WHERE dispatched_at IS NULL)     AS oldest_left
             FROM outbox_events WHERE kind = 'qa.batch'`
        );
        expect(new Date(rows[0].newest_done).getTime()).toBeLessThan(
            new Date(rows[0].oldest_left).getTime()
        );
    });

    it('delivers only to subscribers whose kinds match, once per registration', async () => {
        const narrow = new Collector(['qa.match.a']);
        const wildcard = new Collector('*');
        dispatcher.register(narrow);
        dispatcher.register(wildcard);
        await seedPending(1, 'qa.match.a');
        await seedPending(1, 'qa.match.b', BASE + 1000);

        await dispatcher.drain();

        expect(narrow.seen).toHaveLength(1);
        expect(wildcard.seen).toHaveLength(2);
    });

    it('increments attempts and leaves the row pending when a subscriber throws [database:I-14] [database:I-15]', async () => {
        const failing = new AlwaysFails(['qa.retry']);
        dispatcher.register(failing);
        await seedPending(1, 'qa.retry');

        await dispatcher.drain();
        await makeRetriesDue();
        await dispatcher.drain();

        const { rows } = await getPool().query(
            `SELECT attempts, dispatched_at FROM outbox_events WHERE kind = 'qa.retry'`
        );
        expect(rows[0].attempts).toBe(2);
        expect(rows[0].dispatched_at).toBeNull();
        expect(failing.calls).toBe(2);
    });

    it('spaces retries out instead of burning the ceiling at commit rate [database:I-15]', async () => {
        const failing = new AlwaysFails(['qa.backoff']);
        dispatcher.register(failing);
        await seedPending(1, 'qa.backoff');

        await dispatcher.drain();
        const scheduled = (
            await getPool().query(
                `SELECT attempts, next_attempt_at FROM outbox_events WHERE kind = 'qa.backoff'`
            )
        ).rows[0];
        expect(scheduled.attempts).toBe(1);
        expect(new Date(scheduled.next_attempt_at).getTime()).toBeGreaterThan(
            Date.now()
        );

        // Drains are triggered by commits, so on a busy server they run back to
        // back. Without the schedule, a subscriber that was down for a second
        // would have every event parked before it came back.
        await dispatcher.drain();
        await dispatcher.drain();
        expect(failing.calls).toBe(1);
        expect(
            (
                await getPool().query(
                    `SELECT attempts FROM outbox_events WHERE kind = 'qa.backoff'`
                )
            ).rows[0].attempts
        ).toBe(1);
    });

    it('stops claiming a row once it has failed MAX_DELIVERY_ATTEMPTS times [database:I-16]', async () => {
        const failing = new AlwaysFails(['qa.poison']);
        dispatcher.register(failing);
        await seedPending(1, 'qa.poison');

        for (let i = 0; i < MAX_DELIVERY_ATTEMPTS + 3; i += 1) {
            await makeRetriesDue();
            await dispatcher.drain();
        }

        // It is parked, not deleted and not marked delivered: the row stays
        // queryable as a dead letter, and the subscriber stopped being called.
        const { rows } = await getPool().query(
            `SELECT attempts, dispatched_at FROM outbox_events WHERE kind = 'qa.poison'`
        );
        expect(rows[0].attempts).toBe(MAX_DELIVERY_ATTEMPTS);
        expect(rows[0].dispatched_at).toBeNull();
        expect(failing.calls).toBe(MAX_DELIVERY_ATTEMPTS);
    });

    it('does not let a full batch of poison rows starve the events behind them [database:I-16]', async () => {
        // The regression this exists for: the claim is `ORDER BY occurred_at
        // LIMIT 100`, so 100 permanently-failing rows used to occupy the whole
        // batch on every drain, forever, and nothing newer was ever delivered
        // again. `attempts` was written and never read, so nothing bounded it.
        const failing = new AlwaysFails(['qa.head']);
        const healthy = new Collector(['qa.tail']);
        dispatcher.register(failing);
        dispatcher.register(healthy);
        await seedPending(100, 'qa.head');
        await seedPending(2, 'qa.tail', BASE + 10_000_000);
        // Start the head one failure short of the ceiling: the climb itself is
        // asserted above, and 100 rows × 15 attempts of it here would buy
        // nothing but a slow test.
        await getPool().query(
            `UPDATE outbox_events SET attempts = $1 WHERE kind = 'qa.head'`,
            [MAX_DELIVERY_ATTEMPTS - 1]
        );

        for (let i = 0; i < 2; i += 1) {
            await makeRetriesDue();
            await dispatcher.drain();
        }

        expect(healthy.seen).toHaveLength(2);
        expect(await countWhere('dispatched_at IS NOT NULL', 'qa.tail')).toBe(
            2
        );
        expect(
            await countWhere(`attempts = ${MAX_DELIVERY_ATTEMPTS}`, 'qa.head')
        ).toBe(100);
    });

    it('collapses concurrent drains instead of running one per caller [database:I-18]', async () => {
        const collector = new Collector(['qa.parallel']);
        dispatcher.register(collector);
        await seedPending(500, 'qa.parallel');

        await Promise.all([
            dispatcher.drain(),
            dispatcher.drain(),
            dispatcher.drain(),
            dispatcher.drain(),
            dispatcher.drain()
        ]);

        // Five callers, but at most two drains: the one already running, plus a
        // single queued one that every later caller joins. Unbounded, these
        // five would each have claimed their own batch — and each held a pool
        // client while its subscribers asked for one of their own.
        expect(collector.seen.length).toBeGreaterThanOrEqual(100);
        expect(collector.seen.length).toBeLessThanOrEqual(200);
        // Whatever they delivered, they delivered once.
        expect(new Set(collector.seen).size).toBe(collector.seen.length);
    });

    it('keeps the pool usable when many units of work commit over a backlog [database:I-18]', async () => {
        // Reproduces the deadlock directly: every subscriber here needs a pool
        // client of its own while the drain that called it is holding one. With
        // a drain per committing request, all ten clients ended up held by
        // drains waiting for an eleventh that could never come — no timeout, no
        // log, and every later query on the process hung forever.
        class NeedsItsOwnConnection implements DomainEventSubscriber {
            readonly kinds = ['qa.backlog', 'qa.live'];
            delivered = 0;
            async handle(): Promise<void> {
                await db.execute(sql`select 1`);
                this.delivered += 1;
            }
        }
        const subscriber = new NeedsItsOwnConnection();
        dispatcher.register(subscriber);
        await seedPending(1200, 'qa.backlog');

        const commits = Array.from({ length: 12 }, (_, i) =>
            uow.run(async () => {
                await outbox.append([
                    createDomainEvent({
                        kind: 'qa.live',
                        aggregateType: 'qa-outbox',
                        aggregateId: `live-${i}`,
                        payload: {}
                    })
                ]);
            })
        );

        await expect(Promise.all(commits)).resolves.toHaveLength(12);
        expect(subscriber.delivered).toBeGreaterThan(0);
        // The pool is still answering, which is the whole assertion.
        await expect(db.execute(sql`select 1`)).resolves.toBeDefined();
        expect(getPool().waitingCount).toBe(0);
    });

    it('picks up a row nothing asked it to, once the poll backstop is running [database:I-13]', async () => {
        const collector = new Collector(['qa.poll']);
        dispatcher.register(collector);
        await seedPending(1, 'qa.poll');

        // The backstop is stopped by `beforeEach`: nothing drains on its own.
        await new Promise((resolve) => setTimeout(resolve, 6_000));
        expect(collector.seen).toHaveLength(0);

        try {
            dispatcher.onApplicationBootstrap();
            await new Promise((resolve) => setTimeout(resolve, 6_000));
            expect(collector.seen).toHaveLength(1);
        } finally {
            dispatcher.onModuleDestroy();
        }
    }, 25_000);

    it('delivers the rest of a batch around the row that failed [database:I-15]', async () => {
        // The clause the retry tests cannot see: they seed one row, so
        // "increments attempts and stays undelivered" and "takes the whole
        // batch down with it" look identical. A `catch` that re-threw — or one
        // moved outside the `for` — would roll the claim's transaction back and
        // strand three perfectly deliverable events behind one bad subscriber.
        const failing = new AlwaysFails(['qa.mixed.bad']);
        const healthy = new Collector(['qa.mixed.good']);
        dispatcher.register(failing);
        dispatcher.register(healthy);

        // Interleaved by `occurred_at`, so the failure sits in the middle of the
        // claim rather than at its end: rows both before and after it have to
        // come through.
        await seedPending(3, 'qa.mixed.good');
        await seedPending(1, 'qa.mixed.bad', BASE + 1500);

        await dispatcher.drain();

        expect(healthy.seen).toHaveLength(3);
        expect(
            await countWhere('dispatched_at IS NOT NULL', 'qa.mixed.good')
        ).toBe(3);
        // …and the bad one is parked for a retry, in the same transaction that
        // committed the other three.
        expect(
            await countWhere(
                'dispatched_at IS NULL AND attempts = 1',
                'qa.mixed.bad'
            )
        ).toBe(1);
        expect(failing.calls).toBe(1);
    });

    it('stamps an event nobody listens to on the first drain, unattempted [database:I-21]', async () => {
        // Every subscriber in the repository declares a narrow `kinds` list, so
        // a `qa.` kind genuinely has none — this is the empty-subscriber path,
        // not a lucky filter. The `attempts = 0` half is pinned by
        // `unit-of-work.spec.ts`; `dispatched_at` is what nothing read, and it
        // is the half that distinguishes "delivered immediately" from "left
        // pending for the poll backstop to look at again, forever".
        await seedPending(1, 'qa.unheard');

        await dispatcher.drain();

        const { rows } = await getPool().query(
            `SELECT attempts, dispatched_at, next_attempt_at, last_error
               FROM outbox_events WHERE kind = 'qa.unheard'`
        );
        expect(rows[0].dispatched_at).not.toBeNull();
        expect(rows[0].attempts).toBe(0);
        expect(rows[0].next_attempt_at).toBeNull();
        expect(rows[0].last_error).toBeNull();
    });

    it('bounds the shutdown wait at one batch [database:I-20]', async () => {
        // The unit spec pins that `onModuleDestroy` waits for the drain in
        // flight; what it cannot pin is that the wait *ends*. A drain that
        // looped until the outbox was empty would still satisfy "waits for the
        // in-flight drain" while turning every `SIGTERM` over a backlog into a
        // shutdown that hangs for as long as the queue is long.
        const collector = new Collector(['qa.shutdown']);
        dispatcher.register(collector);
        await seedPending(250, 'qa.shutdown');

        const inFlight = dispatcher.drain();
        await dispatcher.onModuleDestroy();

        // One batch, then out — and it really did wait for that batch rather
        // than returning to an empty result, which would read as 0 here.
        expect(collector.seen).toHaveLength(100);
        expect(await countWhere('dispatched_at IS NULL', 'qa.shutdown')).toBe(
            150
        );
        await inFlight;
    });

    it('takes disjoint rows in two processes without either blocking [database:I-19]', async () => {
        // A second `OutboxDispatcher` over the same database is what a second
        // *process* is, for everything this invariant is about: its own
        // `active`/`queued` state (so the in-process collapsing of
        // `database:I-18` does not apply), its own pool client, its own
        // transaction. Nothing in the claim is about operating-system
        // processes; it is about two concurrent claim transactions.
        const second = new OutboxDispatcher(db, []);

        /**
         * Neither subscriber may return until *both* have been called.
         *
         * This is the whole test. Disjointness alone does not distinguish
         * `SKIP LOCKED` from a plain `FOR UPDATE`: the second drain would block
         * until the first committed, then re-evaluate its `WHERE` against rows
         * now stamped `dispatched_at` and take the next hundred — disjoint, and
         * serialised. Only a rendezvous can tell the two apart, because it can
         * only be reached if both transactions are open at once.
         */
        const RENDEZVOUS_MS = 5_000;
        let arrived = 0;
        let release!: () => void;
        let timedOut = false;
        const opened = new Promise<void>((resolve) => (release = resolve));
        const meet = async () => {
            arrived += 1;
            if (arrived >= 2) {
                release();
            }
            await Promise.race([
                opened,
                new Promise<void>((resolve) =>
                    setTimeout(() => {
                        // Recorded rather than thrown: a throw here would fail
                        // the drain, and the failure would be reported as a
                        // subscriber error rather than as the deadlock it is.
                        timedOut = true;
                        resolve();
                    }, RENDEZVOUS_MS)
                )
            ]);
        };

        class MeetsTheOther implements DomainEventSubscriber {
            readonly kinds = ['qa.disjoint'];
            readonly seen: string[] = [];
            async handle(event: DomainEvent): Promise<void> {
                const first = this.seen.length === 0;
                this.seen.push(event.eventId);
                if (first) {
                    await meet();
                }
            }
        }

        const mine = new MeetsTheOther();
        const theirs = new MeetsTheOther();
        dispatcher.register(mine);
        second.register(theirs);

        // Two full batches' worth, so each drain has a hundred of its own to
        // take and neither is starved into looking disjoint by accident.
        await seedPending(200, 'qa.disjoint');

        await Promise.all([dispatcher.drain(), second.drain()]);

        // Both were mid-transaction at the same moment. Without `SKIP LOCKED`
        // the second `SELECT` waits on the first's row locks, the rendezvous is
        // never reached, and this is `true`.
        expect(timedOut).toBe(false);

        // Disjoint: no event was handed to both, and between them they took
        // exactly the two batches.
        expect(mine.seen).toHaveLength(100);
        expect(theirs.seen).toHaveLength(100);
        expect(new Set([...mine.seen, ...theirs.seen]).size).toBe(200);
        expect(
            await countWhere('dispatched_at IS NOT NULL', 'qa.disjoint')
        ).toBe(200);
    }, 25_000);
});
