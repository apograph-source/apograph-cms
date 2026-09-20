import { defineConfig } from 'drizzle-kit';

/**
 * Generation config for the database plugin's schema. `db:generate`
 * (the @orthacms/nx plugin) runs drizzle-kit against this. Generation
 * only diffs the schema against the snapshot — it never connects to a
 * database, so no `dbCredentials` (and no secret) is needed here.
 *
 * This plugin owns exactly one table, the transactional outbox
 * (`outbox_events`) — the sanctioned exception to "database owns no schema".
 */
export default defineConfig({
    dialect: 'postgresql',
    schema: './src/lib/schema/index.ts',
    out: './migrations'
});
