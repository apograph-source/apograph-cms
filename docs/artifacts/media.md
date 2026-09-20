# Media

_Package group · packages/media_

**The media library, the storage seam, and everything that lives outside the database**

Media is the only place in Ortha where the system works with **bytes** rather than rows. It owns the media library's folders and assets, serves files to the browser, generates previews and — above all — holds the **storage port**: the port has six adapters, exactly one runs in a given deployment, and its name is written into every row of the assets table.

- **9** packages in the group
- **6** storage adapters
- **15** HTTP routes
- **2** database tables
- **3** migrations
- **4** permission keys
- **6** admin slots
- **5** agent tools

## Contents

- [01. Business description](#01-business-description)
- [02. The package group's composition](#02-the-package-groups-composition)
- [03. Roles and permissions](#03-roles-and-permissions)
- [04. Data model](#04-data-model)
- [05. A file's lifecycle](#05-a-files-lifecycle)
- [06. Scenarios — how it works step by step](#06-scenarios-how-it-works-step-by-step)
- [07. HTTP API](#07-http-api)
- [08. The admin UI: routes, screens, states](#08-the-admin-ui-routes-screens-states)
- [09. Configuration and the adapter matrix](#09-configuration-and-the-adapter-matrix)
- [10. Security and resilience](#10-security-and-resilience)
- [11. Invariants](#11-invariants)
- [12. Testing checklist](#12-testing-checklist)
- [13. Boundaries of responsibility](#13-boundaries-of-responsibility)
- [14. Discrepancies between the code and the documentation](#14-discrepancies-between-the-code-and-the-documentation)

## 01. Business description

The media library is an organisation's shared file store inside a workspace: images, video, audio, documents, archives. Everything an editor attaches to an entry, inserts into text or serves outwards through the public API first becomes an **asset** — a row in `media_asset` with a pointer to the bytes.

### The problem it solves

- **The database does not store bytes.** A row holds only metadata and the `storage_key` + `storage_provider` pair. A database dump stays a database dump rather than a terabyte of video; backups, replicas and migrations do not grow along with the media library.
- **One port, six backends.** The local disk, any S3-compatible storage (R2, AWS, MinIO, Spaces, B2, Wasabi), Azure Blob, Google Cloud Storage, Vercel Blob, and an in-memory one for tests. Moving between them is **one line** in the composition root, not a rewrite of the plugin.
- **The media library is private by default.** There is no such thing as a public link to a file: every byte goes through an application route that checks either workspace membership or a bearer token's scope. There is no separate “public bucket” and there should not be.
- **Previews instead of originals.** Raster images get two WebP derivatives on upload — a `thumb` (≤320px) and a `preview` (≤1280px). The media library's grid, media-field tiles and article bodies pull a derivative rather than a 12-megapixel original.
- **Accessibility as part of the model.** Alternative text is a column on the asset, set **right at upload time** (both by session and by token) rather than only by a second PATCH nobody makes. Plus timed-text tracks (subtitles, captions, descriptions, chapters) as separate pointer assets.
- **Agents work with the media library the way people do.** Five tools in the shared registry: three reads (searching assets, listing folders, reading a text file) offered to both the copilot and MCP; two “proposals” (alt text and creating a file) to the copilot only.

### Who sees it

#### The editor

Goes into “Media Library” inside a workspace, arranges files into folders, searches, filters by type, attaches to an entry through the “Media” tab or inserts into text. Uploads in batches — with progress, cancellation and a per-file retry.

#### The administrator / operator

Chooses the storage backend and its settings in `plugins.ts`, sets the upload ceiling, decides whether bytes flow through the application or by redirect. A configuration error is a startup refusal with an intelligible message, not a 500 on the first upload.

#### An integration / external agent

With a bearer token it can do exactly two things: upload a file and download it. Renaming, moving and deleting are session-only: attaching a picture to an entry is content authorship, whereas curating the library is administration.

### What Media is not

- **It is not a CDN and not public file hosting.** An asset's URL is the application route `/api/media/assets/:id/raw`, and it requires authentication on every request. Direct serving from the bucket is enabled separately (`directServe: 'signed-url'`) and only on a backend that can sign a URL with a pinned type and disposition.
- **It is not deduplication.** A sha256 is computed and stored in `checksum`, but it is **nowhere used for lookup**: uploading the same file twice yields two assets and two blobs. The column exists “for the future” — as the port says in so many words.
- **It is not transcoding.** Only raster images are processed (Sharp). Video is not cut, not re-encoded, and its duration is not measured — the `duration` column exists but nobody fills it in.
- **It is not content inspection.** The MIME type is what the uploader _declared_ in the multipart part. The bytes are not sniffed, there is no antivirus, and there is no allowlist of types at upload. Hence the entire serving policy: a file is considered hostile by default.
- **It is not the link to content.** Media does not know who references it. The “this asset exists and matches `accept`” check is done by `content-server` when saving an entry, through the `MEDIA_ASSET_RESOLVER` port that Media _implements_.
- **It is not the audit log.** The plugin writes `media.*` domain events into the transactional outbox; the log rows are laid down by `activity`.

> **The key architectural idea · ADR-0012**
>
> **One deployment, one storage provider, passed as one object.** No registry, no resolver, no `defaultProvider`: the bytes go to one place, so there is nothing to choose between. The object **describes itself** — an `id` (written into every asset row) and its `capabilities`. The price is stated openly: **changing backend orphans the files already uploaded**, so `StorageProviderCheck` refuses to start if the table holds rows from a different provider — and names that provider and the row count.

## 02. The package group's composition

Ten packages. The split is not cosmetic: an adapter must be able to depend on the port _without_ dragging NestJS, Drizzle and React along with it. Every adapter is a separate npm package with its own vendor SDK, and an application installs only the one it chose.

That claim was **false until the port got its own package**, and it is worth recording how. An adapter needs one _value_ from the core — `ObjectNotFoundError`, because `get` promises a particular rejection rather than merely some rejection — and it imported it from `@orthacms/media-server`, whose root barrel re-exports `MediaModule`. So `require('@orthacms/media-provider-local')` reached `@nestjs/common` three hops away, and `@orthacms/media-server` sat in every adapter's runtime `dependencies`: `npm i @orthacms/media-provider-s3` installed NestJS, Drizzle, Express and Sharp to talk to a bucket. Neither the manifests nor the direct imports showed it. `@orthacms/media-domain` now holds the port and its error and declares **no dependency of its own** — publishing adds `tslib`, which `tools/release/pack.mjs` stamps into every manifest because `importHelpers` is on workspace-wide, and that is the whole of it. So `npm i @orthacms/media-provider-s3` fetches the three AWS SDK packages, the port, and a helper runtime. The check is a transitive walk of the import graph rather than a scan of what an adapter names directly.

| Package              | npm name                             | Role                                                                                   | What it owns                                                                                                                                                                                                 |
| -------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| domain               | @orthacms/media-domain               | **The storage port**, and nothing else — what every adapter speaks                     | `StorageProvider`, its capability and payload types, `STORAGE_PROVIDER`, and `ObjectNotFoundError`. **No dependency of its own** (the release adds `tslib` and nothing else), which is the whole point of it |
| server               | @orthacms/media-server               | The NestJS plugin: routes, use cases, the schema, migrations, agent tools              | 2 tables, 15 routes, the `ImageProcessor` port, the aggregates and the domain-error layer                                                                                                                    |
| admin                | @orthacms/media-admin                | The admin plugin: the media library page + six contributions into other people's slots | `/workspaces/:id/media`, the editor's “Media” tab, the sources for the WYSIWYG, four Insights widgets, deferred uploads                                                                                      |
| provider-local       | @orthacms/media-provider-local       | **The default provider** — the file system                                             | `<workspaceId>/<assetId>/<name>` keys, atomic writes through `.part` + `rename`, protection against escaping the root                                                                                        |
| provider-s3          | @orthacms/media-provider-s3          | Any S3-compatible storage — written “from the endpoint”, not “from AWS”                | The **only** one that declares `directUrl: true` unconditionally; multipart with an `abort()` on failure                                                                                                     |
| provider-gcs         | @orthacms/media-provider-gcs         | Google Cloud Storage natively                                                          | Exists for those whose policy forbids HMAC keys; `directUrl` is **computed** from whether a signing key is present                                                                                           |
| provider-azure       | @orthacms/media-provider-azure       | Azure Blob Storage                                                                     | The only large storage **with no S3 compatibility at all**; SAS only with a shared key                                                                                                                       |
| provider-vercel-blob | @orthacms/media-provider-vercel-blob | Vercel Blob — the shortest configuration on Vercel                                     | **Every blob gets a permanent public URL** — the warning is carried in the docs, in a comment and in the generator's hint                                                                                    |
| provider-memory      | @orthacms/media-provider-memory      | Storage in a `Map` — for e2e and offline development                                   | **Published but not offered by the generator**: an application that loses every upload on restart is not a deployment                                                                                        |
| provider-testkit     | @orthacms/media-provider-testkit     | The port's contract as a runnable test suite                                           | One export — `describeStorageProvider(name, harness)`                                                                                                                                                        |

### Why the testkit is published

The port's invariants used to live only in prose, in `provider-local/AGENTS.md`. Each of them is a statement the core _relies on_ and cannot verify itself: it frees blobs by key, hands a `get` result straight into the HTTP response, and puts derivatives next to originals. A provider written outside this repository had no way of learning that it had broken one of them. So the suite is a **public npm package** rather than an internal file: it is addressed to the author of a third-party adapter.

What it checks: a non-empty `id` and complete `capabilities`; the presence of `directUrl()` exactly when `capabilities` says so; honest size and sha256; a byte round trip through `get`; different keys for two assets with the same filename; the impossibility of a derivative overwriting an original named `thumb.webp`; **no traces left behind by an aborted `put`**; a `get` refusal _before_ a stream is opened; the idempotency of `remove`; and that everything rejects a promise rather than throwing synchronously (a synchronous throw flies past the `try` that was supposed to free the blobs).

> **Neighbours that are easy to confuse**
>
> **`@orthacms/content-server`** declares the `MEDIA_ASSET_RESOLVER` port and Media _implements_ it — an “open host” inversion: content does not depend on media, the dependency runs the other way. **`@orthacms/wysiwyg-admin`** declares the `WYSIWYG_MEDIA_SLOT` slot and Media fills it — the editor must stay functional without the media plugin. **`@orthacms/insights-admin`** renders the Insights page, but the storage cards belong to Media, because Media owns the table. **`@orthacms/transfer-server`** moves files during export/import — through Media's normal upload path rather than around it.

## 03. Roles and permissions

Four permission keys, all granted to roles in `identity-server`. The model is flat: the permission is checked by a guard against a constant (`@RequirePermissions(PERMISSIONS.MEDIA_*)`), and there are no per-folder or per-asset permissions.

| Permission   | What it opens                                                                                    | admin | contributor | viewer | read token | full token |
| ------------ | ------------------------------------------------------------------------------------------------ | ----- | ----------- | ------ | ---------- | ---------- |
| media:read   | listing folders and assets, downloading bytes, three Insights widgets, three reading agent tools | ✓     | ✓           | ✓      | ✓          | ✓          |
| media:create | uploading a file, creating a folder, duplicating an asset, the copilot's file proposal           | ✓     | ✓           | —      | —          | ✓          |
| media:update | renaming an asset and a folder, moving, tags, alt text, subtitle tracks                          | ✓     | ✓           | —      | —          | —          |
| media:delete | bulk asset deletion, **cascading** deletion of a folder with all its contents                    | ✓     | —           | —      | —          | —          |

> **Why a token has neither update nor delete**
>
> `scopePermissions` in `identity-server` deliberately grants a bearer token neither `media:update` nor `media:delete` — in neither the `read` nor the `full` scope. Attaching a picture to an entry is content authorship, and without uploading a token **could not fill a media field at all** (the content writer rejects an asset id the workspace does not own). Renaming, moving and deleting other people's files in the library, on the other hand, is administration, and there is an administrator session for that.

### Three independent checking layers

- **The permission.** `PermissionsGuard` + a constant. On every route, without exception — the byte-serving route included.
- **The workspace.** `WorkspaceGuard` reads the `X-Workspace-Id` header and puts it into `@CurrentWorkspace()`. Every request but one goes through it.
- **The Origin.** `OriginGuard` on every state-changing route of the session half (POST/PATCH/DELETE). It is absent from the token routes: a non-browser client has no `Origin`, and there is nothing to protect.

> **The single exception to WorkspaceGuard — and why it is safe**
>
> `GET /media/assets/:id/raw` does **not** carry `WorkspaceGuard`. This URL is loaded by the browser itself — `<img src>` in the tiles and in the details panel, download links — and such requests send cookies but **cannot** send an arbitrary header, so the guard answered 400 on every preview. The scope is not discarded but **derived**: `DownloadAssetQuery.locate` reads the owning workspace from the asset's row, the controller requires the caller's membership _of that_ workspace (through the exported `MembershipCheckQuery`), and only then touches storage. A non-member gets **the same 404** as a non-existent asset — otherwise asset ids could be enumerated. Any new route whose URL is loaded by the browser needs the same treatment rather than a header guard.

## 04. Data model

Two tables, three migrations, and its own `__drizzle_migrations_media` journal. The plugin opens no connection — the client is injected from `@orthacms/database`; the host applies the migrations through `nx run server:db:migrate`.

| Table        | Purpose                     | Key fields and constraints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| media_folder | A folder inside a workspace | `id` uuid PK · `workspace_id` uuid **with no FK** (the workspaces table belongs to another plugin) · `parent_id` uuid nullable — `null` means the top level, and **there is no synthetic root row** · `name` text.<br>The `media_folder_ws_parent_idx` index on `(workspace_id, parent_id)`.<br>**There is no uniqueness of names among siblings** — no index and no check in the use case: two folders may share a name under one parent and are told apart by id.                                                                                                                                                                                                                                             |
| media_asset  | One uploaded file           | `id` uuid PK · `workspace_id` uuid with no FK · `folder_id` uuid nullable (`null` = the workspace's root) · `name` · `kind` — the `media_kind` enum (`image\|video\|audio\|document\|archive`) · `mime_type` — **the uploader's declaration** · `size` bigint · `storage_key` + `storage_provider` — the pointer to the bytes · `checksum` sha256 nullable (**stored only**) · `width`/`height` — filled in for raster images · `duration` — **always null**, video probing is not implemented · `tags` jsonb · `variants` jsonb · `alt` text nullable · `tracks` jsonb · `uploaded_by` uuid **NOT NULL** · `created_at`/`updated_at`.<br>The `media_asset_ws_folder_idx` index on `(workspace_id, folder_id)`. |

### The three jsonb columns, and what is in them

#### `variants`

A dictionary of `name → { key, width, height, size }`. Today it can hold `thumb` and `preview`. Every derivative is **a blob of its own** at the same provider, in the reserved `variants/` key space. Added by the `0001_asset_variants` migration.

#### `tracks`

A list of pointers, `{ kind, srclang, label, assetId, default? }`. The `kind` is one of `captions | subtitles | descriptions | chapters`: captions and subtitles are kept apart deliberately, as in HTML and in WCAG. The WebVTT file itself is **an ordinary library asset** with its own permissions and its own key, so it can be replaced without touching the video. The `0002_asset_tracks` migration.

#### `tags`

A flat list of strings, up to 50 of them at 64 characters each. Replaced wholesale on a PATCH. It takes part in search: `?search=` looks through both the name and the tags, via `jsonb_array_elements_text`.

### What is _not_ stored here

- **Bytes.** Never. Neither in a `bytea` nor in a large object.
- **Back-references to content.** Media does not know which entry references it — and does not find out on deletion (see section 5).
- **A public URL.** `AssetView.url` is assembled on the fly as `/api/media/assets/<id>/raw`; there is no column for it. No storage URL ever reaches the database or the API responses.
- **An index on `checksum`.** There is no deduplication; see section 1.

<details>
<summary>Domain events — seven kinds, all through the transactional outbox</summary>

`media.asset.uploaded`, `media.asset.updated`, `media.asset.moved`, `media.asset.deleted`, `media.folder.created`, `media.folder.renamed`, `media.folder.deleted`. Every state change runs inside a `UnitOfWork.run` over the repositories and the `OutboxWriter`, so the row and the event commit atomically: the log cannot show an upload that never happened and cannot miss one that did.

**The exception is workspace purging.** `MediaWorkspacePurger` works _in sets and without events_: one `delete … where workspace_id = …` per table, with no aggregates loaded and no `media.asset.deleted` per file. A workspace may hold tens of thousands of assets, and their individual deletions are not separately meaningful — the event that happened is `workspace.deleted`. The `returning` hands back exactly the storage columns, which is what freeing the blobs needs; that happens **after the commit**.

</details>

## 05. A file's lifecycle

**picked in the browser** — multipart → **an asset + blob(s)** ⇄ edits, moves, a copy ⇄ **in use** — deletion → **no row, blobs freed**

An asset has **no status column** and no drafts: it either exists or it does not. The states it passes through are the states of its _bytes_ and of the pointer to them.

| Stage           | What happens to the bytes                                                                                                                                                                                      | What happens to the row                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Upload**      | `provider.put` **before** the transaction — the key is needed to create the row at all. For images the derivatives are written next, each with its own `put`                                                   | Created inside a `UnitOfWork` along with the event. If the transaction rolled back, **every** written blob is freed in the `catch` |
| **Storage**     | The key is opaque to the core: only the provider that issued it knows its format. The core **compares** `storage_provider` on every read rather than looking a backend up by name                              | `storage_provider` is fixed forever. A row from another provider is bytes this process will not reach                              |
| **Use**         | Either a stream through the application or a 302 to a signed URL — decided _after_ authorization                                                                                                               | Unchanged. There is no access counter and no `last_used_at`                                                                        |
| **Edits**       | Untouched. Renaming changes the displayed name but **not the key** — the key stays whatever the provider issued at upload                                                                                      | `name`, `folder_id`, `tags`, `alt`, `tracks` — any combination in one PATCH                                                        |
| **Duplication** | Read through `get`, written with a new `put` — including **every derivative**. A source at another provider is rejected rather than half-copied                                                                | A new row, with a “ copy” suffix on the name before the extension; the alt text is carried over                                    |
| **Deletion**    | Freed **after the commit**, with bounded parallelism (16), over `Asset.storageKeys` — the original _and_ every derivative. A freeing error is swallowed: the blob is orphaned but the row was deleted honestly | Deleted in the transaction along with the `media.asset.deleted` event                                                              |

> **What happens to entries that referenced a deleted file**
>
> **Nothing prevents deleting an asset that a published entry references.** Media stores no back-references, there is no usage counter, there is no warning on deletion, and `content` is not notified of the deletion. The consequences spread across three surfaces:
>
> - **In the editor** the media field's tile turns into an explicit **warning card with the “dead” id** — so that it can be found and removed. That is a marker, not a save error.
> - **On the entry's next save** `EntryWriterService.assertMediaTargets` rejects it with a `422 must reference an existing asset`. That is, the entry gets “stuck”: it is already published with a broken reference but cannot be edited until the reference is removed.
> - **In the public API** the resolver simply _omits_ the id it did not find — the response arrives without that media, with no error and no indication that something is missing. A missing asset and someone else's asset are deliberately indistinguishable: otherwise this would be an oracle over ids.
>
> A folder cascade does the same thing at once and irreversibly: the whole subtree is deleted, the blobs are freed after the commit, and there is no undo. The only safety catch is **the confirmation in the interface**, which names the numbers (“…will also delete 3 files and 1 subfolder”); the server cannot argue and deliberately cannot.

### The tie to a workspace

`workspace_id` is an ordinary uuid with no foreign key: the workspaces table belongs to another plugin, and coupling plugins through the schema is not done here. Two things follow.

- **The scope is checked in the application** rather than by the database: every query carries `workspace_id` in its `WHERE`. The recursive subtree walk during a cascade filters by workspace **in both branches of the CTE** — a cascade escaping its tenant would be the worst possible bug here, and that is pinned down by an e2e test.
- **Deleting a workspace had to be closed off separately.** The rows used to survive their workspace _and_ lock up their blobs: both deletion paths go through a live workspace, so once it was gone no request could reach the bytes. Now `MediaWorkspacePurger` implements the `WorkspacePurger` port and **registers itself** with the `WorkspacePurgeRegistry` from `onModuleInit` — the workspaces plugin never learns that media exists. The injection is `@Optional()`, so media comes up without it too.

## 06. Scenarios — how it works step by step

### 6.1 Uploading a file by session

A direct multipart upload to the application server. **There is no presigned URL for uploading** — the bytes always go through Nest. A signed URL exists in this system only for _serving_, and only if the operator enabled it.

1. **The browser sends** `POST /api/media/assets` — a `multipart/form-data` with a `file` part and the `folderId` and `alt` text fields.
   _OriginGuard + PermissionsGuard(media:create) + WorkspaceGuard_
2. **Multer cuts at the ceiling.** `FileInterceptor('file')` is called **with no local options** — deliberately: that way it inherits the limit from the `MulterModule.register` that `MediaModule.forRoot` assembled from `config.plugins.media.maxUploadBytes`. The ceiling used to be read from `process.env` at the module level, and the host's setting was dead.
   _cap+1 is registered, because busboy fires when fileSize === limit — that is how “maximum” becomes inclusive_
3. **Exceeding it is a 413 with human wording.** `MulterUploadFilter` catches _two_ forms of one error: the raw `LIMIT_FILE_SIZE` code and the `PayloadTooLargeException('File too large')` Nest has already converted it into. A filter that looked only at the code never fired, and its friendly message was unreachable.
4. **The name goes through a value object.** `FileName.create` rejects an empty name, one longer than 255, and one containing `/`, `\` or control characters. A name is **a leaf, not a path**: otherwise it would drag directory traversal into the storage key.
5. **The type is classified but not verified.** `MediaKind.fromMime` sorts by prefix: `image/`, `video/`, `audio/`, known archive types → `archive`, **everything else** → `document`. There is no type allowlist: anything can be uploaded, `.html` and `.svg` included. All the protection is moved to serving (see 6.4).
6. **An image is buffered once.** The stream is single-use, and it must be read both by the original's write and by the processor. The caveat is in the code itself: today _any_ upload is fully in memory anyway, because both routes use multer's `memoryStorage`; end-to-end streaming means moving off it and is a separate piece of work. The memory bound is `maxUploadBytes`.
7. **The original goes to storage** — a `provider.put` **before** the transaction opens: the row needs a `storage_key`, and it exists only inside the `put`'s return. Every written key is pushed onto a local `written` list.
8. **Derivatives are “best-effort”.** Sharp reads the dimensions (written into `width`/`height`) and produces a WebP `thumb` (≤320px) and `preview` (≤1280px), **with no upscaling**. Each is its own `put` with `isVariant: true`, that is, into the `variants/` space: otherwise a file literally named `thumb.webp` would overwrite its own derivative. A source the processor cannot decode (SVG, corrupt bytes) simply yields no derivatives and **never fails the upload**.
9. **The transaction.** If a folder was named, a `FOR SHARE` is taken on it: that serialises the upload against a concurrent folder deletion, so that a new asset is not orphaned in a folder being deleted. Then `Asset.create`, `save`, and the `media.asset.uploaded` event into the outbox — the row and the event commit together.
10. **Any failure frees everything.** The `catch` walks `written` and removes **every** blob, not just the original. A failed upload leaves nothing behind.
11. **The response is a full `AssetView`**, including the `url`, the list of derivative names, the dimensions, the tags and the uploader's name (resolved from the id).

> **Why put must be all-or-nothing**
>
> The key exists only in `put`'s _return value_. A rejected `put` gave nobody a name — which means everything it left behind is rubbish no caller can ever name or clean up. Hence the port's contract, and hence the implementations: the local one writes to a `.hex.part` and does one `rename`; S3 calls `upload.abort()` on failure, otherwise the multipart parts stay billable, invisible to `ListObjects` and unreachable.

### 6.2 Uploading by bearer token

`POST /api/v1/media/assets` — the API's second half, alongside the public content API and under the same two guards (`ApiTokenGuard` + `ApiTokenWorkspaceGuard`, exported by `content-server`; the dependency on it already exists for the resolver port, so no new edge between packages appeared).

1. **The scope comes from the token, not from membership.** The workspace is determined by the token's permitted workspace. The `X-Workspace-Id` header is required when the token covers more than one workspace and optional when it covers exactly one; a workspace outside the token's “basket” is a 403.
2. **The parameters are in the query, not the body.** `?folderId=` and `?alt=`. Alt text matters especially here: an unattended import never makes the second PATCH, and without this field it would produce a library of permanently undescribed images.
3. **Authorship is attributed to a person.** `uploaded_by` is NOT NULL and a token is not a person, so the upload is recorded against whoever **issued** the token: that is the responsible party, and it keeps the “who uploaded” column meaningful in the library. A token with no `createdBy` gets a 400. This is **not** an authorization step: that user's role is not consulted at all — the decision was already made by the token's scope.
4. **After that it is the same use case.** `UploadAssetUseCase` takes an `EventActor` (`{ id, email }`) rather than a `PublicUser` — that is all it ever read. The session route did not change, and the token route gained access without inventing a user to satisfy a wider type.

### 6.3 Browsing the library

1. **The folder tree in one request.** `GET /media/folders` returns the workspace's folders flat, with a `parentId`, and the asset count at the root. The client assembles the tree.
2. **A page of assets.** `GET /media/assets?folderId=&search=&kind=&sort=&page=&pageSize=`. 24 per page by default, 100 at most. The sorts are a closed list: `newest` (the default), `oldest`, `name-asc`, `name-desc`, `largest`, `smallest`; the tie-break is always by `id`, so that pages do not “float”.
3. **Filters are validated before Postgres.** `folderId` is a uuid column and `kind` an enum, so an unparseable value used to reach the driver and come back as a **500** (`invalid input syntax`). Now `ListAssetsQuery` throws `InvalidAssetFilterError` → 400. The check lives **in the query, not in the controller**, because the query has a second caller — the `media_assets_search` agent tool.
4. **Search escapes the metacharacters.** A `%` or `_` in the term matches itself, and the backslash itself is escaped first. Without that, `?search=_` found every file with a name of at least one character, and `?search=%` the whole library. It searches both `name` and the `tags` elements.
5. **Uploaders' names are resolved in bulk** (`uploader-names.ts`), with a fallback value for a deleted user — the “who uploaded” column must not show a uuid.

### 6.4 Serving a file — the part with the most decisions in it

**A download is treated as hostile bytes.** `media_asset.mime_type` is what the uploader declared; nothing sniffs the body. And `/api/media/...` is the same origin as the admin UI (behind the dev proxy and in any deployment that fronts both from one host). Without treatment, an uploaded `.html` became **stored XSS on the application's own origin**.

1. **The asset is located and authorized.** The session route goes by membership of the owning workspace; the token route by a match with the request's workspace. In both cases any refusal (no such id, not a member, another workspace) is **the same 404**.
   _and that holds even for a different workspace INSIDE the token's basket — otherwise X-Workspace-Id would be advisory_
2. **A derivative is chosen.** `?variant=thumb|preview`. The lookup goes through `Object.hasOwn` rather than a bare index: `variants` is an ordinary JSON object, and `?variant=toString` would otherwise resolve to a prototype member, enter the branch with no key and crash the provider. A missing derivative is not an error — the original is served.
3. **The delivery method is decided.** If `directServe: 'signed-url'` and the provider can sign, it is a `302` to a short-lived URL. This happens **after** authorization, never instead of it; the redirect only decides how already-permitted bytes will travel.
   _Cache-Control: private, no-store — the URL expires, and a shared cache would hand a dead link to the next viewer_
4. **The disposition is pinned onto the URL itself.** A redirect _discards_ this response's `Content-Disposition`, `X-Content-Type-Options` and CSP, so the provider must bake the type and the disposition into the signature (S3's `ResponseContentDisposition`/`ResponseContentType`, Azure's `rscd`/`rsct`). A provider that cannot declares `capabilities.directUrl: false` — that is the whole point of the capability.
5. **Otherwise it is a stream through the application** (a `StreamableFile`), with three layers of protection on **every** response from both raw routes:
    - `X-Content-Type-Options: nosniff` — the browser will not “sniff up” a `text/plain` into a `text/html`;
    - `Content-Security-Policy: default-src 'none'; sandbox; base-uri 'none'; form-action 'none'` — a document that did get rendered sits in an opaque origin, runs no scripts and loads no subresources;
    - `Content-Disposition: inline` **for an allowlist only**: PDF, `text/plain`, raster images (apng, avif, bmp, gif, jpeg, png, webp, x-icon) and anything prefixed `audio/` or `video/`. Everything else is `attachment`. The filename is percent-encoded so that a quote or a control character in `name` cannot break the header.

> **SVG is excluded from inline deliberately**
>
> `MediaKind` classes SVG as an image, but on direct navigation it is a **scriptable document**. So it arrives as an `attachment`. This does not affect the library's tiles: an `<img src>` ignores `Content-Disposition` — the disposition applies to navigation only.

> **Three ways to fail a download, and only one of them is a 500**
>
> **No such id, or the caller is not a member** → `404`, deliberately the same code, so that ids cannot be enumerated. **The row exists but the blob does not** (the database was restored onto an empty volume, the blob was freed by hand, a migration was interrupted) → also a `404`: it used to be a 500, which is both wrong (from the caller's side it is indistinguishable from a missing asset) and a signal (it reveals that the row is real). The port requires `get` to reject with an `ObjectNotFoundError` — raised by `provider-local` on `ENOENT`/`ENOTDIR` and by `provider-s3` on `NoSuchKey` — and `to-http.ts` turns it into a **bare 404 with no body**: its own message would leak the storage key. **The key resolves outside the storage root** → a `500`, deliberately: that is a corrupted `storage_key` column, not the caller's error, and calling it “not found” would bury an operator's problem under a plausible answer. `to-http` rethrows everything unrecognised for precisely that reason. Only `ENOENT`/`ENOTDIR` become “not found”: a permission denial or an exhausted descriptor table is a fault, and it must not be dressed up as a 404.

### 6.5 Edits: renaming, moving, tags, alt, tracks

1. **One `PATCH /media/assets/:id`** takes any subset of the fields. `folderId: null` moves it to the root, and an absent field leaves it as it is — the difference between “null” and “not sent” is load-bearing here.
2. **A move takes a `FOR SHARE` on the target folder** — the same serialisation against a cascading deletion as on upload.
3. **Tags and tracks are replaced wholesale** rather than patched item by item: the editor shows a list and saves a list, and a track has no natural key beyond the `(kind, srclang)` pair for a partial mutator to address.
4. **Alt text is normalised identically on every path** — whitespace trimmed, empty → `null`. Otherwise a space would masquerade as coverage in the accessibility report.
5. **Renaming a folder is a separate route** and can do **only the name**. A folder's parent cannot be changed by any route, so a cycle in the tree cannot arise — no cycle check is needed and there is none.

### 6.6 Deletion: bulk and cascading

1. **Bulk asset deletion** — `DELETE /media/assets` with a `{ ids }` body: a non-empty list no longer than 100. The rows and the events leave in one transaction, and the response is `{ deleted: N }`, where N is how many were found _in this workspace_.
2. **Blobs are freed after the commit**, fanned out with a limit of 16 concurrent calls: 100 ids means 300+ blobs, and there is no need to open that many provider calls in one tick for work nobody is waiting on. Freeing checks the `storageProvider` and silently skips foreign ones.
3. **Folder deletion is cascading and unconditional.** A non-empty folder used to answer `409`, and a populated tree could not be deleted without dismantling it by hand, level by level. The safety catch belongs to the interface's confirmation, which names what will vanish, not to a server you cannot argue with. `FolderNotEmptyError` has been removed.
4. **The subtree walk is a recursive CTE over `parent_id`** with a workspace filter **in both branches**, then a re-read of the rows `FOR UPDATE` and a return with **the deepest first**: no parent is deleted before its children, and a concurrent upload/move/subfolder creation is serialised against the deletion instead of being orphaned. (A `FOR UPDATE` cannot be attached to the recursive CTE's own SELECT — Postgres forbids it — hence the two statements.)
5. **The walk repeats in a loop** until the subtree stops changing: a CTE takes no locks, so a subfolder created under a _descendant_ between the two statements would otherwise outlive its own parent. Once every known id is locked, a repeat walk either agrees or reveals a new child — and further inserts beneath it now block on us. Convergence is bounded by `SUBTREE_WALK_ROUNDS`.
6. **`reclaimAssetBlobs` is shared** with bulk asset deletion, so that no path can forget the derivatives.

### 6.7 Duplicating an asset

1. `POST /media/assets/:id/duplicate` — the `media:create` permission, because this is creating a new asset rather than editing the old one.
2. **The copy's name is built _before_ storage is touched.** A “ copy” is inserted before the extension and can push past 255 characters; only the value object can say so. Left until the transaction, an over-long name reached the provider and blew up with an unmapped `ENAMETOOLONG` — a 500 instead of a 400.
3. **A source at another provider is rejected** rather than half-copied: `get` would receive a key that means nothing here. In a healthy deployment this is unreachable thanks to the startup check.
4. **The derivatives are copied too**, and every written key is tracked, so that a rollback frees them all.

### 6.8 Agent tools

Five tools in the shared `@orthacms/tools-server` registry. Every registrar injects the `ToolRegistry` **`@Optional()`**: a deployment without the copilot and without MCP is normal, and media must come up in it.

| Tool                   | Effect  | Permission   | Surface      | Wraps                  |
| ---------------------- | ------- | ------------ | ------------ | ---------------------- |
| media_assets_search    | read    | media:read   | **both**     | `ListAssetsQuery`      |
| media_folders_list     | read    | media:read   | **both**     | `ListFoldersQuery`     |
| media_asset_read       | read    | media:read   | **both**     | `DownloadAssetQuery`   |
| media_propose_alt_text | propose | media:update | copilot only | → `UpdateAssetUseCase` |
| media_propose_file     | propose | media:create | copilot only | → `UploadAssetUseCase` |

- **Search spans every folder.** `folderId` has three states: _an absent key_ — the whole workspace, `null` — the root folder, a string — one folder. The admin UI browses one folder at a time, so `null` had to keep the meaning “the root”; a model asked “do we have a logo?” does not know where to look and would get a “no” for a file that exists. The check goes through `in` rather than truthiness precisely so those two states stay distinguishable.
- **The projection is narrowed.** What is returned is the id, name, kind, MIME, size, alt, tags, folder, date and a `downloadPath`; `variants` and the pixel dimensions are dropped, as is the full `url` — that is a route a _model_ will not choose anyway, it costs tokens and answers nothing. The **path** is kept for a different reader: a person who asked to “list the files” wants links they can click.
- **`downloadPath` is the catalogue's only surface-dependent field.** The copilot gets `/media/assets/:id/raw` (which derives the scope from membership, so the browser will load it directly); MCP gets `/api/v1/media/assets/:id/raw` (gated on `media:read`, downloadable with the same bearer token the call was made with). The session route would answer an external agent 401, and a link guaranteed not to work is worse than no link. This is **presentation only**: both routes check the same scope and the same permission.
- **Reading bytes — four constraints.** An _allowlist_ of MIME types, never a blocklist: `MediaKind` puts PDF, Word and Markdown into one `document`, so the coarse kind cannot serve as a filter, while enumerating what we _can_ handle refuses a new binary format by default. The _ceiling is applied on the fly_ (256 KB): buffering the whole asset and then trimming means holding 50 MB in memory for the sake of 256 KB, and that memory pressure can be induced by anyone with the upload permission; the stream is destroyed the moment the ceiling is passed. A _decoding error is fatal_: a MIME type is a claim, not a fact, and an error naming the problem beats a page of replacement characters that a model will faithfully retell. The exception is a truncated read, where `stream: true` holds back an incomplete trailing sequence: the ceiling falls on an arbitrary byte, and a cut three-byte codepoint must not fail a perfectly good file. And finally, `DownloadAssetQuery.locate` is **deliberately not workspace-bound** (the route derives it from the row), so the tool checks `location.workspaceId` itself — and reports a mismatch with **the same** “no such asset”, since otherwise this would be an oracle over ids.
- **Creating a file: the format comes from a closed enumeration, not a MIME type.** Five formats — `md`, `csv`, `html`, `json`, `txt`; given a free-form `contentType`, a model will sooner or later produce something like `application/x-msdownload`, and `MediaKind` will file that under documents without objection. The extension **follows from the format**, replacing the one the module owns (a `summary.txt` in `md` format becomes `summary.md`, not `summary.txt.md`) and leaving anyone else's alone (`2026.q3` keeps its `.q3`). A path is **rejected, not flattened**: a model will happily propose `reports/2026/q3.md`, and silently dropping the directories would put the report in the root while the model tells the user otherwise; the error message names `folderId`. The `MAX_AUTHORED_BYTES` ceiling is 1 MB, far below `maxUploadBytes`: the content arrived as a tool argument, generated token by token, and a megabyte of that is a malfunction, not a report. The applier calls **the same** `UploadAssetUseCase`, inheriting its atomicity, folder lock, blob freeing and provider routing.
- **No deletion is offered — deliberately.** A folder cascade takes the whole subtree away with irreversible blob freeing, and a confirmation prompt has no way of rendering “this will delete 4 folders and 213 files”. Handing that to a non-deterministic tool picker needs a separate ADR, not a provider.

> **Reading a file widens the prompt-injection surface**
>
> Before this tool the copilot read content written by the team; now it reads a file put into the library by anyone with the `media:create` permission, and a `.md` is a fine carrier for “ignore previous instructions”. The protection is the one every tool result gets: the run engine wraps the output in a `fenceUntrusted`. **Over MCP that protection is absent** — there is no run engine there, and an MCP host is expected to treat results as untrusted data itself. What does carry across the boundary is the ceiling, and that is what matters: the token's scope decides what it can do with what it read, and a `read` token that swallowed an instruction still has no write tool.

### 6.9 Deferred uploads on an entry's media field

The least obvious scenario in the whole group — and it explains why a media field and an article's body behave differently.

1. **The user picks a file on the media field.** Nothing is sent. The file is given a **real uuid placeholder**, and it is that which goes into the form's value — real precisely because the shared kernel validates a media field's value as a uuid, so a staged file passes client-side validation, the “changed” badge and the publish gate exactly like an attached asset.
2. **The hook lives above the tab.** The editor's tabs are routes, and the “Media” panel unmounts the moment the tab is switched; so `usePendingMediaUploads` is mounted by `ContentEntryView`, and the panel reaches back to it through the opaque `EntryTabContext.presave[id]`.
3. **`commit` runs inside the save**, before the write and under the busy indicator: it uploads every staged file the values still reference (three at a time, one request per file) and returns the values with the placeholders replaced by real ids.
4. **A failed file aborts the save** with a toast naming it. Nothing was written and the form keeps its placeholders. The files that _did_ upload remember their asset id, so a retry attaches them rather than uploading them a second time.
5. **`settle` after a successful write** revokes the object URLs and clears the staging — the re-initialised form already holds the saved entry's real ids.
6. **An article's body behaves the opposite way — and deliberately.** A field holds an _id_ while a body holds a _URL_, and a URL does not exist until the bytes do — which means the upload has to happen at the moment the file is picked. The trade-off is one-way: an abandoned edit leaves an asset in the library, where it is visible and removable, rather than a body pointing nowhere.
7. **Picking an existing asset is not deferred** — it is already uploaded; attaching an id is an ordinary form edit riding along with “Save”, like any other.

## 07. HTTP API

Every path carries the global `/api` prefix the host sets. Access legend: `session` — a valid session is required, `permission` — a session and the named permission, `token` — a bearer token instead of a session. Unless stated otherwise, a route carries `WorkspaceGuard`, and a state-changing one also carries `OriginGuard`.

### The session half — `/api/media`

| Method and path                  | Access and guards                                                              | Input                                                                         | Success                                                         | Failures                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET /media/folders               | `media:read` Workspace                                                         | —                                                                             | `{ folders[], rootAssetCount }` — a flat list with a `parentId` | `401`; `403` no permission; `400` a missing or foreign `X-Workspace-Id`                                                                            |
| POST /media/folders              | `media:create` Origin, Workspace                                               | `{ name, parentId? }` — the name is 1…120                                     | `{ id }`                                                        | `400` name/DTO; `404` no such parent; `403` a foreign Origin or no permission                                                                      |
| PATCH /media/folders/:id         | `media:update` Origin, Workspace                                               | `{ name }`. **The parent cannot be changed**                                  | `{ id }`                                                        | `400` a non-uuid or an empty name; `404` no such folder                                                                                            |
| DELETE /media/folders/:id        | `media:delete` Origin, Workspace                                               | a uuid in the path                                                            | `204`. **The whole subtree by cascade**                         | `404` no such folder. Non-emptiness is **not** a refusal                                                                                           |
| POST /media/assets               | `media:create` Origin, Workspace                                               | `multipart/form-data`: a `file` part + the `folderId?`, `alt?` fields         | a full `AssetView`                                              | `400` no `file` part, a bad name, an extra DTO field; `413` larger than `maxUploadBytes`; `404` no such folder                                     |
| GET /media/assets                | `media:read` Workspace                                                         | `?folderId=&search=&kind=&sort=&page=&pageSize=` (24 by default, 100 at most) | `{ items, total, page, pageSize }`                              | `400` an unparseable `folderId` or an unknown `kind`                                                                                               |
| GET /media/assets/:id/raw        | `media:read` **NO Workspace** — the scope is derived from the row + membership | a uuid in the path, `?variant=thumb\|preview`                                 | a byte stream, or a `302` to a signed URL under `directServe`   | `404` — no such asset / not a member / the blob is missing from storage (one shape); `500` — the key is outside the storage root; `400` a non-uuid |
| PATCH /media/assets/:id          | `media:update` Origin, Workspace                                               | any subset of `{ name?, folderId?\|null, tags?, alt?, tracks? }`              | the updated `AssetView`                                         | `400` name/tags/tracks; `404` no such asset or no target folder                                                                                    |
| POST /media/assets/:id/duplicate | `media:create` Origin, Workspace                                               | a uuid in the path                                                            | the copy's `AssetView` (with a “ copy” name)                    | `404` no such source; `400` the copy's name exceeds 255; `500` the source is at another provider                                                   |
| DELETE /media/assets             | `media:delete` Origin, Workspace                                               | `{ ids: uuid[] }` — non-empty, 100 at most                                    | `{ deleted: N }`                                                | `400` an empty list, >100, a non-uuid. A non-existent id is **not** an error — it is simply not counted                                            |

### The Insights read model — `/api/insights/media`

| Method and path             | Access and guards      | Input                                                                 | Success                                         | Failures                          |
| --------------------------- | ---------------------- | --------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------- |
| GET /insights/media/storage | `media:read` Workspace | —                                                                     | counts and bytes per kind + totals              | `401`; `403`; `400` the workspace |
| GET /insights/media/uploads | `media:read` Workspace | `?days=` — 30 by default, 365 at most, an invalid value silently → 30 | assets by time bucket                           | the same                          |
| GET /insights/media/alt     | `media:read` Workspace | — **no window, deliberately**                                         | alt-text coverage across the workspace's images | the same                          |

They are gathered into **one** controller, unlike content's five: these are three projections of one table with one dependency and one permission — the reading side of a single resource, not three separate use cases. Each still has a route of its own, so that every widget owns its request and one slow aggregation does not stall the rest.

### The token half — `/api/v1/media`

| Method and path              | Access and guards                                           | Input                                                                                         | Success                                                               | Failures                                                                                                    |
| ---------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| POST /v1/media/assets        | `token` `media:create` — that is, **the `full` scope only** | a multipart `file` + `?folderId=`, `?alt=`; `X-Workspace-Id` required with several workspaces | an `AssetView` — its `id` goes straight into an entry's `field.media` | `400` no file, or the token has no creator; `403` a workspace outside the token's basket; `413` the ceiling |
| GET /v1/media/assets/:id/raw | `token` `media:read` — **both** scopes                      | a uuid, `?variant=`                                                                           | a byte stream or a `302`                                              | `404` — no such asset, or it is outside the request's workspace (including **inside** the token's basket)   |

> **Why a token needs a raw route at all**
>
> The session `raw` derives its scope from **membership**, which a token does not have at all, so a bearer got a 404 on exactly the URLs that public content reads hand out. This route derives the same scope from the token's permitted workspace — an equivalent boundary for credentials that are not a person. And an asset in a _different_ workspace of the same token is also a 404: the request named a workspace, and reading across that line would make `X-Workspace-Id` advisory.

A running server serves the generated OpenAPI at `/reference`. The token routes are declared with the `apiToken` security scheme and carry descriptions; the session routes are documented through DTOs with `@ApiProperty`.

## 08. The admin UI: routes, screens, states

The admin plugin provides **no top-level route and no top-bar item**. It lives strictly inside a workspace and inside other people's screens — six contributions into six slots.

| Slot                 | What it contributes                                                                                                                                         | Where it shows                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| WORKSPACE_NAV_SLOT   | the “Media Library” button, the `Image` icon, `order: 20`                                                                                                   | the workspace's side navigation                     |
| WORKSPACE_ROUTE_SLOT | the `media/*` route, with the page lazily loaded under a `Suspense` with a skeleton                                                                         | `/workspaces/:id/media`                             |
| ENTRY_TAB_SLOT       | the entry editor's “Media” tab, with `appliesTo` checking for a field of type `Media`                                                                       | the entry editor — only on types with a media field |
| ENTRY_PRESAVE_SLOT   | `usePendingMediaUploads` — the deferred uploads, mounted above the tab                                                                                      | invisible; it works inside “Save”                   |
| WYSIWYG_MEDIA_SLOT   | two sources: “Media library…” (the same `MediaPickerDialog`) and “Upload files…” (the same `UploadDialog`)                                                  | the text editor's “Insert ▸ Media” menu             |
| INSIGHTS_WIDGET_SLOT | 4 cards: the “Storage” tile in Overview + “What is taking up storage”, “Uploads” and “Images without alt text” in Reach; all under `permission: media:read` | the Insights page                                   |

### The media library page

One route, two panels with no “island”: both are drawn straight onto the page's background (no muted board, no frames, no shadows), separated by an `lg:border-r` hairline, and each scrolls independently. The page takes its size through a `flex-1` from the workspace shell's column rather than by an `svh` computation of its own — one viewport measurement in the chain, so that no phantom scrollbar appears at a zoom other than 100%. Only the components stay cards (the tiles, the selection bar), not the page's chrome.

- **The header** is a sticky `MediaTopBar` spanning both panels: a teal `Image` tile matching the navigation entry, and breadcrumbs of “Media Library › ancestors › the open folder”. Unlike content's, it is **not derived from the route**: folder navigation here is component state rather than a URL segment, so the crumbs come from the store and are rendered as **`<button>`** elements — a control that changes the view without changing the address is a button, not a link.
- **The left panel** is the folder tree under an “All media” heading, folder creation and a used-space counter.
- **The right panel** is a heading with a count, a toolbar (search, kind filter, sort), a grid of tiles and a pager. **There is no list view**: the grid/list toggle and the table have been removed, the `MEDIA_VIEW` constant does not exist, and there is no `view` state in the store. “Select all” left along with the table — it lived in its header; selection is now per tile, plus a “Clear” in the selection bar.
- **Selection and bulk actions** — the `MediaSelectionBar`: download, duplicate, move, delete, clear.
- **The per-asset menu** is one `AssetActionsMenu`: download, copy link, duplicate, rename, move, delete. There is **no** “Open” item in it: in the details panel it would open a panel already on screen, and on a tile it would duplicate the thumbnail and the filename — both of which are already buttons dispatching the same action. The `'open'` action itself remains; only the menu item is gone.
- **The details panel** — a preview (the `preview` derivative), the actions, the metadata, editable alt text, the tags.

### Pagination — server-side

The store sends `search`, `kind`, `sort`, `page` and `pageSize` (24 / 48 / 96) to the server and renders exactly what came back. This used to be a `filter` + `sort` over one fixed page of 100 items — that is, a search could fail to find a file that certainly exists. Four accompanying rules, each fixing its own class of bug:

- **`placeholderData` holds the previous page** — otherwise the grid went blank between pages.
- **Changing page clears the selection.** A selection that outlived its page would be invisible: the selection bar derives names from the loaded page, so ids left on the first page would vanish from the counter on the second and silently return later — while “Delete” would still take them.
- **Narrowing the list returns to the first page.** Page 4 makes no sense under a new search, and a user would land on an empty grid right after typing a query that does find something.
- **The page is pulled back into range when the result shrank** — delete the last three files on page five and the pager would otherwise stay on a page the server returns empty.

### The screen's states

| State                        | When                                      | What is shown                                                                                                                                                                              |
| ---------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **No permission**            | `useHasPermission('media:read')` is false | A textual “no access” card. The queries **never start at all** (`enabled: canRead`) rather than starting and getting a 403                                                                 |
| **Loading**                  | the first fetch of folders/assets         | A skeleton (`MediaLibrarySkeleton`), which is also the lazy route's `Suspense` fallback                                                                                                    |
| **Error**                    | `store.isError`                           | A state **of its own** with `role="alert"` and a “Retry” button. **Never an empty state**: “there is nothing here” instead of a server failure sends a person looking for files that exist |
| **Empty**                    | zero folders and `total === 0`            | A `MediaEmptyState`, with an invitation to upload — only with `media:create`                                                                                                               |
| **Nothing found**            | the filters narrowed it to zero           | An empty state with “Clear filters” — distinct from “the library is empty”                                                                                                                 |
| **An upload is in progress** | the queue is non-empty                    | A `MediaUploadBanner` above the browser: an overall size-weighted progress bar + a per-file row with percentages, retry and cancel                                                         |

### The upload queue

- **One request per file, three at most at once.** The former `Promise.all` lost the whole batch to a single failure.
- **No success toast is shown for an upload at all.** The dialog closes on confirmation, so a toast would claim a result that does not exist yet; the banner is the status surface, and the cache is invalidated once per settled batch.
- **Every other action does give a toast — on success, not on dispatch.** Every store action returns a `Promise<boolean>` and the page attaches its own wording to it. It used to show “Renamed to “a/b.png”” and “Request failed with status code 400” side by side.
- **Refusals speak the API's words.** `toApiError` puts the transport's description into `message` and the parsed body into `details`, so everything user-facing goes through `apiMessage`, which reads the body and falls back to a local wording — otherwise a status code would show instead of “File exceeds the maximum upload size.”.
- **The files and the progress bookkeeping live in a `ref`, not in state**, so that a progress tick redraws only the small row rather than the whole screen.
- **The hint does not name a size.** The ceiling lives in the server's configuration and **no route tells the admin UI about it**, so the old “up to 250 MB” was a number nothing checked: a 52 MB file was staged happily and got a 413 after being transferred in full. Until the ceiling is readable, the hint talks about accepted types and stays silent about size.

### Accessibility

- **The media field is named as a group** (`aria-labelledby` → its `<h3>`) rather than through a `<label for>` on the button: a media field is a _composite_ control (pick / upload / remove / reorder), and a label would have **replaced** the trigger's own name — the accessibility tree read “Cover, button” instead of “Pick from library”. As a group it reads “Cover, group”, and then each action by its own name.
- **A confirmed deletion hands focus to the grid.** Both the ⋯ menu and the confirmation dialog return focus each to its own trigger, and both sat on the tile the deletion has just removed — focus ended up on `<body>`. The page intercepts `onCloseAutoFocus` and points at the titled “Assets” section with `tabIndex={-1}`, reclaiming focus for a few more frames in case some other layer restores it later. Cancelling is untouched — its trigger still exists.
- **A folder's actions trigger is named after the folder** (“Actions for Images”), otherwise the folder grid would be a row of identical “Folder actions” buttons.
- **The folder-deletion confirmation names the contents.** The numbers are counted from the already-loaded tree — no extra request, with the same freshness as the last folder read. An empty folder gets a plain wording: itemising an inventory of nothing is noise.
- **Object URLs are revoked on unmount.** A staged 200 MB video would otherwise sit in memory for the tab's whole life.

### Caching

The keys are built by the `mediaKeys` factory and **always include the `workspaceId`**: `['media', ws]` → `['media', ws, 'folders']` → `['media', ws, 'assets', folderId, {search, kind, sort, page, pageSize}]`. Mutations invalidate the `mediaKeys.all(workspaceId)` root — coarse but safe: an upload changes the folder counts, the page and the widgets alike. The Insights widgets use keys of their own with `retry: 1`. Uploads from an article's body invalidate the media cache as soon as anything settles, **even if the entry is never saved** — the asset is in the library already.

## 09. Configuration and the adapter matrix

Configuration flows from `apps/server/ortha.config.ts` (the `plugins.media` section) into the `MediaServerPlugin({ provider, config })` factory. The plugin **names no backend**: which one runs is decided by which factory the composition root called.

| Field                 | Type / default                                      | Environment variable           | Meaning                                                                                                                                                                                        |
| --------------------- | --------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| maxUploadBytes        | `number`, 52,428,800 (50 MB)                        | MEDIA_MAX_UPLOAD_BYTES         | The ceiling on one upload, **inclusive**. It reaches multer through `MulterModule.register` and is registered as `cap + 1`. It also bounds the memory multer buffers per request               |
| directServe           | `'off' \| 'signed-url'`, `off` by default           | MEDIA_DIRECT_SERVE             | `off` — every byte flows through the application. `signed-url` — a `302` to a signed URL. **The plugin refuses to start** with `signed-url` on a provider with `capabilities.directUrl: false` |
| directServeTtlSeconds | `number`, 300                                       | MEDIA_DIRECT_SERVE_TTL_SECONDS | A signed URL's lifetime: enough for a page of thumbnails, short enough that a leak is expensive. A non-positive value is a startup error: such a URL expired at the moment it was issued       |
| storage               | the type is set by the **factory** the host imports | MEDIA_LOCAL_ROOT (for local)   | The chosen backend's settings. They live in the _host's_ config rather than in `MediaPluginConfig` — the same scheme as the copilot's providers                                                |

> **There is no “which backend” variable — and that is a decision**
>
> `.env.example` says so in so many words: _“Which storage backend runs is NOT an environment variable”_. A variable's value could point at an adapter nobody installed; an expression in `plugins.ts` cannot. The old scheme (a map of named providers + a resolver + a `defaultProvider` + a `MEDIA_PROVIDER` variable) offered **two ways to get it wrong** and was a second dialect alongside the copilot's convention; ADR-0012 removed it entirely.

### Five checks when the application is assembled

`assertOptions` validates the seam **early**, in the same place where it is assembled. Measured on a real application before it existed: pointing the config at a backend nobody installed came up **without a single warning**, and every upload answered a bare `500 Internal server error` — a message naming neither the provider nor the setting that chose it.

1. **A provider was passed at all** — otherwise the error text contains an example of the line to write.
2. **The `id` is a non-empty string** — it is written into every asset row and is what the startup check compares the existing ones against.
3. **`capabilities` are declared** — the core has no way to determine them, and a guessed capability is either a silently unused feature or an answer served without protection.
4. **`directUrl: true` is backed by a method** — declaring a capability without an implementation is not allowed.
5. **`directServe: 'signed-url'` agrees with the provider**, and **`maxUploadBytes` is positive** — a non-positive ceiling would reject every upload.

A sixth check happens at startup: `StorageProviderCheck` (`OnApplicationBootstrap`) calls `provider.verify?.()` and groups `media_asset` by `storage_provider`. Foreign values fail the start, listing the names and row counts. **A missing table is not a refusal**: migrations are a separate step, and a fresh database must come up.

### The storage adapter matrix

| Adapter     | npm name / `id`                                             | What for                                                                                                                                           | Requires in configuration                                                                              | directUrl | verify() | Specifics and limitations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| local       | @orthacms/media-provider-local<br>`id: 'local'`             | **The default.** A single server, development, a deployment with a persistent volume                                                               | `{ rootDir }` — `MEDIA_LOCAL_ROOT`, `./.storage/media` by default                                      | no        | no       | Keys of `<ws>/<asset>/<name>`. Writes through a `.hex.part` + `rename`. `contentTypeMetadata: false` — a file system has nowhere to put it. **The escape-the-root check** uses `resolve` rather than `join`: `join(root, '/etc/passwd')` silently re-bases an absolute key under the root and hides it from a naive prefix check. Segments are cleaned and truncated to 255 bytes (an `ENAMETOOLONG` would otherwise become an unmapped 500). Empty directories are cleaned up, otherwise a million uploads and deletions leave a million inodes. **It does not scale horizontally** — two instances will not see each other's files                                                                                                             |
| s3          | @orthacms/media-provider-s3<br>`id: 's3'`                   | Cloudflare R2, AWS S3, MinIO, DigitalOcean Spaces, Backblaze B2, Wasabi, Scaleway, Hetzner, Supabase Storage, Tigris — and GCS through its XML API | `{ bucket, region?, endpoint?, forcePathStyle?, credentials?, keyPrefix?, client? }`                   | yes       | yes      | **The only one that declares `directUrl` unconditionally.** `region` defaults to `auto` (which is what R2 expects). **Do not pass `credentials`** on a host with an instance role or IRSA: their absence means “use the SDK's provider chain”, and an object of empty strings shadows it with keys that cannot sign. Size and sha256 are measured _here_: an `ETag` is not a sha256 and for a multipart upload is not even an MD5. A multipart failure calls `abort()`, otherwise the parts stay billable and invisible. `verify` is one `HeadBucket` at startup                                                                                                                                                                                 |
| gcs         | @orthacms/media-provider-gcs<br>`id: 'gcs'`                 | Google Cloud Storage **natively** — where HMAC keys are forbidden by policy or Workload Identity is in use                                         | `{ bucket, projectId?, keyFilename?, credentials?, keyPrefix?, signWithIam?, bucketClient? }`          | computed  | yes      | **You may not need it:** GCS speaks the S3 XML API, and the `-s3` adapter reaches it through `endpoint: 'https://storage.googleapis.com'` — one package fewer. Signing requires a private key (`keyFilename`/`credentials`) or an explicit `signWithIam`; **bare ADC has neither**, declares `directUrl: false`, and its downloads are proxied. `signWithIam` is opt-in precisely because it requires the `iam.serviceAccounts.signBlob` permission, and assuming it would mean issuing URLs that fail at request time                                                                                                                                                                                                                           |
| azure       | @orthacms/media-provider-azure<br>`id: 'azure'`             | Azure Blob Storage — **the only large storage with no S3 compatibility at all**. The gap that stopped a Microsoft shop from running Ortha          | `{ container, connectionString? \| (accountName + accountKey) \| containerClient?, keyPrefix? }`       | computed  | yes      | Three ways to connect, in order of demand: a connection string (which the portal issues and Azurite prints), a name+key pair, or a ready-made `containerClient`. The last is **the managed-identity escape hatch**: build a client with `DefaultAzureCredential` and pass it, leaving the package free of that dependency. SAS requires a shared key, so with a managed identity `directUrl: false`. When it does sign, the SAS pins `rscd` and `rsct`. A user-delegation SAS is the next step, not a silent assumption                                                                                                                                                                                                                          |
| vercel-blob | @orthacms/media-provider-vercel-blob<br>`id: 'vercel-blob'` | The shortest configuration on Vercel                                                                                                               | `{ token?, keyPrefix?, api? }` — the `token` may be omitted on Vercel itself (`BLOB_READ_WRITE_TOKEN`) | no        | yes      | **Every blob is world-readable.** The storage has one access mode, `public`: the URL is permanent, unguessable and unauthenticated. Whoever obtained it — a copied `<img src>`, a browser extension, a proxy log, a forwarded email — can read the file forever. The application keeps honouring its own rules (the API serves `/media/assets/:id/raw`, never the blob's URL), but **a second, public copy of the bytes exists and is revoked only by deleting the blob**. Fine for a marketing site's images, **not fine** for a confidential media library. `directUrl: false` honestly: the URL does not expire and carries no disposition. `addRandomSuffix: false` is mandatory — otherwise the blob lands where the adapter cannot name it |
| memory      | @orthacms/media-provider-memory<br>`id: 'memory'`           | The e2e harness and offline development                                                                                                            | `{ maxTotalBytes? }` — 256 MB by default                                                               | no        | no       | **Published deliberately but not offered by the generator** — an application that loses every upload on restart is not a deployment. Before it existed, `apps/server-e2e` kept its own `Map` provider inline — a second implementation of the port that nothing held back from drifting, and drift it did: a missing key rejected with a bare `Error`, so the route that maps `ObjectNotFoundError` to a 404 was never exercised by the harness at all. `streamingPut: false` — `put` buffers; `contentTypeMetadata: true` — unlike a file system, a `Map` has somewhere to put it. An overflow raises `MemoryStoreFullError`, so that a test fails as a test rather than as an OOM taking the whole run with it                                 |

The `create-ortha-app` generator offers a choice of five (local by default, plus azure, gcs, vercel-blob, s3) — the group's only choice in the wizard; `-memory` and `-testkit` are listed as transitive and always installed.

<details>
<summary>The plugin's registration order</summary>

`MediaServerPlugin` is registered **after** `WorkspacesPlugin` (its routes use `WorkspaceGuard`) and `IdentityPlugin` (`PermissionsGuard`), and **before** `TransferPlugin`, which reads bytes through it and recreates files by its own upload path. The module is declared `global: true`, so the `MEDIA_ASSET_RESOLVER` binding is visible to `EntryWriterService` regardless of registration order. The migrations are described lazily (`dir: () => join(__dirname, '../../../migrations')`) — the path is computed only at migration time.

</details>

## 10. Security and resilience

#### A download is hostile bytes

The MIME type is the uploader's claim, and the application and the media share an origin. Hence three layers on **every** response from both raw routes: `nosniff`, a CSP with no capability at all, and `inline` for an allowlist only. Without them an uploaded `.html` was stored XSS on the application's own origin.

#### No asset enumeration

A non-existent id, another workspace, a non-member and **a lost blob** are all the same 404. The same rule applies in the copilot attachment resolver: someone else's asset comes back as _missing_, indistinguishable from a deleted one, and the engine collapses the shortfall into one error with a count.

#### A redirect does not cancel authorization

`directUrlFor` is called _after_ the asset is resolved and membership (or the token's workspace) is checked — it only decides how already-permitted bytes will travel. There is a second safeguard inside it too: if the provider was swapped out from under us, the function returns `null` and the bytes go by stream rather than by exception.

#### The disposition is baked into the signature

A 302 discards this response's `Content-Disposition`, `nosniff` and CSP, so the decision is made by the same `isInlineSafe` and the provider pins it onto the URL. One that cannot declares `directUrl: false`. Plus `Cache-Control: private, no-store`: a cached redirect would outlive the URL it points at.

#### A filename is a leaf, not a path

`FileName` rejects `/`, `\` and control characters, and the provider additionally cleans the segment. The local one checks that the key resolves **inside** the root: without that, `remove('../../x')` would delete an arbitrary file reachable by the server's user. Keys out of `storage_key` deserve that check, because the column can be written by a migration, an import or a future provider.

#### No error is flattened into a 4xx

`to-http` maps exactly seven domain errors and **rethrows** everything else. A corrupted `storage_key` must stay a loud 500 with a stack in the log — that is exactly what an operator needs; a “not found” would bury their problem under a plausible answer.

#### The upload ceiling is the only memory bound

Both routes use `memoryStorage`, that is, the whole file on the heap. `maxUploadBytes` is what keeps it from being exhausted, and that is why it must be host configuration rather than a constant. End-to-end streaming is separate work.

#### A cascade does not leave its tenant

The recursive CTE filters by workspace **in both branches**, not just the anchor. A cascade escaping its tenant is the worst possible bug here, so it is pinned down by an e2e test rather than by review alone.

#### Blob writes and the transaction do not diverge

Blob writes come **before** the transaction (the key is needed), and freeing on deletion comes **after** the commit. The first requires compensation in a `catch`, the second guarantees that a rolled-back deletion does not destroy bytes a surviving row points at. Both sides are equally load-bearing.

#### Filters never reach the driver

Values headed for a `WHERE` over typed columns are validated in the query itself — because it has two callers, and a controller would have covered only one. `LIKE` metacharacters are escaped, otherwise `?search=%` returns the whole library.

### Deliberately deferred

- **There is no deduplication** — a sha256 is computed and stored but never looked up.
- **There is no garbage collector for blobs.** A subscriber to `media.asset.deleted` is named in the plans but not written; freeing stays embedded in the use case and best-effort. Nobody picks up an orphaned blob (one whose provider refused at freeing time) today.
- **Video duration probing is not done** — the `duration` column is always empty.
- **There is no content inspection** — no sniffing, no antivirus, no type allowlist at upload.
- **There is no tool for moving blobs between backends.** Changing provider is a startup refusal; the move is done outside the system.
- **There is no separately configurable upload rate limit** — the identity plugin's shared limiter covers the public authentication routes, not media.

## 11. Invariants

Statements that must always hold. At once a review checklist and a draft set of test assertions.

- **I-01** — Bytes never live in the database: an asset's row holds only a `storage_key` + `storage_provider`.
- **I-02** — **Exactly one** storage provider runs in a deployment, passed as one object; there is no registry, no resolver and no `defaultProvider`.
- **I-03** — `provider.id` is a fact about the adapter itself, written into every row; the application **compares** it on reads, deletions and purges rather than looking a backend up by name.
- **I-04** — Startup aborts if `media_asset` holds rows from another provider; the message names it and the row count. A missing table is not a refusal.
- **I-05** — `capabilities.directUrl: true` cannot be declared without a `directUrl()` implementation, and `directServe: 'signed-url'` cannot be set on a provider that does not sign. Both checks happen when the application is assembled.
- **I-06** — `put` is all-or-nothing: a rejected call leaves no blob behind and hands out no key.
- **I-07** — `get` rejects **before** opening a stream, and with an `ObjectNotFoundError` specifically, when the key is missing; `remove` is idempotent.
- **I-08** — Every port method rejects a promise rather than throwing synchronously — a synchronous throw bypasses the `try` that frees the blobs.
- **I-09** — A derivative can never overwrite an original: it is written into the reserved `variants/` key space through `PutObject.isVariant`.
- **I-10** — Derivative generation is best-effort: a source the processor cannot decode yields zero derivatives and **never** fails the upload.
- **I-11** — A failed upload (a storage failure or a transaction rollback) frees **every** written blob, derivatives included.
- **I-12** — Deletion frees blobs **after the commit**, over `Asset.storageKeys` — the original and every derivative; a rolled-back deletion destroys no bytes.
- **I-13** — Uploading, moving and creating a subfolder take a `FOR SHARE` on the target folder and are therefore serialised against its cascading deletion.
- **I-14** — A folder-deletion cascade filters by workspace in **both** branches of the recursive CTE, locks the subtree `FOR UPDATE`, returns the deepest first, and repeats the walk until it stabilises.
- **I-15** — Every route is gated on a permission by the `PERMISSIONS.MEDIA_*` constant; state-changing session routes additionally carry `OriginGuard`.
- **I-16** — Every route but `GET /media/assets/:id/raw` carries `WorkspaceGuard`; that one derives the scope from the asset's row and requires membership of the owning workspace.
- **I-17** — A non-existent asset, another workspace, a missing membership and a blob missing from storage all give **the same 404**; the storage key never reaches the response body.
- **I-18** — A key that resolves outside the storage root stays a **500**: that is corrupted data, not the caller's error.
- **I-19** — Both raw routes always set `X-Content-Type-Options: nosniff` and a capability-free CSP; `inline` is granted only to allowlisted types, and SVG is not among them.
- **I-20** — The direct-serve redirect happens **after** authorization, carries a pinned type and disposition, and is accompanied by `Cache-Control: private, no-store`.
- **I-21** — The upload ceiling is inclusive: exactly `maxUploadBytes` is accepted, one byte more is a 413. No route gives `FileInterceptor` local `limits`.
- **I-22** — A filename is a leaf: `/`, `\`, control characters, an empty name and one longer than 255 are rejected by `FileName`, not silently cleaned.
- **I-23** — `?variant=` is resolved through `Object.hasOwn`; a missing derivative is not an error but a fallback to the original.
- **I-24** — An unparseable `folderId` and an unknown `kind` give a 400 from the query itself rather than a 500 from the driver; `%` and `_` in a search match themselves.
- **I-25** — Alt text is normalised identically on every path (trimmed, empty → `null`), so a space is never counted as coverage.
- **I-26** — The token half can only upload and read bytes; `media:update` and `media:delete` are granted to no token scope.
- **I-27** — A token upload is attributed to the user who issued the token; their role is **not** checked in the process — the decision was already made by the token's scope.
- **I-28** — An asset in a different workspace _inside_ the token's basket is also a 404, otherwise `X-Workspace-Id` would be advisory.
- **I-29** — Registration with the tool registry and with the workspace purge registry is `@Optional()`: media comes up without the copilot, without MCP and without the workspaces plugin.
- **I-30** — The three reading tools are visible to both surfaces and the two “proposals” to the copilot only; `downloadPath` is the only surface-dependent field, and it is presentation only.
- **I-31** — `media_asset_read` is bounded by a MIME allowlist and a 256 KB ceiling applied **during** the read; a decoding error is fatal, except for a truncated tail.
- **I-32** — `media_propose_file` takes a format from a closed enumeration, rejects a path in the name and is bounded to 1 MB; the applier calls the same `UploadAssetUseCase` the HTTP route does.
- **I-33** — The `domain/` layer imports neither `@nestjs/*` nor `drizzle-orm` nor `class-validator` nor `infrastructure/`.
- **I-34** — A provider depends only on `@orthacms/media-domain` — the port's types, plus `ObjectNotFoundError`, which is a value — and its own vendor SDK. The port declares no dependency of its own beyond the `tslib` helper runtime the release stamps into every manifest, so no adapter reaches NestJS, Drizzle or Express by any route: not in its manifest, not in its imports, and not transitively.
- **I-35** — Deleting a workspace deletes the media rows and frees their blobs — **without** per-item domain events, with one `delete` per table.
- **I-36** — In the admin UI, the absence of `media:read` starts no queries at all; a read failure gives an error state of its own with a retry rather than an empty state.
- **I-37** — Changing page, search, filter or sort clears the selection; the page is pulled back into range when the result shrank.
- **I-38** — A file picked on an entry's media field is not uploaded until the entry is saved; a failed upload aborts the whole save, and files that already uploaded are not uploaded a second time on retry.
- **I-39** — A file inserted into an article's body is uploaded **immediately** — a body holds a URL, and a URL does not exist without bytes.
- **I-40** — The admin UI's cache keys always contain the `workspaceId`.

## 12. Testing checklist

The wording is “action → expected result”, so items can go into a test case without rewriting. The server side is checked with `curl` + `psql` (plus a look at the storage directory), the admin side in a browser. The existing suites are `apps/server-e2e/src/server/media/*` (8 files: assets, folders, direct serving, hardening, local storage, the provider check, token scope, the upload ceiling), `apps/server-e2e/src/server/insights/media-insights.spec.ts`, `apps/server-e2e/src/server/content/content-media-fields.spec.ts`, `apps/server-e2e/src/server/copilot/copilot-media-files.spec.ts`, `apps/admin-e2e/src/media/*` (3 files) and `apps/admin-e2e/src/content/media-fields.spec.ts`.

### Uploading

- **Upload a PNG** → 200 with an `AssetView`; a row in `media_asset`; three blobs in storage — the original and two under `variants/`; `width`/`height` filled in.
- **Upload an SVG** → 200; `kind = image`; **no derivatives**, `variants = {}`; the upload did not fail.
- **Upload a ZIP** → `kind = archive`; one blob.
- **Upload a file with an unknown MIME type** → `kind = document`, no refusal — there is no type allowlist.
- **A file of exactly `maxUploadBytes`** → 200. **One byte more** → 413 reading “File exceeds the maximum upload size.”, not “File too large”.
- **A request with no `file` part** → 400, “file is required”.
- **The name `a/b.png`** → 400, no asset created, no blob written.
- **A 300-character name** → 400.
- **A `folderId` for a non-existent folder** → 404; the blobs written before the transaction are **freed** — the storage directory is clean.
- **Break the connection mid-upload** → no `.part` file and no partial object is left in storage.
- **Upload the same file twice** → two assets and two blobs — there is no deduplication; their `checksum`s match.
- **Upload with an `alt` of nothing but spaces** → `alt IS NULL` in the database; the file counts as uncovered in the coverage report.
- **An extra field in the body** → 400 from the global `ValidationPipe`.
- **Uploading as a viewer** → 403.

### Serving a file

- **Download a PNG** → 200; `Content-Disposition: inline`; `X-Content-Type-Options: nosniff`; a CSP of `default-src 'none'; sandbox; …`.
- **Download an uploaded `.html`** → `attachment`, **not** inline; the same nosniff and CSP.
- **Download an SVG** → `attachment`. And the grid's tile still renders — an `<img>` ignores the disposition.
- **A filename with a quote or a control character** → the header does not break (the name is percent-encoded).
- **`?variant=thumb` on an image with derivatives** → a WebP, smaller than the original.
- **`?variant=thumb` on an SVG** → the original, 200, not an error.
- **`?variant=toString`** → the original; the provider never receives an `undefined` and does not crash.
- **Another workspace's asset (the user is not a member)** → 404, identical to a non-existent id.
- **Delete the blob from storage by hand, leaving the row** → 404 **with an empty body**, not a 500; the storage key does not appear in the response.
- **Change `storage_key` in the database to `../../etc/passwd`** → a 500 with a stack in the log, not a 404 and not a served file.
- **Change `storage_provider` in the database to a foreign value and restart** → the application **does not start**; the message names the foreign id and the row count.
- **The same without a restart, requesting bytes** → a 500 with a message naming both providers.
- **A non-uuid in the path** → 400 from `ParseUUIDPipe`.

### Direct serving (`directServe: 'signed-url'`)

- **Starting with `signed-url` on the local provider** → the application does not start; the message names the provider and offers either removing the setting or changing backend.
- **A download on a signing provider** → 302; `Cache-Control: private, no-store`; the type and disposition are pinned in the URL.
- **A non-member on the same route** → 404, and **no** redirect — authorization comes first.
- **An uploaded `.html` with direct serving on** → the signed URL's disposition is `attachment`.
- **`directServeTtlSeconds = 0`** → the application does not start.

### Folders and deletion

- **Create two folders with the same name under one parent** → both are created — there is no name uniqueness.
- **Create a folder with a non-existent `parentId`** → 404.
- **Delete a folder with subfolders and files** → 204; the **whole subtree** disappears; every asset's blobs (derivatives included) are freed; there is never a 409.
- **Delete another workspace's folder** → 404; not one row of the other workspace is touched.
- **Create a subfolder under the subtree being deleted, in parallel with the deletion** → when it finishes there are no orphaned rows: either the subfolder was deleted along with the tree, or its creation was rejected.
- **Bulk-delete 100 assets** → `{ deleted: 100 }`; every blob and derivative is gone from storage.
- **Bulk-delete 101 ids** → 400.
- **An empty id list** → 400.
- **Another workspace's id in the list** → it is not counted in `deleted` and is not deleted.
- **Delete an asset referenced by a published entry** → the deletion goes through with no warning; the entry's next save gives a 422 “must reference an existing asset”; a public read simply omits that media.
- **Delete a whole workspace** → the `media_asset`/`media_folder` rows are gone, that workspace's storage directory is empty, and there are no per-item `media.asset.deleted` events in the outbox.

### Listing, filters, edits

- **`?folderId=not-a-uuid`** → 400, not 500.
- **`?kind=picture`** → 400 listing the permitted values.
- **`?search=%`** → finds only assets with a literal `%` in a name or a tag.
- **`?search=_`** → the same for the underscore, rather than the whole library.
- **`?pageSize=1000`** → 100 is returned.
- **`?page=0` or `?page=abc`** → treated as 1.
- **Two consecutive pages with identical sort values** → no duplicates between the pages (the `id` tie-break).
- **PATCH with only `{ tags: [] }`** → the tags are cleared and the name and folder untouched.
- **PATCH `{ folderId: null }`** → the asset is at the root.
- **PATCH `{ folderId }` for a non-existent folder** → 404, the asset is not moved.
- **PATCH with 51 tags or a 65-character tag** → 400.
- **PATCH `{ tracks }` with `kind: 'lyrics'`** → 400 — `kind` is limited to four values.
- **PATCH as a viewer** → 403.
- **Duplicate an asset with a 254-character name** → 400 (the “ copy” overflows the limit), and the copy's blob is not written.
- **Duplicate an image with derivatives** → the copy has derivative blobs of its own, and the alt text is carried over.

### The token half

- **Uploading with a `read`-scope token** → 403 — only `full` holds `media:create`.
- **Uploading with a `full` token** → 200; `uploaded_by` is the user who issued the token; the library's “who uploaded” column shows their name.
- **Downloading with a `read` token** → 200 — both scopes hold `media:read`.
- **Downloading an asset from another workspace in the same token basket** → 404.
- **A two-workspace token with no `X-Workspace-Id`** → refused; with a single workspace the header is optional.
- **A PATCH or DELETE by token** → the routes do not exist; the session ones answer with an authentication refusal.
- **A session user uploading through the token route** → refused — the route is gated by `ApiTokenGuard`.

### Agent tools

- **`media_assets_search` with no `folderId`** → searches the whole workspace, nested folders included.
- **The same with `folderId: null`** → the root only — the two states are distinguishable.
- **A search result** → contains a `downloadPath` and does not contain `variants`, pixel dimensions or a full `url`.
- **The same tool through MCP and through the copilot** → the `downloadPath` differs (`/api/v1/…` versus `/media/…`), everything else is identical.
- **`media_asset_read` on a PDF** → a MIME-allowlist refusal rather than garbage text.
- **`media_asset_read` on a 1 MB file** → at most 256 KB is returned, with a truncation marker; the whole file is never read into memory.
- **A file declared `text/plain` that contains binary** → a decoding error rather than a page of replacement characters.
- **The truncation landed in the middle of a multi-byte character** → the file is read, the tail is dropped, and there is no error.
- **`media_asset_read` on another workspace's asset** → “no such asset” — the same as for a non-existent one.
- **`media_propose_file` with the name `reports/q3.md`** → a tool error naming `folderId`; the model can correct itself and propose again.
- **`media_propose_file` with `summary.txt` and the `md` format** → the file is called `summary.md`, not `summary.txt.md`.
- **`media_propose_file` with 2 MB of content** → refused (the 1 MB ceiling), despite the larger `maxUploadBytes`.
- **A deletion tool** → absent from the catalogue — for the copilot and for MCP alike.
- **An application without the copilot and without MCP** → starts; tool registration is silently skipped.

### The provider contract (the testkit)

- **`npx nx test` on any adapter package** → the `describeStorageProvider` suite passes in full.
- **Two assets with the same filename** → different keys.
- **A derivative named `thumb.webp` next to an original of the same name** → the keys do not collide and the original is intact.
- **A stream that fails mid-`put`** → the promise rejects **and** nothing is left in storage.
- **`get` on a never-written key and on a removed one** → an `ObjectNotFoundError` in both cases, before a stream is opened.
- **`remove` twice, and on a non-existent key** → success, with no exception.
- **A provider with `directUrl: false` and the method implemented (or the reverse)** → the suite fails.

### The admin UI

- **Open the media library as a viewer** → the library is visible; the upload, create-folder, rename and delete buttons are absent.
- **Revoke `media:read` and open the page** → the “no access” card; there are no network requests to `/media/*` at all.
- **The API answers 500 on the asset list** → an error state with `role="alert"` and a “Retry” button, **not** “nothing here”.
- **An empty library** → an empty state with an invitation to upload (and without the invitation when `media:create` is missing).
- **A filter that matched nothing** → the wording differs from “the library is empty” and offers to clear the filters.
- **Drag five files into the upload dialog** → all five are in the staging list; images get local thumbnails; at most three are in flight at once.
- **One file in the batch fails** → the rest arrive; the failed one has a “Retry”; the whole batch is not lost.
- **Cancel an upload in flight** → the row is marked cancelled; the request really is aborted.
- **Confirm the upload dialog** → there is **no** success toast; the banner carries the status.
- **A rename with a server error** → only the server's message on screen, with no parallel “Renamed to …”.
- **Delete a non-empty folder** → the confirmation names the file and subfolder counts; an empty one gets a plain wording.
- **Confirm an asset deletion** → focus moves to the “Assets” section rather than to `<body>`.
- **Cancel a deletion** → focus returns to the menu's trigger.
- **Select assets, then go to the second page** → the selection is cleared; the counter does not “flicker” and does not bring old ids back later.
- **Delete the last assets on the last page** → the pager pulls back to an existing page and no empty grid is shown.
- **Type a search while on page 4** → you go to page 1.
- **A grid of images** → `?variant=thumb` is requested rather than full originals; the details panel uses `preview`.
- **The focus tree breaking when the move dialog closes** → focus stays inside the page.

### An entry's media field and an article's body

- **Pick a file on a media field and do not save the entry** → the file is not in the library — not a single upload request was sent.
- **Pick a file and save** → the upload happens inside the save; the entry's value holds a real id and no placeholder.
- **A file fails during the save** → the entry is not saved, the toast names the file, and the form keeps its placeholders.
- **Retry the save after a partial success** → the already-uploaded files are not uploaded a second time.
- **Remove a staged file before saving** → the object URL is revoked and the file is not uploaded.
- **Switch editor tabs and come back** → the staged files are still there — the hook lives above the tab.
- **Pick an existing library asset** → no upload; an ordinary form edit.
- **A file that fails the field's `accept`** → rejected at pick time and never enters the value; the server rechecks on save.
- **An entry without `content:update`** → the tiles are visible and everything else (pick, upload, remove, reorder, the drop zone) is absent; the upload dialog is not mounted.
- **A user with the full `media:*` set but no permission on this entry** → the same — this is a _content_ permission, not a media one.
- **A media field referencing a deleted asset** → a warning tile with the “dead” id, not a blank space and not an endless wait.
- **Open the editor before the media links have arrived** → a “resolving” placeholder tile; full-size originals are not requested; after a settled read with no link, a fallback to the original rather than a permanent wait.
- **Insert an image into an article's body from the library** → a `previewUrl` and a width go into the node; nothing is uploaded.
- **Upload an image straight from an article's body** → the upload happens **immediately**, the file appears at the library's root, and the cache is invalidated.
- **Pick a PDF or audio in an article's body** → no insertion happens — the editor has no such node.

### Insights

- **The “What is taking up storage” widget** → the bar lengths are bytes, and only bytes; the count is shown separately.
- **A workspace with a few large videos and thousands of pictures** → images lead by count, video by bytes; both figures are visible.
- **An image with `alt = ' '`** → counted as uncovered.
- **The alt-text widget** → the headline is the **number missing**, not a coverage percentage; there is no date window.
- **`?days=9999`** → clamped to 365; `?days=abc` → 30.
- **The byte total for a large workspace** → arrives as a number with no loss of precision (`sum(size)::bigint`).

## 13. Boundaries of responsibility

| Area                                              | Who owns it                           | What Media does                                                                             |
| ------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------- |
| The database connection and running migrations    | `@orthacms/database` + `@orthacms/nx` | Owns the schema and migration **files** but not the connection and not the application step |
| Authentication, roles, permissions, bearer tokens | `identity-server`                     | Only declares the required permission constants on its routes                               |
| A workspace's existence and membership of it      | `workspaces-server`                   | Uses `WorkspaceGuard` and `MembershipCheckQuery`; holds no FKs to workspaces of its own     |
| Deleting a workspace                              | `workspaces-server`                   | Implements the `WorkspacePurger` port and subscribes **itself** to the purge registry       |
| Validating a media field on an entry's save       | `content-server`                      | Implements the `MEDIA_ASSET_RESOLVER` port content declared; knows nothing about entries    |
| The public API's token guards                     | `content-server`                      | Imports its `ApiTokenGuard` and `ApiTokenWorkspaceGuard` instead of writing its own         |
| Inserting an image into text                      | `wysiwyg-admin`                       | Fills the slot it declared; the editor must work without the media plugin                   |
| The Insights page                                 | `insights-admin`                      | Supplies four cards and the three read models behind them, because it owns the table        |
| Exporting and importing files                     | `transfer-server`                     | Hands over bytes and takes them back through the ordinary `UploadAssetUseCase`              |
| The activity log                                  | `activity`                            | Raises `media.*` events into the transactional outbox                                       |
| Tool dispatch and call authorization              | `tools-server`                        | Registers five tools and declares their surfaces                                            |
| Fencing untrusted tool output                     | `copilot-server` (the run engine)     | Over MCP that protection does not exist at all — there the client is responsible for it     |
| The bytes in the backend                          | the provider adapter                  | Knows only the port; never parses the key's format                                          |

### What else is missing

- **Presigned uploads.** A file always goes through the application; a signed URL exists only for serving.
- **Deduplication, GC for orphaned blobs, video duration probing.**
- **A usage check on deletion** — Media does not know who references it.
- **A list view and a “select all”** in the grid — removed along with the table.
- **Editing tags and subtitle tracks in the admin UI.** The server accepts them (a `PATCH` with `tags` and `tracks`), but the interface only displays tags and does not display tracks at all — there is no screen for them.
- **Changing a folder's parent** — a folder can only be renamed.
- **The client being able to read the upload ceiling** — no route reports it, which is why the hint does not name a size.
- **A keyboard e2e suite** for the field and the library.

## 14. Discrepancies between the code and the documentation

Found while reconciling this dossier with the sources. Not product bugs in themselves, but they disorient developers and testers alike.

| Where                                                                   | What it says                                                                                                                                                        | How it actually is                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| media/server/AGENTS.md, “Not yet (follow-ups)”                          | “wiring `directUrl` into the download route (the S3 adapter implements it; **nothing calls it yet**)”                                                               | Direct serving is **implemented and working**: `http/direct-serve.ts`, the `directServe` config field, the `MEDIA_DIRECT_SERVE`/`MEDIA_DIRECT_SERVE_TTL_SECONDS` variables, a `directUrlFor` call in **both** raw controllers, an assembly-time check and the `media-direct-serve.spec.ts` suite. A neighbouring section of the same file (“Direct serve: a redirect instead of a stream”) describes it correctly — the document contradicts itself      |
| media/server/AGENTS.md, “HTTP surface”                                  | Lists the routes: folders (4) + `GET/POST /media/assets`, `GET …/raw`, `PATCH …/:id`, `DELETE /media/assets`                                                        | The `POST /media/assets/:id/duplicate` route (`DuplicateAssetController`, the `media:create` permission) is **absent** from the list, although it exists, is registered and is used by the admin UI. That makes 10 routes in the session half, not 8                                                                                                                                                                                                     |
| media/server/AGENTS.md, the last paragraph                              | “Video captions have no representation at all: ORT-92” and “any **per-usage** override — a `field.media` value is a bare uuid… That is ORT-83 / ORT-91”             | Both are done. The `tracks` column was added by the `0002_asset_tracks` migration, is accepted by `UpdateAssetDto.tracks`, and is returned by the resolver with ready-made `src`. And a media field's value is no longer a bare uuid: the `content-domain` kernel knows the shape `{ id, alt?, decorative? }` (`mediaValueIds`, `hasTextAlternative`), and `MediaFieldItem` in the admin UI renders both the per-usage alt and the “decorative” checkbox |
| media/admin/AGENTS.md, “Data layer”                                     | “search/kind/sort are applied **client-side** over that page (a large `pageSize`) — true server-side pagination is a follow-up”, repeated in “Not yet (follow-ups)” | Pagination is **server-side**: `useMediaLibrary` sends `search`, `kind`, `sort`, `page` and `pageSize` to the server, there is a `MediaPagination` component, the `DEFAULT_ASSETS_PAGE_SIZE = 24` and `ASSETS_PAGE_SIZE_OPTIONS = [24, 48, 96]` constants, clamping of the page into range and clearing of the selection on a page change. The comment in the hook itself says outright that the old client-side `filter` + `sort` has been replaced     |
| media/admin/AGENTS.md, “Not yet (follow-ups)”                           | “alt/tag editing in the drawer (**read-only today**)”                                                                                                               | Alt text in the details panel **is editable** — an `InputField` + a “Save alt text” button, gated on `canUpdate`, for `kind === image` only; and the “Alt text is writable in two places” section of the same file describes it. Only half the statement is true: **tags** really are display-only                                                                                                                                                       |
| media/admin/AGENTS.md, “End-to-end cover”                               | “The Media Library page still has **only** `media-library.spec.ts`”                                                                                                 | `apps/admin-e2e/src/media/` holds three files: `media-library.spec.ts`, `media-alt-text.spec.ts`, `media-feedback.spec.ts`                                                                                                                                                                                                                                                                                                                               |
| media/provider-testkit/AGENTS.md                                        | “Its real consumers are `@orthacms/media-provider-local` and `@orthacms/media-provider-memory`”                                                                     | The suite is called by **all six** adapters: local, memory, s3, gcs, azure, vercel-blob — and each keeps the testkit in its `devDependencies`                                                                                                                                                                                                                                                                                                            |
| create-ortha-app/src/lib/features.ts, the JSDoc above `MEDIA_PROVIDERS` | “S3 is **listed and disabled** — the package exists but has never been released, and offering it would generate an app that cannot install”                         | Directly beneath that comment the `media-s3` entry carries `available: true`, so the option is available in the wizard. The comment describes a state that no longer exists                                                                                                                                                                                                                                                                              |
| media/admin/src/lib/constants/index.ts                                  | The permissions' JSDoc: “Mirrors the **(future)** server matrix”                                                                                                    | The matrix has existed for a long time: `PERMISSIONS.MEDIA_*` in `identity-server`, granted to three system roles and two token scopes                                                                                                                                                                                                                                                                                                                   |

> **Not a discrepancy, but a noticeable asymmetry**
>
> The server accepts `tracks` (subtitle tracks) through `PATCH /media/assets/:id`, returns them in the `AssetView` and resolves them for content with ready-made `src`. **The admin UI has no screen that edits them** — a search through `packages/media/admin/src` does not find the word `tracks` at all. That is, the capability exists only for API clients and agents; an editor working through the interface cannot reach it.

---

**The second dossier in the series.** Written for the `packages/media` group in the same structure as the Identity dossier: business description → composition → permissions → data → lifecycle → scenarios → API → the admin UI → configuration → security → invariants → checklist → boundaries → discrepancies. The “storage adapter matrix” section is added as specific to this group — Identity has no equivalent.

The source is the code: the controllers, DTOs, guards, use cases, the Drizzle schema and three migration files, the `StorageProvider` port and its six implementations, the contract test suite, the admin UI's pages and hooks, plus the host's configuration (`ortha.config.ts`, `plugins.ts`, `.env.example`) and `docs/adr/0012-one-storage-provider-per-deployment.md`. The `AGENTS.md` files were used as a skeleton, but every statement was verified against the implementation — the divergences are collected in section 14.
