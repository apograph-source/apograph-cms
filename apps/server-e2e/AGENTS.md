# @orthacms/server-e2e

End-to-end tests for the NestJS API (`apps/server`). They boot the **real**
server **in-process** against a throwaway Postgres **testcontainer** and drive
it with `supertest`. There is no separate running server, no Docker Compose, no
child process — `npx nx e2e server-e2e` is self-contained (it does need a
running Docker daemon for testcontainers).

> Authoring or extending these suites is governed by the **`server-e2e`**
> skill — read it before adding a suite or a harness helper.

## How a run works

0. **`src/support/preflight.ts`** runs first, before a container exists. It
   refuses a run with more than one Jest worker, and refuses an
   `E2E_DATABASE_URL` that names the same database as `DATABASE_URL` or that
   does not read as disposable. Both are failures that would otherwise present
   as a wall of unrelated red — see **Failure modes** below.
1. **`src/support/global-setup.ts`** starts one `postgres:16-alpine` container
   and applies **each plugin's own migration descriptor** (`{ dir, table }`) —
   the same path `server:db:migrate` uses — so the schema under test is the real
   shipped schema (e.g. identity's `__drizzle_migrations_identity`). The
   connection string is published to the worker (`db-url.ts`: env + temp-file
   fallback). `global-teardown.ts` stops the container — and setup stops it
   itself if a migration fails, because **Jest skips `globalTeardown` when
   `globalSetup` throws** and the container would otherwise be orphaned.
2. **`src/support/test-app.ts`** — `createTestApp(overrides?)` boots the server
   in-process, mirroring `createServer` (real `buildPlugins`, global `api`
   prefix, strict `ValidationPipe`, `setupApiDocs`), runs `app.init()` — which
   runs the `OnApplicationBootstrap` seeders (system roles) — and then binds an
   ephemeral port **on `127.0.0.1`**. The address is not incidental: supertest
   dials `127.0.0.1` but would bind the wildcard, which is how requests ended up
   at other processes on the machine (see **Failure modes**). Suites drive
   `harness.server` (`getHttpServer()`) with supertest. `closeTestApp` closes the
   app — which closes the listener — and the per-file DB pool (via
   `closeDatabase`, which clears the memo too, so a second `createTestApp` in one
   file gets a fresh pool rather than an ended one).
3. **`src/support/copilot.ts`** — the copilot harness. `scriptCopilot(...turns)`
   scripts the fake model for one test; `copilotCalls()` returns every
   `ModelRequest` served, which is the assertion target for the negative path
   ADR-0005 makes mandatory (_a viewer's run must be verified not to be offered
   write tools_ — an assertion about `calls[0].tools`, made without a model).
   The object registered with `CopilotPlugin` is a **stable delegating facade**,
   because the plugin list is built once per spec file while each test needs its
   own script, and `createFakeProvider` takes its script at construction.
   `src/support/copilot-fixture-tools.ts` supplies propose/apply tools that
   phase 1 otherwise has none of — without them "a viewer is offered no write
   tools" would pass vacuously.
4. **`src/support/seed.ts`** — `seedUser` / `seedActiveUser` insert through the
   app's **real `HashingService`** (pulled from DI), so seeded credentials match
   what login verifies. `resetDb()` truncates the mutable tables — including
   `outbox_events`, which has no FK and so is reached by no cascade — and
   deletes non-system `roles`, leaving only the seeded system roles that users
   FK. (`src/harness/harness-isolation.spec.ts` asserts that contract in both
   directions.) Plus `expireUserSessions` / `revokeUserSessions` /
   `deleteUser` / `countUserSessions` for session-lifecycle assertions, and
   `setUserStatus` for the out-of-band suspension the API never performs (its
   disable endpoint revokes sessions in the same transaction).

### Seeing why a request 500ed

`createTestApp` boots with `logger: false` — 70 suites each printing Nest's
start-up banner would bury the report. **`E2E_LOG=1` puts the real logger back**,
and it is the only way to see the _cause_ of a 500: the `ExceptionsHandler` line
carries the failing query and the driver's own message, while a suite can only
ever report the status code. A hand-written SQL fragment that binds its
parameters wrongly is exactly that shape — invisible in the assertion, one line
long in the log.

### Running without Docker

Set **`E2E_DATABASE_URL`** to point the run at an already-running Postgres and
`global-setup` skips the container entirely (it still applies every plugin's
migrations first). For a sandbox or a Docker-less CI runner:

```bash
E2E_DATABASE_URL=postgres://user@127.0.0.1:5432/ortha_e2e npx nx e2e server-e2e
```

**The database it names is truncated between every test.** That is why it is its
own variable rather than reusing `DATABASE_URL`, which is routinely set in a
developer's `.env` and points at their working database — a name that cannot be
triggered by accident is the whole point. The testcontainer stays the default.

The convention is also _enforced_: the run refuses to start if
`E2E_DATABASE_URL` resolves to the same database as `DATABASE_URL`, or if its
database name does not read as disposable (`…e2e…` / `…test…`).
`E2E_ALLOW_UNSAFE_DATABASE=true` waives the name check for an oddly-named
scratch database; nothing waives the `DATABASE_URL` check.

## Failure modes this harness defends against

Both of these produce a wall of red that looks exactly like a product
regression, which is the condition under which real red stops being believed.
The guards are asserted by `src/harness/harness-guards.spec.ts`.

- **More than one worker.** `maxWorkers: 1` in `jest.config.cts` is
  **load-bearing**, not a preference: every suite shares one container and
  `resetDb()` TRUNCATEs it. A CLI `--maxWorkers` / `-w` overrides the config, and
  the result is suites seeding over each other — unique-constraint violations
  and off-by-N counts inside tests about something else entirely. `global-setup`
  now refuses to start and says so. Parallelism needs a database-per-worker
  scheme first; `E2E_ALLOW_PARALLEL=true` is the escape hatch for whoever builds
  it.
- **The database going away mid-run.** On a memory-starved machine the container
  (or Docker) gets killed, and every remaining suite fails in its own
  `beforeAll`/`beforeEach` with a `pg-pool` `AggregateError`, `ECONNRESET`, or
  `write EINVAL` — ~650 failures, none of which says the database is gone.
  `src/support/infra-error.ts` classifies those and re-labels them as
  `E2eInfrastructureError` with a single explicit line; `createTestApp` probes
  the pool with `SELECT 1` before Nest instantiates anything, so the report
  lands at the top rather than inside whichever seeder noticed first. An
  assertion failure is **never** re-labelled.

- **A request answered by another process on this machine.** This is the one
  that cost the suite roughly two tests per full run, on a different pair every
  time, for as long as anyone had run it end to end — and it is a **binding**
  bug, not a leak between spec files.

  `supertest` builds every URL as `http://127.0.0.1:<port>`, but the listen it
  performs for you names no address: `if (!addr) this._server = app.listen(0)`.
  A wildcard `listen(0)` binds `0.0.0.0`/`::`, and Node sets `SO_REUSEADDR`,
  which on **BSD/macOS** lets it **succeed on a port another process already
  holds bound to `127.0.0.1` specifically** — a JetBrains IDE's built-in server
  on `63342`, a toolbox, an Electron app's local bridge. The more specific
  socket wins the loopback traffic, so the request is answered by the stranger:
  `403`, or `301`, or a hang-up read as `ECONNRESET`. (Linux refuses the
  overlap, so a Linux runner never saw it — do not read a green CI as evidence
  the developer machines were fine.)

  It was reached about four times a run rather than never, because supertest
  also **closes the server after every request** (`Test.end`), so the harness
  used to re-bind a fresh ephemeral port for each of the ~35 000 requests a full
  run makes — two ports per request out of macOS's 49152–65535, so the range
  cycles roughly four times and every occupied port is landed on roughly four
  times. A per-directory run never gets far enough round the ring, which is
  exactly why running the suite whole is what exposed it.

  `createTestApp` therefore binds `127.0.0.1` itself before a test can touch the
  server (`listenOnLoopback`), which both closes the hazard — the kernel will
  not hand a loopback listen a port already bound on loopback — and stops the
  churn: one bind per spec file. `createServer` takes a `host` for the same
  reason, and `src/harness/harness-binding.spec.ts` pins both halves plus the
  kernel behaviour the fix rests on.

- **The run exhausting its own heap.** `maxWorkers: 1` does not only mean
  "one worker" — Jest's `shouldRunInBand` returns true on `maxWorkers <= 1`, so
  every spec runs **in band**, in the task process itself. One process for all
  ~94 files, never recycled, each file booting its own Nest app in its own
  module registry: the heap climbs monotonically (1.3 GB at 12 minutes, 2.0 GB
  at 25). Node's default old-space ceiling is sized from total RAM — 2.2 GB on
  an 8 GB machine — so a full run used to abort around minute 20 with
  `Ineffective mark-compacts near heap limit`, reported against whichever suite
  was running rather than against the cause.

  **`apps/server-e2e/.env.e2e` raises the ceiling to 4 GB**, and Nx loads
  `{projectRoot}/.env.<target>` for the `e2e` target, so `npx nx e2e server-e2e`
  carries it with no flag to remember. It is a ceiling, not a reservation. If
  you invoke Jest another way, pass `NODE_OPTIONS=--max-old-space-size=4096`
  yourself — `global-setup` warns when the ceiling is under 3 GB, and
  `harness-guards.spec.ts` asserts the headroom outright so a broken `.env.e2e`
  goes red in seconds instead of at minute 20.

  `workerIdleMemoryLimit` is **not** the fix, for a reason worth knowing before
  reaching for it: setting it is what *disables* in-band execution, so it forks
  a worker that did not exist and restarts it whenever RSS crosses the limit,
  each restart re-reading the whole `node_modules` require cache. Measured
  1894 s against 1030 s for the same suite. See `jest.config.cts`.

## Conventions

- **One suite per endpoint/concern**, grouped by feature folder under
  `src/server/` — e.g. auth suites live in `src/server/auth/`
  (`login.spec.ts`, `logout.spec.ts`, `me.spec.ts`, …); the folder names the
  domain so the file doesn't repeat it. Bootstrap/health stays at
  `src/server/server.spec.ts`. `beforeAll(createTestApp)` /
  `afterAll(closeTestApp)`; `beforeEach(resetDb + seed)` for a clean slate.
- **Boot the real app** via `createTestApp` — never re-declare `NestFactory` /
  prefix / pipe in a spec (that drifts from prod). `bootstrap-server` stays
  untouched.
- **Seed through DI**, never raw bcrypt/SQL for credentials.
- **Cookie flows** use a `supertest.agent(harness.server)` so `Set-Cookie` from
  login is carried into the next request; for single requests forward the
  `ortha_session=...` pair explicitly via `.set('Cookie', …)`.
- `src/support/**` is exempt from `@nx/enforce-module-boundaries` (it
  deliberately imports the host app and a plugin internal); **specs are not** —
  keep cross-project imports in the support harness. (This is why the copilot
  suite reaches DI through `registerCopilotTools` / `copilotToolCallRows`
  helpers rather than importing `@orthacms/copilot-server` directly.)

## Gotchas

- **`@Post` returns `201` by default** (no `@HttpCode` on login/logout), not 200. Assert `201`.
- **Rate limit:** the app boots with a relaxed login limit so suites don't
  self-throttle. To test the `429` path, boot a dedicated app with
  `createTestApp({ rateLimit: { ttlSeconds, limit } })`. The throttle is
  per-app + in-memory, so it never bleeds across suites.
  The throttler's bucket is in-memory **per app**, so it never bleeds across
  suites — but it does persist across _tests in one file_. A throttle suite
  therefore boots per test (`beforeEach`), or each test uses addresses no other
  test touches; otherwise the second test's expected status depends on the
  first, the file passes as a whole, and it fails under `-t`.
- **`maxWorkers: 1`** — one shared container; suites run serially so they don't
  race on `resetDb`. Enforced in `global-setup`, not merely configured (see
  **Failure modes**). Parallelism would need a DB-per-worker scheme.
- Each spec **file** gets its own module registry (own app instance, own pool,
  own throttler) — that's why `closeTestApp` closes the pool per file. Two apps
  _in sequence_ in one file are fine; two apps _open at once_ are not, because
  the `@orthacms/database` handle is a module singleton.

## No CI runs this suite

**No CI pipeline runs these tests today** — the only workflow is
`.github/workflows/release.yml` (`npm ci`, `typecheck`, `nx release`). Until
that changes, a local `npx nx e2e server-e2e` is the only gate on a merge, which
is why the harness defends itself against the two failure modes above rather
than trusting the runner.

## Commands

- `npx nx e2e server-e2e` — run the suites (needs Docker running).
- `npx nx lint server-e2e` / `npx nx typecheck server-e2e`.
