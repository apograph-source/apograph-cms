# Transfer

_Package group · packages/transfer_

**Content export and import — exactly one hop into the graph**

Transfer takes content out of the CMS as a file and brings it back in. It owns no table and no migration: it is a **protocol adapter** over the content plugin — reading through its services and writing **only** through `EntryWriterService`. Two product decisions hold the whole construction up: an export travels **exactly one hop** from the selected entries, and an entry's identity on a foreign installation is given by a **natural key** rather than a row id.

- **3** packages in the group
- **5** HTTP routes
- **4** formats
- **0** database tables
- **2** audit events
- **2** permissions of its own
- **2** dialogs, **3** slots
- **10** configurable limits

## Contents

- [01. Business description](#01-business-description)
- [02. Composition of the package group](#02-composition-of-the-package-group)
- [03. Roles and permissions](#03-roles-and-permissions)
- [04. The format matrix](#04-the-format-matrix)
- [05. What travels and what stays a reference](#05-what-travels-and-what-stays-a-reference)
- [06. Data model](#06-data-model)
- [07. The lifecycle of a transfer](#07-the-lifecycle-of-a-transfer)
- [08. Scenarios — how it works, step by step](#08-scenarios-how-it-works-step-by-step)
- [09. HTTP API](#09-http-api)
- [10. The admin UI: where it lives and how it behaves](#10-the-admin-ui-where-it-lives-and-how-it-behaves)
- [11. Configuration](#11-configuration)
- [12. Security: what was done and why exactly that way](#12-security-what-was-done-and-why-exactly-that-way)
- [13. Invariants](#13-invariants)
- [14. Testing checklist](#14-testing-checklist)
- [15. Boundaries of responsibility](#15-boundaries-of-responsibility)
- [16. Where the code and the documentation diverge](#16-where-the-code-and-the-documentation-diverge)

## 01. Business description

Transfer solves four real editorial problems that have nothing in common but the file in the middle: hand a translator a column of text in a spreadsheet, move a section between installations, keep a copy of the content outside the system, seed staging with production data.

### Why this is not “an export button”

ADR-0014 frames it as one decision that broke into three questions.

- **How far should it pull?** An article without its author, tags and cover arrives on the other side as an article with empty fields. So an export has to walk the relations — and in the same breath it has to know where to stop. Content graphs are almost always connected: a recursive walk from one article reliably drags out nearly the whole library, without warning and without any way for the person who clicked to know that is what is about to happen.
- **What does an entry even mean on the other side?** A row's `id` is a fact about one database. Carried across, it names nothing, so an import keyed on identifiers can only create. Run the same file twice and you get two sets of everything.
- **Where should this live?** Export and import touch content, relations, media bytes and locales. Inside `content/server` that would give that package a dependency on storage and an archive format; smeared across four plugins it would put the depth rule in four places.

> **The three answers everything else rests on**
>
> **A separate adapter plugin.** `transfer → content`, `transfer → media` (optional). There is no arrow back: nobody calls into transfer, so the package graph stays acyclic.
>
> **A depth of exactly one hop.** Depth 0 is the selected entries and their locale twins; depth 1 is everything reached across one relation, exported in full; depth 2 is not exported, but _references to it survive_, carrying a natural key.
>
> **Identity travels as a natural key.** Every entry and every reference has a `$key` — the field values by which an entry of its type is recognised. The fields are named in the plugin's configuration; where they are not, they are derived heuristically, and the choice is written into every export's manifest.

### Who sees it

#### The editor and the translator

Selects entries in the library — “Export” — CSV. Edits the copyright column in a spreadsheet and brings the file back through “Import…”, first looking at exactly what will change, and only then clicking.

#### The content engineer

A ZIP with file bytes, moving a section between installations. What matters to them is the conflict policies and the fact that an import will not create a second author just because a second article arrived.

#### The operator / the security team

Two audit events in the shared outbox: who took how much out, and when. Export is the one operation that carries a workspace's content out in bulk, files included.

### What Transfer is not

- **It is not a backup.** An export travels one hop from what was selected; it does not snapshot the database. Entry versions, draft versions, the trash, permissions, workspaces and users never reach the file.
- **It is not a schema migration.** The content types must already exist on the receiving side; an unknown type is an `unknown-type` verdict, not a type being created.
- **It is not a background job.** A large export remains a synchronous request bounded by ceilings. There is no `transfer_jobs` table, no progress and no link to a finished archive — ADR-0014 explicitly leaves room for them and does not go there.
- **It is not its own way of writing to the database.** Every entry goes through `EntryWriterService`, which means an import physically cannot outrun field validation, the workspace scope, relation-target checks, the one-locale rule, the media-asset check, revisions, the outbox or the attached i18n extension.
- **It is not a separate admin page.** The package adds no routes: export and import are actions on content the person is already looking at.

> **One sentence worth remembering**
>
> **An import can never do more than the caller could do by hand.** `content:import` is the permission to _run_ an import; the permission to _create_ and to _change_ an entry is checked separately, per entry, against the ordinary `content:create` / `content:update` keys.

## 02. Composition of the package group

The `packages/transfer` group is three packages. The split is not cosmetic: the kernel has to be testable without a container and without React, so it contains no clock, no database and no framework.

| Package | npm name                  | Role                                                                                                                            | What it owns                                                                                                                                                                     |
| ------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain  | @orthacms/transfer-domain | The framework-free kernel: the document contract, the format ports, the natural-key rules, the verdict vocabulary, the ceilings | `TransferDocument`, `ExportSerializer`/`ImportParser`, 4 formats, `keyFingerprint`, `TransferIdMap`, `DEFAULT_TRANSFER_LIMITS`. Its one dependency is `@orthacms/content-domain` |
| server  | @orthacms/transfer-server | The NestJS plugin: the routes, the graph walk, a hand-rolled ZIP, reading the uploaded file, the two-phase import pipeline      | 5 routes, `EntryGraphWalker`, `zip-writer`/`zip-reader`/`crc32`, `TransferSchemaCatalog`, 2 events. **Zero tables, zero migrations**                                             |
| admin   | @orthacms/transfer-admin  | Two dialogs and three contributions into the Content Library's slots. **Adds no routes**                                        | `ExportDialog`, `ImportDialog`, `ImportVerdictList`, 4 data hooks, 3 slot hooks                                                                                                  |

### The layout inside the packages

#### domain/src/lib

`document/` — the document contract; `schema/` — a structural view of a content type; `identity/` — deriving and reading a natural key; `formats/` — the ports and the four formats; `csv/` — RFC 4180 and flattening an entry into a row; `import/` — the id map, the two policies, the verdict vocabulary; `limits.ts`.

#### server/src/lib

`archive/` — the ZIP writer and reader plus CRC-32; `schema/` — registry → kernel schema, and the one place the identifying fields are chosen; `export/` — the walk, the join with the serializer, the routes; `import/` — reading the upload, the two-phase pipeline, the media path.

#### admin/src/lib

`api/` — four data hooks (one per route, the template aside); `components/` — the two dialogs and the verdict table; `hooks/` — three slot hooks; `constants/` — permission keys, contribution ids, cache keys.

> **Neighbours easily confused with it**
>
> **`@orthacms/content-server`** owns the type registry, `EntriesService`, `EntryWriterService`, `RelationLinkService` and the admin slots — transfer is only their reader. **`@orthacms/media-server`** owns assets, storage and `UploadAssetUseCase`; without it the plugin still comes up, and media fields travel as references. **`@orthacms/i18n-server`** — transfer _does not depend_ on it at all: `locale` and `locale_group_id` are content's own envelope columns, and the walk reads “the other rows of this entry” generically.

## 03. Roles and permissions

Transfer adds exactly **two** permission keys to Identity's flat model — and both are deliberately separate rather than folded into `content:read` and `content:create`.

| Permission     | What it opens                                               | admin | contributor | viewer |
| -------------- | ----------------------------------------------------------- | ----- | ----------- | ------ |
| content:export | Both export routes — the preflight and the download itself  | ✓     | ✓           | —      |
| content:import | Both import routes — the dry run and the apply              | ✓     | ✓           | —      |
| content:read   | Download an empty CSV template with the type's columns      | ✓     | ✓           | ✓      |
| content:create | **Re-checked per entry** that the import is about to create | ✓     | ✓           | —      |
| content:update | **Re-checked per entry** that the import is about to update | ✓     | ✓           | —      |

> **Why an observer does not get export**
>
> An observer already reads every entry — page by page, through the interface. The difference is not access but **bulk extraction**: a download in a single file, media bytes included, is a different action, and it is precisely the one an operator wants to be able to withhold and to find in the journal afterwards. The comment in `system-roles.ts` says so in as many words: “viewer does not get export”.

### How a permission reaches the code

- **On the server:** both controllers declare the class-level stack `@UseGuards(OriginGuard, PermissionsGuard, WorkspaceGuard, ContentGrantGuard)`, with a `@RequirePermissions(...)` on each method. The stack is copied from content's own bulk controller — **deliberately**: `ContentGrantGuard` is what stops a workspace member granted only `article` from exporting `tag` by naming it in the URL.
- **The re-check on import:** the controller reads the caller's real permission set through `PermissionsService.forRole(user.roleId)` and passes `can.create` / `can.update` flags into the use case. An entry lacking the needed flag gets an `error` verdict with the reason `forbidden` — and that happens _before_ the write is attempted, not after the writer refuses.
- **In the admin UI:** `useHasPermission('content:export')` and `useHasPermission('content:import')` hide the menu items. That is only interface honesty; the real check is on the server.

> **A subtlety the UI does not close**
>
> The “Import…” item is shown to anyone holding `content:import` and does **not** check `content:create`/`content:update`. The three system roles always grant those together, so in the standard distribution this is invisible. With a custom role holding only `content:import`, the dialog opens, the file validates, and every entry gets `forbidden`. The `CONTENT_CREATE` / `CONTENT_UPDATE` constants in `transfer-admin` are declared with a “needed next to import” comment but are read by no hook.

## 04. The format matrix

There are four formats, and they sit behind a pair of ports — `ExportSerializer` and `ImportParser`. The graph walker never learns what a format is: adding XLSX or XML is a new pair of implementations plus a row in the capability table, not a branch inside the walk.

`TRANSFER_FORMAT_CAPABILITIES` is **not documentation**. The export dialog reads it to disable the files toggle; the server reads it to decide whether an archive is needed. One table means the interface cannot promise something the server will quietly not do.

| Format | Extension / MIME               | Carries bytes | Lossless | Many types | What it is for                                                                                                                                                   |
| ------ | ------------------------------ | ------------- | -------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| json   | .json · application/json       | —             | ✓        | ✓          | One indented object: the manifest and every entry. The readable option — the one people open with their eyes and edit by hand                                    |
| ndjson | .ndjson · application/x-ndjson | —             | ✓        | ✓          | The manifest on the first line, then one entry per line. An entry is encoded exactly as in JSON — so a document written by one is read by the other without loss |
| zip    | .zip · application/zip         | ✓             | ✓        | ✓          | **The only format that carries file bytes.** Inside: `manifest.json`, `entries/<type>.ndjson` and `assets/<id>/<name>`                                           |
| csv    | .csv · text/csv                | —             | —        | —          | A flat table per type. The real scenario it serves well: take a column of text out, translate or proofread it in a spreadsheet, bring it back                    |

> **Why CSV across several types is a ZIP**
>
> One table with a `$type` column would require the union of every type's fields in the header — unreadable in exactly the tool CSV is chosen for. So the serializer emits one `<type>.csv` file per type, and the server, seeing more than one member, packs them into an archive. The dialog says so in advance, on its own line.

### What exactly CSV loses

The loss is structural, not accidental: a table has one value per cell, while an entry has a formatted document, an ordered list of references and a set of files. `csv/flatten.ts`'s job is not to fix that but to make the loss **predictable** and impossible to confuse with a full export.

| Field type                             | How it goes into a cell                                                                                    | How it is read back                                                                                                                                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| richtext                               | `richTextPlainText` — the body text only, with no markup: exactly what a translator works on               | Each line becomes a paragraph via `htmlToRichTextDocument`. The formatting is not restored                                                                                                                                             |
| relation                               | `type:key1\|key2` tokens separated by `;`. Backslash escaping: any separator may occur inside a slug       | `parseRefToken` splits on the **first unescaped** colon — a key value may contain a colon (a URL, a time), a type name may not                                                                                                         |
| media                                  | A list of names (or URLs/paths) separated by `;`                                                           | **Not restored at all.** A file name in a table is not a file; inventing an asset reference from it means re-pointing entries at whatever happened to match by name. The cell is ignored, and the entry's existing media is left alone |
| multiselect                            | Values separated by `;`, with escaping                                                                     | Parsed back with the same escaping                                                                                                                                                                                                     |
| json                                   | `JSON.stringify`                                                                                           | `JSON.parse`; an invalid cell stays a string — the field validator will complain about it, rather than the whole file failing                                                                                                          |
| date / datetime                        | An ISO string                                                                                              | The string as is; the field validator parses it from there                                                                                                                                                                             |
| the inverse side of a two-way relation | **There is no column.** It does not own the storage — a column whose edits would go nowhere would be a lie | —                                                                                                                                                                                                                                      |

A CSV header is five envelope columns (`$id`, `$depth`, `$locale`, `$localeGroup`, `$status`), then the fields in schema order. A column the type does not have is a **hard rejection of the file naming that column**, not a quiet skip: a typo or a renamed header would mean a whole column of edited text was thrown away while the import reported success.

CSV carries no manifest, so one is synthesised: `depth` is all `false`, and that is precision rather than a placeholder (a flat table went nowhere), `exportedAt` is the epoch, `sourceWorkspaceId` an empty string, and `identity` whatever the receiving side resolves.

## 05. What travels and what stays a reference

There is one rule, and it is enforced in one loop of the walker rather than smeared across its readers.

**depth 0 · the selection** — one relation → **depth 1 · in full** — a second relation → **depth 2 · the key only**

| Kind of data                                 | Travels                     | How exactly, and why                                                                                                                                                                                                                       |
| -------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The selected entries                         | in full                     | Scalar values, references, media references, `$key`, `$depth: 0`. Read through `writer.loadLiveByIds` — the workspace's live rows, soft-deleted ones excluded                                                                              |
| The locale twins of the selection            | in full                     | The `locales` toggle, on by default. It reads `locale_group_id` — content's envelope column for any type with `i18n: true`. Each locale is a **separate entry** in the document; on the way back they are stitched into one by group       |
| Related entries (one hop)                    | in full                     | The `relations` toggle, on by default. `$depth: 1`. Nodes already visited are not re-read                                                                                                                                                  |
| The locales of related entries               | on request                  | The `relationLocales` toggle, **off by default**: it multiplies the size by the number of locales on top of the number of relations — a surprise nobody asked for                                                                          |
| Relations of relations (depth 2)             | the key only                | The entries themselves are not exported. But their `$key` is fetched by a **cheap projection over the identity columns alone** — which is what makes “the import will link them if it finds them” a fact rather than a wish                |
| Media bytes                                  | ZIP only                    | The `media` toggle. In a ZIP, as an `assets/<id>/<name>` member, with the stream opened only once the writer has reached it. In the other formats the metadata travels: name, MIME, size, a `sha256:…` checksum, alt text, subtitle tracks |
| Subtitle tracks (video/audio)                | as a description            | `TransferAssetTrack`: `kind`, `srclang`, `label`, `path` or `url`, `default`                                                                                                                                                               |
| Publication status                           | leaves, but does not arrive | `$status` is written by the walker for a publishable type and is **not read by the import** — see section 16                                                                                                                               |
| Versions, history, revisions                 | no                          | The live row is exported. Revisions on the receiving side are produced by `EntryWriterService` itself, as for any other entry                                                                                                              |
| Soft-deleted entries (the trash)             | no                          | The walker adds `isNull(deletedAt)` everywhere for a paranoid type, and the export button is hidden in the trash view                                                                                                                      |
| Type schemas, permissions, workspaces, users | no                          | Outside the plugin's scope. The manifest carries `sourceWorkspaceId` — **purely informationally**                                                                                                                                          |

> **The key asymmetry**
>
> The walk stops at **entries**, not at **references**. A depth-1 entry still gets resolvable `$ref`s, filled in by a projection over the depth-2 rows. A reference carrying only somebody else's row `id` is unresolvable anywhere else — which is exactly the problem natural keys exist for.

### The owning side of a relation only

`owningRelationFields` excludes the inverse side of a two-way relation deliberately: it is the _same_ relation read from the other end. Walking both would export every edge twice and — worse — let an import write one relation from two directions with two different orders. A two-way relation has one owner, and the owner's order is the order.

“Many” relations are read through `relations.snapshotLinks` — the row's **complete** ordered set of links, unlike the preview in the records table, which reads one bounded page. An export that lost an entry's three-hundredth tag would silently lose data on the way back in. They are read in batches of 8 rows so that a large export does not take the whole connection pool for one query.

## 06. Data model

> **There are no tables**
>
> The plugin **owns no table and no migration**. It has no `drizzle.config.ts`, no `migrations/` directory and no migration-journal table of its own. Transfer reads and writes content that already exists; the only thing it adds is two audit events, which ride the shared outbox from `@orthacms/database`.

### The model is a document, not a database schema

`TransferDocument` is what an export produces and an import consumes, in every format. The formats differ in _how it is written down_ (one JSON object, a line per entry, a flat table, an archive member); they do not differ in _what it means_.

| Manifest field    | What it is                                                      | Why it is there                                                                                                                                                                                                        |
| ----------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| version           | The format version at export time; currently `1`                | The importer **refuses** a version above its own rather than guessing. It is raised when a change would make an old importer read a new document _wrongly_: a new optional field is not a reason, a changed meaning is |
| exportedAt        | An ISO timestamp of the export                                  | A landmark for a human                                                                                                                                                                                                 |
| sourceWorkspaceId | The source workspace                                            | **Informational only.** An import always stamps its own request's workspace, so a hand-edited manifest is a way to mislabel your own export, not a way to cross a tenant boundary                                      |
| rootType          | The type the export started from                                | Checked at parse time: a manifest that names no type is a rejection                                                                                                                                                    |
| depth             | Four flags: `relations`, `media`, `locales`, `relationLocales`  | A reader can tell a partial file from a whole one                                                                                                                                                                      |
| identity          | The identity fields per type, as the **exporter** resolved them | The import matches on the same fields the export keyed on, instead of re-deriving them from a schema that may have drifted. Otherwise “the same entries imported twice” is exactly the failure it produces             |
| counts            | `roots`, `related`, `assets`, `assetBytes`                      | The same numbers the preflight showed; they also go into the audit event                                                                                                                                               |

| Entry field           | What it is                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| $type                 | The content type's name                                                                                                                                                                               |
| $id                   | The source row's identifier. A handle **within one document**; it is never written into the target row                                                                                                |
| $key                  | The natural-key values, by field name. Empty if the type resolved no identity field                                                                                                                   |
| $depth                | `0` or `1`. The importer reads this: a depth-1 entry is context, so a validation failure on it degrades to a skipped relation rather than sinking the entry that was actually asked for               |
| $locale, $localeGroup | The locale slug and the translation group id — for a row of a localised type. Twins in one document share a group, and that is how the importer restores it without a locale-matching rule of its own |
| $status               | Draft/published — for a publishable type                                                                                                                                                              |
| values                | Scalar values by field name. Dates are normalised to ISO so the document is ordinary JSON in any format                                                                                               |
| relations             | Per field: one reference for a single relation, a list for a “many” one (in the owner's order), `null` for an explicitly empty single one                                                             |
| media                 | One record per asset mentioned: the field, the source `$id`, the path in the archive or the URL, the name, the MIME type, the size, the `checksum`, the `alt` text, the tracks                        |

### A reference carries two handles, because they answer different questions

- `$id` resolves **inside this document** — the case where the target was exported alongside and both are being created right now, so no natural key would match anything yet.
- `$key` resolves against a receiving installation that has never seen this document.
- `$locale` is **part of the match, not decoration**: on a localised type the key values are per-row, so a key without a locale is ambiguous exactly where a translation shares a slug with the original.

### How the identity fields are chosen

The order in `resolveIdentityFields` is strict, and the source of the choice is recorded in `IdentityResolution.source`:

1. **`configured` — named in the plugin's configuration.** It wins unconditionally, _including_ the case where it names a field the schema no longer has: that is a configuration error worth surfacing as an unresolvable key rather than papering over with a guess.
   _identity: { product: ['sku'], author: ['email'] }_
2. **`unique-field` — the first field that looks like an identifier.** Only “keyable” types are candidates: text, select, number, money, date, datetime. A match is either `relation.unique === true` or the name: `slug`, `key`, `code`, `sku`, `email`, `handle`, `identifier`.
   _a scalar column in the schema has no unique flag — only relations do, hence the name heuristic_
3. **`required-text` — the first required text field.** Usually the title. Two posts may legitimately share a title; two posts cannot share a slug — which is why step 2 comes first.
4. **`row-id` — nothing was found.** There is no key, and matching falls back to the source row's identifier.

> **A localised field is a candidate, and that is deliberate**
>
> A transfer entry is one **row**, not an “entry across languages”: the English and the German version of an article travel as two entries and are stitched back together by locale group. So a per-locale slug identifies exactly the row it belongs to. What saves `en`/`hello` from colliding with `de`/`hello` is not excluding the field but the locale being folded into `keyFingerprint`. Excluding localised fields would leave a fully localised type — a perfectly normal shape — with no key at all, and then every import would duplicate every row.

`keyFingerprint` is encoded **through JSON rather than joined with a separator**, because the parts are user content: whichever separator you pick, a slug may contain it. Here `["post","en","slug","a b"]` and `["post","en","slug a","b"]` are different strings, whereas joining on a space or a colon would collapse them and quietly link two unrelated entries. A field with no usable value is **omitted** rather than written as an empty string — that is how `isCompleteKey` tells “this entry has no key” from “this entry's key is the empty string”.

## 07. The lifecycle of a transfer

### Export — a single pass

**selection** → **preflight** → **graph walk** → **serialisation** → **audit** → **streamed into the response**

The preflight is **the very same walk** with the entries thrown away. That matters: a preflight computed some cheaper way would sooner or later diverge from what it predicts, and it is the preflight people believe before clicking.

### Import — one pipeline, run twice

**file chosen** → **dry run** → **per-entry verdicts** → **apply** ⤳ error ⤳ **transaction rollback + blob deletion**

The dry run and the apply are **the same code with one flag flipped**: `dryRun`. A separately computed preview would one day promise something the apply did differently — and the preview is precisely the thing people trust before they click.

### Inside the apply — two passes

1. **Context first.** The entries are sorted by descending depth: `$depth: 1` first, then `$depth: 0`. A depth-1 entry is what a depth-0 entry points at, so most references will already resolve on the first pass. For a required relation on a non-publishable type that is critical: a `null` in the foreign key would be rejected there and then.
2. **Values first, references second.** The entries are written without relations, and then the relations are set once every row exists. That costs a second pass and buys correctness on shapes topological sorting cannot handle _at all_: a cycle (`post.related → post`) and a mutually referencing pair. A side effect that matters just as much is that the document's internal order stops mattering.
3. **The second pass does not start from an empty bag.** `toColumns` writes a field missing from the bag as `null` — a save replaces the document wholesale — so a second update carrying only the relation fields would blank every scalar the first pass had just written. In `linkPass`, the **exact value bag** that was written is carried alongside the target row.
4. **There will be no needless update.** If `sameLink` says the relations have not changed since the first write, the second `UPDATE` is not made: it would cost not just a query but a **second revision** — and then every imported entry would carry two history marks for one import. The comparison is positional, not set-based: on a “many” relation the owner's order is the order.

> **The transaction boundary and what does not fit inside it**
>
> The entire apply runs in **one transaction** (`UnitOfWork.run`): a failure halfway leaves nothing behind, because a half-imported graph is worse than an unimported one — nobody can say which half is real.
>
> **Blobs are not in the transaction.** The rows roll back, the bytes in storage do not. So every asset created during a run is remembered, and a failed run deletes them. The bookkeeping is **per-run and owned by the caller** (`ImportMediaRun`): put it on a singleton service and two concurrent imports would roll back each other's files.

### The import dialog's states

| State            | What is visible                                                      | What is available                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| no file chosen   | The file field, a link to the CSV template, the two policy questions | “Check file” is disabled                                                                                                                                                              |
| file chosen      | The same                                                             | “Check file” is enabled                                                                                                                                                               |
| checking         | A spinner + “Checking…”                                              | The button is locked                                                                                                                                                                  |
| verdict received | The count summary, the file summary, the verdict table               | “Choose another file” and “Import”; the latter is disabled when `hasChanges` is false                                                                                                 |
| error            | An alert with the server's message, where it is fit to show          | The file or a policy can be changed                                                                                                                                                   |
| verdict stale    | The table is **removed**                                             | Changing the file _or either_ of the two policies clears the preview — showing one file's verdicts above an “Import” button for another would be this dialog's worst possible mistake |

## 08. Scenarios — how it works, step by step

### 8.1 Exporting from the entry editor

The “Export…” item lives in the Extras section of the same ⋯ menu where i18n keeps “Publish all locales”: an action on an entry that is already open, next to other actions of the same kind.

1. **A slot hook decides whether to show the item.** `useExportEntryAction` returns `null` when the `content:export` permission is absent, or when this is the create form — there is no saved entry yet, so there is nothing to export.
   _this is how a slot contribution hides itself without skipping the call to its own hook_
2. **The overlay is returned even when the item is hidden.** The dialog is rendered outside the menu's content: the ⋯ menu's content unmounts at precisely the moment the menu closes — which is precisely when the dialog must appear. For the same reason an already-open dialog survives the entry being saved (the create → edit transition flips `isCreate`).
3. **The dialog opens with the ZIP format and the default depth.** `relations`, `media` and `locales` on, `relationLocales` off.
4. **Every toggle re-requests the preflight.** `POST /api/content/:type/export/preview` with the same triple (ids, format, depth). The cache key holds the **sorted** id list, so the same selection made by clicking in a different order is one cache entry rather than two.
   _staleTime: Short — flipping a checkbox back and forth must not re-run the graph walk_
5. **The effective depth is computed on the client, but from the same capability table.** A format that cannot carry bytes makes `media` false and disables the checkbox; `relationLocales` only means anything while `relations` is on, so it is disabled along with it.
6. **The counts are announced politely.** The line under the toggles is marked `aria-live="polite"`: a screen-reader user choosing options must get the same feedback a sighted one gets from looking at the numbers. The phrasing depends on `carriesFileBytes`: “9 files · 12.4 MB” or “9 files (listed, not included)”.
7. **Pressing “Export” sends a `POST` with `responseType: 'blob'`.** The download goes through a blob rather than a URL navigation, because the route is a `POST` carrying the selection and the depth options: a URL you could navigate to simply does not exist.
8. **The object URL is revoked right after the click is dispatched.** Leaving it alive means holding the whole file in memory for the life of the tab; for an export with media that is exactly the memory not to hold.
9. **The toast reads `X-Transfer-Records`.** The number is useful to a script that never opens the file, too.

### 8.2 The graph walk — what the server does

`EntryGraphWalker.walk`. This is the one place the depth rule lives.

1. **The roots.** `writer.loadLiveByIds(type, ids, workspaceId)` — the live rows of that type in that workspace. An id naming somebody else's row is simply absent from the result, so a forged request pulls no data across the boundary.
2. **The locale twins, if asked for.** The roots' `locale_group_id`s are collected and every row of those groups is fetched. Note _what_ is being read: an envelope column content defines itself for any type with `i18n: true`. Transfer never learns what a locale _means_ — hence no dependency on the i18n plugin.
3. **Rows become depth-0 entries.** Two sets are collected along the way: the neighbours (by type) and the asset ids. That is exactly why the relation reads below are batched by type rather than issued per entry.
4. **A reference is created “pending”.** `pendingRef` returns `{ $type, $id, $key: {} }` and remembers the neighbour. The `$key` is filled in later, once every row is known.
5. **Neighbours are fetched — each exactly once.** Already-visited nodes are dropped by the `visited` set, keyed on `type id`. A type absent from the registry is skipped silently.
6. **Depth-1 entries are built by the same code.** Their own neighbours (that is, depth 2) are **put into the same neighbour map** — not to be exported, but so their keys can be taken later.
7. **The entry ceiling is checked.** Exceeding `maxEntries` is a `TransferLimitError` suggesting a narrower selection or turning related entries off.
8. **Every reference's key is filled in.** First for free — from the entries already exported, indexed by `type:id` (two entries may point at one neighbour, so it is indexed once and read, rather than resolved per reference). What remains — those depth-2 neighbours — is read by a **projection over the identity columns alone**, plus `locale` for a localised type.
   _the projection uses PgColumn rather than AnyColumn: Drizzle's select builder accepts only the narrower type_
9. **The assets are read, if bytes were asked for.** The count ceiling first (`maxAssets`), then the media resolver — a **workspace-scoped lookup** — then, row by row, the size, checksum and storage key from the media plugin's own table. The bytes accumulate and are checked against `maxBytes` on every asset.
10. **Size and checksum are read around the `MediaAssetResolver` port.** That port exists so content can _validate_ a media field without knowing what a media plugin is; widening it with a storage key would push storage concerns into every implementation of it.
11. **The totals are computed.** `roots` is the depth-0 entries, `related` everything else, plus `assets` and `assetBytes`.

### 8.3 Assembling the file and the archive

1. **The document is assembled.** The manifest plus the entries. `identity` comes from `catalog.identityMap()` — from the **one** place identity is decided.
2. **The serializer turns the document into a list of files.** A list, not a file: a format is entitled to be several files (a CSV per type; a manifest plus entry files in an archive).
3. **One text member and no bytes — streamed straight out.** There is no reason to wrap a single file in an archive nobody asked for.
4. **Everything else is an archive.** The members are yielded **lazily**, by an async generator: an asset's stream from storage is opened only once the writer has reached it, so a thousand-file export never holds a thousand open reads.
5. **A missing object is a hole in the archive, not a failed export.** The entry still names the asset, and the import will report the missing file. Refusing the whole download over one purged blob is the worse bargain.
6. **The file name inside the archive is sanitised.** The asset id already serves as the directory, so `safeFileName` only keeps the name to one path segment: a slash or a `..` in a stored name must not become structure. Truncated to 180 characters.
7. **The ZIP is written as a stream, with data descriptors.** A local header has to carry a CRC and sizes that are unknown until the bytes have gone past; general-purpose bit 3 says “the sizes follow the data”, so the header is written as zeros and the descriptor is appended afterwards. Bit 11 marks the name as UTF-8 — a file named in any language survives the trip.
8. **CRC-32 (IEEE 802.3) is computed incrementally.** The table is built lazily: importing the module costs nothing until a transfer actually runs. The polynomial is the reversed `0xedb88320`.
9. **Assets are stored, not compressed.** Images, video and PDFs are already compressed — deflate costs CPU and buys a percent or two, and `deflateRawSync` on a 100 MB file would defeat the whole point of streaming. Text members are deflated: they are small, are in memory anyway, and compress by an order of magnitude.
10. **The timestamp in the archive is fixed** (1980-01-01, the earliest DOS can express). Taking “now” would make two exports of identical content differ byte for byte, which breaks archive comparison in a test and makes any future caching pointless.
11. **The audit event is written _before_ the first byte leaves.** A download aborted halfway still took data out; recording only completed transfers would leave the most interesting case — the one that broke off — with no trace at all.
12. **The response headers.** `Content-Type`, `Content-Disposition: attachment; filename="<type>-<YYYYMMDD-HHmmss>.<ext>"`, `X-Transfer-Records` and `X-Content-Type-Options: nosniff` — nothing downstream should sniff this into something executable.

### 8.4 Import, step one: reading the uploaded file

This is the boundary. Above it everything is a `TransferDocument` the codebase understands; below it are bytes a stranger chose.

1. **Multer is bounded by the same number as the reader.** `MulterModule.register({ limits: { fileSize: maxUploadBytes } })`: if multer refused at one size while the reader checked another, one of the two numbers would be decoration.
2. **Size and emptiness are checked before anything else.** A file larger than `maxUploadBytes` or of zero length is a `400` with a phrase naming the number.
3. **An archive is decided by the _bytes_, not the name.** `looksLikeZip` runs before anything else, so a `.json` starting with the ZIP signature is an archive — which is the case the rule exists for, since that is how a bomb arrives wearing a harmless extension. Among the three _text_ formats the extension is authoritative and the bytes are only the fallback for a name that matches none — the sniff two steps below: a JSON document named `.csv` is parsed as CSV and fails. **The request declares no format at all** — `ImportRequestDto` carries only `policy` and `relations`, so there is no client claim here for the reader to weigh.
4. **A non-archive is decoded as UTF-8 strictly.** `Buffer.toString('utf8')` never throws — it substitutes U+FFFD — so invalid bytes would arrive as replacement characters quietly written into the content. The presence of the replacement character `U+FFFD` is a rejection asking for a re-save in UTF-8.
5. **If the format was not guessed from the name, the first non-whitespace character is sniffed.** A `{` with a first line ending in `}` is NDJSON; a bare `{` is JSON; anything else is CSV.
6. **An archive: the central directory first.** That is the archive's own index and carries every member's declared sizes — so the member count, each size, the total size and the compression ratio are checked **before anything is decompressed**. A reader that walks the local headers learns the size only after paying for it; that is exactly what a zip bomb exploits.
7. **ZIP64 is unsupported, and it says so out loud.** An archive that large is past `maxArchiveTotalBytes` anyway; half-support would be worse than a refusal.
8. **Paths are parsed before everything else.** A null byte, an absolute path, a drive letter, a `..` segment — refused. **Refused, not sanitised**: `../../etc/passwd` sanitised down to `etc/passwd` is still a path the author chose, not one we did.
9. **The compression ratio is a signal that arrives before the bytes.** A total ceiling alone is not enough: the whole trick of a bomb is that the compressed file is small enough to sail past the upload limit. The check only engages above 1 kB of compressed data, below which the ratio means nothing.
10. **Decompression is member by member, with a hard output ceiling.** The declared size is a claim; `maxOutputLength` makes it a limit. Any method other than `store` and `deflate` is a refusal.
11. **Only the members the archive format defines are read as text:** `manifest.json`, `*.ndjson`, `*.csv`, `*.json`. An archive somebody dropped a README into still imports. Everything under `assets/` goes into the byte map.
12. **A ZIP with CSVs inside is read as CSV.** That is exactly what a multi-type CSV export produces, so that is how it must come back.
13. **The manifest version is checked in one place.** The archive parser feeds the manifest as a synthetic line into the shared NDJSON reader — so this file does not grow a second copy of the version check that could drift.
14. **Nothing in the file names a workspace.** The manifest carries the source workspace, and the importer **does not read it**: the request's workspace is stamped onto every entry.

### 8.5 Import, step two: matching entries against existing ones

`matchAll`. Two queries per type, not two per entry: a file can carry thousands of rows, and a query each would be the classic N+1.

1. **Road one — the source row id.** Every `$id` that **passes a uuid shape check** is collected, and one query asks which of them still name a live row of that type in that workspace.
   _the shape check is mandatory: a person can type anything into a CSV's $id column, and passing that into a uuid comparison is a Postgres syntax error and a 500_
2. **Road two — the natural key.** The fields come from the **manifest** (`identityFor`) rather than being re-derived. Deriving locally on one side and reading the manifest on the other is exactly how an existing entry gets created afresh anyway: the two sides compute the fingerprint over different fields, the map never hits, and every match quietly degrades into a create.
3. **A key naming a dropped field matches nothing** — and that is better than an exception: `usable` filters out fields the table does not have, and if even one is missing, the type is skipped.
4. **The candidate set is narrowed by the first key column's values.** A large collection is not read whole for the sake of a twenty-row file.
5. **A candidate row is fingerprinted exactly as the incoming entry is** — including the locale, which is fetched by a projection for that purpose. The first match wins; repeated fingerprints are ignored.
6. **The order of the roads in `run`: key first, id second.** The key is an identity that means something on another installation. The id is a fallback that fires only when a file returns to the database it left; there it is a fact rather than a guess.

> **Why the row-id fallback is needed at all**
>
> It is the only thing that can link (rather than copy) a type with **no derivable identity field**: a category with a single optional `name` resolves zero fields. Without that road, every import of such a type would add one more copy of every row. It is for its sake that `matchAll` makes a second, cheap query per type.

### 8.6 Import, step three: the decision, under two policies

There are **two** policies, and which one governs an entry depends only on its depth: an entry the caller selected is governed by `ConflictPolicy`; an entry that came along because something pointed at it, by `RelationPolicy`. Separating them is essential: duplicating an article is a reasonable request, duplicating its author because the article was duplicated is not.

| Policy                   | Value          | No match                                             | A match                             | The verdict on a match    |
| ------------------------ | -------------- | ---------------------------------------------------- | ----------------------------------- | ------------------------- |
| **Conflicts**<br>depth 0 | skip `default` | create · `new`                                       | Leave the existing one untouched    | skip · `conflict-skipped` |
| update                   | create · `new` | Overwrite the existing row's values                  | update · `matched`                  |                           |
| duplicate                | create · `new` | Create a second row despite the match                | create · `conflict-duplicated`      |                           |
| fail                     | create · `new` | Fail the whole run on the very first match           | error · `matched`                   |                           |
| **Relations**<br>depth 1 | link `default` | create · `new` — otherwise the relation would dangle | Match and link, **writing nothing** | skip · `relation-linked`  |
| update                   | create · `new` | Match, link and overwrite the values                 | update · `matched`                  |                           |
| recreate                 | create · `new` | Never match: a new row for every related entry       | create · `relation-recreated`       |                           |

Note the first results column: **no match means a create under every policy**, `recreate` and `fail` included. A related entry with nothing to link to has no choice — otherwise the very relation that put it in the file would dangle. The reason differs, though: `new` when the type has a key, and `no-identity` when no identity field was found.

> **Why link is a “skip” with a different reason**
>
> The action is the same as a conflict `skip`: nothing is written to the row. But it is reported under its own code, `relation-linked`, because it is **not a conflict**: the entry exists, a relation will point at it, and that is the whole design. The user sees “Already here — your entries will link to it”, not “Already here — left unchanged”.

1. **A skipped entry is still recorded in the id map.** A skipped entry is a row that _exists_, so other entries' references to it must resolve.
2. **Permissions are checked after the decision and before the write.** If a `create` or an `update` is needed, the corresponding flag is consulted; absent, the verdict is `error` · `forbidden`, and on to the next entry.
3. **The dry run stops here.** The verdict is recorded, the counter incremented, the match (if any) remembered — the _key_ is enough for the unresolved-reference report to be accurate. A dry run has no new row to point at.
4. **The real write: a create or an update.** The compiler cannot see that an `update` is returned only on a match, so the code reads the match once and falls through to a create rather than discarding the check with an assertion.
5. **The locale group is assembled as it goes.** The group's first twin creates it and the rest join what it made: the `sourceGroup → targetGroup` map lives for one run. The locale and the group id are simply passed to `EntryWriterService`, and the attached i18n extension validates them.
6. **A refusal from the writer does not sink the run.** It becomes an `error` · `validation-failed` verdict, with the **unpacked** per-field messages put into `issues`. The exception's own summary — “Entry validation failed” — is the least useful phrase you can give a reader about a rejected entry: it says something is wrong and names nothing.

### 8.7 Import: what happens to media files

1. **First, what has already been seen in this run.** `TransferAssetMap` resolves by source id, and failing that by checksum.
2. **Then deduplication by `sha256` within the workspace.** Identical bytes are the same asset, whatever the file is called. An import that re-uploaded every byte would duplicate the media library on the second run of the same file, and teams shuttle imports around constantly.
   _the lookup must be workspace-scoped: matching on the checksum alone would tie workspace A's entry to workspace B's asset — identical files (a shared logo, stock imagery) turn up all the time_
3. **Only when nothing matched do the bytes travel.** They are taken from the archive-member map by `ref.path`. No path or no bytes is expected in a format-less file: the entry still names an asset that exists only at the source.
4. **The upload goes through the media plugin's `UploadAssetUseCase`, not through a row insert.** The MIME type declared in the archive is not taken on trust: the media plugin's own upload path re-derives the asset kind and applies its own rules.
5. **Without an actor no asset is created.** `uploaded_by` in media is `NOT NULL`, and an import made with an API token has no session user; rather than inventing one, the asset is declared missing and the rest is imported.
6. **Every asset created during a run goes into `run.uploaded`.** If the transaction fails they are deleted — otherwise a rolled-back import leaves bytes in the bucket that nothing references and nobody will ever collect. The cleanup is best-effort and deliberately silent about individual failures: the import has already failed, and turning a cleanup problem into the error the user sees would hide the real one.
7. **An asset that did not resolve simply does not enter the field's value.** Writing an id that names nothing would be worse.

### 8.8 Import: the second pass and refreshing the admin UI

1. **The relation pass is an ordinary `update` through the same writer.** Which means through the same target checks and the same one-locale rule as any other save.
2. **A reference that did not resolve is dropped from the payload and reported in the verdict.** Refusing an entry over one missing neighbour would sink an entire import over one relation.
3. **A dry run reports this separately.** Nothing was written, so a reference is resolvable only if its target already exists or is itself in the document; both facts are known.
4. **The response.** `{ version, counts, verdicts, hasChanges }`. A run of nothing but skips is not an error, but offering an “Import” button for it would be a lie, so `hasChanges` is false and the button is disabled.
5. **The apply's audit.** A `transfer.content.imported` event with the workspace and the counts, the actor attached by `attachActor`.
6. **The admin UI refreshes the cache of every type touched.** The verdicts name them explicitly, so the set is exact rather than guessed: a run that created an article _and_ the author it points at must refresh both lists.
7. **The refresh goes through `refreshEntryCaches` from `@orthacms/content-admin`, not through a key written here.** It used to invalidate `['content']`, which matches **nothing**: the library's roots are `content-entries` / `content-entry`, TanStack compares whole segments, and `'content' !== 'content-entries'`. The import went through, the toast confirmed it, and the table did not move.
8. **The type that was imported into is always added** — even a run in which every entry errored leaves the list worth re-reading. Plus an invalidation of `['media']` by prefix: an archive import uploads assets.

### 8.9 The round trip: export, move, import

1. **An article and its author are exported to a ZIP** with relations, files and locales on. In the document: the article (`$depth: 0`) and its locale twins, the author (`$depth: 1`), references with `$key` filled in, the cover in `assets/<id>/…`, and a manifest carrying the identity fields.
2. **The file travels to another installation** and is uploaded through the “Import…” of the collection it is being put into.
3. **The dry run.** The author is looked up by `email` (or by whatever the configuration named); if they are already there, the verdict is `skip` · `relation-linked`. The article is looked up by `slug`; there is none, so `create` · `new`.
4. **The apply, in depth order.** The author first (depth 1) — under `link` nothing is written to them, but the map remembers the target row. Then the article: the cover resolves by checksum or is uploaded, the values are written, and the reference to the author is already resolvable on the **first** write.
5. **The second, relation pass usually does nothing** — `sameLink` sees the relations have not changed, so there is no needless `UPDATE` and no needless revision.
6. **Running the same file again breaks nothing.** Under the default policies (`skip` + `link`) the second run yields zeros in create/update, `hasChanges` is false, and the dialog says honestly “Nothing in this file will change anything here”.

### 8.10 The translator's CSV loop

1. **Select entries → “Export” → CSV.** The dialog says up front: rich text will become plain, references a list of keys, files just names. If there is more than one type, it also says a ZIP will be downloaded.
2. **The first import need not be guesswork.** The import dialog has a “Download an empty CSV with the right columns” link — `GET /api/content/:type/import/template`: one header row. That removes the worst part of a first import — guessing the column names, getting one wrong and having the file rejected.
3. **The text column is edited** in the usual spreadsheet editor.
4. **Bringing it back.** The type is taken from the file name, and if no such type exists, from the collection whose button was pressed. A file named after something the installation does not have is rejected **by name**, not guessed into somebody else's table.
5. **A row of nothing but empty cells is skipped** — that is what a spreadsheet's trailing empty row looks like, and an import would create an empty entry from it on every lap.
6. **Matching and writing.** The `$id` from the envelope column gives the second matching road when the file returns to the same database; on another installation the `slug` does the work. The media column is ignored, and the entry's existing media is left alone.

## 09. HTTP API

Every path carries the global `/api` prefix the host sets. All five routes sit on one controller prefix, `content`, and carry a shared class-level guard stack: `OriginGuard`, `PermissionsGuard`, `WorkspaceGuard`, `ContentGrantGuard` — on top of the global `AuthGuard`. Legend: `session` — a valid session is required, `permission` — a session plus the named permission.

| Method and path                        | Access           | Input                                                  | Success                                                                                              | Failures                                                                                                                                                                  |
| -------------------------------------- | ---------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST /content/:typeName/export/preview | `content:export` | `{ ids[], format, depth? }`                            | `200 { roots, related, assets, assetBytes, carriesFileBytes }`                                       | `400` invalid DTO; `403` no permission or a foreign Origin; `404` unknown type **or** one not granted to the workspace                                                    |
| POST /content/:typeName/export         | `content:export` | `{ ids[], format, depth? }`                            | `200` a file stream + `Content-Disposition`, `X-Transfer-Records`, `X-Content-Type-Options: nosniff` | the same; exceeding a ceiling — see the warning below                                                                                                                     |
| POST /content/:typeName/import/preview | `content:import` | `multipart/form-data`: `file`, `policy?`, `relations?` | `200 { version, counts, verdicts[], hasChanges }`, **no writes**                                     | `400` no file, empty, too large, not UTF-8, unparseable, a format version above the supported one, an unknown CSV column, an archive that failed its checks; `403`; `404` |
| POST /content/:typeName/import         | `content:import` | the same                                               | `200 { counts, verdicts[] }`, all in one transaction                                                 | the same, plus a `fail`-policy refusal arriving as verdicts rather than as a status                                                                                       |
| GET /content/:typeName/import/template | `content:read`   | —                                                      | `200` a CSV of one header row, `<type>-template.csv`                                                 | `404` unknown or ungranted type; **see the workspace-header warning**                                                                                                     |

> **The workspace header and the template link**
>
> `WorkspaceGuard` reads `X-Workspace-Id` and answers `400` when it is absent. The template route sits under the same class-level stack, but in the import dialog it is opened by an **ordinary link**, `<a href="/api/content/<type>/import/template">` — and a browser navigation cannot send an arbitrary header. So as things stand, the “Download an empty CSV with the right columns” link leads to `400 Missing or malformed X-Workspace-Id header`. Scenario 8.10 describes the intended behaviour; the actual one is recorded in section 16.

### Validating the export body

- **`ids` is required and non-empty.** Not “empty means everything”: “export the whole collection” is a real request, but it has to be expressed by selecting the whole collection in an interface that shows the count. An empty body quietly meaning “everything” is a shape that produces accidental whole-library dumps.
- **The selection ceiling is 1000 ids** (`MAX_EXPORT_IDS`), each of which must be a uuid v4.
- **`format` is required** and checked against `TRANSFER_FORMATS`.
- **`depth` is optional**, a nested object of four boolean flags, validated through `@ValidateNested`. Missing keys are merged up from `DEFAULT_DEPTH`.
- Any extra field is rejected by the global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`) before the controller.

### Validating the import body

The body is multipart, so every field arrives as a string; there is no `@IsBoolean()` on anything here. There are two genuine settings: `policy` (a value from `CONFLICT_POLICIES`, default `skip`) and `relations` (a value from `RELATION_POLICIES`, default `link`). Both optional.

> **How the import's response reads**
>
> One **verdict per entry**: `{ $type, $id, label, locale?, action, reason, targetId?, unresolved?, issues? }`. `action` is one of `create`/`update`/`skip`/`error`; `reason` is a **stable code, not a phrase**: the wording and its translations belong to the admin UI, the fact belongs to the server. `label` is what an editor would call the entry: the first key value, failing that the first non-empty text field, failing that the source id.

## 10. The admin UI: where it lives and how it behaves

The package **adds no routes**. Everything it does is an action on content the person is already looking at, so it lives in the Content Library's seams. Register it **after** `contentAdminPlugin()`, which declares those seams.

| Slot                     | Contribution                                                   | Id                        | When it is hidden                                                  |
| ------------------------ | -------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| ENTRY_MENU_SLOT          | **Export…** in the editor's ⋯ menu, the Extras group, order 30 | transfer.export.entry     | No `content:export`; the create form (there is no saved entry yet) |
| RECORDS_BULK_ACTION_SLOT | **Export** in the selection bar, order 10                      | transfer.export.selection | No `content:export`; the trash view; an empty selection            |
| RECORDS_MENU_SLOT        | **Import…** in the collection's ⋯ menu, order 10               | transfer.import           | No `content:import`; the trash view                                |

### Why import belongs to the collection, not to the selection

When importing, **nothing is selected**: what arrives is what is in the file — so the selection bar would be a category error. And it does not deserve its own toolbar button next to search and filters: importing is a rare operation, while search, columns and filters are used every single visit, and giving away their width for it would be wrong.

### Three places where it is easy to trip over unmounting

- **The overlay is rendered outside the menu's content.** The ⋯ menu's content unmounts at precisely the moment the menu closes — which is precisely when the dialog must appear.
- **The selection bar dies with the selection.** So `onDone` is called **after a successful download** rather than when the dialog opens: clearing the selection on open would unmount the bar, and the dialog with it.
- **The overlay is returned even when the item is hidden.** An already-open dialog survives a switch to the trash and a save of the entry, instead of vanishing mid-interaction.

### The export dialog

- The heading is pluralised: “Export N entries”. The description states the rule immediately: “The selected entries are exported plus one hop of what they reference. Their own references are preserved as relations rather than copied”.
- A format selector, and under it a loss warning (only when the format is not lossless) plus a separate line about the ZIP for CSV.
- Four toggles, each with a hint caption tied in via `aria-describedby`. The disabled files toggle is **honesty**: a format that cannot carry bytes must not accept a flag and ignore it.
- A live counts line with `aria-live="polite"`. Three states: “Counting…”, the numbers, and “Could not compute the size. The export may still work”.
- A preflight error does **not block** the export button — it only reports.

### The import dialog

- **Two questions, not one**, both of the same shape — a radio group with a caption under each option, so the reader can see these are two different answers. “If an entry is already here” governs the entries in the file; “Entries the file references” governs the ones they point at.
- The conflict question has an explanatory line about _what counts as “already here”_: a match on a key field like a slug or an e-mail, or “this is the very entry the file was exported from”.
- **The height is bounded by the dialog itself.** `DialogContent` sets no height and centres itself fixed, so a long dialog — two explained questions plus the verdict table — runs off both edges of a laptop screen, taking the “Import” button with it. Here: three grid rows (header, body, footer) with scrolling on the **body only**.
- **Three different spacings inside a group** — deliberately: the hint sits tight under the legend (they are one header), the options are pushed away from the header, and the options are separated from one another. Otherwise the group reads as a list of five equal lines.
- **A wide gap between the blocks** (gap-8): at the groups' own rhythm, seven options under two headings would read as one list.
- An error is shown by `Alert variant="destructive"` and takes the server's message when it is a string.

### The verdict table

- **Sorted problems first**, then skips, then updates and creates. A reader of this table is looking for what will go wrong, not for confirmation that most things are fine. Within a group the order is stable — the file's own order shows through.
- **The first 100 rows are shown.** A five-thousand-entry file would otherwise render five thousand table rows into a dialog — slow and unreadable at once. The totals above the table are the summary; the list itself is there to show the run's shape and the problems in it. Under the table: a “Showing the first N of M” line.
- **State is carried by shape, not by words alone**: each action has its own `Badge` variant (create — `default`, update — `secondary`, skip — `outline`, problem — `destructive`).
- Unresolved references get their own line: “Relations not found: … They will stay empty, everything else imports anyway”. Validation messages get their own line, in red.
- A row's locale is shown as a small uppercase marker next to the entry's name.

> **Cache keys**
>
> The plugin has one key of its own — `transferKeys.exportPreview(type, format, ids, depth)`, with the ids **sorted**. Everything else is refreshed after an import by somebody else's hands: `refreshEntryCaches` from `content-admin` for each type touched, and the `['media']` prefix for the media library.

## 11. Configuration

The plugin is assembled at the composition root: `TransferPlugin(config.plugins.transfer)`, **after** `ContentPlugin` (whose registry and writer it uses) and, if files are to travel, after `MediaServerPlugin`. It works without media too: media fields travel as references, and the import reports them as missing rather than refusing to come up.

In the admin UI: `transferAdminPlugin()`, **after** `contentAdminPlugin()`.

### Two settings, and both matter

| Key      | Type                                 | What it decides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| identity | Record\<string, readonly string\[\]> | Which fields identify an entry of each type. **The setting worth filling in.** Everything an import does rests on being able to say “this incoming entry is that existing row”, and the derived fallback is a heuristic. A catalogue keyed on `sku` and a member list keyed on `email` should say so here rather than hope the heuristic agrees. A type left without a key falls back to the derived choice, which is reported in every export's manifest — so what the import matched on is never a secret |
| limits   | Partial\<TransferLimits>             | The ceilings of a single transfer. Omitted keys keep the shipped values                                                                                                                                                                                                                                                                                                                                                                                                                                     |

The configuration is validated **eagerly**, the same way `ContentPlugin` and `I18nServerPlugin` do it: an empty field list for a type, or an empty string inside a list, is an exception at startup. An identity list that names no fields is the configuration error that would otherwise surface as “every import creates duplicates”, months later and nowhere near its cause.

### The ceilings

Export and import need bounds for opposite reasons. Export is bounded so a careless filter cannot ask one request to stream the whole library into memory; import is bounded because the file is **untrusted** — a small archive can describe an enormous one, and parsing without a ceiling is the bug that turns a compressed file into an outage.

| Key                  | Default | Side   | What it bounds                                                                                |
| -------------------- | ------- | ------ | --------------------------------------------------------------------------------------------- |
| maxEntries           | 5,000   | export | Entries an export can reach, roots and related together                                       |
| maxAssets            | 2,000   | export | Distinct assets in one export                                                                 |
| maxBytes             | 512 MiB | export | Total file bytes in one export                                                                |
| maxImportRecords     | 5,000   | import | Entries an import will read out of a document                                                 |
| maxColumns           | 200     | import | Columns in one flat row                                                                       |
| maxUploadBytes       | 256 MiB | import | The uploaded file's bytes **before** decompression; multer is configured with the same number |
| maxArchiveEntries    | 10,000  | import | Members in an uploaded archive                                                                |
| maxArchiveEntryBytes | 128 MiB | import | What one member may decompress to; zlib's `maxOutputLength` is bounded by the same number     |
| maxArchiveTotalBytes | 1 GiB   | import | What the whole archive may decompress to                                                      |
| maxCompressionRatio  | 200     | import | The highest tolerated decompressed-to-compressed ratio across the archive                     |

Separately, outside `TransferLimits`: `MAX_EXPORT_IDS = 1000`, the selection ceiling in the export DTO, and `MAX_ROWS = 100`, the row ceiling of the verdict table in the admin UI.

> **How these should be turned**
>
> `maxEntries` and `maxBytes` are raised for a deliberate bulk migration. The import archive ceilings are a **security boundary, not a capacity setting**: lowering them costs nothing, raising them must be deliberate. The template `create-ortha-app` lays down registers no content types, so there `identity: {}` and `limits: {}`.

### DI tokens

- `TRANSFER_CONFIG` — the validated configuration, `@InjectTransferConfig()`.
- `TRANSFER_LIMITS` — the **already merged** limits, `@InjectTransferLimits()`: a consumer does not merge the defaults in a second time.

The module is **not global and exports nothing** — nothing in the system calls into transfer. Everything it needs comes from the other direction: content's registry and writer, media's storage and upload path, identity's permissions — from modules that are already global.

## 12. Security: what was done and why exactly that way

### The three boundaries that meet here

#### The workspace boundary

Every read and every write carries the request's `workspaceId`. `WorkspaceGuard` checks membership, the media resolver is workspace-scoped, checksum dedup is workspace-scoped, and the manifest's source is not read at all.

#### The content-grant boundary

`ContentGrantGuard` refuses a type not granted to this workspace with **the same `404`** as an unknown type. Without it the export route would be a way to read past the workspace's content surface — and worse than on a list endpoint, because the data leaves with you.

#### The untrusted-bytes boundary

The ZIP reader is the one place in the plugin that receives bytes nobody here wrote. The order of the checks _is_ the defence.

### Why the archive is hand-rolled rather than taken from npm

Because reading an untrusted archive is exactly that point, and the order of checks in it matters more than a library's convenience: the central directory is read first, so the member count, each size, the total size and the compression ratio are rejected **before** anything is decompressed. And because memory behaviour is the whole point of the writer: an export can be hundreds of megabytes of media, so nothing is held whole.

| Attack / case                               | What happens                                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A zip bomb                                  | Refused on `maxCompressionRatio` while still reading the directory, before decompression; plus the member and total ceilings |
| A header that lies about the size           | `inflateRawSync`'s `maxOutputLength` makes the declared size a limit rather than a promise                                   |
| A `../` or absolute path                    | **Refused, not sanitised.** A sanitised path is a guess about what the author meant, and the author here is untrusted        |
| A null byte in a name                       | Refused                                                                                                                      |
| ZIP64                                       | An explicit refusal with an explanation, rather than half-support                                                            |
| An unsupported compression method           | Refused, naming the member                                                                                                   |
| A file that is not UTF-8                    | Refused, rather than quietly writing replacement characters into the content                                                 |
| A manifest from a future format version     | Refused with an exact statement of the file's version and the one this installation reads                                    |
| A manifest naming somebody else's workspace | Ignored. The request's workspace is stamped — this is a way to mislabel your own export, not to cross a tenant boundary      |
| A CSV `$id` that is not a uuid              | A shape check before the query; otherwise it is a Postgres syntax error and a `500`                                          |
| A reference to another workspace's asset    | The resolver simply does not return it — the bytes will not cross the boundary                                               |
| An import under permissions that are absent | A `forbidden` verdict per entry; `content:import` does not stand in for `content:create`/`content:update`                    |
| Exporting soft-deleted entries              | They are not read (`deletedAt IS NULL`), and the button is hidden in the trash                                               |
| CSRF on the write routes                    | `OriginGuard` on both controllers' class-level stack                                                                         |
| Content-type sniffing on a download         | `X-Content-Type-Options: nosniff` on both the export and the template                                                        |

### What gets recorded

Two events in the shared transactional outbox, `aggregateType: 'transfer.content'`, with the type's name as the `aggregateId`:

- `transfer.content.exported` — the workspace, the format, the number selected, plus all four walk counters. Written **before** the first byte.
- `transfer.content.imported` — the workspace and the result counters. Written after the apply.

An export is a read, and a read that raises an audit event is unusual enough to explain: it is the one operation that carries a workspace's content **out** in bulk, files included. Who did it, when, and how much left is exactly the question an operator asks after the fact, and it cannot be reconstructed from the content tables: nothing changed there. The actor is attached through `attachActor`; with no session user the event is written without one.

> **A known hole in the error handling**
>
> `TransferLimitError` is an ordinary `Error`, not an `HttpException`, and there is **no exception filter** in the system that maps it. So exceeding `maxEntries`, `maxAssets` or `maxBytes` hands the client a `500` rather than the `413` with a phrase naming the limit that ADR-0014 promises. The wording of those very messages is written and never reaches the user. Details in section 16.

## 13. Invariants

Statements that must always hold. This is at once a review list and a draft set of test assertions.

- **I-01** — The plugin owns no table and no migration; all it adds is two events in the shared outbox.
- **I-02** — **Every** write goes through `EntryWriterService`. There is not one direct write to a content table.
- **I-03** — The walk fetches only depths 0 and 1 in full; it does not follow outward from depth 1. Depth 2 exists in the document only as references.
- **I-04** — **Every** reference in the document carries a resolvable `$key` rather than somebody else's row `id` alone — including a reference _held by_ a depth-1 record and pointing outward at depth 2, and a reference whose target was not exported at all. The keys of targets the walk did not fetch come from a projection over their identity columns.
- **I-05** — The inverse side of a two-way relation is not exported, gets no CSV column and is not written on import. The owner's order is the order.
- **I-06** — The export preflight runs **the very same** walk as the export: the numbers in the dialog are what will arrive.
- **I-07** — The import's dry run and apply are one code path with a `dryRun` flag; the verdicts the preview showed describe what the apply will do.
- **I-08** — A dry run writes not one row and not one byte.
- **I-09** — The apply runs entirely in one transaction; blobs written by a failed run are deleted through `ImportMediaRun`, which belongs to the caller rather than to a singleton.
- **I-10** — Entries are written values first, relations second, so a cycle and a mutual reference import correctly and the document's internal order means nothing.
- **I-11** — The second pass starts from the exact value bag the first one wrote, and runs only if the relations actually changed — no second revision arises for one import.
- **I-12** — A match is sought first by natural key, then by source row id, and **both sides** of the fingerprint read `identityFor` — the manifest's copy.
- **I-13** — No match means a create under **every** one of the seven policies.
- **I-14** — Depth 0 is governed only by `ConflictPolicy` and depth 1 only by `RelationPolicy`; neither setting acts on both.
- **I-15** — `link` writes nothing to a matched related entry; only one with nothing to link to is created.
- **I-16** — A skipped entry stays in the id map so references to it resolve.
- **I-17** — A key with no fields is not indexed — otherwise it would collide with every other keyless entry of the type and link the unrelated.
- **I-18** — The locale is part of the key fingerprint; `en`/`hello` and `de`/`hello` stay two rows.
- **I-19** — The fingerprint is encoded as JSON, not joined with a separator.
- **I-20** — One document's locale twins arrive in one translation group on the receiving side.
- **I-21** — The package does not depend on `@orthacms/i18n-server`; the locale is read as an envelope column.
- **I-22** — An import never exceeds the caller's permissions: `content:create` / `content:update` are re-checked per entry.
- **I-23** — No operation crosses a workspace boundary: the request's workspace is stamped onto every write, and the manifest's `sourceWorkspaceId` is not read.
- **I-24** — A type not granted to the workspace is indistinguishable from one that does not exist — the same `404`.
- **I-25** — An archive's central directory is read first; counts, sizes and the compression ratio are rejected before decompression.
- **I-26** — A path escaping the archive root is rejected, not sanitised.
- **I-27** — A document whose format version is above `TRANSFER_FORMAT_VERSION` is rejected rather than read “as best we can”.
- **I-28** — The bytes decide whether an upload is an **archive** — the ZIP signature is tested before anything else, so a ZIP named `.json` is read as one — and they decide which text format it is when the file name names none.
- **I-29** — A non-UTF-8 file is rejected rather than imported as replacement characters.
- **I-30** — A CSV column the type does not have is a hard rejection of the file naming that column, not a quiet skip.
- **I-31** — A CSV media cell is never restored into an asset reference.
- **I-32** — An asset's bytes are uploaded only when neither the source id nor the checksum found anything **in this same workspace**.
- **I-33** — Asset bytes travel only in a ZIP; the capability table is the single source of that decision for both the server and the interface.
- **I-34** — The export event is written before the response's first byte leaves.
- **I-35** — An object missing from storage is a hole in the archive, not a failed export.
- **I-36** — Assets are stored uncompressed in the archive, text members are deflated, and the timestamp is fixed — two exports of identical content match byte for byte.
- **I-37** — The `transfer-domain` layer reads no clock and no database and imports neither NestJS, Drizzle nor React; its one dependency is `@orthacms/content-domain`.
- **I-38** — The plugin's module is not global and exports nothing: the dependency arrow points only away from transfer.
- **I-39** — An empty export selection is rejected; “empty means everything” does not exist in the API.
- **I-40** — Changing the file or either of the two policies clears the verdict table.
- **I-41** — After an import the cache of **every** type named in the verdicts is refreshed, plus the collection's type, plus the media library.

## 14. Testing checklist

Phrased as “action → expected result”. Existing coverage: `apps/server-e2e/src/server/transfer/transfer-round-trip.spec.ts` (one file, ~30 tests), plus the kernel's unit tests — `csv.spec.ts`, `flatten.spec.ts`, `keyFingerprint.spec.ts`, `natural-key.spec.ts`, `id-map.spec.ts` — and `archive.spec.ts` on the server side. The browser side is `apps/admin-e2e/src/transfer/` — `import-dialog.spec.ts` (verdict staleness, the refresh pass, the pure-skip run, a refused apply) and `export-dialog.spec.ts` (the format capability table, the live counts, a failed preflight, the selection). There is still **no a11y or keyboard suite** for either dialog.

### Export

- **Export one entry with relations** → the document holds it and its depth-1 neighbours; the references have `$key` filled in; the manifest carries `identity` and `counts`.
- **The same export with `relations: false`** → roots only; the references remain, the depth-1 entries do not.
- **Export a localised entry with `locales: true`** → each locale is its own entry, all sharing a `$localeGroup`.
- **`relationLocales` by default** → off; turning it on increases `related`.
- **A preflight and an export with the same options** → identical `roots`/`related`/`assets`/`assetBytes`.
- **The ZIP format with files** → inside are `manifest.json`, `entries/<type>.ndjson` and `assets/<id>/…`; the archive opens in a standard unzipper.
- **The CSV format for one type** → one file, the header being the envelope columns plus the schema fields, with no inverse relation sides.
- **The CSV format across several types** → a ZIP with several `<type>.csv` files is downloaded.
- **JSON and NDJSON of one set** → identical entries; NDJSON has the manifest on the first line.
- **Two ZIP exports of identical content** → byte-for-byte identical (the fixed timestamp).
- **An asset deleted from storage while its row remains** → an archive without that member, a successful export, and the entry still naming the asset.
- **An export with no media plugin registered** → media fields travel as references, and the export does not fail.
- **An asset name containing `/` or starting with dots** → inside the archive it is one safe path segment.
- **An empty `ids`** → 400.
- **1001 ids** → 400.
- **An unknown format** → 400.
- **An extra field in the body** → 400 from the `ValidationPipe`.
- **A selection exceeding `maxEntries`** → **expected** a 413 with a phrase naming the limit; **actually** a 500 — see section 16.

### Import: the basic loop

- **Export a graph, clear it out, import the same file** → the graph is restored: entries, relations, locale groups, files.
- **A dry run** → 200 with verdicts; nothing changed in the database; the counters match the subsequent apply.
- **Running the same file again on the defaults** → `create = 0`, `update = 0`, `hasChanges = false`, and no duplicates appeared.
- **A document with a cycle (A → B → A)** → both entries created, both relations set.
- **The entry order in the file shuffled** → the same result.
- **A reference to an entry that is neither in the file nor in the database** → the relation is empty, the entry is created, and the verdict carries `unresolved`.
- **An entry with a required relation on a non-publishable type** → created successfully, because depth 1 is written first.
- **An import with no file** → 400 “No file was uploaded.”
- **A zero-length file** → 400.
- **A file that is not a transfer document** → 400 with an intelligible phrase, not a stack trace.
- **A manifest with `version: 2`** → 400 naming both versions.
- **A document with a type the installation does not know** → an `error` · `unknown-type` verdict, with the other entries still processed.

### Import: the policies

- **A match + `skip`** → the row is untouched, the verdict is `skip` · `conflict-skipped`.
- **A match + `update`** → the values are overwritten, the verdict is `update` · `matched`.
- **A match + `duplicate`** → a second row appears, the verdict is `create` · `conflict-duplicated`.
- **A match + `fail`** → an `error` verdict, nothing written.
- **The related entry exists + `link`** → no second author, the article points at the existing one, the verdict is `skip` · `relation-linked`.
- **The related entry exists + `update`** → the author is updated from the file and linked.
- **The related entry exists + `recreate`** → a new author is created and the article points at them.
- **The related entry is absent + `recreate`** → it is created (otherwise the relation would dangle).
- **The `duplicate` + `link` combination** → a second copy of the article, but **one** author — the policies are independent.
- **A type with no derivable identity field, re-imported into the same database** → matched by `$id`, no duplicates.
- **The same file on another installation** → the `$id` match does not fire, and only the natural key works.
- **The `identity` configuration names a nonexistent field** → it matches nothing (not an exception); the export writes that into the manifest all the same.
- **The key matches but the locales differ** → two separate rows rather than one overwriting the other.

### Import: permissions and boundaries

- **An observer exporting** → 403.
- **An observer importing** → 403.
- **Both routes without a session** → 401.
- **A type not granted to the workspace** → 404, indistinguishable from an unknown type.
- **A role with `content:import` but without `content:create`** → every entry to be created gets an `error` · `forbidden` verdict, and nothing is written.
- **A manifest naming somebody else's workspace** → the entries went into the request's workspace.
- **A request without `X-Workspace-Id`** → 400.
- **A foreign `Origin`** → 403.
- **An unknown `policy` or `relations` value** → 400.

### The archive and untrusted bytes

- **An archive with `../` in a member name** → 400, a refusal rather than a write somewhere else.
- **An archive with an absolute path or a drive letter** → 400.
- **A null byte in a member name** → 400.
- **A highly compressed zip bomb** → 400 before decompression; the process's memory profile does not grow.
- **A header understating `uncompressedSize`** → 400 from `maxOutputLength`.
- **More members than `maxArchiveEntries`** → 400.
- **A ZIP64 archive** → 400 with an explanation and advice to export in smaller batches.
- **A compression method other than store/deflate** → 400 naming the member.
- **A truncated archive / a corrupt directory** → 400, not 500.
- **An archive with a stray README inside** → imports fine, the README ignored.
- **A `.json` starting with the ZIP signature** → read as an archive.
- **A file in CP1251** → 400 asking for a re-save in UTF-8.
- **An upload larger than `maxUploadBytes`** → refused; multer and the reader refuse at one and the same number.

### CSV

- **A type's template** → one header row, matching the export header of the same type.
- **An unknown column in the header** → 400 naming the column.
- **A trailing empty row** → no empty entry is created.
- **A value containing a comma, a quote and a line break** → an RFC 4180 round trip with no loss.
- **A slug containing `;`, `|`, `:` or `\`** → the reference token is escaped and parses back to the same value.
- **A filled-in media column** → ignored; the entry's existing media is unchanged.
- **Rich text of several paragraphs** → leaves as plain text, comes back as paragraphs; the markup is not restored, and that is expected.
- **A file named after a type that does not exist** → 400 by name, not a write into somebody else's table.

### Media

- **Importing an archive with a new file** → the asset is created through `UploadAssetUseCase`, `assetsNew = 1`.
- **Re-importing the same archive** → `assetsReused` instead of `assetsNew`, and the media library has not doubled.
- **The same file already exists in another workspace** → not reused — dedup is workspace-scoped.
- **An import that failed after uploading assets** → the rows rolled back, the uploaded assets deleted, the bucket clean.
- **Two concurrent imports** → one failing does not delete the other's files.
- **An import via API token with no session user** → no asset is created, the rest imports.
- **A reference to an asset with no bytes (the JSON format)** → the field does not receive an invented id.

### The admin UI

- **Open “Export…” from the editor's ⋯ menu** → the dialog appears and stays, even though the menu closed.
- **Export from the selection bar** → the selection clears only after a successful download, and the dialog does not vanish on open.
- **Switch the format to CSV** → the “Files” checkbox is disabled and reads as disabled; both explanatory lines appear.
- **Clear “Related entries”** → the “Languages of related entries” checkbox is disabled.
- **Move the toggles** → the counts line updates and is announced by a screen reader.
- **The preflight failed** → “Could not compute the size” is shown and the export button stays enabled.
- **Open “Import…” and change the file after checking** → the verdict table is gone.
- **Change either of the two policies after checking** → the verdict table is gone.
- **A run of nothing but skips** → the “Nothing in this file will change anything here” banner, with the “Import” button disabled.
- **A 500-entry file** → the first 100 shown, the problems at the top, and a “Showing the first 100 of 500” line under the table.
- **A long dialog on a laptop screen** → only the body scrolls, and the “Import” button is on screen.
- **An import that created an article and an author** → both lists refreshed, not just the one it was launched from.
- **Importing an archive with files** → the media library is re-read too.
- **A role without the permission** → the corresponding menu item is absent.
- **The trash view** → neither “Export” nor “Import…”.
- **The “Download an empty CSV” link** → **today** it leads to a 400 for want of `X-Workspace-Id`; a test must pin that until it is fixed.

## 15. Boundaries of responsibility

| Area                                                         | Who owns it                                     | What Transfer does                                                                                                                                                            |
| ------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The content tables, the type registry, validation, revisions | `content-server`                                | Reads through `EntriesService`/`EntryWriterService`/`RelationLinkService` and writes **only** through `EntryWriterService`                                                    |
| The database connection, transactions, the outbox            | `@orthacms/database`                            | Uses `UnitOfWork` and `OutboxWriter`; not one table of its own                                                                                                                |
| Assets, storage, file uploads                                | `media-server`                                  | Reads `MediaAssetResolver`, `STORAGE_PROVIDER` and the `media_asset` table; creates through `UploadAssetUseCase`. The dependency is **optional**                              |
| Locales, translation groups, the one-locale rule             | `i18n-server`, through content's extension port | Reads and passes the envelope columns without knowing what a locale is. **There is no dependency on i18n**                                                                    |
| Permissions and roles                                        | `identity-server`                               | Owns two keys in meaning; checks them with the ordinary `PermissionsGuard`/`@RequirePermissions` and re-checks `content:create`/`content:update` through `PermissionsService` |
| Workspace membership and granted content                     | `workspaces-server`, `content-server`           | Puts `WorkspaceGuard` and `ContentGrantGuard` in its stack; introduces no rules of its own                                                                                    |
| The action journal                                           | `activity`                                      | Emits two events; somebody else writes the journal rows                                                                                                                       |
| The Content Library's slots                                  | `content-admin`                                 | Declares three contributions; the slots themselves and their render order belong to content                                                                                   |
| Invalidating the entry cache in the admin UI                 | `content-admin`                                 | Calls `refreshEntryCaches` rather than writing keys of its own                                                                                                                |

### What else is missing

- **Asynchronous jobs.** A large export is a synchronous request. There is no `transfer_jobs`, no progress and no link to a finished archive; ADR-0014 explicitly leaves room for that and does not go there.
- **Carrying publication status.** `$status` leaves and does not arrive — see section 16.
- **The XLSX and XML formats.** The port for them exists, the implementations do not.
- **Showing the identity source in the interface.** `IdentityResolution.source` is computed and read by nobody — see section 16.
- **A page or route of its own in the admin UI.** Everything lives in the Content Library's seams, and that is a decision rather than a gap.
- **Exporting by filter.** Only an explicitly listed set of ids is exported, at most 1000.
- **An a11y and keyboard pass over the two dialogs.** `apps/admin-e2e/src/transfer/` now covers the behaviour — verdict staleness, the format capability table, the refresh pass — but no scan runs over either dialog and no spec drives them from the keyboard.

## 16. Where the code and the documentation diverge

Found while reconciling this dossier with the sources. Some are the document diverging from the code, some the code diverging from itself; either way they mislead developer and tester alike.

| Where                                              | What it says / intends                                                                                                                                                                                                            | How it actually is                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| docs/adr/0014, the “Consequences” section          | “A big export is still a synchronous request, bounded by configurable ceilings that answer `413` with a sentence naming the limit”                                                                                                | `TransferLimitError` extends a plain `Error`, and there is **no** exception filter in the project that maps it — not in `transfer-server`, not in `bootstrap-server`, not in `apps/server/src/main.ts`. So exceeding `maxEntries`, `maxAssets` or `maxBytes` reaches the client as a `500`, and the carefully written phrases (“Narrow the selection, or turn off related records”) never get to the user                                                                      |
| admin/ImportDialog + ImportEntriesController       | The “Download an empty CSV with the right columns” link points at `GET /api/content/:type/import/template`                                                                                                                        | The route sits under the class-level `WorkspaceGuard`, which requires the `X-Workspace-Id` header. An ordinary browser navigation through an `<a href>` sends no headers, so the link returns `400 Missing or malformed X-Workspace-Id header`. This is not covered by a test: the e2e hits the route through supertest, which does set the header                                                                                                                             |
| domain/document + server/import                    | `TransferRecord.$status` is described as “Draft/published, for a publishable type” and is filled in by the walker                                                                                                                 | The import **does not read `$status` at all** — its only mention in the whole of `transfer-server` is in the walker. A published entry exported and imported on another installation arrives in the writer's default state. There is no verdict and no warning about it                                                                                                                                                                                                        |
| domain/import/verdict.ts + admin/ImportVerdictList | 14 reason codes are declared and translated, including `unknown-field`, `unresolved-relations`, `dependency-failed` and `missing-asset` — with substantive comments (“The record is context (depth 1) and its own record failed”) | The server **never emits** those four codes. Unresolved references travel in the separate `unresolved` field under any action; a missing asset simply drops out of the field's value; a failed dependency and an unknown field are indistinguishable from `validation-failed`. Their translations are written and dead                                                                                                                                                         |
| domain/identity/natural-key.ts                     | `IdentityResolution.source` is “surfaced in the UI so the rule isn't a secret”; `TransferSchemaCatalog.identityOf()` returns the fields **and** the source                                                                        | `identityOf()` has not one caller in the entire monorepo, and it is not separately exported out of `transfer-server`. No screen shows which field the matching will run on, or why. Only the fields themselves leave — in the manifest                                                                                                                                                                                                                                         |
| admin/constants/index.ts                           | `CONTENT_CREATE` / `CONTENT_UPDATE` — “Needed alongside import — an import may never exceed what its caller could do”                                                                                                             | No hook reads them; they are not exported from the package's `index.ts`. The “Import…” item is gated on `content:import` alone. With the three system roles this is invisible (the permissions always come as a set); with a custom role the dialog opens and every entry gets `forbidden`                                                                                                                                                                                     |
| server/import/application, the CSV dry-run report  | The dry run reports unresolved references, counting as known those targets that are in the same document                                                                                                                          | The “in the document” set is built from `record.$key`, and the CSV parser (`rowToRecord`) always sets `$key: {}` — on import the key is computed later, from `values`. So for CSV the dry run marks as unresolved the references to entries that are in the same file and will be created. The apply meanwhile works correctly — it is the preview and the result that diverge                                                                                                 |
| domain/formats/csv-format.ts                       | A type's missing schema at export time is “a hard failure at export time instead”                                                                                                                                                 | What is thrown is a `TransferParseError` — a class whose name and purpose belong to _parsing_ — on the serialisation path. The export controller does not catch it and does not map it to a `400`: it will reach the client as a `500`                                                                                                                                                                                                                                         |
| export/http/dto/export-request.dto.ts              | `@ApiProperty({ default: TRANSFER_FORMAT.Json })` — OpenAPI declares the default format as JSON                                                                                                                                   | The field is **required** (`@IsIn` with no `@IsOptional`), so it has no default at all, while the admin dialog opens on `zip`. Three different answers to one question in three places                                                                                                                                                                                                                                                                                         |
| admin/AGENTS.md, the slot table                    | “`RECORDS_MENU_SLOT` — Import… in the collection's ⋯ menu”, while `transferAdminPlugin`'s comment says “leftmost in the toolbar”                                                                                                  | A small but contradictory description of one and the same place in two neighbouring files                                                                                                                                                                                                                                                                                                                                                                                      |
| Test coverage                                      | The package is described as having both a server and an admin half                                                                                                                                                                | The server e2e is one file of ~30 tests, and it covers the policies, the permissions and the round trip well. The browser suite (`apps/admin-e2e/src/transfer`) now pins the verdict staleness — what `admin/AGENTS.md` calls “this dialog’s worst possible mistake” — along with the format capability table, the post-import refresh and the overlay that outlives the menu it was opened from. What is still missing there is a11y and keyboard coverage of the two dialogs |
| The limits in e2e                                  | Ten configurable ceilings                                                                                                                                                                                                         | Not one of them is checked in `transfer-round-trip.spec.ts`. The archive checks are covered by the `archive.spec.ts` unit tests; the export ceilings by nothing                                                                                                                                                                                                                                                                                                                |

> **What of this is worth fixing first**
>
> **First** — mapping `TransferLimitError` to a `413`: today a large export's most likely failure looks like a broken server. **Second** — the CSV template link: it is offered right there in the dialog and does not work. **Third** — `$status`: moving published content quietly drops it into drafts, and that is stated nowhere.

---

**The series' frame.** This dossier follows the `packages/identity` one: business description → composition → permissions → formats → what travels → data → lifecycle → scenarios → API → admin UI → configuration → security → invariants → checklist → boundaries → divergences. Two sections were added for this package's specifics — the format matrix and the “what travels and what stays a reference” table; the database-tables section is compressed into one box, because the plugin has no tables.

The source is the source code: `packages/transfer/{domain,server,admin}`, `docs/adr/0014-transfer-as-a-separate-plugin.md`, the plugin registrations in `apps/server/src/plugins.ts` and `apps/admin/src/plugins.ts`, the configuration in `apps/server/ortha.config.ts`, the permission set in `packages/identity/server/src/lib/rbac/system-roles.ts`, and the tests in `apps/server-e2e/src/server/transfer/`. The `AGENTS.md` files were used as the frame, but every claim was checked against the implementation — the divergences are gathered in section 16.
