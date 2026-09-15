# @apograph/content-admin

The **Content Library feature plugin** for the Apograph CMS admin UI. It is the
admin counterpart to `@apograph/content-server` (which owns the content
registry, schema, and `CONTENT_CATALOG`). It mounts **inside a workspace** at
`/workspaces/:id/content/*` and ships the library's **navigation + landing**:
the **Content section of the app sidebar** (listing the workspace's content
types, with a ⌘K search palette and pin-to-favorite) plus the work-area island.
Selecting a **collection** opens a dynamic records
table (search, query-builder filter, **click-to-sort headers**, a column picker with
**drag-and-drop / keyboard reordering**, **row selection** with a select-all and
a "{n} selected" bar, pagination, and an **Add record** action); selecting a
**single** (page) opens its **entry editor** directly (its one row, or a blank
create form). The entry
list is **served by the API** (`useContentEntries` → `GET /api/content/:typeName`):
search, query-builder filter, sort, and pagination all run server-side. Creating
(`/new`) or opening (`/:entryId`) an entry renders the **`EntryEditor`** — a
tabbed, schema-driven form (see below). Writes are **live**: create/update
(`useSaveEntry`), publish/unpublish + soft-delete/restore/purge
(`useEntryStatusActions`), and their batch forms (`useBulkEntryActions`), all
against the content-server write API; a server 422 maps back onto the form's
fields. Each paranoid collection also has a **Trash** view
(`:typeName/trash`).

## Layout — layered (ADR-0003)

This plugin is **layered (tactical DDD)**, mirroring the `workspaces/admin` and
`users/admin` pilots. `src/lib` is organized into four layers, not the legacy
per-hook `api/` + `utils/` layout:

- **`domain/`** — pure TS, no React, no transport: the shared view types
  (`types/contentType`), the `constants` (field types, statuses, route segments,
  permissions), and the pure helpers that are UX invariants (`entryColumns`,
  `emptyEntryValues`, `groupContentTypes`, `relationLabel`, `relationHandle`,
  `relationIds`, `stagedRelation`, `contentEntryPath`, `adminProps`).
- **`application/`** — the TanStack Query hooks (reads + mutations), each calling
  the **gateway**, never `apiClient`. The multi-step flows are **use-case hooks**:
  `usePublishEntryFlow` (save → the kernel `canPublish` gate → publish/unpublish →
  invalidate, owning the create→update id continuity) and `useBulkPublishFlow`
  (dry-run preview → commit, surfacing the server's partial-success shape), so the
  entry view and the bulk dialog render the flow's result instead of sequencing
  mutations themselves.
- **`infrastructure/`** — the `ContentGateway` **port** + its `httpContentGateway`
  implementation (the one place `apiClient` is used, consolidating every request
  fn), `contentMapper` (the thin wire→view anti-corruption layer), `contentKeys`
  (every query key), `entryIssues` (the 422 `issues` extractor), and
  `entryFieldSpec` (the one adapter mapping a wire `ContentField` to the kernel's
  serialized field spec).
- **`presentation/`** — pages, components, the `contentPlugin` factory, the
  `slots`, the presentation `hooks` (`useEntryForm`, `useEntryColumns`, …), and
  `entryValidation`; consumes view models + hooks + the kernel only, never
  `apiClient` or wire types.

### Single validation source — the shared kernel

Field-value validation and the publish gate are **not** hand-mirrored in the
admin anymore. They live once, in `@apograph/content-domain` (the shared
**kernel**, per ADR-0003), which `@apograph/content-server` validates against
too — so the admin and server can't drift. `presentation/entryValidation` is a
thin **i18n anti-corruption layer**: it runs the kernel's `validateFieldValue`
over each field (via the `entryFieldSpec` adapter) and renders the kernel's
stable issue reason as localized copy; parameters (`min`/`max`) are read from the
field's own rules, never parsed out of the kernel string. `usePublishEntryFlow`
applies the kernel's `canPublish` as its publish gate. The deleted
`utils/validateEntryValues` (the old hand-mirror) is gone.

## Layout (the Content sidebar section)

The content-type nav lives in the **app sidebar**, not the page: `ContentPlugin`
contributes a **`ContentNavSection`** to the workspace shell's
`WORKSPACE_SECTION_SLOT`, rendering the **`ContentSidebar`** (nav landmark
"Content types") + the ⌘K palette there. Because that section renders **above**
the shell's `CurrentWorkspaceProvider`, `ContentNavSection` resolves the open
workspace itself (`useMatch('/workspaces/:id/*')` + `useWorkspaces`) rather than
`useCurrentWorkspace`, and owns the ⌘K/Ctrl+K shortcut so search works anywhere
in the workspace. `ContentLibraryPage` then owns only the **work-area island**
(`ContentPane`) — a sticky **`ContentTopBar`** (a colored icon tile + a
route-derived breadcrumb: Content › the type's label › the open record's title /
"New record" / "Trash"; the record title comes from `EntryTitleCrumb`, which
subscribes to the editor's own schema/entry queries at no extra request) over an
outlet driven by nested routes.
The routes are (`index` → `ContentWelcome`,
`:typeName` → `ContentTypeView`, `:typeName/new` + `:typeName/:entryId` →
`ContentEntryRoute` (the create / edit editor); the static `new` segment
outranks the `:entryId` param).

**The editor's tabs are routes**, one segment deeper — `:typeName/:entryId/:tab`
(and `:typeName/new/:tab`); for a **single**, whose editor is mounted on the type
itself, each tab slug is spelled out as a **static** segment (`:typeName/general`
…) so it outranks the `:entryId` route, the same trick `new` and `trash` use. The
default tab (`general`) is **omitted**, so the bare entry URL stays the canonical
short link. `domain/entryTab` resolves the open tab from the **last path
segment** — the two editor shapes don't share one route param (a single's static
tab segment yields none), and reading the path covers both. Tabs are routes and
not component state because the editor is remounted by navigations it doesn't
own: switching locale re-targets it at the sibling's id, which used to drop the
user back on General mid-task. `EntrySlotContext.tabSegment` (`'/relations'`, or
`''` on the default) is how a slot that navigates to a sibling record — the i18n
locale switcher — lands the reader on the tab they were working in.

`ContentTypeView` branches on `kind`: a
collection renders `CollectionRecordsView` (the records table), a single renders
`ContentEntryView` in `single` mode (its one-entry editor). The
sidebar splits types via
`groupContentTypes` into **collapsible** groups — **Favorites** (shown only when
something is pinned), **Collections** (`kind: 'collection'`), **Pages**
(`kind: 'single'`) — built on the design-system `Collapsible`. Each row links to
its type and carries a pin toggle. The **`ContentSearchDialog`** is a
`CommandDialog` (cmdk) palette opened from the sidebar's search trigger or the
global ⌘K / Ctrl+K shortcut (both owned by `ContentNavSection`).

## Data + favorites

- `useContentTypes` (`application/useContentTypes/`) reads the registry's source
  of truth, **`GET /api/content-schema`** — **not** the workspace wizard's
  `/api/content-types` mock. Gated on `content:read` (the rail item carries the
  same `permission`).
- **Scoped to the workspace.** The schema list is global, so the page filters it
  to the open workspace's granted content slugs — `Workspace.content` from
  `@apograph/workspaces-admin` (surfaced by `GET /api/workspaces`, sourced from
  the `workspace_content` grants written by the create wizard). Only related
  collections/pages show; an ungranted `:typeName` renders the not-found state.
- `useContentFavorites` (`presentation/hooks/useContentFavorites/`) persists pinned
  type-names in `localStorage`, **keyed per workspace** (`apograph:content:
favorites:<workspaceId>`), with guarded reads/writes. There is no favorites
  server yet — that is the planned migration point.
- **Records table data layer** (per-collection): `useContentSchema`
  (`GET /api/content-schema/:name`, the full field schema) feeds the columns.
  The query-builder **filter fields** are **served, not mirrored**:
  `useFilterFields` (`GET /api/content-schema/:name/filter-fields`) fetches the
  recursive filterable surface — the type's own fields **plus its relations'
  fields** (`author.name`, `author.company.name`) — and `contentMapper.toFilterField`
  maps each wire path to a query-builder `FilterField` (dotted `id`, `group`
  breadcrumb, `relationTarget`). This **replaced** the old client-side
  `filterFieldsFromSchema` mirror (deleted): with a relation graph to walk,
  hand-mirroring the server's whitelist would drift into user-visible 400s, so
  the server owns the one traversal that builds both. Because it is **fetched**,
  it has a failure mode a derived list didn't: `useFilterFields` returns
  `{ fields, isPending, isError, refetch }` and the panel renders a **loading**
  and an **error** state (with retry) instead of an empty picker. That is not
  cosmetic — the Apply gate rejects any rule whose field it can't resolve, so
  without the definitions Apply can never commit; an empty picker would be a
  dead button with nothing on screen explaining why. A relation-`id` rule renders
  the **`RelationValuePicker`** (a searchable, lazily-paginated multi-select over
  the target type, reusing `useRelationCandidates`), injected into the query
  builder via `renderRelationValue` at both call sites (the records
  `QueryBuilderPanel` and the relation picker's inline builder) — rendered as an
  element so its hooks stay scoped. **The records filter is an inline accordion,
  not a drawer**: the toolbar "Filters" button toggles a full-width
  `QueryBuilderPanel` that sits between the toolbar and the table and pushes the
  table down (height-animated, no overlay); collapsed with active filters, the
  applied conditions read out as a `QueryBuilderSummary` row of removable chips
  under the toolbar, and Apply collapses back to it. `useContentEntries`
  fetches `GET /api/content/:name` with `{ search, filter, sort, page, pageSize }`
  → the `{ items, total, page, pageSize }` envelope; the **server** runs search →
  query-builder filter → sort → pagination (this hook owns no row logic). The
  schema gates the columns query and supplies the type name.
  **`status` is publishable-only**: `entryColumns` offers a Status column and the
  server's filter surface includes a Status filter **only when publishable**
  (a non-publishable type has no publish state). The same rule holds **wherever
  publish state is drawn** — the editor rail's Details **Status** row, the
  History tab's Live/Draft/Superseded badges (and the preview dialog's),
  and the i18n **locale menu** rows' badges are all gated on `publishable`. On an
  always-live type those would label a state the type doesn't have; a version
  there was simply saved, so a Revisions row keeps its number, its "Current"
  marker and its time, and nothing else. Sort is a URL param
  (`?sort=<columnId>` asc, `?sort=-<columnId>`
  desc); a header click cycles asc → desc → off, sets `aria-sort` on the
  `<th>`, and resets the page. URL state (search/filter/sort/page) is owned by
  `useTableUrlState` (`@apograph/utils-admin`),
  mirroring the Members page. `useEntryColumns` holds the **ordered** visible
  columns in component state (**not persisted** — the choice lasts the session
  and resets on reload) — the array is both the visibility set and the display
  order, so it powers the column picker's toggles _and_ its drag-to-reorder
  (`reorder` via `@dnd-kit/sortable`'s `arrayMove`); it is seeded from a smart
  default (`domain/entryColumns`, excluding richtext/json) narrowed to the live
  schema, and re-seeded when the open type changes. Row selection is local
  component state (a `Set<string>` by id)
  in `CollectionRecordsView`, surfaced through the table's leading checkbox column
  and the `CollectionRecordsSelectionBar`.
- **Relation columns** render a **`RelationCell`** — a titled trigger (the first
  linked record + a `+N` overflow) opening a `Popover` of the linked records,
  each an `<a target="_blank">` to that record's own editor
  (`domain/contentEntryPath`) with its muted `/handle`. Never the raw FK id — a
  ref the server flags `missing` (its target soft-deleted or out of workspace)
  renders as "Unavailable record" and carries no link, since its `title` is only
  the id standing in.
  Loading is **two-tier**: the list response carries a capped `relations`
  preview (requested via `relations: 'preview'` + `relationFields`, derived from
  the **visible** relation columns, so hiding one stops the server resolving
  it), which renders the collapsed cell and the popover's first view at **no
  extra request**; opening a many/inverse relation then scroll-paginates the
  rest through `useRelationFieldLinks`
  (`GET …/relations/:field`) — the same infinite scroll the editor uses, with the
  same `onScroll` threshold. So a record with thousands of links never loads
  whole. The paginating half lives in the nested **`RelationCellList`**, mounted
  only while the popover is open, so a table of relation cells registers no idle
  queries; a single relation skips the query entirely (its preview is the whole
  story). Two structural rules the table enforces for these cells: they are
  **excluded from the first column's row `<Link>`** (an `<a>` inside an `<a>` is
  invalid) and they `stopPropagation` so a click doesn't fire the row's
  navigation. Relation headers render **non-sortable** — the server's sort
  whitelist excludes relations, so a click would silently fall back to
  `updatedAt`.
- **Rich-text columns** render a plain-text excerpt of their HTML
  (`domain/richTextExcerpt`), not the value. A `richtext` cell printed raw shows
  the reader `<p>Shipped <strong>faster</strong>…</p>` — their markup instead of
  their sentence. Block tags become a space so text either side doesn't run
  together, inline marks vanish without one, and a body with markup but **no
  words** (an empty `<p></p>`) falls back to the em-dash — `isEmpty` can't see
  that case, since the string isn't blank. The excerpt is only ever rendered as
  text, so tag-stripping by regex carries no injection risk; rendering rich text
  as _markup_ is a different problem with a different answer
  (`@apograph/wysiwyg-admin`'s `renderRichText`).
- Column **order and visibility** are both chosen in
  `CollectionRecordsColumnPicker` — a `Popover` (not a `DropdownMenu`, whose menu
  semantics fight dnd-kit's keyboard sensor) listing visible columns first as
  drag-and-drop / keyboard reorderable rows (a `DndContext` + vertical
  `SortableContext`, `GripVertical` handle per row, `KeyboardSensor` +
  `sortableKeyboardCoordinates`), then hidden columns as toggle-only rows. The
  table header itself is static. The records view spans full width (`Container`
  overridden to `max-w-none`) with a uniform 24px gutter (`p-6 sm:p-6`, overriding
  the Container's responsive padding); the table sits in a full-width bordered
  card with no padding of its own.
- **Entry editor** (`/new`, `/:entryId`, and a single page): `ContentEntryView`
  resolves the initial values per mode — `create` → blank; `edit` → the record
  from `GET /content/:type/:id` (`useContentEntry`), seeded instantly from the
  records-list cache when opened from the table; `single` → the type's one row via
  the list endpoint, else blank — then renders **`EntryEditor`**. The editor owns the
  form state (`useEntryForm`, with client validation in `presentation/entryValidation`
  (the kernel-backed i18n ACL, not a hand-mirror of the server rules)) and lays out a title header, a **full-width**
  tabbed body (**General** = `EntryFieldSections`, which groups fields into titled
  `Card`s by control shape — short scalars in a grid, long-form/JSON stacked,
  toggles/multi-choice — **media fields are excluded from General**, rendering on
  the Media tab instead; **Relations** = relation fields via the **`RelationField`**
  picker (empty state otherwise); **`ENTRY_TAB_SLOT` tabs** — contributed editor
  tabs (the media plugin's **Media** tab) render between Relations and History
  when their `appliesTo` matches the open type; **History** = revisions), and the
  right rail (`EntrySidebar`) — the **Properties panel** (see below): a top
  **action bar** — a primary button
  (**Publish** for a publishable type the user may publish, else **Save** /
  **Save draft**) beside a compact **⋯ menu** (Save draft, Save & publish,
  Unpublish, Delete; each permission-gated) — over a
  live **Publish Gate** (`PublishGateItem[]`, computed by `EntryEditor` from the
  strict kernel-backed validation; publishable types only — it renders the
  **failing** checks only, under a heading reading `{n} blocking`, and collapses
  to one "Every check passes" line when nothing does) and a static **Details**
  block (status, created/updated, id, plus any `ENTRY_DETAILS_ROW_SLOT` row). While a save/publish is running, the view
  covers itself with the **`EntryBusyOverlay`** (see _Save/publish flow_ below). `EntryFieldInput` (top-level, shared) renders one **flat** (no-shadow)
  control per field type — `date`/`datetime` use a shadcn `Calendar` popover
  (`EntryFieldInput/DateField`, with a time input for datetime), and
  `multiselect` uses the design-system `MultiSelect` (Popover + Command + Badge)
  rather than native controls. The records pane (`ContentPane`) is `overflow-auto` so
  wide content scrolls inside the work-area island, not the page.
- **Relation picker** (`EntryEditor/RelationField/`): the Relations tab opens with
  a one-line subtitle ("Assign related records and set the order they appear in the
  delivery API.") over a stack of **`RelationFieldSection`** **titled cards** — each
  relation field a card (label + a derived description + — for a many relation — a
  right-aligned "{n} linked" count + a "Changed" badge, and a **header alert icon +
  destructive border when it holds a validation/server error**). Cards are **always
  expanded** (no chevron/collapse — the error is never hidden). The description is
  derived from the relation shape: single → "Single relation — one record from
  {Target}."; many → "Ordered relation — drag to reorder, or use the arrows. Order
  is delivered as-is."; inverse → "Linked from {Target}." Each card wraps
  **`RelationField`** (single) or **`RelationFieldLive`** (many/inverse). **Only
  relations whose target collection is granted to the open workspace are shown** —
  `EntryEditor` filters by
  `availableTypeNames` (passed `workspace.content` from `ContentEntryView`) and passes
  the hidden ones to `useEntryForm` as `ignoreFields`, so a hidden (ungranted)
  relation is excluded from client validation **and** the publish gate — a required
  one can't become an un-satisfiable, invisible block. A **visible** required
  link-managed relation (many / inverse-of-many) _is_ publish-gated, but by its
  **effective link count** (`relationRefs[field].total − staged.removed +
staged.added`), not the values bag it doesn't live in — mirroring the server's
  `assertRequiredRelations`. To seed those counts the aggregate relations read
  (`useEntryRelations`) now fires on **entry open** (not only when the Relations
  tab is first shown), so a populated relation never briefly reads as 0.
  Each assigned record renders as a **`RelationItemRow`** — a generalized row with a
  **leading slot** (an initials `Avatar` for a single relation, a zero-padded
  `01`/`02` **index** for an ordered many-relation, via `RelationIndex`), the
  **title** + a muted `/handle` (the target's `slug`, else a slugified title — see
  `domain/relationHandle`), an optional **status badge**, and a trailing controls
  cluster: reorder **up/down arrows** (ordered relations), the drag `handle`, an
  **open-in-new-tab** link (`domain/contentEntryPath`), a **Replace** action (single
  relations, re-opens the picker), and remove. `RelationField` (single) stores one
  id string in the form values; `RelationFieldLive` (many/inverse) stages links as
  a delta. A many-relation's rows are **drag/keyboard reorderable** (dnd-kit, like
  the records column picker — the array order is the value, via
  `SortableRelationItem`) **and** nudgeable one place with the up/down arrows (same
  staged `order` path as a drag; ↑ disabled on the first row, ↓ on the last). The
  row's accessible names — `Remove {title}`, `Reorder {title}`, `Open {title} in a
  new tab`, `Move {title} up` / `down`, `Replace` — are what the e2e drives.
  An Assign/Add button opens **`RelationPickerDialog`**: a
  search box and an **inline, collapsible** query-builder filter (the headless
  **`QueryBuilder`**, _not_ a drawer — a nested modal over the dialog is an a11y
  hazard) over the _target type's_ filterable surface (`useFilterFields(target)`,
  gated on the dialog being open), and a lazily-scrolled candidate list (accessible
  checkbox group for a many-relation, radio group for a single). Fully controlled —
  the form owns the value (single → one id string, many → string[]). Candidates
  are **served by the API** (`application/useRelationCandidates` → `GET /content/:target`,
  the same list endpoint the records table uses): the picker's search **and** the
  query-builder filter (serialized via `treeToJsonFilter`) run **server-side**,
  and the lazy-scroll window is a `pageSize` grown by the dialog. Titles are
  derived from each row's values by `domain/relationLabel` (mirrors the server's
  `entryTitle`). `RelationPickerDialog` owns state/data and composes nested pieces:
  **`RelationPickerFilters`** (search + inline query builder) and
  **`RelationCandidateList`** → **`RelationCandidateRow`** (each candidate row
  also carries the same **open-in-new-tab** link to that record's editor).
- **Assigned relations — single vs many/inverse.** The links read is **lazy**:
  `EntryEditor` calls `useEntryRelations` (`GET /content/:type/:id/relations` →
  `{ relations: { <field>: { items, total } } }`, each field's **first page** +
  total) **gated on the Relations tab being open** — it never fires on entry
  load, and single-relation _values_ come from the entry read's `values` (their
  FK id), so a save preserves them even if the tab was never opened. A relation
  is edited one of two ways, chosen by `RelationFieldSection`:
    - **Single** relations (and **any** relation while creating a not-yet-saved
      entry) are **form-backed**: `seedRelationValues` seeds the value (single →
      its FK id; a new entry's many → an empty staged array), and `RelationField`
      renders/edits it, submitted in the entry `values` on save (create's
      whole-set → the server `writeLinks`). Titles come from the loaded
      `RelationRef`s (`initialRefs`) or the picked candidate.
    - **Many / inverse** relations are edited by `RelationFieldLive` (create and
      edit alike): the assigned list is the server set — **infinite-scroll
      paginated** (`useRelationFieldLinks` → `GET …/relations/:field`) on an
      existing entry, empty while creating — with the user's **local staging**
      (`StagedRelation` = added refs / removed ids / order) overlaid. Assign /
      unassign / reorder mutate **only** that staging (owned by `EntryEditor`, so
      it survives collapsing a section or switching tabs); **nothing is sent until
      Save**, which serializes each field's staging to a `{ link?, unlink?, order? }`
      delta and posts it in the entry body — one transaction, one request, a huge
      relation never sent whole. `seedRelationValues` **drops** these fields from
      the form (a save can't wipe links it never loaded); a successful save clears
      the staging and `useSaveEntry` invalidates the field queries. Owning
      many-relations reorder (persisted via `position`); the inverse reads order
      but isn't sortable.
      A field with pending edits shows a **"Changed" badge** (`ChangedBadge`): general
      fields (dirty vs the seed) in `EntryFieldSections`, and relation sections
      (dirty staging, or a dirty single value) in the section header — so the user
      sees exactly what a Save will persist. It is **exported from the package
      index** (like `EntryStatusBadge`) so a plugin contributing an `ENTRY_TAB_SLOT`
      tab — the media plugin's Media tab — marks a changed field with the same
      badge instead of a look-alike that drifts.
- **Writes + permissions.** The sidebar's Save / Save&publish / Unpublish / Delete
  actions, the table row menu (Edit/Publish/Unpublish/Delete; Restore/Delete-
  permanently in trash), and the selection-bar bulk actions are all gated by
  `useHasPermission` (`content:create`/`update`/`publish`/`delete`). "Save &
  publish" chains create/update then the dedicated publish endpoint (one validated
  path). Bulk publish opens **`BulkPublishDialog`** — a dry run
  (`bulk/publish/preview`) listing each row's verdict before publishing only the
  valid drafts. That dialog is **exported from the package index**: a plugin
  acting on a _known_ set of this library's records reuses the whole dry-run →
  verdicts → commit flow rather than building a second one (i18n's "publish all
  locales" hands it the record's locale siblings). Two props make it read as
  something other than a table selection — `labels` (heading/body) and
  `labelFor(id)`, which renames a row when the verdict's own title is the wrong
  handle (every locale sibling carries the _same_ record title, so the locale is
  what tells them apart). `useBulkEntryActions` is exported for the same reason —
  i18n's "unpublish all locales" is `bulk/unpublish` over the sibling ids, since
  unpublish has no pre-flight to run. Destructive actions confirm through the design-system
  **`ConfirmDialog`** (shared, i18n-free — pass localized labels). Mutations —
  single **and bulk** — run the shared `refreshEntryCaches` pass, not just the
  records list: a bulk action can be fired from the editor of a record inside the
  set ("publish all locales" publishes the open record along with its siblings),
  and refreshing only the list left the Details block reading its pre-publish
  cache, so a record that had just gone live still showed **Modified**. The 422
  `issues` ride on `ApiError.details` and are extracted by
  `infrastructure/entryIssues`.
- **The editor is read-only without the write permission — the _form_, not just
  its buttons.** `EntryEditor` resolves `content:create` (a create form) or
  `content:update` (an existing record) and publishes the answer through
  **`presentation/hooks/useEntryReadOnly`**, a context taking the same path as
  `useExpandedField` (`EntryEditor` → `EntryFieldSections` → `FieldGroup` →
  `EntryFieldInput`, and the relation stack), plus a `readOnly` flag on
  **`EntryFieldControlContext`** and **`EntryTabContext`** so contributed
  controls and tabs honour it too. Gating the actions alone was not enough: a
  reader could retitle a page, recolor it, and stage an image upload, and only
  learn at Save that none of it was theirs — the server refused the write all
  along, but the UI didn't say so.
    - **Text and textarea controls take `readOnly`, everything else `disabled`.**
      A read-only input keeps its value legible, focusable, and selectable, so a
      reader can still copy out of the record; a select, a multi-select, the
      boolean segments and the date picker have no such state — their value is
      only reachable through a popover — so `disabled` is the only thing that
      closes them off.
    - **Write affordances are removed, not disabled.** Relation assign/remove/
      reorder + the drag handle, the picker dialogs, the media Select/Upload row
      and its drop zone, the WYSIWYG toolbar: there is no state in which they
      light up for this reader, and a row of dead buttons reads as a broken
      editor rather than a preview. The open-in-a-new-tab links stay — following
      a link to a record you can read is not a write. Picker/upload dialogs are
      left **unmounted**, which also stops them registering their candidate and
      library queries.
    - `runSave`/`save` return early and `useUnsavedChanges` is not armed. The
      early return is not belt-and-braces: the editor's `<form>` submits on Enter
      in a text field, which is the one save path that never goes through a
      button.
    - A **`ReadOnlyNotice`** banner sits under the record title. It is
      deliberately _not_ the design-system `Alert`, whose `role="alert"` is a
      live region — this is page furniture present from first paint, not an
      event.
    - The rich-text field is the one place expansion survives: its collapsed
      preview is height-clamped, so removing the way in would leave a reader
      unable to read the field the page is mostly about. The control is renamed
      **View**, and `WysiwygEditorPanel` takes `readOnly` (`editable: false`, no
      toolbar, no autofocus, `role="region"` instead of `textbox`).
    - Pinned by `apps/admin-e2e/src/content/entry-read-only.spec.ts`, which also
      carries the **control case** — the same editor fully live for a role that
      holds `content:update`. Every other assertion there is about something
      being absent, and a bug that dropped the whole form would pass them all.
- The design-system `command` + `collapsible` + `tabs` + `calendar` +
  `multi-select` primitives this plugin relies on were added there via the
  shadcn skill (consumed from `@apograph/design-system`).

## Saved views — the switcher in the records toolbar

A saved view is a named slice of a collection's records list: the filter, the
sort, the visible columns, the page size, and the slot-owned params (i18n's
locale). Served by `/api/views` (`packages/content/server/src/lib/views/`).

**Where it lives.** `ViewSwitcher` **leads `SearchToolbar`'s actions row**,
before the locale switcher, Columns and Filters. The page's two right-aligned
rows are split by the question they answer: the header carries what you do _to_
the collection (**Add record**, the **⋯**), the toolbar carries what changes
_which records you are looking at_. A saved view is the broadest of those, so it
goes first in that row.

It has lived in two other places, and the reasons both moved are worth keeping.
Under the `<h1>` (through a `titleAdornment` slot on `ContainerHeader`, since
removed with its last caller) a small pill read as a caption on the heading
rather than a control, and pushed the record count down on every collection. In
`ContainerHeader`'s `actions` cluster it was one of six near-identical outline
buttons spread over two right-aligned rows with nothing to say which row was
which — the argument for it there ("it says which slice the actions beside it
would act on") stopped holding once those actions were the ones that moved away.
Both rows stay `flex-wrap`: a `shrink-0` row of controls ran off the right edge
on a narrow viewport.

The menu is `modal={false}`, like every other menu in this admin: a modal Radix
menu `aria-hidden`s the page root, so `aria-hidden-focus` fires and the page —
its `<h1>` included — drops out of the a11y tree while the menu is open.

The **dropped-columns notice** is drawn by `LoadedRecordsView` under the header,
not by the switcher: a wrapping sentence inside a right-aligned row of buttons
would shove them around every time a stale view loads. It keeps the switcher's
original message id, so its translations survive the move.

**`?view=` is a pointer, not the slice.** `filter`, `sort`, `pageSize` and the
slot params stay in the URL as themselves; `?view=<id>` only names which saved
view they came from. So a link keeps working when the view it names is renamed
or deleted, Back/Forward switch views like any other navigation, and "Copy link"
needed no new code.

**The payload rules live in `domain/viewPayload/`** — `captureViewPayload`,
`isViewDirty`, `viewPayloadToParams`, `reconcileColumns` — and are the one part
of this feature with unit tests, because their whole job is comparing states the
UI can only reach one keystroke at a time. Two normalizations carry the weight:
an empty filter and an absent one serialize the same (or the badge burns the
moment you clear a filter the view never had), and `extra` keys are compared
sorted while **column order is significant** (reordering columns really is a
change to the view). `search` and `page` are never captured — a search is a
one-off question, a page is a reading position.

**Applying a view seeds columns from an effect, not during render.**
`useEntryColumns` re-seeds its selection whenever the open type changes, using
the adjust-state-while-rendering pattern. The view's columns are applied in a
`useEffect` keyed on the active view's id so they land _after_ that re-seed on
the one commit where both change — a deep link into another collection's view.
Seeding during render instead means the two fight and the columns flicker back
to the type's defaults.

**Nothing autosaves.** When the live state drifts from the saved payload the
trigger says "Modified" and offers Save / Save as new / Reset inline beside it.
None of the three is `variant="default"` — the header's one primary button is
**Add record**, and a second would compete with it. Save is absent on someone
else's shared view — that one is theirs, and "Save as new" is the remedy.

**Deleting a view asks first; changing your default says so afterwards.** The
two consequential menu actions each get the treatment the _other_ one doesn't
need:

- **Delete** opens a `ConfirmDialog` naming the view, rendered outside
  `DropdownMenuContent` (which unmounts the instant the menu closes — the same
  rule `ENTRY_MENU_SLOT` overlays follow). A view holds no records, so nothing
  is destroyed, but it is not undoable and a **shared** one is a colleague's
  tool too — which is why the body has two variants. Confirm closes the dialog
  and lets the outcome land as a toast, exactly like the entry editor's delete.
  Focus is put back by hand (`onCloseAutoFocus`): the menu item that opened the
  dialog is long gone, so Radix's restore would target a detached node. The
  trigger it is put back on is always there — the switcher has **one shape**,
  saved views or none. It used to collapse to a lone "Save current as view…"
  button on an empty list, which spent the row's loudest secondary slot on an
  action that only pays off _after_ the reader has changed something, and needed
  a `justDeleted` ref to chase focus across the swap when deleting the last view
  brought that button back. **Save current as view…** is a menu item now, beside
  the rest of the view actions.
- **Set as my default** gets the toast instead, because a default decides the
  _next_ visit: nothing on this screen moves, so a silent success reads as a
  dead menu item. The message names the view, which also covers the
  exclusivity — pointing your default at one view unsets another, and only the
  server knows which. Creating a view with the dialog's "open by default"
  checkbox is confirmed the same way, and a plain save is now toasted too: the
  slice is already on screen, so the dialog closing was the only evidence the
  write landed.

**A stale view degrades, it does not fail.** The server stores the payload
opaquely, so a view outlives the field it was saved over. `reconcileColumns`
drops column ids the type no longer has (falling back to the defaults when none
survive) and the switcher says how many were skipped — the same posture as the
`pageSize` clamp in `LoadedRecordsView`, where an out-of-range URL param used to
strand the reader in an error card.

**The landing ladder.** An explicit `?view=`, or _any_ list param (`filter`,
`sort`, `page`, `pageSize`, `q`), means the link already carried an intent and
wins over the reader's default view — a deep link out of a mail or a chat has to
show what its sender saw. Only a bare URL falls through to the default, applied
with `replace: true` so Back doesn't bounce off the redirect.

**The ladder runs on every arrival, not once per mount.** `:typeName` is **one
route element for every collection**, so React Router keeps `LoadedRecordsView`
mounted across the two navigations that matter most: the sidebar link back to
the list you are already on, and the sidebar link to a _different_ collection.
Resolving the default once per mount (a `defaultResolved` ref) meant a default
only ever took effect on a full page load — set one, click the collection in the
sidebar, and the plain list came back.

What tells an arrival apart from the reader's own moves is the **navigation
type**: `updateParams` and `applyView` always `replace`, so `NavigationType.Replace`
is our own write and never re-arms the ladder — which is what keeps "All records"
picked, since clearing a view produces exactly the bare URL a fresh arrival has.
A `<Link>` (PUSH) or Back (POP) does re-arm it. A second ref (`hydratedView`,
scope-qualified) guards the `?view=`-only branch, so a view whose payload sets no
params at all can't fail the "already applied" check forever and re-expand on
every render. Both directions are pinned in `saved-views.spec.ts`.

**Trash is excluded.** `/trash` is a route segment over a different row set, not
a param, so a view saved there would describe a slice that only makes sense on
one of the two pages.

`views:share` gates only **sharing**; saving a personal view needs nothing beyond
`content:read`, and the dialog's Shared option explains why it is disabled rather
than just being dead.

## The Properties panel + the editor's actions live in the app chrome

The entry editor no longer draws its own rail or its own action bar. Both render
into **shell-owned regions** (`@apograph/shell-admin`), filled by portal from
inside the editor:

- **`RightPanelPortal title="Properties"`** ← `EntrySidebar`, the panel body.
  The shell's `AppRightPanel` supplies the column, the heading, the collapse
  toggle and the independent scroll; collapsed, the column disappears and the
  reopen button shows up in the top bar.
- **`PageActionsPortal`** ← **`EntryActions`**, the write actions (the primary
  **Publish** / **Save** / **Save draft** button + the ⋯ menu holding Save draft,
  Save & publish, Unpublish, Delete, each permission-gated, plus the delete
  `ConfirmDialog`). They sit in the top bar because the panel can be collapsed
  away entirely and a record you can't save is a trap.
  `ContentTopBar` renders the shell's `<PageActions />` as its last child, which
  is the region they land in.

**Why portals and not "hand the shell a node".** React resolves context by where
a node is _rendered_. Rendered by the shell, this content would be cut off from
`useCurrentWorkspace` (every entry query needs it), from `EntrySlotContext` (the
i18n locale chip), and from the editor's own handlers and busy state.
`createPortal` moves only the DOM. `ContentNavSection` is the counter-example —
it renders above `CurrentWorkspaceProvider` and has to re-resolve the workspace
by hand.

The panel body itself is a **single flat surface**: a run of sections told apart
by **dividers**, deliberately not a column of cards — every block used to draw
its own border, tinted background, and heading, so a stack of blocks read as a
stack of floating boxes on a page rather than one surface with sections. The
rail is also kept **short**: the publish gate, Details, and whatever a plugin
contributes. It is not the place to restate something a tab already owns — a
truncated Revisions block used to sit here beside a History tab that shows the
whole timeline with the same actions, and it is gone.

- **`EntrySidebarSection`** (title + optional `action` adornment + optional
  `description`) and **`EntrySidebarRow`** (a `<dt>`/`<dd>` label-left /
  value-right pair, `stacked` for a long value like a UUID) are the panel's whole
  chrome. Both are **exported from the package index** — a plugin filling
  `ENTRY_SIDEBAR_WIDGET_SLOT` (the alarms plugin's **Checks** block, protection's
  **Review** block) renders _these_, for the same reason `ChangedBadge` and
  `EntryStatusBadge` are shared: a widget with a card of its own would be the one
  floating box left in the panel. `EntrySidebarRow` is also the contract of
  `ENTRY_DETAILS_ROW_SLOT`, whose items render inside **Details' own `<dl>`**.
- **The divider belongs to the rail, not the section.** The blocks sit in a
  `divide-y` wrapper, so a contributed widget is separated exactly like a
  built-in one without drawing a border itself (and a widget that renders `null`
  when it does not apply to the open type leaves no stray rule behind).
- **Collapse is the shell's, not ours** — including its persistence, so it
  survives the remounts this editor takes from navigations it doesn't own (a
  locale switch re-targets it at a sibling record; a single's tab segments are
  separate routes). `EntrySidebar` renders **chrome-less**: no column, no
  heading, no toggle.
- **The collapse is instant — leave it that way.** Two motion treatments were
  built for it and both were rejected: a `transition-[width]` slide and then a
  cross-fade. Don't try a third.
- Headings run `h1` (the record title) in the page → `h2` ("Properties", the
  shell panel's heading) → `h3` (each section).

## Publish state — four labels over two stored values

The server stores only `draft`/`published`, because a save moves a publishable
entry back to `draft` while its published _version_ stays live in history. That
conflates two situations a writer must tell apart, so the UI reads a **third**
signal — `EntryRecord.publishedAt`, which is stamped on publish, cleared only by
unpublish, and deliberately survives an edit:

| stored                     | shown             | meaning                            |
| -------------------------- | ----------------- | ---------------------------------- |
| (create form)              | **Not saved yet** | nothing stored                     |
| `draft`, no `publishedAt`  | **Draft**         | never published                    |
| `draft`, has `publishedAt` | **Modified**      | live content + unpublished changes |
| `published`                | **Published**     | live and current                   |

`domain/entryStatusView` is the pure classifier; **`presentation/components/
EntryStatusBadge`** is its one rendering, used by _both_ the records table's
Status column and the editor's Details block so a record can't read two ways in
the two places it's looked at. Modified is a `warning` badge, not `success` —
what's live is not what's on screen. The table cell used to print the raw wire
value (`draft`/`published`, lowercase, untranslated); it is now localized, which
a third state with no column value spelling it made unavoidable.

## Save/publish flow — one refresh pass, one cover

- **`application/refreshEntryCaches`** is the single cache-refresh pass for any
  entry write (list, revisions, relations, per-field links, and — unless
  `skipEntry` — the read-one). Having one definition is what lets the
  save→publish **chain** run it _once at the end_ (`useSaveEntry` takes
  `deferRefresh`, set by `usePublishEntryFlow` from the same `canPublish` gate,
  now decided **before** the save) instead of each mutation refetching on the way
  past — one Publish click used to re-read the record and its whole timeline
  twice. If the chained publish 422s, the flow runs the deferred pass itself so a
  landed save isn't left with stale caches.
- **The query-key roots are `content-entries` / `content-entry` / … — never
  `content`.** TanStack matches key _segments_, so the obvious
  `invalidateQueries({ queryKey: ['content'] })` matches **nothing**:
  `'content' !== 'content-entries'`. It throws no error and reports no count, so
  the mutation succeeds, the toast appears, and the table never moves —
  `@apograph/transfer-admin` shipped exactly that after an import. A plugin that
  writes entries should call the exported **`refreshEntryCaches`** rather than
  spell a key of its own; the two exported key builders
  (`contentEntriesPrefix`, `contentEntryKey`) are for the cases it doesn't cover.
- **Write responses seed the cache.** Every entry write returns the canonical
  record, so each mutation `setQueryData`s the read-one instead of invalidating
  it, and `useContentEntry` carries a `staleTime` so the create→`/:type/:id`
  navigation stops discarding the record it was just handed. Only the **primed**
  record is spared (`primedEntryId`) — every _other_ cached record of the type is
  still invalidated, because one save can rewrite rows it didn't name: the i18n
  shared-field sync writes a non-localized field to every locale sibling, and
  sparing the whole prefix left a switch to that sibling showing the pre-save
  copy until a reload. Cache-seeded opens
  pass `initialDataUpdatedAt` (the age of the _list_ read), so a stale row still
  refetches. Invalidation ignores `staleTime`, so nothing this app writes goes
  unnoticed.
- **Publishing an unchanged record does not save it first.** When the form,
  its staged links and every presave step's `extensions` are all clean,
  `usePublishEntryFlow` calls the publish endpoint alone. A save is not free
  even when it changes nothing — every save appends a version, and a version is
  what a review approval is bound to — so saving first moved the head off the
  version reviewers had just approved and the publish was refused for it.
- **A refusal that is not a field problem is toasted with the server's own
  sentence** (`Not published: …`). A publish guard's 409 carries its only
  explanation in the body; without the toast the busy cover lifted and nothing
  on screen said the write had not happened.
- **`EntryBusyOverlay`** covers the editor for the whole write — a blur +
  spinner + "Saving…"/"Publishing…", mirroring i18n's locale-switch flourish. Two
  differences from that one: **no delay** (nothing changes until the server
  answers, so there's nothing to hide behind a cover — only lag to add), and **no
  fixed timer** (it's held by `ContentEntryView` around the whole `flow.submit`,
  refetches included, so it never lifts onto pre-save values). It's held in view
  state rather than derived from `isPending` because the chain's two mutations
  are briefly both idle between steps, which would blink the cover mid-flow.

## Revisions (version history)

Every save is versioned (server: `content_entry_revisions`). The editor surfaces
this in **one** place — the **History** tab. It used to have two: a truncated
`RevisionWidget` in the Properties rail as well. A rail block that could only
ever show the newest handful, beside a tab showing all of them with the same
Restore, Publish and Preview actions, was a second copy of the same list with a
second set of loading and error states to keep honest — and it was the tallest
thing in a rail whose job is properties, not history. It was deleted (`ORT-227`);
do not reintroduce it.

- **`useEntryRevisions`** (`application/`) reads the timeline
  (`GET /content/:type/:id/revisions`), gated on a saved entry id.
  **`useRevisionActions`** owns the **restore** (`POST …/revisions/:number/restore`)
  and **publish-a-version** (`POST …/revisions/:number/publish`) mutations, both
  invalidating the same caches a save does (records list, read-one, relations, and
  the revisions prefix). Every mutation that changes the timeline invalidates the
  **revisions prefix** so the History tab refreshes immediately:
  `useSaveEntry` (each save appends a version; on a publishable type a save is a
  **draft** — editing a published entry moves it back to draft while its published
  version stays live in history) and `useEntryStatusActions` (publish/unpublish).
- **Publishing a version.** Server-side, publishing a version marks **that
  version** live in place (prior live → superseded); an earlier version's content
  is re-applied to the record first, but **no new version is recorded** — the
  timeline doesn't grow by one on every publish. So the editor can build up drafts
  and then publish the current one **or switch back to any earlier version and
  publish it**. After the latter, the "Live" badge and the "Current" (newest)
  marker sit on different rows — that is the point, not a glitch.
  A `RevisionRow` shows a **Publish** action on any version that isn't already live
  (publishable type + `content:publish`), and the preview dialog carries a
  **Publish this version** button; both route through a `ConfirmDialog` + toast in
  `RevisionList`. A `422` (an incomplete version) surfaces as an error toast.
- **`RevisionList`** (`EntryEditor/RevisionList/`) is the timeline itself — a
  `RevisionRow` per version (number, status badge Live/Draft/Superseded, capture
  time) plus the **Restore** flow (permission gate on `content:update`, a
  `ConfirmDialog`, and the success/failure `toast`). Restore re-applies an older
  snapshot as a **new** revision, so the timeline refreshes in place. It has one
  caller, so the rows are always the labelled ones; the `compact` (icon-only)
  variant went with the rail widget.
- **Preview / compare** (`RevisionList/RevisionPreviewDialog/`): each earlier
  version's row carries a **Preview** action opening a diff dialog. It fetches
  that version's snapshot **and** the latest one (`useRevisionDetail` →
  `getRevision`; the newest snapshot equals the live record, since every save
  appends one) and runs the pure `domain/revisionDiff` — a field-by-field compare
  in schema order (scalars/single-FKs via `values`, join-backed relations via the
  ordered `relations` id lists). Changed fields render a **Current → Version {n}**
  pair, unchanged ones collapse behind a toggle. Scalars format via
  `formatRevisionValue` (a read-only sibling of the records table's `renderCell`);
  **relation fields render the actual linked records** (`RelationRefList`), not a
  count — the detail read resolves each field's snapshot ids to titled refs
  server-side (`RevisionDetail.relationRefs`/`relationTotals`, capped with a "+N
  more"; a soft-deleted / cross-workspace target reads as "Unavailable record").
  **Media fields render the actual assets** the same way (`MediaRefList` —
  thumbnail + file name, in stored order — the ref's `thumbUrl` derivative when
  the asset has one, else the original), from `RevisionDetail.mediaRefs`, which
  the server had always resolved and the admin used to drop: a media row printed
  the bare asset uuid, which tells a reader nothing about what a version held. A
  side with no resolved list falls back to `formatRevisionValue` — the server
  omits an empty field (so the row reads "Empty") and omits media wholly when no
  media plugin is bound, where the stored value beats claiming "No assets".
  A **Restore this version** button hands the number back to the list's restore
  flow (its own `ConfirmDialog`) — never a modal stacked on a modal. The Preview +
  Restore actions are hidden on the newest row (nothing to compare/apply against),
  and are labelled buttons.
- One mount point: the **History tab**'s **`HistoryTimeline`** (the full list;
  prompts to save first on a create form).

The gateway carries `listRevisions` / `getRevision` / `restoreRevision`; the wire
types (`RevisionSummary` / `RevisionDetail` / `RevisionListView`) live in
`domain/types/contentType`, mirroring the server. Previewing a version is a
**read-only compare against the current record** (the `RevisionPreviewDialog`
above), not an in-form staging preview; restore remains the switch-back path.

## Insights widgets

This plugin contributes the **content cards** on the Insights page via
`@apograph/insights-admin`'s `INSIGHTS_WIDGET_SLOT` — content owns the data, so
it owns the widgets; the Insights plugin ships only the page, the grid and the
card shell and knows nothing about entries.

Eight contributions: three Overview stat tiles (Entries / Published / Drafts),
**Gone quiet** (staleness buckets), **Draft and published, by type**,
**Publishing velocity**, **Waiting to go live**, and the Team **punchcard**.
Velocity is `lg` (8/12) rather than `full` so **Waiting to go live** (`sm`, 4/12)
shares its row — the grid is twelfths, and 8 + 4 is what makes that one row
instead of two. Data layer mirrors the rest
of the package — `infrastructure/contentInsightsGateway` (the port),
`httpContentInsightsGateway` (the only `apiClient` use),
`contentInsightsKeys`, and the read hooks in
`application/useContentInsights`.

- **The three stat tiles share one query key**, so TanStack dedupes them into a
  single `content/totals` request while each widget keeps its own pending and
  error state. Independent loaders without three round-trips for one aggregate.
- **Keys are workspace-scoped**, like every other content key: the workspace
  only reaches the server as an ambient header, which is never sent on a cache
  hit, so without the id in the key switching workspaces would show the previous
  one's numbers and never refetch.
- **`retry: 1`, not TanStack's default 3.** Three attempts with backoff leave a
  broken widget on a skeleton for ~7s, which reads as a hang rather than a
  failure on a page whose premise is that one card fails alone.
- **The Drafts tile shows a share of the total, not a delta** — see
  content-server's note on why a draft change figure would be invented.
- **The velocity widget takes its bucket width from the response**, rather than
  re-deriving it from the range: two places computing the same rule is two
  places to get it wrong, and the axis would silently mislabel.
- **Waiting to go live counts against _live_ records, not all of them.** "94 of
  1,046 live records have pending edits" is a backlog someone can clear; the
  same 94 against the whole content set says nothing about how far behind the
  site is. Never-published drafts are a footnote under the card rather than part
  of the headline — finishing a draft and pressing publish are different jobs,
  which is the same distinction the **Modified** badge exists to draw. Its empty
  state is `live === 0`: with nothing ever published, "0 pending" would claim a
  publishing habit the workspace does not have yet.

## Extension slots

The library exposes sixteen named slots (`presentation/slots/contentSlots`, via
`createSlot`) another admin plugin contributes into — no coupling beyond the
contracts, the same idiom as the workspace shell's slots.
`@apograph/i18n-admin` fills eight; `@apograph/media-admin` fills two
(`ENTRY_TAB_SLOT`, the Media tab, and `ENTRY_PRESAVE_SLOT`, its staged uploads);
`@apograph/wysiwyg-admin` fills one (`ENTRY_FIELD_CONTROL_SLOT`, the rich-text
editor); `@apograph/transfer-admin` fills three (`ENTRY_MENU_SLOT` and
`RECORDS_BULK_ACTION_SLOT` to export, `RECORDS_MENU_SLOT` to import);
`@apograph/segments-admin` fills three (`ENTRY_HEADER_SLOT`, the restricted chip;
`ENTRY_TAB_SLOT`, the Access tab; and `ENTRY_PRESAVE_SLOT`, which is what applies
an entry's audiences on Save rather than on a button of its own);
`@apograph/activity-admin` fills one (`ENTRY_TAB_SLOT`, the **Activity** tab —
who did what to this record, which the revision-timeline History tab cannot
answer).
**Slot items are boot-frozen**
(`createAdmin` registers them once, before the first render), which is what
makes the **hook-style** items (`RECORDS_COLUMN_SLOT.useRowsData`,
`RECORDS_FILTER_FIELDS_SLOT.useFields`, `ENTRY_PRESAVE_SLOT.usePresave`,
`ENTRY_MENU_SLOT.useItem`, `RECORDS_BULK_ACTION_SLOT.useItem`,
`RECORDS_MENU_SLOT.useItem`, `ENTRY_PUBLISH_GUARD_SLOT.useVerdict`)
rules-of-hooks-safe when the render
sites call them in a loop — the call order never changes; an item gates its own
fetching internally.

- **`RECORDS_TOOLBAR_SLOT`** — a control in the records toolbar; owns URL
  `listParamKeys` forwarded to the list request (and its query key), with
  `updateParams` (resets the page).
- **`RECORDS_MENU_SLOT`** — an action on the **collection**, in the ⋯ menu
  **last in the header's action cluster**, after **Add record** — the
  counterpart to `ENTRY_MENU_SLOT` one level up. Same shape (`useItem` hook,
  `null` to hide, an `overlay` rendered outside the menu) and the same reason
  for it: the menu content unmounts the instant the menu closes, which is when
  a dialog opened from it is meant to appear.
    - It is a **menu** and not more header buttons because what belongs here is
      the occasional whole-collection operation, and those should not take the
      header's one primary slot from **Add record**.
    - **`CollectionRecordsMenu` contributes one item itself**: **Trash**, via a
      `trashHref` prop (`paranoid && canDelete`, the pair that used to gate the
      header button). It is here because it is a _destination_, not an action,
      so it read oddly among buttons that do something — and because the menu
      otherwise held exactly one contributed item, making the ⋯ a button that
      hid a button.
    - **The trigger renders only when something resolves** — a contributed item
      or `trashHref` — so an install with neither sees no ⋯ opening onto
      nothing.
    - `@apograph/transfer-admin` fills it with **Import…**.
- **`RECORDS_BULK_ACTION_SLOT`** — an item in the records **selection bar's**
  ⋯ menu, after the built-in Publish / Unpublish / Delete (and, in the trash,
  Restore / Delete permanently). `useItem` receives the selected `ids` and
  `trashed`, plus `onDone` to clear the selection.
    - The bar's own layout is **count · Clear · ⋯**: everything the bar can do
      to the selection lives in the menu, and **Clear** stays outside it,
      because it is the way _out_ of a selection the user may have made by
      accident — burying that behind the same menu as Delete would be the wrong
      shape. Contributions sort after the built-ins and above the separator the
      destructive actions sit below.
    - Its `overlay` is rendered outside `DropdownMenuContent` for the same
      reason `RECORDS_MENU_SLOT`'s is — the menu content unmounts the instant
      the menu closes. On top of that, the bar unmounts as soon as the selection
      is empty, taking the overlay with it — so an action whose dialog must stay
      open calls `onDone` on success, never on open.
    - **The trigger renders only when an item resolves** — a viewer with neither
      publish nor delete, and no contribution, sees no ⋯ button.
    - `@apograph/transfer-admin` fills it with **Export**.
- **`RECORDS_COLUMN_SLOT`** — an extension table column (`COLUMN_KIND.Extension`)
  that joins the column picker like any column (non-sortable header); optional
  `useRowsData` batches per-page data once for all its cells.
- **`ENTRY_SIDEBAR_WIDGET_SLOT`** — a **section** of the entry editor's
  Properties rail (render the exported `EntrySidebarSection` /
  `EntrySidebarRow`, not a card — see _The Properties rail_ above),
  rendered with an `EntrySlotContext` (schema, entry?, isCreate, mode,
  workspaceId, typePath, **params**, **tabSegment**) assembled by
  `ContentEntryView` and shared
  via `EntrySlotContextProvider`. `params` is the current URL values of the
  `ENTRY_PARAMS_SLOT` keys (list + create-body), opaque — a slot reads only its
  own keys (e.g. i18n scopes the relation picker by its `locale` even on a create
  form, where there's no saved `entry`). `tabSegment` is the open tab as a path
  segment (`'/relations'`, or `''` on the default tab) — a slot that navigates
  the user to **another record in this same editor** appends it so they land on
  the tab they were working in.
- **`ENTRY_DETAILS_ROW_SLOT`** — one **row** of the Details block, for a
  property of the record that belongs beside its id and timestamps rather than
  in a section of its own. An item is `{ id, order, appliesTo?, Component }`
  with the same `EntrySlotContext`, and the `Component` must render an
  `EntrySidebarRow` (a `<dt>`/`<dd>` pair) or `null` — the rows render inside
  Details' own `<dl>`, so a `<section>` there is invalid markup.
    - **`order` is load-bearing.** `Slot.getItems()` returns registration order
      and does not sort, so `DetailsBlock` sorts on it — the same contract
      `EntryMenu` and `CollectionRecordsMenu` keep. Built-in rows always come
      first; contributions follow in `order`.
    - It exists because a whole rail block for one read-only line is what the
      rail was being slimmed of: `@apograph/i18n-admin` fills it with the
      **translation-group id**, which used to be the tail of a Locale panel.
- **`ENTRY_HEADER_SLOT`** — an inline element in the entry editor's title row,
  rendered **after** the `<h1>` (the heading stays the sole `<h1>`) with the
  same `EntrySlotContext`. Used for the i18n plugin's locale chip, which is
  also the **locale menu's** trigger.
  Since `ORT-202` the editor's heading is the shared `ContainerHeader` rather
  than a hand-rolled `<h1>`, so these items ride its `actions` region: still
  after the heading in DOM order, still outside it, and now aligned with the
  header's actions on every other page.

    An **empty** contribution list has to be passed as `undefined`, not `[]` —
    `ContainerHeader` draws its actions row for anything truthy, and an empty
    array is truthy.

- **`RECORDS_FILTER_FIELDS_SLOT`** — extra query-builder filter fields, appended
  after the server-derived fields (`useFilterFields`) at the call site.
- **`CONTENT_OVERLAY_SLOT`** — viewport-level chrome, rendered once by
  `ContentLibraryPage` (via `ContentOverlays`) **outside** its `<Routes>`, so a
  contribution stays mounted across every navigation within the library —
  including the window where the entry editor has replaced itself with a loading
  state. That window is why the slot exists: the i18n plugin's locale-switch
  cover used to be rendered by the editor's sidebar widget, i.e. inside the very
  tree that unmounts while the destination record loads, so it vanished
  mid-transition and came back after — two loaders blinking in sequence. A cover
  has to outlive the thing it covers. Takes no props; anything view-specific
  belongs in a narrower slot.
- **`ENTRY_PARAMS_SLOT`** — non-visual plumbing: params scoping the single-mode
  one-entry read (`listParamKeys`), URL values copied into the create body
  (`createBodyKeys`; each must exist on the server `SaveEntryDto`), and extra
  relation-candidate list params (`relationCandidateParams`, consumed by the
  picker dialog through the slot context).
- **`ENTRY_TAB_SLOT`** — a whole editor **tab** (id + `slug` + `label` + `order`
    - `appliesTo` + `Component`). Rendered between Relations and History when
      `appliesTo(schema)` holds; the `slug` must be a known `ENTRY_TAB_SLUGS` member
      so the tab router/`entryTabFromPath` accept it. The Component receives an
      **`EntryTabContext`** — the `EntrySlotContext` plus a **form bridge**
      (`values` / `errorFor` / `setValue` / `touch` / `isFieldDirty`) and the saved
      entry's resolved `mediaRefs` — so a contributed tab renders controls bound to
      the editor's shared form: a field edited there rides Save, the Changed badge,
      the publish gate, and the 422→field mapping exactly like a General-tab field.
      `@apograph/media-admin` fills it with the **Media** tab (media fields live in
      the values bag; the tab is only their rendering surface). `useSaveEntry` also
      invalidates the entry-media cache so the tab reflects the saved set. The
      context also carries **`presave`** — the handles below, so a tab reaches state
      that has to outlive its own body.
- **`ENTRY_MENU_SLOT`** — an action in the entry editor's **⋯ menu**
  (id + `group` + `order` + optional `appliesTo` + **`useItem`**). The menu is laid
  out in `ENTRY_MENU_GROUP` sections — `save` · `publish` · `extras` · `danger`,
  a rule between non-empty ones — and the built-ins sit in them too (Save draft +
  Save & publish, Unpublish, Delete), which is what makes a contribution land in a
  run of related actions instead of after Delete. Contributions default to
  `extras`.
    - `useItem(context)` is a **hook**, not static data: a real item needs
      queries, `useHasPermission` and its own dialog state. Return `null` to
      hide — that is how an item disappears **without skipping its hook**.
      `appliesTo` filters the _result_, never the call, so the hook count can't
      change when the open type does.
    - An item's `overlay` is rendered **outside** `DropdownMenuContent`, by
      `EntryMenu`. That is the whole reason the menu is its own component: the
      menu content unmounts the instant the menu closes — precisely when a
      dialog opened from it is meant to appear — so an item's dialog cannot live
      inside it.
    - `@apograph/i18n-admin` fills it with **Publish all locales** / **Unpublish
      all locales**.
- **`ENTRY_PRESAVE_SLOT`** — a plugin's participation in the **save itself**:
  `usePresave()` is mounted once per `ContentEntryView` and returns
  `{ commit, settle?, handle? }`. `commit(values, publish)` runs after client
  validation and **before** the write, under the busy cover, and returns the
  values actually saved — throwing aborts the save (the step owns surfacing its
  own failure). `settle(result)` is **awaited** once the write succeeded, still
  under the cover, and is handed the saved `entry` + `schema` + `created` +
  `published` — so a step may finish a write of its own there, which is the only
  place it can: on a create there is no entry id until the row exists.
  `@apograph/segments-admin` applies an entry's audiences from it. A `settle`
  that throws cannot abort anything (the entry is written), so the loop swallows
  it and the step owns surfacing its own failure, exactly as `commit` does.
  `handle` is published to contributed tabs as `EntryTabContext.presave[id]`,
  opaque, each tab reading only its own key.
  This is what lets `@apograph/media-admin` **defer uploads to Save**: files
  chosen on a media field are staged under a placeholder uuid (which the values
  bag holds, so validation and the publish gate treat them like any asset id),
  and `commit` uploads them and swaps in the real ids. The staging lives in the
  hook because editor **tabs are routes** — the Media panel unmounts on every tab
  switch, and a file staged there must not die with it.
- **`ENTRY_PUBLISH_GUARD_SLOT`** — the **third gate** on the editor's publish
  button, and the admin-side counterpart of content-server's
  `CONTENT_PUBLISH_GUARD` port. `useVerdict(context, { dirty })` returns
  `{ blocked, reason?, action?, overlay? }`, or `null` for no opinion.
  `@apograph/protection-server`'s admin half fills it with an approval rule.
    - **`dirty` is part of the question.** Publish saves anything unsaved
      first, and a save is a new version — so a guard whose verdict is bound
      to a version has to answer for the one about to be written.
    - **An action keeps the button an ordinary Publish.** No relabel, no
      warning tone: the way through is explained by the ceremony the click
      opens. `action.onSelect(publish)` receives the editor's own publish, and
      the contribution calls `publish({ bypass: true })` when its ceremony is
      done — which is what saves the edits on screen, or creates the record on
      a create form, before the bypass reaches the publish request. Content
      forwards `bypass` uninterpreted, as the server's use-case does.
    - **The ⋯ menu's "Save & publish" goes through the same handler**, and is
      disabled when the primary button is held with no way through — otherwise
      the menu is the door a refusal forgot to close.
    - **Content keeps rendering the button.** It already computes the publish
      gate's half of that button's state, and a contributed second button would
      drift from the first on every state neither owns alone — the same reason
      `ENTRY_FIELD_CONTROL_SLOT` keeps the label row and `REVISION_EXTRA_SLOT`
      keeps the two-column layout.
    - **Content learns nothing about what refused it.** It gets a sentence to
      show and, when the contribution offers a way through, a callback. That is
      what lets a bypass confirmation and its audit row live entirely in the
      contributing plugin — the discipline the server-side port follows when it
      forwards `bypass` without interpreting it.
    - **The first refusal wins**, as on the server. Later items are still
      _asked_ — they are hooks, and skipping one would change the call order —
      but their verdicts are not read. Overlays are collected from every item.
    - **A blocked button is `aria-disabled`, not `disabled`.** A `disabled`
      button is not focusable and fires none of the pointer/focus events a
      tooltip needs, so the reason would be reachable only by hovering — unusable
      by keyboard and silent to a screen reader, for the person most likely to
      need it. The reason is rendered as an `sr-only` sibling referenced by
      `aria-describedby`, **not** as a child: text inside a control joins its
      accessible _name_, which would announce the whole refusal as the thing to
      press. Same treatment as users-admin's `GuardedMenuItem`.
    - **A guard speaks about publishing only.** A verdict is read only when the
      primary button _is_ Publish, so a refusal can never disable the draft save
      on a type whose drafts are explicitly still editable.
    - **With nothing contributed the button is exactly what the publish gate
      alone made it** — invariant `protection:I-03`, pinned by
      `EntryActions/index.spec.tsx`. An empty slot is the state this seam spends
      almost all of its life in, and nothing else would record that it was a
      decision rather than an accident.
- **`REVISION_EXTRA_SLOT`** — a row in the **revision preview** for state a
  plugin stores alongside the entry rather than in its values: what
  content-server's entry-write extensions record in `RevisionSnapshot.extra`.
  An item is `{ key, label, Component }`, and the `Component` renders **one
  side's** value — the two-column Current → Version {n} layout, the "Changed"
  badge and the unchanged-set collapse stay with content, for the reason
  `ENTRY_FIELD_CONTROL_SLOT` keeps the label row.
    - Whether the two sides differ is decided **here**, by a structural compare
      of the raw values, never by the item: a plugin reporting its own row
      identical would let a restore change something the dialog promised it
      would not.
    - A row is dropped only when **neither** side recorded anything. With one
      side absent there is still something to say — restoring a version that
      knows nothing leaves today's answer standing, which is exactly what the
      reader needs told.
    - `@apograph/segments-admin` fills it with the entry's audiences, so "what
      would restoring this version change" includes who could read it.
- **`ENTRY_FIELD_CONTROL_SLOT`** — a per-field **control override**. An item is
  `{ id, appliesTo(field), Component }`; `EntryFieldInput` resolves the **first**
  match before its type switch and mounts the component in place of the built-in
  input, everywhere the form renders (records editor and single alike, General
  tab and the Translated/Shared groups).
    - Only the **input** is handed over. The label row (label, required mark,
      Changed badge, localized globe), the description, and the `<FieldError>`
      stay with `EntryFieldInput`, so a contributed control can't drift from the
      built-ins on any of it. The item gets an `EntryFieldControlContext`:
      `field`, the `id` the `<label for>` points at (put it on the **focusable**
      element), the resolved `label`, `value`, `error`, `describedBy`,
      `onChange`, `onBlur`.
    - Unlike the hook-style slots this one is resolved with a `find`, not a loop:
      it holds **components**, and mounting one is what runs its hooks. First
      match wins in registration order, so a later plugin never silently steals
      a field an earlier one claimed — keep `appliesTo` narrow (a field type,
      plus an `admin.widget` opt-out).
    - An item may also declare a **`FullView`** — an expanded editing surface
      `EntryEditor` renders **in place of the tab strip**, filling the work area,
      once the control calls `setExpanded(true)`. The record's title row stays
      above it and the chrome around it is untouched: the app sidebar, the top
      bar's Save / Publish, and the Properties rail all keep working, because the
      expanded view is still inside this form — same tree, same values, the
      publish gate updating as the author types. That is the point of a view swap
      over a dialog, which would cover the rail it should be updating and put
      Save behind an overlay. The state (which field is expanded, at most one)
      lives in `EntryEditor` and reaches `EntryFieldInput` through
      `hooks/useExpandedField` — a context, because the path runs through
      `EntryFieldSections` and `FieldGroup`, neither of which has any interest in
      it. An item with no `FullView` never expands, and its control's
      `setExpanded` is a no-op.
    - `@apograph/wysiwyg-admin` fills it for `richtext`: the `Component` is a
      rendered preview of the body, the `FullView` is the TipTap editor it
      expands into.
    - **A contributed control's own `<form>` cannot submit the record.** The
      editor's `<form>` ignores any submit whose `target` isn't itself, because
      a control that portals a dialog or popover is moved in the DOM but **not**
      in the React tree — and React bubbles synthetic events along that tree. A
      Save button inside the WYSIWYG's alt-text popover therefore arrived at
      this handler and saved-and-_published_ the whole record. Contributed
      overlays should `stopPropagation` on their own submit as well; the guard
      here is what makes the seam safe for the ones that forget.

The data hooks accept slot-contributed passthrough: `useContentEntries` (`extra`
list params), `useSaveEntry` (`extra` create-body params), `useRelationCandidates`
(`extra`). Wire types carry `i18n` (summary/detail), `localized` (field), and
`locale`/`localeGroupId` (`EntryRecord`).

Two generic hooks surface the `localized` schema flag (same way the editor
already surfaces `required`), so a locale plugin needs no field-level slot:

- `EntryFieldInput` renders a small **localizable indicator**
  (`LocalizedFieldMark` — a `Globe` in a **`Tooltip`**, opening on hover _and_
  focus; it was a bare span with a native `title`, which never surfaces for
  keyboard or touch users) when `field.localized`. Its trigger suppresses the
  surrounding `<label>`'s activation, so reading the hint never focuses — or, on
  a toggle, flips — the control it describes. It shares a single right-aligned
  **end-adornment** with the
  "Changed" badge (the `changed` prop) at the far right of the label row (a
  `w-full` `FieldLabel`, or `InputField`'s `labelAction` slot) — so the badge and
  the globe sit **side by side** instead of overlapping. The `changed` flag comes
  from `EntryFieldSections` (`isChanged`); the badge is no longer an absolute
  overlay. Self-scopes (only i18n types ever mark a field localized).
- A **required** field's label carries a `RequiredMark` (`*`) and its control
  carries `aria-required`. The mark is deliberately `aria-hidden`: the control
  already announces "required", so marking the asterisk up too would say it
  twice on every required field.
- `EntryFieldSections` **groups the General tab by locale scope** when the type
  has both kinds of field: a **Translated fields** run (`localized`) over a
  **Shared fields** run, each a `FieldGroup` with a one-line explanation —
  editing a shared field changes it in _every_ locale, which is not something to
  discover after saving. A type with only one kind (every plain, non-i18n type)
  keeps the flat, header-free stack, so this is inert outside i18n.
- `RelationFieldSection` marks **how a relation carries across the record's
  other languages** with a `RelationSyncMark`, read off the field's own
  `relation.localeSync` (`shared` / `mirrored` / `none`; absent on a type with
  no locales, where the mark renders nothing). It reads that rather than the
  target's `i18n` flag for two reasons: only the server's derived mode answers
  the question an editor actually has — _does saving this change German too?_ —
  and an opted-out relation to a localized target reports `none`, which the old
  target-flag check got backwards. It also no longer waits on the target
  schema's fetch. Like its predecessor it labels the _field_, not each linked
  row: the picker scopes candidates strictly to the record's locale, so one
  identical locale repeated down every row would be noise.
- `ContentEntryView` create mode reads `location.state.translateFrom` (a source
  record's values) and seeds the blank form with **only the non-localized**
  fields — the "create a translation" prefill; localized fields start empty.
- **A save keeps the user on the editor** — success is surfaced via a `toast`,
  not a bounce back to the records list. A brand-new record (any create, incl. a
  translation sibling) navigates to its own editor `${typePath}/${saved.id}` so
  the id is in the URL and a further save updates it; an existing record stays in
  place (its `useSaveEntry`-invalidated query refreshes the Details/status); a
  single stays put (`?locale=` re-resolves). The "Back to records" link is the
  way back.

## Package

- Name: `@apograph/content-admin`
- Import: `import { ContentPlugin } from '@apograph/content-admin'`
- Grouped package (`packages/content/admin`), admin-only. Consumed from source
  (`exports` → `./src/index.ts`); no build step.
- Register it in `createAdmin({ plugins })` **after** `WorkspacesPlugin()` — it
  contributes only to the workspace shell's slots
  (`WORKSPACE_SECTION_SLOT` + `WORKSPACE_ROUTE_SLOT`), which `WorkspacesPlugin`
  owns, so it depends on `@apograph/workspaces-admin`.

## Lives strictly inside a workspace

This plugin contributes **no top-level route and no global nav item**. It adds
the **Content section** (`WORKSPACE_SECTION_SLOT`, its `ContentNavSection`) and a
`content/*` route (`WORKSPACE_ROUTE_SLOT`, the lowest `order` so it is the
workspace's default landing) to the workspace shell — so it only ever renders
under `/workspaces/:id/content`. The page reads the open workspace via
`useCurrentWorkspace()` from
`@apograph/workspaces-admin`.

## Refusal, absence, and failure are three different states

The recurring defect in this package was collapsing them. Four rules, each
pinned by `apps/admin-e2e/src/content/records-resilience.spec.ts` or
`entry-validation.spec.ts`:

- **A failed catalogue is not an empty one.** `ContentNavSection` renders
  `ContentSidebarError` (an `alert` + retry) on `useContentTypes().isError`. It
  used to fall through to the "nothing granted" exit and `return null`, so the
  whole Content nav disappeared with no error and no retry while the pane beside
  it showed a proper error card. Its Retry button is the **primary** variant, not
  the pane's `outline` — an outline button's card background does not carry
  enough contrast against the sidebar's own surface.
- **A URL parameter the server would reject must degrade, not strand.** `page`
  is clamped to `pageCount` once a fetch settles (guarded on `!isPlaceholderData`
  so it reads the fresh total), and `pageSize` is narrowed to `PAGE_SIZE_OPTIONS`
  before it is ever sent — the server answers **400** above its cap rather than
  clamping, and the resulting error card had no way out, because Retry re-sends
  the same parameter and the rows-per-page control lives in a footer that needs
  rows to render.
- **A mutation that removes a row must tell the view.** Row actions call
  `onRowGone(id)` after a delete / purge / restore; `LoadedRecordsView` drops the
  id from the selection (which is keyed by id and spans pages, so nothing else
  would) and `CollectionRecordsTable` moves focus to its own labelled container
  — Radix would otherwise try to restore focus into a menu that has unmounted
  and drop it on `<body>`.
- **A field the editor renders nowhere must not gate the form.** `admin.hidden`
  fields join ungranted relations and link-managed relations in
  `validationIgnored`. The publish gate is built from the _visible_ fields, so a
  hidden required field made the rail read "ready" while validation still counted
  it and the toast named it — a control the user could never find. The server
  stays the authority; `submitWith` promotes a 422 issue naming an unrendered
  field to a toast, since it has nowhere inline to land.

**Contributed tab slugs are a closed set.** `ENTRY_TAB_SLOT` items whose `slug`
is not in `ENTRY_TAB_SLUGS` are dropped (with a console error): the route table
would match the segment, but `entryTabFromPath` cannot resolve it, so the tab
rendered a trigger that navigated and then showed _General_ under a URL saying
otherwise.

**Cells state values, they do not echo them.** A `boolean` cell reads
localized Yes/No rather than `String(value)`, and a `money` cell is formatted as
a **number** at the kernel's fixed scale of 2 — the field spec carries no
currency member, so the old `currency: 'USD'` was the admin inventing one. Bare
`select` / `multiselect` option strings are still printed raw because the DSL
offers no per-option label to use instead.

## Conventions

Follows the workspaces-admin conventions: `type` over `interface`; JSDoc on
exports; `<name>/index.ts(x)` folders (pages in `presentation/pages/<Name>/`, the
factory in `presentation/contentPlugin/`); co-located `react-intl` messages
namespaced `content.<area>.<key>`; UI from `@apograph/design-system` only.

- **One component per file.** Never define a second React component in the same
  file — not as a `renderItem` closure, not as a sibling `function Foo()` above
  the export. Extract it. A component used by only one other component **nests
  inside that parent's folder** (its own `<Name>/index.tsx`, with co-located
  `messages`); a shared one goes under `presentation/components/`. Examples: the search
  palette's result row lives at
  `presentation/components/ContentSearchDialog/ContentSearchItem/`, and the bulk-publish
  dialog's row at `presentation/components/CollectionRecordsView/BulkPublishDialog/VerdictRow/`
  — not as functions inside their parent file.
- **No magic string literals for route segments, route params, keyboard keys, or
  permissions** — define them as named constants in `domain/constants/` and
  import them wherever they're used. `CONTENT_SEGMENT` is the single source of
  truth for the `content` mount path, shared by `contentPlugin` (slot `to` +
  route `path`) and `ContentLibraryPage` (`basePath`); `HISTORY_SEGMENT` /
  `TRASH_SEGMENT` / `TYPE_PARAM` drive the nested routes and the sidebar links;
  `TAB_PARAM` / `ENTRY_TAB` / `ENTRY_TAB_SLUGS` / `DEFAULT_ENTRY_TAB` are the
  editor's tab routes; `SEARCH_SHORTCUT_KEY` is the ⌘K key; `CONTENT_READ` is
  the permission gate.

## Commands

- `npm exec nx typecheck @apograph/content-admin`
- `npm exec nx lint @apograph/content-admin`
