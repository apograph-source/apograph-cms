# Copilot

_Package group · packages/copilot_

**Apograph AI — an assistant that acts on a person's behalf and never on its own**

Copilot is a chat inside the admin UI that can read and **change** content. The decision that shapes the whole group: the assistant has **no identity of its own and no permissions of its own**. A run executes as the calling user, so an observer's copilot physically has not one write tool. The model is a swappable backend behind a port: the kernel does not know which adapters exist and imports not one vendor SDK.

- **6** packages in the group
- **3** model adapters
- **15** HTTP routes
- **5** database tables
- **7** migrations
- **21** tools
- **8** write tools
- **8** SSE event types
- **2** permission keys
- **2** interface surfaces

## Contents

- [01. Business description](#01-business-description)
- [02. Composition of the package group](#02-composition-of-the-package-group)
- [03. The model-provider matrix](#03-the-model-provider-matrix)
- [04. The agent's authority model](#04-the-agents-authority-model)
- [05. Tools: one registry, two surfaces](#05-tools-one-registry-two-surfaces)
- [06. Data model](#06-data-model)
- [07. A run's lifecycle and its bounds](#07-a-runs-lifecycle-and-its-bounds)
- [08. Scenarios — how it works, step by step](#08-scenarios-how-it-works-step-by-step)
- [09. HTTP API](#09-http-api)
- [10. The admin UI: two surfaces over one chat](#10-the-admin-ui-two-surfaces-over-one-chat)
- [11. Configuration](#11-configuration)
- [12. Security: what was done and why exactly that way](#12-security-what-was-done-and-why-exactly-that-way)
- [13. Invariants](#13-invariants)
- [14. Testing checklist](#14-testing-checklist)
- [15. Boundaries of responsibility](#15-boundaries-of-responsibility)
- [16. Where the code and the documentation diverge](#16-where-the-code-and-the-documentation-diverge)

## 01. Business description

Copilot is a chat assistant inside the Apograph admin UI. The product name is **Apograph AI**; in the code everything is called `copilot` (the packages, the routes, the tables, the permission keys, the i18n message ids). The divergence is **deliberate** and recorded in the header of `docs/design/copilot.md`: renaming the code would mean a breaking API change, a table-rename migration and — worst of all — a permission-key migration, and `seedSystemRoles` is idempotent with `ON CONFLICT DO NOTHING`, so the old keys would be left hanging.

### The problem it solves

- **An assistant that actually does things.** It does not merely search and explain but creates entries, edits fields, translates, writes alt text, uploads files. All of it through the same use cases as an ordinary form in the interface.
- **The model is the operator's choice, not ours.** Apograph is installed on your own hardware, and “where does a workspace's content go” is decided by whoever installs it. Hence the `ModelProvider` port and two adapters: native Claude and any OpenAI-format endpoint (Ollama, vLLM, llama.cpp, LM Studio, LiteLLM, OpenRouter, Azure, OpenAI itself). Local inference is a _setting_, not a fork.
- **Zero new authority.** A run executes as the signed-in person. An observer is offered not one write tool — and that is a **unit test**, not a promise. A successful prompt injection gives an attacker nothing beyond what the user could already do themselves.
- **Asking at the moment of the action, not afterwards.** A write not yet allowed in this branch **stops the run** and shows the person the call's arguments before anything happened. The answer is “once”, “in this chat”, or “do not allow”.
- **Every change leaves a receipt.** A `copilot_proposals` row is written _before_ the write and survives whether or not the write succeeded.

### Who sees it

#### The editor

Asks the panel about the page they are standing on, or goes into the full-screen “Agents” view for longer work. They can ask for something to be created, rewritten or translated — and will see a receipt card for every change.

#### The observer

The same chat, but **read-only**. They are shown no write tools, so the model does not know about them and cannot propose them: the MAKING CHANGES section of the system prompt is not assembled for them at all.

#### The administrator

Additionally manages **skills** — reusable instruction bundles that become part of the system prompt for the whole workspace. The `copilot:skills:manage` permission.

### What Copilot is not

- **It is not a principal of its own.** There is no service account, no “AI” role, nothing to escalate. The `copilot_proposals.created_by` row is a person.
- **It is not a review queue.** It was one — and ADR-0009 removed it. The `accept`/`reject` routes do not exist, the `copilot_workspace_policies` table was dropped by migration `0002`, and the `copilot:configure` permission was removed from the catalogue.
- **It is not publishing.** ADR-0005 §7: `content:publish` is not exposed as a tool for any role. The copilot prepares a draft, a person presses the button. Verified against the code — there is no publish tool.
- **It is not a tool registry.** The catalogue lives in `@apograph/tools-server` and is shared with the MCP endpoint (ADR-0007). The tools themselves are supplied by the plugins that own the data.
- **It is not a file store.** An attachment to a message is uploaded by an ordinary `POST /api/media/assets` under the user's own session and their own `media:create`; the run receives only an id.

> **The architecture's key idea**
>
> **Authority is decided twice, and both times by the caller's permissions.** At _offer_ time the tool list is filtered before the prompt is assembled, so a tool the model was never told about cannot be requested, argued for or refused at the cost of tokens. At _execution_ time `ToolRegistry.call` re-checks `requires` against a freshly resolved session. Between them stands a third thing, about intent rather than authority: **the question to the user before a write**.

## 02. Composition of the package group

The `packages/copilot` group is six packages. The split is not cosmetic: an adapter has to be able to depend on the port _without_ dragging NestJS and Drizzle along, and the kernel has to be testable without a framework and without a model.

| Package            | npm name                                  | Role                                                                                                                                        | What it owns                                                                                                              |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| domain             | @apograph/copilot-domain                  | The framework-free kernel: the model port, the run vocabulary, the capability profile, the proposal and skill contracts                     | **Zero dependencies** — there is no `dependencies` block in `package.json` at all                                         |
| server             | @apograph/copilot-server                  | The NestJS plugin: the run's SSE route, the bounded engine, the permission broker, the system prompt, skills, the schema and the migrations | 5 tables, 15 routes, 7 migrations                                                                                         |
| admin              | @apograph/copilot-admin                   | The admin plugin: two surfaces over one chat — the docked panel and the full-screen Agents view                                             | The transcript, the composer, the change card, the permission prompt, the skills page                                     |
| provider-anthropic | @apograph/copilot-provider-anthropic      | Native Claude through `@anthropic-ai/sdk`                                                                                                   | **The only package in the repository allowed a vendor SDK**                                                               |
| provider-openai    | @apograph/copilot-provider-openai         | The chat-completions format against a configurable `baseUrl`. No SDK — a `POST /chat/completions` and SSE parsing                           | Ollama, vLLM, llama.cpp, LM Studio, LiteLLM, OpenRouter, Azure, OpenAI                                                    |
| provider-fake      | @apograph/copilot-provider-fake `private` | A scriptable, deterministic provider. **A test fixture only**                                                                               | `"private": true` in the manifest, excluded from the release projects in `nx.json` (`"!@apograph/copilot-provider-fake"`) |

> **Why the fixture provider is registered by no host**
>
> `provider-fake` used to be published and registered in every composition root **unconditionally and last** — on the grounds that a contributor should be able to run the admin UI without a key. The consequence: for any deployment that had configured nothing, it was the _entire catalogue_. A production installation that enabled the copilot and forgot the key answered every question with a canned phrase instead of honestly refusing. Now: a host registers exactly the backends it configured; `CopilotPlugin` accepts an empty list **only while the copilot is disabled** and refuses to assemble an enabled copilot with nowhere to turn. A deployment with no keys has no copilot — instead of a copilot answering out of a tin.

> **Neighbours easily confused with it**
>
> **`@apograph/tools-server`** is the shared tool registry and the _one_ point of call authorization; `copilot/server` **imports** it rather than providing it. **`@apograph/mcp-server`** is the second consumer of that same registry. **`content/server`, `i18n/server`, `media/server`, `activity/server`, `users/server`, `alarms/server`, `segments/server`** — that is where the tools themselves and the change appliers (`ProposalApplier`) live. `copilot/server` imports not one of them.

## 03. The model-provider matrix

The `ModelProvider` port has **three methods**: `models()`, `capabilities(model?)` and `stream(request, signal)`. The surface is deliberately narrow: a third-party abstraction library (LangChain, the Vercel AI SDK) would cost more than it saves — the port fits into roughly one file, while its own abstractions on top of ours and its release cadence would become our churn (ADR-0004, “alternatives”).

| Adapter   | npm name                                  | SDK                            | What it requires in configuration                                                                 | Particulars                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | ----------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| anthropic | @apograph/copilot-provider-anthropic      | `@anthropic-ai/sdk` ^0.115     | `{ apiKey, models, baseUrl?, effort?, maxRetries?, timeoutMs?, promptCaching? }`                  | The client is **lazy** — constructed on first use, so an unused adapter does not fail the boot for an operator with no key. Capabilities are **probed** through the Models API; when it is unavailable, the conservative `FALLBACK_CAPABILITIES` applies (200k context, 8192 output), and a miss **rejects the promise** rather than being cached as an answer. Prompt caching is **on by default**. The `thinking` setting is not passed at all. |
| openai    | @apograph/copilot-provider-openai         | **none** — Node built-ins only | `{ baseUrl, models, apiKey?, headers?, capabilities?, timeoutMs?, maxRetries?, maxTokensField? }` | Capabilities are **declared by the operator** rather than probed: the wire format has no discovery for them. The defaults are optimistic (tool calling, streaming, a 32,768 context). Retries happen only **before the first event**. The output ceiling travels in `max_tokens`; OpenAI's reasoning models require `maxTokensField: 'max_completion_tokens'` — both names cannot be sent.                                                        |
| fake      | @apograph/copilot-provider-fake `private` | none                           | `{ script?, capabilities?, chunkSize?, models? }`                                                 | No network, no clock, no randomness. Two modes: with no `script`, an eternal canned answer; with a `script`, the turns in order, and running past the end **throws**, naming how many turns there were. `calls` is the target of the assertion “an observer's run was offered no write tool”.                                                                                                                                                     |

### Why only one package may import a vendor SDK

ADR-0004 §1 frames it as a rule of the same class as “Drizzle and Nest do not belong in the `domain/` layer”: **the kernel depends on an interface, never on a vendor**. The rule has measurable consequences, and they are properties rather than costs:

- **The capability profile restates set membership** rather than importing `AccessPolicy` from identity, and a tool's input validation is a hand-written subset of JSON Schema rather than a library. Both prices were paid knowingly.
- **The contracts are testable without a framework and without a model.** “An observer is offered no writes” is a unit test over a pure function.
- **A new backend is a package plus a line in `plugins.ts`.** `copilot/server` imports neither an adapter nor its configuration type: the connection settings live with the host, next to the factories that consume them.

> **The stream contract — three normative points**
>
> (1) **Exactly one `done` ends the stream.** A stream without one reads as `stopReason: 'end'` with zero spend and quietly understates the bill; a second one overwrites the first. (2) **An abort ends the stream rather than throwing out of it** — a `done` with `stopReason: 'aborted'`. (3) **An aborted call reports zero spend**, even if text was already flowing: a partial estimate is a guess that enters cost accounting as a fact.
>
> This is not left to the adapters' good will. The domain holds a **conformance suite** — `runModelProviderConformance` and 12 named checks (`exactly-one-done-event`, `abort-mid-stream-reports-zero-usage`, `unknown-model-costs-no-request` and others). The suite returns a **report** rather than throwing assertions — which is how it lives in a package that imports nothing, and how each adapter turns the report into tests in three lines. The suite's own spec runs a knowingly non-conforming provider past one point at a time: a check suite that cannot fail is indistinguishable from an absent one.

### The registry and choosing a backend

- **`providers` is a list, not a map.** Registration order matters: the first entry _is_ the house default, `catalogue()` hands them back in that same order, and two providers of one kind are simply two entries (`ollama-fast`, `ollama-big`). A list can express what a map cannot — an empty name, or one name twice — and `buildModelRegistry` explicitly rejects both.
- **There is no `defaultProvider` setting.** A name in a config can be mistyped, could point at an unregistered backend, and needed synchronising with the list on every change. The first entry is the one column that cannot drift from the list.
- **The registry's snapshot is a null-prototype object.** A later mutation of the host's map does not reroute a run on the fly, and a lookup of `constructor`/`toString` misses instead of resolving into something from `Object.prototype` that is not a provider.
- **An explicitly requested provider beats the host's `resolve` handler**, because the resolver expresses a default routing policy rather than a veto over what the user chose from the catalogue they were shown. Naming a provider is not escalation: the registry is fixed at boot.
- **`resolveModel(requested, available)`** — one rule for every adapter: the named model, or the first as the default, or an `UnknownModelError`. Falling back to the default would answer on a different model than the caller asked for and quietly bill for it.

<details>
<summary>The declared “supported baseline” exists but is consumed by nobody yet</summary>

ADR-0004 §4 commits us to a **supported baseline** (streaming + native tool calling + a context that fits the workspace's type summaries) and to saying _in words_ when a model falls below it. In the domain that is `SUPPORTED_BASELINE`, `baselineShortfalls(caps)` and `meetsSupportedBaseline(caps)` — `baselineShortfalls` returns _every_ shortfall rather than the first, because the settings interface needs to name the missing capability.

**None of those three is called outside the package**, and `ModelProvider.capabilities()` is called by nobody outside the specs. The explicit degradation §4 commits us to **does not happen** today: a model that cannot call tools is sent the tools anyway, and the interface says nothing. The API is the right shape; wiring it into the engine is tracked separately.

</details>

## 04. The agent's authority model

This is the dossier's central section. Everything else is machinery around one statement: **the copilot is not a principal**. It is a way a person acts.

### Two permission keys, and neither lives here

The permission catalogue is the single source of truth, and it is in `identity/server` (`rbac/system-roles.ts`). No migration is required: `seedSystemRoles` is idempotent and runs on every boot.

| Permission            | What it opens                                                                                                                 | admin | contributor | viewer |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----- | ----------- | ------ |
| copilot:use           | Every chat route: the run, answering a permission request, the model catalogue, conversations, proposals, the skill catalogue | ✓     | ✓           | ✓      |
| copilot:skills:manage | Only the skill **write** routes + `GET /skills/manage` and `GET /skills/:id` (with the instruction body)                      | ✓     | —           | —      |

`copilot:use` is held by **all three roles, the observer included** — and that is a position rather than an oversight. An observer's copilot is _provably_ read-only, because the profile offers it not one write tool; a separate “copilot permission for the chosen few” is unnecessary once a run's authority already equals the role's.

**There is no `copilot:configure` permission.** It guarded the per-workspace auto-apply policy and nothing else, so ADR-0009 removed it along with the policy. Bringing it back is worth it only if a runtime model registry appears, as ADR-0004 §5 anticipates.

### Three enforcement points

#### Offer

The tool list is filtered **before** the prompt is assembled — `resolveCapabilityProfile`. ADR-0005 §3 stresses that this is **not an optimisation**: a tool the model was never told about cannot be requested, argued into existence or refused at the cost of tokens. The function is **pure and total** — no I/O, no clock.

#### Authorization

At execution time `ToolRegistry.call` re-checks `requires` against a **freshly resolved** session. The engine additionally re-resolves the profile before every call: a role taken away mid-turn takes effect on the next tool call. Nothing is cached.

#### Display

The admin UI closes the affordances with `useHasPermission` — fail-closed. That is only interface honesty; the real decision is always on the server.

### The capability profile — what it computes

`resolveCapabilityProfile({ tools, actor })` walks the `copilot`-surface tools in declaration order and decides for each:

1. **Is the name already taken?** The first declaration of a name wins; a later one goes into `withheld` with the reason `duplicate-name`.
   _MCP tools are namespaced mcp.<connector>.<tool> precisely so they do not pass themselves off as native (ADR-0005 §8); “last one wins” would undermine that_
2. **Does the actor hold every declared permission?** The missing ones are collected into a list, and the tool goes into `withheld` with `missing-permission` and an enumeration of what is missing.
   _the enumeration is there to explain the gap to a person — the model is not told the tool exists at all_
3. **There is no second gate on `effect`.** A write tool is offered on the strength of its declared permissions exactly as a read tool is.
   _that is all of ADR-0009 §5: the “apply-not-enabled” withheld reason was removed along with the per-workspace policy_

The function is **generic over a three-field structural type**, `AuthorizableTool` (`name`, `requires`, `effect`), rather than importing `ToolDefinition` — which is how the package still imports nothing, while the server passes the real registry's tools into it directly and gets its own definitions back.

### Why `propose` applies immediately — the decision, examined

**ADR-0009 is the group's most significant product decision.** Before it, every copilot write was a `copilot_proposals` row that a person accepted from a card in the panel, plus a per-workspace, per-tool opt-in that removed that click. Both halves shipped. What running them revealed:

#### The opt-in screen — a feature nobody uses

Every box is unchecked by default, it sits behind an admin permission, and its own text is forced to begin by explaining that this is _not_ a permissions screen — because a page of empty checkboxes reads as a list of prohibitions. **A configuration surface whose main job is apologising for its own default was the wrong choice.**

#### The review step was not a review

One request, one card per change. “Add alt text to every image in this article” is one prompt and twelve approvals. Nobody reads the twelfth. Twelve “Apply” clicks is queue clearing, and an interface that rewards clearing speed produces **worse attention than no ceremony at all** — while charging everyone the ceremony.

#### It taught the wrong thing about authority

“Apograph AI needs your approval” reads as “Apograph AI can otherwise do more than you”. The opposite is true and always was: a run holds exactly the caller's permissions. **The approval step obscured the very guarantee it was meant to express.**

#### The valve pressed in the wrong place

The opt-in was per tool, so a workspace tired of clicking turned auto-apply on _for everything at once_ — arriving at this same decision, but less deliberately, and keeping the screen and the table on the way.

### What replaced it — and what that cost

1. **There is no review queue.** The engine writes a `copilot_proposals` row and **immediately** applies it through the owning plugin's `ProposalApplier`. No `accept`, no `reject`, no change sitting in a list waiting to be found.
   _the accept/reject routes and the GET/PUT /api/copilot/policy pair were removed_
2. **Instead, the run parks _before_ the call.** A `propose` or `apply` tool not yet allowed in this branch makes the engine emit a `tool-permission-request` frame and wait. Three answers: “Allow once”, “Allow in this chat”, “Do not allow”. A refusal comes back as an ordinary tool error, which the model reports.
   _reads never ask: a model runs three or four searches before answering anything, and a chat that opens with four requests trains people to click them through unread_
3. **The whole difference from the old gate is here.** The old step asked about a change that **had already been computed**, from a queue, later. The new one asks **before anything happened**, inline, and the escape hatch (“in this chat”) sits in the prompt itself rather than on a settings page. Twelve cards became twelve clicks; twelve calls become one click and silence.
4. **“Allow in this chat” is remembered on the conversation row** (`copilot_conversations.allowed_tools`) and dies with the branch. There is **deliberately no “always” button**: a permanent per-user allowlist is policy outliving the context it was granted in, which is exactly the shape ADR-0009 §4 removes. The memory is **purely about convenience** and never about authority: every call it skips the question for is still authorized against live grants.
5. **The row remains, and is now the entire paper trail.** It is still written _before_ the apply and _by the engine, not by the binder_, so “reversible but never invisible” from ADR-0005 §5 survives the loss of the human step. A binder writing directly would be a change with no receipt.
6. **`pending` now means “the apply failed”.** A failed apply reopens the row with the error message, the run's frame carries that message, and the card says the change did not happen. **Nobody retries** — the user asks again.

> **The honest residual risk, called by its name**
>
> ADR-0009 states the price outright: **prompt injection is stopped by a prompt, not by an audit log.** An early draft of the record accepted that an injection would simply write, with the log as the only means of detection; that was judged too expensive a giveaway, and §1b is what buys it back: an injected call parks and shows the user its arguments before anything happened. What remains: **a user who answered “allow in this chat” has, for that branch, accepted whatever that tool does next**, including a call an injection talked the model into. Bounded by their own permissions, audited, backed by revisions, and unable either to publish (§7) or to leave the workspace.

> **Three rules of DecideProposalService**
>
> **It has no permission check of its own, and that is not an omission.** The profile offered the tool at the start of the run, and `executeTool` re-authorized it against a fresh session immediately before the proposal came into being. There is no third check because there is no third actor.
>
> **The status is flipped before the write.** `decide` updates the row with a `status = 'pending'` predicate, so the applier is unreachable twice for one row. That stays load-bearing even without reviewers: a model that re-proposed an identical change, or a replayed run, must not write twice.
>
> **A failed apply reopens the row** with the message, and the engine reads that back into the tool result and into the `proposal` event.

### A tool with `effect: 'apply'` leaves a receipt too

No shipped tool declares that effect — every writer is a `propose`. But the registry allows it, and ADR-0009 §5 offers such a tool exactly as it offers a read one — so the engine has to account for it. `recordApplied` writes the row **after the fact** (the handler has already written by the time it returns; only the permission prompt could have stopped it), its `kind` is `tool.<name>` and it has no applier — there is nothing left to execute — while the model still receives the handler's return value, because for an `apply` tool that is a _result_ rather than a change. The row is moved to `accepted` immediately through `decide` rather than by a second INSERT, so it carries `decidedBy`/`decidedAt` like any applied change.

## 05. Tools: one registry, two surfaces

ADR-0007 settles two facts at once: `copilot/server` **does not import** `content-server`, and it **no longer owns** the tool registry. The catalogue is the `ToolRegistry` from `@apograph/tools-server` — the very instance that serves the MCP endpoint. `ToolsModule` is **imported** by this module rather than provided, so a deployment with a copilot but no MCP still has a registry, and a deployment with both has exactly one.

**`ToolRegistry.call` is the authorization gate**, checking `requires` before dispatch. The engine's offer is a convenience filter on top of it. Input validation (`validateToolInput`) moved there too, next to the `ToolDefinition.inputSchema` it interprets: while it lived in the copilot's domain, only the run loop applied it, and the MCP endpoint dispatched unvalidated arguments into those same tools.

### Twenty-one tools on the `copilot` surface

**The `surfaces` field is neither decoration nor a default.** A tool with no tension in it — it sees no drafts, writes nothing, requires no attribution to a person — **omits the field and is offered to both surfaces**. So changing such a tool changes what MCP exposes as well.

| Tool                          | Plugin   | Requires                        | Effect    | Surfaces        |
| ----------------------------- | -------- | ------------------------------- | --------- | --------------- |
| admin_content_types           | content  | content:read                    | read      | `copilot`       |
| admin_content_search          | content  | content:read                    | read      | `copilot`       |
| admin_content_get             | content  | content:read                    | read      | `copilot`       |
| admin_content_revisions       | content  | content:read                    | read      | `copilot`       |
| admin_content_diff            | content  | content:read                    | read      | `copilot`       |
| i18n_translations_get         | i18n     | content:read                    | read      | `copilot`       |
| activity_recent               | activity | activity:read                   | read      | `copilot`       |
| workspace_members_list        | users    | users:read                      | read      | `copilot`       |
| admin_alarms_findings         | alarms   | alarms:read                     | read      | `copilot`       |
| i18n_locales_list             | i18n     | content:read                    | read      | `copilot + mcp` |
| media_assets_search           | media    | media:read                      | read      | `copilot + mcp` |
| media_folders_list            | media    | media:read                      | read      | `copilot + mcp` |
| media_asset_read              | media    | media:read                      | read      | `copilot + mcp` |
| content_propose_create        | content  | content:create                  | `propose` | `copilot`       |
| content_propose_update        | content  | content:update                  | `propose` | `copilot`       |
| content_propose_bulk_save     | content  | content:create + content:update | `propose` | `copilot`       |
| i18n_propose_translation      | i18n     | content:update                  | `propose` | `copilot`       |
| i18n_propose_bulk_translation | i18n     | content:update                  | `propose` | `copilot`       |
| media_propose_alt_text        | media    | media:update                    | `propose` | `copilot`       |
| media_propose_file            | media    | media:create                    | `propose` | `copilot`       |
| content_propose_access        | segments | segments:manage                 | `propose` | `copilot`       |

In total: 13 read tools and 8 write tools; 4 of the reads are given to both surfaces. There is not one publish tool — that is ADR-0005 §7 in code rather than on paper.

### What each `propose` tool produces

**None of them writes anything.** The return value _is_ the change — a `ProposalDraft` with the fields `kind`, `target`, `patch`, `summary` and an optional `changes`. The engine (not the tool) stores that as a row and then applies it.

| Tool                          | Produces the kind         | What the applier does                      |
| ----------------------------- | ------------------------- | ------------------------------------------ |
| content_propose_create        | content.entry.create      | The ordinary `EntryWriterService`          |
| content_propose_update        | content.entry.update      | The same one the edit HTTP route uses      |
| content_propose_bulk_save     | content.entry.bulk-save   | The batch as **one** kind                  |
| i18n_propose_translation      | i18n.entry.translate      | Creating a translation in the locale group |
| i18n_propose_bulk_translation | i18n.entry.bulk-translate | A batch translation                        |
| media_propose_alt_text        | media.asset.setAlt        | Editing an asset's alt text                |
| media_propose_file            | media.asset.create        | Creating a file in the library             |
| content_propose_access        | (a segments kind)         | An entry's audiences — who may read it     |

**The two batch kinds are their own kinds rather than a repeated single one.** A proposal row is the receipt for **one** tool call, so a batch written as twelve rows would put twelve cards in the transcript for a change asked for once, and none of them would account for the other eleven.

> **The inversion of appliers**
>
> `copilot/server` cannot write a content entry and should not be able to. The plugin that owns the data binds a `ProposalApplier` for its `kind` through `copilotAppliersRegistrar(...)`. The interface's contract is one sentence: **an applier calls the ordinary use case**, with a person as the actor. That is what makes an applied change validated, audited and backed by a revision. `ProposalActor` carries the actor's e-mail alongside the id, because the audit freezes an e-mail snapshot on every event, and an applier holding only an id would have to look it up — a query at apply time, on the one path where getting the actor wrong is least acceptable.

### Fencing untrusted data

`fenceUntrusted(source, payload, maxChars?)` is the structural defence from ADR-0005 §8. Two properties carry it: **the payload is JSON** (no field can smuggle in a string that reads as a new turn), and **`<` is escaped** (the closing delimiter cannot be forged from inside). Tested against a forged fence.

The fence is **size-bounded**, and that bound lives in the domain rather than in the engine: `RunLimits.maxTotalTokens` is checked _between_ steps and therefore cannot stop one oversized tool result — by the time of the check it is already in `messages` and already paid for. Past the ceiling the payload is replaced by an envelope that **declares** the truncation, so the model reports the gap instead of answering confidently out of a result it does not know was clipped. The preview is re-encoded with `JSON.stringify` rather than sliced out of the original — a slice cannot leave half an escape sequence or a lone surrogate in the prompt.

## 06. Data model

The plugin owns **five** tables and ships its own migrations: a `drizzle.config.ts` + seven committed `migrations/*.sql`, applied by the host through `nx run server:db:migrate`, with `__drizzle_migrations_copilot` as the journal. The plugin opens no database connection.

> **The Drizzle config points at a glob, not a file**
>
> `src/lib/*/infrastructure/schema/index.ts` — because the plugin has more than one slice (`chat` and `skills`) and each owns its own tables. A slice added without a line in that config would pass typecheck, boot, and fail on the first query against a table nobody generated a migration for.

| Table                 | Purpose                                                     | Key fields and constraints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| copilot_conversations | A chat branch, private to a user × workspace pair           | `user_id` and `workspace_id`, both FKs **on cascade** · `title` nullable (derived from the first message rather than costing a model call) · `surface` (`chat` \| `palette` \| `entry` \| `records`) · `archived` · `model_choice` nullable text · `allowed_tools` jsonb (default `[]`) · `updated_at`.<br>The `(user_id, workspace_id, updated_at)` index is exactly the branch-list query.                                                                                                                                                                                                                                                            |
| copilot_messages      | The transcript, **append-only**                             | `run_id` · `role` (`user` \| `assistant`, a pgEnum) · `content` jsonb — blocks in the **port's** shape rather than a provider's, so the transcript survives a change of backend · `attachments` jsonb · `skills` jsonb (a name/title/source snapshot) · `model`, `provider`, `stop_reason`, `input_tokens`, `output_tokens` · an **explicit** `position` integer — two turns of one run land in the same millisecond.<br>Once written, a row **is not edited**: a failed turn keeps its `stopReason`, an aborted one keeps whatever text had arrived.                                                                                                   |
| copilot_tool_calls    | **The security audit surface** (ADR-0005)                   | A row per **attempt** — succeeded, failed and **refused**, because a refused call is what a reviewer is looking for · `call_id`, `name`, `input` jsonb · `output_summary` — a **reduced summary**, not the whole result · `ok`, `error`, `duration_ms`.<br>The `(run_id, created_at)` index is “what did this run do”.                                                                                                                                                                                                                                                                                                                                  |
| copilot_proposals     | Every change the copilot made; written **before** the write | `tool_call_id` text — the change joins to its row in `copilot_tool_calls` by it, and the interface hangs the card on the step that produced it · `tool_name` · `kind` · `created_by` → users (a person, never the copilot) · `target`, `patch` — **opaque jsonb** · `summary` · `changes` jsonb (a per-file before/after) · `status` (`pending` \| `accepted` \| `rejected`) · `decided_by` (`set null`), `decided_at` · `result` jsonb · `error` text.<br>The shape of `target`/`patch` belongs to the applier that declared the `kind`: teaching this table about content entries would make the copilot something that changes when content changes. |
| copilot_skills        | A skill written inside the CMS — **workspace-scoped**       | `name` (the machine name) · `title` · `description` (in the prompt for _every_ enabled skill) · `instructions` (the body; it reaches the model only while the skill is in force) · `mode`, a pgEnum of `manual` \| `always` · `enabled` · `created_by` → users **`set null`** rather than cascade: a branch is personal and leaves with its owner, while a skill is workspace configuration that must outlive the admin who typed it.<br>A unique index on `(workspace_id, name)` — otherwise which instructions the model receives would become a question of row order.                                                                               |

`external-refs.ts` carries id-only stubs of `users` and `workspaces` so drizzle-kit can emit cross-context foreign keys without pulling another plugin's Nest providers into its esbuild pass. The same trick as in `workspaces/server`.

| Migration                       | What it introduces                                                   |
| ------------------------------- | -------------------------------------------------------------------- |
| 0000_copilot_chat               | The `copilot_message_role` enum + the three chat tables              |
| 0001_proposals                  | `copilot_proposals`                                                  |
| 0002_drop_workspace_policies    | `DROP TABLE copilot_workspace_policies CASCADE` — ADR-0009 §4 in SQL |
| 0003_conversation_allowed_tools | `allowed_tools` jsonb                                                |
| 0004_message_attachments        | `attachments` jsonb on a message                                     |
| 0005_skills                     | The `copilot_skill_mode` enum + `copilot_skills`                     |
| 0006_conversation_model_choice  | `model_choice` text                                                  |

> **Archiving is the only deletion, and that is not a gap**
>
> A branch's `copilot_proposals` rows are receipts for changes that **really were made** to the caller's content. Deleting a conversation would take the only record of those edits with it. A `PATCH` sets `archived`, which moves a branch between **two disjoint lists** — `GET /conversations` serves one or the other, never both, otherwise the flag would mean nothing to whoever is reading the list. The transcript is untouched, and `GET /conversations/:id` still serves it, so a link to an archived branch keeps working. **Deleting a skill, by contrast, is real**: a skill is configuration rather than a receipt for a change that already happened, and every turn that ran under it holds its own snapshot.

**Every repository method a route reaches takes the owning `userId` and `workspaceId` and filters on both.** `WorkspaceGuard` proves the caller belongs to the workspace they named; nothing upstream proves that the _conversation id_ is theirs. Four methods take neither — `allowedTools`, `allowTool` and `messages` are called by the engine with an id `findOrFail`/`create` has already recognised as the caller's, and `toolCalls(runId)` is a test seam. They are **unreachable** from a route.

## 07. A run's lifecycle and its bounds

### The limits — three ceilings

**maxSteps 30** · **wallClockMs 300,000** · **maxTotalTokens 400,000**

| Ceiling        | Default         | Where it is checked                            | What matters about it                                                                                                                                                                                                                                                                                                                                   |
| -------------- | --------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| maxSteps       | 30              | The loop header                                | One “step” is a model call plus whatever tools it requested. It bounds the loop's **depth**, not its width.                                                                                                                                                                                                                                             |
| wallClockMs    | 300,000 (5 min) | The step header **and before every tool call** | One step may request any number of tools, and a parked one waits for a person. Checking only at the top of a step would mean a turn with thirty writes runs all thirty for as long as it likes and only then reports `timeout`. A call refused on the ceiling is fed back as an **ordinary tool error** — every `tool_use` still needs a `tool_result`. |
| maxTotalTokens | 400,000         | **Between** steps only                         | A run may **overshoot the ceiling by a whole model call**, and measurably does: a 100-token ceiling ended a run at 10,000. Bounding that would mean predicting a turn's size before making it.                                                                                                                                                          |

**What `maxTotalTokens` counts:** uncached input + output + **cache writes**, cumulatively across the run. Cache reads are excluded deliberately — they cost about a tenth of ordinary input and are the whole point of caching, so charging the ceiling for them would mean spending budget on re-reading a prompt the provider already has. Writes are billed at a premium and are counted — otherwise turning caching on would make every run look cheaper than it is.

> **Raise the ceilings together**
>
> All three are checked in one loop, so raising one moves the wall rather than removing it: a run with more steps and the same duration stops on `timeout`, which gives the same truncated answer under a different name. Raising them costs tokens, not safety: every step is still authorized and audited, and a `propose` tool still writes its row before applying anything.
>
> The defaults are chosen for a run that **writes**: the model reads the type, reads the entries, proposes, reads the result, reports — and an instruction covering several entries repeats the middle of that. The earlier values (8 steps / 2 minutes) were tuned for the first phase's read-only catalogue.

### Stop reasons

`RunStopReason` is a **superset** of the provider's `ModelStopReason`: the model reports why _it_ stopped, while this reports why the _run_ stopped, including limits the model never sees.

| Reason            | When                                                  | Counts as “truncated”?                                                                             |
| ----------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| end               | The model gave its final answer                       | No                                                                                                 |
| max-steps         | Hit `maxSteps`                                        | Yes                                                                                                |
| max-tokens        | Hit `maxTotalTokens`                                  | Yes                                                                                                |
| timeout           | Hit `wallClockMs`                                     | Yes                                                                                                |
| max-output-tokens | One model reply was clipped by its own output ceiling | Yes                                                                                                |
| refusal           | The provider's safety classifiers refused             | **No** — deliberately: a “carry on where you left off” prompt is precisely not what is wanted here |
| aborted           | The client disconnected or the user cancelled         | Yes                                                                                                |
| error             | The run failed; the message rides the `error` event   | Yes                                                                                                |

> **The reason is a contract; the wording is not**
>
> The domain **exports no user-facing text** for a stop reason, and should not: a `Record<RunStopReason, string>` of ready-made English phrases cannot enter the admin UI's `react-intl` pipeline — there is no message id, and a translator has nothing to look at. What remains in the domain is `RUN_STOP_NOTES`, a module-private constant feeding `interruptionNote`: text the **model** reads, the one place English from the server belongs. The translated wordings belong to `copilot/admin` and are keyed on the same union.

### Eight SSE event types

| Event                   | When                                        | What it carries                                                                                             |
| ----------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| run-started             | Before the first model call                 | `conversationId`, `runId`, and the `messageId` of the already-stored user message                           |
| text-delta              | As it arrives                               | `text`; concatenating every delta gives the full answer                                                     |
| tool-call               | **Before** execution                        | `id`, `name`, `input` — “no invisible actions”: the user sees the call even if it later fails or hangs      |
| tool-result             | After the call — successful or not          | `ok`, `durationMs`, `summary`, `output?`, `error?`                                                          |
| tool-permission-request | The run is parked                           | `id`, `runId`, `name`, `title?`, `input`, **`expiresAt`** — the deadline the client counts down to          |
| proposal                | **After** the same call's own `tool-result` | `id`, `toolCallId`, `kind`, `summary`, `target`, `changes?`, `status`, `entityId?`, `error?`                |
| done                    | Exactly one ends a well-formed run          | `stopReason`, `usage`, `messageId?`                                                                         |
| error                   | May precede `done`                          | `message` — safe to display: never a stack, never a provider payload and nothing that names internal wiring |

**`tool-result` and `proposal` answer different questions**, which is why they are two frames rather than one: a tool result is what the _model_ was told; a proposal is a receipt for what was _done_. The client draws its step list from the first and the card from the second. The client's reducer is written against this union, so a new event kind is a compile error at every consumer rather than a silently ignored frame.

## 08. Scenarios — how it works, step by step

### 8.1 An ordinary turn: a question, a search, an answer

The commonest path. Not one write, not one question to the user.

1. **The client sends `POST /api/copilot/runs`.** The transport is `fetch` rather than the shared `apiClient`: axios cannot stream a response in the browser. SSE over **POST**, because a turn has a body and `EventSource` can only do a bodyless GET.
   _three guards, in order: OriginGuard (cut off a cross-site POST), PermissionsGuard (copilot:use), WorkspaceGuard (prove membership of the named workspace)_
2. **The controller installs the disconnect handler at once — before the first `await`.** A client that gave up during setup must still cancel the run.
   _the handler hangs on res, NEVER on req — see the box below_
3. **The content-type summaries are loaded** and passed into the engine, after which `stream.open()` sends the headers and immediately flushes a `: open` comment frame, so the client's `fetch` resolves and the interface renders a waiting state without waiting for the first token.
4. **The engine resolves the attachments — before it touches the conversation.** An unresolvable attachment is a bad request, and doing this here means it cannot leave the branch with a turn referencing a file the model was never told about.
   _this is the one ordering in which the transcript deserves trust_
5. **Skills are resolved in the same place and before the same row**: a turn must not be stored claiming skills the model never received.
6. **The conversation is found or created**, and the user's message is **stored before the model call**. A dropped connection must not lose what a person typed.
7. **`run-started` is emitted**, with the conversation, run and stored-message ids.
8. **The capability profile is resolved** — the role's permissions through `PermissionsService.forRole`, the tools through `ToolRegistry.forSurface('copilot')`. The `ToolActor` gets `kind: 'user'`, and its `userId` is that same id, because the copilot has no identity of its own.
9. **The provider and the model are chosen.** An explicitly named provider beats the host's resolver; an unregistered name gives an `UnknownModelChoiceError`. The model is resolved **in the engine** rather than left to the adapter: a run's row has to name the model that actually answered, otherwise `copilot_messages.model` would have to be written `null` — the very column both cost accounting and “which model said this” read.
10. **The system prompt is assembled.** Every section is conditional: MAKING CHANGES requires write tools to exist, the locales line requires `i18n_locales_list` to be in the offer, and ON THIS SURFACE requires a surface with something particular to say. Telling an observer how writes behave is buying a tool call that can only fail.
11. **The history is loaded** — from the transcript rather than from memory, so a continued conversation replays exactly what was stored. It goes through `normalizeTranscript`.
12. **The loop: a model call → the tools → repeat.** On each iteration `signal.aborted`, the wall clock and the tokens are checked first; then `yield*` forwards the deltas to the client as they arrive.
13. **Tools execute one at a time**, each with a `tool-call` frame before and a `tool-result` after, each with an audit row. The result is wrapped by `fenceUntrusted`.
14. **The assistant's turn is stored**, even if the run was cancelled or failed: the transcript is append-only, and a partial answer is part of what happened. It is skipped only when nothing at all was produced.
15. **`done` is emitted** with the `stopReason` and `usage`, and the stream closes.

> **Disconnect detection hangs on res, never on req**
>
> Express has already **consumed the request body** by the time the handler is called, and a fully consumed `IncomingMessage` emits `'close'` **immediately** — with the client alive and waiting. Hanging the abort on `req.on('close')` cancels every run the moment it starts, and since `writeHead` has not been flushed yet, it looks like **a request hanging with no response** rather than an error. Verified on Node 22. Worth a lost day if you get it wrong.

### 8.2 A write: the question before the call, then an immediate apply

The core of ADR-0009. Examined line by line, because the ordering here is load-bearing everywhere.

1. **The model asks for `content_propose_update`.** A `tool-call` frame goes to the client at once — before any check, because “no invisible actions”.
2. **The wall-clock check for this particular call.** Exceeding it is a refusal as an ordinary tool error rather than a silent skip: every `tool_use` needs a matching `tool_result`, otherwise the assistant turn just sent is malformed for both wire formats.
3. **`mayRun` decides whether a question is needed.** An unknown tool is none of its business (`executeTool` will say so in its own message): asking a user to approve something that does not exist would be absurd. The `read` effect never asks.
   _reads do not ask, because a chat that opens with four requests trains people to click them through unread — which is worse than not asking, since it devalues the one request that matters_
4. **`allowed_tools` is read _per call_, not per run.** The list grows while the run is parked: an “allow in this chat” answer on the first of one turn's two calls must stop the second from asking. The append is done in SQL for the same reason.
5. **`tool-permission-request` is emitted** with the call's arguments and an `expiresAt` computed from the **run's remaining budget** — here rather than inside `settle`, because the frame leaves before the parking and the client needs a deadline from the moment the prompt appears.
6. **The run parks on `ToolPermissionBroker.ask`.** The broker records `{ userId, workspaceId }` — **who is entitled to answer**.
7. **The user answers `POST /api/copilot/runs/:runId/permission`.** A second request against a still-streaming run is the only available shape: a run is an SSE response, and a response cannot be asked a question.
8. **“Allow in this chat” appends the tool's name to `allowed_tools`.** “Once” does not. A refusal and a timeout are **audited**: “the user said no” is exactly what a reviewer looks for in `copilot_tool_calls`.
9. **`executeTool`: is the tool in the profile?** A hallucinated name and a withheld one give the **same** “Unknown tool”. The tool set is no secret — it is derived from the caller's own role — so naming it reveals nothing and saves the model a wasted turn.
   _the answer here used to be uniform because of an enumeration signal; that is right for DATA (an ungranted content type 404s as nonexistent) and wrong for a tool list — ADR-0006 §5 reached the same conclusion for MCP_
10. **Re-authorization against **freshly** resolved grants.** The offer was computed at the start of the run, and a role can change while a long turn is in flight. A mismatch is a warning in the log and “You are not permitted to use …”.
11. **Argument validation** against the `inputSchema`.
12. **Loop protection.** The signature is the `name` plus the arguments serialised **with sorted keys**, so argument order cannot beat the guard. A repeat is rejected with a message that **says** the call has already been made: telling the model is what breaks the loop; silently re-executing or refusing without a reason both simply repeat. It is checked **after** authorization, so a repeat cannot reveal more than the first call would have.
    _without it the engine serves the repeat until it hits maxSteps: the entire step budget on identical queries, no answer, and a stop reason that explains nothing_
13. **Dispatch through `ToolRegistry.call`** rather than a direct call: the registry re-checks `requires` ahead of the handler. That is **the gate**; the offer above it is a convenience filter.
14. **The return value is checked by `isProposalDraft`.** A binder that declared `effect: 'propose'` and returned something else would otherwise write a malformed row into an append-only table. Here it is an ordinary tool error — the same treatment as any other binder bug.
15. **The `copilot_proposals` row is created — BEFORE the apply.** That is the whole paper trail.
16. **`DecideProposalService.apply`: the status flips first.** `UPDATE … WHERE status = 'pending'` — the applier is unreachable twice. The ordering is load-bearing: applying first and writing afterwards can apply twice.
17. **The applier calls the ordinary use case** with the person as the actor: the same validation, the same revision, the same activity row. That is what makes a copilot change indistinguishable from a hand-made one in the audit log.
18. **The result is appended by a second UPDATE** rather than folded into the status transition: that transition matches only `pending`, and the row is now `accepted` by design.
19. **The model is told what happened rather than handed the patch back.** It already knows what it asked for; echoing the change would spend the tokens twice and invite a “confirm” by re-calling. Success: `Applied: <summary>`. Failure: `NOT applied: … Tell the user it did not happen, and do not claim otherwise.`
20. **The audit row agrees with the outcome rather than with the dispatch.** It used to say `ok: true` next to `output_summary: "failed: …"` and a non-null `error` — a reviewer filtering on `ok = false` would find no trace of a write that did not happen, which is precisely the row they were looking for.
21. **Two events to the client.** A `tool-result` with `ok: !applyError` (a failed write must render as a failed step — it used to be `ok: true` with `summary: 'failed'`, a green tick next to the word “failed”) and a `proposal` with the final `status` and, on failure, the `error`. The frame is the card's **only chance** to say the change did not happen: there is no longer a queue to go and look at.

### 8.3 The permission broker — four things it must not lose

1. **The timeout.** Five minutes **for the whole run**, not five fresh minutes per call. One step may request any number of tools, and each can park; charging each its own timeout let one turn with thirty writes hold the connection, the generator and the model's context for **two and a half hours**. “They went to look at the entry and came back” is one absence, not thirty. It resolves as a **refusal, not a throw**: the model learns of it and an answer still arrives.
   _an exhausted budget refuses immediately, without asking and without holding the connection_
2. **The abort.** A user closing the window is the ordinary case, and the engine's `signal` fires; the waiter must reject, otherwise the generator does not unwind and the run leaks.
3. **Cleanup.** Every exit path clears the entry. A registry that deletes only on the happy path accumulates one dangling promise per abandoned run. A run's spent budget is remembered for `BUDGET_TTL_MS` and swept opportunistically on the next `ask` — there is no “the run ended” signal, the generator simply stops asking.
4. **Ownership.** A `runId` is **not a secret** — it goes to the client in the `run-started` frame. `copilot:use` is held by every role, observers included, and `WorkspaceGuard` proves membership of the workspace _the caller named_: a member of workspace B who names B passes it while answering a run parked in A. So the broker checks the pair, and a mismatch is rejected with the same `false` — and therefore the same **404** — as “nothing is waiting”: whether somebody else's run exists is not something this route answers.

> **An in-process broker is a deployment constraint, not an oversight**
>
> The promise the run awaits lives in this process, so `POST …/permission` must reach that same instance. A single-server self-hosted installation — which is what this is — is fine. A horizontally scaled one needs sticky routing on `runId`, or the registry moved behind a shared channel. Documented rather than discovered as a random hang.

### 8.4 Extending a parked run — `POST …/permission/extend`

The prompt used to have a hard five minutes with no warning, no countdown and no way to ask for an extension: it simply vanished, and the model reported that nobody answered. WCAG 2.2.1 requires that a content-set limit can be turned off, adjusted or **extended after a warning**, and none of the criterion's exceptions applies here — ADR-0009 justifies the limit by cost rather than correctness (ticket `ORT-118`).

- **An extension gives a full fresh budget** rather than a top-up: the first portion was not enough, and WCAG asks for the ability to extend “at least ten times” — which repeated full-size extensions satisfy without inventing a second number.
- **The same guards, the same ownership check, the same 404.** Extending a parked run's time is the same authority as answering it.
- **The response carries a new `expiresAt`.**

**The endpoint is no longer a button (ticket `ORT-199`).** It was “I need more time”, beside a running countdown and a twenty-second warning; it is now a **keep-alive the open prompt runs by itself**, every two minutes while the tab is visible. That satisfies 2.2.1 by a different exception than before: the criterion governs a limit the _content imposes on the user_, and with the countdown, the warning and the button all gone there is no limit in front of them to extend. Removing the button alone would have been the failure — a timer that hurries a reader through a decision about writing to their content, with nothing to press.

Three things stay, and each is load-bearing:

- **The server-side budget is unchanged.** It bounds a connection, a generator and a model context that a parked run holds open; it was never there to hurry anybody.
- **A hidden tab does not extend.** Nobody is reading it, so a prompt abandoned in a background tab is the one case where the budget should still run out.
- **The expiry message stays.** A prompt whose run did close has to say so, or its three buttons look answerable and quietly do nothing.

### 8.5 Attached files

1. **The upload is not part of the run.** The browser first makes a `POST /api/media/assets`, under the user's own session and their own `media:create` — the very request the media library page makes. By the time the run starts the asset already exists.
   _which is why attachments needed neither a new permission nor a new write path: somebody who cannot upload to the library cannot attach a file to a chat either_
2. **The upload happens on adding rather than on sending**, so the waiting falls while the person is still typing, and a file that will be rejected is rejected before a question about it is written. Sending is blocked while any upload is in flight.
3. **The run's body carries ids only.** The client has the asset's whole view in hand, and sending the name would save the server a lookup; it deliberately does not — the id is the only part the server can verify.
4. **The resolver is workspace-scoped and omits what it cannot see.** Another workspace's id is indistinguishable from a deleted one.
5. **A shortfall becomes one `AttachmentError` naming the count** — **never which id**: saying which would be an asset-id oracle in exactly the place a caller would be guessing them. Duplicates collapse into the count.
6. **Metadata, not bytes.** A chat that pastes every attached file into the prompt spends the context window on files nobody asked about; for the “when the question needs the contents” case there is `media_asset_read`. The `readable` flag is answered by **the media plugin itself** from its own allowlist, rather than being derived from `mimeType` here — otherwise there would be a second copy of that list.
7. **`loadHistory` folds attachments back into a **fenced** text block** — that is what carries them into later turns (“summarise the file I sent”, three turns on), and that is what treats a file name as the untrusted text it is.

### 8.6 Skills

1. **Two sources, one catalogue.** Code: `CopilotPlugin({ skills })`, validated by `buildSkillRegistry` **at construction** — a duplicate or a malformed skill fails the boot, like a mistyped provider name. The CMS: `copilot_skills` rows, workspace-scoped.
2. **Code wins a name collision**, and the CMS row is **discarded** rather than overwritten. The write routes refuse a colliding name up front, because a merge drops the shadowed row _silently_, and a saved skill that never runs is the worst of the three outcomes.
3. **A skill reaches the model only through the system prompt**, and that is a decision rather than an omission. The engine wraps every tool result in `fenceUntrusted`, which tells the model that what follows is data and never instructions; a skill is exactly the opposite, so delivering it through a tool would mean either carving an exception into the fence or lying to the model about what it is reading.
4. **The request carries names.** `CreateRunDto.skills` is `[{ name }]`, up to `MAX_RUN_SKILLS` = 3. Instruction text in the request body would let anyone with `copilot:use` write their own system prompt.
5. **An unresolvable name ends the run with a message naming the **count\*\*\*\* — never which one, for the same oracle reason as attachments.
6. **An `always` skill is applied on the server**, whatever the client sent. A client obliged to name it could switch workspace configuration off by omission.
7. **Three channels, and all three are the system prompt.** An `always` skill is in force for every run in the workspace; one attached in the composer is in force for that turn; every other enabled one appears as `name — description`, so the model can recommend one it was not given. The bodies are inserted **between the SECURITY and ANSWERING sections** — after the rules a skill may not override, and before the style rules it is supposed to refine.
8. **`copilot_messages.skills` is a snapshot, not a foreign key.** A skill can be renamed or deleted, and a branch read months later still has to say what shaped it. `loadHistory` folds a past turn's skills into a **one-line note** rather than the bodies: re-injecting the bodies on every turn would multiply the prompt by the branch's length.

> **A skill changes how, and never what is allowed**
>
> ADR-0010 reinvents the per-workspace copilot configuration that ADR-0009 §4 removed — and that is not a rollback, because the distinction has to hold in code rather than only in a paragraph: `copilot:skills:manage` is an admin permission, the capability profile is resolved from the caller's role **before** any skill text is read and re-checked on every tool call, and the SKILLS IN FORCE section states the rule to the model itself so it does not spend a turn on it. **A skill has no `allowedTools` field and must not have one.** The day a skill can hand out a tool, ADR-0009's argument is overturned.

### 8.7 Cancellation and disconnection

1. **The user presses Stop.** This is the **one ending the client has to write for itself**: every other one arrives as a frame, while a cancellation closes the connection, so the server's `stopReason: 'aborted'` is recorded on its side and cannot reach us.
2. **`stop()` aborts **and** dispatches `cancelled`.** Without the second half the turn would stay `streaming` forever, `busy` would never clear, and the composer's button would read Stop for the rest of the session.
3. **On the server an abort does not throw out of the stream**: the adapter has to end it with a `done` carrying `stopReason: 'aborted'` and **zero** spend.
4. **The assistant's turn is stored anyway**, with whatever text had arrived and with its own `stopReason`.
5. **When such a branch is replayed, `normalizeTranscript` drops `tool_use` blocks left without a result**, and `interruptionNote` adds a line for the model saying the turn did not finish, and why. Without it a truncated turn replays indistinguishably from a completed one, and “continue” starts the whole task over instead of resuming.

### 8.8 A deployment with the copilot switched off

1. **`COPILOT_ENABLED=false` is the default.** `CopilotModule.forRoot` registers **no controllers at all**, so every `/api/copilot/*` route 404s — at the same layer MCP applies its own.
2. **The flag used to be read in one place** — `RunEngine.run` — and “off” meant “the send button says no”. The panel, the Agents view, the model catalogue, the conversation and skill routes and the tables all stayed alive: a deployment that had declined still shipped the whole feature and refused at the last step. The engine's check remains as a backstop (the generator drains with no socket).
3. **The wiring is not removed.** The providers, the model registry and the skill registry stay bound, and `ToolsModule` is imported rather than provided — so the shared tool catalogue that serves MCP is the same either way.
4. **The admin UI stands to attention rather than falling over.** The probe is the **model catalogue** rather than a dedicated capabilities endpoint: a deployment that cannot serve `GET /copilot/models` will not be able to serve a run. **Only an explicit 404 counts as off** (`copilotIsOff`, pure and unit-testable): a load, a network failure, a 5xx and a 403 all leave the surfaces in place.
5. **“Switched off” and “no access” are distinguished** rather than merged into one empty state: “nobody may here” and “you may not” send a reader to different people.

> **The flag is not egress protection, and never was**
>
> Since ADR-0004's provider registrations arrived, a backend is registered only if its credentials exist — so a deployment with no key reaches no third party whatever this flag says, and since the scripted `fake` stopped being registered, it reaches no model at all. **A missing key is the egress protection; the flag is the operator's kill switch.** An empty provider list is accepted only while the flag is off: an enabled copilot with nowhere to turn fails at construction.

## 09. HTTP API

Every path carries the global `/api` prefix the host sets. Access legend: `session` — a valid session is required, `permission` — a session plus the named permission. The global `AuthGuard` has already run; `OriginGuard`, `PermissionsGuard` and `WorkspaceGuard` are **explicit decorators on the controller**. The explicitness matters here: a copilot route that forgot `WorkspaceGuard` would authenticate fine, pass the permission check, and then run every tool with an **unvalidated** workspace id straight from a client header, silently unscoping the whole tool catalogue.

| Method and path                             | Access and guards                         | Input                                                                                                                                      | Success                                                                                   | Failures                                                                                                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST /copilot/runs                          | `copilot:use` Origin, Workspace           | `CreateRunDto`: `message` (1–8000), `conversationId?`, `uiLocale?`, `provider?`, `model?`, `context?`, `attachments?` (≤8), `skills?` (≤3) | `200 text/event-stream`; `run-started`, then any number of frames, and exactly one `done` | `400` an invalid DTO (`forbidNonWhitelisted` names the extra key); `403` Origin / not a workspace member; `404` when `enabled: false`. Once the stream is open, an error arrives as an **`error` frame** rather than a status |
| POST /copilot/runs/:runId/permission        | `copilot:use` Origin, Workspace           | `{ callId, decision: once\|chat\|deny }`                                                                                                   | `204`                                                                                     | `404` — identically for “nothing is waiting”, “it timed out”, “the run is on another instance” and **“the run is not yours”**                                                                                                 |
| POST /copilot/runs/:runId/permission/extend | `copilot:use` Origin, Workspace           | `{ callId }`                                                                                                                               | `{ expiresAt }` — the new deadline                                                        | `404`, the same uniform shape                                                                                                                                                                                                 |
| GET /copilot/models                         | `copilot:use` **no Workspace**            | —                                                                                                                                          | `{ items: [{ provider, model }] }` — `ModelRegistry.catalogue()` in registration order    | `403`; `404` with the copilot switched off — **this is the availability probe** the admin UI uses                                                                                                                             |
| GET /copilot/conversations                  | `copilot:use` Workspace                   | `?archived=true\|false` (default `false`)                                                                                                  | `{ items }` — **this** user's branches in this workspace                                  | `403`. No `OriginGuard`: it guards mutating requests                                                                                                                                                                          |
| GET /copilot/conversations/:id              | `copilot:use` Workspace                   | a uuid                                                                                                                                     | The branch + the transcript; **archived ones too**                                        | `404` — one shape for “no such thing” and “not yours”                                                                                                                                                                         |
| PATCH /copilot/conversations/:id            | `copilot:use` Origin, Workspace           | `{ title?, archived?, modelChoice? }`                                                                                                      | The updated branch                                                                        | `404`. The ownership predicate is **in the UPDATE itself** rather than a read beforehand, so there is no check-then-write window                                                                                              |
| GET /copilot/proposals                      | `copilot:use` Workspace                   | `?status=&conversationId=`                                                                                                                 | `{ items }` — **workspace-scoped**, not user-scoped                                       | `404` if `conversationId` points at somebody else's branch                                                                                                                                                                    |
| GET /copilot/proposals/:id                  | `copilot:use` Workspace                   | a uuid                                                                                                                                     | One change                                                                                | `404`                                                                                                                                                                                                                         |
| GET /copilot/skills                         | `copilot:use` Workspace                   | —                                                                                                                                          | The catalogue for the picker. **Without the instruction bodies**                          | `403`                                                                                                                                                                                                                         |
| GET /copilot/skills/manage                  | `copilot:skills:manage` Workspace         | —                                                                                                                                          | Every skill, disabled and code-defined ones included                                      | `403` for a contributor and an observer                                                                                                                                                                                       |
| GET /copilot/skills/:id                     | `copilot:skills:manage` Workspace         | a uuid                                                                                                                                     | One skill, **with its body**                                                              | `403`; `404`                                                                                                                                                                                                                  |
| POST /copilot/skills                        | `copilot:skills:manage` Origin, Workspace | `{ name, title, description, instructions, mode?, enabled? }`                                                                              | The created skill                                                                         | `409` for a name **either** source already holds; `400` for a bounds violation                                                                                                                                                |
| PATCH /copilot/skills/:id                   | `copilot:skills:manage` Origin, Workspace | A partial patch                                                                                                                            | The updated skill                                                                         | `400` for an **empty patch**; `409` for a name collision; `404`                                                                                                                                                               |
| DELETE /copilot/skills/:id                  | `copilot:skills:manage` Origin, Workspace | a uuid                                                                                                                                     | `204` — a **real deletion**                                                               | `404`                                                                                                                                                                                                                         |

> **Value bounds**
>
> `MAX_MESSAGE_LENGTH` = 8,000 · `MAX_RUN_ATTACHMENTS` = 8 · `MAX_RUN_SKILLS` = 3 · `MAX_SKILL_NAME_LENGTH` = 64 (the pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$`) · `MAX_SKILL_TITLE_LENGTH` = 80 · `MAX_SKILL_DESCRIPTION_LENGTH` = 240 (every enabled skill pays it on every run) · `MAX_SKILL_INSTRUCTIONS_LENGTH` = 8,000 · `MAX_SKILL_SUMMARIES` = 25 · content-type summaries in the prompt — `MAX_TYPE_SUMMARIES` = 50.

> **The strict ValidationPipe and nested DTOs**
>
> The host runs the pipe with `whitelist: true` + `forbidNonWhitelisted: true`, and that applies to nested objects too. Without `@ValidateNested()` + `@Type()` the `context` object **is not treated as a DTO at all**: the whitelist strips its properties and the handler silently receives `{}`. `forbidNonWhitelisted` returns a 400 naming an unknown _top-level_ key — that is loud; a nested rejection is **silent**. For the same reason `RunAttachmentDto` and `RunSkillDto` are classes rather than arrays of strings.

A live server serves the generated OpenAPI at `/reference` (the raw JSON at `/reference/json`). The run route is described there as an event stream: `@ApiResponse({ status: 200, description: 'An event stream (text/event-stream).' })`.

<details>
<summary>The SSE headers, and why each is there</summary>

`Content-Type: text/event-stream; charset=utf-8` · `Cache-Control: no-cache, no-transform` — the second half is load-bearing: without it a compressing intermediary is entitled to buffer the whole body in order to compress it · `Connection: keep-alive` · `X-Accel-Buffering: no` — nginx's opt-out. The heartbeat is a `: ping` comment frame every **15 seconds**: a model can think for a long time before the first token, and an idle connection is exactly what an intermediary decides to tidy away. `JSON.stringify` cannot emit a raw newline inside a string, so a single `data:` line is always well-formed and the payload never has to be split. Verified through Vite's dev proxy for GET and POST: the frames arrive one at a time with the same timing as on a direct connection.

</details>

## 10. The admin UI: two surfaces over one chat

The admin plugin **contributes no top-level route and no global navigation entry**. Runs are workspace-scoped (`WorkspaceGuard` requires `X-Workspace-Id`), so everything lives strictly inside a workspace: the page and the switcher go into the workspace shell's slots, and the launcher draws nothing outside a workspace. There _was_ a top-level route — for the per-workspace auto-apply policy; ADR-0009 removed the policy along with the screen, the table, two routes and the `copilot:configure` permission.

| Surface              | Where                                                                                     | What for                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The docked panel** | `SIDEBAR_FOOTER_SLOT` (order 10) or `⌘J`                                                  | A window over whichever page you are standing on — a question _about this page_. **Several** chats can run at once, listed by a strip in the bottom right                 |
| **The Agents view**  | `WORKSPACE_ROUTE_SLOT`, `/workspaces/:id/agents` and `/agents/:conversationId` (order 50) | History in a column, a transcript wide enough for a table or a diff — work where the conversation _is_ the task                                                           |
| **The skills page**  | `/workspaces/:id/agents/skills` (order 49)                                                | Authoring skills; the rail's link is **permission-gated and fail-closed**                                                                                                 |
| **The ViewSwitcher** | `WORKSPACE_SECTION_SLOT` (order 5)                                                        | A two-segment CMS / Agents control right below the workspace switcher and **above** the content navigation: it governs which of the two views everything below belongs to |

**Both surfaces draw the _same_ transcript, composer, tool steps, permission prompts and change cards.** Two diverging chat surfaces are two surfaces to keep correct.

> **Order 49 and 50 are not aesthetics**
>
> `agents/skills` is declared **before** the `agents/*` pattern and as a literal path rather than a segment the Agents page interprets: React Router ranks a static segment above a splat, so `agents/skills` goes there and never to the branch page, which would otherwise try to open a conversation called “skills”. And the **high** order on `agents` itself keeps the Content Library (order 10) as what `/workspaces/:id` leads to: reaching the copilot is a choice.

### Chat state lives outside React

Chats live in `copilotStore`'s module state. The reason is specific and was found twice over: a hook inside an unmounting panel took its `AbortController`'s cleanup with it, so **minimising the window was a disguised cancellation**. The first fix only moved the problem — the Agents page hit the same wall one floor up, where the unmounting thing was a _route_. Now nobody owns a chat: the components are views, and **cancelling is something you do by closing a chat, never something that happens to you because a route changed**.

- **A run carries on when you leave.** Start an answer in Agents, go over to the CMS — the chat becomes a pill in the dock that is still streaming. When it arrives, the pill says “finished” and the browser tab shows a `(1)`.
- **`release` decides what survives.** A chat with an answer in flight or parked on a permission prompt becomes a pill; **everything else closes**. The branches are stored on the server anyway and are one click away in the rail.
- **A handed-back chat is a pill, never a window.** A window popping up over the page you have just navigated to is a surface following you around.
- **The tab is the ceiling, and that is not a shortcut.** The server treats a client disconnect as a cancellation, so a run cannot outlive the page that started it. Surviving a reload would require the server to hold a run detached and replay the frames on reconnect — plus sticky routing, given the in-process broker.

### The permission prompt lives in the transcript, not in a modal

- **The panel is deliberately non-modal** (you have to act on an answer while reading it), and a dialog demanding an answer would block precisely the page needed to decide — often the very entry the change is about.
- **Focus moves to the prompt's primary button when it appears.** The panel stays non-modal — nothing is trapped and Tab still leads out — but this is **the one control that stops an injected write before anything happens**, and it was reachable only by tabbing _backwards_ from the composer, past the model picker and the paperclip, into a scroller that is still moving. The only announcement route was the transcript's `role="log"`, saturated by a still-streaming answer. **A consent control the user cannot find is a control answered blind or not answered at all.**
- **The `<pre>` arguments block is the group's `aria-describedby` and is itself focusable**, because it scrolls.
- **Three buttons, no “always”.** “For this chat” is the escape hatch, and its being _in the prompt_ is the whole difference from the removed settings page: you decide where the context already is.
- **A 404 on an answer is expected traffic**, not a bug: the timeout fired, or the run is parked on another instance. The prompt then **keeps its buttons** and says the answer did not get through: the run may still be parked, and taking the controls away would strand it.
- **A `tool-result` for a parked call removes its prompt.** A server timeout or an answer from another window both end the wait with no click in this client; live buttons that answer nothing are worse than none.

### The change card is a receipt, not a decision

Since ADR-0009 the write has **already happened** by the time the card renders, so every word on it is in the past tense and it has no buttons. That inverts what it protects against: it used to exist so a user would not read “drafted” as “done”, and now it exists because it is **the only place they learn their content changed at all**.

- **The card sits in the transcript exactly where the change happened.** A turn is an ordered `ChatBlock[]` (prose, steps and cards interleaved) rather than three buckets sorted by kind. It was buckets once, and the layout could not say when anything happened: a model that explains, saves and carries on writing produced a card nailed to the bottom while the new text appeared _above_ it.
- **A `text-delta` merges into the newest block only while that block is text.** A step or a card ends the paragraph, so what is written next begins a new block _below_ them.
- **A reopened branch restores the same order from `content`** — the port's block list, as the run produced it. Sorting by kind used to leave the card at the bottom in a reopened branch as well.
- **`ChatBlock` wraps rather than intersects.** `{ kind: 'step' } & ChatToolStep` is tidier and **silently clobbers** `ChatProposal.kind` — that is, the applier that carried the change out (`content.entry.update`), which is the very thing the card draws.
- **`pending` reads as a failure:** a destructive badge, “Not saved” and the server's own reason. It is keyed **on the status**, never on the presence of an `error` — otherwise an old row would draw its diff as though the change had happened.
- **Reopening a branch glues the cards back on.** `useOpenConversation` fetches the transcript and `GET /copilot/proposals?conversationId=` in parallel and joins them on `toolCallId` — which is what the server stores it for.
- **Proposed values are drawn as text, never as markup.** The card is what tells a person what was written into their content.

### The step list reads like a log

- **Two tenses in one phrase:** “Searching content…” while it runs, “Searched content · 12 results” once it has. It used to be a raw `admin_content_search` next to a separate “Running…”: a 20 ms tool flashes past, so the user saw a list of snake_case function names appearing already finished.
- **A step names the thing it is doing**, not just the kind of action. `toolSubject` pulls the subject out of the call's arguments — the `summary` that every `propose` tool's schema asks the model to write _for a person_, then the query, the title, the content type. The value is **text written by the model out of the workspace's content, and is therefore treated as hostile**: control and formatting characters (bidi overrides included) are stripped, whitespace runs are collapsed, truncation is done **by code point**, and all of it is drawn as a text node, never as markup.
- **An unknown tool degrades rather than blanking.** `humanizeToolName` turns `mcp.acme.fetch_orders` into “Fetch orders” — a connector's namespace is plumbing the CMS imposes rather than part of the tool's name. Deliberately **not translated**: there is nothing to translate in an identifier a third party chose.
- **The pause between calls is explained by the pure `MessageList/activity.ts`** rather than by a condition in JSX: after a completed step it reads “Searched content — working out what to do next…”, and “Thinking…” survives only for the gap where that is honestly all there is to say — before the turn's first frame.
- **A plugin can render its own tool's result** through `COPILOT_TOOL_RESULT_SLOT`. The first consumer is `alarms-admin`. Four rules: a renderer resolves only for a **successful step with output**; the **raw payload stays** (rich rendering is a convenience on top of the receipt, never a replacement for it); the match is **on the exact name** (`mcp.acme.admin_alarms_findings` shares only a suffix, and drawing it with this workspace's component would be an assertion about data nobody here produced); and a component that could not read the payload **returns `null`**.

### The model choice is remembered in three places

None of this pins a branch to a model: every turn still carries its own. All three exist only because the choice was being _forgotten_, which nobody chose.

#### On the chat session

In `useState` it was lost both to minimising the window **and** to leaving the Agents view.

#### In the store's per-tab seed

`rememberChoice`/`seedChoice`: a new chat inherits the last model that was _chosen_.

#### On the branch, in the database

`model_choice` through a `PATCH`. A tab was the ceiling of the previous two: reopening after a reload or in a second tab silently returned you to the house default.

- **Only a _choice_ is written back.** `choicePinned` tells a choice apart from an inherited seed and from a value **adopted** from a branch (`adopt-model`, deliberately not `model`). Otherwise every new conversation would record a decision nobody made.
- **Adopting is not choosing**, so the per-tab seed is untouched: reading an old conversation must not change what the next new chat starts on.
- **`'default'` is a legacy value, read but never written.** It was a third state back when “Default” was a selectable item. A row still carrying it reads as “nobody chose here” and puts the chat on `items[0]`. The sentinel stayed unambiguous only because a real `<provider>:<model>` key always contains a colon.
- **The `PATCH` does not bump `updatedAt`** (the rail sorts on it, and touching the picker is not using the branch) and invalidates only that branch's key.
- **The picker hides** when a deployment offers one backend.

### Surface context

Every turn carries where the user is standing — the workspace, the content type, the entry, the locale — so the model can resolve “this entry” and “here”. It is taken from the **URL** (`readRouteContext`, pure and unit-testable), because `useCurrentWorkspace()` is unusable here: `CurrentWorkspaceProvider` wraps only the workspace shell's inset content, while the application sidebar — where the launcher lives — renders **outside** it, and the hook **throws** there, taking the whole admin UI down on every page.

- **It is opt-in.** An “+ Add context” button attaches the current page, and the chip has an `×`. Attaching automatically was the first version and was wrong: every question looked like a question about the open page, and “how many authors do we have?” from an article list told the model you were looking at articles.
- **`new` and `trash` are not entry ids.** They occupy the `:entryId` slot on the create form and in the trash. Sending `entryId: "new"` would have the model confidently discuss an entry that does not exist.
- **Attached context is shown** (a `ContextChip` above the composer): invisibly attached context is context the user cannot correct when it is wrong.
- **It is not a claim of authority.** `workspaceId` becomes the `X-Workspace-Id` that `WorkspaceGuard` validates; `contentType`/`entryId` reach the model as prompt text, and any tool call using them is re-checked against the workspace's grants. A hand-typed URL gives a user nothing they did not have.

### The panel portals into `<body>` — and has to stay there

The component is contributed to the sidebar's footer, so without a portal the fixed chrome becomes a DOM _descendant of the sidebar_ and inherits its styles. That is not hypothetical: the sidebar sets `text-sidebar-foreground` (near-white for its own dark background), and the panel was drawing near-white text on its own white surface at a contrast of **2.86:1** — substantially below WCAG AA's required 4.5:1, and the first thing people complained about. `createPortal(…, document.body)` fixes the whole class of problems (colour, font, letter-spacing) rather than one symptom, and keeps `position: fixed` out of an ancestor transform's trap. Measured after the fix: **17.67:1**.

### Errors: an alert, a warning, a toast

- **A failed turn → an `Alert variant="destructive"` in the transcript.** It is a record: it stays with the turn it belongs to and survives scrolling. Any text already received is kept above — a partial answer is part of what happened.
- **A truncated run → an `Alert variant="warning"`.** A ceiling is not an error; the answer above is real, just shorter. It used to be muted 12-pixel text under the answer — exactly where “this is incomplete” goes unread. **The reason fragment is a message descriptor per stop reason** rather than a bare string in a map: it completes a translated sentence, and a literal would mean the frame is localised while the half that carries the meaning is not.
- **A system condition → a `toast.error`, but _only while the panel is minimised_.** A toast exists to reach somebody who _cannot see_ the alert. Toasting with the panel open is worse than useless: the host mounts the `Toaster` in the bottom right — exactly where the panel is — and it would cover the composer while announcing something already on screen a few pixels above.
- **The panel's state is read through a ref** rather than a captured value: `send`'s async closure is created at send time, while the failure it handles may arrive seconds later, by which time the panel may have been minimised — which is exactly the case the toast is for.

Other things easy to break: Markdown is rendered by a **small local component** that builds React elements and **never touches `dangerouslySetInnerHTML`** — escaping comes for free, and `href` additionally passes a scheme allowlist, because escaping does not save you from `[click](javascript:…)`. The dock's strip is a `group` rather than a `toolbar`: by the WAI-ARIA APG a toolbar is a _composite_ widget with one tab stop and arrow keys inside, and there is neither a roving tabindex nor an arrow handler here, so the role would promise a keyboard model that does not exist. The `animate-in`/`fade-in-0`/`zoom-in-95` utilities **do nothing** in this workspace — `tailwindcss-animate` is deliberately not installed — so ordinary transitions are used. Eight resize strips: seven are pointer-only and `aria-hidden` (eight focusable splitters would add eight tab stops to a non-modal surface a keyboard user _passes through_), and there are two real controls — the header handle and the north-west corner.

## 11. Configuration

Configuration flows from `apps/server/apograph.config.ts` (the `plugins.copilot` section) into the `CopilotPlugin({ providers, resolve?, skills?, config })` factory. The config type is **deliberately adapter-agnostic**: it names no kind of provider and imports no adapter package, so adding Bedrock or Vertex is a new package and a line in the composition root rather than an edit here.

| `CopilotPluginConfig` field | Type / default       | Environment variable      | Meaning                                                                                                                                                                                                                                                              |
| --------------------------- | -------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| enabled                     | `boolean`, **false** | COPILOT_ENABLED           | The operator's kill switch. Switched off is **not a wiring error**: the controllers are not registered and the routes 404                                                                                                                                            |
| maxOutputTokens             | `number`, 8192       | COPILOT_MAX_OUTPUT_TOKENS | The ceiling on one model reply                                                                                                                                                                                                                                       |
| limits.maxSteps             | 30                   | COPILOT_MAX_STEPS         | Model calls per run                                                                                                                                                                                                                                                  |
| limits.wallClockMs          | 300,000              | COPILOT_WALL_CLOCK_MS     | The whole run's wall clock                                                                                                                                                                                                                                           |
| limits.maxTotalTokens       | 400,000              | COPILOT_MAX_TOTAL_TOKENS  | Input + output + cache writes across the run                                                                                                                                                                                                                         |
| permissionDecisionBudgetMs  | 300,000              | — (none)                  | How long a parked run waits for an answer — **for the whole run**. **Not set by the host**: the field is declared and applied by the factory in `CopilotModule`, but `apograph.config.ts` does not read it, so in practice the default is what applies — see section 16 |

The providers' **connection** settings live **with the host**, in `ApographCopilotConfig.providers`, rather than in the plugin's config. Each key is present **only if this deployment configured it**:

| Key    | Appears when                     | Variables                                                                                                                    |
| ------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| claude | `ANTHROPIC_API_KEY` is set       | ANTHROPIC_API_KEY · COPILOT_ANTHROPIC_MODELS (default `claude-opus-5,claude-sonnet-5,claude-haiku-4-5`) · ANTHROPIC_BASE_URL |
| ollama | `COPILOT_OPENAI_BASE_URL` is set | COPILOT_OPENAI_BASE_URL · COPILOT_OPENAI_MODELS (default `llama3.1`) · COPILOT_OPENAI_API_KEY                                |

`COPILOT_OPENAI_BASE_URL` deliberately has no default: an unset variable means “this deployment has no such backend” rather than “let us assume something is running on this laptop”. Registering a keyless `claude` used to be harmless while a run was served by `COPILOT_PROVIDER`; now it is served by the first registered one, so a keyless `claude` at the top of the list would become the default and fail on the very first message.

### Early validation — at construction, not at boot

`CopilotPlugin` checks **in its constructor**, as `I18nServerPlugin` checks locales and `ContentPlugin` checks its registry:

- At least one provider is registered — **if `enabled`**. An empty list with the copilot off is fine and is the ordinary state of a fresh clone that configures no keys.
- Every provider declares at least one model.
- `maxOutputTokens` is a positive number.
- **Every ceiling in `limits` is a positive finite number.** That is on the list because `maxSteps: 0` used to construct fine and produce a run that never answers at all: `for (step = 0; step < 0; …)` skips the loop, the engine emits `run-started` and then immediately `done` with `max-steps` — no model call, no answer and (since `assistantBlocks` is empty) **no assistant row**, leaving the branch with a question and silence forever. All three ceilings are exposed to the environment, so a typo reaches them.
- `buildSkillRegistry(skills)` is built and thrown away: the point is _when_ — a malformed or duplicated skill fails construction, like a mistyped provider name.
- The “`defaultProvider` names a registered provider” check is gone, along with the setting itself. A typo nobody can write is a check nobody needs.

<details>
<summary>Plugin registration order and three DI traps</summary>

`CopilotPlugin` is registered **after** `WorkspacesPlugin` (runs are workspace-scoped) and `IdentityPlugin` (runs execute as the caller, under `copilot:use`). The module is **global**. It exports `COPILOT_CONFIG`, `MODEL_REGISTRY`, `MODEL_RESOLVER`, `COPILOT_SKILL_REGISTRY` and `ProposalApplierRegistry` — the last so the plugins that own the writes can register their appliers.

**Nest ignores a TypeScript default on a constructor parameter.** It resolves every argument positionally, so `limits: RunLimits = DEFAULT_RUN_LIMITS` fails the boot with an unresolvable dependency. What is needed is `@Optional() @Inject(TOKEN)` with the default in the body — which is how `COPILOT_RUN_LIMITS` is done. And a relative of that: a parameter typed `Foo | null` emits `Object` for `design:paramtypes`, so an `@Optional()` with no explicitly named token silently injects `undefined` even where a binding exists — which is how `COPILOT_ATTACHMENT_RESOLVER` is declared.

**`COPILOT_SKILL_REGISTRY` is always bound** (with an empty registry if the host declared no skills) rather than optionally: “this deployment ships no skills” and “the registry was not wired up” would otherwise be the same missing dependency, and only one of the two is a bug.

**`MODEL_RESOLVER` is bound on both sides of the kill switch**, because a toggle must not change the shape of the DI graph. Asking it for a provider with the copilot off falls into `ModelRegistry.get` with the same error as an unknown name.

</details>

### The system prompt

`SYSTEM_PROMPT_VERSION` = **10**, stamped onto the run; `system-prompt.spec.ts` pins the structure. Three rules when editing it:

- **Every section is conditional on something, and that is the point.** A run's prompt says only what is true of _this_ run. That is exactly why `toolNames` carries the _names_ of the offered tools rather than a count.
- **A specific tool's mechanics belong in its `description`, not in the prompt.** The prompt costs tokens on every run; a description costs them only on the runs that read it, and arrives already in context. The HOW APOGRAPH WORKS section carries only what is true of every deployment and what no individual tool can say: the boundary of a workspace's grants, that `draft`/`published` is the whole set of states, that publication state is the **pair** `status` + `publishedAt`, what a save must contain, numbered versions, and that every locale is its own entry.
- **A rule in the prompt is the right fix only where no tool can provide it.** The v8 case (shared, non-localised fields) is exactly that; closing the gap in `content/server` would be the real fix, and the prompt is no substitute for it.

> **A cautionary tale about the propose rule**
>
> Versions 3 and 4 both said: “any tool whose name begins with `propose`”. Every propose tool is named for its owning plugin first (`content_propose_update`), so the rule **matched nothing**. **A prompt can be wrong in a way that passes typecheck, passes the e2e and reads perfectly well.** v5 names the tool instead of a prefix and adds “despite the name” — because since ADR-0009 the word `propose` argues _against_ the rule it appears in. Until phase 4's offline evaluation suite exists, the spec's conditional-structure cases are all that stands between a prompt edit and production; and note that they would **not** have caught this one.

## 12. Security: what was done and why exactly that way

#### No identity — nothing to escalate

There is no service account. Every run executes as the caller, and `ToolActor.userId` is that caller's id. A prompt injection gives an attacker nothing beyond what the current user could already do: a critical class of bug becomes merely an annoying one.

#### The offer filter is not an optimisation

A tool the model was never told about cannot be requested, argued into existence or refused at the cost of tokens. It is also a cheap second layer on top of the execution check rather than in place of it.

#### The untrusted-content fence

Entry bodies are authored and attacker-influenced. They enter the model **only** inside fenced tool results, explicitly framed as material rather than instructions. The payload is JSON and `<` is escaped. Sanitising “instruction-like text” was rejected as unreliable in principle: structural framing plus an authority ceiling is the defence that holds.

#### The question before, not the audit after

An injected call parks and shows the user its arguments, having done nothing. A refusal comes back as an ordinary tool error, so the model reports it and an answer still arrives.

#### Run ownership is checked by the broker, not by a guard

No route guard can say it: `copilot:use` is held by every role, and `WorkspaceGuard` proves membership of the workspace the caller named. Without an ownership check a colleague could allow or cancel a write in somebody else's chat, and a member of an unrelated workspace could do it by naming their own.

#### No secret reaches the browser

The API key lives in the host's config and is never serialised. The model catalogue returns provider × model pairs and nothing else. An error frame carries a message safe to display — never a stack, a provider payload or anything naming internal wiring.

#### There are no id oracles

Missing attachments and unresolvable skills report a **count**, never which one. The `?conversationId=` filter on `GET /proposals` is honoured only for a conversation the caller owns: otherwise it would undermine the conversation route's 404 from the other side.

#### Publishing is not exposed as a tool

ADR-0005 §7 in code: there is no publish tool for any role. Publishing is the one action whose blast radius reaches outside the CMS, and that is trust we chose to earn later.

### Deliberately deferred

- **Explicit degradation for a weak model.** The baseline API exists and is consumed by nobody; a model that cannot call tools is sent the tools anyway.
- **A runtime model registry with encrypted credentials** (ADR-0004 §5, the `copilot_model_configs` table) — not built. The `copilot:configure` permission that would guard it was removed from the catalogue.
- **A shared channel for the permission broker** — needed with more than one instance.
- **An offline evaluation suite** (a fixture workspace + expected tool calls), so a prompt edit can be reviewed like code.
- **Per-role rate limits** instead of excluding roles from the feature.
- **There is no whole-run undo.** Undo is per entry, through revisions; a run that touched a dozen entries requires a dozen restores.
- **A run does not outlive its tab.** The server treats a disconnect as a cancellation.
- **There is no queued review (where somebody other than the asker approves), and no setting for one.** The prompt is synchronous and belongs to whoever is driving the run. The levers are `copilot:use` per role and the global kill switch.

## 13. Invariants

Statements that must always hold. This is at once a review list and a draft set of test assertions.

- **I-01** — The copilot has no identity of its own: every run executes as the caller, and `copilot_proposals.created_by` is always a person.
- **I-02** — The capability profile is **recomputed on every run** and re-checked **on every tool call** against freshly resolved grants. Nothing is cached across a conversation.
- **I-03** — An observer is offered no tool with an `effect` other than `read`. That is a unit test over a pure function rather than an e2e hope.
- **I-04** — No publish tool exists for any role (ADR-0005 §7).
- **I-05** — The one point of call authorization is `ToolRegistry.call`, checking `requires` before dispatch; the offer filter is only a convenience on top of it.
- **I-06** — The first declaration of a tool name wins; a later one goes into `withheld` with `duplicate-name` and cannot pass itself off as a native tool.
- **I-07** — A `propose`/`apply` tool absent from the branch's `allowed_tools` **parks the run before execution**. Reads never ask.
- **I-08** — `allowed_tools` is read **per call** rather than per run, and appended to in SQL.
- **I-09** — Only **a parked run's own user, in their workspace**, may answer it or extend its deadline; everything else is the same 404 as “nothing is waiting”.
- **I-10** — The waiting budget is **per run** rather than per call; an exhausted one refuses immediately without holding the connection.
- **I-11** — Every broker exit — an answer, a timeout, an abort — clears the entry; no dangling promises remain.
- **I-12** — The `copilot_proposals` row is written **by the engine and before the apply**; a binder that wrote directly would be a change with no receipt.
- **I-13** — The apply goes through the owning plugin's `ProposalApplier`, which calls the **ordinary use case** with a person as the actor: the same validation, the same revision, the same activity row.
- **I-14** — The status is flipped by a `status = 'pending'` predicate **before** the write, so the applier is unreachable twice for one row.
- **I-15** — A failed apply reopens the row as `pending` with the message; `pending` means **failure**, and nobody retries automatically.
- **I-16** — The audit row agrees with the **outcome** rather than with the dispatch: a failed apply gives `ok = false`.
- **I-17** — A row is written for **every attempt** at a tool call — succeeded, failed, and refused by the user or by a timeout.
- **I-18** — `executeTool` **never throws**: an unknown tool, a revoked permission, malformed arguments, a failed tool — all come back as tool errors, and the run carries on.
- **I-19** — A repeated identical call (the name + the arguments with sorted keys) is rejected **with an explanation**, and the check runs **after** authorization.
- **I-20** — Every tool result enters the model through `fenceUntrusted`; the closing delimiter cannot be forged from inside, and exceeding the size is replaced by an envelope that **declares** the truncation.
- **I-21** — A run is bounded by three ceilings; the wall clock is checked **before every tool call as well**, and a call refused on a ceiling still returns a `tool_result`.
- **I-22** — Exactly one `done` ends the stream; an abort ends the stream rather than throwing out of it; an aborted call reports **zero** spend. Verified by the conformance suite on all three adapters.
- **I-23** — `text-delta` is forwarded through `yield*` as it arrives; collecting into an array and flushing afterwards would disable streaming invisibly.
- **I-24** — The user's message is stored **before** the model call; attachments and skills are resolved **before** the conversation is touched.
- **I-25** — The assistant's turn is stored even on a cancellation and a failure; the transcript is append-only and is not edited after the write.
- **I-26** — An attachment shortfall and unresolvable skills report a **count**, never which id or name.
- **I-27** — A run request carries skill **names**, never instruction text; an `always` skill is applied on the server regardless of what the client sent.
- **I-28** — A skill has and can have no field narrowing or widening the tool set: a skill changes _how_, never _what is allowed_.
- **I-29** — A code-defined skill wins a name collision; the CMS row is discarded, and the write routes refuse a colliding name up front (409).
- **I-30** — Every repository method reachable from a route filters on both `userId` and `workspaceId`; “no such thing” and “not yours” give the same 404.
- **I-31** — `modelChoice` is validated against `ModelRegistry.catalogue()` on write and cannot name a backend the operator did not configure.
- **I-32** — `PATCH /conversations/:id` **does not bump `updatedAt`**, and the ownership predicate sits in the `UPDATE` itself.
- **I-33** — A conversation cannot be deleted, only archived; the active and archived lists are **disjoint**. A skill can be deleted.
- **I-34** — With `enabled: false` **no controller at all** is registered, while the shared `ToolRegistry` stays identical on both sides of the toggle.
- **I-35** — `CopilotPlugin` refuses to construct with the copilot enabled and no providers, with a provider that has no models, with a non-positive `maxOutputTokens`, or with any non-positive ceiling.
- **I-36** — A vendor SDK is imported by **only** `provider-anthropic`; `copilot-domain` has no `dependencies` block at all.
- **I-37** — `provider-fake` is marked `private` and excluded from the release projects; no composition root registers it.
- **I-38** — Attaching a file gives the copilot no new write path: the upload is an ordinary `POST /api/media/assets` under the user's own `media:create`.
- **I-39** — Client-disconnect detection hangs on `res`, never on `req`.
- **I-40** — The admin UI treats the copilot as switched off **only** on an explicit 404 from the model catalogue; a load, a 5xx, a 403 and a network failure all leave the surfaces in place.
- **I-41** — The permission prompt shows the reader no time limit: no countdown, no warning and no extend button. While it is open on a visible tab it extends the run's budget itself, so the limit it removes from the screen is one it also removes from the reader's experience — not one it merely stopped displaying. A prompt whose run did expire still says so.
- **I-42** — The create form is its own run surface (`create`), never `records`. The context carries the content type and no entry id, and the prompt tells the model the record does not exist yet — so “this entry” cannot resolve to one the person is not on.

## 14. Testing checklist

Phrased as “action → expected result”, so they can go into a test case without rewriting. The existing suites: `apps/server-e2e/src/server/copilot/*` (7 files: chat, conversations, media-files, proposals, read-catalogue, run-authority, skills) and `apps/admin-e2e/src/copilot/*` (9 files: a11y, agents-attachments, agents-chat, agents-manage, agents-skills, agents-view, dock, skills-manage, view-switcher). Unit tests: `chatReducer`, `panelFrame`, `sessions`, `groupConversations`, `agentsRoute`, `ToolStep/labels`, `copilotSlots`, `MessageList/activity`, `tabBadge`, `useCopilotModels`.

### Authority

- **A run as an observer** → `calls[0].tools` contains no tool with an `effect` other than `read`; the prompt has no MAKING CHANGES section.
- **A run as a contributor** → `content_propose_create/update` are offered, but not `activity_recent` (which needs `activity:read`) and not `content_propose_access` (which needs `segments:manage`).
- **Revoke the role mid-way through a long turn** → the next tool call refuses with “You are not permitted to use …”, a warning is logged, and the run carries on.
- **The model asks for a nonexistent tool** → a tool error, “Unknown tool "…"”, the run carries on, and an audit row with `ok = false`.
- **The model asks for a withheld tool** → the same message as for a nonexistent one.
- **A request with invalid arguments** → “Invalid arguments: …”, and the run carries on.
- **Two tools with the same name in the registry** → the first is offered; the second is in `withheld` with `duplicate-name`.
- **Any role looks for a publish tool** → no such tool is in the catalogue.

### The question before a write

- **The first `propose` call in a fresh branch** → a `tool-permission-request` frame with the arguments and an `expiresAt`; nothing has been written.
- **Answering `deny`** → a tool error, “the user did not allow it”, a `copilot_tool_calls` row with `ok = false`, and the run reaching an answer.
- **Answering `once`, then the same tool again** → asked again; `allowed_tools` is empty.
- **Answering `chat`, then the same tool again** → not asked a second time; the name is in `allowed_tools`.
- **Two `propose` calls in one turn, with `chat` answered on the first** → the second does not ask (the list is read per call).
- **An answer from _another_ user of the same workspace** → 404, and the run stays parked.
- **An answer from a member of an unrelated workspace who named their own** → 404.
- **An answer after the timeout** → 404; the prompt in the interface **keeps its buttons** and says the answer did not get through.
- **Nobody answers** → a refusal with “nobody answered”, an audit row with `ok = false`, and the model's answer arriving all the same.
- **A turn with thirty writes** → the total waiting does not exceed the run's budget; exhausting it refuses **without** holding the connection.
- **Press “I need more time”** → `200` with a new `expiresAt`; the countdown restarts.
- **Extend somebody else's parked run** → 404.

### The write and the receipt

- **A successful apply** → a `copilot_proposals` row with `status = accepted`, `decided_by`/`decided_at` filled in and a `result.entityId`; an activity-journal row attributed to the **person** rather than the copilot; and an entry revision created.
- **An apply that fails (validation)** → the row returns to `pending` with an `error`; a `tool-result` with `ok = false`; the `proposal` event carries the `error`; and the card draws a destructive “Not saved” badge.
- **A `propose` tool returned something other than a `ProposalDraft`** → an ordinary tool error, **no row created**, and an error in the log.
- **No applier registered for the `kind`** → the row stays `pending`, a loud log entry, and the message “cannot be applied by this deployment”.
- **Trying to apply an already-applied row** → an `already-decided` refusal; no second write.
- **A bulk save of twelve entries** → **one** proposal row, **one** card, one `kind` of `content.entry.bulk-save`.
- **The `POST /copilot/proposals/:id/accept` route** → 404 — no such route exists.
- **`GET /copilot/policy`** → 404; the `copilot_workspace_policies` table is not in the database.
- **`GET /proposals?conversationId=` with somebody else's branch** → 404 rather than an empty list.

### Run limits

- **`maxSteps` = 1, and the model asks for a tool** → `done` with `stopReason: 'max-steps'`; the interface draws a warning rather than an error.
- **`maxSteps: 0` in the config** → the application **does not start** — validation at construction.
- **The wall clock expires inside a multi-tool turn** → the remaining calls get a `tool_result` with the error “reached its time limit”, the run ends on `timeout`, and there is no malformed turn.
- **A small token ceiling** → the run ends on `max-tokens` **after** the step that overshot it — the overshoot is expected and documented.
- **A run with caching on** → cache reads are **not** charged to the ceiling; writes are.
- **The model asks for one call twice with the same arguments in a different key order** → the second is rejected with an explanation (stable serialisation).
- **The client disconnects mid-answer** → the run is cancelled; the assistant's turn is stored with `stopReason: 'aborted'`; the aborted call's spend is **zero**.
- **Open a run and stay connected while idle for > 15 s** → `: ping` frames arrive.

### Attachments and skills

- **Attach another workspace's asset** → an error frame, “One of the attached files is no longer available” — **without** saying which; the conversation is untouched.
- **Attach one file twice** → it collapses; no error.
- **Attach 9 files** → `400` from `ArrayMaxSize`.
- **A deployment with no media plugin** → “Files cannot be attached in this deployment” — as a sentence, not as an upload error.
- **Ask about an attached file three turns later** → the attachment manifest is visible to the model from the history, fenced.
- **Send a `skills` name that is not in the catalogue** → the run ends with a message naming the **count**, not the name.
- **Send 4 skills** → `400`.
- **Send an `instructions` field in a run's body** → `400` — an undeclared property.
- **An `always` skill in the workspace that the client did not name** → it is in force anyway; `copilot_messages.skills` contains it.
- **Create a skill with a name a code-defined skill holds** → `409`.
- **An empty skill patch** → `400`.
- **Rename a skill and re-read an old branch** → the chips show a snapshot of the **old** title.
- **A contributor requests `GET /copilot/skills/manage`** → `403`; the rail has no link to the skills page.
- **A contributor requests `GET /copilot/skills`** → `200` — using a skill requires nothing beyond `copilot:use`.

### Model providers

- **A run names an unregistered provider** → an error frame carrying its name; the catalogue is public to anyone with `copilot:use`, so that is safe.
- **A run names a model outside the provider's list** → an `UnknownModelError` — **before** a request is issued (the `unknown-model-costs-no-request` conformance check).
- **A run names nothing** → the **first registered** one serves it; `copilot_messages.provider`/`model` are filled in with whoever actually answered.
- **Adapter conformance** → all 12 checks green on anthropic, openai and fake.
- **Anthropic with no network during `capabilities()`** → the promise **rejects** rather than resolving to the fallback — the fallback is not cached as an answer.
- **The OpenAI adapter: a 429 before the first event** → retries up the ladder; the timeout budgets the **whole** ladder.
- **The OpenAI adapter: malformed JSON in the arguments** → `{}` instead of a crash; then a schema-validation refusal as an ordinary tool error.
- **The server pointed at a deliberately slow endpoint** → the frames arrive as they are generated rather than in a batch at the end (the only way to check streaming for real).
- **`COPILOT_ENABLED=true` with no backend configured** → the application **does not start**, and the message names what to do.

### The admin UI

- **A permission prompt appears** → focus moves to the primary button; the arguments block is reachable as the `aria-describedby` and is itself focusable.
- **Start an answer in Agents and go to the CMS** → the chat becomes a streaming pill in the dock; on completion, “finished” and a `(1)` in the tab title.
- **Leave Agents with an _idle_ chat** → the chat closes rather than staying as a pill.
- **Open a branch from the rail that another window already holds** → the existing window is focused; no second transcript appears.
- **The same from the panel's history dropdown** → the same behaviour (`onAdoptConversation`).
- **Press “New chat” while in a branch** → the URL goes to the base path and does **not** bounce back into the branch you left.
- **Switch branch while an answer is streaming** → the URL obeys the user; the cancelled answer is **not** appended to the conversation that replaced it.
- **Minimise the window during a run** → the run carries on; focus goes to the dock's new-chat button rather than to `<body>`.
- **Escape in a panel window** → minimises it into the dock; it does **not** close or cancel.
- **Open a fourth window** → the oldest visible one minimises and keeps working; nothing is refused.
- **Pick a model, go to the CMS and come back** → the choice is kept; reopening the branch in a second tab offers the same one.
- **Merely read an old conversation on a different model** → the per-tab seed does **not** change; nothing is written to the database.
- **Archive the open branch** → a new chat begins; the “Archive” link appears.
- **Rename a branch from the row's menu** → after the dialog closes, focus returns to the row's menu button rather than to `<body>`; `updatedAt` is **unchanged** and the rail's order is preserved.
- **A turn with prose, a step, a card and prose again** → the block order in the live transcript and in the reopened one match.
- **A model answer containing a pipe table** → it renders as a table rather than as one run-together line.
- **An answer containing `[click](javascript:alert(1))`** → the link is inert; the markup does not execute.
- **A tool `summary` containing a bidi override** → stripped; the step line renders as a text node.
- **An observer opens the composer** → there is no paperclip (`media:create` is absent); the skills button **is** there.
- **Send while a file is uploading** → sending is blocked, and the reason is **said** in a live region under the field.
- **Send while a run is in progress** → the text is preserved **and** the tooltip explains why it did not go.
- **Scroll up while an answer is arriving** → the transcript does **not** drag you back down on the next token.
- **`COPILOT_ENABLED=false`** → no launcher and no `ViewSwitcher`; the Agents and skills pages reached by a bookmark draw a “switched off” state rather than a screen of 404ing requests.
- **The server returns a 500 on the model catalogue** → the surfaces **stay**: only an explicit 404 reads as switched off.
- **An axe scan of every state** → no violations; the rail's group headings use the full `text-muted-foreground` rather than a transparency of it.

## 15. Boundaries of responsibility

| Area                                           | Who owns it                                                           | What Copilot does                                                                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The database connection and running migrations | `@apograph/database` + `@apograph/nx`                                 | Owns the schema and migration **files**, but neither the connection nor the apply step                                                                                    |
| The permission catalogue and the roles         | `identity-server`                                                     | `copilot:use` and `copilot:skills:manage` are declared **there**; here they are only read through `PermissionsService.forRole`                                            |
| The tool registry and call authorization       | `@apograph/tools-server`                                              | **Imports** `ToolsModule` rather than providing it. Its own contribution is only the narrowing to the `copilot` surface and the `withheld` reasons                        |
| The tools themselves                           | `content`, `i18n`, `media`, `activity`, `users`, `alarms`, `segments` | Imports none of them. Each tool is a thin wrapper over the same service the HTTP controllers call                                                                         |
| Carrying a change out                          | The plugin that owns the data, through a `ProposalApplier`            | Writes the receipt row, flips the status and hands the change to the applier. **It writes nothing itself**                                                                |
| Resolving attachments                          | `media/server`, through `COPILOT_ATTACHMENT_RESOLVER`                 | Declares the port in the domain and injects it `@Optional()`. A deployment without media binds nothing, and attaching fails as a **sentence** rather than an upload error |
| The action journal                             | `activity`                                                            | The audit of **tool calls** is its own (`copilot_tool_calls`). The activity row for a change is written by the use case the applier called                                |
| Checking workspace membership                  | `workspaces-server`                                                   | Puts `WorkspaceGuard` on every route except the model catalogue (which is deployment-wide)                                                                                |
| The second consumer of the same registry       | `mcp-server`                                                          | Does nothing for MCP, but **must account for it**: a tool with no `surfaces` field is given to both                                                                       |
| Uploading a file                               | `media-admin` / `media-server`                                        | The composer calls the ordinary `POST /api/media/assets`; the run receives only an id                                                                                     |
| Mounting the surfaces                          | `shell-admin` and `workspaces-admin`                                  | Supplies contributions into their slots but does not decide where those slots are                                                                                         |
| Publishing content                             | A person, by hand                                                     | Prepares a publishable draft. **No publish tool exists**                                                                                                                  |

### What else is missing

- **Explicit degradation for a weak model.** `SUPPORTED_BASELINE`, `baselineShortfalls` and `meetsSupportedBaseline` exist and are consumed by nobody; `capabilities()` is called by nobody outside the specs. **Do not delete them in a dead-code sweep** — the API's shape is right, what is missing is the wiring.
- **Runtime model registration** with encrypted credentials (ADR-0004 §5). The permission that would guard it has been removed.
- **A run that outlives its tab.** That needs a detached run, frame replay on reconnect and sticky routing.
- **A whole-run undo.** Per entry only, through revisions.
- **A workspace-wide “what has the copilot changed” summary** — ADR-0009 admits outright that it is worth building: a workspace should be able to see this without opening a branch.
- **Automatic skill selection.** The model can name a skill and ask a person to attach it, but cannot load one itself. The way out is a server-side pre-pass before the first model call, not a tool.
- **A workspace's ability to disable a code-defined skill.** Deferred: it would make a code skill's behaviour unreadable from the repository, which is what code skills exist for.
- **Skill versioning and review of edits to them.** The transcript snapshots the _name_ rather than the body a turn actually ran with.
- **A roving tabindex in the dock's strip** — which is why it is declared a `group` rather than a `toolbar`.

## 16. Where the code and the documentation diverge

Found while reconciling this dossier with the sources. Not product bugs in themselves, but they mislead developer and tester alike — and the first two mislead the model as well.

| Where                                                                                                                                              | What it says                                                                                                                                                                                                                                                                                 | How it actually is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| content/server · entry-proposal.provider.ts<br>media/server · alt-text-proposal.provider.ts<br>segments/server · entry-access-proposal.provider.ts | The tool descriptions **the model reads** say: “This does NOT create anything — it drafts the change and **asks the user to approve it**, and the reply will say so”; and `content_propose_bulk_save`'s says “the user sees one **approval card**”                                           | There has been no approval step since ADR-0009: the engine applies a proposal immediately. **The same build's system prompt says the exact opposite**: “Any tool with "propose" in its name … SAVES the change immediately, despite the name. There is **no approval step**. Do not tell the person a change is waiting for them — nothing is.” The model receives two mutually exclusive statements in one context, and the one in the tool description arrives closer to the moment of the call. This is exactly the failure SYSTEM_PROMPT_VERSION 4 and 5 were rewritten to prevent |
| copilot/server · chat/infrastructure/schema/proposals.ts                                                                                           | The table's docblock is headed “**The accept boundary**”, says “a human decides” and “a workspace that opted a tool into auto-apply”; the comment on `tool_name` claims that “accepting re-resolves the capability profile and requires this tool to still be offered to the accepting user” | The accept boundary does not exist: there is no `accept`, no `reject` and no per-workspace opt-in (the table was dropped by migration `0002`). No profile is re-resolved on acceptance — `DecideProposalService` explicitly documents that it has no permission check of its own. The text describes removed machinery                                                                                                                                                                                                                                                                 |
| copilot/admin · AGENTS.md, the final “Testing” section                                                                                             | “**One known gap, and it is a defect**”: the panel's history dropdown supposedly calls `chat.load()` directly, so two windows _can_ end up on one `conversationId`                                                                                                                           | **Already fixed in the code.** `CopilotPanel` calls `onAdoptConversation?.(…)` and returns without loading on a `false`; `CopilotLauncher.adoptConversation` looks for an existing session with the same `conversationId` and focuses it. The same document **contradicts itself** — its “Several chats at once” section describes the fix as done (“from _both_ paths”)                                                                                                                                                                                                               |
| copilot/server · AGENTS.md, “What exists today”                                                                                                    | “`CopilotModule.forRoot(...)` … and **mounting four routes**”                                                                                                                                                                                                                                | There are **fifteen** routes. Even the same file's own tables list thirteen — and do **not** contain `POST /runs/:runId/permission` or `POST /runs/:runId/permission/extend`, so the route for ADR-0009 §1b's central mechanism is absent from the route table                                                                                                                                                                                                                                                                                                                         |
| copilot/server · AGENTS.md, “Schema”                                                                                                               | “**Five tables**”, followed by a table with **four** rows                                                                                                                                                                                                                                    | There really are five tables; `copilot_skills` is missing from the enumeration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| copilot/server · AGENTS.md, “The tool seam”                                                                                                        | The tool matrix lists the owners `content`, `i18n`, `media`, `activity`, `users`                                                                                                                                                                                                             | Two tools are **absent** from it: `admin_alarms_findings` (`alarms/server`, `alarms:read`, `surfaces: ['copilot']`) and `content_propose_access` (`segments/server`, `segments:manage`, `effect: 'propose'`). The matrix counts seven propose tools; the code has eight                                                                                                                                                                                                                                                                                                                |
| copilot/server · list-models.controller.ts                                                                                                         | The docblock: “(… with encrypted credentials, is the separate phase-4 surface behind `copilot:configure`.)”                                                                                                                                                                                  | There is no `copilot:configure` in the `PERMISSIONS` catalogue — ADR-0009 §4 removed it. A reference to a key that does not exist                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| copilot/server · types/copilot-config.ts                                                                                                           | `permissionDecisionBudgetMs` is documented as operator-configurable: “What the limit protects is … the _operator's_ cost … so an operator who can afford more should be able to say so”                                                                                                      | The field is **set by nobody**: `apps/server/apograph.config.ts` does not read it and there is no environment variable for it (unlike all three `limits` ceilings). In practice `DEFAULT_RUN_DECISION_BUDGET_MS` = 5 minutes always applies. The configurability exists only as a TypeScript parameter                                                                                                                                                                                                                                                                                    |
| docs/adr/0004, §3 and §5                                                                                                                           | §3 calls the second adapter `copilot-provider-openai-compatible`. §5: “an admin holding `copilot:configure` may register a model at runtime … persisted in `copilot_model_configs`. Credentials are **encrypted at rest**”                                                                   | The package is called `@apograph/copilot-provider-openai` (the rename is documented in its own AGENTS.md but not in the ADR). There is no `copilot_model_configs` table, no encryption at rest in the codebase and no `copilot:configure` permission. The ADR's status is “Proposed” and §5 remains unshipped intent, but it reads as a description of something that exists                                                                                                                                                                                                           |
| docs/adr/0004, §4                                                                                                                                  | “Providers declare their capabilities, and the engine **degrades explicitly**. When tool calling is absent the engine falls back to a constrained single-shot protocol … and the UI states the active mode in words”                                                                         | Not implemented, and `copilot/domain/AGENTS.md` records that honestly (“Nothing consumes it yet”) while the ADR does not. A model that cannot call tools is still sent the tools                                                                                                                                                                                                                                                                                                                                                                                                       |
| docs/design/copilot.md, §2                                                                                                                         | The panel opens “from a **floating button** in that corner, from the sidebar footer, or with `⌘J`”                                                                                                                                                                                           | There is no floating button: the dock replaced it, and then the sidebar row went too. `copilot/admin/AGENTS.md` describes this in detail; the design document has not been updated                                                                                                                                                                                                                                                                                                                                                                                                     |
| docs/design/copilot.md, the “Status” header                                                                                                        | “Phase 2 (**export**) is the next buildable slice”                                                                                                                                                                                                                                           | Content export and import shipped as a separate `packages/transfer/*` plugin (ADR-0014) rather than as a copilot phase. The wording describes a plan development went around                                                                                                                                                                                                                                                                                                                                                                                                           |
| docs/adr/0005, §2 and §6                                                                                                                           | §2: the profile is “intersected with workspace membership and **the workspace's copilot policy**”. §6: “Direct apply is a per-workspace, per-tool policy an admin opts into”                                                                                                                 | Formally closed by amendments in ADR-0005's header and in ADR-0009, but the text of §2 and §6 themselves was never rewritten — a reader opening the record in the middle gets a description of removed machinery. `resolveCapabilityProfile` takes **only** a tool list and an actor                                                                                                                                                                                                                                                                                                   |

> **The first divergence is not cosmetic**
>
> The `propose` tools' descriptions and the system prompt's MAKING CHANGES section **contradict each other in the same context of the same run**. The prompt was rewritten precisely because the failure inverted: the risk used to be a model announcing “done” about an unsaved change, and is now a model hedging (“I have drafted this for your approval”) about a write that already happened. The tool descriptions teach exactly that hedging, and they teach it closer to the decision point. This is the first thing in the group worth fixing.

---

**One of a series.** Written for the `packages/copilot` group on the same frame as the Identity dossier: business description → composition → providers → authority → tools → data → the run's lifecycle → scenarios → API → admin UI → configuration → security → invariants → checklist → boundaries → divergences. Sections the plugin has no use for are dropped; the ones specific to it — the model-provider matrix, the tool registry and the agent's authority model — are added.

The source is the source code: `copilot.module.ts`, `copilot-plugin.ts`, the seven controllers and their DTOs, `run-engine.service.ts`, `tool-permission.broker.ts`, `decide-proposal.service.ts`, `capability-profile.service.ts`, `system-prompt.ts`, the Drizzle schema and the seven migrations, the domain's `capability-profile.ts` / `run-limits.ts` / `run-event.ts` / `conformance.ts`, the three adapters, the admin plugin and its slots, plus `apps/server/apograph.config.ts` and `plugins.ts`. `docs/adr/0004`, `0005`, `0007`, `0009`, `0010` and `docs/design/copilot.md` were read. The `AGENTS.md` files were used as the frame, but every claim was checked against the implementation — the divergences are gathered in section 16.
