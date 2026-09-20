# 0007 — One tool registry, two surfaces

- **Status:** Accepted
- **Date:** 2026-08-09
- **Deciders:** Engineering

> Amends [ADR-0005](0005-copilot-authority-model.md) §3 and completes
> [ADR-0006](0006-cms-as-an-mcp-server.md) §2. Neither is reversed; this record
> settles the seam they both pointed at from opposite sides.

> **Update (2026-08-11).** §2 said "today the split is total". It no longer is,
> which was the predicted path rather than a change of decision: four tools —
> `i18n_locales_list` and the three `media_*` reads — now omit `surfaces` and
> are offered to both consumers. Each answers no to every question in the
> decision procedure this record implies (no draft visibility on
> `content:read`, no write, no user-only attribution, no permission the token
> scopes withhold), and the media three were also a capability the MCP endpoint
> simply lacked. The procedure itself is written down in
> [`packages/tools/server/AGENTS.md`](../../packages/tools/server/AGENTS.md#adding-a-tool-decide-surfaces-deliberately);
> `ToolContext.surface` was added at the same time so a shared tool can vary
> **presentation** (a download link the caller can actually fetch) without ever
> varying authority. The revision tools and `i18n_translations_get` were
> considered and declined; the reasons are recorded there as worked examples.

> **Update (2026-08-17).** Two amendments, neither of which reverses a decision
> here.
>
> §4 credits `resolveCapabilityProfile` with "the auto-apply gate on `apply`
> tools". [ADR-0009](0009-copilot-applies-directly.md) §4–5 deleted that gate
> along with `copilot_workspace_policies`, the settings page and the
> `apply-not-enabled` withheld reason: an `apply` tool is now offered exactly
> when a `read` tool with the same `requires` would be. The rest of §4 stands —
> `resolveCapabilityProfile` is still the offer-time policy and still produces
> the surviving `withheld` reasons, and `ToolRegistry.call` is still the
> boundary.
>
> §4's last sentence is also now narrower than the truth: `call()` re-checks
> `requires` **and** validates the arguments against the tool's own
> `inputSchema` before dispatch. That is not a second boundary — `requires` is
> the boundary — but it closed the asymmetry where the copilot's run engine
> validated a call and the MCP endpoint, holding the same registry and the same
> tools, did not.

## Context

ADR-0006 §2 said the MCP endpoint would be one adapter over a shared
`ToolRegistry` and "the copilot's in-process tool loop will be the other", and
listed as a benefit that "our copilot inherits a built, tested tool catalogue
instead of growing a parallel one". It named `COPILOT_TOOL_PROVIDER` explicitly
as the thing it was pre-empting.

It was written while the copilot's own tool seam was being built in a parallel
branch. Both landed. The repository briefly held two of everything:

| Copilot                    | MCP              |
| -------------------------- | ---------------- |
| `ToolSpec`                 | `ToolDefinition` |
| `ToolContext`              | `ToolContext`    |
| `permissions[]`            | `requires[]`     |
| `COPILOT_TOOL_PROVIDER`    | `TOOL_PROVIDER`  |
| `CopilotToolRegistry`      | `ToolRegistry`   |
| `resolveCapabilityProfile` | `visibleTo()`    |
| the engine's re-check      | `call()`         |

Two ports, two registries, and — the part that matters — **two implementations
of the authorization check** over the same content. That is precisely the "two
catalogues, two authorization paths, and two places to add every future
capability" ADR-0006 set out to avoid.

The naive fix — point the copilot at the MCP tools — does not work, for three
reasons that are not incidental:

- **The MCP content tools read the public API's services.** `PublicEntriesQuery`
  is published-only by default and gates `?status=` on `content:update`, which a
  **viewer does not hold**. A viewer's copilot would silently lose the ability to
  answer "which articles are still drafts?" — most of what the panel is for —
  while the admin's own records table shows them exactly that.
- **They attribute writes to a token.** `PublicEntryWritesService` passes `null`
  as the actor by design ("null is the honest answer for 'not a user'"). ADR-0005
  §5 requires the accepting human on the revision and the activity row.
- **`propose` has no analogue.** MCP's `readOnly`/`destructive` are client hints;
  `content_create` writes directly. ADR-0005 §5 requires the copilot's writes to
  produce a reviewable change.

## Decision

**1. One registry, one contract, one authorization point — in its own package.**

`ToolDefinition`, `ToolContext`, `ToolProvider`, `ToolRegistry`,
`createToolContext` and `toToolError` move from `mcp/server` to
`@orthacms/tools-server`. `ToolRegistry.call` remains the single place a tool
call is authorized, for both consumers.

The move is not cosmetic. Importing the seam from `mcp/server` would make a
deployment that runs the copilot **without** MCP pull `@modelcontextprotocol/sdk`
through that package's barrel — a dependency on a protocol it does not speak —
and would leave the registry owned by one of its two consumers. `ToolsModule` is
`@Global()` and imported by both, so whichever consumers a deployment runs share
exactly one instance.

**2. A tool declares its `surfaces`; omitted means both.**

`surfaces?: readonly ('mcp' | 'copilot')[]`. Sharing a registry does not mean
every tool suits every caller — see the three reasons above — so the tool says
who it is for rather than a filter elsewhere guessing. `forSurface` narrows the
catalogue and `call` applies the same narrowing, because a caller may name a
tool it was never shown.

Today the split is total: MCP's twelve content tools are `['mcp']`, the
copilot's fourteen are `['copilot']`. That is honest rather than disappointing —
they wrap genuinely different services for genuinely different callers. What is
now shared is the machinery, which is the part that would have rotted. A tool
with no such tension (a future `i18n_locales_list` for both) simply omits the
field, and that is the path of least resistance.

**3. `effect` joins the definition; `readOnly` stays.**

Two vocabularies because they answer different questions. `readOnly` tells an
MCP client what is safe to auto-approve. `effect` (`read | propose | apply`)
tells the _server_ whether a handler's return value is a change or a result —
which is what makes the run engine persist a `copilot_proposals` row. A
`propose` tool is not read-only in the MCP sense, and a direct-write tool is not
`propose` however destructive it is.

**4. The offer stays the copilot's, the boundary stays the registry's.**

`resolveCapabilityProfile` survives, now generic over a three-field structural
type so `copilot-domain` still imports nothing. It remains the **offer**-time
policy — it adds the auto-apply gate on `apply` tools and the `withheld` reasons
the settings page renders, neither of which the MCP endpoint has any use for.
`ToolRegistry.call` re-checks `requires` before dispatch and is the security
boundary, exactly as ADR-0006 §5 says.

**5. Copilot tool names are `snake_case` and admin-prefixed.**

One registry is one namespace, and a duplicate name throws. The copilot's
content tools become `admin_content_*` because that is what they are — the
admin-scoped set, next to MCP's public-API `content_*`. The naming makes the
distinction visible at the call site and in every audit row.

**6. An unknown tool and a withheld one now answer the same as MCP's.**

ADR-0005 §3's engine returned the same "unknown tool" message for both, so that
"this exists but you may not use it" was not itself information. Applied to the
_tool list_ that reasoning is wrong: the list is derived from the caller's own
role, which they can read off their own profile, so naming it reveals nothing
and saves a model a wasted turn. ADR-0006 §5 reached the same conclusion
independently, and one registry must not answer two ways. **The rule still
holds for _data_** — an ungranted content type 404s exactly like an unknown one,
in both surfaces.

## Consequences

**Good.**

- One authorization implementation. A change to `requires` enforcement cannot
  apply to MCP and miss the copilot.
- A capability plugin registers once. `media`, `i18n`, `activity` and `users`
  now contribute to the same registry `content` does.
- Cross-surface leakage is a test, not a hope: the MCP suite asserts no
  `admin_*`/`*_propose_*` tool is listed **or callable**, and the copilot suite
  asserts the same of `content_*`.
- `copilot-domain` got smaller and still imports nothing.

**Costs and risks.**

- **`surfaces` is a security-relevant field, like `requires`.** A copilot
  propose tool that omitted it would become callable by an MCP client that has
  no way to accept the resulting proposal. The cross-surface e2e cases are the
  guard, and a new tool needs one.
- **Two near-duplicate content tool sets remain**, and now sit side by side in
  one catalogue where the duplication is obvious. That is the honest state: they
  differ in service layer, default visibility, and write attribution. Collapsing
  them means giving `PublicEntriesQuery` an actor-aware visibility mode and
  `PublicEntryWritesService` a real actor — worth doing, and a change to the
  public API rather than to this seam.
- **The copilot's tool names changed.** They appear in `copilot_tool_calls`
  rows, so historical audit rows carry the old names. Nothing reads them
  programmatically; a reviewer looking at old rows sees the old spelling.
