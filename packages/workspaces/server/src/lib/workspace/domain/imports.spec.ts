import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ADR-0003's one hard rule for this package, read off the files rather than
 * left to review. This context is the reference implementation of the layered
 * shape, so a leak here is copied into every context extracted after it.
 *
 * `domain/` must import nothing from `@nestjs/*`, `drizzle-orm`,
 * `class-validator`, or `../infrastructure`. The `@orthacms/nx` layer-boundary
 * lint is not wired up (the package `AGENTS.md` says as much: "self-enforce
 * it"), and the violation is always a one-line convenience — an `@Injectable()`
 * to make a value object injectable, an `eq()` reached for while writing an
 * invariant — that compiles, passes every test, and quietly welds the aggregate
 * to a framework.
 *
 * **The accurate claim is "framework-free", not "dependency-free."** `domain/`
 * *does* import two things: `@orthacms/database`, for the framework-free
 * `DomainEvent` / `createDomainEvent` contract (`events/workspace-events.ts`),
 * and `node:crypto` for `randomUUID` (`value-objects/workspace-id.ts`), which
 * is what lets the aggregate mint its own id instead of reading one back from a
 * database default. The shared tactical-DDD kernel and a node built-in are both
 * outside the four prohibitions rather than exceptions to them — do not "fix"
 * this test by banning either.
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
        // A glob that silently matched nothing would make every case below
        // pass without reading a line of code.
        expect(FILES.length).toBeGreaterThan(5);
        expect(FILES.some((path) => path.endsWith('workspace.ts'))).toBe(true);
        expect(
            FILES.some((path) => path.endsWith('slug-uniqueness.service.ts'))
        ).toBe(true);
    });

    // covers: workspaces:I-23
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
