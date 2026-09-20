import { sql } from 'drizzle-orm';
import type { Database } from '@orthacms/database';

/**
 * The minimal Drizzle executor the workspace locks need: the root client or an
 * open transaction (both expose `execute`). Kept to `Pick<Database, 'execute'>`
 * so the content plugin can pass its own `tx` when writing an entry.
 */
export type LockExecutor = Pick<Database, 'execute'>;

/**
 * A private lock class (the first `pg_advisory_xact_lock` key) namespacing the
 * per-workspace advisory locks below, so their hashed workspace-id keys can't
 * collide with any other advisory lock the app might take. Arbitrary but fixed.
 */
const WORKSPACE_CONTENT_LOCK_CLASS = 0x574b; // 'WK'

/**
 * Serializes a workspace's "is it empty?" guards (delete / revoke-content)
 * against concurrent entry writes, using a transaction-scoped Postgres advisory
 * lock keyed on the workspace id. The lock auto-releases at commit/rollback.
 *
 * The guards read a count and then mutate; without coordination a create could
 * land between the two and be orphaned (the count-then-write race). Entry
 * **creates** take the lock in *shared* mode (they don't conflict with each
 * other, so writes stay concurrent); delete / revoke take it *exclusive*, so
 * they wait for all in-flight creates and block new ones while they check and
 * mutate. Reader/writer semantics: many creators, one destroyer.
 */
export function lockWorkspaceExclusive(
    executor: LockExecutor,
    workspaceId: string
): Promise<unknown> {
    return executor.execute(
        sql`select pg_advisory_xact_lock(${WORKSPACE_CONTENT_LOCK_CLASS}, hashtext(${workspaceId}))`
    );
}

/** Shared counterpart of {@link lockWorkspaceExclusive}, taken by entry writes. */
export function lockWorkspaceShared(
    executor: LockExecutor,
    workspaceId: string
): Promise<unknown> {
    return executor.execute(
        sql`select pg_advisory_xact_lock_shared(${WORKSPACE_CONTENT_LOCK_CLASS}, hashtext(${workspaceId}))`
    );
}
