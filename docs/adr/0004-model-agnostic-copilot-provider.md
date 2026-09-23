# 0004 — Model-agnostic copilot provider

- **Status:** Accepted
- **Date:** 2026-08-01
- **Deciders:** Engineering

> Context for the feature this decision serves lives in
> [`docs/design/copilot.md`](../design/copilot.md). This ADR settles only _how
> the copilot talks to a model_; [ADR-0005](0005-copilot-authority-model.md)
> settles what it is allowed to do once it can.

## Context

We are adding an AI copilot to the admin: a chat that can search, export, draft
and edit content on the signed-in user's behalf. It needs a language model.

Ortha CMS is **self-hosted**. The operator — not us — runs the infrastructure and
owns the policy about where their content may travel. That single fact drives
everything here:

- Some operators must run inference **on their own network**. Sending workspace
  content to a hosted API is not a default they can accept, and for some it is
  not a choice they are permitted to make.
- Some run a container image they did not build. They **cannot edit
  `plugins.ts`** to change a model; a redeploy to swap `gpt-4o-mini` for a local
  Llama is not a workflow, it is a blocker.
- Models differ in what they can actually do. Frontier hosted models stream and
  call tools reliably; a 3B model on a laptop may not support tool calling at
  all. A design that assumes tool calling silently breaks on exactly the
  deployments that most wanted local inference.
- CI must run the full copilot loop with **no API key and no network**, or the
  engine — a non-deterministic multi-step loop — is effectively untested.

We also have a precedent worth reusing rather than re-arguing. `media/server`
already solved "swappable backend, chosen by the composition root": a
`StorageProvider` interface in `domain/`, `buildRegistry` over a name→provider
map, and an optional `resolve(ctx)` router that picks per operation. The media
core imports nothing from S3 or the filesystem.

## Decision

We will treat the model as a **replaceable backend behind a port**, structurally
identical to media storage.

1. **The core depends on an interface, never a vendor.** `ModelProvider` is
   declared in `@orthacms/copilot-domain` (`stream(request, signal)` yielding
   text deltas, tool calls and a final usage record). No vendor SDK may be
   imported by `copilot/domain` or `copilot/server` — the same rule that keeps
   Drizzle and Nest out of any `domain/` layer.

2. **Adapters are separate packages, registered at the composition root.**
   `CopilotPlugin({ providers: { … }, resolve })` takes a name→provider map and
   an optional router, mirroring `MediaServerPlugin`'s storage options. Adding a
   provider is a new package, never a change to the engine.

3. **We ship two adapters**, which together cover the field:
    - `copilot-provider-anthropic` — native Claude; the default for tool-heavy
      work, and the path on which native features (tool-use fidelity, prompt
      caching) stay available.
    - `copilot-provider-openai-compatible` — a configurable `baseUrl`, model id
      and headers. Ollama, vLLM, llama.cpp, LM Studio, LiteLLM, OpenRouter, Azure
      and OpenAI itself all speak this wire format, so one adapter makes a local,
      air-gapped install a configuration choice rather than a fork.
      A third adapter, `copilot-provider-fake`, is scripted and deterministic and
      is how `server-e2e` exercises the whole tool loop in CI. It was originally
      shipped rather than treated as test scaffolding, on the reasoning that a
      contributor should be able to run the admin without a key. **That is no
      longer the decision.** Being shipped meant being registered in every
      composition root, including generated apps, where it was last in the list and
      therefore the whole catalogue of any deployment that had configured nothing —
      so a production install that enabled the copilot and forgot the key answered
      every question with a canned sentence instead of failing. It is now a private
      workspace package, published nowhere and registered by tests only, and a
      deployment with no configured backend has no copilot at all.

4. **Providers declare their capabilities, and the engine degrades
   explicitly.** `ModelCapabilities` reports tool calling, streaming, vision and
   context window. When tool calling is absent the engine falls back to a
   constrained single-shot protocol with a reduced tool set, and the UI states
   the active mode in words. We define a **supported baseline** — streaming +
   native tool calling + a context window large enough for the workspace's type
   summaries — and document that anything below it runs degraded. Pretending a
   small local model is interchangeable with a frontier one is how this feature
   earns a bad reputation.

5. **Configuration has two tiers.** The composition root stays the place for
   custom adapters and routing logic. In addition, an admin holding
   `copilot:configure` may register a model at runtime — adapter kind, base URL,
   model id, credential, limits — persisted in `copilot_model_configs`.
   Credentials are **encrypted at rest** under a key sourced from
   `orthacms.config.ts`, are never serialized to the browser, and the admin UI
   learns only a model's name and probed capabilities.

## Consequences

**Easier:**

- An operator swaps models without a redeploy, and can run the copilot entirely
  inside their own network by pointing one adapter at a local runtime.
- CI runs the full multi-step loop deterministically, with no key and no
  network.
- A new provider is a package plus a registry entry — the engine, the tools and
  the admin are untouched.

**Harder / the cost we accept:**

- **A capability matrix instead of one behaviour.** Degraded mode is real code
  and a real UI state, and it must be tested, not assumed.
- **First encrypted secret at rest in this codebase.** That commits us to an
  encryption key in config, a rotation procedure, and an explicit answer about
  what a database backup now contains.
- **Streaming normalisation is genuine work.** Two wire formats, two tool-call
  encodings, two usage shapes, one internal event stream.
- **Comparing models becomes our problem.** Once operators can swap freely, "is
  this model good enough for our content?" is a question we should help answer —
  hence the eval fixture set below.

**Follow-up work this commits us to:**

- An encryption key in `orthacms.config.ts` plus a documented rotation procedure.
- A small offline eval set (fixture workspace + expected tool calls) so a prompt
  change is reviewable like code, and so an operator can measure a swapped-in
  model before trusting it.
- Documenting the supported baseline tier in the design doc and in the settings
  UI.

**What this rules out:** importing a vendor SDK into `copilot/domain` or
`copilot/server`; assuming tool calling is always available; env-only model
configuration as the _only_ mechanism; and per-provider branching inside the
engine.

## Alternatives considered

- **Depend on one vendor SDK directly.** Simplest, and fine for a hosted
  product. Rejected: it contradicts self-hosting outright and would make local
  inference a fork rather than a setting.
- **Adopt a third-party abstraction library** (LangChain, Vercel AI SDK, or
  similar). Rejected: we need a narrow surface — stream, tools, usage — and
  these bring a large dependency, their own abstractions over ours, and a
  release cadence that becomes our churn. The port above is roughly one file.
- **Ship only the OpenAI-compatible adapter.** Tempting, since nearly everything
  speaks that format. Rejected because it flattens providers to their common
  denominator and gives up native capabilities on the default path.
- **Env-only configuration, no settings UI.** Simpler, and avoids encrypted
  secrets entirely. Rejected: "change the model without redeploying" is most of
  what self-hosters are asking for, and an env-only design denies it to exactly
  the operators who run a prebuilt image.
- **Let each provider define its own tool format and translate per call site.**
  Rejected as the same coupling in a worse place — the engine would grow a
  branch per vendor.
