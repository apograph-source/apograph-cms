# @orthacms/bootstrap-server

The server-side **host** for the Ortha CMS. Turns a list of plugins into a
running NestJS app. Owns the cross-cutting wiring that must exist exactly once;
contains no features.

## Package

- Name: `@orthacms/bootstrap-server`
- Import: `import { createServer, type ServerPlugin } from '@orthacms/bootstrap-server'`
- Server-only. Consumed from source like the other workspace packages.
- Lives at `packages/bootstrap/server` (grouped layout); npm name stays
  hyphenated.

## Conventions

- Uses `interface` for type contracts (not `type`)
- All exported symbols have JSDoc comments
- No `.js` extensions in TypeScript imports
- Types/interfaces go in `src/lib/types/`; plain functions in `src/lib/utils/`;
  the NestJS module in `src/lib/`
- Always import types with the `type` keyword
- `experimentalDecorators` and `emitDecoratorMetadata` are enabled

## Key exports

- `createServer(options)` — bootstraps the app: runs plugin init hooks, imports
  plugin modules, applies global prefix + body cap + `ValidationPipe`, generates
  the OpenAPI document + mounts the Scalar reference, enables shutdown hooks,
  listens. **Returns the listening app**, so an embedding host (or a test) can
  close it again
- `ServerModule` — dynamic root module; `forRoot(plugins)` imports every
  plugin's module
- `ServerPlugin` — the plugin contract: `{ name, module, onPluginInit? }`
- `CreateServerOptions` — `plugins`, `port?`, `host?`, `globalPrefix?`,
  `trustProxy?`, `bodyLimit?`, `docs?`, `staticDir?`. `host` omitted keeps
  Node's wildcard bind, which is what a container wants; name one to bind a
  single interface. In-process tests must name `127.0.0.1`, because a wildcard
  `listen(0)` succeeds on a port another process already holds on loopback
  (Node sets `SO_REUSEADDR`) and the request then reaches that process —
  see `apps/server-e2e/AGENTS.md`
- `TrustProxySetting` — Express's `trust proxy` value: a hop count, a boolean,
  or a subnet/preset string
- `setupApiDocs(app, plugins, docs?, globalPrefix?)` — the API-reference wiring,
  exported for a host that builds its own `INestApplication`. **Call it before
  `app.init()` / `app.listen()`**, as `createServer` does: it registers on the
  http adapter, and a call made after the Nest router is mounted appends a layer
  the router already shadows — it returns the paths and serves nothing, with no
  error. The prefix must also already be set, or the document describes URLs
  nothing serves.
- `ApiDocsOptions` / `PluginApiDocs` / `ApiSecurityScheme` — the docs contracts

## Architecture

- **Construct + assemble.** `createServer` is the single place the Nest app is
  created. `ServerModule.forRoot(plugins)` collects each plugin's `module` into
  one root module.
- **Lifecycle.** Before `NestFactory.create`, `createServer` runs each plugin's
  `onPluginInit()` **in array order**. This is the hook a plugin uses for setup
  that must complete before the app boots (e.g.
  [`@orthacms/database`](../../database/AGENTS.md) opens its connection here).
  List resource-providing plugins (database) first — but be precise about what
  that buys, because it is easy to over-claim: **every** hook runs before
  `NestFactory.create`, so by the time any provider is instantiated the database
  is open no matter where `DatabasePlugin` sits in the array. Moving it behind
  `IdentityPlugin` boots a fully working server; it is the plugin being
  _present_ that matters to DI, not its position. Order is load-bearing for
  `db:migrate` (FK dependencies between plugins' schemas), for a hook that
  genuinely depends on an earlier hook's side effect, and for the docs passes
  (`decorate` and the security-scheme merge run in registration order, last
  writer wins).
- **Global policy, once.** The `api` prefix and the strict `ValidationPipe`
  (`whitelist` + `forbidNonWhitelisted` + `transform`) are configured here so no
  plugin repeats them.
- **Proxy trust, once.** `trustProxy` is applied to the Express adapter before
  the prefix, because it decides what `req.ip` resolves to — and a plugin that
  rate-limits or audits by client address is only as correct as that. Unset by
  default: Express then ignores `X-Forwarded-For`, which is right for a
  directly-exposed server and **wrong behind any proxy**, where every caller
  reports the proxy's address and identity's login throttle degenerates into one
  global bucket. Deployments set `TRUST_PROXY` to their hop count. Never trust a
  chain you don't terminate — a spoofable `X-Forwarded-For` makes the limit one
  header away from bypassable. What each accepted form actually resolves
  `req.ip` to — measured against a live server with a forged three-entry
  `X-Forwarded-For: 1.1.1.1, 2.2.2.2, 3.3.3.3` from a loopback peer:

    | `TRUST_PROXY`               | `req.ip`  | Notes                                                                      |
    | --------------------------- | --------- | -------------------------------------------------------------------------- |
    | unset / `0` / `false`       | the peer  | the header is ignored entirely — the directly-exposed posture              |
    | `1`                         | `3.3.3.3` | one hop from the **right**; a client cannot forge past the count           |
    | `2`                         | `2.2.2.2` | two hops from the right                                                    |
    | `true`                      | `1.1.1.1` | the **leftmost** entry — fully client-controlled; only on a closed network |
    | `loopback`, `::1`           | `3.3.3.3` | walks right-to-left past trusted addresses; here the peer is the only one  |
    | a subnet the peer is not in | the peer  | fails **closed** — an unmatched list silently behaves exactly like unset   |
    | anything unparseable        | —         | `proxy-addr` throws at `app.set`: the boot fails and exits 1 (fails loud)  |

    The second-to-last row is the one to watch: a wrong-but-valid subnet degrades
    to "ignore the header" without a word. That is the safe direction, and it is
    indistinguishable from a correct configuration until you read a session row.

- **Body size, once.** `bodyLimit` (default `'1mb'`, host env
  `MAX_REQUEST_BODY`) re-registers the JSON + urlencoded parsers. Set here
  rather than inherited: `express.json()`'s own default is 100 kB — measured at
  exactly 102 400 bytes — which a long-form entry with embedded rich text
  exceeds, and the parser answers `413` above every controller, guard and
  protocol layer, so an MCP client gets a REST error body rather than a JSON-RPC
  frame. Multipart uploads do not pass through here; the media plugin caps
  those separately with `MEDIA_MAX_UPLOAD_BYTES`.
- **API docs, once.** `setupApiDocs` (`utils/setup-api-docs.ts`) runs after the
  prefix + pipe and before `listen`, so the document describes the real URLs.
  Each plugin's `decorate` pass is guarded individually: the reference is
  developer tooling, so a plugin that throws while describing itself costs its
  own contribution and a logged error, not the whole boot. See below.
- **The admin bundle, optionally.** `staticDir` (`utils/serve-admin.ts`) serves
  a built admin from the same process, with an SPA fallback — so the API and
  the UI share **one origin**. That is the point rather than a convenience:
  identity's session is an `httpOnly`, `SameSite=lax` cookie, which a UI on
  another origin never sends, and it is why `apps/admin`'s Vite config proxies
  `/api` in development. Unset here — `apps/server` is API-only, Vite serves
  `apps/admin` — and set by a generated app, which has no dev proxy in
  production. Mounted **last**, after every controller and the reference, and
  the fallback refuses the API prefix, `/reference`, non-GET methods and
  requests that do not accept HTML: applied indiscriminately it would answer a
  mistyped endpoint with `200` and a page of HTML instead of a JSON `404`. A
  missing bundle warns and serves the API anyway rather than failing boot.
- **Shutdown, once.** `app.enableShutdownHooks()` before `listen`. Without it
  `SIGTERM` — how every orchestrator ends a pod — reaches node's default handler
  and the process dies where it stands: measured, six concurrent in-flight
  logins all ended in a reset connection, and all six completed once the hooks
  were on. With them Nest closes the HTTP server, drains what it already
  accepted, runs every module's `onModuleDestroy`, then re-raises the signal.
- **A boot failure names what failed.** A plugin's throwing `onPluginInit`, and
  a failed `listen`, are logged through `Logger.error` naming the plugin (or the
  port) before the rejection propagates; `apps/server/src/main.ts` catches it,
  logs, and exits `1`. Previously all three — a bad hook, an invalid
  `TRUST_PROXY`, a port already in use — surfaced as a bare unhandled-rejection
  dump with nothing in it saying which of a dozen plugins refused to start.

## API reference (OpenAPI + Scalar)

`createServer` generates the OpenAPI document from the assembled app
(`@nestjs/swagger`) and serves it as a [Scalar](https://scalar.com) API
reference. Two routes, registered on the **http adapter** rather than the Nest
router — so they sit outside the global prefix, outside every guard, and outside
the `ValidationPipe`:

- `GET /reference` — the Scalar UI (HTML that loads Scalar's standalone bundle
  from a CDN and renders the embedded document client-side; point `docs.cdn` at
  a self-hosted copy for an air-gapped deployment)
- `GET /reference/json` — the raw OpenAPI 3.0 document, for codegen

Both paths are configurable (`docs.path` / `docs.jsonPath`). The JSON route is
registered **first**, so it still wins when it lives under the UI mount.

- **Off in production by default.** `docs.enabled` defaults to
  `NODE_ENV !== 'production'`; the host overrides it from `API_DOCS`
  (`API_DOCS=true` publishes, anything else — including `1` and `TRUE` — does
  not, because the host compares `=== 'true'`). Both routes ride the one flag,
  so `/reference/json` is never reachable when `/reference` is not.
  The default is **fail-open**, and exactly: the comparison is a literal string
  match, so `NODE_ENV=Production` and `NODE_ENV=prod` publish the reference just
  as an unset `NODE_ENV` does. It is the same missing variable that leaves the
  session cookie without `Secure` (`ortha.config.ts`) and turns on the GraphiQL
  playground — treat "is `NODE_ENV` exactly `production`?" as one deployment
  check, not three.
- **Grouped by resource, not by controller.** `autoTagControllers` is disabled
  and `tagByResource` tags each operation with the first route segment after the
  prefix (`/api/content/post` → `content`). The codebase runs one controller per
  use case, so the default would produce ~50 one-operation groups.
- **Schemas come from the DTOs.** The swagger CLI plugin is **not** wired (the
  server builds with webpack + `tsc`), so nothing is inferred: every DTO
  property carries an explicit `@ApiProperty`/`@ApiPropertyOptional`. A new
  property without one is silently absent from the docs — see the
  `server-plugin` skill. That covers **request** bodies; responses are the gap
  below.
- **Auth is plugin-described.** The host has no guards, so it doesn't invent
  security schemes: a plugin declares its own through `ServerPlugin.docs`
  (`securitySchemes` + `defaultSecurity`), and `setupApiDocs` merges every
  plugin's contribution. `@orthacms/identity-server` contributes the
  `ortha_session` cookie and the bearer API token.
- **A plugin with a dynamic contract describes itself.** `ServerPlugin.docs`
  also takes a `decorate(document)` hook, run last (after tagging), in
  registration order. It exists because the scanner only sees static
  TypeScript: `@orthacms/content-server` serves every code-defined content type
  through one generic controller set, so it uses this hook to add a schema per
  registered type and attach them to its own routes — see that package's
  `AGENTS.md`. A plugin amends only what it owns; the document is shared.

### The response-schema gap

**Most operations still describe no response payload.** Measured against a live
server (`GET /reference/json`, 10 content types registered): **45 of 162**
operations carry a 2xx JSON schema. Of the 117 that do not, 16 answer `204` and
so correctly have no body; the rest — 75 `200`s and 26 `201`s — are a real hole.
A consumer reaching for the document to learn what comes back cannot, and has to
curl the live API instead.

**The cause is three things, and only the third is the one that matters:**

1. Almost no handler carries `@ApiOkResponse` / `@ApiCreatedResponse`. Five files
   in the whole repo use any response decorator, so the scanner emits a bare
   `{ '200': { description: '' } }`.
2. The `@nestjs/swagger` CLI plugin is not enabled (no `nest-cli.json`, no
   `transformers` entry in `apps/server/webpack.config.js`), so nothing is
   inferred from the return types either.
3. **Turning it on would not help.** The plugin's controller transformer emits
   `@ApiResponse({ type: X })` only when `X` is a value it can reference at
   runtime — a class. Every response view type in this repo is a TypeScript
   `interface` (`PublicEntry`, `WorkspaceView`, `AssetView`, `SegmentView`,
   `WebhookEndpointView`, …), which is erased at compile time and carries no
   metadata. And several of them live in `domain/`, where ADR-0003 forbids the
   `@nestjs/swagger` import a decorated class would need. So this is **not** one
   configuration switch away.

**How to close it, per package.** Not with 100 hand-written decorators, and not
by converting the view interfaces to decorated classes. Use the mechanism the
document already runs on: `ServerPlugin.docs.decorate`. It writes plain OpenAPI
schema objects onto the finished document, needs no decorator and no class, and
so sidesteps the domain-purity rule entirely.
`@orthacms/content-server`'s `src/lib/docs/` is the worked example — a schema
module, a route table keyed by what follows the plugin's prefix, and a pass that
writes the schema onto whichever 2xx key the scanner already emitted (never
inventing a status code). A plugin with a fixed contract needs perhaps 100 lines
of it.

**What is done.** The public content API (`/api/v1/content*`,
`/api/v1/content-types*`) — 22 of its 30 operations, the other 8 being two `204`
deletes, the binary `/v1/media/assets/{id}/raw`, and five operations owned by
other plugins. It went first because it is the document's real audience, and
because 13 of its operations were not merely undescribed but **wrong**: the
content pass's route pattern matched the `/v1/` spelling too, so the published
contract was reported with the admin's schemas.

Since then, **`transfer` (5), `segments` (9) and `content-server`'s saved views
(3)** as well — each a `docs.decorate` on its own plugin, each verified by
replaying the live responses through `ajv` against the published document.
Two things that pass found are worth carrying forward:

- **A route's owner is not always the plugin whose prefix it sits under.**
  Transfer's `/api/content/{typeName}/export*` and segments'
  `/api/v1/content/{typeName}/{id}/access` are mounted inside content's
  `{typeName}` namespaces. Content's pass lists them as `FOREIGN` and writes
  **only** the registered-name enum onto the parameter — the bodies and the
  failure codes belong to the owners, and the owners disagree (transfer 404s an
  unknown type; the public `/access` route answers 400), so a blanket 404 from
  the neighbouring pass would have published something the API does not do.
- **Anchor a route pattern at both ends.** `/\/views(…)$/` also matches
  `/api/insights/views`; `/^\/[^/]+\/views(…)$/` does not. The looser spelling
  is the same shape that once put the admin's schemas on the public content API,
  and it was caught here only because the fixture carried a foreign route that
  ended in the same word.

**What remains**, by owning plugin, largest first: `workspaces` 13 (including
the admin `GET /api/content-types` — a workspaces controller over its own
`CONTENT_CATALOG` port, despite the content-shaped path), `media` 12,
`identity` (auth 12 + users 11 + api-tokens 3), `webhooks` 10, `insights` 10,
`alarms` 9, `i18n` 3, `activity` 3, `preferences` 2, `content-graphql` 2. A
`docs.decorate` pass per plugin, in that order, finishes it.

The three counts at the top of this section are the **pre-pass** measurement and
will be stale until the last plugin lands; re-measure against
`GET /reference/json` rather than trusting them.

## Configuration

Options flow from `apps/server/ortha.config.ts` (the single reader of
`process.env`) into `createServer`:

```typescript
// apps/server/src/main.ts
createServer({
    plugins: [DatabasePlugin({ connectionString: config.database.url })],
    port: config.port,
    globalPrefix: config.globalPrefix,
    trustProxy: config.trustProxy,
    bodyLimit: config.bodyLimit,
    docs: config.docs
}).catch((error: unknown) => {
    // The host owns the exit code; the package owns naming what failed.
    Logger.error('The server failed to start.' /* … */);
    process.exit(1);
});
```

## Not owned here (deferred until a plugin needs it)

- Auth guards / sessions, a plugin registry, nav/permission concerns
- Per-operation API docs (summaries, response schemas): the host generates the
  document, but `@ApiOperation`/`@ApiResponse` belong on the plugins'
  controllers — see [the response-schema gap](#the-response-schema-gap)
- Lifecycle beyond `onPluginInit` and `enableShutdownHooks`. The host turns
  shutdown hooks **on**, so a plugin gets `onModuleDestroy` on `SIGTERM`; what
  it does with it is the plugin's business. Note `@orthacms/database` binds
  none, so the pg pool is not drained on shutdown — harmless when the process
  is about to exit anyway, and the reason an embedding host that keeps running
  must call `closeDatabase()` itself.
- Actual endpoints — those live in feature plugins' modules

## Tests

Coverage is split by what can observe the defect.

**`apps/server-e2e`** — everything a request can see. A host is only meaningful
with an app around it, so this is where most of it lives:

- **`src/harness/create-server.spec.ts`** drives `createServer` itself: it boots
  the real host on an ephemeral port and closes it again. This is the file that
  can fail on a host defect, because every other suite goes through
  `createTestApp`, which _mirrors_ the bootstrap and therefore cannot. It covers
  the body cap in both directions, a throwing `onPluginInit` (rejects, and the
  log names the plugin), a throwing `decorate` (logged, boot survives, reference
  still served), the shutdown-hook registration, and the docs mount paths
  (`null` when disabled, both paths normalised, JSON wins a collision).
- **`src/harness/production-parity.spec.ts`** pins the docs flag in both
  directions and the session-cookie shape, through the harness.
- **`src/server/auth/login-throttle-proxy.spec.ts`** is what makes `trustProxy`
  observable: distinct forwarded clients get distinct rate-limit buckets, and
  the forwarded address — not the proxy's — lands on the session row.

**The package's own unit specs** (jest; `npm exec nx test @orthacms/bootstrap-server`)
— the composition root's _ordering_, which no request can see. `NestFactory.create` is
mocked and the application it returns is a recording object, so the sequence of
calls the host makes on it is the observable: every `onPluginInit` awaited in
array order before the app exists (I-02), `trust proxy` applied when configured
and untouched when not (I-04), the document generated after the prefix and the
pipe and before `listen` (I-07), the admin bundle mounted after the controllers
and both reference routes (I-15). The global `ValidationPipe` is pulled off
`useGlobalPipes` and **exercised** rather than introspected, which is what pins
all three of its flags (I-06). `setup-api-docs.spec.ts` does the same for the
document's security schemes: the case that matters is the one with no
contributing plugin, because "the host invents none" is only visible against a
document nobody contributed to (I-21).

They exist because two of those — `trust proxy` and the pipe's flags — used to be
asserted only against `createTestApp`, which _re-implements_ the bootstrap.
Deleting either line from the real `create-server.ts` left the whole suite green.
`src/host-boundaries.spec.ts` covers the other shape a request cannot show: that
the package does not depend on `express` and declares its request/response types
structurally (I-36).

`tagByResource`'s non-operation-key guard **is** covered, and how it got there
is worth keeping: it was written off as having "no reachable repro" on the
grounds that `@nestjs/swagger` emits no path-level `parameters` and `decorate`
runs _after_ tagging, so nothing can stage one. That is a fact about the
scanner, not about the harness — `setup-api-docs.spec.ts` already stubs
`SwaggerModule.createDocument`, so the document is whatever a test says it is,
and a path item carrying `parameters`, `$ref`, `summary` and `servers` goes
straight in (I-12). Nothing had to be exported to reach the branch.

The same file also pins the host's own emptiness (I-01, first sentence): no
`CanActivate`, no `@Controller` or method decorator — the reference routes are
registered on the http adapter and deliberately are not these — no `pgTable`,
and a manifest declaring no `@orthacms/*` at all. Its second sentence ("adding a
capability never requires editing a file in `packages/bootstrap`") is a claim
about future diffs and stays uncovered by design.

One thing is deliberately uncovered. SIGTERM's effect on in-flight requests is
asserted only as "the listeners are installed" — the drain itself was measured
by hand against the built bundle (six concurrent logins, all reset before, all
`401` after) because a jest worker cannot signal itself without ending the run.

## Commands

- `npm exec nx typecheck @orthacms/bootstrap-server`
- `npm exec nx build @orthacms/bootstrap-server`
