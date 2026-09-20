import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = jest.fn();

jest.mock('../run', () => ({
    run: (...args: unknown[]) => run(...args),
    tscBin: (root: string) => join(root, 'node_modules/typescript/bin/tsc'),
    viteBin: (root: string) => join(root, 'node_modules/vite/bin/vite.js')
}));

import { buildCommand } from './build';
import { LAYOUT } from '../project';

const roots: string[] = [];

/** An app tree, optionally with the admin's HTML entry present. */
function tempApp({ admin }: { admin: boolean }): string {
    const root = mkdtempSync(join(tmpdir(), 'ortha-cli-build-'));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), '{"name":"my-cms"}', 'utf8');

    if (admin) {
        const index = join(root, LAYOUT.adminIndex);
        mkdirSync(join(index, '..'), { recursive: true });
        writeFileSync(index, '<!doctype html>', 'utf8');
    }

    return root;
}

/** Everything the build spawned, flattened into one list of argv elements. */
function everySpawnedArgument(): string[] {
    return run.mock.calls.flatMap(([argv]: [string[]]) => argv);
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('buildCommand', () => {
    /**
     * The server is **compiled**, not bundled, and that is a correctness
     * requirement rather than a preference: every Ortha plugin locates its
     * migrations as `join(__dirname, '../../../migrations')`, which resolves to
     * its own package root inside `node_modules` and stops resolving the moment
     * a bundler flattens those files into one. So the server half of a build is
     * exactly one child process — the app's own `tsc` on the app's own
     * tsconfig — and no bundler is invoked for it at all.
     */
    it('compiles the server with tsc and bundles nothing [cli:I-12] [cli:I-13]', async () => {
        const root = tempApp({ admin: false });

        await buildCommand(root, { serverOnly: true });

        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith(
            [
                join(root, 'node_modules/typescript/bin/tsc'),
                '-p',
                LAYOUT.serverTsconfig
            ],
            root
        );
        expect(everySpawnedArgument()).not.toContainEqual(
            expect.stringMatching(/webpack|rollup|esbuild|--bundle/)
        );
    });

    /**
     * `--config`, because the config lives inside the app rather than at the
     * project root: Vite looks for one in the working directory and would
     * otherwise build with its defaults, silently producing a bundle from the
     * wrong root.
     */
    it('builds the admin with the app’s vite and the app’s config [cli:I-13]', async () => {
        const root = tempApp({ admin: true });

        await buildCommand(root);

        expect(run).toHaveBeenNthCalledWith(
            2,
            [
                join(root, 'node_modules/vite/bin/vite.js'),
                'build',
                '--config',
                LAYOUT.adminConfig
            ],
            root
        );
    });

    it('compiles the server before building the admin', async () => {
        const root = tempApp({ admin: true });

        await buildCommand(root);

        expect(run.mock.calls.map(([argv]: [string[]]) => argv[0])).toEqual([
            join(root, 'node_modules/typescript/bin/tsc'),
            join(root, 'node_modules/vite/bin/vite.js')
        ]);
    });

    /** A headless app — an API with no UI — is a supported shape, not an error. */
    it('skips the admin build, saying so, when there is no index.html', async () => {
        const root = tempApp({ admin: false });

        await buildCommand(root);

        expect(run).toHaveBeenCalledTimes(1);
        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining(`No ${LAYOUT.adminIndex}`)
        );
    });

    it('builds the server alone for --server, even with an admin present', async () => {
        const root = tempApp({ admin: true });

        await buildCommand(root, { serverOnly: true });

        expect(run).toHaveBeenCalledTimes(1);
        expect(run.mock.calls[0][0][0]).toContain('typescript');
    });

    it('builds the admin alone for --admin', async () => {
        const root = tempApp({ admin: true });

        await buildCommand(root, { adminOnly: true });

        expect(run).toHaveBeenCalledTimes(1);
        expect(run.mock.calls[0][0][0]).toContain('vite');
    });

    it('does not build the admin after a failed server compile', async () => {
        const root = tempApp({ admin: true });
        run.mockRejectedValueOnce(new Error('tsc exited with code 2'));

        await expect(buildCommand(root)).rejects.toThrow(
            'tsc exited with code 2'
        );
        expect(run).toHaveBeenCalledTimes(1);
    });
});
