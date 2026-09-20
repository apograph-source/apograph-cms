import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The four architectural invariants of the `utils` group — the ones a reviewer
 * can only enforce by remembering them.
 *
 * Every other rule in this package is a function's behaviour and is pinned by a
 * spec beside that function. These four are properties of the *repository*: what
 * the leaf may depend on, what it may contain, and — for the axios instance —
 * what everybody else may not do. Nothing enforced them until this file, and
 * each is broken by an edit that looks entirely reasonable in isolation: one
 * `import axios from 'axios'` in a new plugin's hook loses the workspace header
 * and the 401 handler at once, and the request still works, which is what makes
 * it a silent loss rather than a bug report.
 */

/**
 * The workspace root, found by walking up from wherever the runner was
 * started. `import.meta.url` is not a `file:` URL under the jsdom environment
 * and a fixed number of `..` breaks the moment the package moves.
 */
function repoRoot(): string {
    let dir = resolve(process.cwd());
    while (!existsSync(join(dir, 'nx.json'))) {
        const parent = dirname(dir);
        if (parent === dir)
            throw new Error('no nx.json above ' + process.cwd());
        dir = parent;
    }
    return dir;
}

const REPO = repoRoot();
const ADMIN = join(REPO, 'packages/utils/admin');
const SERVER = join(REPO, 'packages/utils/server');

const SKIP_DIRS = new Set([
    'node_modules',
    'dist',
    'out-tsc',
    'test-output',
    'coverage',
    '.nx',
    '.git'
]);

/** Every `.ts`/`.tsx` file under `dir`, recursively, skipping build output. */
function sources(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sources(full));
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

const read = (file: string) => readFileSync(file, 'utf8');
const rel = (file: string) => relative(REPO, file);
const isSpec = (file: string) => /\.(spec|test)\.tsx?$/.test(file);

/**
 * Line and block comments removed. Every one of these packages documents its
 * reasoning at length in prose, and that prose names the very things the
 * assertions below look for — `@ortha/bootstrap-server`, `react-intl`,
 * `axios`. Matching against raw text would make the tests fail on a sentence
 * and pass on a violation whose comment happened to be short.
 */
function withoutComments(code: string): string {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Every module specifier the file imports or re-exports from. */
function importsOf(code: string): string[] {
    const body = withoutComments(code);
    const out: string[] = [];
    const pattern = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) out.push(match[1]);
    return out;
}

const ADMIN_SOURCES = sources(join(ADMIN, 'src'));
const SERVER_SOURCES = sources(join(SERVER, 'src'));

describe('the leaf’s dependencies', () => {
    it('names no plugin and no host in either manifest [utils:I-01]', () => {
        const workspaceDeps = (pkgDir: string) => {
            const manifest = JSON.parse(read(join(pkgDir, 'package.json')));
            return Object.keys({
                ...manifest.dependencies,
                ...manifest.peerDependencies,
                ...manifest.devDependencies
            }).filter((name) => name.startsWith('@ortha/'));
        };

        // The design system is the one exception, and only on the admin side.
        // Anything else here is a cycle waiting to happen: every plugin imports
        // this package, so a plugin it imported back would make the two
        // unloadable in either order.
        expect(workspaceDeps(ADMIN)).toEqual(['@ortha/design-system']);
        expect(workspaceDeps(SERVER)).toEqual([]);
    });

    it('imports no plugin and no host from its source either [utils:I-01]', () => {
        const offenders = [...ADMIN_SOURCES, ...SERVER_SOURCES].flatMap(
            (file) =>
                importsOf(read(file))
                    .filter(
                        (spec) =>
                            spec.startsWith('@ortha/') &&
                            spec !== '@ortha/design-system'
                    )
                    .map((spec) => `${rel(file)} → ${spec}`)
        );

        // A manifest can be right while the code is not: the workspace resolves
        // every `@ortha/*` from source through `tsconfig.base.json`, so an
        // undeclared import compiles and runs.
        expect(offenders).toEqual([]);
    });

    it('keeps the design-system dependency on the admin side only [utils:I-01]', () => {
        const serverOffenders = SERVER_SOURCES.filter((file) =>
            importsOf(read(file)).some((spec) => spec.startsWith('@ortha/'))
        ).map(rel);

        expect(serverOffenders).toEqual([]);
    });
});

describe('the leaf’s copy', () => {
    it('depends on react-intl nowhere and imports it nowhere [utils:I-02]', () => {
        for (const dir of [ADMIN, SERVER]) {
            const manifest = JSON.parse(read(join(dir, 'package.json')));
            expect(
                Object.keys({
                    ...manifest.dependencies,
                    ...manifest.peerDependencies
                })
            ).not.toContain('react-intl');
        }

        const importers = [...ADMIN_SOURCES, ...SERVER_SOURCES]
            .filter((file) => importsOf(read(file)).includes('react-intl'))
            .map(rel);

        // The copy is brought by whoever mounts these helpers. The moment this
        // package formats a message it owns a translation catalogue, and the
        // host's single `IntlProvider` stops being the only one.
        expect(importers).toEqual([]);
    });

    it('renders no literal text of its own [utils:I-02]', () => {
        // The other half, and the one a missing `react-intl` import does not
        // cover: a hard-coded English `<p>You have unsaved changes</p>` needs no
        // library at all. The provider takes its dialog as a *prop* precisely so
        // the sentence lives at the call site.
        //
        // Read with TypeScript's own parser rather than a regex: `>` opens a
        // generic and closes a comparison as often as it closes a tag, and a
        // pattern loose enough to find real JSX text in this file also matched
        // half a `useState` call.
        const texts: string[] = [];
        for (const file of [...ADMIN_SOURCES, ...SERVER_SOURCES]) {
            if (!file.endsWith('.tsx') || isSpec(file)) continue;
            const parsed = ts.createSourceFile(
                file,
                read(file),
                ts.ScriptTarget.Latest,
                true,
                ts.ScriptKind.TSX
            );
            const visit = (node: ts.Node) => {
                if (ts.isJsxText(node) && node.getText().trim() !== '') {
                    texts.push(`${rel(file)}: ${node.getText().trim()}`);
                }
                ts.forEachChild(node, visit);
            };
            visit(parsed);
        }

        expect(texts).toEqual([]);
    });
});

describe('what the leaf does not own', () => {
    it('ships no schema and no migrations [utils:I-03]', () => {
        for (const dir of [ADMIN, SERVER]) {
            expect(existsSync(join(dir, 'drizzle.config.ts'))).toBe(false);
            expect(existsSync(join(dir, 'migrations'))).toBe(false);
        }

        // `pgTable` is how a table is declared in this repo; the filter engine
        // reads whatever table its *caller* hands it, and owning one would give
        // the leaf a migration set and a place in the host's migrate step.
        // Specs excluded: the filter engine's own tests declare throwaway
        // tables to translate against, which is the opposite of owning one —
        // the engine reads whatever table its *caller* hands it.
        const declarers = [...ADMIN_SOURCES, ...SERVER_SOURCES]
            .filter((file) => !isSpec(file))
            .filter((file) => /\bpgTable\s*\(|\bpgSchema\s*\(/.test(read(file)))
            .map(rel);
        expect(declarers).toEqual([]);
    });

    it('mounts no route and defines no permission [utils:I-03]', () => {
        const ROUTING =
            /@(Controller|Get|Post|Put|Patch|Delete|All|Sse)\s*\(|@(Module|RequirePermissions)\s*\(/;
        const routers = [...ADMIN_SOURCES, ...SERVER_SOURCES]
            .filter((file) => ROUTING.test(withoutComments(read(file))))
            .map(rel);

        // A leaf both hosts import cannot also be a Nest module: it would be
        // mounted once per importer, and its permission keys would have to be
        // seeded by whichever plugin happened to load first.
        expect(routers).toEqual([]);
    });
});

describe('one axios per application', () => {
    /** Every `.ts`/`.tsx` file in the workspace's own code. */
    const workspaceSources = [
        ...sources(join(REPO, 'packages')),
        ...sources(join(REPO, 'apps'))
    ];

    /**
     * The two modules that *are* the transport. `apiClient` constructs the one
     * instance; `apiError` needs `isAxiosError` to unwrap what that instance
     * throws.
     */
    const TRANSPORT = [
        'packages/utils/admin/src/lib/apiClient/index.ts',
        'packages/utils/admin/src/lib/apiError/index.ts'
    ];

    it('is imported by nothing but the transport itself [utils:I-04]', () => {
        const importers = workspaceSources
            .filter((file) => importsOf(read(file)).includes('axios'))
            .map(rel)
            // A spec constructing an `AxiosError` fixture is not a request to
            // an API, and both of this package's own transport specs do it.
            .filter((file) => !isSpec(file))
            .filter((file) => !TRANSPORT.includes(file));

        // One import is all it takes: a plugin's own instance has no `/api`
        // base URL, no `withCredentials`, no `X-Workspace-Id` — so it reads the
        // wrong workspace's rows — and no 401 handler, so a dead session shows
        // as a broken page instead of a redirect to sign-in.
        expect(importers).toEqual([]);
    });

    it('is created exactly once, in apiClient [utils:I-04]', () => {
        const creators = workspaceSources
            .filter((file) => /\baxios\s*\.\s*create\s*\(/.test(read(file)))
            .map(rel);

        expect(creators).toEqual([
            'packages/utils/admin/src/lib/apiClient/index.ts'
        ]);
    });

    it('is declared as a dependency by that package alone [utils:I-04]', () => {
        // Walk the manifests rather than the sources: a package that declares
        // axios has announced an intention to use it, and the declaration is
        // what survives a `npm install` in a generated app.
        const declaring: string[] = [];
        const scan = (dir: string) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name))
                    continue;
                const full = join(dir, entry.name);
                if (entry.isDirectory()) scan(full);
                else if (entry.name === 'package.json') {
                    const manifest = JSON.parse(read(full));
                    const deps = {
                        ...manifest.dependencies,
                        ...manifest.peerDependencies
                    };
                    if ('axios' in deps) declaring.push(rel(full));
                }
            }
        };
        for (const root of ['packages', 'apps']) scan(join(REPO, root));

        expect(declaring).toEqual(['packages/utils/admin/package.json']);
    });
});
