import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The kernel's one hard rule, read off the files rather than left to review.
 *
 * `transfer-domain` exists so the document contract, the four formats and the
 * natural-key rules can be exercised without a container, a browser or a
 * running server — and that property is not something a type-checker defends.
 * The violation is always a one-line convenience: an `@Injectable()` to make a
 * value object injectable, an `eq()` reached for while writing a lookup, a
 * `new Date()` to stamp something. Each compiles, passes every other test, and
 * quietly welds the kernel to a runtime.
 *
 * **Framework-free, not dependency-free.** The package legitimately imports
 * `@orthacms/content-domain` — the field-type vocabulary and the rich-text
 * helpers the CSV flattener runs on — and that is its *only* dependency, which
 * is the second half of what is asserted here.
 *
 * On the clock: `new Date(0)` in `csv-format.ts` is the synthesised manifest's
 * `exportedAt`, deliberately the epoch because a flat table carries no export
 * time. That is the opposite of reading a clock, and it is why the check below
 * looks for `Date.now()` and a zero-argument `new Date()` rather than for the
 * word "Date".
 */
describe('transfer-domain is a framework-free kernel', () => {
    const SRC = join(__dirname, '..');

    /** Every non-spec `.ts` file under `src/`, recursively. */
    function sourceFiles(dir: string = SRC): string[] {
        return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) return sourceFiles(path);
            if (
                !entry.name.endsWith('.ts') ||
                entry.name.endsWith('.spec.ts')
            ) {
                return [];
            }
            return [path];
        });
    }

    /** The module specifiers a file imports or re-exports from. */
    function specifiersOf(path: string): string[] {
        const source = readFileSync(path, 'utf8');
        return [...source.matchAll(/from\s+'([^']+)'/g)].map(
            (match) => match[1]
        );
    }

    const FILES = sourceFiles();

    /** The forbidden neighbours, as `[label, predicate]`. */
    const FORBIDDEN: [string, (specifier: string) => boolean][] = [
        ['@nestjs/*', (spec) => spec.startsWith('@nestjs/')],
        ['drizzle-orm', (spec) => spec.split('/')[0] === 'drizzle-orm'],
        ['react', (spec) => spec === 'react' || spec.startsWith('react/')],
        ['react-intl', (spec) => spec === 'react-intl'],
        ['class-validator', (spec) => spec === 'class-validator'],
        ['a database package', (spec) => spec === '@orthacms/database'],
        ['a node built-in', (spec) => spec.startsWith('node:')]
    ];

    it('found the kernel sources to check', () => {
        // A recursion that silently matched nothing would make every case
        // below pass without reading a line of code.
        expect(FILES.length).toBeGreaterThan(10);
        for (const expected of [
            'transfer-document.ts',
            'natural-key.ts',
            'csv-format.ts',
            'zip-format.ts',
            'id-map.ts'
        ]) {
            expect(FILES.some((path) => path.endsWith(expected))).toBe(true);
        }
    });

    // covers: transfer:I-37
    it.each(FORBIDDEN)('imports nothing from %s', (_label, forbidden) => {
        const offenders = FILES.filter((path) =>
            specifiersOf(path).some(forbidden)
        ).map((path) => path.slice(SRC.length + 1));

        expect(offenders).toEqual([]);
    });

    it('depends on @orthacms/content-domain and on nothing else [transfer:I-37]', () => {
        const external = new Set<string>();
        for (const path of FILES) {
            for (const spec of specifiersOf(path)) {
                if (spec.startsWith('.')) continue;
                // The package name: `@scope/name` or `name`.
                const parts = spec.split('/');
                external.add(
                    spec.startsWith('@')
                        ? parts.slice(0, 2).join('/')
                        : parts[0]
                );
            }
        }

        expect([...external].sort()).toEqual(['@orthacms/content-domain']);
    });

    it('declares that single dependency in its manifest too', () => {
        // The import scan above reads the code; this reads the promise. A
        // dependency added to package.json and not yet used is the step before
        // the import, and it is where the drift starts.
        const manifest = JSON.parse(
            readFileSync(join(SRC, '..', 'package.json'), 'utf8')
        ) as { dependencies?: Record<string, string> };

        expect(Object.keys(manifest.dependencies ?? {})).toEqual([
            '@orthacms/content-domain'
        ]);
    });

    it('reads no clock [transfer:I-37]', () => {
        // `new Date(0)` — the epoch stamp on a synthesised CSV manifest — is
        // deliberately not a clock read and is not matched here.
        const offenders = FILES.filter((path) => {
            const source = readFileSync(path, 'utf8');
            return (
                /\bDate\.now\s*\(/.test(source) ||
                /\bnew\s+Date\s*\(\s*\)/.test(source) ||
                /\bperformance\.now\s*\(/.test(source)
            );
        }).map((path) => path.slice(SRC.length + 1));

        expect(offenders).toEqual([]);
    });

    it('still uses the fixed epoch stamp the clock rule spares', () => {
        // Guards the exemption above: if `new Date(0)` ever disappeared, the
        // clock check would keep passing while meaning less than it says.
        const csvFormat = readFileSync(
            join(SRC, 'lib', 'formats', 'csv-format.ts'),
            'utf8'
        );

        expect(csvFormat).toContain('new Date(0)');
    });
});
