import { defineConfig } from 'drizzle-kit';

/**
 * Generation config for the workspaces plugin's schema. `db:generate`
 * (the @orthacms/nx plugin) runs drizzle-kit against this. Generation
 * only diffs the schema against the snapshot — it never connects to a
 * database, so no `dbCredentials` (and no secret) is needed here.
 *
 * The `memberships` table carries a cross-package FK to identity's `users`
 * table; the generated SQL references `users(id)` without creating it (identity
 * owns and migrates that table, applied first by the host's db:migrate).
 */
export default defineConfig({
    dialect: 'postgresql',
    schema: './src/lib/workspace/infrastructure/schema/index.ts',
    out: './migrations'
});
