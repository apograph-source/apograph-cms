import { sql } from 'drizzle-orm';
import type { Database } from '@orthacms/database';

/**
 * The minimal Drizzle executor the admin lock needs: the root client or an open
 * transaction (both expose `execute`).
 */
export type LockExecutor = Pick<Database, 'execute'>;

/**
 * Stable key for the transaction-scoped advisory lock that serializes the
 * "≥1 active admin" guard. Demotion ({@link Member.changeRole}) and disable
 * ({@link Member.disable}) both count-then-write the admin set; under the
 * default READ COMMITTED isolation two concurrent transactions can read the
 * same count and both pass, dropping it to zero. Taking this lock first — at the
 * load that precedes the guard — makes those sections mutually exclusive. Any
 * stable bigint works as long as it is the same in both paths.
 */
const ACTIVE_ADMIN_LOCK = 0x55534552; // "USER"

/**
 * Serializes the last-admin guard against concurrent demote/disable, using a
 * transaction-scoped Postgres advisory lock. Auto-releases at commit/rollback,
 * so it must be called inside the unit of work — before reading the admin count
 * the guard decides on.
 */
export function lockActiveAdmins(executor: LockExecutor): Promise<unknown> {
    return executor.execute(
        sql`select pg_advisory_xact_lock(${ACTIVE_ADMIN_LOCK})`
    );
}
