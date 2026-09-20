import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ADR-0003's one hard rule for this package, read off the files rather than
 * left to review — the dossier's §14 says in as many words that it is "upheld
 * by review alone", and it was not: `domain/asset.ts` imported
 * `StoredMediaTrack` out of `infrastructure/schema/media-asset.ts`, so the
 * aggregate could not be read without the Drizzle table it is stored in. The
 * types now live in `domain/value-objects/media-track` and the schema
 * re-exports them, which is the dependency the right way round.
 *
 * `domain/` must import nothing from `@nestjs/*`, `drizzle-orm`,
 * `class-validator`, or `../infrastructure`. The `@orthacms/nx` layer-boundary
 * lint is not wired up, and the violation is always a one-line convenience —
 * an `@Injectable()` to make a value object injectable, a persistence type
 * borrowed because it happened to have the right fields — that compiles,
 * passes every test, and quietly welds the aggregate to a framework or a table.
 *
 * A **type-only** import is not an exception. It leaves no trace at runtime,
 * which is exactly why it survives: nothing fails, and the layer is welded
 * anyway the moment someone tries to move it.
 *
 * **The accurate claim is "framework-free", not "dependency-free."** `domain/`
 * *does* import `@orthacms/database`, for the framework-free `DomainEvent` /
 * `createDomainEvent` contract (`events/media-events.ts`), and `node:` built-ins
 * (`randomUUID` in the id value objects, `Readable` in the storage port). Both
 * are outside the four prohibitions rather than exceptions to them — do not
 * "fix" this test by banning either.
 */
describe('domain layer imports', () => {
    /** Every non-spec `.ts` file under `domain/`, recursively. */
    function domainFiles(dir: string = __dirname): string[] {
        return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                return domainFiles(path);
            }
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

    const FILES = domainFiles();

    /** The forbidden neighbours, as `[label, predicate]`. */
    const FORBIDDEN: [string, (specifier: string) => boolean][] = [
        ['@nestjs/*', (spec) => spec.startsWith('@nestjs/')],
        ['drizzle-orm', (spec) => spec.split('/')[0] === 'drizzle-orm'],
        ['class-validator', (spec) => spec === 'class-validator'],
        ['the infrastructure layer', (spec) => spec.includes('infrastructure')]
    ];

    it('found the domain sources to check', () => {
        // A walk that silently matched nothing would make every case below
        // pass without reading a line of code.
        expect(FILES.length).toBeGreaterThan(10);
        expect(FILES.some((path) => path.endsWith('asset.ts'))).toBe(true);
        // The storage port itself no longer lives here — it moved to
        // `@orthacms/media-domain` so an adapter can speak it without
        // installing NestJS. The aggregates it serves stayed.
        expect(FILES.some((path) => path.endsWith('folder.ts'))).toBe(true);
        expect(
            FILES.some((path) => path.endsWith('value-objects/file-name.ts'))
        ).toBe(true);
    });

    // covers: media:I-33
    it.each(FORBIDDEN)('imports nothing from %s', (_label, forbidden) => {
        const offenders = FILES.filter((path) =>
            specifiersOf(path).some(forbidden)
        );
        expect(offenders).toEqual([]);
    });

    it('does depend on the shared kernel — framework-free, not dependency-free', () => {
        const kernelUsers = FILES.filter((path) =>
            specifiersOf(path).includes('@orthacms/database')
        );
        expect(kernelUsers.length).toBeGreaterThan(0);
    });

    it('does use node built-ins — the aggregate mints its own id', () => {
        const builtinUsers = FILES.filter((path) =>
            specifiersOf(path).some((spec) => spec.startsWith('node:'))
        );
        expect(builtinUsers.length).toBeGreaterThan(0);
    });
});
