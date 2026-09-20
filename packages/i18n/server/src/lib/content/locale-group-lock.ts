import { sql } from 'drizzle-orm';
import type { Database } from '@orthacms/database';

/**
 * The minimal Drizzle executor the group lock needs: the root client or an
 * open transaction (both expose `execute`). Mirrors
 * `@orthacms/workspaces-server`'s `LockExecutor`, so content-server can pass
 * the entry write's own `tx` straight through.
 */
export type LockExecutor = Pick<Database, 'execute'>;

/**
 * A private lock class (the first `pg_advisory_xact_lock` key) namespacing the
 * per-translation-group advisory lock below, so its hashed group-id key can't
 * collide with any other advisory lock the app takes (workspace content `WK`,
 * revision append `RE`, relation append `RL`). Arbitrary but fixed.
 */
const LOCALE_GROUP_LOCK_CLASS = 0x4c47; // 'LG'

/**
 * Serializes writes across the members of one translation group, using a
 * transaction-scoped Postgres advisory lock keyed on the `locale_group_id`.
 * The lock auto-releases at commit/rollback.
 *
 * **Why an advisory lock rather than ordering the row locks.** The shared-field
 * sync locks every sibling `FOR UPDATE`, and ordering *that* statement does not
 * make the group deadlock-free: by the time the sync runs, the transaction
 * already holds a row lock on the entry being saved, taken by the entries
 * pipeline's own `UPDATE` before any i18n code ran. Two concurrent saves on two
 * locales of one record therefore each hold a row the other is about to
 * request, whatever order the sibling `SELECT … FOR UPDATE` uses — Postgres
 * detects the cycle and aborts one with `deadlock detected` (SQLSTATE 40P01),
 * which reaches the client as a 500 on an ordinary save.
 *
 * Taking this lock from the extension's `beforeWrite` hook — the first
 * statement in the write transaction, ahead of the row `UPDATE` — imposes a
 * total order on the group instead: the second saver waits at the lock, and by
 * the time it proceeds the first has committed and released every row. Waiting
 * is the correct outcome for two edits to one record; deadlocking is not.
 *
 * Exclusive rather than shared because every taker is a writer: a save reaches
 * here only when it has shared columns or a syncing relation to propagate.
 */
export function lockLocaleGroup(
    executor: LockExecutor,
    localeGroupId: string
): Promise<unknown> {
    return executor.execute(
        sql`select pg_advisory_xact_lock(${LOCALE_GROUP_LOCK_CLASS}, hashtext(${localeGroupId}))`
    );
}
