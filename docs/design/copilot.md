# Copilot — design

The AI partner inside the admin: a chat that can find, export, create and edit
content, running on whatever model the operator points it at, able to do exactly
what the signed-in person is allowed to do.

> ## Naming: the product is **Ortha AI**, the code is `copilot`
>
> Every string a user reads says **Ortha AI** — the panel title, the sidebar
> launcher, the empty state, the error frames, and how the model introduces
> itself. Everything a user does not read keeps the `copilot` name: the packages
> (`@orthacms/copilot-*`), the routes (`/api/copilot/runs`), the permission
> keys (`copilot:use`), the tables
> (`copilot_conversations`, …), the i18n message ids (`copilot.panel.title`),
> and this document.
>
> **This mismatch is deliberate — please don't "fix" it.** Renaming the code
> would mean a breaking API change, a table-rename migration, and a
> permission-key migration that is genuinely awkward: `seedSystemRoles` is
> idempotent with `ON CONFLICT DO NOTHING`, so the old keys would linger and
> every role grant would need re-pointing. None of that buys a user anything.
> If the product name ever needs to reach the code, it deserves its own change
> with its own migration, not a rename bundled into a feature.

This document is the working reference for building it. Two decisions are
settled in ADRs and are not re-argued here:

- [ADR-0004](../adr/0004-model-agnostic-copilot-provider.md) — how we reach a
  model (the provider port, adapters, capability degradation, runtime config).
- [ADR-0005](../adr/0005-copilot-authority-model.md) — what the copilot may do
  (capability profile, propose-then-apply, untrusted content).

**Status:** in progress. **Phases 0, 1 and 3 have shipped** (§9), plus
**skills** (§11), which is not one of the six phases — it arrived from use
rather than from this plan. Phase 0 landed the
`ModelProvider` port and registry, the three adapters, `plugins.copilot`, the two
permission keys, and an empty plugin in both hosts. Phase 1 landed the chat
vertical slice: the SSE run route, the bounded run engine, the capability
profile, conversation persistence, the read-only content tools, and the chat
panel. Phase 2 (export) is the next buildable slice.

---

## 1. Why this fits the codebase

A copilot is only as good as the structured surface it can act on. Ortha already
has the pieces that make one tractable, which is why this is an additive plugin
rather than a re-platform:

- **A self-describing content model.** Content types are code-defined and
  validated at boot; `ContentTypeRegistry` already serialises fields, types,
  required flags, relation targets and the `i18n`/publishable envelope flags.
  Tool JSON Schemas are _generated_ from it, so the model never guesses a field
  name and a schema change updates the tools for free.
- **An authority model to inherit.** RBAC, `WorkspaceGuard` and the activity
  recorder already gate every mutation (ADR-0005).
- **An adapter precedent.** `StorageProvider` + `buildRegistry` + `resolve(ctx)`
  in `media/server` is the exact shape the model provider needs (ADR-0004).
- **Reviewability and async.** `EntryValidationService` and revision history make
  a generated edit diffable and validated; the transactional outbox gives
  at-least-once event delivery for background work — with one caveat in §8.

> `ARCHITECTURE.md` §8 still claims there is no content model. That is stale —
> content types, entries, revisions, media and i18n all shipped. Worth fixing,
> since the copilot's system prompt is assembled from exactly these docs.

## 2. The chat

The primary surface is a persistent chat panel: a **docked window in the
bottom-right corner**, opened from a floating button in that corner, from the
sidebar footer, or with `⌘J` — with threads scoped to a user × workspace. Three
lighter entry points feed the same engine and the same transcript, so work
started inline can be continued in conversation.

**Docked and non-modal, not a drawer.** The useful thing to do with an answer
about your content is act on it — open the entry it named, check a field, run
the filter it suggested. A modal drawer dims the page, traps focus and blocks
every control behind it, so acting on an answer means closing the conversation
first. The docked window sits alongside the page instead: scroll the records
table, click into an entry, keep the thread open beside it. It minimizes to its
title bar (the run keeps streaming) and expands for long answers.

A turn shows:

- **Your message**, plus where you are — workspace, content type, entry,
  selected rows.
- **Its work, as it happens.** Each tool call renders as a collapsed step
  (`searched articles · 12 results`), expandable to the exact input and output.
  No invisible actions.
- **Its answer**, streamed as markdown.
- **Any change, as a card.** A proposed edit is a per-field diff with
  Accept/Reject; an export is a download with its row count and the filter that
  produced it.

**Entry points**

| Surface         | Where                                          | What it does                                                                                                                                                           |
| --------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat panel      | Floating corner button, sidebar footer, `⌘J`   | The full conversation. All enabled tools. A model picker over `GET /api/copilot/models` chooses the backend **per turn**, so a thread can start cheap and escalate.    |
| ⌘K palette      | `COMMAND_SLOT`                                 | Natural language → the _existing_ list filters via `query-builder-admin`'s `FilterField`s. The model emits a filter object, not SQL; the user sees the chips it chose. |
| Entry editor    | `ENTRY_MENU_SLOT`, `ENTRY_SIDEBAR_WIDGET_SLOT` | Tighten copy, write the SEO description, suggest relations, translate. Field-level diffs accepted individually.                                                        |
| Records toolbar | `RECORDS_TOOLBAR_SLOT`                         | Export by description — the copilot builds the filter and column set, reports the row count, streams a file.                                                           |

Background work (phase 5) produces proposals that land in your chat as pending
cards; it never edits live.

## 3. Packages

Six new packages, no host edits. Layered per
[ADR-0003](../adr/0003-tactical-ddd-inside-plugins.md): `domain / application /
infrastructure / http`, with `domain/` importing no framework — so the tool
contracts, capability profile and run state machine are testable without Nest,
React or a model.

| Package                      | Owns                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `copilot/domain`             | Run state machine, message/tool-call value objects, `ToolSpec`, `ModelProvider`, capability profile, proposal types. No framework imports.                      |
| `copilot/server`             | `CopilotPlugin()`, run engine + tool loop, tool registry, MCP client, SSE controller, provider registry, schema + migrations, the `COPILOT_TOOL_PROVIDER` port. |
| `copilot/admin`              | Chat panel, streaming transport, proposal diff UI, model/connector settings, slot contributions.                                                                |
| `copilot/provider-anthropic` | Adapter over `@anthropic-ai/sdk`.                                                                                                                               |
| `copilot/provider-openai`    | Configurable base URL — Ollama, vLLM, LiteLLM, OpenAI, Azure, OpenRouter.                                                                                       |
| `copilot/provider-fake`      | Scripted provider for e2e. A private test fixture — never published, never registered by a host.                                                                |

**Tool bindings live with their owners.** Content tools ship in
`content/server`, media tools in `media/server`, and so on — each a small
addition to a package that already holds the service it wraps.

## 4. Extension: two ways to add a tool

### Inside the repo — the DI port

`copilot/server` must not import `content-server`, `media-server` or
`i18n-server`; that would put the copilot at the bottom of the package graph.
Instead it declares a port and each plugin binds its own tools, the same
inversion as `CONTENT_ENTRY_EXTENSION`:

```ts
/** One capability the copilot may invoke on the user's behalf. */
export interface ToolSpec<I = unknown, O = unknown> {
    name: string; // 'admin_content_search'
    description: string; // shown to the model
    inputSchema: JsonSchema; // generated from the content registry
    permissions: PermissionKey[]; // ALL must be held by the caller
    effect: 'read' | 'propose' | 'apply';
    run(input: I, ctx: ToolContext): Promise<O>;
}

/** Bound by content-server, media-server, i18n-server, activity-server, … */
export const COPILOT_TOOL_PROVIDER = Symbol('COPILOT_TOOL_PROVIDER');
```

`ToolContext` carries the authenticated user, the active workspace, the unit of
work and the run id — so a tool cannot execute outside a caller's scope even by
mistake. Any future plugin gets copilot support by binding this port; the
copilot never learns a new import.

### Outside the repo — MCP connectors

For third-party systems (a DAM, analytics, an issue tracker, a translation
memory) `copilot/server` runs an **MCP client**. An admin registers a connector;
its tools are discovered at connect time and merged into the catalogue. Rules
are in ADR-0005 §8: namespaced, permission-mapped by the installing admin,
treated as untrusted text, and failing in isolation — a connector timeout
degrades that run's catalogue, it never fails the chat.

## 5. Request flow

A bounded loop: call the model, execute the tools it asks for, feed results
back, stop on a final answer or a ceiling. Steps 5–8 repeat.

1. **`POST /api/copilot/runs`** — conversation id, message, surface context.
   `AuthGuard` + `OriginGuard` + `@RequirePermissions('copilot:use')`.
2. **Resolve the capability profile** — permissions × membership × workspace
   policy → this run's tool set. Everything downstream reads from it.
3. **Persist the turn, open the SSE stream.** The user message is written first,
   so a dropped connection never loses it.
4. **Assemble context** — system prompt + content-type _summaries_ for this
   workspace + surface context + trimmed history, fitted to the provider's
   context window. Full field schema is fetched on demand via
   `admin_content_types`, not inlined. Content bodies arrive only through tool
   results, fenced as untrusted data.
5. **Model call**, streamed through the provider chosen by `resolve(ctx)`. Text
   deltas forward immediately; tool-use blocks are collected. Without native
   tool support, the constrained JSON protocol runs instead (ADR-0004 §4).
6. **Authorize each tool call** — in this run's profile, permissions re-verified
   against a live session, input valid against the generated schema. Any failure
   returns a tool error to the model: the run continues, the violation is logged.
7. **Execute** against the same use-cases the HTTP controllers call, inside a
   `UnitOfWork`. Writes produce a proposal unless workspace policy allows direct
   apply. Every call is audited in the same transaction.
8. **Feed results back** — bounded by max steps, wall clock and a per-run token
   ceiling; exceeding one ends the run with a reason the UI shows.
9. **Finalize** — persist the assistant message, tool calls, tokens and cost;
   emit `copilot.run.completed`; the client invalidates affected query keys.

## 6. Tool catalogue (v1)

`read` runs freely; `propose` produces a reviewable change; `apply` writes
directly and is off unless workspace policy enables it (ADR-0005 §6).

| Tool                            | Bound by  | Requires                            | Effect          |
| ------------------------------- | --------- | ----------------------------------- | --------------- |
| `admin_content_types`           | content   | `content:read`                      | read            |
| `admin_content_search`          | content   | `content:read`                      | read            |
| `admin_content_get`             | content   | `content:read`                      | read            |
| `admin_content_revisions`       | content   | `content:read`                      | read            |
| `admin_content_diff`            | content   | `content:read`                      | read            |
| `content.exportEntries`         | content   | `content:read`                      | read            |
| `i18n_locales_list`             | i18n      | `content:read`                      | read            |
| `i18n_translations_get`         | i18n      | `content:read`                      | read            |
| `content_propose_create`        | content   | `content:create`                    | propose         |
| `content_propose_update`        | content   | `content:update`                    | propose         |
| `content_propose_bulk_save`     | content   | `content:create` + `content:update` | propose         |
| `i18n_propose_translation`      | i18n      | `content:update`                    | propose         |
| `i18n_propose_bulk_translation` | i18n      | `content:update`                    | propose         |
| `media_assets_search`           | media     | `media:read`                        | read            |
| `media_propose_alt_text`        | media     | `media:update`                      | propose         |
| `activity_recent`               | activity  | `activity:read`                     | read            |
| `workspace_members_list`        | users     | `users:read`                        | read            |
| `mcp.<connector>.*`             | connector | as mapped by admin                  | read by default |

Because the profile is derived from `SYSTEM_ROLES`, the practical effect is:

| The copilot can…               | Viewer | Contributor | Admin |
| ------------------------------ | :----: | :---------: | :---: |
| Answer questions about content |   ✔   |     ✔      |  ✔   |
| Search & filter entries        |   ✔   |     ✔      |  ✔   |
| Export what you can read       |   ✔   |     ✔      |  ✔   |
| Draft & edit entries           |   —    |     ✔      |  ✔   |
| Translate into other locales   |   —    |     ✔      |  ✔   |
| Write alt text on assets       |   —    |     ✔      |  ✔   |
| Read the activity log          |   —    |      —      |  ✔   |
| Configure models & connectors  |   —    |      —      |  ✔   |

**Two tools the first draft of this table didn't have.** `admin_content_revisions`
is what makes `admin_content_diff` reachable — a diff needs two version
numbers, and nothing else tells the model which exist. `i18n_locales_list` is
what makes `admin_content_search`'s `locale` usable: locale slugs are
deployment configuration, so without it the model either omits `locale` and
silently searches the default language or guesses a slug and gets an error.
`i18n_translations_get` follows, since "which article is missing a German
version?" is the question a localized CMS is actually asked.

**`activity_recent` is deployment-wide, not workspace-scoped.** `activity_events`
has no workspace column — the trail records invites, role changes and workspace
lifecycle alongside content edits, several of which belong to no workspace at
all. So there is nothing to scope by; what bounds the tool is `activity:read`,
admin-only, withheld at offer time from everyone else. Its description says
which scope it covers rather than implying a boundary it cannot enforce.

**Export deserves care.** `content.exportEntries` takes a filter, column set and
format (JSON/CSV/Markdown) and streams through a download route
(`media/server`'s `download-asset.controller` is the streaming precedent). It is
a read tool, but the one that moves the most data at once: show the row count
before producing the file, cap the export, resolve relation and media fields to
human-readable labels rather than raw ids, and write an activity row naming the
filter.

**New permissions.** `copilot:use` (admin + contributor, and viewer — see §10).
`copilot:configure` was added and then removed: it gated the per-workspace
auto-apply policy, which
[ADR-0009](../adr/0009-copilot-applies-directly.md) deleted. Re-add it if the
runtime model registry of ADR-0004 §5 lands.

## 7. Data model

`copilot/server` ships its own `drizzle.config.ts` and committed migrations
(`nx run copilot-server:db:generate --name=…`; applied by the host's
`db:migrate`).

| Table                   | Holds                                                                       | Notes                                                                       |
| ----------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `copilot_conversations` | Thread per user × workspace, title, surface, archived flag                  | FKs to identity `users` and workspaces                                      |
| `copilot_messages`      | Ordered turns: role, content blocks, model id, finish reason                | Append-only — the transcript for replay and audit                           |
| `copilot_tool_calls`    | Tool name, input, redacted output, duration, error                          | What actually touched data; the security-review surface                     |
| `copilot_proposals`     | Target (type, entry, locale), patch, status, applied by/at                  | The receipt for every change; applying runs the ordinary update use-case    |
| `copilot_model_configs` | Adapter kind, base URL, model id, encrypted credential, probed capabilities | Runtime provider registration (ADR-0004 §5); secrets never leave the server |
| `copilot_connectors`    | MCP endpoint, auth, enabled workspaces, per-tool permission mapping         | Admin-managed; disabled by default                                          |
| `copilot_usage`         | Per run: input/output tokens, cost, provider, model                         | Backs quotas and the cost panel                                             |
| `copilot_skills`        | Workspace-authored instruction packets: name, description, body, mode       | The CMS half of §11; code-defined skills have no row                        |

Phase 5 adds `copilot_embeddings` (entry, locale, chunk, vector), which needs
the `pgvector` extension — a deployment change, not just a migration, and the
reason semantic retrieval is last.

## 8. What we still have to build

The plugin seams are ready; the streaming and model plumbing is not.

| Capability                | Today    | What's needed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model port & adapters     | none     | No LLM dependency in `package.json`. The port copies `StorageProvider` + `buildRegistry`, so the shape is settled; the adapters and streaming normalisation are the work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Streaming transport       | **done** | `SseStream` (Nest) + `streamRun` (admin). The `fetch` transport replicates `apiClient`'s credentials and `X-Workspace-Id` rather than changing it, as planned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Runtime provider config   | none     | All config is env-only via `ortha.config.ts`. First DB-persisted settings and first encrypted-secret-at-rest in the codebase; needs a key in config and a rotation story.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| MCP client                | none     | Connection lifecycle, tool discovery, namespacing, permission mapping, timeouts, untrusted-text handling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Tool-schema generation    | partial  | `SerializedContentType` has everything needed; a `registry → JsonSchema` mapper (and round-trip tests) does not exist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Export                    | partial  | No content export exists. Streaming CSV/JSON writer, label resolution, row caps, audited download route.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Long-running work         | partial  | **`OutboxDispatcher.drain()` runs every subscriber inside one transaction.** A multi-second model call in a subscriber would hold that transaction and its row locks open for the whole batch. Background AI must enqueue a job row and let a separate worker do the model call — or the dispatcher must learn to hand off outside the tx.                                                                                                                                                                                                                                                                                                                                         |
| Cost & quota              | none     | Token accounting, per-workspace caps, per-user rate limiting. `@nestjs/throttler` is already in the lockfile via identity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Chat UI primitives        | partial  | Phase 1 shipped streaming text, message bubbles, tool-step disclosure and a small local markdown renderer (React elements only, never `dangerouslySetInnerHTML`). Still missing: the field-level proposal diff (`revisionDiff` is the starting point), needed at phase 3.                                                                                                                                                                                                                                                                                                                                                                                                          |
| Deterministic tests       | partial  | `server-e2e` now covers the whole loop over the fake provider — guards, the strict pipe, the stream, the tool loop, the capability profile, the content tools. `admin-e2e` now covers **both copilot surfaces** end to end (`src/copilot/`) — the Agents view and the docked panel's window chrome: `page.route` _can_ fulfil an event-stream body, so only progressive arrival is lost, not the transcript or its block order. Remaining gap: the panel's **history dropdown bypasses the one-window-per-thread guard** (it sits on the reducer's `open` action; the picker loads straight into the chat and reports the id as `meta`), so two windows can hold one conversation. |
| Prompt versioning & evals | partial  | `SYSTEM_PROMPT_VERSION` exists and is bumped with the prompt text. The offline eval set that would give it teeth does not — a prompt edit is still reviewed by reading it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Localized output          | **done** | The run DTO carries `uiLocale` (an app preference, not `Accept-Language`) and the system prompt instructs the model to answer in it regardless of the content's language. Translation targeting arrives with the phase-4 translation tool.                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## 9. Roadmap

Six phases; each after phase 1 is independently shippable.

**Phase 0 — Foundations. ✅ Shipped.** `ModelProvider` port + registry, the three
adapters, `plugins.copilot` config, `copilot:use`, empty
plugin registered in both hosts. _Ships nothing visible; unblocks everything._
Four things landed differently from the sketch above, all deliberate and all
detailed in the package `AGENTS.md` files:

- The port carries **no sampling parameters** — current frontier models reject
  `temperature`/`top_p`/`top_k` outright.
- The Anthropic adapter leaves **thinking at the API default** rather than
  disabling it: with thinking off, a model will occasionally write a tool call
  into its visible text, where it silently never runs.
- **A provider serves a list of models**, not one. `models()` is part of the
  port and `ModelRegistry.catalogue()` enumerates every provider × model pair,
  so a user can switch model mid-conversation, and the picker opens on the
  first pair rather than on an abstract "Default". An operator changes what is
  on offer, and which backend is the house default, by changing the registered
  list — there is no `defaultProvider` setting beside it to keep in step.
- **`CopilotPluginConfig` names no adapter.** Provider connection settings live
  with the host, so `copilot/server` depends only on `copilot-domain` and
  `bootstrap-server`. Adding a Bedrock adapter is a package plus a line in
  `plugins.ts` — what ADR-0004 §2 actually asked for. The first cut had the
  config importing both adapter packages for their types.

**Phase 1 — Chat (the vertical slice). ✅ Shipped.** SSE endpoint, run engine,
capability profile, conversation persistence, the read-only content tools, the
chat panel. Server-e2e over the fake provider, including the viewer-can't-write
case. _Ships: conversational search over your own content._

Five things landed differently from the sketch above, all deliberate:

- **`COPILOT_TOOL_PROVIDER` and `ToolSpec` both live in `copilot/domain`**, not
  in `copilot/server` as §3/§4 have it. The port exists so `copilot/server`
  never imports `content-server`; putting the token in the server would just
  invert that, forcing every tool binder to import the server. This is the same
  call phase 0 made for `MODEL_REGISTRY`, for the same reason.
- **Tools register at runtime, not by multi-provider binding.** Nest cannot
  merge a multi-provider token across independent dynamic modules, and every
  plugin here is one — a second binder would silently replace the first.
  Binders inject `CopilotToolRegistry` from their own `OnApplicationBootstrap`
  and call `register(...)`, the precedent `OutboxDispatcher.register` set.
- **`AccessPolicy` was not exported from `identity-server`** as ADR-0005's
  follow-up list anticipated. The capability profile is a pure function in
  `copilot/domain`, which imports nothing — so it cannot reach a class that
  lives behind a Nest package's barrel. The set-membership rule is therefore
  restated in `resolveCapabilityProfile`, in ten lines with an exhaustive unit
  test. Exporting `AccessPolicy` with no consumer would have been dead code.
- **Tool-input validation is a hand-written JSON Schema subset**
  (`validateToolInput`), not a schema library. It covers what the generated
  schemas use and ignores what it doesn't know — sound because it is defence in
  depth behind the capability profile, not the security boundary.
- **The panel reads its workspace from the route, not from
  `useCurrentWorkspace()`.** `CurrentWorkspaceProvider` wraps only the workspace
  shell's inset; the app sidebar — where the launcher lives — renders outside
  it, and the hook _throws_ there rather than returning null.

Two dependencies the readiness table did not budget for were **not** taken:
markdown rendering is a small local renderer building React elements (never
`dangerouslySetInnerHTML`), and JSON Schema validation is the subset above.
Both are documented at their call sites with the upgrade path.

**Phase 2 — Export.** Streaming CSV/JSON/Markdown with label resolution, row
caps and audit; `content.exportEntries`; the records-toolbar entry point.

**Phase 3 — Create & edit. ✅ Shipped, then simplified.** `copilot_proposals`,
the four propose tools, the applier port and the field-level diff card in the
transcript are in. What shipped alongside them and has since been **removed** —
`copilot_workspace_policies`, the accept/reject routes, the per-workspace
auto-apply policy and its settings page — is the subject of
[ADR-0009](../adr/0009-copilot-applies-directly.md): a change now applies the
moment it is drafted, gated only by the caller's own permissions, and the card
is a receipt rather than a decision. The entry-editor entry points are the one
piece left, and they are an entry point rather than a capability.

Three things landed differently from the sketch above:

- **A propose tool's return value IS the change**, and the _engine_ persists it
  — not the tool. So ADR-0005 §5's guarantees live in one place instead of once
  per binder: every proposal is recorded whether or not a human clicks, which is
  what makes an auto-applied change "undoable, never invisible".
- **Applying is a second inverted port** (`ProposalApplier`, bound by the plugin
  that owns the data), because `copilot/server` cannot know how to write a
  content entry any more than it can know how to read one. Its whole contract is
  "run the ordinary use-case".
- **Auto-apply is not a separate `effect: 'apply'` tool.** One tool declares
  `propose`, and the workspace policy decides whether a human must accept — so a
  team opting alt text in gets the same code path, the same row, and the same
  audit trail, with the click removed. `effect: 'apply'` stays in the vocabulary
  for a hypothetical tool that is only meaningful as a direct write; nothing
  declares it today.

**Phase 4 — Configure & connect.** Runtime model settings with encrypted secrets
and connection testing; MCP connector registration with permission mapping; ⌘K
natural language → filters; translation tool.

**Phase 5 — Background & retrieval.** Job runner outside the outbox transaction,
background alt text and translation drafts, `pgvector` embeddings with backfill,
cost dashboard and quotas. _Requires a deployment change; deferrable
indefinitely._

Phases 0–4 deliver the whole product statement. Phase 5 is optional.

### Readiness — verified, nothing blocks a start

| Needed for phase 0–1            | State      | Evidence                                                                                                                                                                                                          |
| ------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Register a new plugin           | ready      | `ServerModule.forRoot` imports whatever the plugin list holds — one line in `plugins.ts`, one in `main.tsx`.                                                                                                      |
| Call content logic in-process   | ready      | Logic already lives in injectable services: `EntriesService.list(type, query, workspaceId)`, `EntryWriterService.update(type, id, values, workspaceId, relations, userId)`. Tools are thin wrappers; no refactor. |
| Resolve permissions in code     | ready      | `PermissionsService.forRole(roleId)` + the pure `AccessPolicy.canAll(actor, …)`. The capability profile is ~20 lines on top.                                                                                      |
| Add the new permission keys     | ready      | **No migration** — `seedSystemRoles` is idempotent and runs each boot from `PERMISSIONS` / `SYSTEM_ROLES` (`ON CONFLICT DO NOTHING`).                                                                             |
| Own tables & migrations         | ready      | `@orthacms/nx` infers `db:generate` from a `drizzle.config.ts`; the host's `db:migrate` reads `plugins.ts`.                                                                                                       |
| Stream a response               | clear path | `createServer` adds only a global prefix and `ValidationPipe` — no compression or global interceptor to buffer a stream. Node 22 gives native `fetch` server-side.                                                |
| Export `AccessPolicy` / `Actor` | not needed | Superseded in phase 1 — the profile rule is a pure function in `copilot/domain`, which imports nothing and so cannot reach a class behind a Nest barrel. See the phase-1 notes above.                             |
| New npm dependencies            | two        | `@anthropic-ai/sdk` now; `@modelcontextprotocol/sdk` at phase 4. **Still two after phase 1** — markdown rendering and JSON Schema validation were written locally rather than pulled in.                          |

**MCP is an output, not an input.** It exists in this design so _operators_ can
attach their own systems (§4). Phases 0–3 ship with no MCP involved.

**Three things to confirm with a short spike before the engine is written.**
All three were run before phase 1's engine was written; each is now a permanent
test rather than a throwaway script.

1. **SSE through the Vite dev proxy. — Confirmed.** Measured against a real
   origin behind the real dev server: frames arrive one at a time with the same
   timing as a direct connection (7 chunks, ~1793ms spread either way, ~10ms of
   proxy overhead), on **POST as well as GET**. POST matters, because the turn
   has a body and `EventSource` cannot send one. The same question still applies
   to whatever reverse proxy fronts production; `Cache-Control: no-transform`
   and `X-Accel-Buffering: no` are set for it.
    - **The spike's own bug is the durable lesson:** `req.on('close')` fires the
      moment the request body is fully consumed — which is _always_ true by the
      time a Nest handler runs — while the client is still connected and waiting.
      Wiring the abort to it cancels every run instantly, and because
      `writeHead` hasn't flushed, it presents as a request that hangs with no
      response rather than as an error. Client-disconnect detection must hang off
      `res`. See `SseStream.onClientDisconnect`.
2. **The strict global pipe. — Confirmed, with a sharper edge than expected.**
   `forbidNonWhitelisted: true` 400s an undeclared key by name, which is the
   behaviour we want. The trap is **nested** objects: without `@ValidateNested()`
    - `@Type()`, `context` is not traversed as a DTO at all — its properties are
      stripped by the whitelist and the handler silently receives `{}`, with no
      error anywhere. Covered by two e2e cases, one of which asserts the nested
      context reaches the system prompt intact.
3. **Guard composition. — Confirmed.** Only `AuthGuard` is global (`APP_GUARD`);
   `PermissionsGuard`, `OriginGuard` and `WorkspaceGuard` are per-controller
   decorators, applied explicitly on every copilot route. Each is covered by its
   own e2e case (401 / 403-no-permission / 403-cross-origin / 400-no-workspace /
   403-non-member), because forgetting `WorkspaceGuard` would not fail loudly —
   it would run every tool against an unvalidated, client-supplied workspace id.

## 10. Open questions

Settled enough to start phase 0; decide before the phase that needs them.

- **How much schema goes in the system prompt?** A workspace with fifty content
  types would blow the budget if every field were inlined. Current plan: type
  summaries in the prompt, full schema on demand via `admin_content_types` — one
  extra round trip, bounded cost. Revisit with real workspaces.
- ~~**Does `copilot:use` extend to viewers?**~~ **Decided: yes.** A read-only
  copilot is useful and, by construction, cannot mutate — a viewer's runs are
  offered only the tools that viewer's own permissions already allow. Cost is
  handled with per-role rate limits rather than a role exclusion. Granted in
  `SYSTEM_ROLES` as of phase 0. `content:publish` stays withheld at every role
  (ADR-0005 §7), and direct-apply remains an admin opt-in (§6).
- **SSE or websockets?** SSE is the smaller change and enough for token
  streaming. Websockets only earn their cost if presence or server-initiated
  notifications follow. Revisit at phase 5.
- **Who owns proposals — copilot or content?** Current plan: copilot owns the
  table, content exposes an _apply_ use-case, so content stays ignorant of where
  a patch came from — which also lets a future human-authored suggestion reuse
  it.
- **Is there a headless surface?** `api-tokens` already mints workspace-scoped
  bearer tokens; exposing runs to them turns the copilot into an automation
  endpoint with a much larger blast radius. Not in v1.

## 11. Skills

Settled in [ADR-0010](../adr/0010-copilot-skills.md) and shipped. **Not one of
the six phases** — it came from watching people paste the same instructions into
the message box, once per question.

A skill is a named instruction packet with a description of when it applies:
house style, the checklist before a page is published, how a release note is
written. Seven fields, and the one that matters is the split between
`description` — short, and in the prompt for every enabled skill — and
`instructions`, the body, which reaches the model only when the skill is
actually in force. That is the same trade §10 settles for content types.

**Two sources, one catalogue.** An operator declares skills in code
(`CopilotPlugin({ skills })`), validated at construction like the provider list
and available in every workspace; an admin authors them in the CMS, scoped to
one workspace, from a page at `/workspaces/:id/agents/skills`. `mergeSkills`
combines the two with code winning a name collision, and the write routes refuse
a colliding name up front rather than letting the merge drop a row somebody just
saved.

**Three channels, all of them the system prompt.** `always` skills apply to
every run in their workspace; attached ones to that turn; everything else
appears as `name — description` so the model can recommend a skill it was not
given. There is deliberately **no tool** that loads a skill: the engine fences
every tool result as untrusted data, and a skill body is the opposite of that.
Automatic selection, when it lands, is a server-side pre-pass before the first
model call rather than a second trust channel — see the ADR.

**The client sends names.** `CreateRunDto.skills` is `[{ name }]`, capped at
`MAX_RUN_SKILLS`, resolved against the workspace's catalogue. A request that
could carry instruction text would let anyone with `copilot:use` write their own
system prompt, which is the sharper version of the reason attachments carry ids
only. An always-on skill never appears in the request at all — the server
applies it regardless, so naming it would be the client asserting a decision
that is not its own.

**Authoring is admin-only** (`copilot:skills:manage`, new in `PERMISSIONS`,
no migration). Using a skill needs nothing beyond `copilot:use`. That asymmetry
is the whole authority story: writing a skill writes prompt text that runs for
every member of the workspace, so it is configuration rather than content.

**In the UI** the composer grows a skills button beside the paperclip, opening a
filterable picker; staged skills render as chips above the field, always-on ones
with a lock rather than an `×`. The selection lives on the chat session — like
the model choice, and for the same reason it was moved there — and is seeded
into the next chat, because leaving the Agents view _closes_ an idle chat and
the selection would otherwise vanish silently. Every turn records the skills it
ran under (`copilot_messages.skills`), and the transcript draws them, so a
thread read back says what shaped it.

**Two things this does not do**, both deliberate: a skill cannot narrow or widen
the tool offer (one authority mechanism, not two), and a skill is not versioned
— the transcript snapshots the name, not the body a turn ran with.
