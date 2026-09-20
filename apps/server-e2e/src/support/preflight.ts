import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { platform } from 'node:os';
import { getHeapStatistics } from 'node:v8';

/**
 * Checks `global-setup` makes **before** it starts a container or touches a
 * database. Each one turns a failure that would otherwise present as a wall of
 * unrelated test failures into a single sentence naming the cause.
 *
 * Kept out of `global-setup.ts` so they can be exercised directly by
 * `src/harness/harness-guards.spec.ts` — a guard nothing tests is a guard that
 * quietly stops working.
 */

/**
 * Refuse to run with more than one Jest worker.
 *
 * `jest.config.cts` pins `maxWorkers: 1` and that setting is **load-bearing**:
 * every suite shares one Postgres testcontainer and `resetDb()` TRUNCATEs it
 * between tests. A CLI `--maxWorkers` / `-w` flag overrides the config, and the
 * result is not an error — it is suites truncating and seeding each other's
 * rows, surfacing as unique-constraint violations and off-by-N counts inside
 * tests that have nothing to do with the cause. That reads exactly like a
 * product regression, which is the worst possible failure mode for the only
 * gate this repo has.
 *
 * So: fail fast, and say why. Set `E2E_ALLOW_PARALLEL=true` only if you have
 * actually implemented the database-per-worker scheme.
 */
export function assertSerialExecution(maxWorkers: number | undefined): void {
    if (maxWorkers === undefined) return;
    if (maxWorkers <= 1) return;
    if (process.env['E2E_ALLOW_PARALLEL'] === 'true') return;

    throw new Error(
        `[e2e] Refusing to run with maxWorkers=${maxWorkers}.\n\n` +
            'apps/server-e2e shares ONE Postgres testcontainer across every suite, and\n' +
            '`resetDb()` TRUNCATEs it between tests. With more than one worker the suites\n' +
            "truncate and seed each other's rows, and the run fails with unique-constraint\n" +
            'violations and count mismatches inside tests that have nothing to do with the\n' +
            'cause — indistinguishable, at a glance, from a real regression.\n\n' +
            '`jest.config.cts` pins `maxWorkers: 1` for exactly this reason; a CLI\n' +
            '`--maxWorkers` / `-w` flag silently overrides it, which is why this check exists.\n\n' +
            'Parallelism needs a database-per-worker scheme first (apps/server-e2e/AGENTS.md).\n' +
            'Override with E2E_ALLOW_PARALLEL=true only once that exists.'
    );
}

/**
 * Headroom a full run wants, in bytes.
 *
 * The worker's RSS climbs across the run (70+ files, each booting its own Nest
 * app), and Postgres, Docker and the container want their share beside it. Below
 * roughly this, the back half of the run starves — 30-second hook timeouts
 * first, then pool failures, then the container going away.
 */
const RECOMMENDED_FREE_BYTES = 2.5 * 1024 * 1024 * 1024;

/**
 * Bytes of memory available on Linux, or `undefined` off Linux.
 *
 * `os.freemem()` is the wrong number here: it reports `MemFree`, which excludes
 * reclaimable page cache, so a perfectly healthy box reads as nearly out of
 * memory (measured: 204 MB "free" against 1.5 GB available). `MemAvailable` is
 * the kernel's own estimate of what a new allocation could actually get, which
 * is the question being asked.
 */
function linuxAvailableBytes(): number | undefined {
    try {
        const meminfo = readFileSync('/proc/meminfo', 'utf8');
        const match = /^MemAvailable:\s+(\d+) kB$/m.exec(meminfo);
        if (match) return Number(match[1]) * 1024;
    } catch {
        // /proc is not mounted, or this is not Linux.
    }
    return undefined;
}

/**
 * Bytes of memory available on macOS, or `undefined` if `vm_stat` cannot be
 * read.
 *
 * `os.freemem()` on Darwin returns `vm_statistics.free_count` alone — pages the
 * kernel is holding for nobody. macOS deliberately keeps that number near zero
 * and parks everything else in the **inactive** and **speculative** queues,
 * which are reclaimable on demand. So a 32 GiB machine with 11 GiB genuinely
 * available reports 0.2 GiB, and the low-memory advisory fires on every single
 * run — which is worse than no advisory, because it teaches the reader to skip
 * the line on the one run where it is true.
 *
 * `free + inactive + speculative` is the honest figure: it is what Activity
 * Monitor and `vm_stat`-based tooling treat as reclaimable. Wired and active
 * pages are excluded because they are not. Purgeable pages sit *inside* the
 * active/inactive counts and are deliberately not added again.
 *
 * The page size comes from `vm_stat`'s own header so the two always agree;
 * `sysctl hw.pagesize` is the fallback, and a machine that yields neither gets
 * `undefined` rather than a guess (Apple silicon pages at 16 KiB, Intel at 4 —
 * assuming either one is a 4× error in the direction of a false alarm).
 */
function darwinAvailableBytes(): number | undefined {
    try {
        return parseVmStat(execFileSync('vm_stat', { encoding: 'utf8' }), () =>
            Number(
                execFileSync('sysctl', ['-n', 'hw.pagesize'], {
                    encoding: 'utf8'
                }).trim()
            )
        );
    } catch {
        return undefined;
    }
}

/**
 * The reclaimable-memory total in `vm_stat` output, or `undefined` if the
 * output does not carry every field the sum needs.
 *
 * Split out from {@link darwinAvailableBytes} so the parsing can be tested
 * against captured output rather than against whatever this machine happens to
 * have free — the number is only trustworthy if the parse is.
 *
 * `pageSizeFallback` is consulted only when the header is missing; it may
 * throw, and a throw is an answer (`undefined`).
 */
export function parseVmStat(
    output: string,
    pageSizeFallback: () => number
): number | undefined {
    const header = /page size of (\d+) bytes/.exec(output);
    const pageSize = header ? Number(header[1]) : pageSizeFallback();
    if (!Number.isFinite(pageSize) || pageSize <= 0) return undefined;

    // Every queue must be present. A partial sum would silently under-report,
    // which is the failure this whole function exists to remove.
    let pages = 0;
    for (const queue of ['free', 'inactive', 'speculative']) {
        const match = new RegExp(`^Pages ${queue}:\\s+(\\d+)\\.`, 'm').exec(
            output
        );
        if (!match) return undefined;
        pages += Number(match[1]);
    }

    return pages * pageSize;
}

/**
 * Memory a process could actually get, in bytes — or `undefined` where this
 * platform cannot be asked honestly.
 *
 * `undefined` is a real answer, not a failure: {@link warnOnLowMemory} says
 * nothing when it gets one. A warning that is always wrong on the platform the
 * suite is actually run on costs more than no warning at all, because it trains
 * the reader to skip the line on the run where it is right. Silence beats a
 * guess.
 */
export function availableMemoryBytes(): number | undefined {
    switch (platform()) {
        case 'linux':
            return linuxAvailableBytes();
        case 'darwin':
            return darwinAvailableBytes();
        default:
            return undefined;
    }
}

/**
 * Warn — do not refuse — when the machine is short of memory.
 *
 * A warning rather than a hard failure because the threshold is a heuristic and
 * a targeted single-suite run needs far less. What matters is that the *first*
 * line of a starved run says memory, so the ~650 failures that follow are read
 * as one cause rather than 650 regressions. Returns the message it printed, or
 * `undefined`, so a test can assert the boundary.
 *
 * `undefined` in means `undefined` out: on a platform we cannot measure
 * honestly the run gets no line at all. That is the deliberate trade — this
 * advisory is only worth anything while it is believed.
 */
export function warnOnLowMemory(
    availableBytes: number | undefined
): string | undefined {
    if (availableBytes === undefined) return undefined;
    if (availableBytes >= RECOMMENDED_FREE_BYTES) return undefined;
    const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
    const message =
        `[e2e] WARNING: only ${gib(availableBytes)} of memory is available; a full run wants about ${gib(RECOMMENDED_FREE_BYTES)}.\n` +
        '[e2e] A starved run fails in ways that look like product regressions — hook\n' +
        '[e2e] timeouts, then pg-pool connection failures, then the testcontainer being\n' +
        '[e2e] killed. If this run goes red in its back half, suspect memory first.';
    console.warn(message);
    return message;
}

/**
 * Old-space ceiling a full run needs, in bytes.
 *
 * The heap climbs monotonically across the run and was measured at 2.0 GB by
 * minute 25 on the 70-file suite; the suite is larger now. Three gigabytes is
 * the first round number with room above that, and well under the 4 GB
 * `.env.e2e` asks for — this is the line at which a run is *suspect*, not the
 * line at which it is comfortable.
 */
const RECOMMENDED_HEAP_BYTES = 3 * 1024 * 1024 * 1024;

/** This process's V8 old-space ceiling, in bytes. */
export function heapCeilingBytes(): number {
    return getHeapStatistics().heap_size_limit;
}

/**
 * Warn — do not refuse — when the run has no room to grow.
 *
 * `maxWorkers: 1` makes Jest run the specs **in band**, so this process is the
 * one that executes all ~94 files, and its heap only goes up: each file boots
 * its own Nest app in its own module registry. Node's default ceiling is sized
 * from total RAM (2.2 GB on an 8 GB machine), which a full run exhausts around
 * minute 20 — and a heap-limit abort names no cause, blames whichever suite was
 * running, and costs twenty minutes to reach a second time.
 *
 * `apps/server-e2e/.env.e2e` raises the ceiling and Nx loads it for the `e2e`
 * target, so the documented command already carries it. This catches the runs
 * that route around that — a direct `jest` invocation, `NX_LOAD_DOT_ENV_FILES=false`,
 * a `NODE_OPTIONS` set to something else — and says so in the first seconds
 * rather than the twenty-first minute.
 *
 * Advisory, like {@link warnOnLowMemory}: a single targeted suite runs fine on
 * the default ceiling, and refusing those would be a worse trade than the
 * occasional wasted full run. Returns the message it printed, or `undefined`.
 */
export function warnOnLowHeapCeiling(ceilingBytes: number): string | undefined {
    if (ceilingBytes >= RECOMMENDED_HEAP_BYTES) return undefined;
    const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
    const message =
        `[e2e] WARNING: this process can only grow its heap to ${gib(ceilingBytes)}; a full run wants at least ${gib(RECOMMENDED_HEAP_BYTES)}.\n` +
        '[e2e] Every spec runs in this one process (maxWorkers: 1 means Jest runs in band)\n' +
        '[e2e] and its heap climbs across the run, so a full suite ends in "Ineffective\n' +
        '[e2e] mark-compacts near heap limit" — reported against whichever suite was running.\n' +
        '[e2e] `apps/server-e2e/.env.e2e` sets this and Nx loads it for `nx e2e server-e2e`;\n' +
        '[e2e] if you invoked jest another way, pass NODE_OPTIONS=--max-old-space-size=4096.';
    console.warn(message);
    return message;
}

/** The database name from a Postgres connection string, or `''`. */
function databaseName(connectionString: string): string {
    try {
        return new URL(connectionString).pathname.replace(/^\//, '');
    } catch {
        return '';
    }
}

/** Compare two connection strings ignoring trailing slashes / query order. */
function sameTarget(a: string, b: string): boolean {
    const normalise = (value: string) => value.trim().replace(/\/+$/, '');
    if (normalise(a) === normalise(b)) return true;
    try {
        const left = new URL(a);
        const right = new URL(b);
        return (
            left.host === right.host &&
            left.pathname.replace(/\/+$/, '') ===
                right.pathname.replace(/\/+$/, '')
        );
    } catch {
        return false;
    }
}

/** A name a human plausibly meant to be disposable. */
const DISPOSABLE_NAME = /(^|[_-])(e2e|test)([_-]|\d*$)/i;

/**
 * Refuse an `E2E_DATABASE_URL` that does not look disposable.
 *
 * The suite TRUNCATEs every mutable table in every `beforeEach`. Pointing it at
 * a working database destroys that database's contents, silently and in
 * seconds. Two cheap guards close the realistic accidents:
 *
 * 1. It must not name the same database as `DATABASE_URL` — the variable a
 *    developer's `.env` sets, which is the one thing they would lose.
 * 2. Its database name must read as disposable (`…e2e…` / `…test…`).
 *
 * `E2E_ALLOW_UNSAFE_DATABASE=true` waives (2) for a CI runner with an
 * oddly-named scratch database. Nothing waives (1).
 */
export function assertDisposableExternalDatabase(
    externalUrl: string,
    workingUrl: string | undefined
): void {
    if (workingUrl && sameTarget(externalUrl, workingUrl)) {
        throw new Error(
            '[e2e] Refusing to run: E2E_DATABASE_URL names the same database as DATABASE_URL.\n\n' +
                `  database: ${databaseName(externalUrl) || externalUrl}\n\n` +
                'This suite TRUNCATEs every mutable table before every test. DATABASE_URL is\n' +
                'the working database your `.env` points at — running here would empty it.\n\n' +
                'Point E2E_DATABASE_URL at a throwaway database, or unset it to use the\n' +
                'Postgres testcontainer (the default).'
        );
    }

    const name = databaseName(externalUrl);
    if (
        !DISPOSABLE_NAME.test(name) &&
        process.env['E2E_ALLOW_UNSAFE_DATABASE'] !== 'true'
    ) {
        throw new Error(
            `[e2e] Refusing to run: E2E_DATABASE_URL names "${name || externalUrl}", which does not look disposable.\n\n` +
                'This suite TRUNCATEs every mutable table before every test, so the database it\n' +
                'names must be one you are happy to lose. Name it with `e2e` or `test` in it\n' +
                '(e.g. `ortha_e2e`), or set E2E_ALLOW_UNSAFE_DATABASE=true if you are certain.'
        );
    }
}
