import { defineConfig } from 'drizzle-kit';

/**
 * Generation config for the HOST-owned content tables (the code-defined
 * collections in `src/content/collections/` and pages in `src/content/pages/`,
 * aggregated by `src/content/index.ts`). `db:generate` (the @orthacms/nx
 * plugin) runs drizzle-kit against this. Generation only diffs the schema
 * against the snapshot — it never connects to a database, so no
 * `dbCredentials` (and no secret) is needed here. The emitted SQL is
 * applied by `db:migrate` via the migrations descriptor that
 * `ContentPlugin` carries in `src/plugins.ts`.
 */
export default defineConfig({
    dialect: 'postgresql',
    schema: './src/content/index.ts',
    out: './migrations'
});
