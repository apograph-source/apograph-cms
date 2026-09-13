/**
 * The Content Library's **extension slots** — the named seams another admin
 * plugin (e.g. `@apograph/i18n-admin`) contributes UI and behavior into,
 * with no coupling beyond these contracts. Mirrors the workspace shell's
 * `WORKSPACE_SIDEBAR_SLOT` idiom: this package declares and renders the
 * slots; contributors register items via their `AdminPlugin.slots`.
 *
 * **Hook-style items** (`useRowsData`, `useFields`): the render sites call
 * these inside a loop over `slot.getItems()`. That is rules-of-hooks-safe
 * ONLY because slot registration is boot-frozen — `createAdmin` registers
 * every contribution once, before the first render, and the list never
 * changes afterwards — so the call order is stable across renders. The render
 * sites call every registered item's hook on every render (never behind a
 * condition); an item must gate its own fetching internally (e.g. TanStack
 * Query `enabled`) rather than expect to be skipped.
 */

import type { ComponentType, ReactNode } from 'react';
import type { MessageDescriptor } from 'react-intl';
import { createSlot } from '@apograph/utils-admin';
import type { FilterField } from '@apograph/query-builder-admin';
import type {
    ContentField,
    ContentTypeDetail,
    EntryRecord,
    MediaRef
} from '../../../domain/types/contentType';
import type { EntryMenuGroup, EntryMode } from '../../../domain/constants';

/** Context handed to a {@link RecordsToolbarItem}'s component. */
export type RecordsToolbarContext = {
    /** The open collection's full schema. */
    schema: ContentTypeDetail;
    /** The open workspace's id. */
    workspaceId: string;
    /**
     * Current URL values of this item's {@link RecordsToolbarItem.listParamKeys},
     * keyed by param name (undefined = absent).
     */
    params: Record<string, string | undefined>;
    /**
     * Merge params into the URL (undefined deletes a key) and reset the page —
     * the same semantics as the search/filter controls.
     */
    updateParams: (next: Record<string, string | undefined>) => void;
};

/** One records-toolbar contribution (e.g. a locale switcher). */
export type RecordsToolbarItem = {
    /** Stable id (used as the React key). */
    id: string;
    /**
     * URL query params this item owns. Their current values are forwarded to
     * the records list request verbatim (and ride the query key), and are
     * handed back via {@link RecordsToolbarContext.params}.
     */
    listParamKeys?: string[];
    /** The control to render in the records toolbar's actions row. */
    Component: ComponentType<RecordsToolbarContext>;
};

/**
 * Toolbar add-ons in the collection records view, rendered in the toolbar's
 * actions row (after the column picker and filters).
 */
export const RECORDS_TOOLBAR_SLOT = createSlot<RecordsToolbarItem>(
    'content.records.toolbar'
);

/** Context handed to a {@link RecordsColumnItem}'s cell. */
export type RecordsColumnCellContext = {
    /** The row's record. */
    entry: EntryRecord;
    /** Whatever this item's {@link RecordsColumnItem.useRowsData} returned. */
    data: unknown;
    /** Absolute path to the open type (`/workspaces/:id/content/:typeName`). */
    typePath: string;
};

/** One extension table column (e.g. a per-record locales overview). */
export type RecordsColumnItem = {
    /** Stable id — also the column id in the picker. Must not collide with a field name. */
    id: string;
    /** Column header / picker label. */
    label: MessageDescriptor;
    /** Whether the column applies to this type (drives its picker presence). */
    appliesTo: (schema: ContentTypeDetail) => boolean;
    /**
     * Optional hook run once per records-table render with the current page's
     * rows — the place to batch-load per-page data (one request per page, not
     * per row). Called for **every** registered item on every render (see the
     * module JSDoc); gate fetching internally when not applicable.
     *
     * `isVisible` says whether the user actually has this column switched on.
     * It has to be a parameter rather than a wrapper around the call, because
     * the hook must run unconditionally to keep hook order stable — so the
     * item is the only place the decision can be made. **Honour it**: every
     * extension column is hidden by default, so without it a column nobody
     * enabled still issues its batch request on every page of every records
     * list, for data that is never rendered.
     */
    useRowsData?: (
        entries: EntryRecord[],
        schema: ContentTypeDetail,
        workspaceId: string,
        isVisible: boolean
    ) => unknown;
    /** The cell renderer. */
    Cell: ComponentType<RecordsColumnCellContext>;
};

/**
 * Extension columns for the collection records table. An applicable column
 * joins the column picker like any schema column (toggle + reorder), hidden
 * by default. Extension columns are not sortable (the server's sort
 * whitelist doesn't know them).
 */
export const RECORDS_COLUMN_SLOT = createSlot<RecordsColumnItem>(
    'content.records.columns'
);

/**
 * Context handed to entry-editor slot items — the sidebar widgets and the
 * relation picker's param contributions. Assembled by `ContentEntryView`.
 */
export type EntrySlotContext = {
    /** The open type's full schema. */
    schema: ContentTypeDetail;
    /** The record being edited; undefined while creating. */
    entry?: EntryRecord;
    /** Whether the editor is a blank create form. */
    isCreate: boolean;
    /** Which editor mode is open (create / edit / single). */
    mode: EntryMode;
    /** The open workspace's id. */
    workspaceId: string;
    /** Absolute path to the open type (`/workspaces/:id/content/:typeName`). */
    typePath: string;
    /**
     * Current URL values of the {@link ENTRY_PARAMS_SLOT} keys (list +
     * create-body), keyed by param name (`undefined` when absent). Opaque — a
     * slot reads only its own keys (e.g. i18n scopes the relation picker by its
     * `locale` even on a create form, where there's no saved `entry`).
     */
    params: Record<string, string | undefined>;
    /**
     * The open tab as a path segment to append when linking to *another* record
     * in this same editor — `'/relations'`, or `''` on the default tab. A slot
     * that navigates the user to a sibling record (the i18n plugin's locale
     * switch) appends it so the reader lands on the tab they were working in
     * instead of being dropped back on General.
     */
    tabSegment: string;
};

/** One entry-sidebar widget contribution (a section of the Properties rail). */
export type EntrySidebarWidgetItem = {
    /** Stable id (used as the React key). */
    id: string;
    /**
     * The widget, rendered below the Revisions block. The rail is **one flat
     * panel** whose blocks are separated by dividers, so a widget should render
     * the exported `EntrySidebarSection` (and `EntrySidebarRow`) rather than a
     * card of its own — otherwise it is the one floating box in the panel.
     */
    Component: ComponentType<EntrySlotContext>;
};

/** Sections appended to the entry editor's Properties rail. */
export const ENTRY_SIDEBAR_WIDGET_SLOT = createSlot<EntrySidebarWidgetItem>(
    'content.entry.sidebar'
);

/** One entry-header contribution (an inline element beside the editor title). */
export type EntryHeaderItem = {
    /** Stable id (used as the React key). */
    id: string;
    /** Rendered in the title row, to the right of the `<h1>` (e.g. a chip). */
    Component: ComponentType<EntrySlotContext>;
};

/**
 * Inline add-ons in the entry editor's title row, rendered after the `<h1>`
 * (e.g. the i18n plugin's current-locale chip). The heading stays the sole
 * `<h1>`; contributions are siblings beside it.
 */
export const ENTRY_HEADER_SLOT = createSlot<EntryHeaderItem>(
    'content.entry.header'
);

/**
 * What a contribution may add to the publish it lets through.
 *
 * `bypass` is carried to the publish request as is, for the server's
 * `CONTENT_PUBLISH_GUARD` registrations to judge. Content does not interpret
 * it — the same discipline the server-side use-case keeps.
 */
export type EntryPublishOptions = {
    bypass?: boolean;
};

/**
 * The way through a refusal, when the contribution offers one.
 *
 * Content keeps the primary button looking and reading exactly as an ordinary
 * **Publish** — the refusal is explained by the ceremony the click opens, not by
 * restyling the control — and hands the click over. Whatever comes first (a
 * dialog naming a rule, a mandatory reason) belongs to the contribution, which
 * is the only party that knows there is any.
 *
 * The contribution publishes by calling `publish`, which runs the editor's own
 * publish — client validation, saving anything unsaved (or creating the record
 * on a create form), the busy cover, the toasts — with its options attached.
 * Publishing any other way would skip the edits on screen, and on a create form
 * there would be no record to publish at all.
 */
export type EntryPublishAction = {
    /** Ran instead of the publish. */
    onSelect: (publish: (options: EntryPublishOptions) => void) => void;
};

/**
 * The editor's state a verdict may depend on beyond the {@link EntrySlotContext}.
 */
export type EntryPublishGuardState = {
    /**
     * Whether the form holds unsaved changes, which Publish saves first. A save
     * writes a new version, and a guard whose verdict is bound to a version —
     * an approval rule — has to answer for that one rather than the stored one.
     */
    dirty: boolean;
};

/** What a {@link EntryPublishGuardItem} reports about the open entry. */
export type EntryPublishVerdict = {
    /** Whether publishing is refused. */
    blocked: boolean;
    /**
     * Why — one short sentence, already localized. Rendered as the button's
     * tooltip **and** voiced as its description, so it reaches a reader who
     * never hovers. Required in practice whenever `blocked`; a refusal with
     * nothing to say is a dead button.
     */
    reason?: string;
    /** Offered when the person may proceed anyway. See {@link EntryPublishAction}. */
    action?: EntryPublishAction;
    /**
     * An overlay (a dialog) the action opens, rendered **outside** the actions
     * cluster — the same rule `ENTRY_MENU_SLOT` items follow, and here for a
     * second reason: the button it hangs off is re-rendered as the verdict
     * changes, and a dialog mounted inside it would close with it.
     */
    overlay?: ReactNode;
};

/** One contribution to the entry editor's publish decision. */
export type EntryPublishGuardItem = {
    /** Stable id (used as the React key). */
    id: string;
    /**
     * Hook, mounted once per `EntryActions` render and called unconditionally
     * in slot order — rules-of-hooks-safe for the reason every hook-style item
     * here is (slot items are boot-frozen). Return `null` for "no opinion",
     * which is how a contribution stays silent **without skipping its hook**.
     */
    useVerdict: (
        context: EntrySlotContext,
        state: EntryPublishGuardState
    ) => EntryPublishVerdict | null;
};

/**
 * Contributions to the entry editor's **publish decision** — the admin-side
 * counterpart of content-server's `CONTENT_PUBLISH_GUARD` port, and the same
 * division of labour.
 *
 * A contribution reports that publishing is refused, why, and optionally the way
 * through. It does **not** draw a button: `EntryActions` keeps rendering the
 * primary control, because it already computes the publish gate's half of that
 * button's state and a second component drawing a second button would drift from
 * the first on every state neither of them owns alone.
 *
 * Content learns nothing about *what* refused it. It receives a sentence to show
 * and, when offered, a label and a callback — which is what lets
 * `@apograph/protection-server`'s admin half supply an approval rule, its
 * bypass dialog and its audit row without a word of any of it reaching here.
 *
 * **The first refusal wins**, mirroring the server port: later guards are still
 * *asked* (they are hooks — skipping one would change the call order between
 * renders) but their verdicts are not read.
 *
 * With nothing registered the button is exactly what the publish gate alone made
 * it — invariant `protection:I-03`, pinned by `EntryActions`' own spec, because
 * an empty slot is the state this seam spends almost all of its life in and
 * nothing else would record that it was a decision.
 */
export const ENTRY_PUBLISH_GUARD_SLOT = createSlot<EntryPublishGuardItem>(
    'content.entry.publishGuard'
);

/** One always-mounted overlay contribution for the content library. */
export type ContentOverlayItem = {
    /** Stable id (used as the React key). */
    id: string;
    /**
     * Rendered once at the library's page level, taking no props. Mount only
     * viewport-level chrome here (a portalled cover) — this renders on **every**
     * content route, so anything view-specific belongs in a narrower slot.
     */
    Component: ComponentType;
};

/**
 * Viewport-level overlays for the content library, rendered by
 * `ContentLibraryPage` **outside** its routes — so a contribution stays mounted
 * across every navigation *within* the library, including the window where an
 * entry editor has unmounted itself for its loading state.
 *
 * That window is the whole reason this slot exists. The i18n plugin's
 * locale-switch cover used to be rendered by the editor's sidebar widget, which
 * is inside the very tree that unmounts while the destination record loads: the
 * cover vanished mid-transition, exposing the editor's spinner, then came back
 * when the editor re-rendered — two loaders blinking in sequence. A cover has to
 * outlive the thing it is covering.
 */
export const CONTENT_OVERLAY_SLOT =
    createSlot<ContentOverlayItem>('content.overlay');

/** One filter-fields contribution for the records query-builder drawer. */
export type RecordsFilterFieldsItem = {
    /** Stable id. */
    id: string;
    /**
     * Hook returning extra {@link FilterField}s for the type, appended after
     * the schema-derived ones. Return `[]` when not applicable. Called for
     * every registered item on every render (see the module JSDoc).
     */
    useFields: (schema: ContentTypeDetail) => FilterField[];
};

/** Extra query-builder filter fields for the records view. */
export const RECORDS_FILTER_FIELDS_SLOT = createSlot<RecordsFilterFieldsItem>(
    'content.records.filterFields'
);

/**
 * Non-visual param plumbing for the entry editor. Lets a contributor thread
 * its own wire params through flows this package owns, without owning any UI
 * in them.
 */
export type EntryParamsItem = {
    /** Stable id. */
    id: string;
    /**
     * URL query params forwarded to the **single**-mode one-entry read (a
     * single resolves its row via the list endpoint; these scope that read).
     */
    listParamKeys?: string[];
    /**
     * URL query params copied verbatim into the **create** body. Each key
     * must be declared on the server's `SaveEntryDto` — the strict
     * ValidationPipe rejects unknown body keys.
     */
    createBodyKeys?: string[];
    /**
     * Extra list params for a relation picker's candidate query (e.g. scope
     * candidates to the source entry's locale). Return `{}` to add nothing.
     */
    relationCandidateParams?: (
        targetSchema: ContentTypeDetail,
        source: EntrySlotContext
    ) => Record<string, string>;
};

/** Entry-editor param plumbing contributions. */
export const ENTRY_PARAMS_SLOT = createSlot<EntryParamsItem>(
    'content.entry.params'
);

/**
 * The minimal form bridge an {@link EntryTabItem} needs to render controls bound
 * to the editor's shared form — so a contributed tab (e.g. the Media tab) edits
 * the same `values` the built-in tabs do. A field edited on a slot tab rides
 * Save, the Changed badge, the publish gate, and the server-422 mapping exactly
 * like a General-tab field, because it's the same form state.
 */
export type EntryTabForm = {
    /** The current form values, keyed by field name. */
    values: Record<string, unknown>;
    /** The (localized) validation error for a field, if any. */
    errorFor: (field: string) => string | undefined;
    /** Set a field's value. */
    setValue: (field: string, value: unknown) => void;
    /** Mark a field touched (so its error may show). */
    touch: (field: string) => void;
    /** Whether a field holds an unsaved edit (drives the Changed badge). */
    isFieldDirty: (field: string) => boolean;
};

/** Context handed to a {@link EntryTabItem}'s tab panel — slot context + form. */
export type EntryTabContext = EntrySlotContext & {
    /** Form bridge for rendering controls bound to the editor's values. */
    form: EntryTabForm;
    /**
     * Whether the editor is a **read-only preview** — the reader may see this
     * record but not change it (no `content:update`, or no `content:create` on a
     * create form). A contributed tab **must** honour it: show the field's
     * current value and drop every write affordance it owns (pickers, upload
     * triggers, remove/reorder controls). The server refuses the write either
     * way; a tab that still accepts input just loses the user's work at Save.
     */
    readOnly: boolean;
    /**
     * The saved entry's media fields resolved to display refs (name / thumbnail
     * url / kind), keyed by field name — so a tab can label pre-existing assets
     * without re-fetching. Empty while creating, or when no media resolver is
     * bound. Freshly picked/uploaded assets aren't here (the tab tracks those
     * from the picker); a thumbnail always renders from the id regardless.
     */
    mediaRefs: Record<string, MediaRef[]>;
    /**
     * Whether {@link EntryTabContext.mediaRefs} is still loading (or failed).
     * A tab that renders a ref-backed thumbnail needs to tell "not resolved
     * **yet**" from "resolved to nothing": the first is a placeholder, the
     * second is a real absence it should stop waiting on.
     */
    mediaRefsPending: boolean;
    /**
     * The {@link EntryPresave.handle}s of every presave contribution, keyed by
     * item id — opaque, and a tab reads only its own key. It is how a tab reaches
     * state mounted above it (staged uploads survive a tab switch; the tab body
     * does not).
     */
    presave: Record<string, unknown>;
};

/**
 * One entry-editor tab contribution. A contributed tab renders after the
 * built-in General/Relations tabs and before History, ordered by {@link order}.
 * Its {@link slug} MUST be a known editor tab slug (`ENTRY_TAB_SLUGS`) so the
 * route table and the tab-from-path resolver accept it. The tab appears only
 * when {@link appliesTo} returns true for the open type (e.g. the Media tab only
 * when the type has media fields).
 */
export type EntryTabItem = {
    /** Stable id (React key). */
    id: string;
    /** URL tab segment — must be one of `ENTRY_TAB_SLUGS`. */
    slug: string;
    /** Tab trigger label. */
    label: MessageDescriptor;
    /** Sort order among contributed tabs (ascending). */
    order: number;
    /** Whether this tab applies to the open type. */
    appliesTo: (schema: ContentTypeDetail) => boolean;
    /** The tab panel, rendered with the editor's slot + form context. */
    Component: ComponentType<EntryTabContext>;
};

/**
 * Extra tabs in the entry editor (e.g. the media plugin's Media tab). Declared
 * here and rendered by `EntryEditor`; contributors register items via their
 * `AdminPlugin.slots`. Boot-frozen like every slot, so the tab set is stable
 * across renders.
 */
export const ENTRY_TAB_SLOT = createSlot<EntryTabItem>('content.entry.tabs');

/** What an {@link EntryMenuItem} renders as, once its hook has run. */
export type EntryMenuEntry = {
    /** The item's label. */
    label: ReactNode;
    /** Leading icon, as any other menu item carries. */
    icon?: ComponentType;
    /** Render it disabled (e.g. while its own request is in flight). */
    disabled?: boolean;
    /** Style it as destructive — reserve for the `danger` group. */
    destructive?: boolean;
    /** Run the action. Selecting an item always closes the menu. */
    onSelect: () => void;
    /**
     * A dialog or other overlay this item owns. Rendered **outside** the menu,
     * so it survives the menu closing — which is precisely when it needs to
     * appear. Keep it mounted and drive it from your own state.
     */
    overlay?: ReactNode;
};

/** One contributed item in the entry editor's ⋯ menu. */
export type EntryMenuItem = {
    /** Stable id (used as the React key). */
    id: string;
    /** Which section it renders in; sections are separated by a rule. */
    group: EntryMenuGroup;
    /** Sort within the group. */
    order: number;
    /** Limit the item to certain types; omitted = every type. */
    appliesTo?: (schema: ContentTypeDetail) => boolean;
    /**
     * Resolves the item for the open editor — **a hook**, called once per item
     * per render (boot-frozen slots, so the order is stable; see this module's
     * header). It is a hook and not static data because a real item needs
     * queries, `useHasPermission`, and its own dialog state. Return `null` to
     * render nothing — that is how an item hides itself without skipping the
     * hook.
     */
    useItem: (context: EntrySlotContext) => EntryMenuEntry | null;
};

/**
 * Extra actions in the entry editor's **⋯ menu**, beside the built-in Save /
 * Publish / Delete. Grouped by {@link ENTRY_MENU_GROUP} and rendered by
 * `EntryActions`, which also renders each item's `overlay` outside the menu.
 * `@apograph/i18n-admin` fills it with **Publish all locales** / **Unpublish
 * all locales**.
 */
export const ENTRY_MENU_SLOT = createSlot<EntryMenuItem>('content.entry.menu');

/**
 * What the write turned out to be, handed to {@link EntryPresave.settle}.
 *
 * A step that has to write **against the record** — rather than only rewrite the
 * values on their way in — can only do it here: on a create there is no id until
 * the row exists, and `commit` runs before it does.
 */
export type EntryPresaveResult = {
    /** The record as the write returned it — on a create, the row that now exists. */
    entry: EntryRecord;
    /** The type it was saved against. */
    schema: ContentTypeDetail;
    /** Whether this write created the record. */
    created: boolean;
    /** Whether the record is live after this write. */
    published: boolean;
};

/**
 * One plugin's participation in the **save itself** — work that must happen
 * between "the user pressed Save/Publish" and the write, plus the state that
 * work is staged in.
 */
export type EntryPresave = {
    /**
     * Runs inside the save, after client validation and **before** the write,
     * with the values about to be sent; returns the values to actually save.
     * The media plugin uploads the files staged on media fields here and swaps
     * their placeholder ids for the real asset ids — so nothing is uploaded
     * until the record is saved. Throwing **aborts the save**: nothing is
     * written and the editor stays put, so the step owns surfacing its own
     * failure (a toast naming the file).
     */
    commit: (input: {
        values: Record<string, unknown>;
        publish: boolean;
    }) => Promise<Record<string, unknown>>;
    /**
     * State this plugin wants stored **alongside** the entry, read just before
     * the write and sent in the save body's `extensions` bag under the returned
     * keys — each of which must be an extension the server has registered
     * (`@apograph/segments-server` registers `access`).
     *
     * This is how a plugin's own state rides the entry's Save rather than a
     * second request of its own, and it is not merely tidier: the server writes
     * it inside the save's transaction and the revision that save appends
     * captures it, so the entry cannot land with the plugin's half missing and
     * "restore version 3" puts back version 3's state along with its words.
     *
     * Return `undefined` (or an empty object) when there is nothing staged —
     * an omitted key is left untouched by the server, which is what an editor
     * who never opened the plugin's tab must get.
     */
    extensions?: () => Record<string, unknown> | undefined;
    /**
     * Called after the write succeeded — to drop whatever `commit` consumed, and
     * to do the work that needed the saved record. It is **awaited**, still under
     * the busy cover, so a step may finish a write of its own here: that is how
     * `@apograph/segments-admin` applies an entry's audiences on Save, which is
     * impossible from `commit` because a create has no id yet.
     *
     * The entry is already written by the time this runs, so throwing cannot
     * abort anything — a step owns surfacing its own failure (and leaving its
     * staging in place so the next Save retries it), exactly as `commit` does.
     */
    settle?: (result: EntryPresaveResult) => void | Promise<void>;
    /**
     * Opaque handle published to contributed tabs as
     * `EntryTabContext.presave[id]`. This is how a tab's controls reach staging
     * state that has to **outlive the tab body**: editor tabs are routes, so the
     * panel unmounts the moment the user switches tab, while this hook is
     * mounted by the entry view for the editor's whole life. A slot reads only
     * its own key (same contract as `EntrySlotContext.params`).
     */
    handle?: unknown;
};

/** A contribution to the entry save. See {@link EntryPresave}. */
export type EntryPresaveItem = {
    /** Stable id — also the key its `handle` is published under. */
    id: string;
    /**
     * Hook mounted **once per entry view**, for the editor's whole life. Called
     * unconditionally in slot order, which is rules-of-hooks-safe because slot
     * items are boot-frozen (the same guarantee `RECORDS_COLUMN_SLOT.useRowsData`
     * relies on).
     */
    usePresave: () => EntryPresave;
};

/**
 * Contributions to the entry **save**: an async step run before the write, and
 * the staging state behind it. Mounted by `ContentEntryView` (which owns the
 * busy overlay covering the whole write, uploads included).
 */
export const ENTRY_PRESAVE_SLOT = createSlot<EntryPresaveItem>(
    'content.entry.presave'
);

/** One side of a revision comparison, for a {@link RevisionExtraItem}. */
export type RevisionExtraValueContext = {
    /**
     * What that version recorded under this item's `key`, verbatim — or
     * `undefined` when it recorded nothing.
     *
     * `undefined` is genuinely "this version knows nothing about it", not "it was
     * empty": versions captured before the plugin was installed carry no bag at
     * all, and a restore leaves an unmentioned key alone. Render it as absence,
     * never as a claim.
     */
    value: unknown;
};

/** One contributed row in the revision preview, for plugin-owned snapshot state. */
export type RevisionExtraItem = {
    /**
     * The snapshot `extra` key this item renders — the same key the plugin's
     * server-side entry-write extension is registered under (`access`).
     */
    key: string;
    /** The row's label. */
    label: MessageDescriptor;
    /**
     * Renders **one side's** value. The two-column Current → Version {n} layout,
     * the "Changed" badge, and the unchanged-set collapse stay with content, for
     * the reason `ENTRY_FIELD_CONTROL_SLOT` keeps the label row: a contributed
     * renderer that drew its own chrome would drift from every built-in row in
     * the same dialog.
     */
    Component: ComponentType<RevisionExtraValueContext>;
};

/**
 * Rows in the entry editor's **revision preview** for state a plugin stores
 * alongside the entry rather than in its values — what content-server's
 * entry-write extensions record in `RevisionSnapshot.extra`.
 * `@apograph/segments-admin` fills it with the entry's audiences, so "what would
 * restoring this version change" includes who could read it.
 *
 * Whether the two sides differ is decided by content (a structural compare of
 * the raw values), not by the item — so a plugin cannot accidentally report a
 * version as identical when a restore would change it.
 */
export const REVISION_EXTRA_SLOT = createSlot<RevisionExtraItem>(
    'content.revision.extra'
);

/**
 * Context handed to an {@link EntryFieldControlItem}'s control — one field's
 * slice of the entry form, already resolved by `EntryFieldInput`.
 *
 * A control renders **only the input surface**. The label row (label, required
 * mark, Changed badge, localized globe), the description, and the error message
 * stay with `EntryFieldInput`, so a contributed control can't drift from the
 * built-in ones on any of it. Fully controlled, exactly like the built-ins: the
 * form owns `value`/`error`, the control reports edits through `onChange`.
 */
export type EntryFieldControlContext = {
    /** The field being rendered (type, validation, `admin` hints). */
    field: ContentField;
    /**
     * The DOM id the rendered `<FieldLabel htmlFor>` points at. The control
     * MUST put it on whatever element the label names — the focusable one, not
     * a wrapper — or clicking the label lands nowhere.
     */
    id: string;
    /** The resolved display label (the `admin.label`, else the humanized name). */
    label: string;
    /** The field's current form value. */
    value: unknown;
    /** The field's localized validation error, when it has one. */
    error?: string;
    /**
     * The id of the rendered `<FieldError>`, or `undefined` when valid. Spread
     * onto the focusable element as `aria-describedby` so the error is read on
     * focus, not only when it appears.
     */
    describedBy?: string;
    /** Report an edit (the form marks the field dirty). */
    onChange: (value: unknown) => void;
    /** Mark the field touched, so its error may show. */
    onBlur?: () => void;
    /**
     * Whether the editor is a **read-only preview** — the reader may see this
     * record but not change it (no `content:update`, or no `content:create` on a
     * create form). A contributed control **must** honour it: render the value,
     * accept no input, and drop its own write affordances (pickers, upload
     * triggers, toolbars). The built-in controls do the same, and the server
     * refuses the write regardless — but a control that still takes typing lets
     * the user do work that is thrown away at Save.
     */
    readOnly: boolean;
    /**
     * The row's locale on a localized type — a **BCP-47 language tag** by the
     * i18n plugin's wire contract, so a control can put it straight on the
     * element that renders the value as `lang`.
     *
     * The form row already carries it: `EntryFieldSections` wraps the whole
     * Translated group in `lang` + `dir="auto"`, and a `Component` rendered
     * inside that group inherits both. A `FullView` does **not** — it is
     * rendered in place of the tab strip, outside the group — so an expanded
     * control has to set it itself, or a German body is announced with English
     * pronunciation rules under the admin's `<html lang="en">` (WCAG 3.1.2).
     *
     * `undefined` on a type with no locales. It is the *row's* language, not the
     * field's: apply it only to a field the schema marks `localized`, since a
     * shared field holds one value for every locale.
     */
    contentLocale?: string;
    /**
     * Whether this field currently **owns the editor's work area** — the
     * expanded view described on {@link EntryFieldControlItem.FullView}. Always
     * `false` for an item that declares no `FullView`.
     */
    expanded: boolean;
    /**
     * Take the work area over for this field, or hand it back. A no-op for an
     * item with no `FullView` — there would be nothing to show.
     *
     * At most one field is expanded at a time; expanding a second collapses the
     * first.
     */
    setExpanded: (next: boolean) => void;
};

/** One contributed field control (e.g. the WYSIWYG plugin's rich-text editor). */
export type EntryFieldControlItem = {
    /** Stable id (used as the React key). */
    id: string;
    /**
     * Whether this item owns the given field's control. The **first** matching
     * item wins, in registration order — so a plugin registered later never
     * silently steals a field a earlier one already claimed. Keep the predicate
     * narrow (a field type, plus an `admin.widget` opt-out); a broad one takes
     * over fields the plugin was never meant to render.
     */
    appliesTo: (field: ContentField) => boolean;
    /** The input surface, rendered inside the standard `Field` wrapper. */
    Component: ComponentType<EntryFieldControlContext>;
    /**
     * An **expanded** editing surface for the field, for a control that needs
     * far more room than a form row — a rich-text body, a code editor, a canvas.
     *
     * `EntryEditor` renders it in place of the **tab strip**, filling the work
     * area, once the control calls `setExpanded(true)`. The record's title row
     * stays above it and the surrounding chrome is untouched: the app sidebar,
     * the top bar's Save / Publish actions, and the Properties rail all keep
     * working — because the expanded view is still inside the editor's form.
     * Same tree, same values, same publish gate updating as the author types.
     *
     * That is why this is a view swap and not a dialog. A modal over the form
     * would cover the rail it should be updating and put the record's own Save
     * behind an overlay.
     *
     * Omit it and the field simply never expands.
     */
    FullView?: ComponentType<EntryFieldControlContext>;
};

/**
 * Per-field control overrides for the entry form. A contribution replaces the
 * **input** `EntryFieldInput` would otherwise render for a field, everywhere the
 * form renders — a collection's records editor and a single (page) alike, on the
 * General tab and inside a localized type's Translated/Shared groups.
 *
 * This is a plain (non-hook) slot, so the render site resolves it with a `find`
 * rather than calling every item: a control is a component, and mounting it is
 * what runs its hooks. `@apograph/wysiwyg-admin` fills it with the TipTap
 * editor for `richtext` fields.
 */
export const ENTRY_FIELD_CONTROL_SLOT = createSlot<EntryFieldControlItem>(
    'content.entry.fieldControl'
);

/** What a {@link RecordsBulkActionItem} renders as, once its hook has run. */
export type RecordsBulkActionEntry = {
    /** The item's label. */
    label: ReactNode;
    /** Leading icon, as the built-in bulk actions carry. */
    icon?: ComponentType;
    /** Render it disabled (e.g. while its own request is in flight). */
    disabled?: boolean;
    /** Style it as destructive — reserve for actions that lose data. */
    destructive?: boolean;
    /** Run the action. Selecting an item always closes the menu. */
    onSelect: () => void;
    /**
     * A dialog or other overlay this action owns, rendered **outside** the ⋯
     * menu — which unmounts the moment it closes, exactly when the dialog is
     * meant to appear. Keep it mounted and drive it from your own state.
     *
     * Note what it does **not** survive: the selection bar unmounts as soon as
     * the selection is empty, and the overlay goes with it. So an action whose
     * dialog should stay open must not call `onDone` until that dialog is
     * finished — clear the selection on success, not on open.
     */
    overlay?: ReactNode;
};

/** Context handed to a {@link RecordsBulkActionItem}'s hook. */
export type RecordsBulkContext = {
    /** The open collection's full schema. */
    schema: ContentTypeDetail;
    /** The open workspace's id. */
    workspaceId: string;
    /** The selected entry ids. */
    ids: string[];
    /** Whether the trash view is open (the selection is soft-deleted rows). */
    trashed: boolean;
    /** Clears the selection — call after the action succeeds. */
    onDone: () => void;
};

/** One contributed item in the records selection bar's ⋯ menu. */
export type RecordsBulkActionItem = {
    /** Stable id (used as the React key). */
    id: string;
    /** Sort among contributed actions; built-ins always render first. */
    order: number;
    /** Limit the action to certain types; omitted = every type. */
    appliesTo?: (schema: ContentTypeDetail) => boolean;
    /**
     * Resolves the action for the current selection — **a hook**, called once
     * per item per render (boot-frozen slots, so the order is stable; see this
     * module's header). Return `null` to render nothing, which is how an action
     * hides itself without skipping its hook.
     */
    useItem: (context: RecordsBulkContext) => RecordsBulkActionEntry | null;
};

/**
 * Extra actions in the collection records view's **selection bar**, in the same
 * ⋯ menu as the built-in Publish / Unpublish / Delete (and, in the trash,
 * Restore / Delete permanently). Contributions sort after the built-ins and
 * above the separator, so they never land under the same rule as Delete.
 *
 * The counterpart to {@link ENTRY_MENU_SLOT} for a set of records rather than
 * one — `@apograph/transfer-admin` fills both, so Export reads the same whether
 * you are looking at a record or at a selection of them.
 *
 * **Clear** is deliberately not in this menu: it is the way out of a selection
 * the user may have made by accident, and the selection bar renders it itself,
 * before the trigger.
 */
export const RECORDS_BULK_ACTION_SLOT = createSlot<RecordsBulkActionItem>(
    'content.records.bulkActions'
);

/** What a {@link RecordsMenuItem} renders as, once its hook has run. */
export type RecordsMenuEntry = {
    /** The item's label. */
    label: ReactNode;
    /** Leading icon, as any other menu item carries. */
    icon?: ComponentType;
    /** Render it disabled (e.g. while its own request is in flight). */
    disabled?: boolean;
    /** Style it as destructive — reserve for actions that lose data. */
    destructive?: boolean;
    /** Run the action. Selecting an item always closes the menu. */
    onSelect: () => void;
    /**
     * A dialog or other overlay this item owns, rendered **outside** the menu —
     * which unmounts the moment it closes, exactly when the dialog is meant to
     * appear. Keep it mounted and drive it from your own state.
     */
    overlay?: ReactNode;
};

/** Context handed to a {@link RecordsMenuItem}'s hook. */
export type RecordsMenuContext = {
    /** The open collection's full schema. */
    schema: ContentTypeDetail;
    /** The open workspace's id. */
    workspaceId: string;
    /** Whether the trash view is open. */
    trashed: boolean;
};

/** One contributed item in the collection's **⋯ menu**. */
export type RecordsMenuItem = {
    /** Stable id (used as the React key). */
    id: string;
    /** Sort within the menu. */
    order: number;
    /** Limit the item to certain types; omitted = every type. */
    appliesTo?: (schema: ContentTypeDetail) => boolean;
    /**
     * Resolves the item for the open collection — **a hook**, called once per
     * item per render (boot-frozen slots, so the order is stable; see this
     * module's header). Return `null` to render nothing, which is how an item
     * hides itself without skipping its hook.
     */
    useItem: (context: RecordsMenuContext) => RecordsMenuEntry | null;
};

/**
 * Actions on the **collection**, in a ⋯ menu at the end of the records
 * toolbar — the counterpart to {@link ENTRY_MENU_SLOT} one level up.
 *
 * It is a menu rather than a row of buttons because what belongs here is the
 * occasional, whole-collection operation (`@apograph/transfer-admin` puts
 * Import in it), and those should not compete for width with the controls
 * people use on every visit — search, columns, filters.
 *
 * The trigger renders **only when at least one item resolves**, so an install
 * without any contributor sees no empty ⋯ button.
 */
export const RECORDS_MENU_SLOT = createSlot<RecordsMenuItem>(
    'content.records.menu'
);
