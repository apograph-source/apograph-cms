# @orthacms/tools-server

The shared, transport-neutral catalogue of everything an agent can do to this
CMS — and the **single place a tool call is authorized**.

> [ADR-0007](../../../docs/adr/0007-one-tool-registry-two-surfaces.md) is why
> this package exists; [ADR-0006](../../../docs/adr/0006-cms-as-an-mcp-server.md)
> §2 is where the seam was first described (inside `mcp/server`, before it had
> two consumers).

## Two consumers, one registry

- **`mcp/server`** exposes it to external agents over `POST /api/v1/mcp`.
- **`copilot/server`**'s run loop injects the same instance in-process.

That is the whole reason **no transport crosses the tool contract**. A handler is
handed a `ToolContext` and a plain argument bag — never a request, a response, or
a protocol envelope — and no JSON-RPC vocabulary appears anywhere in the package
(`transport-neutrality.spec.ts`). HTTP and MCP do appear, in two places and only
two: refusals are Nest `HttpException`s flattened to a numeric
`ToolError.status`, and `mcp` is one of the two `ToolSurface` labels beside the
`readOnly`/`destructive` client hints. A tool added for either consumer is
reachable by the other unless it says otherwise, and neither can end up with a
private set of rules.

**`ToolsModule` is imported by both, provided by neither.** If `McpModule`
provided the registry, a deployment running the copilot without MCP would have
no registry and no tools; if each provided its own, a capability plugin's tools
would land in whichever won. Nest caches a static module by class, so importing
it twice yields one instance — the invariant the whole seam rests on.

A capability plugin does **not** import `ToolsModule`. It injects `ToolRegistry`
`@Optional()` and registers itself from `onModuleInit`, because a deployment may
run neither consumer and its tools then simply go unregistered.

## The authorization invariant

`call()` checks `requires` **before dispatch**. `visibleTo()` merely _hides_
what the actor could not call anyway.

Filtering a list is a usability nicety — an MCP client is free to invoke a name
it was never shown, and a model may hallucinate one outright — so the check in
`call()` is the security boundary and must stay that way. This is the direct
analogue of `@RequirePermissions(...)` on a route: Nest gates _routes_, and both
consumers are one route carrying many operations.

`requires` is therefore a **security-critical field** that no type checker
validates. A new tool needs an authorization test.

**Resources go through the same gate.** `ResourceDefinition.requires` is
optional and every shipped resource omits it (the content-type schemas are
already narrowed to the workspace's grants by the provider that builds them),
but when one is declared, `resources()` hides the resource **and**
`readResource()` refuses it — because a client may read a URI it was never
listed, exactly as it may call a tool it was never shown.

**A refusal names the permission it wanted.** `"content_delete" requires
content:delete, which this token does not hold.` goes back to a third-party
model verbatim. That is deliberate ([ADR-0007](../../../docs/adr/0007-one-tool-registry-two-surfaces.md)
§6): the tool set is derived from the caller's own scope and reveals nothing
about anyone else, and an undiagnosable permission problem costs more than the
key name. Be aware it leaks the *shape* of the permission model — so keep the
message to `requires` and never let a handler's own reason join it.

## Validation

Two checks the registry owns, so no consumer has to remember them:

- **At boot.** `onApplicationBootstrap` walks the assembled catalogue once and
  refuses to start on a duplicate name, a name that is not `snake_case`, an
  empty `surfaces` array (offered to neither consumer — dead on arrival), an
  `inputSchema` that is not an object schema, or a `requires` entry that is not
  a permission this deployment defines. That last one is what catches a raw
  `'content:delete'` literal gone stale or a stray space: `can()` is exact-match
  set membership, so such a tool is silently uncallable by everyone. Every
  problem is reported at once, and the throw aborts `app.init()` — a wiring bug
  belongs to the deploy, not to the first caller who trips over it.
- **Per call.** `call()` checks the arguments against the tool's own
  `inputSchema` (`validateToolInput`) after authorizing and before dispatch, and
  answers a `validation_failed` naming each field. It is **not** a boundary —
  `requires` is — and its JSON Schema subset ignores `anyOf`/`oneOf`/`$ref`/
  `format`/`pattern`, so a rule nested inside a combinator is not checked at
  all. Do not read it as one: a handler still owns every rule about its own
  values.

`register()` is **idempotent per provider instance**, so a plugin that
registers twice is a no-op rather than a catalogue where every tool collides
with itself.

## Surfaces

`surfaces?: readonly ('mcp' | 'copilot')[]`, and **omitted means both**.

Sharing a registry does not mean every tool suits every caller. The content
tools are split, for reasons that are not incidental:

|                   | MCP's content tools                   | The copilot's                                  |
| ----------------- | ------------------------------------- | ---------------------------------------------- |
| Reads through     | `PublicEntriesQuery` (published-only) | `EntriesService` (the admin's list)            |
| Drafts visible to | callers holding `content:update`      | anyone with `content:read` — a viewer too      |
| Writes attributed | `null` (a token is not a user)        | the accepting human                            |
| Write shape       | direct (`content_create`)             | `propose` → a reviewed `copilot_proposals` row |

A viewer's copilot offered `content_list` would silently stop seeing drafts,
which is most of what the chat panel is for. So the tool declares its audience
rather than a filter elsewhere guessing.

`forSurface` narrows the catalogue **and** `call` applies the same narrowing,
for the same reason the permission check is in `call`: a caller may name a tool
it was never shown. Cross-surface leakage is covered by e2e cases in both
suites — a `surfaces` omitted from a propose tool would make it callable by an
MCP client that has no way to accept the resulting proposal.

**But the split is not the default, and it is not total.** These are shared —
offered to both, with no `surfaces` field:

| Tool                  | Why it is shared                                             |
| --------------------- | ------------------------------------------------------------ |
| `i18n_locales_list`   | deployment config; identical for every caller, no publish state |
| `media_assets_search` | assets have no draft/published state to leak                 |
| `media_folders_list`  | same, and workspace-scoped identically for a token and a user |
| `media_asset_read`    | same; both token scopes carry `media:read`                   |

## Adding a tool: decide `surfaces` deliberately

**Every new tool must answer "who is this for?" before it is written**, whether
it was prompted by the copilot or by MCP. An accidental omission and a
considered one produce identical code and opposite intentions, so record the
answer either way: a `surfaces` array with a comment saying what the tension is,
or no field with a comment saying there is none.

Work these in order; the first **yes** decides it. Note that they are about the
tool, not about which consumer asked for it — a tool written for the copilot
that answers "no" to all five belongs to both.

1. **Does the handler write, or return a change for someone else to apply?**
   → `['copilot']`. A `propose` handler writes nothing and hands back a draft
   for the run engine to record and apply; MCP has no engine, so the call would
   look like a success and change nothing at all. A direct `apply` tool is worse
   — its receipt is a `copilot_proposals` row the run engine writes
   ([ADR-0009](../../../docs/adr/0009-copilot-applies-directly.md)), so over MCP
   it would write with nothing recording that it had.
2. **Does it expose unpublished content on `content:read` alone?** Drafts,
   revision snapshots, sibling translations, anything derived from the admin's
   services rather than `public-api/`. → `['copilot']`. A **token's**
   `content:read` is the public API's published-only scope; a **user's** is a
   viewer who legitimately sees drafts in the admin UI. Same key, two meanings,
   and this is where that bites.
3. **Does it need a permission no token scope mints?** `scopePermissions` yields
   only `content:*` plus `media:read`/`media:create`. Anything requiring
   `activity:read`, `users:read`, `media:update`… can never list for a token.
   → `['copilot']`, so the reason is declared rather than left to a coincidence
   of the scope table that a future scope would silently undo.
4. **Does it read or write something that only means anything for a signed-in
   human?** Attribution to the accepting user, the current conversation, a
   pending proposal. → `['copilot']`.
5. **Is it built on `public-api/` and therefore published-only?** → `['mcp']`.
   Offering it to the copilot is the downgrade in the table above.

Otherwise: **omit the field and share it.** That is the path of least
resistance by design, not a loophole.

### What a shared tool may and may not vary

`ToolContext.surface` is stamped by `call()` — always the surface the call was
authorized against, never something a caller asserts. Use it for
**presentation** only:

```typescript
// Right: same asset, same scoping, a link the caller can actually fetch.
downloadPath: surface === 'mcp'
    ? `/api/v1/media/assets/${id}/raw`   // bearer-fetchable
    : `/api/media/assets/${id}/raw`;     // session + membership
```

Never for **authority**. A tool that wants `if (surface === 'copilot')` around a
permission check, a filter, or a field it withholds is two tools — split it, and
let `requires` and `can()` mean one thing for everybody.

This is enforced rather than reviewed. `surface-is-presentation.spec.ts` scans
every `ToolProvider` in the workspace and asserts the set that reads
`.surface` is exactly one file — the media provider, for the link above — so a
second reader fails the suite and has to be argued for in that list. The media
provider's own spec then pins what the one permitted read may do: the same
query arguments, the same field set, and a difference of exactly
`downloadPath`. A handler learns its surface only from the context the registry
stamps, which is what makes that pair complete rather than a sample.

### The rest of the checklist

- **Throw `HttpException` subclasses, not bare `Error`s.** The two surfaces
  flatten a throw differently: the copilot's run engine reports
  `error.message`, while `toToolError` treats a non-`HttpException` as a bug and
  returns an opaque 500 with the message withheld. A shared tool that throws
  `new Error('No such asset')` is legible in the panel and useless over MCP.
- **Update both cross-surface e2e suites.** `mcp.spec.ts` asserts which tools a
  token is and is not shown; `copilot-read-catalogue.spec.ts` does the same for
  a run. A tool absent from both lists is a tool nobody is checking.
- **`requires` still needs its own authorization test** (see above). `surfaces`
  narrows who is *offered* a tool; it is not a substitute for the permission it
  declares.

### Worked examples of a "no"

Two tools that look shareable and are not, recorded so the question is not
reopened from scratch:

- **`admin_content_revisions` / `admin_content_diff`** — no MCP analogue exists,
  and they already re-check workspace content grants, so they read like free
  capability. They fail (2): a revision timeline *is* the draft history, on
  `content:read`. Tightening `requires` to include `content:update` would fix
  MCP and **regress the copilot** — a viewer would lose version history they can
  see in the admin UI today, which `copilot-read-catalogue.spec.ts` pins. The
  real fix is an actor-aware visibility mode on `PublicEntriesQuery`
  ([ADR-0007](../../../docs/adr/0007-one-tool-registry-two-surfaces.md) names
  it), not a widened `surfaces`.
- **`i18n_translations_get`** — sits in the same file as the shared
  `i18n_locales_list`. It fails (2) too, less visibly: `LocaleGroupService`'s
  `liveWhere` scopes to workspace and soft-delete but **not** publish state, so
  it reports a draft sibling and its status. The tool next door being shared is
  not an argument.

## `effect` vs `readOnly`

Two vocabularies, because they answer different questions:

- **`readOnly` / `destructive`** are MCP's client hints — what is safe to
  auto-approve in a tool picker.
- **`effect`** (`read | propose | apply`) is the authority vocabulary: whether a
  handler's return value is a _result_ or a _change_. It is what makes the
  copilot's run engine persist a proposal instead of a tool result.

A `propose` tool is not read-only in the MCP sense (it is half of a write flow),
and a direct-write tool is not `propose` however destructive it is. Neither
field can be derived from the other.

## Naming

`snake_case`, unique across every provider — a duplicate is a wiring bug and
`all()` throws rather than letting registration order decide which
implementation runs. Namespaced by subject (`content_list`, `content_create`);
the copilot's admin-scoped counterparts carry an `admin_` prefix
(`admin_content_search`) so the two sets read apart at the call site and in
every audit row.

## Conventions

- `interface` for contracts, `type` for unions
- All exported symbols carry JSDoc
- No `.js` extensions in imports; always `import type` for types

## Commands

- `npx nx typecheck @orthacms/tools-server`
- `npx nx lint @orthacms/tools-server`
- `npx nx test @orthacms/tools-server`
