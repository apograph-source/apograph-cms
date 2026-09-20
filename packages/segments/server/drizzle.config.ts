import { defineConfig } from 'drizzle-kit';

/**
 * Generation config for the segmentation plugin's two tables. `db:generate`
 * (the @orthacms/nx plugin) runs drizzle-kit against this. Generation only
 * diffs the schema against the snapshot — it never connects to a database, so
 * no `dbCredentials` (and no secret) is needed here.
 */
export default defineConfig({
    dialect: 'postgresql',
    schema: './src/lib/schema/index.ts',
    out: './migrations'
});
