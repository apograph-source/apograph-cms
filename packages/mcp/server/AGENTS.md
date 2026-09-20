# @orthacms/mcp-server

> **The tool registry moved out.** `ToolDefinition` / `ToolContext` /
> `ToolProvider` / `ToolRegistry` / `createToolContext` / `toToolError` now live
> in [`@orthacms/tools-server`](../../tools/server/AGENTS.md)
> ([ADR-0007](../../../docs/adr/0007-one-tool-registry-two-surfaces.md)). This
> package owns the **protocol** and nothing else — the endpoint, bearer auth,
> workspace resolution, JSON-RPC dispatch. It imports `ToolsModule` for the
> registry rather than providing it, because the copilot imports the same one.
>
> Consequently a tool declares `surfaces`, and every **content** tool served
> here is `['mcp']`: they read the public API's published-only services and
> attribute writes to a token, which is right for an external agent and wrong
> for the chat panel. The e2e asserts no copilot-only tool is listed **or
> callable** here.
>
> **This endpoint serves more than its own tools.** `i18n_locales_list` and the
> three `media_*` reads name no surface and are offered to both consumers — so a
> change to a tool you did not write can change what this endpoint exposes.
> Adding a tool anywhere in the monorepo means answering "who is this for?"
> against the checklist in
> [`tools/server`](../../tools/server/AGENTS.md#adding-a-tool-decide-surfaces-deliberately),
> which is the canonical home for that decision.

The **Model Context Protocol** front door onto the CMS, and the home of the
shared **agent tool registry**. An external agent — Claude Desktop, Cursor, an
SDK-built client — connects to `POST /api/v1/mcp` with an API token and gets the
content CRUD the public HTTP API serves.

Owns **no tables**, **no migrations**, and **no tools**. It owns the protocol,
the authentication, and the registry; capability plugins contribute the tools.
See [ADR-0006](../../../docs/adr/0006-cms-as-an-mcp-server.md) for why.

> Not to be confused with the copilot's planned MCP **client**
> ([`docs/design/copilot.md`](../../../docs/design/copilot.md) §4), which points
> the other way: that lets the copilot call an _operator's_ MCP servers. This
> package makes the CMS _be_ one.

## The shape

```
src/lib/
  types/
    mcp-config.ts        # kill switch + the identity clients see
  http/
    mcp-auth.service.ts  # bearer → verified token → ToolContext (+ workspace)
    mcp.controller.ts    # POST /api/v1/mcp, stateless Streamable HTTP
  protocol/
    build-mcp-server.ts  # per-request SDK server: tools/list, tools/call, resources/*
```

`ToolDefinition` / `ToolContext` / `ToolProvider` / `ToolRegistry` /
`createToolContext` / `toToolError` all live in
[`@orthacms/tools-server`](../../tools/server/AGENTS.md) and are imported from
there — this package defines none of them.

## Who contributes tools

`content/server` contributes the CRUD set, `i18n/server` the locale tools,
`media/server` the asset ones — and `segments/server` contributes three over
**reader entitlements**: `segments_list`, `content_access_get` and
`content_access_set`. That last one is `surfaces: ['mcp']`, because the copilot's
counterpart proposes rather than writes; the two reads are offered on both. A
token reaches them through the scope mapping, which carries `segments:read` on
both scopes and `segments:manage` on `full` — an agent that cannot ask whether an
entry is restricted reports a partial list as the whole one, since the read scope
subtracts restricted entries from `total` as well as from `items`.

Nothing here reaches the audience **directory**: creating, renaming or deleting a
segment changes visibility across every entry naming it, and that stays on a
session-authenticated screen. See
[`packages/segments/server/AGENTS.md`](../../segments/server/AGENTS.md).

## Two consumers, one registry

`ToolDefinition` and `ToolContext` mention no HTTP, no JSON-RPC, and no MCP.
That is deliberate and is the main structural idea here:

- **The MCP endpoint** builds a `ToolContext` from a bearer token and exposes
  the registry over JSON-RPC.
- **The copilot's tool loop** (once its run engine lands) injects the _same_
  `ToolRegistry`, builds a context for the **signed-in user** with
  `createToolContext`, and calls the same tools in-process.

A tool added for one is automatically available to the other. Nothing in this
package needs to change when the copilot arrives — it injects `ToolRegistry`
(exported, global) and supplies an actor with `kind: 'user'` whose
`grantedPermissions` come from identity's RBAC rather than a token scope.

## Contributing tools (the `ToolProvider` port)

Nest has no multi-provider token, so registration is a **call**, not a binding:

```typescript
@Injectable()
export class MediaToolProvider implements ToolProvider, OnModuleInit {
    constructor(@Optional() private readonly toolRegistry?: ToolRegistry) {}

    onModuleInit(): void {
        this.toolRegistry?.register(this);
    }

    tools(): readonly ToolDefinition[] {
        return [
            {
                name: 'media_upload',
                title: 'Upload an asset',
                description: 'Written for a MODEL — see below.',
                inputSchema: { type: 'object', properties: {} },
                requires: [PERMISSIONS.MEDIA_CREATE],
                readOnly: false,
                handler: async (input, context) => {
                    /* call this plugin's own services */
                }
            }
        ];
    }
}
```

`@Optional()` because MCP is a plugin: a deployment that omits it must still
boot, with contributors simply going unregistered.

Register the provider in your plugin's module `providers` array. Tool names must
be unique across every plugin — a duplicate throws from `ToolRegistry.all()`
rather than silently resolving by registration order.

### Rules for a new tool

- **`requires` is security-critical.** It is the analogue of
  `@RequirePermissions(...)`, enforced centrally by `ToolRegistry.call` **before**
  dispatch. A handler must not check its own gate, and getting this field wrong
  is a privilege bug no type checker catches — **add a registry test with it.**
- **Delegate; never restate a rule.** Call the services your plugin's HTTP
  controllers call. That is what keeps the two surfaces from drifting.
- **Write the description for a model.** It is the only documentation the caller
  gets, so workflow rules belong in it: that a create yields a draft, that
  publish is separate, that an update merges.
- **Validate through the HTTP DTO.** `content/server`'s `validateToolInput` runs
  the real `class-validator` DTO with the host's `ValidationPipe` options, so a
  bound (like the `pageSize` cap) is written once.
- **Mind the response size.** Every field is context the model pays for. Offer a
  sparse-fieldset argument and keep page sizes small.
- **Throw, don't return errors.** An `HttpException` becomes a model-readable
  `isError` result via `toToolError`, with a 422's per-field `issues` carried
  through verbatim — which is what lets a model fix its own next call.

## The endpoint

`POST /api/v1/mcp` — **stateless** Streamable HTTP with `enableJsonResponse`.
Every request authenticates from scratch, so there is no session store and no
sticky routing; the per-request protocol server is also what lets `tools/list`
reflect _this_ caller's scope.

`GET` and `DELETE` are answered **by the controller** with a 405, which is the
answer the specification reserves for a server that offers no server-initiated
stream and no sessions. The transport is deliberately not asked: handed a `GET`
in stateless mode it opens a standalone SSE stream and holds it **open forever**
— nothing here ever pushes a server-initiated message — so a client that probes
`GET`, which several do, would hang instead of learning the endpoint is
POST-only. Authentication still runs first, so an unauthenticated `GET` is a
401, not a 405.

**Authentication** is the existing bearer API tokens, verified through identity's
`ApiTokenService.verify`, with permissions from `scopePermissions` — the same
three rules `/api/v1/*` applies, restated for a non-Nest call site because a
guard gates a route and this is one route carrying many operations:

| `/api/v1/*` guard          | Here                                            |
| -------------------------- | ----------------------------------------------- |
| `ApiTokenGuard`            | `McpAuthService.authenticate` (bearer half)     |
| `ApiTokenWorkspaceGuard`   | `McpAuthService.authenticate` (workspace half)  |
| `@RequirePermissions(...)` | `ToolDefinition.requires` + `ToolRegistry.call` |

A **session cookie is not accepted**, exactly as on `/api/v1`: a cookie rides
along ambiently and would make this CSRF-able, and this endpoint writes content.

**Workspace resolution** takes `X-Workspace-Id`, or `?workspaceId=` on the
endpoint URL — the second spelling exists because MCP client configs are URL-
shaped and several clients make custom headers awkward. The header wins when
both are present, and both go through the identical bucket check. A
single-workspace token needs neither. Naming **more than one** workspace — a
repeated `?workspaceId=`, or a repeated `X-Workspace-Id` (which Node joins into
one comma-separated value) — is a 400 rather than a silent pick.

## What one exchange is allowed to cost

Three ceilings bound a request, none of which the tool registry can supply —
it is transport-neutral, and a request/response exchange has obligations an
in-process loop does not:

| Bound                                                                 | Where                  | Over it                                                                                       |
| --------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| **Request body**, 1 MB (`MAX_REQUEST_BODY`)                           | the host's `bodyLimit` | `413`, as a plain Nest body — this is above the JSON-RPC layer, so it is not a JSON-RPC frame |
| **One `tools/call`**, `callTimeoutMs` (30s; `MCP_CALL_TIMEOUT_MS`)    | `build-mcp-server.ts`  | an `isError` result, `504` / `timeout`                                                        |
| **One tool result**, `maxResultBytes` (4 MiB; `MCP_MAX_RESULT_BYTES`) | `build-mcp-server.ts`  | an `isError` result, `413` / `result_too_large`, naming both sizes                            |

The deadline **abandons, it does not cancel**: the handler is handed a signal
that aborts on expiry (and on the caller hanging up — the SDK's `extra.signal`,
relayed into `ToolContext.signal`), but a tool that ignores it runs to
completion with nobody reading the answer. Bounding the caller's wait is the
guarantee; ending the work is not one this layer can make.

The result ceiling exists because a result is serialised **twice** here — the
pretty-printed text block a model reads, and `structuredContent` for clients
that parse it — and the transport serialises the whole response again. A payload
that does not fit under the ceiling does not fit in a model's context either, so
the refusal tells it to ask for less.

## Two ways a failure leaves

A `tools/call` failure rides out as an **`isError` result**; a `resources/*`
failure rides out as a **JSON-RPC error**. That is the protocol's asymmetry, not
an accident, and it is worth knowing before "fixing" either half:

- a **tool** failure is an outcome the _model_ is meant to read and act on
  ("title must be at most 200 characters"), so MCP models it as a successful
  call carrying `isError`;
- a **resource** read has no model in the loop — a client asked for bytes at a
  URI and either gets them or does not — so MCP models its failures as protocol
  errors, with `-32002` reserved for a URI that is not there.

Both paths go through `toToolError` first, so the flattened
`{ status, code, message, issues }` is identical either way (it rides as the
JSON-RPC error's `data` on the resource path) and an unexpected throw is opaque
on both. A refusal and an absence share `-32002` deliberately: for _data_ the
answer is uniform, and `data.code` still distinguishes them for a client that
cares.

**Excluded from the OpenAPI document** (`@ApiExcludeController`): JSON-RPC over
one route is not describable as REST operations, and a lone `POST /v1/mcp` entry
would tell a reader nothing.

## Configuration

```typescript
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

**Off by default** (`MCP_ENABLED=true` to turn it on). Enabling it lets any
holder of a `full`-scope token drive content CRUD from an external agent — a
decision an operator makes deliberately, not one they inherit from an upgrade.
The same reasoning as the copilot's kill switch.

The **registry still binds when disabled**, and only the controller is removed:
the copilot consumes the registry in-process and has nothing to do with whether
an external endpoint is exposed. `CopilotModule` now applies `COPILOT_ENABLED`
the same way, for the mirror-image reason — so either switch takes its own
surface away and neither shrinks the catalogue they share
(`server-e2e/src/server/tools/tool-registry.spec.ts` asserts both directions).

## Connecting a client

The endpoint speaks Streamable HTTP directly. For a client that only speaks
stdio, `mcp-remote` bridges it — one line of client config and nothing for us to
maintain:

```json
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

Mint the token in the admin's **API Tokens** page: `read` scope for a
retrieval-only agent, `full` for one that authors. The scope is what decides
which tools the agent can even see.

## Commands

- `npx nx typecheck @orthacms/mcp-server` / `npx nx lint @orthacms/mcp-server`
- `npx nx test @orthacms/mcp-server` — unit tests (registry authorization,
  bearer + workspace rules, error mapping, plugin validation)
- `npx nx e2e server-e2e --testPathPatterns=mcp` — the wire-level suite (needs
  Docker), which drives raw JSON-RPC because that is the contract clients depend on
