import {
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
    creationLimitTrippedBy,
    throttleStateDir,
    tripCreationLimit,
    withPublishSlot
} from './throttle';

let dir: string;
const lock = () => join(dir, 'lock');

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ortha-throttle-'));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

/** Pretend the lock was last refreshed `ms` milliseconds ago. */
function ageLock(ms: number): void {
    const when = new Date(Date.now() - ms);
    utimesSync(lock(), when, when);
}

describe('throttleStateDir', () => {
    it('lives under dist/, so wiping dist clears the lock and the breaker', () => {
        expect(throttleStateDir('/repo')).toBe('/repo/dist/.release-publish');
    });
});

describe('withPublishSlot', () => {
    it('runs the publish and returns its value', async () => {
        await expect(
            withPublishSlot({ dir, spacing: 0 }, async () => 'ok')
        ).resolves.toBe('ok');
    });

    it('holds the lock for the duration and drops it after [nx:I-20]', async () => {
        let heldDuring = false;

        await withPublishSlot({ dir, spacing: 0 }, async () => {
            heldDuring = existsSync(lock());
        });

        expect(heldDuring).toBe(true);
        expect(existsSync(lock())).toBe(false);
    });

    it('drops the lock even when the publish throws', async () => {
        await expect(
            withPublishSlot({ dir, spacing: 0 }, async () => {
                throw new Error('nope');
            })
        ).rejects.toThrow('nope');

        expect(existsSync(lock())).toBe(false);
    });

    it('records the finish time, so the next publish can space itself', async () => {
        const before = Date.now();
        await withPublishSlot({ dir, spacing: 0 }, async () => undefined);

        expect(
            Number.parseInt(readFileSync(join(dir, 'last-publish'), 'utf8'), 10)
        ).toBeGreaterThanOrEqual(before);
    });

    /**
     * The gap runs from the previous publish's recorded finish, so the
     * assertion is anchored to that stamp as well. Anchoring it to a
     * `Date.now()` taken *after* the stamp was written measured the wrong
     * interval: the implementation subtracts the age of the stamp from the
     * gap, so every millisecond spent writing the stamp came off the observed
     * wait while the publish still ran a full gap after the stamp. On a loaded
     * machine that write took tens of milliseconds and the test failed while
     * the rule held (a 120ms gap seen as 79ms of waiting). Anchored here,
     * `sleep` never returning early makes the bound exact — no tolerance, and
     * load can only overshoot it.
     */
    it('waits out the gap since the previous publish', async () => {
        const previousPublish = Date.now();
        writeFileSync(join(dir, 'last-publish'), `${previousPublish}`);
        let publishedAt = 0;

        await withPublishSlot({ dir, spacing: 120 }, async () => {
            publishedAt = Date.now();
        });

        expect(publishedAt - previousPublish).toBeGreaterThanOrEqual(120);
    });

    /**
     * ...and only the gap *since* that publish. A stamp already older than the
     * gap is a gap that has been served, so there is nothing left to wait out.
     * Read from `onWait` rather than from the clock, so this says what it means
     * on a machine of any speed.
     */
    it('does not wait when the previous publish is already older than the gap', async () => {
        writeFileSync(join(dir, 'last-publish'), `${Date.now() - 5_000}`);
        const waits: string[] = [];

        await withPublishSlot(
            { dir, spacing: 120, onWait: (r) => waits.push(r) },
            async () => undefined
        );

        expect(waits).toEqual([]);
    });

    /**
     * `spacing` is a function so it is asked *inside* the slot: a package that
     * has since learned a peer is blocked should bow out rather than sit out
     * the gap first.
     */
    it('evaluates a spacing function only once the slot is held [nx:I-21]', async () => {
        const spacing = jest.fn(() => {
            expect(existsSync(lock())).toBe(true);
            return 0;
        });

        await withPublishSlot({ dir, spacing }, async () => undefined);

        expect(spacing).toHaveBeenCalledTimes(1);
    });

    it('waits rather than stealing while a live holder has the lock [nx:I-20]', async () => {
        writeFileSync(lock(), `${process.pid}`);
        const waits: string[] = [];

        const run = withPublishSlot(
            { dir, spacing: 0, onWait: (r) => waits.push(r) },
            async () => 'done'
        );

        await sleep(400);
        expect(waits).toContain(
            'waiting for another package to finish publishing'
        );
        rmSync(lock(), { force: true });

        await expect(run).resolves.toBe('done');
    });

    it('steals immediately from a holder that no longer exists [nx:I-23]', async () => {
        // A pid nothing can be running under; `process.kill(pid, 0)` gives ESRCH.
        writeFileSync(lock(), '2147483646');

        await expect(
            withPublishSlot({ dir, spacing: 0, staleAfter: 60_000 }, async () =>
                readFileSync(lock(), 'utf8')
            )
        ).resolves.toBe(`${process.pid}`);
    });

    it('treats an empty or malformed lock as held, so a genuine race still waits [nx:I-23]', async () => {
        writeFileSync(lock(), '');
        let acquired = false;

        void withPublishSlot(
            { dir, spacing: 0, staleAfter: 60_000 },
            async () => {
                acquired = true;
            }
        );

        await sleep(300);
        expect(acquired).toBe(false);
        rmSync(lock(), { force: true });
        await sleep(300);
    });

    it('steals a lock whose live holder has gone quiet for longer than staleAfter', async () => {
        writeFileSync(lock(), `${process.pid}`);
        ageLock(5_000);

        await expect(
            withPublishSlot(
                { dir, spacing: 0, staleAfter: 1_000 },
                async () => 'stolen'
            )
        ).resolves.toBe('stolen');
    });

    /**
     * Regression for the window this file exists to close: `staleAfter`
     * defaulted to 15 minutes while the executor's own retry ladder sleeps
     * 12.5 of them before its sixth upload attempt (and much longer with
     * `ORTHA_PUBLISH_RETRIES` raised). A slow-but-alive publisher would have
     * its slot stolen mid-upload and two publishes would run at once. The
     * holder now refreshes the lock while it works, so `staleAfter` bounds
     * silence rather than work.
     */
    it('is not stolen from a holder that outlives staleAfter but keeps beating [nx:I-22]', async () => {
        const order: string[] = [];

        const holder = withPublishSlot(
            { dir, spacing: 0, staleAfter: 300, heartbeat: 50 },
            async () => {
                order.push('holder:start');
                // Four times `staleAfter` — a stamp-once lock would be long gone.
                await sleep(1_200);
                order.push('holder:end');
            }
        );

        await sleep(100);
        // A peer arriving mid-publish must find the lock fresh, not stale.
        const peer = withPublishSlot(
            { dir, spacing: 0, staleAfter: 300, heartbeat: 50 },
            async () => {
                order.push('peer:start');
            }
        );

        await Promise.all([holder, peer]);

        expect(order).toEqual(['holder:start', 'holder:end', 'peer:start']);
    });

    it('keeps refreshing the lock while it is held [nx:I-22]', async () => {
        let first = 0;
        let last = 0;

        await withPublishSlot(
            { dir, spacing: 0, staleAfter: 60_000, heartbeat: 40 },
            async () => {
                first = statSync(lock()).mtimeMs;
                ageLock(10_000);
                await sleep(200);
                last = statSync(lock()).mtimeMs;
            }
        );

        expect(last).toBeGreaterThan(first - 10_000);
        expect(last).toBeGreaterThanOrEqual(first);
    });

    /**
     * If a peer did steal the slot, the original holder finishing must not
     * remove the thief's lock — that would hand a third publisher the slot
     * while the thief is still uploading, turning one overlap into a cascade.
     */
    it('does not remove a lock that is no longer ours [nx:I-21]', async () => {
        await withPublishSlot({ dir, spacing: 0 }, async () => {
            writeFileSync(lock(), '999999');
        });

        expect(existsSync(lock())).toBe(true);
        expect(readFileSync(lock(), 'utf8')).toBe('999999');
    });
});

describe('the new-name circuit breaker', () => {
    it('reads back the package that first hit the limit', () => {
        tripCreationLimit(dir, '@orthacms/media-server');

        expect(creationLimitTrippedBy(dir)).toBe('@orthacms/media-server');
    });

    it('is closed until something trips it', () => {
        expect(creationLimitTrippedBy(dir)).toBeNull();
    });

    it('creates its directory rather than failing a publish over bookkeeping', () => {
        const fresh = join(dir, 'not', 'there', 'yet');
        tripCreationLimit(fresh, '@orthacms/x');

        expect(creationLimitTrippedBy(fresh)).toBe('@orthacms/x');
    });
});
