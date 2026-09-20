import { and, eq } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { AnyContentType } from '@orthacms/content-server';
import type { AccessExecutor } from '../application/entry-access.service';

/** The locale columns content's table builder adds to an `i18n: true` type. */
type Columns = Record<string, PgColumn | undefined>;

/**
 * Every row of one entry's **locale group**, including the entry itself.
 *
 * Access is not a translated field. "Who may read this" is a fact about the
 * record, not about the German wording of it, so a decision made on one locale
 * has to reach every locale — the same reading content already gives a
 * non-localized field, which i18n propagates to the siblings on save. Left
 * per-row, an editor who restricted the English article published the German one
 * to everyone without ever seeing a screen that said so.
 *
 * **This reads content's own columns, not i18n's service.** `locale` and
 * `locale_group_id` are added by content's table builder when a type declares
 * `i18n: true`, so the group is answerable from the type in hand; going through
 * `@orthacms/i18n-server` would make an entitlement rule depend on a plugin the
 * deployment may not have installed, and the honest fallback there — treat the
 * entry as alone — is the same thing a non-localized type already gets.
 *
 * **Soft-deleted siblings are included, deliberately**, exactly as i18n's own
 * propagation includes them: a locale in the trash comes back on restore, and it
 * must come back with the group's access rather than with whatever it held on
 * the day it was deleted.
 */
export async function localeGroupIds(
    executor: AccessExecutor,
    type: AnyContentType,
    entryId: string,
    workspaceId: string
): Promise<string[]> {
    if (!type.i18n) return [entryId];

    const columns = type.table as unknown as Columns;
    const id = columns['id'];
    const group = columns['localeGroupId'];
    const workspace = columns['workspaceId'];
    // A type that claims `i18n` without the columns cannot happen through the
    // table builder; treating the entry as alone is the safe reading if it ever
    // does, since it changes only this entry rather than an unknown set.
    if (!id || !group || !workspace) return [entryId];

    const [self] = await executor
        .select({ groupId: group })
        .from(type.table)
        .where(eq(id, entryId))
        .limit(1);
    const groupId = self?.groupId as string | undefined;
    if (!groupId) return [entryId];

    const rows = await executor
        .select({ id })
        .from(type.table)
        .where(and(eq(group, groupId), eq(workspace, workspaceId)));

    const ids = rows.map((row) => row.id as string);
    // The entry itself is in the group by construction — unless the write is
    // part of the create that inserted it, where the row is visible on this
    // transaction but a caller could still have handed us an id the query
    // cannot see. Naming it explicitly costs nothing and cannot go wrong.
    return ids.includes(entryId) ? ids : [entryId, ...ids];
}

/**
 * Whether this entry id names a row of **this workspace's** content.
 *
 * Content stamps `workspace_id` on create and filters every one of its own
 * reads and writes by it — its table builder says outright that the isolation
 * lives in the app layer, because there is no foreign key to lean on. A plugin
 * writing against an entry id it was handed therefore has to make the same
 * check, and every write path here but one was outside content's services and so
 * inherited nothing: the admin's `PUT`, the public `PUT`, the MCP tool and an
 * accepted copilot proposal. Only the entry save arrives with an id content has
 * already resolved inside the workspace.
 *
 * It matters more here than the phrase "tenant scoping" usually implies, because
 * the enforcement predicate matches on `entry_id` **alone** — `workspace_id` is
 * carried on `entry_access` for the admin's lists, not consulted by the read. So
 * a row written against a foreign id governs that entry's reads all the same,
 * while the workspace that owns the entry cannot see it.
 *
 * Read on the caller's executor, so it sees a row inserted moments earlier by
 * the same entry save — the create path applies extensions after the insert, in
 * that transaction.
 */
export async function entryBelongsTo(
    executor: AccessExecutor,
    type: AnyContentType,
    entryId: string,
    workspaceId: string
): Promise<boolean> {
    const columns = type.table as unknown as Columns;
    const id = columns['id'];
    const workspace = columns['workspaceId'];
    // Both are base columns every content table gets from the builder. Refusing
    // rather than passing is the safe reading if one is ever absent: the caller
    // is about to decide who may read published content.
    if (!id || !workspace) return false;

    const [row] = await executor
        .select({ id })
        .from(type.table)
        // Soft-deleted rows count: a locale in the trash comes back on restore,
        // and `localeGroupIds` deliberately writes to it for the same reason.
        .where(and(eq(id, entryId), eq(workspace, workspaceId)))
        .limit(1);
    return Boolean(row);
}
