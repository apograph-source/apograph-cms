import { Logger } from '@nestjs/common';
import { AlarmSweepService } from './alarm-sweep.service';
import type { AlarmRuleRecord } from './alarm-rule.repository';
import { ALARMS_DEFAULTS } from '../types/alarms-config';
import type { ResolvedAlarmsConfig } from '../types/alarms-config';

/**
 * The periodic sweep, tested where it is reachable.
 *
 * `AlarmSweepService` is deliberately **not** exported from the package index —
 * it is armed by the module and nothing outside calls it — so a server-e2e test
 * cannot get hold of an instance without widening the production surface for the
 * benefit of a test. Everything the invariants claim about it is about
 * scheduling rather than about content, and all three claims are visible with a
 * stubbed evaluator: whether two rules overlap, whether a second `sweep()`
 * starts a second pass, and whether shutdown waits.
 *
 * The evaluator is gated rather than merely counted. A pass that ran its rules
 * with `Promise.all` and one that ran them in order produce the *same* call
 * count and the same final state; the only thing that separates them is whether
 * the second rule started while the first was still in flight, which needs a
 * rescan that does not finish until the test says so.
 */

const WORKSPACE = '11111111-1111-4111-8111-111111111111';

function rule(id: string, name = `rule ${id}`): AlarmRuleRecord {
    return {
        id,
        workspaceId: WORKSPACE,
        contentType: 'article',
        name,
        findingTitle: 'Something is off',
        severity: 'warn',
        filter: { and: [{ field: 'status', op: 'eq', value: 'published' }] },
        enabled: true,
        brokenReason: null
    };
}

interface Gate {
    promise: Promise<void>;
    open: () => void;
    fail: (error: Error) => void;
}

function gate(): Gate {
    let open!: () => void;
    let fail!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
        open = () => resolve();
        fail = reject;
    });
    return { promise, open, fail };
}

/** Lets every already-scheduled microtask and immediate run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function sweeper(
    rules: AlarmRuleRecord[],
    config: Partial<ResolvedAlarmsConfig> = {}
) {
    /** Rules whose rescan has *begun*, in the order it began. */
    const started: string[] = [];
    /** Rules whose rescan has returned. */
    const finished: string[] = [];
    /**
     * Starts and ends interleaved. Counts and final states cannot tell a serial
     * pass from a parallel one — only the order of these can.
     */
    const events: string[] = [];
    const gates = new Map<string, Gate>();

    const evaluator = {
        rescan: jest.fn(async (target: AlarmRuleRecord) => {
            started.push(target.id);
            events.push(`start:${target.id}`);
            await gates.get(target.id)?.promise;
            finished.push(target.id);
            events.push(`end:${target.id}`);
            return {
                ruleId: target.id,
                scanned: 0,
                opened: 0,
                resolved: 0,
                open: 0
            };
        })
    };
    const repository = { allActive: jest.fn(async () => rules) };

    const service = new AlarmSweepService(
        repository as never,
        evaluator as never,
        { ...ALARMS_DEFAULTS, ...config }
    );

    return {
        service,
        evaluator,
        repository,
        started,
        finished,
        events,
        /** Holds `id`'s rescan open until the returned gate is opened. */
        hold(id: string): Gate {
            const held = gate();
            gates.set(id, held);
            return held;
        }
    };
}

describe('AlarmSweepService', () => {
    describe('one pass at a time', () => {
        it('rescans its rules one after another rather than all at once [alarms:I-23]', async () => {
            const harness = sweeper([rule('r1'), rule('r2')]);
            const first = harness.hold('r1');

            const pass = harness.service.sweep();
            await settle();

            // The discriminating moment: with `Promise.all` over the rules both
            // ids would be in `started` here. A scan reads whole collections,
            // and twenty of them at once turns a background hygiene task into
            // the heaviest thing the database is doing.
            expect(harness.events).toEqual(['start:r1']);

            first.open();
            await pass;

            // The second rule begins only after the first has returned. The
            // call counts are identical either way, which is why this reads the
            // interleaving instead.
            expect(harness.events).toEqual([
                'start:r1',
                'end:r1',
                'start:r2',
                'end:r2'
            ]);
        });

        it('collapses a second caller onto the sweep already running [alarms:I-23]', async () => {
            const harness = sweeper([rule('r1')]);
            const held = harness.hold('r1');

            const first = harness.service.sweep();
            const second = harness.service.sweep();

            await settle();

            // One pass, not two: the second caller joined the sweep in flight.
            // (`sweep` is `async`, so each call still returns its own wrapper
            // promise — identity is not the observable here, the work is.)
            expect(harness.repository.allActive).toHaveBeenCalledTimes(1);
            expect(harness.events).toEqual(['start:r1']);

            held.open();
            await first;
            await second;

            // Both callers are told the pass is done, and the rule was scanned
            // once between them.
            expect(harness.evaluator.rescan).toHaveBeenCalledTimes(1);
            expect(harness.events).toEqual(['start:r1', 'end:r1']);
        });

        it('sweeps again once the previous pass has finished', async () => {
            // The coalescing is a latch that clears, not a one-shot. Forgetting
            // the `finally` that nulls `running` would leave a process that
            // swept once and then never again — and the interval would keep
            // firing into it, silently.
            const harness = sweeper([rule('r1')]);

            await harness.service.sweep();
            await harness.service.sweep();

            expect(harness.repository.allActive).toHaveBeenCalledTimes(2);
            expect(harness.started).toEqual(['r1', 'r1']);
        });

        it('carries on to the remaining rules when one of them throws', async () => {
            const harness = sweeper([rule('r1'), rule('r2')]);
            const failing = harness.hold('r1');
            const warn = jest
                .spyOn(Logger.prototype, 'warn')
                .mockImplementation(() => undefined);

            const pass = harness.service.sweep();
            await settle();
            failing.fail(new Error('collection is on fire'));
            await pass;

            // The rules are unrelated; one bad filter must not stop the other
            // nineteen from being refreshed for the rest of the day.
            expect(harness.started).toEqual(['r1', 'r2']);
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('collection is on fire')
            );
            warn.mockRestore();
        });

        it('reaches content through the evaluator alone, never a scan of its own [alarms:I-03]', async () => {
            // The sweep is one of the three evaluation paths, and it is the one
            // with the least reason to be a path at all — it holds no filter,
            // no query and no store, only `allActive()` and `rescan`. Giving it
            // a matcher or a finding store of its own is what "a second
            // evaluation path" would look like here, and it would not compile
            // against this constructor.
            const harness = sweeper([rule('r1'), rule('r2')]);

            await harness.service.sweep();

            expect(
                harness.evaluator.rescan.mock.calls.map(([r]) => r.id)
            ).toEqual(['r1', 'r2']);
        });
    });

    describe('the interval', () => {
        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        it('arms no timer at all when sweeping is switched off [alarms:I-21]', () => {
            const harness = sweeper([rule('r1')], { sweepIntervalMinutes: 0 });

            harness.service.onApplicationBootstrap();

            // Asserted before the clock is advanced on purpose. `0` is a real
            // choice rather than a rejected one, and dropping the guard makes
            // it `setInterval(fn, 0)` — a timer that fires on every tick, so
            // advancing a day first would spin rather than fail.
            expect(jest.getTimerCount()).toBe(0);

            jest.advanceTimersByTime(24 * 60 * 60 * 1000);
            expect(harness.repository.allActive).not.toHaveBeenCalled();
        });

        it('waits a whole interval before its first pass', () => {
            const harness = sweeper([rule('r1')], { sweepIntervalMinutes: 60 });

            harness.service.onApplicationBootstrap();
            jest.advanceTimersByTime(59 * 60 * 1000);
            expect(harness.repository.allActive).not.toHaveBeenCalled();

            jest.advanceTimersByTime(60 * 1000);
            expect(harness.repository.allActive).toHaveBeenCalledTimes(1);
        });

        it('stops firing once the module is destroyed', async () => {
            const harness = sweeper([rule('r1')], { sweepIntervalMinutes: 60 });

            harness.service.onApplicationBootstrap();
            await harness.service.onModuleDestroy();
            jest.advanceTimersByTime(10 * 60 * 60 * 1000);

            expect(jest.getTimerCount()).toBe(0);
            expect(harness.repository.allActive).not.toHaveBeenCalled();
        });
    });

    describe('shutdown', () => {
        it('waits for a sweep already in flight [alarms:I-23]', async () => {
            const harness = sweeper([rule('r1')]);
            const held = harness.hold('r1');

            const pass = harness.service.sweep();
            await settle();
            expect(harness.started).toEqual(['r1']);

            let shutDown = false;
            const destroyed = harness.service
                .onModuleDestroy()
                .then(() => (shutDown = true));
            await settle();

            // A scan interrupted mid-rule has reconciled some of its batches
            // and not others, so its findings describe neither the old state
            // nor the new one. Dropping the `await this.running` makes this
            // true here instead.
            expect(shutDown).toBe(false);
            expect(harness.finished).toEqual([]);

            held.open();
            await destroyed;
            await pass;

            expect(shutDown).toBe(true);
            expect(harness.finished).toEqual(['r1']);
        });

        it('returns immediately when no sweep is running', async () => {
            const harness = sweeper([rule('r1')]);

            await expect(
                harness.service.onModuleDestroy()
            ).resolves.toBeUndefined();
            expect(harness.started).toEqual([]);
        });

        it('abandons the rules it has not reached yet', async () => {
            const harness = sweeper([rule('r1'), rule('r2'), rule('r3')]);
            const held = harness.hold('r1');

            const pass = harness.service.sweep();
            await settle();
            const destroyed = harness.service.onModuleDestroy();
            held.open();
            await destroyed;
            await pass;

            // Waiting for the *rule* in flight is not the same as finishing the
            // pass: shutdown must not be held open by however many rules the
            // workspace happens to have left.
            expect(harness.started).toEqual(['r1']);
        });
    });
});
