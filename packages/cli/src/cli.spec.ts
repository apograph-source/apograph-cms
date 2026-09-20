/**
 * `cli.ts` runs `main()` on import, so these drive it the only way it can be
 * driven: set `process.argv`, reset the module registry, import it again, and
 * let the promise settle. Everything below `main` is mocked — what is under
 * test is the order of the three things it does before dispatching, and what
 * happens to an exception that gets all the way back out.
 */
const calls: string[] = [];

const loadEnv = jest.fn((...args: unknown[]) => {
    calls.push(`loadEnv ${String(args[0])}`);
});
const findProjectRoot = jest.fn((...args: unknown[]) => {
    void args;
    calls.push('findProjectRoot');

    return ROOT;
});
const devCommand = jest.fn(async (...args: unknown[]) => {
    void args;
    calls.push('dev');
});
const buildCommand = jest.fn(async (...args: unknown[]) => {
    void args;
    calls.push('build');
});
const startCommand = jest.fn(async (...args: unknown[]) => {
    void args;
    calls.push('start');
});
const migrateCommand = jest.fn(async (...args: unknown[]) => {
    void args;
    calls.push('migrate');
});
const generateCommand = jest.fn((...args: unknown[]) => {
    void args;
    calls.push('generate');
});
const studioCommand = jest.fn(async (...args: unknown[]) => {
    void args;
    calls.push('studio');
});

jest.mock('./lib/env', () => ({
    loadEnv: (...args: unknown[]) => loadEnv(...args)
}));
jest.mock('./lib/project', () => ({
    findProjectRoot: (...args: unknown[]) => findProjectRoot(...args)
}));
jest.mock('./lib/commands/dev', () => ({
    devCommand: (...args: unknown[]) => devCommand(...args)
}));
jest.mock('./lib/commands/build', () => ({
    buildCommand: (...args: unknown[]) => buildCommand(...args)
}));
jest.mock('./lib/commands/start', () => ({
    startCommand: (...args: unknown[]) => startCommand(...args)
}));
jest.mock('./lib/commands/migrate', () => ({
    migrateCommand: (...args: unknown[]) => migrateCommand(...args)
}));
jest.mock('./lib/commands/generate', () => ({
    generateCommand: (...args: unknown[]) => generateCommand(...args)
}));
jest.mock('./lib/commands/studio', () => ({
    studioCommand: (...args: unknown[]) => studioCommand(...args)
}));

import { USAGE } from './lib/args';

const ROOT = '/apps/my-cms';

const originalArgv = process.argv;

/** Runs the binary as the shell would, and waits for `main` to settle. */
async function ortha(...argv: string[]): Promise<void> {
    process.argv = ['node', '/n_m/.bin/ortha', ...argv];
    jest.resetModules();
    // `require`, not `await import()`: this package is CommonJS, and under
    // `nodenext` a dynamic import would have to name `./cli.js` — a file that
    // does not exist in the source tree jest is resolving against.
    require('./cli');
    // `main()` is async, so its `.catch` lands a turn later.
    await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
    calls.length = 0;
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(process, 'exit').mockImplementation(
        () => undefined as unknown as never
    );
});

afterEach(() => {
    process.argv = originalArgv;
    // The unknown-command branch sets this, and jest reads it on the way out.
    process.exitCode = 0;
    jest.restoreAllMocks();
});

describe('the .env is read once, before anything is dispatched', () => {
    /**
     * `.env` is loaded here and nowhere else. Nx loads it before a target runs;
     * a generated app has no task runner, so if this did not happen before the
     * command, `ortha migrate` would fail on a `DATABASE_URL` sitting right
     * there in the file — and the `tsc`, `vite` and `node` processes the
     * commands spawn inherit the values only because they were put on
     * `process.env` first.
     */
    it('loads it after finding the root and before the command [cli:I-15]', async () => {
        await ortha('migrate');

        expect(calls).toEqual([
            'findProjectRoot',
            `loadEnv ${ROOT}`,
            'migrate'
        ]);
    });

    it('loads it exactly once, whichever command was asked for [cli:I-15]', async () => {
        await ortha('dev');

        expect(loadEnv).toHaveBeenCalledTimes(1);
        expect(loadEnv).toHaveBeenCalledWith(ROOT);
    });

    it('loads it for every command, not only the database ones [cli:I-15]', async () => {
        for (const command of ['dev', 'build', 'start', 'generate', 'studio']) {
            jest.clearAllMocks();
            await ortha(command);

            expect(loadEnv).toHaveBeenCalledWith(ROOT);
        }
    });

    /**
     * Both answered before `findProjectRoot`, so asking what the command is and
     * which version it is works from the shell you are in before the app
     * exists.
     */
    it('does not go looking for an app to answer --help or --version', async () => {
        await ortha('--help');
        expect(findProjectRoot).not.toHaveBeenCalled();
        expect(loadEnv).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith(USAGE);

        await ortha('--version');
        expect(findProjectRoot).not.toHaveBeenCalled();
        expect(loadEnv).not.toHaveBeenCalled();
    });
});

describe('dispatch', () => {
    it('hands each command the project root', async () => {
        await ortha('start');

        expect(startCommand).toHaveBeenCalledWith(ROOT);
    });

    it('reads the build flags off the arguments after the command', async () => {
        await ortha('build', '--server');

        expect(buildCommand).toHaveBeenCalledWith(ROOT, {
            serverOnly: true,
            adminOnly: false
        });
    });

    /**
     * `--server` was documented for `dev` in `USAGE` and read by nobody:
     * `devCommand(root)` took no options, so the flag parsed, changed nothing,
     * and brought Vite up anyway. An accepted flag that does nothing is worse
     * than one that errors, because there is no moment at which the user finds
     * out.
     */
    it.each([
        ['--server', { serverOnly: true, adminOnly: false }],
        ['--admin', { serverOnly: false, adminOnly: true }]
    ])('reads dev’s %s the same way build’s is read', async (arg, expected) => {
        await ortha('dev', arg);

        expect(devCommand).toHaveBeenCalledWith(ROOT, expected);
    });

    it('runs both halves when dev is given neither flag', async () => {
        await ortha('dev');

        expect(devCommand).toHaveBeenCalledWith(ROOT, {
            serverOnly: false,
            adminOnly: false
        });
    });

    it.each(['dev', 'build'])(
        'refuses %s --server --admin, which asks for neither half',
        async (command) => {
            await ortha(command, '--server', '--admin');

            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining('asks for neither half')
            );
            expect(devCommand).not.toHaveBeenCalled();
            expect(buildCommand).not.toHaveBeenCalled();
        }
    );

    it('passes the migration name through', async () => {
        await ortha('generate', '--name', 'add_posts');

        expect(generateCommand).toHaveBeenCalledWith(ROOT, 'add_posts');
    });

    it('turns the studio port into a number, leaving an unasked-for one undefined', async () => {
        await ortha('studio', '--host=0.0.0.0', '--port=5000');
        expect(studioCommand).toHaveBeenCalledWith(ROOT, {
            host: '0.0.0.0',
            port: 5000
        });

        await ortha('studio');
        expect(studioCommand).toHaveBeenLastCalledWith(ROOT, {
            host: undefined,
            port: undefined
        });
    });

    /**
     * `port ? Number(port) : undefined` lost the one port a user can type that
     * is falsy. Whether Studio should *run* on port 0 is `studio.ts`'s call —
     * it refuses, because drizzle-kit prints the port it was asked for rather
     * than the one it bound — but that decision can only be made by code the
     * value actually reaches.
     */
    it('carries a --port=0 through to the command instead of dropping it', async () => {
        await ortha('studio', '--port=0');

        expect(studioCommand).toHaveBeenCalledWith(ROOT, {
            host: undefined,
            port: 0
        });
    });

    it('reports a --port that is not a number, and runs nothing', async () => {
        await ortha('studio', '--port=abc');

        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining('must be a whole number')
        );
        expect(studioCommand).not.toHaveBeenCalled();
    });

    it('names an unknown command, prints the usage, and fails', async () => {
        await ortha('buld');

        expect(console.error).toHaveBeenCalledWith('Unknown command "buld".\n');
        expect(console.log).toHaveBeenCalledWith(USAGE);
        expect(process.exitCode).toBe(1);
    });
});

describe('an exception reaching the top', () => {
    /**
     * Every throw that gets here is a condition the user can act on — an
     * unbuilt app, a missing `DATABASE_URL`, a migration failure naming the
     * plugin — and each of those messages is a written sentence. A stack trace
     * buries the sentence under frames from inside this CLI, which is where the
     * problem is not.
     */
    it('prints the message alone, with no stack, and exits 1 [cli:I-19]', async () => {
        const error = new Error('DATABASE_URL is not set — migrating needs…');
        migrateCommand.mockRejectedValueOnce(error);

        await ortha('migrate');

        expect(console.error).toHaveBeenCalledTimes(1);
        expect(console.error).toHaveBeenCalledWith(
            'DATABASE_URL is not set — migrating needs…'
        );
        // The stack exists; it is simply not what was printed.
        expect(error.stack).toContain('at ');
        expect(
            String((console.error as jest.Mock).mock.calls[0][0])
        ).not.toContain('at ');
        expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('prints a thrown non-Error as itself [cli:I-19]', async () => {
        migrateCommand.mockRejectedValueOnce('drizzle-kit went missing');

        await ortha('migrate');

        expect(console.error).toHaveBeenCalledWith('drizzle-kit went missing');
        expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('exits 1 for a synchronous throw from a command too [cli:I-19]', async () => {
        generateCommand.mockImplementationOnce(() => {
            throw new Error(
                'No apps/server/drizzle.config.ts in /apps/my-cms.'
            );
        });

        await ortha('generate');

        expect(console.error).toHaveBeenCalledWith(
            'No apps/server/drizzle.config.ts in /apps/my-cms.'
        );
        expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('leaves a command that succeeds alone [cli:I-19]', async () => {
        await ortha('migrate');

        expect(console.error).not.toHaveBeenCalled();
        expect(process.exit).not.toHaveBeenCalled();
    });
});
