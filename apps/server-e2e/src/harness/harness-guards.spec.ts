import { Pool } from 'pg';
import {
    assertDisposableExternalDatabase,
    assertSerialExecution,
    availableMemoryBytes,
    heapCeilingBytes,
    parseVmStat,
    warnOnLowHeapCeiling,
    warnOnLowMemory
} from '../support/preflight';
import {
    E2eInfrastructureError,
    isDatabaseUnreachable,
    withDatabaseDiagnostics
} from '../support/infra-error';
import { isDuplicateEmail } from '../support/seed';
import { parseSse } from '../support/sse';

/**
 * The harness's own guards, tested.
 *
 * This suite is deliberately not about the product. It is about the two ways
 * this harness has been observed to lie: a run that corrupts its own shared
 * database because someone passed `--maxWorkers`, and a run whose database died
 * underneath it reporting ~650 connection failures as if they were assertion
 * failures. Both manufacture red that is indistinguishable from real red, which
 * is the condition under which real red stops being believed — so the guards
 * against them are load-bearing, and a guard nothing tests is a guard that
 * quietly stops working.
 *
 * It needs no app and no database: everything here is a pure function or a
 * deliberately-broken pool.
 */
describe('harness guards', () => {
    describe('serial execution (assertSerialExecution)', () => {
        it('permits the pinned single worker', () => {
            expect(() => assertSerialExecution(1)).not.toThrow();
        });

        it('permits an unknown worker count rather than guessing', () => {
            // Jest has always passed `globalConfig`, but a guard that hard-fails
            // on a shape it did not expect is worse than the problem.
            expect(() => assertSerialExecution(undefined)).not.toThrow();
        });

        it('refuses two workers, naming the flag and the reason', () => {
            // The whole point: `--maxWorkers=2` used to surface as
            // unique-constraint violations inside unrelated authorization tests.
            expect(() => assertSerialExecution(2)).toThrow(/maxWorkers=2/);
            expect(() => assertSerialExecution(2)).toThrow(/resetDb/);
            expect(() => assertSerialExecution(2)).toThrow(
                /database-per-worker/
            );
        });

        it('refuses any count above one', () => {
            expect(() => assertSerialExecution(4)).toThrow(/maxWorkers=4/);
        });

        it('yields to an explicit opt-in, for whoever implements the scheme', () => {
            process.env['E2E_ALLOW_PARALLEL'] = 'true';
            try {
                expect(() => assertSerialExecution(4)).not.toThrow();
            } finally {
                delete process.env['E2E_ALLOW_PARALLEL'];
            }
        });
    });

    describe('memory advisory (warnOnLowMemory)', () => {
        const GIB = 1024 ** 3;
        let warn: jest.SpyInstance;

        beforeEach(() => {
            warn = jest.spyOn(console, 'warn').mockImplementation(() => {
                /* keep the suite's output clean */
            });
        });
        afterEach(() => warn.mockRestore());

        it('says nothing when there is headroom', () => {
            expect(warnOnLowMemory(8 * GIB)).toBeUndefined();
            expect(warn).not.toHaveBeenCalled();
        });

        it('names memory as the suspect when there is not', () => {
            // The point is the *first* line of a starved run, so the hundreds of
            // failures after it are read as one cause rather than as hundreds of
            // regressions.
            const message = warnOnLowMemory(1.5 * GIB);
            expect(message).toContain('1.5 GiB');
            expect(message).toContain('suspect memory first');
            expect(warn).toHaveBeenCalled();
        });

        it('says nothing at all when the platform cannot be measured', () => {
            // The whole point of the darwin work below. An advisory that fires
            // on every run of every developer machine is worse than no
            // advisory: it teaches the reader to skip the line on the run where
            // it is true. Where we cannot get an honest number we print
            // nothing.
            expect(warnOnLowMemory(undefined)).toBeUndefined();
            expect(warn).not.toHaveBeenCalled();
        });

        it('reports a plausible amount for this machine', () => {
            // Guards both readings. On Linux `os.freemem()` reports MemFree,
            // which excludes reclaimable page cache; on macOS it reports
            // `free_count` alone, which the kernel deliberately keeps near zero
            // — a 32 GiB Mac read as 0.2 GiB and warned on every single run. A
            // number below 32 MiB means we are reading the wrong field, not
            // that the box is out of memory: it is running this test.
            const platforms = ['linux', 'darwin'];
            if (!platforms.includes(process.platform)) {
                // Anywhere else, silence is the correct answer and asserting a
                // number would be asserting the bug back in.
                expect(availableMemoryBytes()).toBeUndefined();
                return;
            }
            expect(availableMemoryBytes()).toBeGreaterThan(32 * 1024 * 1024);
        });
    });

    describe('macOS reclaimable memory (parseVmStat)', () => {
        const GIB = 1024 ** 3;

        // Captured from `vm_stat` on a 32 GiB Apple-silicon machine — the exact
        // case that used to print "only 0.2 GiB of memory is available".
        const VM_STAT = [
            'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
            'Pages free:                                    19076.',
            'Pages active:                                 704462.',
            'Pages inactive:                               701695.',
            'Pages speculative:                              1465.',
            'Pages throttled:                                   0.',
            'Pages wired down:                             181273.',
            'Pages purgeable:                               13072.',
            '"Translation faults":                     2688361400.'
        ].join('\n');

        const never = () => {
            throw new Error('page-size fallback should not be reached');
        };

        it('sums free, inactive and speculative at the header page size', () => {
            // 19076 + 701695 + 1465 = 722236 pages × 16 KiB.
            expect(parseVmStat(VM_STAT, never)).toBe(722236 * 16384);
        });

        it('reads far above what `os.freemem()` would have said', () => {
            // freemem() on this machine returns the 19076 free pages alone —
            // 0.3 GiB, under the 2.5 GiB threshold, hence the warning on every
            // run. The honest figure clears it comfortably.
            const bytes = parseVmStat(VM_STAT, never) as number;
            expect(bytes).toBeGreaterThan(10 * GIB);
            expect(warnOnLowMemory(bytes)).toBeUndefined();
        });

        it('excludes active and wired pages, which are not reclaimable', () => {
            // Counting them would turn the false alarm into a false all-clear,
            // which is the same defect pointing the other way.
            const bytes = parseVmStat(VM_STAT, never) as number;
            expect(bytes).toBeLessThan(34359738368);
            expect(bytes / 16384).toBe(722236);
        });

        it('falls back to the supplied page size when the header is missing', () => {
            const headerless = VM_STAT.split('\n').slice(1).join('\n');
            expect(parseVmStat(headerless, () => 4096)).toBe(722236 * 4096);
        });

        it('returns nothing rather than a partial sum', () => {
            // A missing queue would under-report, which is precisely the
            // failure mode being removed. Silence, not a smaller number.
            const missingInactive = VM_STAT.split('\n')
                .filter((line) => !line.startsWith('Pages inactive:'))
                .join('\n');
            expect(parseVmStat(missingInactive, never)).toBeUndefined();
        });

        it('returns nothing when no page size can be established', () => {
            // Guessing 4 KiB where the machine pages at 16 would under-report
            // fourfold — in the direction of the false alarm.
            const headerless = VM_STAT.split('\n').slice(1).join('\n');
            expect(parseVmStat(headerless, () => Number.NaN)).toBeUndefined();
            expect(parseVmStat(headerless, () => 0)).toBeUndefined();
        });
    });

    describe('heap headroom (warnOnLowHeapCeiling)', () => {
        const GIB = 1024 ** 3;
        let warn: jest.SpyInstance;

        beforeEach(() => {
            warn = jest.spyOn(console, 'warn').mockImplementation(() => {
                /* keep the suite's output clean */
            });
        });
        afterEach(() => warn.mockRestore());

        it('says nothing when the run has room to grow', () => {
            expect(warnOnLowHeapCeiling(4 * GIB)).toBeUndefined();
            expect(warn).not.toHaveBeenCalled();
        });

        it('names the ceiling and the fix when it does not', () => {
            // Node's default on an 8 GB machine, which is exactly the case that
            // used to end in a heap-limit abort twenty minutes in.
            const message = warnOnLowHeapCeiling(2.2 * GIB);
            expect(message).toContain('2.2 GiB');
            expect(message).toContain('max-old-space-size');
            expect(warn).toHaveBeenCalled();
        });

        it('actually has the headroom `.env.e2e` asks for', () => {
            // The guard the other two only describe. Nx loads
            // `apps/server-e2e/.env.e2e` for the `e2e` target, and that is the
            // entire mechanism — if it stops happening (the file renamed, the
            // target renamed, `NX_LOAD_DOT_ENV_FILES=false`), nothing else goes
            // red until the run dies in its back half, twenty minutes in,
            // against an unrelated suite.
            //
            // Asserted unconditionally and NOT gated on `NODE_OPTIONS` looking
            // right: a missing variable is the failure, so a check that reads
            // the variable to decide whether to check would pass in exactly the
            // case it exists to catch.
            expect(heapCeilingBytes()).toBeGreaterThan(3 * GIB);
        });
    });

    describe('abandoned-hook cascade (isDuplicateEmail)', () => {
        // A hook that overruns `testTimeout` is reported and abandoned — but
        // not cancelled, so its insert can land after the NEXT test's resetDb.
        // That test then fails on a unique violation having done nothing wrong.
        // `seedUser` re-labels it to name the real culprit, and this is the
        // detection that decides when it may.
        const pgError = (constraint: string) =>
            Object.assign(new Error('duplicate key value'), { constraint });

        it('recognises the collision on the driver error', () => {
            expect(isDuplicateEmail(pgError('users_email_lower_unique'))).toBe(
                true
            );
        });

        it('recognises it through the wrapper Drizzle throws', () => {
            const wrapped = new Error('Failed query', {
                cause: pgError('users_email_lower_unique')
            });
            expect(isDuplicateEmail(wrapped)).toBe(true);
        });

        it('recognises it from the message alone', () => {
            // Which of the three fields is populated is a detail of a
            // dependency; the re-label must not depend on that detail.
            expect(
                isDuplicateEmail(
                    new Error(
                        'duplicate key value violates unique constraint "users_email_lower_unique"'
                    )
                )
            ).toBe(true);
        });

        it('does NOT claim another constraint is the cascade', () => {
            // The whole risk of a re-label: swallowing a real failure. A
            // duplicate slug or role key is a test's own doing.
            expect(isDuplicateEmail(pgError('roles_key_unique'))).toBe(false);
            expect(isDuplicateEmail(new Error('some other failure'))).toBe(
                false
            );
        });
    });

    describe('external database safety (assertDisposableExternalDatabase)', () => {
        const DISPOSABLE = 'postgres://u:p@127.0.0.1:5432/ortha_e2e';
        const WORKING = 'postgres://u:p@127.0.0.1:5432/ortha_cms';

        it('accepts a database whose name reads as disposable', () => {
            expect(() =>
                assertDisposableExternalDatabase(DISPOSABLE, WORKING)
            ).not.toThrow();
            expect(() =>
                assertDisposableExternalDatabase(
                    'postgres://u@h/test_ortha',
                    WORKING
                )
            ).not.toThrow();
        });

        it('refuses the exact database DATABASE_URL names', () => {
            // The realistic accident, and the expensive one: this suite
            // TRUNCATEs every mutable table before every test.
            expect(() =>
                assertDisposableExternalDatabase(WORKING, WORKING)
            ).toThrow(/same database as DATABASE_URL/);
        });

        it('refuses it even when the two URLs are spelled differently', () => {
            expect(() =>
                assertDisposableExternalDatabase(
                    'postgres://u:p@127.0.0.1:5432/ortha_cms/',
                    'postgres://other:pw@127.0.0.1:5432/ortha_cms?sslmode=disable'
                )
            ).toThrow(/same database as DATABASE_URL/);
        });

        it('refuses a name that does not read as disposable', () => {
            expect(() =>
                assertDisposableExternalDatabase(
                    'postgres://u@h/production',
                    undefined
                )
            ).toThrow(/does not look disposable/);
        });

        it('yields to an explicit opt-in for an oddly-named scratch database', () => {
            process.env['E2E_ALLOW_UNSAFE_DATABASE'] = 'true';
            try {
                expect(() =>
                    assertDisposableExternalDatabase(
                        'postgres://u@h/scratch17',
                        undefined
                    )
                ).not.toThrow();
            } finally {
                delete process.env['E2E_ALLOW_UNSAFE_DATABASE'];
            }
        });

        it('never yields the DATABASE_URL check to that opt-in', () => {
            process.env['E2E_ALLOW_UNSAFE_DATABASE'] = 'true';
            try {
                expect(() =>
                    assertDisposableExternalDatabase(WORKING, WORKING)
                ).toThrow(/same database as DATABASE_URL/);
            } finally {
                delete process.env['E2E_ALLOW_UNSAFE_DATABASE'];
            }
        });
    });

    describe('infrastructure diagnostics (isDatabaseUnreachable)', () => {
        it('recognises the pg-pool AggregateError seen in the wild', () => {
            // What a starved run actually produced: no code, no message, only
            // an `errors` array — reported under whichever seeder noticed.
            const error = new AggregateError([], '');
            expect(isDatabaseUnreachable(error)).toBe(true);
        });

        it('recognises a socket errno, however deeply wrapped', () => {
            const reset = Object.assign(new Error('read ECONNRESET'), {
                code: 'ECONNRESET'
            });
            const wrapped = new Error('seeding failed', { cause: reset });
            expect(isDatabaseUnreachable(wrapped)).toBe(true);
        });

        it('recognises `write EINVAL` from a socket that went away mid-write', () => {
            expect(
                isDatabaseUnreachable(
                    Object.assign(new Error('write EINVAL'), { code: 'EINVAL' })
                )
            ).toBe(true);
        });

        it('recognises a Postgres admin-shutdown SQLSTATE', () => {
            expect(
                isDatabaseUnreachable(
                    Object.assign(
                        new Error(
                            'terminating connection due to administrator command'
                        ),
                        { code: '57P01' }
                    )
                )
            ).toBe(true);
        });

        it('does NOT claim an assertion failure is infrastructure', () => {
            // The property that matters most. If this ever returns true, the
            // helper starts hiding the bugs it exists to expose.
            expect(
                isDatabaseUnreachable(new Error('expected 200, got 403'))
            ).toBe(false);
        });

        it('does NOT claim a constraint violation is infrastructure', () => {
            expect(
                isDatabaseUnreachable(
                    Object.assign(
                        new Error(
                            'duplicate key value violates unique constraint "workspaces_slug_unique"'
                        ),
                        { code: '23505' }
                    )
                )
            ).toBe(false);
        });
    });

    describe('infrastructure diagnostics (withDatabaseDiagnostics)', () => {
        it('re-labels a real pool failure as infrastructure, not a test failure', async () => {
            // A genuine `pg` connection failure, not a synthetic error: port 1
            // has nothing on it.
            const pool = new Pool({
                connectionString: 'postgres://nobody@127.0.0.1:1/nothing',
                connectionTimeoutMillis: 2000
            });
            try {
                const failure = await withDatabaseDiagnostics(
                    'connecting to the test database',
                    () => pool.query('SELECT 1')
                ).catch((error: unknown) => error);

                expect(failure).toBeInstanceOf(E2eInfrastructureError);
                expect((failure as Error).message).toContain(
                    'THE TEST DATABASE IS UNREACHABLE'
                );
                expect((failure as Error).message).toContain(
                    'infrastructure failure, not a test failure'
                );
                // The original is kept, so nothing is lost by re-labelling.
                expect((failure as Error).cause).toBeDefined();
            } finally {
                await pool.end();
            }
        });

        it('passes an assertion failure through untouched', async () => {
            const original = new Error('expected 201, got 400');
            const failure = await withDatabaseDiagnostics('doing a thing', () =>
                Promise.reject(original)
            ).catch((error: unknown) => error);

            expect(failure).toBe(original);
            expect(failure).not.toBeInstanceOf(E2eInfrastructureError);
        });

        it('returns the value when nothing goes wrong', async () => {
            await expect(
                withDatabaseDiagnostics('doing a thing', async () => 'ok')
            ).resolves.toBe('ok');
        });
    });

    describe('SSE parsing (parseSse)', () => {
        // The server writes `data: ` today, so both forms work today. The point
        // is what happens if that ever changes: a parser that requires the space
        // would drop every frame silently while the shipped admin client — whose
        // own parser does not require it — kept working. That is a false red
        // manufactured by the harness, which is the whole class of failure this
        // package is being hardened against.
        it('reads a frame written the way the server writes it', () => {
            const body =
                ': open\n\nevent: text-delta\ndata: {"type":"text-delta","text":"hi"}\n\n';
            expect(parseSse(body)).toEqual([
                { type: 'text-delta', text: 'hi' }
            ]);
        });

        it('reads a frame written without the optional space', () => {
            const body =
                'event: text-delta\ndata:{"type":"text-delta","text":"hi"}\n\n';
            expect(parseSse(body)).toEqual([
                { type: 'text-delta', text: 'hi' }
            ]);
        });

        it('still skips comment frames', () => {
            expect(parseSse(': open\n\n: ping\n\n')).toEqual([]);
        });
    });
});
