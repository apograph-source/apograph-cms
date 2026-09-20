import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { ServerPlugin } from '@orthacms/bootstrap-server';

/**
 * Where a generated app keeps things.
 *
 * These are conventions, not configuration, and deliberately so: an app that
 * can put its server anywhere needs a config file describing where, which the
 * CLI then has to read before it can do anything — and the first thing a
 * generated app should be is boring.
 *
 * The layout mirrors this repo's own `apps/` folder — `server`, `admin`,
 * `server-e2e`, `admin-e2e` — so someone who has read the Ortha source finds
 * the same shape in their own project.
 *
 * The compiled paths follow from `apps/server/tsconfig.json` setting `rootDir`
 * to the app directory: `apps/server/ortha.config.ts` becomes
 * `dist/server/ortha.config.js`, and `apps/server/src/main.ts` becomes
 * `dist/server/src/main.js`. Change that `rootDir` without changing these and
 * the paths below stop resolving — `ortha start` then reports a missing entry
 * point rather than a misconfigured one.
 */
export const LAYOUT = {
    /** tsc project for the API and everything it imports. */
    serverTsconfig: 'apps/server/tsconfig.json',
    /** Vite config for the admin — it lives inside the app it builds. */
    adminConfig: 'apps/admin/vite.config.mts',
    /** The admin's HTML entry. Its absence means "this app has no UI". */
    adminIndex: 'apps/admin/index.html',
    /** Compiled server output. */
    serverOut: 'dist/server',
    /** Built admin bundle — what `staticDir` serves. */
    adminOut: 'dist/admin',
    /** Compiled entry point `ortha start` runs. */
    serverEntry: 'dist/server/src/main.js',
    /** Compiled typed config, default-exported. */
    compiledConfig: 'dist/server/ortha.config.js',
    /** Compiled plugin factory, exporting `buildPlugins(config)`. */
    compiledPlugins: 'dist/server/src/plugins.js',
    /** Drizzle generation config for the app's own content tables. */
    drizzleConfig: 'apps/server/drizzle.config.ts'
} as const;

/** The minimum this CLI needs to know about a host's config. */
export interface HostConfig {
    database?: { url?: string };
    [key: string]: unknown;
}

/** A loaded host: its typed config and the plugin list it builds. */
export interface LoadedHost {
    config: HostConfig;
    plugins: ServerPlugin[];
}

/**
 * Finds the app root — the nearest ancestor with a `package.json` — starting
 * from `from`.
 *
 * Walking up rather than trusting `process.cwd()` means `ortha migrate` works
 * from a subdirectory, which is where people actually run it. Everything else
 * in this file resolves against the result, so the app's own relative paths
 * (`migrations/`, `dist/`) mean the same thing wherever the command was typed.
 */
export function findProjectRoot(from: string = process.cwd()): string {
    let dir = resolve(from);

    for (;;) {
        if (existsSync(join(dir, 'package.json'))) return dir;

        const parent = dirname(dir);
        if (parent === dir) {
            throw new Error(
                `No package.json in ${resolve(from)} or any parent directory — ` +
                    `run this inside an Ortha app.`
            );
        }
        dir = parent;
    }
}

/**
 * Loads the host's config and plugin list from the **compiled** output.
 *
 * The monorepo reads the same two modules straight from TypeScript, which
 * costs it jiti plus an swc transform hook configured for legacy decorators
 * (`@orthacms/nx`'s `createTsJiti`) — the plugin graph is full of decorated
 * Nest classes, and jiti's bundled babel defaults to the stage-3 semantics
 * that crash on them. A generated app has a build step of its own, so it can
 * simply build first and require the JavaScript, and the whole transform
 * problem stops existing on the consumer's side.
 */
export function loadHost(root: string): LoadedHost {
    const configPath = join(root, LAYOUT.compiledConfig);
    const pluginsPath = join(root, LAYOUT.compiledPlugins);

    for (const path of [configPath, pluginsPath]) {
        if (!existsSync(path)) {
            throw new Error(
                `${path} does not exist — the app has not been built. ` +
                    `Run \`ortha build\` first (\`ortha migrate\` does this for you).`
            );
        }
    }

    // `require`, not `await import()`. The app compiles to CommonJS, and
    // importing a CommonJS module from ESM puts the whole `module.exports` on
    // the namespace's `default` — so `module.default` is `{ default: config }`
    // rather than the config, and the first thing to touch it fails on a
    // property of undefined with nothing in the message about interop.
    // `require` returns `module.exports` itself, with no such ambiguity.
    const load = createRequire(join(root, 'package.json'));

    const configModule = load(configPath) as { default?: HostConfig };
    const config = configModule.default;

    if (!config) {
        throw new Error(
            `${LAYOUT.compiledConfig} has no default export — ` +
                `ortha.config.ts must \`export default\` the app's config.`
        );
    }

    const pluginsModule = load(pluginsPath) as {
        buildPlugins?: (config: HostConfig) => ServerPlugin[];
    };

    if (typeof pluginsModule.buildPlugins !== 'function') {
        throw new Error(
            `${LAYOUT.compiledPlugins} does not export buildPlugins(config).`
        );
    }

    return { config, plugins: pluginsModule.buildPlugins(config) };
}

/**
 * The database URL from a loaded config, refusing an empty one.
 *
 * `new Pool({ connectionString: '' })` does not fail — it falls through to
 * libpq's environment defaults (`PGHOST`/`PGDATABASE`, or localhost and the OS
 * user). Measured in this repo before the check existed: with `DATABASE_URL`
 * unset, migrate reported success after creating every table in a database
 * nobody named.
 */
export function requireDatabaseUrl(config: HostConfig): string {
    const url = config.database?.url;

    if (!url) {
        throw new Error(
            'DATABASE_URL is not set — migrating needs to know which database ' +
                'to change, and will not fall back to the local defaults. Set it ' +
                'in your .env and try again.'
        );
    }

    return url;
}
