import { defineConfig } from 'drizzle-kit';

/**
 * Generation config for the media plugin's schema. `db:generate` (the
 * `@orthacms/nx` plugin) runs drizzle-kit against this; it only diffs the
 * schema against the snapshot and never connects to a database, so no
 * `dbCredentials` (and no secret) is needed here. The host applies the emitted
 * migrations under the `__drizzle_migrations_media` tracking table.
 */
export default defineConfig({
    dialect: 'postgresql',
    schema: './src/lib/infrastructure/schema/index.ts',
    out: './migrations'
});
