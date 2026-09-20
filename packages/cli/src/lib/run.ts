import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';

/**
 * Resolves an executable from the **app's** `node_modules`, via that package's
 * own `bin` field.
 *
 * Two things this has to get right.
 *
 * It resolves from the app, not from this package: `ortha` is installed into
 * the app it builds, so the TypeScript and Vite that app declares are the ones
 * that must run — resolving from the CLI's own tree would compile someone's
 * app with whatever version npm happened to hoist next to it.
 *
 * And it goes through the manifest rather than guessing the path. A deep
 * specifier like `vite/bin/vite.js` is only resolvable if the package happens
 * to export that subpath, and Vite does not: it publishes an `exports` map
 * without it, so the guess fails with `Package subpath './bin/vite.js' is not
 * defined by "exports"`. `package.json` is exported by both, and its `bin`
 * field is the authoritative answer — it is what npm itself links.
 */
function resolveBin(root: string, pkg: string, command: string): string {
    const manifestPath = createRequire(join(root, 'package.json')).resolve(
        `${pkg}/package.json`
    );
    const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        bin?: string | Record<string, string>;
    };
    const relative = typeof bin === 'string' ? bin : bin?.[command];

    if (!relative) {
        throw new Error(
            `${pkg} declares no "${command}" binary — is it installed in ${root}?`
        );
    }

    return join(dirname(manifestPath), relative);
}

/** The app's `tsc` entry point. */
export function tscBin(root: string): string {
    return resolveBin(root, 'typescript', 'tsc');
}

/** The app's `vite` entry point. */
export function viteBin(root: string): string {
    return resolveBin(root, 'vite', 'vite');
}

/**
 * Spawns `node` with `argv`, inheriting stdio.
 *
 * `argv` is everything after `node`, node's own flags included — which is why
 * this takes one array rather than a script plus arguments. `--watch` is a
 * node flag, and passed as a script argument it reaches the script instead of
 * the runtime, so the process starts once and never watches anything.
 */
export function spawnNode(
    argv: readonly string[],
    root: string,
    env: NodeJS.ProcessEnv = {}
): ChildProcess {
    return spawn(process.execPath, [...argv], {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, ...env }
    });
}

/** Runs `node argv` to completion, rejecting on a non-zero exit. */
export function run(
    argv: readonly string[],
    root: string,
    env: NodeJS.ProcessEnv = {}
): Promise<void> {
    return new Promise((resolvePromise, reject) => {
        const child = spawnNode(argv, root, env);

        child.on('error', reject);
        child.on('exit', (code, signal) => {
            // Ctrl+C is the documented way to end `dev` and `start`; reporting
            // it as a failure trains people to ignore red.
            if (signal === 'SIGINT' || signal === 'SIGTERM') {
                return resolvePromise();
            }
            if (code === 0) return resolvePromise();

            const label = basename(
                argv.find((arg) => !arg.startsWith('-')) ?? 'node'
            );
            reject(new Error(`${label} exited with code ${code}`));
        });
    });
}

/**
 * Keeps a set of watch processes alive until one exits or the user interrupts,
 * then takes the rest down with it.
 *
 * Without the teardown, ending `ortha dev` leaves an orphaned `tsc --watch`
 * and a `node --watch` still holding the API port — so the next `ortha dev`
 * fails on a port already in use, blamed on a process the user cannot see.
 */
export function superviseUntilExit(children: ChildProcess[]): Promise<void> {
    return new Promise((resolvePromise) => {
        let settling = false;

        const stopAll = (): void => {
            if (settling) return;
            settling = true;

            for (const child of children) {
                if (child.exitCode === null && child.signalCode === null) {
                    child.kill('SIGTERM');
                }
            }
            resolvePromise();
        };

        for (const child of children) {
            child.on('exit', stopAll);
            child.on('error', stopAll);
        }

        process.on('SIGINT', stopAll);
        process.on('SIGTERM', stopAll);
    });
}
