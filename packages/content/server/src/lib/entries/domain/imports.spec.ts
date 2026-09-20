import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ADR-0003's one hard rule for the entries feature, read off the files rather
 * than left to review — the second half of `content:I-37`, whose first half
 * (`@orthacms/content-domain` declares no dependencies) is pinned in that
 * package's `kernel-shape.spec.ts`.
 *
 * `domain/` here holds the publish lifecycle: the `Entry` model, the gate
 * failure it raises, and the `entry.*` event factory. The layer is small, which
 * is precisely the risk — the violation is always a one-line convenience (an
 * `@Injectable()` to make the model injectable, an `eq()` reached for while
 * writing an invariant, an import of `entry-row` to reuse a mapper) that
 * compiles, passes every test, and welds the lifecycle to the persistence
 * engine it was extracted from. The `@orthacms/nx` layer-boundary lint is not
 * wired up; this is what enforces the rule. Same shape and same reason as
 * `packages/workspaces/server/src/lib/workspace/domain/imports.spec.ts`.
 *
 * **The accurate claim is "framework-free", not "dependency-free."** This layer
 * *does* import `@orthacms/content-domain` (the status state machine and the
 * publish gate — the whole point of a shared kernel) and `@orthacms/database`
 * for the framework-free `createDomainEvent` / `DomainEvent` contract. Both are
 * outside the four prohibitions rather than exceptions to them; do not "fix"
 * this test by banning either.
 */
describe('entries/domain layer imports', () => {
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
        expect(FILES.length).toBeGreaterThanOrEqual(3);
        expect(FILES.some((path) => path.endsWith('entry.ts'))).toBe(true);
        expect(FILES.some((path) => path.endsWith('entry-events.ts'))).toBe(
            true
        );
        expect(
            FILES.some((path) =>
                path.endsWith('entry-publish-blocked.error.ts')
            )
        ).toBe(true);
    });

    // covers: content:I-37
    it.each(FORBIDDEN)('imports nothing from %s', (_label, forbidden) => {
        const offenders = FILES.filter((path) =>
            specifiersOf(path).some(forbidden)
        );
        expect(offenders).toEqual([]);
    });

    it('does depend on the shared kernel — framework-free, not dependency-free', () => {
        // The complement: the four checks above are also true of a layer that
        // imported nothing at all, which would make them unfalsifiable by
        // anything anyone would actually write. The publish lifecycle is
        // *supposed* to reach for the kernel's gate and status machine.
        const kernelUsers = FILES.filter((path) =>
            specifiersOf(path).includes('@orthacms/content-domain')
        );
        expect(kernelUsers.length).toBeGreaterThan(0);

        const eventUsers = FILES.filter((path) =>
            specifiersOf(path).includes('@orthacms/database')
        );
        expect(eventUsers.length).toBeGreaterThan(0);
    });
});
