import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * What the admin host is allowed to know about.
 *
 * Both claims are about what is **absent**, which no rendered page can show: an
 * app assembled with the shell and identity present behaves identically whether
 * the host imports them or not. They are also the two the host is most likely to
 * lose, because in both cases the import that breaks them is the convenient move
 * in the moment — reading a slot to render one nav item, importing `useAuth` to
 * skip a redirect.
 */

// Resolved off `import.meta.url` as a string. Under the jsdom environment the
// global `URL` is jsdom's, and node's `fileURLToPath` refuses an instance it did
// not make ("The URL must be of scheme file").
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Every TypeScript source file in the package, specs and setup excluded. */
function sourceFiles(dir = join(PACKAGE_ROOT, 'src')): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        if (!/\.tsx?$/.test(path)) return [];
        if (/\.spec\.tsx?$/.test(path) || path.endsWith('test-setup.ts')) {
            return [];
        }
        return [path];
    });
}

/** Source files whose text matches `pattern`, relative to the package. */
function matching(pattern: RegExp): string[] {
    return sourceFiles()
        .filter((file) => pattern.test(readFileSync(file, 'utf8')))
        .map((file) => relative(PACKAGE_ROOT, file));
}

describe('the admin host’s boundaries', () => {
    it('wires slots without defining or reading one [bootstrap:I-24]', () => {
        // The positive half first, so this cannot pass by the host having
        // stopped touching slots altogether: it does wire them, in one call,
        // and that call is the entirety of its involvement.
        expect(matching(/wireSlotContributions/)).toEqual([
            'src/lib/createAdmin/index.tsx'
        ]);

        // All 26 slots belong to plugins. A host that defined one would be
        // declaring that the application has a sidebar — which is the shell's
        // claim to make, and the reason a deployment can drop the shell and
        // still boot.
        expect(matching(/\bcreateSlot\b/)).toEqual([]);
        // Reading one is the subtler failure: it makes the host depend on a
        // contribution's shape, so a plugin can no longer change its own items
        // without the composition root agreeing.
        expect(matching(/\.getItems\s*\(/)).toEqual([]);
    });

    it('imports no authorization package at all [bootstrap:I-35]', () => {
        const manifest = JSON.parse(
            readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')
        ) as Record<string, Record<string, string> | undefined>;

        const declared = Object.keys({
            ...manifest['dependencies'],
            ...manifest['peerDependencies'],
            ...manifest['devDependencies']
        });
        // Not a dependency, not even a dev one. The gate lives in the `layout`
        // the shell contributes, and the host mounts that layout without knowing
        // what is inside it — which is what lets an installation replace or omit
        // the gate without touching `packages/bootstrap`.
        expect(declared).not.toContain('@apograph/identity-admin');

        expect(matching(/@apograph\/identity-admin/)).toEqual([]);
        // The three words the dossier names, as imported symbols rather than
        // prose: `createAdmin`'s comments discuss `RequireAuth` at length, and
        // must go on being able to.
        expect(
            matching(
                /import[\s\S]{0,200}?\b(RequireAuth|AuthProvider|useAuth)\b/
            )
        ).toEqual([]);
    });
});

/**
 * The admin half of "the hosts contain no domain logic … no screens".
 *
 * A screen is not a shape a regex can name — a React component is a React
 * component — but it is not a thing the host can invent from nothing either.
 * Every page in this admin is contributed by a plugin through
 * `AdminPlugin.routes`, so a screen appearing here would arrive one of two
 * ways: imported from a plugin package, or hard-coded against a plugin's data.
 * The first is a dependency, and the second needs one too, because there is no
 * API client in this package to reach the data with.
 *
 * So the enumerable channel is the import list, and the assertion is that it
 * contains only the two packages that carry no domain: the design system (the
 * primitives) and `utils-admin` (the slot mechanism).
 */
describe('the admin host holds no domain logic', () => {
    /** The `@apograph/*` packages the host is allowed to know about. */
    const CHROME = ['@apograph/design-system', '@apograph/utils-admin'];

    it('imports only the two domain-free packages [bootstrap:I-01]', () => {
        const imported = new Set(
            sourceFiles().flatMap((file) =>
                [
                    ...readFileSync(file, 'utf8').matchAll(
                        /from '(@apograph\/[a-z0-9-]+)'/g
                    )
                ].map(([, specifier]) => specifier)
            )
        );

        // Both halves matter. The subset check is the rule; the non-empty check
        // is what stops it passing on a host that imported nothing at all —
        // which would mean the scan had silently stopped finding files.
        expect([...imported].sort()).toEqual(CHROME);
    });

    it('declares no plugin package as a dependency [bootstrap:I-01]', () => {
        // The same rule at the manifest, so an import added under a path alias
        // or a dynamic `import()` still has to show up somewhere. A generated
        // app installs every plugin it wants and hands them to `createAdmin`;
        // the host's own tree is the two above and React.
        const manifest = JSON.parse(
            readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')
        ) as Record<string, Record<string, string> | undefined>;
        const declared = Object.keys({
            ...manifest['dependencies'],
            ...manifest['peerDependencies'],
            ...manifest['devDependencies']
        });

        expect(
            declared.filter((name) => name.startsWith('@apograph/'))
        ).toEqual(CHROME);
    });
});
