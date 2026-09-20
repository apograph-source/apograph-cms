import { inArray } from 'drizzle-orm';
import { type Database } from '@orthacms/database';
import { users } from '@orthacms/identity-server';

/**
 * Fallback shown when an uploader can't be resolved **at all** — the account was
 * deleted, so there is no row to read a name or an email from. A user who simply
 * hasn't set a display name is NOT unknown; see below.
 */
export const UNKNOWN_UPLOADER = 'Unknown';

/**
 * Resolves uploader user ids to display labels in one batched query. Media rows
 * store only the uploader's id; the admin shows a label.
 *
 * `users.name` is **nullable** — it stays null until someone sets it (an invite
 * that was never personalized, a root admin provisioned without a `name`), which
 * is the common case, not the edge case. Falling straight through to "Unknown"
 * there told the uploader their own upload had no known author. So the label is
 * `name ?? email`, mirroring `memberMapper`'s rule in the admin, and
 * {@link UNKNOWN_UPLOADER} is reserved for an id with no user row behind it.
 */
export async function resolveUploaderNames(
    db: Database,
    ids: string[]
): Promise<Map<string, string>> {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) {
        return new Map();
    }
    const rows = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, unique));
    return new Map(rows.map((row) => [row.id, row.name?.trim() || row.email]));
}
