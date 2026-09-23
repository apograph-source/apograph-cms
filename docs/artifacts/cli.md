# Ortha CMS CLI

_Package · packages/cli_

**The `orthacms` command — how an application installed from npm is built, run and migrated**

Everything needed to **operate** an Ortha CMS application used to live in `@orthacms/nx` — a private package that will never be published. An application installed from npm physically had no way to apply its own migrations. `@orthacms/cli` closes that hole and at the same time fixes a rule: **the monorepo and any generated application migrate through one and the same implementation**. Two implementations of "apply migrations in plugin order" are two chances to get the system's most destructive operation wrong.

- **6** commands
- **6** flags and options
- **9** paths in LAYOUT
- **9** public exports
- **4** dependencies
- **130** unit tests
- **1** required environment variable

## Contents

- [01. Business description](#01-business-description)
- [02. Composition and place in the system](#02-composition-and-place-in-the-system)
- [03. Command catalogue](#03-command-catalogue)
- [04. Step-by-step flows](#04-step-by-step-flows)
- [05. Internals: compile → read the config → act](#05-internals-compile-read-the-config-act)
- [06. Configuration and environment](#06-configuration-and-environment)
- [07. Diagnostics and errors](#07-diagnostics-and-errors)
- [08. Invariants](#08-invariants)
- [09. Testing checklist](#09-testing-checklist)
- [10. Boundaries: the CLI and @orthacms/nx](#10-boundaries-the-cli-and-orthacmsnx)
- [11. Discrepancies between the code and the documentation](#11-discrepancies-between-the-code-and-the-documentation)

## 01. Business description

Ortha CMS is distributed in two ways. Inside the monorepo a developer lives in Nx: `npx nx serve server`, `npx nx run server:db:migrate`. But the end product is an application a person creates with `npx create-orthacms-app my-cms`, made almost entirely of `@orthacms/*` packages installed from npm. Such an application has no Nx, no executors and no project graph — and needs a way to be built, run and migrated.

That way is `orthacms`. Six commands, which a generated application wraps in its own `npm run` scripts, so that the application's owner usually never types the word `orthacms` at all:

| What the application's owner does | What they type               | What is invoked         |
| --------------------------------- | ---------------------------- | ----------------------- |
| Develops                          | npm run dev                  | orthacms dev               |
| Builds a release                  | npm run build                | orthacms build             |
| Runs in production                | npm start                    | orthacms start             |
| Creates the database schema       | npm run migrate              | orthacms migrate           |
| Sets up their own content types   | npm run generate -- --name=… | orthacms generate --name=… |
| Inspects the data                 | npm run studio               | orthacms studio            |

### Why this is a separate package

- **Publishability.** `@orthacms/nx` is marked `private: true` and will never reach npm — it is tied to `@nx/devkit`, the project graph and the `nx.json` file. The `applyPluginMigrations` function was reachable only through an Nx executor, that is, only from inside the monorepo.
- **One implementation for two worlds.** The `db-migrate`, `db-generate` and `db-studio` executors in `@orthacms/nx` are thin adapters over the functions exported here. The same migration loop, the same refusal on an empty `DATABASE_URL`, the same warning on an unsafe Drizzle Studio bind.
- **Dullness as a product quality.** The CLI has no configuration file of its own and accepts no directory paths. An application's layout (`apps/server`, `apps/admin`, `dist/server`) is a **convention**. An application that may put its server anywhere needs a config describing where — and the CLI would have to read that before doing anything at all.

### Who sees it

#### The generated application's owner

The only real user. Meets the command through the `npm run` scripts and the README generated alongside the application. Reads the errors as sentences in human language rather than as stack traces.

#### An Ortha CMS developer

Never calls `orthacms` directly — they have Nx. But they execute the same logic: three Nx executors import functions from this package.

#### Deployment / CI

Production is exactly `orthacms build && orthacms start`, one process serving both the API and the admin UI from one origin. Migrations are a separate `orthacms migrate` step before the start.

### What the CLI is not

- **It is not a build tool.** Compilation is the application's own `tsc`, and the admin build its own `vite`. The CLI only finds them and runs them with the right arguments.
- **It is not a migration manager.** Generation is done by `drizzle-kit` and application by `drizzle-orm`. The CLI owns the **order** and the **error messages**.
- **It is not a server.** `orthacms start` runs the already compiled `main.js` with plain `node` and dies with it.
- **It is not a project generator.** Creating an application is `create-orthacms-app`. The CLI appears in an application as a `devDependency` afterwards.
- **It is not a bundler.** Deliberately: see invariant I-11.

> **The key idea**
>
> **Compile first — then read JavaScript.** To apply migrations you have to know the plugin list, and that is declared in one of the application's TypeScript files. The monorepo reads that TypeScript on the fly and pays for it with `jiti` plus an `swc` transform hook configured for legacy decorators. A generated application has a build step of its own — so it can simply build and `require` the JavaScript. The whole transform problem **ceases to exist** on the consumer's side.

## 02. Composition and place in the system

The package is flat (`packages/cli` rather than an `admin`/`server` group) and **CommonJS** — no `"type": "module"`, so `require` and `__dirname` are available and `import.meta` is not. That is not a matter of style: both `require` and `__dirname` are load-bearing here (see section 5).

| File                   | Role                                                                                                   | The key decision inside                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| src/cli.ts             | The `orthacms` binary's entry point: argv parsing, the help text, the command dispatcher, one error catch | Prints a **message** rather than a stack; `process.exit(1)`                                      |
| src/index.ts           | The package's public API — what `@orthacms/nx` imports                                                 | 9 exports; they are what makes the implementation shared                                         |
| src/lib/project.ts     | `LAYOUT` (9 paths), `findProjectRoot`, `loadHost`, `requireDatabaseUrl`                                | The layout is a convention, not configuration                                                    |
| src/lib/env.ts         | `loadEnv` — the only place that reads `.env`                                                           | `process.loadEnvFile` does not overwrite what was already exported                               |
| src/lib/run.ts         | Running child processes: `resolveBin`, `tscBin`, `viteBin`, `spawnNode`, `run`, `superviseUntilExit`   | A binary is looked up in the **application's** `node_modules` through the manifest's `bin` field |
| src/lib/migrate.ts     | `applyPluginMigrations`, `describeTarget` — the plugin loop and the refusal text                       | The plugin order is preserved verbatim; nothing is rolled back                                   |
| src/lib/generate.ts    | `runDrizzleKitGenerate` — the call into `drizzle-kit generate`                                         | The migration name goes as a single argv element, with no shell                                  |
| src/lib/studio.ts      | `runDrizzleKitStudio` plus the unsafe-bind warning                                                     | An ephemeral config in a temporary directory; the credential never reaches the disk              |
| src/lib/commands/\*.ts | Six thin adapters from argv to the functions in `src/lib`                                              | They contain almost no logic at all                                                              |

### The dependencies — four, and all of them required

| Package                    | What for                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| @orthacms/bootstrap-server | Only for the `ServerPlugin` type — the `migrations: { dir(), table }` descriptor is read from it |
| drizzle-kit                | `generate` and `studio`; the binary is looked up as `bin.cjs` next to the package's main entry   |
| drizzle-orm                | `drizzle()` + `migrate()` from `node-postgres` — applying migrations                             |
| pg                         | The one `Pool` that `migrate` opens, and closes                                                  |

**What is not among the dependencies**, and it matters: no `jiti`, no `@swc/core`, no `@nx/devkit`, no `typescript` and no `vite`. The last two must come from the application — compiling somebody else's application with a TypeScript version npm happened to hoist next to the CLI is not acceptable.

### The public API (what `@orthacms/nx` imports)

| Export                | Who uses it                                                                                    | What it does                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| applyPluginMigrations | the `db-migrate` executor, the `migrate` command, a generated application's `server-e2e` suite | Applies each plugin's migrations in list order                           |
| describeTarget        | `applyPluginMigrations`                                                                        | `host:port/database` without credentials                                 |
| runDrizzleKitGenerate | the `db-generate` executor, the `generate` command                                             | Runs `drizzle-kit generate` in a given `cwd`                             |
| runDrizzleKitStudio   | the `db-studio` executor, the `studio` command                                                 | Runs Drizzle Studio through an ephemeral config                          |
| loadEnv               | the CLI only (Nx loads `.env` itself)                                                          | Reads the application's `.env`                                           |
| findProjectRoot       | the CLI                                                                                        | The nearest ancestor with a `package.json`                               |
| loadHost              | the CLI                                                                                        | Reads the **compiled** config and plugin factory                         |
| requireDatabaseUrl    | the CLI                                                                                        | A refusal on an empty URL rather than a fall through to libpq's defaults |
| LAYOUT                | the CLI                                                                                        | Nine paths — the whole of an application's "configuration"               |

> **The binary in the manifest points at TypeScript**
>
> In the repository `package.json` declares `"bin": { "orthacms": "./src/cli.ts" }` — because every workspace package resolves **from source**. The published tarball fixes it: the `tools/release/pack.mjs` script rewrites the manifest and remaps `bin` exactly as it does `main` (to `./dist/…js`), then checks that the file named in `bin` really was built. The consequence: **inside the monorepo the `orthacms` command as such does not work** — Nx plays its role there.

### How the package reaches a user

Between what sits in the repository and what a person installs from npm there is a step without which `orthacms` would simply not start. Every workspace package resolves **from source**: their `exports` point at `./src/index.ts` and `tsconfig.base.json` supplies the `@orthacms/source` condition. A consumer cannot do that — they have neither the condition nor a compiler at runtime.

1. **The build.** The `build` target compiles the package through `tsconfig.lib.json`, emitting JS and `.d.ts`.
2. **Staging.** The `pack` target assembles the publishable root under `dist/pack/packages/cli` with a **rewritten** manifest: `main`, `types`, `exports` and `bin` are moved from `./src/*.ts` to `./dist/*.js`, and dependencies on workspace packages (`"*"`) are pinned to the version being released.
   _this is where bin.orthacms stops pointing at TypeScript_
3. **The check.** Staging refuses to assemble a tarball whose manifest names a file the build never emitted — and `bin` is the most important name on that list: a tarball with a non-existent binary installs successfully and fails on the first invocation of the command.
4. **Publishing.** Every package is released as one set, in lockstep. The publishes are serialised with a gap and retries: npm limits write frequency, and one run releases dozens of tarballs.

A practical consequence for debugging follows: `orthacms` "as a user sees it" can only be observed on a built tarball, not in a monorepo checkout.

## 03. Command catalogue

Six commands plus the help. The argv parsing fits into two functions: `option()` reads `--flag=value` or `--flag value`, and `flag()` answers "is there a bare `--flag`". No argument-parsing library, no subcommands, no interactivity.

```
orthacms — the Ortha CMS command line

Usage: orthacms <command> [options]

Commands:
  dev                    Run the API and admin dev servers together
  build                  Compile the server and build the admin bundle
  start                  Run the built server
  migrate                Apply every plugin's pending migrations
  generate [--name=<n>]  Generate a migration for this app's content tables
  studio [--host --port] Open Drizzle Studio on this app's database

Options:
  --server               build/dev: the server only, skipping the admin
  --admin                build: the admin bundle only
  -h, --help             Show this message
```

### 3.1 The summary table

| Command      | What it does                                                                                                                                       | Flags and options                                             | What it needs                                                                                                                               | Exit code                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| dev          | A one-shot server build, then three watch processes in one terminal: `tsc --watch`, `node --watch dist/server/src/main.js` and the Vite dev server | —<br>(`--server` is declared but never read — see section 11) | `typescript` and `vite` in the application's `node_modules`; `apps/server/tsconfig.json`; a live database, because the server really starts | 0 on Ctrl+C; 1 if the build fails   |
| build        | `tsc -p apps/server/tsconfig.json`, then `vite build --config apps/admin/vite.config.mts`                                                          | --server<br>--admin                                           | `typescript`; for the admin build, `vite` and the presence of `apps/admin/index.html`                                                       | 0 / 1                               |
| start        | Runs `node dist/server/src/main.js` — one process serving the API and (through the config's `staticDir`) the built admin UI                        | —                                                             | The application is already built; `DATABASE_URL` and the other variables are read by the application itself, not by the CLI                 | 0 on Ctrl+C; 1 if `dist` is missing |
| migrate      | Builds the server (`--server`), reads the compiled config and plugin list, and applies each plugin's migrations in list order                      | —                                                             | `DATABASE_URL`; a reachable database; `dist/server/orthacms.config.js` and `dist/server/src/plugins.js` (created by the command itself)        | 0 / 1                               |
| generate     | Runs `drizzle-kit generate` against `apps/server/drizzle.config.ts` — a migration for the application's **own** content tables                     | --name=\<n>                                                   | The presence of `apps/server/drizzle.config.ts`. **No database needed**: generation only diffs the schema against a snapshot                | 0 / 1                               |
| studio       | Builds the server, takes the URL from the config and starts Drizzle Studio through an ephemeral config in a temporary directory                    | --host=\<h><br>--port=\<p>                                    | `DATABASE_URL`; a reachable database; a built config                                                                                        | 0 on Ctrl+C; 1 on a refusal         |
| (no command) | Prints the help                                                                                                                                    | -h, --help                                                    | —                                                                                                                                           | 0                                   |
| (unknown)    | An `Unknown command "…"` message plus the help                                                                                                     | —                                                             | —                                                                                                                                           | 1                                   |

> **There are exactly two exit codes**
>
> `0` — success, including a **deliberate** Ctrl+C exit for `dev`, `start` and `studio`. `1` — any failure: an unknown command (through `process.exitCode = 1`) or a thrown exception caught in `main().catch` (through `process.exit(1)`). A child process's exit code is **not** propagated: a `tsc` that failed with code 2 becomes an `Error("tsc exited with code 2")` and leaves as a one.

### 3.2 `orthacms dev`

Three processes joined by the `superviseUntilExit` supervisor. The order is mandatory: **the one-shot server build first**, and only then the watch processes.

```
orthacms dev
  1. buildCommand(root, { serverOnly: true })          # dist/ is guaranteed to exist
  2. node <tsc> -p apps/server/tsconfig.json --watch --preserveWatchOutput
  3. node --watch dist/server/src/main.js
  4. node <vite> --config apps/admin/vite.config.mts   # only if apps/admin/index.html exists
```

- **`--preserveWatchOutput`** — otherwise `tsc` clears the screen on every recompile and wipes the Nest logs living in the same terminal.
- **`--watch` is passed as a `node` flag rather than a script argument.** That is why `spawnNode` takes one whole argv array: split into "script + arguments", the flag would go to the script, the process would start once and watch nothing.
- **Termination takes everyone with it.** Without that, leaving `dev` orphans a `node --watch` still holding the API port — and the next `orthacms dev` fails on a busy port, blaming a process the user cannot see.

> **Why the one-shot build is mandatory**
>
> `node --watch` **cannot recover from a missing entry point**. Given a path to a file that does not exist yet, it stays alive, watches nothing and never loads. From the outside that looks not like "we started a second too early" but like a **hung server**. The monorepo solves the same problem with a separate `dev:prebuild` target.

### 3.3 `orthacms build`

| Invocation                   | Server                            | Admin                                  |
| ---------------------------- | --------------------------------- | -------------------------------------- |
| orthacms build                  | yes                               | yes, if `apps/admin/index.html` exists |
| orthacms build --server         | yes                               | no                                     |
| orthacms build --admin          | no                                | yes                                    |
| orthacms build --server --admin | refused: it asks for neither half |                                        |

The last row used to be a consequence of the check order rather than a design — `adminOnly` skipped `tsc`, then `serverOnly` returned early before Vite, so both flags together gave a command that did nothing and exited zero. `halves()` now refuses the pair for `dev` and `build` alike. The same two flags narrow `orthacms dev` to one half.

A missing `apps/admin/index.html` is **not an error** but a sign that "this application has no UI": the command prints `No apps/admin/index.html — skipping the admin build.` and exits successfully. Vite is invoked with an explicit `--config`, because the config sits inside the application being built: Vite looks for a config in the working directory and would otherwise build a bundle with defaults from the wrong root — silently.

### 3.4 `orthacms start`

The shortest command in the package: check that `dist/server/src/main.js` exists, and run it. No building — if the file is missing, that is a refusal reading ``… does not exist — run `orthacms build` first.`` Production is literally `orthacms build && orthacms start`: one process, one origin, the API and the admin UI together.

### 3.5 `orthacms migrate`

The only command whose input is **the application's own TypeScript**: the plugin list and the order it is written in. So it builds the server itself rather than relying on somebody having built it earlier.

```
Applying migrations for 12 plugin(s) to localhost:5432/orthacms
Applying migrations: database → __drizzle_migrations_database
Applying migrations: identity → __drizzle_migrations_identity
Applying migrations: workspaces → __drizzle_migrations_workspaces
…
Migrations complete.
```

- Plugins **without** a `migrations` descriptor are filtered out up front. If none is left, it prints `No plugin migrations to apply.` and **opens no connection at all**.
- Each plugin keeps its own history table (`migrations.table`), so plugins are versioned independently. A plugin from source and a plugin installed from npm take the same path — each merely declares its own `migrations.dir()`.
- The destination line carries no credentials: `describeTarget` assembles `host:port/database`, and a URL that will not parse honestly calls itself `(unparseable DATABASE_URL)` rather than guessing.

### 3.6 `orthacms generate`

This is **only** about the schema the application itself defines. Plugins carry their migrations inside their tarballs, and there is nothing to generate for them. Hence the requirement for an `apps/server/drizzle.config.ts`, which a freshly created application does not have: the first run of this command is the moment the `migrations/` folder appears.

```
orthacms generate --name=add_content_types
  → node <drizzle-kit>/bin.cjs generate --config=apps/server/drizzle.config.ts --name=add_content_types
     cwd = <the application's root>, stdio = inherit
```

Without `--name` the flag is **not added at all** — drizzle-kit picks the name itself. The name is passed as one literal argv element with no shell, so `--name="a b; rm -rf /"` is simply a long migration name rather than a command.

### 3.7 `orthacms studio`

Drizzle Studio reads its connection from the config's `dbCredentials`, but every committed drizzle config is deliberately schema-only — there are no secrets in them. So the CLI synthesises an **ephemeral** config in a temporary directory:

```
export default {
    dialect: 'postgresql',
    dbCredentials: { url: process.env.DATABASE_URL }
};
```

The config references the variable rather than inlining the URL; the URL itself goes into the child process's environment. **The credential never touches the disk for a moment**, and the temporary directory is removed in a `finally`. No schema is needed: Studio introspects the live database and derives the relations from the foreign keys.

> **The danger of one flag**
>
> Studio is an **unauthenticated** browser with full read and write access to everything `DATABASE_URL` points at. Bound to loopback it is a local tool; bound to anything else it is a database console exposed to the network, and drizzle-kit says nothing about the difference. So a `--host` outside `{localhost, 127.0.0.1, ::1, [::1]}` prints an explicit warning naming the address before the start.

### 3.8 Argument parsing — what the CLI actually understands

There is no argument-parsing library here. There are two five-line functions, and their behaviour is worth knowing precisely, because it determines every edge case.

| Form            | How it is parsed                                                 | Note                                                                |
| --------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| --name=add_x    | The value is everything after the first `=`                      | The preferred form; always works                                    |
| --name add_x    | The value is the next argv element, unless it starts with `-`    | Works                                                               |
| --name --port 1 | The value is **not** picked up: the next element starts with `-` | The option counts as unset, with no warning                         |
| --name          | At the end of argv there is no value                             | The same: silently unset                                            |
| --server        | `flag()` — a plain string membership test on argv                | Any value after it is ignored                                       |
| --port=abc      | `numberOption()` — a whole-number test on the raw string         | A message naming the value; nothing runs                            |
| --port=0        | Carried through the parse, refused by `runDrizzleKitStudio`      | A message naming the reason, from the CLI and the Nx executor alike |
| extra arguments | Ignored entirely                                                 | A typo in a flag is never diagnosed                                 |

The trade-off is deliberate: six commands with six options do not justify a dependency on an argv parser, and a word that is not understood means, at worst, "did something other than what was asked" — never "did something destructive". The one place where that stung was `studio --port`, where a mistyped or zero port became the default in silence; that check now lives in `runDrizzleKitStudio`, which `@orthacms/nx` calls too. An unknown _word_ is still ignored.

## 04. Step-by-step flows

### 4.1 The first run of an installed application

What a person does immediately after `npx create-orthacms-app my-cms`. The generated README reduces it to three lines; below is what actually happens.

1. **Postgres comes up.** `docker compose up -d` — the `docker-compose.yml` is part of the application template.
   _the CLI takes no part in this_
2. **`npm run migrate` → `orthacms migrate`.** First `findProjectRoot()` walks up from the current directory to the nearest `package.json`. Then `loadEnv(root)` reads `.env` — and that happens **before** any command, so that `orthacms.config.ts` finds its settings and the child processes inherit the variables.
   _a missing .env is normal, not a warning_
3. **The server is built.** `tsc -p apps/server/tsconfig.json` → `dist/server/`. The compilation is incremental and costs about a second.
4. **The compiled host is read.** `require('dist/server/orthacms.config.js').default` and `require('dist/server/src/plugins.js').buildPlugins(config)`. Both absences and both "wrong export shapes" have messages of their own.
5. **The database URL is checked.** `requireDatabaseUrl(config)` refuses to work with an empty value — a silent fall through to local defaults is forbidden.
6. **Every plugin's migrations are applied** in the order `buildPlugins` returned. Each into its own history table.
   _one pg.Pool connection for the whole run, closed in a finally_
7. **`npm run dev` → `orthacms dev`.** The API on `:3000`, the admin UI on `:4200`.
8. **The first sign-in.** The administrator's account is provisioned at startup from `ORTHACMS_ROOT_ADMIN_EMAIL` / `ORTHACMS_ROOT_ADMIN_PASSWORD` — that is the identity plugin's doing, not the CLI's. But it is `loadEnv` that gets the variables to it.

### 4.2 Applying migrations after a package update

1. **The `@orthacms/*` versions are raised in lockstep.** The packages are released as one set; a partial update can leave two copies of a shared package in `node_modules`.
2. **`orthacms migrate`.** Rebuilding the server here is not a formality: **a stale `dist/` would silently migrate against the previous composition** — a plugin added an hour ago would simply not get its tables, and nobody would say so.
3. **Each plugin applies only what it has not applied.** The history tables are separate, so a new plugin catches up from zero and the old ones are untouched.
4. **If something fails, the run stops.** The plugins that ran before the failing one are **committed**: there is no rollback, and each plugin commits as it goes. The message says how many of how many made it.
   _a re-run resumes from the plugin that failed_

> **The plugin order is load-bearing**
>
> One plugin's tables reference another's by foreign key (workspaces' `memberships` references identity's `users`). **That dependency is declared nowhere.** The only guarantee is that the loop applies plugins in exactly the host list's order. So on a "relation … does not exist" error the refusal text points at the order in `plugins.ts` as the most likely cause.

### 4.3 Generating a migration for your own content types

1. **Describe the content types** and gather them into a `contentTypes` array.
2. **Pass them into `ContentPlugin({ types, migrations })`** in `apps/server/src/plugins.ts`. The `migrations` descriptor is what `orthacms migrate` will latch onto.
3. **Add an `apps/server/drizzle.config.ts`** with `schema` and `out` paths. Without it `orthacms generate` refuses to run and explains what is missing.
   _paths in the config resolve against the cwd rather than against the config itself — see section 11_
4. **`orthacms generate --name=add_content_types`.** drizzle-kit diffs the schema against the snapshot in `migrations/meta/` and writes the SQL. **No database is required** — which is why there are no secrets in the config.
5. **`orthacms migrate`.** The generated SQL is applied through the same shared loop as every plugin's migrations.
6. **The SQL is committed into the application's repository.** Just as plugins commit theirs.

### 4.4 A production build and start

1. **`orthacms build`.** `tsc` compiles the server into `dist/server` and Vite builds the admin UI into `dist/admin`. **Nothing is bundled.**
2. **`orthacms migrate` in the deployment window.** As a separate step, before the new process starts — migrations are not tied to the application booting.
3. **`orthacms start`.** A check that `dist/server/src/main.js` exists, then `node` on it. The process serves the API and, through the config's `staticDir`, the built admin UI — **one process, one origin**.
4. **The variables come from the environment rather than from a file.** A `.env` in the image is not required, and if one ends up there it will not overwrite already exported variables.
   _that is the priority a deployment needs_
5. **Stopping.** SIGTERM/SIGINT for `run()` is a success rather than a failure: exit code 0.

> **Why the build is not bundled**
>
> Every Ortha CMS plugin finds its migrations as `join(__dirname, '../../../migrations')` — a path leading to the root of its own package inside `node_modules`. A bundler that flattens those files into one breaks that lookup. The monorepo uses webpack only because it has to inline packages consumed **from source**; an installed application has no such problem, so it leaves `node_modules` alone.

## 05. Internals: compile → read the config → act

Three of the six commands (`migrate`, `studio` and indirectly `dev`) go through one and the same pipeline. It is worth taking apart in full, because it explains why this package does not need the machinery `@orthacms/nx` cannot do without.

### 5.1 The "find the root" step

`findProjectRoot()` walks up from `process.cwd()` to the nearest directory holding a `package.json`. Not "trust the current directory" but specifically walking up: `orthacms migrate` has to work from a subdirectory, because that is where it is run from. Everything else resolves against the root it found, so the application's relative paths (`migrations/`, `dist/`) mean the same thing wherever the command was typed. If there is no `package.json` anywhere up the tree, it refuses with "run this inside an Ortha CMS app".

### 5.2 The "read `.env`" step

`loadEnv(root)` is called exactly once, in `main()`, before the command dispatcher. The implementation is three lines over `process.loadEnvFile`, but each carries a decision:

- **A missing file is normal**, not something to warn about: a deployment sets real environment variables and writes no such file at all.
- **Already exported values are not overwritten.** Real environments set configuration in the environment, and a `.env` that accidentally rode into the image must not beat it.
- **Node ≥ 20.12 is required.** An older version gets a message of its own naming its `process.version`, rather than `TypeError: process.loadEnvFile is not a function`.
- **The moment of the call matters.** The values have to reach `process.env` before `node`, `vite` and `drizzle-kit` are spawned — they inherit the parent's environment.

### 5.3 The "compile" step

A command that needs the plugin list **builds the server first** and only then reads the result. That looks like an extra step and in fact removes a whole class of problems.

| Aspect        | `@orthacms/nx` (the monorepo)                                          | `@orthacms/cli` (an installed application)                                      |
| ------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| What is read  | `apps/server/orthacms.config.ts` and `src/plugins.ts` — **TypeScript**    | `dist/server/orthacms.config.js` and `dist/server/src/plugins.js` — **JavaScript** |
| What reads it | `jiti` plus an `@swc/core` transform hook                              | an ordinary `createRequire()`                                                   |
| Why           | Nx works against source; there is no build step before the target      | the application has a build step of its own, and it is needed anyway            |
| The cost      | 2 extra dependencies (`jiti`, `@swc/core`) and decorator configuration | ~1 second of incremental compilation                                            |

Why "just jiti" is not enough for the monorepo: loading `orthacms.config.ts` or `buildPlugins` drags in the whole plugin graph — NestJS modules and their DTOs — and that graph uses **legacy decorators** (`experimentalDecorators`). The babel built into jiti ignores the repository's tsconfig and defaults to stage-3 decorator semantics: a field with a definite assignment under a decorator (`email!: string`) gets an initializer, and `transform-typescript` fails. So `@orthacms/nx` holds `createTsJiti` — jiti with an swc transform in `legacyDecorator` + `decoratorMetadata` mode, so that the same source is read the way the application itself compiles it.

> **What follows from this**
>
> Three consequences, all three in the consumer's favour. **First:** `jiti` and `@swc/core` stay dependencies of `@orthacms/nx` and never reach an installed application's tree. **Second:** a whole class of "the config is read by one compiler while the application is built by another" divergences disappears — what is read is exactly the JavaScript that will later run. **Third:** a stale `dist/` stops being a possible source of a silent error, because the command builds it itself.

### 5.4 The "read the config" step — why `require` rather than `await import()`

The application compiles to CommonJS. Importing a CommonJS module from ESM puts the **entire** `module.exports` into the namespace's `default` — so `module.default` turns out to be `{ default: config }` rather than the config itself. The very first field access fails with `Cannot read properties of undefined`, and the message says nothing about interop: the user sees an error that names nothing. `require` returns `module.exports` as is, and that ambiguity never arises. `createRequire` is built from the application's `package.json` so that resolution happens in its tree.

`loadHost` checks four things and gives each its own message:

| Check                            | Message                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| No `dist/server/orthacms.config.js` | … does not exist — the app has not been built. Run \`orthacms build\` first (\`orthacms migrate\` does this for you). |
| No `dist/server/src/plugins.js`  | the same message with a different path                                                                          |
| The config has no default export | … has no default export — orthacms.config.ts must \`export default\` the app's config.                             |
| `plugins.js` exports no function | … does not export buildPlugins(config).                                                                         |

### 5.5 The “action” step — where the binaries come from

`resolveBin` solves two problems at once.

- **Resolution from the application, not from the CLI.** `orthacms` is installed inside the application it builds, so the `typescript` and `vite` that must run are the ones the application declared. Resolving from the CLI's own tree would mean compiling someone else's application with whatever version npm happened to hoist next door.
- **Through the manifest, not by guessing a path.** A deep specifier such as `vite/bin/vite.js` resolves only if the package exports that subpath — and Vite does not export it, so the attempt fails with `Package subpath './bin/vite.js' is not defined by "exports"`. Both packages do export `package.json`, and its `bin` field is the authoritative answer: it is exactly what npm links.

With `drizzle-kit` the same story is resolved differently: its `exports` map also blocks direct access to `./bin.cjs`, so the CLI resolves the package's main entry and takes the neighbouring `bin.cjs` — `join(dirname(require.resolve('drizzle-kit')), 'bin.cjs')`.

<details>
<summary>Application layout: nine paths, zero settings</summary>

`LAYOUT` in `src/lib/project.ts` is the CLI's entire “config”: `apps/server/tsconfig.json`, `apps/admin/vite.config.mts`, `apps/admin/index.html`, `dist/server`, `dist/admin`, `dist/server/src/main.js`, `dist/server/orthacms.config.js`, `dist/server/src/plugins.js`, `apps/server/drizzle.config.ts`. The layout mirrors Ortha CMS's own `apps/` folder (`server`, `admin`, `server-e2e`, `admin-e2e`), so that someone who has read the Ortha CMS sources finds the same shape in their own project.

The compiled paths follow from `apps/server/tsconfig.json` setting `rootDir: "."` and `outDir: "../../dist/server"`: `apps/server/orthacms.config.ts` → `dist/server/orthacms.config.js`, `apps/server/src/main.ts` → `dist/server/src/main.js`. Change `rootDir` without changing `LAYOUT` and the paths stop resolving: `orthacms start` will then report a missing entry point rather than an incorrect setting.

</details>

### 5.6 Supervising child processes

Three functions in `src/lib/run.ts` share all the process work between them, and the difference between them is the difference between “wait for a result” and “live as long as they live”.

| Function                     | Who uses it      | Semantics                                                                                                                                                               |
| ---------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| spawnNode(argv, root, env)   | everyone         | Spawns `node` with inherited stdio and environment. Takes **one** whole argv array, including `node`'s own flags                                                        |
| run(argv, root, env)         | `build`, `start` | Waits for completion. A non-zero code → `Error("<label> exited with code N")`, where label is the basename of the first non-flag argument. `SIGINT`/`SIGTERM` → success |
| superviseUntilExit(children) | `dev`            | Lives as long as they all live. An exit or error from any child, or a signal to the parent → `SIGTERM` to all the others, exactly once                                  |

Two details in `superviseUntilExit` carry weight. The `settling` flag makes shutdown happen once: without it, three children exiting in a row would trigger cleanup three times and try to resolve an already-resolved promise. The `exitCode === null && signalCode === null` check means “only signal the ones still alive” — the child whose own exit triggered the cleanup does not get hit a second time.

> **Why this matters at all**
>
> Without cleanup, quitting `orthacms dev` leaves orphaned `tsc --watch` and `node --watch` processes behind, and the second one keeps holding the API port. The next `orthacms dev` fails with “port in use”, and the culprit is a process the user cannot see and did not start in this session. Debugging that costs incomparably more time than the handler itself is worth.

## 06. Configuration and environment

The CLI has no settings file of its own. Everything it knows about the application falls into two parts: **path conventions** (`LAYOUT`, section 5) and **environment variables**, which it merely carries through to whoever reads them.

### 6.1 What the CLI itself reads

| Source                | Who reads it                                                                        | Behaviour                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| \<root>/.env          | `loadEnv` — the only reader in the whole system on the installed application's side | Missing → silently skipped. Does not overwrite already-exported variables                        |
| DATABASE_URL          | indirectly: through `config.database.url` in `orthacms.config.ts`                      | The only variable whose absence the CLI turns into a refusal of its own (`requireDatabaseUrl`)   |
| process.env (in full) | `spawnNode` / `run` / `execFileSync`                                                | Inherited by every child process; `studio` additionally puts the resolved `DATABASE_URL` into it |
| process.version       | `loadEnv`                                                                           | Checks for the presence of `process.loadEnvFile` (Node ≥ 20.12)                                  |

> **One door to process.env**
>
> In a generated application, `apps/server/orthacms.config.ts` is declared the **single place that reads `process.env`**: everything downstream — the host and every plugin — receives already-typed values. The CLI upholds that rule rather than breaking it: it does not parse `DATABASE_URL` itself, it takes `config.database?.url` from the loaded config. That is why “where did this setting come from” has exactly one answer.

### 6.2 What the application owner sets (the `.env` template)

These variables are read by `orthacms.config.ts` and the plugins, but it is `loadEnv` that carries them into the process. The list depends on which capabilities were chosen in the `create-orthacms-app` wizard; below are the ones that are always there.

| Variable                            | Purpose                                                                                                                         | Required?                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| DATABASE_URL                        | PostgreSQL connection string                                                                                                    | **Required.** Without it `migrate` and `studio` refuse to run                            |
| PORT                                | The API port; `orthacms start` serves the admin UI from the same one                                                               | Defaults to 3000                                                                         |
| ADMIN_PORT                          | The Vite dev server's port (development only)                                                                                   | Defaults to 4200                                                                         |
| NODE_ENV                            | `production` must be spelled exactly so: any other value drops `Secure` from the session cookie and publishes the API reference | Required in production                                                                   |
| TRUST_PROXY                         | The number of reverse proxies in front of the application                                                                       | Required behind a load balancer, otherwise the rate limit collapses into a single bucket |
| API_DOCS                            | Whether to serve the API reference at `/reference`                                                                              | Optional                                                                                 |
| MAX_REQUEST_BODY                    | Maximum JSON request size                                                                                                       | Defaults to 1mb                                                                          |
| ORTHACMS_ROOT_ADMIN_EMAIL / \_PASSWORD | Provisioning the first administrator account at startup                                                                         | Needed for the first sign-in, then cleared                                               |

Plus the groups that appear depending on the wizard's choices: media storage (`MEDIA_*`), copilot (`COPILOT_*`, `ANTHROPIC_API_KEY`), MCP (`MCP_*`), single sign-on (`SSO_*`). The CLI interprets none of them — it only carries them.

### 6.3 The link to the generated application

`@orthacms/cli` lands in a new application not as a choice but as a constant: it is listed in the generator's `CORE_DEV_PACKAGES` and is always written into `devDependencies` with the version stamped in by `create-orthacms-app` itself. The `package.json` template wraps six commands in scripts right away, so the application owner usually interacts with the CLI only through `npm run`.

```
"scripts": {
    "dev": "orthacms dev",
    "build": "orthacms build",
    "start": "orthacms start",
    "migrate": "orthacms migrate",
    "generate": "orthacms generate",
    "studio": "orthacms studio",
    …
}
```

There is a seventh consumer too, already inside the application itself: the `apps/server-e2e` suite creates and migrates its own `<database>_e2e` database with the **same** `applyPluginMigrations` function that `orthacms migrate` calls. That means the schema the e2e tests run against is the real one, not a separately maintained copy.

## 07. Diagnostics and errors

The philosophy of the messages is set in one place — the handler at the bottom of `src/cli.ts`:

```
main().catch((error: unknown) => {
    // The message, not the stack. Every throw reaching here is a condition the
    // user can act on — an unbuilt app, a missing DATABASE_URL, a failed
    // migration naming the plugin — and a stack trace buries the sentence that
    // says which.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
```

### 7.1 What the user sees on typical failures

| Situation                                                                     | What is shown                                                                                                                                                                                                           | Where it is decided        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| The command was run outside an application                                    | No package.json in /home/user or any parent directory — run this inside an Ortha CMS app.                                                                                                                                   | findProjectRoot            |
| The application is not built and `start` was run                              | dist/server/src/main.js does not exist — run \`orthacms build\` first.                                                                                                                                                     | commands/start             |
| The application is not built and `studio` was run with someone else's `dist/` | … does not exist — the app has not been built. Run \`orthacms build\` first (\`orthacms migrate\` does this for you).                                                                                                         | loadHost                   |
| A TypeScript compilation error                                                | The full `tsc` output (stdio is inherited), then one line: `tsc exited with code 2`                                                                                                                                     | run()                      |
| `orthacms.config.ts` without `export default`                                    | dist/server/orthacms.config.js has no default export — orthacms.config.ts must \`export default\` the app's config.                                                                                                           | loadHost                   |
| `plugins.ts` without `buildPlugins`                                           | dist/server/src/plugins.js does not export buildPlugins(config).                                                                                                                                                        | loadHost                   |
| `DATABASE_URL` is unset or empty                                              | DATABASE_URL is not set — migrating needs to know which database to change, and will not fall back to the local defaults. Set it in your .env and try again.                                                            | requireDatabaseUrl         |
| The database is unreachable (container not up, wrong port)                    | The `pg` driver's error as it is — `ECONNREFUSED …`. The CLI does not rephrase it, but it has already printed the line `Applying migrations for N plugin(s) to host:port/db`, which shows exactly where it was knocking | pg / applyPluginMigrations |
| A plugin's migration failed                                                   | A detailed message: which plugin, how many of how many are already committed, that no rollback is performed, and that the first thing to check is the order in `plugins.ts`. The original error is preserved in `cause` | migrationFailure           |
| No `apps/server/drizzle.config.ts`                                            | No apps/server/drizzle.config.ts in \<root>. It describes the content tables this app defines — add one (plus the content types it points at) before generating a migration.                                            | commands/generate          |
| `drizzle-kit generate` returned a non-zero code                               | drizzle-kit's own output above, then ``drizzle-kit generate failed in <cwd> (exit 1) — its output is above. Check …'s `schema` paths and that the schema files compile.``                                               | runDrizzleKitGenerate      |
| `typescript` / `vite` are not installed                                       | typescript declares no "tsc" binary — is it installed in \<root>?                                                                                                                                                       | resolveBin                 |
| Node older than 20.12 with a `.env` present                                   | Reading .env needs Node 20.12 or newer (process.loadEnvFile). You are on v18.x.x.                                                                                                                                       | loadEnv                    |
| `orthacms studio --host 0.0.0.0`                                                 | A multi-line warning about the absence of authentication and full write access — **before** Studio starts. Not a refusal: the command carries on                                                                        | warnIfExposed              |
| An unknown command                                                            | Unknown command "buld".                                                                                                                                                                                                 | cli.ts                     |

> **An empty DATABASE_URL is not “no big deal”**
>
> `new Pool({ connectionString: '' })` **does not fail**: it falls through to libpq's defaults — `PGHOST`/`PGDATABASE`, and in their absence to localhost and the OS user. This was measured in this repository before the check existed: with `DATABASE_URL` unset, the migration reported success, having created the whole schema in a database nobody had named. Hence the rule: **refuse, do not guess**. An identical check sits in the `db-migrate` executor.

> **Ctrl+C is a success**
>
> `dev`, `start` and `studio` are documented as being terminated by the user. `run()` recognises `SIGINT`/`SIGTERM` and resolves; `runDrizzleKitStudio` recognises the same thing in the `execFileSync` exception. The reason is human behaviour, not tidiness: reporting a documented exit as a failure teaches people to read red as noise.

### 7.2 What is left “raw”

- **Database connection errors** arrive from `pg` unprocessed. The line about the target, printed before connecting, only partly compensates.
- **The `tsc` and `vite` output** is not filtered — stdio is inherited whole. That is deliberate: their own messages are more useful than any retelling.
- **The migration error's `cause` is not printed.** The top-level handler prints only `error.message`, while the original `relation "users" does not exist` sits in `cause` and never reaches the outside — even though the text of the refusal directly assumes the reader knows about the missing relation.

## 08. Invariants

Statements that must always hold. This is at once a review checklist and a draft set of test assertions.

- **I-01** — **One implementation for two worlds.** The monorepo and any generated application apply migrations through the very same `applyPluginMigrations`; the Nx executors are thin adapters, not a second implementation.
- **I-02** — `migrate` and `studio` never run against a stale `dist/`: both build the server first, then read the compiled config.
- **I-03** — An empty or missing database URL is a **refusal**, not a fallback to libpq's local defaults.
- **I-04** — Plugins migrate in exactly the order `buildPlugins()` returned them. The order is never rearranged, sorted, or derived from dependencies.
- **I-05** — A plugin without a `migrations` descriptor is skipped; if there are no such plugins at all, **no connection is opened**.
- **I-06** — Every plugin is tracked in **its own** history table (`migrations.table`), so plugins are versioned independently.
- **I-07** — A migration failure names the plugin, the number already committed, the total, and points at the ordering as the likely cause; the original error is preserved in `cause`; plugins after the failing one are **not attempted**.
- **I-08** — The connection pool is closed on both success and failure (`finally`).
- **I-09** — No log contains credentials: the target is described as `host:port/database`, and an unparseable URL as `(unparseable DATABASE_URL)` rather than as a guess.
- **I-10** — The credential for Drizzle Studio is **never written to disk**: the ephemeral config references `process.env.DATABASE_URL`, the URL is passed through the child process's environment, and the temporary folder is removed in `finally`.
- **I-11** — Binding Studio to anything other than loopback prints a warning with the address **before** startup.
- **I-12** — The build **never bundles**: plugin migrations must remain files inside their packages in `node_modules`.
- **I-13** — `tsc` and `vite` are resolved from the **application's** `node_modules` and only through its manifest's `bin` field — not from the CLI's tree and not by guessing a subpath.
- **I-14** — `.env` does not overwrite already-exported environment variables; a missing file is neither an error nor a warning.
- **I-15** — `.env` is read once, before the command dispatcher, so that every spawned process inherits the values.
- **I-16** — `dev` populates `dist/` with a one-shot build **before** starting `node --watch`.
- **I-17** — Shutting `dev` down — by any child exiting or by a signal — takes all the others with it, exactly once (the `settling` flag).
- **I-18** — Termination by `SIGINT`/`SIGTERM` for `dev`, `start` and `studio` is a **success**, exit code 0.
- **I-19** — Any exception that reaches the top is printed as a single message line without a stack trace, and the process exits with code 1.
- **I-20** — `generate` **never connects to a database**: generation only compares the schema against a snapshot, which is why there are — and must be — no secrets in the drizzle configs.
- **I-21** — The migration name reaches drizzle-kit as a single literal argv element, with no shell involved: a hostile name is merely a strange name.
- **I-22** — The application layout is a convention (`LAYOUT`), not configuration: the CLI reads no settings file of its own.
- **I-23** — The compiled config is read through `require`, not `await import()` — otherwise `module.default` turns out to be a wrapper rather than the config.
- **I-24** — `findProjectRoot` walks up to the nearest `package.json`, so a command works from any subdirectory of the application.

## 09. Testing checklist

The wording is “action → expected result”, so items can go into a test case without rewriting. Existing automated coverage: **130** unit tests in fourteen files next to the code, mocking at the process boundary (`node:child_process`, `pg`), so the package is tested without a database. Run them with `npx nx test @orthacms/cli`. The gap this dossier first recorded — `cli.ts`, `project.ts`, `env.ts`, `run.ts` and all six commands untested — **is closed**: the dispatcher, the argv readers, the root walk, the `.env` load, the child-process helper and every command now have a spec beside them. What is still checked only by hand is this list against a real application.

### Argument parsing and help

- **`orthacms` with no arguments** → prints help, exit code 0.
- **`orthacms build --help`** → prints help and builds **nothing**, code 0.
- **`orthacms --help`, `orthacms -h` and `orthacms help`** → prints help, exit code 0, and without going looking for an application first. `wantsHelp` reads the **whole** argv rather than the arguments after the command, which is what keeps the flag out of the command position; the three forms and the precedence against `--version` are pinned by `args.spec.ts`.
- **`orthacms buld`** → `Unknown command "buld".`, help, code 1.
- **`orthacms generate --name add_x` (a space instead of `=`)** → the name is recognised exactly as in the `--name=add_x` form.
- **`orthacms generate --name --other`** → the name is not picked up (the value starts with `-`), drizzle-kit chooses a name itself.

### Finding the root and the environment

- **`orthacms migrate` from a subdirectory of the application** → works exactly as from the root; relative paths mean the same thing.
- **Running outside any application** → the “run this inside an Ortha CMS app” message, code 1.
- **No `.env`, variables set in the shell** → the command works; there is no warning.
- **`DATABASE_URL` set both in the shell and in `.env`, with different values** → the shell wins; the migration goes to the database named in the environment.
- **`.env` present, Node 18** → the message about Node 20.12 naming the current version, code 1.

### build / start

- **`orthacms build` in a clean application** → `dist/server/` and `dist/admin/` appear; `node_modules` is not inlined into the bundle.
- **`orthacms build --server`** → Vite does not run at all.
- **`orthacms build --admin`** → `tsc` does not run; `dist/server` stays as it was.
- **`orthacms build` in an application without `apps/admin/index.html`** → the “skipping the admin build” line, exit code 0.
- **A type error in `apps/server`** → the whole `tsc` output, then `tsc exited with code 2`, code 1; `dist/` is not updated.
- **`typescript` removed from the application** → the message “typescript declares no "tsc" binary — is it installed in …?”.
- **`orthacms start` without building first** → “dist/server/src/main.js does not exist — run \`orthacms build\` first.”, code 1.
- **`orthacms start` after a build** → one process serves both the API and the admin UI from a single origin; Ctrl+C gives code 0.

### dev

- **`orthacms dev` with an empty `dist/`** → the server comes up (rather than “hanging”): the one-shot build ran before `node --watch`.
- **Editing a server file** → `tsc` recompiles, `node --watch` restarts; the Nest logs are not wiped off the screen.
- **Ctrl+C, then immediately `orthacms dev` again** → the second run does not fail on a busy port — no orphaned processes were left.
- **`tsc --watch` crashing** → the other two processes terminate as well and the terminal comes back.
- **An application without an admin UI** → Vite does not start, the other two processes run.

### migrate

- **A clean database, the full plugin list** → a line with the number of plugins and the target `host:port/db`, one line per plugin, “Migrations complete.”, code 0.
- **Running it again straight away** → idempotent: nothing new is applied, code 0.
- **A password in `DATABASE_URL`** → it appears in no line of the output.
- **`DATABASE_URL` unset** → a refusal; **no table is created** in any database.
- **An unparseable `DATABASE_URL`** → `(unparseable DATABASE_URL)` in the log, then the driver's error.
- **Postgres not running** → a connection error, code 1; the target line was printed before it.
- **A plugin reordered so that its FK points forward** → the refusal names the plugin, says “applied N of M”, mentions that there is no rollback, and points at the order in `plugins.ts`.
- **After such a failure — fix the order and run again** → the run resumes from the failed plugin; the already-applied ones are not replayed.
- **A plugin list where none carries migrations** → “No plugin migrations to apply.”, no connection is opened.
- **A new plugin added, `dist/` stale** → its tables are still created: the command rebuilt the server itself.
- **`orthacms.config.ts` without `export default`** → the message about the missing default export, not `Cannot read properties of undefined`.

### generate

- **A freshly created application** → the refusal “No apps/server/drizzle.config.ts …”, the database is untouched.
- **The config added, `--name=add_content_types`** → SQL with that name appears in the `out` folder; there was no database connection (verified with Postgres shut down).
- **Without `--name`** → drizzle-kit picks a name itself; the flag is absent from argv.
- **`--name="a b; rm -rf /"`** → a migration with that name is created; no command is executed.
- **Broken `schema` paths in the config** → drizzle-kit's output, then “drizzle-kit generate failed in \<cwd> (exit N) — its output is above”.

### studio

- **`orthacms studio`** → Studio on `127.0.0.1:4983`; every applied table is visible.
- **While Studio is running** → there is no file containing the password in the temporary directory: the config references `process.env.DATABASE_URL`.
- **Ctrl+C** → exit code 0, the temporary directory is removed.
- **`--host 0.0.0.0`** → the multi-line warning about the absence of authentication is printed **before** startup; the command carries on.
- **`--host localhost`** → no warning.
- **`--port 4990`** → Studio listens on 4990.
- **`--port 0`** → a refusal naming the reason (drizzle-kit prints the port it was asked for, not the one it bound), from the CLI and the Nx executor alike. So is `--port=abc` and anything past 65535.
- **`DATABASE_URL` unset** → a refusal before drizzle-kit is started.

### Integration with the monorepo

- **`npx nx run server:db:migrate` and `orthacms migrate` on the same plugin list** → the same order, the same history tables, the same refusal text.
- **`npx nx run <plugin>:db:generate` and `orthacms generate`** → both call `drizzle-kit` the same way, differing only in `cwd` and the config path.
- **The built package tarball** → `bin.orthacms` points at an existing file in `dist/`, not at `src/cli.ts`.

<details>
<summary>How the package's existing unit tests are put together</summary>

The specs live **next to** the code (`src/lib/*.spec.ts`) and mock strictly at the process boundary: `node:child_process` for `generate` and `studio`, `pg` plus `drizzle-orm` for `migrate`. That is why `npx nx test @orthacms/cli` requires neither a database nor a built application.

**What exactly the tests pin down.** For `migrate`: the exact order in which plugins are applied (that is the entire guarantee, because the dependency between tables is declared nowhere), passing each plugin its own folder and history table, the absence of a connection on an empty list, the refusal text with names and counters, preserving the original error in `cause`, not attempting plugins after the failing one, closing the pool on both success and failure, and the absence of the password from the target description. For `studio`: the ephemeral config contains neither the password nor the database name, the URL goes through the environment, the temporary folder is removed, and the `host`/`port` defaults are not artificially substituted. For `generate`: the call goes through `process.execPath` from the project root, `--name` is absent when it was not given, a hostile name stays a single argv element, and a non-zero code turns into a message naming the project and the code rather than a copy of argv.

**What the tests do not cover:** argv parsing and the dispatcher (`cli.ts`), finding the root and loading the compiled host (`project.ts`), reading `.env` (`env.ts`), resolving binaries and supervising processes (`run.ts`), and all six command adapters. That is exactly the part the manual checklist above covers.

</details>

## 10. Boundaries: the CLI and @orthacms/nx

Two packages solve the same three problems for two different worlds. The split runs not along functionality but along **how they get at the application's TypeScript**.

| Trait                               | @orthacms/cli                                                     | @orthacms/nx                                                                             |
| ----------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Who it is for                       | An application installed from npm                                 | The Ortha CMS monorepo                                                                    |
| Published                           | yes, to npm                                                       | no (`private: true`)                                                                     |
| How it is invoked                   | the `orthacms` binary / `npm run`                                    | Nx targets (`db:generate`, `db:migrate`, `db:studio`)                                    |
| How the targets appear              | a hard-coded list of six commands                                 | inference (`createNodesV2`) from the presence of `drizzle.config.ts` / `orthacms.config.ts` |
| How it reads the host config        | build + `require` of JavaScript                                   | `jiti` + `swc` straight from TypeScript                                                  |
| Who loads `.env`                    | itself (`loadEnv`)                                                | Nx, before the target runs                                                               |
| Who builds and runs the application | it does (`build`, `dev`, `start`)                                 | the `@nx/*` targets and webpack; not its business                                        |
| Caching                             | none, and none intended                                           | `build`/`pack` have it; `db-*` has it deliberately off                                   |
| Publishing to npm                   | no                                                                | yes — the `release-publish` executor with throttling and retries                         |
| Validating `--port=0` for Studio    | yes — the refusal lives in `runDrizzleKitStudio`, which both call | yes, and now the same refusal                                                            |

### Who owns what

| Area                                | Who owns it                                    | What the CLI does                                                                     |
| ----------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| Plugin order                        | the application's `apps/server/src/plugins.ts` | Preserves it verbatim; on failure points at it as the cause                           |
| A plugin's migrations descriptor    | the plugin itself (`ServerPlugin.migrations`)  | Reads `dir()` and `table` without interpreting them                                   |
| Reading `process.env`               | `apps/server/orthacms.config.ts`                  | Carries the variables into the process and takes `config.database.url`                |
| The runtime database connection     | `@orthacms/database`                           | Opens **its own** temporary pool only for the duration of the migration and closes it |
| Generating SQL                      | `drizzle-kit`                                  | Runs it with the right `cwd` and turns a non-zero code into an intelligible message   |
| Applying SQL                        | `drizzle-orm`                                  | Owns the loop, the order, the logs and the refusal text                               |
| Compiling and bundling the admin UI | the application's `typescript` and `vite`      | Finds their binaries and passes the right arguments                                   |
| Creating an application             | `create-orthacms-app`                             | Nothing; it lands in the application as a `devDependency`                             |
| Bringing Postgres up                | the application's `docker-compose.yml`         | Nothing                                                                               |

### What the CLI does not have

- **Migration rollback.** No `down` command, no `drizzle-kit drop`. Recovery is a backup's job, not the CLI's.
- **An `orthacms migrate --dry-run` command** — or any way at all to see what would be applied without applying it.
- **Propagating a child process's exit code.** Any failure is a one.
- **A configuration file of its own.** The paths are a convention; a custom layout is not supported.
- **Working with several applications.** One command, one root, found by walking up the tree.
- **A `--verbose` flag, log levels, or machine-readable output.**

## 11. Discrepancies between the code and the documentation

Found while reconciling this dossier with the sources. Not product bugs in themselves, but they disorient developers and testers alike.

| Where                                                                    | What it says                                                                                                           | How it actually is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/cli/AGENTS.md, the command table                                | “`orthacms start` — Runs `dist/server/main.js`”                                                                           | `LAYOUT.serverEntry` = `dist/server/src/main.js`. The `src/` segment is preserved because the template's `apps/server/tsconfig.json` has `rootDir` equal to `"."`, not `"src"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| packages/cli/AGENTS.md, “Compile first”                                  | “`require`s `dist/server/{orthacms.config,plugins}.js`”                                                                   | The paths differ: `dist/server/orthacms.config.js`, but `dist/server/src/plugins.js`. The brace form implies a shared directory that does not exist                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| packages/cli/AGENTS.md, “Compile first”                                  | “`tsconfig.server.json` sets `rootDir` to `src/server`, … `src/server/main.ts` → `dist/server/main.js`”                | No `tsconfig.server.json` file exists, neither in the template nor in the monorepo; what is read is `apps/server/tsconfig.json` with `rootDir: "."`. The comment in `src/lib/project.ts` describes this **correctly** — that is, the document contradicts its own code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| packages/cli/src/cli.ts, the Options block                               | “`--server` — build/**dev**: the server only, skipping the admin”                                                      | **Fixed.** `devCommand(root)` took no options at all and did not read argv, so `orthacms dev --server` still brought Vite up. Both flags now work for `dev` as well — `--admin` runs the Vite dev server alone against an API already up, the way the monorepo offers `start:server` / `start:admin` — and `--admin` asked of an application with no `apps/admin/index.html` is a refusal rather than a supervised empty set exiting 0. `cli.spec.ts` and `commands.spec.ts` carry the regression                                                                                                                                                                                                                                                                                                    |
| packages/cli/src/cli.ts, the Options block                               | “`-h, --help` — Show this message”                                                                                     | **Fixed.** It used to be true — the first argv element was always treated as a command, so `orthacms --help` and `orthacms -h` answered `Unknown command` with exit code 1, and help was reachable only as `orthacms` with no arguments or `orthacms <command> --help`. `wantsHelp` now reads the whole argv, accepts a bare `help` as well, and is checked before the project root is looked for; `args.spec.ts` carries the regression                                                                                                                                                                                                                                                                                                                                                                      |
| packages/cli/src/lib/studio.ts                                           | The `--host`/`--port` options are described as passed straight through to drizzle-kit                                  | **Fixed.** `--port=0` was **silently dropped** (`0` is falsy in `if (options.port)`) and Studio came up on 4983, while `@orthacms/nx`'s `db-studio` executor refused the same input with an explanation — **two branches of one tool behaving differently**. The refusal now lives in `runDrizzleKitStudio`, the implementation both worlds call, and it is a refusal rather than a pass-through for the reason that executor gave: drizzle-kit's listen callback is handed the bound address and ignores it, printing the port it was _asked_ for, so `--port=0` would leave an unauthenticated read/write console on the database at an address nothing reports. `--port=abc` is reported by the argv reader instead of becoming `NaN` and vanishing                                            |
| create-orthacms-app · README.md.tmpl, “Adding content types”, step 3        | “Add `apps/server/drizzle.config.ts` pointing `schema` at your `src/content/index.ts` and `out` at `../../migrations`” | The paths are written as if they resolved relative to the config file. But `generateCommand` starts drizzle-kit with `cwd` = **the application root**, and drizzle-kit resolves `schema`/`out` relative to the working directory (this is stated outright in the comment in `src/lib/generate.ts`). Following the instruction literally sent `out` two levels **above** the application root, and `schema` was not found. **Fixed:** the step is now the config itself, with `out: 'migrations'` and the full `apps/server/src/content/index.ts`, plus the sentence saying both are relative to the application root and why. `generated-readme.spec.ts` resolves `out` from the root the CLI runs drizzle-kit in and compares it with the directory the plugin's own migrations descriptor names |
| create-orthacms-app · templates/default/apps/server/src/plugins.ts, comment | “Define some in `src/server/content/`”                                                                                 | **Fixed.** No such path existed in the template — the server side lives in `apps/server/src/` — while the same template's README named the correct one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| create-orthacms-app · templates/default/apps/server/src/plugins.ts, example | `migrations: { dir: () => join(process.cwd(), 'migrations') }`                                                         | Depends on the current directory, whereas `findProjectRoot` exists precisely so a command can be run from a subdirectory. The monorepo uses `join(__dirname, '../migrations')` in the equivalent place, and every plugin uses `join(__dirname, '…')`. The template's example breaks in exactly the scenario the CLI promises to support                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| create-orthacms-app · README.md.tmpl, the command table                     | `npm run generate -- --name=<name>` was listed alongside the rest as ready to use                                      | A freshly created application has no `apps/server/drizzle.config.ts` (the template does not contain that file), so the very first run is a refusal. This is intended and explained in “Adding content types”, but nothing marks it in the table                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| packages/cli/AGENTS.md, structure                                        | The “## Commands” heading appears **twice**: once as the table of `orthacms` commands, once as a list of `npm exec nx …`  | The second occurrence is about developing the package itself. The duplicate heading breaks navigation through the document                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| packages/cli/package.json                                                | The Node ≥ 20.12 requirement is stated only in `loadEnv`'s error text                                                  | There is no `engines` field in the manifest, so npm will not warn when installing on an older version — you find out only by the refusal itself                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| packages/cli/src/lib/commands/build.ts                                   | The flags are described as “`--server`/`--admin` narrow the build”                                                     | **Fixed.** The combination was not rejected and yielded a command that compiled nothing, built nothing and exited 0. `halves()` in `src/lib/args.ts` now refuses it, for `dev` and `build` alike, naming what each flag skips                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

> **What is worth checking first**
>
> Three items had a practical effect on the user, and two are now fixed: the `drizzle.config.ts` instruction in the generated application's README (a person followed it literally and got an unintelligible refusal) and the `--port=0` divergence between the CLI and the Nx executor. What remains is the `process.cwd()` example in `plugins.ts` — it only breaks when the command is run from a subdirectory, which is exactly the case `findProjectRoot` exists to support, so it does not show up straight away.

---

**Dossier for the `packages/cli` package.** The skeleton is the same as in the `identity` dossier: business description → composition → command catalogue → scenarios → internals → configuration → diagnostics → invariants → checklist → boundaries → discrepancies. Sections the package does not have (data model, HTTP API, admin screens, permissions) have dropped out — the CLI has neither tables nor routes nor a UI.

The source is the package's own code: `src/cli.ts`, `src/index.ts`, six commands in `src/lib/commands/`, six core modules in `src/lib/` and the fourteen spec files beside them. Cross-checked against the `@orthacms/nx` executors (`db-migrate`, `db-generate`, `db-studio`, `lib/jiti.ts`), against the `create-orthacms-app` template (`package.json.tmpl`, `env.tmpl`, `README.md.tmpl`, `apps/server/{tsconfig.json,src/plugins.ts}`) and against the `ServerPlugin` type from `@orthacms/bootstrap-server`. The `AGENTS.md` files were used as a skeleton, but every statement was verified against the implementation — the divergences are collected in section 11.
