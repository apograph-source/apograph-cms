import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Two boundary rules the compiler cannot hold, read off the sources.
 *
 * Both are the kind that regress by convenience rather than by decision: an
 * `eq()` and a `db.update()` reached for while fixing an import bug, an
 * `import { LOCALE_HEADER } from '@orthacms/i18n-server'` because the constant
 * was right there. Each compiles and passes every other test.
 */

/** `packages/transfer`. */
const GROUP_ROOT = join(__dirname, '..', '..', '..');
/** `packages/transfer/server`. */
const SERVER_ROOT = join(GROUP_ROOT, 'server');

/** Every non-spec `.ts`/`.tsx` under a directory, recursively. */
function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        if (!/\.tsx?$/.test(entry.name) || /\.spec\.tsx?$/.test(entry.name)) {
            return [];
        }
        return [path];
    });
}

describe('every content write goes through EntryWriterService', () => {
    const FILES = sourceFiles(join(SERVER_ROOT, 'src'));

    /**
     * Mutating query-builder calls, as `method(argument)` strings.
     *
     * Matched on the receiver as well as the method, because `crc.update(...)`
     * in the ZIP writer is not a database write and a bare `/\.update\(/` would
     * say it was.
     */
    function mutationsIn(path: string): string[] {
        const source = readFileSync(path, 'utf8');
        return [
            ...source.matchAll(
                /\b(?:this\.db|db|tx|trx|transaction)\.(insert|update|delete)\s*\(\s*([A-Za-z0-9_.]+)/g
            )
        ].map((match) => `${match[1]}(${match[2]})`);
    }

    it('found the plugin sources to check', () => {
        expect(FILES.length).toBeGreaterThan(10);
        expect(
            FILES.some((path) => path.endsWith('import-entries.use-case.ts'))
        ).toBe(true);
    });

    it('makes no direct write to a content table [transfer:I-02]', () => {
        // The one mutating query in the whole plugin is the media rollback:
        // `db.delete(mediaAsset)`, undoing blobs an aborted import uploaded
        // (storage cannot join the transaction, so that bookkeeping cannot go
        // through a writer either). Everything about *content* — creating an
        // entry, overwriting its values, setting its links — goes through
        // `EntryWriterService`, where field validation, the workspace scope,
        // the relation-target checks, the same-locale rule, revisions, the
        // outbox and the bound i18n extension live. A direct insert here would
        // be a supported way to write rows none of those rules ever saw.
        const mutations = FILES.flatMap(mutationsIn).sort();

        expect(mutations).toEqual(['delete(mediaAsset)']);
    });

    it('does write content, through the writer — the scan above is over live code [transfer:I-02]', () => {
        // Guards the emptiness above: a plugin that wrote nothing at all would
        // also make no direct write, and would prove nothing by it.
        const importUseCase = readFileSync(
            join(
                SERVER_ROOT,
                'src/lib/import/application/import-entries.use-case.ts'
            ),
            'utf8'
        );

        expect(importUseCase).toMatch(/this\.writer\.create\(/);
        expect(importUseCase).toMatch(/this\.writer\.update\(/);
    });
});

describe('transfer does not depend on the i18n plugin [transfer:I-21]', () => {
    const PACKAGES = ['domain', 'server', 'admin'];

    it.each(PACKAGES)('%s imports nothing from @orthacms/i18n-*', (name) => {
        // `locale` and `locale_group_id` are envelope columns `content/server`
        // defines for any `i18n: true` type, and the walk asks "the other rows
        // of this record" generically. Reaching into the i18n plugin for a
        // locale rule would make a transfer stop working on an installation
        // that has no locales — the common case.
        const offenders = sourceFiles(join(GROUP_ROOT, name, 'src'))
            .filter((path) =>
                /from\s+'@orthacms\/i18n-/.test(readFileSync(path, 'utf8'))
            )
            .map((path) => path.slice(GROUP_ROOT.length + 1));

        expect(offenders).toEqual([]);
    });

    it.each(PACKAGES)('%s declares no i18n dependency either', (name) => {
        const manifest = JSON.parse(
            readFileSync(join(GROUP_ROOT, name, 'package.json'), 'utf8')
        ) as {
            dependencies?: Record<string, string>;
            peerDependencies?: Record<string, string>;
        };
        const declared = [
            ...Object.keys(manifest.dependencies ?? {}),
            ...Object.keys(manifest.peerDependencies ?? {})
        ];

        expect(
            declared.filter((name) => name.startsWith('@orthacms/i18n'))
        ).toEqual([]);
    });

    it('does read the envelope columns the locale travels in', () => {
        // The other half of the claim: the locale is handled, just not by
        // asking the i18n plugin. Without this, deleting every mention of
        // locales would make the two cases above pass more easily.
        const walker = readFileSync(
            join(
                SERVER_ROOT,
                'src/lib/export/infrastructure/entry-graph.walker.ts'
            ),
            'utf8'
        );

        expect(walker).toContain('locale_group_id');
    });
});
