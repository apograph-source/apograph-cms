import {
    DatabaseModule,
    DEFAULT_OUTBOX_RETENTION_DAYS,
    MAX_DELIVERY_ATTEMPTS,
    OUTBOX_RETENTION_DAYS,
    OutboxDispatcher
} from '@apograph/database';
import type { ValueProvider } from '@nestjs/common';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { resetDb } from '../../support/seed';
import {
    backdateDispatched,
    backdateOccurred,
    countOutbox,
    insertOutboxRow,
    outboxRowExists,
    parkEvent,
    readOutboxRow
} from '../../support/outbox';

/**
 * Retention for `outbox_events` — the sweep that stops the transactional
 * outbox being a permanent archive of every fact the system has ever emitted.
 *
 * The highest-severity failure here is not "the table grew". It is a **dead
 * letter being deleted**: a parked row is the only evidence that something —
 * very often an audit row — was never recorded, and a sweep that took one would
 * make an audit gap invisible again, which is precisely the condition the
 * dead-letter route exists to end. So the survival assertions carry as much
 * weight as the deletion ones, and both a pending and a parked row are aged far
 * past any window before being checked.
 *
 * Every window is reached by **backdating rows with `UPDATE`**, never by faking
 * a clock: the cutoff is computed in this process and compared inside Postgres,
 * so a mocked `Date` would move one side of the comparison and not the other.
 * The idiom is `outbox-dispatcher.spec.ts`'s.
 */
describe('outbox retention (sweep on, one-day window)', () => {
    let harness: TestApp;
    let dispatcher: OutboxDispatcher;

    /** Reaches the private hourly guard — see the note on the first test using it. */
    const pruneIfDue = () =>
        (dispatcher as unknown as { pruneIfDue(): Promise<void> }).pruneIfDue();

    beforeAll(async () => {
        // The only suite in the run that boots with retention **on**. Every
        // other one takes the harness default of 0, because a background sweep
        // deleting rows mid-assertion is unreadable afterwards.
        harness = await createTestApp({ database: { outboxRetentionDays: 1 } });
        dispatcher = harness.app.get(OutboxDispatcher);
    });
    afterAll(async () => {
        await closeTestApp(harness);
    });
    beforeEach(async () => {
        await resetDb();
        // Stop the 5-second poll backstop, which is also what calls the sweep.
        // Without this a tick lands between the arrange and the assert and the
        // suite is flaky rather than wrong. The app's own teardown re-runs it.
        dispatcher.onModuleDestroy();
        // The guard is an in-process field and the app is shared across tests,
        // so a sweep in one test would suppress the next one's for an hour.
        (dispatcher as unknown as { lastPrunedAt: number }).lastPrunedAt = 0;
    });

    describe('what the window takes', () => {
        it('deletes a delivered row stamped before the cutoff', async () => {
            const id = await insertOutboxRow({
                kind: 'qa.retention.old',
                dispatched: true
            });
            await backdateDispatched(id, 40);

            const removed = await dispatcher.pruneDelivered(
                new Date(Date.now() - 30 * 24 * 60 * 60_000)
            );

            expect(removed).toBe(1);
            expect(await outboxRowExists(id)).toBe(false);
        });

        it('keeps a delivered row stamped inside the window', async () => {
            const id = await insertOutboxRow({
                kind: 'qa.retention.recent',
                dispatched: true
            });
            await backdateDispatched(id, 3);

            const removed = await dispatcher.pruneDelivered(
                new Date(Date.now() - 30 * 24 * 60 * 60_000)
            );

            expect(removed).toBe(0);
            expect(await outboxRowExists(id)).toBe(true);
        });

        it('cuts on dispatched_at, never on occurred_at', async () => {
            // The row that tells the two clocks apart: the fact is a year old,
            // the delivery happened this morning. Cutting on domain time would
            // delete an event that went out today because what it describes is
            // old — and nothing else in this suite could notice, because every
            // other row has both timestamps in the same place.
            const id = await insertOutboxRow({
                kind: 'qa.retention.clocks',
                dispatched: true
            });
            await backdateOccurred(id, 365);

            const removed = await dispatcher.pruneDelivered(
                new Date(Date.now() - 30 * 24 * 60 * 60_000)
            );

            expect(removed).toBe(0);
            expect(await outboxRowExists(id)).toBe(true);
        });

        it('removes only the rows past the cutoff when both are present', async () => {
            const old = await insertOutboxRow({
                kind: 'qa.retention.mixed',
                dispatched: true
            });
            const recent = await insertOutboxRow({
                kind: 'qa.retention.mixed',
                dispatched: true
            });
            await backdateDispatched(old, 90);
            await backdateDispatched(recent, 1);

            const removed = await dispatcher.pruneDelivered(
                new Date(Date.now() - 30 * 24 * 60 * 60_000)
            );

            expect(removed).toBe(1);
            expect(await outboxRowExists(old)).toBe(false);
            expect(await outboxRowExists(recent)).toBe(true);
        });
    });

    /**
     * The half that matters most. Both of these rows carry `dispatched_at IS
     * NULL`, which is what excludes them from the predicate — **by
     * construction, not by a clause**. There is deliberately no `AND attempts <
     * 15` in the sweep: that spells the same intent in a form a later edit can
     * break, and would start taking pending rows the moment somebody tidied it
     * away.
     */
    describe('what the window can never take [database:I-14]', () => {
        it('never deletes a pending row, however old the fact is', async () => {
            const id = await insertOutboxRow({ kind: 'qa.retention.pending' });
            await backdateOccurred(id, 400);

            const removed = await dispatcher.pruneDelivered(new Date());

            expect(removed).toBe(0);
            expect(await outboxRowExists(id)).toBe(true);
        });

        it('never deletes a PARKED row, however old the fact is', async () => {
            // A silently deleted dead letter is an audit gap made invisible
            // again — the single worst outcome this feature could produce.
            const id = await insertOutboxRow({ kind: 'qa.retention.parked' });
            await parkEvent(id);
            await backdateOccurred(id, 400);

            const removed = await dispatcher.pruneDelivered(new Date());

            expect(removed).toBe(0);
            expect(await outboxRowExists(id)).toBe(true);
            expect((await readOutboxRow(id))?.attempts).toBe(
                MAX_DELIVERY_ATTEMPTS
            );
        });

        it('takes the delivered row and leaves its parked neighbour', async () => {
            const delivered = await insertOutboxRow({
                kind: 'qa.retention.pair',
                dispatched: true
            });
            const parked = await insertOutboxRow({ kind: 'qa.retention.pair' });
            await backdateDispatched(delivered, 90);
            await parkEvent(parked);
            await backdateOccurred(parked, 90);

            expect(
                await dispatcher.pruneDelivered(
                    new Date(Date.now() - 30 * 24 * 60 * 60_000)
                )
            ).toBe(1);
            expect(await countOutbox('qa.retention.pair')).toBe(1);
            expect(await outboxRowExists(parked)).toBe(true);
        });
    });

    /**
     * The scheduling guard, reached through the private method.
     *
     * Going round the encapsulation is the honest option here and not
     * laziness: the only other way in is the five-second poll tick, and the
     * claim under test is that the *second* call inside an hour does nothing —
     * which is not observable at all without either this or an hour of
     * wall-clock. `pruneDelivered` itself, the part that carries the `DELETE`
     * predicate, is public precisely so it needs none of this.
     */
    describe('the hourly guard', () => {
        it('sweeps on a due tick and then holds off for an hour', async () => {
            const first = await insertOutboxRow({
                kind: 'qa.retention.due',
                dispatched: true
            });
            await backdateDispatched(first, 5);

            await pruneIfDue();
            expect(await outboxRowExists(first)).toBe(false);

            // A second row, equally overdue, and a second tick immediately
            // afterwards: the guard, not the predicate, is what spares it.
            const second = await insertOutboxRow({
                kind: 'qa.retention.due',
                dispatched: true
            });
            await backdateDispatched(second, 5);

            await pruneIfDue();
            expect(await outboxRowExists(second)).toBe(true);
        });

        it('hands the slot back when the sweep fails, so the next tick retries', async () => {
            // The guard used to be armed *before* the `await`, so a sweep that
            // threw — a dropped connection, a pool timeout — consumed its hourly
            // slot without deleting anything, and nothing swept for a full hour.
            // `pollOnce` meanwhile logged that the next tick would pick it up.
            const row = await insertOutboxRow({
                kind: 'qa.retention.failed',
                dispatched: true
            });
            await backdateDispatched(row, 5);

            const failing = jest
                .spyOn(dispatcher, 'pruneDelivered')
                .mockRejectedValueOnce(
                    new Error('Connection terminated unexpectedly')
                );
            await expect(pruneIfDue()).rejects.toThrow(
                'Connection terminated unexpectedly'
            );
            failing.mockRestore();
            expect(await outboxRowExists(row)).toBe(true);

            // The assertion that matters: the very next tick sweeps. Under the
            // old arming this second call returned without touching the table.
            await pruneIfDue();
            expect(await outboxRowExists(row)).toBe(false);
        });
    });

    describe('the configured window', () => {
        it('is the one the host handed the plugin', () => {
            expect(harness.app.get<number>(OUTBOX_RETENTION_DAYS)).toBe(1);
        });
    });
});

/**
 * `0` is the off switch, and it has to be the whole off switch: a deployment
 * that asks for no retention must get a sweep that does not run, not one that
 * runs with a cutoff of "now".
 */
describe('outbox retention (sweep switched off)', () => {
    let harness: TestApp;
    let dispatcher: OutboxDispatcher;

    beforeAll(async () => {
        // Also the harness default, which is what every other suite boots with.
        harness = await createTestApp({ database: { outboxRetentionDays: 0 } });
        dispatcher = harness.app.get(OutboxDispatcher);
    });
    afterAll(async () => {
        await closeTestApp(harness);
    });
    beforeEach(async () => {
        await resetDb();
        dispatcher.onModuleDestroy();
        (dispatcher as unknown as { lastPrunedAt: number }).lastPrunedAt = 0;
    });

    it('deletes nothing at all, however old the delivered rows are', async () => {
        const id = await insertOutboxRow({
            kind: 'qa.retention.off',
            dispatched: true
        });
        await backdateDispatched(id, 3_650);

        await (
            dispatcher as unknown as { pruneIfDue(): Promise<void> }
        ).pruneIfDue();

        expect(await outboxRowExists(id)).toBe(true);
    });

    it('reports 0 as the configured window', () => {
        expect(harness.app.get<number>(OUTBOX_RETENTION_DAYS)).toBe(0);
    });

    /**
     * The default a host that configures nothing gets, asserted on the wiring
     * rather than on the constant alone — a correct constant bound to nothing
     * is the failure this catches.
     */
    it('defaults to 30 days when the plugin is given no window', () => {
        expect(DEFAULT_OUTBOX_RETENTION_DAYS).toBe(30);

        const provider = (DatabaseModule.forRoot().providers ?? []).find(
            (candidate): candidate is ValueProvider<number> =>
                typeof candidate === 'object' &&
                'provide' in candidate &&
                candidate.provide === OUTBOX_RETENTION_DAYS
        );

        expect(provider?.useValue).toBe(30);
    });
});
