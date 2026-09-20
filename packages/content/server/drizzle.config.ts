import { defineConfig } from 'drizzle-kit';

/**
 * Generation config for the **saved-views** schema — the only tables this
 * package owns outright.
 *
 * The content model's own tables are deliberately absent: those are generated
 * from the host's code-defined collections, and the host diffs them with its
 * own `drizzle.config.ts` (see "Migrations are HOST-owned" in AGENTS.md). This
 * config covers the fixed platform tables that ship with the plugin, applied by
 * the host under `__drizzle_migrations_content_views`.
 *
 * `db:generate` (the @orthacms/nx plugin) runs drizzle-kit against this; it only
 * diffs the schema against the snapshot and never connects to a database, so no
 * `dbCredentials` (and no secret) is needed here.
 *
 * `saved_views` carries cross-package FKs to identity's `users` and workspaces'
 * `workspaces`; the generated SQL references them without creating them (both
 * plugins own and migrate those tables, applied first by the host's db:migrate).
 */
export default defineConfig({
    dialect: 'postgresql',
    schema: './src/lib/views/infrastructure/schema/index.ts',
    out: './migrations'
});
