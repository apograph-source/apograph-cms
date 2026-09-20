# @orthacms/media-admin

The **Media Library feature plugin** for the Ortha CMS admin UI. It mounts
**inside a workspace** at `/workspaces/:id/media` and ships the asset-management
experience: a folders sidebar beside a searchable/filterable/sortable asset
browser (grid **and** list views), an asset detail drawer, and the
create-folder / upload / rename / move / duplicate / delete flows — now **wired
to `@orthacms/media-server`** over `apiClient`.

## Data layer (wired to the API)

The page consumes one hook, **`hooks/useMediaLibrary`**, which is the store the
components read. Its internals use TanStack Query over the gateway; its returned
shape is unchanged from the original mock so no component had to change:

- **`infrastructure/mediaGateway`** — the port (interface) the plugin talks to.
  `uploadFile` is deliberately **singular** and takes `{ onProgress, signal }`;
  batching, concurrency, and retries belong to `useUploadQueue`, not the seam.
- **`infrastructure/httpMediaGateway`** — the **only** place `apiClient` is used;
  maps responses through the ACL and normalizes failures to `ApiError`. Translates
  the admin's `ROOT_FOLDER_ID` sentinel to/from the wire's `null` folder.
- **`infrastructure/mediaMapper`** — wire types (`AssetResponse` / `FolderResponse`)
  + `toMediaAsset` / `toMediaFolder`.
- **`infrastructure/mediaKeys`** — the per-workspace query-key factory; mutations
  invalidate `mediaKeys.all(workspaceId)`.

Folders (with per-folder + root asset counts) and the **open folder's** assets
are fetched. **Search, kind, sort and paging all go to the server** — they are
one `listParams` object used as both the request and the cache key, so the two
cannot disagree. They used to be applied in the browser over one fixed page of
100, which is what made "oldest first" order the *newest* hundred and let a
search miss a file that plainly existed; neither is fixable client-side, because
the answer depends on rows the browser was never sent. Mutations post to the API
and invalidate the cache; `apiClient` attaches `X-Workspace-Id` automatically
inside the workspace shell.

## Permissions

`MediaLibraryPage` gates on the real matrix via `useHasPermission`: `media:read`
gates the queries (`enabled`) and renders a no-access state when absent;
`media:create` / `media:update` / `media:delete` gate the write controls (mirror
of the server's RBAC, which is the real enforcer).

## What it does

- **Header** — a sticky **`MediaTopBar`** (the shared design-system
  `TopBar`/`TopBarIcon`: the teal `Image` tile matching the plugin's workspace-nav
  entry, plus a breadcrumb Media Library › ancestor folders › open folder). It
  spans **both** panes at the top of the page, the same page-context header every
  other admin page carries. Unlike the Content Library's bar it is **not**
  route-derived — folder navigation here is component state, not a URL segment —
  so crumbs come from the store and dispatch `onNavigate`; they render as
  `BreadcrumbLink`s over real `<button>`s, since a control that changes view
  without changing location is a button. It **replaced** the old in-page
  `MediaBreadcrumbs` (deleted), which would otherwise duplicate the path.
- **Browse** — a left **`MediaFoldersNav`** (folder tree headed by "All media",
  a New-folder action, a storage meter). The main pane shows a title/count, the
  **`MediaToolbar`**, and the content.
- **Flush layout, no island.** Both panes render directly on the page background
  (no muted board, no bordered/rounded/shadowed card), mirroring the Content
  Library's `ContentPane`; a hairline `lg:border-r` divides the sidebar from the
  browser and each pane scrolls independently. The page sizes itself with
  `flex-1` against the workspace shell's `min-h-svh` column rather than its own
  `svh` calc — one viewport measurement in the chain, so no phantom scrollbar at
  non-100% zoom. Component-level cards (asset tiles, the table, the selection
  bar) stay bordered; only the page chrome is flat.
- **One view — the grid.** **`MediaGrid`** (tiles; images render their real
  preview via `asset.url`, other kinds a gradient + glyph). The `grid`/`list`
  toggle and the `MediaTable` list view were **removed**; there is no `MEDIA_VIEW`
  constant and the store holds no `view` state. Select-all went with the table
  (it lived in that table's header) — selection is per-tile plus the selection
  bar's Clear.
- **Find** — a search box (name + tags), a **type filter**, and a **sort** select.
- **Select + bulk-act** — checkboxes + a header select-all feed a
  **`MediaSelectionBar`** (Download / Duplicate / Move / Delete / Clear).
- **Per-asset actions** — the shared **`AssetActionsMenu`** (Download, Copy link,
  Duplicate, Rename, Move, Delete), routed through one dispatcher. It carries
  **no "Open" item**: in the drawer that re-opened the drawer already on screen,
  and on the tile it tripled up with the thumbnail and the filename, which are
  both already buttons dispatching `'open'`. The `'open'` action kind remains —
  only the menu entry is gone.
- **Detail drawer** — **`AssetDetailDrawer`** (preview, actions, metadata, alt, tags).
- **Dialogs** — **`NewFolderDialog`**, **`UploadDialog`**, **`RenameDialog`**,
  **`MoveAssetsDialog`**, and `ConfirmDialog`.
- **Deleting a folder takes its contents with it**, so the confirmation says so:
  `utils/folderContents` counts the subtree from the already-loaded tree
  (`folders` + `folderCounts` — no extra request, as fresh as the last folders
  read) and the prompt reads "Delete “X” and everything inside?" over "…also
  deletes 3 assets and 1 subfolder". An empty folder gets the plain wording
  instead — reciting an inventory of nothing is just noise. The per-folder ⋯
  trigger is named after its folder ("Actions for Images"), so a grid of folders
  isn't a row of identical "Folder actions" buttons.
- **Upload — stage, preview, then watch it go.** `UploadDialog` takes multiple
  files (drag-and-drop *and* a `multiple` picker, accumulating across drops) and
  stages them as **`StagedFileRow`**s: images get a real thumbnail from a local
  `URL.createObjectURL` (revoked on unmount — a staged 200 MB video would
  otherwise leak for the tab's life), other kinds a MIME-derived glyph. Confirm
  closes the dialog and hands the `File`s to **`hooks/useUploadQueue`**, which
  uploads at most `UPLOAD_CONCURRENCY` (3) at a time, **one request per file**,
  and drives the **`MediaUploadBanner`** above the browser: a size-weighted
  overall bar plus a `MediaUploadRow` per file (live %, retry on failure, cancel
  in flight via `AbortController`). One file per request is the point — the old
  `Promise.all` lost a whole batch to a single rejection. The queue keeps `File`s
  and its runner bookkeeping in **refs**, not state, so a progress tick
  re-renders only the small `UploadItem` rows. Because the dialog closes on
  submit, **there is no upload success toast** — it would claim a result that
  hasn't happened; the banner is the status surface, and the query cache is
  invalidated once per settled batch. The **dialog** is shared with the content
  editor's media field (below); the queue and banner are the library's own, since
  a field defers its uploads to the record's save.
- Every other action fires a **toast** — **on success, not on submit**. Every
  store action returns `Promise<boolean>` (`settle` in `useMediaLibrary`), and
  the page chains its confirmation on it. Firing at dispatch time is what put
  "Renamed to “a/b.png”" on screen beside "Request failed with status code 400";
  the rejection is already handled by `onError`, so the page only has to hold
  its own sentence back. Failures surface a toast + resync.
- **Failures speak the API's words.** `toApiError` puts the *transport's*
  description in `ApiError.message` and the parsed body in `details`, so a call
  site reading `.message` shows a status code where media-server sent a sentence
  ("File exceeds the maximum upload size.", "Invalid file name: a/b.png").
  Everything user-facing goes through **`infrastructure/apiMessage`**, which
  reads the body and falls back to local copy — the upload rows included.
- **Alt text is writable in two places, and nowhere else.** `media_asset.alt` is
  a per-asset column the server has always had; the admin used to *render* it
  (read-only, and only when already set) without ever offering to write it, so
  an image that landed undescribed stayed that way while the Insights
  alt-coverage card counted it. Now: an optional **Alt text** input per staged
  **image** in `UploadDialog` (opt-in via `collectAlt` — a caller that would drop
  the value, like a media field, must not ask for one), sent as the `alt` part of
  the upload; and an editable field in `AssetDetailDrawer` behind `media:update`,
  through the gateway's `updateAsset`. Neither blocks anything: skipping alt
  uploads exactly as before, and a blank value is never sent.
- **No size is quoted in the upload copy.** The cap is
  `config.plugins.media.maxUploadBytes` (50 MB by default) and no route reports
  it to the admin, so the old "up to 250 MB each" was a number nothing enforced —
  a 52 MB file staged happily and 413'd after transferring in full. Until the
  cap is readable, the hint says what kinds are accepted and not how big.
- **A confirmed delete hands focus to the grid.** The ⋯ menu and the confirm
  dialog each restore focus to their own trigger, both of which sit on the tile
  the delete just removed, so focus ended on `<body>`. The page claims
  `ConfirmDialog`'s `onCloseAutoFocus` and focuses a labelled, `tabIndex={-1}`
  "Assets" section, reclaiming it for a few frames if another layer's restore
  lands later. Cancelling is untouched — its trigger still exists.

## The content editor's Media tab

Beyond the library page, this plugin contributes the **Media tab** of the
content entry editor via content-admin's **`ENTRY_TAB_SLOT`** (hence the
`@orthacms/content-admin` dependency; the tab appears only when the open type
has a `media` field — `appliesTo` checks `CONTENT_FIELD_TYPE.Media`). Pieces:

- **`EntryMediaTab`** — the slot `Component`. Reads the schema's media fields and
  renders one **`MediaFieldSection`** each, bound to the editor's shared form via
  the slot's form bridge (`ctx.form.values` / `setValue` / `errorFor` / `touch` /
  `isFieldDirty`). Media values live in the entry values bag; the tab is only
  their surface.
- **`MediaFieldSection`** — one field as a **titled card**, deliberately the same
  shape as the Relations tab's `RelationFieldSection` so the two contributed tabs
  read as one editor: header (heading + required mark, the localized globe in a
  `Tooltip`, the **shared** `ChangedBadge` imported from `@orthacms/content-admin`
  — not a look-alike that would drift — and an error alert icon) over a one-line
  description of what the field holds, then the control; an error tints the card
  border. The field is named as a **group** (`aria-labelledby` → its `<h3>`), not
  by a `<label for>` pointing at a button: a media field is a *composite* control
  (pick / upload / remove / reorder), and a label would **replace** the trigger's
  own accessible name — the a11y tree read "Cover image, button" instead of
  "Select from library". As a group it reads "Cover image, group" and then each
  action by its own name, which is also what makes the e2e locators legible.
- **`MediaFieldControl`** — the control itself. Attached assets render as
  **`MediaFieldItem`** tiles in a panel that is also a **drop zone** (highlight
  held by a drag-depth counter, since nested tiles fire `dragleave` as the
  pointer crosses them). Empty, the panel is a dashed `Empty` state that says so
  and invites the drop. Below sit **Select from library** / **Add from library** /
  **Replace**, **Upload**, and a muted meta line (attached count + the `accept`
  hint — the hint was a `Badge` beside the buttons, which read like an action). It
  writes an asset id (single) or id array (multiple).
- **`MediaFieldItem`** — one attached asset: the **thumb derivative** (or the
  deterministic `assetGradient` behind its kind glyph) over the name and whatever
  type / size / dimensions are known (`types/mediaFieldDisplay` is the merge of a server
  `MediaRef` and a locally-picked `MediaAsset` — a ref carries no size), with
  hover/focus-revealed controls: open in a new tab (the **original**), remove,
  and — multiple only — nudge up/down beside a position badge. A `missing` ref is
  an explicit warning tile carrying the dead id, so it can be found and removed.
  An id whose ref hasn't arrived yet renders a **`resolving` placeholder**, not a
  guessed `/raw` URL: guessing meant every edit-mode open fetched full-size
  originals for the window before `useEntryMedia` landed — to draw a 180px tile —
  and printed a uuid where the file name goes. Waiting is keyed on
  `EntryTabContext.mediaRefsPending`, so it ends: once the read **settles**
  without a ref (it failed, or no media server binding is present) the tile falls
  back to the original rather than waiting forever. Both halves are pinned by
  admin-e2e.

**Uploading is gated on `media:create`, picking on `media:read`** — not decoration:
uploads are deferred into the save, so an ungranted upload 403s *inside the write*
and takes the user's unrelated edits down with it. Without `media:create` the
Upload button and the drop zone are gone; without `media:read` the picker trigger
is disabled and the card says why.

**A third gate sits above both: the record's own.** `EntryTabContext.readOnly`
(content-admin) is true when the reader has no `content:update` — or no
`content:create` on a create form — and `EntryMediaTab` threads it down through
`MediaFieldSection` to `MediaFieldControl` and each `MediaFieldItem`. It is a
*content* permission, distinct from the `media:*` matrix: a user may hold every
media permission there is and still not be allowed to change **this record**, and
attaching an asset to a record is a write to the record. Read-only leaves the
tiles (preview, name, metadata, position badge, open-in-a-new-tab) and removes
everything else — the Select/Replace/Add and Upload row, the remove and reorder
controls, the drop zone (via `canStage`), and the `UploadDialog`, which is left
unmounted. The accept hint and the "no Media Library access" note go too: the
first describes attaching, and the second would blame the wrong permission.
- **`MediaPickerDialog`** — a wide modal over `useMediaLibrary`, **permission-
  aware** (the trigger is disabled without `media:read`, and the field says why)
  and with its own **error** state: a failed library read offers a retry instead
  of the empty state, because "nothing here" for a read that never landed sends
  the user hunting for assets that exist. Search, a type
  filter (listing only the kinds the field's `accept` allows, hidden when that
  leaves one), a sort, **breadcrumbs** over the folder chips — descending used to
  be one-way, with no path back up — and a grid of **`MediaPickerTile`**s
  (thumbnail + name + size/dimensions, `aria-pressed`, an "Attached" mark on what
  the field already holds). Skeleton tiles while loading, an `Empty` (with Clear
  filters) when nothing matches. Candidates are narrowed to the field's `accept`
  (the server enforces it on save); closing resets the selection **and** the
  filters, so a stale search can't hide the library on the next open.
- **Upload — the library's dialog, but nothing moves until Save.** Picking a file
  opens the same **`UploadDialog`** the library toolbar opens (stage → preview →
  confirm; dropping files on the field panel opens it *pre-staged*, so a drop is
  reviewed rather than sent blind), narrowed by new optional props: `multiple` /
  `accept` / `description` / `hint` / `confirmLabel` / `initialFiles`. (A single
  field stages exactly one file; `initialFiles` defaults to a module-level
  constant — an inline `[]` would re-seed the staging on every render.)
  Confirming **stages** the files; the bytes go up when the record is saved or
  published. See *Deferred uploads* below.
    `acceptsFile` (`utils/mediaAccept`, over the local `kindFromMime`) checks a
  staged file against the field's `accept` at the moment it's chosen, so a
  rejected file never reaches the value; the server re-checks the real asset on
  save, which is the enforcing pass.

## The rich-text editor's media sources

Beyond the Media tab, this plugin also fills **`WYSIWYG_MEDIA_SLOT`**, declared
by `@orthacms/wysiwyg-admin` (hence that dependency; it runs media → wysiwyg,
never the reverse — the editor must stay usable with no media plugin installed).
Two contributions, because they are different acts:

- **`WysiwygLibrarySource`** — the same `MediaPickerDialog` a media field opens,
  in `multiple` mode, narrowed to the kinds the editor can hold. One picker
  implementation, so an author moving between a field and a body meets the same
  browsing, searching, and folders.
- **`WysiwygUploadSource`** — the same `UploadDialog`, then one `uploadFile`
  request per file, then insert. Files land in `ROOT_FOLDER_ID` and the media
  caches are invalidated as soon as anything lands.

`utils/toWysiwygEmbed` is the one place an asset becomes the editor's model. It
returns `null` for anything the editor has no node for (audio, a PDF), which is
the second gate behind the picker's own `accept` filter. An image embeds its
**`previewUrl`** — a body has no use for a 12-megapixel original — and a video
its `url`; the asset's `alt` and pixel width ride along, so the node lands at a
sensible size with the alt text someone already wrote in the library. An asset
with no alt (and every fresh upload) arrives un-described — the editor prompts
for it on the image itself, which is where the author can see what the picture
is doing.

### Why this uploads immediately, unlike a media field

A media **field** defers uploads to the record's save (below), because the field
holds an *id* and an abandoned edit would litter the library. A **body** holds a
*URL*, and there is no URL until the bytes exist — so the upload has to happen
when the file is chosen. The trade is one-directional and deliberate: abandoning
the edit leaves an asset in the library, where it is visible and deletable,
rather than leaving the body pointing at nothing.

## Deferred uploads — a record and its new assets are one commit

**`hooks/usePendingMediaUploads`** is the plugin's contribution to content-admin's
**`ENTRY_PRESAVE_SLOT`**, and it is what makes "choose a file" and "save the
record" a single write. An upload is a write: uploading the moment a file is
picked fills the Media Library with assets for a record the user then abandons.

- A staged file gets a **placeholder uuid**, and that is what the form value
  holds. A real uuid on purpose — the shared kernel validates a media value as a
  uuid (or uuid[]), so a staged file satisfies client validation, the Changed
  badge, and the publish gate exactly like an attached asset. The `File` itself
  lives in the hook's map (`types/pendingUpload`), keyed by that placeholder.
- The hook is mounted by **`ContentEntryView`**, not by the tab: editor tabs are
  routes, so the Media panel unmounts the moment the user switches tab. Its
  `handle` reaches the panel back down through `EntryTabContext.presave[id]`
  (opaque; a tab reads only its own key, the same contract as
  `EntrySlotContext.params`), and `MediaFieldControl` renders the staged files as
  dashed "Uploads on save" tiles previewing off a local object URL.
- **`commit`** runs inside the save, before the write and under the busy cover:
  it uploads every staged file the values still reference (`UPLOAD_CONCURRENCY`
  at a time, one request each) and returns the values with the placeholders
  swapped for real asset ids. A failed file **aborts the save** with a toast
  naming it — nothing is written, so the form keeps its placeholders. The files
  that *did* upload remember their asset id (`PendingUpload.uploadedId`), so a
  retry attaches them instead of uploading twice.
- **`settle`** runs after the write succeeded: object URLs revoked, staging
  dropped (the re-seeded form now holds the saved record's real ids).
- Uploads land in `ROOT_FOLDER_ID`; the media caches are invalidated as soon as
  anything uploads, even if the write behind it then fails.
- Removing, replacing, or re-picking releases the staged file in one place
  (`setIds`) — the preview blob is revoked and the save stops uploading a file
  nothing references.
- **Picking an existing library asset is not deferred** — it is already uploaded;
  attaching its id is an ordinary form edit that rides Save like any other.

## Insights widgets

This plugin contributes the **media cards** on the Insights page via
`@orthacms/insights-admin`'s `INSIGHTS_WIDGET_SLOT` — media owns `media_asset`,
so it owns the cards reading it. Four contributions: a **Media storage** stat
tile in Overview, **What's using the storage**, **Uploads**, and **Images
missing alt text**. Data layer follows the package's shape —
`infrastructure/mediaInsightsGateway` (port), `httpMediaInsightsGateway`
(the `apiClient` use), and `hooks/useMediaInsights` (keys + read hooks,
workspace-scoped, `retry: 1`).

Two decisions worth keeping:

- **The storage widget's bars are bytes and only bytes.** An earlier draft
  scaled the bar by asset count while the readout showed size, which put two
  measures on one row and made the widget's whole point — that a few videos
  outweigh thousands of images — impossible to see.
- **Alt-text coverage takes no range.** Accessibility debt is a standing total,
  not something that happened in the last 30 days; windowing it would make the
  number shrink whenever someone narrowed the range. The headline is the
  **missing count**, not the coverage percentage: "794 images need alt text" is
  a job someone can pick up, where "68% covered" is a score.

## Lives strictly inside a workspace

This plugin contributes **no top-level route and no top-toolbar nav item**. It
adds an `Image` rail button (`order: 20`) and a `media/*` route to the workspace
shell — plus the content editor's **Media tab** (`ENTRY_TAB_SLOT`, above) — so it
only renders under `/workspaces/:id/media` and inside the content entry editor.

## Conventions

Follows the workspaces-admin / content-admin conventions: `type` over `interface`;
JSDoc on exports; **one component per file** with `<name>/index.ts(x)` folders
(pages in `src/lib/pages/`, components in `src/lib/components/`, the data layer in
`src/lib/infrastructure/`); no magic string literals (route segment, enums,
permissions, root-folder id in `src/lib/constants/`); co-located `react-intl`
messages namespaced `media.<area>.<key>`; UI from `@orthacms/design-system` only.

## Thumbnails — the grid never loads a full-size original

Image assets carry server-generated WebP derivatives — `thumbUrl` (~320px) and
`previewUrl` (~1280px), mapped from the API's `variants` by `mediaMapper`.
`MediaThumbnail` renders the `thumb` in grid + picker tiles and the `preview` in
the detail drawer (`size` prop), falling back to the full `url` when a derivative
is absent (an SVG, or an image too small to derive).

The **field tiles** follow the same rule from the other side of the wire:
`MediaRef` now carries `thumbUrl` / `previewUrl` (resolved by media-server's
`MediaAssetResolverQuery`), so `MediaFieldDisplay.url` is the derivative and
`originalUrl` — the full bytes — is reserved for the tile's open-in-a-new-tab
link. A staged upload puts its local object URL in the same slot, so the tile
renders one way regardless of where the image came from.

## End-to-end cover

The **Media tab** has an admin-e2e suite —
`apps/admin-e2e/src/content/media-fields.spec.ts`, driven by the
`MediaFieldPage` page object: picking from the library, the `accept` narrowing,
walking into a folder and back out via the breadcrumb, staging an upload and
asserting it is sent **only** on save (an upload spy proves the count is 0 until
then), dropping a staged file, appending + reordering a multiple field, a saved
record's assets resolving to names, and an axe scan with the picker open. Its
seeds are `MEDIA_FIELDS_*` in `support/api/content.ts` (their schema is what
makes the tab appear) plus the existing `mockMediaApi`.

Two harness details worth keeping: mock asset ids are **uuids**
(`MEDIA_ASSET_IDS` / `uploadedAssetId`), because the shared kernel shape-checks a
media value and a friendlier `a_hero` is refused client-side before any save;
and `mockEntryMedia` must be registered **after** `mockContentEntryWrites`,
whose multi-segment route would otherwise answer `/:id/media` with an entry
record.

The **Media Library page** still has only `media-library.spec.ts`.

The editor sources are covered from the other side, in
`apps/admin-e2e/src/content/wysiwyg-fields.spec.ts` (its `media` describe): that
both contributions appear in Insert ▸ Media beside the editor's own URL entries,
that a library pick stores the asset's URL and seeds the node's width, and that
nothing uploads when an existing asset is chosen.

## Not yet (follow-ups)

A keyboard suite for the field and the library; tag editing in the drawer
(read-only today — alt text is editable). Server-side pagination **is** done;
`useMediaLibrary` sends search, kind, sort, page and page size to the API.

## Unit cover

The package has a **vitest target** (`vite.config.mts`, jsdom). Component
*behaviour* still belongs in `admin-e2e`, which drives a real browser; what
lives here is the state a browser has no handle on:

- `hooks/useMediaLibrary` — the control → selection → page algebra. A selection
  that outlives the page it was made on is invisible and still armed, and a
  pager left past the end of a shrunken result shows an empty grid under a
  header claiming ninety files. Neither is an error state to look for.
- `hooks/usePendingMediaUploads` — the two clauses that exist only because the
  upload step and the write can disagree: a failed upload aborts the save, and
  the retry does not send the bytes that already landed. Both live across two
  `commit` calls.
- `infrastructure/mediaKeys` — every key factory in the plugin, enumerated by
  reflection rather than listed, so a new one written without a `workspaceId`
  fails on the day it is written.
- `components/WysiwygUploadSource` — that a body's file is uploaded *before*
  anything is inserted, and that a failed upload inserts nothing.

## Commands

- `npm exec nx typecheck @orthacms/media-admin`
- `npm exec nx lint @orthacms/media-admin`
- `npm exec nx test @orthacms/media-admin`
