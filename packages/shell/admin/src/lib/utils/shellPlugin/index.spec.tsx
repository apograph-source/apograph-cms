import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SIDEBAR_NAV_SLOT } from '../../slots/sidebarSlots';
import { ShellPlugin } from './index';

/**
 * What the shell is allowed to know about.
 *
 * The whole plugin architecture rests on the chrome not importing the features
 * it renders: the sidebar's rows, sections, footer widgets and palette groups
 * all arrive through slots, the contextual area through an override, and the two
 * page regions through portals. One `import { ContentPlugin } from
 * '@orthacms/content-admin'` in here compiles, renders, and quietly makes the
 * shell un-droppable from any app that does not want content — and nothing in a
 * browser suite would ever notice.
 *
 * So this reads the package's own source. It is the only harness that can see
 * the rule at all: it is a statement about the import graph, not about a render.
 */

/**
 * Resolved from the runner's working directory, not from `import.meta.url`.
 * Under the jsdom environment Vite serves modules over `http:`, so
 * `fileURLToPath(import.meta.url)` throws "The URL must be of scheme file" —
 * which is how this file failed the first time it ever ran. Vitest sets the cwd
 * to the project root, and the assertion below fails loudly if that ever stops
 * being true, rather than silently scanning an empty tree and passing.
 */
const PACKAGE_ROOT = process.cwd();

// A wrong cwd would leave the scan below with nothing to read, and a rule with
// no files to check passes. Fail here instead, where the cause is legible.
if (!existsSync(join(PACKAGE_ROOT, 'package.json'))) {
    throw new Error(
        `shellPlugin spec: expected the package root at ${PACKAGE_ROOT}. ` +
            'Vitest is meant to run with the project as its working directory.'
    );
}

/**
 * The four workspace packages the shell is allowed to reach for, and why each
 * one is not a feature:
 *
 * - `bootstrap-admin` — the host contract (`AdminPlugin`), type-only.
 * - `identity-admin` — the gate the layout composes; the shell's whole reason
 *   for existing as a *plugin* rather than as markup (see the package AGENTS.md).
 * - `design-system` — the primitives everything is built from.
 * - `utils-admin` — the slot mechanism itself.
 */
const ALLOWED = [
    '@orthacms/bootstrap-admin',
    '@orthacms/design-system',
    '@orthacms/identity-admin',
    '@orthacms/utils-admin'
];

/** Every source file the package ships, specs and the jsdom setup aside. */
function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        if (!/\.tsx?$/.test(entry.name)) return [];
        if (/\.(spec|test)\.tsx?$/.test(entry.name)) return [];
        if (entry.name === 'test-setup.ts') return [];
        return [path];
    });
}

/** Workspace-package specifiers imported anywhere in the shell's source. */
function importedWorkspacePackages(): string[] {
    const found = new Set<string>();
    for (const file of sourceFiles(join(PACKAGE_ROOT, 'src'))) {
        const source = readFileSync(file, 'utf8');
        for (const match of source.matchAll(/from\s+'(@orthacms\/[^'/]+)/g)) {
            found.add(match[1]);
        }
    }
    return [...found].sort();
}

describe('the shell plugin', () => {
    it('imports no feature plugin [shell:I-04]', () => {
        // An exact set, not a "contains no content-admin" check: the failure this
        // guards is a *new* import nobody thought to add to a deny-list.
        expect(importedWorkspacePackages()).toEqual(ALLOWED);
    });

    it('declares exactly those four dependencies, so the manifest cannot drift [shell:I-04]', () => {
        const manifest = JSON.parse(
            readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')
        ) as { dependencies?: Record<string, string> };

        expect(
            Object.keys(manifest.dependencies ?? {})
                .filter((name) => name.startsWith('@orthacms/'))
                .sort()
        ).toEqual(ALLOWED);
    });

    it('contributes one nav row, and it is the exact-match root [shell:I-28]', () => {
        // `end: true` belongs to `/` and nowhere else: any other path matched
        // exactly stops marking itself current on its own sub-routes, and `/`
        // matched loosely marks itself current on every page in the product.
        // (The same rule across every plugin is asserted in
        // `apps/admin/src/plugins.spec.ts`.)
        const items = ShellPlugin()
            .slots?.filter(
                (contribution) => contribution.slot === SIDEBAR_NAV_SLOT
            )
            .flatMap((contribution) => contribution.items);

        expect(items).toHaveLength(1);
        expect(items?.[0]).toMatchObject({ to: '/', end: true });
    });
});
