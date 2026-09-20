/**
 * Shared string constants for the Content Library, kept here so route segments,
 * route params, and keyboard keys live in one place instead of being repeated as
 * magic literals across the page, the sidebar, and the plugin factory.
 */

/** Permission required to browse content. Granted to all system roles. */
export const CONTENT_READ = 'content:read';

/** Permission required to create an entry. */
export const CONTENT_CREATE = 'content:create';

/** Permission required to edit an entry's values. */
export const CONTENT_UPDATE = 'content:update';

/** Permission required to publish/unpublish an entry. */
export const CONTENT_PUBLISH = 'content:publish';

/** Permission required to delete/restore an entry. */
export const CONTENT_DELETE = 'content:delete';

/**
 * Permission required to share a saved list view with the whole workspace.
 * Saving a **personal** view needs nothing beyond `content:read` — the gate is
 * on turning one into a navigation item for everyone else.
 */
export const VIEWS_SHARE = 'views:share';

/**
 * Path segment under the workspace shell where the Content Library mounts
 * (`/workspaces/:id/content`). Shared by the plugin's slot contribution and the
 * page's `basePath` so they can never drift apart.
 */
export const CONTENT_SEGMENT = 'content';

/** Sub-route segment for the History pane. */
export const HISTORY_SEGMENT = 'history';

/** Sub-route segment for the Trash pane. */
export const TRASH_SEGMENT = 'trash';

/**
 * Route param holding the selected content type's machine name. Declared in the
 * route as `:${TYPE_PARAM}` and read back via `useParams()`.
 */
export const TYPE_PARAM = 'typeName';

/** Key that, with ⌘/Ctrl, toggles the search command palette. */
export const SEARCH_SHORTCUT_KEY = 'k';

/**
 * Sub-route segment under a collection for the create-entry view
 * (`/workspaces/:id/content/:typeName/new`). A static segment, so React Router
 * ranks it above the `:${ENTRY_PARAM}` route.
 */
export const NEW_SEGMENT = 'new';

/**
 * Route param holding the selected entry's id, under a collection
 * (`/workspaces/:id/content/:typeName/:entryId`).
 */
export const ENTRY_PARAM = 'entryId';

/**
 * Route param holding the entry editor's open tab, the last segment under an
 * entry (`/…/:typeName/:entryId/relations`). Absent means the default tab, so
 * the plain entry URL keeps working and stays the canonical short link.
 */
export const TAB_PARAM = 'tab';

/**
 * The entry editor's tabs, as URL slugs. Tabs are **routes** so the open tab
 * survives a navigation the editor doesn't control — switching locale remounts
 * the editor at the sibling's id, which used to drop the user back on General
 * mid-task.
 */
export const ENTRY_TAB = {
    General: 'general',
    Relations: 'relations',
    Media: 'media',
    /**
     * Who may **read** the entry once it is published — contributed by
     * `@orthacms/segments-admin`. A slug the router knows, declared here rather
     * than by the contributor, because the set is closed: `ENTRY_TAB_SLOT` drops
     * an item naming a slug this list does not carry, since the route table
     * would match the segment while `entryTabFromPath` could not resolve it.
     */
    Access: 'access',
    /**
     * What was **done** to this record and by whom — contributed by
     * `@orthacms/activity-admin`. Declared here for the same reason as Access:
     * the set is closed, because the route table would match a segment
     * `entryTabFromPath` could not resolve.
     *
     * Next to History and deliberately not the same thing: History is the
     * revision timeline (what the words were at each save), which cannot say
     * who published the record, who took it down, or who changed who may read
     * it.
     */
    Activity: 'activity',
    History: 'history'
} as const;

/** Every entry-tab slug, for the route table and for validating the param. */
export const ENTRY_TAB_SLUGS = Object.values(ENTRY_TAB);

/** The tab an entry opens on when the URL names none. */
export const DEFAULT_ENTRY_TAB = ENTRY_TAB.General;

/**
 * Sections of the entry editor's **⋯ menu**, in the order they render. A rule is
 * drawn between non-empty sections, so a contributed item lands in a run of
 * related actions instead of being appended after Delete.
 *
 * `Extras` is where `ENTRY_MENU_SLOT` contributions go by default (the i18n
 * plugin's "all locales" actions); `Danger` is last and stays destructive-only.
 */
export const ENTRY_MENU_GROUP = {
    Save: 'save',
    Publish: 'publish',
    Extras: 'extras',
    Danger: 'danger'
} as const;

/** One `ENTRY_MENU_GROUP` value. */
export type EntryMenuGroup =
    (typeof ENTRY_MENU_GROUP)[keyof typeof ENTRY_MENU_GROUP];

/** The menu's sections in render order — the one place that order is decided. */
export const ENTRY_MENU_GROUP_ORDER: readonly EntryMenuGroup[] = [
    ENTRY_MENU_GROUP.Save,
    ENTRY_MENU_GROUP.Publish,
    ENTRY_MENU_GROUP.Extras,
    ENTRY_MENU_GROUP.Danger
];

/**
 * Query-param name holding a collection table's text search. The records view's
 * URL source of truth (via `useTableUrlState`), alongside `filter`/`page`/
 * `pageSize`.
 */
export const SEARCH_PARAM = 'q';

/**
 * Query-param name holding a collection table's sort: a column id for ascending,
 * or `-`-prefixed for descending (e.g. `text`, `-updatedAt`). Absent means
 * default (insertion) order. The bare-`-` convention keeps the URL unescaped.
 */
export const SORT_PARAM = 'sort';

/**
 * Query-param name pointing at the applied saved view. Holds the view's id, so
 * the link is shareable and Back/Forward switch views like any other navigation.
 *
 * A **pointer**, not the slice: `filter`/`sort`/`pageSize` stay in the URL as
 * themselves, so a link keeps working when the view it names is renamed or
 * deleted, and a hand-edited link is still just a link.
 */
export const VIEW_PARAM = 'view';

/** Default rows-per-page for a collection's records table. */
export const DEFAULT_PAGE_SIZE = 10;

/**
 * Content field type identifiers — the admin mirror of the server's
 * `CONTENT_FIELD_TYPE` (`@orthacms/content-server`). Kept as a local constant
 * (the admin deliberately doesn't import across the server boundary, like its
 * wire types) so every `switch (field.type)` references a named member instead
 * of a bare string literal. Must stay in lock-step with the server set.
 */
export const CONTENT_FIELD_TYPE = {
    Text: 'text',
    RichText: 'richtext',
    Number: 'number',
    Money: 'money',
    Boolean: 'boolean',
    Date: 'date',
    Datetime: 'datetime',
    Select: 'select',
    Multiselect: 'multiselect',
    Json: 'json',
    Relation: 'relation',
    Media: 'media'
} as const;

/**
 * Per-entry verdicts in a bulk-publish dry run — the admin mirror of the
 * server's `BULK_VERDICT` (`@orthacms/content-server`). Drives the icon/label
 * for each row in the {@link BulkPublishDialog}. Must stay in lock-step.
 */
export const BULK_VERDICT = {
    Publishable: 'publishable',
    AlreadyPublished: 'already-published',
    Blocked: 'blocked',
    NotFound: 'not-found'
} as const;

/** Multi-entry collection vs. standalone page — mirror of the server's `kind`. */
export const CONTENT_TYPE_KIND = {
    Collection: 'collection',
    Single: 'single'
} as const;

/** Publish state of an entry on a publishable type. */
export const ENTRY_STATUS = {
    Draft: 'draft',
    Published: 'published'
} as const;

/**
 * Which form the entry editor opens: a blank `create` (`/:type/new`), an existing
 * record `edit` (`/:type/:entryId`), or a `single` page (the type's one entry).
 * Named so the editor and its route adapters reference a member instead of a bare
 * string literal.
 */
export const ENTRY_MODE = {
    Create: 'create',
    Edit: 'edit',
    Single: 'single'
} as const;

/** Which form the entry editor opens (see {@link ENTRY_MODE}). */
export type EntryMode = (typeof ENTRY_MODE)[keyof typeof ENTRY_MODE];

/**
 * The kinds of column the records table can show: a schema `field`, one of
 * the two envelope columns (`status`, `updated`), or an `extension` column
 * contributed through `RECORDS_COLUMN_SLOT`. The discriminant of
 * {@link EntryColumn}.
 */
export const COLUMN_KIND = {
    Field: 'field',
    Status: 'status',
    Updated: 'updated',
    Extension: 'extension'
} as const;

/**
 * Column ids for the platform-owned envelope columns. These double as the
 * `?sort=` column ids and must match the server's sortable whitelist
 * (`createdAt`/`updatedAt`/`status`).
 */
export const ENVELOPE_COLUMN = {
    Status: 'status',
    UpdatedAt: 'updatedAt'
} as const;
