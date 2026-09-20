import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ADR-0003's one hard rule for this package, read off the files rather than
 * left to review — the same check `workspaces` and `users` carry over their own
 * `domain/` layers.
 *
 * `domain/` must import nothing from `@nestjs/*`, `drizzle-orm`,
 * `class-validator`, or `../infrastructure`. The `@orthacms/nx` layer-boundary
 * lint is not wired up, and the violation is always a one-line convenience — an
 * `@Injectable()` to make `filterTreeSegments` injectable, an `eq()` reached
 * for while writing a guard — that compiles, passes every test, and quietly
 * welds three pure functions to a framework.
 *
 * Alarms is the strictest case of it: this `domain/` currently imports
 * **nothing at all** outside itself, which is what lets `filterTreeSegments`
 * and `nextFindingState` be unit-tested against the shapes the query builder
 * actually emits. That is not asserted as a rule — a later import of the shared
 * `@orthacms/database` kernel (a framework-free `DomainEvent` contract) would
 * be legitimate, exactly as it is in `workspaces` — but the four prohibitions
 * below are.
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
        // A walk that silently matched nothing would make every case below pass
        // without reading a line of code.
        expect(FILES.length).toBeGreaterThanOrEqual(5);
        for (const name of [
            'alarm-severity.ts',
            'finding-state.ts',
            'filter-tree-segments.ts'
        ]) {
            expect(FILES.some((path) => path.endsWith(name))).toBe(true);
        }
        // `errors/` is a subdirectory: the walk has to recurse, or the layer's
        // most import-prone corner goes unchecked.
        expect(
            FILES.some((path) => path.includes(`${join('domain', 'errors')}`))
        ).toBe(true);
    });

    // covers: alarms:I-24
    it.each(FORBIDDEN)('imports nothing from %s', (_label, forbidden) => {
        const offenders = FILES.filter((path) =>
            specifiersOf(path).some(forbidden)
        );
        expect(offenders).toEqual([]);
    });
});
