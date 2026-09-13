import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformFileSync } from '@swc/core';

/**
 * These run `loadEnv` in a **real child process**, and the reason is that the
 * observable in this harness cannot otherwise show the difference. Jest's node environment hands each test
 * file a `process` whose `env` is a copy, while `process.loadEnvFile` writes to
 * the real environment through V8 — so in-process, a correct `loadEnv` and one
 * that did nothing at all leave `process.env` looking identical. Measured, not
 * assumed: the first draft of this file asserted in-process and passed while
 * reading `undefined` for every variable the file had set.
 *
 * The child runs the compiled production module, not a re-statement of it, so
 * the precedence being asserted is `process.loadEnvFile`'s own — which is the
 * whole reason `env.ts` delegates to it instead of parsing the file itself.
 */
const scratch = mkdtempSync(join(tmpdir(), 'apograph-cli-env-'));

/** `env.ts` compiled to CommonJS, so any Node that can run the CLI can run it. */
const MODULE = (() => {
    const path = join(scratch, 'env.cjs');
    const { code } = transformFileSync(join(__dirname, 'env.ts'), {
        module: { type: 'commonjs' },
        jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }
    });
    writeFileSync(path, code, 'utf8');

    return path;
})();

interface ChildRun {
    /** The child's own `APOGRAPH_SPEC_*` variables after `loadEnv` returned. */
    env: Record<string, string>;
    /** Anything `loadEnv` printed, either stream. */
    stdout: string;
    stderr: string;
    status: number | null;
}

function app(dotenv?: string): string {
    const root = mkdtempSync(join(scratch, 'app-'));
    if (dotenv !== undefined) {
        writeFileSync(join(root, '.env'), dotenv, 'utf8');
    }

    return root;
}

function loadEnvIn(
    root: string,
    exported: Record<string, string> = {}
): ChildRun {
    const script = [
        `const { loadEnv } = require(${JSON.stringify(MODULE)});`,
        `loadEnv(${JSON.stringify(root)});`,
        // A NUL separates anything loadEnv printed from the report, so the
        // "not even a warning" clause is checkable on the same run.
        `process.stdout.write('\\u0000' + JSON.stringify(Object.fromEntries(`,
        `    Object.entries(process.env).filter(([k]) => k.startsWith('APOGRAPH_SPEC_'))`,
        `)));`
    ].join('\n');

    const child = spawnSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        env: { ...process.env, ...exported }
    });
    const [printed, report] = child.stdout.split('\u0000');

    return {
        env: JSON.parse(report ?? '{}') as Record<string, string>,
        stdout: printed,
        stderr: child.stderr,
        status: child.status
    };
}

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('loadEnv', () => {
    /**
     * The precedence a deployment needs: real environments set their
     * configuration in the environment, and a `.env` that accidentally shipped
     * inside an image must not win over it. Inverted, this is the worst kind of
     * failure — a container quietly migrating whichever database the stale file
     * named, having been told which one to use and ignored it.
     */
    it('leaves an already-exported variable alone [cli:I-14]', () => {
        const root = app(
            'APOGRAPH_SPEC_EXPORTED=from-the-file\nAPOGRAPH_SPEC_FROM_FILE=only-in-the-file\n'
        );

        const { env, status } = loadEnvIn(root, {
            APOGRAPH_SPEC_EXPORTED: 'from-the-shell'
        });

        expect(status).toBe(0);
        expect(env.APOGRAPH_SPEC_EXPORTED).toBe('from-the-shell');
        // The same run did read the file — so the line above is about
        // precedence, not about the file having been skipped wholesale.
        expect(env.APOGRAPH_SPEC_FROM_FILE).toBe('only-in-the-file');
    });

    it('reads the .env beside the project root it was given [cli:I-14]', () => {
        const root = app('APOGRAPH_SPEC_FROM_FILE=beside-the-root\n');

        // The child's working directory is this package, not the app: the path
        // is built from `root`, not from wherever the command was typed.
        expect(loadEnvIn(root).env.APOGRAPH_SPEC_FROM_FILE).toBe(
            'beside-the-root'
        );
    });

    /**
     * Absent is the normal case for a deployment, which sets real environment
     * variables and never writes the file. A warning here would print on every
     * production start, for nothing — so the silence is the invariant.
     */
    it('says nothing at all when there is no .env [cli:I-14]', () => {
        const { status, stdout, stderr, env } = loadEnvIn(app());

        expect(status).toBe(0);
        expect(stdout).toBe('');
        expect(stderr).toBe('');
        expect(env).toEqual({});
    });

    it('says nothing on the happy path either [cli:I-14]', () => {
        const { stdout, stderr } = loadEnvIn(
            app('APOGRAPH_SPEC_FROM_FILE=x\n')
        );

        expect(stdout).toBe('');
        expect(stderr).toBe('');
    });
});
