# @orthacms/cli

The `ortha` command — how an **installed** Ortha CMS app is built, run and
migrated. The counterpart to [`@orthacms/nx`](../nx/AGENTS.md), which does the
same jobs inside this monorepo.

## Package

- Name: `@orthacms/cli`
- Binary: `ortha`
- A devDependency of a generated app (see
  [`create-ortha-app`](../create-ortha-app/AGENTS.md)), and a dependency of
  `@orthacms/nx`.
- **CommonJS** (no `"type": "module"`), so `require`/`__dirname` are available
  and `import.meta` is not.

## Why it exists

Everything a consumer needs to *operate* an app used to live in `@orthacms/nx`,
which is `private` and will never be published: `applyPluginMigrations` was
reachable only through an Nx executor, so an app installed from npm had no way
to migrate its database at all.

The core rule this package encodes: **the monorepo and every generated app go
through one implementation.** `@orthacms/nx`'s `db:migrate`, `db:generate` and
`db:studio` executors are thin adapters over the functions exported here. Two
implementations of "apply migrations in plugin order" would be two chances to
get the most destructive operation in the system wrong.

## Commands

| Command | Notes |
| --- | --- |
| `ortha dev` | `tsc --watch`, `node --watch`, and Vite in one terminal. `--server` / `--admin` run one half |
| `ortha build` | `tsc` for the server, Vite for the admin. `--server` / `--admin` narrow it |
| `ortha start` | Runs `dist/server/main.js` |
| `ortha migrate` | Builds the server, then applies every plugin's migrations |
| `ortha generate --name=<n>` | drizzle-kit against the app's own `drizzle.config.ts` |
| `ortha studio` | Drizzle Studio on the app's database. `--port=0` is refused, not dropped — drizzle-kit prints the port it was asked for, never the one it bound |
| `ortha --help` | Usage — also `-h` and a bare `help`. Answered before `findProjectRoot`, so it works outside an app |
| `ortha --version` | The installed version, read from the package manifest at runtime. Also `-v`, and checked before `--help` |

## Architecture

- **Thin commands over a core lib.** Logic lives in `src/lib/`
  (`migrate.ts`, `generate.ts`, `studio.ts`); `src/lib/commands/` adapts it to
  argv, and `src/index.ts` re-exports it for `@orthacms/nx`. The specs sit
  beside the code and mock at the process boundary (`node:child_process`, `pg`),
  so the package tests without a database.
- **Compile first, then read JavaScript.** `ortha migrate` builds the server and
  `require`s `dist/server/{ortha.config,plugins}.js`. The monorepo cannot do
  this — Nx runs against source, so it needs `jiti` plus an swc transform hook
  configured for legacy decorators, because the plugin graph is full of
  decorated Nest classes and jiti's bundled babel crashes on them. A generated
  app has its own build step, so **that whole problem stays out of the consumer
  path**; `jiti` remains a dependency of `@orthacms/nx` alone.

    Two details that are easy to get wrong here, both measured:

    - It is `require`, not `await import()`. Importing a CommonJS module from
      ESM puts the whole `module.exports` on the namespace's `default`, so
      `module.default` is `{ default: config }` rather than the config — and the
      first thing to touch it fails with `Cannot read properties of undefined`,
      naming nothing.
    - The app's layout is a **convention**, not configuration (`LAYOUT` in
      `src/lib/project.ts`). `tsconfig.server.json` sets `rootDir` to
      `src/server`, which is what keeps the compiled tree flat —
      `src/server/main.ts` → `dist/server/main.js`. Change that and the paths
      here stop resolving.

- **`.env` is loaded by this package.** Nothing else does it. Nx loads `.env`
  before a target runs, so `ortha.config.ts` can just read `process.env` — a
  generated app has no task runner, and without `loadEnv` every command fails on
  a `DATABASE_URL` sitting in the file. `process.loadEnvFile` does not overwrite
  variables already exported, which is the precedence a deployment needs.
- **Binaries resolve from the app, through the manifest.** `tsc` and `vite` come
  from the app's own `node_modules` (its declared versions, not whatever npm
  hoisted next to the CLI), and are located via each package's `bin` field
  rather than a guessed path. A deep specifier only resolves if the package
  exports that subpath, and Vite does not export `./bin/vite.js` — the guess
  fails with `Package subpath './bin/vite.js' is not defined by "exports"`.
- **Nothing is bundled.** Every plugin locates its migrations as
  `join(__dirname, '../../../migrations')`, resolving to its own package root
  inside `node_modules`; a bundler flattening those files breaks it. The
  monorepo's `apps/server` uses webpack only because it must inline packages it
  consumes from source.
- **`dev` builds once before it watches.** `node --watch` cannot recover from a
  missing entry point — handed a path that does not exist yet it stays alive
  watching nothing and never boots, which reads as a hang. Ending `dev` takes
  every child down with it, or the next run fails on a port held by an orphan.

## Tests

`npx nx test @orthacms/cli` — jest, `.spec.ts` beside the source.

## Commands

- `npm exec nx typecheck @orthacms/cli`
- `npm exec nx build @orthacms/cli`
