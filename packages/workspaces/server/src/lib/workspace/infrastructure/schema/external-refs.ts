import { pgTable, uuid } from 'drizzle-orm/pg-core';

/**
 * Reference-only projection of identity's `users` table, carrying just the
 * `id` column the `memberships` foreign key targets. Identity owns and migrates
 * the real table (with all its columns); this stub exists so that:
 *
 *  - the generated workspaces migration can emit the cross-context FK
 *    `memberships.user_id → users(id)` — the host applies identity's migration
 *    first, so the physical `users` table already exists when this one runs; and
 *  - `drizzle-kit generate` bundles a **pure-Drizzle** schema graph. Importing
 *    identity's runtime barrel (`@orthacms/identity-server`) here would pull
 *    its NestJS providers into drizzle-kit's esbuild pass, which has no
 *    `experimentalDecorators` and fails on their parameter decorators.
 *
 * It is deliberately **not** re-exported from `schema/index.ts`, so drizzle-kit
 * references it only in the FK and never emits a duplicate `CREATE TABLE users`.
 * Runtime queries against users go through identity's real table (see
 * {@link MembershipService}); both objects resolve to the same physical table.
 */
export const users = pgTable('users', {
    id: uuid('id').primaryKey()
});
