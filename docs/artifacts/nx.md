# Nx

_Package · packages/nx_

**A build-tool plugin: migrations and releases without a single line of manual configuration**

`@ortha/nx` is the one package in the monorepo that serves not an application but the **build pipeline**. It **infers** targets onto projects from the presence of a file: drop in a `drizzle.config.ts` and you get `db:generate`; put a package under `packages/` and you get `build`, `pack` and publishing to npm. There is no per-project configuration, and there should not be.

- **4** executors
- **6** inferred targets
- **12** projects with `db:generate`
- **1** host project
- **60** publishable packages
- **127** unit tests
- **3** publish-tuning variables
- **0** database tables owned

## Contents

- [01. Business description](#01-business-description)
- [02. Composition and place in the system](#02-composition-and-place-in-the-system)
- [03. Target catalogue](#03-target-catalogue)
- [04. How target inference works](#04-how-target-inference-works)
- [05. Reading TypeScript from source](#05-reading-typescript-from-source)
- [06. Step-by-step flows](#06-step-by-step-flows)
- [07. The release process in detail](#07-the-release-process-in-detail)
- [08. Configuration and environment](#08-configuration-and-environment)
- [09. Invariants](#09-invariants)
- [10. Testing checklist](#10-testing-checklist)
- [11. Boundaries of responsibility](#11-boundaries-of-responsibility)
- [12. Discrepancies between code and documentation](#12-discrepancies-between-code-and-documentation)

## 01. Business description

No user of the CMS ever sees this package. Its audience is the developer adding a plugin and the release engineer shipping a version. It has exactly one value, and a measurable one: **to cut the number of manual decisions in the two most dangerous operations in the project** — changing the database schema, and publishing to a registry from which nothing can be recalled.

### The problem it solves

- **Zero per-project configuration.** The monorepo has 12 projects with their own database schema and 60 publishable packages. If each described its own targets, those descriptions would drift apart — one mistyped path per ten packages. Instead targets are **inferred from the presence of a file**: a new plugin gets migration generation, a build and publishing simply because it exists.
- **One migration implementation for the monorepo and for a generated app.** The database executors are thin adapters over `@ortha/cli`. Applying migrations is the most destructive operation in the system; having two implementations of it that drift apart over time costs more than tolerating one layer of indirection.
- **A release that does not fall apart halfway through.** npm rate-limits a single account's writes, and a lockstep release asks it to accept several dozen tarballs back to back. Nx's stock executor does not survive that: the version is already committed, tagged and pushed while the registry holds half the set. Here publishing is serialised behind a file lock, spaced out by a delay, and retried with exponential backoff.
- **Refusal instead of quiet trouble.** Three places where the tool had better stop: a migration without `DATABASE_URL`, Studio on port 0, publishing a name npm refused to create. In each case what used to happen was a "green" result with nothing useful behind it.

### Who sees it

#### Plugin developer

Edits a Drizzle schema and runs `nx run <plugin>:db:generate --name=…`. No database is needed for this: generation only diffs the schema against a snapshot.

#### Whoever brings up an environment

A single `nx run server:db:migrate` applies the migrations of _every_ plugin in the order the host set. Each plugin keeps its own journal table.

#### Release engineer

Runs `npm run release` from a clean `main`. Inside: the build, staging of a rewritten manifest, and publish throttling they never configure.

### What this package is not

- **It is not a CLI.** The implementations of `generate`, `migrate` and `studio` live in `@ortha/cli`. What lives here are only the wrappers that know how to get a path from Nx and read a TypeScript config from source.
- **It is not a project generator.** The package ships no Nx generator at all: its `package.json` declares only the `executors` key. Scaffolding an application is `create-ortha-app`.
- **It is not part of the product.** The package is marked `private: true` and excluded from the release by an explicit `!@ortha/nx` in `nx.json`. It lives only inside this repository.
- **It is not a schema owner.** It has not one table and not one migration of its own. It knows _how_ to apply someone else's migrations, but not _which_.

> **The key architectural idea**
>
> **Thin executors over a shared core, and half of that core lives outside the package.** `db:generate`, `db:migrate` and `db:studio` are adapters over `runDrizzleKitGenerate`, `applyPluginMigrations` and `runDrizzleKitStudio` from `@ortha/cli`. These functions used to live here, in `src/lib/drizzle/`, where an application installed from npm could not reach them at all — the package is private and unpublished, so a generated app had no way to migrate its own database. The release logic (`src/lib/release/`) stayed here: only this repository runs it.

## 02. Composition and place in the system

The package is flat — `packages/nx`, npm name `@ortha/nx`, version `0.0.1`, flagged `private: true`. It is registered in the root `nx.json` by the line `"@ortha/nx"` in the `plugins` list, next to `@nx/js/typescript`, `@nx/eslint/plugin`, `@nx/vite/plugin`, `@nx/vitest`, `@nx/playwright/plugin`, `@nx/webpack/plugin` and `@nx/jest/plugin`. Like the rest of the workspace packages it is consumed **from source**: `main` and `types` point at `./src/index.ts`, and Nx loads it as a TypeScript plugin with no build step.

### File structure

| File                              | What is in it                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| src/index.ts                      | `createNodesV2` — all of the target inference plus the `packageTargets` function. Also the long comment explaining why `db:generate` is not cached |
| executors.json                    | Registration of the four executors: `db-generate`, `db-migrate`, `db-studio`, `release-publish`                                                    |
| src/executors/\<name>/executor.ts | The executor implementation: option parsing, the refusal checks, the call into the core                                                            |
| src/executors/\<name>/schema.json | The JSON schema of the options — what Nx validates and shows in hints                                                                              |
| src/lib/jiti.ts                   | `createTsJiti()` — a TypeScript loader via jiti + swc in legacy-decorator mode                                                                     |
| src/lib/release/publish.ts        | A single `npm publish`, classification of the registry's response, and the retry ladder                                                            |
| src/lib/release/throttle.ts       | A file lock with a heartbeat, the interval between publishes, and the "safety catch" on creating new names                                         |
| src/lib/release/registry.ts       | Probing the registry with a single `GET`, and pulling the token out of the environment                                                             |
| jest.config.js · .spec.swcrc      | Jest + swc, as in the server plugins. `npx nx test nx`                                                                                             |

### Dependencies, and who looks at it

#### What it imports

- `@nx/devkit` — the `CreateNodesV2`, `TargetConfiguration` and `ExecutorContext` types
- `@ortha/cli` — three database functions
- `@ortha/bootstrap-server` — the `ServerPlugin` type (type only)
- `jiti` + `@swc/core` — loading the host's TypeScript at runtime

#### What depends on it

- `nx.json` — plugin registration and `targetDefaults.nx-release-publish`
- `tools/release/release.mjs` — via `nx release`
- `tools/release/pack.mjs` — invoked by the `pack` target
- Every plugin with a `drizzle.config.ts` — silently, by the mere existence of the file

> **CommonJS**
>
> The package compiles to CJS: there is no `"type": "module"` in its `package.json`. That means `require`, `__dirname` and `__filename` inside, and never `import.meta`. This is not a matter of style: `createTsJiti(__filename)` in both database executors relies on exactly that CJS variable.

## 03. Target catalogue

The central section. The package infers **six** targets and implements **four** executors — the other two (`build` and `pack`) are inferred with the stock `nx:run-commands` executor. Not one of them is written out by hand on any project.

| Target             | Where it is inferred, and from what                                                                                                                                                                                            | What it does                                                                                                                                       | Cache |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| db:generate        | Any project with a `drizzle.config.ts` at its root. Today there are **12**: `apps/server`, `apps/server-e2e`, and the activity, alarms, content, copilot, database, identity, media, segments, webhooks and workspaces plugins | Runs `drizzle-kit generate` at the project root. Diffs the schema against the `migrations/meta/*_snapshot.json` snapshot and writes a new SQL file | `no`  |
| db:migrate         | A project with an `ortha.config.ts` at its root — that is, the host. Today that is **one** project, `apps/server`                                                                                                              | Loads the host config and its `buildPlugins()`, and applies each plugin's migrations in turn, each under its own journal table                     | `no`  |
| db:studio          | The same marker — an `ortha.config.ts` at the project root                                                                                                                                                                     | Brings up Drizzle Studio against the host's live database through an ephemeral config in a temporary directory                                     | `no`  |
| build              | A package under `packages/` whose manifest has a `name` and that has a `tsconfig.lib.json` beside it                                                                                                                           | `tsc --build tsconfig.lib.json --pretty`: JS and `.d.ts` into `dist/`, building project references along the way                                   | `yes` |
| pack               | The same, but **only for a non-private** manifest — that is, one without `private: true`                                                                                                                                       | `node tools/release/pack.mjs <projectRoot>` — stages the package's publishable root into `dist/pack/<projectRoot>/`                                | `no`  |
| nx-release-publish | The same marker as `pack`                                                                                                                                                                                                      | Publishes to npm what `pack` staged: `packageRoot` is redirected to `dist/pack/<projectRoot>` rather than the project root                         | `no`  |

### Options and environment requirements

| Target / executor                                  | Options                                                                                                                                                                                                                                     | What it needs in the environment                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| db:generate<br>@ortha/nx:db-generate            | `cwd` (required, filled in by inference = the project root) · `config` (required, `drizzle.config.ts` relative to `cwd`) · `name` (optional, the migration name)                                                                            | **Nothing.** No database, no secrets: generation only diffs the schema against the snapshot. It needs `drizzle-kit` installed                          |
| db:migrate<br>@ortha/nx:db-migrate              | `config` (required, path to `ortha.config.ts` from the workspace root) · `plugins` (required, path to the module exporting `buildPlugins(config)`; inference fills in `<projectRoot>/src/plugins.ts`)                                       | `DATABASE_URL` in `.env` — **required**, an empty string is rejected. A live Postgres (`docker compose up -d`)                                         |
| db:studio<br>@ortha/nx:db-studio                | `config` (required) · `host` (optional, defaults to `127.0.0.1`) · `port` (optional, defaults to `4983`; the value `0` is rejected)                                                                                                         | `DATABASE_URL` and a live database: Studio introspects it directly and does not need the schema                                                        |
| build<br>nx:run-commands                           | `command`, `cwd`. Plus `dependsOn: ['^build']`, `inputs: ['production', '^production']`, `outputs: ['{projectRoot}/dist']`                                                                                                                  | Nothing beyond TypeScript. Cacheable and deterministic                                                                                                 |
| pack<br>nx:run-commands                            | `command`. `dependsOn: ['build']`, `outputs: ['{workspaceRoot}/dist/pack/<projectRoot>']`                                                                                                                                                   | Nothing. But it is **deliberately not cached**: it reads `dist`, which is not among its declared inputs, and a cache hit would restore a stale tarball |
| nx-release-publish<br>@ortha/nx:release-publish | `packageRoot` · `delay` (5000) · `retries` (5) · `retryBackoff` (30000) · `maxRetryBackoff` (300000) · and the pass-through from `nx release publish`: `registry`, `tag`, `otp`, `access`, `dryRun`, `firstRelease`, `nxReleaseVersionData` | npm credentials (`NPM_TOKEN` or `npm login`). `dependsOn: ['pack']` lives in `targetDefaults`, not here                                                |

### Where the targets physically hang today

Not one line below is declared anywhere — it is simply a consequence of which files sit in which projects. The "schema" column shows how far the paths inside the configs diverge: which is exactly why a single input glob for the cache is impossible in principle.

| Project                               | Marker                                          | Targets                                  | `schema` in the drizzle config                     |
| ------------------------------------- | ----------------------------------------------- | ---------------------------------------- | -------------------------------------------------- |
| apps/server                           | `drizzle.config.ts` + `ortha.config.ts`         | `db:generate`, `db:migrate`, `db:studio` | ./src/content/index.ts                             |
| apps/server-e2e                       | `drizzle.config.ts`                             | `db:generate`                            | ./src/support/content/index.ts                     |
| packages/activity/server              | `drizzle.config.ts`                             | `db:generate`, `build`, `pack`, publish  | ./src/lib/schema/index.ts                          |
| packages/alarms/server                | `drizzle.config.ts`                             | the same                                 | ./src/lib/infrastructure/schema/index.ts           |
| packages/content/server               | `drizzle.config.ts`                             | the same                                 | ./src/lib/views/infrastructure/schema/index.ts     |
| packages/copilot/server               | `drizzle.config.ts`                             | the same                                 | ./src/lib/\*/infrastructure/schema/index.ts        |
| packages/database                     | `drizzle.config.ts`                             | the same                                 | ./src/lib/schema/index.ts                          |
| packages/identity/server              | `drizzle.config.ts`                             | the same                                 | ./src/lib/schema/index.ts                          |
| packages/media/server                 | `drizzle.config.ts`                             | the same                                 | ./src/lib/infrastructure/schema/index.ts           |
| packages/segments/server              | `drizzle.config.ts`                             | the same                                 | ./src/lib/schema/index.ts                          |
| packages/workspaces/server            | `drizzle.config.ts`                             | the same                                 | ./src/lib/workspace/infrastructure/schema/index.ts |
| packages/nx                           | `package.json` + `tsconfig.lib.json`, `private` | `build` only                             | —                                                  |
| packages/copilot/provider-fake        | `package.json` + `tsconfig.lib.json`, `private` | `build` only                             | —                                                  |
| the other 47 packages under packages/ | `package.json` + `tsconfig.lib.json`            | `build`, `pack`, publish                 | —                                                  |

> **Why db:generate is not cached — a decision, not an oversight**
>
> There was a cache once, with `inputs: ['{projectRoot}/src/lib/schema/**/*']` and `outputs: ['{projectRoot}/migrations']`. Both halves were wrong, and together they **lost work**.
>
> **(1) The inputs could not be right.** Each project declares where its schema lives in _its own_ `drizzle.config.ts`: for the host that is `./src/content/index.ts`, for media `./src/lib/infrastructure/schema/index.ts`, for copilot the glob `./src/lib/*/infrastructure/schema/index.ts`. Most configs point _outside_ `src/lib/schema/`, so the declared input matched **nothing**: editing the schema did not change the hash, and re-running with the same `--name` replayed a cached "No schema changes, nothing to migrate" — a green tick with no migration behind it, exactly the schema-versus-migration drift `.cursor/BUGBOT.md` warns about.
>
> **(2) The output is also an input.** drizzle-kit diffs the schema against `migrations/meta/*_snapshot.json`, which sits inside the declared output directory. So the result is not a function of the declared inputs, however you write them, and _restoring_ from the cache replaces the whole `migrations/` folder — erasing migrations created after the cache entry was written, along with the journal and the snapshot.
>
> Deriving the inputs from each config fixes (1) but not (2), and would mean importing a dozen TypeScript configs on every graph computation. Generation takes about a second, is run by hand a few times a week and is never run in CI — the cache bought nothing and risked the working tree.

## 04. How target inference works

All of the inference is a single exported constant, `createNodesV2`: a pair of a glob and an async function. Nx finds every file matching the glob and asks the function which targets to hang on the project whose root holds that file. It is the same mechanism `@nx/js` uses to infer `typecheck` from a tsconfig.

```
export const createNodesV2: CreateNodesV2 = [
    '**/{drizzle.config.ts,ortha.config.ts,package.json}',
    async (configFiles, _, context) => { /* … */ }
];
```

Dispatch inside the function is by file name, exactly three branches:

1. **`package.json`** → `packageTargets(projectRoot, file, workspaceRoot)`. Returns `build`, plus `pack` and `nx-release-publish` for a non-private package.
   _if the function returned undefined, an empty object is handed back — the project simply gets nothing_
2. **`drizzle.config.ts`** → one `db:generate` target with `cwd` = the project root and `config: 'drizzle.config.ts'`.
   _config is given relative to cwd because drizzle-kit resolves schema/out against the working directory, not against the config's location_
3. **`ortha.config.ts`** → two targets, `db:migrate` and `db:studio`. The first also gets `plugins: <projectRoot>/src/plugins.ts`.
   _the path to the plugin factory is fixed by convention, not read from the config_

### The four safety catches in packageTargets

The function returns `undefined` — meaning the project gets no targets at all — in four cases. Each is covered by its own test:

| Condition                                        | Why it refuses                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| The project root does not start with `packages/` | Applications (`apps/admin`, `apps/server`) are built by their own bundlers; the workspace's root manifest is not a package     |
| The manifest does not parse as JSON              | A broken `package.json` must not take down the whole graph computation — that would break every `nx` command in the repository |
| The manifest has no `name`                       | A nameless package can neither be wired into references nor published                                                          |
| There is no `tsconfig.lib.json` beside it        | Nothing to build with: the `build` command is `tsc --build tsconfig.lib.json`                                                  |

A fifth case — `private: true` — is not a refusal but a narrowing: the package gets `build` but not `pack` and not publishing. That is precisely how `@ortha/nx` itself ends up buildable but unpublishable.

### Why build is inferred here rather than by the @nx/js plugin

`@nx/js/typescript` infers `build` only for a project whose manifest points at an **output**. The workspace manifests point at `./src/index.ts`, because packages are consumed from source (see the root `AGENTS.md`, "How packages resolve"). That is the right trade for development and the wrong one for npm, so the compile step is inferred here.

> **nx-release-publish is declared twice — and has to be**
>
> Nx adds its **own implicit** `nx-release-publish` to every non-private package and applies it _after_ inference. If the two definitions disagree on the executor, Nx's definition wins — and takes the inferred `options` with it, `packageRoot` included. The practical outcome: the release silently publishes the project root, whose manifest points at source, instead of what `pack` staged. So the executor is duplicated into `nx.json` → `targetDefaults`, and `dependsOn: ['pack']` lives **only there** — here Nx would overwrite it anyway.

> **The scaffolder templates are hidden from inference**
>
> `packages/create-ortha-app/templates` is listed in the root `.nxignore`. Inside the template sits a real `ortha.config.ts`, and inference would dutifully hang `db:migrate` on it — on a directory that has no project name, after which the graph would stop building entirely. The ignore file is not written for this plugin but for all of them at once: `@nx/js/typescript` would infer `typecheck` from the template tsconfigs just as eagerly.

## 05. Reading TypeScript from source

Two executors — `db:migrate` and `db:studio` — have to read the host's `ortha.config.ts`, and the first also `src/plugins.ts` with its `buildPlugins(config)` factory. Both files are TypeScript, and in this monorepo they are **not compiled**: the workspace resolves everything from source. Hence `src/lib/jiti.ts`.

```
export function createTsJiti(referenceFile: string) {
    return createJiti(referenceFile, { transform: swcTransform });
}
```

### Why swc specifically, and not the built-in babel

Loading the config drags in the whole plugin graph — NestJS modules and their DTOs — and that graph uses **legacy** decorators (`experimentalDecorators`). The babel built into jiti ignores our tsconfig and defaults to stage-3 decorator semantics. Under those semantics a decorated field with a definite assignment (`email!: string`) gets an initializer, and the transform fails inside `transform-typescript`. swc with `legacyDecorator: true` and `decoratorMetadata: true` matches the repository's real TS config, so the very same source that compiles the application loads here too.

| Transform option            | Value                            | Why                                                               |
| --------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| jsc.target                  | `es2022`                         | Matches the server's compilation target                           |
| jsc.parser                  | `typescript`, `decorators: true` | Otherwise Nest's decorators are not recognised as syntax          |
| transform.legacyDecorator   | `true`                           | The exact point of divergence from babel                          |
| transform.decoratorMetadata | `true`                           | Nest reads parameter types out of the metadata                    |
| module.type                 | `commonjs`                       | The package and the code it loads are both CJS                    |
| configFile / swcrc          | `false`                          | Settings are given explicitly rather than picked up from the tree |

> **Why the CLI has none of this**
>
> This is a problem **of this workspace only**. A generated application has its own build step, so `@ortha/cli` simply builds first and `require`s the finished JavaScript: `dist/server/ortha.config.js` and `dist/server/src/plugins.js` (the `LAYOUT.compiledConfig` and `LAYOUT.compiledPlugins` constants). The whole transform problem never arises on the consumer side — the CLI needs neither jiti nor swc. The same place also chose `require` over `await import()`: the application compiles to CommonJS, and importing a CJS module from ESM puts the entire `module.exports` into the namespace's `default`, so `module.default` turns out to be `{ default: config }` and the very first property access fails on `undefined`.

## 06. Step-by-step flows

### 6.1 Generate a migration for a plugin

No database needed. No secrets needed. The result is a new SQL file, committed together with the schema change.

```
npx nx run identity-server:db:generate --name=add_sso_identities
```

1. **Nx found the target from a file.** `packages/identity/server` holds a `drizzle.config.ts` — so the project already has `db:generate`, having declared nothing.
   _inferred options: cwd = packages/identity/server, config = drizzle.config.ts_
2. **The executor builds an absolute path.** `join(context.root, options.cwd)` — and passes it on as the working directory.
3. **`runDrizzleKitGenerate(cwd, config, name)` from `@ortha/cli` is called.** It resolves the binary: drizzle-kit's `exports` do not let you reach `./bin.cjs` directly, so the package's main entry is resolved and the neighbouring file is taken.
4. **drizzle-kit runs with `stdio: 'inherit'`.** Its output goes straight to the terminal: the work happens in the plugin's `cwd`, because `schema` and `out` resolve against the working directory rather than the config's location.
5. **The schema is diffed against the snapshot.** `migrations/meta/*_snapshot.json` is the reference; no database connection is opened at all.
6. **On failure the message is rewritten.** `execFileSync` throws an error whose text is the entire argv (the node path, the binary path, every flag), and Nx prints that as a multi-frame stack. Instead a short "drizzle-kit generate failed in \<cwd> (exit N) — its output is above" is thrown, telling you to check the `schema` paths and that the schema compiles.
   _the original error is preserved in cause_
7. **The emitted SQL is committed.** The migration file and the updated journal/snapshot are part of the same change as the schema edit.

### 6.2 Apply every plugin's migrations

The one command run on a staging environment and in production. The order of the plugins is load-bearing.

```
docker compose up -d          # Postgres
npx nx run server:db:migrate  # apply everything
```

1. **A jiti loader is created** — `createTsJiti(__filename)`, the one with swc in legacy-decorator mode.
2. **The host's `ortha.config.ts` is imported** from `join(context.root, options.config)`; the `default` export is taken.
3. **The plugins module is imported** — `apps/server/src/plugins.ts`, which exports `buildPlugins(config)`.
4. **The database URL is checked — and this is a refusal, not a warning.** If `config.database?.url` is empty, an error is thrown with a blunt message: "db:migrate needs to know which database to migrate, and will not fall back to the local defaults".
   _the check runs BEFORE the plugin list is built — a dedicated test pins that down_
5. **The plugin list is built** by calling `buildPlugins(config)`, and passed into `applyPluginMigrations(plugins, url)`.
6. **The core filters out plugins with no migrations.** If there are none at all, it prints "No plugin migrations to apply." and stops.
7. **It prints where exactly it is writing.** `describeTarget(url)` gives `host:port/database` without credentials; a URL that will not parse is honestly called unparseable rather than guessed at.
8. **Plugins are applied one at a time, in the order `buildPlugins()` returned.** Each with its own `migrations.dir()` folder and its own `migrations.table` journal table.
9. **A failure says where it stopped.** "Migrating plugin \<name> failed — applied N of M before it", plus an explicit "nothing is rolled back: N are already committed", plus the main hint — about the **order** in `plugins.ts`.
10. **The pool is closed in `finally`** whatever the outcome.

> **Why an empty DATABASE_URL is a refusal**
>
> `new Pool({ connectionString: '' })` does not fail: `pg` falls through to the libpq environment variables — `PGHOST`, `PGUSER`, `PGDATABASE` — or to localhost and the OS user. Measured in this repository before the check existed: with `DATABASE_URL` unset and `PGDATABASE` pointing somewhere else, `db:migrate` reported "Migrations complete." **after creating the entire schema in a database nobody named**. `db:studio` always refused; this is the same refusal.

> **The plugin order is declared nowhere**
>
> `memberships` from workspaces has a foreign key onto `users` from identity, and nothing in the system declares that dependency. The loop applies plugins in exactly the order `buildPlugins()` returned them, which is why the error message points at the order as the usual cause of "relation does not exist".

### 6.3 Open Drizzle Studio

```
npx nx run server:db:studio
npx nx run server:db:studio --port=5000        # a different port
npx nx run server:db:studio --host=0.0.0.0     # prints a warning
```

1. **The URL is resolved from the host config** by the same jiti loader — `ortha.config.ts` remains the only place that reads `DATABASE_URL`.
2. **An empty URL is a refusal.** "Drizzle Studio needs a live database connection."
3. **`--port=0` is a refusal.** drizzle-kit will indeed take an ephemeral port, but it prints the one it was _asked_ for, and Studio ends up at an address nobody reports. A refusal beats both the silent shrug that used to be here and drizzle-kit's useless success.
4. **An ephemeral config is synthesised in a temporary directory.** The committed drizzle configs deliberately contain only the schema and no secrets, so the config is created on the fly — and it references `process.env.DATABASE_URL` rather than inlining the URL.
5. **The URL is passed through the child process's env** and is **never written to disk**. The ephemeral config exports a plain object with no `import`, so that drizzle-kit's bundler needs no module resolution from the temporary directory.
6. **An unsafe bind warns out loud.** Any `--host` other than `localhost`, `127.0.0.1`, `::1` or `[::1]` prints a warning naming the address: Studio has no authentication and full read/write access, and drizzle-kit says nothing about that difference.
7. **Ctrl+C is a success.** `execFileSync` throws when the child is killed by a signal; `SIGINT` and `SIGTERM` are recognised and return success. Treating the documented way to stop as a red failure teaches people to ignore red.
8. **The temporary directory is removed in `finally`** on any outcome.

### 6.4 Cut a release

```
npm run release:dry-run     # a rehearsal: writes nothing, pushes nothing, publishes nothing
npm run release             # version → changelog → tag → push → publish → GitHub Release
npm run release:publish     # publish only, to finish off a partially failed release
npm run release -- 1.2.0    # force a version instead of the inferred one
```

1. **Pre-flight checks.** `tools/release/release.mjs` loads `.env` and refuses to start if you are not on `main` (bypass with `--allow-branch`), the tree is dirty, the branch is behind `origin/main`, npm has no usable credentials, or `GITHUB_TOKEN` is missing.
   _nx release commits, tags and PUSHES before publishing — a problem found late leaves a tag and an empty registry_
2. **The version.** `nx release` derives it from conventional commits (`feat:` → minor, `fix:` → patch, `!` → major), in `fixed` mode: all packages move together.
3. **`preVersionCommand` builds everything:** `npx nx run-many -t build --projects=@ortha/*,create-ortha-app`.
4. **`pack` stages each package** into `dist/pack/<projectRoot>/` with a rewritten manifest. The target depends on `build`.
5. **Confirmation.** `nx release` asks before publishing, and that prompt is left in deliberately: a publish cannot be undone, and a version number cannot be reused.
6. **Publishing one at a time.** Each package goes through a work slot behind a file lock, is probed against the registry with a `GET`, and published with `npm publish <packageRoot> --json`.
7. **GitHub Release.** One shared `CHANGELOG.md` for the workspace, a tag of the form `v{version}`, the release created with `GITHUB_TOKEN`.
8. **If something failed — `npm run release:publish`.** Packages already in the registry are skipped by the probe without a single write.

## 07. The release process in detail

Every package under `packages/` is published **in one pass, at one version, under one tag**. In `nx.json` that reads: `projects: ["@ortha/*", "create-ortha-app", "!@ortha/nx", "!@ortha/copilot-provider-fake"]`, `projectsRelationship: "fixed"`, `releaseTagPattern: "v{version}"`. The applications (`apps/admin`, `apps/server`) are private and never published: they are the reference host, not a distribution.

### Why the tarball is not the committed manifest

The workspace resolves packages **from source**: `exports` points at `./src/index.ts`, and `tsconfig.base.json` supplies the `@ortha/source` condition. A consumer installing the package from npm has neither, and no way to compile our TypeScript. So the release has to _undo_ exactly the thing that is convenient in development. Three inferred targets do that, and all three come from this package — meaning a new package gets them by the fact of existing.

| Step               | What happens                                                                                                              | What ends up in the result                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| build              | `tsc --build tsconfig.lib.json` — JS and `.d.ts` into the package's `dist/`, building project references along the way    | Server packages compile to CommonJS (a consequence of `nodenext` and no `"type": "module"`), admin packages to ESM for the bundler                                                                                                  |
| pack               | `tools/release/pack.mjs` assembles the publishable root into `dist/pack/<projectRoot>/`                                   | a rewritten `package.json` · `dist/` (the tsc output plus non-TS assets such as `styles.css`) · `migrations/` verbatim, if the plugin carries them · `templates/` verbatim, if the package carries them · `README.md` and `LICENSE` |
| nx-release-publish | Publishes **that directory**, not the project root, via `packageRoot`. The executor is ours, not `@nx/js:release-publish` | A tarball of exactly the staged content                                                                                                                                                                                             |

#### What pack rewrites in the manifest

- **`exports`** — each subpath is moved from `./src/*.ts` to `./dist/*.js`, with the declarations offered first (so that `types` wins for tsc) and the compiled JS as `default`.
- **`bin`** — remapped the same way as `main`, in both forms npm accepts: a bare string and a map. Left pointing at `./src/cli.ts`, it publishes a command that installs cleanly and dies on the first `npx`, on someone else's machine, with an error about a missing command rather than a missing file.
- **Workspace dependencies** — declared as `"*"`, which in the registry means "whatever is latest", are pinned to the release version.
- **`files`** — `dist` plus `migrations` and `templates` where present; otherwise npm simply would not publish them.
- **`publishConfig.access: 'public'`** — always set.

> **Two things pack refuses to ship**
>
> Both were real bugs and both fail the release rather than reaching the registry. **(1) An entry point that was not built** — every path in the generated `exports` must exist in the staging directory. **(2) A phantom dependency** — a package importing something declared only in the _root_ manifest resolves here (npm hoists dependencies) and is simply absent from the consumer's tree. Type-only imports count too: they end up in the `.d.ts`.

The staging directory sits at the workspace root rather than beside the package, deliberately: the root `workspaces` globs cover `packages/*`, and a staging directory inside a flat package reads as a second workspace with the same name — after which npm refuses to work at all.

### Throttling: why publishing cannot just be npm publish

npm limits **how fast** a single account writes. Published at the speed Nx schedules them, the tarballs start collecting `429 Too Many Requests` somewhere in the middle of the list — and by then the version is already committed, tagged and pushed, so the repository claims the release happened while the registry holds only half of it.

Nx runs `nx-release-publish` as ordinary tasks — in parallel, in forked workers — so the interval cannot be held inside a single process. Hence the file lock under `dist/.release-publish`: whoever holds it publishes, the rest wait their turn.

| Mechanism       | How it works                                                                                                                                                                                                                           | What it protects                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| withPublishSlot | A `lock` file is created with the `wx` flag (failing when it exists is the mutex) and holds the owner's pid. The lock is held **through the pause as well**, so that packages queue up instead of all sleeping at once and then racing | Serialising publishes on top of Nx's task parallelism                                                                                 |
| spacing         | The minimum interval between two publishes. It may be a function — evaluated only _after_ the slot is taken, so that a package which already knows it will not publish does not sit out the pause                                      | The write rate limit                                                                                                                  |
| heartbeat       | The holder touches its lock's mtime every 60 s (the timer is `unref`'d so that a stuck publish does not hold the worker's event loop open)                                                                                             | Tells "dead" apart from "still working"                                                                                               |
| staleAfter      | 15 minutes of **silence**, after which the lock may be stolen. Silence, not age: the default retry ladder sleeps 30+60+120+240+300 s = 12.5 minutes before the sixth attempt, and `ORTHA_PUBLISH_RETRIES=8` takes it past twenty       | A hung worker does not jam every subsequent release                                                                                   |
| holderIsAlive   | A pid check with signal `0`, **before** the age check. `ESRCH` is proof that nobody holds it; `EPERM` means "alive and someone else's". An unreadable or corrupt lock is treated as alive, so that a genuine race still waits          | A release interrupted with Ctrl-C leaves a lock behind — otherwise every resumed release would start with a fifteen-minute hang       |
| release         | Removes the lock **only if it is still ours** (the pid matches)                                                                                                                                                                        | If the lock was in fact stolen, removing it from here would hand the slot to a _third_ publisher — one overlap would become a cascade |

#### The life of a single publish

**queued** — took the lock → **pause** — GET probe → **npm publish** → **published** or **failed**

The "probe" state has two exits that bypass publishing: `version-published` goes straight to success with no write, and a tripped safety catch goes straight to failure, also with no write. From "npm publish" a retryable response returns to the pause with a doubled backoff, and so on until the attempts run out.

### Probing the registry: ask before you speak

`PUT` is a metered operation, `GET` is not. Before every publish a single `GET` of the packument is made (`lib/release/registry.ts`), and its answer settles two questions at once.

| Probe result      | What it means                                      | What the executor does                                                                           |
| ----------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| version-published | This exact version is already in the registry      | Skip without a single write — this is what resuming a failed release is                          |
| name-exists       | The name exists, this version is new               | A normal publish with the full retry ladder                                                      |
| name-absent       | 404 — publishing will **create the name**          | Exactly one attempt, no ladder                                                                   |
| unknown           | The registry did not answer: offline, DNS, a proxy | Publish and let the `PUT` decide. A probe that could not answer must never be a cause of failure |

The slash in a scoped name is escaped to `%2f` — the way npm's own clients do it. The token, when present, is sent as a `Bearer`, and is needed for exactly one thing: so that a **restricted** package reads as `name-exists` rather than `name-absent`. It is looked up in three places in order: npm's own key of the form `npm_config_//registry.npmjs.org/:_authToken`, then `NPM_TOKEN`, then `NODE_AUTH_TOKEN`.

### What is retried and what is not

| npm's response                                                                           | Classification    | Behaviour                                                                                     |
| ---------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------- |
| 429 / "too many requests" / "rate limit" / `E429` / `ERATELIMIT` — **on a version bump** | retryable         | Retry with a backoff of 30 s → 60 → 120 → 240 → 300 (the ceiling), 5 extra attempts           |
| 429 — **on creating a name**                                                             | creation-blocked  | One attempt and an honest answer. A "safety catch" is tripped next to the lock                |
| `E50x`, `500/502/503/504` with the server's text                                         | retryable         | Retry ("the registry returned a server error")                                                |
| `ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`, `EAI_AGAIN`, "socket hang up", "network"      | retryable         | Retry ("the connection to the registry failed")                                               |
| `EPUBLISHCONFLICT` / "cannot publish over the previously published versions"             | already-published | **Success.** This is exactly what a resumed release sees for everything that already went out |
| A broken manifest, a missing entry point, a rejected token                               | failed            | Fail on the first attempt — retrying only lengthens the path to the same answer               |

Server errors are recognised by npm's own phrasing (`npm error code E503`, `503 Service Unavailable - PUT https://…`) rather than by a bare number, which also turns up in unrelated output such as file sizes. The rate-limit check deliberately **does not fire** on a plain `E403`.

> **Creating a name is a different limit, and you cannot wait it out**
>
> Everything above is about write speed, and the interval fixes that. Creating a **new package name** is metered separately and far more harshly. Measured: release 0.1.0 created 25 names in 32 seconds, after which npm refused the remaining 12 — and kept refusing them in 0.2.0 and 0.2.1 as well, while version bumps on the 25 names that already existed went through untouched in the same runs. An hour of a completely idle account changed nothing.
>
> So: **a 429 on creation is terminal**. One attempt, a clear message, and a flag tripped next to the lock. Packages queued behind it drop out **without spending a single request**: one blocked release costs one rejected write, not one per package. The flag is re-checked _inside_ the slot, not only on entry — before the first publish attempt the answer would always have been "no".
>
> The only cures are contacting npm support — or seeding the names in advance: `npm run release:reserve` creates the missing names in batches, publishing a **real staged tarball** under version `0.0.0-reserve.0` and the dist-tag `reserve`. `latest` is left unset, so `npm install` finds nothing until the real release instead of installing a stub. The first refusal ends the run: every rejected attempt is a signal to the rate limiter.

> **Rehearse with npm run release:dry-run, never with nx run-many**
>
> `nx run <project>:nx-release-publish --dryRun` works — the flag reaches the executor. `nx run-many -t nx-release-publish --dryRun` **does not**: `run-many` swallows `--dryRun` itself, the option never arrives, and the target performs a **real** `npm publish`. On an authenticated machine that publishes for real, and for a name the account has not created yet it spends one of the rationed creations. `npm run release:dry-run` goes through `nx release publish --dry-run`, which also sets `NX_DRY_RUN`, so the rehearsal holds in both cases.

### What the executor skips without a write

- **`private: true` in the staged manifest** — "Skipped \<pkg>, because it is marked private".
- **Nx resolved no new version** (`nxReleaseVersionData[project].newVersion === null`) — there is nothing to publish, and asking npm would only earn another 403.
- **The probe said `version-published`** — "that version is already on the registry".
- **The safety catch was tripped by another package** — status `blocked-by-peer`: the message names the package that hit the limit first, and this one spends no request.

A dry run does not probe the registry and does not wait for anything: it writes nothing, so it has no limit to pace itself against.

## 08. Configuration and environment

### Environment variables

| Variable                    | Who reads it                                             | Purpose                                                                                                                                                                                                      |
| --------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DATABASE_URL                | the host's `ortha.config.ts` → `db:migrate`, `db:studio` | The only source of the database address. An empty value is a refusal in both executors                                                                                                                       |
| NPM_TOKEN                   | `release.mjs`, the registry probe                        | An automation token with publish rights in the `@ortha` scope. Passed to npm as child-process configuration, **never written into `.npmrc`**. It may be left empty and the publish done under `npm login` |
| NODE_AUTH_TOKEN             | the registry probe                                       | A fallback source for the token (typical in CI)                                                                                                                                                              |
| GITHUB_TOKEN                | `release.mjs` → `nx release`                             | A token with `repo` access, used to create the GitHub Release                                                                                                                                                |
| ORTHA_PUBLISH_DELAY         | `release-publish`                                        | The interval between publishes, in ms. Defaults to 5000                                                                                                                                                      |
| ORTHA_PUBLISH_RETRIES       | `release-publish`                                        | Extra attempts on a retryable error. Defaults to 5                                                                                                                                                           |
| ORTHA_PUBLISH_RETRY_BACKOFF | `release-publish`                                        | The first backoff, in ms; doubles thereafter. Defaults to 30000                                                                                                                                              |
| NX_DRY_RUN                  | `release-publish`                                        | Set by `nx release publish --dry-run`; enables a dry run on equal footing with the `dryRun` option                                                                                                           |

```
# slow the publishes down for a single run
ORTHA_PUBLISH_DELAY=10000 ORTHA_PUBLISH_RETRIES=8 npm run release
```

**Precedence for the numeric settings:** environment → target option → built-in default. Any finite non-negative integer is accepted from the environment, `0` included: zero is meaningful (no pause at all) and must not silently fall through to the default.

### Configuration points outside the package

| File                         | What it sets                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| nx.json → plugins            | The line `"@ortha/nx"` — the only thing that switches target inference on                                          |
| nx.json → targetDefaults     | `nx-release-publish`: the duplicated `executor` and the **only place** `dependsOn: ['pack']` lives                    |
| nx.json → release            | The project list, `fixed` mode, the tag pattern, conventional commits, `preVersionCommand`, one shared `CHANGELOG.md` |
| .nxignore                    | Hides `packages/create-ortha-app/templates` from every plugin's inference at once                                     |
| \<plugin>/drizzle.config.ts  | The marker for `db:generate` and at the same time the source of the `schema` / `out` paths. Schema only, no secrets   |
| apps/server/ortha.config.ts  | The marker for `db:migrate` / `db:studio`; the only place that reads `DATABASE_URL`                                   |
| apps/server/src/plugins.ts   | `buildPlugins(config)` — the list of plugins and, more importantly, their **order**                                   |
| \<package>/tsconfig.lib.json | The file's presence is a precondition for `build`; the file itself says what is compiled and where to                 |

<details>
<summary>The minimal `.env` that is enough to work with the database</summary>

```
DATABASE_URL=postgres://ortha:ortha@localhost:5432/ortha_cms
```

`db:generate`, `db:migrate` and `db:studio` need nothing more. The first does not even need that. For parallel stacks, slot _n_ fixes its own port and database (`ortha_cms_an`), and `npm run worktree -- provision <slot>` writes an already adjusted `.env` — the database targets do not change at all, they simply read a different URL.

</details>

### How to add a new command

1. **Create `src/executors/<name>/executor.ts` and `schema.json`.** Keep the logic in `src/lib/`, keep the executor thin.
2. **Register it in `executors.json`** with `implementation`, `schema` and `description`.
3. **Optionally: infer it in `createNodesV2`,** so the target attaches itself to projects by a file marker.

## 09. Invariants

Statements that must always hold. This doubles as a review list and as a starting set of test assertions.

- **I-01** — The inference glob is exactly `**/{drizzle.config.ts,ortha.config.ts,package.json}`; not one target of this package is written onto a project by hand.
- **I-02** — A project with a `drizzle.config.ts` gets `db:generate` and **does not get** `db:migrate` or `db:studio`.
- **I-03** — A project with an `ortha.config.ts` gets `db:migrate` and `db:studio` — both uncacheable.
- **I-04** — `db:generate` is uncacheable and **declares neither inputs nor outputs** against which it could be cached.
- **I-05** — `db:generate` opens no database connection and requires no secret at all.
- **I-06** — `db:migrate` and `db:studio` refuse to run with an empty database URL and **never** fall through to libpq's local defaults.
- **I-07** — The URL check in `db:migrate` happens **before** the plugin list is built: nothing is opened and nothing is applied.
- **I-08** — Migrations are applied strictly in the order `buildPlugins()` returned, each plugin under its own journal table.
- **I-09** — A migration failure names the plugin and the number of plugins already committed, and points at the order as a likely cause; the pool is closed either way.
- **I-10** — The database URL is never written to disk: Studio receives it through the child process's `env`, and the ephemeral config references `process.env.DATABASE_URL`.
- **I-11** — The ephemeral config's temporary directory is removed in `finally` on any outcome.
- **I-12** — `--port=0` for Studio is a refusal, not a silent shrug.
- **I-13** — Any `--host` other than loopback prints a warning about the missing authentication before Studio starts.
- **I-14** — Stopping Studio with `SIGINT`/`SIGTERM` is a target success, not a failure.
- **I-15** — `build`, `pack` and `nx-release-publish` are inferred only for a package under `packages/` with a name in its manifest and a `tsconfig.lib.json` beside it.
- **I-16** — A `package.json` that will not parse yields **zero targets**, not a failed graph computation.
- **I-17** — A package with `private: true` gets **only** `build`.
- **I-18** — `nx-release-publish` always points `packageRoot` at `dist/pack/<projectRoot>` rather than the project root; the executor is declared both in the inference and in `targetDefaults`, and the two declarations agree.
- **I-19** — `pack` is uncacheable: it reads `dist`, which is not among its declared inputs.
- **I-20** — Publishes are serialised behind a file lock; at any moment at most one package in the workspace is publishing.
- **I-21** — The lock is held through the pause as well, and is released only by its owner (a matching pid).
- **I-22** — A live holder refreshes the lock with a heartbeat; `staleAfter` bounds **silence**, not the duration of the work.
- **I-23** — A dead holder's lock (`ESRCH`) is taken immediately, without waiting out `staleAfter`; an unreadable or corrupt one is treated as alive.
- **I-24** — Before every publish the registry is probed with a single `GET`; any failure of that probe collapses to `unknown` and never becomes a cause of a failed publish.
- **I-25** — An already-published version is skipped **without a single write** to the registry; an `EPUBLISHCONFLICT` that slips through is also read as success.
- **I-26** — A 429 on a version bump is retried; a 429 on **creating a name** is terminal and gets exactly one attempt.
- **I-27** — The first blocked creation trips the safety catch, and the remaining new names in that run drop out without spending a single request.
- **I-28** — An error that is not the registry's (a broken manifest, a missing entry point, a rejected token) fails on the first attempt.
- **I-29** — A dry run neither probes the registry nor waits out the pause.
- **I-30** — Precedence for the numeric settings: environment → target option → default; `0` from the environment is accepted as a value.
- **I-31** — The `@ortha/nx` package stays `private` and is excluded from the release by an explicit `!@ortha/nx`.
- **I-32** — The database executors contain no implementation of their own: `db:generate`, `db:migrate` and `db:studio` call `@ortha/cli` functions, and that is the single implementation for the monorepo and for a generated application.
- **I-33** — The host's TypeScript is loaded through `createTsJiti` with legacy decorators; both executors use the same loader.
- **I-34** — The package stays CommonJS: `require`/`__dirname`/`__filename`, never `import.meta`.

## 10. Testing checklist

Phrased as "action → expected result", so they can go into a test case without rewriting. The existing suite is **127** jest cases across eleven files next to the code (`npx nx test nx`); they mock at the process boundary — `node:child_process`, `pg`, `fetch`, jiti — so the whole package is covered with no database, no registry and no Nx graph. Target inference is exercised against a throwaway workspace root on disk: that is what makes the manifest safety catches testable at all.

### Target inference

- **A project with a `drizzle.config.ts`** → exactly one `db:generate` target, `cache: false`, `cwd` = the project root, `config` = `drizzle.config.ts`.
- **A project with an `ortha.config.ts`** → two targets, both `cache: false`; `db:migrate` has `plugins` in its options, `db:studio` does not.
- **A publishable package under `packages/`** → exactly three targets: `build`, `pack`, `nx-release-publish`; `packageRoot` = `dist/pack/<projectRoot>`.
- **A package with `private: true`** → exactly one target — `build`.
- **A manifest outside `packages/` (apps, the workspace root)** → an empty target object.
- **A manifest with no `name`** → an empty target object.
- **A package with no `tsconfig.lib.json`** → an empty target object.
- **Broken JSON in `package.json`** → an empty target object; `nx graph` still builds and no `nx` command fails.
- **`npx nx show project <plugin> --json` for a new plugin** → every expected target is present with not one line of configuration in the project.

### db:generate

- **Run with Postgres completely stopped** → success: no connection is opened.
- **Run with `--name=…` after a schema edit** → a new SQL file in `migrations/`, an updated journal and snapshot.
- **Re-run with the same `--name` and no schema edits** → drizzle-kit reports no changes; the result is **not** served from the Nx cache.
- **Edit the schema of a plugin whose `schema` points outside `src/lib/schema/` (media, alarms, copilot, content, workspaces)** → the migration is generated — the old mismatched-cache-input bug does not reproduce.
- **Break the `schema` path in the config** → one short "drizzle-kit generate failed in \<cwd>" error, with no multi-frame argv stack.

### db:migrate

- **`DATABASE_URL` unset** → a refusal with the "will not fall back to the local defaults" text; not one table created.
- **`DATABASE_URL` empty but `PGDATABASE`/`PGHOST` set** → the same refusal; the unrelated database is untouched.
- **A clean database** → the log names `host:port/database` without credentials and the number of plugins; it ends with "Migrations complete.".
- **A re-run against an already migrated database** → idempotent, nothing new is applied.
- **Move workspaces ahead of identity in `plugins.ts`** → the failure names the plugin, how many were committed before it, and points at the order.
- **Kill the Postgres process halfway through** → the pool is closed, the error names the plugin; a re-run continues from that same plugin.
- **A plugin with a decorated `email!: string` field in a DTO** → the config loads; there is no failure in `transform-typescript`.

### db:studio

- **Run without `DATABASE_URL`** → a refusal before drizzle-kit starts.
- **`--port=0`** → a refusal with an explanation, not a start on an unknown port.
- **`--host=0.0.0.0`** → a warning naming the address and port is printed **before** the start.
- **`--host=127.0.0.1`** → no warning.
- **Inspect the temporary directory while it runs** → the ephemeral config holds `process.env.DATABASE_URL`, not the URL itself.
- **Ctrl+C** → the target finishes successfully; the temporary directory is gone.

### Publishing

- **`npm run release:dry-run` from a clean `main`** → not one write to the registry, not one push; the log shows "Would publish …" for each package.
- **Run from a branch other than `main` / with a dirty tree / with the branch behind** → pre-flight refuses **before** anything is committed or tagged.
- **`GITHUB_TOKEN` missing (not a dry run)** → refusal at pre-flight.
- **A private package in the list** → "Skipped …, because it is marked private"; no request to the registry.
- **Nx resolved no new version for a project** → "Skipped …, because no new version was resolved".
- **The version is already in the registry** → skipped on the probe's answer, with no `npm publish`.
- **The registry answers `EPUBLISHCONFLICT`** → success, not a failure.
- **The registry answers 429 on a version bump** → retries with a 30/60/120/240/300 s backoff; the log shows the attempt number out of the total.
- **The registry answers 429 on creating a name** → exactly one attempt, and a `creation-blocked` file appears in `dist/.release-publish`.
- **A second new package after the safety catch tripped** → it fails with no request to the registry, and the message names the package that hit the limit first.
- **An existing name while the safety catch is tripped** → publishes normally.
- **The registry unreachable (network off) at the probe stage** → the answer is `unknown` and the publish is attempted anyway.
- **Two concurrent `nx-release-publish` runs** → the second waits and prints "waiting for another package to finish publishing"; there is no overlap.
- **Kill the process holding the lock** → the next one takes the slot immediately, with no fifteen-minute wait.
- **A holder running longer than `staleAfter` but refreshing the lock** → the lock is not stolen.
- **`ORTHA_PUBLISH_DELAY=0`** → the pause really is zero, not replaced by the 5000 default.
- **Wipe `dist/` between runs** → the lock and the safety catch are cleared — both live under `dist/.release-publish`.

### Tarball staging

- **`nx run <pkg>:pack`, then inspect `dist/pack/<projectRoot>/package.json`** → `exports` points at `./dist`, workspace dependencies are pinned to the release version, `publishConfig.access: 'public'`.
- **A package with a `bin`** → the path is rewritten to the build output; both forms (string and map) are handled; a non-existent bin fails `pack`.
- **A plugin with `migrations/`** → the folder is copied verbatim and listed in `files`.
- **`create-ortha-app`** → `templates/` is copied and listed in `files`.
- **A package importing a dependency declared only in the root manifest** → `pack` refuses: a phantom dependency never reaches the registry.
- **A new package added under `packages/` but not classified in `features.ts`** → the `create-ortha-app` tests fail — by design.

## 11. Boundaries of responsibility

The main line in this package runs between it and `@ortha/cli`. The rule is simple: **what only this repository runs stays here; what has to work in an app installed from npm moves into the CLI**.

| Area                                        | What `@ortha/nx` does                                                                                   | What `@ortha/cli` does                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Generating migrations                       | Infers the target, builds the absolute `cwd`, passes the options                                           | `runDrizzleKitGenerate`: resolves the drizzle-kit binary, runs it, rewrites the error message                                |
| Applying migrations                         | Infers the target, loads the host's TypeScript through jiti+swc, refuses on an empty URL                   | `applyPluginMigrations`: the `pg` pool, the loop over plugins, the journal tables, `describeTarget`, the failure diagnostics |
| Drizzle Studio                              | Infers the target, resolves the URL, refuses on an empty URL and on `--port=0`                             | `runDrizzleKitStudio`: the ephemeral config, passing the URL through env, the unsafe-bind warning, the handling of Ctrl+C    |
| Finding the app root and reading the config | Reads the paths Nx gave it: the workspace root is known from the context                                   | `findProjectRoot`, `loadHost`, `requireDatabaseUrl`, the `LAYOUT` constants — works from any subdirectory of the application |
| Publishing to npm                           | **Entirely here:** the lock, the interval, the retries, the registry probe, the name-creation safety catch | Nothing — a consumer does not cut releases                                                                                   |
| Tarball staging                             | Infers the `pack` target and points `packageRoot` at it                                                    | Nothing — assembling the staging directory itself lives in `tools/release/pack.mjs`                                          |

### What the neighbours handle

| Area                                                        | Who owns it                                                  | What this plugin does                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| The database schema and the SQL migrations                  | Each plugin separately (`drizzle.config.ts` + `migrations/`) | Knows _how_ to generate and apply, never _what_                             |
| The runtime database connection                             | `@ortha/database`                                         | Opens a pool of its own only for the duration of a migration, and closes it |
| The plugin order                                            | `apps/server/src/plugins.ts`                                 | Applies in the order it was given, and points at the order on failure       |
| Assembling the staging directory and rewriting the manifest | `tools/release/pack.mjs`                                     | Invokes the script through the `pack` target and declares its output        |
| Pre-flight, `.env`, the GitHub Release                      | `tools/release/release.mjs` + `nx release`                   | Is responsible only for one `npm publish` at a time                         |
| Scaffolding an application                                  | `create-ortha-app`                                           | Nothing: this package ships no Nx generators                                |
| Building the applications                                   | webpack (server) and Vite (admin)                            | Infers `build` only for `packages/`, and never touches the apps             |

### What is not here

- **Generators.** The manifest declares only the `executors` key; you cannot create a plugin with `nx g`.
- **A `project.json` of its own.** The package is described by a single `package.json`; it gets its own `build` through its own inference.
- **Migration rollback.** There are no `down` migrations; on failure the plugins already applied stay committed, and the message says so explicitly.
- **A declaration of dependencies between plugins.** The order is set by hand in `plugins.ts` and is never checked automatically.
- **A check that schema and migrations have not drifted apart.** The cache was removed precisely because it created that drift, but no active check appeared in its place.

## 12. Discrepancies between code and documentation

Found while checking this dossier against the source. Not product bugs in themselves, but they mislead developer and tester alike — especially where a number in a document looks like a verifiable fact.

| Where                                                            | What it says                                                                                                                                                                              | How it actually is                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/nx/src/executors/<br>db-generate/executor.ts            | The function docstring: "Cacheable — inputs are the schema files, output is the plugin's migrations directory."                                                                           | **Directly contradicts the target inference in the same package.** `createNodesV2` sets `cache: false` and accompanies it with a long comment on why a cache here is both impossible and harmful. The docstring is left over from the old behaviour                                                                                                                                      |
| packages/nx/AGENTS.md                                            | "five of this workspace's **eight** \[drizzle configs\] point outside `src/lib/schema/`". The same count of "eight" is repeated in the `src/index.ts` comment                             | There are now **twelve** configs, and **eight** of them point outside `src/lib/schema/`: `apps/server`, `apps/server-e2e`, alarms, content, copilot, media, webhooks, workspaces. Four point inside: activity, database, identity, segments. The argument only gets stronger, but the numbers are stale — and have gone stale again since, which is the point                            |
| docs/releasing.md · packages/nx/AGENTS.md · comments in the code | "one lockstep release: one version, one tag, one GitHub Release, **37 tarballs**" — and the same figure five more times: "~37 of them", "37 packages in one release", "12 writes, not 37" | There are now **60** publishable packages (every non-private manifest under `packages/*` and `packages/*/*`, `create-ortha-app` included, out of 62 manifests). Two are private — `@ortha/nx` and `@ortha/copilot-provider-fake`. The figure 37 reflects an earlier state of the repository; the arithmetic of the "resume with 12 packages instead of 37" example rests on it too |
| packages/nx/src/executors/<br>db-migrate/executor.ts             | In a comment: "reported "Migrations complete." after creating all **37 tables** in a database nobody named"                                                                               | The coincidence with the tarball count is accidental — that was the number of tables at the time of the measurement. The schema is wider today; the measurement was never repeated. The phrasing looks like a current fact about the system when it is a historical record                                                                                                               |
| .nxignore                                                        | "`@ortha/nx` infers a `db:migrate` target onto `templates/default/src/server`"                                                                                                         | The path in the template is different — `templates/default/apps/server/ortha.config.ts`. The exclusion mechanism itself is described correctly; only the path in the explanation is wrong                                                                                                                                                                                                |
| packages/nx/AGENTS.md, "Architecture"                            | "Release logic (`src/lib/release/`: `publish.ts`, `throttle.ts`, `registry.ts`) stays here"                                                                                               | The same directory holds a fourth spec — `pack.spec.ts` — which tests `tools/release/pack.mjs`, a file **outside** the package. The list in AGENTS.md does not mention it, and from the document it is not obvious that the `pack` tests live here                                                                                                                                       |
| packages/nx/AGENTS.md, "What it provides"                        | On `db:migrate`: "It **refuses to run without a database URL**" — and that is all                                                                                                         | The thing that matters most to a tester is left out: the check runs **before** `buildPlugins()` is called, so with an empty URL the plugin list is not even built. A dedicated test pins that down ("refuses before building the plugin list"), but the document says nothing about it                                                                                                   |
| packages/nx/AGENTS.md, "Commands"                                | Three commands are listed — `db:generate`, `db:migrate`, `db:studio`                                                                                                                      | There are **six** inferred targets: also `build`, `pack` and `nx-release-publish`. They are described further down the document, but not in the "Commands" section, which is where a person looks first                                                                                                                                                                                  |
| nx.json → plugins                                                | `@nx/js/typescript` is configured with `build: { targetName: "build", configName: "tsconfig.lib.json" }`                                                                                  | That setting infers nothing: the workspace manifests point at source, so `@nx/js` does not infer `build` here at all — `@ortha/nx` does. The configuration looks live but is inert, and reading `nx.json` leaves the impression of two sources for one target                                                                                                                         |

<details>
<summary>Why the numbers in this artifact were counted rather than copied</summary>

Every quantitative claim above comes from enumerating the working tree at the time of writing: 12 `drizzle.config.ts` files outside `node_modules`; 1 `ortha.config.ts` outside the ignored templates; 60 manifests under `packages/*` and `packages/*/*` without `private: true`; 4 entries in `executors.json`; 6 targets in `createNodesV2`; 127 `it(...)` cases across the package's eleven spec files. Re-counted 2026-09-05: every figure in this paragraph had drifted, which is the argument for counting them rather than quoting them. Where the documentation claimed otherwise, the discrepancy went into the table above rather than being bent to fit the document.

</details>

---

**A dossier of the build plugin.** Written from the `packages/nx` group in the series' common frame: business description → composition → target catalogue → the inference mechanism → loading TypeScript → flows → the release → configuration → invariants → checklist → boundaries → discrepancies. The sections this package does not have by nature (data model, HTTP API, admin screens, permissions) have been dropped: it owns not one table, serves not one route, and has no user interface.

The source is the source code: `src/index.ts`, the four executors with their option schemas, `src/lib/jiti.ts`, the three `src/lib/release/` modules and the eight spec files beside them; plus the root `nx.json`, `.nxignore`, `docs/releasing.md`, `tools/release/{release,pack}.mjs` and the public API of `@ortha/cli`. The `AGENTS.md` files were used as a skeleton, but every claim was checked against the implementation — discrepancies went into section 12.
