# Content

_Package group · packages/content_

**The content model, the editor and the public API — Ortha CMS's heart**

Content answers the question a CMS exists for: **what kinds of content there are** (types declared in code), **who edits them and how** (the editor, versions, publication) and **how the outside world takes them** (REST, GraphQL, MCP). Content types are declared in TypeScript and turn into real Postgres tables; everything else — the editor, the filters, the API, the agent tools — is generated from one registry.

- **4** packages in the group
- **64** HTTP routes
- **2** tables of its own
- **12** field types
- **6** permission keys
- **6** extension ports
- **24** tools for agents
- **14** admin slots

## Contents

- [01. Business description](#01-business-description)
- [02. Composition of the package group](#02-composition-of-the-package-group)
- [03. Roles and permissions](#03-roles-and-permissions)
- [04. Data model](#04-data-model)
- [05. An entry's lifecycle](#05-an-entrys-lifecycle)
- [06. Scenarios — how it works, step by step](#06-scenarios-how-it-works-step-by-step)
- [07. HTTP API](#07-http-api)
- [08. The admin UI: screens, states, behaviour](#08-the-admin-ui-screens-states-behaviour)
- [09. Configuration](#09-configuration)
- [10. Security and resilience: what was done and why exactly this way](#10-security-and-resilience-what-was-done-and-why-exactly-this-way)
- [11. Invariants](#11-invariants)
- [12. Testing checklist](#12-testing-checklist)
- [13. Boundaries of responsibility](#13-boundaries-of-responsibility)
- [14. Divergences between code and documentation](#14-divergences-between-code-and-documentation)

## 01. Business description

Content is what turns an empty skeleton into a CMS. Identity answers “who arrived”, Workspaces answers “where they work”, and Content answers “what is here at all and what can be done with it”. Every other plugin (media, localization, segments, alarms, export, the copilot) is built around it and has no subject matter without it.

### The problem it solves

- **The content model lives in code, not in an interface.** A content type is declared by a TypeScript file (`collection('article', { fields: … })`), goes through review, lands in git and produces a migration. This is a deliberate choice against a “type builder in the admin UI”: the schema is part of the application, not of user data, and changing it must be visible in the repository's history.
- **One model, many surfaces.** From one type registry you automatically get: the editor's form, the records table with its filters, the OpenAPI document, the public REST API, the GraphQL schema and the tool set for an MCP agent and the copilot. Adding a field does not require editing six places.
- **A draft is separated from what is published.** Editing a live entry does not break the site: changes accumulate as a draft, and publication is a separate deliberate act. The required-field checks bite at publication time rather than preventing you from saving something unfinished.
- **History, not “the last save”.** Every save lays down an immutable snapshot of the whole document, relations included. Any version can be viewed, compared, restored and published.
- **The outside world gets data by token, not on someone else's session.** The public API runs on bearer tokens with a `read`/`full` scope and a set of workspaces; a session cookie is not accepted on `/api/v1` at all.
- **The workspace and grant boundaries are the same everywhere.** An entry always belongs to a workspace, and a content type must be granted to that workspace. The same rule works in the admin UI, in REST, in GraphQL, in MCP and in the copilot — and an ungranted type is indistinguishable from one that does not exist.

### Who sees it

#### The developer

Writes a collection file, runs `db:generate`, commits the SQL. Gets the form, the table, the filters, REST, GraphQL and OpenAPI for free.

#### The editor

The content library inside a workspace: a records table with search, filters and saved views, a tabbed editor, the properties panel, the publication gate and version history.

#### An external application / agent

Takes published content over `/api/v1/content`, over GraphQL or through the MCP tools — with the same visibility rules and one filter language.

### What Content is not

The boundaries matter more than the capabilities — they explain why things one expects of a CMS are absent here:

- **It is not a type builder.** You cannot create a content type or add a field in the admin UI. A type is code; a schema change is a migration. The “content types” section of the interface only reads the registry.
- **It is not a media library.** `media` fields store bare asset uuids; the files themselves, uploading, previews and serving are the `media` plugin. Content declares the `MEDIA_ASSET_RESOLVER` port and works without it (in which case media fields are validated by value shape only).
- **It is not localization.** Content owns the _shape_ of the storage (one row per locale, `locale` + `locale_group_id`) but knows nothing of which locales exist, which is the default, or how to match them. All of that is `@orthacms/i18n-server` behind the `CONTENT_ENTRY_EXTENSION` port. The `?locale=` and `localeGroupId` parameters are declared in the DTOs as **opaque strings** and passed to the extension uninterpreted.
- **It is not a read-permission system.** Who may read _published_ content is the `segments` plugin's question, plugged in through the `CONTENT_READ_SCOPE` port. Content only ANDs its predicate onto its own.
- **It is not a rich-text editor.** The kernel describes `richtext` as a structured document and validates it (heading order, table headers, link text, language markers), but the TipTap editor itself comes from `@orthacms/wysiwyg-admin` through a slot.
- **It is not an audit journal.** Content emits seven kinds of `entry.*` domain events through the transactional outbox; the journal rows are written by `activity`.
- **It is not search.** `?search=` is an `ILIKE` over text columns with metacharacters escaped. There is no indexed text projection, and the documentation says so outright.

> **The main architectural bet**
>
> The engine is **generic**: one `EntryWriterService` and one `EntriesService` serve _every_ content type, and the physical table is derived from `type` at request time. Everything else follows from that: one shared versions table, one set of `/content/:typeName/…` routes, sixteen generic MCP tools instead of a set per type, and an OpenAPI document the plugin writes itself — because `@nestjs/swagger` sees only the string `:typeName` and does not know that `article` differs from `home_page`.

## 02. Composition of the package group

The `packages/content` group is four packages. The split is load-bearing: the kernel must work in the browser and on the server alike, so it can contain neither React, nor NestJS, nor Drizzle; and the GraphQL protocol adapter must reuse REST's services rather than repeat them.

| Package | npm name                  | Role                                                                                                                                                     | What it owns                                                                                                                                                                                                 |
| ------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| domain  | @orthacms/content-domain  | The shared kernel — plain TypeScript both runtimes apply identically                                                                                     | The `draft ↔ published` state machine, field value validation, the publication gate, the `richtext` document model and its structural rules, BCP-47. **Zero dependencies** in its `package.json` — verified |
| server  | @orthacms/content-server  | The NestJS plugin: the type DSL, the registry, the table generator, the entries engine, versions, the public API, the agent tools, insights, saved views | 2 tables of its own (`saved_views`, `saved_view_defaults`), 61 HTTP routes, 6 extension ports, 24 tools, OpenAPI generation                                                                                  |
| admin   | @orthacms/content-admin   | The content library in the admin UI: navigation, the records table, the entry editor, history, saved views, insights widgets                             | The `/workspaces/:id/content/*` route, 14 extension slots, 8 widgets on the Insights page                                                                                                                    |
| graphql | @orthacms/content-graphql | A second **protocol** over the same public API (`POST /api/v1/graphql`) — an adapter, not a second API (ADR-0008)                                        | 3 routes, schema assembly per the workspace's grant set, a query cost budget, GraphiQL. **No tables, no migrations, no new way of authenticating**                                                           |

### Two plugin entry points, not one

The `server` package exports **two** `ServerPlugin` factories, and that is not a stylistic choice. The `ServerPlugin.migrations` contract carries **one** `{ dir, table }` descriptor, and content has already spent it on the _host's_ generated tables:

- `ContentPlugin({ types, migrations })` — the registry, the routes, the engine. Its migrations descriptor points at `apps/server/migrations`, with the journal table `__drizzle_migrations_content`.
- `ContentViewsPlugin({ content })` — saved views with **their own** migrations (`__drizzle_migrations_content_views`). Registered **after** `ContentPlugin`, identity and workspaces: `saved_views` has foreign keys into `users` and `workspaces`, and `applyPluginMigrations` walks the plugin array in order and declares no dependencies.

> **Separate barrels: /define and the main one**
>
> Collection files and the schema entry for drizzle-kit must import from `@orthacms/content-server/define`, not from the main barrel. drizzle-kit assembles the schema's whole import graph with plain esbuild, which trips over the NestJS decorators arriving through the main barrel's controllers. `/define` re-exports only the decorator-free DSL: `collection`, `single`, `field`, `joinTableOf`, the types and the `content_entry_revisions` table.

> **Neighbours that are easy to confuse**
>
> **`@orthacms/i18n-server`** binds `CONTENT_ENTRY_EXTENSION`: locales, shared-field synchronization onto siblings, the `hasLocale`/`missingLocale`/`localeCount` virtual filters. **`@orthacms/media-server`** binds `MEDIA_ASSET_RESOLVER`. **`@orthacms/segments-server`** registers `CONTENT_READ_SCOPE`, `ENTRY_WRITE_EXTENSION` (the `access` key) and `ENTRY_FILTER_PROVIDER`. **`@orthacms/alarms-server`** uses the exported `EntryMatchQuery`. **`@orthacms/transfer-server`** handles import/export and writes only through `EntryWriterService`. **`@orthacms/mcp-server`** owns the MCP protocol but not the tools; the tool registry is in `@orthacms/tools-server`.

## 03. Roles and permissions

Permissions are flat and global to a role; workspace membership and type grants are a separate, orthogonal axis. Content uses six keys from identity's catalogue (plus `media:read` on one MCP tool).

| Key             | What it opens                                                                                                                                                                                                                  | admin | contributor | viewer |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ----------- | ------ |
| content:read    | The type catalogue, a type's schema, the list of filterable fields, listing and reading entries, relations, media refs, version history, all six insights routes, all saved-view routes, public reads on a `read`-scoped token | Yes   | Yes         | Yes    |
| content:create  | `POST /content/:typeName`, `POST /v1/content/:typeName`, half of the `/bulk` save, the `content_create` / `content_propose_create` tools                                                                                       | Yes   | Yes         | No     |
| content:update  | `PATCH` on an entry, restoring a version, the other half of the `/bulk` save. **Plus a hidden role:** it is the key `DraftVisibilityGuard` uses to check the right to see drafts through `?status=draft\|any`                  | Yes   | Yes         | No     |
| content:publish | `publish`/`unpublish` (single, bulk, by locale group), the bulk-publish preview, publishing a specific version                                                                                                                 | Yes   | Yes         | No     |
| content:delete  | Deletion (soft or hard), restoring from the trash, `permanent`, and the bulk forms of all three                                                                                                                                | Yes   | **No**      | No     |
| views:share     | Only **publishing** a saved view to the whole workspace (`visibility: 'workspace'`). A personal view saves without it — `content:read` is enough                                                                               | Yes   | Yes         | No     |

> **A contributor does not delete content**
>
> `content:delete` is held by the administrator only. A contributor can create, edit and publish an entry but not delete it — soft deletion included. It shows in the admin UI too: the Delete item in an entry's menu and the Delete in the selection bar are hidden via `useHasPermission`, and the selection bar's “⋯” menu is not rendered at all when no available item is left.

### How a permission reaches the code

1. **The route declares its requirement with a constant.** `@RequirePermissions(PERMISSIONS.CONTENT_PUBLISH)` — there is no string literal anywhere in the code.
   _the server-plugin skill's rule: permission-by-constant_
2. **The session path.** Identity's `PermissionsGuard` reads the current user's role permissions and hands the decision to the pure `AccessPolicy`.
3. **The token path.** `ApiTokenGuard` turns the token's scope (`read`/`full`) into a permission set through `scopePermissions`, and the same `@RequirePermissions` is evaluated by the same `AccessPolicy`. The role of whoever issued the token is **not** considered: a token acts on its own behalf.
4. **GraphQL.** One endpoint serves both reads and writes, so the controller's decorator can only be a “floor” (`content:read`), and each mutation resolver calls `context.assert(...)` itself — against the same `AccessPolicy` and the same `tokenActor`.
5. **The agent tools.** The permission is **declared**, not implemented: each tool carries `requires: [...]`, and `ToolRegistry.call` checks them before dispatch. No handler contains the line “a read token does not write”.

> **Three independent axes of access**
>
> The permission (`content:update`) is _what_ may be done. Workspace membership (`WorkspaceGuard` on the `X-Workspace-Id` header) is _where_. The type grant (`ContentGrantGuard` against the `workspace_content` table) is _over what_. All three are mandatory and are checked in that order: CSRF and permissions first (cheap, no database), then membership, then the grant — so a request rejected for a missing permission does not pay for a database trip for membership.

## 04. Data model

Content has three different classes of table, and they must not be confused — they have different owners and different migrations.

| Class                                                                               | Who owns the files                                                                                                | Who owns the migrations                                                                                                          | Migrations journal                   |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **Generated type tables** `content_<name>` and join tables `content_<name>_<field>` | Built by `buildTables` from the type declaration                                                                  | **The host** (`apps/server`): re-exports the tables in `src/content/index.ts`, runs its own `drizzle.config.ts`, commits the SQL | \_\_drizzle_migrations_content       |
| **The shared versions table** `content_entry_revisions`                             | Declared in the package (`revisions/infrastructure/persistence/revision-table.ts`), re-exported through `/define` | **The host**, under the same descriptor                                                                                          | \_\_drizzle_migrations_content       |
| **Fixed platform tables** `saved_views`, `saved_view_defaults`                      | The package                                                                                                       | **The package** — its own `drizzle.config.ts` + `migrations/0000_saved_views.sql`                                                | \_\_drizzle_migrations_content_views |

The reference application currently has **6** host migrations (`0000_content-types` … `0005_richtext_structured_documents`) and **1** package migration. The reason for the split is direct: the shape of the generated tables depends on a particular application's code, so their migrations are per-app; the shape of `saved_views` is the same in any installation, so it travels with the package.

### A generated table's envelope

| Column                  | When it appears     | Meaning and constraints                                                                                                                                                |
| ----------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                      | always              | uuid PK, `gen_random_uuid()`                                                                                                                                           |
| workspace_id            | always              | uuid **with no FK** — the `workspaces` table belongs to another plugin, and there are no cross-plugin FKs in the system. The scope is checked in the application layer |
| created_at / updated_at | always              | timestamptz, `updated_at` refreshed on every save                                                                                                                      |
| status                  | `publishable: true` | `draft` \| `published`, `DEFAULT 'draft'`                                                                                                                              |
| published_at            | `publishable: true` | timestamptz nullable with no default. **Not cleared on an edit** — only on `unpublish`                                                                                 |
| deleted_at              | `paranoid: true`    | timestamptz nullable — the soft-delete tombstone                                                                                                                       |
| locale                  | `i18n: true`        | text NOT NULL                                                                                                                                                          |
| locale_group_id         | `i18n: true`        | uuid NOT NULL, `DEFAULT gen_random_uuid()` — the identifier of “one story across all languages”                                                                        |

**Indexes.** The list index is `(workspace_id, status)` for publishable types, otherwise `(workspace_id)`. On an `i18n` type a unique `(locale_group_id, locale)` is added (**partial**, `WHERE deleted_at IS NULL`, on paranoid types) along with a list index `(workspace_id, locale[, status])`. Every single relation gets an index on `<field>_id`; for `unique: true` it is skipped on the assumption that the unique index serves it.

> **Required is not NOT NULL**
>
> On a **publishable** type, required fields stay **nullable** columns: “required” here means “required _in order to publish_”, otherwise an unfinished draft could not be saved. The check lives in `EntryValidationService` and fires at publication, against the _stored_ row. On a **non-publishable** type there is no publication — it is always live, so required fields become `NOT NULL` and are validated on every write.

### Reserved columns

`status`, `published_at`, `deleted_at`, `locale` and `locale_group_id` are reserved **unconditionally**: an author cannot declare a field that would land in such a column (`assertFields` rejects it), and a client cannot set them — they are not in `type.fields`, so `coerceValues` drops them from the bag before storage and before validation. Hence a non-obvious consequence: **an unknown key in `values` is silently ignored** rather than giving a 422 — the validator sees an already-coerced bag. This is deliberate in one direction (a version snapshot that outlived a removed field is still restorable) and acknowledged as a rough edge in the other (a client's typo writes nothing and says nothing). The public `?fields=` and the copilot's tools _reject_ unknown names — there the caller is naming what it expects back.

### Twelve field types

| Type        | Storage                                               | Filterable / sortable        | Notes                                                                                                                                       |
| ----------- | ----------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| text        | text                                                  | Yes (string)                 | `minLength`/`maxLength` count **graphemes** through `Intl.Segmenter`, not UTF-16 units                                                      |
| richtext    | jsonb                                                 | No                           | A structured document (a ProseMirror/TipTap tree). A legacy HTML string remains a valid value. `?search=` reaches it through a cast to text |
| number      | numeric                                               | Yes (number)                 |                                                                                                                                             |
| money       | numeric                                               | Yes (number)                 | Fixed scale of 2. **There is no currency in the field spec**                                                                                |
| boolean     | boolean                                               | Yes                          | A required one gets `DEFAULT false`                                                                                                         |
| date        | date                                                  | Yes (date)                   | Validated against the calendar, not just the `YYYY-MM-DD` mask                                                                              |
| datetime    | timestamptz                                           | Yes (date)                   | An `Invalid Date` does not pass                                                                                                             |
| select      | text                                                  | Yes (an enum of the options) | The DSL has no option labels — the raw value is printed                                                                                     |
| multiselect | jsonb                                                 | No                           | An array of strings                                                                                                                         |
| json        | jsonb                                                 | No                           |                                                                                                                                             |
| relation    | An `<field>_id` FK column or a join table             | Not directly                 | Filtering goes by **paths** (`author.name`), not by the raw uuid                                                                            |
| media       | a uuid or a jsonb array of uuids **in the value bag** | No                           | Not an FK — the assets live in the media plugin's schema. Existence and `accept` are checked by the port                                    |

### Relations: four cardinalities, two storage shapes

| Cardinality  | Declaration                                                   | Storage                                                                                         |
| ------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| many-to-one  | `field.relation({ to })`                                      | An `<field>_id` FK column on the owning side                                                    |
| one-to-one   | `field.relation({ to, unique: true })`                        | The same FK + a `UNIQUE`; on an `i18n` type a partial `uniqueIndex(<field>_id, locale)` instead |
| one-to-many  | `field.relationInverse({ of, field })` over a single relation | **Nothing** — it reads the owner's FK                                                           |
| many-to-many | `field.relation({ to, many: true })`                          | A join table `(source_id, target_id, position float)`                                           |

`onDelete` defaults to `'cascade'` for a required relation and `'set null'` for an optional one; a required single relation with `'set null'` is rejected at declaration time — a NOT NULL FK cannot be nulled. `relationInverse` **produces no migration** at all: it is virtual, both sides write into the same join table, so they cannot drift apart. The pair is validated by the registry at startup.

> **Why (<field>\_id, locale) and not the other way round**
>
> The pair's uniqueness does not depend on the column order, but the leading column decides what else the index serves. For `unique` relations the ordinary FK index is skipped on the assumption that this one already exists — and the paged read of the inverse side does an `inArray(<fk>, sourceIds)` and relies on it.

### The package's own tables

| Table               | Purpose                         | Key fields and constraints                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| saved_views         | A named slice of a records list | `id` uuid PK · `workspace_id` → workspaces (cascade) · `scope` text (`content:<typeName>`) · `owner_id` → users (cascade) · `visibility` enum `view_visibility` = private \| workspace, default private · `name` · `payload` jsonb · `position` int · timestamps.<br>Uniqueness on `(workspace_id, scope, owner_id, name)` — “Save as new” with an existing name gives a clean 409, while two people can each keep their own “Needs review”. Index on `(workspace_id, scope)`. |
| saved_view_defaults | Which view a person lands on    | PK `(user_id, scope)` · `view_id` → saved_views (cascade) · `updated_at`. **A separate table rather than an `is_default` column**: the choice is personal, and one shared view can be the default for one member and not for another — a column on the view itself cannot express that. The index on `view_id` covers the cascade check when a view is deleted.                                                                                                                |

### The shared versions table

| Column                                 | Meaning                                                                                                                                                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| workspace_id                           | The workspace — ANDed into every read and write                                                                                                                                                                            |
| content_type                           | The type's machine name. **Not decoration:** without it the URL's `:typeName` would never be checked against the version returned, and any registered name would serve any entry's history together with its full snapshot |
| entry_id                               | The live row. The key is **per locale** — each translation has its own version feed                                                                                                                                        |
| locale_group_id / locale               | Null on non-i18n types                                                                                                                                                                                                     |
| revision_number                        | A monotonic number within one `entry_id`, from 1. Uniqueness on `(entry_id, revision_number)` backstops a race with a 23505 error instead of a silent duplicate                                                            |
| status                                 | `draft` · `published` · `superseded`                                                                                                                                                                                       |
| snapshot                               | jsonb `{ values, relations, extra }` — the value bag (scalars, localized and shared, single relations' FKs), the full ordered link sets of join relations, and third-party plugins' state                                  |
| created_by / created_at / published_at | Who and when. On a token write `created_by` is null — a version stores a user's id, and a token is not a user                                                                                                              |

## 05. An entry's lifecycle

**draft** — publish → **published** ⇄ unpublish / an edit ⇄ **draft** — delete → **deleted_at**

There are exactly **two** stored `status` values — `draft` and `published`. A separate `unpublished` or `archived` is deliberately absent: unpublishing is the reverse `published → draft` transition, and an archive is a soft-delete tombstone rather than a status. The state machine lives in the kernel (`canTransition` / `assertTransition`), identical for the server and the admin UI; a transition into the same state is not a transition, and the caller must short-circuit it itself as an idempotent no-op.

### Two stored values — four meanings

| Stored                        | Shown             | What it means                              | What the public API sees                                                          |
| ----------------------------- | ----------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| the creation form             | **Not saved yet** | Nothing has been saved                     | —                                                                                 |
| draft · `published_at` = null | **Draft**         | Never published                            | Nothing (or only on a token with `?status=draft\|any`)                            |
| draft · `published_at` ≠ null | **Modified**      | Live content with unpublished edits on top | Nothing by default — **but** a `published` version remains in the version history |
| published                     | **Published**     | Live and current                           | Served                                                                            |

> **Editing a live entry returns it to draft**
>
> Saving a publishable entry always yields a **draft working copy**: `status → draft`. `published_at` is **preserved**, though — it records that the entry _has_ a live version, and an edit does not undo that; only `unpublish` clears it. The previously published _version_ in the history stays `published` and remains live. Hence a practical consequence for filters: `?filter=` on `publishedAt` means “when it last went live”, not “live right now” — for the latter, filter on `status`.

### Soft deletion

On a `paranoid` type, `DELETE` sets `deleted_at`; the row drops out of every list except `?deleted=only` (the “Trash” view). `POST .../restore` brings it back, `DELETE .../permanent` kills it for good. On a non-paranoid type `DELETE` is a real `DELETE`, and the `restore`/`permanent` routes do not exist for it by definition. A soft-deleted row is invisible as a _relation target_ too: a link to it is still returned as a `RelationRef`, but with a `missing: true` flag and no title — so that `items` is never shorter than `total`, and the admin UI draws “Unavailable record” instead of a bare uuid.

### The version feed

**draft** — publish → **published** — publish another version → **superseded**

A version is born a draft. `markPublished` raises one to `published` and **demotes the previous live one to `superseded`** — there is never more than one live version. `markUnpublished` returns the live one to `draft`. Publishing the entry as a whole raises the **latest** version (which is exactly the row just published, because every save appends a version); publishing a specific version passes its number and raises _it_ in place.

History is **append-only**: restoring version v2 goes through the ordinary `EntryWriterService.update` and yields a fresh v6 equal to v2 — nothing is rewritten. Publishing an _earlier_ version first carries its contents onto the live row (`RestoreRevisionUseCase` with `appendRevision: false`) but **writes no new version** — otherwise every publication would lengthen the feed with a copy. Hence an honest consequence worth knowing: after publishing an earlier version, the “latest” version no longer matches the live content, i.e. `isLatest ≠ “equal to the live row”` in that window; the next save re-aligns them.

### The values' password rules — the publication gate

- **The gate covers the value bag** — `canPublish(fields, values)` — and lives in the kernel so that the admin UI's Publish button and the server's check cannot drift apart.
- **A required link-managed relation** (an owning many-to-many or the inverse side of one) is not in the bag, so it is checked separately — `assertRequiredRelations` **counts the links**: eagerly inside the write transaction for non-publishable types, and against the stored links at publication. Zero links gives the same 422 `is required`.
- **The order of the checks is load-bearing:** values first, and only if they pass, the required relations. Otherwise the set of issues in the 422 would change depending on which check failed first.
- **The inverse side of a _single_ relation** (one-to-many) owns no writable link of its own, so it is not checked at all.

## 06. Scenarios — how it works, step by step

### 6.1 A content type: from a file to a table

Types are declared in code in the host application: collections in `apps/server/src/content/collections`, pages (singles) in `src/content/pages`. The reference application ships 7 collections and 3 pages, including the kitchen-sink `article` with every flag and every relation cardinality at once.

1. **The author writes the declaration.** `collection('article', { label, publishable, paranoid, i18n, fields: {…} })`. The import is strictly from `@orthacms/content-server/define`.
   _the main barrel would drag in the NestJS decorators that esbuild inside drizzle-kit trips over_
2. **`assertName` and `assertFields` run immediately.** Rejected: a name not in snake*case, a field that would land in a reserved column, two fields collapsing into one column, a field colliding with a relation's `<field>_id`, `localized: true` on a non-i18n type, a required single relation with `onDelete: 'set null'`, `unique` together with `many`, invalid BCP-47 in `lang`, an unknown `kind` in a media field's `accept`.
   \_a declaration error is a build error, not a first-request error*
3. **`buildTables` builds the physical layer.** One `content_<name>` table plus a join table per owning many-relation. The envelope is added per the flags.
4. **The host re-exports the tables** in `src/content/index.ts`. Join tables go through `joinTableOf(type, field)`, which **throws** if a many-relation was renamed, instead of silently dropping the table out of the migration diff.
5. **`nx run server:db:generate --name=…`** assembles the SQL and the developer commits it. For the package's own tables the command differs: `nx run "@orthacms/content-server:db:generate"`.
6. **At startup `ContentPlugin({ types })` builds the registry eagerly.** Duplicate names and unresolvable relation targets throw _here_ — the application does not boot, rather than failing on the first request.
   _the relationInverse pairing is validated in the same place_
7. **`EntryExtensionBootCheck` checks i18n.** If a type with `i18n: true` exists and nobody bound `CONTENT_ENTRY_EXTENSION`, startup fails: a localized type with no locale plugin would write NULL into the NOT NULL `locale`.
8. **`ContentGraphqlPlugin` checks the names across the whole registry.** Two types collapsing into one GraphQL name, or a field colliding with the envelope (`status`, `translations`), is a startup failure rather than a surprise on the first request from a workspace granted both.
9. **The registry becomes the source of everything else.** Its serialized view (`registry.serializeAll()`) goes to `describeContentApi`, which — _after_ the OpenAPI document is assembled — appends three schemas per type (`ArticleValues` / `ArticleEntry` / `ArticleListPage`) and turns `typeName` into an enum of the registered names.

### 6.2 Creating an entry through the admin UI

The order of the steps inside `EntryWriterService.create` is reconstructed from the code; almost all of it is deliberate.

1. **The request.** `POST /api/content/:typeName` with `{ values, relations?, locale?, localeGroupId?, extensions? }` and an `X-Workspace-Id` header.
   _OriginGuard → PermissionsGuard(content:create) → WorkspaceGuard → ContentGrantGuard_
2. **The type is resolved by the registry.** An unknown name is a 404. A non-grant is **the same** 404 with the same text, and the grant is read _before_ any registry decision.
3. **`coerceValues` coerces the bag.** Only declared fields are projected; everything extra (reserved keys included) drops out.
4. **The extension stamps the envelope columns.** `createColumns` validates and fills in `locale`/`localeGroupId`. It is called **before the transaction** — an unknown locale or a foreign group fails fast; and **before the relation checks** — because this row's locale is exactly what the links are checked against.
5. **A single relation's `set` is folded into a value.** `relations: { author: { set: "<gid>", by: "localeGroup" } }` turns into an ordinary id in `values`, so that everything downstream — existence, workspace, the one-locale rule — sees one shape and needs no second implementation. A field sent in both bags is a 400: otherwise one would silently win.
6. **The relation targets are checked.** Existence in the same workspace, `assertSameLocale` (a link does not cross locales when both sides are localized), `assertUniqueRelations` for one-to-one — by **translation group** rather than by row id, otherwise the entry's own second locale would look like a competitor. A malformed uuid is filtered out by a regex beforehand: `inArray(<uuid>, ['not-a-uuid'])` is a cast error in Postgres, i.e. a 500 on ordinary bad input.
7. **The media targets are checked** through `MEDIA_ASSET_RESOLVER` if it is bound: a missing, foreign or `accept`-forbidden asset gives a uniform **422** without distinguishing “does not exist” from “not allowed”. With the port unbound the step is a no-op.
8. **Value validation — only for a non-publishable type.** A publishable one has a draft stage, so an incomplete draft must be savable.
9. **One transaction.** A **shared** advisory lock on the workspace is taken (`lockWorkspaceShared`) — it coordinates with the exclusive locks of the “is the workspace empty” checks when a workspace is deleted or a grant revoked, so a new entry cannot be orphaned by a concurrent deletion.
10. **The extension's `beforeWrite` — before the row lock.** This is the only place an extension can order its locks: by the time `afterUpdate` runs, the transaction already holds the row taken by its own UPDATE, outside the extension's control, and two concurrent saves on two members of one group are guaranteed to end in `deadlock detected`. i18n takes a transactional advisory lock on `locale_group_id` here.
11. **The INSERT** with the field columns + `workspace_id` + the extension's columns. All wrapped in `uniqueGuarded`, so a duplicate `(group, locale)` is a clean **409** rather than a 500.
12. **The links are written.** `writeLinks` — the whole many-relation sets sent in the body (on creation this is the usual path: position = the array index); then `applyRelationDeltas` — the incremental deltas.
13. **For a non-publishable type — the required link-managed relation check** comes _after_ the links are written, inside the transaction, so it can see them; a 422 rolls the whole creation back.
14. **The extension's `afterUpdate`** with the context `{ created: true }`. The asymmetry matters: on an **update** the edited row is the authority and its state fans outward; on a **creation** it is the opposite — the translation arrives with the source's shared values but _without_ its relations, and treating it as the authority would wipe the links of siblings that were already correct.
15. **The write extensions' `applyAll` and `inheritAll`.** The first writes what the client sent in `extensions`; the second (creation only) gives the fresh row what its **locale group** already holds. Without the second, the translation of a restricted article came out as a public German copy — a failure a reader notices and an editor never does.
16. **Version snapshot #1** — in the same transaction. Plus one version per row rewritten by either extension path, with **deduplication**: one save can reach a sibling both through a shared field and through an audience, and two versions on one row read as two edits.
17. **An `entry.created` event into the transactional outbox** — inside the same transaction, so the fact and the row it describes commit together or not at all.
18. **The response is the re-read entry.** The admin UI puts it in the cache via `setQueryData` and navigates to `/:typeName/<id>`, so the id ends up in the URL and the next save is already an update.

### 6.3 Editing an entry

1. **`PATCH /api/content/:typeName/:id` is a _replacement_ of the values**, not a merge. The editor always sends the whole document, so replacement is right here. **The public `PATCH`, conversely, merges** by key presence: an API client sends the two fields that changed, and silently nulling the rest would be invisible until some future failed publication over fields it never touched. `{"excerpt": null}` still clears, though.
2. **The row's locale is read before the transaction** — with one indexed query and only on localized types, so that the pre-transaction target checks apply the same rule as the link writing inside.
3. **Inside the transaction the stored row is read first** — exactly the one this UPDATE will replace.
4. **The UPDATE sets `status = draft`** (on a publishable type) and refreshes `updated_at`, **preserving `published_at`**.
5. **The links and deltas are written, the extensions run, a version is appended.** All as on creation.
6. **`entry.updated` names the changed fields** — and is **not raised at all** if nothing changed. The writer diffs the stored row against the written one over `type.fields`, excluding the envelope columns any save rewrites. A re-submitted editor form or a restore of an already-live version is a round trip, not an editorial change; there is no autosave in the admin UI, so no coalescing window is needed: a save is a human pressing a button.

### 6.4 Publishing one entry

1. `POST /api/content/:typeName/:id/publish`, permission `content:publish`. A non-publishable type gives a **400** rather than a silent success.
2. **All inside a `UnitOfWork`.** The status write and the `entry.published` outbox event commit atomically.
3. **The live row is read** (`findLive` on the transaction executor). Absent — 404.
4. **The _stored_ row is re-validated**, not what the client sent. Values first; only if they pass are the required link-managed relations counted, so that the set of issues in the 422 matches the original order of checks.
5. **The transition is applied by the `Entry` domain model** through the kernel's state machine. A gate failure is an `EntryPublishBlockedError`, which the HTTP layer turns into a `422 { message, issues: [{ field, message }] }`.
6. **`markPublished`** stamps `status` and `published_at` unconditionally — re-publishing is idempotent.
7. **`markRevisionPublished`** raises the version (the latest one — or the named one when a specific version is published) and demotes the previously live one to `superseded`, in the same transaction.

### 6.5 Bulk publication: a dry run, then the commit

Two routes, and that matters: the editor must see the verdicts _before_ anything goes live.

1. **`POST …/bulk/publish/preview`** with `{ ids }` (at most 100). Returns a verdict per entry: `publishable`, `already-published`, `blocked` (with per-field issues), `not-found`.
   _an already-published row still returns its per-field checks — so that the dialog can expand it like any other rather than leave a dead, unexpandable row_
2. **The admin UI draws the `BulkPublishDialog`** — a list of verdicts with icons. The dialog is **exported from the package's index**: a plugin acting on a known set of entries (i18n's “publish all locales”) reuses the entire flow rather than building a second one. Two props make it readable in another context — `labels` and `labelFor(id)`, because every sibling of one entry has the _same_ title and it is the locale that distinguishes them.
3. **`POST …/bulk/publish` commits.** `BulkPublishEntriesUseCase` selects the candidates `FOR UPDATE` and re-validates inside **one** transaction — the only thing that closes the window between “this draft is valid” and “publish it”. Only valid drafts are published; the response is a partial success.
4. **Bulk unpublish counts the _real_ transitions.** `{ count }` is the number of rows that actually went `published → draft` — the same set the events are raised for. It used to count every live row matched by an id: unpublishing a list with a draft inside counted it and stamped `updated_at` on a row nothing happened to.

### 6.6 Relations: deltas instead of whole sets

A relation can hold thousands of links. Sending it whole is not an option in either direction.

1. **Reading is paged.** `GET …/:id/relations` returns the _first page_ and a `total` for each relation field; `GET …/:id/relations/:field?page=&pageSize=` pages through one field (default `RELATION_PAGE_SIZE` = 20), ordered by `position`.
2. **The editor accumulates edits locally.** A `StagedRelation` = added refs + removed ids + the order. Nothing goes to the server before Save. The staging belongs to `EntryEditor` so that it survives collapsing a section and switching tabs (and tabs are routes, so a tab's component unmounts).
3. **Saving serializes the staging into a delta** `{ link?, unlink?, order? }` and puts it in the write body. One transaction, one request.
4. **Inside the transaction `applyDelta`** removes the unlinked pairs, adds the new ones at `max(position)+1` for their source (`ON CONFLICT DO NOTHING`), and renumbers by `order` (the owning side only).
5. **Before that an advisory lock is taken on the _physical source list_** (`<join table>:<sourceId>`). `max(position)+1` is a read-modify-write on a contended column: the owning side, the inverse side and a whole-set write all target the same list, and without the lock two concurrent additions would read one `max` and collide on `position`. The inverse loop locks its owners in sorted order so as not to deadlock.
6. **What gives a 400 and what a 422.** A `relations` key that owns no writable link from this side (a single relation, the inverse side of a single, an unknown name) is a **400**: a delta must never be lost silently. A structurally malformed delta (not an array of uuids, an extra inner key, an over-long array, too many fields) is a **400 at the DTO level** (`IsRelationDeltaMap`), not a 500. A non-existent or foreign target is a **422**.
7. **The preview in the records table is opt-in.** `?relations=preview&relationFields=a,b` adds a bounded page of refs plus an honest `total` to each row. Opt-in, because the same endpoint serves the relation _picker_, which must not pay for expansion; the admin UI requests only the **visible** relation columns, so a hidden column costs nothing. Resolution is `previewForEntries`, batched over the whole page: one window query per field (`row_number()` for the limit, `count(*)` for the total, partitioned by the owning id) rather than N+1 per row; a test pins that the query count does not grow with the page.

### 6.7 Locales: one row per language

Content owns the storage shape and does not own the meaning. Everything that decides which locales exist sits behind the port.

1. **Every locale is a full row** with its own `id`; siblings share a `locale_group_id`.
2. **A field is marked `localized: true`** when its value varies by language. An unmarked field is **shared** across the whole group, and a write to it fans out to every sibling.
3. **Relations live by their own rule.** A relation belongs to the _entry_, not to a language, so `syncAcrossLocales: true` is the default. But _how_ a synchronized link is stored is decided by the **target's type**, because that is a fact about storage rather than a preference.
4. **Three modes, one source of truth** (`extension/relation-locale-sync.ts`, consulted by the schema serializer, the sibling synchronization and the copilot's translation applier): `shared` — synchronization on, the target is not i18n: the same id in every sibling. `mirrored` — synchronization on, the target is i18n: the target's _group_ is stored and resolved by each row's locale. `none` — synchronization off, this is the inverse side, or the owner is not i18n: nothing fans out.
   _cardinality plays no part in this rule at all_
5. **`isPerLocaleField` is a _different_ question** (“does this row's value differ from its siblings'”), and it is not the opposite of the previous one: a `mirrored` relation is both per-locale _and_ propagated — the id differs precisely so that each row points at the right translation.
6. **A link does not cross locales.** When both sides are localized, an English article links to the English tag. This used to be a rule of the admin UI's _picker_; now the **writer** applies it, so a direct API call cannot bypass it. `assertSameLocale` is the only implementation, reachable from all three write paths, and it compares against the locale of **the row being written**, not the request parameter.
7. **Addressing by group.** A delta may carry `by: "localeGroup"` and group ids: each is resolved to that group's row _in the source's locale_. A client that thinks in stories keeps one id per story instead of one per language, and the server picks — the only side that reliably knows the source row's locale. A group with no row in that locale gives a 422 with an explanation; the mode on a non-localized target gives a 400.
8. **There is no separate “create a translation” route.** It is an ordinary creation with a `localeGroupId` in the body — the extension stamps and validates it, and the row becomes a sibling.

### 6.8 Versions: snapshot, comparison, restore, publishing a version

1. **Every save appends a version** inside the same transaction, through the `REVISION_STORE` port. The number is allocated as `max + 1` under an advisory lock on the entry, and the unique index `(entry_id, revision_number)` backstops a race.
2. **There is no separate `entry.revision.created` event.** The save has already raised `entry.created`/`entry.updated`, and a second event per version would double every journal row.
3. **The feed.** `GET …/:id/revisions`, newest first, 20 at a time. Each row shows the number, a Live/Draft/Superseded badge and a timestamp. On a **non-publishable** type there are no badges at all: a version there is simply saved, and drawing a state the type never has would be a lie.
4. **A version's detail is enriched with resolved refs.** `RevisionRefsQuery` turns the snapshot's ids (a single relation's FK from `values`, join relations' lists from `relations`) into titled `RelationRef`s, capped at `PREVIEW_RELATION_REF_CAP` = 50; a soft-deleted or foreign target is marked `missing` and returns no title. Media are resolved the same way.
5. **The preview is a comparison with the current state.** The dialog fetches the selected version _and_ the newest one (which equals the live row, since every save appends a version) and runs the pure `revisionDiff`: changed fields are drawn as a “Current → Version {n}” pair, unchanged ones are collapsed.
6. **Restoring is an ordinary save.** `RestoreRevisionUseCase` runs the snapshot through `EntryWriterService.update`, which appends a **new** version: restoring v2 yields a fresh v6 equal to v2. History is append-only.
7. **Restoring brings back third-party plugins' state too.** `snapshot.extra` goes back through the same `update`, so “go back to Tuesday” restores Tuesday's audiences too rather than leaving today's readers on Tuesday's text.
8. **Publishing a specific version** (`POST …/revisions/:number/publish`, permission `content:publish`) marks _that_ version live in place. If the version is an earlier one, its contents are first carried onto the live row with `appendRevision: false`, so the feed does not grow a copy per publication. A gate failure (422) leaves the contents carried over as a draft — a recoverable state.

### 6.9 Public reads on a bearer token

1. **The request.** `GET /api/v1/content/article?locale=de&fields=title,slug&relations=preview` with `Authorization: Bearer …`. The route is marked `@Public()`, so the session `AuthGuard` lets it through — **a session cookie is not accepted here at all**.
2. **`ApiTokenGuard`** hashes the presented token, resolves it through identity's `ApiTokenService.verify` (unknown / revoked / expired all give one flat 401) and attaches it to `request.apiToken`.
3. **`ApiTokenWorkspaceGuard`** picks the workspace. A token carries a **basket** of workspaces: `X-Workspace-Id` picks one (malformed — 400, outside the basket — 403, the same as “no such thing”, so ids cannot be enumerated). With no header and a token covering exactly one workspace, that one is taken; covering several gives a 400 rather than a guess.
4. **`DraftVisibilityGuard`** looks at `?status=`. By default and with `published` it passes through. `draft`/`any` require `content:update`: the right to read drafts is the right of whoever could have published them anyway. An unrecognized value is deliberately left alone — the DTO will turn it into a 400, and a guard answering 403 first would report the wrong problem.
5. **`resolveGrantedType`** requires `:typeName` to be both registered and granted to the workspace. Everything else is one and the same 404. `/v1/content-types` lists exactly the names that will not 404 — there is nothing to guess.
6. **One visibility predicate.** `readableWhere` = `liveWhere` (workspace + published-only on publishable + not deleted on paranoid + the `CONTENT_READ_SCOPE` fragments) AND the extension's list scope. The reader **deliberately does not reuse `EntriesService`**: that one has admin knobs, and `?deleted=only` alone selects rows a token must not see — a narrow WHERE is better than a wide one with subtraction.
7. **`?search=` and `?filter=` are ANDed on top**, so they can only narrow. The filter surface is built **lazily**, only when `?filter=` is present, because walking the relation graph costs money, and with `grantedTypes` — a hop into an ungranted type gives a 400 `FILTER_UNKNOWN_RELATION` rather than resolving. The `status` field is **removed** from the schema: reads force `published` anyway, so a rule over it would be either a no-op or an emptiness, and a coherent 400 beats a mysteriously empty page.
8. **`?fields=` narrows both `values` and the SQL projection.** An unread richtext column is not read at all (verified against a live server: the SELECT collapses from “all columns” to the envelope plus the named ones). An unknown name is a **400**, not a silent drop; a relation or media name gets a _different_ message (“cannot be selected”), because “not selectable yet” is a different fact from “no such field”. An empty `?fields=` reads as “no preference”, not “no fields at all”. The envelope always comes back — `id` first of all.
9. **Expanding relations and media is opt-in and batched.** `?relations=preview` with no field list expands _every_ relation whose targets are granted to the workspace (ungranted ones are skipped rather than rejected — the caller named nothing, so there is nothing to correct). A type with more expandable fields than `MAX_EXPANDED_FIELDS` = 10 gives a 400 asking for them to be named, rather than a silent truncation. A related entry is returned as a **full `PublicEntry`** but is not _itself_ expanded — which is what bounds a request to one level of the graph.
10. **Unreachable targets are neither shown _nor counted_.** The restriction (published-only + `CONTENT_READ_SCOPE` on the _target's_ type) goes **inside** the window and inside the `count(*)`, so `total` cannot advertise links nothing can reach. While the scope was applied only during hydration, `items` was right and `total` was not: a reader forbidden three of five related entries saw two items under a five and could infer that three were hidden.
11. **The response** is `{ items, total, page, pageSize }`. `values` holds **only the entry's own data**; every reference field (`relation` in all four cardinalities, including the owning single whose FK _is_ a column of the row, and `media`) is removed from it — a bare uuid would be an identifier with no route. The omission is declared **temporary**: the schema describes them, and when the reads arrive the keys will only be added.

### 6.10 GraphQL: the same path, a different protocol

ADR-0008. A resolver translates a GraphQL field into the very DTO the public REST path takes, calls the same service and returns the result.

1. **`POST /api/v1/graphql`, an ordinary NestJS controller** rather than `@nestjs/graphql`. This is forced by the item below, but it delivers the main thing: `@UseGuards(ApiTokenGuard, ApiTokenWorkspaceGuard)` work with the **same objects** as on any other `/v1` route. With `@nestjs/graphql` a `GqlExecutionContext` adapter would be needed — a fork in the authentication path, i.e. exactly where a fork is least acceptable.
2. **The schema is built per the workspace's grant set**, not once at startup. Otherwise introspection would hand the whole content model to any token — a leak strictly worse than the one REST specifically avoids by 404ing an ungranted type.
3. **`SchemaCache` memoizes by the sorted grant set**, with a TTL (60,000 ms by default). The TTL is a **freshness knob, not a security boundary**: every resolver re-checks the live grants through `resolveGrantedType`, so a stale schema may _describe_ a just-revoked type but can never _read_ it. The cache sweeps expired entries once more than 32 accumulate — otherwise the map grew by a schema for every grant set the process ever served.
4. **The cost budget runs after parsing and before execution**, cheapest check first: document length (16384) → depth (8) → field count (500) → complexity (1000) → one operation per request.
   _each of the three walks is memoized by fragment name_
5. **Memoizing the walks is not an optimization.** Nine fragments, each expanding the next ten times, is a **788-byte** document expanding into 10⁹ selections; without memoization the count blocked the event loop (measured at 10 seconds on a 618-byte version, with an unrelated unauthenticated request stuck in the queue for 9 of them). A cyclic document skips the cost check and goes straight to `validate`, whose `NoFragmentCycles` gives a better message than anything invented here.
6. **Introspection is enabled and exempt from the budget.** The endpoint is authenticated, the schema is already trimmed to the grants, and `__schema`/`__type` are answered from the in-memory schema object — with no resolvers and no database. The exemption is what makes “enabled” true: the standard introspection query has depth 15 and 220 fields.
7. **The selection set becomes `?fields=`.** `selection.ts` reads what was selected and turns it into the same query parameters: value fields → `fields`, relation fields → `relations=preview` + `relationFields` + `relationLimit`, media → `media=preview`, `translations` → `translations=preview`. A `{ id title }` query narrows the SQL projection exactly as `?fields=id,title` does — for free, because it is the same code.
8. **The assembled DTOs are validated in the resolver.** A REST body goes through the global `ValidationPipe`; a GraphQL argument never does. Without this a token reached further through GraphQL than through REST: `pageSize: -1` was a clean 400 there and reached `.limit(-1)` here (an opaque 500), `pageSize: 500` ignored `MAX_PAGE_SIZE`, and a 100-kilobyte search string slipped past the DTO's limit.
9. **Nested reads are batched by level.** `EntryLoader` collects every request in one tick and makes **one query per level** — an ordinary `PublicEntriesQuery.list` with a `{ field: 'id', op: 'in' }` filter, so the load goes through the same `readableWhere` and needs neither new query code nor a new visibility rule.
10. **The loader carries an entry's visibility in hand.** A mutation returns a draft (creation always does, and an update returns a published entry to draft), and re-reading that row through the published-only default found nothing — `createArticle(…, relations: { tags: { link: […] } }) { tags { total } }` answered `0` for the links it had just written. The widening is safe: holding a draft already means having the right to see it.
11. **A resolver error is an HTTP 200 with an `errors` array.** That is how GraphQL works, and it is the one thing a REST migrant has to get used to: the status they used to branch on now travels in `extensions.status`.

### 6.11 Saved views

1. **A view is a bookmark, not a grant.** The payload is replayed by an ordinary list query with the _reader's_ permissions, workspace and grants, so a shared view shows a narrower reader _fewer_ rows, never more.
2. **The payload mirrors the URL rather than re-modelling it.** `filter` and `sort` are the same raw `?filter=`/`?sort=` strings that already belong to the records page. Two things are deliberately absent: `search` is a one-off question rather than a property of the slice, and `page` is a reading position, so a view always opens on the first page.
3. **`extra` is an opaque string map** for slot parameters (i18n's `?locale=`). The keys come from `RECORDS_TOOLBAR_SLOT.listParamKeys` at runtime, so enumerating them in the DTO would silently break the next plugin's parameters.
4. **`scope` is checked against the grants rather than taken on trust.** `ViewScopeService` resolves `content:<typeName>` through the registry _and_ the workspace's grants, answering with **the same 404** as an unknown type. Without that the endpoint would be a way around `ContentGrantGuard`: saving a view over `content:salaries` would confirm such a type exists.
5. **Only the owner writes.** Editing or deleting someone else's view is a 403 **even for an administrator**: the cure for disagreeing with a shared view is “Save as new”, not a quiet rewrite. Setting a _default_ is deliberately not restricted to the owner — that is the reader's personal choice of landing point.
6. **Sharing is a permission.** `visibility: 'workspace'` requires `views:share`, and it is checked _on every write_, because it depends on the body rather than the route. Personal views are available to every role.
7. **Shape-only validation is deliberate.** The server bounds the payload (known keys, lengths, array sizes: up to 100 columns, up to 20 `extra` keys, up to 100 views per person and scope) but does _not_ check the filter against the type's surface: a view outlives the field it referenced, and on application the admin UI drops unknown rules with a notice. Deep validation would require a two-way dependency, and degrading on application has to be survivable anyway.
8. **`?view=` is a pointer, not a slice.** `filter`/`sort`/`pageSize` and the slot parameters stay in the URL by themselves; `?view=<id>` only names where they came from. That is why a link keeps working after a view is renamed or deleted, Back/Forward switch views like ordinary navigation, and “Copy link” needed no new code.
9. **The landing ladder.** An explicit `?view=` or _any_ list parameter means the link already carries an intent and beats the reader's default — a deep link from an email must show what the sender saw. Only a bare URL falls through to the default, applied with `replace: true` so that Back does not bounce off the redirect.

### 6.12 The filter: one surface, two consumers

1. **`buildEntryFilterSurface` makes _one_ walk** of the relation graph and produces both the wire list for the field picker **and** the SQL `FilterSchema` the list endpoint applies. The picker physically cannot offer a path the API will reject; a drift test pins that.
2. **Paths are recursive** — `author.name`, `author.company.name`, with a default budget of 2 hops. Every emitted relation carries a `scope` (workspace + soft-delete) so that a relation filter does not match a deleted or foreign target.
3. **The list endpoint builds the schema lazily**, only when `?filter=` is present — walking the graph is not free. Hence an important consequence: **filtering by relations works through the API independently of the UI**.
4. **The admin list's schema is deliberately _not_ trimmed by grants.** There it is a SQL allowlist rather than a visibility boundary, and trimming would make one and the same saved view sometimes a 400 and sometimes a change of meaning depending on which workspace it was opened from. On the public API it is exactly the opposite: there it _is_ a visibility boundary.
5. **Virtual fields come from two sources.** The bound extension (`filterExtension`: i18n's `hasLocale`/`missingLocale`/`localeCount`) is the single binding; for a second participant there is the `ENTRY_FILTER_PROVIDER` registry (segments puts `audienceAllowed`, `audienceDenied` and `accessRestricted` there). `compose` routes each rule to whoever declared its field and keeps the **first** declarer on a name collision: “last wins” would make a saved filter's meaning depend on plugin registration order.
6. **A participant's three obligations.** Every emitted subquery must be workspace-scoped (otherwise the filter becomes a cross-tenant read); it must declare only the fields and operators it actually answers to (a resolver's refusal reaches the user as “could not load the collection” — under a rule the picker itself offered); and it must remember that **a filter narrows a list but is not a visibility rule** — reachability is decided by `CONTENT_READ_SCOPE` and applied separately.
7. **`EntryMatchQuery` is the same filter without the list.** Exported from the module so that alarms evaluate their rules through the **same** surface, parser and translator. Two deliberate differences: **there is no locale scope** (a rule is a statement about a collection, so it must see every translation; the extension's virtual fields are still wired in), and **deleted rows are always excluded**. Plus a separate “parse without executing” method: a filter that a background subscriber will replay for months must parse at write time — a tree that fails only on evaluation fails where nobody is watching.

### 6.13 The copilot: propose, do not write

1. **Content _binds_ the copilot's tool port** rather than the other way round: `copilot/server` declares `COPILOT_TOOL_PROVIDER` and never imports content, while content — which already has `EntriesService`, `EntryWriterService` and the registry — supplies the tools as thin wrappers. Not a line of query logic is duplicated.
2. **Three read tools** (`admin_content_types`, `admin_content_search`, `admin_content_get`) reach the same query surface as the records table: free-text search, the `?filter=` tree, sorting, pagination, locales, sparse field sets. “Which German articles has Ada not published?” is one tool call rather than a paged walk that used to run into the run's step limit.
3. **`filter` is the query builder's own grammar.** The model gets an **object** (assembling an object is noticeably easier for it than a string), and the tool serializes it, because the wire wants JSON in a query parameter. The model never writes SQL: every path is checked against the type's schema, and the paths on offer come from `admin_content_types`, built with `grantedTypes`.
4. **`fields` projects `values`** — and that is what makes “list every article” possible at all: a full entry carries every richtext body, and a page of 25 eats the token ceiling long before the row limit. The envelope — and `id` first of all — is always preserved, otherwise the projection would break the subsequent `admin_content_get`.
5. **Two history tools** (`admin_content_revisions`, `admin_content_diff`) form a separate provider, because versions are their own feature with their own port, and the registry takes any number of providers. `diffRevisions` returns **only the changed fields** plus a count of the unchanged ones: the admin dialog draws everything because a human needs the context, but on a wide type the unchanged richtext bodies alone would consume the whole run budget.
6. **Three write tools** (`content_propose_create`, `content_propose_update`, `content_propose_bulk_save`), all with `effect: 'propose'`. None writes anything: they compute a change and return it. That is the entire point of the split — a tool is a pure function of the model's arguments plus the current entry, so a prompt injection saying “just save it” has nowhere to land.
7. **An edit that reaches into other languages must say so.** A shared (not `localized`) field fans out across the whole group — rightly, “shared” means shared. What was missing is that nobody said so: under ADR-0009 a change is applied as composed, and one accepted proposal could rewrite an entry in four languages while `copilot_proposals` recorded an edit to one. Now `proposeEdit`/`proposeBulk` ask the extension's `describeFanout` — against the **patched** values, so the disclosure names what will actually be written — and weave the answer into the `summary` and into a structured `target.fanout`. Into the summary specifically, because that string is at once the card's heading, the audit row's `output_summary` and the “Applied: …” in the run's receipt — that is, it reaches the human, the log and the model alike.
8. **An unknown field name is an _error_ here**, unlike `fields` in the reads: the cost is a human approving a change they believe writes a field that does not exist. Join relations are rejected for the same reason — their links do not travel in the value bag, so a value for them would be silently lost.
9. **There is no `status` parameter on any role** (ADR-0005 §7): the copilot may prepare a publishable draft; a human presses the publish button. Bulk publication and bulk deletion are deliberately absent — batching is a way to ask, not a route to authority the single-item tool was never given.
10. **`content_propose_bulk_save` is one change, not a loop.** “Translate these eight posts” used to be eight calls: eight steps of a bounded run and eight cards for one instruction, none of which mentioned the other seven. Fields that did not change are dropped, and an item left with none is dropped entirely — which is more than card hygiene: writing an entry's own current values still appends a version and returns a **live** entry to draft, so a model resending twenty unchanged entries would unpublish twenty live pages.
11. **The applier goes through `EntryWriterService.create`/`.update` — the same methods the HTTP routes use.** Not “similar”, the same: that is what makes an accepted proposal validated, locked, snapshotted into a version and run through the i18n extension exactly as a hand-typed edit is. The update **merges** rather than replaces (the admin PATCH replaces because the editor sends the whole document; a proposal carries only what the reviewer approved) and reads the entry **now**, so a proposal accepted an hour later writes the approved fields over whatever the entry has become rather than rewinding it.
12. **Grants are re-checked at apply time** rather than taken from the row: a stored `typeName` is an argument like any other. “Not granted” and “does not exist” give **the same** message, so that a run in one workspace cannot enumerate the whole installation's content types.
13. **The bulk applier stops at the first failure** and throws a message with the number already written: a proposal is one row with one status, and continuing would grow the number of writes under a receipt that will then report a failure. The public `/bulk` does the **opposite**, because there every item has its own verdict.

### 6.14 MCP: sixteen generic tools

1. **Every handler delegates to the objects the public controllers call** — `resolveGrantedType`, `PublicEntriesQuery`, `PublicEntryWritesService`. That is the whole design: published-only reads, the grant gate, the locale rules, publication-time validation, version numbering and the outbox are not restated and therefore cannot drift. The provider adds descriptions, argument validation and mapping — and nothing else.
2. **Which is why the tools live here and not in the MCP package.** Those services are internal to content, and exporting them so another package can drive the read path is exactly how a second, diverging copy of the visibility rules appears.
3. **Sixteen generic tools, not a set per type.** `typeName` is an argument, exactly as it is a path segment on the HTTP routes. Generating `article_create`, `author_create`, … would put the whole content model into every conversation's context (a client loads every tool schema on connect) and still could not be a fixed set, because which types are visible depends on the token's grants.
4. **The model learns a type's shape on demand** through `content_type_get`, whose `valuesSchema` comes from the same `docs/field-schema.ts` as the OpenAPI document. Granted types are additionally available as MCP **resources** at `orthacms://content-type/<name>` — through the same grant gate.
5. **Arguments are validated by the real HTTP DTOs.** `validateToolInput` runs `PublicListEntriesQueryDto`/`PublicSaveEntryDto` with the host's `ValidationPipe` options. A hand-rolled check would fork the contract at the first boundary shift — `pageSize` would cap at 100 on the route and at something else on the tool. Unknown arguments are rejected rather than ignored, and that matters more to a model than to a developer: a silently dropped typo produces a plausible-looking wrong answer.
6. **The one authorization decision inside a handler** is `assertDraftVisibility`, because it is a rule about an _argument_ (`status=draft|any` requires `content:update`) rather than about an operation. Everything else is `requires` declarations checked by `ToolRegistry.call`.
7. **On `content_update` the `locale` argument is _addressing_** and is passed separately, never folded into the save DTO: `body.locale` applies to creation only, and reading it for addressing is exactly how updating the German row by group silently rewrites the English one.

### 6.15 Soft deletion, the trash, permanent deletion

1. **`DELETE /content/:typeName/:id`** (permission `content:delete`, 204). On a `paranoid` type it sets `deleted_at`; on an ordinary one it deletes the row.
2. **The row disappears from every read**, relation reads included — `readableWhere` and `liveWhere` both carry the `deleted_at IS NULL` condition.
3. **The trash is `?deleted=only`**, a separate view and a separate route segment in the admin UI (`:typeName/trash`). A saved view deliberately does not reach it: `/trash` is a segment over a different set of rows rather than a parameter, and a view saved there would describe a slice meaningful on only one of the two pages.
4. **`POST …/restore`** clears `deleted_at`; **`DELETE …/permanent`** kills the row for good. Both under `content:delete`.
5. **Every form has a bulk variant** (`bulk/delete`, `bulk/restore`, `bulk/purge`), and all of them raise **one event per actually changed row** rather than per id passed.
6. **The admin UI must tell the view a row is gone.** Row actions call `onRowGone(id)`: the id is struck from the selection (which is keyed by id and lives across pages, so there is nobody else to do it) and the table moves focus to its own labelled container — otherwise Radix would try to return focus to an unmounted menu and drop it on `<body>`.

## 07. HTTP API

Every path carries the global `/api` prefix set by the host. Access legend: `session` — a session cookie + `X-Workspace-Id`, `permission` — plus the named permission, `bearer` — token only, no session accepted. Every session route under `/content/:typeName…` additionally carries `WorkspaceGuard` + `ContentGrantGuard`, and every mutating one also carries `OriginGuard` (CSRF). **64** routes in total: 37 session, 24 public REST, 3 GraphQL.

### 7.1 The type catalogue (session)

| Method and path                         | Access and guards                                          | Input                       | Success                                                                                                                      | Refusals                                                                          |
| --------------------------------------- | ---------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| GET /content-schema                     | `content:read` PermissionsGuard **without** WorkspaceGuard | —                           | Summaries of every registered type                                                                                           | `401`, `403`                                                                      |
| GET /content-schema/:name               | `content:read` Workspace                                   | the type's name in the path | The full field schema: types, validation rules, admin props, the `i18n`/`localized` flags                                    | `404` — unknown **and** ungranted share one shape; `400` with no workspace header |
| GET /content-schema/:name/filter-fields | `content:read` Workspace                                   | —                           | The filterable surface: the type's scalar paths + recursive relation paths (a 2-hop budget), with `scope` and `RelationKind` | `404`. Trimmed by grants: a hop into an ungranted collection is not offered       |

`GET /content-schema` is deliberately left without a workspace scope: types are declared in code and are global, and the admin UI's ⌘K palette reads them when no workspace is open yet, intersecting with the grants on the client.

### 7.2 Entries (session)

| Method and path                             | Access                   | Input                                                                                                           | Success                                                                                      | Refusals                                                                                                                   |
| ------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| GET /content/:typeName                      | `content:read`           | `?search=&filter=&sort=&page=&pageSize=&deleted=only&relations=preview&relationFields=&locale=&localeFallback=` | `{ items, total, page, pageSize }`. `status` is present only on publishable types            | `400` for a malformed filter or `pageSize` > 100; a malformed sort silently falls back to `-updatedAt`; `404` for the type |
| POST /content/:typeName                     | `content:create` Origin  | `{ values, relations?, locale?, localeGroupId?, extensions? }`                                                  | `201` + the re-read entry                                                                    | `422` validation / relation target / media; `409` a duplicate (group, locale); `400` a malformed delta; `403` Origin       |
| GET /content/:typeName/:id                  | `content:read`           | `:id` through `ParseUUIDPipe`                                                                                   | One live entry                                                                               | `404` — including an id from another workspace and a soft-deleted row                                                      |
| GET /content/:typeName/:id/relations        | `content:read`           | —                                                                                                               | `{ relations: { <field>: { items: RelationRef[], total } } }` — the first page of each field | `404`                                                                                                                      |
| GET /content/:typeName/:id/relations/:field | `content:read`           | `?page=&pageSize=`                                                                                              | `{ items, total }`, ordered by `position`                                                    | `400` when `field` is not a relation; `404`                                                                                |
| GET /content/:typeName/:id/media            | `content:read`           | —                                                                                                               | Media fields resolved into refs (name, kind, thumbnail url)                                  | `404`. With no `MEDIA_ASSET_RESOLVER` bound — a no-op                                                                      |
| PATCH /content/:typeName/:id                | `content:update` Origin  | `{ values, relations?, extensions? }` — a **replacement** of the values                                         | The re-read entry; on a publishable type `status = draft`                                    | `422`, `400`, `404`, `403`                                                                                                 |
| POST /content/:typeName/:id/publish         | `content:publish` Origin | —                                                                                                               | The entry with `status = published` and a `published_at` stamp                               | `400` the type is not publishable; `422 { message, issues }` the gate; `404`                                               |
| POST /content/:typeName/:id/unpublish       | `content:publish` Origin | —                                                                                                               | `status = draft`, `published_at` **cleared**                                                 | `400`, `404`                                                                                                               |
| DELETE /content/:typeName/:id               | `content:delete` Origin  | —                                                                                                               | `204`. Soft on paranoid, hard otherwise                                                      | `404`, `403`                                                                                                               |
| POST /content/:typeName/:id/restore         | `content:delete` Origin  | —                                                                                                               | The restored entry                                                                           | `404`; on a non-paranoid type there is nothing to restore                                                                  |
| DELETE /content/:typeName/:id/permanent     | `content:delete` Origin  | —                                                                                                               | `204`                                                                                        | `404`                                                                                                                      |

> **The controllers' registration order is load-bearing**
>
> `BulkEntriesController` is registered **before** the single-entry ones in `ContentModule.forRoot`, so that the literal `bulk` segment beats `:id`. As a second line of defence the single `:id` routes carry a `ParseUUIDPipe`: even if the order is broken, the word `bulk` will not pass as a uuid.

### 7.3 Bulk operations (session)

| Method and path                              | Permission        | Input                | Success                                                                                                 |
| -------------------------------------------- | ----------------- | -------------------- | ------------------------------------------------------------------------------------------------------- |
| POST /content/:typeName/bulk/publish/preview | `content:publish` | `{ ids }`, up to 100 | `200` — a verdict per entry: `publishable` / `already-published` / `blocked`+issues / `not-found`       |
| POST /content/:typeName/bulk/publish         | `content:publish` | `{ ids }`            | `200` — a partial success; the candidates are selected `FOR UPDATE` and re-validated in one transaction |
| POST /content/:typeName/bulk/unpublish       | `content:publish` | `{ ids }`            | `200 { count }` — the **real** published → draft transitions                                            |
| POST /content/:typeName/bulk/delete          | `content:delete`  | `{ ids }`            | `200 { count }`                                                                                         |
| POST /content/:typeName/bulk/restore         | `content:delete`  | `{ ids }`            | `200 { count }`                                                                                         |
| POST /content/:typeName/bulk/purge           | `content:delete`  | `{ ids }`            | `200 { count }`                                                                                         |

### 7.4 Versions (session)

| Method and path                                       | Permission               | Success                                                             | Refusals                                                                            |
| ----------------------------------------------------- | ------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| GET /content/:typeName/:id/revisions                  | `content:read`           | The feed, newest first, 20 at a time                                | `404`                                                                               |
| GET /content/:typeName/:id/revisions/:number          | `content:read`           | The snapshot + resolved `relationRefs`/`relationTotals`/`mediaRefs` | `404` — the key includes `content_type`, so a foreign `:typeName` serves no history |
| POST /content/:typeName/:id/revisions/:number/restore | `content:update` Origin  | A new version equal to the restored one                             | `404`, `422`                                                                        |
| POST /content/:typeName/:id/revisions/:number/publish | `content:publish` Origin | That version is marked live, the previous one `superseded`          | `422` (the contents stay carried over as a draft), `404`, `400`                     |

### 7.5 Insights (session)

Six endpoints rather than one combined payload: **each widget owns its query**, so a slow or failing aggregate darkens one card rather than the whole dashboard. All are `content:read` + `WorkspaceGuard`, read-only, computed on the fly over the existing `(workspace_id, …)` indexes; there is no projection.

| Path                            | Answers                                                                                       | `?days=`                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET /insights/content/totals    | Total / published / drafts, the change over the window and a short history for the sparklines | yes, 1…365, default 30                                                                                         |
| GET /insights/content/stale     | Published entries bucketed by “untouched for a while”: 30/90/180/365/older                    | **no** — the buckets _are_ the time axis                                                                       |
| GET /insights/content/pipeline  | Drafts versus published, by type                                                              | **no** — this is a snapshot of what exists                                                                     |
| GET /insights/content/velocity  | Publications by time bucket                                                                   | yes; the bucket width is chosen from the window: up to 31 days by day, up to 120 by week, beyond that by month |
| GET /insights/content/punchcard | Edits by weekday and hour, from `content_entry_revisions`                                     | yes                                                                                                            |
| GET /insights/content/unshipped | Live entries with unpublished edits (the **Modified** badge), by type and in total            | **no** — a deferred edit is deferred whether it was made this morning or last spring                           |

> **Why unshipped is an endpoint rather than a filter**
>
> It is the one figure `status` alone does not express: `draft` + `published_at` is live content with edits, while `draft` without it is a draft that never shipped; added together they turn a fresh workspace into a backlog. Plus two rules: **a non-publishable type contributes nothing at all**, not even to the “live” denominator (it has no draft stage, so all its rows are trivially current), and **the three counters are taken with one grouped query per type** rather than three `countOf`s — they partition the same rows.
>
> **There is deliberately no draft delta.** Nothing records an entry going back _into_ draft — `published_at` says when it shipped and never that it stopped — so a change figure for drafts could only be invented.

### 7.6 Saved views (session)

| Method and path           | Access                                          | Input                                                 | Success                                                                | Refusals                                                                                                                         |
| ------------------------- | ----------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GET /views                | `content:read`                                  | `?scope=content:<typeName>`                           | Your own views of any visibility + every shared one for the scope      | `404` for an ungranted/unknown scope                                                                                             |
| POST /views               | `content:read`<br>`views:share` for `workspace` | `{ scope, name, visibility?, payload, makeDefault? }` | The created view                                                       | `409` the name is taken; `403` without `views:share`; `404` scope; `400` payload limits; `422` the ceiling of 100 views exceeded |
| PATCH /views/:id          | `content:read`                                  | Only the changing fields                              | The updated view                                                       | `403` **not the owner — even an administrator**; `409`; `404`                                                                    |
| DELETE /views/:id         | `content:read`                                  | —                                                     | `204`; defaults pointing at it are cleared by cascade                  | `403` not the owner; `404`                                                                                                       |
| PUT /views/:id/default    | `content:read`                                  | —                                                     | `204`. **Not restricted to the owner** — the landing point is personal | `404`                                                                                                                            |
| DELETE /views/:id/default | `content:read`                                  | —                                                     | `204`, idempotent                                                      | `404`                                                                                                                            |

### 7.7 The public REST API on a bearer token (`/api/v1`)

Every route is `@Public()` + `ApiTokenGuard` + `ApiTokenWorkspaceGuard`. **No `OriginGuard`**: a browser does not send a bearer token in the background, there is nothing to forge, and requiring an `Origin` header would break every non-browser client. A `read` token scope gives `content:read`; `full` gives the whole set.

| Method and path                                            | Permission                          | Input                                                                                                                                                                         | Success                                                                                                | Refusals                                                                                                 |
| ---------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| GET /v1/content-types                                      | `content:read`                      | —                                                                                                                                                                             | Summaries of every type granted to the workspace                                                       | `401` token; `400`/`403` workspace                                                                       |
| GET /v1/content-types/:name                                | `content:read`                      | —                                                                                                                                                                             | The full field schema                                                                                  | `404` — unknown and ungranted are indistinguishable                                                      |
| GET /v1/content/:typeName                                  | `content:read` Draft                | `?search=&filter=&sort=&page=&pageSize=&fields=&locale=&status=&relations=preview&relationFields=&relationLimit=&media=preview&mediaFields=&mediaLimit=&translations=preview` | `{ items, total, page, pageSize }`. Serves `single` types too — take `items[0]`                        | `400` filter/field/locale/expanding an ungranted type; `403` drafts without `content:update`; `404` type |
| GET /v1/content/:typeName/:id                              | `content:read` Draft                | the same expansion parameters                                                                                                                                                 | One published entry                                                                                    | `404`. **Not** scoped by locale — an id already names exactly one row                                    |
| GET /v1/content/:typeName/:id/relations/:field             | `content:read` Draft                | `?page=&pageSize=`                                                                                                                                                            | `{ items, total }`                                                                                     | `400` not a relation / an ungranted target; `404`                                                        |
| GET /v1/content/:typeName/:id/media                        | `content:read` Draft                | —                                                                                                                                                                             | Every media field with metadata and URLs                                                               | `404`                                                                                                    |
| GET /v1/content/:typeName/:id/translations                 | `content:read` Draft                | —                                                                                                                                                                             | The **other** published locales, keyed by slug; the entry itself is not repeated                       | `400` on a non-localized type — `[]` would read as “there are no other languages”                        |
| GET /v1/content/:typeName/group/:localeGroupId             | `content:read` Draft                | `?locale=`                                                                                                                                                                    | The group's row in the requested locale                                                                | `404` when there is no **published** row in that locale                                                  |
| GET /v1/content/:typeName/group/:gid/relations/:field      | `content:read` Draft                | `?locale=&page=&pageSize=`                                                                                                                                                    | `{ items, total }`                                                                                     | as for the id form                                                                                       |
| GET /v1/content/:typeName/group/:gid/media                 | `content:read` Draft                | `?locale=`                                                                                                                                                                    | media fields                                                                                           | as for the id form                                                                                       |
| GET /v1/content/:typeName/group/:gid/translations          | `content:read` Draft                | `?locale=`                                                                                                                                                                    | the other locales                                                                                      | as for the id form                                                                                       |
| POST /v1/content/:typeName                                 | `content:create`                    | `{ values, relations?, locale?, localeGroupId? }` — **no `extensions`**                                                                                                       | `201` — a **draft**                                                                                    | `422`, `409`, `400`                                                                                      |
| PATCH /v1/content/:typeName/:id                            | `content:update`                    | a partial update + relation deltas                                                                                                                                            | The re-read entry                                                                                      | `422`, `400`, `404`                                                                                      |
| PATCH /v1/content/:typeName/group/:gid                     | `content:update`                    | `?locale=` — **from the query only**, never from `body.locale`                                                                                                                | The re-read entry                                                                                      | `404`, `422`                                                                                             |
| POST /v1/content/:typeName/:id/publish · /unpublish        | `content:publish`                   | —                                                                                                                                                                             | The entry in its new state                                                                             | `400` not publishable; `422` the gate; `404`                                                             |
| POST /v1/content/:typeName/group/:gid/publish · /unpublish | `content:publish`                   | `?locale=`                                                                                                                                                                    | the same                                                                                               | the same                                                                                                 |
| DELETE /v1/content/:typeName/:id                           | `content:delete`                    | —                                                                                                                                                                             | `204`                                                                                                  | `404`                                                                                                    |
| DELETE /v1/content/:typeName/group/:gid                    | `content:delete`                    | `?locale=`                                                                                                                                                                    | `204` — deletes **one** locale                                                                         | `404`                                                                                                    |
| POST /v1/content/:typeName/bulk                            | `content:create` + `content:update` | `{ items }`, up to 50 documents                                                                                                                                               | **Always `200`** — a verdict per item in request order, repeating the single call's status and message | —                                                                                                        |
| POST /v1/content/:typeName/bulk/publish                    | `content:publish`                   | `{ ids }`, up to 100                                                                                                                                                          | `200` in the same `BulkPublishResult` shapes as the admin UI                                           | —                                                                                                        |
| POST /v1/content/:typeName/bulk/unpublish                  | `content:publish`                   | `{ ids }`                                                                                                                                                                     | `200 { count }`                                                                                        | —                                                                                                        |
| POST /v1/content/:typeName/bulk/delete                     | `content:delete`                    | `{ ids }`                                                                                                                                                                     | `200 { count }`                                                                                        | —                                                                                                        |

> **Two batching contracts, and the difference is not arbitrary**
>
> **`/bulk` (saving) reports per item and carries on.** `EntryWriterService` opens its own transaction per entry, so there is nothing to roll back in a batch even in principle — and rejecting forty-nine good rows because the fiftieth named a non-existent relation would make the endpoint pointless. Items are written **one at a time, in order**: every write takes the workspace's shared lock, so parallelizing would mostly contend with itself.
>
> **`/bulk/publish` delegates to `BulkPublishEntriesUseCase`** rather than looping over the single publish: that one selects the candidates `FOR UPDATE` and re-validates inside **one** transaction — the only thing that closes the window between “valid” and “publish”.
>
> **Addressing a save item.** An `id` present means an update; neither `id` nor `localeGroupId` means a creation; a bare `localeGroupId` is genuinely ambiguous (“add the German row” or “change the existing German one”), so it requires an explicit `op`. An `op` contradicting the addressing is an error rather than a silent preference. Bulk _actions_ take only `{ ids }`: a group names the entry in every language, and publishing “the entry” would publish translations the caller never listed.

> **Every single-entry route exists twice**
>
> Everything you can do holding an entry's id you can do holding a group id plus `?locale=` — which is the identity a localized front end actually carries, since a group is stable across languages and each locale's `id` is not. Both spellings lead into one `EntryLocator`, so the pair is a routing detail rather than a behavioural fork. The `group/…` routes are declared **first**: they cannot be shadowed by segment count, but Express matches in declaration order, and literal-prefix routes come before wildcards so that this stays true as the set grows. The **list** has no group form — a group names one entry.
>
> **A group WRITE takes the locale from the query string**, never from `body.locale`: that field applies to creation only, and reading it for addressing let a body that omitted it silently redirect the write to the default locale's row. A live check caught a German update rewriting the English article; an e2e test pins it.
>
> **`/:id/relations` (all fields) is deliberately absent from the public API** — it returned exactly what `GET /:id?relations=preview` already serves minus the entry itself, i.e. a second spelling of one read on a contract that must hold still. The only thing a query parameter cannot express is paging one field past the limit, so `/relations/:field` survived.

### 7.8 GraphQL (ADR-0008)

| Method and path            | Access                                                 | Input                                   | Success                                               | Refusals                                                                                                                                                |
| -------------------------- | ------------------------------------------------------ | --------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST /v1/graphql           | `content:read` (the floor) + a check on every mutation | `{ query, variables?, operationName? }` | **Always 200** if the operation executed at all       | `400` the budget exceeded / a parse failure / more than one operation; `401`/`403` token and workspace; field errors go in `errors[].extensions.status` |
| GET /v1/graphql            | `content:read`                                         | —                                       | `text/plain` — the SDL of **this** workspace's schema | `401`/`403`. Two tokens with different grants legitimately get different documents                                                                      |
| GET /v1/graphql/playground | `unauthenticated`                                      | —                                       | GraphiQL (~9 MB of self-contained HTML, no CDN)       | **The route does not exist** unless the host enabled it. Excluded from OpenAPI                                                                          |

#### Names in the schema

`blog_post` → the type `BlogPost`, the single query `blogPost`, the list `blogPosts`, the mutations `createBlogPost` / `updateBlogPost` / `publishBlogPost` / `unpublishBlogPost` / `deleteBlogPost`. The pluralization is naive English and deliberately not a library: the result is a **published name**, and a “smart” rule that changed with a dependency version would break the contract.

#### Shape differences from REST — and why

| REST                                                                     | GraphQL                                     | Why                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------- |
| A `single` type is served by the list route, the client takes `items[0]` | `landing(locale:)` returns the entry itself | `items[0]` is storage leaking into a published API            |
| An owning single relation is a raw FK in `values`                        | `author { name }` — the target itself       | A many-to-one holds at most one target; `items[0]` again      |
| `{ items, total, page, pageSize }`                                       | `{ items, total }`                          | The caller passed page/pageSize itself; echoing them is noise |
| `"published"`                                                            | `PUBLISHED`                                 | The GraphQL enum naming convention; the value maps back       |
| `DELETE` → 204                                                           | `deleteArticle` → `true`                    | Inventing a payload would let the protocols drift             |
| An error carries an HTTP status                                          | 200 + `errors[].extensions.status`          | That is how GraphQL works — the one thing to get used to      |

Everything else is byte-for-byte identical, and `apps/server-e2e/src/server/api-tokens/public-graphql-api.spec.ts` asserts it directly: one fixture, both protocols, a field-by-field comparison.

> **Mutation input fields must have no defaultValue**
>
> The REST `PATCH` merges by **key presence**: a key sent is applied, one omitted is left alone, an explicit `null` clears. graphql-js preserves that — an unmentioned input field is absent from the coerced object — but a `defaultValue` **materializes** the key and turns every omitted field into an overwrite. `build-schema.spec.ts` pins this.

#### One operation's budget

| Limit                  | Default | env                      | What it catches                                                                           |
| ---------------------- | ------- | ------------------------ | ----------------------------------------------------------------------------------------- |
| maxQueryLength         | 16384   | GRAPHQL_MAX_QUERY_LENGTH | An enormous document — before parsing                                                     |
| maxDepth               | 8       | GRAPHQL_MAX_DEPTH        | Deep nesting (one loader batch per level)                                                 |
| maxFields              | 500     | GRAPHQL_MAX_FIELDS       | Aliasing one expensive field N times. Counts **every** selection, aliased and plain alike |
| maxComplexity          | 1000    | GRAPHQL_MAX_COMPLEXITY   | Shallow but wide — the sum of `pageSize` down the nesting path                            |
| operations per request | 1       | —                        | Multiplying every other budget                                                            |

The complexity estimator deliberately assumes any list comes back full (the point is to reject shapes that _could_ be enormous), and it does **not** count `items` as a separate list — that is the very page the parent already measured, and counting it twice would square every list. A `pageSize` passed by variable is read both from the values sent **and from the variable's declared default**: `query Q($n: Int = 500)` runs at 500 whether or not anything was sent. A field with an `id:` or `localeGroupId:` argument costs **one** entry: it addresses one row, and charging it a full page made `article(id:) { author tags translations }` cost 1220 against a budget of 1000 — an ordinary single read rejected as a request that could touch 61 rows.

**There is no rate limiting** — as there is none on the public REST either (throttling sits only at the entrance). This is noted in the documentation as a separate task; the natural key is `request.apiToken.id`.

### 7.9 OpenAPI: the types describe themselves

`@nestjs/swagger` reflects **static** TypeScript, and this plugin's contract is runtime data: one generic set of controllers serves every code-declared type, so the scanner sees `/content/{typeName}` with an opaque string parameter and no response shape at all. So the plugin describes itself through `ServerPlugin.docs.decorate`: `ContentPlugin` closes over its registry and passes `registry.serializeAll()` to `describeContentApi`, which runs **after** the document is assembled and appends only its own paths.

- **Three schemas per type** from the same serialized view the admin UI draws its forms from: `<Type>Values`, `<Type>Entry`, `<Type>ListPage`.
- **`typeName` becomes an enum** of the registered names — a dropdown in the reference instead of a free-text field.
- **Join relations are absent from `Values`** — they own no column, exactly as `toRecord` does not put them there; the description names them and points at `/relations`.
- **A publishable type lists no `required`** — required means “required in order to publish”, and a draft may legitimately omit a field; a non-publishable (always live) one lists them.
- **Every property is `nullable`** — an unfilled field reads back as `null`.

## 08. The admin UI: screens, states, behaviour

The admin plugin **contributes no top-level route and no global navigation item**. It contributes a section into the workspace sidebar (`WORKSPACE_SECTION_SLOT`), a `content/*` route into the workspace shell (`WORKSPACE_ROUTE_SLOT`, with the lowest `order` — making it the workspace's landing page), a command into the global palette (`COMMAND_SLOT`) and eight widgets onto the Insights page (`INSIGHTS_WIDGET_SLOT`). Everything lives only under `/workspaces/:id/content`.

### Routes

| Route                             | Screen                  | What it does                                                                                         |
| --------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| /workspaces/:id/content           | `ContentWelcome`        | A greeting with the workspace's name                                                                 |
| …/content/history                 | `ContentComingSoon`     | A **placeholder** — an icon, a heading, a “coming soon” line                                         |
| …/content/trash                   | `ContentComingSoon`     | A library-level **placeholder** (a collection's trash is a different route below)                    |
| …/content/:typeName               | `ContentTypeView`       | Branches on `kind`: a collection → the records table, a page (single) → the editor for its one entry |
| …/content/:typeName/trash         | `CollectionRecordsView` | A collection's trash (`?deleted=only`), for paranoid types only                                      |
| …/content/:typeName/new           | `ContentEntryRoute`     | An empty creation form. The static segment beats `:entryId`                                          |
| …/content/:typeName/new/:tab      | `ContentEntryRoute`     | The creation form with a tab open                                                                    |
| …/content/:typeName/:entryId      | `ContentEntryRoute`     | The entry editor, default tab                                                                        |
| …/content/:typeName/:entryId/:tab | `ContentEntryRoute`     | The editor with an explicit tab                                                                      |
| …/content/:typeName/\<tab slug>   | `ContentTypeView`       | A **single** type's tabs: each slug is spelled out as a **static** segment so it beats `:entryId`    |
| …/content/\*                      | —                       | A redirect to `.` with `replace`                                                                     |

> **The editor's tabs are routes, not component state**
>
> The editor is remounted by navigations it does not control: switching locale re-targets it at a sibling's id, and that used to drop a person back on General mid-work. The default tab (`general`) is **omitted** from the URL so that a bare entry address stays the canonical short link. `domain/entryTab` determines the open tab from the **last path segment** — the two editor forms share no route parameter (a single's static segment has no parameter at all), and reading the path covers both.
>
> **The slug set is closed.** An `ENTRY_TAB_SLOT` contribution with a slug outside `ENTRY_TAB_SLUGS` is dropped with a console error: the route table would match the segment but `entryTabFromPath` would not resolve it — the tab would render a trigger that navigates and then shows _General_ under a URL saying otherwise. Six slugs: `general`, `relations`, `media`, `access`, `activity`, `history`.

### The records table

- **The data comes from the server, not the client.** Search, the filter tree, sorting and pagination all run on the server; the hook owns no row logic. The URL state (`q`/`filter`/`sort`/`page`/`pageSize`/`view`) is held by `useTableUrlState`.
- **The filter fields are _fetched_, not mirrored.** The former client-side mirror was deleted: with a relation graph, hand-repeating the server's allowlist would turn into user-visible 400s. Hence a failure mode a derived list never had — the panel draws a **loading** state and an **error** state with a retry rather than an empty picker. This is not cosmetic: the Apply gate rejects any rule whose field it could not resolve, so with no definitions Apply could never fire, and an empty picker would be a dead button with no explanation on screen.
- **The filter is an inline accordion, not a drawer.** The “Filters” button expands a full-width panel between the toolbar and the table and _pushes the table down_; collapsed with active filters, it reads as a row of removable chips.
- **Columns.** Order and visibility are chosen in one `Popover` (not a `DropdownMenu` — its menu semantics conflict with dnd-kit's keyboard sensor): the visible ones on top as draggable/keyboard-reorderable rows, the hidden ones below as toggles. The choice is **not persisted** — it lives until a reload and is re-seeded when the type changes. The starting set excludes `richtext` and `json`.
- **The Status column and the status filter appear on publishable types only.** The same rule holds _everywhere publication state is drawn_: the Status row in the properties panel, the Live/Draft/Superseded badges in versions, the badges in the locale menu's rows. On an always-live type they would denote a state the type does not have.
- **Cells state values rather than echoing them.** A `boolean` reads as a localized Yes/No rather than `String(value)`; `money` is formatted as a **number** with a fixed scale of 2 — the field spec has no currency, and the former `currency: 'USD'` was an invention of the admin UI. Raw `select`/`multiselect` values are printed as they are, because the DSL offers no option labels.
- **Relation columns** are a `RelationCell`: a titled trigger (the first link + “+N”) opens a popover with the list; each entry is an `<a target="_blank">` to its own editor with a dimmed `/handle`. Never a raw FK: a ref the server marked `missing` is drawn as “Unavailable record” and carries no link. Loading is two-tiered: the preview from the list response draws the collapsed cell and the popover's first view with **no additional request**, and infinite scrolling takes over from there. The paginating half lives in a nested component mounted _only while the popover is open_, so a table of relation cells registers no idle queries.
- **Two structural caveats for those cells:** they are excluded from the first column's wrapping link (an `<a>` inside an `<a>` is invalid) and they `stopPropagation` so that a click does not trigger the row's navigation. Relation headers render **unsortable** — the server's sort allowlist excludes relations, and a click would silently fall back to `updatedAt`.
- **Rich-text columns** draw a text excerpt rather than the value. A raw cell would show the reader their markup instead of their sentence. Block tags become a space, inline ones vanish without one, and a body with markup but **no words** (an empty `<p></p>`) falls back to an em dash — `isEmpty` does not see that case, since the string is not empty.

### The entry editor

- **Tabs:** General (fields grouped into cards by control shape; media fields excluded from General), Relations, contributed tabs (`ENTRY_TAB_SLOT`) between Relations and History, and History.
- **The properties panel and the action buttons live in the application's chrome.** `EntrySidebar` is portalled into `RightPanelPortal`, `EntryActions` into `PageActionsPortal`. **Portals rather than “hand the shell a node”**, because React resolves context at the point of _render_: rendered by the shell, this content would be cut off from `useCurrentWorkspace` (without which no entry query works), from `EntrySlotContext` and from the editor's own handlers. `createPortal` moves only the DOM.
- **The buttons are in the top bar, because the properties panel can be collapsed entirely, and an entry you cannot save is a trap.**
- **The properties panel is short on purpose.** The publication gate, Details, and whatever a plugin contributes — and nothing that restates what a tab already owns. A truncated Revisions block used to sit here beside a History tab showing the whole timeline with the same Restore, Publish and Preview actions: a second copy of the same list, with a second set of loading and error states to keep honest, and the tallest thing in a panel whose job is properties. It was removed (`ORT-227`), and the locale panel with it — the locale switcher is the title-row chip's menu now, and the translation-group id is one row of **Details**, contributed through `ENTRY_DETAILS_ROW_SLOT`.
- **The publication gate lists what is failing, not what exists.** Passing checks were a re-statement of every required field on the type, which the reader had to scan to find the one red line; with nothing failing the gate is a single sentence (“Every check passes — ready to publish.”) and the heading reads `ready`, and the moment something blocks the list is exactly the outstanding work under a `{n} blocking` heading. **Rendering only** — what fails is still decided once, in the kernel (`content:I-38`); this component counts and draws. Not collapsible, and not to become so: the verdict decides what is shown, so there is no control and no remembered state to fall out of step with the entry. It is built from the **visible** fields — hidden ones (`admin.hidden`), ungranted relations and link-managed relations go into `validationIgnored`. Otherwise a hidden required field showed “ready” in the panel while validation still counted it and a toast named it — a control the user will never find.
- **A required _visible_ link-managed relation is gated on the effective link count** — `total − staged.removed + staged.added` — rather than on the value bag, which does not contain it. To seed those counts, the aggregate relations read fires when the **entry is opened** rather than when the Relations tab is first shown — otherwise a populated relation would momentarily read as 0.
- **Relation edits send nothing until Save** — the staging belongs to `EntryEditor` and survives tab switches; on save it is serialized into a delta.
- **Only relations whose target collection is granted to the workspace are shown.** Hidden ones go into `ignoreFields`, i.e. they are excluded from client-side validation and from the publication gate: a required invisible relation cannot become an unsatisfiable blocker.
- **“Changed” is visible before saving.** A `ChangedBadge` is placed on dirty fields in General and on relation sections with dirty staging. It is **exported from the package's index** so that a contributed tab marks a changed field with the same badge rather than a lookalike that drifts over time.
- **Saving leaves the person in the editor.** Success is a toast, not a bounce back to the list. A new entry navigates to its own `${typePath}/${saved.id}`, an existing one stays put, and a single stays put. The “Back to records” link is the way back.

### Read-only is a form, not just buttons

`EntryEditor` resolves `content:create` (the creation form) or `content:update` (an existing entry) and publishes the answer through the `useEntryReadOnly` context, plus a `readOnly` flag on the field-control and tab contexts so that contributed controls and tabs honour it. Gating the buttons alone was not enough: a reader could rename a page, recolour it and stage an image upload — and only learn at Save that none of it was theirs; the server had been rejecting the write all along, and the interface never said so.

#### Text — `readOnly`

The value stays readable, focusable and selectable, so a reader can copy the entry's contents.

#### Everything else — `disabled`

A select, a multi-select, boolean segments and a date picker have no read-only state — the value is reachable only through a popover, so `disabled` is the only way to close them.

#### Write affordances are **removed**, not dimmed

Assign/remove/reorder a relation, the drag handle, the picker dialogs, the Select/Upload row and the drop zone, the WYSIWYG toolbar. A row of dead buttons reads as a broken editor rather than a preview. The dialogs stay **unmounted**, which also removes their candidate and library queries.

#### Rich text stays expandable

The collapsed preview is height-limited, and removing the way to expand it would stop a reader from reading the very field the page exists for. The control is renamed to **View**, the editor runs with `editable: false`, with no toolbar, no autofocus, and `role="region"` instead of `textbox`.

`runSave`/`save` return early, and `useUnsavedChanges` is not armed. The early return is not belt-and-braces: the editor's `<form>` submits on Enter in a text field, and that is the one save path that goes through no button at all. The `ReadOnlyNotice` banner under the entry's title is **deliberately not** the design system's `Alert`, whose `role="alert"` is a live region — this is page furniture present from the first paint, not an event.

### Four states that must not be collapsed

The recurring defect in this package is confusing a refusal, an absence and a failure. Four rules, each pinned by the `records-resilience.spec.ts` or `entry-validation.spec.ts` e2e suite:

#### A failed catalogue ≠ an empty one

`ContentNavSection` draws a `ContentSidebarError` (an `alert` + Retry) on `isError`. It used to fall into the “nothing granted” branch and return `null`, so the whole Content navigation vanished with no error and no retry while the panel beside it showed a perfectly normal error card. The Retry button there is **primary**, not `outline`: an outline button's card background does not give enough contrast on the sidebar's surface.

#### A URL parameter the server will reject must degrade

`page` is clamped to `pageCount` once the result set settles (guarded by `!isPlaceholderData` so it reads a fresh total), and `pageSize` is narrowed to the allowed set _before_ sending: the server answers **400** above its ceiling rather than clamping, and the resulting error card was a dead end — Retry sends the same parameter, and the “rows per page” control lives in a footer that needs rows to render.

#### A mutation that removed a row must tell the view

`onRowGone(id)` strikes the id from the selection (which is keyed by id and lives across pages) and moves focus to the table's labelled container — otherwise Radix would try to return focus to an unmounted menu and drop it on `<body>`.

#### A field the editor draws nowhere must not gate the form

Hidden fields, ungranted relations and link-managed relations go into `validationIgnored`. The server stays the authority: `submitWith` raises a 422 issue naming an unrendered field into a toast, because it has nowhere inline to land.

### Screen states

| Screen                             | Loading                                                                                      | Empty                                                                                                                                                                                        | Error                                                                                                                                                  | No permission                                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| The Content section in the sidebar | `ContentSidebarSkeleton`                                                                     | Nothing granted — the section is not rendered                                                                                                                                                | `ContentSidebarError`: an `alert` + a primary Retry                                                                                                    | The item carries `permission: content:read`; without it there is no section                                                                  |
| The library (the panel)            | `ContentLibrarySkeleton`                                                                     | `ContentLibraryEmpty`                                                                                                                                                                        | `ContentLibraryError`                                                                                                                                  | A route inside a workspace; reading is gated by `content:read`                                                                               |
| The records table                  | `CollectionRecordsSkeleton`                                                                  | `CollectionRecordsEmpty` — **three** different texts: a search/filter miss (with “Clear filters”), a genuinely empty collection (with “Add record” when creation is allowed), an empty trash | An error card with a retry                                                                                                                             | Add record / the row menu / the selection-bar items are hidden via `useHasPermission`; the “⋯” trigger is not rendered when no item resolved |
| The filters panel                  | A field-loading state                                                                        | —                                                                                                                                                                                            | An error state with Retry — **instead of** an empty picker                                                                                             | —                                                                                                                                            |
| The entry editor                   | An `EntryBusyOverlay` for the duration of a write (blur + spinner + “Saving…”/“Publishing…”) | The Relations tab with no relations — its own empty state                                                                                                                                    | A 422 is laid out over the form's fields; an issue on an unrendered field goes to a toast                                                              | `ReadOnlyNotice` + the whole form read-only                                                                                                  |
| The Insights widgets               | A card skeleton, **each independently**                                                      | “Waiting to go live” with `live === 0` — its own empty state: “0 deferred” would claim a publishing habit the workspace does not have yet                                                    | An error per card, with `retry: 1` rather than three — three attempts with backoff keep a widget on its skeleton for ~7 seconds, which reads as a hang | `permission: content:read` on every element                                                                                                  |

### The cache and refreshing it

- **One refresh pass per write, whatever it is.** `refreshEntryCaches` refreshes the list, the versions, the relations, the per-field links and (unless `skipEntry`) the single-entry read. The single definition is what lets a save→publish chain run it **once at the end** instead of having every mutation re-read along the way: one Publish click used to re-read the entry and its whole feed twice.
- **The key roots are `content-entries` / `content-entry` / …, never `content`.** TanStack matches _segments_, so the obvious `invalidateQueries({ queryKey: ['content'] })` matches **nothing**: `'content' !== 'content-entries'`. It throws nothing and returns no count — the mutation succeeds, the toast appears, the table does not move. `@orthacms/transfer-admin` shipped exactly that after an import. A plugin that writes entries must call the exported `refreshEntryCaches` rather than invent its own key.
- **A write's response seeds the cache.** Every write returns the canonical entry, so a mutation does a `setQueryData` instead of an invalidation. **But only the directly seeded entry is spared** — every other cached entry of the type is invalidated anyway, because one save can rewrite rows it never named: i18n's shared-field synchronization writes an unlocalized field into every sibling, and sparing the whole prefix meant navigating to a sibling showed a pre-save copy until a reload.
- **The keys are workspace-scoped.** The workspace only reaches the server as an ambient header, which is not sent on a cache hit — so without the id in the key, switching workspaces would show the previous one's numbers and never refetch.
- **The three stat tiles share one key**, so TanStack collapses them into a single `content/totals` request while each widget keeps its own loading and error state.
- **The busy overlay is held by view state rather than derived from `isPending`:** a chain's two mutations are both momentarily idle between steps, and a derived overlay would blink mid-flow.

### Accessibility

- **The editor's heading hierarchy:** `h1` is the entry's name on the page, `h2` is “Properties” (the shell panel's heading), `h3` is each panel section.
- **`ENTRY_HEADER_SLOT` renders _after_ the `<h1>`**, so the title stays the only `h1`.
- **Every menu is `modal={false}`.** A modal Radix menu puts `aria-hidden` on the page root, the `aria-hidden-focus` rule fires, and the page along with its `<h1>` drops out of the accessibility tree while the menu is open.
- **A sortable header** sets `aria-sort` on the `<th>` and resets the page; a click cycles asc → desc → off.
- **The localizable indicator** is a globe in a `Tooltip` that opens on hover _and on focus_ (it used to be a bare `span` with a native `title`, which a keyboard or touch user never sees). The trigger suppresses the surrounding `<label>`'s activation, so reading the tooltip does not focus — and, on a toggle, flip — the control it describes.
- **The required asterisk is `aria-hidden`**: the control already announces “required”, and marking up the asterisk would repeat it on every required field.
- **Focus after deleting a view is restored by hand** (`onCloseAutoFocus`): the menu item that opened the dialog is long gone, and Radix's restoration would aim at a detached node.
- **Dialogs do not stack.** The filter in the relation picker is an inline collapsible query builder rather than a drawer: a nested modal over a modal is an a11y hazard. “Restore this version” in the preview hands the number back into the list's own flow with its own `ConfirmDialog` rather than opening a modal over a modal.
- Checked by the `apps/admin-e2e/src/content/a11y.spec.ts` suite and the keyboard scenarios beside it.

### Sixteen extension slots

Slot items are **frozen at startup** (`createAdmin` registers them once before the first paint) — which is exactly what makes hook-style items safe under the rules of hooks when render sites call them in a loop: the call order never changes, and an item gates its own data fetching.

| Slot                       | Where it lands                                                                                                                                                                                                                                                                               | Who fills it                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| RECORDS_TOOLBAR_SLOT       | A control in the table's toolbar; owns the URL parameter keys threaded into the list query and into its key                                                                                                                                                                                  | i18n (the locale switcher)                               |
| RECORDS_MENU_SLOT          | An action over the **collection**, last in the header cluster's “⋯” menu. It draws the **Trash** item itself (that is a _destination_ rather than an action, and it read oddly among the buttons)                                                                                            | transfer (Import…)                                       |
| RECORDS_BULK_ACTION_SLOT   | An item in the selection bar's “⋯” menu, after the built-in Publish/Unpublish/Delete. The bar's layout is **count · Clear · ⋯**: Clear stays outside, because it is the way _out_ of a selection a person may have made by accident                                                          | transfer (Export)                                        |
| RECORDS_COLUMN_SLOT        | An extension column, entering the picker like any other (its header is unsortable); an optional `useRowsData` batches the data for the whole page at once                                                                                                                                    | alarms                                                   |
| RECORDS_FILTER_FIELDS_SLOT | Additional query-builder fields, after the server's                                                                                                                                                                                                                                          | —                                                        |
| ENTRY_SIDEBAR_WIDGET_SLOT  | A **section** of the properties panel (render the exported `EntrySidebarSection`/`EntrySidebarRow`, not a card)                                                                                                                                                                              | alarms (Checks), protection (Review)                     |
| ENTRY_DETAILS_ROW_SLOT     | One **row** of the Details block, after the built-in ones. The component must render an `EntrySidebarRow` (a `<dt>`/`<dd>` pair) or `null` — the rows land inside Details' own `<dl>`. `order` is load-bearing: `getItems()` does not sort, so the render site does                          | i18n (the translation-group id)                          |
| ENTRY_HEADER_SLOT          | An inline element in the entry's title row, after the `<h1>`                                                                                                                                                                                                                                 | i18n (the locale chip, which is also the locale menu's trigger), segments (the “restricted” chip) |
| ENTRY_TAB_SLOT             | A whole editor tab, between Relations and History. The component gets a **bridge to the form** (`values`/`errorFor`/`setValue`/`touch`/`isFieldDirty`), so a field on it rides along with Save, the “Changed” badge, the publication gate and the 422 layout exactly as a General field does | media (Media), segments (Access), activity (Activity)    |
| ENTRY_MENU_SLOT            | An action in an entry's “⋯” menu, in one of four groups: `save` · `publish` · `extras` · `danger`. `useItem` is a **hook** rather than static data; returning `null` is the way to disappear _without skipping a hook_                                                                       | i18n, transfer                                           |
| ENTRY_PARAMS_SLOT          | Non-visual plumbing: the parameters for the single-mode entry read, the URL keys copied into the creation body, and the relation-candidate list parameters                                                                                                                                   | i18n                                                     |
| ENTRY_PRESAVE_SLOT         | A plugin's participation **in the save itself**: `commit(values, publish)` before the write, under the overlay (throwing cancels the save), and `settle(result)` **after** success, still under the overlay                                                                                  | media (deferred uploads), segments (audiences)           |
| ENTRY_FIELD_CONTROL_SLOT   | An override for a field's control. Resolved with `find` rather than a loop (it holds _components_, and mounting runs their hooks); the first match in registration order wins. It may declare a `FullView` — an expanded surface in place of the tab strip                                   | wysiwyg (richtext)                                       |
| ENTRY_PUBLISH_GUARD_SLOT   | The **third gate** on the editor's Publish, the admin counterpart of the server's `CONTENT_PUBLISH_GUARD`. `useVerdict(context, { dirty })` returns `{ blocked, reason?, action?, overlay? }`, or `null` for no opinion; the **first refusal wins** and content never learns what refused it                                 | protection (the approval rule)                           |
| REVISION_EXTRA_SLOT        | A row in a version's preview for state a plugin stores alongside the entry (`RevisionSnapshot.extra`). **Content decides whether the sides differ**, by a structural comparison of the raw values, not the item itself                                                                       | segments (audiences)                                     |
| CONTENT_OVERLAY_SLOT       | Viewport-level chrome, rendered once **outside** `<Routes>`                                                                                                                                                                                                                                  | i18n (the cover during a locale switch)                  |

> **Three recurring slot traps**
>
> **An overlay renders outside `DropdownMenuContent`.** A menu's content unmounts at the very moment the menu closes — that is, exactly when a dialog opened from it must appear. The selection bar additionally unmounts as soon as the selection empties, taking the overlay with it, so an action whose dialog must stay open calls `onDone` on success rather than on opening.
>
> **A cover must outlive what it covers.** `CONTENT_OVERLAY_SLOT` exists precisely because the locale-switch cover used to be drawn by the editor's sidebar widget — that is, inside a tree that unmounts while the target entry loads; it vanished mid-transition and returned afterwards, giving two blinking loaders in a row.
>
> **Someone else's `<form>` cannot save an entry.** The editor's `<form>` ignores any submit whose `target` is not itself: a control portalling a dialog or a popover is moved in the DOM but **not** in the React tree, and React bubbles synthetic events through the tree. A Save button inside the WYSIWYG's alt-text popover reached that handler and saved-and-_published_ the whole entry.

## 09. Configuration

`ContentPlugin` has not one field from the environment — its whole configuration is **code**: the list of types and the host's migrations descriptor. Only the GraphQL adapter is configured from outside.

| Factory              | Option                | Type / default                          | Meaning                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | --------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ContentPlugin        | types                 | `readonly AnyContentType[]`, required   | Every code-declared type. The registry is built eagerly — duplicate names and unresolvable relation targets abort startup                                                                                                                                                                                                                                               |
| ContentPlugin        | migrations            | `{ dir, table }?`                       | The **host's** migrations for the generated tables, routed through the plugin so that an ordinary `db:migrate` applies them with everyone else's                                                                                                                                                                                                                        |
| ContentViewsPlugin   | content               | `ContentServerPlugin`, required         | Taken by value — for the registry that resolves `content:<typeName>` in a view's `scope`                                                                                                                                                                                                                                                                                |
| ContentGraphqlPlugin | content               | `ContentServerPlugin`, required         | By value, so that the name-collision check runs **at composition time**: two types collapsing into one GraphQL name must abort the host's startup rather than the first request from the one workspace granted both                                                                                                                                                     |
| ContentGraphqlPlugin | playground            | `boolean`, **false by default**         | A **composition** option rather than a config key: it is the host that knows whether this deployment shows developer tools. `apps/server` passes `docs.enabled`, so one switch governs both the Scalar reference and GraphiQL. With `false` the controller is **not registered at all** — the route does not exist, rather than a live handler answering with a refusal |
| ContentGraphqlPlugin | limits.maxDepth       | `8` · `GRAPHQL_MAX_DEPTH`               | Nesting depth                                                                                                                                                                                                                                                                                                                                                           |
| ContentGraphqlPlugin | limits.maxComplexity  | `1000` · `GRAPHQL_MAX_COMPLEXITY`       | The cost estimate                                                                                                                                                                                                                                                                                                                                                       |
| ContentGraphqlPlugin | limits.maxFields      | `500` · `GRAPHQL_MAX_FIELDS`            | The total number of selections, aliased and plain alike                                                                                                                                                                                                                                                                                                                 |
| ContentGraphqlPlugin | limits.maxQueryLength | `16384` · `GRAPHQL_MAX_QUERY_LENGTH`    | Document length, checked before parsing                                                                                                                                                                                                                                                                                                                                 |
| ContentGraphqlPlugin | schemaCacheTtlMs      | `60000` · `GRAPHQL_SCHEMA_CACHE_TTL_MS` | How long an assembled schema is reused. **Freshness only**: every read is still authorized against the live grants                                                                                                                                                                                                                                                      |

### Constants baked into the code (not from the environment)

| Constant                                  | Value                              | Why exactly that                                                                                                                                                                                                                                                         |
| ----------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DEFAULT_PAGE_SIZE                         | 25 (server) / 10 (the admin table) | Different questions: an API reads in batches, a person looks at a screen                                                                                                                                                                                                 |
| MAX_PAGE_SIZE                             | 100                                | A hard ceiling on one request's cost. The server answers **400** rather than clamping                                                                                                                                                                                    |
| FILTER_MAX_LENGTH                         | 4096                               | The first line of defence, before parsing                                                                                                                                                                                                                                |
| BULK_MAX_IDS                              | 100                                | Bounds one SQL expression                                                                                                                                                                                                                                                |
| BULK_MAX_SAVE_ITEMS                       | 50                                 | Deliberately **lower** than the previous one: a bulk action sends a list of uuids, while a bulk save sends whole documents with richtext bodies and makes its own transaction for each. It bounds both the request body and how long the workspace's shared lock is held |
| RELATION_PAGE_SIZE                        | 20                                 | A page of one relation field's links                                                                                                                                                                                                                                     |
| DEFAULT_EXPANSION_LIMIT                   | 20                                 | The default for `?relationLimit=`/`?mediaLimit=`. It is **per field per entry**, so the real bound on a response is `pageSize × fields × limit`                                                                                                                          |
| MAX_EXPANDED_FIELDS                       | 10                                 | Per expansion kind. The cost scales with _fields_ rather than rows, and the admin UI bounds only the raw string's length — too loose for a public endpoint                                                                                                               |
| REVISIONS_PAGE_SIZE                       | 20                                 | A page of the version feed                                                                                                                                                                                                                                               |
| PREVIEW_RELATION_REF_CAP                  | 50                                 | How many links a version preview resolves into titles per field                                                                                                                                                                                                          |
| VIEW_MAX_PER_SCOPE                        | 100                                | Views per person in one workspace and scope                                                                                                                                                                                                                              |
| VIEW_MAX_COLUMNS / VIEW_MAX_EXTRA_KEYS    | 100 / 20                           | The bounds of a stored payload                                                                                                                                                                                                                                           |
| DEFAULT_INSIGHTS_DAYS / MAX_INSIGHTS_DAYS | 30 / 365                           | Bounded because each of these endpoints fans out over every type's table: an unbounded `?days=` would let one request scan the whole history of every collection in the workspace                                                                                        |

<details>
<summary>Plugin registration order</summary>

`DatabasePlugin` → `IdentityPlugin` (`PermissionsGuard`, `AccessPolicy`, `ApiTokenService` are needed) → `WorkspacesPlugin` (`WorkspaceGuard`, `lockWorkspaceShared`) → `ActivityPlugin` → `UsersPlugin` → **`ContentPlugin`** → **`ContentViewsPlugin`** (FKs into `users` and `workspaces`, and the migrations run in list order with the dependency declared nowhere) → **`ContentGraphqlPlugin`** → media → i18n (binds `CONTENT_ENTRY_EXTENSION` and reads the registry) → … The ports are injected `@Optional()`, so **removing** one of these plugins degrades quietly rather than aborting startup — which is exactly why `plugins.spec.ts` pins the composition of that list.

`ContentModule.forRoot(registry)` is a **global** module. It exports not only `CONTENT_REGISTRY` and `EntryValidationService`, but everything a `/v1` request is authorized and answered with: `PublicEntriesQuery`, `PublicEntryWritesService`, `ApiTokenGuard`, `ApiTokenWorkspaceGuard`, `WorkspaceGrantsQuery`, the three extension registries, plus `EntryWriterService` (for the proposal appliers), `RelationLinkService` (for i18n's sibling synchronization) and `EntryMatchQuery` (for alarms). The practical consequence: **changing a signature here changes two protocols and four plugins at once.**

It also **binds identity's ports**: `CONTENT_CATALOG` (the type catalogue, so that the grant-issuing flow sees the real code-declared types) and `CONTENT_ENTRY_COUNTER` (a count of a type's rows in a workspace and of the total), so that the “revoke a grant only when empty” and “delete a workspace only when there is no content” checks see the rows actually stored. `countWorkspaceEntries` deliberately counts **every** registered type, granted or not: it backs the workspace-deletion guard, where a missed row means deleting a workspace with data in it.

</details>

## 10. Security and resilience: what was done and why exactly this way

#### A non-grant is indistinguishable from a non-existent type

An unknown `:typeName` and a `:typeName` not granted to the workspace give **one** 404 with one text, and the grants are read _before_ any registry decision. This is a guard rather than a check inside the handler — so that it fires before the controller can let slip an error shaped like the type. The same rule holds in the public REST (`resolveGrantedType`), in GraphQL (the type is simply absent from the schema), in MCP and in the copilot.

#### A read scope can only narrow

The `CONTENT_READ_SCOPE` fragments are ANDed onto an already-formed visibility predicate — there is no return shape that _widens_ a read. They are applied in `liveWhere` rather than `readableWhere`: the list, the single-entry read and the translation lookup (which deliberately bypasses the locale scope) all pass through the former.

#### Every hop asks again — about the _target_ type

A reader allowed to see an entry does not thereby earn the right to see everything it links to — a scope pinned to the requested type would leave every relation target unguarded. **Both** places ask: the hydration of related entries and `RelationLinkService.targetVisibleWhere`, the one predicate shared by every relation read.

#### `total` does not leak the cardinality of what is hidden

While the scope was applied only during hydration, `items` was right and `total` was not: a reader forbidden three of five related entries saw two items under a five and could conclude three were hidden, and paging returned emptiness. The restriction was moved **inside** the window and inside the `count(*)`.

#### A registry instead of a DI token — where two bindings would mean a leak

Nest has **no** multi-providers: two dynamic bindings of one token do not merge, the second silently replaces the first. For a visibility rule that means “content quietly became visible”, for a filter registry “fields silently vanished from the picker and saved filters started giving 400s”, for a write extension “the restriction stopped being applied”. So `CONTENT_READ_SCOPE`, `ENTRY_WRITE_EXTENSION`, `ENTRY_FILTER_PROVIDER` and the copilot's tools are **registries with runtime registration** rather than tokens.

#### A token acts on its own behalf

The issuing user's role is deliberately not consulted: revoking the token itself is enough to revoke its access. The `read`/`full` scope turns into a permission set, and the same `@RequirePermissions` is evaluated by the same `AccessPolicy` as on the session routes.

#### There are no cross-plugin FKs — deliberately

`workspace_id` in the generated tables and asset ids in media fields are ordinary uuids with no foreign keys: the tables belong to other plugins, and plugins are not coupled by schema. The price is that the checks move into the application layer, and there they are: the workspace scope is threaded through every query, and asset existence is checked by the port.

#### A version's key includes the content type

Every version read is keyed by `(content_type, entry_id, workspace_id)`. Without the `content_type` leg, the URL's `:typeName` would never be checked against the version returned, and **any registered type name would serve any entry's history** together with its full snapshot. The same key holds in the copilot's tools.

#### Advisory locks instead of “read, then write”

Three levels. A shared lock on the **workspace** on every write coordinates with the exclusive locks of the emptiness checks when a workspace is deleted or a grant revoked. A lock on the **entry** serializes concurrent savers so that version numbers cannot collide. A lock on the **physical source list** closes the read-modify-write on `max(position)+1`. The inverse loop takes its owners in sorted order so as not to deadlock.

#### `beforeWrite` exists for the sake of lock ordering

By the time `afterUpdate` runs, the transaction already holds a row lock taken by its own UPDATE, outside the extension's control. An extension that then locks a wider set cannot make the acquisition deterministic: two concurrent saves on two members of one set each hold the row the other is about to request, and Postgres kills one with `deadlock detected`. `beforeWrite` runs _before_ the row lock — so a lock taken there imposes a total order, and the second saver waits.

#### The event and the row commit together

Every write runs inside a `UnitOfWork` and takes its executor from `uow.current()`. The write paths used to open their own `db.transaction`, which is exactly why event emission was deferred: an outbox append outside the unit of work commits on its own connection, so an event could outlive a rolled-back write.

#### A uniform 422 with no enumeration signal

A missing, cross-workspace and `accept`-forbidden target all give the same 422 without distinguishing “does not exist” from “not allowed”. A malformed uuid is a 422 too rather than a 500: it is filtered out by a regex before the database trip, because `inArray(<uuid>, ['not-a-uuid'])` is a cast error in Postgres.

### What protects the public API from an expensive request

- **REST's structural bounds:** one route, one page, `MAX_PAGE_SIZE`, a ceiling on expandable fields, a ceiling on the raw filter's length before parsing.
- **Lazy construction of the filter surface** — the relation graph is walked only when `?filter=` was actually sent.
- **Batching instead of N+1:** the relation preview is one window query per _field_ rather than per row; hydrating related entries is one `IN (…)` read per _target type_; media are batched by hand and deliberately **not** through `MediaRefsQuery.forValues` (that one takes one entry's values, and a page would call it row by row — exactly the N+1 the preview exists to avoid). Measured: `pageSize=1` and `pageSize=50` issue the same number of queries.
- **The GraphQL budget** substitutes for the structural bounds a document does not have, and memoizing the walks stops a 788-byte document from occupying the event loop for seconds.
- **What is absent:** rate limiting. Neither the public REST nor GraphQL is throttled — throttling sits only at the entrance to the system. This is recorded in the documentation as a separate task.

### Resilience and degradation

- **The ports are optional.** With `MEDIA_ASSET_RESOLVER` unbound, media fields are validated by shape and stored, but existence and `accept` go unchecked and `/media` answers with emptiness. With no `CONTENT_READ_SCOPE` registered, the port costs one length check. With `CONTENT_ENTRY_EXTENSION` unbound, types with `i18n: true` are forbidden by the boot check and everything else works.
- **An unknown key in `extensions` is ignored rather than rejected** — the bag comes from a client that may be talking to an installation without that plugin, and a 400 would make one and the same request work on one installation and fail on another. The recorded version is still truthful: `capture` reports no state for a key nobody owns.
- **A stale saved view degrades rather than failing.** The payload is stored opaquely and a view outlives the field it referenced; `reconcileColumns` drops column ids that vanished (falling back to the defaults if none survived) and says how many were skipped.
- **Legacy richtext remains a valid value.** Bodies written before the move to a structured document are stored as strings and are read, validated and rendered as strings; the migration was `USING to_jsonb(col)`, so nothing was parsed and nothing could be lost. The editor will rewrite such a value as a document on the next save — content upgrades as it is edited. Everything that reads `richtext` must accept both.
- **An unsafe `pattern` is rejected up front.** A source that will not compile and one at risk of catastrophic backtracking are both rejected and fail the field — a synchronous `RegExp.test` cannot be interrupted.
- **Own properties only.** Both the unknown-key check and the value read use `Object.hasOwn`, never `key in fields` / `values[name]`: `in` would accept `toString`/`constructor`/`__proto__` as known-but-unvalidatable keys, and a bare read would hand a field named `toString` an inherited function as its submitted value.
- **Lengths are counted in graphemes.** `Intl.Segmenter` is a platform global and adds no dependency; where it is absent there is a fallback to code points, which is still closer to the promise than UTF-16 code units (one emoji would cost 2, a family one 11).
- **Richtext emptiness is documental, not JSON-shaped.** `{ doc: [paragraph] }` is what a cleared editor leaves behind, and it must fail `required`.

## 11. Invariants

Statements that must always hold. Both a review list and a starting set of assertions for tests.

- **I-01** — Content types are declared **in code only**; no HTTP route creates, changes or deletes a type or a field.
- **I-02** — The registry is built eagerly at startup: a duplicate name, an unresolvable relation target, an unpaired `relationInverse` and a GraphQL name collision abort **the application's boot** rather than the first request.
- **I-03** — A type with `i18n: true` and no bound `CONTENT_ENTRY_EXTENSION` aborts startup (`EntryExtensionBootCheck`).
- **I-04** — Every content row belongs to exactly one workspace, and **every** read, write and bulk operation ANDs `workspace_id`. An id from another workspace reads as a 404.
- **I-05** — An unknown and an ungranted `:typeName` give the **same** 404 with the same text, and the grants are read before any registry decision — on all four surfaces (the session API, the public REST, GraphQL, the tools).
- **I-06** — The reserved envelope columns (`status`, `published_at`, `deleted_at`, `locale`, `locale_group_id`) can neither be declared as a field nor set from a request body.
- **I-07** — On a publishable type, required fields are **nullable** columns and the required check runs at publication against the _stored_ row; on a non-publishable one they are `NOT NULL` and checked on every write.
- **I-08** — Saving a publishable entry always yields `status = draft` while preserving `published_at`; only `unpublish` clears it.
- **I-09** — Publication re-validates the **stored** row rather than the submitted values; a gate failure is a `422 { message, issues }`, and the entry does not go live.
- **I-10** — At any moment one entry has at most **one** version in `published` status: `markPublished` demotes the previous live one to `superseded` in the same transaction.
- **I-11** — Version history is **append-only**: restoring yields a new version, publishing an earlier version creates no copy, and no version is ever rewritten or deleted.
- **I-12** — Version numbers are monotonic and unique within one `entry_id` — allocated under an advisory lock on the entry and backstopped by a unique index.
- **I-13** — The version, the row, its links, the write extensions' state and the domain event commit in **one** transaction or not at all.
- **I-14** — `entry.updated` is not raised when no field value changed; a bulk write raises one event per **actually changed** row rather than per id passed.
- **I-15** — Every row rewritten by any extension (a shared field, an audience) gets **its own** version, with deduplication — one save never gives one row two versions.
- **I-16** — A public read serves **published content only** by default; `?status=draft|any` requires `content:update`, and a guard checks it, not the query.
- **I-17** — The `CONTENT_READ_SCOPE` fragments can only **narrow** a read; they are not applied to the admin UI's records list.
- **I-18** — An unreachable relation target appears in neither `items` nor `total`: the restriction goes inside the window and inside the `count(*)`.
- **I-19** — A link does not cross locales when both sides are localized; the rule is applied by the **writer** (one `assertSameLocale` implementation reachable from all three write paths), not only by the admin UI's picker.
- **I-20** — A group **write** takes its locale from the query string, never from `body.locale` — that field is for creation only.
- **I-21** — A `relations` key that owns no writable link from this side is a **400**: a delta is never lost silently.
- **I-22** — A structurally malformed relation delta is a 400 at the DTO level rather than a 500 out of the query; the arrays and the map are size-bounded.
- **I-23** — A malformed relation target uuid is a uniform 422 rather than a 500 from a Postgres cast error.
- **I-24** — `?fields=` narrows `values` **and the SQL projection**, the envelope always comes back, an unknown name is a 400, and an empty parameter reads as “no preference”.
- **I-25** — The filter picker physically cannot offer a path the API will reject: the list and the SQL schema come out of **one** `buildEntryFilterSurface` walk; a drift test pins it.
- **I-26** — Every virtual filter field's subquery is scoped by the workspace passed in; on a name collision the **first** declarer wins, not the last.
- **I-27** — The GraphQL schema is built per the workspace's grant set, so introspection cannot enumerate types the workspace was not granted; the cache TTL is a freshness knob, not a security boundary.
- **I-28** — GraphQL mutation input fields have no `defaultValue`, otherwise merging by key presence would turn into overwriting every omitted field.
- **I-29** — Both protocols reject the same input with the same message: the DTOs are validated in the GraphQL resolvers and in the agent tools alike.
- **I-30** — No copilot tool writes to the database: all three write tools have `effect: 'propose'`, and applying goes through the same `EntryWriterService.create`/`.update` as the HTTP routes.
- **I-31** — The copilot's tools have no `status` parameter on any role; bulk publication and bulk deletion are absent from them too.
- **I-32** — A change that reaches into other locales is disclosed in the proposal's `summary` and in `target.fanout` — against the **patched** values.
- **I-33** — Grants are re-checked when a proposal is applied; “not granted” and “does not exist” give one message.
- **I-34** — A saved view is a **bookmark, not a grant**: the payload is replayed with the reader's permissions, workspace and grants, so it cannot show more.
- **I-35** — Someone else's view is neither edited nor deleted **even by an administrator**; setting a personal default is not restricted to the owner; `visibility: 'workspace'` requires `views:share` and is checked on every write.
- **I-36** — A view's `scope` is resolved through the registry **and** the grants, answering with the same 404 — otherwise the endpoint would be a way around `ContentGrantGuard`.
- **I-37** — The `@orthacms/content-domain` kernel declares no dependencies; the `entries/domain/` layer imports neither NestJS, nor Drizzle, nor class-validator, nor its own infrastructure (checked by grep).
- **I-38** — Value validation and the publication gate exist in **one** copy — in the kernel; the admin UI does not mirror them, it localizes the stable English reason.
- **I-39** — An editor without write permission is read-only **throughout**, not just in its buttons; `runSave` returns early, because a `<form>` submits on Enter in a text field.
- **I-40** — A failed type catalogue gives an error state with a retry rather than empty navigation; a URL parameter outside the allowed range degrades rather than leaving the reader in an error card with no way out.

## 12. Testing checklist

Phrased as “action → expected result”. Existing suites: `apps/server-e2e/src/server/content/*` (11 files), `apps/server-e2e/src/server/api-tokens/*` (7 files, including two GraphQL suites and the playground), `apps/server-e2e/src/server/insights/`, `apps/admin-e2e/src/content/*` (16 files, including `a11y`, `records-resilience`, `entry-read-only`, `saved-views`), plus the DB-free unit suites of the kernel, `content-graphql` and the server's pure modules.

### Type declaration and startup

- **Two types with the same name** → the application does not start; the error comes from constructing the registry.
- **A relation to a non-existent type** → does not start.
- **A `relationInverse` pointing at a field that is not an owning relation back** → does not start.
- **A type with `i18n: true` and no i18n plugin** → does not start (`EntryExtensionBootCheck`).
- **A field named `status` on a publishable type** → rejected by `assertFields` at declaration.
- **A required single relation with `onDelete: 'set null'`** → rejected at declaration.
- **`unique: true` together with `many: true`** → rejected: a join table has no column to constrain.
- **Invalid BCP-47 in `lang`** → rejected at declaration.
- **Two types yielding one GraphQL name** → `ContentGraphqlPlugin` fails at composition time rather than on the first request.
- **A many-relation renamed without fixing `joinTableOf`** → a throw while assembling the schema for drizzle-kit rather than the table silently vanishing from the diff.
- **Importing a collection from the main barrel instead of `/define`** → drizzle-kit fails on the decorators.

### Entries: creating, editing, deleting

- **Creating a draft on a publishable type with an empty required field** → 201, the entry is saved, `status = draft`.
- **The same on a non-publishable type** → 422 with a per-field issue.
- **An unknown key in `values`** → silently dropped; a 422 is **not** returned. (A deliberate rough edge — see section 4.)
- **Trying to set `status` or `deletedAt` through `values`** → ignored, the state does not change.
- **A write with no `X-Workspace-Id` header** → 400.
- **A write with the id of a workspace the caller is not a member of** → 403.
- **A `:typeName` not granted to the open workspace** → 404 with the same text as a non-existent type.
- **A POST with a foreign `Origin`** → 403 (`OriginGuard`).
- **A `PATCH` with a field omitted on the admin API** → the field is **cleared** — it is a replacement.
- **A `PATCH` with a field omitted on the public API** → the field is **untouched** — it is a merge; `{"field": null}` still clears it.
- **Editing a published entry** → `status = draft`, `published_at` **preserved**, the badge reads **Modified**.
- **Re-saving an entry with no changes at all** → a version is appended, but there is no `entry.updated` event in the outbox.
- **`DELETE` on a paranoid type** → 204, `deleted_at` filled, the row disappears from the list and from relation reads but is visible with `?deleted=only`.
- **`DELETE` on a non-paranoid type** → the row is gone from the database.
- **A contributor calls `DELETE`** → 403 — only an administrator holds `content:delete`.
- **`pageSize=101`** → 400, not a silent clamp.
- **A malformed `?filter=`** → 400.
- **`?sort=` on richtext / json / multiselect / a relation** → a fallback to `-updatedAt`, with no 500.

### Publication

- **Publishing a valid draft** → 200, `status = published`, `published_at` set, the latest version marked live.
- **Publishing a draft with an empty required field** → 422 listing the fields; the entry stays a draft.
- **Publishing with an empty required many-relation** → 422 `is required`, even when every scalar value is valid.
- **A required scalar field _and_ an empty required relation at once** → only the scalar issues appear — relations are not counted while the values are invalid.
- **Publishing on a non-publishable type** → 400, not a silent success.
- **Re-publishing an already live entry** → idempotent, `published_at` re-stamped.
- **`unpublish`** → `status = draft`, `published_at` **cleared**, the live version back to `draft`.
- **A bulk-publish dry run over a mixture** → a verdict for each: `publishable`, `already-published` (with expandable checks), `blocked`+issues, `not-found`.
- **A bulk publish of the same mixture** → only the valid drafts are published; the partial success is reflected in the response.
- **A bulk unpublish of a list half of which are already drafts** → `count` = the number of real transitions; `updated_at` on the untouched rows did not move.
- **Two concurrent `publish`es of one entry** → a consistent state, with no version-number collision.

### Versions

- **Three saves in a row** → three versions, numbered 1, 2, 3, all `draft`.
- **Publication** → the latest version is `published`, the rest untouched.
- **An edit after publication** → a new `draft` version, and the previously published one **stays** `published`.
- **Publishing v2 while v5 is live** → v2 is marked live, v5 → `superseded`, the feed's length **did not grow**, and the live row carries v2's contents.
- **Restoring v2** → a v6 appeared equal to v2; v2 is still there; the journal has an `entry.updated` naming the fields that came back.
- **Restoring a version that had different audiences** → the audiences came back too (`snapshot.extra`).
- **Reading `/article/<id>/revisions` with another type's `:typeName`** → 404, no snapshot served.
- **A version preview with a relation whose target is soft-deleted** → the row reads as “Unavailable record”, the title does not leak.
- **A version preview with a media field** → thumbnails and file names in the stored order, not bare uuids.
- **The same screen on a non-publishable type** → no Live/Draft/Superseded badges at all.
- **Publishing a version that is no longer valid** → 422; the contents stay applied as a draft — a recoverable state.

### Relations

- **A `link` delta on an owning many-relation** → the links are appended at the end, `position` = `max+1`.
- **An `order` delta on the inverse side** → 400 — only the owning side may reorder.
- **A delta on a single relation** → 400 (a single has `set`).
- **A delta on an unknown field** → 400, not a silent no-op.
- **`link: "not-a-uuid"`** → 400 at the DTO level.
- **A single relation with a malformed uuid in `values`** → 422, not a 500.
- **A link to an entry in another workspace** → 422, with the same message as “does not exist”.
- **A link from the German row to the English tag (both sides i18n)** → 422; verified with a direct API call, not only through the picker.
- **A link from the German row to a non-localized author** → allowed.
- **`by: "localeGroup"` with a group that has no row in that locale** → 422 with an explanation.
- **`by: "localeGroup"` on a non-localized target** → 400.
- **A field sent both in `values` and in `relations.set`** → 400.
- **The same `seo_meta` on two different articles** → 422 with a coherent message, not a 500 naming the constraint.
- **The same `seo_meta` on the English and German rows of _one_ article** → allowed — one-to-one uniqueness is counted per entry, not per row.
- **A page of 50 entries with the relation preview** → the same query count as with `pageSize=1`.
- **Two concurrent additions to one link list** → the positions did not collide, and there is no deadlock.

### The public REST API

- **A request with a session cookie and no token** → 401 — a cookie is not accepted here.
- **A revoked / expired / unknown token** → one and the same flat 401.
- **A two-workspace token with no `X-Workspace-Id`** → 400, not a guess.
- **A single-workspace token with no header** → works.
- **An `X-Workspace-Id` outside the token's basket** → 403, the same as for a non-existent workspace.
- **A draft in the list on an ordinary read** → absent.
- **`?status=draft` with a `read`-scoped token** → 403.
- **`?status=draft` with a `full` token** → the drafts are visible.
- **`?status=something`** → 400 from the DTO, not 403 from the guard.
- **`?fields=title,noSuchField`** → 400 naming the field.
- **`?fields=title,coverImage` (media)** → 400 with a **different** message — “cannot be selected”.
- **An empty `?fields=`** → everything is served — “no preference”.
- **`?fields=title` on a type with richtext** → the richtext column is not read at all (checkable in the SELECT against a live server).
- **`?filter=` with `status`** → 400 `FILTER_UNKNOWN_FIELD`, not an empty page.
- **`?filter=` with a hop into an ungranted type** → 400 `FILTER_UNKNOWN_RELATION`.
- **`?relations=preview` on a type with 11 relations** → 400 asking for the fields to be named, not a silent truncation.
- **A reader forbidden 3 of 5 related entries** → `total: 2`, not 5.
- **`?translations=preview` on a non-localized type** → 400, not `[]`.
- **A group's only published row** → `translations: []`, not a missing key.
- **A group with no published row in the requested locale** → 404, the same as for an unknown group.
- **A read by `:id` with `?locale=zz`** → 400 — the scope is not applied, but the slug is still validated.
- **A group `PATCH` with `?locale=de` and `body.locale = "en"`** → the **German** row is rewritten.
- **A `/bulk` of 50 items, 3 of them invalid** → 200; 47 written, the three carrying their own status and message.
- **A `/bulk` item with only a `localeGroupId` and no `op`** → an addressing error.
- **A write's response** → identical in shape to a read's (it is a re-read, not a mapping).
- **A media URL from a public response opened with the same bearer token** → 401 — the media routes are session-based; a known limitation.

### GraphQL

- **Introspection with two tokens holding different grants** → different SDL; each contains only the granted types.
- **Querying a type the workspace was not granted** → a validation error (the field is absent), not a 404.
- **Revoking a grant, then querying before the TTL expires** → the schema may still describe the type, but the read is refused — the grants are re-checked.
- **The standard introspection query** → passes (exempt from the budget), and GraphiQL and codegen work.
- **A 788-byte document of nine fragments expanding 10⁹ times** → refused immediately; the event loop is not blocked.
- **A cyclic document** → a coherent `NoFragmentCycles` error.
- **Two operation definitions in one request** → refused.
- **`query Q($n: Int = 500)` with no variable supplied** → the cost is computed at 500, not at the schema's default.
- **`article(id:) { author tags translations }`** → passes the 1000 budget — an addressed field costs one entry.
- **`pageSize: -1`** → the same error and the same message as in REST, not a 500.
- **An `update` mutation with a field omitted** → the field is untouched; an explicit `null` clears it.
- **`createArticle(…, relations: { tags: { link: […] } }) { tags { total } }`** → returns the written links, not 0.
- **A mutation without the required permission** → 200 with `errors[0].extensions.status = 403`.
- **One fixture, both protocols** → the fields match, apart from the documented shape differences.
- **`playground: false`** → `GET /v1/graphql/playground` is a 404: the route does not exist, rather than a live handler refusing.
- **Sixteen spellings of `/api/v1/GraphQL/playground`** → RSS does not grow by hundreds of megabytes — the page is memoized into one slot.

### Agent tools

- **A `read`-scoped token calls `content_create`** → refused by the registry before dispatch.
- **An unknown tool argument** → rejected, not ignored.
- **A `pageSize` above the ceiling in an argument** → the same bound as on the HTTP route.
- **`content_update` with a `locale` for addressing** → the named locale's row is rewritten.
- **An ungranted type's name in a tool** → the same message as for a non-existent one.
- **`content_propose_update` on a shared field of a localized type** → the `summary` says how many languages it touches; `target.fanout` is populated.
- **`content_propose_update` with a non-existent field name** → an error, not a silent skip.
- **`content_propose_update` that changes nothing** → refused — there is nothing to propose.
- **`content_propose_bulk_save` with 20 unchanged entries** → the items are dropped; no live page is unpublished.
- **A proposal applied an hour later** → the approved fields were laid over the current state rather than rewinding the entry.
- **A proposal with a stored `localeGroupId` on a creation** → refused (`assertStartsItsOwnGroup`).
- **The bulk applier fails on the fifth of eight** → it stops, and the message says how many were already written.

### Saved views

- **A viewer role saves a personal view** → succeeds — `content:read` is enough.
- **Saving a shared view without `views:share`** → 403; in the UI the Shared option is disabled **with an explanation** rather than simply dead.
- **A second view with the same name, same owner, same scope** → 409.
- **The same name under a different user** → succeeds.
- **An administrator editing someone else's view** → 403.
- **Making someone else's shared view your default** → succeeds — it is a personal choice.
- **Deleting a view that was someone's default** → 204, the default cleared by cascade.
- **`scope=content:nonexistent`** → 404.
- **An ungranted type's `scope`** → the same 404 — `ContentGrantGuard` cannot be bypassed.
- **Opening a view that references a deleted field** → the unknown rules are dropped, the number skipped is shown, and the page works.
- **A bare collection URL with a default set** → the default view is applied, with `replace`, and Back does not bounce.
- **A deep link with `?filter=` while a default is set** → the link wins.
- **A sidebar link to the collection you are already on** → the landing ladder runs again and the default is applied.
- **Clearing the view** → “All records” is selected rather than a silent return to the default.
- **Changing the filter relative to the saved one** → the trigger says “Modified” and offers Save / Save as new / Reset; none of them is primary.
- **Clearing a filter the view never had** → the “Modified” badge does not light up.
- **Reordering the columns** → the badge lights up — column order is meaningful.
- **Opening `/trash`** → there is no view switcher.

### The admin UI: accessibility and resilience

- **The type catalogue answers 500** → an error card with a primary Retry in the sidebar; the navigation does not vanish.
- **The workspace was granted no type at all** → the Content section is not rendered — with **no** error.
- **The filter-fields endpoint answers 500** → the panel shows an error with a retry rather than an empty picker with a dead Apply button.
- **`?pageSize=500` in the address** → narrowed to the allowed value _before_ sending; no dead end with an error card.
- **The last entry on page 3 was deleted** → the page is clamped to `pageCount` once the result set settles.
- **A selected row was deleted** → the id left the selection; focus is on the table's labelled container rather than on `<body>`.
- **A role without `content:update` opens an existing entry** → a read-only banner; text fields readable and copyable; selects disabled; no relation-assignment buttons, no WYSIWYG toolbar, no upload zones; Enter in a text field does not save.
- **The same entry under a role with `content:update`** → a fully live editor — the control case, without which a suite of “absent” assertions would pass on a completely broken form too.
- **A hidden (`admin.hidden`) required field** → the publication gate does not block; the server's 422 about it surfaces as a toast.
- **A required many-relation that does have links** → the publication gate is satisfied the moment the entry opens, with no momentary “0”.
- **An ungranted relation on an entry** → not shown, and it takes part in neither validation nor the gate.
- **Switching locale mid-work on the Relations tab** → the sibling opens on the same tab; the cover does not blink twice.
- **Saving from the Media tab with a staged file** → the file is uploaded on `commit`, the real id is substituted, and everything went out in one write.
- **“Publish all locales” from one sibling's editor** → the open entry's Details block updated too rather than staying on “Modified”.
- **Any menu open** → the page's `<h1>` stays in the accessibility tree (`modal={false}`).
- **A click on a sortable header** → the asc → desc → off cycle, `aria-sort` set, the page reset.
- **Focus on a localizable field's globe** → the tooltip opens; the surrounding `<label>` does not activate the control.
- **Deleting a view from the menu** → a dialog naming it; after it closes, focus returned to the switcher's trigger.
- **The Save button inside the WYSIWYG's alt-text popover** → the entry is **not** saved and **not** published.
- **An insights widget failed** → one card shows an error after at most one retry; the rest are alive.
- **Switching workspaces** → the insights numbers are refetched rather than shown from the previous one.

## 13. Boundaries of responsibility

| Area                                                        | Who owns it                           | What Content does                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| The database connection and running migrations              | `@orthacms/database` + `@orthacms/nx` | Owns the `saved_views` schema files, but not the connection and not the application step                                                         |
| Migrations for the generated type tables                    | **The host** (`apps/server`)          | Builds the table objects and routes the host's descriptor through the plugin                                                                     |
| Authentication, roles, permissions, API tokens              | `identity-server`                     | Uses its guards, `AccessPolicy` and `ApiTokenService`; **binds** its `CONTENT_CATALOG` and `CONTENT_ENTRY_COUNTER` ports                         |
| Workspaces, membership, content grants                      | `workspaces-server`                   | Reads `workspace_content` through `WorkspaceGrantsQuery`, uses `WorkspaceGuard` and `lockWorkspaceShared`                                        |
| Locales: which exist, which is the default, synchronization | `i18n-server` / `i18n-admin`          | Owns the storage **shape** (one row per locale) and declares the port; the locale parameters are opaque strings                                  |
| Files, uploading, previews, serving                         | `media-server` / `media-admin`        | Stores asset ids in the value bag and declares the `MEDIA_ASSET_RESOLVER` port                                                                   |
| Who may read published content                              | `segments-server` / `segments-admin`  | Declares the `CONTENT_READ_SCOPE` registry and ANDs its fragments; segments checks the authorization of its own write itself (`segments:manage`) |
| Alarm rules over content                                    | `alarms-server` / `alarms-admin`      | Exports `EntryMatchQuery`, so that a rule means exactly what the list showed                                                                     |
| Import and export                                           | `transfer-server` / `transfer-admin`  | Exports `EntryWriterService`, so an import cannot outrun validation, the workspace scope or the caller's permissions                             |
| The MCP protocol                                            | `mcp-server`                          | Owns content's **tools**; the protocol and the endpoint are not its business                                                                     |
| The tool registry and call authorization                    | `tools-server`                        | Registers its providers and declares `surfaces` on each tool                                                                                     |
| The copilot's run engine, proposals, change cards           | `copilot-server` / `copilot-admin`    | **Binds** its port: supplies the tools and the appliers, but owns neither the run nor the proposals table                                        |
| The rich-text editor                                        | `wysiwyg-admin`                       | Owns the document _model_ and its structural rules; the editor arrives through a slot                                                            |
| The activity journal                                        | `activity`                            | Emits 7 kinds of `entry.*` events through the outbox; writes no journal rows and **has no** in-band `ACTIVITY_RECORDER`                          |
| The Insights page: the grid, the card shell                 | `insights-admin`                      | Owns the data, therefore owns the widgets; the page knows nothing about entries                                                                  |
| The right panel, the page buttons, collapsing               | `shell-admin`                         | Portals its content in; the collapsed state and its persistence belong to the shell                                                              |

### What else is not here

- **Indexed full-text search.** `?search=` is an `ILIKE` over text-like columns with metacharacters escaped; for richtext the column is cast to text, so what is searched is the serialized tree. A stored indexed text projection is named as the real answer whenever search gets attention.
- **Reference fields in the public `values`.** `relation` and `media` are removed from it, because a bare uuid is an identifier with no route. The omission is declared **temporary**: the schema describes them, and the keys will only be added.
- **Media URLs reachable with a token.** The `url`/`thumbUrl` returned are the CMS's own media routes, gated by `media:read` and membership; a bearer token gets a 401 on them (verified). Either a token-authenticated media route or signed URLs is needed, and neither exists yet.
- **Rate limiting on the public API.** Neither on REST nor on GraphQL.
- **Typed filter inputs in GraphQL.** `filter` is the existing JSON tree behind a `JSON` scalar, so that the filter language and its validator remain exactly one. A generated `ArticleFilterInput` is named as the natural next step.
- **GraphQL subscriptions.** Content events are published to no transport.
- **A schema-cache invalidation hook on grant changes.** The TTL covers it for now; an explicit flush would require a port from `workspaces-server`.
- **Attribution of token-authored writes.** A write made by a token puts `created_by = null` in the version — a version stores a user's id, and a token is not one; the honest answer for now is “System”.
- **An actor on bulk publish and bulk unpublish.** These are the only remaining unattributed writes — their use cases do not take an actor yet.
- **Server-side favourites.** Type pins in the sidebar live in `localStorage`, keyed per workspace; this is named as a planned migration point.
- **Persisting the column selection.** Order and visibility live until a reload. Persisting them is what a saved view is.
- **A second consumer of `CONTENT_ENTRY_EXTENSION`.** The port is a single binding, held by i18n; a second one would need a composite, and it is deliberately not built, so that “narrow a read” and “widen a write” do not merge into one provider where a failure in either half silently takes down the other.

## 14. Divergences between code and documentation

Found while checking this artifact against the sources. Not product bugs in themselves, but they mislead both a developer and a tester.

| Where                                                         | What it says                                                                                                                                 | How it actually is                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/content/server/AGENTS.md, the first paragraph        | “It owns **no database connection and no migrations of its own** — the HOST owns the generated tables and their migrations”                  | There is indeed no connection, but there **are** migrations of its own: a `drizzle.config.ts` + `migrations/0000_saved_views.sql` + the `__drizzle_migrations_content_views` journal, travelling through the plugin's second entry point `ContentViewsPlugin`. Further down the same file the “Migrations” section describes this correctly — so the document contradicts its own header                                                 |
| packages/content/server/AGENTS.md, the “Agent tools” section  | “contributed to the shared **tool registry** in `@orthacms/mcp-server`”                                                                      | The registry lives in `@orthacms/tools-server` (ADR-0007), and the provider imports exactly that: `import { … } from '@orthacms/tools-server'`. `@orthacms/mcp-server` owns only the protocol. The root `AGENTS.md` gets this right                                                                                                                                                                                                      |
| packages/content/server/package.json                          | `@orthacms/mcp-server` in `dependencies`                                                                                                     | There is **not one import** from that package in `src/` (checked by grep across the whole tree). A dead dependency — probably a leftover from the registry's move to `tools-server`; it also drags an extra edge into the build graph                                                                                                                                                                                                    |
| packages/content/admin/AGENTS.md, the “Package” section       | “it contributes **only** to the workspace shell's slots (`WORKSPACE_SECTION_SLOT` + `WORKSPACE_ROUTE_SLOT`)”                                 | There are **four** contributions: those two plus `INSIGHTS_WIDGET_SLOT` (8 widgets — described in a separate section of the same file) and `COMMAND_SLOT` (`ContentTypeCommands`, navigating to any content type from the global palette) — the last of which is mentioned **nowhere** in the document                                                                                                                                   |
| packages/content/admin/AGENTS.md, the routes description      | “The routes are (`index` → `ContentWelcome`, `:typeName` → `ContentTypeView`, `:typeName/new` + `:typeName/:entryId` → `ContentEntryRoute`)” | `ContentLibraryPage` has **ten** routes. Not named: the two top-level `history` and `trash` placeholders drawing `ContentComingSoon` (“coming soon”), the collection trash route `:typeName/trash`, the static tab segments for single types, and the catch-all redirect. The `/content/history` and `/content/trash` placeholders are meanwhile documented nowhere in the group — and are easily mistaken for a broken collection trash |
| packages/content/server/AGENTS.md, the “HTTP surface” section | Lists the entry routes in a list that omits `GET /content/:typeName/:id/media`                                                               | The route exists (`get-entry.controller.ts`) and is described in another section of the same file (“Media fields”). A reader of the HTTP-surface section will not find it                                                                                                                                                                                                                                                                |
| packages/content/server/AGENTS.md, “Public content API”       | The “Writes (`full`-scope tokens)” table lists six rows of write routes                                                                      | The controller has **thirteen** write routes: the table does not show the group forms (`PATCH`/`publish`/`unpublish`/`DELETE` on `group/:localeGroupId`), even though the paragraph below asserts that “every single route exists twice”. The completeness is in the prose only, not in the table                                                                                                                                        |
| packages/content/domain/AGENTS.md                             | “`content-admin` … its `presentation/entryValidation` runs `validateFieldValue` as the sole rule set”                                        | True but incomplete: the admin UI's publication gate is built from the **visible** fields, while hidden, ungranted and link-managed ones land in `validationIgnored` — so the “sole rule set” is applied to a reduced set of fields. This is described in `admin/AGENTS.md` and not reflected in the kernel's description, from which a reader infers full coverage                                                                      |
| packages/content/graphql/AGENTS.md, “Cost limits”             | “**Rate limiting is absent** — and so it is on the REST public API”                                                                          | Confirmed by the code — no divergence, but worth noting as a **consistent, documented gap** rather than a forgotten detail: the system does have a throttler, and it sits only on identity's public sign-in routes                                                                                                                                                                                                                       |

---

**The second of the series.** Written for the `packages/content` group on the pilot Identity skeleton: business description → composition → permissions → data → lifecycle → scenarios → API → admin UI → configuration → security → invariants → checklist → boundaries → divergences. The sections the group does not have were dropped; subsections for GraphQL, the agent tools and the admin slots were added.

The source is the source code: the type DSL and registry, the controllers and their guards, the DTOs and validators, the Drizzle schema and migrations, the use cases and the write engine, the public `public-api/`, the GraphQL resolvers and schema assembly, the MCP and copilot tool providers, and the admin UI's pages, hooks and slots. The `AGENTS.md` files (3311 lines across four packages) were used as a skeleton, but every statement was checked against the implementation — the divergences found are collected in section 14.
