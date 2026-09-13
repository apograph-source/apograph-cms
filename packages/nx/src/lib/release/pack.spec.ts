import { execFileSync } from 'node:child_process';
import {
    cpSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `tools/release/pack.mjs` staging a package that ships a **`bin`** and
 * **`templates/`** — what `create-apograph-app` and `@apograph/cli` need.
 *
 * Driven as a subprocess against a throwaway workspace rather than imported:
 * the script is an ESM entry point that reads `process.cwd()`, writes to
 * `dist/pack/`, and calls `process.exit` on failure. Running it for real is
 * also the only way to catch the failure this exists for — a `bin` left
 * pointing at `./src/cli.ts`, which installs cleanly and only breaks at
 * someone else's `npx`.
 */
const packScript = join(__dirname, '../../../../../tools/release/pack.mjs');

let root: string;

/** Writes `value` as JSON at `path`, creating parent directories. */
function writeJson(path: string, value: unknown): void {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 4)}\n`);
}

/** Writes a text file at `path`, creating parent directories. */
function writeText(path: string, contents: string): void {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, contents);
}

/**
 * Lays down a workspace holding one already-"built" package, so `pack.mjs`
 * finds the root manifest, the LICENSE and a `dist/` the way it would in the
 * real repo.
 */
function workspace(manifest: Record<string, unknown>): string {
    const dir = mkdtempSync(join(tmpdir(), 'apograph-pack-'));

    writeJson(join(dir, 'package.json'), {
        name: '@apograph/source',
        license: 'MIT',
        repository: {
            type: 'git',
            url: 'git+https://github.com/ortha-source/apograph-cms.git'
        },
        devDependencies: { tslib: '^2.3.0' }
    });
    writeText(join(dir, 'LICENSE'), 'MIT');

    const project = join(dir, 'packages/scaffolder');
    writeJson(join(project, 'package.json'), manifest);
    writeText(join(project, 'dist/cli.js'), '#!/usr/bin/env node\n');
    writeText(join(project, 'dist/index.js'), 'exports.x = 1;\n');
    writeText(
        join(project, 'dist/index.d.ts'),
        'export declare const x = 1;\n'
    );

    return dir;
}

/** Runs `pack.mjs` for the fixture project inside `root`. */
function pack(): void {
    execFileSync(process.execPath, [packScript, 'packages/scaffolder'], {
        cwd: root,
        stdio: 'pipe'
    });
}

/** The manifest `pack.mjs` staged for the fixture project. */
function stagedManifest(): Record<string, never> {
    return JSON.parse(
        readFileSync(
            join(root, 'dist/pack/packages/scaffolder/package.json'),
            'utf8'
        )
    );
}

const baseManifest = {
    name: 'create-apograph-app',
    version: '1.2.3',
    license: 'MIT',
    main: './src/index.ts',
    types: './src/index.ts',
    exports: {
        '.': {
            types: './src/index.ts',
            default: './src/index.ts'
        }
    }
};

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('pack.mjs, for a package that ships a bin', () => {
    it('remaps a bin map onto the build output', () => {
        root = workspace({
            ...baseManifest,
            bin: { apograph: './src/cli.ts' }
        });

        pack();

        expect(stagedManifest().bin).toEqual({ apograph: './dist/cli.js' });
    });

    it('remaps the bare-string spelling too', () => {
        root = workspace({ ...baseManifest, bin: './src/cli.ts' });

        pack();

        expect(stagedManifest().bin).toBe('./dist/cli.js');
    });

    it('leaves the manifest without a bin when the package has none', () => {
        root = workspace(baseManifest);

        pack();

        expect(stagedManifest()).not.toHaveProperty('bin');
    });

    /**
     * The regression this file exists for. Unremapped, npm links
     * `./src/cli.ts` — absent from the tarball, since `files` is `dist` — and
     * the command fails only at `npx`, on a consumer's machine.
     */
    it('refuses to stage a bin the build never emitted', () => {
        root = workspace({
            ...baseManifest,
            bin: { apograph: './src/missing.ts' }
        });

        expect(pack).toThrow();
    });
});

describe('pack.mjs, and the licence a package states', () => {
    it('stages the licence the package declares', () => {
        root = workspace(baseManifest);

        pack();

        expect(stagedManifest().license).toBe('MIT');
    });

    it('refuses a package that states no licence, rather than inheriting one', () => {
        const { license: _omitted, ...unlicensed } = baseManifest;
        root = workspace(unlicensed);

        expect(pack).toThrow(/no "license" field/);
    });

    it('refuses a package whose licence differs from the workspace', () => {
        root = workspace({ ...baseManifest, license: 'Apache-2.0' });

        expect(pack).toThrow(
            /licensed "Apache-2.0" but the workspace is "MIT"/
        );
    });
});

describe('pack.mjs, for a package that ships templates', () => {
    /** Adds a `templates/` tree to the fixture project. */
    function withTemplates(): void {
        writeText(
            join(root, 'packages/scaffolder/templates/base/package.json.tmpl'),
            '{ "name": "__NAME__" }\n'
        );
    }

    it('carries templates/ into the tarball', () => {
        root = workspace(baseManifest);
        withTemplates();

        pack();

        expect(
            readFileSync(
                join(
                    root,
                    'dist/pack/packages/scaffolder/templates/base/package.json.tmpl'
                ),
                'utf8'
            )
        ).toContain('__NAME__');
    });

    it('lists templates/ in `files`, so npm actually publishes it', () => {
        root = workspace(baseManifest);
        withTemplates();

        pack();

        expect(stagedManifest().files).toEqual(['dist', 'templates']);
    });

    it('lists only dist when the package ships no templates', () => {
        root = workspace(baseManifest);

        pack();

        expect(stagedManifest().files).toEqual(['dist']);
    });
});

/**
 * **`cli:I-12` — the build never bundles, so plugin migrations stay files
 * inside their packages in `node_modules`.**
 *
 * `packages/cli/src/lib/commands/build.spec.ts` pins the compile step's shape:
 * the server half of a build is one `tsc` child process and no bundler appears
 * in any spawned argv. What it cannot see is the consequence the invariant is
 * *stated* for — that `join(__dirname, '../../../migrations')`, evaluated by a
 * plugin living under someone's `node_modules`, lands on a directory of `.sql`
 * files.
 *
 * Two links in that chain are checkable here without a built app:
 *
 * - **the depth**, read off every real plugin rather than restated. A plugin
 *   compiles to `<pkg>/dist/lib/utils/<name>-plugin.js`, and three levels up
 *   from there has to be the package root. This asserts it against the actual
 *   source, so a plugin that moved its descriptor a directory breaks the case
 *   rather than quietly shipping a `dir()` pointing outside its own package.
 * - **the staging**, by running `pack.mjs` for real, installing what it staged
 *   into a `node_modules` tree, and calling the descriptor's `dir()` from
 *   there. That is the resolution the invariant describes, performed rather
 *   than described.
 *
 * What remains out of reach is the compile itself: nothing here runs `tsc`
 * against a real plugin, so a bundling step introduced elsewhere in the
 * pipeline — collapsing `dist/` to a single file and taking the `lib/utils/`
 * depth with it — would still pass. That needs a built app.
 */
describe('pack.mjs, for a plugin that ships migrations', () => {
    /** Every real plugin's `dir: () => join(__dirname, …)` descriptor. */
    function descriptors(): { file: string; segments: string[] }[] {
        const packages = join(__dirname, '../../../../../packages');
        const found: { file: string; segments: string[] }[] = [];

        const walk = (dir: string): void => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const path = join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (
                        /^(node_modules|dist|out-tsc|migrations)$/.test(
                            entry.name
                        )
                    )
                        continue;
                    walk(path);
                } else if (/-plugin\.ts$/.test(entry.name)) {
                    // Comments stripped: `content-plugin.ts` documents the
                    // descriptor in prose, at a depth it does not use.
                    const source = readFileSync(path, 'utf8')
                        .replace(/\/\*[\s\S]*?\*\//g, '')
                        .replace(/\/\/[^\n]*/g, '');

                    for (const [, args] of source.matchAll(
                        /dir:\s*\(\)\s*=>\s*join\(__dirname,([^)]*)\)/g
                    )) {
                        found.push({
                            file: path,
                            segments: [...args.matchAll(/'([^']+)'/g)].map(
                                ([, value]) => value
                            )
                        });
                    }
                }
            }
        };

        walk(packages);
        return found;
    }

    it('resolves to the package root from the compiled layout, in every plugin [cli:I-12]', () => {
        const found = descriptors();

        // Ten-odd plugins ship migrations. A walk that found one or none would
        // make the loop below vacuous.
        expect(found.length).toBeGreaterThan(5);

        for (const { file, segments } of found) {
            expect(`${file}: ${join('/pkg/dist/lib/utils', ...segments)}`).toBe(
                `${file}: ${join('/pkg', 'migrations')}`
            );
        }
    });

    it('stages migrations/ where that expression finds them from node_modules [cli:I-12]', () => {
        root = workspace(baseManifest);

        const project = join(root, 'packages/scaffolder');
        writeText(
            join(project, 'migrations/0000_init.sql'),
            'CREATE TABLE "thing" ("id" uuid PRIMARY KEY);\n'
        );
        // The descriptor at the depth the compiler puts it, spelled with the
        // segments the real plugins use rather than a hand-written guess.
        const [{ segments }] = descriptors();
        writeText(
            join(project, 'dist/lib/utils/thing-plugin.js'),
            "const { join } = require('node:path');\n" +
                `exports.dir = () => join(__dirname, ${segments
                    .map((segment) => JSON.stringify(segment))
                    .join(', ')});\n`
        );

        pack();

        // Install the staged package the way npm would, and ask the plugin
        // itself where its migrations are.
        const installed = join(root, 'consumer/node_modules/@apograph/thing');
        mkdirSync(join(installed, '..'), { recursive: true });
        cpSync(join(root, 'dist/pack/packages/scaffolder'), installed, {
            recursive: true
        });

        const { dir } = require(
            join(installed, 'dist/lib/utils/thing-plugin.js')
        ) as { dir: () => string };

        // `realpathSync` on both sides: macOS resolves the tmpdir through
        // a `/private` symlink, so `__dirname` inside the required module and
        // the path this test built are the same directory spelled two ways.
        expect(realpathSync(dir())).toBe(
            realpathSync(join(installed, 'migrations'))
        );
        expect(readdirSync(dir())).toEqual(['0000_init.sql']);
        expect(stagedManifest().files).toEqual(['dist', 'migrations']);
    });
});

/**
 * What the tarball's `dependencies` say, which is not what the checked-in
 * manifest says. Four dossiers describe a domain package as having "no
 * dependencies" on the strength of its own `package.json`; the staged
 * manifest is the one a consumer installs from, and `pack.mjs` writes
 * `tslib` into it unconditionally because `importHelpers` is on
 * workspace-wide. Nothing pinned that until here.
 */
describe('pack.mjs, resolving what a package depends on', () => {
    it('gives a package that declares nothing a tslib to run against', () => {
        root = workspace(baseManifest);

        pack();

        // The source never mentions tslib — the emitted JS reaches for it.
        expect(stagedManifest().dependencies).toEqual({ tslib: '^2.3.0' });
    });

    it('keeps a tslib the package pinned for itself', () => {
        root = workspace({
            ...baseManifest,
            dependencies: { tslib: '^2.99.0' }
        });

        pack();

        expect(stagedManifest().dependencies).toEqual({ tslib: '^2.99.0' });
    });

    it('pins a workspace dependency declared as "*" to its version', () => {
        root = workspace({
            ...baseManifest,
            dependencies: { '@apograph/database': '*' }
        });
        writeJson(join(root, 'packages/database/package.json'), {
            name: '@apograph/database',
            version: '4.5.6'
        });

        pack();

        // "*" on the registry means "whatever is latest", never what this
        // was built against.
        expect(stagedManifest().dependencies).toEqual({
            '@apograph/database': '^4.5.6',
            tslib: '^2.3.0'
        });
    });
});

/**
 * What the phantom-dependency check reads, which is not every file under
 * `src/`.
 *
 * The check exists to catch a package importing something only the workspace
 * root depends on — hoisted in development, absent from the consumer's tree.
 * That reasoning applies to what the tarball *contains*. Test scaffolding a
 * package excludes from its build — `__test__/harness.tsx`, `test-setup.ts` —
 * is compiled nowhere and shipped nowhere, and reading it refused
 * `@apograph/query-builder-admin` over a `@testing-library/react` import no
 * consumer could ever reach. The excludes differ per package, so the package's
 * own `tsconfig.lib.json` is what decides.
 */
describe('pack.mjs, and which files owe a dependency', () => {
    /** The fixture workspace, plus a `src/` and the tsconfig that compiles it. */
    function withSources(exclude: string[]): string {
        const dir = workspace(baseManifest);
        const project = join(dir, 'packages/scaffolder');

        writeJson(join(project, 'tsconfig.lib.json'), {
            compilerOptions: {
                outDir: 'dist',
                rootDir: 'src',
                jsx: 'react-jsx'
            },
            include: ['src/**/*.ts', 'src/**/*.tsx'],
            exclude
        });
        writeText(join(project, 'src/index.ts'), 'export const x = 1;\n');
        writeText(
            join(project, 'src/lib/__test__/harness.tsx'),
            "import { render } from '@testing-library/react';\nexport { render };\n"
        );

        return dir;
    }

    it('ignores a test helper the build excludes', () => {
        root = withSources(['src/**/__test__/**']);

        expect(() => pack()).not.toThrow();
    });

    it('still refuses an undeclared import the build does compile', () => {
        root = withSources([]);

        expect(() => pack()).toThrow(/@testing-library\/react/);
    });
});
