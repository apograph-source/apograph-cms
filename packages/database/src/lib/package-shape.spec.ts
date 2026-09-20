import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as schema from './schema';

/**
 * The two claims this package makes about *itself* rather than about anything
 * it does — and which are therefore invisible to every test that drives it.
 *
 * A second table appearing here, or a `domain/` folder, breaks nothing an e2e
 * run can observe: the pool would still open, the outbox would still drain,
 * every route would still answer. The dossier is explicit that both would be a
 * change of architectural decision rather than a routine edit — "a `domain/`
 * folder appearing here would mean the subject area had leaked into the
 * infrastructure, and it should be reverted". The only observable is the source
 * tree, so this reads it, the same way
 * `packages/activity/server/src/lib/package-shape.spec.ts` does.
 *
 * Every scan below is guarded against reading nothing: a walk that finds no
 * files, or a pattern a refactor has defeated, fails here rather than passing
 * vacuously.
 */

/** This package's own sources, from `packages/database/src/lib`. */
const PACKAGE_SRC = join(__dirname, '..');

/** The package root — where `migrations/` and `drizzle.config.ts` live. */
const PACKAGE_ROOT = join(__dirname, '../..');

/** Directory names a source walk never descends into. */
const SKIP_DIRS = new Set([
    'node_modules',
    'dist',
    'out-tsc',
    'test-output',
    'migrations'
]);

/** Every directory under `root`, as repo-relative paths. */
function sourceDirs(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (
                !entry.isDirectory() ||
                entry.name.startsWith('.') ||
                SKIP_DIRS.has(entry.name)
            ) {
                continue;
            }
            const path = join(dir, entry.name);
            out.push(path);
            walk(path);
        }
    };
    walk(root);
    return out;
}

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
 * Comment lines are dropped, and that is load-bearing rather than tidiness:
 * this package documents its own shape at length — `outbox-events.ts` names
 * `pgTable` in prose, and the dispatcher's doc blocks quote the dead-letter
 * SQL. Counting those would make the checks below permanently red.
 *
 * The filter is line-based (a line whose first non-space character opens or
 * continues a comment), which is exact for this repo's Prettier style and
 * cannot hide a real declaration: a statement never starts with `*` or `//`.
 */
function codeLines(
    files: string[]
): { file: string; line: number; text: string }[] {
    const out: { file: string; line: number; text: string }[] = [];
    for (const file of files) {
        const lines = readFileSync(file, 'utf8').split('\n');
        for (const [index, text] of lines.entries()) {
            const trimmed = text.trimStart();
            if (
                trimmed.startsWith('*') ||
                trimmed.startsWith('//') ||
                trimmed.startsWith('/*')
            ) {
                continue;
            }
            out.push({
                file: relative(PACKAGE_ROOT, file),
                line: index + 1,
                text
            });
        }
    }
    return out;
}

describe('the shape of @orthacms/database', () => {
    const PACKAGE_CODE = codeLines(sourceFiles(PACKAGE_SRC));

    it('reads the package at all', () => {
        // The guard on the guards. A walk that skipped everything would pass
        // every check below while proving nothing about any of them.
        expect(PACKAGE_CODE.length).toBeGreaterThan(500);
    });

    describe('exactly one table [database:I-23]', () => {
        it('exports one name from the schema barrel [database:I-23]', () => {
            // The barrel is what every other package imports and what the
            // migrations descriptor points drizzle-kit at. A second table would
            // have to appear here to be reachable at all.
            expect(Object.keys(schema)).toEqual(['outboxEvents']);
        });

        it('declares one table in the whole package [database:I-23]', () => {
            // The barrel could re-export one name while the package declared
            // three; `pgTable(` is the declaration itself.
            const tables = PACKAGE_CODE.filter((hit) =>
                hit.text.includes('pgTable(')
            );

            expect(tables.map((hit) => hit.file)).toEqual([
                'src/lib/schema/outbox-events.ts'
            ]);
        });

        it('names outbox_events and nothing else [database:I-23]', () => {
            // The name matters as much as the count: this is the *sanctioned
            // exception* to "the database plugin owns no schema", and it is
            // sanctioned for one table by name.
            const source = readFileSync(
                join(PACKAGE_SRC, 'lib/schema/outbox-events.ts'),
                'utf8'
            );

            expect(
                [...source.matchAll(/pgTable\(\s*'([^']+)'/g)].map(
                    ([, name]) => name
                )
            ).toEqual(['outbox_events']);
        });

        it('ships migrations that touch no other table [database:I-23]', () => {
            // A migration is the one place this package could grow a second
            // table without a line of TypeScript changing — the schema module
            // above would still export one name, and the running server would
            // still behave identically.
            const dir = join(PACKAGE_ROOT, 'migrations');
            const files = readdirSync(dir).filter((name) =>
                name.endsWith('.sql')
            );
            expect(files.length).toBeGreaterThan(0);

            const touched = new Set<string>();
            for (const name of files) {
                const sql = readFileSync(join(dir, name), 'utf8');
                for (const [, table] of sql.matchAll(
                    /(?:CREATE TABLE|ALTER TABLE|DROP TABLE|UPDATE)\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/gi
                )) {
                    touched.add(table);
                }
            }

            expect([...touched].sort()).toEqual(['outbox_events']);
        });
    });

    describe('no domain layer, by construction [database:I-24]', () => {
        const DIRS = sourceDirs(PACKAGE_SRC).map((dir) =>
            relative(PACKAGE_SRC, dir)
        );

        it('reads the source tree at all', () => {
            // Guards the two checks below: an empty walk would satisfy both.
            // These are the infrastructure modules the package is made of, and
            // finding them is what proves the walk descended.
            expect(DIRS.sort()).toEqual([
                'lib',
                'lib/events',
                'lib/outbox',
                'lib/schema',
                'lib/types',
                'lib/uow',
                'lib/utils'
            ]);
        });

        it('has no ADR-0003 layer folder anywhere under src [database:I-24]', () => {
            // ADR-0003 lays out `domain / application / infrastructure` for the
            // plugins that model a subject area. This package models none — it
            // is the machinery those layers are built on — so the dossier is
            // categorical: "there are no layers here by definition". A folder
            // by one of these names is the leak, whatever it holds.
            const layers = DIRS.filter((dir) =>
                /(^|\/)(domain|application|infrastructure|presentation)$/.test(
                    dir
                )
            );

            expect(layers).toEqual([]);
        });

        it('holds no aggregate, repository port or mapper either [database:I-24]', () => {
            // The other route to the same leak: the vocabulary without the
            // folder. ADR-0003's building blocks are named by convention in
            // this repo, so a file that carries one of those suffixes is a
            // domain model however it is filed.
            const files = sourceFiles(PACKAGE_SRC).map((file) =>
                relative(PACKAGE_SRC, file)
            );
            expect(files.length).toBeGreaterThan(5);

            const domainish = files.filter((file) =>
                /\.(aggregate|value-object|repository|mapper|use-case)\.ts$/.test(
                    file
                )
            );

            expect(domainish).toEqual([]);
        });

        it('keeps the event envelope free of every framework [database:I-24]', () => {
            // The complement, and the reason the rule is not merely tidiness:
            // ADR-0003 lets an aggregate in someone else's `domain/` import
            // `DomainEvent`, which is only legal while this file imports no
            // framework. It is the one file here held to the domain rule, and
            // it is held to it precisely because there is no `domain/` to put
            // it in.
            const envelope = readFileSync(
                join(PACKAGE_SRC, 'lib/events/domain-event.ts'),
                'utf8'
            );

            const imports = [...envelope.matchAll(/from\s+'([^']+)'/g)].map(
                ([, specifier]) => specifier
            );

            expect(imports.length).toBeGreaterThan(0);
            expect(
                imports.filter((specifier) =>
                    /^(@nestjs|drizzle-orm|pg|react)/.test(specifier)
                )
            ).toEqual([]);
        });
    });
});
