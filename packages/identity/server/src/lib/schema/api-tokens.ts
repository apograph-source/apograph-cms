import {
    index,
    pgEnum,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uuid
} from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Access level a bearer token grants to the external content API.
 * `read` maps to `content:read`; `full` maps to the full content CRUD set.
 * The token carries the scope; the guard turns it into a permission set.
 */
export const apiTokenScope = pgEnum('api_token_scope', ['read', 'full']);

/**
 * Long-lived bearer tokens for the external content API (`/api/v1/...`).
 * Unlike the one-time {@link tokens} (invite/reset), these authenticate a
 * developer/service and are scoped to a **bucket** of workspaces — the join
 * rows in {@link apiTokenWorkspaces}, at least one per token.
 *
 * Only the SHA-256 hash of the raw token is stored, never the raw token —
 * the plaintext is shown to the creator exactly once, on mint. Verification
 * hashes the presented bearer and looks up by {@link apiTokens.tokenHash}
 * (the unique constraint provides the backing index).
 */
export const apiTokens = pgTable('api_tokens', {
    /** Primary key. */
    id: uuid('id').primaryKey().defaultRandom(),
    /** Human label shown in the admin list (e.g. "CI deploy", "Preview app"). */
    name: text('name').notNull(),
    /**
     * SHA-256 hash of the raw token. Unique — verification looks up by this
     * column and two live tokens must not collide.
     */
    tokenHash: text('token_hash').notNull().unique(),
    /**
     * The non-secret leading characters of the raw token (e.g.
     * `orthacms_ab12cd`). Safe to display so an admin can recognise a token
     * in the list without ever seeing the secret again.
     */
    lookupPrefix: text('lookup_prefix').notNull(),
    /** Access level this token grants. */
    scope: apiTokenScope('scope').notNull(),
    /**
     * Absolute expiry. **Null means the token never expires** (unlimited
     * access) — unlike the one-time tokens' NOT NULL expiry.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** The user who minted the token. */
    createdBy: uuid('created_by')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    /** Last time the token authenticated a request (throttled touch). */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    /** Set when revoked; null while the token is live. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow()
});

/**
 * The **workspace bucket** of a token: one row per workspace the token may act
 * in. A token always carries at least one (the API rejects an empty bucket);
 * a token with several is a single credential spanning them, and the public
 * content API picks which one a request targets via `X-Workspace-Id`.
 *
 * `token_id` cascades, so deleting a token can never leave orphan grants.
 * `workspace_id` is a plain uuid with **no** cross-plugin FK — the `workspaces`
 * table belongs to `@orthacms/workspaces-server`, exactly like the
 * `workspace_id` on the generated `content_*` tables; tenancy is enforced in
 * the app layer.
 */
export const apiTokenWorkspaces = pgTable(
    'api_token_workspaces',
    {
        /** The token this grant belongs to. */
        tokenId: uuid('token_id')
            .notNull()
            .references(() => apiTokens.id, { onDelete: 'cascade' }),
        /** A workspace the token may act in. */
        workspaceId: uuid('workspace_id').notNull()
    },
    (table) => [
        // The pair *is* the identity of a grant; its index also serves the
        // "which workspaces does this token cover?" lookup on every verify.
        primaryKey({ columns: [table.tokenId, table.workspaceId] }),
        // The reverse lookup — "which tokens cover this workspace?" — behind
        // the management list's `?workspaceId=` filter.
        index('api_token_workspaces_workspace_id_idx').on(table.workspaceId)
    ]
);
