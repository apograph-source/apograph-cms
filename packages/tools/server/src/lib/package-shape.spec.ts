import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The claim this package makes about itself that is made entirely of
 * **absences**, and is therefore invisible to every test that drives it.
 *
 * `tools/server` is the transport-neutral seam: the contract a tool is written
 * against and the one place a call is authorized. Two consumers import it — the
 * MCP endpoint and the copilot's run loop — and the whole reason it was lifted
 * out of `mcp/server` is that a deployment wanting only the copilot must not
 * pull `@modelcontextprotocol/sdk` through this barrel
 * ([ADR-0007](../../../../docs/adr/0007-one-tool-registry-two-surfaces.md)).
 * That reason is only worth anything while the dependency really is absent, and
 * nothing that exercises the registry can tell: a `drizzle-orm` import, a table,
 * or a vendor SDK would leave all 27 registry cases green.
 *
 * So the observable is the source tree, and this reads it — the same technique
 * `packages/activity/server/src/lib/package-shape.spec.ts` uses, for the same
 * reason.
 *
 * The import check is an **allow-list**, not a list of banned modules. The
 * package is seven files deep and has exactly two dependencies; a deny-list
 * would only ever catch the vendor whose name somebody remembered to add, while
 * an allow-list turns "this package grew a dependency" into a decision someone
 * has to write down here. Every scan is guarded against reading nothing.
 */

/** The package root, from `packages/tools/server/src/lib`. */
const PACKAGE_ROOT = join(__dirname, '../..');

/** This package's own sources. */
const PACKAGE_SRC = join(PACKAGE_ROOT, 'src');

/** The repository root, for readable failure messages. */
const REPO = join(PACKAGE_ROOT, '../../..');

/**
 * Build output, not source. `dist/` and `out-tsc/` hold compiled copies of the
 * very files below; walking them would double every hit and, worse, would let a
 * stale build keep a check green after the source it came from changed.
 */
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
            } else if (
                /\.tsx?$/.test(entry.name) &&
                !/\.spec\.tsx?$/.test(entry.name)
            ) {
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
 * Dropping comment lines is load-bearing rather than tidiness: `src/index.ts`
 * explains at length why this package does not depend on
 * `@modelcontextprotocol/sdk`, and `tool.ts` discusses MCP throughout. A scan
 * that counted prose would be permanently red, and the fix for a permanently
 * red scan is to delete it.
 *
 * The filter is line-based (a line whose first non-space character opens or
 * continues a comment), which is exact for this repo's Prettier style and
 * cannot hide a real import: a statement never starts with `*` or `//`.
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

const SOURCES = sourceFiles(PACKAGE_SRC);
const CODE = codeLines(SOURCES);

const MANIFEST = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')
) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
};

describe('the shape of @ortha/tools-server [tools:I-24]', () => {
    it('reads the package at all', () => {
        // The guard on the guard. A walk that found nothing — a renamed
        // directory, a changed extension — would pass every check below while
        // proving nothing about any of them.
        expect(SOURCES.length).toBeGreaterThanOrEqual(8);
        expect(CODE.length).toBeGreaterThan(200);
    });

    describe('imports nothing but the contract it is written against', () => {
        /**
         * The only two packages this one may name. Compared **sorted** at both
         * call sites below rather than in a fixed order: the scope's own name
         * decides where it lands alphabetically, so a literal order would be a
         * second thing to remember on a rename.
         */
        const ALLOWED = ['@nestjs/common', '@ortha/identity-server'];

        /**
         * Every module specifier the package's own code imports or re-exports,
         * relative paths excluded.
         *
         * Matches `import … from 'x'`, `export … from 'x'`, bare `import 'x'`,
         * `import type`, and dynamic `import('x')`/`require('x')`.
         */
        const externalImports = (): {
            file: string;
            line: number;
            module: string;
        }[] => {
            const out: { file: string; line: number; module: string }[] = [];
            for (const hit of CODE) {
                for (const [, quoted] of hit.text.matchAll(
                    /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g
                )) {
                    if (quoted.startsWith('.')) {
                        continue;
                    }
                    out.push({ ...hit, module: quoted });
                }
            }
            return out;
        };

        it('finds the imports it is about to judge', () => {
            // Without this, a regex a refactor has defeated reports an empty
            // set — which is exactly what "imports nothing forbidden" looks
            // like.
            expect(externalImports().length).toBeGreaterThanOrEqual(4);
        });

        it('names exactly two packages, and neither is a database or an SDK [tools:I-24]', () => {
            /**
             * The whole allowed surface:
             *
             * - `@nestjs/common` — `@Injectable`/`@Global` and the HTTP
             *   exception classes refusals are signalled with. Nest is the DI
             *   container both consumers already run in, not a transport.
             * - `@ortha/identity-server` — `PermissionKey` and
             *   `PERMISSION_KEYS`. The package keeps no dictionary of its own,
             *   which is the point of I-04's neighbour: rights are named by
             *   identity and *resolved* by whoever authenticated the caller.
             *
             * Adding a third is a decision, and it is made here.
             */
            const foreign = externalImports().filter(
                (hit) => !ALLOWED.includes(hit.module)
            );

            expect(foreign.map((hit) => `${at(hit)} → ${hit.module}`)).toEqual(
                []
            );
            expect(
                [...new Set(externalImports().map((hit) => hit.module))].sort()
            ).toEqual([...ALLOWED].sort());
        });

        it('declares the same two in its manifest, and nothing else [tools:I-24]', () => {
            // The import scan cannot see a dependency that is declared and not
            // yet used — and a manifest is what a consumer installs. A
            // `drizzle-orm` here would reach every deployment that runs the
            // copilot whether or not a line of code imported it.
            expect(Object.keys(MANIFEST.dependencies ?? {}).sort()).toEqual(
                [...ALLOWED].sort()
            );
            expect(MANIFEST.peerDependencies ?? {}).toEqual({});
            expect(MANIFEST.devDependencies ?? {}).toEqual({});
        });

        it('mentions no vendor SDK or driver anywhere in its code [tools:I-24]', () => {
            // A second net under the allow-list, catching the routes an import
            // specifier does not travel: a `require` assembled at runtime, a
            // type reference through a global, a re-export path. Redundant
            // today and cheap; the named modules are the ones ADR-0007 says
            // must not arrive through this barrel.
            const FORBIDDEN =
                /@modelcontextprotocol|@anthropic-ai|\bopenai\b|drizzle-orm|drizzle-kit|\bfrom\s+['"]pg['"]|\bnew Pool\(|\bnew Client\(|\bgetDatabase\(|\bgetPool\(/i;

            const hits = CODE.filter((hit) => FORBIDDEN.test(hit.text));

            expect(hits.map(at)).toEqual([]);
        });
    });

    describe('owns no table and ships no migrations', () => {
        it('declares no schema and no table [tools:I-24]', () => {
            const tables = CODE.filter(
                (hit) =>
                    hit.text.includes('pgTable(') ||
                    /\bCREATE TABLE\b/i.test(hit.text)
            );
            expect(tables.map(at)).toEqual([]);

            // The other half of "owns no table": there is no schema module for
            // a table to be declared in, and no barrel exporting one.
            expect(
                SOURCES.map((file) => relative(PACKAGE_SRC, file)).filter(
                    (name) => /(^|\/)schema(\.ts|\/)/.test(name)
                )
            ).toEqual([]);
        });

        it('has no drizzle config and no migrations directory [tools:I-24]', () => {
            // How a plugin ships migrations in this repo: a `drizzle.config.ts`
            // at the package root makes `db:generate` infer onto the project,
            // and the emitted SQL is committed beside it for the host to apply.
            // Neither exists, which is what "ships no migrations" means
            // operationally — there is nothing for `server:db:migrate` to run.
            expect(existsSync(join(PACKAGE_ROOT, 'drizzle.config.ts'))).toBe(
                false
            );
            expect(existsSync(join(PACKAGE_ROOT, 'migrations'))).toBe(false);

            // And nothing is published from outside `src/`, so a migrations
            // directory could not reach an installed app even if one appeared.
            const manifest = JSON.parse(
                readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')
            ) as { files?: string[] };
            expect(manifest.files).toEqual(['src']);
        });
    });
});
