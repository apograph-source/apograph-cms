# @orthacms/copilot-provider-fake

A scripted, deterministic `ModelProvider`, and a **test fixture only**
([ADR-0004](../../../docs/adr/0004-model-agnostic-copilot-provider.md) §3). It
is how `server-e2e` exercises the whole tool loop with no API key and no
network. It is `private` in its manifest and excluded from `nx.json`'s release
projects, so it publishes nowhere and a generated app never installs it.

**Do not register it in a composition root.** It used to be, unconditionally and
last, on the reasoning that a contributor should be able to run the admin
offline — which meant it was the entire catalogue of any deployment that had
configured no real backend, so a production install that turned the copilot on
and forgot the key answered every question with a canned sentence rather than
failing. A host now registers exactly the backends it configured;
`CopilotPlugin` accepts an empty list only while the copilot is switched off,
and refuses to build an enabled copilot that has nothing to call.

Depends only on `@orthacms/copilot-domain`. No network, no clock, no randomness
— the run engine is a non-deterministic multi-step loop, and a flaky fake would
make every assertion downstream of it flaky too.

## What it exports

- `createFakeProvider(config?): FakeProvider` where `config` is
  `{ script?, capabilities?, chunkSize?, models? }`.

`models` defaults to a single `fake`. Declare several to exercise a model
picker or the engine's model-switching path with no real provider; a run naming
one that wasn't declared is rejected exactly as production would reject it.

`FakeProvider` extends `ModelProvider` with the inspection surface tests need:

- `calls` — every `ModelRequest` served, in order.
- `reset()` — clears `calls` and rewinds the script.

`calls` is the assertion target for the negative path ADR-0005 makes mandatory:
_a viewer's run must be verified not to be offered write tools._ That is an
assertion about `calls[0].tools`, made without a model.

## Layout

```
src/lib/
  fake-provider.ts   # the factory — the stream loop, ~100 lines
  config.ts          # FakeProviderConfig/FakeTurn/FakeToolCall/FakeProvider + defaults
  script.ts          # createScriptReader — the two modes below, and exhaustion
  usage.ts           # estimateUsage — the deterministic token estimate
  text.ts            # chunkText — the delta splitter
```

## Two modes, and the difference matters

- **No `script` (unscripted).** Every call returns the same canned reply,
  forever. It is what a harness constructs before a test has scripted anything,
  and what a test that does not care what the model says can leave in place.
- **`script` supplied.** Turns are consumed in order, and running past the end
  **throws**, naming how many turns were scripted and which call asked for one.
  Silently inventing a turn would let a test assert the wrong number of model
  calls and still pass.

## Behaviour

- Text is streamed in `chunkSize` (default 8) character deltas, so a consumer's
  reassembly is genuinely exercised rather than handed one whole string.
- A turn with `toolCalls` and no explicit `stopReason` infers `tool_use`;
  otherwise `end`. Tool-call ids default to `fake-tool-<call>-<index>`.
- Usage defaults to a deterministic ~chars/4 estimate of the request and the
  reply — not a tokenizer, just stable non-zero numbers for accounting
  assertions to bite on. Override per turn with `usage`.
- An abort yields a single `done` with `stopReason: 'aborted'` and **zero**
  usage, checked at every boundary a real adapter observes one at: before the
  first delta, between deltas, before a tool call, and before `done`. The script
  still advances: the run happened, it just didn't finish.

    It used to report a partial estimate on a mid-stream abort, which is the one
    path where the fake behaved differently from both production adapters — so any
    assertion about an aborted run's token columns was written against fake-only
    numbers. `conformance.spec.ts` runs the domain's
    `runModelProviderConformance` kit, the same one both production adapters run,
    so the three cannot drift apart again.

- `calls` records a **snapshot** of each request. The run engine appends to the
  very array it passes as `messages`, so an aliased record would report the whole
  conversation as what the first call was shown.
- `capabilities` is overridable, which is how degraded mode gets tested — e.g.
  `{ toolCalling: false }`.

```typescript
const provider = createFakeProvider({
    script: [
        {
            toolCalls: [
                { name: 'admin_content_search', input: { q: 'launch' } }
            ]
        },
        { text: 'I found 3 matching articles.' }
    ]
});
```

## Commands

- `npx nx typecheck @orthacms/copilot-provider-fake`
- `npx nx lint @orthacms/copilot-provider-fake`
- `npx nx test @orthacms/copilot-provider-fake`
