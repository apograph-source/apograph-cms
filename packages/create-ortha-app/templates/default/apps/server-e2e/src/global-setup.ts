import {
    assertDisposable,
    ensureDatabase,
    loadDotEnv,
    resolveTestDatabaseUrl
} from './support/db';

/**
 * Creates and migrates the e2e database once for the whole run.
 *
 * Migrations go through `applyPluginMigrations` — the same function
 * `ortha migrate` calls — so the schema under test is the real shipped schema,
 * applied in the same plugin order. A hand-rolled setup would drift from what
 * the app does the first time a plugin is added.
 *
 * The app's config and plugin list are pulled in with **dynamic** imports, and
 * that is load-bearing rather than stylistic: `ortha.config.ts` reads
 * `process.env` at import time and throws without `DATABASE_URL`. A static
 * import is hoisted above every statement here, so it would run before `.env`
 * is loaded and before the URL is pointed at the test database — and the whole
 * suite would fail on a variable that is sitting in a file two lines away.
 */
export default async function globalSetup(): Promise<void> {
    loadDotEnv();

    const url = resolveTestDatabaseUrl();
    assertDisposable(url);
    await ensureDatabase(url);

    // Only now is it safe to let the config load.
    process.env['DATABASE_URL'] = url;

    const [{ applyPluginMigrations }, { default: config }, { buildPlugins }] =
        await Promise.all([
            import('@orthacms/cli'),
            import('../../server/ortha.config'),
            import('../../server/src/plugins')
        ]);

    await applyPluginMigrations(buildPlugins(config), url);
}
