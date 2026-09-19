import {
    MAX_DELIVERY_ATTEMPTS,
    nextAttemptAfter,
    OutboxDispatcher
} from './outbox-dispatcher';
import type { Database } from '../types';

const NOW = new Date('2026-01-01T00:00:00.000Z');

/**
 * Retention off for every dispatcher built here. These specs stub the database
 * down to a `transaction` method, and the retention sweep is a real `DELETE`
 * against a real table — it is asserted in
 * `apps/server-e2e/src/server/database/outbox-retention.spec.ts`, where there
 * is one.
 */
const NO_RETENTION = 0;
const delayAfter = (attempts: number) =>
    nextAttemptAfter(attempts, NOW).getTime() - NOW.getTime();

/**
 * The retry schedule. It is the half of the retry ceiling that decides whether
 * the ceiling protects anything: drains are triggered by commits, so without a
 * delay a busy server would spend every attempt in milliseconds and park events
 * whose subscriber was merely restarting.
 */
describe('nextAttemptAfter', () => {
    it('waits a second after the first failure', () => {
        expect(delayAfter(1)).toBe(1_000);
    });

    it('doubles with each further failure [database:I-17]', () => {
        expect(delayAfter(2)).toBe(2_000);
        expect(delayAfter(3)).toBe(4_000);
        expect(delayAfter(4)).toBe(8_000);
        expect(delayAfter(8)).toBe(128_000);
    });

    it('plateaus at five minutes rather than running away [database:I-17]', () => {
        expect(delayAfter(9)).toBe(256_000);
        expect(delayAfter(MAX_DELIVERY_ATTEMPTS)).toBe(300_000);
        expect(delayAfter(100)).toBe(300_000);
    });

    it('gives a row roughly half an hour before it is a dead letter', () => {
        const total = Array.from({ length: MAX_DELIVERY_ATTEMPTS }, (_, i) =>
            delayAfter(i + 1)
        ).reduce((sum, delay) => sum + delay, 0);

        expect(total).toBeGreaterThan(20 * 60_000);
        expect(total).toBeLessThan(60 * 60_000);
    });

    it('never schedules a retry in the past [database:I-17]', () => {
        for (let attempts = 1; attempts <= MAX_DELIVERY_ATTEMPTS; attempts++) {
            expect(nextAttemptAfter(attempts, NOW).getTime()).toBeGreaterThan(
                NOW.getTime()
            );
        }
    });
});

/**
 * Shutdown, as a promise-ordering property — which is the only part of the
 * dispatcher worth mocking. Anything needing a real transaction, pool or drain
 * lives in `apps/server-e2e/src/server/database/outbox-dispatcher.spec.ts`.
 */
describe('onModuleDestroy', () => {
    /** A `Database` whose `transaction` resolves when the test says so. */
    const controllableDb = () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let started = 0;
        const db = {
            transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
                started += 1;
                await gate;
                await fn({
                    select: () => ({
                        from: () => ({
                            where: () => ({
                                orderBy: () => ({
                                    limit: () => ({ for: async () => [] })
                                })
                            })
                        })
                    })
                });
            }
        } as unknown as Database;
        return { db, release, startedCount: () => started };
    };

    it('waits for a drain already in flight instead of abandoning it [database:I-20]', async () => {
        // Before: `onModuleDestroy` cleared the interval and returned. A drain
        // running when SIGTERM arrived died mid-batch with its connection —
        // subscribers that had already run were never marked delivered, so
        // those events were re-delivered on the next boot. Safe only because
        // the one shipped subscriber is idempotent.
        const { db, release } = controllableDb();
        const dispatcher = new OutboxDispatcher(db, [], NO_RETENTION);

        const drain = dispatcher.drain();
        let drainFinished = false;
        void drain.then(() => {
            drainFinished = true;
        });

        const destroyed = dispatcher.onModuleDestroy().then(() => {
            expect(drainFinished).toBe(true);
        });

        expect(drainFinished).toBe(false);
        release();
        await Promise.all([drain, destroyed]);
    });

    it('also waits for the drain queued behind the active one', async () => {
        // A second caller during an in-flight drain does not start its own —
        // it joins one queued drain. Awaiting only the active one would walk
        // away from that.
        const { db, release, startedCount } = controllableDb();
        const dispatcher = new OutboxDispatcher(db, [], NO_RETENTION);

        const first = dispatcher.drain();
        const second = dispatcher.drain();

        const destroyed = dispatcher.onModuleDestroy();
        release();
        await destroyed;

        expect(startedCount()).toBe(2);
        await Promise.all([first, second]);
    });

    it('does not throw when the in-flight drain fails [database:I-20]', async () => {
        // A throw here would abort the rest of the shutdown, and a failing
        // drain has already logged.
        const db = {
            transaction: async () => {
                throw new Error('connection terminated unexpectedly');
            }
        } as unknown as Database;
        const dispatcher = new OutboxDispatcher(db, [], NO_RETENTION);

        await expect(dispatcher.drain()).rejects.toThrow();
        await expect(dispatcher.onModuleDestroy()).resolves.toBeUndefined();
    });

    it('returns immediately when nothing is draining', async () => {
        const dispatcher = new OutboxDispatcher(
            {} as unknown as Database,
            [],
            NO_RETENTION
        );

        await expect(dispatcher.onModuleDestroy()).resolves.toBeUndefined();
    });
});
