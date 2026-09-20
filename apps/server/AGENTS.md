# apps/server

The **API** — a NestJS application. Like the admin app, this is a thin entry
point: it holds almost no logic. It assembles the product by handing a list of
**server plugins** to the `@orthacms/bootstrap-server` host.

## What's here

- `src/plugins.ts` — the **plugin registry**. Adding a feature to the API means
  registering its `ServerPlugin` here. This is the file you edit most.
  **What the order decides is migrations, not DI**: `applyPluginMigrations` walks
  the array with no transaction spanning plugins, so a plugin whose tables
  reference another's must come after it (`workspaces` after `identity`). DI is
  order-independent — every module is global and every `onPluginInit` runs before
  `NestFactory.create` — so `DatabasePlugin` is listed first as a convention, for
  the day a second plugin opens a resource in that hook, not because anything
  breaks today. `src/plugins.spec.ts` asserts the membership and the migration
  order, because a plugin dropped from the array degrades **silently**: the ports
  other plugins bind are `@Optional()`, so removing e.g. `ActivityPlugin` boots
  clean and just stops writing audit rows.
- `ortha.config.ts` — host config: the flat object naming what this deployment
  runs. It **assembles** rather than derives — one builder per plugin, each in
  its own module under `config/`. It stays the entry point because
  `@orthacms/cli` looks for exactly `dist/server/ortha.config.js`, `@orthacms/nx`
  infers the migration targets onto the project that has an `ortha.config.ts`,
  and `src/plugins.ts` and `apps/server-e2e` import its types.
- `config/` — the single place that reads the environment, and it does so
  **only** through the readers (`readEnv`, `requireEnv`, `readPositiveInt`,
  `readList`, `readFlag`, `readTrustProxy`, `readNodeEnv`) in
  `@orthacms/utils-server`, shared with the scaffolder's template so a
  generated app validates its environment the same way. These modules name the
  variables and the defaults; the readers decide what a value has to look like.
  **No module here writes `process.env[…]`** — a test asserts it. `readEnv` is
  where "empty means absent" is decided, and `.env.example` ships forty-two keys
  with nothing on the right-hand side, so a raw `process.env['X'] ?? default`
  hands the blank line the win: `SSO_OIDC_NAME=` produced a provider named `''`
  and a callback path of `/api/auth/sso//callback`, at boot, in silence.
  Nothing conditional is spread into a config object — `when(…)` yields a block
  or `undefined`, `defined(…)` drops the keys that were never set, because
  plugins merge as `{ ...DEFAULTS, ...config }` and an explicit `undefined`
  erases a default instead of leaving it. Both are shared too.
  Values are **validated at import**: a missing `DATABASE_URL`, a numeric
  setting that is not a plain positive integer, or a `NODE_ENV` that is not one
  of `development` / `test` / `production` refuses to load rather than booting a
  deployment that looks configured (`src/ortha.config.spec.ts`, which exercises
  the real module by re-importing it under a set environment). This project is
  also the migration host: the inferred `db:migrate` target applies every
  plugin's pending migrations.
- `src/content/` — the host's **code-defined content types** (see below).

## Content types (`src/content/`)

The host defines its content model here — the collections and pages the
`ContentPlugin` serves, and whose generated tables the host owns.

- `src/content/index.ts` — the **one aggregation point**. It exports the
  `contentTypes` array (which `plugins.ts` registers with `ContentPlugin`) and
  **re-exports every generated table** for drizzle-kit to diff.
- `src/content/collections/` — one file per collection (a `collection(...)`).
- `src/content/pages/` — one file per single page (a `single(...)`).

**Adding a type:** create a file under `content/collections/` or
`content/pages/`, then in `content/index.ts` add it to `contentTypes` **and**
re-export its table(s). drizzle-kit only diffs **top-level table exports**, so a
table not re-exported from `index.ts` is silently absent from migrations
(many-relation join tables via `joinTableOf` included). Then
`npx nx run server:db:generate --name=<change>` and commit the SQL —
`drizzle.config.ts` points `schema` at `src/content/index.ts`.

`src/content/index.spec.ts` guards exactly that: it derives the complete set of
generated tables from `contentTypes` (each type is `{ table, joinTables }`) and
fails if any of them is not a top-level export here — so the forgotten join table
is a red test instead of a `relation … does not exist` on a production write. The
generic version of this problem, for any plugin's schema barrel, is ORT-130.

## How it fits

- The host (`createServer({ plugins })`) runs each plugin's `onPluginInit`,
  imports its NestJS module, and applies the global `/api` prefix + a
  `ValidationPipe`. It also generates the OpenAPI document from the assembled
  controllers + DTOs and serves it as a Scalar reference on `/reference`
  (JSON on `/reference/json`), configured by `ortha.config.ts`'s `docs`.
- Cross-cutting guards are global: `AuthGuard` (session), `PermissionsGuard`
  (RBAC), `OriginGuard` (CSRF on state-changing POSTs).
- Each plugin owns its Drizzle schema + migrations; the shared
  `@orthacms/database` plugin owns the single connection.

## Working here

- Authoring or changing a server plugin is governed by the **`server-plugin`**
  skill (`ServerPlugin` factory + dynamic module, feature-then-kind layout,
  `@InjectDatabase()` DI, schema/migrations descriptor, and the authorization /
  data-integrity invariants).
- Migrations: `npx nx run <plugin>:db:generate --name=<name>` to generate,
  `npx nx run server:db:migrate` to apply. Commit emitted SQL.
- E2E coverage lives in `apps/server-e2e` (testcontainer + supertest) — see the
  **`server-e2e`** skill.
- Common back-end traps: `.cursor/BUGBOT.md` (Server section).

See [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) for the full picture.
