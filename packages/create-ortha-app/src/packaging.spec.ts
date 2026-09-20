import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What this package *is*, as opposed to what it writes.
 *
 * Both properties below are invisible until they break, and both break loudly
 * somewhere else: a template the workspace mistakes for source takes the whole
 * project graph down with it, and a runtime dependency is weight on the very
 * first thing a new user waits for.
 */

const packageRoot = join(__dirname, '..');
const workspaceRoot = join(__dirname, '../../..');

/** Reads a file from the workspace root. */
function root(path: string): string {
    return readFileSync(join(workspaceRoot, path), 'utf8');
}

describe('the templates directory', () => {
    /**
     * `templates/default` is an app, in a workspace that resolves packages from
     * source — so every tool that walks directories has to be told it is data.
     * Nx is the one that fails hardest: left visible, `@orthacms/nx` infers a
     * `db:migrate` target onto a directory with no project name and **the whole
     * project graph fails to build**, taking every `nx` command in the repo
     * with it. The other three fail quietly instead — `tsc --build` compiling
     * app-shaped files against this workspace, lint reporting on files nobody
     * here owns, and Prettier reformatting `__PLACEHOLDER__` tokens inside
     * JSON. All four have to hold at once; three out of four is the same
     * broken repo.
     */
    it.each([
        ['.nxignore', () => root('.nxignore')],
        ['.prettierignore', () => root('.prettierignore')],
        ['eslint.config.mjs', () => root('eslint.config.mjs')]
    ])('is excluded from %s [create-ortha-app:I-31]', (_name, read) => {
        expect(read()).toMatch(/packages\/create-ortha-app\/templates/);
    });

    it('is excluded from the TypeScript build [create-ortha-app:I-31]', () => {
        const tsconfig = JSON.parse(
            readFileSync(join(packageRoot, 'tsconfig.lib.json'), 'utf8')
        ) as { exclude: string[] };

        expect(tsconfig.exclude).toContain('templates');
    });
});

describe('the package itself', () => {
    const manifest = JSON.parse(
        readFileSync(join(packageRoot, 'package.json'), 'utf8')
    ) as {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
    };

    /**
     * This is what `npx` downloads before anything else exists, so every
     * dependency is weight on the first thing a new user waits for — and the
     * terminal UI, the argument parsing and the conditional processor are all
     * hand-rolled to keep it that way.
     */
    it('installs nothing to run [create-ortha-app:I-32]', () => {
        expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
        expect(Object.keys(manifest.peerDependencies ?? {})).toEqual([]);
    });
});
