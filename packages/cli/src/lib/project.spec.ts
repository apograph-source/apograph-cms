import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    findProjectRoot,
    LAYOUT,
    loadHost,
    requireDatabaseUrl,
    type HostConfig
} from './project';

/**
 * These run against a real directory tree rather than a mocked `node:fs`,
 * because two of the three things under test are resolution: which
 * `package.json` the walk stops at, and what Node's own `require` returns for a
 * CommonJS module. A mock of the filesystem would answer both questions itself.
 */
const roots: string[] = [];

function tempApp(): string {
    const root = mkdtempSync(join(tmpdir(), 'ortha-cli-project-'));
    roots.push(root);
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'my-cms', version: '1.0.0' }),
        'utf8'
    );

    return root;
}

/** Writes the two compiled modules `loadHost` reads, as real CommonJS. */
function writeCompiledHost(
    root: string,
    { config, plugins }: { config: string; plugins: string }
): void {
    for (const [relative, source] of [
        [LAYOUT.compiledConfig, config],
        [LAYOUT.compiledPlugins, plugins]
    ] as const) {
        const path = join(root, relative);
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, source, 'utf8');
    }
}

afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('findProjectRoot', () => {
    /**
     * People run `ortha migrate` from wherever they happen to be — most often
     * `apps/server`, because that is where they were editing. Trusting
     * `process.cwd()` would make the app's own relative paths (`migrations/`,
     * `dist/`) mean something different depending on which terminal tab was
     * focused.
     */
    it('walks up to the nearest package.json, from any depth [cli:I-24]', () => {
        const root = tempApp();
        const deep = join(root, 'apps', 'server', 'src', 'content');
        mkdirSync(deep, { recursive: true });

        expect(findProjectRoot(deep)).toBe(root);
        expect(findProjectRoot(join(root, 'apps'))).toBe(root);
        expect(findProjectRoot(root)).toBe(root);
    });

    /**
     * "Nearest", not "outermost": a nested package.json is a different app, and
     * resolving past it would migrate the wrong database.
     */
    it('stops at the nearest package.json, not the outermost one [cli:I-24]', () => {
        const outer = tempApp();
        const inner = join(outer, 'packages', 'plugin');
        mkdirSync(join(inner, 'src'), { recursive: true });
        writeFileSync(
            join(inner, 'package.json'),
            JSON.stringify({ name: 'a-plugin' }),
            'utf8'
        );

        expect(findProjectRoot(join(inner, 'src'))).toBe(inner);
    });

    it('says to run inside an app when the walk reaches the filesystem root [cli:I-24]', () => {
        // A temp dir with no package.json of its own and none above it: the
        // walk runs out of parents rather than finding something to migrate.
        const orphan = mkdtempSync(join(tmpdir(), 'ortha-cli-orphan-'));
        roots.push(orphan);

        expect(() => findProjectRoot(orphan)).toThrow(
            /No package\.json in .* run this inside an Ortha app/s
        );
    });
});

describe('loadHost', () => {
    const CONFIG_SOURCE = `
        exports.default = {
            database: { url: 'postgresql://ortha:secret@db:5432/app' },
            staticDir: 'dist/admin'
        };
    `;
    const PLUGINS_SOURCE = `
        exports.buildPlugins = (config) => [
            { name: 'database', url: config.database.url }
        ];
    `;

    /**
     * The interop trap this exists to avoid: importing a CommonJS module from
     * ESM puts the whole `module.exports` on the namespace's `default`, so
     * `module.default` comes back as `{ default: config }` — a truthy object
     * that passes the missing-export check and then fails on
     * `config.database.url` being undefined, with nothing in the message about
     * interop. `require` returns `module.exports` itself.
     */
    it('reads the compiled config itself, not an ESM wrapper around it [cli:I-23]', () => {
        const root = tempApp();
        writeCompiledHost(root, {
            config: CONFIG_SOURCE,
            plugins: PLUGINS_SOURCE
        });

        const { config } = loadHost(root);

        // The wrapper's signature is a `default` key holding the real config.
        expect(config).not.toHaveProperty('default');
        expect(config.database?.url).toBe(
            'postgresql://ortha:secret@db:5432/app'
        );
    });

    it('builds the plugin list from that same config object [cli:I-23]', () => {
        const root = tempApp();
        writeCompiledHost(root, {
            config: CONFIG_SOURCE,
            plugins: PLUGINS_SOURCE
        });

        const { plugins } = loadHost(root);

        // `buildPlugins` read `config.database.url`, which only resolves if it
        // was handed the config rather than a namespace object wrapping it.
        expect(plugins).toEqual([
            {
                name: 'database',
                url: 'postgresql://ortha:secret@db:5432/app'
            }
        ]);
    });

    it('is synchronous, which is what require buys over await import() [cli:I-23]', () => {
        const root = tempApp();
        writeCompiledHost(root, {
            config: CONFIG_SOURCE,
            plugins: PLUGINS_SOURCE
        });

        expect(loadHost(root)).not.toBeInstanceOf(Promise);
    });

    it('reports an unbuilt app as unbuilt rather than as a missing module', () => {
        const root = tempApp();

        expect(() => loadHost(root)).toThrow(
            /does not exist — the app has not been built/
        );
    });

    it('names the missing default export when ortha.config.ts has none', () => {
        const root = tempApp();
        writeCompiledHost(root, {
            config: `exports.somethingElse = {};`,
            plugins: PLUGINS_SOURCE
        });

        expect(() => loadHost(root)).toThrow(/has no default export/);
    });

    it('names the missing buildPlugins export', () => {
        const root = tempApp();
        writeCompiledHost(root, {
            config: CONFIG_SOURCE,
            plugins: `exports.notBuildPlugins = 1;`
        });

        expect(() => loadHost(root)).toThrow(
            /does not export buildPlugins\(config\)/
        );
    });
});

describe('requireDatabaseUrl', () => {
    /**
     * The measured failure this refuses: `new Pool({ connectionString: '' })`
     * does not fail. It falls through to libpq's environment defaults —
     * `PGHOST`/`PGDATABASE`, or localhost and the OS user — so migrating with
     * `DATABASE_URL` unset reported success after creating every table in a
     * database nobody named. A fallback here is silent; a refusal is not.
     */
    it.each([
        ['no database section at all', {}],
        ['a database section with no url', { database: {} }],
        ['an undefined url', { database: { url: undefined } }],
        ['an empty url', { database: { url: '' } }]
    ])('refuses %s rather than falling back [cli:I-03]', (_case, config) => {
        expect(() => requireDatabaseUrl(config as HostConfig)).toThrow(
            /DATABASE_URL is not set/
        );
    });

    it('says it will not fall back, and where to set it [cli:I-03]', () => {
        expect(() => requireDatabaseUrl({})).toThrow(
            /will not fall back to the local defaults.*Set it in your \.env/s
        );
    });

    it('returns a configured url unchanged [cli:I-03]', () => {
        expect(
            requireDatabaseUrl({
                database: { url: 'postgresql://ortha:secret@db:5432/app' }
            })
        ).toBe('postgresql://ortha:secret@db:5432/app');
    });
});
