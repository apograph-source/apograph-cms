# create-orthacms-app

The scaffolder. `npx create-orthacms-app my-cms` writes an Ortha CMS app that
consumes every package from npm.

## Package

- Name: **`create-orthacms-app`** — unscoped, so `npx create-orthacms-app` and
  `npm create orthacms-app` both work. It is the one package in this workspace
  outside the `@orthacms` scope, which is why `nx.json`'s `release.projects`
  names it explicitly alongside the `@orthacms/*` glob.
- Binary: `create-orthacms-app`
- Released **in lockstep** with everything else.

## The version mechanism

The scaffolder stamps **its own version** into every `@orthacms/*` dependency of
the generated app (`__ORTHACMS_VERSION__`). Since the release is lockstep, its
version _is_ the matching set — so `npx create-orthacms-app@0.4.0` generates a
0.4.0 app, and a generated app is internally consistent by construction.

They are pinned **exactly**, no caret, and the generated README says to upgrade
them together. A partial upgrade can leave two copies of a shared package in
`node_modules` — two React context instances, and an admin whose sidebar
silently stops talking to its provider.

Reading the version from the manifest rather than resolving `latest` from the
registry is also what makes `create-orthacms-app@<old>` reproducible.

## Keeping the template current

Two upkeep rules, both enforced by tests rather than by memory.

**Releasing does not require a template edit.** Every `@orthacms/*` dependency
is written as `__ORTHACMS_VERSION__` and stamped with the scaffolder's own version
at render time, so a lockstep release bumps the whole generated set with nothing
to update here. There is no version list to fall behind.

**Adding a package does require one.** Every published `@orthacms/*` package
must be classified in [`src/lib/features.ts`](src/lib/features.ts) as exactly
one of:

| Group                    | Meaning                                                                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CORE_PACKAGES`          | every app gets it                                                                                                                                                                            |
| a `Feature`'s `packages` | installed when that feature is chosen                                                                                                                                                        |
| `TRANSITIVE_PACKAGES`    | published, but with no reason for a generated app to import it. Currently `media-provider-memory` and `media-provider-testkit` — tools for _writing_ a storage provider, not for running one |

`features.spec.ts` enumerates the workspace and fails on anything unclassified,
so a new package cannot merge without someone deciding whether a new app gets
it. Without that guard the template just falls a release behind: the package
publishes, nothing references it, and nobody notices until a user asks why the
feature they read about is missing.

**Everything reachable is declared.** A generated app's manifest lists every
`@orthacms/*` package it could import, the extension points included — the
`*-domain` kernels (`content`, `copilot`, `identity`, `media`, `segments`,
`transfer`, `webhooks`) plus `tools-server` and `query-builder-admin`. Every one
of them arrives transitively anyway, so an import resolves on npm's flat
`node_modules` regardless; declaring them is what makes that resolution
something the app owns. An undeclared import works until a version conflict
nests a copy, and never works under pnpm.

That leaves **15** of the 67 published packages out of a default app, and
`features.spec.ts` asserts the list in full: the four unpicked storage adapters,
the two hosted copilot backends, the three SSO adapters, the mail queue and its
SMTP adapter, `content-graphql`, `mcp-server`, and the two
`TRANSITIVE_PACKAGES`. Every one of the thirteen is reachable from the wizard;
only the last two are unreachable by design.

Note what "optional" does and does not mean for the last two.
`content-server` depends on `mcp-server`, so it is on disk in every generated
app whatever the user picked. Optional means **not registered** — the plugin is
absent from `plugins.ts` and its config block from `orthacms.config.ts` — which is
why a default app answers `404` on `/api/v1/mcp` rather than failing to
resolve anything.

## Feature selection

The wizard asks five questions; everything else is installed unconditionally.

| Question                                        | Kind            | Default          |
| ----------------------------------------------- | --------------- | ---------------- |
| Where should uploads be stored?                 | single          | Local filesystem |
| AI copilot — which model backends?              | multiple        | none             |
| How do people sign in?                          | multiple        | none (email)     |
| Which protocols should the content API speak?   | multiple        | REST (locked)    |
| How should the app send invitations and resets? | single, or none | Do not configure |

The sign-in question offers OpenID Connect, GitHub and SAML — three because
their **wire** differs, which is the only thing that earns a package: OIDC
covers Okta, Auth0, Keycloak, Google, Entra ID and the rest through preset
factories inside one adapter, GitHub is OAuth2 with no identity token, and SAML
is a POST binding with XML signatures. None is on by default: SSO needs an
issuer, a client and a callback registered on the other side, none of which a
scaffolder can invent.

All three share one `ssoProviders` key in `config/identity.ts`, one builder in
`plugins.ts` and one extra argument to `IdentityPlugin` — each of which has to
appear if _any_ was picked. `orthacms:if` is line-based with no expression
language, so `resolveFlags` derives a group flag, **`sso`**, which is the one
thing in the flag set that is not a picked id.

The mail question is the only **single choice that may be answered with
nothing**, and "Do not configure" is a row in the picker rather than an unticked
box: storage has to go somewhere, but a deployment that sends no mail is a
configuration, not an omission — it is what the CMS did before ADR-0018, and the
invite response still carries the link for an administrator to pass on. One
entry covers the market for the same reason the OIDC adapter covers the identity
vendors: Resend, SES, Postmark, SendGrid, Mailgun, Google Workspace and any
relay inside a perimeter all speak SMTP. A vendor HTTP adapter joins the list
when its wire genuinely differs.

Two mail packages are offered **nowhere** and installed with every app:
`mail-provider-console` and `mail-provider-testkit`, on `identity-provider-fake`'s
reasoning (ADR-0018 §6). The console adapter writes a message to the log, which
is right while developing and wrong in production — an invitation that looks
sent and reaches nobody, which is ORT-148's mistake with a secret attached. No
template names either one.

What the mail question adds is the **plugin**, not just an adapter:
`mail-server` rides with the backend rather than sitting in `CORE_PACKAGES`,
because an app that sends nothing registers no queue and no worker — and a core
package defining a plugin factory has to be mounted unconditionally, which this
one must not be. The `mail` group flag is derived the way `sso` is, so
`config/mail.ts`, the `mailPlugin` helper and the shared `MAIL_*` keys belong to
mail rather than to SMTP.

All three multi-selects default to **nothing extra**, deliberately: a hosted
copilot provider sends workspace content to a third party (ADR-0005 §10), an
endpoint nobody asked for is still an endpoint, and an identity provider is a
tenant on someone else's directory.

REST is shown **`locked`** — ticked, dimmed, and skipped by the cursor — rather
than left out of the question. "Which protocols does this app speak?" is a more
useful thing to answer than "do you want these two extras", and the answer reads
as a complete set only if the one you always get is in it. `--protocols none`
still yields REST; it is not something a flag can switch off.

The storage question offers **five** adapters — local disk, S3-compatible,
Azure, GCS and Vercel Blob — all of them published and selectable. It is
**skipped whenever only one is `available`**, because a question with a single
possible answer is noise pretending to be a choice; that branch is dormant
today and exists for the next adapter that lands in the codebase before it
lands on npm, which is shown greyed out rather than hidden.

**The copilot itself is core, not a choice.** `copilot-server` and
`copilot-admin` are in `CORE_PACKAGES`, and `CopilotPlugin` is registered on
both sides of every generated app, because its server half arrives regardless —
five core plugins (`content`, `i18n`, `media`, `segments`, `users`) depend on
`copilot-server` to contribute their tools, so the code is on disk whatever the
manifest says, and leaving it undeclared bought only a missing chat panel.
`COPILOT_ENABLED` defaults to `false`, and since that flag unregisters the
copilot's routes, a generated app ships with the surfaces **absent** rather than
present-and-refusing.

What the question picks is which **backends** to add, and picking none is a
complete answer: an app with no backend has the plugin installed and nothing
registered, so `COPILOT_ENABLED` has to stay `false` until one is configured —
enabling it with an empty provider list refuses to boot.
`copilot-provider-fake` is never offered because it is not a published package
at all. It was once shipped as an offline stand-in (ADR-0004 §3) and registered
last in every generated app, which made it the whole catalogue of any deployment
that configured nothing — so a keyless install answered every question with a
canned sentence instead of failing. It is now a private test fixture of the CMS
repo.

Every question has a flag (`--media`, `--copilot`, `--sso`, `--protocols`,
`--mail`, each taking a comma-separated list or `none`), and `--yes` plus any
non-TTY takes the defaults without asking. A scaffolder that blocks on a prompt in CI hangs the job until
it times out.

## Templates

**One** template, `templates/default` — a working CMS with **no content types**.
The user defines their own; the generated README and a comment in the template's
`plugins.ts` say how, including the `drizzle.config.ts` and `migrations`
descriptor to add at that point. `ContentPlugin({ types: [] })` is valid and
owns no tables, which is what lets the app migrate and boot before any content
type exists.

Templates are **data, not source**, and this workspace has to be told so in four
separate places — each of which failed loudly the first time:

| Where                         | Why                                                                                                                                                                                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.nxignore`                   | Nx inference walks every directory. Left visible, `@orthacms/nx` infers a `db:migrate` target onto `templates/default/src/server` — a directory with no project name — and **the whole project graph fails to build**, taking every `nx` command in the repo with it |
| `tsconfig.lib.json` `exclude` | `tsc --build` would compile app-shaped files against this workspace's resolve-from-source setup                                                                                                                                                                      |
| `eslint.config.mjs` `ignores` | Same, for lint                                                                                                                                                                                                                                                       |
| `.prettierignore`             | The files carry `__PLACEHOLDER__` tokens inside JSON                                                                                                                                                                                                                 |

### File naming

Two renames happen at scaffold time (`RENAMES` in `src/lib/template.ts`):

- **`_gitignore` → `.gitignore`.** npm silently refuses to publish a file named
  `.gitignore`, so a template carrying one ships without it and every generated
  app starts by offering to commit `node_modules`. Nothing about the tarball
  looks wrong. create-vite and create-next-app use the same workaround.
- **`*.tmpl` → the real name.** Keeps a `package.json` out of the root
  `workspaces` globs, which would otherwise read the template directory as a
  package of its own.

`pack.mjs` stages `templates/` verbatim and adds it to `files`, the same way it
handles a plugin's `migrations/`.

## The generated app

```
my-cms/
├── package.json          one package — not workspaces; see below
├── tsconfig.json         references the four apps
└── apps/
    ├── server/           orthacms.config.ts, src/{main,plugins}.ts, jest.config.js
    ├── admin/            index.html, vite.config.mts, src/
    ├── server-e2e/       jest.config.js, src/{api.spec,global-setup,support}
    └── admin-e2e/        playwright.config.ts, src/{auth.spec,support}
```

**The same four apps this repo is built from**, so anyone who has read the
Ortha CMS source finds the same shape in their project — and `LAYOUT` in
`@orthacms/cli` has one tree to describe rather than two.

Still **one** `package.json`, deliberately: npm workspaces would let the two
halves resolve different copies of a shared package, and `pack.mjs` pins
internal deps per release, so a split risks two `@orthacms/design-system`
instances — two React contexts, and a UI that silently stops talking to itself.

`apps/server/tsconfig.json` sets `rootDir` to the app directory, which is what
makes the compiled paths predictable: `apps/server/orthacms.config.ts` →
`dist/server/orthacms.config.js`, `apps/server/src/main.ts` →
`dist/server/src/main.js`. Those exact strings are `LAYOUT`'s
`compiledConfig` / `serverEntry`; change the `rootDir` without changing them
and `orthacms start` reports a missing entry point rather than a moved one.

The admin's Vite config lives **inside** `apps/admin` and sets its own `root`,
so the CLI passes `--config apps/admin/vite.config.mts`. Without the flag Vite
finds no config in the working directory and builds from its defaults —
silently, producing a bundle from the wrong root.

Three things the generated app does differently from this repo's `apps/*`, each
because it consumes packages from npm rather than from source:

1. **No webpack.** `tsc` only, so `node_modules` stays on disk and every
   plugin's `join(__dirname, '../../../migrations')` still resolves.
2. **`@source "../../../node_modules/@orthacms"`** in `styles.css`. Tailwind
   excludes `node_modules` from content detection, so without this the entire
   admin renders unstyled — and nothing errors. It must stay a **bare
   directory**: a `@source` containing a glob is still filtered through the
   ignore rules, so `@orthacms/*/dist/**/*.js` matches nothing and the emitted
   stylesheet is the theme block alone (~15 kB, no component utilities). Only a
   literal directory path is registered as an explicit content root that
   bypasses those rules.
3. **`staticDir`**, so one process serves the API and the admin on one origin.
   `apps/*` splits them because Vite serves the admin there; a deployment has no
   dev proxy, and identity's `SameSite=lax` session cookie needs same-origin.

## Conditional blocks

One template serves every feature combination through `orthacms:if` markers
(`src/lib/conditionals.ts`):

```ts
// orthacms:if copilot
import { CopilotPlugin } from '@orthacms/copilot-server';
// orthacms:end
```

`orthacms:if`, `orthacms:ifnot` and `orthacms:end`, on any comment syntax, so the same
directive works in TypeScript, YAML, `.env` and Markdown. Marker lines are
always stripped; blocks nest, and an inner block inside a dropped one stays
dropped. An unclosed block **throws** — silently swallowing the rest of
`plugins.ts` would produce an app that boots with no API rather than one that
fails to render.

**A file that conditions itself away is not written.** Wrap the whole of a file
in one block and an app generated without that feature simply has no such file —
which is what lets `apps/server/config/` hold one module per optional plugin
(`mcp.ts`, `sso-oidc.ts`, `copilot-anthropic.ts`) rather than one file of
markers. The guard is on the _rendered_ result being blank while the source was
not, so a template file that is deliberately empty still ships.

That shape is not decoration. Split across modules, an import list is narrow
enough that a helper only a feature block used is left **dangling** when that
feature is off — and `orthacms:if` cannot drop it, because two features may need
the same import and a marker per specifier would emit it twice. One file per
optional thing sidesteps that entirely: every module's imports are
unconditional and exactly used. `apps/server/config/media-storage.ts` is the
one file that still carries several blocks, and it can, because storage is a
single choice — exactly one survives.

`package.json` deliberately does **not** use them: dropping lines from JSON is
how you get a trailing comma and an app that cannot be installed, blaming the
template rather than the feature that was switched off. Its dependency map is
assembled in `features.ts` and re-sorted instead.

## Registering a plugin is three edits, not one

Mounting a plugin in the generated app touches three files, and the failure
modes differ:

1. `src/lib/features.ts` — classify the package, or it is not installed at all.
2. `templates/default/apps/{server,admin}/src/plugins.ts` — import the factory
   and add it to `buildPlugins`, plus its `name` to that app's
   `EXPECTED_PLUGINS`. Skip this and the package ships in `node_modules` with
   no route and no nav row (**I-33**).
3. `templates/default/apps/server/config/<plugin>.ts` plus a line in
   `orthacms.config.ts` — **only if the plugin has settings an operator sets**.
   Skip this while advertising the keys in `env.tmpl` and the app documents
   configuration it ignores (**I-34**).

Step 3 is the one with no natural reminder, so mirror
[`apps/server/config/`](../../apps/server/config/) — this repo's own app is the
reference composition, and a plugin configured there and not here is the tell.
`AlarmsPlugin()` takes no argument in either, which is what "has no settings"
looks like; `transfer` and `segments` have settings that are **code** (a
per-type identity map, a resolver function) rather than environment values, so
their modules read no env and exist to give that code a home.

## The command and the scaffolder

`src/cli.ts` is the `bin` and nothing else: it calls `main()` and turns a thrown
error into an exit code. Everything the command does — the flags, the wizard,
the refusals, the summary — lives in `src/lib/run.ts`.

The split is not tidiness. A module that scaffolds the moment it is imported can
only be tested by spawning a process, so the two promises that matter most
("never overwrite a directory someone is using", "never block on a prompt")
were unpinned while they were in the entry file. `run.spec.ts` drives `main()`
directly, with `--no-install --no-git` as the only concessions.

## The terminal UI

`src/lib/ui.ts` — boxes, colour, and arrow-key/space-bar pickers, hand-rolled
with **no dependencies**. This package is what `npx` downloads before anything
else exists, so every dependency is weight on the first thing a new user waits
for. It degrades on `NO_COLOR`, a dumb terminal, a non-TTY and `--yes`.

The one hazard to know: the pickers put stdin in raw mode, and a process that
exits while still raw leaves the user's terminal with no echo — they have to
type `reset` blind. Restoring it lives in a `finally`.

## The generated app's own tests

A scaffolded app ships a working test setup, because a starter that cannot be
tested teaches people not to.

| Suite                               | Runner                                                     | Why that one                                                                                                                                              |
| ----------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/**/*.spec.ts`          | Jest + `@swc/jest`                                         | NestJS DI reads `emitDecoratorMetadata`; Vitest's esbuild transform does not emit it, and providers resolve as `undefined` with no error naming the cause |
| `apps/admin/src/**/*.spec.{ts,tsx}` | Vitest + jsdom, configured in `apps/admin/vite.config.mts` | It is a Vite app; sharing the config is the only way tests and app agree on resolution                                                                    |
| `apps/server-e2e`                   | Jest + supertest, real Postgres                            | Boots **this app** through `createServer` — a harness that mirrors the bootstrap can never fail on a bootstrap defect                                     |
| `apps/admin-e2e`                    | Playwright, Vite dev server, `/api` mocked                 | Drives the UI with no backend: fast, hermetic, and a failure means the UI is wrong                                                                        |

The e2e split mirrors `apps/server-e2e` and `apps/admin-e2e` in this repo, for
the same reason: testing the API through a browser is slower and blames the UI
for server bugs.

Two runners is the honest answer here rather than a compromise: each half has a
different toolchain and neither transform serves both.

The shipped specs assert what breaks quietly — the plugin lists and their
order. They are **feature-aware**: the expected server list carries `orthacms:if`
blocks for `content-graphql` and `mcp`, so it stays correct whatever the wizard
was asked for.

### The server e2e database

It manages its own: `<database>_e2e`, created and migrated on first run through
`applyPluginMigrations` — the same function `orthacms migrate` calls, so the schema
under test is the real one rather than a hand-rolled mirror.

Four things there took a run to get right:

- **The derivation is idempotent.** `global-setup` runs in Jest's main process
  and points `DATABASE_URL` at the test database; workers fork from it and
  inherit that value, so a naive append derives `app_e2e_e2e` in the worker and
  every test fails against a database nobody created.
- **`global-setup` imports the config dynamically.** A static import is hoisted
  above every statement, so it would run before `.env` is loaded and before the
  URL is repointed — and the suite would fail on a variable sitting in a file
  two lines away.
- **`transformIgnorePatterns` un-ignores `@scalar`.** `createServer` pulls in
  the API-reference renderer, published ESM-only, and Jest is CommonJS: without
  it the run dies on `Unexpected token 'export'` pointing at a file nobody in
  the app wrote.
- **`assertDisposable` refuses the development database.** The suite truncates
  every table, and `E2E_DATABASE_URL` can be set to anything. Check before the
  first `TRUNCATE`, not after.

Three more details worth not re-discovering:

- **`jest.setup.js` supplies placeholder secrets.** The specs import
  `orthacms.config.ts`, which deliberately refuses to load without `DATABASE_URL`.
  Nothing connects — the plugin list is a pure function of the config — so
  placeholders are what let `npm test` run in CI with no `.env`.
- **`tsconfig.server.json` excludes `**/\*.spec.ts`**, or `orthacms build`compiles
the tests into`dist/server` and ships them.
- **The Vite config is `.mts`.** The app is `"type": "commonjs"`, and Vite warns
  (and will eventually fail) on ESM syntax in a config loaded as CJS.
- **The server e2e specs read `ALLOWED_ORIGIN` from the config.** Login is
  guarded by an origin allow-list that follows `ADMIN_PORT`, so a hardcoded
  `:4200` fails on any app whose admin runs elsewhere — as a confusing `403`
  rather than "wrong origin".

## Tests

`npx nx test create-orthacms-app` — the package-coverage guard, the conditional
processor, and the scaffolded output for several feature combinations (nothing
optional, one copilot provider, both, and every protocol). Four of the eleven
spec files are worth knowing about by name:

- `run.spec.ts` drives `main()` end to end in a temporary directory: the
  non-empty-directory refusal, the two ways of answering without being asked,
  and where the generated administrator password is allowed to exist.
- `composition.spec.ts` compares the plugin list the template _registers_
  against the one the generated app's own `plugins.spec.ts` _expects_, reading
  each plugin's name from the package that defines it. Those generated specs
  never run here, so nothing else notices when they stop describing the app —
  which is exactly how a scaffolded app shipped with `npm test` already red.
  It also closes the gap between **classified** and **mounted**: every
  `CORE_PACKAGES` entry that defines a plugin factory must appear in
  `buildPlugins`. Classification alone only puts a package in `package.json`,
  and the two drifted apart for four releases — `v0.4.0`–`v0.4.3` installed
  `transfer-*` and `segments-*` in every generated app without registering
  either, so users got the code in `node_modules` and no export/import dialogs
  and no audience directory, with every guard green. Plugin-ness is read from
  the package's own return types, so a library that grows a factory later fails
  this without anyone touching the scaffolder.
- `generated-config.spec.ts` **executes** rendered `config/` modules (they
  import types and env readers only, so this costs nothing) to check that an
  unset key means no provider rather than one that fails on the first message.
- `packaging.spec.ts` holds the two facts about the package itself: templates
  excluded from all four tools, and zero runtime dependencies.

The end-to-end path (publish to a local registry → scaffold → install → migrate
→ build → boot) is not automated yet; see the PR that introduced this package
for the manual run.
