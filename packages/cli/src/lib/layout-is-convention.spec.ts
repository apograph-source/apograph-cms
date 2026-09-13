import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LAYOUT } from './project';

/**
 * The application layout is a **convention**, and `LAYOUT` is where the whole
 * convention is written down.
 *
 * The invariant has two halves and they are not equally reachable. "`LAYOUT`,
 * not configuration" is checkable, because a path has to be spelled out
 * somewhere to be used: a second opinion about where the server compiles to is
 * a string literal, and this file is the assertion that there is no such
 * literal outside the one table. The other half — "the CLI reads no settings
 * file of its own" — is an unbounded absence over the package, and is
 * deliberately left unasserted.
 *
 * What the checkable half buys is not tidiness. Every one of these paths is
 * load-bearing at a distance: `serverEntry` follows from `apps/server/
 * tsconfig.json`'s `rootDir`, and a copy that drifted would have `apograph start`
 * report a missing entry point for an app that had built perfectly.
 */

/** The package root — `packages/cli`. */
const PACKAGE = join(__dirname, '..', '..');

/** Every shipped `.ts` under `src/`, specs excluded. */
function sources(dir = join(PACKAGE, 'src')): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return sources(path);
        if (!path.endsWith('.ts') || path.endsWith('.spec.ts')) return [];
        return [path];
    });
}

/** Every single-quoted string literal in a file. */
function literals(path: string): string[] {
    return [...readFileSync(path, 'utf8').matchAll(/'([^'\n]*)'/g)].map(
        ([, value]) => value
    );
}

describe('the application layout lives in exactly one place', () => {
    /** Where `LAYOUT` itself is declared — the one file allowed these. */
    const HOME = join(PACKAGE, 'src/lib/project.ts');

    it('names no app or output directory outside LAYOUT [cli:I-22]', () => {
        // `apps/` and `dist/` are the two roots the whole layout hangs off, so
        // a literal naming either — whole, or as the first segment of a path,
        // or as a `join()` fragment — is a second copy of the convention. The
        // check runs over every source but `project.ts`, which is the copy.
        const strays = sources()
            .filter((path) => path !== HOME)
            .flatMap((path) =>
                literals(path)
                    .filter((value) => /^(apps|dist)(\/|$)/.test(value))
                    .map((value) => `${relative(PACKAGE, path)}: ${value}`)
            );

        expect(strays).toEqual([]);
    });

    it('is the table the commands actually resolve against [cli:I-22]', () => {
        // The premise the case above rests on. Without it, a `LAYOUT` nobody
        // reads would satisfy "no strays" by the commands having stopped using
        // paths at all — so this asserts the table is live, and that its
        // entries are the relative conventions the doc comment describes rather
        // than absolute paths somebody could point elsewhere.
        const readers = sources()
            .filter((path) => path !== HOME)
            .filter((path) => /\bLAYOUT\./.test(readFileSync(path, 'utf8')));

        expect(readers.length).toBeGreaterThan(3);
        for (const value of Object.values(LAYOUT)) {
            expect(value.startsWith('/')).toBe(false);
            expect(value.startsWith('.')).toBe(false);
        }
    });
});
