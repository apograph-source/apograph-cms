# @orthacms/nx

The Ortha CMS **Nx plugin**. Adds first-class `nx` targets for database
work and is the home for any future Ortha-specific Nx commands. Sits
alongside the `@nx/*` plugins in the root `nx.json`.

## Package

- Name: `@orthacms/nx`
- Registered in `nx.json` under `plugins` (`"@orthacms/nx"`).
- Consumed from source like the other workspace packages. Loaded directly
  as a TypeScript Nx plugin (no build step).

## What it provides

- **`createNodesV2` inference** (`src/index.ts`) — targets appear
  automatically, the same way `@nx/js` infers `typecheck`:
    - a project with a `drizzle.config.ts` gets **`db:generate`**
    - a project with an `ortha.config.ts` (the host) gets **`db:migrate`** and
      **`db:studio`**
    - a package under `packages/` with a `tsconfig.lib.json` gets a cacheable
      **`build`** (`tsc --build`, emitting JS + `.d.ts` to `dist/`), and a
      publishable one also gets **`pack`** and an **`nx-release-publish`**
      pointed at what `pack` staged. `@nx/js` infers no `build` here because
      our manifests point at source rather than output, which is exactly the
      thing a release has to undo — see [`docs/releasing.md`](../../docs/releasing.md)

        `nx-release-publish` is the one inferred target that is **also** named in
        the root `nx.json`, and it has to be: Nx adds an implicit
        `nx-release-publish` to every non-private package and applies it after
        inference. Where the two disagree on the executor, Nx's wins outright and
        drops the inferred `options` with it — so the `executor` is declared in
        `targetDefaults` as well, and `dependsOn` lives there alone.

- **Executors** (`executors.json`):
    - `db-generate` — runs `drizzle-kit generate` for one plugin's schema.
      Needs no database and no secrets — generation only diffs against the
      snapshot. **Not cached**, deliberately: every project's schema location
      comes from its own `drizzle.config.ts` (five of this workspace's eight
      point outside `src/lib/schema/`), and drizzle-kit diffs against
      `migrations/meta/*_snapshot.json`, which sits inside what would be the
      declared output. So no input glob can be correct and the result is not a
      function of its inputs anyway — a cache hit both skipped a generation
      that was asked for and restored `migrations/` over the working tree. See
      the long note in `src/index.ts`.
    - `db-migrate` — applies every plugin's migrations. Loads the host's
      `ortha.config.ts` + `buildPlugins()` via `jiti` (transpiling with `swc`
      in **legacy-decorator** mode, since the plugin graph it pulls in uses
      `experimentalDecorators` and jiti's bundled babel otherwise defaults to
      stage-3 decorators and crashes), then applies each plugin's `migrations`
      (see `ServerPlugin.migrations`) under its own tracking table.
      `cache: false` (side-effecting).

        It **refuses to run without a database URL**, and names the
        `host:port/database` it is about to change. An empty connection string
        makes `pg` fall through to `PGHOST`/`PGUSER`/`PGDATABASE` or localhost
        and the OS user, so an unset `DATABASE_URL` used to report
        "Migrations complete." after building a whole schema in a database
        nobody named.

        Plugin **order** is load-bearing and undeclared — workspaces'
        `memberships` FK-references identity's `users`. The loop applies
        plugins in exactly the order `buildPlugins()` returns them, so a
        failure names the plugin, says how many committed before it, and points
        at the order as the usual cause.

    - `db-studio` — launches `drizzle-kit studio` against the host database.
      Resolves the connection URL from the host's `ortha.config.ts` (loaded via
      the same `jiti`+`swc` helper as `db-migrate`), the single place that reads
      `DATABASE_URL`. The committed drizzle configs are schema-only (no
      secrets), so this synthesizes an **ephemeral** config in a temp dir that
      reads `process.env.DATABASE_URL` — the URL is passed through the child's
      env and never written to disk. Studio introspects the live DB, so no
      schema is needed. `cache: false` (side-effecting, long-running).

        Studio has **no authentication** and full read/write access to the
        database, so `--host` anything other than loopback prints a warning
        naming the exposure before it starts. Ctrl+C is the documented way to
        stop it and is reported as a success, not a failed target. `--port=0`
        is refused rather than silently dropped: drizzle-kit binds an ephemeral
        port for it but prints the port it was _asked_ for, so Studio ends up
        somewhere nothing reports.

    - `release-publish` — publishes one staged package to npm, in place of
      `@nx/js:release-publish`. npm rate-limits an account's writes and a
      lockstep release fires ~37 of them, so every publish takes a turn
      through a workspace-wide slot (a file lock under `dist/.release-publish`)
      that serialises them and leaves a gap in between, and a publish refused
      with a 429, a 5xx or a dropped socket is retried with exponential
      backoff. The holder **heartbeats** its lock while it works, because the
      staleness window that lets a peer reclaim a dead worker's slot (15min)
      is shorter than the retry ladder a live one may legitimately spend
      (12.5min by default, longer with `ORTHA_PUBLISH_RETRIES` raised) — so
      `staleAfter` bounds silence rather than work, and a finishing publisher
      only removes a lock that is still its own. Defaults — 5s gap, 5 retries
      from 30s, capped at 5min — are
      target options, overridable per run with `ORTHA_PUBLISH_DELAY`,
      `ORTHA_PUBLISH_RETRIES` and `ORTHA_PUBLISH_RETRY_BACKOFF`. A dry run
      waits for nothing: it writes nothing to rate-limit.

        **Rehearse with `npm run release:dry-run`, never with `nx run-many`.**
        `nx run <project>:nx-release-publish --dryRun` works — the flag reaches
        the executor. `nx run-many -t nx-release-publish --dryRun` does **not**:
        `run-many` consumes `--dryRun` itself, the option never arrives, and the
        target performs a **real** `npm publish`. On an authenticated machine
        that publishes for real, and for a package name this account has never
        created it spends one of the rationed name creations described below.
        `npm run release:dry-run` goes through `nx release publish --dry-run`,
        which sets `NX_DRY_RUN` as well, so the rehearsal holds either way.

        Each publish is preceded by a registry **probe** (`lib/release/registry.ts`)
        — a `GET`, which npm does not meter like a write. It answers whether the
        version is already published (skip, sending nothing), whether the name
        exists (a version bump), or whether the name is absent (a **creation**).

        That distinction matters, because **creating a name is a different limit
        from writing too fast** and retrying cannot beat it: 0.1.0 created 25
        names then hit a wall the next two releases never got past, while bumps
        on existing names kept succeeding throughout. So a 429 on a creation is
        terminal — one attempt, an actionable message — and it trips a flag beside
        the lock so packages queued behind it bow out without spending a request.
        One blocked release costs one rejected write, not one per package. Only
        npm support (or waiting out their schedule) clears it; see
        [`docs/releasing.md`](../../docs/releasing.md#creating-a-package-name-is-a-different-limit).

## Architecture

- **Thin executors over a core lib — and the database half of that lib now
  lives in [`@orthacms/cli`](../cli/AGENTS.md).** `db:generate`, `db:migrate`
  and `db:studio` are adapters over `runDrizzleKitGenerate`,
  `applyPluginMigrations` and `runDrizzleKitStudio`, imported from that package.
  They used to live here, in `src/lib/drizzle/`, where an app installed from npm
  could not reach them at all — this package is `private` and never published,
  so a generated app had no way to migrate its own database. Moving them means
  **the monorepo and every generated app apply migrations through one
  implementation**, which for the most destructive operation in the system is
  worth more than the indirection costs.

    Release logic (`src/lib/release/`: `publish.ts`, `throttle.ts`,
    `registry.ts`) stays here — it is workspace tooling, not something a
    consumer runs.

    `src/lib/jiti.ts` also stays: it builds the `jiti`+`swc` (legacy-decorator)
    loader `db:migrate` and `db:studio` use to import the TypeScript
    `ortha.config.ts` **from source**, which is a problem only this workspace
    has. A generated app compiles first and `require`s the JavaScript, so
    `@orthacms/cli` needs neither jiti nor swc.
- **Generate is per-plugin; apply is host-level.** Each workspace plugin
  owns its `drizzle.config.ts` and generates its own `migrations/`. The host
  applies all of them. npm-installed plugins ship their SQL pre-generated;
  the apply path is identical because each plugin advertises its own
  `migrations.dir`.
- **CommonJS.** This package compiles to CJS (no `"type": "module"`), so use
  `require`/`__dirname`/`__filename`, never `import.meta`.
- **Tested with jest** (`jest.config.js` + `.spec.swcrc`, like the server
  plugins). The specs sit beside the code and mock at the process boundary —
  `node:child_process`, `pg`, `fetch`, jiti — so the whole package is covered
  without a database, a registry or an Nx graph. `createNodesV2` is exercised
  against a throwaway workspace root on disk, which is what makes the manifest
  guards (`private`, no `name`, no `tsconfig.lib.json`, unparseable JSON)
  testable at all. `npx nx test nx`.

## Commands

- `nx run <plugin>:db:generate --name=<migration_name>` — generate a plugin's migration
- `nx run server:db:migrate` — apply all plugins' migrations (needs `DATABASE_URL`)
- `nx run server:db:studio` — open Drizzle Studio on the host DB (needs
  `DATABASE_URL`; optional `--host` / `--port`)

## Adding a new command

1. `src/executors/<name>/{executor.ts,schema.json}` — keep logic in `src/lib/`.
2. Register it in `executors.json`.
3. (Optional) infer it in `createNodesV2` so it auto-attaches to projects.
