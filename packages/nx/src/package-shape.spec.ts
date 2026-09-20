import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The claims this package makes about *itself* — its module system and its
 * exclusion from the release — which no test that drives it can see.
 *
 * Both are made of absences. A `import.meta.url` slipping in breaks nothing a
 * jest run notices, because jest transpiles these files itself; it breaks Nx
 * `require`-ing the executor out of the CJS build, at release time. And the
 * `!@orthacms/nx` in `nx.json` is not code at all: drop it and every test in
 * this package still passes, right up until the next release publishes the
 * workspace's build tooling to npm.
 *
 * So this reads the source tree and the two manifests, the way
 * `packages/activity/server/src/lib/package-shape.spec.ts` does.
 */

/** The repository root, from `packages/nx/src`. */
const REPO = join(__dirname, '../../..');

/** This package's own sources. */
const PACKAGE_SRC = __dirname;

/** Directory names a source walk never descends into. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out-tsc', 'test-output']);

/** Every non-test TypeScript file under `root`. */
function sourceFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) {
                continue;
            }
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(path);
            } else if (/\.ts$/.test(entry.name) && !/\.spec\.ts$/.test(path)) {
                out.push(path);
            }
        }
    };
    walk(root);
    return out;
}

/**
 * One `{ file, line, text }` per **code** line of `files`.
 *
 * Comment lines are dropped, and here that is load-bearing rather than
 * tidiness: `src/index.ts` carries a long doc block that quotes the very glob
 * patterns and executor names the checks below look for, and `jiti.ts`
 * explains stage-3 decorators in prose. Counting those would make the scans
 * permanently red or allow-listed into uselessness.
 */
function codeLines(
    files: string[]
): { file: string; line: number; text: string }[] {
    const out: { file: string; line: number; text: string }[] = [];
    for (const file of files) {
        for (const [index, text] of readFileSync(file, 'utf8')
            .split('\n')
            .entries()) {
            const trimmed = text.trimStart();
            if (
                trimmed.startsWith('*') ||
                trimmed.startsWith('//') ||
                trimmed.startsWith('/*')
            ) {
                continue;
            }
            out.push({ file: relative(REPO, file), line: index + 1, text });
        }
    }
    return out;
}

/** `path:line` for the assertion messages — the point of failing is to say where. */
const at = (hit: { file: string; line: number }) => `${hit.file}:${hit.line}`;

const manifest = JSON.parse(
    readFileSync(join(REPO, 'packages/nx/package.json'), 'utf8')
) as { name: string; private?: boolean; type?: string };

const nxJson = JSON.parse(readFileSync(join(REPO, 'nx.json'), 'utf8')) as {
    release: { projects: string[] };
    targetDefaults: Record<string, { executor?: string }>;
};

describe('the shape of @orthacms/nx', () => {
    const PACKAGE_CODE = codeLines(sourceFiles(PACKAGE_SRC));

    it('reads the package at all', () => {
        // The guard on the guards below: an empty walk would satisfy every
        // "no occurrence of X" check while proving nothing.
        expect(PACKAGE_CODE.length).toBeGreaterThan(400);
    });

    describe('not a distributable [nx:I-31]', () => {
        it('is marked private in its own manifest [nx:I-31]', () => {
            expect([manifest.name, manifest.private]).toEqual([
                '@orthacms/nx',
                true
            ]);
        });

        it('is excluded from the release by name as well [nx:I-31]', () => {
            // Belt and braces on purpose, and the braces are the load-bearing
            // half: `private: true` only stops the *publish*, and only because
            // the release-publish executor checks it. The release's project
            // list is what decides whether this package is versioned and
            // tagged with the rest at all — `@orthacms/*` sweeps it in, so the
            // negation is the one thing keeping workspace tooling out of a
            // release the moment either guard is relaxed.
            expect(nxJson.release.projects).toContain('!@orthacms/nx');
        });

        it('states the exclusion after the glob that would otherwise take it [nx:I-31]', () => {
            // Nx applies the patterns in order, so a negation ahead of the
            // glob that matches is silently undone by it. This is the reading
            // that makes the entry above mean anything.
            const projects = nxJson.release.projects;

            expect(projects).toContain('@orthacms/*');
            expect(projects.indexOf('!@orthacms/nx')).toBeGreaterThan(
                projects.indexOf('@orthacms/*')
            );
        });
    });

    describe('CommonJS, because Nx requires the executors [nx:I-34]', () => {
        it('names import.meta nowhere in the package [nx:I-34]', () => {
            // The one construct that cannot be expressed in CommonJS. It would
            // survive every other check in this repo: jest transpiles per-file
            // and the typecheck is `module: nodenext`, so the failure lands on
            // whoever runs `nx run <plugin>:db:generate` after a release.
            const hits = PACKAGE_CODE.filter((hit) =>
                hit.text.includes('import.meta')
            );

            expect(hits.map(at)).toEqual([]);
        });

        it('uses the CommonJS globals instead [nx:I-34]', () => {
            // The complement: "no `import.meta`" is also true of a package
            // that never needs to know where it is, which would make the check
            // above unfalsifiable by anything anyone would write. Both
            // executors anchor jiti at `__filename`, which is exactly the call
            // an ESM conversion would have to rewrite.
            const globals = PACKAGE_CODE.filter((hit) =>
                /\b(__dirname|__filename|require\()/.test(hit.text)
            );

            expect(globals.map((hit) => hit.file).sort()).toEqual([
                'packages/nx/src/executors/db-migrate/executor.ts',
                'packages/nx/src/executors/db-studio/executor.ts'
            ]);
        });

        it('declares no ESM module type in its manifest [nx:I-34]', () => {
            // `"type": "module"` would reinterpret every emitted `.js` in
            // `dist/` as ESM without changing one line of TypeScript.
            expect(manifest.type).toBeUndefined();
        });
    });

    it('loads the host’s TypeScript through one shared loader [nx:I-33]', () => {
        // Both executor specs mock `../../lib/jiti` away, so each proves its
        // own executor calls *a* loader and neither proves they call the same
        // one. Two loaders would be two decorator readings, and the one that
        // got it wrong would fail only on a host whose DTOs use decorated
        // definite-assignment fields — which is to say, later.
        const callers = PACKAGE_CODE.filter(
            (hit) =>
                hit.text.includes('createTsJiti(') &&
                // The declaration in `lib/jiti.ts` is not a caller.
                !hit.text.includes('function createTsJiti(')
        );

        expect(callers.map((hit) => hit.file).sort()).toEqual([
            'packages/nx/src/executors/db-migrate/executor.ts',
            'packages/nx/src/executors/db-studio/executor.ts'
        ]);
        expect(
            PACKAGE_CODE.filter((hit) =>
                hit.text.includes("from '../../lib/jiti'")
            )
        ).toHaveLength(2);
    });
});

/**
 * The licence is a claim every package makes about itself, and one no test
 * that drives a package can see: a manifest with no `license` field builds,
 * tests and links exactly like one with it. It is read by `pack` at release
 * time — which refuses the package — and by a consumer's compliance scanner
 * after publication, which is too late. So the whole workspace is checked
 * here, against the root manifest, on every test run.
 */
describe('every workspace package states the licence', () => {
    const root = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));

    /** Every `package.json` one or two levels under `packages/`. */
    const manifests = (() => {
        const out: string[] = [];
        const packages = join(REPO, 'packages');
        for (const group of readdirSync(packages, { withFileTypes: true })) {
            if (!group.isDirectory()) continue;
            const flat = join(packages, group.name, 'package.json');
            try {
                readFileSync(flat);
                out.push(flat);
                continue;
            } catch {
                /* a group directory: its packages are one level down */
            }
            for (const child of readdirSync(join(packages, group.name), {
                withFileTypes: true
            })) {
                if (!child.isDirectory()) continue;
                const nested = join(
                    packages,
                    group.name,
                    child.name,
                    'package.json'
                );
                try {
                    readFileSync(nested);
                    out.push(nested);
                } catch {
                    /* not a package */
                }
            }
        }
        return out;
    })();

    it('finds the packages at all', () => {
        expect(manifests.length).toBeGreaterThan(50);
    });

    it('is the workspace licence, stated on the package itself', () => {
        const wrong = manifests
            .map((file) => ({
                file: relative(REPO, file),
                license: JSON.parse(readFileSync(file, 'utf8')).license
            }))
            .filter((entry) => entry.license !== root.license);

        expect(root.license).toBe('MIT');
        expect(wrong).toEqual([]);
    });
});
