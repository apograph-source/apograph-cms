# Segments

_Package group · packages/segments_

**Who may read what is published — Ortha reader entitlements**

Segments answers exactly one question: **which readers are entitled to see a published entry**. This is neither RBAC nor `workspace_content` — those decide _who may touch_ content and exist independently. Here an audience is a named set of reader tags, an entry names the audiences it admits and the ones it refuses, and the entire decision fits into one pure `canRead` function and one SQL predicate applied to every public read.

- **3** packages in the group
- **10** HTTP routes
- **2** database tables
- **2** migrations
- **2** permission keys
- **4** agent tools
- **3** admin screens
- **6** slot contributions
- **0** dependencies in the kernel

## Contents

- [01. Business description](#01-business-description)
- [02. Composition of the package group](#02-composition-of-the-package-group)
- [03. Roles and permissions](#03-roles-and-permissions)
- [04. The canRead truth table](#04-the-canread-truth-table)
- [05. Data model](#05-data-model)
- [06. Lifecycle](#06-lifecycle)
- [07. Scenarios — how it works, step by step](#07-scenarios-how-it-works-step-by-step)
- [08. HTTP API](#08-http-api)
- [09. Agent surfaces — MCP, the copilot, the token](#09-agent-surfaces-mcp-the-copilot-the-token)
- [10. The admin UI: screens, states, behaviour](#10-the-admin-ui-screens-states-behaviour)
- [11. Configuration](#11-configuration)
- [12. Security: what was done and why exactly that way](#12-security-what-was-done-and-why-exactly-that-way)
- [13. Invariants](#13-invariants)
- [14. Testing checklist](#14-testing-checklist)
- [15. Boundaries of responsibility](#15-boundaries-of-responsibility)
- [16. Where the code and the documentation diverge](#16-where-the-code-and-the-documentation-diverge)
- [17. What the QA pass found](#17-what-the-qa-pass-found)

## 01. Business description

Segments is the “guest list” for published content. Everything else in the CMS answers the question “what may a _staff member_ do”; this plugin answers the opposite one — “what will a _reader_ see”.

### The problem it solves

- **Content for one specific customer.** Documentation, a price list, release notes available to Acme and to nobody else. That used to mean a separate site or a hand-rolled check in a template; here it is two lists on the entry.
- **Exceptions to a general rule.** “Everyone in Europe except this one customer” is expressed by a single deny — because a deny beats an allow. Were the rules to compose the other way round, that sentence could not be said at all.
- **One answer across three protocols.** The decision compiles into a predicate inside the shared query builder, so REST, GraphQL and MCP are closed by the same code. Not three implementations to keep in agreement, but one.
- **Resilience to renames on the outside.** A reader arrives with identifiers _your_ application already knows (`acme`, `plan-pro`, an organisation id). An audience says which of them it responds to. If an identifier changes in billing, one line in the directory is edited rather than every entry.
- **Nothing breaks on installation.** Until at least one audience exists the plugin is inert: the catalogue is empty, no predicate is emitted, and a public read is byte for byte what it was. That is the state every existing installation is in.

### Who sees it

#### The editor

Sees a chip by the entry's title (“Everyone” or “Restricted”) and an “Access” tab where each audience has one three-state control. The tab has no “Save” button — the decision travels with the entry's own save.

#### The administrator

Owns the vocabulary: creates audiences, edits their reader tags, decides which workspaces an audience is even offered in. It is the only role with access to the `segments:manage` permission.

#### The reader

Sees nothing and knows nothing. They simply do or do not receive an entry — and cannot tell “hidden from me” from “does not exist”: a restricted entry is absent from both `items` and `total`.

### What Segments is not

The boundaries matter more than the capabilities here — because the name “segments” usually promises something quite different:

- **It is not RBAC.** Roles and permissions decide who may _touch_ content — create, edit, publish. Segments decides who may _read_ what is already published. There is exactly one overlap: the `segments:manage` permission is itself part of RBAC.
- **It is not `workspace_content`.** Content grants say which types a workspace has. That is about touching too.
- **It is not a rules engine.** There is no rule object, no inheritance, no order of application, no per-collection or per-workspace defaults. There are two lists on an entry, and what the editor put in them is what the reader gets.
- **It is not personalisation.** The plugin does not serve different content to different readers and does not segment by behaviour. It only answers “yes” or “no” about one specific entry.
- **It is not reader authentication.** Where a reader's tags come from is something the plugin fundamentally does not know: that is the `SegmentResolver` port, implemented by the host.
- **It is not a records-list filter in the admin UI.** The three virtual filter fields (“visible to”, “hidden from”, “is it restricted”) are an editor's questions about their own library, not a visibility rule. An editor sees their workspace's entries either way.

> **The architecture's key idea**
>
> The model is deliberately reduced to **two lists and three rules**. The price is the absence of defaults and inheritance. The gain is that **the row the editor saved is exactly the row the reader is compared against**: nothing to recompute, nothing to project, nothing for a background pass to catch up on. So a write is one upsert, and a “200” means the change is already in force.

> **Two emptinesses that read in opposite directions**
>
> **An empty allow list means “everyone”**, not “nobody”: that is the state every entry is in before anybody decided anything, and reading it as a closed door would black out the whole library on the day the feature was switched on. **An absent reader context means an anonymous reader**, not an unrestricted one: a path the middleware did not cover gets public content and nothing beyond it. Both emptinesses are deliberate, and they point in different directions.

## 02. Composition of the package group

The `packages/segments` group is three packages. The split is load-bearing: the domain kernel has to be checkable by a truth table _without_ a database, without Nest and without React, and the admin UI has to read the same validation rules as the server DTO.

| Package | npm name                  | Role                                                                                                       | What it owns                                                                                                                                                                                      |
| ------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain  | @ortha/segments-domain | The framework-free kernel: the model itself and the decision itself                                        | `canRead`, `isOpen`, `sameAccess`, `isOfferedIn`, `segmentIdsForTags`, the `SegmentResolver` port, `validateSegment` + four limits. **Zero dependencies** in its `package.json`                   |
| server  | @ortha/segments-server | The NestJS plugin: two tables, three controllers, one predicate, four agent tools                          | The schema and migrations, `SegmentReadScope` (the `CONTENT_READ_SCOPE` implementation), `EntryAccessWriteExtension`, `AccessFilterProvider`, the catalogue cache, two `AsyncLocalStorage` stores |
| admin   | @ortha/segments-admin  | The admin plugin: the audience directory + the “Access” tab + four contributions into other people's slots | `/segments`, `/segments/new`, `/segments/:segmentId`, the chip by the entry's title, the pre-save step, the revision line, the records-list filter fields                                         |

### How the files are laid out inside

#### `server/src/lib`

`schema/` — `segments` and `entry_access`. `application/` — `segment-catalog.service.ts` (the cache), `reader.store.ts` (who is reading), `principal.store.ts` (who is acting), `segments.service.ts` (the dictionary CRUD), `entry-access.service.ts` (the whole write path). `infrastructure/` — `segment-read-scope.ts`, `entry-access-write-extension.ts`, `access-filter.provider.ts`, `locale-group.query.ts`, `uuid-array.ts`. `http/` — two middlewares and three controllers. `tools/` and `copilot/` — the agent surfaces.

#### `admin/src/lib`

A layered layout: `domain/types.ts` (the three-state algebra — `stateOf`, `withState`, `withStates`), `infrastructure/segmentsGateway.ts` (the port + the HTTP implementation + the cache keys), `application/` (the TanStack Query hooks, `useEntryAccessPresave`, `useAccessFilterFields`), `presentation/` (the plugin factory, two pages, eleven components).

> **Neighbours easily confused with it**
>
> **`@ortha/identity-server`** owns the `segments:read` / `segments:manage` permission keys and their distribution to the system roles, plus the API-token scope mapping. **`@ortha/content-server`** owns the `CONTENT_READ_SCOPE` and `EntryWriteExtension` ports and the filter-field registry; Segments _registers_ into them. **`@ortha/copilot-server`** owns the proposal-applier registry. **`@ortha/tools-server`** owns the tool registry and call authorization.

## 03. Roles and permissions

There are exactly two permissions, and they are split not by “read/write data” but by the **weight of the consequences**.

| Permission      | What it opens                                                                                   | admin | contributor | viewer |
| --------------- | ----------------------------------------------------------------------------------------------- | ----- | ----------- | ------ |
| segments:read   | See the audience directory, see who an entry is available to, filter the records list by access | ✓     | ✓           | ✓      |
| segments:manage | Create, rename, re-tag, re-scope and delete audiences; change the two lists on an entry         | ✓     | —           | —      |

> **Why reading is given to all three roles**
>
> An editor who **cannot see** that an entry is restricted will publish it believing it is public. This is not about the audience list being private, it is about a setting hidden from the editor producing a mistake the reader notices rather than the author. So both the contributor and the observer hold `segments:read`.

> **Why managing is the administrator's alone**
>
> Renaming one audience's tags changes who can see **every entry that names it** — across the installation and without a single event in the editor's interface. Deleting an audience rewrites both lists on every entry that held it. This is dictionary administration, and it stays on a screen with a session, where a person reads the consequences spelled out in a confirmation dialog.

### How a permission reaches the code — three different paths

#### Through a route guard

`@UseGuards(PermissionsGuard)` + `@RequirePermissions(PERMISSIONS.SEGMENTS_READ | SEGMENTS_MANAGE)` on the directory controllers and on `PUT /segments/entries/:entryId`. The ordinary path.

#### Through the entry write extension

Saving an entry asked for `content:update` — a **different** authority. So `EntryAccessWriteExtension.assertMayManage` fetches the actor from `PrincipalStore` itself and asks `PermissionsService.forRole`. An actor that could not be identified is refused, not waved through.

#### Through a token scope

`scopePermissions` in identity: the `read` scope carries `segments:read`, the `full` scope carries `segments:read` + `segments:manage`. The tool registry checks the same thing before a call.

| API-token scope | segments:read | segments:manage | What it actually grants                                                                                |
| --------------- | ------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| read            | ✓             | —               | Asking whether an entry the token can already read is restricted. Nothing new about the content itself |
| full            | ✓             | ✓               | The same plus rewriting both lists on an entry. The audience dictionary is **not** opened by any scope |

The reasoning is in the code (`packages/identity/server/src/lib/api-tokens/domain/api-token-scope.ts`): a token that cannot ask whether an entry is restricted is a client quietly passing a partial list off as a complete one. And assigning audiences to an entry is an editorial decision of the same weight as publishing or deleting, which `full` already grants.

## 04. The `canRead` truth table

Three rules applied strictly in this order, and the order **is** the specification:

1. **A deny wins.** A reader who falls into any refused audience is cut off — however many allow lists they satisfy.
   _without this, “everyone in Europe except one customer” could not be expressed_
2. **An empty allow list means “everyone”.** Not “nobody”.
   _the state every entry starts in_
3. **Otherwise the reader must be on the allow list.** Including an anonymous reader, who belongs to no audience and therefore sees only entries with an empty allow list.

Below are all the meaningful combinations. `A` and `B` are audiences; the “reader's tags” have already been resolved into a set of audience ids by `segmentIdsForTags`.

| allow      | deny  | The reader's audiences           | Result        | Which rule fired                                       |
| ---------- | ----- | -------------------------------- | ------------- | ------------------------------------------------------ |
| — (no row) | —     | anything, the empty set included | reads         | `COALESCE(…, true)` — an unrestricted entry            |
| \[\]       | \[\]  | {} (anonymous)                   | reads         | rule 2: an empty allow means “everyone”                |
| \[\]       | \[\]  | {A}                              | reads         | rule 2                                                 |
| \[A\]      | \[\]  | {} (anonymous)                   | does not read | rule 3: an anonymous reader belongs to no audience     |
| \[A\]      | \[\]  | {A}                              | reads         | rule 3: the intersection is non-empty                  |
| \[A\]      | \[\]  | {B}                              | does not read | rule 3: no intersection                                |
| \[A, B\]   | \[\]  | {B}                              | reads         | rule 3: **any one** of the allowed audiences is enough |
| \[A, B\]   | \[\]  | {A, B}                           | reads         | rule 3                                                 |
| \[\]       | \[A\] | {A}                              | does not read | rule 1: a deny wins                                    |
| \[\]       | \[A\] | {B}                              | reads         | rule 1 did not fire → rule 2                           |
| \[\]       | \[A\] | {} (anonymous)                   | reads         | exactly “everyone except A”                            |
| \[A\]      | \[A\] | {A}                              | does not read | rule 1 before rule 3 — a deny beats its own allow      |
| \[A\]      | \[B\] | {A, B}                           | does not read | rule 1: caught by a refused audience                   |
| \[A\]      | \[B\] | {A}                              | reads         | rule 1 missed → rule 3 hit                             |
| \[A\]      | \[B\] | {B}                              | does not read | rule 1                                                 |

> **The row rule 1 exists for**
>
> The combination `allow=[A]`, `deny=[A]` is a state the server **will accept** and the reader will resolve as “denied”, while the editor's screen would have said “allowed”. So the client-side `withState` function **removes first and adds second**: that makes such a state unreachable from the interface, and it is the one place in the admin domain model covered by a dedicated unit test (`types.spec.ts`: “never leaves a segment in both lists”).

### The same thing in SQL, line for line

| Predicate fragment        | The kernel's rule                                     |
| ------------------------- | ----------------------------------------------------- |
| NOT (ea.deny && $reader)  | Rule 1 — a deny wins                                  |
| cardinality(ea.allow) = 0 | Rule 2 — an empty allow means “everyone”              |
| OR ea.allow && $reader    | Rule 3 — the intersection with the reader's audiences |
| COALESCE((…), true)       | No row at all — an unrestricted entry                 |

The full form, as `SegmentReadScope.scope()` assembles it:

| SQL                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| COALESCE(( SELECT NOT (ea.deny && $reader) AND (cardinality(ea.allow) = 0 OR ea.allow && $reader) FROM entry_access ea WHERE ea.entry_id = article.id ), true) |

> **An anonymous reader works without a single special case**
>
> For an anonymous reader `$reader` is `'{}'::uuid[]`. The intersection operator `&&` against an empty array is false in both directions: the deny does not fire (nothing denies them), and the allow list does not fire (they belong to no audience). Exactly the behaviour the three rules describe — and there is no “if the reader is empty” branch anywhere in the code.

> **What canRead does not look at**
>
> The function **never** consults `isOfferedIn`. Where an audience is _offered_ for selection is an editor's question (“can I pick it here?”), not a reader's. A saved decision means what its author meant; overriding it from a screen about an audience's availability would change who reads published content while neither of the two screens said a word about it.

## 05. Data model

The plugin owns **two** tables and ships its own migrations: a `drizzle.config.ts` + committed `migrations/*.sql`, its own journal table `__drizzle_migrations_segments`, and a thunk for the migrations directory so it resolves both when consumed from source and when installed from npm. It opens no database connection: the client is injected from `@ortha/database`.

| Table        | Purpose                                        | Key fields and constraints                                                                                                                                                                                                                                                                                              |
| ------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| segments     | The audience dictionary, **installation-wide** | `id` uuid PK · `key` text **unique** · `label` text · `tags` text\[\] default `'{}'` · `workspace_ids` uuid\[\] default `'{}'` · `created_at`, `updated_at`.<br>Indexes: a btree on `label` (the directory's order), a **GIN** on `workspace_ids` (the question “which audiences apply here” is an array intersection). |
| entry_access | One row per **restricted** entry               | `entry_id` uuid **PK** (one row per entry, not per decision) · `workspace_id` uuid · `type_slug` text · `allow` uuid\[\] · `deny` uuid\[\] · `updated_at`.<br>Indexes: **GIN** on `allow` and on `deny` (the `&&` operator in the predicate), a btree on the `(workspace_id, type_slug)` pair.                          |

### Four schema decisions, each load-bearing

#### One row per entry, not per decision

A read asks **one** question of **one** row: the predicate is a primary-key probe and two array intersections, not a join. The whole answer for an entry arrives at once, which is why a write is an ordinary upsert of what the editor sent.

#### The absence of a row means “unrestricted”

Two empty lists lead to a `DELETE` of the row rather than to keeping it. Otherwise every entry anyone ever opened would cost a row on the read path. The other half of that decision is the `COALESCE(…, true)` in the predicate.

#### No cross-plugin foreign keys

Neither `entry_access.workspace_id` nor `segments.workspace_ids` has an FK: `workspaces` belongs to identity, and plugins are not bound by schema. A deleted workspace leaves an id that corresponds to nothing — which **narrows** an audience rather than widening it.

#### `workspace_id` and `type_slug` are carried, not joined

A read does not need them — `entry_id` is unique by itself. But they are what lets you ask “what is restricted in this collection” without touching a single content table, and they are what the records-list filter keys on.

### The migrations

| File                        | What it does                                                                     | Why it is its own migration                                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0000_init.sql               | Creates both tables, the uniqueness of `segments.key` and four indexes           | The initial delivery                                                                                                                                                                                                    |
| 0001_segment_workspaces.sql | Adds `segments.workspace_ids uuid[] NOT NULL DEFAULT '{}'` and a GIN index on it | The `'{}'` default reads as “offered everywhere” — the state every existing row is already in. Reading the emptiness as “nowhere” would have made every audience vanish from every editor on the day the column shipped |

> **The catalogue cache is part of the data model, not an optimisation**
>
> `SegmentCatalogService` holds the **whole** directory in memory, because the read path needs it **synchronously**: the predicate is assembled inside a query builder that cannot `await`, and the reader's tags have to become audience ids _before_ the query is built. It is loaded in `onApplicationBootstrap`, that is, inside `app.init()`: a catalogue that could not be read **aborts the start** rather than leaving a server that serves restricted content as if nothing were configured. A full reload runs after every write to the directory — the set is bounded by how many audiences a business has, and that is cheaper than any invalidation scheme worth writing.

> **A consequence for tests**
>
> The catalogue is in memory, and `resetDb` `TRUNCATE`s behind its back. So `apps/server-e2e/src/support/segments.ts` has a `reloadSegmentCatalogue(app)`, and every suite that touches segments must call it right after `resetDb` — otherwise `configured` stays true and nonexistent ids keep passing validation.

## 06. Lifecycle

### 6.1 An installation's lifecycle

**the plugin is registered, no audiences** — the first audience is created → **the catalogue is non-empty, a predicate is emitted** — the last one is deleted → **inert again**

| State    | What `SegmentReadScope` does                                                                                        | What `ReaderMiddleware` does                                                             | What is visible in the admin UI                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| inert    | `catalog.configured === false` → returns `undefined`, no fragment is added, and a read is byte for byte what it was | `next()` immediately, the resolver is not called                                         | The chip by the entry's title is not rendered at all; the filter fields are not offered; the “Access” tab shows a “there are no audiences here yet” state |
| in force | Emits the predicate on every public read and on every relation traversal                                            | Calls the resolver, resolves the tags into ids, puts the reader into `AsyncLocalStorage` | The chip, the tab with its controls, the three filter fields, and the “Who can read this” line in the revision preview                                    |

Separately: `ReaderMiddleware` also passes through when the resolver is **not configured**. Then every reader is anonymous — and that is a working configuration rather than a broken one: unrestricted content is served, restricted content is not.

### 6.2 An audience's lifecycle

| Transition                    | What happens to entries                                                                                                                                                                        | Why it works that way                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creation                      | Nothing. The new audience is named by nobody, `usageCount = 0`                                                                                                                                 | The tags default to the key — which is what the administrator meant in every case except the one where they said otherwise. Workspaces get no default: empty already means “everywhere” |
| Renaming the `label`          | Nothing. Entries hold an **id**                                                                                                                                                                | Directory cosmetics                                                                                                                                                                     |
| Changing the `tags`           | Nothing in the data, but **who falls into the audience changes**                                                                                                                               | Exactly what the indirection exists for: an identifier renamed on the billing side is one edited line here rather than a migration across every entry                                   |
| Narrowing the `workspace_ids` | Nothing. Entries that already name the audience keep naming it and keep reading the same                                                                                                       | The audience stops being _offered_ on new decisions. Quietly rewriting saved access from a screen about an audience's availability is an action nobody would connect to what they did   |
| Deletion                      | One transaction: a `DELETE` of the dictionary row + `array_remove` from `allow` and `deny` on every entry that held it + a `DELETE` of those `entry_access` rows whose lists both became empty | A leftover id would point at an audience that resolves to “nobody”: on the `allow` side that quietly closes content, on the `deny` side it quietly opens it, and no screen explains why |

### 6.3 An entry's access lifecycle

**no row — everyone reads** — the editor set a control and saved → **a row exists — restricted** — both lists are empty again → **the row is deleted**

Three transitions, each with its own entry point in the code:

- **An explicit decision** — `EntryAccessService.set` through `setForGroup`. A wholesale replacement, not a merge: only a full replacement can express a _removal_; a merge has no spelling for “this audience is no longer mentioned”.
- **Inheritance when a translation is created** — `inheritFromGroup`. The new row gets the group's lists verbatim, with no workspace-scope check and **no permission check**: nothing is being decided, the row is simply joining an entry that already carries those audiences.
- **Restoring a version** — the same `apply`, but the `value` comes from the snapshot's `extra`. A version that named no `access` key leaves the access **alone**.

> **Access is not a translatable field**
>
> “Who may read this” is a fact about the **entry**, not about its German wording. So access travels as a non-translatable field: set on one locale, set on all. Left per row, it was a hole invisible from any screen: an editor restricted the English article and published the German one to everybody. The locale group is resolved through `localeGroupIds`, which reads content's **own** `locale_group_id` column rather than going to `@ortha/i18n-server`: an entitlement rule must not depend on a plugin a deployment may not have, and the honest fallback (“the entry is alone”) is exactly what a non-localised type already gets. **Soft-deleted** siblings are included deliberately, as in i18n's own propagation: a locale in the trash will come back on restore, and it must come back with the group's access.

## 07. Scenarios — how it works, step by step

There are four ways into the plugin, and they differ in **who is acting**: the admin screens (a session), the `extensions` bag on an entry save (a session, but with no route of its own), a bearer token (its own actor) and the agent tool catalogue (acting on a person's behalf). Below are all the meaningful paths, ordered from “how it gets switched on” to “how machines use it”.

### 7.1 The first audience: how an installation stops being inert

1. **The administrator opens `/segments`.** The page is gated on `segments:read`; without it there is a dedicated “you do not have access to segments” state naming the permission to ask for, rather than an empty list.
   _the sidebar item carries permission: SEGMENTS_READ, otherwise it would be a dead link_
2. **An empty directory explains the consequences of doing nothing.** The empty state's text says outright: while there is no audience, every published entry is read by everyone and nothing in your content API changes. This is not “no data” but a description of a working state of the system.
3. **“New audience” leads to a `/segments/new` page, not a dialog.** An audience stopped being three short fields the moment it acquired a workspace list that grows with the installation. A modal that scrolls is a modal that outgrew itself; and a page has a URL, so “look at this one” becomes a link rather than a set of directions.
4. **The key follows the name until it is taken over.** `derivedKey = keyTouched ? key : slugify(label)` — the same convention as a workspace's slug: a derived value is almost always right, and typing in the field means “not here”.
   _while editing, the key is read-only: it is also the default reader tag_
5. **Validation comes from the kernel, not from the form.** `validateSegment` is the same function whose constants the server DTO reads. Two copies of a validation rule are two copies that will drift, and it will surface in the worst possible way: the form accepts what the API then rejects with a 400 whose text was written for a different audience.
6. **Errors show on blur or on submit, never on the first keystroke.** A key is invalid for as long as it is being typed, and a complaint on the second character is noise about a state the person is already leaving. Meanwhile the “Create” button is **never disabled**: a dead button explains nothing, and pressing it is how somebody with an unfocused field finds out where the error is.
7. **`POST /api/segments`.** The server checks the key's uniqueness itself and answers `409` when it is taken. The form deliberately does **not** hold a local list of keys: the directory is paginated, and “the existing keys” would be one page of it — a check that is right most of the time is worse than one that is honestly late.
   _the 409 lands on the key field, remembering the refused key itself — the message clears as soon as another is typed_
8. **The tags default to the key.** An audience with no tags matches nobody, that is, it can only close content off. An empty workspace list gets no default — the emptiness already means “in all of them”.
9. **`catalog.reload()` — and from this moment the system is a different one.** `configured` became true: `SegmentReadScope` starts emitting the predicate, `ReaderMiddleware` starts calling the resolver, `AccessFilterProvider` starts offering the three filter fields, and the chip by the entry's title starts rendering.
   _leaving the inert state is this feature's only “switch-on”; there is no configuration flag_

### 7.2 An editor restricts an entry — the main write path

This is the most important flow in the whole plugin, and it is deliberately built **not** to be a request of its own.

1. **The chip by the entry's title.** `EntryAccessChip` in `ENTRY_HEADER_SLOT` asks `useSegments({ workspaceId, pageSize: 1 })` — it needs to know _whether there is any_ audience at all, not which. At `total === 0` it renders **nothing**: a badge asserting anything about access would be an assertion about a system that is not running.
   _the chip sits by the title rather than in the right-hand properties panel: the moment access matters is the moment before publishing something believed to be public, and that moment happens while writing, not while auditing a properties column_
2. **Clicking the chip leads to the tab.** A link, not a popover: the tab is one click away and holds the whole answer, while a hover card would be a second rendering of the same thing to keep in agreement. The path is built explicitly, because on a **singleton** page the editor is mounted on the type itself (`${typePath}/access`), while a collection row nests its tabs under the entry id (`${typePath}/${entry.id}/access`).
3. **The tab's slug belongs to content, not to us.** `ENTRY_TAB_SLOT` discards an item whose slug is outside `ENTRY_TAB_SLUGS`: the route table would match the segment, and `entryTabFromPath` would not be able to resolve it. So `access` is declared in `ENTRY_TAB` inside `content/admin`.
4. **The tab issues two requests.** The audience list — **scoped to the current workspace**, with search (250 ms debounce) and pagination; and the entry's saved access — `useEntryAccess(workspaceId, entry.id, entry.updatedAt)`. The row's version is part of the cache key, because access now changes on paths this plugin knows nothing about — restoring a version above all.
5. **One three-state control per audience.** “Not set” / “Can see” / “Cannot see”. **Three states rather than a checkbox:** an audience nobody mentioned reads the entry when nothing else is allowed, and does not read it when something is. A two-state control would make those two outcomes indistinguishable on screen and would make “not mentioned” unreachable after the row is first touched.
   _a segmented control rather than a dropdown: all three answers are substantive, there are exactly three, and the current one reads without opening anything_
6. **Every toggle goes through `withState`, which removes before it adds.** See section 4: otherwise the “both allowed and denied” state is reachable, which the server accepts and the reader resolves as a denial.
7. **The staging clears itself.** `stage(sameAccess(next, savedAccess) ? null : next)`: returning the controls to what is already saved **clears** the dirty mark rather than queueing a round trip. `sameAccess` is order-insensitive — the lists are sets everywhere it matters.
8. **A bulk action hits everything matched, not everything visible.** “Set every audience to…” acts on the `ids` from the list response — that is **every** id matching the filter, not the current page. A control called “every audience” that quietly sets ten of forty would be worse than no control: the mistake is invisible until a reader is refused. Past the server ceiling (`MATCHED_IDS_CAP = 200`, exactly as many as an entry may name on one side) the buttons are disabled with an explanation — that many cannot be saved anyway, so offering it would be offering a save that returns a 400.
9. **Decisions absent from the list are preserved and counted.** Search hides rows; an audience may have been narrowed out of this workspace _after_ the entry named it. Such decisions are counted under the list (“N more decisions on audiences this list does not show; they remain in force”) rather than discarded — discarding would rewrite who reads published content from a screen that said nothing about those audiences.
10. **Switching tabs unmounts the panel — and that breaks nothing.** The editor's tabs are **routes**, so the staging lives _above_, in `ENTRY_PRESAVE_SLOT`, and is reached downward through `EntryTabContext.presave` — exactly as deferred uploads are in the media plugin.
11. **The tab deliberately has no “Save” button.** Two alternatives were ruled out: writing on every toggle would publish three intermediate answers to real readers on the way to the intended one; and a second “Save” button on an editor tab would force the user to remember which of the two their change belongs to.
12. **Pressing Save / Publish: `extensions()`.** When the staging is `null` the **key is not sent at all**, and the server leaves the access alone. That is what inertness means for an editor who never opened the tab.
13. **The server: `EntryAccessWriteExtension.apply` inside the save's transaction.** Content declares the `extensions` bag opaque and passes it through unvalidated, so the shape check is ours: `parse` is strict, and a malformed payload is a 400 that rolls the save back rather than a silent partial write.
14. **`groupHas` first, permissions second.** A request asking for exactly what is already saved changes nothing and therefore needs no authority — and that is precisely what keeps **restoring a version** working for anyone entitled to restore. The **whole locale group** is asked about, not this row: a save matching the English row but not the German one still has work to do, and skipping it would leave the group half-restricted.
15. **`assertMayManage`.** The actor comes from `PrincipalStore`, the permissions from `PermissionsService.forRole`. Without `segments:manage` — a `403` that rolls the save back. The check lives **here** because there is no route: the save asked for `content:create`/`content:update`, and deciding who may _read_ an entry is a different authority. Without this check a contributor could restrict (or unrestrict) any entry available to them simply by naming the key in a save body.
    _an actor that could not be identified is refused, not waved through: somebody who cannot be identified cannot be shown to hold a permission_
16. **`setForGroup`: the locale group is resolved.** `localeGroupIds` reads content's `locale_group_id`, includes soft-deleted siblings and always explicitly includes the entry itself (on a create the row is visible within this transaction, but the caller may have passed an id the query cannot see yet).
17. **“Held by the group” is assembled.** `heldInGroup` is every id that _any_ row of the group already names on either side. Those are exempt from the workspace-scope check: an audience narrowed away after the fact is still held by the very entry the editor is looking at, and refusing on a sibling that has not caught up would fail the whole save.
18. **`validate` per side.** Deduplication; an unknown id is a `400` (saved, it would be a decision matching nobody — closing content on the allow side and doing nothing on the deny side, while no screen would say the entry is governed by an audience that is absent); an id outside the workspace scope is a `400`, **unless the entry already holds it** (it was not offered to the editor, so the request did not come from the screen).
19. **The rows are written sequentially, not with `Promise.all`.** This is the save's own transaction, and a pg transaction serves one query at a time: parallel ones interleave on a single connection and fail.
20. **Two empty lists delete the row;** otherwise it is an `INSERT … ON CONFLICT DO UPDATE` on `entry_id`.
21. **The ids of every rewritten row are returned** — and content appends a revision to each, exactly as it does for rows rewritten by i18n's shared-field synchronisation. A sibling whose audiences moved while its timeline did not is a history that hides a change, and restoring any of its versions silently undoes it. One save can reach a sibling by two paths at once (a shared field _and_ the audience), so the ids are deduplicated against the rows i18n reported: two revisions on one row read as two edits.
22. **`capture` runs on **every** snapshot, not only saves that touched access.** The asymmetry with `apply` is deliberate: a version that recorded access only when it changed would, on restore, read as a version that had no access — and quietly open the entry. For an unrestricted entry it returns `undefined`, so a snapshot of ordinary open content is byte for byte what it was before the extension existed.
23. **The admin UI: `settle` seeds the cache rather than invalidating it.** The save carried those lists and the server stored them in the same transaction — a refusal would have failed the save itself — so seeding tells the cache what it already knows instead of guessing. A refetch would blank a control the editor is still looking at, and on a create there is nothing to refetch under the old (id-less) key anyway.
24. **…and it invalidates every _other_ cached entry.** A sibling's `updatedAt` does not move when only its access did, so its key is unchanged while the cached answer is already a lie — switching locale would show the audiences that locale _used to_ have. The seeded row is excluded from the invalidation so the control the editor is looking at does not fly off into a refetch.

> **Why this is a save extension rather than a second HTTP request**
>
> Three properties a second request has none of. **One transaction** — the entry, its relations, its audiences and the version recording all three commit together or not at all; two requests can land half a change. **A truthful version** — the revision is built _inside_ the write, so a separate later request would at best be caught by the _next_ version, meaning every version would store the access the entry _used to have_. **A restorable version** — a restore applies a snapshot through the same writer, so the extension's state travels with it; otherwise “put it back as it was on Tuesday” would return Tuesday's words to today's readers.

> **The access key is stable forever**
>
> `ACCESS_EXTENSION_KEY = 'access'` is named by every version already made, both in the save body's bag and in a revision snapshot's `extra`. Renaming it would orphan the access recorded across all existing history — and a restore that finds no bag leaves the audiences **alone**. That is exactly the kind of silence nobody notices.

### 7.3 A public read, through the reader's eyes

1. **The request arrives; both middlewares are mounted on `{*splat}`.** Not on a path list: who is reading is a property of the request rather than of one controller, and a path filter would be a second place to keep in agreement as each protocol is added. The pattern is specifically `{*splat}`, because Express 5 uses path-to-regexp 8, where the historical `'*'` is a parse error rather than a wildcard: an error no typecheck catches, which would have left the plugin silently never running.
2. **`PrincipalMiddleware` puts the `request` itself into `AsyncLocalStorage`.** The request object, not the user: middleware is the only thing positioned to wrap the rest of the request in a `run`, and it executes _before_ the guards that resolve `request.user`. A guard mutates that same object in place, so by write time `user` is already there. Unlike the reader's, this middleware **never short-circuits**: resolving the reader is skippable when there are no audiences, whereas a permission check that quietly stopped running would be a refusal nobody notices.
3. **`ReaderMiddleware` decides whether there is work.** No audiences or no resolver — `next()` immediately.
4. **The host's resolver returns the tags.** The port receives the Express request, so a JWT claim, a CDN header or a call to billing are equally reachable. **An exception is caught and logged as a warning** rather than turned into a 500: an unavailable entitlement source should degrade the site to its public content, not take it off the air.
5. **The tags are resolved into audience ids synchronously.** `segmentIdsForTags` is an exact, case-sensitive match on **any** tag. No patterns, no prefixes, no namespaces: those exist to express “anyone of this kind”, and this model answers such a question without asking it — an entry lists audiences, and “anyone” is an empty list.
6. **The reader is put into `ReaderStore.run`, and `next()` is called.** `AsyncLocalStorage` specifically, not a request-scoped provider: the read scope is asked _inside a query builder_, reached from a singleton that has no request in hand.
7. **The public query builder asks the read-scope registry.** A registration rather than a DI-token binding: Nest has no multi-provider, and two plugins binding one token do not merge — the second silently replaces the first, and for a visibility rule that means content quietly becoming visible.
8. **`SegmentReadScope.scope()` assembles the fragment.** It looks for the type table's `id` column; if there is none it **throws** rather than silently omitting the fragment (a silent omission would serve restricted content). The reader's ids are bound through `uuidArray`.
9. **The fragment is ANDed into both the window and the `count(*) over`.** A restricted entry is absent from both `items` and `total`: a count would leak the cardinality of what is hidden — “5 relations, 2 visible” tells you there are three restricted entries here.
10. **Relations are closed by the same predicate, on every traversal.** A reader entitled to see an article is not thereby entitled to see everything it references — so the scope is asked about the **target** type through `RelationLinkService.targetVisibleWhere`, which REST expansion, the `/relations/:field` route, the `content_relations` MCP tool and GraphQL's nested resolvers all reach. The gate is the `publishedOnly` flag marking a public read: **admin reads pass no visibility and are unaffected**, because an editor has to see the entries their entry references in order to manage them.

> **Why uuidArray exists as its own function**
>
> Writing `` sql`${ids}::uuid[]` `` looks like it does the right thing — and does not. Drizzle expands a JS array in a template into **one placeholder per element**, comma-separated: that is what makes an `in (…)` list work, and what, against a `::uuid[]` cast, produces **a different broken query for every length**. Empty gives `()::uuid[]`, a syntax error — that is the **anonymous reader**, the one case that must always work. One id gives `($1)::uuid[]` with a scalar binding, and Postgres reads the uuid as an array literal and answers `malformed array literal`. Two gives `($1, $2)::uuid[]`, a row constructor rather than an array. Both the read scope and the access filter shipped exactly like that and 500'd on every restricted read, **because unit specs check the shape of the emitted SQL — and the shape is correct in all three cases**. `uuidArray` binds the list as one `sql.param`; its spec counts _parameters_ rather than reading SQL, and the server-e2e suites execute it.

### 7.4 Creating a translation — the path where `apply` never runs

1. **An editor creates the German version of a restricted English article.** The translation-create form sends no `extensions` bag at all — it has nothing to say about access.
2. **So `apply` is not called,** and without a third mechanism the new row would be born public next to a restricted sibling. A reader would notice; an editor never would.
3. **`inherit` fires** — content's create-only hook. `inheritFromGroup` returns immediately if the type is not localised, or if the row already _has_ non-empty access (meaning the same save's `apply` gave the answer, and that is the caller's answer, not the group's).
4. **The first restricted sibling's lists are copied verbatim.** With no workspace-scope check and **no `segments:manage`**: nothing is being decided, the audiences were chosen when they were chosen, and the row is joining an entry that already carries them.
   _requiring the permission here would mean a contributor could not translate a restricted article at all — and the alternative to inheritance is publishing it to everyone, precisely the outcome the permission exists to prevent_

### 7.5 Restoring a version

1. **An editor presses “restore” on a version.** Content runs the snapshot through the same writer, and `extra.access` reaches `apply` as its `value` — the same code path that put the state there puts it back.
2. **`groupHas` compares it with the current one.** A match means the write is skipped and no permission is asked for: restoring a version whose audiences match today's is not an access decision.
3. **No match means `segments:manage` is required, else a `403`.** And that is the right answer, not a special case: this is a change to who may read the entry, whatever button set it off.
4. **A version captured before the plugin existed carries no key** — the access is left untouched. In the revision preview `RevisionAccessValue` distinguishes **three** states: a recorded bag; a recorded “nothing”, because the entry was unrestricted (“Readable by everyone”); and an absent key (“Not recorded in this version”). Printing “everyone reads it” in the third case would promise a change the restore will not make.
5. **Audiences are named by their **current** label** — through `useSegmentLookup`, that is, by id rather than by searching a page of the directory. An audience deleted since is shown as a muted “Deleted audience” rather than a raw uuid: the id is all the version stores, and there is no meaning left in it.
6. **The entry's cache key carries the row's `updatedAt`.** A restore is exactly the path segments do not know about; a key ignoring the row's version would leave the chip quietly reporting the access the entry _used to_ have.

### 7.6 Renaming tags and narrowing an audience's scope

1. **`PATCH /api/segments/:id` with new `tags`.** Not one entry is touched: entries hold ids, and a tag is matched exactly once — when a reader arrives. That is the indirection's payoff.
2. **`catalog.reload()`** — otherwise the rename would never reach the read path, and a rename nobody sees is not a rename.
3. **Narrowing `workspace_ids` does not revoke the audience from entries.** It only changes where it is _offered_ for selection. The narrowing screen says so outright: “Entries that already name it keep it, and keep reading the way they do now”.
4. **And `validate` exempts already-held ids.** Otherwise the next save of an entry naming a narrowed audience would fall over with a 400 — and, more importantly, restoring a version naming an audience the entry still holds would break.
5. **The admin UI invalidates the whole `segments` root,** not just the list: the labels the open entry's rows are drawn with come from the directory, and refreshing one list would leave the editor with the old name.

### 7.7 Deleting an audience

1. **The confirmation dialog spells out the consequences rather than asking “are you sure?”.** Two different texts: if nobody names the audience — “no reader will notice anything”; if somebody does — “an entry that only refused this audience will become readable by everyone; an entry that only allowed it will stop being readable by anyone but the other audiences it names”.
2. **`DELETE /api/segments/:id` → one transaction of three steps.** Delete the dictionary row; `array_remove` the id from `allow` and `deny` on every `entry_access` row containing it; delete the rows whose lists both became empty.
3. **The third step is the same “no row = open” rule the writer maintains.** An entry left with two empty lists loses its row entirely.
4. **`catalog.reload()`, then an invalidation of the `segments` root in the admin UI** — the server rewrote every entry that named the audience, so every cached per-entry answer is stale.
5. **The response is a `204`.** There is no body: there is nothing to return.

### 7.8 Filtering the records list by access

1. **Three virtual fields, not a relation.** `audienceAllowed` and `audienceDenied` (enumerations of the workspace's audiences) and `accessRestricted` (a boolean). It is deliberately not a relation: a relation in the builder means a **content type** — the picker would go to `/content/<target>` and the filter surface would descend into the target's own fields. An audience is a row in this plugin's table with no content model behind it, and modelling it as a relation would advertise a traversal (`audience.tags eq …`) nobody can answer.
2. **The fields are wired in through content's filter-field registry** (`entryFilterProviderRegistrar`), so they land in the records list's **own** builder: the same filter tree, the same saved views, the same alarm rules.
3. **The enumeration's values are **ids**, not keys.** Ids are what an entry's lists hold, and the whole point of the indirection is that a key can be renamed without touching them. The admin picker draws the labels.
4. **The `in` operator means “any of”** — an array intersection. “Both” is an `and` of two `eq` rules, which the builder will compose itself; there is no separate array-containment operator, so that no operator has two readings.
5. **Negation is deliberately absent.** `audienceAllowed ne "acme"` would negate _inside_ the EXISTS — “there is some allowed audience other than Acme” — which is satisfied by an entry that allows Acme _as well_. That reads as “not visible to Acme” and is not. The honest spelling is `audienceDenied eq "acme"`, or `accessRestricted eq true` inside a tree-level `not` group, which the builder owns.
6. **The subquery is workspace-scoped.** A virtual field is a subquery over a table content-server knows nothing about; one that forgot the workspace would turn the filter into a cross-tenant read.
7. **The picker opens on “is one of”, not on “is”.** The order in which the operators are declared decides both the picker's order and the default. These fields' question is _which audiences_, and a multi-select answers the single-audience case too (one checkbox is the same `in` the server reads as an intersection). With “is” at the head, naming a second audience would require first noticing that a second operator exists.
8. **This is a list filter, not a visibility rule.** Who may actually _read_ an entry is decided by `SegmentReadScope` on the public API, and nothing here affects it.

## 08. HTTP API

Every path carries the global `/api` prefix the host sets. Access legend: `bearer` — no session, an external API token, `session` — a valid session is required, `permission` — the named permission is required.

### 8.1 The audience directory — `/api/segments`

Not workspace-scoped: an audience is an installation-wide concept, like a content type, and one copy per workspace would mean renaming a customer in every one of them.

| Method and path      | Access and guards                       | Input                                                                                                                    | Success                                                                                     | Failures                                                                                                              |
| -------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| GET /segments        | `session` `segments:read`               | `?q=` (substring over label and key, case-insensitive), `?workspace=` (uuid), `?page=`, `?pageSize=` (≤ 100, default 25) | `{ items[], total, page, pageSize, ids[], idsTruncated }`; each item carries a `usageCount` | `403` without the permission; `400` an invalid DTO                                                                    |
| GET /segments/lookup | `session` `segments:read`               | `?ids=a,b` or `?ids=a&ids=b` — both forms, ≤ 200 uuids                                                                   | `SegmentView[]`, sorted by label                                                            | `400` a non-uuid. **Unknown ids are skipped**, not rejected                                                           |
| GET /segments/:id    | `session` `segments:read`               | a uuid in the path (`ParseUUIDPipe`)                                                                                     | `SegmentView`                                                                               | `404` “Unknown segment.”; `400` a non-uuid                                                                            |
| POST /segments       | `session` `segments:manage` OriginGuard | `{ key, label, tags?, workspaceIds? }`                                                                                   | `201 SegmentView`; `tags` defaults to `[key]`                                               | `409` a taken key; `400` key format / lengths / > 20 tags / > 100 workspaces; `403` a foreign Origin or no permission |
| PATCH /segments/:id  | `session` `segments:manage` OriginGuard | `{ label?, tags?, workspaceIds? }` — the **key is immutable**                                                            | `SegmentView`; the catalogue is reloaded                                                    | `404`; `400`; `403`                                                                                                   |
| DELETE /segments/:id | `session` `segments:manage` OriginGuard | a uuid in the path                                                                                                       | `204`, no body. The audience is swept out of both sides of every entry, in one transaction  | `404`; `403`                                                                                                          |

> **Why lookup is declared before :id**
>
> So the literal segment wins the match. The route itself exists because **a page is not the whole list**: a caller holding an _id_ (the chip by the entry's title, the access recorded by a revision) can no longer count on the rows it needs being on the first page. Without it they would print uuids or, worse, claim an audience was deleted when it is merely on page three.

> **The ids in the list response is not a page**
>
> `ids` is **every** id matching the filter, capped at `MATCHED_IDS_CAP = 200` — exactly the number an entry may name on one side: past the cap a bulk action cannot be performed anyway, and `idsTruncated` is how the editor learns to say so rather than doing part of the work in silence. It costs one extra index read of a uuid column.

### 8.2 One entry's access — `/api/segments/entries/:entryId`

Workspace-scoped (`WorkspaceGuard`), so an entry id from another workspace cannot be written through a session holding this one.

| Method and path                | Access and guards                                       | Input                                                  | Success                                                                                   | Failures                                                                                              |
| ------------------------------ | ------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GET /segments/entries/:entryId | `session` `segments:read` WorkspaceGuard                | a uuid in the path                                     | `{ allow[], deny[] }`. Two empty lists = everyone reads                                   | `400` a non-uuid; `403`                                                                               |
| PUT /segments/entries/:entryId | `session` `segments:manage` WorkspaceGuard, OriginGuard | `{ typeSlug, allow[], deny[] }`, each side ≤ 200 uuids | `{ allow[], deny[] }` of the named entry; on a localised type **every** locale is written | `400` an unknown `typeSlug` / an unknown audience id / an audience outside the workspace scope; `403` |

> **It is a PUT, and the API is telling the truth by that**
>
> The editor sends **the entire state of both lists**, and it becomes the entire state. There is nothing to merge into: nothing sits above an entry — no rule to inherit from, no level above. Only a full replacement can express a _removal_: a merge has no spelling for “this audience is no longer mentioned”. **The route remains for an API client that is not saving an entry** — it simply gets neither atomicity nor a version. The admin UI is not that client: its hooks deliberately have no write hook (the gateway has a `setEntryAccess` method, but nobody uses it).

### 8.3 The public API by bearer token — `/api/v1/content/:typeName/:id/access`

| Method and path                      | Access and guards                                              | Input                                                                     | Success                                                      | Failures                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| GET /v1/content/:typeName/:id/access | `bearer` `segments:read` ApiTokenGuard, ApiTokenWorkspaceGuard | `X-Workspace-Id` (required when the token covers more than one workspace) | `{ entryId, restricted, allow[], deny[] }`                   | `400` “Unknown content type” — **including for a type not granted to the workspace**; `403` a workspace outside the token's basket |
| PUT /v1/content/:typeName/:id/access | `bearer` `segments:manage` (the `full` scope only)             | `{ allow[], deny[] }` — no `typeSlug`, the type is already in the path    | The same body; on a localised type every language is written | `400`; `403`                                                                                                                       |

> **Three decisions in this controller**
>
> **It reads from the plugin's table rather than through a public entry read.** That read is reader-scoped, so a client that has just restricted an entry could not read back what it did: the restriction it wrote is what hides the answer. Asking who may read an entry is not the same as reading the entry. **It does not become an enumeration oracle, thanks to the workspace:** an id from another workspace answers as an unrestricted entry — exactly as an unknown one does, because access is stored per workspace. **`OriginGuard` is deliberately absent:** a browser never sends a bearer token implicitly, so requiring an `Origin` would reject every server-side client while protecting nothing.

> **There is no public route over the dictionary**
>
> An audience cannot be created, renamed or deleted through a token under any scope. That is not a gap in the mapping but its explicit boundary: renaming one audience's tags changes the visibility of every entry naming it, installation-wide. A future route or tool over the dictionary is a decision somebody will have to make deliberately.

## 09. Agent surfaces — MCP, the copilot, the token

Four tools in the shared `@ortha/tools-server` registry, and the difference between them is entirely about **who is acting**.

| Tool                   | Surfaces                                        | Requires        | Effect             | What it does                                                                                                                                                |
| ---------------------- | ----------------------------------------------- | --------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| segments_list          | MCP + copilot (the `surfaces` field is omitted) | segments:read   | `readOnly`         | The audiences **offered in this workspace** (`isOfferedIn`). An empty list means the installation is not segmented and there is nothing to say about access |
| content_access_get     | MCP + copilot                                   | segments:read   | `readOnly`         | One entry's two lists, with the ids resolved into audience **names**. Reads `entry_access` directly                                                         |
| content_access_set     | \['mcp'\]                                       | segments:manage | writes immediately | Replaces both lists through `setForGroup`. The change is in force by the time it returns                                                                    |
| content_propose_access | \['copilot'\]                                   | segments:manage | effect: 'propose'  | Changes nothing: it drafts the change and asks a human to confirm it on a card                                                                              |

### Why the reads are on both surfaces while the writes are different tools

- **A bearer token is its own authority.** The registry has already checked `segments:manage` against the token's scope — there is nobody to ask and nothing to propose, so `content_access_set` writes and returns.
- **A copilot run acts on a _person's_ behalf** (`docs/adr/0009-copilot-applies-directly.md`): the change is recorded as a `copilot_proposals` row and executed under that person's own permissions. So the copilot gets a different tool rather than “the same tool with another flag”.
- **An agent that cannot ask about access is worse than an agent that cannot see the entry.** The read scope already drops restricted entries from both `items` and `total`, so a client with no way to ask passes a partial list off as a complete one. Hence both reads are gated no more strictly than `read`.
- **The agent reads answer from `entry_access` rather than through a public entry read** — for the same reason as the public controller: an agent that has just restricted an entry could not read back what it did.

### A copilot proposal, step by step

1. **`summary` is a required argument.** Not a convenience: the assertion card is what a person reads instead of code, and for an access change the overview matters more than it does for a text edit.
2. **`assertOffered` runs _at proposal time_, not at apply time.** An audience never offered to this workspace is not a choice an editor could have made, and a card proposing it would be a card whose “Accept” button returns a 400.
3. **The “before” state is read.** `EntryAccessService.get` for the same workspace and entry.
4. **The diff names the audiences rather than identifying them.** “Can be seen by” / “Cannot be seen by” — by label; **an empty allow list is written as a word rather than an empty cell** the reviewer is expected to interpret. Emptiness on the deny side genuinely means “nothing is denied”, and it says so.
5. **The applier re-checks the grant.** A proposal can sit between drafting and acceptance, and a type that lost its grant in that window must not be written on the strength of an old card.
6. **The applier writes through the same `setForGroup`.** An accepted proposal cannot mean anything an entry save and the `PUT` route do not: the same full replacement, the same row deletion on two empty lists, the same workspace-scope check, the same write across every language.
7. **It appends no revision — and that is the honest reading.** A save carries the access because the entry itself is being written; here only who may read what is already written changes, exactly as on the `PUT` route. An entry's timeline is the history of its content; “the copilot restricted this, and here is who agreed” is recorded by the proposal row.
8. **The number of rows touched goes into `detail`**, so the run's receipt can say “and its three translations” rather than leaving that to be discovered.

## 10. The admin UI: screens, states, behaviour

The plugin contributes **three routes** and **six contributions into other people's slots**. Between the directory and the entry there is nothing — no rule library, no assignment screen — because in the model there is nothing between them either.

| Route                | Screen              | What it does                                                                                                          |
| -------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| /segments            | `SegmentsPage`      | The audience directory: an “Audience / Reader tags / Offered in / Used by” table, search, pagination, an actions menu |
| /segments/new        | `SegmentEditorPage` | Creation. Declared **before** `:segmentId` so the literal segment wins the match                                      |
| /segments/:segmentId | `SegmentEditorPage` | Editing. The key is read-only — it is also the default reader tag                                                     |

| Slot                       | Component / hook                                                   | Why                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| SIDEBAR_NAV_SLOT           | a “Segments” item, group `directory`, order 40                     | Carries `permission: SEGMENTS_READ` — otherwise the row would be a dead link for somebody who cannot open the directory                         |
| ENTRY_HEADER_SLOT          | `EntryAccessChip`                                                  | Whether this entry is restricted **right now**                                                                                                  |
| ENTRY_TAB_SLOT             | `EntryAccessTab`, slug `access`, order 20, `appliesTo: () => true` | All the decisions. On **every** type, unlike the media tab: any entry can be restricted, and the schema says nothing about whether it should be |
| ENTRY_PRESAVE_SLOT         | `useEntryAccessPresave`                                            | The staging, the `extensions` contribution and `settle`. Mounted **above** the tab, because tabs are routes                                     |
| REVISION_EXTRA_SLOT        | `RevisionAccessValue`, key `access`, label “Who can read this”     | Who could read a past version — made possible precisely because the write travels with the save                                                 |
| RECORDS_FILTER_FIELDS_SLOT | `useAccessFilterFields`                                            | Three filter fields in the records list's query builder                                                                                         |

### The “Access” tab's states

| State                       | When                                                                      | What is shown                                                                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading                     | The audience list is in flight, or (when there is an entry) its access is | Two skeletons. The access read is disabled without an entry id, so **on a create it never resolves** — waiting for it there would leave the tab on skeletons forever                                                                                                                                    |
| There are no audiences here | `total === 0` and no search                                               | Its own phrasing: “no audience is offered in this workspace yet” + a button into the directory. This is a **setup step**, not a typo                                                                                                                                                                    |
| The search found nothing    | `total === 0` with a non-empty search                                     | “No audience matches “…””. A different situation gets a different suggestion                                                                                                                                                                                                                            |
| Working                     | There are audiences                                                       | A heading + a badge (open / restricted) + a `ChangedBadge` when the staging is uncommitted; search on the left, a link into the directory on the right; the bulk-actions block; the row list; pagination; the “decisions outside the list” counter; and the “This applies when you save the entry” line |
| Read-only                   | `readOnly`, or no `segments:manage`, or no staging handle                 | The controls are locked, the bulk-actions block is not rendered, and the bottom line explains which permission is needed                                                                                                                                                                                |

> **Two gates on the tab, and they are different**
>
> `readOnly` says the caller cannot edit the entry's _values_. `segments:manage` says they cannot change who reads it. An editor with `content:update` and without the second must be able to rewrite the article and unable to publish it to a new audience.

> **The chip and the tab speak of different moments in time — deliberately**
>
> The chip renders from `EntrySlotContext`, which has **no** `presave` handle, so it does not see the staging. And that is the honest reading: until the save, the restriction the chip reports is still live. The tab, meanwhile, says what it will become after the next save.

> **Nothing staged is not the same as open access**
>
> `EntryAccessStaging.draft` is `null` until something is set, and a save with `null` **writes nothing at all**: the key is absent from the bag and the server leaves the audiences alone. That is what makes the feature inert for an editor who never opened the tab. Returning a control to what is already saved **clears** the staging through `sameAccess` rather than queueing a round trip.

### The directory and its editor

- **The empty state describes a working system.** “While there is no audience, every published entry is read by everyone and nothing in your content API changes” is not “no data”.
- **The “Offered in” column is never empty.** Empty means “every workspace”, so it says so with a badge rather than being left as an unfilled cell. The same in the `SegmentWorkspacesField` control: “leave every box unchecked and it is offered in all of them, including ones created later”. The opposite reading (an audience nobody restricted is offered nowhere) is what would make the control look broken.
- **A failed workspace read is **not** an empty one.** It renders as a warning that leaves the current scope alone: a form quietly showing zero checkboxes would invite saving an audience the person believes is unrestricted.
- **The delete dialog spells out the consequences** and changes its text when nobody names the audience.
- **The result count is announced into a live region.** A deletion changes the table with no navigation and no heading change — otherwise the change would be silent.
- **The actions column is named by hidden text.** A header cell with no text is a column a screen reader announces as nothing while reading every row's menu beneath it.
- **Required fields are marked with the shared `RequiredMark`** from `@ortha/content-admin` (one implementation — the audience form and the entry editor will not drift apart), `aria-hidden`, because the control carries `aria-required` and announcing both would say “required” twice. Name and Key are marked; the reader tags are not: an audience without them responds to its own key. The convention is explained by a line in the page itself rather than by a tooltip — a tooltip is unreachable by keyboard and by touch alike.
- **`noValidate` on the form,** because the messages are ours: the browser's bubble says something different, in a different language, and vanishes on the next keystroke.

### Both pages load into a skeleton, not a spinner

A lazy route's fallback is **a whole page**: a spinner in the middle of an empty one says only that something is happening, and then rearranges every control into place when the chunk lands. Four components, split by consumer: `SegmentsListSkeleton` and `SegmentFormSkeleton` are the bodies, drawn **both** by the route's fallback **and** by the page's own pending state (so “the page is loading” and “its data is loading” become one shape); `SegmentsPageSkeleton` and `SegmentEditorPageSkeleton` wrap them for `Suspense`. Two rules taken from `ContentLibraryPageSkeleton`: **the top bar is real rather than a skeleton** (it is the page's identity and its way back, both known before the chunk's first byte), and **the editor's second breadcrumb is the bar itself** — “New audience” versus “Edit audience” lives in the chunk, and dropping it would leave the trail one crumb short and shift it on resolve. **The `<h1>` is visually hidden and names the state**: a fallback is a page with no heading at all, and a slow connection sits in that state longest.

> **What is lazy, and why**
>
> Both directory pages are `React.lazy`, each in its own chunk. The chip and the tab are **not**: they mount inside the editor, which is a separate chunk anyway, and a `Suspense` boundary around a badge in the title row is a flicker on opening every entry.

### Cache keys — three decisions

- **The directory and an entry's access are rooted separately.** The directory changes when an administrator edits an audience; an entry's lists change every time an editor touches them. A shared root would make renaming an audience evict every open entry's answer from the cache for no reason a reader could see.
- **The workspace is in the entry-access key explicitly.** It reaches the server only as the implicit `X-Workspace-Id` header, which is **not sent on a cache hit** — without it one workspace would read another's answer.
- **The ids in a `lookup` key are deduplicated and sorted.** Two components asking for the same ids in a different order are asking for the same thing, and an unsorted key would go and fetch it twice.

## 11. Configuration

There is exactly **one** configurable value in this plugin, and it is not an environment variable.

| Field    | Type / default                       | Meaning                                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| resolver | `SegmentResolver<unknown>`, optional | Where a reader's tags come from. It receives the Express request, so a JWT claim, a CDN header or a call to billing are equally reachable. **Its absence is a working configuration:** every reader is anonymous, unrestricted content is served, restricted content is not |

Everything else is **data an administrator enters in the admin UI**: the audiences themselves, and what each entry admits or refuses. The plugin has no environment variables, no enable flag and no ceilings in configuration — the limits (`SEGMENT_KEY_MAX = 120`, `SEGMENT_LABEL_MAX = 200`, `SEGMENT_TAG_MAX = 200`, `SEGMENT_TAGS_MAX = 20`, `IDS_MAX = 200`, `WORKSPACES_MAX = 100`, `MAX_PAGE_SIZE = 100`, `MATCHED_IDS_CAP = 200`) are baked in as constants.

> **Registration order is load-bearing**
>
> `SegmentsPlugin` is registered **after** `ContentPlugin`, whose `CONTENT_READ_SCOPE` port it binds: binding a read scope only means anything when there is something to bind to. The module is **global**, because `SegmentReadScope` has to reach content-server's read path from wherever a query is assembled. Registration goes through `contentReadScopeRegistrar('segments', …)`, `entryWriteExtensionRegistrar('segments', …)`, `entryFilterProviderRegistrar('segments', …)` and `copilotAppliersRegistrar('segments', …)` rather than DI-token bindings: Nest has no multi-provider, and a second plugin binding the same token would silently replace the first.

> **The example in apps/server/ortha.config.ts**
>
> In this repository the `plugins.segments` section is left **empty**, with a commented-out resolver example. That is, the reference build runs in anonymous mode — and that is a deliberate choice: an audience nobody can be resolved into cannot be accidentally admitted. `apps/server-e2e` substitutes a `headerSegmentResolver` reading an `x-reader-tags` header — that is a **production seam** rather than a test hook alongside one: a real deployment writes exactly the same shape.

<details>
<summary>How the plugin is assembled and what happens at startup</summary>

`SegmentsPlugin(config)` returns `{ name: 'segments', module: SegmentsModule.forRoot(config), migrations: { dir, table } }`. The migrations directory is a **thunk**, so it resolves at migration time and works both when consumed from source and when installed from npm; the journal is its own `__drizzle_migrations_segments` table, so installing the plugin later disturbs nothing already applied. At startup `SegmentCatalogService.onApplicationBootstrap` reads the directory and **logs**: either “Loaded N segment(s)” or “No segments defined — every published entry is readable by everyone”. That is the one line by which an operator knows which of the two modes they are in.

</details>

## 12. Security: what was done and why exactly that way

#### Both emptinesses point in the safe direction

No row — the entry is open (otherwise installing the plugin would black out the whole library). No reader context — the reader is **anonymous** (otherwise every hole the middleware did not cover would become an open door). No actor in `PrincipalStore` — **refusal** (somebody who cannot be identified cannot be shown to hold a permission).

#### The resolver fails closed and never sinks the request

An adapter that could not reach its source returns an empty tag set, and a thrown exception is caught and logged as a warning. An empty set still reads everything unrestricted, so a source failure degrades to “public content only” rather than to the site being down.

#### What is hidden is hidden from `total` too

The predicate sits inside the window **and** inside `count(*) over`. Otherwise the count would leak the cardinality of what is hidden: “5 relations, 2 visible” tells you there are three restricted entries here.

#### Another workspace is indistinguishable from a nonexistent one

The public access controller answers an id from another workspace as an unrestricted entry — exactly as it does an unknown one, because access is stored per workspace. A type not granted to the workspace answers as an unknown type does, with the same `400 Unknown content type`, so a client cannot enumerate the installation's types by probing.

#### Relations are checked against the target, not the source

A reader entitled to see an article is not thereby entitled to see everything it references. The scope is asked about the target type on every traversal, and the gate is the `publishedOnly` flag marking a public read; admin reads are unaffected.

#### The permission check sits where the write happens

This write **has no route of its own**: it arrives inside a save that asked for `content:update`. The check in the extension is the only place `segments:manage` can be asked for at all; without it a contributor could unrestrict any entry available to them by naming the key in a save body.

#### The dictionary is unreachable by any token

The `full` scope grants `segments:manage` at the _entry_ level only. Neither a route nor a tool over the directory exists: renaming one audience's tags changes the visibility of every entry naming it, installation-wide.

#### An unknown audience id is rejected, not stored

Saved, it would be a decision matching nobody: it would close content off on the allow side and do nothing on the deny side — while no screen would say the entry is governed by an audience that is absent.

### One class of defect worth knowing about separately

> **The SQL's shape is right and the binding is not**
>
> The `::uuid[]` bug (section 7.3) is invisible to an assertion about the emitted SQL, because **the shape is correct in all three cases** — only the placeholders are wrong. It surfaces as a 500 on the first real allowed reader. Both the read scope and the access filter shipped that way. The lesson, recorded in the code: the `uuid-array.spec.ts` spec counts **parameters** rather than reading SQL, and the server-e2e suites actually execute it. Any new `&&` in this plugin must go through `uuidArray`.

### Deliberately deferred

- **Deletions are not wired up.** A hard-deleted entry leaves an `entry_access` row behind. Nothing joins to a nonexistent id, so the cost is disk rather than correctness.
- **There are no per-collection or per-workspace defaults.** A default is inheritance, and inheritance is precisely what this design discarded on purpose. If it comes back, it should come back as one explicit rule rather than a chain.
- **There is no negation in the list filter** — for the reason in section 7.8: it has no honest reading.

## 13. Invariants

Statements that must always hold. This is at once a review list and a draft set of test assertions.

- **I-01** — Until an audience is created, the plugin is **inert**: `configured === false`, the read scope returns `undefined`, no fragment is added, and a public read is byte for byte what it was before installation.
- **I-02** — An entry with no `entry_access` row is read by everyone — that is what `COALESCE(…, true)` provides.
- **I-03** — An empty `allow` list means “everyone”, not “nobody”.
- **I-04** — A deny wins: a reader who falls into even one `deny` audience does not read the entry — however many allows they satisfy.
- **I-05** — An anonymous reader (an empty tag set) sees exactly the entries with an empty `allow`, and there is no dedicated code branch for them.
- **I-06** — The SQL predicate is `canRead` line for line: `deny` first, then the empty-`allow` case, then the intersection.
- **I-07** — A restricted entry is absent from both `items` and `total` — across all three protocols and on every relation traversal.
- **I-08** — Every `&&` binds its list through `uuidArray` — as **one** `sql.param`, never by inlining the array into a template.
- **I-09** — `canRead` never consults `isOfferedIn`: where an audience is offered is an editor's question, not a reader's.
- **I-10** — An empty `workspace_ids` means “every workspace”, not “none” — in the schema, in the directory and in the “Offered in” control alike.
- **I-11** — Narrowing an audience's scope does **not** revoke it from entries that already name it; `validate` exempts from the scope check every id the entry (or its locale group) already holds.
- **I-12** — Deleting an audience sweeps it out of both sides of every entry **in one transaction**, and an entry left with two empty lists loses its row.
- **I-13** — Two empty lists **delete** the row rather than being stored as a row of empty arrays.
- **I-14** — An access write is a **full replacement** of both lists, not a merge.
- **I-41** — Every write path checks that the entry id names a row of **this workspace's** content before writing anything, and answers a foreign id with the same `404` an id that exists nowhere gets. Added after the QA pass — see section 17.
- **I-42** — Neither list may name more than **200** audiences, on every write path including the entry save's `extensions` bag. Added after the QA pass — see section 17.
- **I-15** — Access is written across the entry's **whole locale group**, soft-deleted siblings included; the group is resolved from content's own `locale_group_id` column, with no dependency on `@ortha/i18n-server`.
- **I-16** — A write arriving in the `extensions` bag runs on the **save's own transaction** — never on a connection of the plugin's own.
- **I-17** — Changing audiences requires `segments:manage`, checked **in the extension**; a request asking for exactly what is already saved changes nothing and needs no authority.
- **I-18** — An actor that could not be identified (`PrincipalStore.current()` returned `undefined`) gets a `403`, not a pass.
- **I-19** — `capture` runs on **every** snapshot, not only on saves that touched access; for an unrestricted entry it returns `undefined`.
- **I-20** — `ACCESS_EXTENSION_KEY = 'access'` is stable forever; restoring a version that did not name the key leaves the access untouched.
- **I-21** — A restore that **would change** the audiences requires `segments:manage`; a restore matching the group's current state does not.
- **I-22** — Every row of the locale group rewritten by `apply` gets a revision; the ids are deduplicated against the rows i18n reported.
- **I-23** — Creating a translation inherits the group's audiences **without** a permission check and **without** a workspace-scope check, and only while the new row's access is still open.
- **I-24** — `withState` and `withStates` always remove before they add: an audience never ends up in both lists at once.
- **I-25** — `sameAccess` is order-insensitive — a reordered list is not a pending change, in the staging or on the write path.
- **I-26** — An empty staging (`draft === null`) does not send the `access` key at all, and the server leaves the audiences alone.
- **I-27** — The tab's bulk action acts on the `ids` from the list response (every match), not on the rows on screen; past `MATCHED_IDS_CAP` the controls are disabled with an explanation.
- **I-28** — Decisions on audiences absent from the current list are preserved and counted rather than discarded.
- **I-29** — An entry's access cache key carries the workspace and the row's `updatedAt`; `settle` seeds the saved row and invalidates all the others.
- **I-30** — The chip by the entry's title renders nothing while the workspace has no audiences.
- **I-31** — Agent and public access reads answer from `entry_access`, not through a reader-scoped public entry read.
- **I-32** — `content_access_set` exists on MCP only; the copilot gets `content_propose_access` with `effect: 'propose'` in its place, and both require `segments:manage`.
- **I-33** — There is neither a public route nor an agent tool over the audience directory — under any token scope.
- **I-34** — An accepted proposal's applier re-checks the workspace grant and writes through the same `setForGroup` as every other path.
- **I-35** — The reader resolver never rejects a request: an exception is caught, logged as a warning, and yields an anonymous reader.
- **I-36** — The catalogue is loaded in `onApplicationBootstrap`; an unreadable catalogue **aborts the start**. Every write to the directory reloads the catalogue in full.
- **I-37** — All three virtual filter fields' subqueries are workspace-scoped, and there is no negation among their operators.
- **I-38** — `@ortha/segments-domain` declares no dependencies at all, and the audience-field validation rules are read from it by both the admin form and the server DTO.
- **I-39** — A content type with no `id` column makes `SegmentReadScope` **throw** rather than silently omit the fragment.
- **I-40** — The middlewares are registered on `{*splat}` (Express 5 / path-to-regexp 8), and `PrincipalMiddleware` never short-circuits.

## 14. Testing checklist

Phrased as “action → expected result”, so they can go into a test case without rewriting. The server side is checked with `curl` + `psql`, the admin side in a browser. The existing suites: `apps/server-e2e/src/server/segments/` (5 files: `segments-directory`, `entry-access`, `public-read-scope`, `access-filter`, `agent-access`), `apps/admin-e2e/src/segments/` (3 files: `segments-directory`, `entry-access`, `records-access-filter`), plus the unit specs of the kernel (`entry-access.spec`, `segment.spec`, `validation.spec`), the server (`segment-read-scope.spec`, `uuid-array.spec`, `entry-access-write-extension.spec`, `entry-access-proposal.spec`) and the admin UI (`types.spec`).

> **A mandatory harness step**
>
> The segment catalogue is held **in memory**, and `resetDb` `TRUNCATE`s behind its back. Every suite that touches segments must call `reloadSegmentCatalogue(app)` right after `resetDb` — otherwise `configured` stays true and ids that no longer exist keep passing validation.

### Inertness before the first audience

- **A public read with an empty directory** → the emitted SQL **contains no** subquery against `entry_access`; the response bodies match the same requests made before the plugin was installed.
- **`GET /api/segments` with no filters** → `total: 0`, `ids: []`, `idsTruncated: false`.
- **Open an entry in the editor** → the chip by the title is not rendered at all; the “Access” tab shows “there are no audiences in this workspace yet” + a button into the directory.
- **Open the records list's filter builder** → there is no “Segmentation” group — an enumeration field with no values is a rule that cannot be completed.
- **`segments_list` over MCP** → an empty list, not an error.

### The truth table against a live database

- **An anonymous reader (no `x-reader-tags`) reads an unrestricted entry** → 200, the entry in `items`, counted in `total`.
- **An anonymous reader reads an entry with `allow=[A]`** → the entry is in neither `items` nor `total`; the by-id response is a 404, indistinguishable from a nonexistent id.
- **A reader tagged for audience A reads an entry with `allow=[A]`** → sees it.
- **A reader tagged B reads an entry with `allow=[A]`** → does not see it.
- **A reader tagged B reads an entry with `allow=[A,B]`** → sees it — any one is enough.
- **A reader tagged A reads an entry with `deny=[A]`, `allow=[]`** → does not see it.
- **A reader tagged B reads the same entry** → sees it — “everyone except A”.
- **Audience A is in both `allow` and `deny`; the reader is in A** → does not see it: a deny wins.
- **A reader with an unknown tag** → resolves to an empty set, that is, to an anonymous reader.
- **A tag in different case (“ACME” versus “acme”)** → does not match — the comparison is exact and case-sensitive.

### The predicate and parameter binding

- **A reader with **no** tags on a restricted read** → 200, not 500. This is the check for `()::uuid[]` — the case that historically broke.
- **A reader with exactly **one** audience** → 200, not `malformed array literal`.
- **A reader with **two** audiences** → 200, not a row-constructor error.
- **A public read expanding a relation onto a restricted target** → the target is absent from both `items` and `total` of the relation list.
- **The same traversal from an admin read** → the target is visible: an editor has to see the entries their entry references.
- **The same request through GraphQL and through the `content_relations` MCP tool** → the same result as over REST.

### The workspace boundary

An entry id names one row in one workspace, and every write path has to say so. The read already does — `EntryAccessService.get` filters on both columns — but the enforcement predicate matches on `entry_id` **alone**, so a row written under the wrong workspace still governs the reads of the entry it names. These are the checks that were missing when this dossier was written; see section 17.

- **`PUT /api/segments/entries/:id` naming another workspace's entry, with two empty lists** → 404; the other workspace's stored access is unchanged. Before the fix this answered 200 and **deleted** their restriction, publishing their content.
- **The same with a non-empty pair** → 404. Before the fix it re-homed the row to the caller's workspace: the entry's readers were blacked out while its own editor read “unrestricted”.
- **`PUT /api/v1/content/:type/:id/access` with a legitimate `full` token, on an entry outside its bucket** → 404, and the owning workspace's row untouched.
- **`content_access_set` over MCP, same shape** → a tool error. This was the loosest path: it checks neither the entry's workspace nor the type's grant.
- **A well-formed uuid that names no entry at all** → 404, and **no `entry_access` row created**. It used to succeed and leave a row behind for a record that does not exist.
- **A foreign id on `GET …/access`** → answers as an unrestricted entry, indistinguishable from an unknown id — the read side already gave this flat answer, and the write now matches it.
- **The legitimate write from the owning workspace, after all of the above** → 200; open-up deletes the row; the boundary check costs the normal path nothing.

### The write path through an entry save

- **Save an entry with no `access` key in `extensions`** → the `entry_access` row is neither created nor changed.
- **Save with `access` under a role without `segments:manage`** → 403, and **the whole write rolled back** — the entry's values were not saved either.
- **Save with 201 ids on one side** → 400, the save rolled back. The two `PUT` DTOs always capped this; the save's `extensions` bag passes no DTO and did not.
- **Save with an `access` exactly matching the current one** → 200 even without `segments:manage`: nothing changes, so no authority is needed.
- **Save with `extensions.access = "a string"` or `allow: [1,2]`** → 400, the save rolled back, with no partial write.
- **Save with `{ allow: [id] }` and no `deny`** → the missing side reads as empty rather than being rejected.
- **Save with a nonexistent audience id** → 400 “Unknown segment(s)”.
- **Save with the id of an audience not offered to this workspace** → 400 “not offered in this workspace”.
- **The same, but the entry already holds that audience** → 200 — already-held ids are exempt from the scope check.
- **Save two empty lists on a previously restricted entry** → the `entry_access` row is deleted rather than blanked.
- **A save on a localised type** → `entry_access` rows appeared for **every** locale of the group, soft-deleted ones included; each rewritten row gained a revision; there are no double revisions on a row i18n also touched.
- **A save matching the English row but not the German one** → the write **happens** — `groupHas` asks the whole group, not one row.
- **A revision snapshot of an ordinary unrestricted entry** → `extra` contains no `access` key — byte for byte as before the extension existed.
- **A snapshot from a save that did not touch access, on a restricted entry** → `extra.access` **is recorded**: `capture` runs on every snapshot.

### Restoring a version

- **Restore a version whose audiences match the current ones, without `segments:manage`** → success.
- **Restore a version whose audiences differ, without `segments:manage`** → 403, and the restore did not happen at all.
- **Restore a version captured before the plugin was installed** → the entry's audiences are unchanged; the revision row shows “Not recorded in this version”.
- **Restore a version naming an audience narrowed out of the workspace** → success, because the entry still holds that audience.
- **Restore a version naming a **deleted** audience** → the revision row shows “Deleted audience” rather than a raw uuid.
- **Refresh the editor after a restore** → the chip reflects the restored access — the cache key carries the row's `updatedAt`.

### The audience directory

- **Create an audience with no `tags`** → `tags = [key]`.
- **Create with a taken key** → 409; in the form the message lands on the key field and clears when another is typed.
- **The key “Acme Corp” or “-acme”** → 400 / a form error: lowercase, digits and `. _ -` only, starting with a letter or a digit.
- **21 tags** → 400 / a form error.
- **The same tag twice** → a “duplicate” error.
- **Pasting a tag list with a trailing empty line** → the empties are dropped rather than rejected.
- **`PATCH` with new `tags`** → no entry's lists changed; a reader with the **old** tag stopped falling into the audience and one with the new tag started.
- **Narrow `workspaceIds` to a single workspace** → the other workspace's entries that named the audience read as before; their editor shows the decision and counts it; new entries there are not offered the audience.
- **Delete an audience that is in use** → 204; the id is gone from `allow` and `deny` of every entry; entries left with two empty lists lost their row; all in one transaction.
- **`GET /segments?workspace=…`** → returns the audiences naming that workspace, **plus** those naming none.
- **`GET /segments/lookup?ids=` with one id, with two comma-separated, and with a repeated parameter** → all three forms work.
- **`lookup` with an unknown id** → it is simply absent from the response rather than a 404.
- **A search containing `%` and `_`** → read literally — the ILIKE metacharacters are escaped.
- **A directory with more than `MATCHED_IDS_CAP` matches** → `ids` is capped, `idsTruncated: true`.

### Permissions and token scopes

- **`GET /api/segments` as an observer** → 200 — all three roles have `segments:read`.
- **`POST /api/segments` as a contributor** → 403.
- **`PUT /api/segments/entries/:id` as a contributor** → 403.
- **A `read`-scope token on `GET /api/v1/content/:type/:id/access`** → 200.
- **A `read`-scope token on a `PUT` of the same path** → 403.
- **A `full`-scope token on the `PUT`** → 200, and the change is in force immediately.
- **Any token on `/api/segments`** → refused: the dictionary is session-only.
- **A request with an `X-Workspace-Id` outside the token's basket** → 403.
- **An entry id from another workspace on `GET …/access`** → answers as an unrestricted entry, indistinguishable from an unknown id.
- **A type not granted to the workspace** → the same `400 Unknown content type` as a nonexistent type.

### Agent tools

- **`segments_list` in a workspace offered some of the audiences** → only those come back, plus the unrestricted ones.
- **`content_access_set` over MCP, then `content_access_get` with the same token** → the read returns what was written, even though the write would have hidden it from a reader.
- **`content_access_set` from the copilot** → the tool is not in the catalogue — `surfaces: ['mcp']`.
- **`content_propose_access` over MCP** → the tool is absent — `surfaces: ['copilot']`.
- **`content_propose_access` with an audience not offered to the workspace** → an error **at proposal time**, not at acceptance.
- **The proposal card** → the diff carries audience **labels**, not uuids; an empty `allow` is spelled out as “everyone reads it” rather than an empty cell.
- **Accept a proposal after the type lost its grant** → refused: the applier re-checks the grant.
- **Accept a proposal on a localised entry** → every language is written; `detail.entries` carries the count; **no revision is added**.
- **Both reads under a `read`-scope token** → work.

### The records-list filter

- **`audienceAllowed is one of [A, B]`** → entries allowing either of the two.
- **Two `audienceAllowed equals` rules joined by `and`** → entries allowing both.
- **`accessRestricted equals true`** → exactly the entries that have an `entry_access` row.
- **`accessRestricted equals false`** → the entries with no row.
- **Trying to build an `ne` on any of the audience fields** → the operator is not offered by the picker; sent by hand it gives a 400.
- **A rule with an empty value list** → 400 “needs at least one audience”, not a 500.
- **The same filter in another workspace** → finds none of the other's entries — the subquery is workspace-scoped.
- **Save the filter as a view and as an alarm rule** → reproduces the same results.
- **Open the picker** → the fields sit in a “Segmentation” group rather than among the type's columns; the default operator is “is one of”.

### The admin UI: behaviour and accessibility

- **Toggle an audience, go to another editor tab and come back** → the decision is still there and the `ChangedBadge` is lit.
- **Return the control to its original state** → the `ChangedBadge` goes out and the save will not send the key.
- **Set one and save** → the save body carries `extensions.access`; after the response the control neither flickers nor goes into a refetch.
- **Save, then switch locale** → the sibling shows the **new** audiences rather than the cached old ones.
- **“Set every audience to Can see” with a search narrowing the list** → applied to every match rather than to the page; audiences outside the match are untouched; the text under the buttons says “every” means the search's matches.
- **More than 200 matches** → the buttons are disabled with an explanation rather than doing part of the work.
- **An audience narrowed out of the workspace after a decision** → there is no row in the list, but the “N more decisions” counter accounts for it, and the save does not erase it.
- **Type a search while on page four** → the page resets to the first rather than showing “no matches” for a term that has plenty.
- **A role with `segments:read` but no `manage`** → the tab reads, the controls are locked, there is no bulk-actions block, and the bottom line names the permission needed.
- **Open `/segments` without `segments:read`** → a “no access” page; the sidebar item is not rendered.
- **Delete an audience from the directory** → the result count is announced into a live region; the dialog beforehand spelled out the consequences and switched its text when nobody named the audience.
- **Walk both pages and the tab by keyboard** → every control is reachable; the segmented control has an accessible name of the form “Access for {name}”; the actions column is named.
- **A slow network on `/segments` and `/segments/new`** → a skeleton rather than a spinner; the top bar is real; exactly one `<h1>` on screen at the moment of the swap.
- **Press “Create” with an empty name** → the button is enabled, the submit refuses and highlights every offending field at once.
- **Start typing a key** → no error appears before blur or submit.

## 15. Boundaries of responsibility

| Area                                            | Who owns it                                                             | What Segments does                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| The database connection and running migrations  | `@ortha/database` + `@ortha/nx`                                   | Owns the schema and migration **files** and its own journal table, but neither the connection nor the apply step |
| Permission keys, roles, API-token scopes        | `identity-server`                                                       | Only **consumes** `PERMISSIONS.SEGMENTS_READ/MANAGE`, `PermissionsGuard`, `OriginGuard`, `ApiTokenGuard`         |
| Who a reader is                                 | the **host**, through the `SegmentResolver` port                        | Knows nothing about the source; it receives a list of tags and resolves them into audience ids                   |
| The public read path and the query builder      | `content-server` (`PublicEntriesQuery`, `RelationLinkService`)          | Registers into `CONTENT_READ_SCOPE` and hands over one SQL fragment                                              |
| The entry-save transaction, revisions, restores | `content-server` (`EntryWriterService`, the `EntryWriteExtension` port) | Implements `apply` / `inherit` / `capture`; the revisions are appended by **content** from the returned ids      |
| The locale group and shared-field propagation   | `i18n-server` (and the columns added by content's table builder)        | Reads `locale_group_id` **directly**, so as not to depend on a plugin that may not be present                    |
| The records-list filter tree, views, alarms     | `content-admin`, `query-builder-admin`, `alarms`                        | Hands over three virtual fields and their translation into SQL                                                   |
| The tool registry and call authorization        | `tools-server`                                                          | Registers four definitions and declares their `surfaces` and `requires`                                          |
| Copilot proposals, the change card, applying    | `copilot-server` / `copilot-domain`                                     | Hands over a `ProposalDraft` and one `ProposalApplier`                                                           |
| The MCP protocol                                | `mcp-server`                                                            | Knows nothing about the protocol; the tools are simply marked with `surfaces`                                    |
| Whether a workspace exists                      | `workspaces-server`                                                     | Holds uuids with no FK; a deleted workspace narrows an audience rather than widening it                          |

### What else is missing

- **Hooking into entry deletion.** A hard-deleted entry leaves an `entry_access` row. The cost is disk, not correctness.
- **Per-collection or per-workspace access defaults.** Every decision today is per entry. A default would be inheritance, which this design discarded deliberately.
- **A “restricted” column in the records list.** Filtering by access is possible; a column is not there.
- **A bulk action over a selection of entries.** The only bulk action is inside one entry — “set every audience to one state”.
- **A tool or public route over the audience dictionary.** Deliberately absent, see sections 8 and 12.
- **Negation in the access filter.** Deliberately absent, see section 7.8.
- **A “what is restricted in this collection” screen of its own**, even though `entry_access` carries `workspace_id` and `type_slug` and the index for that question already exists.

## 16. Where the code and the documentation diverge

Found while reconciling this dossier with the sources. Not product bugs in themselves, but they mislead developer and tester alike.

| Where                                                              | What it says                                                                                                                                                                      | How it actually is                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/segments/server/AGENTS.md, the “e2e” section              | “`apps/server-e2e/src/server/segments/` holds **four** suites — the directory, the entry-save write path, the public read scope including relations, and the three filter fields” | **Fixed.** There were five suites, not four — those plus `agent-access.spec.ts`, for the agent tools and the public access route. The QA pass corrected the count and added a paragraph on the workspace boundary that did not exist when this was written                                                                                                                    |
| packages/segments/server/AGENTS.md, the file tree                  | `application/` lists four files, `http/` four, `infrastructure/` three                                                                                                            | `application/principal.store.ts` and `http/principal.middleware.ts` are unnamed — even though **later in the same document** there is a whole paragraph titled “`PrincipalStore` holds the request, not the user”. Also unnamed are `infrastructure/locale-group.query.ts` and `infrastructure/uuid-array.ts`, the latter of which has a section of its own in that same file |
| packages/segments/admin/AGENTS.md, the “What it contributes” table | Six rows: the directory, the editor, the chip, the “Access” tab, the save step, the revision line                                                                                 | There are **six** slot contributions, and two of them are missing from the table: `SIDEBAR_NAV_SLOT` (the sidebar item gated on `SEGMENTS_READ`) and `RECORDS_FILTER_FIELDS_SLOT` (the three filter fields). The second is described further down the text, but it is absent from the summary table — and that table is what people read as the list of surfaces              |
| packages/segments/admin/AGENTS.md, the file tree                   | Seven components and three files under `application/` are listed                                                                                                                  | There are **eleven** components: `RevisionAccessValue` and the four skeletons (`SegmentsListSkeleton`, `SegmentFormSkeleton`, `SegmentsPageSkeleton`, `SegmentEditorPageSkeleton`) are unnamed, though they have a section of their own in the same document. Under `application/`, `useAccessFilterFields.ts` is unnamed                                                     |
| packages/segments/admin/src/lib/infrastructure/segmentsGateway.ts  | The port declares `setEntryAccess`, and the HTTP implementation implements it                                                                                                     | The method is **called from nowhere**. That is a direct consequence of the “the hooks deliberately have no write hook” decision: a dead part of the seam remains. The harm is small in itself, but a reader of the port sees a write path the admin UI does not have                                                                                                          |
| packages/segments/domain/src/lib/segment.spec.ts                   | The file is called “segment.spec” and, per the domain's documentation, “the decision table lives here”                                                                            | **Fixed.** Only `isOfferedIn` was covered (three cases), while `segmentIdsForTags` — the function that turns a reader's tags into audience ids, and the single point where a raw tag is matched against anything — had no unit test at all. The QA pass added eight, and `sameAccess` six; see section 17                                                                     |
| packages/segments/admin/AGENTS.md, “What is not here yet”          | “A records column showing which entries in a collection are restricted” and “A bulk action setting the same audiences on a selection”                                             | True, but the neighbouring root `AGENTS.md` describes another plugin's contributions (alarms) as “an optional records column”, which makes it easy on a quick read to conclude segments has a column too. It genuinely does not                                                                                                                                               |
| The root AGENTS.md, the `packages/segments/*` paragraph            | “`admin` is the audience directory plus the entry editor's Access tab, where each audience gets one three-state control”                                                          | Incomplete: it mentions neither the revision line (“Who can read this”), nor the three records-list filter fields, nor the chip by the entry's title — that is, half the admin plugin's surfaces. The wording has fallen behind the code rather than contradicting it                                                                                                         |

> **What passed the reconciliation without a note**
>
> Every substantive claim in both `AGENTS.md` files about the model, the predicate, the catalogue cache, the resolver's fail-closed behaviour, the locale group, the stability of the `access` key, the permission check inside the extension, `uuidArray`'s behaviour, the split of agent surfaces and the absence of a tool over the dictionary is confirmed by the code word for word. The route table in `server/AGENTS.md` is correct too, scope and permission notes included.

## 17. What the QA pass found

This dossier was written from the code, and the code has since been read again — against a live database, a compiled server, the e2e suites and the units. What follows is what that pass changed, so the document and the implementation do not drift apart again. PR [#231](https://github.com/apograph-source/apograph-cms/pull/231); the full write-up is [here](https://claude.ai/code/artifact/8a114b1a-ae60-4c81-9865-821650da79df).

> **A write could cross the workspace boundary**
>
> `entry_access` has an `entry_id` primary key and a `workspace_id` column. The read filtered on both; **the write filtered on neither**, taking the entry id from the caller and trusting it.
>
> That mattered more than the phrase “tenant scoping” usually implies, because the enforcement predicate this dossier prints in section 4 matches on `entry_id` **alone** — `workspace_id` is carried for the admin's lists and is never consulted when a reader is matched. So a row written against a foreign id governed that entry's reads all the same. Observed on a live stand, both directions: two empty lists **deleted** another workspace's restriction and published its content; a non-empty pair **re-homed** the row to the caller's workspace, where the owning editor could no longer see the restriction that was hiding their own entry. A uuid naming no entry at all was accepted too, leaving a row for a record that does not exist.
>
> Four of the five write paths could drive it — the admin `PUT`, the public `PUT`, `content_access_set`, and an accepted copilot proposal. Only the entry save was safe, because content had already resolved the id inside the workspace before handing the extension its id. The guards were all correct: they check the workspace in the _header_ against membership or a token's bucket, and neither looks at the id in the path — that is the service's question, and it was not being asked.
>
> **Fixed** by one check in `writeGroup`, the single point all five paths pass through, answering a foreign id with the same `404` an id that exists nowhere gets — telling those apart would make every write path an oracle for entry ids. Now **I-41**.

> **A cap only the routes applied**
>
> Both `PUT` DTOs cap each side at 200, and `MATCHED_IDS_CAP` in the directory service is set to that same number _on the stated grounds that it is what an entry can store_. But the entry save carries its lists in content's opaque `extensions` bag, which passes no DTO — and that is the path the admin actually writes through. It applied no cap at all. No damage was observed; it is fixed because the code's own reasoning depended on it being true. Now **I-42**.

### Coverage the pass closed

- **`segmentIdsForTags`** — the only place a raw reader tag is compared to anything, and therefore the whole seam between a deployment's vocabulary and this model's — had **no unit test**. Eight added: any-one-tag matching, case sensitivity, an unknown tag resolving to nothing rather than everything, the anonymous reader, and a tagless segment matching nobody.
- **`sameAccess`** decides whether the permission check runs at all (**I-17**), and had no unit test on the server side. Six added.
- **The revision line's three states** had no browser test — the admin-e2e revisions mock could not serve a snapshot's `extra` at all. Three added, including “not recorded in this version”, which is the state a restore turns on.
- **The boundary itself**, at every level it has: six server-e2e across the three affected paths, plus the manual pass against a compiled server.

### Still open

- **The title chip** still has no browser test. It is no longer untested — `EntryAccessChip/index.spec.tsx` pins **I-30**: nothing rendered while the workspace has no audiences, nothing rendered before there is an entry to describe, and the open and restricted readings — but that is a component in isolation, not the chip beside a real entry's title.
- **The admin package keeps its own copies** of `sameAccess`, `isOpen` and `EntryAccess` while depending on `@ortha/segments-domain` and importing `validateSegment` from it. They agree today; the domain's own documentation is the argument against it. A decision, not a bug.
- **Two admin checklist rows** remain undriven: switching locale after a save, and resetting the pager when a search is typed on page four. The third — the bulk control past 200 matches — is now driven by `entry-access.spec.ts` → “refuses the bulk set when more matched than an entry can name”, which asserts all three buttons disabled and the reason on screen. The locale row's _mechanism_ is pinned by `useEntryAccessPresave.spec.tsx` (**I-29**: the saved row is seeded and every other cached entry invalidated); what no test drives is the editor actually switching locale afterwards.

> **Recorded, not claimed**
>
> The development database holds **four fully orphaned `entry_access` rows with both lists empty** — the state **I-13** says is never stored. Neither their workspace nor their entry still exists, and their timestamps fall in a twelve-minute window during the `workspaces` pass, when probes were running against a build that turned out to be stale. It could not be reproduced against current code by any path tried, so it is written down rather than reported as a defect, and the rows were left in place. The fix above does close one route to a related state: writing access against an id that names no entry used to succeed.

---

**The series' second dossier.** Written for the `packages/segments` group on the frame of the pilot `identity` dossier: business description → composition → permissions → truth table → data → lifecycle → scenarios → API → agent surfaces → admin UI → configuration → security → invariants → checklist → boundaries → divergences. Two sections were added for this plugin: the **`canRead` truth table** (which is both the specification and a draft set of tests) and **agent surfaces**, because the four ways into the plugin differ not by protocol but by who is acting. There are no “account lifecycle” or “SSO” sections here — the plugin has neither.

The source is the source code: the domain kernel and its specs, the Drizzle schema and both migrations, the controllers and DTOs, the `CONTENT_READ_SCOPE` and `EntryWriteExtension` implementations, the tool providers, the admin pages, hooks and slots, plus the wiring points in `identity-server`, `content-server` and `apps/server`. The `AGENTS.md` files were used as the frame, but every claim was checked against the implementation — the divergences are gathered in section 16, and what the later QA pass changed in the code is section 17.
