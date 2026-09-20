# MCP

_Package · packages/mcp/server_

**The front door for an external AI agent: one route, one protocol, zero tools of its own**

MCP is a **protocol adapter**. It knows nothing about content, media or locales: it accepts JSON-RPC on the single route `POST /api/v1/mcp`, verifies the bearer token, picks the workspace, and passes the call to _someone else's_ tool registry. An external agent — Claude Desktop, Cursor, a hand-written SDK client — gets exactly the same content CRUD as the public HTTP API, with the same authentication and the same permission decision. The plugin owns no table and no tool.

- **1** HTTP route
- **23** tools over MCP
- **6** JSON-RPC methods
- **5** JSON-RPC error codes
- **0** DB tables
- **0** migrations
- **3** exchange limiters
- **2** token scopes

## Contents

- [01. Business description](#01-business-description)
- [02. Composition of the package and its surroundings](#02-composition-of-the-package-and-its-surroundings)
- [03. Token scopes and permissions](#03-token-scopes-and-permissions)
- [04. The catalogue of tools available over MCP](#04-the-catalogue-of-tools-available-over-mcp)
- [05. Data model](#05-data-model)
- [06. A call's lifecycle](#06-a-calls-lifecycle)
- [07. Scenarios — how it works, step by step](#07-scenarios-how-it-works-step-by-step)
- [08. The HTTP API and the JSON-RPC methods](#08-the-http-api-and-the-json-rpc-methods)
- [09. Admin UI](#09-admin-ui)
- [10. Configuration](#10-configuration)
- [11. Security: what was done and why exactly this way](#11-security-what-was-done-and-why-exactly-this-way)
- [12. Invariants](#12-invariants)
- [13. Testing checklist](#13-testing-checklist)
- [14. Boundaries of responsibility](#14-boundaries-of-responsibility)
- [15. Divergences between code and documentation](#15-divergences-between-code-and-documentation)

## 01. Business description

The CMS already has a full external API — `/api/v1/*` with bearer tokens issued on the “API tokens” page. Everything a script can do to this CMS from outside, it can do there. The problem is not capability, it is the **manner of introduction**.

### The problem it solves

- **An agent does not read OpenAPI.** An MCP client learns what a server can do by _asking it_ — it calls `tools/list` and gets a list of tools with descriptions and JSON schemas for their arguments. It does not download a specification and synthesize a REST client from it. So the real question is not “should an agent be able to edit content” (it already can — with a token and an HTTP library), but “will it get a described, permission-filtered surface, or will every operator have to write their own bridge”.
- **The security rules are not in the controllers.** Published-only by default, soft-deleted rows invisible, a content type that was not granted indistinguishable from one that does not exist, relations not crossing locales, validation deferred until publication, revision numbering under an advisory lock, a transactional outbox. All of it lives in `PublicEntriesQuery`, `PublicEntryWritesService` and `EntryWriterService` beneath them. A second entry point that rewrote even one of these would not be a second entry point, it would be **a second, quietly diverging security model**. Which is why every tool handler reaches for the same objects the HTTP controller does.
- **One catalogue, two consumers.** The copilot reads the same in-process tool registry. A tool added for one is automatically available to the other — unless it said otherwise itself, with the `surfaces` field.
- **Revocation in one click.** No second credential store: the same `ApiTokenService.verify`, the same tokens table. The operator revokes a token and MCP access dies the same second.

### Who sees it

#### The external agent

Connects to `POST /api/v1/mcp` with `Authorization: Bearer`. Sees only the tools its token's scope allows it to call, and gets errors in a form a model can read and correct.

#### The deployment operator

Decides whether to open the door at all (`MCP_ENABLED`) and issues narrow tokens: `read` for a reading agent, `full` for a writing one, with an explicit list of workspaces.

#### The plugin developer

Adds a tool in their own package without touching this one: a `ToolProvider` in their module plus an answer to “who is this for?”. MCP learns nothing about their plugin.

### What the MCP plugin is not

The boundaries matter more than the capabilities here — almost everything expected of it lives in neighbouring packages:

- **It is not the tool registry.** `ToolDefinition`, `ToolContext`, `ToolProvider`, `ToolRegistry`, `createToolContext` and `toToolError` live in `@orthacms/tools-server`. MCP _imports_ `ToolsModule` rather than providing it — otherwise a deployment that only wants the copilot would drag `@modelcontextprotocol/sdk` in through this barrel, that is, a dependency on a protocol it does not speak.
- **It is not the tools.** The content tools are contributed by `content/server`, the media ones by `media/server`, locales by `i18n/server`, audiences by `segments/server`. It is exactly this inversion that lets a handler call `PublicEntriesQuery` directly: that object is internal to content and is not exported outward.
- **It is not an MCP client.** The copilot separately plans to _go out_ to the operator's MCP servers (`docs/design/copilot.md` §4). That is the opposite direction and a different feature. Here the CMS _is_ the MCP server.
- **It is not a second API.** Not one new visibility rule, not one new token format, not one new table. Just another way to ask the same thing.

> **The key architectural idea**
>
> Nest guards **routes**, and MCP is **one route carrying dozens of operations**. So the public API's three guards are rewritten here as three non-Nest mechanisms: `ApiTokenGuard` → the bearer half of `McpAuthService.authenticate`, `ApiTokenWorkspaceGuard` → its workspace half, `@RequirePermissions(...)` → the tool's `requires` field, which `ToolRegistry.call` checks centrally **before dispatch**. Not one new rule — just a different point of application for the same ones.

## 02. Composition of the package and its surroundings

The `packages/mcp` group holds exactly one package — `server`. It has no `admin` and no `domain`, and none is planned: a protocol adapter has neither a screen nor a domain model.

| File                             | What it does                                                                                                                                                      | Why it exists separately                                                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lib/utils/mcp-plugin.ts          | The `McpPlugin({ config })` factory — what the host puts in its plugin list. Returns `{ name: 'mcp', module, mcpConfig }`                                         | Validates the settings **eagerly**, at construction time: an empty name or version, a zero/negative/`NaN` ceiling — an exception here, rather than a malformed `initialize` response a week later |
| lib/mcp.module.ts                | The global dynamic module. `imports: [ToolsModule]`, `controllers: config.enabled ? [McpController] : []`                                                         | The registry is **imported, not provided**: it is shared with the copilot, and both consumers must see the very same instance                                                                     |
| lib/mcp.tokens.ts                | `MCP_CONFIG` (a Symbol) and the `InjectMcpConfig()` decorator                                                                                                     | A module with no dependencies (it imports only `@nestjs/common`) so that providers can reference the token without forming a cycle with `mcp.module.ts`                                           |
| lib/types/mcp-config.ts          | `McpPluginConfig`: `enabled`, `name`, `version`, `callTimeoutMs`, `maxResultBytes`                                                                                | Five fields are the entire set of decisions the operator makes here                                                                                                                               |
| lib/http/mcp-auth.service.ts     | Bearer → a verified token → a `ToolContext` (+ the resolved workspace)                                                                                            | The only place this endpoint authenticates. A session cookie is **not accepted** here                                                                                                             |
| lib/http/mcp.controller.ts       | `@All()` on `v1/mcp`: 405 for `GET`/`DELETE`, bringing up the transport and the protocol server for a single request                                              | The SDK transport is deliberately _not asked_ about `GET` — it would open an eternal SSE stream                                                                                                   |
| lib/protocol/build-mcp-server.ts | The protocol server **for one request**: `tools/list`, `tools/call`, `resources/list`, `resources/read`, the call deadline, the result ceiling, the error mapping | The tool list is a function of the caller, so the server is built around an already-resolved context instead of re-asking “who is asking” in every handler                                        |

### The neighbours it cannot work without

| Dependency                  | What is taken                                                                                               | Role                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| @orthacms/tools-server      | `ToolRegistry`, `ToolsModule`, `ToolContext`, `createToolContext`, `toToolError`, `ToolOutput`, `ToolError` | The tool catalogue and the **single** point where a call is authorized             |
| @orthacms/identity-server   | `ApiTokenService.verify`, `scopePermissions`, the `@Public()` decorator                                     | The credentials and the translation of a token scope into a permission set         |
| @orthacms/workspaces-server | `WORKSPACE_HEADER`, `WORKSPACE_ID_PATTERN`                                                                  | The header name and the identifier format — the same constants the REST guard uses |
| @orthacms/bootstrap-server  | The `ServerPlugin` type                                                                                     | The plugin contract for the host                                                   |
| @modelcontextprotocol/sdk   | `Server` (the low-level one), `StreamableHTTPServerTransport`, the request schemas, `McpError`, `ErrorCode` | The **only** new runtime dependency, locked inside one package (version `^1.30.0`) |
| @nestjs/swagger             | `@ApiExcludeController()`                                                                                   | Excluding the route from the OpenAPI document                                      |

> **Why the low-level Server rather than McpServer**
>
> The SDK's `McpServer` helper takes Zod schemas, whereas here every schema is a **JSON Schema generated at runtime**: content types are defined in code and live in a registry, and their shape is computed at startup. Turning a generated JSON Schema into Zod so the SDK can turn it back is a loss of information in exchange for nothing.

## 03. Token scopes and permissions

MCP has **no permission model of its own**. The actor here is always a token (`kind: 'token'`), its permissions are the result of `scopePermissions(token.scope)` from `identity-server`, and the “may it” decision is made by `ToolRegistry.call`, comparing `ToolDefinition.requires` against that set. There are no RBAC roles here: the role of the human who minted the token is **never consulted**.

| Permission      | read | full | What it opens over MCP                                                                                |
| --------------- | ---- | ---- | ----------------------------------------------------------------------------------------------------- |
| content:read    | ✓    | ✓    | Seven reading content tools + the schema resources + `i18n_locales_list`                              |
| content:create  | —    | ✓    | `content_create`, half of `content_bulk_save`                                                         |
| content:update  | —    | ✓    | `content_update`, the other half of `content_bulk_save`, **and the widening of visibility to drafts** |
| content:publish | —    | ✓    | `content_publish`, `content_unpublish` and their bulk variants                                        |
| content:delete  | —    | ✓    | `content_delete`, `content_bulk_delete`                                                               |
| media:read      | ✓    | ✓    | The three `media_*` tools and `content_media`                                                         |
| media:create    | —    | ✓    | No tool here at all: uploading goes through the REST route `POST /api/v1/media/assets`                |
| segments:read   | ✓    | ✓    | `segments_list`, `content_access_get`                                                                 |
| segments:manage | —    | ✓    | `content_access_set` — and only at the entry level, not the audience directory                        |

The permissions `media:update`, `media:delete`, `activity:read`, `users:*`, `alarms:*`, `copilot:*`, `tokens:*`, `workspaces:*` and `views:share` are granted by **no** token scope. A tool that requires them physically cannot be visible to an agent — but the right way to express that is still `surfaces: ['copilot']`, so that the reason is declared rather than following from an accidental coincidence in the scope table.

### How a permission reaches a call

1. **Scope → permission set.** `scopePermissions(scope)` is a pure function with no Nest and no Drizzle, the single source of truth for “what this scope can do”.
   _packages/identity/server/src/lib/api-tokens/domain/api-token-scope.ts_
2. **Permission set → context.** `createToolContext(actor, workspaceId)` yields `context.can(permission)` — a plain membership check on a `Set`. The function **never derives permissions itself**: they are resolved by whoever authenticated the caller.
3. **Context → list filter.** `registry.visibleTo(context, 'mcp')` hides what the actor could not call anyway. This is a **convenience**, not a boundary.
4. **Context → boundary.** `registry.call(name, args, context, 'mcp')` re-checks `requires` before dispatch. A client is free to name a tool it was never shown — and will be refused.
   _this is the security boundary; ADR-0006 §5_
5. **Finer decisions inside the handler.** `context.can(...)` is used where the rule concerns an _argument_ rather than an operation: `assertDraftVisibility` requires `content:update` before allowing `status: 'draft'|'any'`.

> **Why draft visibility is probed with the content:update permission**
>
> `content:read` is held by **both** scopes, so it distinguishes nothing. `content:update` does. The logic: a token that can read drafts is a token that could have published them too. And the widening exists at all because otherwise a writing agent would create a draft and **never see it again**: reading returns only published content by default, and the writing API would become write-only.

### Catalogue validation at startup

The registry implements `OnApplicationBootstrap` and checks the assembled catalogue **once, at startup**, throwing every problem at once. A refusal here aborts `app.init()`, so the process never begins serving at all. What is checked:

- **Name uniqueness** — two plugins claiming the same name would make the choice of implementation depend on registration order.
- **Name format** — `^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$`. A name with a space registers and is callable only by sending the same space; `Content_List` next to `content_list` is two live tools one letter apart.
- **A non-empty `surfaces`** — an empty array means “offered to nobody”, i.e. a dead tool.
- **Permissions exist** — every value in `requires` must be in `PERMISSION_KEYS`. A string literal that drifted from the list would leave the tool uncallable for everyone, silently.
- **The shape of `inputSchema`** — it must be an object of type `object`.

## 04. The catalogue of tools available over MCP

Twenty-three tools, and this package wrote none of them. Sixteen come from `content/server`, three from `media/server`, one from `i18n/server`, three from `segments/server`. A `read`-scoped token sees **thirteen** of them, a `full` token all twenty-three.

The tools are **generic**, taking a `typeName` in their arguments, rather than generated per content type. The reason is cost: an MCP client loads every tool's schema into the model's context on connect, so `article_create`, `author_create`, `tag_create`… would scale the cost of every conversation by the number of collections — and could not be a fixed set anyway, because which types are visible depends on the grants issued to the workspace. The model learns a type's shape on demand via `content_type_get`.

### 4.1 Content — 16 tools, all `surfaces: ['mcp']`

The stamp is applied in one line to the whole set rather than tool by tool: uniformly this is **the public API's set** — reads through `PublicEntriesQuery` (published only), writes through `PublicEntryWritesService` (attributed to the token).

| Name                   | What it does                                                                                                                       | Input                                                                          | Requires                        | read | Difference from the copilot variant                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| content_types_list     | This workspace's content types: machine name, label, kind (collection/single), the publishable / localized / soft-delete flags     | —                                                                              | content:read                    | ✓    | The copilot's `admin_content_types` looks at the admin registry; here the list is **trimmed by the workspace's grants**                                      |
| content_type_get       | The full field schema of one type + a `valuesSchema` as JSON Schema for constructing `values`                                      | typeName                                                                       | content:read                    | ✓    | No counterpart; the same `fieldSchema` that produces the OpenAPI document, so two descriptions of a type cannot diverge                                      |
| content_list           | A page of entries of a type. Free-text search, a structural filter, sorting, pages, a sparse field set                             | typeName, status?, search?, filter?, sort?, page?, pageSize?, fields?, locale? | content:read                    | ✓    | `admin_content_search` sees drafts under a plain `content:read`; here `status` is unlocked only by the `content:update` permission                           |
| content_get            | One entry by `id` or by `localeGroupId`+`locale`, expanding relations, media and translations                                      | typeName, id \| localeGroupId, locale?, status?, fields?                       | content:read                    | ✓    | `admin_content_get` hands an editor the draft; here a draft, a deleted entry, another workspace and a non-existent id all read **identically — “not found”** |
| content_relations      | One ordered page of one field's relations — a way around the preview limit in `content_get`                                        | typeName, id \| localeGroupId, field, page?, pageSize?                         | content:read                    | ✓    | No counterpart. **Only published** targets are shown and counted                                                                                             |
| content_media          | All of an entry's media fields, laid out by field name into asset metadata and URLs                                                | typeName, id \| localeGroupId                                                  | content:read + media:read       | ✓    | No counterpart. The only content tool requiring two permissions                                                                                              |
| content_translations   | An entry's other locales, keyed by locale slug. The entry itself is not repeated                                                   | typeName, id \| localeGroupId                                                  | content:read                    | ✓    | The copilot's `i18n_translations_get` **reports a draft sibling's status** — which is why it is `['copilot']`, while this one works by the public rules      |
| content_create         | Create an entry. On a publishable type it lands as a **draft**: publishing is a separate call                                      | typeName, values, locale?                                                      | content:create                  | —    | `content_propose_create` writes nothing and returns the change to the run engine; here the write happens immediately                                         |
| content_update         | A **partial** update: the `values` sent are merged into the stored ones, an explicit `null` clears a field                         | typeName, id \| localeGroupId, values, locale?                                 | content:update                  | —    | `content_propose_update` is a proposal awaiting a human's signature; here it is a direct write, attributed to the token                                      |
| content_publish        | Re-validate a stored entry and put it on air. The moment `required` bites                                                          | typeName, id \| localeGroupId, locale?                                         | content:publish                 | —    | No counterpart: the copilot publishes by accepting a proposal, not through a separate tool                                                                   |
| content_unpublish      | Return an entry to drafts                                                                                                          | typeName, id \| localeGroupId, locale?                                         | content:publish                 | —    | No counterpart                                                                                                                                               |
| content_delete         | Delete an entry. Recoverable from the trash on a soft-delete type, otherwise permanent. `destructive: true`                        | typeName, id \| localeGroupId, locale?                                         | content:delete                  | —    | No counterpart. Deletes **exactly one row**: on a localized type the other translations survive                                                              |
| content_bulk_save      | Create and/or update many entries of one type. **Always successful as a call**: each item gets its own verdict at its own position | typeName, items\[\]                                                            | content:create + content:update | —    | No counterpart. The description tells the model outright to read `failed` and not to report the batch as saved without checking                              |
| content_bulk_publish   | Publish many drafts; the ones that do not make it go into `skipped` with a reason — `already-published`, `blocked`, `not-found`    | typeName, ids\[\]                                                              | content:publish                 | —    | No counterpart. A partially skipped batch is a **normal** outcome                                                                                            |
| content_bulk_unpublish | Return many to drafts. `count` is how many actually changed                                                                        | typeName, ids\[\]                                                              | content:publish                 | —    | No counterpart                                                                                                                                               |
| content_bulk_delete    | Delete many. `destructive: true`                                                                                                   | typeName, ids\[\]                                                              | content:delete                  | —    | No counterpart                                                                                                                                               |

### 4.2 Shared tools — no `surfaces` declared, therefore both consumers

These are the four with none of the tension that separates the rest: they do not show drafts under a plain `content:read`, they write nothing, they require no attribution to a human, and they ask for no permission a token scope does not grant.

| Name                | Who provides it | What it does                                                                       | Input                                      | Requires     | What changes on MCP                                                                                                                                                                |
| ------------------- | --------------- | ---------------------------------------------------------------------------------- | ------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| i18n_locales_list   | i18n/server     | The locales the deployment is configured for, with slugs and a default flag        | —                                          | content:read | Nothing. It returns the same deployment configuration to every caller, stores no workspace data and writes nothing                                                                 |
| media_assets_search | media/server    | A search by file name across the workspace's whole media library, over all folders | query?, kind?, folderId?, page?, pageSize? | media:read   | **Only `downloadPath`**: for MCP it is `/api/v1/media/assets/:id/raw` (fetched with the bearer), for the copilot the admin `/api/media/...`. That is _presentation_, not authority |
| media_folders_list  | media/server    | All of the workspace's media folders with their asset counts                       | —                                          | media:read   | Nothing                                                                                                                                                                            |
| media_asset_read    | media/server    | The contents of a text file from the media library — Markdown, CSV, JSON           | assetId                                    | media:read   | Nothing                                                                                                                                                                            |

> **This endpoint serves more than “its own” tools**
>
> The four tools above belong to two other plugins and declare no surface. Which means **a change to a tool you did not write changes what this endpoint serves**. That is exactly why adding any tool anywhere in the monorepo requires answering “who is this for?” — following the procedure in `packages/tools/server/AGENTS.md`.

### 4.3 Audiences (segments) — two shared reads and one MCP-only write

| Name               | What it does                                                                       | Input                                  | Requires        | Surfaces     | Difference from the copilot variant                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------- | -------------------------------------- | --------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| segments_list      | The reader audiences the workspace can restrict content by                         | —                                      | segments:read   | both         | Identical. An agent that cannot ask whether an entry is restricted will report a partial list as a complete one                                                                      |
| content_access_get | Who may see one published entry. An empty `allow` means **EVERYONE**, not “nobody” | entryId, typeName                      | segments:read   | both         | Identical. It answers from the plugin's own table, **not** through a public read of the entry — otherwise an agent that had just restricted an entry could not read back what it did |
| content_access_set | Replace both lists at once — who is admitted and who is refused                    | entryId, typeName, allow\[\], deny\[\] | segments:manage | **mcp only** | The copilot's `content_propose_access` _proposes_: its actor is a human who must see the change. A bearer token has nobody to ask — the registry already checked `segments:manage`   |

The audience directory is deliberately absent here: renaming one audience's tags changes who can see _every_ entry that names it, and deleting one rewrites both lists on all such entries. That is dictionary administration, and it stays on a screen behind a session. `segments:manage` on a `full` token reaches exactly as far as the entry level.

### 4.4 What is not here: the tools marked `surfaces: ['copilot']`

Not a list of prohibitions but a list of **declared decisions**. The e2e suite checks every name on this list for absence both from `tools/list` and when called by name.

| Name                                                                                                                                                              | The step of the procedure that fired                                                            | What would happen if it got in here                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| admin_content_types<br>admin_content_search<br>admin_content_get                                                                                                  | Shows unpublished content under a plain `content:read`                                          | A `read`-scoped token would see drafts: a token's `content:read` is the public “published only” surface, while a user's is a viewer legitimately seeing drafts in the admin UI. One key, two meanings         |
| admin_content_revisions<br>admin_content_diff                                                                                                                     | The same — revision snapshots                                                                   | The edit history of unpublished versions would leak outward                                                                                                                                                   |
| i18n_translations_get                                                                                                                                             | The same — it reports the draft status of a sibling locale                                      | A subtle case: its `liveWhere` is bounded by workspace and soft-delete, but not by publication                                                                                                                |
| activity_recent<br>workspace_members_list<br>admin_alarms_findings                                                                                                | Requires a permission that no token scope grants (`activity:read`, `users:read`, `alarms:read`) | They would not be listed anyway — but the reason is declared rather than left to a coincidence in the scope table that a future scope will silently undo                                                      |
| content_propose_create<br>content_propose_update<br>content_propose_access<br>i18n_propose_translation<br>i18n_propose_bulk_translation<br>media_propose_alt_text | The handler writes nothing and returns a change that someone else's engine applies              | The call would look like a success and **change nothing**: MCP has no run engine to write the `copilot_proposals` row and apply the change                                                                    |
| media_propose_file                                                                                                                                                | The same, but sharper: it _writes_                                                              | A `full` token holds `media:create`, so **the permissions would suffice**. Only `surfaces` stops it — and it must, because an MCP client has no way to answer the confirmation request that write sits behind |

### 4.5 MCP resources

Besides tools the endpoint serves **resources** — documents a client can pull into its context without spending a tool call. Today there is exactly one kind: a content type's schema at the URI `ortha://content-type/<name>`, `mimeType: application/json`.

- **The list is trimmed by the workspace's grants** — the same ones `content_types_list` uses.
- **A read goes through the same grant gate** (`resolveGrantedType`), so an ungranted type gives a 404 here exactly as it does on a tool call: reading a resource must not be a way around.
- **A resource's permissions** are declared with the `requires` field and checked **before the provider is asked for any bytes**. No resource shipped today declares one: they are already narrowed by the workspace's grants.
- **`valuesSchema` does not list `required` for publishable types** — on those, fields are required _for publication_, and declaring them required would tell the model it cannot save an incomplete draft, which is exactly what it can do.

## 05. Data model

The plugin has **zero** tables of its own and **zero** migrations, there is no `drizzle.config.ts`, and no migrations descriptor is declared. The unit test `mcp-plugin.spec.ts` pins this explicitly (“owns no migrations”), so that a table cannot appear “by accident”.

This is not asceticism but a consequence of the design: **the endpoint has no state**. There would be nothing to store — there are no sessions, no session identifiers, and the call journal is kept by the plugins whose tools were invoked.

| Data one might expect            | Where it actually is                                                       | Why not here                                                                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| The agent's credentials          | `identity-server`, the API tokens table                                    | A second credential store is a second audit trail and a second way to forget to revoke access                                                         |
| An MCP session                   | nowhere                                                                    | Every request authenticates from scratch; an `Mcp-Session-Id` header from a client that thinks it has a session is simply ignored                     |
| The tool-call journal            | `activity` — through the events of the plugins whose services did the work | MCP does not know what a tool actually did; the service that was called does                                                                          |
| Content revisions and the outbox | `content-server` + `@orthacms/database`                                    | A handler calls the same `EntryWriterService` the HTTP controller does — and gets the same numbering under an advisory lock and the same outbox write |
| Proposals (`copilot_proposals`)  | `copilot/server`                                                           | MCP has no run engine; which is why `propose` tools are not admitted here                                                                             |
| The tool catalogue               | in memory, in `ToolRegistry`                                               | It is assembled from providers on `onModuleInit` and checked on `onApplicationBootstrap`; it has no business in the database                          |

> **A known gap inherited from the public API**
>
> A write made by an agent is **attributed to the token, not to a human**. Revisions store a _user_ identifier, and a token is not a user, so agent-authored revisions carry `null`: “_null is an honest answer to the question ‘not a user’_”. This is precisely the same gap the public write API already has; ADR-0006 notes it as deserving its own column and a fix **before** agent authorship becomes commonplace. The context's `actor.userId` field carries the human who minted the token, but **for attribution only** — it never influences a permission decision.

## 06. A call's lifecycle

There is no “session” lifecycle here — there is the lifecycle of **one exchange**. The transport and the protocol server are created per request and die with it.

**HTTP request** → **authentication** → **workspace resolution** → **verb check** → **transport + Server** → **JSON-RPC dispatcher** → **response** → **close: teardown**

### Why this order

1. **First, “is it on”.** The controller is only registered when `enabled`, but there is another check inside that returns `503` — in case the wiring changes in future. A disabled plugin answers **404**, because the route is simply not mounted.
   _e2e: “unmounts the endpoint when disabled”_
2. **Authentication _before_ anything reaches the protocol layer.** An unauthenticated caller must not be able to move the JSON-RPC state machine at all — **not even as far as `initialize`**. And the answer here is an ordinary HTTP status: `401` is what tells an MCP client “your credentials are wrong”, whereas a JSON-RPC error would read as “the connection works and returned a failure”.
3. **Workspace resolution in the same operation.** One call to `McpAuthService.authenticate(headers, workspaceQuery)` does both halves and immediately assembles the `ToolContext`: further down the code there is no place where the context is still “half-built”.
4. **The verb check _after_ authentication.** Otherwise a `GET` without a token would report 405, i.e. would confirm the endpoint exists. An unauthenticated `GET` is a `401`, and nothing more.
   _e2e: “401s an unauthenticated GET, before the verb is considered”_
5. **The transport is created with no session-id generator** (`sessionIdGenerator: undefined`) and with `enableJsonResponse: true`. The latter means “answer with a single JSON body rather than opening an SSE stream”: nothing streams here — a tool call returns once — and plain JSON is what clients and proxies digest best.
6. **The protocol server is built _around an already-resolved context_.** This is exactly why it is per-request rather than one long-lived server: `tools/list` must show a `read` token a different set than a `full` token, and resources are trimmed by the workspace's grants. Baking the context into the handlers' closures at build time makes that impossible to break — there is no shared server whose handlers must _remember_ to re-ask who is asking.
7. **Teardown is hung on `response.on('close')`.** Without that line every request would leak a protocol server and its closures. Both are closed however the exchange ends.
8. **The body is not re-read.** The host's express middleware has already parsed the JSON, so it is passed as the third argument to `transport.handleRequest` — otherwise the transport would try to read an already-consumed stream.
9. **The emergency exit.** If something threw: headers not yet sent — a `500` is written with a `-32603` JSON-RPC envelope; already sent — the connection is simply **closed**. A truncated response is diagnosable, a hang is not.

### The three ceilings of one exchange

None of them can be supplied by the tool registry: it is transport-neutral, and a request-response exchange has obligations the copilot's in-process loop does not.

| Limit                | Value                          | Where it lives                                             | What happens above it                                                                                             |
| -------------------- | ------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **The request body** | 1 MB (`MAX_REQUEST_BODY`)      | the host's `bodyLimit` in `createServer`                   | A `413` with an ordinary Nest body. This is **above** the JSON-RPC layer, which is why it is not a JSON-RPC frame |
| **One `tools/call`** | 30 s (`MCP_CALL_TIMEOUT_MS`)   | `build-mcp-server.ts`, `callWithinDeadline`                | a result with `isError: true`, `status: 504`, `code: timeout`                                                     |
| **One tool result**  | 4 MiB (`MCP_MAX_RESULT_BYTES`) | `build-mcp-server.ts`, before handing off to the transport | a result with `isError: true`, `status: 413`, `code: result_too_large`, **with both sizes in the text**           |

> **The deadline abandons the work, it does not cancel it**
>
> The handler is given a signal that fires both when the deadline expires and when the caller has gone away (the SDK's `extra.signal`). But a tool that ignores the signal will **run to completion** — its answer simply goes unread. The guarantee here is **a bound on the caller's wait**, not the ending of work: this layer cannot end work.
>
> A separate subtlety: the promise that lost the race is **still driven to a settled state** (`pending.catch(() => undefined)`). Without that, a handler failing _after_ the deadline would become an unhandled rejection and crash the process — exactly the failure the timeout was introduced to contain.

### Why the result ceiling is not paranoia

A result is serialized **three times**: as the prettily printed text block the model reads; as `structuredContent` for clients that parse it; and once more by the transport as it assembles the whole response. Peak memory is therefore a multiple of the payload, and per concurrent request at that, while nothing in the tool catalogue bounds how much a handler may return. A refusal is more useful than the data itself: a result that does not fit here will not fit in the model's context window either, and the message tells it outright to narrow its request.

## 07. Scenarios — how it works, step by step

### 7.1 A client connecting and getting acquainted

An MCP client does not read documentation — it asks the server. The first three exchanges are the whole “introduction”.

1. **The operator mints a token.** The “API tokens” page in the admin UI: `read` for a reading agent, `full` for a writing one, plus an explicit list of workspaces. The secret is shown once. **The token's scope is what decides which tools the agent will see at all.**
   _there is no separate “MCP registration”_
2. **The client is pointed at a URL.** An MCP client's config is URL-shaped, so the workspace can be named right in the address: `https://cms.example.com/api/v1/mcp?workspaceId=<uuid>`. For a client that only speaks stdio, `mcp-remote` provides a bridge — one line in its config and nothing we would have to maintain.
3. **`initialize`.** The client sends its protocol version, its capabilities and its name. The server answers with `serverInfo` (`name` and `version` from the plugin's configuration — this is what the client shows in its connector list) and `capabilities`, declaring two sections: `tools` and `resources`.
   _strictly after authentication: even initialize is unavailable to an unauthenticated caller_
4. **`notifications/initialized`.** A notification; it has no `id` and there is nothing to answer — the endpoint returns **`202` with an empty body**.
5. **`tools/list`.** This is where the main thing happens: `registry.visibleTo(context, 'mcp')` — first the surface narrowing, then the actor's permissions. Each tool is returned with `name`, `title`, `description`, `inputSchema` and `annotations` (`title`, `readOnlyHint`, `destructiveHint`). A `read` token **never learns** that `content_create` exists — which is better than learning it through a refusal, and saves the model turns.
6. **`resources/list` (optional).** Content type schemas trimmed by the workspace's grants, so the model can pull a type's shape into its context without spending a call.

> **Why annotations rather than “just descriptions”**
>
> `readOnlyHint` and `destructiveHint` are **hints to the client**, which it uses to decide what may be auto-approved and what needs a human. They are not authority: authority is `requires`. Which is why the tool contract carries _two_ vocabularies: `readOnly`/`destructive` answer the client's “what is safe”, while `effect` (`read | propose | apply`) answers the _server's_ “is the returned value a change or a result”. A `propose` tool is not “read-only” in the MCP sense, and a directly writing tool is not `propose`, however destructive it may be.

### 7.2 Authentication: how a bearer is parsed

1. **The header is split on whitespace.** `header.trim().split(/\s+/)`. The scheme is compared case-insensitively with `bearer`.
2. **Exactly one value must remain after the scheme.** Surrounding and repeated whitespace _around_ the scheme is tolerated — RFC 9110 allows it and clients send it. Whitespace _inside_ the value is not: credentials do not contain spaces, and gluing the pieces back together would **invent a token the caller never sent**, and then report that invention as “Invalid API token”, which reads as “wrong secret” rather than “malformed header”.
   _a notable divergence from the REST guard — see section 15_
3. **`ApiTokenService.verify(secret)`.** An unknown, a revoked and an expired token all give **one flat 401**: the endpoint must not be a tool for enumerating which tokens exist.
4. **The actor is assembled.** `kind: 'token'`, `id` — the identifier of the token itself (not the user: a token acts on its own behalf, which is why revoking it is always sufficient), `displayName` — the token's name, `grantedPermissions` — `new Set(scopePermissions(token.scope))`, `userId` — the human who minted it, **for attribution only**.
5. **A cookie is not considered at all.** A cookie rides along with a request _by itself_ — which is exactly what makes cookie-authenticated writes vulnerable to CSRF. A bearer never rides that way. Accepting both here would put CSRF back on an endpoint whose whole point is to let an agent write content.

### 7.3 Workspace resolution

The rule matches `ApiTokenWorkspaceGuard` word for word, rewritten for a non-Nest call site.

1. **The source is `X-Workspace-Id`, otherwise `?workspaceId=`.** The header wins if both are present. The second spelling exists because MCP client configs are URL-shaped and several clients make custom headers awkward or impossible — and a multi-workspace token has to name one somehow.
   _both go through the same membership check; the query is a spelling of the same rule, not a way around it_
2. **Not named, the token covers one workspace** → that one is taken. The ordinary case needs no configuration at all.
3. **Not named, the token covers several** → `400` with the number of workspaces and a hint about what to name it with. Silently picking one would surface as “why is it empty here?” — a refusal is far better.
4. **Named, but malformed** → `400` “Malformed x-workspace-id”.
5. **Named, but not in the token's basket** → `403`. “Not in the basket” and “no such workspace” are **the same answer**, so that a token cannot be used to probe which workspace identifiers exist.
6. **Named twice** → `400`. A repeated `?workspaceId=a&workspaceId=b` (and the `?workspaceId[]=` spelling) is parsed by express into an array; treating an array as “not named” used to mean that **a single-workspace token quietly acted against its own workspace even though the caller had named two others**. A request naming more than one workspace has no answer that is not a guess. A repeated `X-Workspace-Id` is joined by Node into one comma-separated value — which fails the format check and gives the same `400`.

### 7.4 A full exchange: calling a tool

Below is a real exchange, as the wire-level e2e suite drives it (it speaks raw JSON-RPC through supertest rather than through the client SDK: the wire format _is_ the contract external clients rely on).

```
POST /api/v1/mcp?workspaceId=6a1f0f52-4c1e-4a0e-9c8b-0f6b2a5d1c11 HTTP/1.1
Host: cms.example.com
Authorization: Bearer ort_9f3c…
Accept: application/json, text/event-stream
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "content_create",
    "arguments": {
      "typeName": "test_article",
      "values": { "text": "From an agent", "select": "article" }
    }
  }
}
```

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\n  \"id\": \"c4d1…\",\n  \"status\": \"draft\",\n  \"values\": { … }\n}"
      }
    ],
    "structuredContent": {
      "id": "c4d1…",
      "status": "draft",
      "values": { "text": "From an agent", "select": "article" }
    }
  }
}
```

**Both spellings of the one value are returned at once.** `structuredContent` is for clients that parse it; the text block is for models that only see `content`. Returning just one would make the tool useless to half the ecosystem. A value that is not an object (an array, a number) is **wrapped in `{ value: … }`**, because the spec requires `structuredContent` to be an object — but it is not dropped.

#### What happened between those two blocks, step by step

1. **The controller has already assembled the context** (steps 7.2–7.3) and built the protocol server around it.
2. **The SDK found the `CallToolRequestSchema` handler** and passed it `params` plus an `extra` carrying the cancellation signal.
3. **`callWithinDeadline` creates its own `AbortController`.** The client's signal is relayed into it (that is the only cancellation signal this surface has) and a timer is attached. The `expired` flag is set **before** `abort()` is called, so that the listener firing right after can tell a deadline from a client that went away.
4. **`registry.call('content_create', args, {…context, signal}, 'mcp')`.** Inside the registry, strictly in this order: a) **the surface narrowing** — `forSurface('mcp')`. A tool of the wrong surface gives “Unknown tool” rather than a proposal nothing can accept; b) **an unknown name → `404`**, and this is a _deliberately different_ answer from a permission refusal: the tool set is not a secret (it is the same for any actor of a given scope, and it is documented), so conflating them would make a legitimate permissions problem undiagnosable. It is the **data** that is secret — and there an ungranted type 404s exactly like a non-existent one; c) **the `requires` check** — the actual boundary; d) **the `args ?? {}` default** — in the registry rather than at each edge: both shipped consumers used to compensate for this themselves; e) **argument validation** against the tool's own `inputSchema`. **Authorization before validation**: a caller who may not do this learns nothing about the arguments, and the answer to an unauthorized call is the same whatever it sends; f) **the surface stamp** — `{...context, surface}`, applied here rather than at the edge: this way the surface a handler sees is, by construction, the one the tool was authorized against.
   _packages/tools/server/src/lib/tool-registry.ts_
5. **The `content_create` handler delegates.** `resolveGrantedType` is the grant gate; `validateToolInput(PublicSaveEntryDto, input)` is **the actual HTTP DTO** with the same options as the host's global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`); `this.writes.create(...)` is the same `PublicEntryWritesService` the controller calls. **Not one visibility rule is rewritten here.**
6. **The result is measured before it is handed off.** `JSON.stringify(result, null, 2)`, `Buffer.byteLength`, compared against `maxResultBytes`. Measured _before_ a single copy reaches the transport, because on the way out the response costs roughly three times as much.
7. **The timer is cleared in `finally`**, and so is the listener on the client's signal. Otherwise a long-running process would accumulate listeners on someone else's signal.

### 7.5 How a refusal leaves — and why by two different paths

A `tools/call` refusal leaves as **a result with `isError`**. A `resources/*` refusal leaves as **a JSON-RPC error**. This is an asymmetry of the protocol, not an accident, and it is worth knowing before “fixing” either half.

#### A tool → `isError`

A tool's refusal is **an outcome the model is supposed to read** and react to (“title must be at most 200 characters”). So MCP models it as a successful call carrying `isError`. A protocol error would abort the call at the client; a result is handed to the model, which fixes its next call. A permission refusal arrives the same way — a model that learns it does not hold `content:publish` stops trying instead of retrying blindly.

#### A resource → a JSON-RPC error

Reading a resource has **no model in the loop**: the client asked for the bytes at a URI and either got them or did not. So MCP models the refusal as a protocol error, and `-32002` is reserved for “no such URI”. The flattened `ToolError` travels in the `data` field, so the client reads the same `status`/`code`/`issues` it would get from a tool.

What both paths share is `toToolError`. It turns what was thrown into `{ status, code, message, issues }`:

- **An `HttpException`** is a _caller's error_. The status, a short machine code (`bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `validation_failed`, otherwise `error`) and **the message as is**. The `issues` field from a 422 body is **carried over verbatim** — which is exactly what makes a validation error self-correcting.
- **Everything else is a bug, not a caller's error.** It is logged with a stack for the operator and returned as a bare `500` / `internal_error` with the text “see the server logs”: the message could name a table, a column or a connection string, and a tool's result is read by a **third-party model**.

```
// a tools/call that failed the permission check — HTTP 200, a JSON-RPC result
{
  "jsonrpc": "2.0",
  "id": 12,
  "result": {
    "isError": true,
    "content": [{
      "type": "text",
      "text": "{\n  \"status\": 403,\n  \"code\": \"forbidden\",\n  \"message\": \"\\\"content_create\\\" requires content:create, which this token does not hold.\"\n}"
    }]
  }
}

// a resources/read on an ungranted type — HTTP 200, a JSON-RPC error
{
  "jsonrpc": "2.0",
  "id": 13,
  "error": {
    "code": -32002,
    "message": "Unknown content type \"never_granted\".",
    "data": { "status": 404, "code": "not_found", "message": "…" }
  }
}
```

**Refusal and absence share `-32002` deliberately.** For _data_ the answer is uniform: an ungranted content type reads exactly like a non-existent one. `data.code` still distinguishes them for a client that cares.

### 7.6 An agent's full authoring cycle

The very loop the e2e suite drives end to end — “creates a draft, reads it back, publishes, and deletes it”. It shows why the workflow has to be written into the tools' _descriptions_: the model has nowhere else to learn it from.

1. **`content_types_list`.** The entry point of any authoring conversation, not a courtesy: a model cannot type `values` it has never seen.
2. **`content_type_get`.** The field schema + `valuesSchema`. Which is exactly why the writing tools can take an open object and still be usable.
3. **`content_create` → the entry lands as `status: "draft"`.** On a publishable type, _always_: every creation has a reviewable state. Required fields are required **for publication**, not for creation, so a draft may be incomplete.
4. **`content_list` with no arguments does not find it** — `total: 0`. Not a bug, the headline rule of the public API.
   _content_create's description warns outright: read it back with status: "any"_
5. **`content_get` with `status: "any"` finds it.** The widening is unlocked by the `content:update` permission — otherwise the writing API would be write-only.
6. **`content_update` merges.** Sending `{ number: 7 }` does not erase `text`; an explicit `null` clears a field. On a publishable type an update returns a published entry to draft, **while its published version stays on air**.
7. **`content_publish` re-validates and puts it on air.** A draft that fails the type's rules fails here — with the **fields named individually** in `issues`. This is the most useful error a model can get.
8. **`content_unpublish` takes it off air**, **`content_delete` deletes it.** After deletion `content_get` with `status: "any"` answers `code: "not_found"` — the same shape as an ungranted type.

### 7.7 Batched calls and notifications

1. **A batch.** A client may send an array of frames; the response is an array of results, one per request, preserving `id`. This is exactly why the endpoint is **a single route** rather than a route per tool: one bearer check, many operations.
2. **A notification** (a frame with no `id`) — `202` and an empty body.
3. **An unknown method** — `-32601` (Method not found) with HTTP 200, not a 500. A client trying `prompts/list` gets a coherent answer: this server declares only `tools` and `resources`.
4. **A malformed frame** — an empty body, a frame with no `method`, a frame declaring JSON-RPC 1.0 — is answered with `400` and a negative JSON-RPC code, not a 500.
5. **The `Accept` header.** Streamable HTTP requires a POST to accept _both_ types — `application/json` and `text/event-stream`. A client that sent only the first gets a `406`, with the missing type named in the message: this is the most common first-connection mistake.
6. **`Mcp-Session-Id` is ignored.** A client that believes it has a session is served normally: there are no sessions, so there is nothing to validate.

### 7.8 What happens when the switch is off

1. **`MCP_ENABLED` is not `true`** → `config.enabled === false` → `McpModule.forRoot` returns `controllers: []`.
2. **The route is not mounted** → `POST /api/v1/mcp` answers **404**, even with a valid token.
3. **But `ToolsModule` is still imported and re-exported.** The registry is bound and populated, because the copilot's in-process loop consumes the same registry and has nothing to do with whether the _external_ door is exposed.
4. **And a contributing plugin never has to think about it.** It registers its tools unconditionally, and it is the composition root that decides who reaches them.
5. **The mirror rule at the copilot.** `COPILOT_ENABLED` applies in exactly the same way — each switch removes **its own** surface, and neither shrinks the shared catalogue. The e2e suite `tools/tool-registry.spec.ts` checks **both** directions: with MCP off the copilot sees the full catalogue, with the copilot off MCP sees the full catalogue.

> **Why it is off by default**
>
> Turning it on gives **every holder of a `full`-scoped token** the ability to drive content CRUD from an external agent. That is a decision an operator makes deliberately, not one inherited by upgrading a version. Tokens, scopes and workspace baskets do not change — the switch governs only whether the door is mounted.

## 08. The HTTP API and the JSON-RPC methods

The package's HTTP surface is **one route**. The global `/api` prefix is set by the host; the controller is declared as `@Controller('v1/mcp')`, so the full path is `/api/v1/mcp`. Legend: `public` — the route is marked `@Public()`, so the session `AuthGuard` does not touch it, `bearer` — `Authorization: Bearer` is required, `permission` — decided at the tool level.

| Method and path | Access                       | Input                                                                                                                                                                                    | Success                                                                     | Refusals                                                                                                                                                                                                                                                                                                                                               |
| --------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST /v1/mcp    | `public` `bearer` `requires` | JSON-RPC 2.0: one frame or an array of frames. Headers: `Authorization`, `Accept: application/json, text/event-stream`, an optional `X-Workspace-Id`; query: an optional `?workspaceId=` | `200` with a JSON-RPC response; `202` with an empty body for a notification | `401` missing/invalid bearer or whitespace inside the value; `400` workspace not named on a multi-workspace token / malformed / named twice / a malformed frame; `403` workspace outside the basket; `406` `Accept` does not cover both types; `413` body larger than 1 MB; `404` the plugin is off; `500` an uncaught exception (a `-32603` envelope) |
| GET /v1/mcp     | `public` `bearer`            | —                                                                                                                                                                                        | — (there is no success)                                                     | `405` with `Allow: POST` and a `-32000` envelope. With no token — `401`                                                                                                                                                                                                                                                                                |
| DELETE /v1/mcp  | `public` `bearer`            | —                                                                                                                                                                                        | — (there is no success)                                                     | `405`. With no token — `401`                                                                                                                                                                                                                                                                                                                           |

> **Why the 405 comes from the controller rather than the transport**
>
> In the specification `GET` is a **server-initiated stream** and `DELETE` is tearing down a session. Neither exists here, and this is exactly the case the specification reserves 405 for. The SDK transport is deliberately **not asked**: given a `GET` in stateless mode it opens a separate SSE stream and holds it **forever** — nobody on this endpoint ever sends a server-initiated message — so a client that tries a `GET` (and several do) would hang on a connection that will carry nothing, holding a socket, a transport and a protocol server per attempt. `@All()` routes these verbs into the same controller so that the answer comes from the protocol layer rather than being a generic Nest 404 a client cannot interpret.

### The JSON-RPC methods

**Four** handlers of its own are registered; two more methods (`initialize`, `ping`) are served by the SDK's low-level `Server` itself. The declared server capabilities are `{ tools: {}, resources: {} }`: this server has no `prompts`, `sampling` or `logging` sections.

| Method           | Who serves it         | Parameters                                      | Result                                                                                                                                | Refusals                                                                                                                                                                                                                                                                                                      |
| ---------------- | --------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| initialize       | the SDK               | `protocolVersion`, `capabilities`, `clientInfo` | `serverInfo: { name, version }` from the plugin's configuration + `capabilities` with `tools` and `resources`                         | The answer to an unauthenticated call is a `401`, before the protocol layer                                                                                                                                                                                                                                   |
| ping             | the SDK               | —                                               | An empty result                                                                                                                       | —                                                                                                                                                                                                                                                                                                             |
| tools/list       | `build-mcp-server.ts` | —                                               | `{ tools: [{ name, title, description, inputSchema, annotations }] }`, where `annotations = { title, readOnlyHint, destructiveHint }` | An empty list is **an answer**, not an error                                                                                                                                                                                                                                                                  |
| tools/call       | `build-mcp-server.ts` | `name`, `arguments`                             | `{ content: [{ type: 'text', text }], structuredContent }`                                                                            | **Never a JSON-RPC error.** Everything leaves as `{ isError: true, content: [...] }`: `404 not_found` (an unknown tool or a tool of the other surface), `403 forbidden`, `422 validation_failed`, `400 bad_request`, `504 timeout`, `499 client_closed_request`, `413 result_too_large`, `500 internal_error` |
| resources/list   | `build-mcp-server.ts` | —                                               | `{ resources: [{ uri, name, description, mimeType }] }`, trimmed by permissions and grants                                            | A JSON-RPC error via `toMcpError`                                                                                                                                                                                                                                                                             |
| resources/read   | `build-mcp-server.ts` | `uri`                                           | `{ contents: [{ uri, mimeType, text }] }`                                                                                             | A JSON-RPC error: `-32002` for 403/404, `-32602` for 400/422, `-32603` for the rest. The flattened `ToolError` travels in `data`                                                                                                                                                                              |
| notifications/\* | the transport         | a frame with no `id`                            | `202`, an empty body                                                                                                                  | —                                                                                                                                                                                                                                                                                                             |

### JSON-RPC error codes

| Code   | Name                                  | When                                                                                                                            | Where from                                                                                                                                                              |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| -32000 | Server error (implementation-defined) | The envelope of the `405` response to `GET`/`DELETE`. The message explains that the endpoint is stateless and serves POST only  | `mcp.controller.ts`, the `methodNotAllowed` function                                                                                                                    |
| -32002 | Resource not found                    | `resources/read`: status `403` or `404`. Refusal and absence share the code deliberately                                        | The `RESOURCE_NOT_FOUND` constant — it is in the specification but not in the SDK's enum, so it is written out explicitly rather than approximated with `InternalError` |
| -32601 | Method not found                      | An unknown method, e.g. `prompts/list`                                                                                          | the SDK                                                                                                                                                                 |
| -32602 | Invalid params                        | `resources/*`: status `400` or `422`                                                                                            | `ErrorCode.InvalidParams`, the `jsonRpcCodeFor` function                                                                                                                |
| -32603 | Internal error                        | `resources/*`: any other status. Plus the controller's emergency envelope when the transport threw before the headers were sent | `ErrorCode.InternalError` and `mcp.controller.ts`                                                                                                                       |

Malformed frames (an empty body, a frame with no `method`, a frame with `jsonrpc: "1.0"`) are rejected by the transport itself with its own negative code and HTTP `400`; the e2e suite pins only the sign of the code, because the specific code here is an SDK detail rather than this package's contract.

> **Why the route is absent from OpenAPI**
>
> `@ApiExcludeController()`. JSON-RPC over a single route is not describable with REST operations, and a lone `POST /v1/mcp` line in the reference would tell a reader _nothing_ about the tools. The documentation is the package's `AGENTS.md` — and, for an agent, the tool descriptions themselves.

## 09. Admin UI

**MCP has no admin package of its own** — `packages/mcp/admin` does not exist. No screen, no route, no slot contribution. This is correct by design: a protocol adapter has nothing to show, and everything an operator manages here lives on other people's screens.

| The operator's task                                 | Where it is done                                                                                      | What to know                                                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue an agent its access                           | The **“API tokens”** page (`@orthacms/api-tokens-admin`; the server half is inside `identity-server`) | The scope — `read` for a reading agent, `full` for a writing one. That is what decides which tools the agent will see at all. Plus an explicit list of workspaces |
| Revoke an agent's access                            | The same place                                                                                        | Revoking the token closes MCP immediately too: there is no second credential store                                                                                |
| Limit which content types the agent sees            | The workspace's content grants (`workspaces-admin`)                                                   | An ungranted type is indistinguishable from a non-existent one, in tools and in resources alike                                                                   |
| Limit which readers a published entry is visible to | The **“Access”** tab in the entry editor + the audience directory (`segments-admin`)                  | An agent with `full` can change this per entry through `content_access_set`, but cannot touch the directory                                                       |
| Open or close the door                              | An **environment variable**, not an interface                                                         | `MCP_ENABLED=true` and a restart. There is deliberately no toggle screen: this is a deployment decision, not an editorial one                                     |
| See what the agent has done                         | The activity journal (`activity`) and an entry's revision history                                     | An agent-authored revision carries `null` in the user field — see section 5                                                                                       |

### How a client connects

The endpoint speaks Streamable HTTP directly. For a client that only speaks stdio, `mcp-remote` provides a bridge — one line in its config and nothing for us to maintain:

```
{
    "mcpServers": {
        "ortha-cms": {
            "command": "npx",
            "args": [
                "-y",
                "mcp-remote",
                "https://cms.example.com/api/v1/mcp?workspaceId=<uuid>",
                "--header",
                "Authorization: Bearer <token>"
            ]
        }
    }
}
```

## 10. Configuration

The plugin is registered in the composition root **after** `IdentityPlugin` (bearer tokens are verified through its `ApiTokenService`) and after every plugin contributing tools — so that the intent reads top to bottom. DI itself does not depend on that order: all plugin modules are global, and contributors register in `onModuleInit`, which Nest calls only after the whole graph is built.

```
McpPlugin({
    config: {
        enabled: true,
        name: 'ortha-cms',
        version: '1.0.0',
        callTimeoutMs: 30_000,
        maxResultBytes: 4_194_304
    }
});
```

| Field          | Environment variable | Default             | What it means and why that value                                                                                                                                                                                                                                                                                 |
| -------------- | -------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| enabled        | MCP_ENABLED          | `false`             | Whether the door is mounted. Read strictly as `=== 'true'`, so any other value means “off”. The only thing it governs is the controller. Tokens, scopes and workspace baskets do not change                                                                                                                      |
| name           | —                    | `'ortha-cms'`       | The server's identity in `initialize` — what the client shows in its connector list. A literal rather than a variable: this is stable product configuration. An empty value is an exception at plugin construction                                                                                               |
| version        | —                    | `'1.0.0'`           | The same. An empty value is an exception at construction                                                                                                                                                                                                                                                         |
| callTimeoutMs  | MCP_CALL_TIMEOUT_MS  | `30_000`            | The ceiling on a single `tools/call`. 30 s is generous for every shipped tool and noticeably below the idle timeouts of the load balancers such deployments sit behind. A **positive integer** is required: a zero would fail every call, and `Number(env) \|\| default` would turn a typo into a silent default |
| maxResultBytes | MCP_MAX_RESULT_BYTES | `4_194_304` (4 MiB) | The ceiling on one tool's serialized result. Deliberately generous: nothing in the catalogue returns that much today, and the ceiling exists so that a pathological result is not serialized three times, not to shape ordinary use. A positive integer is required                                              |
| —              | MAX_REQUEST_BODY     | `'1mb'`             | **Not an MCP field**: the host's `bodyLimit`, applied to the whole application. Uploads are unaffected — they are multipart and are bounded separately by the media plugin's `maxUploadBytes`                                                                                                                    |

### What is validated at plugin construction

- **`config.name` is non-empty** → otherwise an exception reading “it is the server identity MCP clients display”. A malformed identity would surface as a broken `initialize` response, where it is incomparably more expensive to diagnose.
- **`config.version` is non-empty** → the same.
- **`callTimeoutMs` is a positive integer** → `Number.isInteger(v) && v > 0`. A ceiling of `0`, a negative one or `NaN` is worse than no ceiling.
- **`maxResultBytes` is a positive integer** → the same.

The unit test `mcp-plugin.spec.ts` separately pins that the plugin **constructs even when disabled**: the registry is bound regardless.

## 11. Security: what was done and why exactly this way

### 11.1 The same credentials, the same rules

MCP is **a second front door into the same house**, not a second security model. It takes the bearer tokens the “API tokens” page already mints, verifies them with the same `ApiTokenService.verify`, and derives permissions with the same `scopePermissions`. The consequences are pragmatic: revoking a token closes MCP the same second, and there is no second credential store to audit.

| The guard on `/api/v1/*` | Its twin here                               | What proves the equivalence                                                                                                                                                        |
| ------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ApiTokenGuard            | McpAuthService.authenticate                 | The same `verify`, the same flat 401, the same `scopePermissions`                                                                                                                  |
| ApiTokenWorkspaceGuard   | resolveWorkspace                            | The rule is rewritten word for word: 400 on a malformed value, 403 on “not in the basket”, auto-selection for a single-workspace token, 400 for a multi-workspace one with no name |
| @RequirePermissions(...) | ToolDefinition.requires + ToolRegistry.call | The check happens **before dispatch**; a handler never checks its own gate                                                                                                         |
| DraftVisibilityGuard     | assertDraftVisibility                       | The same `content:update` probe, the same behaviour on an unrecognized value (leave it to the DTO, so the 400 reports the right problem)                                           |

### 11.2 A cookie is not accepted

Exactly as on `/api/v1`. A cookie rides along with a request **by itself** — that ambient quality is precisely what makes cookie-authenticated writes vulnerable to CSRF; a bearer never rides that way. Accepting both on an endpoint whose purpose is to let an agent write content would bring CSRF back for nothing. The e2e suite checks this with its own case: “does not accept a session cookie in place of a token”.

### 11.3 No signal for enumeration

#### What is unified

- An unknown / revoked / expired token → one `401`.
- A workspace outside the basket / a non-existent workspace → one `403`.
- An ungranted content type / a non-existent type → one `404`, in tools and in resources alike.
- A draft / a deleted entry / another workspace / an unknown id → one “not found”.

#### What is deliberately distinguished

- **An unknown tool** (`404`) and **a permission refusal** (`403`) are different answers. The tool set is not a secret: it is the same for any actor of a given scope and it is documented, and the list is derived from the caller's own scope. Conflating them would make a legitimate permissions problem undiagnosable and would make the model burn turns blindly.
- The “one answer” rule still holds for **data**, and that is exactly where the boundary runs.

### 11.4 Two fields that are security-critical

- **requires** — **The counterpart of `@RequirePermissions(...)`.** Getting it wrong is a privilege bug no type-checker will catch. A handler must not check its own gate: then a new tool could forget to. The registry validates at startup that every value really exists in `PERMISSION_KEYS` — a raw literal that drifted from the list would leave the tool uncallable, silently.
- **surfaces** — **Just as critical.** A propose tool that forgot this field would become callable by an MCP client that has nothing to accept the resulting proposal with — and `media_propose_file` also _writes_, and a `full` token's permissions would suffice for it. Only `surfaces` stops it. The protection is the cross-surface e2e cases, and a new tool must acquire its own.

### 11.5 Prompt injection

> **A risk that cannot be eliminated here — only bounded**
>
> An agent reading a CMS entry that contains instructions may follow them. **Nothing in this package can prevent that.** What it bounds is the blast radius: the token's scope, its workspace basket and the content grants. Hence the practical conclusions: mint **narrow** tokens; remember that the switch defaults to off precisely so that the operator accepts this risk explicitly; and do not hand out `full` where `read` will do.

### 11.6 What cannot be reached over MCP at all

- **The audience directory.** Renaming one audience's tags changes the visibility of every entry that names it, installation-wide. That is dictionary administration — it stays on a screen behind a session.
- **The activity journal, the members, the check findings.** They require permissions no token scope grants; on top of that they are marked `surfaces: ['copilot']`, so that the reason is declared rather than following from a coincidence.
- **Drafts, for a token with no write permission.** The `status` widening is unlocked by the `content:update` permission.
- **Uploading a file.** There is no tool for it; a `full` token's `media:create` leads to the REST route `POST /api/v1/media/assets`, not here.
- **Renaming and deleting other people's assets.** `media:update` and `media:delete` are granted by no scope: attaching an asset to an entry is content authorship, while renaming someone else's file in the library is media administration.

### 11.7 Resilience

- **Every request cleans up after itself.** `response.on('close')` closes both the transport and the protocol server, however the exchange ends. Without that line every request would leak a server and its handlers' closures.
- **A late rejection does not crash the process.** `pending.catch(() => undefined)` on the promise that lost the race — otherwise a handler failing after the deadline would become an unhandled rejection.
- **A client going away is not a tool failure.** The `CallAbandoned` class separates “the deadline” and “the client left” from real errors, so that neither reaches `toToolError` and gets logged as an uncaught error with a stack. A client going away is routine, and the deadline is this file's own decision; neither is a bug in a tool.
- **The response always terminates.** If the transport has already started writing there is nowhere to put a status — the connection is simply closed: a truncated response is diagnosable, a hang is not.
- **Broken wiring does not survive to the first caller.** The catalogue validation on `onApplicationBootstrap` aborts `app.init()`: a duplicate name used to take down both surfaces at runtime while startup reported success.

## 12. Invariants

Statements that must remain true. Violating any of them is either a hole or a divergence between the two surfaces.

- **I-01** — **Authentication precedes the protocol.** An unauthenticated caller cannot move the JSON-RPC state machine at all, `initialize` included. The answer is an ordinary HTTP `401`, not a JSON-RPC error.
- **I-02** — **The verb check follows authentication.** An unauthenticated `GET` is a `401`, not a `405`: the answer about the verb is unreachable without credentials.
- **I-03** — **A session cookie is not a credential for this endpoint** — never, in any mode.
- **I-04** — **An unknown, a revoked and an expired token are indistinguishable** — one flat `401` with no hint which of the three it was.
- **I-05** — **A bearer value contains no internal whitespace.** The pieces after the scheme are not glued together: an invented token would report itself as “wrong secret” instead of “malformed header”.
- **I-06** — **The workspace is always resolved before dispatch** and always belongs to the token's basket. The header wins over the query; both spellings pass the same check. More than one named workspace is a `400`, not a silent pick.
- **I-07** — **An actor's permissions are derived from the token's scope alone.** The role of the human who minted it is never consulted — revoking the token is always sufficient, whoever issued it.
- **I-08** — **`ToolRegistry.call` is the only authorization boundary.** `visibleTo` only hides; a client is free to name a name it was never shown. A handler does not check its own gate.
- **I-09** — **The surface narrowing applies both to the list and to a call.** A `['copilot']` tool is neither visible nor callable here, however broad the token.
- **I-10** — **Authorization precedes argument validation.** Someone who may not do this learns nothing about the arguments, and the answer is the same whatever they send.
- **I-11** — **The surface in the context is stamped by the registry**, not by the caller. So a handler sees, by construction, the surface the tool was authorized against. It may be used **for presentation only**, never for authority.
- **I-12** — **A `tools/call` refusal is a result with `isError`, not a JSON-RPC error.** A `resources/*` refusal is the reverse. Both halves go through `toToolError`, so the flattened error shape is the same.
- **I-13** — **An unexpected exception is opaque on both paths** — `500` / `internal_error` and the text “see the logs”. A raw driver message never reaches the wire.
- **I-14** — **A result is returned in both spellings** — as a text block and as `structuredContent`. A non-object is wrapped in `{ value }`, not dropped.
- **I-15** — **Every exchange is bounded by three ceilings**: the request body, the time of one call, the size of one result. Exceeding the time or the size is returned in a form the model can read (`504`/`timeout`, `413`/`result_too_large`).
- **I-16** — **The deadline bounds the caller's wait, not the work.** A tool that ignores the signal runs to completion. The caller gets an answer either way.
- **I-17** — **The transport and the protocol server live exactly one exchange** and are closed on `close`. No session identifiers are issued or checked; an `Mcp-Session-Id` that is sent is ignored.
- **I-18** — **The tool list is a function of the caller.** A `read` token and a `full` token get different lists from one and the same deployment.
- **I-19** — **No content rule is rewritten here.** The handlers call the same `resolveGrantedType`, `PublicEntriesQuery`, `PublicEntryWritesService` the HTTP controllers do, and validate with the real DTOs under the host's `ValidationPipe` options.
- **I-20** — **The switch removes only the controller.** The registry is bound and populated with `MCP_ENABLED=false`, because the copilot consumes the same registry. Symmetrically for `COPILOT_ENABLED`.
- **I-21** — **The plugin owns no table and no migration.** No migrations descriptor is declared.
- **I-22** — **A broken catalogue does not survive to the first caller.** A duplicate name, an invalid name, an empty `surfaces`, a non-existent permission, a malformed `inputSchema` — all of them abort `app.init()`, and every problem is reported at once.
- **I-23** — **Reading a resource is not a way around the grant gate.** An ungranted type 404s on `resources/read` exactly as it does on a tool call; a resource's `requires` is checked **before** the provider is asked for any bytes.
- **I-24** — **Reading returns only published content by default.** Only an actor with `content:update` can widen it to drafts.

## 13. Testing checklist

In the “action → what to expect” format. Most of it is already covered by automated tests: the package's unit suite (`mcp-auth.service.spec.ts`, `build-mcp-server.spec.ts`, `mcp-plugin.spec.ts`) and the wire-level e2e (`apps/server-e2e/src/server/mcp/mcp.spec.ts`, `apps/server-e2e/src/server/tools/tool-registry.spec.ts`). The e2e speaks **raw JSON-RPC** through supertest rather than through the client SDK: the wire format _is_ the contract external clients rely on, so the bytes are what must be checked.

### 13.1 Authentication

- **A POST with no `Authorization` header** → `401`. Not a single JSON-RPC frame in the response.
- **A POST with an unknown bearer** → `401` “Invalid API token”, with no hint as to what is wrong with the token.
- **Revoke the token, repeat the same request** → `401` immediately, with no server restart and no waiting for expiry.
- **An expired token** → the same `401`, indistinguishable from an unknown and a revoked one.
- **Send a session cookie instead of a token** → `401`. A cookie is not a credential on this endpoint under any circumstances.
- **A differently cased scheme: `bearer`, `BEARER`** → accepted: the comparison is case-insensitive.
- **Extra whitespace around the scheme: `" Bearer <token> "`** → accepted — RFC 9110 allows it and clients send it that way.
- **Whitespace inside the value: `"Bearer <token> extra"`** → `401`. The pieces are not glued: gluing would invent a token that was never sent.
- **A non-bearer scheme (`Basic`, `Token`)** → `401`.
- **The actor's permissions for a token issued by an administrator** → equal to `scopePermissions(scope)`, not the administrator role's permissions. Test this specifically on a `read` token issued by an admin.

### 13.2 Workspace resolution

- **A single-workspace token with no header and no query** → works; the workspace is filled in automatically. The ordinary case needs no configuration.
- **A multi-workspace token with nothing specified** → `400` with the number of workspaces and a hint about the header and the query. Not a silent pick of the first.
- **`X-Workspace-Id` with a workspace from the basket** → works; the data of that very workspace.
- **`?workspaceId=` in the endpoint's URL** → works exactly like the header: it is a second spelling of the same rule.
- **The header and the query both named and different** → the header wins; the query has no effect and causes no error.
- **A workspace outside the token's basket** → `403`, identical to the answer for a non-existent workspace: identifiers cannot be enumerated with a token.
- **A malformed identifier in the header or the query** → `400` “Malformed x-workspace-id”.
- **A repeated `?workspaceId=a&workspaceId=b`** → `400` “more than one workspace”. **A regression that is easy to reintroduce:** the array used to be read as “not named”, and a single-workspace token quietly acted against its own workspace even though two others had been named.
- **A repeated `X-Workspace-Id` header** → `400`: Node joins repeats with a comma, and the join fails the format check.
- **A write into a workspace outside the basket** → refused; test this with a writing tool specifically, not only with a read.

### 13.3 Transport and protocol

- **`GET /api/v1/mcp` with a valid token** → `405`, an `Allow: POST` header, the word “stateless” in the message. **The answer must come immediately** — if the request hangs, the transport did open an eternal SSE stream after all.
- **`DELETE /api/v1/mcp`** → `405`: there is no session to close.
- **`GET` with no token** → `401`, not `405`: the answer about the verb is unreachable without credentials.
- **`Accept: application/json` without `text/event-stream`** → `406`, with the missing type named in the message. This is the most common first-connection mistake.
- **An `Mcp-Session-Id` header from a client that believes it has a session** → `200`, the header ignored.
- **A notification (a frame with no `id`), e.g. `notifications/initialized`** → `202` and an **empty** body.
- **A batch of two frames (`tools/list` + `resources/list`)** → an array of two results, identifiers preserved, both carrying a `result`.
- **The unknown method `prompts/list`** → `200` with a `-32601` error, not a `500`.
- **An empty body / a frame with no `method` / `"jsonrpc": "1.0"`** → `400` with a negative JSON-RPC code, not a `500`.
- **A body larger than 1 MB** → `413` with an ordinary Nest body — this is above the JSON-RPC layer, so there is no frame here.
- **`initialize`** → `serverInfo` exactly from the plugin's configuration; `capabilities` contains `tools` and `resources` and does **not** contain `prompts`.
- **A hundred sequential requests** → RSS does not grow linearly: the transport and the protocol server are closed on `close`. A regression here is a leak per request.

### 13.4 Tool visibility and authorization

- **`tools/list` with a `read` token** → `content_list` and `content_types_list` present, `content_create`, `content_update`, `content_publish`, `content_delete` **absent**. Check membership, never a total: the set grows whenever a package registers a tool, and a count in a checklist is pinned by nothing.
- **`tools/list` with a `full` token** → the writing tools appear alongside the reading ones — `content_create`, `content_update`, `content_publish`, `content_unpublish`, `content_delete`, the four `content_bulk_*`, and `content_access_set`.
- **Annotations** → `content_list.readOnlyHint === true`; `content_delete.readOnlyHint === false` and `destructiveHint === true`.
- **Every tool in the list** → `inputSchema.type === 'object'` and a non-empty `description`. The description is the only documentation the model gets.
- **A `read` token calls `content_create` by name** → `isError: true`, `403`/`forbidden`. **This is the boundary:** the list only hides, and a client is free to name a name it was never shown.
- **A `read` token calls every writing tool in turn** → every one of them refused. Test by enumeration, not by sampling: `requires` is set on each tool separately.
- **A `read` token asks for `status: "draft"` or `"any"`** → `403`: the visibility widening is unlocked by the `content:update` permission.
- **An unknown tool name** → `404`/`not_found`, and **not** the same answer as a permission refusal. The distinction is deliberate.
- **A permission refusal with knowingly malformed arguments** → a `403` arrives, not a `422`: authorization comes before validation.

### 13.5 Surface isolation

- **`tools/list` with a `full` token** → the list contains no `admin_*`, no `*_propose_*`, no `i18n_translations_get`, no `activity_recent`, no `workspace_members_list`, no `admin_alarms_findings`.
- **Call `admin_content_search` by name** → `isError: true`. The surface narrowing applies to a call too, not only to the list.
- **Call `media_propose_file` with a `full` token** → `isError: true`. **The sharpest case:** the token's permissions suffice (`media:create` is part of `full`), only `surfaces` stops it.
- **The shared tools are visible to a `read` token** → the list contains `i18n_locales_list`, `media_assets_search`, `media_folders_list`, `media_asset_read`.
- **A shared tool is not only visible but callable** → `i18n_locales_list` runs and returns `locales`. A tool that is listed but 404s when called would mean the list and the call have diverged.
- **`media_assets_search` over MCP** → `downloadPath` has the form `/api/v1/media/assets/<id>/raw`, and **that path really does fetch with the same bearer** (`200`). The admin path here would be a guaranteed 401.
- **A new tool was added in any plugin** → the PR contains either a `surfaces` with a comment saying where the tension is, or an absent field with a comment saying there is none. Neither present is an unanswered question.

### 13.6 Errors and ceilings

- **An argument that fails `inputSchema`** → `isError`, `422`/`validation_failed` with the field named individually in `issues`.
- **A required argument is missing** → the same; the call never reaches the handler.
- **An unknown argument, rather than being ignored** → an error. A silently dropped mistyped argument produces a plausible-looking wrong answer — the hardest failure to notice.
- **A non-uuid in `folderId` / `assetId`** → `400`/`bad_request`, not an opaque `500`.
- **A tool threw an `HttpException`** → `isError` with the status, a short code and the message as is; `issues` carried over verbatim.
- **A tool threw a non-`HttpException`** → a bare `500`/`internal_error` and the text “see the server logs”. The response contains **no** table name, column or connection string. The log has the stack.
- **`MCP_CALL_TIMEOUT_MS=1`, any call** → `isError`, `504`/`timeout`, with the tool's name and the deadline value in the message. The caller **always** gets an answer.
- **A handler that fails after the deadline** → the process survives. A regression here is an unhandled rejection crashing the server, i.e. exactly the failure the timeout was introduced for.
- **The client broke the connection mid-call** → no “unhandled error in a tool handler” entry with a stack in the logs: a client going away is routine, not a bug in a tool.
- **`MCP_MAX_RESULT_BYTES=200`, `content_types_list`** → `isError`, `413`/`result_too_large`, **both sizes named**, and `structuredContent` **absent** from the response.
- **A result just under the ceiling** → passes unchanged; the cutoff is not “approximately”.
- **A non-object value from a tool** → reaches `structuredContent` as `{ value: … }` rather than being lost.

### 13.7 Content: the full cycle and the visibility rules

- **`content_types_list`** → only the types granted to _this_ workspace. An ungranted type in the list is a leak of the data model.
- **`content_type_get` for an ungranted type** → `404`, identical to the answer for a non-existent type.
- **`content_list` with no `status`** → published content only. A draft created a second ago by the same token is neither visible nor counted in `total`.
- **`content_list` in another workspace** → the neighbouring workspace's entries do not appear in the output.
- **`content_create` on a publishable type** → `status: "draft"`. Not “published”, not “depends on the type”.
- **`content_get` with `status: "any"` and a `full` token** → the draft is readable — otherwise the writing API would be write-only.
- **`content_update` with one field** → the other fields survive; an explicit `null` clears a field, an omitted one does not.
- **`content_publish` on an invalid draft** → `isError` with `issues` naming the specific fields. This is the most useful error a model can get.
- **`content_delete`, then `content_get` with `status: "any"`** → `not_found` — the same shape as an ungranted type.
- **`content_delete` on a localized type** → exactly one row is deleted; the other translations survive.
- **`content_bulk_save` with a mixed batch** → the call succeeds, each item gets its own verdict at its own position, and a failure carries the same reason a single call would have failed with.
- **`content_bulk_publish` where some drafts are invalid** → the valid ones are published, the rest land in `skipped` with a reason of `already-published` / `blocked` / `not-found`. A partially skipped batch is a normal outcome.
- **`content_relations`** → only published targets are shown and counted.
- **The `pageSize` limit** → matches the limit of the HTTP route of the same name: the rule is written once, in the DTO.

### 13.8 Resources and audiences

- **`resources/list`** → only the schemas of types granted to the workspace.
- **`resources/read` for a granted type** → JSON with the field schema and `valuesSchema`.
- **`resources/read` for an ungranted type** → a JSON-RPC **error** `-32002`, with `{ code: "not_found" }` in `data`. Not a result with `isError`: a resource has the other asymmetry.
- **`content_access_get` right after `content_access_set`** → what was just written is read back. A regression here is reading through the public entry read, which loses sight of the entry the agent itself just restricted.
- **An empty `allow`** → means “EVERYONE can see it”, not “nobody”. Test it specifically on an empty list.
- **Call `content_access_set` with a `read` token** → `403`: it needs `segments:manage`, which only `full` carries.
- **Try to create/rename/delete an audience over MCP** → no such tool exists. The audience directory is exposed by no token-authenticated surface.

### 13.9 The switch and startup

- **`MCP_ENABLED=false`, a POST with a valid token** → `404`: the route is not mounted.
- **`MCP_ENABLED=false`, the copilot on** → the copilot sees the **full** tool catalogue. The switch removes its own surface, not the shared catalogue.
- **`COPILOT_ENABLED=false`, MCP on** → mirror image: MCP sees the full catalogue, and there are no copilot routes at all.
- **An empty `config.name` or `config.version`** → an exception at plugin construction, not a broken `initialize` a week later.
- **`callTimeoutMs` or `maxResultBytes` = 0, negative, `NaN`, fractional** → an exception at construction. A zero timeout would fail every call.
- **Two providers claimed the same tool name** → the process **does not start**: `app.init()` aborts. Not “the first call fails”.
- **`requires` with a non-existent permission key** → the process does not start. A regression here is a tool invisible and uncallable for everyone, silently.
- **A tool name that is not `snake_case`** → the process does not start. Test both surrounding whitespace and `CamelCase`.
- **An empty `surfaces: []` array** → the process does not start: the tool is offered to nobody.
- **Two catalogue problems at once** → the error message names **both**, not whichever came first.
- **A deployment with no MCP plugin at all** → the application starts; the contributing plugins simply stay unregistered (`@Optional()`).

## 14. Boundaries of responsibility

| Area                                                                            | Who owns it                                                                         | What MCP does                                                                                                 |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| The tool contract, the registry, call authorization                             | `tools-server`                                                                      | **Imports** `ToolsModule` and re-exports it. Defines none of the types and does not own the registry instance |
| The tools themselves                                                            | `content-server` (16), `media-server` (3), `segments-server` (3), `i18n-server` (1) | Nothing. Learning about a new tool requires no change here                                                    |
| Content visibility rules, writes, revisions, the outbox                         | `content-server` (`public-api/` and the `EntryWriterService` beneath it)            | Rewrites not one rule. The handlers call the same objects the HTTP controllers do                             |
| Tokens, their verification and revocation; translating a scope into permissions | `identity-server` (`ApiTokenService`, `scopePermissions`)                           | Calls `verify` and `scopePermissions`; has no credential store of its own                                     |
| The UI for issuing and revoking tokens                                          | `api-tokens-admin`                                                                  | Nothing: MCP has no admin package                                                                             |
| The workspace header's name and the identifier format                           | `workspaces-server` (`WORKSPACE_HEADER`, `WORKSPACE_ID_PATTERN`)                    | Applies the same constants the REST guard does — the rule is rewritten, the values are not                    |
| The workspace's content grants                                                  | `workspaces-server` + `content-server`                                              | Nothing; the grant gate is applied inside the handlers and when reading resources                             |
| Restricting the readers of a published entry                                    | `segments-server`                                                                   | Serves three of that plugin's tools; does not expose the audience directory at all                            |
| Proposals, the run engine, attribution to a human                               | `copilot-server`                                                                    | Nothing — and that is exactly why `propose` tools are not admitted here                                       |
| The request body limit                                                          | `bootstrap-server` (`bodyLimit`, `MAX_REQUEST_BODY`)                                | Does not configure it; the limit is application-wide and fires above JSON-RPC                                 |
| The global `/api` prefix, the `ValidationPipe`, the body parser                 | `bootstrap-server`                                                                  | Uses them: the controller is declared as `v1/mcp`, and the body arrives already parsed                        |
| The database connection and migrations                                          | `@orthacms/database` + `@orthacms/nx`                                               | Nothing. No tables, no migrations, no schema                                                                  |
| The activity journal                                                            | `activity`                                                                          | Nothing directly; the events are produced by the plugins whose services ran                                   |
| The Streamable HTTP format, the JSON-RPC envelope, negotiation                  | `@modelcontextprotocol/sdk`                                                         | Wires up the transport and the low-level `Server`; intercepts `GET`/`DELETE` **before** the transport         |
| The bridge for stdio clients                                                    | `mcp-remote` (third-party, at the client)                                           | Nothing — one line in the client's config and nothing in our code                                             |

### What else is not here

- **Attribution of a write to a human.** An agent-authored revision carries `null` in the user field. The gap is inherited from the public write API and deserves its own column — ADR-0006 notes it as something worth fixing _before_ agent authorship becomes widespread.
- **A `prompts` section.** The server declares only `tools` and `resources`; no pre-built prompts are offered to an MCP client here.
- **Subscriptions to resource changes** (`resources/subscribe`) and any server-initiated messages at all — a direct consequence of statelessness.
- **File upload through a tool.** A `full` token holds `media:create`, but it leads to the REST route `POST /api/v1/media/assets`.
- **Telemetry of its own.** This package keeps no call counters, durations or refusal rates; only an uncaught exception in an exchange is logged.
- **A separate rate limit.** There is no `ThrottlerGuard` on this route: the limiter is the token's scope and the exchange's three ceilings.
- **A toggle screen.** `MCP_ENABLED` is an environment variable; this is a deployment decision, not an editorial one.

## 15. Divergences between code and documentation

Found while checking this artifact against the sources. Mostly these are not product bugs, but they mislead both a developer and a tester — and in two cases (the last two rows) it is behaviour, not text, that is at issue.

| Where                                                                           | What it says                                                                                                                                          | How it actually is                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| docs/adr/0006-cms-as-an-mcp-server.md, §4                                       | “**Twelve tools**, flat, whatever the content model”                                                                                                  | There are **sixteen** content tools (four bulk ones were added: `content_bulk_save`, `content_bulk_publish`, `content_bulk_unpublish`, `content_bulk_delete`), and **23** are served over MCP in total. The code itself knows this: the docstring in `content-tools.provider.ts` says “The sixteen content tools”                                                                                                                 |
| docs/adr/0007-one-tool-registry-two-surfaces.md, §2                             | “MCP's **twelve** content tools are `['mcp']`, the copilot's **fourteen** are `['copilot']`”                                                          | The same stale number. The same section still says “Today the split is total” — already contradicted by that document's own 2026-08-11 note in its header (four tools declare no surface)                                                                                                                                                                                                                                         |
| packages/mcp/server/AGENTS.md, the opening paragraph                            | “The MCP front door onto the CMS, **and the home of the shared agent tool registry**… It owns the protocol, the authentication, **and the registry**” | Directly contradicts the callout in the same file's header (“The tool registry **moved out**”) and the code: `McpModule` **imports** the registry rather than providing it. The document argues with itself within ten lines                                                                                                                                                                                                      |
| packages/mcp/server/AGENTS.md, “Two consumers, one registry”                    | “The copilot's tool loop (**once its run engine lands**)… Nothing here needs to change **when the copilot arrives**”                                  | The copilot arrived long ago: it has a run engine, fourteen tools of its own, and an e2e suite checking surface isolation in both directions. The future-tense wording is out of date                                                                                                                                                                                                                                             |
| packages/mcp/server/AGENTS.md, the `ToolProvider` example                       | Shows a `media_upload` tool with `requires: [PERMISSIONS.MEDIA_CREATE]`                                                                               | There is **no such tool** anywhere in the monorepo. `media/server` has three tools, and all three are reads. Uploading goes through a REST route. The example is illustrative, but it reads as a list of what exists                                                                                                                                                                                                              |
| packages/mcp/server/AGENTS.md, “Who contributes tools”                          | “`i18n/server` the **locale tools**” (plural)                                                                                                         | Exactly **one** reaches here — `i18n_locales_list`. The plugin's second tool, `i18n_translations_get`, is marked `surfaces: ['copilot']` because it reports a draft sibling's status                                                                                                                                                                                                                                              |
| packages/mcp/server/AGENTS.md, “The shape”                                      | A tree of three subfolders: `types/`, `http/`, `protocol/`                                                                                            | `src/lib` also contains `mcp.module.ts`, `mcp.tokens.ts` and `utils/mcp-plugin.ts` — that is, the module, the DI tokens and the plugin factory itself are not shown in the diagram                                                                                                                                                                                                                                                |
| .env.example (the repository root)                                              | Only `MCP_ENABLED` is documented                                                                                                                      | `MCP_CALL_TIMEOUT_MS` and `MCP_MAX_RESULT_BYTES` are **absent** from the file, even though the package's `AGENTS.md` names them and `ortha.config.ts` reads them. Meanwhile the scaffolder's template (`packages/create-ortha-app/templates/default/env.tmpl`) contains both variables — so a generated application is documented better than the repository itself                                                               |
| docs/adr/0006, docs/adr/0007                                                    | Both records are in status **Proposed**                                                                                                               | The decisions were implemented long ago and are covered by e2e: the endpoint is live, the registry has moved to `tools-server`, the `surfaces` field is checked at startup. The status misleads a reader looking for “what already exists”                                                                                                                                                                                        |
| docs/adr/0006, §3 and the table in 0007                                         | The DI tokens `TOOL_PROVIDER` and `COPILOT_TOOL_PROVIDER` are mentioned                                                                               | The tokens do not exist: Nest has no multi-provider token, so registration is a **call** to `toolRegistry?.register(this)` from `onModuleInit`. In 0007 this is presented as historical context, in 0006 as a design decision                                                                                                                                                                                                     |
| packages/segments/server/src/lib/tools/segments-tool.provider.ts, `resolveType` | The rule from `tools/server/AGENTS.md`: “Throw `HttpException` subclasses, **not bare `Error`s**”                                                     | **A divergence in behaviour, not in text.** The method throws a bare `new Error('Unknown content type …')`. For MCP that means a typo in `typeName` on `content_access_get` / `content_access_set` reaches the model as an opaque `500` / `internal_error` “The tool failed unexpectedly. See the server logs”, instead of the `404` the model could have fixed itself. Plus every such typo writes a stack to the log as a “bug” |
| mcp-auth.service.ts `bearerFrom` vs. api-token.guard.ts `bearerFrom`            | `AGENTS.md`: “the **same three rules** `/api/v1/*` applies, restated for a non-Nest call site”                                                        | **The two doors parse the header differently.** The REST guard glues everything after the scheme back together (`rest.join(' ')`), MCP requires exactly one value. The outcome for the client is a `401` either way, but for a different reason: MCP rejects the header as malformed and never touches the database, while REST hashes and looks up an invented token. A low-severity divergence, but it is not “rule for rule”   |

> **What is worth fixing first**
>
> Of the list above, only the **bare `Error` in `segments-tool.provider.ts`** genuinely affects behaviour: it turns a correctable model error into an opaque `500` and litters the logs with stacks over an ordinary typo. The rest is text, but the contradiction inside `packages/mcp/server/AGENTS.md` (items 3 and 4) is especially costly: agents read that file, and it says the exact opposite of itself about who owns the registry.

---

**One of the series.** Written for the `packages/mcp/server` package on the skeleton of the pilot `identity` dossier: business description → composition → permissions → tool catalogue → data → lifecycle → scenarios → API → admin UI → configuration → security → invariants → checklist → boundaries → divergences. The sections the plugin does not have stay honestly short: it has zero tables, zero migrations and no admin package — and the “Data model” section explains why that is the design rather than a gap. One section absent from the template was added — the **tool catalogue**: for this package that _is_ the subject matter, because the package itself writes not a single tool.

The source is the source code: the whole of `packages/mcp/server/src/**`, the registry in `packages/tools/server/src/lib/*`, the public API's guards and DTOs in `packages/content/server/src/lib/public-api/**`, the tool providers in `content`, `media`, `i18n` and `segments`, the token scope mapping in `packages/identity/server/src/lib/api-tokens/domain/api-token-scope.ts`, the host's configuration in `apps/server/ortha.config.ts`, plus the package's unit suites and the wire-level e2e `apps/server-e2e/src/server/mcp/mcp.spec.ts` and `apps/server-e2e/src/server/tools/tool-registry.spec.ts`. `docs/adr/0006-cms-as-an-mcp-server.md` and `docs/adr/0007-one-tool-registry-two-surfaces.md` were read. The `AGENTS.md` files were used as a skeleton, but every statement was checked against the implementation — the divergences are collected in section 15.
