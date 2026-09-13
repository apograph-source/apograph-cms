# create-apograph-app

_Package · packages/create-apograph-app_

**The first ninety seconds with the product — one command, a working CMS**

The scaffolder is **the single entry point into the product for a new user**. `npx create-apograph-app my-cms` asks a few questions and leaves an application on disk that builds, migrates and runs without a single edit. Technically it is a generator with one template; as a product it is a shop window: it decides how Apograph is seen the first time, and what a person gets by default, choosing nothing.

- **59** packages classified
- **44** in the application core
- **4** choices in the wizard
- **42** files in the template
- **46** packages in the default application
- **4** applications produced
- **0** runtime dependencies

## Contents

- [01. Business description](#01-business-description)
- [02. Its place in the system, and why the package is unscoped](#02-its-place-in-the-system-and-why-the-package-is-unscoped)
- [03. The wizard and its choices](#03-the-wizard-and-its-choices)
- [04. Package classification in features.ts](#04-package-classification-in-featurests)
- [05. What comes out](#05-what-comes-out)
- [06. Flows — how it works, step by step](#06-flows-how-it-works-step-by-step)
- [07. Lockstep versioning and the release](#07-lockstep-versioning-and-the-release)
- [08. Invariants](#08-invariants)
- [09. Testing checklist](#09-testing-checklist)
- [10. Boundaries of responsibility](#10-boundaries-of-responsibility)
- [11. Discrepancies between code and documentation](#11-discrepancies-between-code-and-documentation)

## 01. Business description

Apograph ships as a set of npm packages rather than as a finished application. That is right in itself — an application is assembled from plugins, and its composition is the owner's decision. But such a delivery has a price: to _see_ the product you must first assemble it. The scaffolder removes that price entirely.

### The problem it solves

- **It removes day zero.** Between "heard about the CMS" and "seeing the admin UI on my laptop" there is one command, three short answers and `npm run dev`. No "first read up on how the composition root works".
- **It gives a consistent set of versions.** Every `@apograph/*` package is released in lockstep, and the scaffolder writes **its own version** into every dependency in the manifest. The application is consistent by construction rather than because somebody was watching.
- **It shows the reference composition.** The generated `plugins.ts` is not an "example" but a working composition root with comments explaining why the order is what it is. It doubles as the tutorial for adding a plugin of your own.
- **It makes the choice explicit where one exists and removes it where none does.** File storage, the copilot's backends, the content API's protocols, and sign-in through an external provider — four genuine decisions. Everything else, the copilot included, is installed unconditionally, because offering a choice where there is only one right answer means asking the user to guess.
- **It switches nothing on silently.** Both "expensive" decisions — sending content to an external model and opening a new endpoint — are off by default. The copilot is installed but with `COPILOT_ENABLED=false`; MCP, if chosen, with `MCP_ENABLED=false`.

### A first impression designed on purpose

#### Someone evaluating the product

Wants to see whether it is worth looking further. Gets a working admin UI with the content library, media, users and the log — and **zero** demo content types, that is, a blank sheet rather than somebody else's blog to clear out.

#### The developer who will maintain it

Gets the same four-application layout as the Apograph monorepo itself: `server`, `admin`, `server-e2e`, `admin-e2e`. Everything they read in the CMS's source sits in the same place in theirs.

#### CI and automation

The scaffolder never blocks on a question nobody is there to hear: with no TTY, or with `--yes`, the defaults are taken. Every question is mirrored by a flag.

### What the scaffolder is not

- **It is not an installer and not an upgrader.** It writes files once. Updating versions is the application owner's job (and is done wholesale, not piecemeal).
- **It is not a set of "blog / shop / landing page" templates.** There is exactly one template. It contains no content types at all — `ContentPlugin({ types: [] })` is valid and owns not one table, so the application migrates and starts before the first type exists.
- **It is not a configurator for everything.** It does not ask about roles, locales, limits or email: those are either product constants in `apograph.config.ts` or decisions made inside the admin UI later.
- **It is not a runtime.** After generation the package disappears from the application's life: it does not end up among the generated project's dependencies.

> **The key idea**
>
> The scaffolder **keeps no version list** and **never asks the registry for `latest`**. It reads its own version from its own `package.json` and substitutes it into every `@apograph/*` dependency as an exact value, with no caret. Two consequences follow: a release requires no template edit, and `npx create-apograph-app@0.3.0` reproducibly generates a 0.3.0 application rather than "whatever has shipped since".

## 02. Its place in the system, and why the package is unscoped

The monorepo has **60** publishable packages. Fifty-nine of them are `@apograph/*`. The sixtieth is `create-apograph-app`, the only unscoped one.

### Why the name has no scope

That is not a matter of style but a requirement of two npm entry points. Both forms work only with this name:

```
npx create-apograph-app my-cms
npm create apograph-app my-cms
```

`npm create <name>` expands into `npx create-<name>`, so the package name has to begin with `create-` and live in the root namespace. A package called `@apograph/create-app` would be reachable only as `npm create @apograph/app` — a form nobody types.

The decision has one price, and it is visible in `nx.json`: the release project list cannot simply be a glob.

```
"release": {
    "projects": [
        "@apograph/*",
        "create-apograph-app",
        "!@apograph/nx",
        "!@apograph/copilot-provider-fake"
    ],
    "projectsRelationship": "fixed"
}
```

`projectsRelationship: "fixed"` is the lockstep: every listed project shares one version and one tag. `@apograph/nx` (the internal Nx plugin) and `@apograph/copilot-provider-fake` (a private test fixture) are excluded explicitly.

### The only package that declares no runtime dependencies

In its `package.json` the `dependencies` field is empty, deliberately: `npx` downloads this package _before anything else_, and every dependency is seconds of waiting in the very first command a person types. So the terminal interface — the frames, the colour, the arrow-key and checkbox pickers — is written by hand in `src/lib/ui.ts` rather than with `prompts`/`clack`/`chalk`. The published tarball is not quite the manifest, though: `tools/release/pack.mjs` stamps `tslib` into every staged manifest, because `importHelpers` is on workspace-wide — so `npx` fetches two packages, not one.

### How the package relates to the rest of the monorepo

| Neighbour              | Relationship                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @apograph/cli          | The only `devDependency` the scaffolder writes into an application. The `dev/build/start/migrate/generate/studio` scripts are the `apograph` command. Its `LAYOUT` constants describe exactly the layout the template writes: `apps/server/tsconfig.json`, `apps/admin/vite.config.mts`, `dist/server/src/main.js`, `dist/admin` |
| @apograph/nx           | Never reaches an application: the migration and release targets are the monorepo's business, and a generated application gets them from the CLI                                                                                                                                                                               |
| tools/release/pack.mjs | Copies the `templates/` directory into staging as is and adds it to `files` — the same way it handles plugins' `migrations/` directories. It also rewrites `bin` from the source file to the compiled one                                                                                                                     |
| packages/\*/…          | Every publishable package must be classified in `src/lib/features.ts` — see section 4                                                                                                                                                                                                                                         |

### The template is data, not source code

The files under `templates/default` have the shape of an application: their own `tsconfig.json`, their own `package.json.tmpl`, their own `apograph.config.ts`. The monorepo's tooling has to know that, and it has to be told in **four** places — each of which broke at some point.

| Where                       | What would happen without it                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| .nxignore                   | The most expensive one. Nx walks every directory; `@apograph/nx` would infer a `db:migrate` target onto a directory with no project name, and **the project graph would stop building entirely** — meaning every `nx` command in the repository would die. `.nxignore` was chosen rather than an `exclude` on our own plugin: the same problem afflicts any inference plugin — `@nx/js/typescript`, say, would infer `typecheck` from the template tsconfigs |
| tsconfig.lib.json → exclude | `tsc --build` would compile the application's files against the monorepo's "resolve from source" setting                                                                                                                                                                                                                                                                                                                                                     |
| eslint.config.mjs → ignores | The same for linting                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| .prettierignore             | The template's JSON files hold tokens like `__APP_NAME__`; formatting them is meaningless                                                                                                                                                                                                                                                                                                                                                                    |

## 03. The wizard and its choices

The wizard has two parts. First three text questions about the project, then the block of feature choices, preceded by a line that sets the tone: _"Everything else is installed for you. These are the choices."_

> **The number of choices: code versus documentation**
>
> Both the root `AGENTS.md` and the package's own `AGENTS.md` speak of **three** questions (storage, copilot backends, protocols). In the code there are **four** groups: `MEDIA_PROVIDERS`, `COPILOT_PROVIDERS`, `SSO_PROVIDERS`, `PROTOCOLS`, and `resolveAnswers()` asks all four in a row; a comment in `ui.ts` says outright "the wizard asks four of these in a row", and `USAGE` lists the `--sso` flag. All four are described below, from the code. The discrepancy went into section 11.

### 3.0 The three text questions

| Question     | Default                                          | Validation                                                                                                                                    | Where it goes                                                                    |
| ------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| App name     | the target directory's name                      | `validateAppName`: non-empty, ≤ 214 characters, does not start with `.` or `_`, only lowercase letters, digits, dots, hyphens and underscores | `package.json → name`, the admin UI's title, the MCP connector's name            |
| Database URL | `postgresql://apograph:apograph@localhost:5432/<name>` | `validateDatabaseUrl`: parses as a URL, the protocol is `postgresql:` or `postgres:`, and the path contains a database name                   | `.env → DATABASE_URL`; the database name separately reaches `docker-compose.yml` |
| Admin email  | `admin@example.com`                              | none                                                                                                                                          | `.env → APOGRAPH_ROOT_ADMIN_EMAIL`                                                  |

A question with an invalid answer is asked again rather than failing: `askText` loops, printing the reason for the refusal. The app name is validated because it reaches the manifest verbatim, and npm refuses to install a project with an invalid name — with a message about the application rather than about the name the person just typed.

> **The administrator's password is not asked for**
>
> It is **generated**: `randomBytes(12).toString('base64url')`. A password typed at a prompt echoes into the terminal and settles in the shell history. This one is written only into `.env` (which is in `.gitignore`) and printed once in the closing frame.

### 3.1 Choice one — where uploaded files are stored

The `MEDIA_PROVIDERS` group, a single choice (radio). Flag `--media <id>`.

The media plugin always works; the only question is which adapter stands behind it. Exactly one — a deployment holds one storage, and that is the media plugin's own rule rather than the scaffolder's.

| id                | What it is                                                      | Package                    | Keys in `.env`                                                                                                    |
| ----------------- | --------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| media-local       | The local filesystem. **The default answer**                    | media-provider-local       | `MEDIA_LOCAL_ROOT` (defaults to `./.storage/media`)                                                               |
| media-s3          | S3-compatible: AWS S3, Cloudflare R2, MinIO, Spaces, B2, Wasabi | media-provider-s3          | `MEDIA_S3_BUCKET`, `MEDIA_S3_ENDPOINT`, `MEDIA_S3_REGION`, `MEDIA_S3_FORCE_PATH_STYLE`, and a pair of access keys |
| media-azure       | Azure Blob Storage                                              | media-provider-azure       | `MEDIA_AZURE_CONTAINER`, `MEDIA_AZURE_CONNECTION_STRING`                                                          |
| media-gcs         | Google Cloud Storage with native authentication                 | media-provider-gcs         | `MEDIA_GCS_BUCKET`, `MEDIA_GCS_PROJECT_ID`, `MEDIA_GCS_KEY_FILE`, `MEDIA_GCS_SIGN_WITH_IAM`                       |
| media-vercel-blob | Vercel Blob                                                     | media-provider-vercel-blob | `BLOB_READ_WRITE_TOKEN`                                                                                           |

#### What changes in the generated application

1. **The manifest.** Exactly one `@apograph/media-provider-*` appears in `dependencies`.
   _the other four are not installed at all_
2. **The factory import** in `apps/server/src/plugins.ts`: one `createLocalStorageProvider` / `createS3StorageProvider` / …
3. **One expression inside `MediaServerPlugin({ … })`.** In the template that is five mutually exclusive `apograph:if` blocks around the `provider` field; in the generated file one line remains. The comment beside it says it plainly: changing the backend means changing this expression.
4. **The configuration type.** In `apograph.config.ts` the `plugins.media.storage` field is typed with the chosen factory's type (`LocalStorageConfig` / `S3StorageConfig` / …), so the type and the factory move together and a mismatch is caught by the compiler.
5. **The block in `.env`** — only the chosen adapter's keys, with comments about their pitfalls (Vercel Blob's permanent public URL; S3's empty keys, which must not be filled in with empty strings or they will shadow the instance role).

> **The question may not appear**
>
> The wizard asks only when there is more than one available answer: `MEDIA_PROVIDERS.filter(p => p.available).length > 1`. The mechanism exists so as not to ask a "question" with only one possible answer. **Today all five adapters are marked `available: true`**, and `features.spec.ts` separately checks that S3 is offered ("now that it is implemented") — so the question is asked. An unavailable adapter is not hidden but drawn greyed with an `(unavailable)` note and skipped by the cursor: the picker tells the truth about what is coming.

### 3.2 Choice two — the AI copilot's backends

The `COPILOT_PROVIDERS` group, a multiple choice. Flag `--copilot <ids|none>`.

> **This is not the question "do you want a copilot"**
>
> The copilot itself is **core**: `copilot-server` and `copilot-admin` are in `CORE_PACKAGES`, and `CopilotPlugin` is registered on both sides of any generated application. The reason is technical and unavoidable: five core plugins (`content`, `i18n`, `media`, `segments`, `users`) depend on `copilot-server` in order to hand it their tools. The code will be on disk regardless — not declaring it would only buy us a missing chat panel. What is asked is **which model backends to add**.

| id                | What it is                                                                                 | Package                    | What registers the backend                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| copilot-anthropic | Claude (Anthropic), the native protocol                                                    | copilot-provider-anthropic | a non-empty `ANTHROPIC_API_KEY`; the models come from `COPILOT_ANTHROPIC_MODELS`, defaulting to `claude-sonnet-5` |
| copilot-openai    | Any endpoint speaking the OpenAI-compatible protocol: Ollama, vLLM, LiteLLM, Azure, OpenAI | copilot-provider-openai    | a non-empty `COPILOT_OPENAI_BASE_URL`; `COPILOT_OPENAI_MODELS`, `COPILOT_OPENAI_API_KEY`                          |

**Nothing is selected by default, and that is a substantive answer.** Switching a hosted provider on means sending a workspace's content to a third party — a decision ADR-0005 §10 requires to be made explicitly rather than received by default.

#### What changes in the generated application

1. **The manifest** gets the chosen provider packages — zero, one or two.
2. **The `copilotProviders(config)` function** in `plugins.ts` is assembled from `apograph:if` blocks: only the chosen providers' branches remain in it. Each branch adds a provider **only if its settings are present** in the configuration.
   _the array's order is the setting: the first registered one serves a run that named no provider; there is no defaultProvider field_
3. **The types in `apograph.config.ts`:** `AppCopilotConfig.providers` gets a `claude?` and/or an `openai?` field, and the environment reads sit under conditional blocks too.
4. **The keys in `.env`** — only the chosen providers'.
5. **`COPILOT_ENABLED=false` is always written**, whatever was chosen. The flag removes the `/api/copilot` route registration, so the application ships with the chat surfaces **absent** rather than present and refusing.

> **Why "none" is a legitimate answer**
>
> An application with no backends has the plugin installed and not one provider registered. There is **no** offline stub to fall back on: `copilot-provider-fake` is a private test fixture of the CMS repository, published nowhere. It used to be registered last in every generated application, and an installation with no keys answered any question with a canned phrase instead of an honest refusal. Now `COPILOT_ENABLED=true` with an empty provider list **stops the application from starting**.

### 3.3 Choice three — sign-in through an external provider (SSO)

The `SSO_PROVIDERS` group, a multiple choice, empty by default. Flag `--sso <ids|none>`.

An application without SSO signs in by email and password — the "invitation only" mode Apograph has always had. SSO is off by default not out of caution but because the scaffolder physically cannot guess it: it needs an issuer, a client id and a callback URL registered _on the other side_.

| id         | What it is                                                                                                   | Package                  | Why it is a separate package                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| sso-oidc   | Generic OpenID Connect: Okta, Auth0, Keycloak, Google, Entra ID, Authentik, Zitadel, JumpCloud, Ping, GitLab | identity-provider-oidc   | One entry covers almost the whole field — the named vendors are preset factories inside the package rather than separate packages. Pulls in `jose` |
| sso-github | GitHub and GitHub Enterprise Server                                                                          | identity-provider-github | OAuth2 **with no** identity token — the wire really is different                                                                                   |
| sso-saml   | SAML 2.0                                                                                                     | identity-provider-saml   | POST binding with XML signatures. Pulls in `@node-saml/node-saml`                                                                                  |

#### What changes in the generated application

There is an important asymmetry here between what is offered and what is wired up in the template.

1. **`sso-oidc` chosen.** The package is added to the manifest; `plugins.ts` gains a `createOidcProvider` import, the `SsoRegistration` type and an `ssoProviders(config)` function; `IdentityPlugin` is called with a **second argument**, `{ sso: { providers: ssoProviders(config) } }`, instead of the one-argument form; `apograph.config.ts` gains the `AppIdentityConfig.ssoProviders.oidc` type and reads of six variables; and `.env` gains an `SSO_OIDC_*` block.
   _the provider registers only when both SSO_OIDC_ISSUER and SSO_OIDC_CLIENT_ID are set — a sign-in button that can only fail is worse than no button_
2. **`sso-github` or `sso-saml` chosen.** The package is added to the manifest — and **nothing else**. There are no `apograph:if sso-github` or `apograph:if sso-saml` markers in any template file: no import, no registration, no environment variables. Wiring the adapter up is a manual job.
   _the USAGE text confirms it too: only sso-oidc is named in the flag's parentheses_
3. **Nothing chosen.** `IdentityPlugin(config.plugins.identity)` in its one-argument form. The shared handshake settings (`SSO_PUBLIC_BASE_URL`, `SSO_REQUEST_TTL_SECONDS`) are written into `.env` anyway — they are unconditional.

### 3.4 Choice four — which protocols the content API speaks

The `PROTOCOLS` group, a multiple choice. Flag `--protocols <ids|none>`.

| id      | State                                             | Package         | What it gives                                                                              |
| ------- | ------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------ |
| rest    | **locked** — ticked, muted, skipped by the cursor | none            | `/api/v1/…` — the API everything else adapts                                               |
| graphql | off by default                                    | content-graphql | `POST /api/v1/graphql`: the same bearer tokens, the same scopes, the same visibility rules |
| mcp     | off by default                                    | mcp-server      | `POST /api/v1/mcp` — an external agent does content CRUD with an API token                 |

**Why REST is shown rather than hidden.** "Which protocols does this application speak?" is a more useful question than "do you want these two add-ons", and the answer reads as a complete set only if what you always get is in it. `--protocols none` still gives REST: `lockedOf()` adds the locked ids to any answer, and no flag turns that off. In the picker such a row is drawn as `[x] REST (always on)` and does not accept the space bar.

Neither add-on brings credentials of its own: GraphQL is a protocol adapter over the same REST API's services (ADR-0008), and MCP reuses the same API tokens and scopes. They are optional simply because an endpoint nobody asked for is still an endpoint.

#### What changes in the generated application

#### GraphQL chosen

The package in the manifest; a `ContentGraphqlPlugin` import; an entry in the plugin array **immediately after** `ContentViewsPlugin`, receiving `content` by value and `playground: config.docs.enabled === true`; a "GraphQL" section in the README. Passing the whole plugin rather than only the types is what lets it fail at startup over two content types whose names would collide in GraphQL, rather than on the first request from a workspace granted both.

#### MCP chosen

The package in the manifest; a `McpPlugin` import; an entry **last** in the plugin array, because MCP exposes what the plugins above it put in; the `McpPluginConfig` type and a `plugins.mcp` block in the configuration (the connector's name, `callTimeoutMs`, `maxResultBytes`); an `MCP_ENABLED=false` block in `.env`; an "MCP" section in the README.

> **Optional means "not registered", not "not installed"**
>
> `content-server` depends on `mcp-server`, so the package physically sits in any generated application's `node_modules`, whatever the user chose. The difference is that the plugin is absent from `plugins.ts` and its block from `apograph.config.ts`. Which is exactly why the default application answers `/api/v1/mcp` with an honest `404` rather than failing on an unresolved import.

### 3.5 How the picker itself works

- **Not one dependency.** `ui.ts` — the frames, SGR colour, and redrawing in place with `CSI nA` + `CSI 2K`.
- **The arrows and `j`/`k`** move the cursor, the space bar toggles a checkbox, Enter confirms, and Escape and Ctrl-C cancel. Cancelling in a multi-select means "take the defaults" rather than "nothing selected".
- **The cursor skips** `disabled` and `locked` rows — they cannot be reached from either direction, wrap-around included.
- **A multi-select with nothing to touch** (every row locked or unavailable) is not drawn at all: it immediately returns what is already ticked.
- **Colour switches itself off** under `NO_COLOR`, `TERM=dumb` or with no TTY.
- **There is one hazard, and it is handled:** the picker puts stdin into raw mode, and a process that exits in raw mode leaves the terminal with no echo — the user has to type `reset` blind. The restoration lives in a `finally`.
- **Listeners rather than `for await`.** A Node stream's iterator destroys the stream on an early exit from the loop: the first picker would answer fine and take stdin with it, and the next would draw its rows and fail with an `AbortError` before the first keypress. There are four questions in a row, so stdin has to stay readable.

### 3.6 Non-interactive mode

The wizard asks only if `!--yes && process.stdin.isTTY && process.stdout.isTTY`. Otherwise the defaults are taken, and the flags override them per group. This is not an emergency mode but CI, a pipeline and `--yes`: a scaffolder hanging on a prompt nobody is there to see hangs the job until it times out — a far worse failure than taking a default.

```
npx create-apograph-app my-cms [options]

  --yes             Accept every default, asking nothing
  --media <id>      The storage adapter (defaults to media-local)
  --copilot <ids>   Comma-separated copilot providers, or "none"
  --sso <ids>       Comma-separated sign-in providers (sso-oidc), or "none"
  --protocols <ids> Protocols beyond REST (graphql, mcp), or "none"
  --no-install      Do not install dependencies
  --no-git          Do not initialise a git repository
  -h, --help        Show the help
```

Flags are read in two forms — `--name=value` and `--name value`. The value `none` means an empty selection; for protocols, "empty" still gives REST.

## 04. Package classification in features.ts

The file `src/lib/features.ts` calls itself, in its own header, **the contract between the release and the scaffolder**. Every publishable `@apograph/*` package is accounted for here exactly once, and a test fails the build when it is not.

### Four buckets, and no third option

| Bucket              | Meaning                                                                  | How many now |
| ------------------- | ------------------------------------------------------------------------ | ------------ |
| CORE_PACKAGES       | Every application gets it, whatever it chose                             | 44           |
| CORE_DEV_PACKAGES   | Needed for the application to build and run; goes into `devDependencies` | 1            |
| Feature.packages    | Installed when the corresponding capability is chosen                    | 12           |
| TRANSITIVE_PACKAGES | An internal detail of another package; deliberately not declared         | 2            |

That is **59** in total — exactly the number of `@apograph/*` packages the monorepo publishes. The sixtieth publishable package is `create-apograph-app` itself, and it does not classify itself.

### The mechanism that forces a decision

There are two rules for maintaining the template, and both are held by tests rather than by memory.

#### A release requires no template edit

There is not one version in `features.ts`. Every dependency is written as `__APOGRAPH_VERSION__` and stamped with the scaffolder's version at render time. A version list that could fall behind simply does not exist.

#### Adding a package does

`features.spec.ts` enumerates the `packages/` directory on disk and fails on any unclassified name. A new package cannot merge into the main branch until somebody has decided whether a new application gets it.

The guard's value lies in what does _not_ happen without it. Without it the template simply falls a release behind: the package is published, nothing references it, and nobody notices until a user asks why they do not have the feature they read about.

#### How the check itself works

1. **Enumerating reality.** `publishedPackages()` walks `packages/*` and `packages/*/*`, reads every `package.json` and takes the names beginning with `@apograph/` and not marked `private`. The source of truth is the disk, not a list.
   _a directory with no manifest is silently skipped_
2. **Enumerating intent.** The `classified` set is the union of `CORE_PACKAGES`, `CORE_DEV_PACKAGES`, `TRANSITIVE_PACKAGES` and every `Feature.packages`.
3. **Every package is classified.** `it.each(publishedPackages())('%s is classified')` — one test per package, so the report shows _which_ package was forgotten. The comment says outright what to do.
4. **Nothing extra.** The reverse check: the classification holds no name absent from the disk (the exception is `@apograph/cli`, which reaches an application as a dev dependency).
5. **No package is in two buckets at once.** The concatenation's length is compared against the set's size.
6. **The list of "what an application does not get by default" is pinned in full.** A separate test compares the difference between published and installed against an explicit list — so "what does choosing nothing cost me?" has a written answer that cannot be changed silently.

> **Everything reachable is declared**
>
> The extension points (`content-domain`, `copilot-domain`, `tools-server`, `query-builder-admin`, `identity-domain`) and the shared tooling (`design-system`, `utils-admin`, `utils-server`) are in the core even though they arrive transitively and undeclared. Declaring them is what makes the import's resolution **the application's property** rather than a favour: an undeclared import works exactly until the first version conflict nests a second copy, and never works under pnpm. That is what a phantom dependency means.

### The full classification — 59 packages

Built from `features.ts` verbatim. The "in the default application" column is the answer for `npx create-apograph-app my-cms --yes`.

| Package (`@apograph/`…)    | Bucket                                | What it is                                                                                                                                            | By default                          |
| -------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| activity-admin             | CORE_PACKAGES                         | The activity log screen                                                                                                                               | yes                                 |
| activity-server            | CORE_PACKAGES                         | The activity log: the outbox subscriber and its table                                                                                                 | yes                                 |
| alarms-admin               | CORE_PACKAGES                         | The alarms page, the rule editor, three contributions into the content library's slots                                                                | yes                                 |
| alarms-server              | CORE_PACKAGES                         | Alarm rules and findings, the evaluator, the periodic sweep                                                                                           | yes                                 |
| api-tokens-admin           | CORE_PACKAGES                         | The screen for issuing and revoking external API tokens                                                                                               | yes                                 |
| bootstrap-admin            | CORE_PACKAGES                         | The admin host: createAdmin({ plugins })                                                                                                              | yes                                 |
| bootstrap-server           | CORE_PACKAGES                         | The API host: createServer({ plugins })                                                                                                               | yes                                 |
| cli                        | CORE_DEV_PACKAGES                     | The apograph command: dev / build / start / migrate / generate / studio                                                                                  | yes, as a devDependency             |
| content-admin              | CORE_PACKAGES                         | The content library: entry lists, the editor, the slots                                                                                               | yes                                 |
| content-domain             | CORE_PACKAGES                         | An extension point: the content core's framework-free types                                                                                           | yes                                 |
| content-graphql            | PROTOCOLS · graphql                   | The same content API over GraphQL                                                                                                                     | no                                  |
| content-server             | CORE_PACKAGES                         | Content: the type registry, the public REST API, the agent tools                                                                                      | yes                                 |
| copilot-admin              | CORE_PACKAGES                         | The docked chat panel and the full-page Agents view                                                                                                   | yes                                 |
| copilot-domain             | CORE_PACKAGES                         | An extension point: the ModelProvider port and the proposal contracts                                                                                 | yes                                 |
| copilot-provider-anthropic | COPILOT_PROVIDERS · copilot-anthropic | The Claude adapter (the only one allowed a vendor SDK)                                                                                                | no                                  |
| copilot-provider-openai    | COPILOT_PROVIDERS · copilot-openai    | The adapter for an OpenAI-compatible endpoint                                                                                                         | no                                  |
| copilot-server             | CORE_PACKAGES                         | The copilot plugin: the SSE run route, the engine, the write path                                                                                     | yes                                 |
| database                   | CORE_PACKAGES                         | The single Drizzle/pg connection, UnitOfWork, the transactional outbox                                                                                | yes                                 |
| design-system              | CORE_PACKAGES                         | The UI primitive library built on shadcn/ui                                                                                                           | yes                                 |
| i18n-admin                 | CORE_PACKAGES                         | Locales in the entry editor                                                                                                                           | yes                                 |
| i18n-server                | CORE_PACKAGES                         | Content locales and their extensions                                                                                                                  | yes                                 |
| identity-admin             | CORE_PACKAGES                         | The sign-in and one-time-link screens, AuthProvider, RequireAuth                                                                                      | yes                                 |
| identity-domain            | CORE_PACKAGES                         | An extension point: the SsoProvider port                                                                                                              | yes                                 |
| identity-provider-fake     | CORE_PACKAGES                         | A scripted sign-in provider: no tenant, no network — for offline checking                                                                             | yes                                 |
| identity-provider-github   | SSO_PROVIDERS · sso-github            | GitHub / GitHub Enterprise                                                                                                                            | no                                  |
| identity-provider-oidc     | SSO_PROVIDERS · sso-oidc              | OpenID Connect plus vendor presets                                                                                                                    | no                                  |
| identity-provider-saml     | SSO_PROVIDERS · sso-saml              | SAML 2.0                                                                                                                                              | no                                  |
| identity-server            | CORE_PACKAGES                         | Authentication, RBAC, sessions, API tokens, the SSO core                                                                                              | yes                                 |
| insights-admin             | CORE_PACKAGES                         | The dashboard and its default sections                                                                                                                | yes                                 |
| mcp-server                 | PROTOCOLS · mcp                       | The Model Context Protocol endpoint                                                                                                                   | no                                  |
| media-admin                | CORE_PACKAGES                         | The media library and file picking from the editor                                                                                                    | yes                                 |
| media-domain               | CORE_PACKAGES                         | An extension point: the storage port and its errors, declaring no dependencies of its own — which is what makes installing an adapter cost an adapter | yes                                 |
| media-provider-azure       | MEDIA_PROVIDERS · media-azure         | Azure Blob Storage                                                                                                                                    | no                                  |
| media-provider-gcs         | MEDIA_PROVIDERS · media-gcs           | Google Cloud Storage                                                                                                                                  | no                                  |
| media-provider-local       | MEDIA_PROVIDERS · media-local         | The local filesystem                                                                                                                                  | yes, unless the adapter was changed |
| media-provider-memory      | TRANSITIVE_PACKAGES                   | In-memory storage — testing and offline development, never a deployment                                                                               | no                                  |
| media-provider-s3          | MEDIA_PROVIDERS · media-s3            | S3-compatible storage                                                                                                                                 | no                                  |
| media-provider-testkit     | TRANSITIVE_PACKAGES                   | The contract check suite storage adapters are run against                                                                                             | no                                  |
| media-provider-vercel-blob | MEDIA_PROVIDERS · media-vercel-blob   | Vercel Blob                                                                                                                                           | no                                  |
| media-server               | CORE_PACKAGES                         | Media: uploads, serving, the storage port                                                                                                             | yes                                 |
| query-builder-admin        | CORE_PACKAGES                         | An extension point: the filter builder                                                                                                                | yes                                 |
| segments-admin             | CORE_PACKAGES                         | The audience directory and an entry's Access tab                                                                                                      | yes                                 |
| segments-domain            | CORE_PACKAGES                         | The segments core: canRead and the admission rules                                                                                                    | yes                                 |
| segments-server            | CORE_PACKAGES                         | The two segment tables and the read predicate via CONTENT_READ_SCOPE                                                                                  | yes                                 |
| shell-admin                | CORE_PACKAGES                         | The admin shell: the sidebar, the single layout, the auth gate                                                                                        | yes                                 |
| tools-server               | CORE_PACKAGES                         | An extension point: the shared agent tool registry                                                                                                    | yes                                 |
| transfer-admin             | CORE_PACKAGES                         | The export and import dialogs, three slot contributions                                                                                               | yes                                 |
| transfer-domain            | CORE_PACKAGES                         | The transfer core: the exchange document, four formats, natural keys                                                                                  | yes                                 |
| transfer-server            | CORE_PACKAGES                         | The export/import routes, the graph walk, the ZIP container                                                                                           | yes                                 |
| users-admin                | CORE_PACKAGES                         | Members: invitations, disabling, reset links                                                                                                          | yes                                 |
| users-server               | CORE_PACKAGES                         | The server side of member management                                                                                                                  | yes                                 |
| utils-admin                | CORE_PACKAGES                         | Shared admin tooling: apiClient, slots, table state in the URL                                                                                        | yes                                 |
| utils-server               | CORE_PACKAGES                         | Shared server tooling: filter parsing and the rest                                                                                                    | yes                                 |
| webhooks-admin             | CORE_PACKAGES                         | The global webhooks pages in the directory group                                                                                                      | yes                                 |
| webhooks-domain            | CORE_PACKAGES                         | The webhooks core: the event catalogue, the subscription filter, the signed envelope, the URL policy                                                  | yes                                 |
| webhooks-server            | CORE_PACKAGES                         | Webhooks: three tables, the outbox subscriber, the delivery worker                                                                                    | yes                                 |
| workspaces-admin           | CORE_PACKAGES                         | Workspaces and the sidebar switcher                                                                                                                   | yes                                 |
| workspaces-server          | CORE_PACKAGES                         | Workspaces and membership                                                                                                                             | yes                                 |
| wysiwyg-admin              | CORE_PACKAGES                         | The rich-text editor and its styles                                                                                                                   | yes                                 |

### What the default application leaves out

Exactly **eleven** packages, and the list is pinned in full by a test: `content-graphql`, `copilot-provider-anthropic`, `copilot-provider-openai`, `identity-provider-github`, `identity-provider-oidc`, `identity-provider-saml`, `mcp-server`, `media-provider-azure`, `media-provider-gcs`, `media-provider-s3`, `media-provider-vercel-blob`. Plus the two `TRANSITIVE_PACKAGES`, which are never installed.

> **Why media-provider-memory is deliberately not offered**
>
> Both transitive packages are tools _for writing_ a storage provider rather than for running one. `StorageProviderCheck` refuses to bring up a database whose rows were written by a provider that is no longer configured, so in-memory storage is for tests and offline development but never a deployment: offering it in the scaffolder would mean offering an application that loses every upload on restart. Putting the package in this bucket is a decision the guard forces; forgetting it entirely is not.

### What the manifest is made of

`resolvePackages(selection)` is the `CORE_PACKAGES` set plus each enabled capability's packages, sorted. `resolveFlags(selection)` is simply the set of chosen ids, with no derived values: what the `apograph:if` blocks are checked against.

```
--yes  →  44 (core) + 1 (media-provider-local)  = 45 in dependencies
       →  1 (@apograph/cli)                      =  1 in devDependencies
46 @apograph packages in total — exactly the number the wizard's closing frame prints
```

It matters that the dependencies are assembled **in code** rather than by conditional blocks inside `package.json.tmpl`. Dropping lines out of JSON is a way to get a trailing comma and an application that cannot even be installed, with the error blaming the template rather than the capability that was switched off.

## 05. What comes out

There is one template — `templates/default`, **42** files. It is a working CMS **with not one content type**: the user describes their own. `ContentPlugin({ types: [] })` is valid and owns no tables, so the application migrates and starts before the first type exists.

### The structure

```
my-cms/
├── package.json            one package, NOT npm workspaces
├── tsconfig.json           references to the five projects (the server twice: build, specs)
├── docker-compose.yml      Postgres 17-alpine with the right database name
├── .env                    the only file with secrets, and it is in .gitignore
├── .gitignore
├── README.md
└── apps/
    ├── server/             apograph.config.ts, config/ (one module per plugin),
    │                       src/{main,plugins}.ts, plugins.spec.ts,
    │                       jest.config.js, jest.setup.js, tsconfig.spec.json
    ├── admin/              index.html, vite.config.mts,
    │                       src/{main.tsx,plugins.ts,plugins.spec.ts,styles.css}
    ├── server-e2e/         jest.config.js, src/{api.spec,global-setup,
    │                       jest.setup,support/{db,test-app}}
    └── admin-e2e/          playwright.config.ts, src/{auth.spec,support/seed}
```

**The same four applications the monorepo itself is built from.** Anyone who has read Apograph's source finds the same shape in their own project, and the `LAYOUT` constants in `@apograph/cli` get to describe one tree rather than two.

> **One package.json, deliberately**
>
> Not npm workspaces. Workspaces would let the two halves resolve **different copies** of a shared package, and `pack.mjs` pins internal dependencies for the release — so splitting risks two instances of `@apograph/design-system`: two React contexts and an interface that silently stops talking to itself.

### The application's scripts

| Script    | Command           | What it does                                                                |
| --------- | ----------------- | --------------------------------------------------------------------------- |
| dev       | apograph dev         | The compiler in watch mode, `node --watch` and the Vite dev server together |
| build     | apograph build       | Compiles the server and bundles the admin UI                                |
| start     | apograph start       | One process: the API **and** the admin UI, one origin                       |
| migrate   | apograph migrate     | Applies each plugin's pending migrations                                    |
| generate  | apograph generate    | Generates a migration for the application's own content tables              |
| studio    | apograph studio      | Drizzle Studio on this application's database                               |
| test      | jest + vitest     | Unit tests for both halves                                                  |
| e2e       | jest + playwright | Both end-to-end suites                                                      |
| typecheck | tsc --build       | Both TypeScript projects                                                    |

### Three differences from the monorepo's `apps/*`

Each follows from the application consuming packages from npm rather than from source.

#### No webpack

Only `tsc`, so `node_modules` stays on disk and calls like `join(__dirname, '../../../migrations')` inside each plugin keep resolving.

#### `@source` for Tailwind

Tailwind excludes `node_modules` from content auto-detection. Without the line `@source "../../../node_modules/@apograph";` the whole admin UI renders **unstyled**, and nothing fails.

#### `staticDir`

One process serves both the API and the admin UI from one origin. In the monorepo Vite separates them; a deployment has no dev proxy, and identity's `SameSite=lax` session cookie needs the same origin.

> **Why @source must be a bare directory**
>
> An `@source` with a glob in it still passes through the ignore rules, `node_modules` among them. A pattern such as `@apograph/*/dist/**/*.js` matches nothing, and the output is a stylesheet consisting of one theme block — about 15 kB, with no component utilities. Only a literal directory path registers as an explicit content root that bypasses those rules. The test checks both the exact string and the absence of an asterisk.

### The server's composition root

`apps/server/src/plugins.ts` is the application's most substantive file. Its comment states the rule: **the array's order is the migration order**. Migrations are applied by walking the array, with no transaction spanning plugins, so a plugin whose tables reference another's must come later. `WorkspacesPlugin` follows `IdentityPlugin` because its `memberships` references `users`: put them the other way round and a **fresh** migration fails with `relation "users" does not exist`, while an already-migrated database sails through. So the mistake ships and bites the next clean installation rather than its author.

The order does **not**, however, settle any dependency-injection questions: each plugin's module is global, and every `onPluginInit` runs before the Nest application is created.

```
database → identity → workspaces → activity → users
        → content → content-views [→ content-graphql]
        → i18n → alarms → media → copilot [→ mcp]
```

`DatabasePlugin` comes first — the only plugin that opens a resource in `onPluginInit`. `McpPlugin`, if chosen, comes last: it exposes what the plugins above it put in.

### The admin UI's composition root

In `apps/admin/src/plugins.ts` exactly two positions matter. `IdentityPlugin` is first — it brings the only **public** routes (sign-in and accepting an invitation), which must render outside the closed layout. `ShellPlugin` is second — it is the only one that supplies a `layout`, and the host mounts the **first one it finds**; the shell's layout is what composes identity's auth gate. A plugin that registered its own layout earlier would render every private route **unguarded**, and an authorisation bug would look like broken markup.

The rest is ordering for readability: the slots are module-level singletons and are filled before the first render.

### Configuration: where the application reads its environment

`apps/server/config/` is that place — one module per plugin, each exporting a builder, with `apps/server/apograph.config.ts` assembling them into the typed literal the host is handed. So the file at the top is the table of contents (what this application runs, in one screen), and the one module that owns a setting is where its derivation is read. Everything downstream receives typed values, so "where did this setting come from" still has exactly one answer.

The readers themselves are **not** written there: `config/` touches `process.env` nowhere and goes through `@apograph/utils-server` instead, so _how_ a value is parsed is decided once for the monorepo and for every generated application at the same time. Four of them carry the reasoning:

- `requireEnv(name)` — fails at load time rather than a few seconds after startup. A missing `DATABASE_URL` resolved to `''` would reach `pg` as "use libpq's defaults", and the first request would fail with a message naming not one unset variable.
- `readPositiveInt(name, fallback)` — deliberately **not** `Number(x) || fallback`, which is wrong in three directions at once and silent in all of them: `0` is falsy and is replaced by the default, a negative number is truthy and accepted (a negative session TTL issues sessions already expired), and `1e9` parses.
- `readTrustProxy()` — a hop count (the recommended form, which a client cannot forge), a boolean, or a preset string.
- `readEnv(name)` — where "an empty value means the setting is absent" is decided, and the reason that rule holds everywhere. The generated `.env` ships keys with nothing to the right of the `=`, so a raw `process.env['X'] ?? fallback` would let a blank line beat the default. It is what a copilot backend and an SSO provider are configured through: an unset key yields no settings object, and therefore no registered provider, rather than one that fails on the first message.

`NODE_ENV` is checked separately, through `isProduction()` over `readNodeEnv()`: that one comparison governs two protections at once — whether the API reference is published and whether the session cookie carries the `Secure` flag — so a typo would silently switch both off and be indistinguishable from a correct setting. A value outside the `development / test / production` list fails the start; unset is legitimate — the common local state — and reads as "not production".

### The tests that ship with the application

A starter set that cannot be tested teaches people not to test. So the application carries four suites and **two** runners — an honest answer rather than a compromise: each half has its own toolchain, and no single transform serves both.

| Suite                                | Runner                                              | Why that one                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| apps/server/\*\*/\*.spec.ts          | Jest + `@swc/jest`                                  | NestJS's DI reads `emitDecoratorMetadata`; Vitest's esbuild transform does not emit it, and providers resolve to `undefined` with no error naming the cause |
| apps/admin/src/\*\*/\*.spec.{ts,tsx} | Vitest + jsdom, configured inside `vite.config.mts` | It is a Vite application; a shared configuration is the only way the tests and the application resolve modules identically                                  |
| apps/server-e2e                      | Jest + supertest, a real Postgres                   | Boots **this** application through `createServer`: a harness that repeats the bootstrap cannot fail on a bootstrap defect                                   |
| apps/admin-e2e                       | Playwright, the Vite dev server, `/api` mocked      | Exercises the interface with no backend: fast, hermetic, and a failure means the interface is wrong                                                         |

The shipped specs check what breaks quietly — **the plugin lists and their order**. They are feature-aware: the expected server list itself carries `apograph:if` blocks for `content-graphql` and `mcp`, so it stays correct whatever the wizard was answered.

<details>
<summary>The server e2e database — four things that took more than one attempt</summary>

The suite manages its own database: `<database>_e2e` is created and migrated on the first run through `applyPluginMigrations` — the same function `apograph migrate` calls, so the test runs against the real schema rather than a hand-made copy of it.

- **Deriving the name is idempotent.** `global-setup` runs in Jest's main process and rewrites `DATABASE_URL`; the workers fork from it and inherit the value — naively appending the suffix would give a worker `app_e2e_e2e`, and every test would fail against a database nobody created.
- **`global-setup` imports the configuration dynamically.** A static import hoists above any statement, so it would run before `.env` was loaded and before the URL was redirected — and the suite would fail on a variable sitting two lines below in the file.
- **`transformIgnorePatterns` un-ignores `@scalar`.** `createServer` pulls in the API reference renderer, published only as ESM, while Jest is CommonJS: without this the run dies on `Unexpected token 'export'` in a file nobody in the application wrote.
- **`assertDisposable` refuses a development database.** The suite `TRUNCATE`s every table, and `E2E_DATABASE_URL` can be pointed anywhere. The check runs _before_ the first `TRUNCATE`.

Three more details: `jest.setup.js` supplies placeholders because the specs import `apograph.config.ts`, which deliberately refuses to load without a `DATABASE_URL` (nothing connects in the process — the plugin list is a pure function of the configuration, so `npm test` works in CI with no `.env`); `apps/server/tsconfig.json` excludes `**/*.spec.ts`, or `apograph build` compiles the tests into `dist/server` and ships them; and the Vite config is named `.mts` because the application is declared `"type": "commonjs"` and Vite complains about ESM syntax in a CJS config. And the server e2e specs read `ALLOWED_ORIGIN` from the configuration, because sign-in is protected by an allowed-origin list that follows `ADMIN_PORT`: a hardcoded `:4200` would fail on any application with a different admin port — as an inscrutable `403` rather than as "wrong origin".

</details>

## 06. Flows — how it works, step by step

### 6.1 Creating an application

1. **The run.** `npx create-apograph-app my-cms`. The target path is the first positional argument, otherwise the current directory. A frame with the path is printed.
   _a long path is truncated from the front: the tail is what identifies it_
2. **The directory check.** `isNonEmptyDirectory(target)` — an existing non-empty directory means a refusal with text explaining what to do. The scaffolder never writes over somebody else's files.
3. **Resolving the answers.** With a TTY and no `--yes`, the three text questions and four pickers are asked. Otherwise the defaults are taken, overridden by flags. Locked ids (`rest`) are added to any answer.
4. **Generating the administrator's password.** `randomBytes(12).toString('base64url')`. It is never asked for at a prompt.
5. **The summary frame.** The name, the database, the storage, the protocols, the copilot, sign-in, and the number of `@apograph` packages. An empty multi-selection is printed as a muted `none` / `no backend` — so the absence of a choice is shown rather than hidden.
6. **Rendering the template.** `renderTemplate(templates/default, target, values)`: walking every file, applying `apograph:if`, substituting `__PLACEHOLDER__`, renaming. The manifest takes another path — through `renderManifest`.
   _files outside the text-extension list are copied byte for byte: running a favicon through a string replacement would corrupt it in a way visible only in a browser_
7. **`git init --quiet`**, if a `.git` directory does not already exist and `--no-git` was not passed.
8. **`npm install --no-audit --no-fund`**, unless `--no-install` was passed. A failed install does not pretend to be a success: the error is printed and `process.exitCode = 1` is set, but the files stay where they are — the install can be finished by hand.
9. **The credentials frame** — the email, the password and a reminder that it is written into `.env`.
10. **The next steps:** `cd my-cms`, `docker compose up -d`, `npm run migrate`, `npm run dev`.

#### What the render actually does to each file

1. **Conditional blocks.** `applyConditionals(raw, flags, file)`: the marker lines are always removed, and the body stays only if the condition holds. Blocks nest, and an inner block inside a discarded one stays discarded.
2. **Collapsing blank runs.** A removed block almost always leaves a blank line next to the one that followed it. Without `collapseBlankRuns` every generated file would carry a scar where a capability was switched off — and that is the first thing a person opens.
3. **Substitution.** Seven tokens: `__APP_NAME__`, `__APP_TITLE__`, `__DATABASE_URL__`, `__DATABASE_NAME__`, `__ADMIN_EMAIL__`, `__ADMIN_PASSWORD__`, `__APOGRAPH_VERSION__`. **Every** occurrence is replaced, not the first.
4. **Renames.** `_gitignore → .gitignore`, `env.tmpl → .env`, `package.json.tmpl → package.json`, `README.md.tmpl → README.md`.

> **Two renames, each covering a silent failure**
>
> **`_gitignore`.** npm _silently_ refuses to publish a file named `.gitignore`. A template carrying such a file ships in the tarball without it, and every generated application begins by offering to commit `node_modules`. And nothing in the tarball looks wrong. create-vite and create-next-app use the same workaround.
>
> **`*.tmpl`.** Keeps `package.json` out of the root manifest's `workspaces` globs, which would otherwise read the template directory as a separate package.

### 6.2 The first run

1. **Bring up Postgres.** `docker compose up -d` — the `postgres:17-alpine` image, user and password `apograph`, the database name taken from the URL that was entered, a healthcheck through `pg_isready`, and a `postgres-data` volume.
2. **Apply the migrations.** `npm run migrate` → `apograph migrate`: a walk over the plugin array, each with its own migration bookkeeping table. This is the step where a wrong plugin order would show itself.
3. **Run it.** `npm run dev`: the server's watch compilation, `node --watch` and the Vite dev server. The admin UI on `:4200`, the API on `:3000`, with `/api` proxied to the API — the browser sees one origin and the session cookie is first-party with no CORS.
   _the proxy key is the regular expression ^/api/ rather than a string: a string prefix would swallow the SPA route /api-tokens too_
4. **Sign in.** The email and password from `.env`. The account is provisioned at startup idempotently and non-destructively — an existing account is left alone. The README advises clearing both variables as soon as sign-in works.
5. **What is visible immediately.** The dashboard, the content library with an empty type registry, the media library, workspaces, members, the activity log, API tokens, alarms. There is no chat — `COPILOT_ENABLED=false` removes the route registration, and the surfaces are absent rather than refusing.
6. **The API reference.** `http://localhost:3000/reference` — on outside production by default.

#### Adding your own content types

1. Describe the types and export a `contentTypes` array.
2. Pass them into `ContentPlugin({ types: contentTypes, migrations: … })` — the descriptor's exact shape is in a comment inside `plugins.ts` itself.
3. Add a `drizzle.config.ts` pointing `schema` at the types file and `out` at the migrations directory.
4. `npm run generate -- --name=add_content_types && npm run migrate`.

### 6.3 Adding a new package to the monorepo and taking it through features.ts

This is the flow the guard in section 4 exists for. It always begins with a failing test.

1. **The package is created** in `packages/<group>/<name>` with a manifest named `@apograph/<group>-<name>` and no `"private": true`.
2. **`npx nx test create-apograph-app` fails.** One named case: `@apograph/<name> is classified`. The comment beside it says what to do.
   _a package with "private": true is not picked up by the enumeration — privacy is a decision too, just one already made_
3. **Make the decision.** Three possible answers, exactly one of them right: does _every_ new application get this package; is it installed along with some capability; or is it an internal detail of another package that need not be declared.
4. **Core.** Add the name to `CORE_PACKAGES`, in alphabetical order. If the package has a plugin that must be registered, add it to `templates/default/apps/server/src/plugins.ts` or `apps/admin/src/plugins.ts` **and to the expected list in the corresponding `plugins.spec.ts`**, or the generated application's tests will stop passing.
5. **A capability.** Add a `Feature` object to the right group — `id`, `label`, `hint`, `packages`, `enabledByDefault`, `available`. A new group also means a question in `resolveAnswers()`, a flag in `USAGE` and a line in `describeSelection()`.
6. **Wire up the template.** The import and the registration under `apograph:if <id>`; the environment variables under the same marker in `env.tmpl`; the types and the environment reads in `apograph.config.ts`; a section in `README.md.tmpl` under an HTML comment `<!-- apograph:if <id> -->`.
7. **Transitive.** Add it to `TRANSITIVE_PACKAGES` and write in the doc block _why_ an application has no reason to import it. The guard will not let you forget it entirely; it will let you put it here.
8. **Update the pinned list.** The "leaves exactly the choosable packages out of a default app" test enumerates the exclusions verbatim; a new optional package has to be added to it. That is not a formality: the list is the written answer to "what does choosing nothing cost me".
9. **Run the tests.** `npx nx test create-apograph-app` — package coverage, the conditional-block processor and the generated output for several combinations.

### 6.4 How the conditional blocks work

One template serves every combination through three directives — `apograph:if`, `apograph:ifnot`, `apograph:end` — in any comment syntax, so the same thing works in TypeScript, YAML, `.env`, CSS, HTML and Markdown.

```
// apograph:if copilot-anthropic
import { createAnthropicProvider } from '@apograph/copilot-provider-anthropic';
// apograph:end

# apograph:ifnot graphql
# (REST only — the GraphQL endpoint is not mounted.)
# apograph:end

<!-- apograph:if mcp -->
### MCP
<!-- apograph:end -->
```

The mechanism is deliberately line-based rather than an expressive language: templates are read far more often than they are written, and somebody opening `plugins.ts` should see a real file with a few comments rather than a templating dialect. Every condition needed here is "is this capability enabled".

> **An unclosed block throws**
>
> And that is the only correct behaviour. A missing `apograph:end` in `plugins.ts` would silently swallow the rest of the file — every plugin below it — and the application would **boot with no API** instead of failing to build. Symmetrically: an `apograph:end` with no opening block also throws.

## 07. Lockstep versioning and the release

### The mechanism in one paragraph

The scaffolder reads its own version from its own manifest (`ownVersion()`) and substitutes it into every `@apograph/*` dependency of the generated application. Since the release is lockstep, its version **is** the compatible set. Hence `npx create-apograph-app@0.4.0` generates a 0.4.0 application.

### Three properties that follow

#### An exact pin, no caret

`"@apograph/content-server": "0.4.2"`, not `"^0.4.2"`. A partial update can leave two copies of a shared package in `node_modules`: two instances of a React context, and the admin sidebar silently stops talking to its provider.

#### Reproducibility

Reading the version from the manifest rather than resolving `latest` from the registry is what makes an old scaffolder version reproducible. Otherwise `@0.3.0` would generate an application out of today's packages.

#### A release does not touch the template

There is no version list in any template file, so there is nothing to fall behind. The only thing a release requires editing is: nothing.

### How the manifest is actually assembled

`renderManifest()` **rebuilds** the dependency map rather than patching it: the template carries a manifest with its non-Apograph dependencies and an empty `@apograph` set, the chosen packages are merged in, and the whole map is re-sorted.

1. Placeholder substitution in the text, then `JSON.parse`.
2. `dependencies` = the existing ones + `pin(resolvePackages(selection))`, sorted.
3. `devDependencies` = the existing ones + `pin(resolveDevPackages())`, sorted.
4. `JSON.stringify(manifest, null, 4)` plus a newline.

### What `pack.mjs` does

A package's tarball is not its committed manifest. The workspace resolves packages from source and a consumer cannot, so `build` compiles and `pack` lays out a rewritten manifest under `dist/pack/`. For the scaffolder there are two specific steps here:

- **The `templates/` directory is copied verbatim** and added to `files` — the same way plugins' `migrations/` directories are packed. It is data rather than source, and there is nothing there to compile.
- **`bin` is redirected** from the source `./src/cli.ts` to the compiled file. A `bin` pointing at a file the build never emitted is the worst kind of breakage: it only shows up at the user's end.

### The release

`npm run release` from a clean copy of `main`: versioning from conventional commits, a `v{version}` tag, publishing and a GitHub Release. The publishes are **throttled and retried** — npm rate-limits an account's writes and several dozen tarballs go out in one run, so they are serialised with a gap and a `429` is backed off rather than failing the release.

For a generated application, updating means raising every `@apograph/*` to one version at once. The README says so outright, and for the same reason: a partial update nests a second copy of a shared package.

## 08. Invariants

Statements that must always hold. Both a review list and a starting set of test assertions.

- **I-01** — Every publishable `@apograph/*` package under `packages/` is classified in `features.ts` **exactly once**: core, dev core, a capability's packages, or transitive. An unclassified package fails a test.
- **I-02** — The classification holds no name absent from the disk (the one allowed exception is `@apograph/cli`).
- **I-03** — Every `@apograph/*` dependency of a generated application is pinned to the scaffolder's **exact** version — no caret, no range, no `latest`.
- **I-04** — No `@apograph/*` version is written down in `features.ts` or in any template file — every one is stamped at render time from the scaffolder's own manifest. `features.ts` holds no version number at all; a template's own third-party dependency ranges are its business.
- **I-05** — A rendered application contains not one `__PLACEHOLDER__` token and not one `apograph:if|ifnot|end` directive.
- **I-06** — `package.json` never passes through the conditional blocks: its dependency set is assembled in code.
- **I-07** — An unclosed `apograph:if` and an unpaired `apograph:end` **throw**, naming the file, rather than returning a truncated file.
- **I-08** — A nested block inside a discarded one stays discarded, whatever its own condition says.
- **I-09** — Marker lines are always removed — both when a block is kept and when it is discarded.
- **I-10** — REST cannot be switched off: `lockedOf(PROTOCOLS)` is added to any answer, `--protocols none` included; the picker's cursor does not land on a locked row and the space bar does not toggle it.
- **I-11** — Exactly one storage adapter is installed and exactly one is constructed in `MediaServerPlugin`; exactly one type is assigned to the `plugins.media.storage` field.
- **I-12** — Exactly one storage adapter is marked `enabledByDefault && available`.
- **I-13** — Every optional capability (the copilot backends, all of SSO, the unlocked protocols) starts **switched off**.
- **I-14** — `copilot-server` and `copilot-admin` are present in every application, and `copilot-provider-fake` in **none**: it is a private fixture, not a published package.
- **I-15** — `COPILOT_ENABLED=false` is always written into `.env`, whatever was chosen — the copilot is installed unconditionally, so the kill switch must be there to be turned on. `MCP_ENABLED=false` is written only when `mcp` was chosen: it sits inside that feature’s `apograph:if` block, so an app scaffolded without MCP has no such line, no `McpPlugin`, and nothing the setting could switch.
- **I-16** — A copilot backend and an SSO provider register **only when their settings are present**: an empty key means no item in the list rather than an item that fails on the first message.
- **I-17** — The generated `.env` holds neither a `SESSION_SECRET` nor a `TOKEN_SECRET`: sessions and one-time tokens are opaque random values verified against a database row, and there is nothing to sign them with.
- **I-18** — The administrator's password is generated rather than asked for, and exists in exactly two places: in `.env` (which is in `.gitignore`) and in one printed line.
- **I-19** — An existing non-empty directory is never overwritten — the refusal comes before the first write.
- **I-20** — The scaffolder never blocks on a prompt: no TTY or `--yes` means the defaults, and every question has a flag.
- **I-21** — stdin is returned from raw mode to its original state on any outcome — an answer, a cancellation, an exception.
- **I-22** — `_gitignore` arrives as `.gitignore`, and no `*.tmpl` file remains in the generated application.
- **I-23** — The root `tsconfig.json` references exactly five projects, in the order `server`, the server's spec project (`apps/server/tsconfig.spec.json`), `admin`, `server-e2e`, `admin-e2e`. The server contributes two because the build project excludes the specs, so without a project of their own nothing typechecks them.
- **I-24** — `apps/server/tsconfig.json` excludes `**/*.spec.ts`, or the tests end up in `dist/server`.
- **I-25** — `styles.css` contains the exact line `@source "../../../node_modules/@apograph";` and **contains no** `@source` with a glob inside a `node_modules` path.
- **I-26** — The Vite config is named `vite.config.mts`, not `.ts`.
- **I-27** — `DatabasePlugin` is first in the server list; `identity` precedes `workspaces` among the migrating plugins; `McpPlugin`, where present, is last.
- **I-28** — In the admin UI exactly one plugin supplies a `layout`, and it is `shell`; `identity` comes first.
- **I-29** — The expected plugin list in the generated application's `plugins.spec.ts` matches the actual one for **any** combination of capabilities.
- **I-30** — A template file outside the text-extension list is copied byte for byte, with no substitutions.
- **I-31** — The `templates/` directory is excluded from Nx inference, the TypeScript build, linting and formatting — in all four places at once.
- **I-32** — The package has zero runtime dependencies.
- **I-33** — Every `CORE_PACKAGES` entry that **defines a plugin factory** is also registered in the generated application's `buildPlugins`. Classification puts a package in `package.json`; only this puts it in the running app. The two drifted apart in `v0.4.0`–`v0.4.3`, which installed `transfer-*` and `segments-*` in every generated app without mounting either.
- **I-34** — Every key the generated `.env` declares is read by something the generated application ships, in **every** feature combination. A documented setting that changes nothing is worse than a missing one: the operator sets it, restarts, and gets the default with the file in front of them promising otherwise. Five `WEBHOOKS_*` keys — `WEBHOOKS_ALLOW_PRIVATE_NETWORKS` among them — were inert until `config/webhooks.ts` existed to read them.

## 09. Testing checklist

The scaffolder is tested in two layers: the package's unit tests (ten spec files — classification coverage, the conditional-block processor, the template render, the terminal interface, the validators, the command itself end to end, the composition of the generated application, its executed `config/` modules, its executed composition root, and the packaging) and a manual end-to-end run that is not yet automated.

### 9.1 Classification and coverage

- **Add a dummy publishable package to `packages/`** → the test fails with a named case carrying that package's name, rather than a generic "the list did not match".
- **Mark it `"private": true`** → the test is green: privacy is a decision already made.
- **Put a package in two buckets at once** → the duplicate check fails.
- **Write in a name that is not on disk** → the "classifies nothing that does not exist" check fails.
- **Add an optional package without updating the pinned exclusion list** → "leaves exactly the choosable packages out of a default app" fails.

### 9.2 The wizard and the flags

- **`--protocols none`** → REST is in the set anyway; neither `content-graphql` nor `mcp-server` is installed.
- **`--copilot none`** → the copilot is installed and registered, not one provider is installed, and `COPILOT_ENABLED=false`.
- **`--copilot copilot-anthropic,copilot-openai`** → both packages in the manifest, both branches in `copilotProviders()`, both key blocks in `.env`.
- **`--media media-s3`** → only the S3 adapter is installed; `plugins.ts` holds one `createS3StorageProvider`; `apograph.config.ts` holds the `S3StorageConfig` type; `.env` holds only `MEDIA_S3_*`.
- **A non-existent id in a flag** → document the behaviour: today the id simply matches no capability and is silently ignored.
- **A run with no TTY (`| cat`)** → not one prompt, the defaults, and a zero exit code.
- **Ctrl-C in the middle of a picker** → the terminal keeps its echo; a subsequent `echo test` prints normally.
- **Escape in a multi-select** → the group's defaults are taken, not an empty selection.
- **The space bar on the REST row and on an unavailable row** → the state does not change; the cursor does not land on them.
- **`NO_COLOR=1` and `TERM=dumb`** → not one ANSI sequence in the output, and the frames do not fall apart.
- **A very long target path** → truncated from the front, and the frame keeps its width.

### 9.3 Input validation

- **App names `My CMS`, `_x`, `.x`, and a string longer than 214 characters** → each is rejected with its own text and the question is asked again.
- **URLs `mysql://…`, a non-URL, and `postgresql://host:5432` with no database name** → three different messages; none passes.
- **The database name from the URL** → reaches both `DATABASE_URL` and `POSTGRES_DB` in `docker-compose.yml` — one and the same value.

### 9.4 The generated application's integrity

- **Grep for `__[A-Z_]+__` and for `apograph:` across every file** → zero matches for any combination of capabilities.
- **`.gitignore` exists, `_gitignore` does not, and there is no `*.tmpl`** → and the first contains a `node_modules` line.
- **`JSON.parse` of the generated `package.json`** → valid for any combination; the dependency keys are sorted; not one caret among the `@apograph/*`.
- **No whitespace scars** → files where blocks were removed contain no triple blank lines.
- **`npm install` in the generated directory** → succeeds; `node_modules` holds one copy of `@apograph/design-system`.
- **`npm run typecheck`** → both projects are clean for every combination, the two extremes included (nothing optional / everything optional).
- **`npm test`** → both halves green with no `.env`. They were not until D-07 was fixed (section 11), and what keeps them green now is `composition.spec.ts` rather than this item.
- **`npm run migrate` on a clean database** → succeeds; a re-run is idempotent.
- **`npm run build && npm start`** → one process serves the API and the admin UI; `dist/server` contains no compiled `*.spec.js`.
- **The admin UI in a browser after `npm start`** → the styles are there (the `@source` check): the CSS is noticeably larger than ~15 kB and the components carry utility classes.
- **`GET /api/v1/graphql` and `POST /api/v1/mcp` in the default application** → an honest `404` rather than a module resolution error.
- **Signing in with the credentials from `.env`** → works the first time; after clearing both variables the existing account keeps working.

### 9.5 Packing and the release

- **`npm pack` and unpacking the tarball** → the `templates/` directory is inside in full, `_gitignore` included; `bin` points at an existing compiled file.
- **Installing from a local registry and generating from it** → the version in the generated application's dependencies matches the installed scaffolder's version.
- **An old version: `npx create-apograph-app@<previous>`** → an application of that version, not of today's.
- **`npx nx graph` after any edit under `templates/`** → the graph builds; if the directory accidentally became visible to inference, every `nx` command breaks.

> **What is not automated yet**
>
> The whole end-to-end path — publish to a local registry, generate, install, migrate, build, run — is **not automated**. The run is described by hand in the PR that introduced the package. The last six items of 9.4 and all of 9.5 are performed manually today.

## 10. Boundaries of responsibility

| Area                                                      | Who owns it                    | What the scaffolder does                                                                                      |
| --------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Building, running and migrating the generated application | `@apograph/cli`                | Writes six scripts and `@apograph/cli` into `devDependencies`; keeps the file layout compatible with `LAYOUT` |
| The monorepo's migration and release targets              | `@apograph/nx`                 | Nothing; the package never reaches an application                                                             |
| Version numbers and publishing                            | Nx Release + `tools/release/*` | Only **reads** its own version and stamps it into the dependencies                                            |
| The admin UI's content, the API and the access rules      | the `@apograph/*` plugins      | Only composes: the plugin list and its order                                                                  |
| Content types                                             | the application's owner        | Ships not one; leaves a comment with the migration descriptor's exact shape                                   |
| The values of secrets and keys                            | the operator                   | Writes empty keys with comments; the only generated value is the first administrator's password               |
| Installing dependencies                                   | npm                            | Runs `npm install` and reports a failure honestly, leaving the files in place                                 |
| Updating an application that already exists               | the application's owner        | Nothing: the package is single-use and never reaches an application's dependencies                            |
| Registering an SSO adapter beyond the three offered       | the application's owner        | Installs and registers the three the wizard offers; anything else is a line in `ssoProviders()`               |

### What is deliberately absent

- **A second template.** No "blog" and no "shop": the demo content would have to be cleared out, and every variant would share one layout anyway.
- **Questions about locales, roles, limits and email.** Those are either product constants in `apograph.config.ts` or decisions inside an already running admin UI.
- **An offline copilot stub.** An installation with no keys should have no copilot rather than a copilot answering with a canned phrase.
- **In-memory storage among the options.** An application that loses its uploads on restart is not something worth offering.
- **A "do you want a copilot" choice.** Its server half arrives transitively regardless; the question would be an illusion.
- **An automated end-to-end run.** Acknowledged and written down rather than forgotten.

## 11. Discrepancies between code and documentation

Found while checking this dossier against the source. None of it is a product bug in itself — except D-07, which was one and has since been fixed — but it misleads developer and tester alike.

| №    | Where                                                       | What it says                                                                                                                                                                                              | How it actually is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | AGENTS.md (root and package)                                | "The wizard asks **three** questions"; the root file lists them as "the storage adapter, the hosted copilot backends, the content API's protocols"                                                        | There are **four** groups in `features.ts`: `MEDIA_PROVIDERS`, `COPILOT_PROVIDERS`, `SSO_PROVIDERS`, `PROTOCOLS`. `resolveAnswers()` asks four pickers in a row, `USAGE` carries a `--sso` flag, `describeSelection()` prints a "Sign-in" line, and the `readKeys` doc block in `ui.ts` says outright "the wizard asks four of these in a row". **The SSO question is described in no AGENTS.md at all**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D-02 | create-apograph-app/AGENTS.md, "Feature selection"             | "S3 is in the registry and marked `available: false`, because the package was never released"; "the storage question is skipped while only one adapter is available"; "it will appear when S3 ships"      | All five adapters are marked `available: true`, and `features.spec.ts` holds a test **"offers the S3 adapter, now that it is implemented"**. The `selectable.length > 1` condition holds, so the question **is** asked. The paragraph describes a past state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D-03 | create-apograph-app/AGENTS.md, the bucket table                | "`TRANSITIVE_PACKAGES` — an internal detail of another package; **currently empty**"                                                                                                                      | The bucket holds two packages: `@apograph/media-provider-memory` and `@apograph/media-provider-testkit`, with the reasoning spelled out right in `features.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D-04 | create-apograph-app/AGENTS.md                                  | "This leaves **exactly five** packages out of the default app, and `features.spec.ts` lists them in full: the two hosted copilot backends, `content-graphql`, `mcp-server` and the unreleased S3 adapter" | The test lists **eleven**: plus the three SSO adapters and plus `media-provider-azure`, `media-provider-gcs`, `media-provider-vercel-blob`; and S3 has shipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D-05 | create-apograph-app/AGENTS.md                                  | "Every question has a flag (`--media`, `--copilot`, `--protocols`)"                                                                                                                                       | There are four flags — there is also `--sso`, documented in the command's own `USAGE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D-06 | features.ts, `SSO_PROVIDERS` ↔ the template                | The picker offers three equal options: `sso-oidc`, `sso-github`, `sso-saml`                                                                                                                               | **Fixed.** There were **no** `apograph:if sso-github` / `apograph:if sso-saml` markers in any template file: choosing either added the package to the manifest and changed nothing else — no import, no registration in `plugins.ts`, no type in `apograph.config.ts`, no keys in `.env` — and `USAGE` tacitly acknowledged it by naming only `sso-oidc` in the flag's parentheses. Both are wired now: `config/sso-github.ts`, `config/sso-saml.ts`, their types and registrations in `config/identity.ts`, their builders in `plugins.ts`, and their keys in `.env`. The three share one `ssoProviders` key, one builder and one argument to `IdentityPlugin`, so `resolveFlags` derives a group flag `sso` — `apograph:if` is line-based and cannot say "any of these three". `generated-plugins.spec.ts` runs the rendered builder per provider and `generated-config.spec.ts` executes both new config modules |
| D-07 | templates/default/apps/server/src/plugins.spec.ts           | `EXPECTED_PLUGINS` = `database, identity, workspaces, activity, users, content, [content-graphql], i18n, alarms, media, copilot, [mcp]`                                                                   | **`content-views` is missing.** The template's `plugins.ts` registers `ContentViewsPlugin({ content })` right after `content`, and its `name` is `'content-views'`. So the generated application's very first test — "registers exactly the plugins this app ships" — **fails**, and `npm test` in a freshly created application is red. The scaffolder's own tests did not catch it: `template.spec.ts` checks that the factory names are present in the file's text but never executes the template's specs. The admin half was the same defect — `apps/admin/src/plugins.spec.ts` omitted `webhooks`, so `npm run test:admin` was red too. **Both are now fixed**, and `src/lib/composition.spec.ts` compares the two lists for every combination, reading each plugin's name from the package that defines it                                                                                       |
| D-08 | features.ts, `CORE_PACKAGES` ↔ the template                | The core declares `transfer-server`, `transfer-admin`, `transfer-domain`, `segments-server`, `segments-admin`, `segments-domain`                                                                          | **Fixed.** Neither `TransferPlugin` nor `SegmentsPlugin` was registered in the template's server or admin `plugins.ts` — the packages were installed and the functionality did not appear: no export/import routes, no Access tab, no audience directory. Both halves are registered now, where this repository's own `apps/` registers them: transfer after content and media, segments after content whose read-scope port it binds. `composition.spec.ts` compares the registered list against the generated application's own expected list, so a future omission fails here. The `*-domain` ones remain unregistered by design — they are extension points                                                                                                                                                                                                                                         |
| D-09 | features.ts, the `SSO_PROVIDERS` doc block                  | "`identity-provider-fake` … is how a generated app's sign-in page is exercised offline"                                                                                                                   | The package really is installed unconditionally, but the template holds not one reference to it. The same place honestly notes that installing registers nothing — so "how it is exercised" requires a manual edit of the composition root that is shown nowhere                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D-10 | templates/default/README.md.tmpl, "Writing your own plugin" | "added to the array in `src/server/plugins.ts`"; "an `AdminPlugin` … added to `src/admin/plugins.ts`"                                                                                                     | **Fixed.** The real paths are `apps/server/src/plugins.ts` and `apps/admin/src/plugins.ts`, which the neighbouring "What you own" section of the same README already named correctly — the document contradicted itself, and the same old layout showed up in a comment in the template's `plugins.ts` and in the header of the admin's. All of them now name the real paths, and `generated-readme.spec.ts` looks up every path the README names in a rendered application, so a stale one fails rather than reads badly                                                                                                                                                                                                                                                                                                                                                                               |
| D-11 | AGENTS.md and a comment in `apps/server/jest.config.js`     | Both reference a `tsconfig.server.json` file                                                                                                                                                              | No such file exists in the template; the server's compiler settings live in `apps/server/tsconfig.json`. The name outlived the move to the `apps/*` layout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D-12 | templates/default/env.tmpl                                  | The "single sign-on" block with `SSO_PUBLIC_BASE_URL` and `SSO_REQUEST_TTL_SECONDS` is printed unconditionally                                                                                            | In an application generated without SSO, those are two settings for a handshake that does not exist. Not an error, but noise in the first file an operator opens — unlike every other `.env` block, which is neatly enclosed in markers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D-13 | create-apograph-app/AGENTS.md, "The generated app"             | The tree shows `apps/server/` with `apograph.config.ts, src/{main,plugins}.ts, jest.config.js`                                                                                                               | The list is incomplete: the template also has `apps/server/jest.setup.js` and `apps/server/src/plugins.spec.ts`, and `apps/admin/src` has `plugins.spec.ts` and `styles.css`. A small thing, but the list looks exhaustive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### What is worth fixing first

1. **D-07** — the only one that broke the product: `npm test` in a freshly created application was red on _both_ halves, and the first thing a new user learned about the shipped tests was that they do not pass. **Fixed.** The two expected lists name `content-views` and `webhooks`, and `composition.spec.ts` compares them against the plugins the template actually registers, for every combination of capabilities — so the next omission fails the scaffolder's own suite instead of a stranger's first run.
2. **D-06** and **D-08** — a choice and a declaration that led to nothing: the user got an installed package and absent functionality. **Both fixed** — the two remaining identity providers are wired end to end, and transfer and segments are registered on both sides.
3. **D-01…D-05** — documentation that has fallen behind the code; cured by one edit of `AGENTS.md` at both levels.

---

**An artifact in the series.** Written from the `packages/create-apograph-app` package in the same frame as the `identity` group's dossier: business description → place in the system → the wizard and its choices → package classification → the output → flows → versions and the release → invariants → checklist → boundaries → discrepancies.

The source is the source code: `src/cli.ts`, `src/lib/{features,template,conditionals,ui,validate,run}.ts` and the ten spec files beside them, all 42 files of `templates/default`, plus `nx.json`, `.nxignore`, `.prettierignore`, `eslint.config.mjs`, `tsconfig.lib.json` and `tools/release/pack.mjs`. The package counts in the classification were checked by enumerating the manifests on disk. The `AGENTS.md` files were used as a skeleton, but every claim was checked against the implementation — discrepancies went into section 11.
