import { sql } from 'drizzle-orm';
import {
    createDomainEvent,
    getPool,
    OutboxWriter,
    UnitOfWork
} from '@orthacms/database';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { resetDb } from '../../support/seed';
import { getOutboxRows } from '../../support/outbox';

/**
 * The transaction boundary every use case is written on top of.
 *
 * `UnitOfWork` is asserted indirectly by a thousand cases — they mutate and the
 * mutation sticks, so a transaction must be happening. What that never pins
 * down is the part the outbox pattern actually depends on: that the events and
 * the state change are in the *same* transaction, that a nested `run` does not
 * open a second one, and that appending outside a unit of work is refused
 * rather than quietly committed on its own connection.
 */
describe('UnitOfWork + OutboxWriter (transaction boundary)', () => {
    let harness: TestApp;
    let uow: UnitOfWork;
    let outbox: OutboxWriter;

    const event = (aggregateId: string, kind = 'qa.uow.event') =>
        createDomainEvent({
            kind,
            aggregateType: 'qa-uow',
            aggregateId,
            payload: { hello: 'world' }
        });

    beforeAll(async () => {
        harness = await createTestApp();
        uow = harness.app.get(UnitOfWork);
        outbox = harness.app.get(OutboxWriter);
    });
    afterAll(async () => {
        await closeTestApp(harness);
    });
    beforeEach(async () => {
        await resetDb();
    });

    it('runs the callback in one transaction, and a nested run joins it [database:I-07]', async () => {
        const seen: string[] = [];
        let innerExecutorIsOuter = false;

        await uow.run(async () => {
            const outer = uow.current();
            seen.push(
                String(
                    (await outer.execute(sql`select txid_current() as t`))
                        .rows[0].t
                )
            );
            await uow.run(async () => {
                const inner = uow.current();
                innerExecutorIsOuter = inner === outer;
                seen.push(
                    String(
                        (await inner.execute(sql`select txid_current() as t`))
                            .rows[0].t
                    )
                );
            });
        });

        // Same backend transaction id from both levels: one BEGIN, not two.
        expect(seen[0]).toBe(seen[1]);
        expect(innerExecutorIsOuter).toBe(true);
    });

    it('rolls the appended events back with the state change that produced them [database:I-10]', async () => {
        const aggregateId = 'rollback-1';

        await expect(
            uow.run(async () => {
                await outbox.append([event(aggregateId)]);
                throw new Error('the use case failed after appending');
            })
        ).rejects.toThrow('the use case failed after appending');

        expect(await getOutboxRows(aggregateId)).toEqual([]);
    });

    it('commits the events with the state change that produced them [database:I-10] [database:I-21]', async () => {
        const aggregateId = 'commit-1';

        await uow.run(async () => {
            await outbox.append([
                event(aggregateId, 'qa.uow.first'),
                event(aggregateId, 'qa.uow.second')
            ]);
        });

        const rows = await getOutboxRows(aggregateId);
        expect(rows.map((row) => row.kind).sort()).toEqual([
            'qa.uow.first',
            'qa.uow.second'
        ]);
        // No subscriber wants these kinds, so the post-commit drain delivers
        // them to nobody and stamps them — `attempts` is what stays at zero.
        expect(rows.map((row) => row.attempts)).toEqual([0, 0]);
    });

    it('is a no-op for an empty event array [database:I-11]', async () => {
        await expect(
            uow.run(async () => {
                await outbox.append([]);
            })
        ).resolves.toBeUndefined();
    });

    it('rejects the whole unit of work when one append repeats an eventId [database:I-12]', async () => {
        const aggregateId = 'duplicate-1';
        const eventId = '11111111-2222-4333-8444-555555555555';
        const duplicate = () =>
            createDomainEvent({
                eventId,
                kind: 'qa.uow.dup',
                aggregateType: 'qa-uow',
                aggregateId,
                payload: {}
            });

        const error = await uow
            .run(async () => {
                await outbox.append([duplicate(), duplicate()]);
            })
            .catch((caught: unknown) => caught);

        // The uuid primary key is the idempotency key, so the repeat is a
        // unique violation — and it takes the caller's transaction with it.
        expect((error as { cause?: { code?: string } }).cause?.code).toBe(
            '23505'
        );
        expect(await getOutboxRows(aggregateId)).toEqual([]);
    });

    it('refuses an append outside a unit of work instead of committing it alone [database:I-09]', async () => {
        const aggregateId = 'detached-1';

        // Before this was enforced, the insert ran on the base pool as its own
        // auto-commit statement: the event could outlive a state change that
        // rolled back, which is precisely what the outbox exists to prevent —
        // and it did it silently, so nothing ever surfaced the mistake.
        await expect(outbox.append([event(aggregateId)])).rejects.toThrow(
            'must be called inside UnitOfWork.run'
        );

        expect(await getOutboxRows(aggregateId)).toEqual([]);
    });

    it('reports whether a unit of work is active, and hands out the base connection outside one [database:I-08]', async () => {
        expect(uow.isActive()).toBe(false);

        await uow.run(async () => {
            expect(uow.isActive()).toBe(true);
        });

        expect(uow.isActive()).toBe(false);

        // Reads outside a unit of work stay legal — `current()` falls back to
        // the pool on purpose; only writes to the outbox are refused.
        const rows = await uow
            .current()
            .execute(sql`select count(*)::int as c from outbox_events`);
        expect(rows.rows[0].c).toBe(0);
        expect(getPool().totalCount).toBeGreaterThan(0);
    });
});
