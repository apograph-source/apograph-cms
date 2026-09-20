import { defineConfig } from 'drizzle-kit';

/**
 * Generation config for the copilot plugin's schema. `db:generate` (the
 * `@orthacms/nx` plugin) runs drizzle-kit against this; it only diffs the
 * schema against the snapshot and never connects to a database, so no
 * `dbCredentials` (and no secret) is needed here. The host applies the emitted
 * migrations under the `__drizzle_migrations_copilot` tracking table.
 */
export default defineConfig({
    dialect: 'postgresql',
    // A glob rather than one path: this plugin has more than one slice, and
    // each owns its own tables. A slice added without a line here would
    // typecheck, boot, and then fail on the first query against a table nobody
    // ever generated a migration for.
    schema: './src/lib/*/infrastructure/schema/index.ts',
    out: './migrations'
});
