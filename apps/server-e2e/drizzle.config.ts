import { defineConfig } from 'drizzle-kit';

/**
 * Generation config for the server-e2e-owned content tables — the dedicated
 * test content types under `src/support/content/`, aggregated by
 * `src/support/content/index.ts`. This deliberately mirrors
 * `apps/server/drizzle.config.ts`, but points at the e2e content barrel and
 * emits into an e2e-owned migrations dir, so the harness never depends on the
 * app's collections.
 *
 * `db:generate` (the @orthacms/nx plugin, inferred from this file) runs
 * drizzle-kit against this config. Generation only diffs the schema against the
 * snapshot — it never connects to a database, so no `dbCredentials` is needed.
 * The emitted SQL is applied by `global-setup` via the migrations descriptor
 * that `support/plugins.ts` hands to `ContentPlugin`.
 */
export default defineConfig({
    dialect: 'postgresql',
    schema: './src/support/content/index.ts',
    out: './migrations/content'
});
