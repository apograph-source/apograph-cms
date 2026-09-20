# @orthacms/copilot-server

The copilot **plugin**. Phase 0 bound the model seam; **phase 1 added the chat
vertical slice** — the SSE run route, the bounded run engine, the capability
profile, and the transcript this plugin now owns and migrates
([`docs/design/copilot.md`](../../../docs/design/copilot.md) §9).

## What exists today

- `CopilotPlugin({ providers, resolve?, config })` — the standard `ServerPlugin`
  shape with `copilotConfig` attached and a `migrations` descriptor.
  `providers` is a **list** of `{ name, provider }`, in preference order.
- `CopilotModule.forRoot(...)` — a **global** dynamic module binding
  `COPILOT_CONFIG`, `MODEL_REGISTRY`, `MODEL_RESOLVER` and the chat services,
  and mounting four routes.
- `buildModelRegistry(registrations)` — the immutable name→provider lookup,
  plus `catalogue()`: every provider × model pair on offer, in registration
  order. That is exactly what `GET /api/copilot/models` serves.

### Routes

| Route                                  | Guards                                              | Notes                                                       |
| -------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| `POST /api/copilot/runs`               | `OriginGuard`, `PermissionsGuard`, `WorkspaceGuard` | SSE. One turn.                                              |
| `GET /api/copilot/models`              | `PermissionsGuard`                                  | The catalogue. Deployment-wide, so **no** `WorkspaceGuard`. |
| `GET /api/copilot/conversations`       | `PermissionsGuard`, `WorkspaceGuard`                | This user's threads. `?archived=true` for the filed ones.   |
| `GET /api/copilot/conversations/:id`   | `PermissionsGuard`, `WorkspaceGuard`                | Thread + transcript. Serves archived threads too.           |
| `PATCH /api/copilot/conversations/:id` | `OriginGuard`, `PermissionsGuard`, `WorkspaceGuard` | Rename, archive, and/or record the model picked.            |
| `GET /api/copilot/proposals`           | `PermissionsGuard`, `WorkspaceGuard`                | The record of what changed.                                 |
| `GET /api/copilot/proposals/:id`       | `PermissionsGuard`, `WorkspaceGuard`                | One change.                                                 |
| `GET /api/copilot/skills`              | `PermissionsGuard`, `WorkspaceGuard`                | The picker's catalogue. **No instruction bodies.**          |

All of the above require `copilot:use`. The skills **write** routes require
`copilot:skills:manage` instead — admin-only, see [Skills](#skills):

| Route                            | Guards                                              | Notes                                            |
| -------------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| `GET /api/copilot/skills/manage` | `PermissionsGuard`, `WorkspaceGuard`                | Every skill, disabled and code-defined included. |
| `GET /api/copilot/skills/:id`    | `PermissionsGuard`, `WorkspaceGuard`                | One skill, body included.                        |
| `POST /api/copilot/skills`       | `OriginGuard`, `PermissionsGuard`, `WorkspaceGuard` | 409 on a name either source already holds.       |
| `PATCH /api/copilot/skills/:id`  | `OriginGuard`, `PermissionsGuard`, `WorkspaceGuard` | 400 on an empty patch.                           |
| `DELETE /api/copilot/skills/:id` | `OriginGuard`, `PermissionsGuard`, `WorkspaceGuard` | A real delete — see below.                       |

**Archiving is the only removal, and there is deliberately no delete.** A
thread's `copilot_proposals` rows are the receipts for changes that were actually
made to the caller's content (ADR-0009), so dropping a conversation would take
the only record of those edits with it. `PATCH` sets `archived`, which moves the
thread between two **disjoint** lists — `GET /conversations` serves one or the
other, never both, or the flag would mean nothing to whoever reads the list. The
transcript is untouched and `GET /conversations/:id` still serves it, so a link
to an archived thread keeps working. If a hard delete is ever added it has to
answer for the proposals first.

Three things in the PATCH worth keeping:

- **`updatedAt` is not bumped.** It means "last used" and the list sorts by it;
  a rename would otherwise send a thread nobody has spoken to in a week to the
  top. Covered by a case in `copilot-conversations.spec.ts` — and it matters
  more now that `modelChoice` is patchable, because the client writes that as a
  side effect of somebody touching a picker.
- **The ownership predicate is in the `UPDATE`**, not a read beforehand, so
  there is no check-then-write window — and a miss is a flat 404 for "not yours"
  and "no such id" alike, matching the read routes.
- **`modelChoice` is validated against `ModelRegistry.catalogue()`.** It is a
  value the caller writes, the picker renders back, and the next run is offered
  as its `provider`/`model` — so an unchecked string would be both stored user
  input on the way to the UI and a run that could only fail. Checking it against
  the boot-time registry keeps it inside what the operator already configured,
  the same boundary the run route enforces when a request names a provider.

**`modelChoice` is a memory, not a pin.** A run still carries its own provider
and model per turn (`CreateRunDto`), and nothing about the column constrains the
next one — it is what the client _seeds_ the picker from when a saved thread is
reopened, which is the half of "don't forget my model" no browser-side state can
do. Two live states: `null` is "nobody has picked on this thread" (the client
falls back to the catalogue's first entry), and `'<provider>:<model>'` is a
registered backend. A third, `'default'`, is **legacy** — it meant "the person
picked the host's resolver", from when the picker offered that and the
deployment had a `defaultProvider` behind it; it is still accepted and still
read, and reads back as "nobody picked". One nullable text column rather than a
`provider`/`model` pair is what let the states be told apart at all;
`'default'` cannot collide with a real key because a key always contains a
colon.

The proposal routes are **reads only** — the
accept/reject pair and the `GET/PUT /api/copilot/policy` pair were deleted by
[ADR-0009](../../../docs/adr/0009-copilot-applies-directly.md), along with
`copilot:configure` itself. Whether a caller may make a change is decided once,
by the capability profile, before the tool is ever offered.

## Three things that will bite you

These are spike findings from phase 1, each now covered by a test.

- **Client-disconnect detection hangs off `res`, never `req`.** Express has
  consumed the request body before a handler runs, and a fully-consumed
  `IncomingMessage` emits `'close'` immediately — while the client is still
  connected and waiting. Wiring an abort to `req.on('close')` cancels every run
  the instant it starts, and because `writeHead` hasn't flushed, it presents as
  a request that **hangs with no response** rather than as an error. See
  `SseStream.onClientDisconnect`.
- **The strict global `ValidationPipe` traverses nested DTOs only with
  `@ValidateNested()` + `@Type()`.** Without them, `context` is not treated as a
  DTO at all: the whitelist strips its properties and the handler silently gets
  `{}`. `forbidNonWhitelisted` 400s an unknown _top-level_ key by name, which is
  loud; this failure is silent.
- **Nest ignores a TypeScript default on a constructor parameter.** It resolves
  every argument positionally, so `limits: RunLimits = DEFAULT_RUN_LIMITS` fails
  boot with an unresolvable dependency. Use an `@Optional() @Inject(TOKEN)`
  parameter and apply the default in the body — see `COPILOT_RUN_LIMITS`.
  Relatedly, a parameter typed `Foo | null` emits `Object` for
  `design:paramtypes`, so an `@Optional()` one silently injects `undefined`
  unless you name the token explicitly.

## The tool seam — shared with MCP

`copilot/server` must not import `content-server`, and it no longer owns a tool
registry either. Both facts are settled by
[ADR-0007](../../../docs/adr/0007-one-tool-registry-two-surfaces.md):

- **The catalogue is `@orthacms/tools-server`'s `ToolRegistry`** — the same
  instance the MCP endpoint serves. `CopilotToolRegistry`,
  `COPILOT_TOOL_PROVIDER`, `ToolSpec` and `copilotToolsRegistrar` are gone. A
  binder implements `ToolProvider`, injects `ToolRegistry` `@Optional()`, and
  registers itself from `onModuleInit`.
- **`ToolsModule` is imported by this module**, not provided by it, so a
  deployment running the copilot _without_ MCP still has a registry and one
  running both has exactly one.
- **A copilot tool declares `surfaces: ['copilot']` when — and only when — it
  has a reason to.** It is not decoration: the content tools read the _admin_
  services (a viewer must see drafts) and the write half produces proposals only
  the chat panel can accept, so an MCP client reaching one would see unpublished
  content or create a change it cannot apply. The cross-surface e2e cases in
  both suites are the guard.

    It is not a default either. A tool with none of that tension — no draft
    visibility, no write, no user-only attribution — **omits the field and is
    offered to both**; `i18n_locales_list` and the three `media_*` reads already
    are, which means a change to one of them changes what the MCP endpoint
    exposes. Adding a tool here means working the checklist in
    [`tools/server`](../../tools/server/AGENTS.md#adding-a-tool-decide-surfaces-deliberately)
    first, and recording the answer in a comment whichever way it goes.

- **`ToolRegistry.call` is the authorization boundary**, checking `requires`
  before dispatch. The engine's offer is a usability filter on top.
- What stays here is the copilot-specific narrowing: `CapabilityProfileService`
  builds a `ToolActor` (`kind: 'user'`) and hands `forSurface('copilot')` to the
  pure `resolveCapabilityProfile`, which returns the offer plus the `withheld`
  reasons. It used to add a second gate — a per-workspace opt-in an `apply` tool
  had to appear in — and ADR-0009 removed it: a write tool is offered on the
  strength of its declared permissions, exactly like a read one.

Every tool ships with the plugin that owns its data, as a thin wrapper over the
same service the HTTP controllers call:

| Plugin     | Tools                                                                                                               | Surface  |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | -------- |
| `content`  | `admin_content_types`, `admin_content_search`, `admin_content_get`, `admin_content_revisions`, `admin_content_diff` | copilot  |
| `i18n`     | `i18n_translations_get`                                                                                             | copilot  |
| `i18n`     | `i18n_locales_list`                                                                                                 | **both** |
| `media`    | `media_assets_search`, `media_folders_list`, `media_asset_read`                                                     | **both** |
| `activity` | `activity_recent` — deployment-wide, `activity:read` (admin only)                                                   | copilot  |
| `users`    | `workspace_members_list` — scoped to the run's workspace                                                            | copilot  |

The **both** rows are offered to the MCP endpoint as well and are not the
copilot's to change unilaterally. `media_assets_search`'s `downloadPath` is the
one field in the catalogue that varies by caller — the session route for the
panel, the bearer-fetchable `/v1` one for a token — via `ToolContext.surface`,
which is for presentation and never for authority.

Plus the `propose` half — the write tools, all of which **write nothing**:

| Plugin    | Tool                            | Produces kind               |
| --------- | ------------------------------- | --------------------------- |
| `content` | `content_propose_create`        | `content.entry.create`      |
| `content` | `content_propose_update`        | `content.entry.update`      |
| `content` | `content_propose_bulk_save`     | `content.entry.bulk-save`   |
| `i18n`    | `i18n_propose_translation`      | `i18n.entry.translate`      |
| `i18n`    | `i18n_propose_bulk_translation` | `i18n.entry.bulk-translate` |
| `media`   | `media_propose_alt_text`        | `media.asset.setAlt`        |
| `media`   | `media_propose_file`            | `media.asset.create`        |

The two batch kinds are their own kinds rather than a repeated single one: a
proposal row is the receipt for **one** tool call, so a batch written as twelve
rows would be twelve cards in the transcript for a change the user asked for
once, none of which said what the other eleven were.

## Attachments

A turn may carry files the user attached in the composer. Three things settle
how, and each one is the reason a piece of this looks the way it does.

- **The upload is not part of the run.** The browser posts to
  `POST /api/media/assets` first, on the user's own session with their own
  `media:create` — the same request the Media Library page makes. By the time a
  run starts the asset exists, and `CreateRunDto.attachments` only names it.
  That is why attachments needed **no new permission and no new write path**: a
  user who cannot upload to the library cannot attach a file to a chat either.
- **Ids only, and the server resolves the rest.** The client has the whole asset
  view in hand and sending the name along would save a lookup; it deliberately
  does not, because the id is the only part the server can verify. Everything
  the model is told about a file comes from the row, so a caller cannot describe
  an asset — theirs or anyone else's — as something it is not.
- **`COPILOT_ATTACHMENT_RESOLVER` is how the lookup happens.** Declared in
  `copilot-domain`, injected `@Optional()` here, bound by `media/server`. Same
  inversion as the applier port and for the same reason: this package must not
  import media. A deployment with no media plugin binds nothing, and attaching a
  file then fails with a sentence rather than a boot error.

The resolver is **workspace-scoped and omits what it cannot see**, so an id
belonging to another workspace is indistinguishable from a deleted one. The
engine turns any shortfall into a single `AttachmentError` naming the count —
never which id — because saying _which_ would be an asset-id oracle in the one
place the caller picks the ids. Resolution runs **before the conversation is
touched**, so a bad attachment cannot leave a thread holding a turn that
references a file the model was never told about.

`copilot_messages.attachments` is a jsonb column rather than a sixth
`ModelContentBlock`: the union is what every adapter switches on, so a new
member would be a change to three adapters for something no provider needs to
see, and the transcript read wants this structured — the panel draws chips, and
recovering them by sniffing a text block's prefix works until someone types the
prefix. `loadHistory` folds them back into a **fenced** text block, which is what
carries them into later turns ("summarise the file I sent", three turns on) and
what treats a user-authored file name as the untrusted text it is.

Metadata only — no bytes. A chat that pastes every attached file into the prompt
spends the context window on files nobody asked about, and `media_asset_read`
exists for when the question needs the contents. `AttachmentRef.readable` is
answered by media's own allowlist so the model does not spend a step discovering
a PDF cannot be decoded.

## Asking before a write runs

A `propose`/`apply` tool the thread has not already allowed **parks the run**:
the engine yields `tool-permission-request` and awaits `ToolPermissionBroker`,
which `POST /api/copilot/runs/:runId/permission` resolves. Reads never ask (see
`mayRun` for why: a chat that opens with four prompts trains people to click
through them).

- **Before, not after.** This is the gate ADR-0009 §1b is about, and the reason
  it is worth the machinery: an injected call shows the user its arguments and
  is stopped with nothing having happened. A refusal is fed back as an ordinary
  tool error, so the model reports it and the answer still lands.
- **Only the run's own user may answer it**, and no guard on the route can say
  so. `copilot:use` is held by every role including viewers, and
  `WorkspaceGuard` proves the caller belongs to _the workspace they named_ —
  neither has anything to say about the run. The `runId` is not a secret either:
  it goes to the client in `run-started`. So the broker records
  `{ userId, workspaceId }` when the run parks and refuses a mismatch with the
  same `false` — hence the same **404** — as "nothing is waiting", because
  whether someone else's run exists is not something this route answers.
- **The five-minute wait is a budget for the whole run**, not five fresh minutes
  per call. One step may ask for any number of tools and each of them can park;
  charging each its own timeout let a single turn requesting thirty writes hold
  the connection, the generator and the model context for two and a half hours.
  "They went to look at the entry and came back" is one absence, not thirty.
  The engine also checks the wall clock **per call** rather than only at the top
  of a step, and a call refused on the ceiling is fed back as an ordinary tool
  error — every `tool_use` still needs its `tool_result`.
- **"Allow for this chat" lives on `copilot_conversations.allowed_tools`** and
  dies with the thread. Read **per call**, never per run — two calls in one turn
  can both be answered while the run is parked, and the second must see the
  first's answer. The append is done in SQL for the same reason.
- **The broker is in-memory.** A run and its decision must reach the same
  instance; single-node is fine, horizontal scaling needs sticky routing by
  `runId`. Its three exits — answered, five-minute timeout, abort — all clean up,
  because a registry that only deletes on the happy path leaks a promise per
  abandoned run.
- **A refused or timed-out call is audited** like any other. "The user said no"
  is exactly what a reviewer reading `copilot_tool_calls` wants to find.

## Writes — proposal row, then apply

A `propose` tool's return value **is** the change (`ProposalDraft`), and the
engine — not the tool — persists it as a `copilot_proposals` row and then
applies it. That split predates
[ADR-0009](../../../docs/adr/0009-copilot-applies-directly.md) and matters more
since: with no human step, the row written _before_ the write is the only thing
carrying ADR-0005 §5's "undoable, never invisible". A binder that wrote directly
would be a change with no receipt. One that returns something else gets an
ordinary tool error (`isProposalDraft`), never a malformed row.

Applying is inverted the same way the tools are: `copilot/server` cannot know
how to write a content entry, so the plugin that owns the data binds a
`ProposalApplier` for its `kind` via `copilotAppliersRegistrar(...)`. **An
applier must call the ordinary use-case** — the same one an HTTP request would
reach, with the human as actor. That is what makes an applied change validated,
audited and revision-backed; an applier that reimplements the write is the
failure the port exists to prevent, and with nobody reviewing the result it is
also the failure nobody would catch.

Three rules in `DecideProposalService` worth knowing before touching it:

- **No permission check of its own, deliberately.** The profile offered the tool
  at the start of the run and `executeTool` re-authorized it against a freshly
  resolved session immediately before the proposal existed. There is no third
  check because there is no third actor — `accept`, `reject` and the
  "you may accept what you could have proposed" re-resolution are gone.
- **The status flips before the write.** `decide` updates with a
  `status = 'pending'` predicate, so the applier is unreachable twice for one
  row. Still load-bearing with no reviewers: a model that re-proposes an
  identical change, or a retried run, must not write twice.
- **A failed apply reopens the row** with its message, and the engine reads that
  back into the tool result and the `proposal` run event. Nobody will retry it,
  so `pending` now means _failed_ — the model is told to say the change did not
  happen, and the card says so too.

Rows carry `toolCallId`, so a change joins to its `copilot_tool_calls` row and
the UI attaches the card to the step that produced it.

**An `effect: 'apply'` tool leaves a receipt too.** Nothing shipped declares the
effect — every write tool is `propose` — but the registry allows it and ADR-0009
§5 offers such a tool exactly as it would a read one, so the engine has to
answer for it: it parks for permission like a write and runs like a write, and
until it recorded a row it was precisely the "change with no receipt" §2 names
as the failure the split exists to prevent. The row is written **after** the
fact (the handler has already written by the time it returns; the permission
prompt is what could have stopped it), its `kind` is `tool.<name>` and has no
applier — there is nothing left to carry out — and the model still gets the
handler's return value, because for an `apply` tool that value is a _result_,
not a change.

The model is told what happened, not handed the patch back — it already knows
what it asked for, and echoing the change invites it to "confirm" by calling
again. `SYSTEM_PROMPT_VERSION` 4 rewrote the MAKING CHANGES section for the
inverted failure mode: the old risk was a model claiming success when nothing
was saved, the new one is a model hedging about a write that already landed, or
quietly repeating a failed one.

## Skills

Reusable instruction packets a run can be given
([ADR-0010](../../../docs/adr/0010-copilot-skills.md), design §11). The whole
feature is in `src/lib/skills/`; the shape checks and the merge rule are pure
and live in `copilot-domain`.

- **Two sources, one catalogue.** `CopilotPlugin({ skills })` is validated at
  construction by `buildSkillRegistry` — a duplicate or malformed skill fails
  boot, like a mistyped provider name. CMS skills are `copilot_skills` rows,
  workspace-scoped. `SkillCatalogService` is the only thing that merges them,
  and **code wins a name collision**; the write routes refuse a colliding name
  up front, because the merge drops the shadowed row _silently_ and a saved
  skill that never runs is the worst of the three outcomes.
- **A skill reaches the model only through the system prompt**, and that is a
  decision rather than an omission. The engine wraps every tool result in
  `fenceUntrusted`, which tells the model the content is data and never
  instructions; a skill is the exact opposite, so delivering one through a tool
  would mean either carving an exception into the fence or lying about what the
  model is reading. If auto-selection is ever wanted, it is a server-side
  pre-pass before the first model call — not a tool.
- **The request carries names.** `CreateRunDto.skills` is `[{ name }]`, capped
  at `MAX_RUN_SKILLS`, and `SkillCatalogService.resolveRunSkills` looks each one
  up in the run's workspace. Instruction text in a request body would let anyone
  with `copilot:use` write their own system prompt. An unresolvable name ends
  the run with a message naming a **count** — never which one — for the same
  oracle reason the attachment resolver does.
- **An always-on skill is applied server-side**, whatever the client sends. A
  client that had to name it could switch workspace configuration off by
  omission.
- **`copilot_messages.skills` is a snapshot**, not a foreign key: a skill can be
  renamed or deleted, and a thread read months later still has to say what
  shaped it. `loadHistory` folds a past turn's skills back as a one-line **note**
  rather than the bodies — re-injecting those per turn multiplies the prompt by
  the length of the thread.
- **Delete is real here**, unlike a conversation's: a skill is configuration
  rather than the receipt for a change somebody's content already took, and
  every turn that ran with it holds its own snapshot.
- **`copilot:skills:manage` is admin-only**, and it reintroduces per-workspace
  copilot configuration that ADR-0009 deleted. The distinction the ADR rests on
  has to hold in the code: a skill changes _how_ the copilot works and must
  never change _what it may do_. The day a skill can grant a tool, that argument
  is undone — which is why there is no `allowedTools` field.

## The system prompt

`system-prompt.ts` assembles it, `SYSTEM_PROMPT_VERSION` is stamped on the run,
and `system-prompt.spec.ts` pins the structure. Three rules for editing it:

- **Every section is conditional on something, and that is the point.** A run's
  prompt says only what is true of _that_ run: MAKING CHANGES needs write tools,
  the locale line needs `i18n_locales_list` to be on offer, `ON THIS SURFACE`
  needs a surface with something distinctive to say. Telling a viewer how writes
  behave, or a no-i18n deployment to look up locale slugs, buys a tool call that
  can only fail. `toolNames` carries the offered tool _names_ rather than a
  count for exactly this reason.
- **Per-tool mechanics belong in the tool's `description`, not here.** The
  prompt costs tokens on every run; a description costs them on the runs that
  read it, and arrives in context. HOW ORTHA WORKS carries only what is true of
  every deployment and what no single tool can say — the workspace grant
  boundary, `draft`/`published` being the whole state set, **publish state being
  the `status` + `publishedAt` pair**, **what a save must contain**, numbered
  versions, and each locale being its own entry. The publish-state line (v6) is the counterpart of the
  propose-rule bug below: `draft`/`published` is true of the _column_, and a
  model that reads it as the whole story answers "how many entries are edited
  but not published?" with a count of every draft — the never-published ones
  included. Editing a published entry returns it to `draft` but **keeps**
  `publishedAt`, so "modified" is the pair, and the filter that finds it is in
  `admin_content_search`'s description where it costs only the runs that search.
- **v10 also broke a tie between two rules that used to disagree.** "Translate
  these eight posts into German" is several entries of one type _and_ a
  translation, so the batch rule pointed at `content_propose_bulk_save` while
  the translation rule pointed at the i18n tool. Where
  `i18n_propose_bulk_translation` is on offer the batch rule now defers to it,
  in the only direction that is safe: a content save creates records and cannot
  add a language to one that exists.
- **v10: what a save must contain depends on `publishable`, and nothing else
  says so.** `EntryWriterService` sets `enforceRequired = !type.publishable`: a
  publishable type's save always lands as a **draft**, and a draft may be
  incomplete, so required fields, lengths and formats are checked at **publish**
  — while a non-publishable type has no later moment and validates every write,
  refusing one that omits a required field. Both propose tools take the same
  `values` bag whatever the type, so a model has no way to tell the two apart
  from a schema; without the rule it learns the difference from a 422 naming
  fields it never asked the user about. HOW ORTHA WORKS carries the fact (and
  points at `admin_content_types`, which reports `publishable` and `required`);
  MAKING CHANGES carries the instruction, because the useful part is what to do
  when a required value is unknown — **ask**, rather than invent one or write
  without it — and that answer differs by type where the fact alone does not.
- **A prompt rule is the right fix only where no tool can enforce it.** v8's
  shared-field rule is the case: `localized` is what makes a field vary per
  locale, a field without it is **shared** across the translation group, and
  i18n's sync copies it onto every sibling row. `i18n_propose_translation`
  refuses a non-localized field name; `content_propose_create` /
  `content_propose_update` do **not** — they filter only inverse relations — so
  a model asked to translate can still write "translated" shared values onto the
  entry in front of it and rewrite every locale at once. (The other half of that
  gap **was** closed in code, which is the point: the content tools no longer
  offer a `localeGroupId`, so joining a group now goes through the i18n tools
  that inherit the source's shared values.) HOW ORTHA WORKS states the fact
  unconditionally; MAKING CHANGES restates it as an instruction only when
  `i18n_propose_translation` is actually on offer. It stays **prose**: the rule
  is about which fields carry a flag, and answering it in the prompt would mean
  inlining the field schemas `describeTypes` exists to keep out (the e2e suite
  asserts the prompt contains no `"fields"`). Closing the gap in
  `content/server` would be the real fix, and the prompt is not a substitute for
  it.
- **The propose-rule bug is the cautionary tale.** v3 and v4 both said "any tool
  whose name starts with `propose`". Every propose tool is named for its owning
  plugin first (`content_propose_update`), so the rule matched **nothing** — a
  prompt can be wrong in a way that typechecks, passes e2e and reads fine. v5
  names a tool instead, and adds "despite the name", because since ADR-0009 the
  word `propose` argues against the rule it appears in. Until phase 4's offline
  eval set exists, the spec's conditional-structure cases are the only thing
  standing between a prompt edit and production — and note they would _not_ have
  caught this one.

## The run engine

An **async generator**, not a service that writes to a response — the transport
stays in the controller, and the loop is testable by draining the generator.

- **Bounded three ways** (`RunLimits`): max steps, wall clock, total tokens.
  Exceeding any one ends the run with a reason the UI shows. Two caveats worth
  knowing before you rely on a number here: the wall clock is checked at the top
  of a step **and before each tool call** (a step may ask for any number of
  tools, and a parked one waits on a human), while the token ceiling is checked
  only between steps — so a run can overshoot `maxTotalTokens` by a whole model
  call, and measurably does: a 100-token ceiling ended a run at 10 000. Bounding
  that would mean predicting a turn's size before making it.
- **What `maxTotalTokens` counts.** Uncached input + output + **cache writes**,
  accumulated across the run. Cache _reads_ are excluded on purpose: they cost
  ~a tenth of plain input and they are the whole point of caching, so charging
  the ceiling for them would spend the budget re-reading a prompt the provider
  already has. Writes are billed at a premium and are counted, or turning
  caching on would have made every run look cheaper than it is — see
  [`provider-anthropic/AGENTS.md`](../provider-anthropic/AGENTS.md#prompt-caching-is-on-and-the-loop-is-why).
- **The user's message is persisted before the model is called**, so a dropped
  connection never loses what someone typed.
- **The capability profile is recomputed per run and re-checked per tool call**
  against freshly resolved grants (ADR-0005 §2, §3). Nothing is cached; a role
  revoked mid-turn takes effect on the next tool call.
- **`executeTool` never throws.** Unknown tool, revoked permission, malformed
  arguments, a tool that blew up — all come back as tool _errors_ the model can
  recover from, and the run continues. An unknown tool and a withheld one get
  the **same** message, because "that exists but you may not use it" is itself
  information.
- **A repeated identical call is refused, not re-run.** A model — especially a
  smaller local one — will sometimes re-request a call it already made instead
  of using the result. Without a guard the engine obliges every time until it
  hits `maxSteps`: a run's whole step budget spent on identical queries, no
  answer, and a stop reason that explains nothing. The guard compares `name` + arguments
  (key-sorted, so argument order doesn't defeat it) and feeds back a tool error
  _saying_ the call was already made — telling the model is what breaks the
  loop; silently re-running or refusing without a reason both just repeat.
  Checked after authorization, so a repeat can never reveal more than a first
  call would.
- **All three ceilings are configurable** via `config.limits`, and all three are
  env-exposed on the host: `COPILOT_MAX_STEPS`, `COPILOT_WALL_CLOCK_MS`,
  `COPILOT_MAX_TOTAL_TOKENS`. **Raise them together.** They are checked in the
  same loop, so lifting one alone relocates the wall rather than removing it — a
  run given more steps and the same wall clock stops on `timeout` instead, which
  is the same truncated answer under a different name. Raising them costs tokens
  rather than safety: every step is still authorized and audited, and a
  `propose` tool still records its row before it applies anything. The defaults
  (30 / 300 s / 400 000 tokens) are sized for a run that _writes_ — the model
  reads the type, reads the entries, proposes, reads the result, reports, and a
  multi-entry instruction repeats the middle of that.
- **Every attempted call is audited**, successful or not — a refused call is
  exactly what a reviewer is looking for. Output is stored as a **summary**, not
  whole: copying entry bodies into an append-only table would duplicate content
  with a different deletion story, and the transcript already holds what the
  model saw.
- **The model is resolved in the engine**, not left to the adapter, so
  `copilot_messages.model` names the model that actually answered.
- **`streamTurn` is a generator, and the `yield*` is load-bearing.** It once
  collected text deltas into an array and returned them for `loop` to flush
  after the provider's stream ended — which silently turns streaming off: the
  answer arrives in one burst when the model finishes, indistinguishable from a
  slow non-streaming API. A fast provider hides this completely, which is how it
  survived the first round of verification. To check it, point the server at a
  deliberately slow OpenAI-compatible endpoint and time the frames; anything
  else measures nothing.

## Schema

Five tables, migrated under `__drizzle_migrations_copilot`. `drizzle.config.ts`
points at a **glob** (`src/lib/*/infrastructure/schema/index.ts`) rather than one
file, because this plugin has more than one slice and each owns its own tables —
a slice added without a line in that config would typecheck, boot, and fail on
the first query against a table nobody generated a migration for.

| Table                   | Holds                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `copilot_conversations` | Thread per user × workspace. FKs cascade from both. `model_choice` remembers the model last picked for it — a memory the picker is seeded from, never a pin on the next run.                                                                                             |
| `copilot_messages`      | Append-only transcript, as the **port's** content blocks — so it survives a provider switch. `position` is explicit because two turns can land in the same millisecond. `attachments` holds a user turn's files (see above).                                             |
| `copilot_tool_calls`    | The security-review surface (ADR-0005). Redacted output.                                                                                                                                                                                                                 |
| `copilot_proposals`     | Every change the copilot made, written before the write. `target`/`patch` are opaque jsonb — their shape belongs to the applier that declared the `kind`, and teaching this table about content entries would make the copilot the thing that changes when content does. |

`external-refs.ts` carries id-only stubs of `users` and `workspaces` so
drizzle-kit can emit the cross-context FKs without pulling another plugin's Nest
providers into its esbuild pass. Same pattern as `workspaces/server`.

**Every repository method a route reaches takes the owning `userId` and
`workspaceId` and filters on both.** `WorkspaceGuard` proves the caller belongs
to the workspace they named; nothing upstream proves a _conversation id_ belongs
to them. Four methods take neither, and the distinction is worth stating rather
than reading as a gap: `allowedTools`, `allowTool` and `messages` are called by
the engine with an id `findOrFail`/`create` has already proved is the caller's,
and `toolCalls(runId)` is a test seam. They are **not** reachable from a route,
and a new caller for one of them is a new place to prove ownership.

`GET /proposals` is the deliberate exception to the _user_ half: it is
workspace-scoped, because a proposal is the receipt for a change to the
workspace's content and every member can already read that content. Its
`?conversationId=` filter is not, though — `GET /conversations/:id` 404s a
thread that is not yours, and a filter that answered "yes, that id is here"
would undo it from the other side, so the filter is honoured only for a
conversation the caller owns.

## The model seam

Structurally identical to media storage, by decision
([ADR-0004](../../../docs/adr/0004-model-agnostic-copilot-provider.md)):

| media                    | copilot                       |
| ------------------------ | ----------------------------- |
| `StorageProvider`        | `ModelProvider`               |
| `buildRegistry`          | `buildModelRegistry`          |
| `STORAGE_REGISTRY`       | `MODEL_REGISTRY`              |
| `STORAGE_RESOLVER`       | `MODEL_RESOLVER`              |
| `config.defaultProvider` | the first registered provider |

**This package knows no adapter exists.** It does not import a vendor SDK, a
factory, _or_ an adapter config type — so a Bedrock adapter is a package plus
one entry in `plugins.ts`. Provider _connection_ settings live with the host, in
`apps/server/ortha.config.ts`.

A run may name a `provider` and `model`; an explicitly requested provider wins
over the host's `resolve` handler, because the resolver expresses a default
routing policy rather than a veto over what the user picked from the catalogue
they were shown. Naming one is not an escalation: the registry is fixed at boot,
so the worst a caller can do is choose a backend the operator already configured.

**There is no `defaultProvider` setting** — the row above is where media still
has one. A run naming no provider is served by the **first registered**, which
is the only column that cannot disagree with the list: a name in config could be
misspelled, could point at a backend nobody registered (which is why this
package used to validate it), and had to be kept in step with `providers` on
every change. The admin does not rely on it in practice — the picker opens on
`catalogue()[0]` and sends it — so what the first entry really governs is the
callers that cannot pick: MCP, the API, and e2e.

### Why a list, not a map

`providers` is `readonly ProviderRegistration[]`, so registration order is
meaningful (the first entry **is** the house default, and `catalogue()` renders
in that order) and two providers of the same kind are just two entries:

```typescript
{ name: 'ollama-fast', provider: createOpenAiProvider({ models: ['llama3.1:8b'], … }) },
{ name: 'ollama-big',  provider: createOpenAiProvider({ models: ['llama3.1:70b'], … }) },
```

A list can express what a map cannot — a blank name, or the same name twice —
so `buildModelRegistry` rejects both explicitly.

`buildModelRegistry` snapshots the provider map into a **null-prototype**
object: a later mutation of the host's map can't reroute a run mid-flight, and a
lookup of `constructor`/`toString` misses instead of resolving something off
`Object.prototype` that is not a provider. (Media's `buildRegistry` still has
the second issue — worth fixing there too.)

## Eager config validation

`CopilotPlugin` validates at **construction**, like `I18nServerPlugin`'s locales
and `ContentPlugin`'s registry: at least one provider registered, every provider
declaring at least one model, a positive `maxOutputTokens`, and every ceiling in
`limits` a positive number. A host that registers nothing fails before boot
rather than on the first chat message. The "`defaultProvider` names a registered
provider" check is gone with the setting — a misspelling nobody can write is a
check nobody needs.

`limits` is on that list because `maxSteps: 0` used to construct fine and
produce a run that answers nothing at all: `for (step = 0; step < 0; …)` skips
the loop, so the engine yields `run-started` and then `done` with `max-steps` —
no model call, no answer, and (because `assistantBlocks` is empty) **no
assistant row**, leaving a thread showing a question and silence for good.
All three ceilings are env-exposed, so a typo reaches them.

Being **disabled is not a wiring error**: `config.enabled: false` is the default
and constructs fine. That switch is the operator's kill switch (ADR-0005 §10),
and it is applied where MCP applies its own — `CopilotModule.forRoot` registers
**no controller** when it is off, so every `/api/copilot/*` route 404s.

It was read in one place only for a while — `RunEngine.run`, throwing
`CopilotDisabledError` for the controller to turn into an error frame — which
made "off" mean _the send button says no_. The panel, the Agents view, the model
catalogue, the conversation and skill routes and the tables all stayed live, so
a deployment that had opted out still shipped the entire feature and refused at
the last step. The engine's check is still there as belt-and-braces (the
generator is drainable without a socket), exactly as `McpController` keeps its
own.

**What the switch does not take away** is the wiring: providers, the model
registry and the skill registry stay bound, and `ToolsModule` is imported rather
than provided, so the shared tool catalogue the MCP endpoint serves is identical
either way (`tool-registry.spec.ts` asserts both halves).

**It is not the egress guard, and never really was.** Since ADR-0004's provider
registrations, a backend is registered only if its credentials exist — so a
deployment holding no key reaches no third party whatever this flag says, and
since the scripted `fake` adapter stopped being registered it reaches no model
at all. (An empty provider list is accepted only while this flag is off: an
enabled copilot with nothing to call fails at construction.) The flag is the operator's off switch for the feature; the
absent key is what keeps content in-house. See the 2026-08-24 update on
ADR-0005.

## Permissions

`copilot:use` lives in `identity/server`'s `PERMISSIONS`, not here — the
catalogue has exactly one source of truth. **No migration:** `seedSystemRoles` is
idempotent and runs each boot. Viewers hold it (ADR-0005 §10, resolved), and a
viewer's copilot is provably read-only because the profile offers them no write
tool — which is the whole authority model now that nothing pauses for review.

There is no `copilot:configure`. It gated the per-workspace policy and nothing
else, so ADR-0009 removed it with the policy. Re-add it if the runtime model
registry ADR-0004 §5 anticipates ever lands.

## Package

- Name: `@orthacms/copilot-server`
- Register **after** `WorkspacesPlugin` (runs are workspace-scoped) and
  `IdentityPlugin` (runs execute as the calling user)

## Commands

- `npx nx typecheck @orthacms/copilot-server`
- `npx nx lint @orthacms/copilot-server`
- `npx nx test @orthacms/copilot-server`
- `npx nx run @orthacms/copilot-server:db:generate --name=<name>`
