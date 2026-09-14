# Apograph — Nx monorepo

> **This is the canonical context file for AI agents.** It is tool-agnostic and
> read natively by Cursor, OpenAI Codex, Gemini CLI, and others. Claude Code
> reads it via the sibling `CLAUDE.md` (`@AGENTS.md` import). Every directory
> with project-specific context follows the same pair: `AGENTS.md` holds the
> content, `CLAUDE.md` imports it. Edit `AGENTS.md`, never the importer.

**Shared-context map** — start here, then dive in:

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — how the system is built (plugin hosts, resolve-from-source, request flow, migrations)
- [`CONTEXT-MAP.md`](CONTEXT-MAP.md) — glossary + the full project map (every app & package, one line each)
- [`DESIGN.md`](DESIGN.md) — product & design intent (owned by Design; partly `TODO:`)
- [`docs/adr/`](docs/adr/README.md) — Architecture Decision Records (why things are the way they are)
- [`docs/design/`](docs/design/) — engineering design docs for work that is proposed but not yet built (currently: [`copilot.md`](docs/design/copilot.md), [`graphql-api.md`](docs/design/graphql-api.md), [`mail.md`](docs/design/mail.md), [`sso.md`](docs/design/sso.md)) — plus [`alarms.md`](docs/design/alarms.md), [`protection.md`](docs/design/protection.md) and [`webhooks.md`](docs/design/webhooks.md), which document shipped behaviour rather than proposals
- [`docs/agent-pipeline.md`](docs/agent-pipeline.md) — how a ticket becomes a merged PR when agents do the typing: the four tiers, the label vocabulary, the role subagents, and the steps
- [`docs/definition-of-ready.md`](docs/definition-of-ready.md) — what a ticket must contain before the pipeline will act on it
- [`README.md`](README.md) — human-facing project overview & getting started
- `.cursor/BUGBOT.md` — recurring bug-patterns reviewers and agents must watch for

## Project overview

- `apps/admin` — React 19 + Vite SPA (admin UI)
- `apps/server` — NestJS API
- `packages/design-system` — `@apograph/design-system`, shadcn/ui library
- `packages/bootstrap/{admin,server}` — the application **hosts** that turn a
  list of plugins into a running app
    - `@apograph/bootstrap-admin` — `createAdmin({ plugins })`: mounts the React
      root, router, and plugin-contributed routes
    - `@apograph/bootstrap-server` — `createServer({ plugins })`: runs each
      plugin's `onPluginInit`, imports its module, applies global prefix +
      `ValidationPipe`
- `packages/database` — `@apograph/database`, the database **plugin**:
  owns one Drizzle/`pg` connection, opens it in `onPluginInit`, and exposes
  it via DI (`@InjectDatabase()`, global `DatabaseModule`) and plain
  `getDatabase()`/`getPool()`. Also provides the shared tactical-DDD
  infrastructure ([ADR-0003](docs/adr/0003-tactical-ddd-inside-plugins.md)):
  `UnitOfWork`, the transactional outbox (`OutboxWriter` / `OutboxDispatcher`),
  and the `DomainEvent` contract. It owns exactly **one** table — `outbox_events`
  — the sanctioned exception to "no schema", shipped with its own migrations.
- `packages/identity/server` — `@apograph/identity-server`, the identity
  **plugin**: owns the auth/RBAC schema (Drizzle tables in `src/lib/schema`)
  and **ships its own migrations** (`drizzle.config.ts` + committed
  `migrations/`). Opens no connection; the host applies its migrations.
- `packages/copilot/*` — the AI copilot. `domain` holds the framework-free
  `ModelProvider` port, the offer-time capability profile and the proposal
  contracts; `server` is the plugin (`CopilotPlugin`) with the SSE run route,
  the bounded run engine, and the write path — a `propose` tool's change is
  recorded as a `copilot_proposals` row and applied immediately, gated only by
  the caller's own permissions ([ADR-0009](docs/adr/0009-copilot-applies-directly.md));
  `admin` is the two chat surfaces — the docked panel over any page, and the
  full-page **Agents view** at `/workspaces/:id/agents` (thread rail + one
  conversation, with a CMS ⇄ Agents switch in the workspace sidebar) — sharing
  one transcript, composer and change card;
  `provider-anthropic` / `provider-openai` are the two shipped adapters,
  constructed at the composition root; `provider-fake` is a **private test
  fixture** — scripted and deterministic, published nowhere, registered by
  `server-e2e` and never by a host, so a deployment that configured no backend
  has no copilot rather than one answering from a canned script. Only
  `provider-anthropic` may import a vendor SDK
  ([ADR-0004](docs/adr/0004-model-agnostic-copilot-provider.md)). Its tools live
  in the shared registry, marked `surfaces: ['copilot']`
  ([ADR-0007](docs/adr/0007-one-tool-registry-two-surfaces.md)).
- `packages/tools/server` — `@apograph/tools-server`, the shared agent **tool
  registry**: the transport-neutral `ToolDefinition` contract and the one place
  a tool call is authorized. Two consumers import its global `ToolsModule` — the
  MCP endpoint and the copilot's run loop — so both see one instance, and a tool
  declares which `surfaces` it is offered to
  ([ADR-0007](docs/adr/0007-one-tool-registry-two-surfaces.md)). **Omitting the
  field means both**, so adding a tool anywhere means deciding who it is for —
  the checklist is in
  [`packages/tools/server/AGENTS.md`](packages/tools/server/AGENTS.md#adding-a-tool-decide-surfaces-deliberately).
- `packages/content/graphql` — `@apograph/content-graphql`, the public content
  API over **GraphQL** (`POST /api/v1/graphql`). A protocol **adapter** over
  `content/server`'s `public-api/`, not a second API: same bearer tokens, same
  guards, same scopes, same visibility rules, and resolvers that assemble the
  existing DTOs rather than reaching for the database
  ([ADR-0008](docs/adr/0008-graphql-as-a-protocol-adapter.md)). Its schema is
  built **per workspace content-grant set**, so introspection cannot enumerate
  types the workspace was not granted.
- `packages/transfer/*` — content **export and import**. `domain` is the
  framework-free kernel: the transfer document both ends agree on, the four
  formats behind one `ExportSerializer` / `ImportParser` port, and the
  natural-key rules; `server` is the plugin — the export/import routes, the
  graph walk, and a hand-rolled ZIP container; `admin` is the two dialogs and
  the three slot contributions that reach them. The depth is **one hop**
  ([ADR-0014](docs/adr/0014-transfer-as-a-separate-plugin.md)): relations, files
  and locales travel, relations-of-relations stay as references. Every write
  goes through content's `EntryWriterService`, so an import cannot outrun
  validation, the workspace scope, or the caller's own permissions. Owns no
  tables.
- `packages/segments/*` — reader **entitlements**: who may _read_ published
  content. `domain` is the kernel — a segment is a named set of reader tags, an
  entry names the segments it admits and the segments it refuses, and `canRead`
  is the whole decision (a deny wins; an empty allow list means everyone).
  `server` owns the two tables and compiles that decision into one SQL predicate
  through content's `CONTENT_READ_SCOPE` port, so it covers REST, GraphQL and
  MCP at once; `admin` is the audience directory plus the entry editor's Access
  tab, where each audience gets one three-state control. Deliberately separate
  from RBAC and from `workspace_content`, which answer who may _touch_ content.
  There is no rule object and no inheritance: what an editor sets on the entry
  is what a reader gets. Inert until an audience exists.
- `packages/alarms/*` — content **alarms**: workspace-defined rules that flag
  content problems without ever blocking a write
  ([ADR-0015](docs/adr/0015-alarms-are-non-blocking.md)). `server` owns the two
  tables (`alarm_rules`, `alarm_findings`), the outbox subscriber, the evaluator
  and the periodic sweep; `admin` is the alarms page, the rule editor, and three
  contributions into the Content Library's slots — the entry rail's checks
  block, an optional records column, and **"Save as rule"** in the records
  toolbar, which is how rules are actually made. A rule is not a new query
  language: it stores the **records-list filter tree verbatim** and is evaluated
  through content's own `EntryMatchQuery`, so it can only ever mean what the
  list means by the same filter. Severity orders and colours; it never gates.
- `packages/protection/*` — publication **protection**: a per-content-type rule
  requiring N approvals before an entry may be published
  ([ADR-0017](docs/adr/0017-publication-protection.md)). `domain` is the
  framework-free kernel — the third gate on publish, one pure function over a
  rule, the head revision and the votes recorded against it. It answers _may
  this person ship it now_, never whether the entry is complete. `server` owns
  three tables — the rule, the review request and the vote — plus the publish
  guard, the two permissions (`content:approve` approves, `protection:manage`
  writes rules and bypasses) and the agent tools; `admin` is the entry editor's
  review chip, the rail's **Review** block and the publish verdict with its
  bypass dialog, the workspace **Reviews** page, the settings tab where a rule
  is written, a records column and its filter, and an Insights card. An approval
  belongs to a **revision**, so the next save stops it counting — there is no
  dismissal logic anywhere. Addressed `(workspace, kind, slug)`, the same
  coordinate as `workspace_content`. It takes **no configuration**: the rule
  table is the whole configuration surface and its empty state is the off state,
  so registering it changes nothing until a workspace writes a rule.
- `packages/webhooks/*` — outgoing **webhooks** on content changes. `domain` is
  the framework-free kernel — the subscribable event catalogue, the subscription
  filter (workspaces × event kinds × content types, where an **empty set means
  everything, including what does not exist yet**), the HMAC-signed envelope,
  the retry policy, and the URL policy that decides where this server may be
  talked into connecting; `server` is the plugin — three tables, an outbox
  subscriber and a delivery worker; `admin` is the global `/webhooks` pages in
  the directory group. The structural rule is that the **subscriber never
  touches the network** ([ADR-0016](docs/adr/0016-webhooks-deliver-from-a-queue.md)):
  `OutboxDispatcher` calls subscribers inside its claim transaction, so fan-out
  only queues delivery rows and a worker claims them, commits, and then POSTs
  with nothing open. Delivery is at-least-once and unordered; receivers
  deduplicate on `X-Apograph-Event-Id`. Administrator-only, because an endpoint
  spans every workspace it names and holds a signing secret.
- `packages/mcp/server` — `@apograph/mcp-server`, the **MCP plugin**: the
  Model Context Protocol endpoint (`POST /api/v1/mcp`) that lets an external
  agent do content CRUD with an API token
  ([ADR-0006](docs/adr/0006-cms-as-an-mcp-server.md)). Owns the protocol and
  nothing else — the registry lives in `tools/server` and the tools in
  `content/server`, which is what lets a handler call `PublicEntriesQuery`
  directly instead of re-implementing the rules it enforces. Off unless
  `MCP_ENABLED=true`.
- `packages/nx` — `@apograph/nx`, the workspace **Nx plugin**: infers and
  implements the `db:generate` / `db:migrate` targets (Drizzle migration
  tooling) plus the release targets. Registered in `nx.json`. The database
  executors are adapters over `@apograph/cli`, so this repo and a generated app
  migrate through one implementation.
- `packages/cli` — `@apograph/cli`, the **`apograph` command**: how an app
  installed from npm is built, run and migrated (`dev` / `build` / `start` /
  `migrate` / `generate` / `studio`). Compiles first and reads the compiled
  config, so it needs none of the jiti/swc machinery the Nx executors use to
  read TypeScript from source.
- `packages/create-apograph-app` — the **scaffolder** behind
  `npx create-apograph-app my-cms`. One template, no sample content types, plus a
  keyboard wizard for the three genuine choices (storage adapter, hosted copilot
  backends, and which protocols the content API speaks — REST always, GraphQL
  and MCP optional); everything else, the copilot included, is installed
  unconditionally. Stamps
  its own version into every `@apograph/*` dependency it writes, which is what
  makes a generated app a consistent lockstep set — so a release needs no
  template edit, while **adding a package does**: every published package must
  be classified in its `features.ts`, and a test fails until it is. The only
  published package outside the `@apograph` scope.

## Package layout

Packages are either **flat** (`packages/<name>`, e.g. `design-system`) or
**grouped** by domain with an `admin`/`server` split
(`packages/<group>/{admin,server}`, e.g. `bootstrap`). The npm package name
stays hyphenated regardless of nesting: `packages/bootstrap/admin` is published
as `@apograph/bootstrap-admin`. The root `workspaces` globs (`packages/*` and
`packages/*/*`) cover both shapes.

A group is not limited to `admin`/`server`: it holds however many packages the
domain needs, named for what they are. `content` has four — `domain` (the
framework-free kernel), `server`, `admin`, and `graphql` (the public API's
second protocol); `copilot` has six.

## How packages resolve

Workspace packages are consumed **from source** — their `exports` point at
`./src/index.ts` and `tsconfig.base.json` sets
`customConditions: ["@apograph/source"]`. No build step is needed to consume a
package; the admin app's Vite transpiles the design-system source directly.

## Commands

- `npx nx <typecheck|build|lint|test|serve> <project>`
- **`npm run dev`** — the whole stack in **one terminal**. Runs four continuous
  tasks, each in its own Nx Terminal UI pane (arrow keys to switch, and two can
  be pinned side by side):
    - `server:dev:build` — webpack in watch mode; compile + type errors land here
      instead of scrolling past the API logs
    - `server:dev:run` — `node --watch` on `apps/server/dist/main.js`; Nest logs only
    - `admin:dev` — the Vite dev server (proxies `/api` → `:3000`)
    - `admin:dev:typecheck` — `tsc --build --watch`, because **Vite never
      typechecks**; this is the pane that catches admin type errors

    Needs Postgres (`docker compose up -d`) and a `.env`, same as `nx serve server`.
    `npm run start:server` / `start:admin` still run either half on its own.

    There are **three** server targets, not two, and the ordering matters:
    `dev:prebuild` does a one-shot dev build so `dist/main.js` exists before
    `dev:run` starts — `node --watch` **cannot recover from a missing entry
    point**, it stays alive with nothing to watch and never boots. Both watch
    tasks depend on it so they never race on `dist/`. The watcher sets
    `NX_WATCH_BUILD=true`, which turns off webpack's `output.clean` so its first
    compile can't delete the file `dev:run` is holding open.

    Don't reach for `readyWhen` to sequence a `continuous` task — on match Nx
    fires that task's _exit_ callbacks, so it is reported as "continuous but
    exited with code 0" and the whole run fails.

- **Parallel stacks** — `npm run dev` is not limited to one checkout. A **slot**
  fixes a worktree's ports and database (slot _n_: API `:300n`, admin `:420n`,
  database `apograph_cms_an`), so several tickets can each hold a live app to
  verify against. `npm run worktree -- provision <slot> --path <worktree>`
  creates the database and writes the port-adjusted `.env`; `-- list` shows who
  holds what; `-- release <slot> --yes` drops the database. Slots share **one**
  Postgres container — `CREATE DATABASE` already isolates the data, and five
  containers do not fit in memory. Two concurrent stacks is the realistic
  ceiling on a 4-core / 8 GB machine. See
  [`docs/parallel-stacks.md`](docs/parallel-stacks.md)
- **API reference** — a running server serves the generated OpenAPI document as
  a Scalar reference on `http://localhost:3000/reference` (raw JSON at
  `/reference/json`). On outside production; `API_DOCS=true|false` overrides.
  See [`packages/bootstrap/server/AGENTS.md`](packages/bootstrap/server/AGENTS.md)
- `npx nx sync` — run after changing cross-project dependencies (updates TS project references)
- **Releasing to npm** — every `packages/` package publishes together, in
  lockstep. `npm run release` from a clean checkout of `main` versions, tags,
  publishes and opens the GitHub Release, reading `NPM_TOKEN` / `GITHUB_TOKEN`
  from `.env`; `npm run release:dry-run` rehearses it. The **Release** Actions
  workflow does the same unattended. A package's tarball is not its checked-in
  manifest: `build` compiles it and `pack` stages a rewritten manifest under
  `dist/pack/`, because the workspace resolves from source and a consumer
  cannot. The publishes are **throttled and retried** — npm rate-limits an
  account's writes and 37 tarballs go out in one run, so they are serialised
  with a gap and a 429 is backed off rather than failing the release. See
  [`docs/releasing.md`](docs/releasing.md)
- **Database / migrations** (provided by `@apograph/nx`; needs a `.env` with
  `DATABASE_URL`, and Postgres via `docker compose up -d`):
    - `npx nx run <plugin>:db:generate --name=<name>` — generate that plugin's
      Drizzle migration from its schema (per-plugin; commit the emitted SQL).
      Inferred on any project with a `drizzle.config.ts`. Needs no database.
    - `npx nx run server:db:migrate` — apply every plugin's pending migrations.
      Inferred on the host (the project with `apograph.config.ts`).
    - `npx nx run server:db:studio` — open Drizzle Studio on the host database
      (introspects the live DB; needs `DATABASE_URL`). Also inferred on the
      host. Optional `--host` / `--port` to change where Studio binds.
- Package manager: **npm workspaces** (not pnpm/yarn)

## Conventions

- Prettier: 4-space indent, single quotes
- shadcn / design-system work is governed by the shadcn skill and
  [`packages/design-system/AGENTS.md`](packages/design-system/AGENTS.md)
- Authoring or extending a NestJS **server plugin** (`packages/<group>/server`)
  is governed by the `server-plugin` skill — the `ServerPlugin` factory +
  dynamic-module pattern, `@InjectDatabase()` DI, config injection, and the
  Drizzle schema/migrations descriptor
- **Invariants** — every package dossier in [`docs/artifacts/`](docs/artifacts/)
  ends with a numbered list of invariants: at once a review checklist and a
  draft set of test assertions. Many specs name the one they pin in their title
  (`[segments:I-01]`); keep the habit when a test exists for a documented rule.
- **Countable claims in the root documents are pinned by a test.** Slot counts,
  contract fields, provider adapters, the tables a plugin owns and the project
  map itself are derived from the code by
  [`tools/docs-guard`](tools/docs-guard/AGENTS.md) and compared against
  `ARCHITECTURE.md` / `CONTEXT-MAP.md`. Add a package, a slot or a table and
  `npx nx test docs-guard` tells you which sentence now lies. Reword those
  sentences freely — a claim that stops matching its pattern fails too, so
  re-point the pattern in the same commit.
- **Tactical DDD inside plugins** ([ADR-0003](docs/adr/0003-tactical-ddd-inside-plugins.md)):
  we are migrating each plugin from feature-then-kind to a layered
  `domain / application / infrastructure / http(presentation)` layout
  (aggregates, value objects, repository ports, use-cases, an outbox for domain
  events). The rollout is **incremental** — each package's own `AGENTS.md`
  declares which layout it is in, and the `server-plugin` / `admin-plugin` skills
  document both modes. The core rule: `domain/` imports no framework
  (Nest/Drizzle/React). Reference: `packages/workspaces/{server,admin}`.
- Admin i18n: `react-intl` with the host's single `IntlProvider`; each
  component **co-locates** its own `const messages = defineMessages({ … })`
  (no shared `messages.ts`). See
  [`packages/bootstrap/admin/AGENTS.md`](packages/bootstrap/admin/AGENTS.md)
