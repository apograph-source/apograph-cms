import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as schema from './schema';

/**
 * The two claims about this package that are made of *absences*, and are
 * therefore invisible to every test that drives it.
 *
 * A package that quietly opened a second pool, or a caller that started writing
 * through the deprecated recorder again, would break nothing an e2e run can
 * see: the rows would still appear, the routes would still answer, and the
 * audit trail would have acquired a second writer nobody knew about. The only
 * observable is the source tree, so this reads it — the same technique
 * `audit-event-mapping.spec.ts` uses to compare the admin's catalogue and the
 * producers' event kinds, and for the same reason.
 *
 * Every scan below is guarded against reading nothing: a walk that finds no
 * files, or a pattern a refactor has defeated, fails here rather than passing
 * vacuously.
 */

/** The repository root, from `packages/activity/server/src/lib`. */
const REPO = join(__dirname, '../../../../..');

/** This package's own sources. */
const PACKAGE_SRC = join(__dirname, '..');

/** Directory names a source walk never descends into. */
const SKIP_DIRS = new Set([
    'node_modules',
    'dist',
    'out-tsc',
    'test-output',
    'migrations'
]);

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
 * Comment lines are dropped, and that is load-bearing rather than tidiness:
 * this package documents the deprecated write path at length, so
 * `audit-event-mapping.ts` and `activity.service.ts` both name
 * `recorder.record(...)` and `ACTIVITY_RECORDER` in prose. Counting those as
 * callers would make the check below either permanently red or permanently
 * allow-listed into uselessness.
 *
 * The filter is line-based (a line whose first non-space character opens or
 * continues a comment), which is exact for this repo's Prettier style and
 * cannot hide a real call: a statement never starts with `*` or `//`.
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
            out.push({ file: relative(REPO, file), line: index + 1, text });
        }
    }
    return out;
}

/** `path:line` for the assertion messages — the point of failing is to say where. */
const at = (hit: { file: string; line: number }) => `${hit.file}:${hit.line}`;

describe('the shape of @orthacms/activity-server', () => {
    describe('one writer, and it is the subscriber', () => {
        /** Every production source in the repository, tests excluded. */
        const REPO_CODE = codeLines([
            ...sourceFiles(join(REPO, 'packages')),
            ...sourceFiles(join(REPO, 'apps'))
        ]);

        it('reads the repository at all', () => {
            // The guard on the guard. A walk that skipped everything would pass
            // all three checks below while proving nothing about any of them.
            expect(REPO_CODE.length).toBeGreaterThan(20000);
        });

        it('has no caller left holding the deprecated recorder [activity:I-02]', () => {
            /**
             * The three places the token may legitimately appear: identity
             * declares it and re-exports it, and this package binds it. Every
             * other mention in code is somebody obtaining a writer.
             */
            const DECLARERS = [
                'packages/identity/server/src/lib/activity/activity-recorder.ts',
                'packages/identity/server/src/index.ts',
                'packages/activity/server/src/lib/activity.module.ts'
            ];

            const holders = REPO_CODE.filter(
                (hit) =>
                    /\bACTIVITY_RECORDER\b/.test(hit.text) &&
                    !DECLARERS.includes(hit.file)
            );

            expect(holders.map(at)).toEqual([]);
        });

        it('has no caller reaching for the concrete service either [activity:I-02]', () => {
            // The other route to the same `record`: skip the token and inject
            // `ActivityService`, which the module exports. Nothing outside this
            // package may name it.
            const importers = REPO_CODE.filter(
                (hit) =>
                    // Word-bounded: `EntryActivityService` in another package
                    // is a different class, and a scan that flagged it would be
                    // allow-listed into uselessness within a release.
                    /\bActivityService\b/.test(hit.text) &&
                    !hit.file.startsWith('packages/activity/server/src/')
            );

            expect(importers.map(at)).toEqual([]);
        });

        it('inserts an audit row from exactly two places, one of them dead [activity:I-02]', () => {
            const writers = codeLines(sourceFiles(PACKAGE_SRC))
                .filter((hit) => hit.text.includes('.insert(activityEvents)'))
                .map((hit) => hit.file);

            // The subscriber is the live one; the service's is the retained
            // `record`, which the two checks above prove has no caller. A third
            // entry here is a write path nobody has reviewed.
            expect(writers.sort()).toEqual([
                'packages/activity/server/src/lib/activity/infrastructure/audit-event.subscriber.ts',
                'packages/activity/server/src/lib/activity/services/activity.service.ts'
            ]);
        });

        it('holds no statement that changes or removes a row [activity:I-01]', () => {
            // The other half of "append-only". `activity-coverage.spec.ts`
            // proves the *routes* refuse every verb but GET, which says nothing
            // about the package's own code: a background job, a repair path or a
            // retention sweep would leave every one of those 404s intact while
            // rewriting the trail. There is no such code, and this is what says
            // so — the append-only claim is about the package, not the router.
            //
            // Runtime code only: `migrations/0001` back-fills `actor_type` on
            // rows written before the column existed, which is a schema change a
            // human reviewed rather than a write path the server can take.
            const mutations = codeLines(sourceFiles(PACKAGE_SRC)).filter(
                (hit) =>
                    /\.update\(activityEvents\)|\.delete\(activityEvents\)/.test(
                        hit.text
                    ) ||
                    /(?:UPDATE|DELETE FROM)\s+activity_events/i.test(hit.text)
            );

            expect(mutations.map(at)).toEqual([]);
        });

        it('marks both retained surfaces @deprecated [activity:I-02]', () => {
            // Read as "the doc block that ends at this declaration", which is
            // what a reader and an IDE both see. Retaining the surface without
            // the marking is how a deprecated writer acquires a new caller.
            const service = readFileSync(
                join(PACKAGE_SRC, 'lib/activity/services/activity.service.ts'),
                'utf8'
            );
            expect(
                service.split('async record(')[0].split('/**').pop()
            ).toContain('@deprecated');

            const port = readFileSync(
                join(
                    REPO,
                    'packages/identity/server/src/lib/activity/activity-recorder.ts'
                ),
                'utf8'
            );
            expect(
                port
                    .split('export const ACTIVITY_RECORDER')[0]
                    .split('/**')
                    .pop()
            ).toContain('@deprecated');
        });
    });

    describe('no connection of its own, and one table [activity:I-23]', () => {
        const PACKAGE_CODE = codeLines(sourceFiles(PACKAGE_SRC));

        it('reads the package at all', () => {
            expect(PACKAGE_CODE.length).toBeGreaterThan(500);
        });

        it('opens no client, pool or Drizzle instance [activity:I-23]', () => {
            // The ways a package can acquire a connection instead of being
            // handed one: build a Drizzle instance, build a pg client, or take
            // the database plugin's module-scoped accessors. `@InjectDatabase()`
            // — asserted below — is the only sanctioned route.
            const OPENERS = [
                'drizzle(',
                'new Pool(',
                'new Client(',
                'getDatabase(',
                'getPool(',
                'DatabasePlugin('
            ];
            const hits = PACKAGE_CODE.filter((hit) =>
                OPENERS.some((opener) => hit.text.includes(opener))
            );

            expect(hits.map(at)).toEqual([]);
        });

        it('takes the host’s client through DI instead [activity:I-23]', () => {
            // The complement: "no opener" would also be true of a package that
            // touches no database at all, which would make the check above
            // unfalsifiable by anything anyone would actually write.
            const injections = PACKAGE_CODE.filter((hit) =>
                hit.text.includes('@InjectDatabase()')
            );
            expect(injections.length).toBeGreaterThan(0);
        });

        it('declares exactly one table [activity:I-23]', () => {
            expect(Object.keys(schema)).toEqual(['activityEvents']);

            const tables = PACKAGE_CODE.filter((hit) =>
                hit.text.includes('pgTable(')
            );
            expect(tables.map(at)).toHaveLength(1);
        });

        it('ships migrations that touch no other table [activity:I-23]', () => {
            const dir = join(PACKAGE_SRC, '../migrations');
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

            // A migration is the one place this package could grow a second
            // table without a line of TypeScript changing — the schema module
            // above would still export one name.
            expect([...touched]).toEqual(['activity_events']);
        });
    });
});
