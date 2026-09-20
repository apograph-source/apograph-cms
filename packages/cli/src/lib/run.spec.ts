import { EventEmitter } from 'node:events';
import {
    mkdirSync,
    mkdtempSync,
    realpathSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';

const spawn = jest.fn();

jest.mock('node:child_process', () => ({
    spawn: (...args: unknown[]) => spawn(...args)
}));

import { run, spawnNode, superviseUntilExit, tscBin, viteBin } from './run';

/** A child process stub: an emitter with the three fields `run.ts` reads. */
class FakeChild extends EventEmitter {
    kill = jest.fn();
    exitCode: number | null = null;
    signalCode: NodeJS.Signals | null = null;
}

function fakeChild(): FakeChild {
    const child = new FakeChild();
    spawn.mockReturnValueOnce(child);

    return child;
}

const roots: string[] = [];

/**
 * An app tree with its own `node_modules`, in a temp directory — deliberately
 * outside this repo, so a resolution that started from the CLI's own tree lands
 * somewhere else and the assertion can see it.
 */
function tempApp(packages: Record<string, unknown>): string {
    // `realpathSync`, because Node's resolver answers with the real path and
    // macOS's temp directory is reached through a symlink.
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'ortha-cli-run-')));
    roots.push(root);
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'my-cms' }),
        'utf8'
    );

    for (const [name, manifest] of Object.entries(packages)) {
        const dir = join(root, 'node_modules', name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(manifest),
            'utf8'
        );
    }

    return root;
}

/**
 * Vite as it really publishes: an `exports` map that exposes the package
 * manifest but *not* `./bin/vite.js`. This is the fixture the invariant turns
 * on — resolving the guessed subpath against it fails with
 * `Package subpath './bin/vite.js' is not defined by "exports"`.
 */
const VITE_MANIFEST = {
    name: 'vite',
    version: '7.0.0',
    bin: { vite: 'bin/vite.js' },
    exports: {
        '.': { import: './dist/node/index.js' },
        './package.json': './package.json'
    }
};

const TYPESCRIPT_MANIFEST = {
    name: 'typescript',
    version: '5.9.0',
    bin: { tsc: './bin/tsc', tsserver: './bin/tsserver' }
};

beforeEach(() => jest.clearAllMocks());

afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('resolving the app’s binaries', () => {
    /**
     * Two rules in one assertion, because they fail in the same place.
     *
     * From the *app*: `ortha` is installed into the app it builds, so the
     * TypeScript and Vite that app declares are the ones that must run — this
     * repo has both in its own `node_modules`, and a resolution anchored on the
     * CLI would return those instead of the fixture's.
     *
     * Through the *manifest*: `vite/bin/vite.js` is only resolvable if Vite
     * exports that subpath, and it does not. The `bin` field is what npm itself
     * links, and `package.json` is exported by every package that has one.
     */
    it('resolves tsc and vite from the app, through the bin field [cli:I-13]', () => {
        const root = tempApp({
            typescript: TYPESCRIPT_MANIFEST,
            vite: VITE_MANIFEST
        });

        expect(tscBin(root)).toBe(
            join(root, 'node_modules', 'typescript', 'bin', 'tsc')
        );
        expect(viteBin(root)).toBe(
            join(root, 'node_modules', 'vite', 'bin', 'vite.js')
        );
    });

    it('prefers the app’s copy over the one beside the CLI [cli:I-13]', () => {
        const root = tempApp({
            typescript: { ...TYPESCRIPT_MANIFEST, version: '4.0.0' },
            vite: VITE_MANIFEST
        });

        // What a resolution anchored on this package — rather than on the app —
        // would have answered. This repo has its own TypeScript, so the two
        // paths really are different, and compiling someone's app with whatever
        // npm hoisted next to the CLI is the bug being excluded.
        const besideTheCli = join(
            require.resolve('typescript/package.json'),
            '..',
            'bin',
            'tsc'
        );

        expect(tscBin(root)).toBe(
            join(root, 'node_modules', 'typescript', 'bin', 'tsc')
        );
        expect(tscBin(root)).not.toBe(besideTheCli);
    });

    it('accepts a package whose bin is a bare string [cli:I-13]', () => {
        const root = tempApp({
            typescript: { name: 'typescript', bin: './bin/tsc' },
            vite: VITE_MANIFEST
        });

        expect(tscBin(root)).toBe(
            join(root, 'node_modules', 'typescript', 'bin', 'tsc')
        );
    });

    it('names the package and the app when no such binary is declared [cli:I-13]', () => {
        const root = tempApp({
            typescript: { name: 'typescript' },
            vite: VITE_MANIFEST
        });

        expect(() => tscBin(root)).toThrow(
            `typescript declares no "tsc" binary — is it installed in ${root}?`
        );
    });
});

describe('spawnNode', () => {
    /**
     * The reason `.env` is loaded once at startup rather than per command: the
     * values reach `tsc`, `vite` and the API only by being on `process.env`
     * when these children are spawned.
     */
    it('hands the child this process’s environment [cli:I-15]', () => {
        fakeChild();
        process.env.ORTHA_SPEC_INHERITED = 'yes';

        try {
            spawnNode(['/app/dist/server/src/main.js'], '/app', {
                NODE_ENV: 'production'
            });
        } finally {
            delete process.env.ORTHA_SPEC_INHERITED;
        }

        const [command, argv, options] = spawn.mock.calls[0];
        expect(command).toBe(process.execPath);
        expect(argv).toEqual(['/app/dist/server/src/main.js']);
        expect(options.cwd).toBe('/app');
        expect(options.stdio).toBe('inherit');
        expect(options.env.ORTHA_SPEC_INHERITED).toBe('yes');
        expect(options.env.NODE_ENV).toBe('production');
    });

    /**
     * `--watch` is a node flag. Passed as a script argument it reaches the
     * script instead of the runtime, and the process starts once and watches
     * nothing — which is why this takes one argv array rather than a script
     * plus arguments.
     */
    it('passes node’s own flags ahead of the script', () => {
        fakeChild();

        spawnNode(['--watch', '/app/dist/server/src/main.js'], '/app');

        expect(spawn.mock.calls[0][1]).toEqual([
            '--watch',
            '/app/dist/server/src/main.js'
        ]);
    });
});

describe('run', () => {
    it('resolves on a clean exit', async () => {
        const child = fakeChild();
        const promise = run(['/app/main.js'], '/app');

        child.emit('exit', 0, null);

        await expect(promise).resolves.toBeUndefined();
    });

    it('rejects naming the binary and the exit code', async () => {
        const child = fakeChild();
        const promise = run(
            ['/n_m/typescript/bin/tsc', '-p', 'x.json'],
            '/app'
        );

        child.emit('exit', 2, null);

        await expect(promise).rejects.toThrow('tsc exited with code 2');
    });

    /**
     * Ctrl+C is the documented way to end `dev` and `start`. Reporting it as a
     * failure teaches people to read red as noise — which is the same reason
     * `runDrizzleKitStudio` swallows the signal from its own child.
     */
    it.each([['SIGINT'], ['SIGTERM']])(
        'treats %s as the documented way to stop, not a failure [cli:I-18]',
        async (signal) => {
            const child = fakeChild();
            const promise = run(['/app/main.js'], '/app');

            child.emit('exit', null, signal);

            await expect(promise).resolves.toBeUndefined();
        }
    );

    it('rejects when the child could not be spawned at all', async () => {
        const child = fakeChild();
        const promise = run(['/app/main.js'], '/app');

        child.emit('error', new Error('spawn ENOENT'));

        await expect(promise).rejects.toThrow('spawn ENOENT');
    });
});

describe('superviseUntilExit', () => {
    // `superviseUntilExit` adds process-level signal listeners and never
    // removes them; restore the set the harness started with.
    const signals = ['SIGINT', 'SIGTERM'] as const;
    let existing: Record<string, NodeJS.SignalsListener[]>;

    beforeEach(() => {
        existing = Object.fromEntries(
            signals.map((signal) => [
                signal,
                process.listeners(signal) as NodeJS.SignalsListener[]
            ])
        );
    });

    afterEach(() => {
        for (const signal of signals) {
            process.removeAllListeners(signal);
            for (const listener of existing[signal]) {
                process.on(signal, listener);
            }
        }
    });

    function children(count: number): FakeChild[] {
        return Array.from({ length: count }, () => new FakeChild());
    }

    /**
     * Delivers the signal the way Node would — to the handlers this call
     * installed, and to nothing else.
     *
     * Deliberately not `process.emit('SIGINT')`. Jest and Nx install their own
     * interrupt handlers on the same object, so emitting it for real starts
     * tearing down the *test run*: written that way, these two cases timed out
     * in roughly half of the full-suite runs and never once on their own.
     * Reading the listeners back also states the other half of the invariant —
     * that a handler was registered for this signal at all.
     */
    function deliver(signal: NodeJS.Signals): void {
        const added = (
            process.listeners(signal) as NodeJS.SignalsListener[]
        ).filter((listener) => !existing[signal].includes(listener));

        expect(added).toHaveLength(1);
        added[0](signal);
    }

    /**
     * Without the teardown, ending `ortha dev` leaves an orphaned `tsc --watch`
     * and a `node --watch` still holding the API port — so the *next* `ortha
     * dev` fails on a port in use, blamed on a process the user cannot see.
     */
    it('takes the others down when any one child exits [cli:I-17]', async () => {
        const [tsc, api, vite] = children(3);
        const supervised = superviseUntilExit([
            tsc,
            api,
            vite
        ] as unknown as ChildProcess[]);

        api.exitCode = 1;
        api.emit('exit', 1, null);

        await expect(supervised).resolves.toBeUndefined();
        expect(tsc.kill).toHaveBeenCalledWith('SIGTERM');
        expect(vite.kill).toHaveBeenCalledWith('SIGTERM');
        // The one that died is not signalled again.
        expect(api.kill).not.toHaveBeenCalled();
    });

    it.each([['SIGINT'], ['SIGTERM']])(
        'takes them all down on %s [cli:I-17] [cli:I-18]',
        async (signal) => {
            const [tsc, api] = children(2);
            const supervised = superviseUntilExit([
                tsc,
                api
            ] as unknown as ChildProcess[]);

            deliver(signal as NodeJS.Signals);

            await expect(supervised).resolves.toBeUndefined();
            expect(tsc.kill).toHaveBeenCalledWith('SIGTERM');
            expect(api.kill).toHaveBeenCalledWith('SIGTERM');
        }
    );

    /**
     * The `settling` flag, and the reason it is not decoration: the SIGTERMs
     * this sends make the *other* children exit, and each of those exits calls
     * `stopAll` again. Without the flag a three-process `dev` signals every
     * survivor once per sibling death — and on the signal path it re-enters
     * from Ctrl+C as well, so a child that had started shutting down cleanly
     * gets killed again mid-flight.
     */
    it('settles exactly once, however many children then die [cli:I-17]', async () => {
        const [tsc, api, vite] = children(3);
        const supervised = superviseUntilExit([
            tsc,
            api,
            vite
        ] as unknown as ChildProcess[]);

        api.exitCode = 1;
        api.emit('exit', 1, null);

        // The two survivors now die of the SIGTERM they were just sent, and
        // the user, seeing nothing happen, presses Ctrl+C.
        tsc.emit('exit', null, 'SIGTERM');
        vite.emit('exit', null, 'SIGTERM');
        deliver('SIGINT');

        await supervised;
        expect(tsc.kill).toHaveBeenCalledTimes(1);
        expect(vite.kill).toHaveBeenCalledTimes(1);
        expect(api.kill).not.toHaveBeenCalled();
    });

    it('leaves a child that has already been signalled alone [cli:I-17]', async () => {
        const [tsc, api] = children(2);
        tsc.signalCode = 'SIGTERM';
        const supervised = superviseUntilExit([
            tsc,
            api
        ] as unknown as ChildProcess[]);

        api.emit('error', new Error('vanished'));

        await supervised;
        expect(tsc.kill).not.toHaveBeenCalled();
        expect(api.kill).toHaveBeenCalledWith('SIGTERM');
    });
});
