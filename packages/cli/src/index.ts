/**
 * Public API of `@orthacms/cli`.
 *
 * The commands themselves are reached through the `ortha` binary; what is
 * exported here is the layer underneath, so `@orthacms/nx` can drive the same
 * implementations from its Nx executors. That sharing is the point: the
 * monorepo and every generated app then migrate through one code path, rather
 * than two that drift.
 */
export { applyPluginMigrations, describeTarget } from './lib/migrate';
export { runDrizzleKitGenerate } from './lib/generate';
export { loadEnv } from './lib/env';
export { runDrizzleKitStudio, type StudioServerOptions } from './lib/studio';
export {
    findProjectRoot,
    loadHost,
    requireDatabaseUrl,
    LAYOUT,
    type HostConfig,
    type LoadedHost
} from './lib/project';
