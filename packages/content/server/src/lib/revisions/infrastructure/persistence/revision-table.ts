import {
    index,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    unique,
    uuid
} from 'drizzle-orm/pg-core';

/**
 * The **generic** entry-revision store — one immutable snapshot per save, for
 * every content type (mirroring the generic `EntryWriterService` engine, which
 * backs every type with no per-aggregate table). A revision captures the whole
 * document — scalar values, localized + shared fields, single-relation FKs, and
 * the ordered many/inverse link sets — as a JSON `snapshot`, so a version can be
 * reconstructed or restored independently of the live `content_<name>` row.
 *
 * Like every `content_<name>` table, this is **HOST-owned**: content-server
 * emits no migrations. The table is defined here (and re-exported from the
 * decorator-free `@orthacms/content-server/define` barrel) so the host's
 * drizzle-kit schema entry can re-export it into the migration diff, while the
 * persistence layer imports the same object directly. It is scoped to a
 * workspace and keyed **per-locale** (`entry_id` is the live row, one per
 * locale), so each translation carries its own version timeline.
 */
export const contentEntryRevisions = pgTable(
    'content_entry_revisions',
    {
        /** Revision id. */
        id: uuid('id').primaryKey().defaultRandom(),
        /** Owning workspace — every read/write AND-s it in. */
        workspaceId: uuid('workspace_id').notNull(),
        /** The registry content-type machine name (`article`, `home_page`…). */
        contentType: text('content_type').notNull(),
        /** The live `content_<name>` row this revision belongs to (per-locale). */
        entryId: uuid('entry_id').notNull(),
        /** The row's translation-group id — null on non-i18n types. */
        localeGroupId: uuid('locale_group_id'),
        /** The row's locale — null on non-i18n types. */
        locale: text('locale'),
        /** Monotonic version number within one `entry_id` (1-based). */
        revisionNumber: integer('revision_number').notNull(),
        /** `draft` · `published` · `superseded`. */
        status: text('status').notNull(),
        /** The full document snapshot — `{ values, relations }`. */
        snapshot: jsonb('snapshot').notNull(),
        /** The acting user's id (identity), or null when unknown. */
        createdBy: uuid('created_by'),
        /** When the version was captured. */
        createdAt: timestamp('created_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
        /** When this revision was published; null until then. */
        publishedAt: timestamp('published_at', { withTimezone: true })
    },
    (table) => [
        // One number per entry — the store allocates `max + 1` under the
        // entry's advisory lock, and this backstops a concurrent double-insert
        // with a 23505 rather than a silent duplicate version.
        unique('content_entry_revisions_entry_number_uq').on(
            table.entryId,
            table.revisionNumber
        ),
        // The timeline read: newest-first for one entry.
        index('content_entry_revisions_entry_idx').on(
            table.entryId,
            table.revisionNumber
        ),
        // Workspace-scoped browsing across a type.
        index('content_entry_revisions_workspace_idx').on(
            table.workspaceId,
            table.contentType
        )
    ]
);
