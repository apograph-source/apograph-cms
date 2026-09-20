import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExecutorContext } from '@nx/devkit';

const execFileSync = jest.fn();

jest.mock('node:child_process', () => ({
    execFileSync: (...args: unknown[]) => execFileSync(...args)
}));

/**
 * The driver, replaced by constructors that refuse to be built.
 *
 * `@orthacms/cli`'s barrel pulls `pg` in for `applyPluginMigrations`, so the
 * module is loaded on this path whatever `db:generate` does — what must never
 * happen is a client being *constructed*. This is the trip wire for that, and
 * it is the reason this suite drives the real `runDrizzleKitGenerate` instead
 * of a mock of it: a mocked `@orthacms/cli` would prove only that the executor
 * itself opens nothing, which is the half of the path nobody suspected.
 */
jest.mock('pg', () => {
    class Refuses {
        constructor() {
            throw new Error('db:generate opened a database connection');
        }
    }
    return { Pool: Refuses, Client: Refuses };
});

import dbGenerateExecutor from './executor';

const context = { root: '/repo' } as ExecutorContext;

/** The env keys libpq would fall back on, plus the one we configure. */
const CREDENTIAL_KEYS = [
    'DATABASE_URL',
    'PGHOST',
    'PGPORT',
    'PGUSER',
    'PGPASSWORD',
    'PGDATABASE',
    'PGSERVICE',
    'PGPASSFILE'
];

beforeEach(() => jest.clearAllMocks());

describe('db-generate executor', () => {
    it('runs drizzle-kit from the plugin root, resolved against the workspace [nx:I-32]', async () => {
        await expect(
            dbGenerateExecutor(
                {
                    cwd: 'packages/media/server',
                    config: 'drizzle.config.ts',
                    name: 'add_focal_point'
                },
                context
            )
        ).resolves.toEqual({ success: true });

        const [command, args, options] = execFileSync.mock.calls[0];
        expect(command).toBe(process.execPath);
        expect(args[0]).toMatch(/drizzle-kit[/\\]bin\.cjs$/);
        expect(args.slice(1)).toEqual([
            'generate',
            '--config=drizzle.config.ts',
            '--name=add_focal_point'
        ]);
        // `cwd` is relative to the workspace root in the target's options —
        // drizzle-kit resolves the config's `schema`/`out` paths against the
        // working directory, so handing it the unresolved value would generate
        // into whatever directory Nx happened to be run from.
        expect(options.cwd).toBe(join('/repo', 'packages/media/server'));
    });

    describe('needs no database and no secret [nx:I-05]', () => {
        /** Runs the executor with every credential the environment could offer removed. */
        async function runWithoutCredentials() {
            const saved = Object.fromEntries(
                CREDENTIAL_KEYS.map((key) => [key, process.env[key]])
            );
            for (const key of CREDENTIAL_KEYS) {
                delete process.env[key];
            }
            try {
                return await dbGenerateExecutor(
                    {
                        cwd: 'packages/media/server',
                        config: 'drizzle.config.ts'
                    },
                    context
                );
            } finally {
                for (const [key, value] of Object.entries(saved)) {
                    if (value === undefined) {
                        delete process.env[key];
                    } else {
                        process.env[key] = value;
                    }
                }
            }
        }

        it('succeeds with no DATABASE_URL and no libpq fallback set [nx:I-05]', async () => {
            // The sibling targets refuse outright in this situation, and that
            // refusal is right for them — `db:migrate` and `db:studio` would
            // otherwise fall through to libpq's local defaults. Generation only
            // diffs the schema against the stored snapshot, so the same guard
            // here would make migrations ungeneratable on a machine with no
            // Postgres, which is most machines that ever edit a schema.
            await expect(runWithoutCredentials()).resolves.toEqual({
                success: true
            });
            expect(execFileSync).toHaveBeenCalledTimes(1);
        });

        it('opens no connection on the way [nx:I-05]', async () => {
            // The `pg` mock above throws from either constructor, so a client
            // built anywhere on this path — executor or `@orthacms/cli` —
            // surfaces as a rejection rather than as a passing test.
            await expect(runWithoutCredentials()).resolves.toEqual({
                success: true
            });
        });

        it('hands the child no environment of its own [nx:I-05]', async () => {
            // The child inherits this process's env, which is the point: there
            // is nothing to assemble, because there is nothing to connect to.
            // An `env` option appearing here means somebody started passing a
            // credential down, and the target acquired a secret it does not need.
            await runWithoutCredentials();

            expect(execFileSync.mock.calls[0][2]).toEqual({
                cwd: join('/repo', 'packages/media/server'),
                stdio: 'inherit'
            });
        });

        it('puts no connection string in the argv either [nx:I-05]', async () => {
            await runWithoutCredentials();

            const argv: string[] = execFileSync.mock.calls[0][1];
            expect(argv.some((arg) => /postgres(ql)?:\/\//.test(arg))).toBe(
                false
            );
            expect(
                argv.some((arg) => /--url|--driver|DATABASE_URL/.test(arg))
            ).toBe(false);
        });

        it('names no credential anywhere on the implementation path [nx:I-05] [nx:I-32]', () => {
            // The behavioural checks above run one shape of one call. This
            // reads the two files the target is actually made of — the thin
            // executor and the `@orthacms/cli` function it delegates to, which
            // is the *single* implementation shared with a generated app — and
            // fails on a credential or a driver appearing in either.
            const sources = [
                'packages/nx/src/executors/db-generate/executor.ts',
                'packages/cli/src/lib/generate.ts'
            ].map((path) => ({
                path,
                text: readFileSync(
                    join(__dirname, '../../../../..', path),
                    'utf8'
                )
            }));

            // The guard on the guard: an empty read would satisfy every
            // pattern below.
            for (const { path, text } of sources) {
                expect([path, text.length > 400]).toEqual([path, true]);
            }

            for (const { path, text } of sources) {
                expect([
                    path,
                    /DATABASE_URL|PGHOST|PGPASSWORD|connectionString/.test(text)
                ]).toEqual([path, false]);
                expect([
                    path,
                    /\bnew (Pool|Client)\b|from 'pg'|require\('pg'\)/.test(text)
                ]).toEqual([path, false]);
            }
        });
    });
});
