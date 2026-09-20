# @orthacms/copilot-domain

The copilot's **framework-free core**: the `ModelProvider` port and everything
that crosses it, plus (as of phase 1) the tool contracts, the capability
profile, the run vocabulary, and the untrusted-content fence.

> Feature context: [`docs/design/copilot.md`](../../../docs/design/copilot.md).
> The two settled decisions:
> [ADR-0004](../../../docs/adr/0004-model-agnostic-copilot-provider.md) (how we
> reach a model) and
> [ADR-0005](../../../docs/adr/0005-copilot-authority-model.md) (what it may do).

## The one hard rule

**This package imports nothing.** Not Nest, not Drizzle, not React, and — the
rule ADR-0004 §1 exists to enforce — **no vendor SDK**. `@anthropic-ai/sdk` may
appear in `copilot/provider-anthropic` and nowhere else. That is what makes the
tool contracts, the capability profile and the run vocabulary testable without a
framework or a model.

This rule has real consequences, and they are features rather than costs: the
capability profile restates set membership instead of importing identity's
`AccessPolicy`, and tool-input validation is a hand-written schema subset
instead of a library. Both are documented where they live.

`package.json` has no `dependencies` block at all. Keep it that way; if
something here needs a dependency, it belongs in a layer above.

## What it exports

### The port

- `ModelProvider` — `models()`, `capabilities(model?)` and
  `stream(request, signal)`. Three methods, deliberately: the surface is narrow
  enough that a third-party abstraction library would cost more than it saves
  (ADR-0004, alternatives).
- **A provider serves several models.** `models()` returns the ids it offers,
  first as the default, so one endpoint and one credential can back a cheap
  model for routine turns and a frontier one for hard work — and a user can
  switch mid-conversation without a redeploy. It is synchronous because it is
  declared configuration: a model picker renders it with no round trip.
- `resolveModel(requested, available)` — the one rule every adapter applies:
  the named model, or the first as default, and `UnknownModelError` for
  anything else. Falling back to the default would answer on a different model
  than the caller asked for, and bill it silently. A provider declaring no
  models at all raises `NoModelsConfiguredError` — typed, not a bare `Error`,
  so the SSE controller can tell an operator misconfiguration from a fault.
- `ModelRequest` — model id (optional; the provider's configured default wins),
  system prompt, messages, tools, output ceiling. **No sampling parameters**:
  current frontier models reject `temperature`/`top_p`/`top_k` outright, so the
  port doesn't pretend to carry them.
- `ModelStreamEvent` — `text-delta` | `tool-call` | `done`. Two wire formats,
  two tool-call encodings and two usage shapes collapse to this one vocabulary,
  so the engine never grows a branch per vendor.
- `ModelUsage` / `ModelStopReason` — the inputs to cost accounting and to the
  "why did it stop" line the UI shows.
- `normalizeTranscript(messages)` — the one repair a **replayed** thread needs.
  A run is persisted as one assistant row holding text, `tool_use` and
  `tool_result` blocks together (the shape the transcript UI reads), and that is
  not a shape the wire accepts: Anthropic requires a tool result on a `user`
  turn immediately after the assistant turn that asked for it, and 400s
  otherwise — `tool_result blocks can only be in user messages`. This splits the
  row back into `assistant` / `user` pairs, one per step, and drops `tool_use`
  blocks a cancelled run left unanswered (a second 400). It lives here, not in
  an adapter, because the OpenAI adapter emits `role: 'tool'` per result block
  and so *hides* the defect — one wire format tolerating bad data is not a
  reason to send it.

### The registry seam

- `ModelRegistry` + `MODEL_REGISTRY` — name→provider lookup plus
  `catalogue()`, every provider × model pair on offer (what a model picker
  renders, and the full set a run may legally choose from). Bound at the
  composition root. The implementation (`buildModelRegistry`) lives in
  `copilot/server`; only the interface and the token are here, so an adapter
  package depends on the domain and never on the server.
- `ModelResolver` + `MODEL_RESOLVER` — the optional per-run router. Plain code
  in `plugins.ts`, returning a registered provider **name**.
- `UnknownModelProviderError` — thrown by the registry, transport-agnostic.

### The abort contract, made executable

- `isAbortError(error, signal?)` and `abortedEvent()` (`lib/model/abort.ts`).

`ModelProvider.stream` states three clauses normatively, because an adapter
that breaks one produces figures the engine cannot detect as wrong: exactly one
`done` ends a stream; an abort **ends** it with `stopReason: 'aborted'` rather
than throwing out of it; and a cancelled call reports **zero** usage even when
text had already streamed, because a partial estimate is a guess entering cost
accounting as a fact. Every adapter has to implement that, so it lives here as
two functions instead of as prose copy-pasted into each one. Both are pure, so
this costs the layer nothing.

### The conformance kit — what enforces the clauses

- `runModelProviderConformance(case)` + `MODEL_PROVIDER_CONFORMANCE_CHECKS`
  (`lib/model/conformance.ts`).

The clauses used to bind nothing: each adapter was on its honour, and they had
already diverged — `provider-fake` reported a partial usage estimate on a
mid-stream abort where both production adapters reported zero. No per-adapter
spec could see that, because each one only ever documented what its own adapter
happened to do.

The kit takes a case that arms a provider per scenario and returns a **report**
rather than throwing assertions: `null` per check it passed, otherwise the
sentence naming what it did instead. That is what lets it live here — it needs no
test framework, so this package still imports nothing — and each adapter's spec
turns the report into one test per check with three lines. It checks the three
`stream` clauses plus what the port promises around them: delta reassembly, a
whole and parsed tool call, a usable usage record, `models()`, the default model,
and `UnknownModelError` **before** any request is issued.

Its own spec drives a deliberately non-conforming provider one clause at a time,
because a conformance kit that cannot fail is indistinguishable from one that
does nothing.

### The offer-time gate

The tool _contract_ and its registry are shared with the MCP endpoint and live
in `@orthacms/tools-server` (ADR-0007). `ToolSpec`, `ToolContext` and
`COPILOT_TOOL_PROVIDER` are gone from this package. What remains is what
genuinely belongs to a framework-free core:

- `resolveCapabilityProfile(...)` — the **offer**-time gate (ADR-0005 §3). Pure
  and total, which is what makes "a viewer is offered no write tools" a unit
  test rather than a promise. Since
  [ADR-0009](../../../docs/adr/0009-copilot-applies-directly.md) the declared
  permissions are its _only_ input: the per-workspace auto-apply opt-in, and the
  `apply-not-enabled` withheld reason it produced, are gone. It is **generic over a three-field structural
  type** (`AuthorizableTool`: `name`, `requires`, `effect`) rather than
  importing `ToolDefinition`, so this package still imports nothing and the
  server still passes the real registry's tools straight in.
- `validateToolInput(input, schema)` **has moved to `@orthacms/tools-server`**,
  next to the `ToolDefinition.inputSchema` it interprets. Living here meant only
  the copilot's run loop applied it, while the MCP endpoint dispatched
  unvalidated arguments to the very same tools; `ToolRegistry.call` now applies
  it for every consumer. Still a deliberate JSON Schema subset and still
  defence in depth behind the profile — the boundary is `requires`.

### Proposals (phase 3)

- `ProposalDraft` / `ProposalTarget` / `ProposalChange` / `ProposalStatus` —
  what a `propose` tool returns. The engine applies it as soon as it is drafted
  (ADR-0009), so a new row lands `accepted`, or stays `pending` because the
  apply **failed**; `rejected` survives only on rows written before that. `target` and `patch` are deliberately opaque
  JSON: their shape belongs to the applier that declared the `kind`, and
  teaching the copilot every plugin's addressing would make it the thing that
  changes whenever one of them does.
- `isProposalDraft(value)` — the runtime guard. `effect: 'propose'` is a promise
  a binder makes about its return value; without this, a binder that broke it
  would write a malformed row into an append-only table instead of producing an
  ordinary tool error.
- `ProposalApplier` + `COPILOT_PROPOSAL_APPLIER` + `ProposalActor` /
  `ProposalApplyResult` — the write half, inverted exactly like the tool port so
  `copilot/server` still never imports a feature plugin. The interface's
  contract is one sentence: **an applier runs the ordinary use-case**, with the
  human as actor. `ProposalActor` carries the actor's email as well as their id,
  because the audit trail freezes an email snapshot on every event and an
  applier holding only an id would have to look it up — a query per apply, in
  the one path where getting the actor wrong is least acceptable.

### Attachments

- `AttachmentRef` / `AttachmentResolver` / `COPILOT_ATTACHMENT_RESOLVER` — how a
  run learns what the files someone attached to a message are. Inverted exactly
  like `ProposalApplier`, so `copilot/server` still never imports a feature
  plugin: `media/server` binds it. A **single** binding rather than a runtime
  registration list — there is one media library, so unlike the appliers there
  is nothing to merge across dynamic modules.
- `AttachmentRef` is metadata only, deliberately: the bytes stay in storage and
  a tool reads them when a question needs them. `readable` is answered by the
  binding plugin rather than derived from `mimeType` here, because the answer is
  that plugin's allowlist and a second copy of it would drift.
- The interface's contract is one sentence: **scope to the workspace and omit
  what does not match**. An id in a request body is proven by nothing.

### Skills

- `Skill` / `SkillDefinition` / `SkillRef` / `SkillMode` / `SkillSource` — a
  reusable instruction packet, what a host declares, and the snapshot a
  transcript keeps of one ([ADR-0010](../../../docs/adr/0010-copilot-skills.md)).
- `buildSkillRegistry(definitions)` — the host's code-defined skills, frozen at
  boot. Structurally `buildModelRegistry`: a null-prototype snapshot, order
  preserved, and a duplicate or malformed name is a **throw** rather than a
  silent last-one-wins. The implementation lives here rather than in the server
  because the merge rule and the shape checks are pure, and both the server's
  boot-time validation and its write routes have to agree on them.
- `mergeSkills(code, cms)` — one workspace's catalogue. Code wins a collision,
  and the CMS row is dropped rather than overwritten: reaching this filter means
  a deploy took a name over, and a deploy silently changing one workspace's
  instructions is the surprise it avoids.
- `validateSkillShape(skill)` — returns **every** problem, not the first,
  because both callers report to a human who would otherwise fix one and rerun.
- The bounds (`MAX_RUN_SKILLS`, `MAX_SKILL_INSTRUCTIONS_LENGTH`, …) live here so
  the DTOs, the host's validation and the admin's form all read one set.

### The run (phase 1)

- `CopilotRunEvent` — the engine's output vocabulary and exactly what the SSE
  controller serializes. `RunProposalEvent` follows a `propose` tool's own
  result rather than replacing it: the tool result is what the _model_ was told,
  the proposal is what the _human_ is being asked to decide, and a client
  renders the step list from one and the card from the other. A client reducer written against this union turns a new
  event kind into a compile error rather than a silently ignored frame.
- `RunLimits` / `DEFAULT_RUN_LIMITS` / `RunStopReason` — the three ceilings
  (steps, wall clock, tokens) and why a run ended. `RunStopReason` is a superset
  of `ModelStopReason`: the model reports why _it_ stopped, this reports why the
  _run_ did, including limits the model never sees.

  **The reason is the contract; the sentence is not.** This package exports no
  user-facing copy for a stop reason, and should not: a
  `Record<RunStopReason, string>` of finished English cannot enter the admin's
  `react-intl` pipeline — no message id, nothing for a translator to see — so
  anything shipped here could only ever render English. `copilot/admin` owns the
  translated copy, keyed off the same union. What is left is `RUN_STOP_NOTES`,
  module-private, feeding `interruptionNote` — text the **model** reads, which
  is the one place server-authored English belongs.
- `fenceUntrusted(source, payload, maxChars?)` + `UNTRUSTED_DATA_RULE` +
  `MAX_UNTRUSTED_PAYLOAD_CHARS` — ADR-0005 §8's structural defence. Two
  properties carry it: the payload is JSON (so no field can introduce a line
  that reads as a new turn) and `<` is escaped (so the closing delimiter is
  unforgeable from inside). Unit-tested against a forged fence.

  It is also **size-bounded**, and that bound lives here rather than in the
  engine for a reason: `RunLimits.maxTotalTokens` is checked _between_ steps,
  so it cannot stop a single oversized tool result — by the time it is
  consulted the payload is already in `messages` and already billed. Over the
  ceiling the payload is replaced by an envelope that **states** the
  truncation, so the model reports the gap instead of answering confidently
  from a result it cannot know was clipped. The preview is re-encoded with
  `JSON.stringify` rather than spliced out of the original, so a cut can never
  leave half an escape sequence or a lone surrogate in the prompt, and the
  closing delimiter stays unforgeable across the truncation.

### The baseline

- `SUPPORTED_BASELINE`, `baselineShortfalls(caps)`, `meetsSupportedBaseline(caps)`.

ADR-0004 §4 commits us to a **supported tier** — streaming, native tool calling,
and a context window big enough for a workspace's type summaries — and to
saying so in words when a model falls below it. `baselineShortfalls` returns
_every_ dimension that falls short, not the first, because the settings UI has
to name which capability is missing. Unit-tested; the test is the specification.

**Nothing consumes it yet.** No caller outside this package reads any of the
three, and no caller outside a spec calls `ModelProvider.capabilities()` — so
the explicit degradation ADR-0004 §4 commits to does not currently happen: a
model that cannot call tools is still sent tools, and the UI says nothing.
The API is the right shape; wiring it into the run engine is tracked separately.
Do not delete it to satisfy a dead-code sweep.

## Conventions

- `interface` for type contracts, `type` for unions and derived types
- All exported symbols carry JSDoc
- No `.js` extensions in TypeScript imports; always `import type` for types

## Commands

- `npx nx typecheck @orthacms/copilot-domain`
- `npx nx lint @orthacms/copilot-domain`
- `npx nx test @orthacms/copilot-domain`
