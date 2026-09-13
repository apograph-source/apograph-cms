# Tools

_Package · packages/tools/server_

**The single catalogue of what an agent may do to the CMS — and the one place a tool call is authorized**

`@apograph/tools-server` can do nothing by itself. It owns the **tool contract**, the **registry** and **one permission check** that both consumers must pass through: the external MCP endpoint and the copilot's internal run loop. The tools are brought by the application plugins — content, media, locales, the journal, alarms, audiences, members. The package owns no table, makes no network call and does not know the words “HTTP” and “JSON-RPC”.

- **40** tools in the registry
- **23** visible to the `mcp` surface
- **23** visible to the `copilot` surface
- **6** shared by both
- **7** producing packages
- **14** provider classes
- **0** database tables
- **1** authorization point

## Contents

- [01. Business description](#01-business-description)
- [02. Composition of the package](#02-composition-of-the-package)
- [03. Two surfaces, one instance](#03-two-surfaces-one-instance)
- [04. The complete tool registry](#04-the-complete-tool-registry)
- [05. Roles, permissions and tool visibility](#05-roles-permissions-and-tool-visibility)
- [06. A tool call's lifecycle](#06-a-tool-calls-lifecycle)
- [07. Scenarios — how it works, step by step](#07-scenarios-how-it-works-step-by-step)
- [08. The API: the contracts and their signatures](#08-the-api-the-contracts-and-their-signatures)
- [09. Validation: at startup and at call time](#09-validation-at-startup-and-at-call-time)
- [10. Errors and their way out](#10-errors-and-their-way-out)
- [11. The checklist for the author of a new tool](#11-the-checklist-for-the-author-of-a-new-tool)
- [12. Configuration](#12-configuration)
- [13. Security and authorization](#13-security-and-authorization)
- [14. Invariants](#14-invariants)
- [15. Testing checklist](#15-testing-checklist)
- [16. Boundaries of responsibility](#16-boundaries-of-responsibility)
- [17. Divergences between code and documentation](#17-divergences-between-code-and-documentation)

## 01. Business description

Apograph has two fundamentally different audiences of machine client. The first is an **external agent**: Claude Desktop, Cursor, a hand-written SDK client. It arrives over HTTP with a bearer token and wants to ask the server what it can do. The second is the CMS's **own copilot**: it lives inside the process, acts on behalf of the signed-in person, and calls those same operations with no HTTP at all.

Those two audiences used to be served by two different bodies of code. For a while the repository held two instances of every concept: `ToolSpec` and `ToolDefinition`, `permissions[]` and `requires[]`, `CopilotToolRegistry` and `ToolRegistry` — and, most importantly of all, **two independent implementations of a permission check over the same content**. The `tools/server` package is the decision to collapse them into one (`docs/adr/0007-one-tool-registry-two-surfaces.md`).

### The problem it solves

- **One permission check instead of two.** A change to the access rules physically cannot apply to MCP and miss the copilot: both surfaces call `ToolRegistry.call`, and the `requires` check lives inside it.
- **A plugin registers a capability once.** `media`, `i18n`, `activity`, `alarms`, `segments` and `users` put their tools into the same registry as `content`. A new capability does not require separate work to “do the same again for the other surface”.
- **Deliberate addressing.** A tool declares who it is meant for (`surfaces`). That is not a filter off to one side guessing at the author's intent, but a field next to the definition that is visible in code review.
- **An application plugin is not turned inside out.** A tool lives inside its own plugin and calls that plugin's own internal services (`PublicEntriesQuery`, `EntryAccessService`). Nothing has to be re-exported for another package's sake — and that is exactly how a second, diverging copy of the visibility rules comes about.
- **The catalogue as a product.** For an external agent the tool list _is_ the documentation. Each description is written **for a model** rather than for a person: it carries the workflow rules (“a create yields a draft”, “publishing is a separate call”, “an update merges fields”).

### Who sees it

#### The external agent

Connects to `POST /api/v1/mcp` with an API token. It sees exactly the tools its token's scope has the permissions for; a refusal names the missing permission in plain words, so the model stops trying.

#### The copilot in the admin UI

Acts on behalf of the person who opened it. The tool set is recomputed on **every run**: a permission taken away from a role disappears from the very next answer rather than a day later.

#### The application-plugin author

Writes a `ToolProvider`, registers in `onModuleInit` through `@Optional()` and declares `requires`. They do not write their own permission check — and are not entitled to.

### What Tools is not

The boundaries explain almost the whole shape of the package:

- **It is not MCP.** Not a line about JSON-RPC, Streamable HTTP, `isError` or `structuredContent`. All of that is `packages/mcp/server`. If the contract lived there, a deployment with a copilot and _no_ MCP would drag `@modelcontextprotocol/sdk` along — a dependency on a protocol it does not speak.
- **It is not the copilot.** No run loop, no SSE, no model, no proposals (`copilot_proposals`). The `effect` field is only declared here; the run engine is what gives it meaning.
- **It is not the tools.** The package contains not one callable tool — only the contract and the registry. All 40 come from seven application plugins.
- **It is not a data model.** **Zero tables, zero migrations, no `drizzle.config.ts`.** The registry lives entirely in the process's memory and is reassembled on every start.
- **It is not a JSON Schema validator.** `validateToolInput` is a deliberately trimmed subset, and what it cannot do is listed in its own JSDoc.

> **The architecture's key idea**
>
> **Filtering the list is a convenience; the check at call time is the boundary.** `visibleTo()` hides what a caller could not call anyway: an MCP client is free to name something it was never shown, and a language model can invent a name outright. So `call()` re-checks `requires` before dispatch — the direct analogue of a `@RequirePermissions(...)` on a route, with the difference that Nest guards _routes_, whereas here one route carries dozens of operations.

## 02. Composition of the package

The whole package is seven source files and three test files. It is probably the monorepo's smallest package with the highest density of decisions per line.

| File                           | What is in it                                                                                                                                   | Why it exists separately                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| src/lib/tool.ts                | `ToolDefinition`, `ToolContext`, `ToolActor`, `ToolEffect`, `ToolSurface`, `ToolOutput`, `JsonSchema`, `ResourceDefinition`, `ResourceContents` | The transport-neutral contracts. Its one external import is `PermissionKey` from `@apograph/identity-server`, so `requires` is a typed union rather than a string                     |
| src/lib/tool-registry.ts       | `ToolRegistry`: `register`, `all`, `forSurface`, `visibleTo`, `call`, `resources`, `readResource`, `onApplicationBootstrap`                     | The one authorization point and the one place the catalogue is validated at startup                                                                                                   |
| src/lib/tools.module.ts        | `ToolsModule` — `@Global()`, `providers: [ToolRegistry]`, `exports: [ToolRegistry]`                                                             | The module is **imported by both consumers and provided by neither**. Nest caches a static module by its class, so a double import yields one instance                                |
| src/lib/tool-provider.ts       | The `ToolProvider` port: `tools()`, plus optional `resources()` and `readResource()`                                                            | The dependency inversion that keeps the package graph acyclic: the registry does not know about content, and content registers itself                                                 |
| src/lib/tool-context.ts        | `createToolContext(actor, workspaceId)`                                                                                                         | The context constructor belongs to neither consumer: MCP builds it from a token, the copilot from a session. A shared constructor is what makes `can()` mean the same thing           |
| src/lib/validate-tool-input.ts | `validateToolInput(input, schema)` — a subset of JSON Schema                                                                                    | It used to live in the copilot's framework-free kernel, which meant only the run loop applied it while MCP had, all along, been dispatching unchecked arguments into those same tools |
| src/lib/tool-error.ts          | `toToolError(error)` and the `ToolError` type                                                                                                   | Flattening any throw into `{ status, code, message, issues? }`. A non-`HttpException` is treated as a bug and goes out as an opaque 500                                               |
| src/index.ts                   | The package's public barrel                                                                                                                     | It exports `validateToolInput` separately too — because a consumer may want to reject a malformed call _before_ the registry does (which is what the run engine does)                 |

### Dependencies

`package.json` declares exactly two: `@nestjs/common` (the `@Injectable`/`@Global` decorators, the exception classes, `Logger`) and `@apograph/identity-server` (`PermissionKey` and `PERMISSION_KEYS`). No Drizzle, no HTTP client, no vendor SDK.

> **The data model**
>
> There is none. The package owns no table and ships no migrations — unlike `identity` (11 tables), `copilot` (conversations, messages, proposals, tool calls) or `alarms` (rules and findings). A call's trace is written by the **consumer**: the copilot puts a row into `copilot_tool_calls`, and MCP writes nothing beyond logs. That is deliberate: the registry must not be able to write, or it stops being transport-neutral.

## 03. Two surfaces, one instance

A surface (`ToolSurface`) is a **consumer of the registry** rather than a kind of client or a transport. There are exactly two, and the difference between them is not cosmetic.

|                                     | `mcp`                                                                          | `copilot`                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **Who calls**                       | an external agent over `POST /api/v1/mcp`                                      | the copilot's run loop, in-process                                         |
| **The actor**                       | `kind: 'token'` — the token acts for itself                                    | `kind: 'user'` — the run acts on a person's behalf                         |
| **Where the permissions come from** | `scopePermissions(token.scope)`                                                | `PermissionsService.forRole(user.roleId)`                                  |
| **Who builds the context**          | `McpAuthService.authenticate`                                                  | `CapabilityProfileService.resolve`                                         |
| **The workspace**                   | from `X-Workspace-Id` or `?workspaceId=`, checked against the token's “basket” | from the run's header, checked by membership                               |
| **Cancellation**                    | the transport's `extra.signal` + a 30 s deadline of its own                    | the live SSE stream's `signal`                                             |
| **What it does with `effect`**      | nothing — there is no engine                                                   | `propose` → a `copilot_proposals` row, then the apply; `apply` → a receipt |
| **What an error looks like**        | an `isError` result (tools) or a JSON-RPC error (resources)                    | a `tool_result` block with `isError` + an SSE `tool-result` event          |
| **Exchange limits**                 | a 1 MB body, a 30 s call, a 4 MiB result                                       | `RunLimits`: steps, time, tokens; plus a pause for confirmation            |

### Why this must be one instance — and how that is ensured

`ToolsModule` is marked `@Global()` and imported by **both** consumers:

```
// packages/mcp/server/src/lib/mcp.module.ts
imports: [ToolsModule],
exports: [MCP_CONFIG, ToolsModule]

// packages/copilot/server/src/lib/copilot.module.ts
imports: [ …, ToolsModule ]
```

- If the registry were provided by `McpModule`, a deployment with a copilot and no MCP would be left **with no registry and no tools**.
- If each provided its own, an application plugin's tools would land in whichever instance won at DI, and the other would silently hold an empty catalogue.
- An application plugin **does not import** `ToolsModule`. It injects `ToolRegistry` as `@Optional()`, because a deployment may run neither consumer — in which case its tools simply are not registered, and the application must still boot.

> **This is checked, not assumed**
>
> `apps/server-e2e/src/server/tools/tool-registry.spec.ts` boots the application **three times**: with both consumers (asking each for the same shared tool), without MCP (the copilot must keep the full catalogue) and without the copilot (the same for MCP). A suite that boots both and asks only one would not see this breakage at all.

### The two switches are independent

**MCP_ENABLED=false** → **the catalogue is intact, the copilot works**

**COPILOT_ENABLED=false** → **the catalogue is intact, MCP works**

Each switch removes only **its own routes**, not the shared wiring: `McpModule` still imports `ToolsModule` and registers `McpAuthService`, it simply does not register the controller. Neither switch shrinks the shared catalogue.

## 04. The complete tool registry

Forty tools, fourteen provider classes, seven producing packages. Not one of them lives in `tools/server` — the package owns the contract, not the capabilities. Below is the full list by owner; in the “surfaces” column a dash means the **`surfaces` field is absent**, that is, the tool is offered to both.

### Summary

| Producing package | Providers | `mcp` only | `copilot` only | Shared | Total  |
| ----------------- | --------- | ---------- | -------------- | ------ | ------ |
| content/server    | 4         | 16         | 8              | 0      | 24     |
| media/server      | 3         | 0          | 2              | 3      | 5      |
| i18n/server       | 2         | 0          | 3              | 1      | 4      |
| segments/server   | 2         | 1          | 1              | 2      | 4      |
| activity/server   | 1         | 0          | 1              | 0      | 1      |
| alarms/server     | 1         | 0          | 1              | 0      | 1      |
| users/server      | 1         | 0          | 1              | 0      | 1      |
| **Total**         | **14**    | **17**     | **17**         | **6**  | **40** |

From which: the `mcp` surface sees **23** tools (17 of its own + 6 shared), and the `copilot` surface also sees **23** (17 of its own + 6 shared). The symmetry of the numbers is a coincidence rather than a rule.

### 4.1 Public content — `content/server`, the `mcp` surface

The `ContentToolProvider` class (`src/lib/mcp/content-tools.provider.ts`). All sixteen are stamped `surfaces: ['mcp']` in **one place** in `tools()` rather than one at a time: uniformly, this is the _public API_ set — reading through `PublicEntriesQuery` (published only, by default), writing through `PublicEntryWritesService` with attribution to the token (`actor = null`). Every handler goes through the `resolveGrantedType` grant gate: a type not granted to the workspace answers 404 exactly as a nonexistent one does.

| Tool                   | Permissions                    | RO  | What it does; what it reads or writes                                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------ | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| content_types_list     | content:read                   | yes | The workspace's content types: the name, the label, the kind (collection/singleton), and the publishable / localized / soft-delete flags. Reads `ContentTypeRegistry.summaries()`, filtered by `WorkspaceGrantsQuery.grantedSlugs`. The entry point of any conversation about authoring |
| content_type_get       | content:read                   | yes | One type's full schema plus a generated JSON Schema for the `values` bag. It uses the same `fieldSchema` as the OpenAPI document — two descriptions of a type cannot diverge                                                                                                            |
| content_list           | content:read                   | yes | A page of a type's entries. Published only by default; `status` opens drafts and requires `content:update` (`assertDraftVisibility`). Supports `search`, a `filter` tree, `sort`, pagination and a sparse field set                                                                     |
| content_get            | content:read                   | yes | One entry by `id` or by `localeGroupId` + `locale`, with relations, media and translations expanded. A draft, a deleted row, another workspace and an unknown `id` all give the same “not found”                                                                                        |
| content_relations      | content:read                   | yes | One ordered page of one relation field's links — a way around the ceiling the relation preview in `content_get` imposes. It shows and counts published targets only                                                                                                                     |
| content_media          | content:read, media:read       | yes | All of an entry's media fields, resolved down to asset metadata (name, kind, MIME, alt) and a URL. **The only MCP tool with two permissions**                                                                                                                                           |
| content_translations   | content:read                   | yes | The other locales of a translation group, by locale slug. The entry itself is not repeated; on a non-localised type it is an error                                                                                                                                                      |
| content_create         | content:create                 | no  | **Writes.** On a publishable type it creates a **draft**: publishing is a separate call. Required fields are required _to publish_ rather than to create                                                                                                                                |
| content_update         | content:update                 | no  | **Writes.** A partial update: the `values` sent are merged over what is stored, and an explicit `null` clears a field. It returns a published entry to draft while the live version stays on air                                                                                        |
| content_publish        | content:publish                | no  | **Writes.** Re-validates the stored entry and puts it on air. This is where `required` bites, with the offending fields enumerated                                                                                                                                                      |
| content_unpublish      | content:publish                | no  | **Writes.** Returns an entry to draft — it leaves the public reads immediately                                                                                                                                                                                                          |
| content_delete         | content:delete                 | no  | **Writes, `destructive: true`.** Deletes exactly one row: on a localised type the other translations stay alive. Recoverable from the trash on a soft-delete type                                                                                                                       |
| content_bulk_save      | content:create, content:update | no  | **Writes.** Creating and/or updating many entries of one type. **Always succeeds as a call**: each item has its own verdict in the same position, and a failure carries its reason. The model must read `failed`                                                                        |
| content_bulk_publish   | content:publish                | no  | **Writes.** Publishes those that validate and returns the rest in `skipped` with a reason: `already-published`, `blocked`, `not-found`. A partially skipped batch is a normal outcome                                                                                                   |
| content_bulk_unpublish | content:publish                | no  | **Writes.** `count` is how many rows actually changed; an `id` that was not a live published entry does not count                                                                                                                                                                       |
| content_bulk_delete    | content:delete                 | no  | **Writes, `destructive: true`.** Deletes exactly the listed rows; translations are untouched                                                                                                                                                                                            |

> **Resources, not just tools**
>
> That same provider is the only one in the repository implementing `resources()` and `readResource()`. Every type granted to the workspace is published as an `apograph://content-type/<name>` resource with the MIME type `application/json`, so a client that understands resources can pull the schema into context without spending a tool call. Reading goes through the same grant gate: an ungranted type 404s here too. These resources **declare no `requires`** — they are already narrowed to the workspace's grants by whoever builds them.

### 4.2 Admin content — `content/server`, the `copilot` surface

Three classes: `ContentCopilotToolProvider`, `RevisionCopilotToolProvider`, `EntryProposalToolProvider`. These are **not duplicates** of the set above: they read the admin services (where an observer legitimately sees drafts) and write through a “proposal”, attributing the change to the person who accepted it. Hence the `admin_` prefix — the set is distinguishable at the call site and in every audit row.

| Tool                      | Permissions                    | `effect` | What it does; what it reads or writes                                                                                                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| admin_content_types       | content:read                   | read     | The workspace's types; with a `typeName`, the full field schema **plus the paths that may be filtered and sorted on**. Neither is in the system prompt, so this call is mandatory before building a filter                                                                                                                                       |
| admin_content_search      | content:read                   | read     | A search over a type's entries: `search` + a structural `filter` + `fields`. It answers with a **true total**, so the model can name the number of matches having read one page. The description separately explains that publication state is _two_ fields, and that “changed but not published” is `status=draft` AND a non-null `publishedAt` |
| admin_content_get         | content:read                   | read     | One entry by `id` with every field value — an admin read, drafts included                                                                                                                                                                                                                                                                        |
| admin_content_revisions   | content:read                   | read     | An entry's stored versions, newest first: the number, the status (draft / published / superseded), and when and by whom it was captured. Each locale has its own timeline                                                                                                                                                                        |
| admin_content_diff        | content:read                   | read     | A comparison of two versions: only the changed fields with their before and after values; the number of unchanged ones is reported separately                                                                                                                                                                                                    |
| content_propose_create    | content:create                 | propose  | **Writes nothing itself.** It prepares a `ProposalDraft` of the `CONTENT_PROPOSAL_KINDS.createEntry` kind; the run engine writes the `copilot_proposals` row and applies it                                                                                                                                                                      |
| content_propose_update    | content:update                 | propose  | The same for editing an existing entry (`updateEntry`)                                                                                                                                                                                                                                                                                           |
| content_propose_bulk_save | content:create, content:update | propose  | A batch of changes as one proposal (`bulkSaveEntries`) — one card instead of ten, while still writing nothing in the handler                                                                                                                                                                                                                     |

### 4.3 Media — `media/server`

Three reads (`MediaCopilotToolProvider`) — **the registry's first genuinely shared tools** — and two proposals (`AltTextProposalToolProvider`, `CreateFileProposalToolProvider`).

| Tool                   | Surfaces  | Permissions  | `effect` | What it does; what it reads or writes                                                                                                                                                                                                                    |
| ---------------------- | --------- | ------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| media_assets_search    | `both`    | media:read   | read     | Searching assets by file name **across every folder at once**: a model asked “do we have a logo” does not know which folder to look in. The projection is narrowed — variant lists and dimensions cost tokens and answer nothing. The page ceiling is 25 |
| media_folders_list     | `both`    | media:read   | read     | Every folder in the library as a **flat list** with file counts: `parentId` is enough for the model to reconstruct the tree and is cheaper than nesting                                                                                                  |
| media_asset_read       | `both`    | media:read   | read     | The contents of a text file from the library — Markdown, CSV, JSON. The list of readable types is the media plugin's own allowlist                                                                                                                       |
| media_propose_alt_text | `copilot` | media:update | propose  | A proposal of alt text for an asset (`MEDIA_PROPOSAL_KINDS.setAltText`). It stores nothing in the handler. `media:update` is granted by no token scope                                                                                                   |
| media_propose_file     | `copilot` | media:create | propose  | Writing a new text file into the library — a report, a summary, a CSV (`createFile`). This is how the copilot “hands” a piece of work back into the CMS                                                                                                  |

> **The one legitimate difference between the surfaces**
>
> The `downloadPathFor(assetId, surface)` function is **a link, and only a link**. For `mcp` it returns `/api/v1/media/assets/:id/raw` (the `media:read` rule, reachable with the same bearer token that made the call), and for the copilot `/api/media/assets/:id/raw` (a session + membership, which a browser opens directly). The session route would answer an external agent with a 401, and a broken link reads as a broken library. Both routes apply the same workspace narrowing and the same `media:read`: **this is presentation, not authority**.

### 4.4 Locales and translations — `i18n/server`

| Tool                          | Surfaces  | Permissions    | `effect` | What it does; what it reads or writes                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | --------- | -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| i18n_locales_list             | `both`    | content:read   | read     | The locales the CMS is configured for, with their slugs and which is the default. This is **deployment configuration**: identical for any caller, with no publication state in it at all                                                                                                                                                           |
| i18n_translations_get         | `copilot` | content:read   | read     | For one entry of a localised type — every configured locale and whether a translation exists. **Deliberately narrowed**, though it sits in the same file as its shared neighbour: `LocaleGroupService.liveWhere` narrows by workspace and soft-delete but **not by publication state**, so the tool reports a draft translation and its status too |
| i18n_propose_translation      | `copilot` | content:update | propose  | A proposal to translate an entry into another locale, creating that locale's row (`createTranslation`)                                                                                                                                                                                                                                             |
| i18n_propose_bulk_translation | `copilot` | content:update | propose  | Several entries × several locales as **one change** (`bulkTranslation`) — otherwise translating ten entries into three languages would produce thirty cards to confirm                                                                                                                                                                             |

### 4.5 Reader audiences — `segments/server`

The split is clearest here: **both reads are shared and the write is split in two** — a direct one for MCP and a “proposal” for the copilot.

| Tool                   | Surfaces  | Permissions     | `effect` | What it does; what it reads or writes                                                                                                                                                                                                                                                                                             |
| ---------------------- | --------- | --------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| segments_list          | `both`    | segments:read   | — (read) | The audiences this workspace may restrict content to. Narrowed by workspace the same way the editor's list is: offering an audience an entry will not then accept is worse than not offering it. An empty list means the installation has no restrictions at all                                                                  |
| content_access_get     | `both`    | segments:read   | — (read) | Who can see a published entry. It answers **from the plugin's own table**, by `entryId` and workspace, rather than through a public entry read: otherwise an agent that had just restricted an entry could not read back what it did — the restriction it wrote would be hiding it. An empty `allow` means EVERYONE, not “nobody” |
| content_access_set     | `mcp`     | segments:manage | — (read) | **Writes directly.** It replaces both lists wholesale: there is no spelling for “leave the rest alone”. It applies to **every language of the entry** — who may read is a fact about the entry rather than about its translation. A bearer token is its own actor; there is nobody to ask permission from                         |
| content_propose_access | `copilot` | segments:manage | propose  | The copilot's twin of the previous one: it prepares a `SEGMENTS_PROPOSAL_KINDS.setEntryAccess` and writes nothing itself                                                                                                                                                                                                          |

> **What is deliberately absent here**
>
> **Not one tool over the audience directory** — no creating, renaming, re-tagging or deleting. Renaming one audience's tags changes the visibility of every entry naming it across the whole installation; deleting one rewrites both lists on every such entry. That is dictionary administration, and it stays on a session-backed screen where a person looks at the consequence a dialog spells out for them. So `segments:manage` on a `full`-scope token reaches exactly as far as an entry and no further.

### 4.6 The journal, alarms and members

| Tool                   | Package         | Permissions   | What it does; what it reads or writes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | --------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| activity_recent        | activity/server | activity:read | A page of the audit trail, newest first, filterable by event kind. **The tool is installation-wide rather than workspace-wide**, and that is not an oversight: `activity_events` has no workspace column, because the trail holds invitations, role changes and workspace lifecycle — events some of which have no workspace at all. The tool says so in its description rather than implying a boundary it cannot enforce. What bounds it is `activity:read`, which in the role matrix **only the administrator** has. The page ceiling is 25                          |
| admin_alarms_findings  | alarms/server   | alarms:read   | Content problems flagged by the workspace's rules. It reads the same `AlarmFindingStore` as the HTTP routes. Each finding carries an `entryId`, so the model's natural next step is `admin_content_get`. `alarms:read` is held by all three roles, deliberately: findings are already rendered right in the entry editor. **There is no write tool here**: “muting” a finding is a person's decision about whether an exception is acceptable, which is what the feature exists for                                                                                     |
| workspace_members_list | users/server    | users:read    | The **current** workspace's members: e-mail, name, role, account status — exactly the columns the members page renders for the same permission. Through a targeted `WorkspaceMembersQuery` rather than the general user directory: `users:read` would allow enumerating every account in the installation, and a workspace-bound run has no reason to — and the narrow answer is more useful besides. No invite tokens, no sessions, no password state. This is the tool that turns an `actorEmail` from `activity_recent` into a person's name. The page ceiling is 50 |

### 4.7 Test fixtures (not part of the product registry)

`apps/server-e2e/src/support/copilot-fixture-tools.ts` defines four tools — `fixture.readThing`, `fixture.proposeThing`, `fixture.applyThing`, `fixture.explodes`. They are registered only by the copilot's suite and are published nowhere. Their existence is substantive: **the product catalogue has not one tool with `effect: 'apply'`**, so the direct-write branch is covered by a fixture alone. All four are marked `surfaces: ['copilot']` so they do not leak into the MCP suite's exact assertions about the catalogue's contents.

> **An incidental observation**
>
> The fixture names — `fixture.readThing` — **do not pass** `TOOL_NAME_PATTERN` (`snake_case` only). The application does not fail purely because they are registered _after_ `app.init()`, once `onApplicationBootstrap` has already run. That is exactly where the startup check's limitation shows: it validates only the providers that registered before initialisation ended.

## 05. Roles, permissions and tool visibility

The registry invents no permission model of its own. It takes a ready-made set of `resource:action` keys and can do exactly one operation — a membership check. Who computed those keys depends on the surface.

### The permissions an actor is made of

| Surface   | Where the permissions come from    | What comes out                                                                                                                                                                      |
| --------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp`     | scopePermissions(token.scope)      | `read` → `content:read`, `media:read`, `segments:read`.<br>`full` → plus `content:create`, `content:update`, `content:publish`, `content:delete`, `media:create`, `segments:manage` |
| `copilot` | PermissionsService.forRole(roleId) | The role's full set: an administrator all 30 keys, a contributor 15, an observer 7                                                                                                  |

> **One permission, two meanings — and here it bites**
>
> A **token's** `content:read` is the public API's scope: published only. A **user's** `content:read` is an observer, who legitimately sees drafts in the admin interface. One key, two meanings. Which is precisely why the content tool set is split: an observer offered `content_list` would have the copilot quietly stop showing them drafts — that is, most of what the panel is opened for.

### Who sees which tool

| Permission      | `read` token | `full` token | observer | contributor | admin | What it opens                                                                          |
| --------------- | ------------ | ------------ | -------- | ----------- | ----- | -------------------------------------------------------------------------------------- |
| content:read    | yes          | yes          | yes      | yes         | yes   | 7 MCP reads + 5 admin reads + `i18n_*_get/list`                                        |
| content:create  | —            | yes          | —        | yes         | yes   | `content_create`, `content_propose_create`                                             |
| content:update  | —            | yes          | —        | yes         | yes   | `content_update`, drafts in `status=`, `content_propose_update`, both `i18n_propose_*` |
| content:publish | —            | yes          | —        | yes         | yes   | `content_publish`, `content_unpublish` and their bulk versions                         |
| content:delete  | —            | yes          | —        | —           | yes   | `content_delete`, `content_bulk_delete`                                                |
| media:read      | yes          | yes          | yes      | yes         | yes   | the three shared `media_*` reads, `content_media`                                      |
| media:create    | —            | yes          | —        | yes         | yes   | `media_propose_file` (though the tool is narrowed to the copilot)                      |
| media:update    | —            | —            | —        | yes         | yes   | `media_propose_alt_text`                                                               |
| segments:read   | yes          | yes          | yes      | yes         | yes   | `segments_list`, `content_access_get`                                                  |
| segments:manage | —            | yes          | —        | —           | yes   | `content_access_set` (mcp), `content_propose_access` (copilot)                         |
| alarms:read     | —            | —            | yes      | yes         | yes   | `admin_alarms_findings`                                                                |
| activity:read   | —            | —            | —        | —           | yes   | `activity_recent`                                                                      |
| users:read      | —            | —            | yes      | yes         | yes   | `workspace_members_list`                                                               |

The table yields a practical consequence worth keeping in view when adding a tool: **a token scope grants `activity:read`, `users:read`, `alarms:read` and `media:update` under no scope at all**. A tool with such a `requires`, offered to the `mcp` surface, would appear in `tools/list` and be refused on every call — which is worse than being absent, because it advertises a capability that does not exist.

> **Why a surfaces field rather than “let the permission check sort it out”**
>
> Because a coincidence in the scope table is not a decision. If a future token scope started including `alarms:read`, a tool with no declared `surfaces` would silently open a surface nobody decided to open. A declared field is intent, pinned down, and it survives a change to the neighbouring table.

## 06. A tool call's lifecycle

A tool has no state and no database row, so its “lifecycle” here is the sequence of gates one call passes through. There are five, and the order between them is chosen so that an error at one level tells you nothing about the level below.

**known on the surface?** → **permissions?** → **arguments?** → **the handler** → **flattening the result or the error**

| #   | Gate                     | Where                   | The answer on failure                | Why exactly here                                                                                                                                                                                                               |
| --- | ------------------------ | ----------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | Assembling the catalogue | onApplicationBootstrap  | the process does not start           | A duplicate name, a non-`snake_case` one, an empty `surfaces`, a nonexistent permission, a malformed `inputSchema` — these are wiring errors. A wiring error belongs to the deployment rather than to the first unlucky caller |
| 1   | Narrowing by surface     | forSurface(surface)     | `404 Unknown tool`                   | An MCP client that named `content_propose_edit` should get “no such thing” rather than an offer it has no way to accept                                                                                                        |
| 2   | The `requires` check     | permits(tool, context)  | `403` naming the missing permissions | **The security boundary.** _All_ the listed keys are required, and the check is an exact set membership                                                                                                                        |
| 3   | Argument validation      | validateToolInput       | `422` with per-field `issues`        | Strictly after the permission check: a caller who is not allowed must learn nothing about the arguments                                                                                                                        |
| 4   | Stamping the surface     | { ...context, surface } | —                                    | Set by the registry rather than by the edge: by construction, a handler sees the surface its `surfaces` was narrowed against                                                                                                   |
| 5   | The handler              | tool.handler(args, ctx) | a throw → `toToolError`              | A handler **does not check its own gate**. It may refine decisions _more finely_ than its `requires` through `ctx.can()` — as `assertDraftVisibility` does                                                                     |

> **Why unknown and forbidden answer differently**
>
> The tool list is **no secret**: it is derived from the caller's own scope or role, which they can read in their own profile anyway. Naming a missing permission saves the model a turn rather than giving away somebody else's secret. **The opposite rule applies to data**: an ungranted content type answers 404 indistinguishably from a nonexistent one — on both surfaces.

## 07. Scenarios — how it works, step by step

### 7.1 Assembling the catalogue at application start

The catalogue is described nowhere in configuration. It is assembled bottom-up from the DI graph and validated once.

1. **The host brings the plugins up.** `createServer({ plugins })` imports each plugin's dynamic module. `ToolsModule` is not in the plugin list — it enters the graph transitively, because `McpModule` and `CopilotModule` import it.
   _both import, neither provides_
2. **Nest hands out one `ToolRegistry`.** A static module is cached by its class, so a double import yields one instance. That is the invariant the whole seam rests on; everything else is a consequence.
3. **Each application plugin registers itself, from `onModuleInit`.** `this.toolRegistry?.register(this)`, with `toolRegistry` injected as `@Optional()`. Registration is a **call rather than a DI binding**, because Nest has no multi-provider token: without one you would either invent a provider registry inside Nest or make `tools/server` know the names of every application plugin.
   _@Optional() — because a deployment may run neither MCP nor the copilot, and must still boot_
4. **Re-registering the same instance is a no-op.** `register()` checks `providers.includes(provider)`. The reason is specific: an `onModuleInit` that ran twice (a recreated test module, a provider bound in two modules) would put the same object in twice, and then **every** one of its tools would collide with itself by name and bring down the **whole** catalogue on both surfaces — over a mistake that changes nothing.
5. **`onApplicationBootstrap` walks the assembled catalogue once.** Not in `register()`: a provider's `tools()` may depend on state (the content-type registry) that is only complete after every module has initialised.
   _a throw here aborts app.init(), and the process never starts serving_
6. **Every problem is reported at once.** `catalogueProblems()` collects a list and joins it into one message — a deployment that broke two things should learn about both rather than fixing them one at a time.
7. **After that the catalogue is only read.** `all()` calls each provider's `tools()` afresh on every list request — which is how tools that depend on content types reflect the current type registry. A duplicate name after startup still throws from `all()`: a backstop against a provider that started colliding at runtime.

> **What exactly the startup check catches**
>
> The most valuable of the five checks is **a `requires` naming a nonexistent permission**. `can()` is an exact set membership, so a string literal `'content:delete'` gone stale after a rename, or a key with a stray space, makes a tool **uncallable by anyone at all** — and silently: it simply never appears in any list. The error message asks outright for the `PERMISSIONS.*` constant to be used.

### 7.2 An external agent asks what the server can do (`tools/list`)

1. **The client sends `POST /api/v1/mcp`** with an `Authorization: Bearer …`. The controller is marked `@Public()` — the global session `AuthGuard` has nothing to do with it — and `@ApiExcludeController()`, because JSON-RPC over one route does not describe as REST operations.
2. **Authentication happens before the protocol.** `McpAuthService.authenticate` is called _before_ the transport is created: an unauthenticated caller must not be able to move the JSON-RPC state machine at all, not even before `initialize`. And a 401 is the semantically right answer: a JSON-RPC error would read as “the connection is fine, the operation failed”.
   _a session cookie is not accepted — exactly as on /api/v1_
3. **The token is verified by the same `ApiTokenService.verify`** as the rest of the public API. Unknown, revoked and expired all give one flat 401: the endpoint must not serve as a probe for live tokens.
4. **The workspace is resolved.** An `X-Workspace-Id` header or a `?workspaceId=` in the URL (the second form exists because MCP clients are configured by a _link_, and arbitrary headers are hard for many of them). The header wins; both forms pass the same check against the token's basket. A single-workspace token needs neither; a multi-workspace one with neither gets a 400 rather than a silent choice.
5. **The `ToolContext` is built.** `createToolContext({ kind: 'token', id: token.id, displayName: token.name, grantedPermissions: new Set(scopePermissions(token.scope)), userId: token.createdBy ?? null }, workspaceId)`. Note the `id`: it is the **token's id, not the issuing user's** — a token acts for itself, so revoking a token revokes the access whoever issued it. `userId` here is only for attribution.
6. **Any method other than POST answers 405** — but only _after_ authentication, so an unauthenticated probe learns only 401. The 405 comes from the controller rather than the transport: in stateless mode the transport would open a separate SSE stream on a GET and hold it **forever**, because nothing here is ever pushed by the server.
7. **The protocol server is assembled — one per request.** Not one long-lived: the tool list is a function of the caller, and baking the context into the handlers' closures at construction is what makes the mistake impossible. The low-level `Server` is used rather than the `McpServer` helper: the latter takes Zod schemas, while every schema here is a **generated JSON Schema**, and running it through Zod and back loses information for nothing.
8. **`registry.visibleTo(context, 'mcp')`** — narrowing by surface, then a permission filter. A `read`-scope token **never learns** that `content_create` exists. That is better than learning about it through a refusal, and it saves the model turns.
9. **Each tool is translated into MCP's shape.** The `inputSchema` is handed over as is; `readOnly` becomes `annotations.readOnlyHint` and `destructive ?? false` becomes `destructiveHint`. These are **hints to the client** about what is safe to auto-approve, and they have nothing to do with `effect`.

### 7.3 An external agent calls a tool (`tools/call`)

1. **The client sends `{ name, arguments }`.** Everything from 7.2 (steps 1–7) happens **again**: the endpoint is stateless and there is no session, so every request authenticates from scratch. The price is one token check; the gain is no session store and no sticky routing.
2. **A call deadline is set.** `callWithinDeadline` creates an `AbortController`, hangs the transport's `extra.signal` on it (the client cancelled the request, or the exchange closed) plus a timer for `callTimeoutMs` (30,000 ms by default). The `expired` flag is set _before_ `abort()`, so the listener can tell a deadline from a disconnect.
3. **The registry receives the call:** `registry.call(name, args, { ...context, signal }, 'mcp')`.
4. **Narrowing by surface.** The tool is looked up in `forSurface('mcp')`. Not found — a `NotFoundException`. All seventeen copilot tools are cut off right here: a client that named `content_propose_update` gets “unknown tool”.
5. **The permission check.** `tool.requires.every(k => context.can(k))`. A refusal is a `403` with text of the form `"content_delete" requires content:delete, which this token does not hold.` The message goes verbatim to a third-party model provider, and that is a deliberate decision: an undiagnosable permission problem costs more than the name of a key.
6. **Default arguments.** `const args = input ?? {}` — **in the registry rather than at each edge**. Both consumers used to compensate for a missing arguments object themselves (`args ?? {}` in the MCP adapter, `call.input ?? {}` in the run engine); for a parameter the signature types as an object, that is a protection the registry owes them.
7. **Validation against the `inputSchema`.** A failure is a `422` with the body `{ message, issues: [{ field, message }] }`. Splitting a `path: message` string into a pair of fields is done by the `toIssue` function, so the model reads the registry's refusal exactly as it reads the content plugin's 422.
8. **The stamp and the dispatch.** `tool.handler(args, { ...context, surface: 'mcp' })`.
9. **The handler delegates rather than rewriting the rules.** `content_list`, for instance, calls `assertDraftVisibility` (the one access decision a handler makes itself — because it is a rule about an _argument_ rather than about the operation), then `resolveGrantedType`, then `PublicEntriesQuery.list`. The public API's rules — published only, soft-deleted invisibility, an ungranted type indistinguishable from an unknown one, relations that do not cross locales, validation at publish time, revision numbering under an advisory lock, the outbox — are **not repeated here and therefore cannot diverge** from the HTTP surface.
10. **The race with the deadline.** `Promise.race([pending, rejectWhenAborted(...)])`. The loser still has a `pending.catch(() => undefined)` attached: without it a handler failing _after_ the deadline would become an unhandled rejection and take the process down — the exact failure the timeout exists to contain.
11. **The deadline throws but does not cancel.** The handler was given the signal; a tool that ignored it will run to completion, and nobody will read its answer. What is bounded is **the caller's wait** — the guarantee a request/response exchange owes; ending the work itself is beyond this layer.
12. **The result's size is measured before it is returned.** `JSON.stringify(result, null, 2)`, then `Buffer.byteLength`. Exceeding `maxResultBytes` (4 MiB) is an `isError` with the code `result_too_large`, naming **both numbers**. It has to be measured beforehand, because a response costs roughly three times over: the text block, the `structuredContent` and the transport's serialisation. And what did not fit the ceiling will not fit the model's context either — so the refusal asks outright for a smaller request.
13. **Success is returned in two spellings at once.** `content: [{ type: 'text', text }]` for models that see only `content`, and `structuredContent` for clients that parse it. Returning one of the two makes the tool useless to half the ecosystem. A non-object is boxed under a `value` key, because by the specification `structuredContent` must be an object.
14. **Any failure goes out as an `isError` result rather than a JSON-RPC error.** That is the whole point: a protocol error aborts the client's call, while an `isError` goes to the **model**, which will read “title must be at most 200 characters” and fix its next call. Permission refusals land here too — a model that learns it has no `content:publish` stops trying blind.

### 7.4 The copilot assembles a run's tool set

1. **A run begins.** `CapabilityProfileService.resolve(user, workspaceId, signal)` — **per run, uncached**. Permissions can be revoked mid-conversation, and a long conversation must not carry stale authority. The price is one indexed read per run.
2. **The permissions come from the role:** `new Set(await permissions.forRole(user.roleId))`.
3. **A `kind: 'user'` actor is built.** `id` and `userId` are **the same id**: the copilot has no identity of its own, and a run acts on behalf of the person who opened it. It is `kind` that tells a run from an MCP call in every handler that cares.
4. **The context receives the live SSE stream's `signal`** — so a tool doing real I/O can drop the work when the browser disconnects.
5. **The catalogue is narrowed to the surface:** `this.tools.forSurface('copilot')` — **not `visibleTo`**, and that matters. The profile needs the surface's _whole_ list in order to return `withheld` with reasons; a pre-filtered list could not say “you are missing `content:update`”, which is exactly what the settings page shows.
6. **`resolveCapabilityProfile` decides what to offer.** The function is pure and total — no I/O and no clock — so “an observer is offered no write tool” is a unit test rather than a promise. It lives in `copilot/domain`, which imports **nothing**, and is therefore generic over a three-field structural type (`name`, `requires`, `effect`) instead of importing `ToolDefinition`.
7. **The first declaration of a name wins.** A repeat goes into `withheld` with the reason `duplicate-name` rather than shadowing the previous one: tool names are namespaced precisely so one cannot pass itself off as another, and “the last registered wins” would undo that.
8. **There is no second gate on `effect`.** A write tool is offered on the strength of the same declared permissions as a read one. There used to be a per-workspace opt-in to auto-apply; ADR-0009 removed it along with the `copilot_workspace_policies` table and the `apply-not-enabled` reason. Otherwise “the copilot can do what your role can” would mean nothing.
9. **The profile goes to the model.** Exactly these definitions become the tool declarations in the request to the model provider.

### 7.5 The copilot calls a tool inside a run

The longest path in the system: eight checks before the handler, each added for a specific reason.

1. **The model returned a `tool_use` block.** The engine looks the name up in `authority.profile.tools`. Not found — `Unknown tool "…"`, in the same words the registry uses. An invented name and a withheld one answer identically: the list is derived from the caller's own role, and naming it saves a turn rather than giving away a secret.
2. **The confirmation pause applies to writes only.** `mayRun()` intervenes when the `effect` is `propose` or `apply`. Reads never ask: if everything asked, everybody would learn to click through without reading, and that is **worse** than not asking, because it devalues the request that matters.
   _an “allow for this chat” permission is read per call rather than per run: the list grows while the run is paused_
3. **The run parks.** A `tool-permission-request` frame with a deadline goes to the client; `ToolPermissionBroker` holds the promise **in this process's memory**. The budget is 5 minutes **for the whole run** rather than per call: a turn that requested thirty writes would otherwise hold the connection, the generator and the model's context for two and a half hours. An extension gives a full fresh budget — that is exactly what somebody pressing “I need more time” is saying.
4. **A refusal by a person is an ordinary tool error.** The model reads it and carries on, and the run does not die. And it lands in the audit: “the user said no” is exactly what a reviewer wants to see in `copilot_tool_calls`. Silence differs from a refusal by the message's text.
5. **Permissions are re-checked afresh.** `this.profiles.resolve(...)` is called again, inside the call's handling: the offer was computed at the start of the run, and a role can change while a long turn is in flight. A vanished name gives `You are not permitted to use "…"` plus a `warn`-level log entry.
6. **Arguments are validated _before_ the registry.** The engine calls `validateToolInput(call.input, tool.inputSchema)` itself — not duplication but a decision point: a failure must become a _message to the model_ after which the run continues, rather than an exception to be caught. The registry will check again anyway — for the third consumer who forgets.
7. **The loop guard.** The signature `"<name> <stable JSON of the arguments>"` is put into a set of calls already made. A repeat is answered with text that says outright: the result is above, use it or answer. Without it a model — especially a small local one — burns `maxSteps` on eight identical queries. It is checked **after** authorization, so a repeat never reveals more than the first call would.
8. **Dispatch through the registry rather than directly.** `this.tools.call(name, input ?? {}, fresh.context, 'copilot')`. The offer above is a convenience filter; the boundary is here. The registry will re-check `requires`, re-validate the arguments and stamp `surface: 'copilot'`.
9. **Branching on `effect`.** This is the one place in the system where `effect` means anything at all:
    - `propose` → the returned value **is the change**. It is checked by `isProposalDraft` (otherwise a binder that lied about its `effect` would write a malformed row into an append-only table; instead it becomes an ordinary tool error), written as a `copilot_proposals` row and then **applied**. The “row first, write second” ordering is all that carries “reversible but never invisible”.
    - `apply` → the tool wrote itself, and the engine must write the receipt, or you get “a change with no trace”.
    - `read` (or the field absent) → an ordinary result.
10. **The result is wrapped as “untrusted”.** `fenceUntrusted(call.name, output)`: entry bodies are written by people and must enter the model as **material rather than instructions**. Two properties carry that: the payload is JSON (no field can smuggle in a string that reads as a new turn), and `<` is escaped (the closing delimiter cannot be forged from inside).
11. **The audit.** A row in `copilot_tool_calls`: the name, success, duration, an output summary. Plus a `tool-result` SSE event for the client.
12. **A throw from the handler is caught and turned into a message.** The engine takes `error.message` directly (`userFacingMessage`) rather than going through `toToolError`. Hence a practical consequence for the author of a shared tool, carried into the checklist: throwing `new Error('No such asset')` will be readable in the panel and **useless over MCP**, where `toToolError` treats it as a bug and hides it behind an opaque 500.

### 7.6 Reading a resource over MCP

1. **`resources/list`** → `registry.resources(context)`. The registry polls every provider (a `Promise.all` over the optional `resources?.(context)`), joins the lists and filters by each resource's `requires`.
2. **`resources/read`** → `registry.readResource(uri, context)`. First a **full enumeration of the declared resources**, to find this URI's declaration and check its `requires` — _before_ a single provider is asked for bytes.
3. **Why an enumeration rather than “ask and hope”.** The rule is the same as for `call`: hiding a resource from the list is a courtesy, and a client is free to read a URI it was never shown. The extra walk is the gate's price; `resources/read` is not a hot path, and a provider with no resources costs nothing.
4. **Providers are polled in registration order**, and the first to recognise the URI wins. If nobody does — a 404.
5. **A failure goes out as a **JSON-RPC error** rather than an `isError`.** Reading a resource has no model in the loop: a client asked for the bytes at a URI and either got them or did not. The flattened `ToolError` rides in the `data` field, so the client reads the same `status`/`code`/`issues`.
6. **403 and 404 share the code `-32002`.** For _data_ the answer is deliberately uniform; `data.code` still says `forbidden` to a client that needs the distinction.

### 7.7 One and the same refusal on two surfaces

It helps to see how one event looks on both sides — that is exactly the symmetry the package provides.

| Event                                 | The `mcp` surface                                              | The `copilot` surface                                                          |
| ------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| The name does not exist               | `isError`, `{ status: 404, code: 'not_found' }`                | a `tool_result` with `isError`, the text `Unknown tool "…"`                    |
| The name belongs to the other surface | the same as “does not exist”                                   | the same as “does not exist”                                                   |
| A permission is missing               | `isError`, `403`, with the missing keys named                  | the tool is not offered at all; on a race — `You are not permitted to use "…"` |
| Malformed arguments                   | `isError`, `422` + per-field `issues`                          | `Invalid arguments: …` (caught by the engine before the registry)              |
| The tool threw an `HttpException`     | `toToolError`: the status, code, message and `issues` verbatim | `error.message` as is                                                          |
| The tool threw a plain `Error`        | an **opaque 500**, the message hidden, the stack in the log    | the message shown as is                                                        |
| An ungranted content type             | 404, indistinguishable from nonexistent                        | 404, indistinguishable from nonexistent                                        |
| Cancellation by the caller            | `499 client_closed_request` (nobody to read it)                | the run stops on its `signal`                                                  |
| The time ceiling exceeded             | `504 timeout` naming the number of ms                          | `RunLimits` are checked between steps                                          |

## 08. The API: the contracts and their signatures

The package exposes not one HTTP route. Its “API” is eight exports from `src/index.ts`: four contract types, the registry class, the module, the context constructor, the error flattener and the validator.

### 8.1 `ToolDefinition` — one callable unit

```
interface ToolDefinition {
    name: string;                          // snake_case, unique across every provider
    title: string;                         // a short title for an MCP client's picker
    description: string;                   // documentation FOR THE MODEL
    inputSchema: JsonSchema;               // the arguments object's JSON Schema
    requires: readonly PermissionKey[];    // ALL keys are required; the registry checks
    readOnly: boolean;                     // the MCP readOnlyHint
    effect?: ToolEffect;                   // 'read' | 'propose' | 'apply'; 'read' by default
    surfaces?: readonly ToolSurface[];     // 'mcp' | 'copilot'; ABSENT = BOTH
    destructive?: boolean;                 // the MCP destructiveHint
    handler(
        input: Record<string, unknown>,
        context: ToolContext
    ): Promise<ToolOutput>;                // throws on failure; see toToolError
}
```

| Field       | Required | The note worth remembering                                                                                                                                                                                                                                                          |
| ----------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| name        | yes      | The namespace is by subject (`content_list`, `media_asset_read`). Admin twins carry an `admin_` prefix so the two sets read apart at the call site and in every audit row                                                                                                           |
| description | yes      | The only documentation a caller gets. This is where the process rules the HTTP API states in prose are carried: “a create yields a draft”, “publishing is a separate call”, “an update merges”                                                                                      |
| requires    | yes      | **A security-critical field no type checker verifies.** The direct analogue of `@RequirePermissions(...)`. An empty array is a legitimate value, but it must be declared explicitly                                                                                                 |
| readOnly    | yes      | The _client's_ vocabulary: what is safe to auto-approve                                                                                                                                                                                                                             |
| effect      | no       | The _server's_ vocabulary: whether the handler's return value is a result or a change. It is neither derived from `readOnly` nor derives it: a `propose` is not read-only in MCP's sense (it is half a write), and a direct write is not a `propose`, however destructive it may be |
| surfaces    | no       | Security-critical too. Omitting it on a `propose` tool would make it callable by an MCP client that has no way to accept the resulting proposal                                                                                                                                     |

### 8.2 `ToolContext` and `ToolActor` — “who is asking”

```
type ToolActorKind = 'token' | 'user';

interface ToolActor {
    kind: ToolActorKind;
    id: string;                                  // the token's id OR the user's id
    displayName: string;
    grantedPermissions: ReadonlySet<string>;     // THE ONLY input to an access decision
    userId: string | null;                       // the accountable person — ATTRIBUTION ONLY
}

interface ToolContext {
    actor: ToolActor;
    workspaceId: string;                         // always resolved before dispatch
    signal?: AbortSignal;                        // only the copilot has one
    surface?: ToolSurface;                       // stamped by call(); presentation only
    can(permission: PermissionKey): boolean;
}
```

- **`grantedPermissions` is the decision's only input.** A tool never re-derives permissions from an `id` or a `userId`. Whoever authenticated the caller decided what they may do — once, at the edge.
- **A token's `id` is the token, not the person who issued it.** The issuer's role is never consulted, so revoking the token is always sufficient.
- **`can()` is for decisions _finer_ than a tool's own `requires`.** There is exactly one example, and it is instructive: `assertDraftVisibility` widens visibility inside one tool for a holder of `content:update`, instead of breeding a second tool.
- **`signal` is optional because only one consumer has one.** A copilot run is a live SSE stream that ends with the tab; an MCP call is a request/response that will finish one way or another. A tool that ignores the signal is **correct**: it is a courtesy rather than a correctness boundary.
- **`surface` is optional so a handler can be unit-tested with a hand-built context.** When it is absent, treat it as the copilot's admin rendering.

> **The one rule about surface**
>
> A tool that finds itself wanting an `if (surface === 'copilot')` around a check, a filter or a hidden field **is two tools**. Split it, and let `requires` and `can()` mean the same thing to everyone. Only **presentation** may vary by surface: a download link, say, that the caller can actually fetch with their own credentials.

### 8.3 `ToolProvider` — how a plugin brings tools

```
interface ToolProvider {
    tools(): readonly ToolDefinition[];
    resources?(context: ToolContext): Promise<readonly ResourceDefinition[]>;
    readResource?(uri: string, context: ToolContext):
        Promise<ResourceContents | undefined>;   // undefined = “not my URI”
}
```

`tools()` is called **on every list request**, so it may depend on runtime state (the content-type registry) — but it must not be expensive and must do no I/O: permission filtering happens after it returns. `resources()`, by contrast, is asynchronous and takes a context, because a resource's visibility is per workspace.

The canonical registration form, identical in all fourteen providers:

```
@Injectable()
export class MediaCopilotToolProvider implements ToolProvider, OnModuleInit {
    constructor(
        private readonly assets: ListAssetsQuery,
        @Optional() private readonly toolRegistry?: ToolRegistry
    ) {}

    onModuleInit(): void {
        this.toolRegistry?.register(this);
    }

    tools(): readonly ToolDefinition[] { /* … */ }
}
```

### 8.4 `ToolRegistry` — seven methods

| Method                 | Signature                                               | What it does                                                                            |
| ---------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| register               | (provider: ToolProvider) => void                        | Adds a provider. **Idempotent per instance**: re-registering the same object is a no-op |
| onApplicationBootstrap | () => void                                              | One pass over the assembled catalogue. A throw aborts `app.init()`                      |
| all                    | () => readonly ToolDefinition\[\]                       | Every tool in registration order; throws on a duplicate name                            |
| forSurface             | (surface: ToolSurface) => readonly ToolDefinition\[\]   | The filter `!tool.surfaces \|\| tool.surfaces.includes(surface)`                        |
| visibleTo              | (context, surface) => readonly ToolDefinition\[\]       | `forSurface` plus a permission filter. **A convenience, not a boundary**                |
| call                   | (name, input, context, surface) => Promise\<ToolOutput> | Surface → permissions → arguments → stamp → handler. **The boundary**                   |
| resources              | (context) => Promise\<readonly ResourceDefinition\[\]>  | Every provider's resources, filtered by `requires`                                      |
| readResource           | (uri, context) => Promise\<ResourceContents>            | The declaration's `requires` check, then polling the providers in order                 |

### 8.5 The functions

```
function createToolContext(actor: ToolActor, workspaceId: string): ToolContext;

function toToolError(error: unknown): ToolError;
interface ToolError {
    status: number;                  // an HTTP-like status
    code: string;                    // not_found | forbidden | validation_failed | …
    message: string;
    issues?: unknown;                // per-field problems, when the failure was a validation
}

function validateToolInput(input: unknown, schema: JsonSchema): ToolInputValidation;
interface ToolInputValidation {
    valid: boolean;
    errors: string[];                // strings of the form "path: message"
}
```

`createToolContext` **never derives permissions** — it receives a ready-made set. That is one line of code and one very important architectural statement: the inputs to an access decision are determined once, at the edge, by the code that authenticated the caller.

### 8.6 Resources

```
interface ResourceDefinition {
    uri: string;                             // e.g. apograph://content-type/article
    name: string;
    description: string;
    mimeType: string;                        // e.g. application/json
    requires?: readonly PermissionKey[];     // absent = “no gate beyond access to the endpoint”
}

interface ResourceContents { uri: string; mimeType: string; text: string; }
```

Today no shipped resource declares a `requires` — content-type schemas are already narrowed to the workspace's grants by the provider that builds them. But the gate is implemented and tested in both directions: a declared `requires` both hides the resource from `resources()` and rejects a `readResource()` against an explicitly named URI.

## 09. Validation: at startup and at call time

The registry owns two checks so that no consumer has to remember them. They differ in weight, and confusing them is expensive.

### 9.1 At startup — `onApplicationBootstrap`

| Check                                                                      | What would happen without it                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A duplicate name across providers                                          | Both surfaces would fail at runtime on the first `tools/list`, while the startup reported success                                                                                                       |
| A name failing `/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/`                         | Every deviation is silent: a name with padding whitespace registers and is callable only if you send the padding back, and a `Content_List` next to a `content_list` is two live tools one letter apart |
| `surfaces: []` — an empty array                                            | The tool is offered to nobody and callable from neither side. Dead on arrival, with nobody to say so                                                                                                    |
| `requires` is not an array                                                 | A silently absent gate                                                                                                                                                                                  |
| `requires` names a permission absent from `PERMISSION_KEYS`                | **The most valuable of the five.** `can()` is an exact set membership, so a stale literal makes the tool uncallable by anyone at all, and silently                                                      |
| `inputSchema` is not an object, or declares a `type` other than `'object'` | A tool's arguments are always an object. A tool with no arguments is expected to declare `{ type: 'object', properties: {} }`                                                                           |

Every problem found is collected and reported in one throw, because a deployment that broke two things should learn about both.

### 9.2 At call time — `validateToolInput`

A deliberate subset of JSON Schema, covering exactly what the generated tool schemas use:

#### What is checked

- `type`: object, array, string, integer, number, boolean, null — with `integer` and `number` kept apart
- `required` — by key name
- `properties` — recursively, building a path (`filter.rules[0].field`)
- `additionalProperties: false` — an extra key becomes an error _only_ if the schema really is closed
- `enum` — membership
- `items`, `minItems`, `maxItems`
- `minLength`, `maxLength`
- `minimum`, `maximum` — **both inclusive**

#### What is silently ignored

- `anyOf`, `oneOf`, `allOf`
- `$ref` — recursion through a reference is impossible
- `format`, `pattern`
- any unfamiliar type name — accepted and skipped: a schema you did not understand is no reason to blame the value

**The rule a tool author must not misread:** a constraint nested inside an `anyOf` is not checked at all.

> **This is not a security boundary**
>
> The boundary is `requires`. Argument validation is **defence in depth**: it stops a malformed call from reaching the handler and coming back as an opaque 500 instead of a `validation_failed` naming the field. **The handler still owns every rule about its own values.** The content plugin, for instance, additionally runs the arguments through the real `class-validator` DTO of its HTTP route, so a ceiling like `pageSize` is written once.

> **A naming trap**
>
> The repository has **two different functions called `validateToolInput`**: the JSON Schema subset in `@apograph/tools-server`, and the DTO validation in `packages/content/server/src/lib/mcp/tool-input.ts`, which runs class-validator with the host `ValidationPipe`'s options. The content MCP provider imports the second. The shared name is confusing when reading a diff.

## 10. Errors and their way out

`toToolError` — 37 lines in which one product decision is fixed: **what the model may be told about a failure**.

| What was thrown              | What came out                                                                          | Rationale                                                                                                                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HttpException(400)           | `bad_request`                                                                          | Handlers delegate to the same services as the HTTP controllers, so they throw Nest exceptions. This is **the most useful thing that can be reported to the model**: “title must be at most 200 characters” — a failure it will fix on the next turn |
| HttpException(401)           | `unauthorized`                                                                         |                                                                                                                                                                                                                                                     |
| HttpException(403)           | `forbidden`                                                                            |                                                                                                                                                                                                                                                     |
| HttpException(404)           | `not_found`                                                                            |                                                                                                                                                                                                                                                     |
| HttpException(409)           | `conflict`                                                                             |                                                                                                                                                                                                                                                     |
| HttpException(422)           | `validation_failed` + `issues` **verbatim**                                            |                                                                                                                                                                                                                                                     |
| HttpException(anything else) | `error` with the original status                                                       | An unknown code is not swapped for an invented one                                                                                                                                                                                                  |
| Error / anything else at all | **`500 internal_error`**, message `The tool failed unexpectedly. See the server logs.` | This is a **bug, not a caller's error**. The message could name a table, a column or a connection string, and a tool's result is read by a third-party model. The stack goes to the `McpTools` log for the operator                                 |

The `message` body is extracted carefully: a string is taken as is, **an array of strings is joined with `;`** (which is exactly how Nest returns multiple `ValidationPipe` errors), otherwise `error.message` is taken. The `issues` key is preserved under the same name — that is what makes a validation failure self-correcting.

### Where this structure ends up

- **`tools/call` over MCP** → the body of the `isError` result, as prettily formatted JSON.
- **`resources/list` and `resources/read` over MCP** → the `data` field of the JSON-RPC error, with the code chosen by status: 403 and 404 → `-32002`, 400 and 422 → `InvalidParams`, everything else → `InternalError`.
- **A copilot run** → `toToolError` is **not used**; the engine takes `error.message` directly.

> **A consequence for the author of a shared tool**
>
> A tool offered to both surfaces must throw **subclasses of `HttpException`**, not bare `Error`s. `new Error('No such asset')` will read beautifully in the copilot panel and become an opaque 500 over MCP. The asymmetry is not in the contract but in how the two sides flatten a throw — and it is the author who has to account for it.

### Two exceptions that never reach `toToolError`

The `CallAbandoned` class in `build-mcp-server.ts` exists separately for exactly this reason: the deadline is this file's own decision, and a client disconnecting is routine. Neither is a bug in a tool, and logging them with a stack as an “unhandled error” would be noise. They turn into `504 timeout` and `499 client_closed_request` directly.

## 11. The checklist for the author of a new tool

Formally this is the “Adding a tool: decide `surfaces` deliberately” section of `packages/tools/server/AGENTS.md`. In substance it is the one procedure in the monorepo that the author of a tool in _any_ package is **obliged** to go through, because a field that was forgotten and a field that was deliberately omitted produce identical code and opposite intentions.

### 11.1 Decide who the tool is for

The questions are worked through **in order; the first “yes” decides**. And they are about the tool itself, not about who asked for it: a tool written for the copilot that answers “no” to all five belongs to both surfaces.

1. **Does the handler write — or return a change for someone else to apply?** → `['copilot']`.
   _why: MCP has no run engine. A propose handler writes nothing and hands a draft outward — over MCP the call would look like a success and change nothing at all. Direct apply is worse: its receipt is a copilot_proposals row written by the engine, so over MCP it would write with no trace whatsoever_
2. **Does it show unpublished content under a plain `content:read`?** Drafts, revision snapshots, sibling translations — anything derived from admin services rather than from `public-api/`. → `['copilot']`.
   _why: a token's content:read is the published-only surface of the public API; a user's content:read is a viewer legitimately seeing drafts. One key, two meanings_
3. **Does it need a permission that no token scope grants?** `scopePermissions` gives only `content:*`, `media:read`, `media:create`, `segments:read` and `segments:manage`. Anything requiring `activity:read`, `users:read`, `alarms:read`, `media:update` will never appear for a token. → `['copilot']`.
   _why declare it rather than rely on the permission check: a future token scope that accidentally included such a key would silently open a surface nobody decided to open_
4. **Does it read or write something that only makes sense for a logged-in human?** Attribution to whoever accepted, the current conversation, a pending proposal. → `['copilot']`.
5. **Is it built on `public-api/` and therefore published-only?** → `['mcp']`.
   _why: offering it to the copilot means demoting a viewer to the visibility of an external token_

**Otherwise — do not declare the field, and share it.** That is the path of least resistance _by design_, not a loophole.

> **Worked-through “no”s — so the question is not reopened**
>
> **`admin_content_revisions` / `admin_content_diff`**: they look like a free win (MCP has no equivalent, and they re-check grants themselves), but they fail at (2) — a revision timeline _is_ draft history, under `content:read`. Tightening `requires` to `content:update` would fix MCP and **break the copilot**: a viewer would lose the version history it sees in the admin UI today.
>
> **`i18n_translations_get`**: it sits in the same file as the shared `i18n_locales_list`. It fails at (2) less visibly: `LocaleGroupService.liveWhere` narrows by workspace and soft-delete, but not by publication state. That a neighbour is shared is not an argument.

### 11.2 Write the definition

- **A `snake_case` name, unique across every provider** → namespaced by subject; an admin twin of a public tool gets the `admin_` prefix.
- **`requires` — only `PERMISSIONS.*` constants** → a raw string literal goes stale silently and leaves the tool uncallable for everyone; startup will catch it, but why.
- **`requires` declared even when it is empty** → `[]` is a legal value, a missing field is not.
- **`surfaces` either declared with a comment saying “where the tension is”, or omitted with a comment saying “there is no tension”** → the answer gets recorded, not just the code.
- **`effect` set explicitly for anything that writes or prepares a change** → the `read` default means “a result”, and for a `propose` tool that is a silent breakage of the proposal write.
- **`readOnly` and `destructive` are honest** → these are hints to the MCP client about what may be auto-approved; they are not derived from `effect`.
- **`inputSchema` is an object schema with `additionalProperties: false`** → otherwise an extra key will not be an error; a tool with no arguments should have `{ type: 'object', properties: {} }`.
- **The schema does not hide a constraint inside `anyOf` / `$ref`** → such a constraint is not checked at all.
- **`description` is written for the model** → process rules go inside it: that creation yields a draft, that publishing is separate, that an update merges, that a batch is “successful” even with failed items.
- **The handler delegates to its own plugin's services** → that is exactly how a second, diverging copy of the visibility rules fails to appear.
- **The handler does not check its own gate** → that is `ToolRegistry.call`'s job; `ctx.can()` is only for decisions finer than `requires`.
- **The handler throws subclasses of `HttpException`** → a bare `Error` becomes an opaque 500 over MCP.
- **The response size is under control** → every field is context the model pays for: a sparse field set, small pages, a narrow projection.
- **`ctx.surface` is presentation only** → if you find yourself wanting to branch a check, a filter or a hidden field on it, that is two tools.

### 11.3 Wire it up

- **The provider implements `ToolProvider` and `OnModuleInit`** → registration is a `register(this)` call, not a DI binding.
- **`ToolRegistry` is injected as `@Optional()`** → a deployment may run no consumer at all and must still boot.
- **The provider is added to the plugin module's `providers`** → an application plugin does not import `ToolsModule`.
- **The application boots** → that is the catalogue validation run.

### 11.4 Cover it with tests

- **An authorization test on `requires`** → the field is security-critical and is checked by no type-checker; `surfaces` is not a substitute for it.
- \***\*Both** cross-surface e2e suites updated\*\* → `mcp.spec.ts` asserts what a token is shown and what it is not; `copilot-read-catalogue.spec.ts` does the same for a run. A tool missing from both lists is a tool nobody checks.
- **For a shared tool — check both surfaces** → including that the presentation difference stayed a presentation difference.

## 12. Configuration

**The package itself has no configuration.** No environment variables, no settings object, no plugin factory: `ToolsModule` is a static module with no `forRoot`. The catalogue is entirely determined by which application plugins are up.

What is configured is around it — at the consumers, and it is exactly the set of knobs that affects what is visible in the registry:

| Variable / field               | Owner            | Default   | What it affects in the context of tools                                                                                                                 |
| ------------------------------ | ---------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP_ENABLED                    | `mcp/server`     | false     | Removes the **controller**, but not the wiring: `ToolsModule` is still imported, the registry is still bound, the copilot still sees the full catalogue |
| MCP_CALL_TIMEOUT_MS            | `mcp/server`     | 30 000    | The ceiling on a single `tools/call`. Exceeding it gives an `isError` with code `timeout`. **It abandons the wait, it does not cancel the work**        |
| MCP_MAX_RESULT_BYTES           | `mcp/server`     | 4 194 304 | The ceiling on one tool's serialized result. Exceeding it gives `result_too_large` with both numbers                                                    |
| MAX_REQUEST_BODY               | host             | 1 MB      | The request body; exceeding it gives an ordinary Nest 413, above the JSON-RPC layer                                                                     |
| config.name / config.version   | `mcp/server`     | apograph-cms | The identity the server reports to clients at `initialize`                                                                                              |
| COPILOT_ENABLED                | `copilot/server` | false     | Mirror image: removes the copilot routes without shrinking the shared catalogue                                                                         |
| DEFAULT_RUN_DECISION_BUDGET_MS | `copilot/server` | 5 min     | How long a parked run waits for a human's answer — **for the whole run**, not per call                                                                  |

> **What is not configurable, on principle**
>
> Neither `surfaces` nor `requires` is configurable: the tool's code declares them. There is no per-workspace tool allowlist, no switch for an individual tool, no policy table. The last one existed — `copilot_workspace_policies`, the auto-apply gate for `apply` tools — and ADR-0009 deleted it along with the settings page and the `apply-not-enabled` refusal reason. Since then an `apply` tool is offered exactly when a `read` tool with the same `requires` would be.

### Commands

```
npx nx typecheck @apograph/tools-server
npx nx lint      @apograph/tools-server
npx nx test      @apograph/tools-server

# cross-surface e2e (needs Docker)
npx nx e2e server-e2e --testPathPatterns=tools
npx nx e2e server-e2e --testPathPatterns=mcp
```

## 13. Security and authorization

### 13.1 One point, and why that one

Nest guards **routes**. Both the MCP endpoint and the copilot's run loop are **a single route carrying many operations**, so a decorator on the route is useless here by construction. What replaces it is a declared `requires` plus the centralized check in `ToolRegistry.call`.

| The gate on `/api/v1/*`  | Its counterpart here                                             |
| ------------------------ | ---------------------------------------------------------------- |
| ApiTokenGuard            | `McpAuthService.authenticate`, the bearer half                   |
| ApiTokenWorkspaceGuard   | `McpAuthService.authenticate`, the workspace half, rule for rule |
| @RequirePermissions(...) | `ToolDefinition.requires` + `ToolRegistry.call`                  |

### 13.2 What it protects, and from what

- **Calling a name that was never shown.** An MCP client is free to do it, and a model is capable of inventing a name. Which is why filtering the list is not the protection, and `call()` is.
- **Calling another surface's tool.** `call` applies the same narrowing as `forSurface`. Without it an MCP client could reach a `propose` tool that has nothing to accept the result with, and the copilot could reach the public `content_create`, which attributes the write to `null`.
- **Stale authority in a long conversation.** The copilot's profile is recomputed for every run, and inside a run the permissions are re-checked once more before every call.
- **A tool that forgot its gate.** It physically cannot forget it: the handler takes no part in the decision.
- **Instruction injection through content.** The copilot wraps a result in `fenceUntrusted`: JSON and an escaped `<`. An entry body written by a human enters the model as material, not as a move.
- **Enumerating workspaces and tokens.** An unknown/revoked/expired token is one flat 401; a workspace outside the “basket” and a non-existent workspace are one 403.
- **CSRF.** A session cookie is not accepted on MCP at all. A cookie rides along with a request by itself, and this endpoint writes content.

### 13.3 What is deliberately disclosed

> **A refusal names the missing permission**
>
> `"content_delete" requires content:delete, which this token does not hold.` goes to a third-party model verbatim. The rationale: the tool set is derived from the caller's own scope and says nothing about anyone else, and an undiagnosable permissions problem costs more than the name of a key. **The price** — the _shape_ of the permission model leaks. Hence the requirement: keep the message within the bounds of `requires`, and never let a handler append its own reason to it.

> **The rule that is NOT waived for data**
>
> For a _tool list_, “this exists but you may not” is not information. For _data_ it is, and there the answer must be uniform: **a content type that was not granted answers 404 indistinguishably from one that does not exist**, on both surfaces. These two rules are easy to mix up with each other, and confusing them in either direction is a defect.

### 13.4 Two fields the type-checker does not check

#### `requires`

Its type is right — `PermissionKey[]` — but the _correctness of the value_ is unverifiable: a tool that declared `content:read` instead of `content:delete` compiles. Hence the rule “a new tool requires an authorization test”, and the startup check that catches at least a non-existent key.

#### `surfaces`

An omitted field is legal and means “both”. A forgotten field on a `propose` tool yields a tool callable over MCP that has nothing to accept the proposal with. The type-checker is silent; the cross-surface e2e cases catch it, and a new tool needs its own.

### 13.5 Known limitations

- **The catalogue check runs at startup only.** A provider registered after `app.init()` passes none of the five checks. Nothing in the product does this (all fourteen register from `onModuleInit`), but the e2e fixtures do — and their dotted names demonstrate it.
- **`validateToolInput` is not a boundary.** A rule inside `anyOf` is not checked at all.
- **The MCP deadline does not cancel work.** A tool that ignores `signal` will run to completion.
- **The copilot's permission broker lives in the process's memory.** This is a real deployment limitation: a horizontally scaled installation needs sticky routing by `runId`.

## 14. Invariants

Statements that must always hold. Both a review list and a starting set of assertions for tests.

- **I-01** — A tool call is authorized in **exactly one place** — `ToolRegistry.call`, before dispatch. No handler checks its own `requires`.
- **I-02** — `visibleTo()` and `forSurface()` are convenience filters; either can be removed without losing security, the check in `call()` cannot.
- **I-03** — **All** keys in `requires` are required; the check is an exact match against the `grantedPermissions` set.
- **I-04** — Permissions are **never re-derived** inside the package: `createToolContext` receives a ready-made set from whoever authenticated the caller.
- **I-05** — `ToolActor.userId` is used only for attribution and never for authorization; for a token, the issuing user's role is not consulted at all.
- **I-06** — A tool with no `surfaces` field is offered to **both** surfaces; `surfaces: []` is impossible — the application will not start.
- **I-07** — `call()` applies the same surface narrowing as `forSurface()`: calling another surface's tool answers “unknown tool”.
- **I-08** — `ToolContext.surface` is set by `call()`, not by the caller; it is always the surface the call was authorized against.
- **I-09** — `surface` may change **only the presentation** of a response, and never the set of checks, a filter, or which fields are disclosed.
- **I-10** — An unknown name (`404`) and a forbidden name (`403`) are **different** answers; the refusal names the missing keys.
- **I-11** — For **data** the answer is uniform: a content type that was not granted answers the same as one that does not exist, on both surfaces.
- **I-12** — Authorization happens **before** argument validation: an unauthorized caller gets the same answer whatever it sends.
- **I-13** — A missing arguments object is treated as `{}` by the registry, not by each consumer separately.
- **I-14** — A resource passes through the same gate: a declared `requires` both hides the resource from the list and rejects a read of a directly named URI.
- **I-15** — The application **does not start** on a duplicate name, a name that is not `snake_case`, an empty `surfaces`, an unknown permission in `requires`, or a non-object `inputSchema`. Every problem is reported at once.
- **I-16** — `register()` is idempotent per provider instance; two **different** providers claiming the same name remain a wiring error.
- **I-17** — `ToolsModule` is global, imported by both consumers and provided by neither; exactly one `ToolRegistry` exists in an application.
- **I-18** — An application plugin injects `ToolRegistry` as `@Optional()`; a deployment with neither consumer boots, just without a catalogue.
- **I-19** — Turning off MCP or the copilot removes **only** the corresponding routes and does not shrink the shared catalogue.
- **I-20** — A non-`HttpException` goes out as an **opaque** 500 with the message hidden; the stack reaches the server log only.
- **I-21** — Per-field `issues` from a 422 are carried into `ToolError` **verbatim**, under the same key.
- **I-22** — The copilot's capability profile is **not cached** between runs, and permissions are re-checked once more before every call inside a run.
- **I-23** — The first declaration of a name wins; a repeat lands in `withheld` rather than shadowing the earlier one.
- **I-24** — The package owns no table, ships no migrations, and imports neither Drizzle, nor any vendor SDK, nor `@modelcontextprotocol/sdk`.
- **I-25** — No JSON-RPC vocabulary appears anywhere in the package, and no transport object crosses the tool contract — a handler is handed a `ToolContext` and a plain argument bag, never a request, a response, or a protocol envelope. HTTP and MCP do appear, and only in these two shapes: refusals are Nest `HttpException`s flattened to a numeric `ToolError.status`, and `mcp` is one of the two `ToolSurface` labels alongside the `readOnly`/`destructive` client hints. See I-24 for the dependency rule.

## 15. Testing checklist

Phrased as “action → expected result”. Existing suites: unit tests in `packages/tools/server/src/lib/*.spec.ts` (registry — 27 cases, errors — 5, validator — 20), the cross-surface e2e `apps/server-e2e/src/server/tools/tool-registry.spec.ts`, and the wire-level suites `…/server/mcp/mcp.spec.ts` and `…/server/copilot/copilot-read-catalogue.spec.ts`.

### Authorization

- **An actor without a declared permission calls a tool** → 403; the handler was **not** called.
- **An actor the tool is hidden from names it explicitly** → 403, not execution: filtering the list guarantees nothing.
- **A tool with two permissions, the actor holds one** → 403; all are required.
- **A tool with `requires: []`** → runs for anyone who reached the endpoint.
- **A `read` token asks for `tools/list`** → the response contains no writing tool at all.
- **A `read` token calls `content_create`** → `isError`, 403, naming `content:create`.
- **The role's permissions are revoked between the start of a run and a call** → the call is rejected with `You are not permitted to use "…"`, the run continues.

### Surfaces

- **A tool with no `surfaces` field** → present in `forSurface('mcp')` and in `forSurface('copilot')`.
- **A tool with `surfaces: ['copilot']`, requested from the `mcp` surface** → absent from the list AND uncallable (404, not 403).
- **`tools/list` over MCP** → not a single name with the `admin_` prefix and not a single `*_propose_*`.
- **A copilot run's catalogue** → not a single public `content_*` (apart from the shared `content_access_get`).
- **A handler reads `ctx.surface`** → it sees exactly the surface the call came through; the caller cannot forge it.
- **The shared `media_asset_read` over MCP and in the copilot** → the same set of assets, different `downloadPath` (`/api/v1/…` vs `/api/…`).

### A single registry instance

- **An application with both consumers, a shared tool asked for from each** → visible to both — that is the proof the instance is single.
- **`MCP_ENABLED=false`** → the copilot keeps the full catalogue; there is no `/api/v1/mcp` route.
- **`COPILOT_ENABLED=false`** → MCP keeps the full catalogue; there is no copilot route.
- **Both off** → the application boots; the tools are simply not registered.

### Catalogue validation at startup

- **Two providers declared the same name** → `app.init()` throws, naming the name.
- **`requires` contains a permission absent from `PERMISSION_KEYS`** → a throw demanding a `PERMISSIONS.*` constant be used.
- **The name `Content_List` / `content__list` / `_content`** → a throw naming the pattern.
- **`surfaces: []`** → a throw: “offered to no consumer”.
- **`inputSchema: { type: 'string' }` or a non-object** → a throw.
- **The catalogue is broken in two places** → the message lists **both** problems.
- **A correct catalogue** → startup succeeds.
- **The same provider instance registered twice** → startup succeeds, the tools are not duplicated.

### Argument validation

- **A required field is missing** → 422, `issues: [{ field: '<name>', message: 'required' }]`.
- **A wrong type** → 422 with `expected <type>`; nested branches are not checked further.
- **`1.5` against `type: 'integer'`** → 422; against `type: 'number'` — accepted.
- **A value outside `enum`** → 422 listing the allowed ones.
- **An extra key with `additionalProperties: false`** → 422; with an open schema — accepted.
- **`minimum`/`maximum`/`minLength`/`maxLength` exactly on the boundary value** → accepted: every bound is inclusive.
- **Three rules broken at once** → all three are reported, not just the first.
- **A constraint hidden inside `anyOf` or behind `$ref`** → not checked — documented behaviour, not a bug.
- **No arguments sent at all** → treated as `{}`; a schema with no required fields passes.
- **An actor without permissions sends knowingly malformed arguments** → 403, not 422: authorization comes first.

### Errors

- **The handler threw `NotFoundException`** → `{ status: 404, code: 'not_found' }`.
- **The handler threw a 422 with `issues`** → the `issues` reached the caller verbatim.
- **Nest returned `message` as an array** → joined with `;` into one string.
- **The handler threw a bare `Error('table users does not exist')`** → 500 `internal_error`, the text hidden, the stack in the log.
- **A tool over MCP did not finish within `callTimeoutMs`** → `isError` `504 timeout`; the process survives even if the handler fails after the deadline.
- **The result is larger than `maxResultBytes`** → `413 result_too_large` with both numbers.
- **The client disconnected mid-call** → no “unhandled error” log, no stack.

### Resources

- **A URI no provider recognized** → 404.
- **Two providers recognize the same URI** → the one registered first wins.
- **A resource with `requires`, the actor lacks the permission** → hidden from the list AND rejected when read by direct URI.
- **A resource with no `requires`** → readable by anyone who reached the endpoint.
- **The schema of a type the workspace was not granted, via `apograph://content-type/…`** → 404, indistinguishable from a non-existent type.
- **A `resources/read` failure** → a JSON-RPC error (not `isError`), with the flattened `ToolError` in the `data` field.

## 16. Boundaries of responsibility

A seven-file package is easy to confuse with its neighbours, because all of them talk about tools. The line is drawn along three axes: the **contract**, the **protocol** and the **capability**.

| Question                                                                                                      | Who answers                                             | Why not the neighbour                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What does a tool look like?                                                                                   | tools/server                                            | The contract must be transport-neutral, otherwise one implementation could not serve both consumers                                                                                 |
| May this actor call this tool?                                                                                | tools/server                                            | The single point. Two implementations are exactly the problem the package was extracted for                                                                                         |
| What permissions exist at all, and who holds them?                                                            | identity/server                                         | `tools/server` imports `PermissionKey` and `PERMISSION_KEYS` and keeps no dictionary of its own                                                                                     |
| Who arrived, and what were they granted?                                                                      | mcp/server                                              | Authentication is a property of the edge. `createToolContext` takes a ready-made permission set and never derives it itself                                                         |
| Who is logged in, and what is their role?                                                                     | copilot/server                                          |                                                                                                                                                                                     |
| JSON-RPC, Streamable HTTP, `isError`, `structuredContent`, annotations, the call deadline, the result ceiling | mcp/server                                              | A deployment with the copilot but no MCP should not drag in the SDK of a protocol it does not speak                                                                                 |
| The run loop, SSE, proposals, call auditing, pausing for confirmation, the loop guard                         | copilot/server                                          | The registry cannot write. The `copilot_tool_calls` and `copilot_proposals` rows are written by the engine                                                                          |
| What to offer the model and why something was held back (`withheld`)                                          | copilot/domain                                          | `resolveCapabilityProfile` is a pure function with no imports; it is generic over a structural type of three fields so as not to pull in `ToolDefinition`                           |
| The tools themselves and everything they do                                                                   | content, media, i18n, activity, alarms, segments, users | A tool inside its own plugin reaches that plugin's internal services directly. Otherwise they would have to be re-exported — and a second copy of the visibility rules would appear |
| The public API's rules (published-only, grants, locales, revisions, the outbox)                               | content/server, public-api/                             | A handler does not repeat them and therefore cannot diverge from them                                                                                                               |

### Who uses what from the package's public API

| Export            | mcp/server        | copilot/server                             | an application plugin |
| ----------------- | ----------------- | ------------------------------------------ | --------------------- |
| ToolsModule       | imports           | imports                                    | no                    |
| ToolRegistry      | injects           | injects                                    | injects `@Optional()` |
| ToolProvider      | no                | no                                         | implements            |
| ToolDefinition    | reads             | reads                                      | declares              |
| createToolContext | yes               | yes                                        | no                    |
| visibleTo         | yes               | no — takes `forSurface` to keep `withheld` | no                    |
| toToolError       | yes               | no — takes `error.message`                 | no                    |
| validateToolInput | no — via `call()` | yes, and before `call()` too               | no                    |

The asymmetry in the last three rows is the only substantive difference in how the two consumers use the package, and it is precisely where the “throw `HttpException`” rule for a shared tool comes from.

## 17. Divergences between code and documentation

Every statement below was checked against the implementation on the current branch. The order runs from “could mislead you while adding a tool” to “cosmetic”.

| Where                                                   | What it says                                                                                                                                                    | How it actually is                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tools/server/AGENTS.md, the checklist, item (3)         | “`scopePermissions` yields only `content:*` plus `media:read`/`media:create`”                                                                                   | Out of date: a token scope also yields `segments:read` (both scopes) and `segments:manage` (`full`). The item about which permission a “token will never get” is the most consequential in the checklist, and it is what the author of a new tool decides `surfaces` by                                                                                                                       |
| tools/server/AGENTS.md, the “Surfaces” section          | The table of shared tools lists **four**: `i18n_locales_list` and three `media_*`                                                                               | There are **six** shared ones: `segments_list` and `content_access_get` were added (both with no `surfaces` field, both on `segments:read`). The table was not updated                                                                                                                                                                                                                        |
| alarms/server/.../alarms-tool.provider.ts, JSDoc        | “`scopePermissions` yields `content:*` plus `media:read`/`media:create` and nothing else”                                                                       | The same stale statement, copied into the code. The conclusion (“a token cannot hold `alarms:read`”) remains true, the reasoning no longer is                                                                                                                                                                                                                                                 |
| docs/adr/0007, §2                                       | “MCP's **twelve** content tools are `['mcp']`, the copilot's **fourteen** are `['copilot']`”                                                                    | MCP has **sixteen** content tools (the provider itself writes “the sixteen content tools” in its JSDoc), and there are **seventeen** copilot ones across the repository. The numbers were fixed at the time of writing and never recounted                                                                                                                                                    |
| docs/adr/0007, the 2026-08-11 update                    | “**four tools** — `i18n_locales_list` and the three `media_*` reads — now omit `surfaces`”                                                                      | There are six; the two segments ones were added later and never made it into the update                                                                                                                                                                                                                                                                                                       |
| mcp/server/AGENTS.md, the header                        | “`i18n_locales_list` and the **three** `media_*` reads name no surface”                                                                                         | The same undercount in a third place. The wording is especially unfortunate because the whole paragraph is devoted to the warning “changing someone else's tool changes what this endpoint exposes”                                                                                                                                                                                           |
| mcp/server/AGENTS.md, the overview                      | “Owns no tables, no migrations, and no tools. It owns the protocol, the authentication, and **the registry**”                                                   | The registry has been **moved out** of the package — which the header of the same file says twenty lines above. The document contradicts itself                                                                                                                                                                                                                                               |
| mcp/server/AGENTS.md, “Two consumers, one registry”     | “The copilot's tool loop **(once its run engine lands)** injects the same `ToolRegistry`… Nothing in this package needs to change **when the copilot arrives**” | The run engine is implemented and injects the registry today. The future tense is left over from when it was written                                                                                                                                                                                                                                                                          |
| tools/server/src/lib/tool-registry.ts, the class JSDoc  | “the copilot's in-process tool loop **will** inject the very same instance”                                                                                     | The same future tense inside the package itself; further down the same file the loop is already described as existing                                                                                                                                                                                                                                                                         |
| tools/server/src/lib/tool.ts, the `ToolOutput` JSDoc    | “the copilot's loop **will** feed it back to the model as a tool result”                                                                                        | The same again                                                                                                                                                                                                                                                                                                                                                                                |
| tools/server/src/lib/tool.ts, the `effect` JSDoc        | “say it explicitly on anything that writes”                                                                                                                     | The convention is honoured by **no writing MCP tool at all**: all nine writing `content_*` tools and `content_access_set` declare no `effect` field and rely on the `read` default. Harmless today — `effect` is read only by the copilot's engine, and these tools are narrowed to `mcp` — but the convention was written precisely so that the value would not be inferred from the surface |
| tools/server/src/lib/tool-error.ts                      | `new Logger('McpTools')`                                                                                                                                        | The file has not belonged to the MCP package for a long time. The log context name is left over from the move and points at a package that merely uses this function                                                                                                                                                                                                                          |
| apps/server-e2e/.../copilot-fixture-tools.ts, JSDoc     | “phase 1 ships **no write tools at all** — every real tool is `content:read`” and “let the **`apply`-not-opted-in branch** be exercised end to end”             | There are eighteen tools with `readOnly: false` today — ten direct writes and eight proposals. The “apply not permitted” branch was deleted along with the workspace policy (ADR-0009): there is no second gate on `effect` any more                                                                                                                                                          |
| apps/server-e2e/.../copilot-fixture-tools.ts, the names | `fixture.readThing`, `fixture.proposeThing`, `fixture.applyThing`, `fixture.explodes`                                                                           | **They do not pass `TOOL_NAME_PATTERN`** (`snake_case` only). They fail to blow up solely because they are registered after `app.init()`, once `onApplicationBootstrap` has already run. This is both a divergence and a demonstration of the startup check's boundary                                                                                                                        |
| docs/adr/0006 and 0007                                  | Both have status `Proposed`                                                                                                                                     | Both are fully implemented; ADR-0007 has also been amended twice (2026-08-11 and 2026-08-17). “Proposed” misleads a reader looking for the decision in force                                                                                                                                                                                                                                  |
| Identically named functions                             | —                                                                                                                                                               | The repository has **two** `validateToolInput` functions: the JSON Schema subset in `@apograph/tools-server` and the DTO validation via class-validator in `content/server/src/lib/mcp/tool-input.ts`. The content MCP provider imports the second. The name collision is confusing when reading a diff; no document points it out                                                            |

> **The common denominator**
>
> Eleven of the sixteen items are **stale numbers and a stale verb tense**: they arose because the catalogue grows across seven packages while the documents describing it live in two others. The only divergence with the potential for a real defect is item (3) of the checklist: it is what the author of a new tool decides `surfaces` by, and its list of permissions “a token will never get” is incomplete.

---

**The dossier of the `packages/tools/server` package.** Built on the skeleton of the pilot `identity` artifact: business description → composition → surfaces → registry → permissions → lifecycle → scenarios → API → validation → errors → author's checklist → configuration → security → invariants → testing checklist → boundaries → divergences. The sections the package does not have (a data model, migrations, admin screens) dropped out — and that is itself a characterization: `tools/server` owns neither a table, nor a route, nor a screen.

The source is the source code: the whole of `packages/tools/server/src/**`, both consumers (`packages/mcp/server`, `packages/copilot/server/src/lib/chat`), fourteen provider classes in seven application packages, `docs/adr/0006` and `docs/adr/0007`, the package's unit tests and the cross-surface suite `apps/server-e2e/src/server/tools/tool-registry.spec.ts`. The `AGENTS.md` files were used as a skeleton, but every statement was checked against the implementation — the divergences are collected in section 17.
