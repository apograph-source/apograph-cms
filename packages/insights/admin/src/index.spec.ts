import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The two structural claims the package makes about itself: that the dashboard
 * depends on nothing it displays, and that it is admin-only.
 *
 * Neither is observable at runtime — a dashboard that imported `content-admin`
 * would render exactly the same page — so the only harness that can state them
 * reads the manifest and the import graph. That is worth doing rather than
 * trusting review: the pressure to reach for a feature package is highest
 * precisely here, where every widget on the page comes from one.
 */

// Vitest serves specs over its own dev server, so `import.meta.url` is an
// http: URL here and cannot be turned into a path. The config sets `root` to
// the package directory, which is what the runner chdirs to.
const PACKAGE_ROOT = process.cwd();
const HERE = join(PACKAGE_ROOT, 'src');
const GROUP_ROOT = join(PACKAGE_ROOT, '..');

/** Every `@orthacms/*` specifier imported anywhere under `src/`. */
function workspaceImports(dir: string): Set<string> {
    const found = new Set<string>();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            for (const nested of workspaceImports(path)) found.add(nested);
            continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const source = readFileSync(path, 'utf8');
        for (const match of source.matchAll(/from\s+'(@ortha\/[^']+)'/g)) {
            found.add(match[1]);
        }
    }
    return found;
}

/**
 * The packages Insights is allowed to know about: the host, the design system,
 * the shared admin utilities, the workspace it lives inside, and the auth state
 * it reads permissions from. Every one of them is infrastructure — none of them
 * owns a widget.
 */
const ALLOWED = [
    '@orthacms/bootstrap-admin',
    '@orthacms/design-system',
    '@orthacms/identity-admin',
    '@orthacms/utils-admin',
    '@orthacms/workspaces-admin'
];

describe('@orthacms/insights-admin dependencies', () => {
    const manifest = JSON.parse(
        readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')
    ) as { dependencies?: Record<string, string> };

    it('declares no feature package as a dependency [insights:I-01]', () => {
        const declared = Object.keys(manifest.dependencies ?? {})
            .filter((name) => name.startsWith('@orthacms/'))
            .sort();

        // `content-admin`, `media-admin` and `i18n-admin` depend on *this*
        // package to contribute their widgets. A dependency back the other way
        // is both a cycle and the start of the dashboard knowing what is on it.
        expect(declared).toEqual(ALLOWED);
    });

    it('imports no feature package anywhere in its source [insights:I-01]', () => {
        const imported = [...workspaceImports(HERE)].sort();

        // The manifest is the declaration; this is the fact. A source import of
        // a package the manifest never mentions resolves fine in a workspace
        // and breaks only once the package is installed from npm.
        expect(imported.filter((name) => !ALLOWED.includes(name))).toEqual([]);
    });
});

describe('@orthacms/insights-admin shape', () => {
    it('has no server half and ships no migrations [insights:I-25]', () => {
        // Insights reads endpoints owned by `content-server`, `media-server`
        // and `i18n-server`. Owning a table here would mean owning a
        // projection, and the aggregates are deliberately live.
        expect(readdirSync(GROUP_ROOT).sort()).toEqual(['admin']);

        const stray = readdirSync(PACKAGE_ROOT).filter(
            (entry) =>
                entry.startsWith('drizzle.config') || entry === 'migrations'
        );
        expect(stray).toEqual([]);
    });

    it('depends on no database or server package [insights:I-25]', () => {
        const manifest = JSON.parse(
            readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')
        ) as { dependencies?: Record<string, string> };

        expect(
            Object.keys(manifest.dependencies ?? {}).filter(
                (name) =>
                    name === '@orthacms/database' ||
                    name.endsWith('-server') ||
                    name === 'drizzle-orm'
            )
        ).toEqual([]);
    });
});

/** Guards the assumption the import scan rests on: that it read anything. */
it('scans a source tree that is actually there', () => {
    expect(statSync(join(HERE, 'lib')).isDirectory()).toBe(true);
    expect(workspaceImports(HERE).size).toBeGreaterThan(0);
});
