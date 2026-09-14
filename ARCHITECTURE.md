# Architecture

How Apograph is built. For the _why_ behind these choices, see
[`docs/adr/`](docs/adr/README.md). For the project inventory and glossary, see
[`CONTEXT-MAP.md`](CONTEXT-MAP.md).

The countable claims below — how many slots, which contract fields, what tables
a plugin owns — are derived from the code and checked by
[`tools/docs-guard`](tools/docs-guard/AGENTS.md), not maintained by hand.

## 1. The big idea: a plugin host

Apograph is not a monolith with features bolted on. It is a small, dumb **host**
that turns _a list of plugins_ into a running application. The host owns no
domain logic — no auth, no users, no content. All capability lives in plugins.

There are two hosts, one per runtime:

- **`@apograph/bootstrap-admin`** — `createAdmin({ plugins })` mounts the React
  root, the router, the providers (TanStack Query, `IntlProvider`), and the
  routes each plugin contributes.
- **`@apograph/bootstrap-server`** — `createServer({ plugins })` runs each
  plugin's `onPluginInit`, imports its NestJS module, and applies the global
  `/api` prefix + `ValidationPipe`.

Adding a capability = adding a plugin and registering it. You never edit the
host. Registration happens in:

- `apps/admin/src/main.tsx` — the admin plugin list
- `apps/server/src/plugins.ts` — the server plugin list

## 2. Plugins come in pairs

Most domains ship an **admin** plugin and a **server** plugin:

```
packages/<group>/admin    → AdminPlugin  (React routes, slots, layout)
packages/<group>/server   → ServerPlugin (NestJS module, schema, migrations)
```

Some are single-runtime (`design-system`, `query-builder/admin`, `database`,
`nx`), and a group is **not** limited to two: it holds however many packages the
domain needs, named for what they are. Alongside `admin` and `server` you will
find a framework-free `domain` kernel (`content`, `copilot`, `identity`, `mail`,
`media`, `protection`, `segments`, `transfer`, `webhooks`), a second protocol
(`content/graphql`), and `provider-*` adapters where the domain has a swappable
backend — `media` has six plus a shared contract test kit, `identity` four,
`copilot` three, `mail` three. The npm name is always hyphenated regardless of nesting:
`packages/bootstrap/admin` → `@apograph/bootstrap-admin`.

### Server plugin contract

```ts
interface ServerPlugin {
    name: string;
    module: Type | DynamicModule; // the NestJS module
    onPluginInit?(): void | Promise<void>; // setup hook, run in registration order
    migrations?: { dir: () => string; table: string }; // owned Drizzle migrations
    docs?: PluginApiDocs; // OpenAPI security schemes this plugin's guards accept
}
```

`migrations.dir` is a thunk on purpose: the path resolves at migrate time only,
so it works whether the plugin is consumed from source or installed from npm.
`docs` is how a plugin contributes to the generated OpenAPI document — the host
merges every plugin's contribution before generating it.

Authoring rules live in the **`server-plugin`** skill: the `ServerPlugin`
factory + dynamic-module pattern, feature-then-kind folder layout
(`feature/{controllers,services,dto,errors,types}`), `@InjectDatabase()` DI,
config injection, and the schema/migrations descriptor.

### Admin plugin contract

```ts
type AdminPlugin = {
    name: string;
    routes?: RouteItem[]; // React Router routes (lazy / code-split)
    layout?: ReactNode; // optional authenticated shell
    slots?: SlotContribution[]; // contributions to named extension points
};
```

Authoring rules live in the **`admin-plugin`** skill: the per-module
`<name>/index.ts(x)` layout, lazy routes, the per-hook data layer
(`apiClient` + TanStack Query, each hook owning its request fn),
`useHasPermission` gating, and co-located `react-intl` messages.

## 3. Packages resolve from source

Workspace packages are consumed **without a build step**. Their `exports` point
at `./src/index.ts`, and `tsconfig.base.json` sets
`customConditions: ["@apograph/source"]`. The admin app's Vite transpiles
design-system (and every other package's) source directly. Run `npx nx sync`
after changing cross-project dependencies to update TS project references.

## 4. The data layer

- **One connection.** `packages/database` (`@apograph/database`) owns a single
  Drizzle/`pg` pool, opened in its `onPluginInit` (which must run first). It is
  exposed via DI (`@InjectDatabase()`, a global `DatabaseModule`) and via plain
  `getDatabase()` / `getPool()`. It owns exactly **one** table —
  `outbox_events`, the transactional outbox — and ships its own migrations for
  it. That is the sanctioned exception to "the shared database plugin owns no
  schema", and the only one: no other table may be added here.
- **Each plugin owns its schema + migrations.** e.g. `identity/server` owns the
  auth/RBAC tables in `src/lib/schema` and ships committed SQL in `migrations/`
  with its own `drizzle.config.ts`. Generate per-plugin
  (`nx run <plugin>:db:generate --name=<name>`); the host applies all pending
  migrations (`nx run server:db:migrate`).
- **Except the content model, which the _host_ owns.** Content types are
  code-defined per app, so their generated tables are too: `apps/server`
  re-exports them from `src/content.ts`, runs `db:generate` against its own
  `drizzle.config.ts`, and commits the SQL. `content/server` ships migrations
  only for its fixed platform tables (`saved_views`, `saved_view_defaults`) —
  and does so through a **second** `ServerPlugin` entry, `ContentViewsPlugin`,
  because `migrations` is one `{ dir, table }` descriptor and content's is
  already spent on the host's tables.
- **Migration tooling** is provided by the `@apograph/nx` workspace plugin,
  which infers the `db:generate` / `db:migrate` targets.

## 5. Request flow (admin → API → DB)

1. A user action fires a TanStack Query mutation via the shared `apiClient`
   (axios, `/api` base URL).
2. The NestJS server receives it. A global **`AuthGuard`** validates the
   session (DB-backed, revocable, httpOnly cookie).
3. **`PermissionsGuard`** + `@RequirePermissions('users:read')` enforce RBAC
   (roles → permissions), and workspace-scoped routes add
   **`WorkspaceGuard`** (membership) and, for content, **`ContentGrantGuard`**
   (the workspace's content-type grants). Only `AuthGuard` is global
   (`APP_GUARD`); the rest are declared per controller or route — including
   **`OriginGuard`** (CSRF defense), which every write route names explicitly
   rather than inheriting.
4. The use case runs the mutation inside a `UnitOfWork` transaction and appends
   its **domain events** to the transactional outbox (`OutboxWriter.append`)
   **using that same transaction** — so an event commits if and only if the
   mutation does, and never without it. Auditing is downstream of that: once the
   transaction commits, `OutboxDispatcher` delivers each event to its
   subscribers, and `activity`'s `AuditEventSubscriber` turns the audited kinds
   into `activity_events` rows. The drain is triggered post-commit (and
   `await`ed, so the row is normally there before the response returns) with a
   5-second poll as the backstop; delivery is at-least-once and the audit insert
   is keyed on the event id `ON CONFLICT DO NOTHING`, so a redelivery never
   double-records. `ActivityService.record(...)` still exists but is
   **deprecated** — nothing writes through it.
5. The response returns; React Query updates client state.

## 6. Extension points (admin slots + server DI ports)

Two parallel mechanisms let a plugin extend another with **no direct coupling**:

**Admin — named slots.** Plugins contribute UI into slots defined by other
plugins, as pure data. Example: `shell` defines `SIDEBAR_NAV_SLOT`; the
workspaces, users, and activity plugins each register nav entries into it (and
the workspace shell defines `WORKSPACE_NAV_SLOT` / `WORKSPACE_SECTION_SLOT` /
`WORKSPACE_ROUTE_SLOT` for its interior). Slots are wired once at boot
(`slot._register(items)`) and read sorted by consumers (`slot.getItems()`). The shell's sidebar also has a
route-scoped **dynamic region** (`useSidebarContent`) the workspace shell takes
over — a runtime override alongside the boot-time slots. The Content Library
defines **15** of its own — five around the records list (toolbar, menu,
columns, filter fields, bulk actions), eight around the entry editor (header,
menu, tabs, sidebar widgets, params, field controls, pre-save steps, the publish
guard), one on the revision view and one route-level overlay — and it fills none of them itself:
`activity`, `alarms`, `copilot`, `i18n`, `media`, `segments`, `transfer` and
`wysiwyg` do. Because slots are **boot-frozen**, an item may even expose a hook
the render site calls in a loop.

**Server — DI ports (inversion).** The _depended-upon_ plugin declares a
`Symbol` token + interface and injects it `@Optional()`; the _implementing_
plugin binds it in its module. identity declares `CONTENT_CATALOG` /
`ACTIVITY_RECORDER` (bound by content / activity — though `ACTIVITY_RECORDER` is
now deprecated, kept only for a stable surface: auditing moved to the outbox
subscriber described in §5); content declares
`CONTENT_ENTRY_EXTENSION` (bound by `i18n/server` to add row-per-locale scoping,
create stamping, shared-field sync, and locale filters to the entries pipeline
without content knowing what a locale is). Keeps the package graph acyclic.

A DI token binds **once**: Nest has no multi-provider, so a second module
binding the same token silently replaces the first. Where a port must accept any
number of independent contributions the seam is a **registry** instead — content
declares `CONTENT_READ_SCOPE` that way (registered by `segments/server`, and
every fragment is AND-ed onto the public read's predicate, so a scope can only
subtract rows), as does the copilot's tool registrar.

## 7. Security posture (today)

- Sessions: DB-backed, revocable, an **opaque** random token in an httpOnly
  cookie. The cookie is **unsigned** and the token carries no claims — validity
  is the per-request lookup, which is what makes revocation immediate. Only the
  token's SHA-256 is stored (it _is_ the session row's id), so the raw token
  lives in the client's cookie and nowhere else.
- Passwords: bcrypt. Invite/reset tokens: SHA-256 hashed at rest.
- Login is rate-limited (`@nestjs/throttler`).
- RBAC is a single global role per user (`admin` / `contributor` / `viewer`);
  memberships are M:N workspace links (no per-workspace role yet).

## 8. What does **not** exist yet

Worth knowing before you plan. This list is short now — the content model, the
media library, the copilot, the outbox's queue-and-worker fan-out and SSE
streaming all shipped, and this section used to deny every one of them.

- **No search index.** The records list's free-text `q` is a Postgres `ILIKE`
  OR-ed across the type's text-like columns — no `tsvector`, no ranking, no
  cross-type search.
- **No embeddings and no vector store.** The copilot reads content through the
  tool registry, not through retrieval.
- **No websockets.** The only server push is the copilot's SSE run stream;
  everything else is request/response, and the admin polls where it needs to.
- **No scheduled publishing.** `draft ⇄ published` are the two transitions, and
  an editor makes them by hand.
- **No per-workspace role, and no role-management API.** A user holds one global
  role, workspace membership carries none of its own, and the three seeded
  system roles (`admin` / `contributor` / `viewer`) are the only roles a
  deployment has — the `roles` table would take more, but nothing writes them.
