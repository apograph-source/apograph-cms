# Bootstrap

_Package group · packages/bootstrap_

**The two hosts that turn a list of plugins into a running application**

Bootstrap is the one part of Ortha that has **no product feature in it at all**. No authentication, no content, no tables, no business routes. It is two composition roots — `createServer` for the NestJS API and `createAdmin` for the React admin UI — that take an array of plugins and assemble an application out of it, setting the cross-cutting rules exactly once along the way: the prefix, validation, proxy trust, the request-body ceiling, OpenAPI generation, the React root, the router, the providers, the error boundary and the announcing of navigation.

- **2** packages in the group
- **5** fields in the ServerPlugin contract
- **4** fields in the AdminPlugin contract
- **10** steps to start the server
- **9** steps to start the admin UI
- **15 + 15** plugins in the build
- **26** extension slots
- **0** tables and API routes of its own

## Contents

- [01. Business description](#01-business-description)
- [02. Composition of the package group](#02-composition-of-the-package-group)
- [03. The ServerPlugin contract](#03-the-serverplugin-contract)
- [04. The AdminPlugin contract](#04-the-adminplugin-contract)
- [05. Starting the server: ten steps, in order](#05-starting-the-server-ten-steps-in-order)
- [06. Starting the admin UI: nine steps, in order](#06-starting-the-admin-ui-nine-steps-in-order)
- [07. The slot system](#07-the-slot-system)
- [08. Registration order and collisions](#08-registration-order-and-collisions)
- [09. Configuration and environment](#09-configuration-and-environment)
- [10. Security and the cross-cutting harness](#10-security-and-the-cross-cutting-harness)
- [11. Invariants](#11-invariants)
- [12. Testing checklist](#12-testing-checklist)
- [13. Boundaries of responsibility](#13-boundaries-of-responsibility)
- [14. Where the code and the documentation diverge](#14-where-the-code-and-the-documentation-diverge)

## 01. Business description

Ortha is not a monolith with features bolted on. It is a small, deliberately stupid **host** that turns a _list of plugins_ into an application. The host knows no domain at all: not what a user is, not what a content entry is, not what a workspace is. All of that lives in plugins. The decision is recorded in ADR-0002 “Plugin-based architecture” and is the defining one for the whole architecture.

### What it buys the product

- **An installation is assembled for the customer, not trimmed down for them.** A deployment that needs neither the AI copilot nor MCP nor GraphQL simply does not register those plugins. Nothing is “switched off by a flag”, nothing hangs around as dead code in the bundle — the corresponding routes, tables and screens are physically absent from that build.
- **The product can be handed out.** It is precisely because an application _is_ a list of plugins that `npx create-ortha-app` exists: the generated application is the same `createServer` and the same `createAdmin`, only with a different list. The host does not distinguish “a plugin from the monorepo” from “a plugin installed from npm”: both present one interface.
- **A new capability does not touch existing code.** Adding a feature means adding a package and one line to `apps/server/src/plugins.ts` or `apps/admin/src/plugins.ts`. The host's own files are never opened. That is not an aesthetic point: it is the reason the fifteenth feature costs what the second one did.
- **Cross-cutting rules apply once, to everyone.** Strict body validation, the ceiling on its size, the global prefix, proxy trust, a graceful shutdown on SIGTERM — all set in one place. A plugin cannot “forget” to apply them, because it has nothing to apply.

### What it buys the team

#### The feature developer

Writes a package and exports a plugin factory. They need not know how Nest comes up, where the connection pool lives, who mounts the React root or how the router is built. The contract is five fields on the server and four in the admin UI.

#### The reviewer

Sees the boundary: if a change touches `packages/bootstrap`, it is cross-cutting by definition and concerns everyone. Everything else is local by construction — plugins have no right to reach into one another, only through explicit contracts and slots.

#### The tester

Knows that the make-up of the application is two readable list files, and that unit tests exist for them (`plugins.spec.ts`) pinning both the set and the order. A missing plugin is not “a page disappeared”, it is a red test.

### What Bootstrap is not

This is a case where the list of what is missing matters more than the list of what is there: it explains why most things cannot “just be fixed” in the host.

- **It is not authentication.** The server host contains not a single guard. The admin host does not know the words `RequireAuth`, `signInPath` or “current user”. Authentication lives entirely in `identity`, and its assembly into an application in `shell`.
- **It is not a plugin registry.** There is no discovery, no manifests, no loading by name. The plugin list is an array in the application's code, and that is deliberate minimalism: an array can be read, sorted and covered by a test.
- **It is not a data layer.** The database connection is opened by the `@orthacms/database` plugin in its own hook; the host merely calls the hooks in order. The TanStack Query client and the axios client live in `@orthacms/utils-admin`, and the host only mounts the provider.
- **It is not a set of slots.** The host can _wire up_ contributions into slots, but it defines none and reads none. All 26 slots belong to plugins.
- **It is not migrations.** The host carries the `migrations` descriptor from a plugin over to the tooling; it applies nothing itself and does not even resolve the path at load time.

> **The architecture's key idea**
>
> The host owns **only what is obliged to exist exactly once**. Everything that can exist zero or many times belongs to plugins. Every decision follows from that: why `ValidationPipe` is here but guards are not; why `IntlProvider` is here but the strings are not; why slots are wired up here but defined in plugins.

## 02. Composition of the package group

The `packages/bootstrap` group is exactly two packages, one per runtime. They do not depend on each other and share no code: the only thing they have in common is the role of composition root.

| Package | npm name                   | Entry point           | What it owns                                                                                                                                                                  |
| ------- | -------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| server  | @orthacms/bootstrap-server | createServer(options) | Assembling the Nest application, the global prefix, `ValidationPipe`, proxy trust, the body ceiling, OpenAPI + Scalar, serving the admin bundle, shutdown hooks               |
| admin   | @orthacms/bootstrap-admin  | createAdmin(options)  | Mounting the React root, the router, the providers (theming, queries, i18n, tooltips), the error boundary, announcing navigation, the unsaved-changes dialog, wiring up slots |

### The public surface

The server package exports **3 values and 7 types**, the admin one **1 value and 3 types**. That is the entire surface twenty-odd plugins rest on.

| Export              | Package | What it is                                                                                                           |
| ------------------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| createServer        | server  | Boots the application; **returns the listening application**, so an embedding host or a test can close it            |
| ServerModule        | server  | The dynamic root module; `forRoot(plugins)` imports each plugin's module                                             |
| setupApiDocs        | server  | The OpenAPI + Scalar harness on its own — for a host that builds its `INestApplication` itself                       |
| ServerPlugin        | server  | The plugin contract: `name`, `module`, `onPluginInit?`, `migrations?`, `docs?`                                       |
| CreateServerOptions | server  | `plugins`, `port?`, `globalPrefix?`, `trustProxy?`, `bodyLimit?`, `docs?`, `staticDir?`                              |
| TrustProxySetting   | server  | `boolean \| number \| string` — the Express `trust proxy` value                                                      |
| ApiDocsOptions      | server  | Settings for the document and the reference: `enabled`, `path`, `jsonPath`, `title`, `description`, `version`, `cdn` |
| PluginApiDocs       | server  | A plugin's contribution to the document: `securitySchemes`, `defaultSecurity`, `decorate`                            |
| ApiSecurityScheme   | server  | An authentication scheme in OpenAPI 3 terms, restated structurally                                                   |
| OpenApiDocument     | server  | A structural view of the document for the `decorate` pass                                                            |
| createAdmin         | admin   | Mounts the whole SPA                                                                                                 |
| AdminPlugin         | admin   | The plugin contract: `name`, `routes?`, `layout?`, `slots?`                                                          |
| RouteItem           | admin   | A route contribution: `path`, `element`, `public?`                                                                   |
| CreateAdminOptions  | admin   | `plugins`, `rootElement?`, `locale?`                                                                                 |

### The dependencies — and what is missing from them

The server package depends on `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/swagger` and `@scalar/nestjs-api-reference` — and **does not depend on `express` directly**. The request and response types in the static-file serving are declared structurally rather than imported: an import would make `express` a phantom dependency — resolvable in the monorepo thanks to root hoisting and absent for a consumer. The `verifyDependenciesAreDeclared` check in `pack.mjs` will not publish such a build.

The admin package depends on `@orthacms/design-system`, `@orthacms/utils-admin`, `@tanstack/react-query` and `react-intl`; React, ReactDOM and `react-router-dom` are declared as peer dependencies. Note what is not here: `@orthacms/identity-admin`. The host physically cannot import authentication.

> **Neighbours easily confused with it**
>
> **`@orthacms/shell-admin`** is _not_ a host. Shell is an ordinary plugin that simply happens to be the only one contributing a `layout`: `AuthProvider` + `RequireAuth` + the application chrome are assembled inside it. **`@orthacms/utils-admin`** is the shared leaf library: the `createSlot` primitive, `queryClient`, `apiClient`. The host takes `queryClient` and `wireSlotContributions` from there, but plugins go there directly, bypassing the host. **`@orthacms/cli`** and **`@orthacms/nx`** are the consumers of the `migrations` descriptor: they, not the host, are what applies migrations.

## 03. The `ServerPlugin` contract

This is the central interface of the entire system: everything the server side of Ortha can do arrives in the application through it. There are exactly **five** fields, of which **two** are required. That narrowness is deliberate: the less the host knows about a plugin, the fewer reasons a plugin has to depend on the host.

```
export interface ServerPlugin {
    name: string;
    module: Type | DynamicModule;
    onPluginInit?(): void | Promise<void>;
    migrations?: {
        dir: () => string;
        table: string;
    };
    docs?: PluginApiDocs;
}
```

| Field        | Req. | What the host does with it                                                                                                                                                                                                                     | What happens if you get it wrong                                                                                                                                                                                                             |
| ------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| name         | yes  | Does not affect the application's behaviour. Used in the logs, in the message about a failed `onPluginInit`, in the message about a failed `decorate`, in the migration-application line and in the composition tests                          | A duplicate name is checked by nothing: two plugins named `content` will assemble and start. The price is unreadable diagnostics: the message “Plugin "content" failed” will not say which of the two                                        |
| module       | yes  | The only thing that actually reaches Nest: `ServerModule.forRoot` puts the value into the root module's `imports`. It accepts both a class and a dynamic module — the latter being the standard way to thread a plugin's configuration through | A module whose provider requires an unavailable dependency brings the graph build down inside `NestFactory.create` — **after** every `onPluginInit`, so by that point open resources already exist                                           |
| onPluginInit | no   | Called **before** the Nest application is created, in array order, with `await`. This is the place for one-off preparation that has to finish before the first provider is instantiated                                                        | A throw is wrapped: the host logs `Plugin "X" failed in onPluginInit; the server cannot start.` and rethrows. `main.ts` catches it and exits with code 1. This used to be a bare unhandled rejection with no plugin name                     |
| migrations   | no   | The host **does nothing with it at startup**. The descriptor is read by the tooling: `applyPluginMigrations` in `@orthacms/cli` and the `db:migrate` executor from `@orthacms/nx`, walking the same plugin array                               | A `table` shared by two plugins glues their migration histories into one bookkeeping table — and the second plugin will conclude its migrations are already applied. That is exactly why `plugins.spec.ts` checks that the tables are unique |
| docs         | no   | A contribution to the shared OpenAPI document: authentication schemes, document-level requirements and a final `decorate` pass. Assembled in `setupApiDocs` in registration order                                                              | A throw in `decorate` is caught **per plugin**: only that plugin's contribution is lost, the error is logged, and the server carries on coming up. Before that guard, one bad `decorate` brought all of `createServer` down                  |

### 3.1 `name` — an identifier for a human, not for a machine

It matters to understand what `name` does **not** do: nothing is looked up by it, nothing is resolved by it and nothing is linked by it. The system has no “give me the plugin called X” registry. It is a label for the log and for the composition test, and its value is entirely diagnostic — which is confirmed by what it was pressed into service for: three different failure scenarios (a bad hook, a bad `decorate`, a busy port) all used to look equally faceless.

### 3.2 `module` — the whole of the Nest integration in one field

The host's root module is as trivial as it is possible to be:

```
@Module({})
export class ServerModule {
    static forRoot(plugins: ServerPlugin[]): DynamicModule {
        return {
            module: ServerModule,
            imports: plugins.map((plugin) => plugin.module)
        };
    }
}
```

There is no filtering here, no sorting, no duplicate check. Which is exactly why **a plugin's position in the array decides almost nothing for DI**: plugin modules in Ortha are global, and Nest builds the whole graph before instantiating. Measured: moving `IdentityPlugin` above `DatabasePlugin` yields a fully working server.

The standard form is a factory returning a dynamic module with the configuration inside:

```
export function DatabasePlugin(
    config: DatabasePluginConfig
): DatabaseServerPlugin {
    return {
        name: 'database',
        module: DatabaseModule.forRoot(),
        databaseConfig: config,
        onPluginInit() {
            initDatabase(config);
        },
        migrations: {
            dir: () => join(__dirname, '../../../migrations'),
            table: '__drizzle_migrations_database'
        }
    };
}
```

> **The contract is a minimum, not a ceiling**
>
> Note the `databaseConfig` field in the example: it is not in the contract. A plugin is free to extend the interface with fields of its own — `DatabaseServerPlugin extends ServerPlugin`, `ContentServerPlugin extends ServerPlugin` with a `registry` field. The host ignores such fields, but _other plugins_ use them: `ContentViewsPlugin({ content })` and `ContentGraphqlPlugin({ content })` take the content plugin's object **by value** in order to share its type registry. That is the only sanctioned way for plugins to be explicitly linked on the server, DI ports aside.

### 3.3 `onPluginInit` — the one hook that runs before the application

The host walks the array and awaits each hook:

```
for (const plugin of plugins) {
    try {
        await plugin.onPluginInit?.();
    } catch (error) {
        Logger.error(
            `Plugin "${plugin.name}" failed in onPluginInit; the server cannot start.`,
            describeError(error)
        );
        throw error;
    }
}
```

In today's build this hook is implemented by **exactly one plugin out of fifteen** — `database`, which opens the pool. That is both why `DatabasePlugin` comes first, and why the position is not critical right now: every hook runs before `NestFactory.create` regardless. The comment in `plugins.ts` puts it honestly — the database is first not because anything would break otherwise, but because “the moment a second plugin starts opening a resource, hook order becomes load-bearing, and there will be nothing to catch the mistake”.

The hook is **not** the place for work that needs DI: the role seeders in `identity` use the Nest lifecycle (`OnApplicationBootstrap`), because they need an already-assembled database client from the container.

### 3.4 `migrations` — a descriptor, not an action

Two details in this field are worth explaining.

- **`dir` is a function, not a string.** The path is computed only at migration time and never during an ordinary boot. That is what lets the same code work both when the package is consumed from source and when it is installed from npm: `__dirname` points to different places in those two cases, but it is called equally late.
- **`table` — history isolation.** Every plugin has its own bookkeeping table (`__drizzle_migrations_identity`, `__drizzle_migrations_alarms`, and so on), so plugins are versioned independently and adding a new plugin does not rewrite somebody else's history.

In today's build, **10 of 15** plugins carry migrations: `database` (one table — the transactional outbox), `identity`, `workspaces`, `activity`, `content` (the descriptor is passed by the _host_: the generated collection tables belong to the application, not the package), `content-views`, `media`, `alarms`, `segments`, `copilot`. Not carrying any: `users` and `i18n` (they own no schema at all), `content-graphql`, `transfer` and `mcp` (protocol adapters and intermediaries).

> **This is where array order is load-bearing**
>
> `applyPluginMigrations` walks the array, and **no transaction spans two plugins**. The `memberships → users` foreign key means `WorkspacesPlugin` must come after `IdentityPlugin`. The insidious part is that the mistake shows up asymmetrically: on an _already migrated_ database a reordering passes without a single complaint, while on a _clean_ one it fails with `relation "users" does not exist`. That is, the mistake sails into a release and bites the next person deploying from scratch. Which is why the failure message names ordering as the first candidate cause and reports how many plugins have already been committed (there is no rollback — each plugin commits as it goes). The order is pinned by a test in `apps/server/src/plugins.spec.ts`; task ORT-131 is to make the dependency a declaration rather than a comment.

### 3.5 `docs` — a plugin describes its own authentication

The logic of this field follows directly from the host having no guards: since the host verifies no credential at all, it has no right to invent authentication schemes in the document. They are declared by whoever owns the verification.

| Subfield        | Purpose                                            | How it is processed                                                                                                                                       |
| --------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| securitySchemes | Named schemes: cookie, bearer, OAuth2, OIDC        | Each name/scheme pair is added via `DocumentBuilder.addSecurity`; on a name clash the last plugin registered wins                                         |
| defaultSecurity | The names of the schemes offered at document level | Each becomes its own element of the `security` array; OpenAPI reads a list of requirements as **OR**, so `['session', 'apiToken']` means “either will do” |
| decorate        | A final pass over the finished document            | Runs **last** — after generation and after the tags are laid out — in registration order, each in its own `try/catch`                                     |

`identity`'s contribution is the only source of authentication schemes in the system:

```
docs: {
    securitySchemes: {
        session: {
            type: 'apiKey',
            in: 'cookie',
            name: SESSION_COOKIE,
            description: 'Opaque session cookie issued by `POST /api/auth/login` …'
        },
        apiToken: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'ortha_<random>',
            description: 'External API token minted by `POST /api/api-tokens` …'
        }
    },
    defaultSecurity: ['session', 'apiToken']
}
```

And `decorate` exists because `@nestjs/swagger` sees only **static TypeScript** — decorated classes and their metadata. A plugin whose contract is _runtime data_ is invisible to the scanner. That is exactly content's situation: content types are defined by code and live in a registry, and one set of generic `/content/:typeName` controllers serves them all. So content describes itself:

```
docs: {
    decorate: (document) =>
        describeContentApi(document, registry.serializeAll())
}
```

> **The document is shared — edit only your own part**
>
> `decorate` receives **the same mutable object** for every plugin. The “only append what you own” rule is enforced by nothing technical. A plugin that wipes out somebody else's `components.schemas` gets green tests and a broken reference — and since that is a developer tool, nobody notices right away.

## 04. The `AdminPlugin` contract

The mirror of the server contract on the SPA side. **Four** fields, **one** of them required. As on the server the narrowness is deliberate, but here it has an extra consequence that must be taken literally: **the host does not know what authorization is**, and gives no guarantee about it.

```
export type RouteItem = {
    path: string;
    element: ReactNode;
    public?: boolean;
};

export type AdminPlugin = {
    name: string;
    routes?: RouteItem[];
    layout?: ReactNode;
    slots?: SlotContribution[];
};
```

| Field  | Req. | What the host does with it                                                                                                                                                                                  | What happens if you get it wrong                                                                                                                                                                                                              |
| ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| name   | yes  | As on the server — diagnostics: the names are listed in the warnings about a `layout` collision and about a route collision, and are pinned by the composition test                                         | A duplicate name is checked by nothing. The price is a warning along the lines of “"content" and "content" conflict”, which clarifies nothing                                                                                                 |
| routes | no   | Every plugin's `routes` are collapsed into one flat list and split by the `public` flag: public ones are mounted as top-level siblings, the rest as children of a single pathless parent                    | Two plugins on one `path` — React Router picks by rank rather than by declaration, so the winner is formally undefined. The host warns and names both (see section 8)                                                                         |
| layout | no   | The host takes the **first `layout` it finds** and makes it the single parent of every non-public route. The contents are opaque to the host — it is simply a `ReactNode` obliged to render an `<Outlet/>`  | A second `layout` contributor loses on registration order. And that is not cosmetic: the winning foreign layout takes `RequireAuth`, the sidebar, the skip link and the `<main>` landmark with it — **every private route renders unchecked** |
| slots  | no   | Every plugin's contributions are wired into their target slots **before the first render**, in one `wireSlotContributions` call. The host is slot-agnostic: it only wires up, never defines and never reads | Hard to get wrong: a slot is a singleton object, not a name, so “missing the slot” is impossible. Collisions are possible only _inside_ a slot, by the consumer's own rules (see section 7)                                                   |

### 4.1 The `public` flag does not mean “unauthenticated”

This is the most important point in the whole contract, and the code comments it in exactly those words: _“the host attaches no authorization meaning to it”_. The flag decides **one** question: whether to mount the route under the `layout` or beside it.

#### `public: true`

The route is a top-level sibling, outside the `layout`. Today there is exactly one such contribution in the application: `/identity/*` from the identity plugin — the sign-in and accept-invitation screens, which have to open before the user is signed in.

#### `public` omitted or `false`

The route is a child of the single parent carrying the `layout`. Whether that layout checks anything is the layout's business. Today it does, because shell wraps the chrome in `RequireAuth`. The host guarantees none of it.

> **The default is fail-open**
>
> A route with `public: false` renders **entirely unchecked** when no protective `layout` is present. That is a deliberate trade: the host stays completely free of authorization code, and locking things down becomes the application's decision (shell wires itself in) rather than a platform guarantee. It follows from the same trade that the warning about two `layout`s is a warning about a vulnerability, not about markup, and that `apps/admin/src/plugins.spec.ts` has a dedicated test pinning the fact that the application has exactly one `layout` contributor and it is shell.

### 4.2 What a contribution looks like end to end

The identity plugin is the smallest possible: one field beyond the name, one wildcard route, a nested router inside.

```
export function IdentityPlugin(): IdentityAdminPlugin {
    return {
        name: 'identity',
        routes: [
            { path: '/identity/*', element: <IdentityRouter />, public: true }
        ]
    };
}
```

The shell plugin is the only one that uses all four fields at once, and the only one that contributes a `layout`:

```
export function ShellPlugin(): ShellAdminPlugin {
    return {
        name: 'shell',
        layout: (
            <AuthProvider>
                <RequireAuth>
                    <AppShell />
                </RequireAuth>
            </AuthProvider>
        ),
        routes: [{ path: '/', element: <HomePage /> }],
        slots: [
            {
                slot: SIDEBAR_NAV_SLOT,
                items: [
                    {
                        labelId: 'shell.nav.home',
                        defaultLabel: 'Home',
                        to: '/',
                        end: true,
                        group: 'overview',
                        order: 10,
                        icon: HomeIcon,
                        iconColor: 'text-nav-orange'
                    }
                ]
            }
        ]
    };
}
```

This also shows exactly how authorization ends up in the application without ever reaching the host: shell imports `AuthProvider` and `RequireAuth` from `identity-admin` and folds them _inside_ its own `layout`. To the host it is still an anonymous `ReactNode`.

### 4.3 What the contract does not have — and why

| What is missing           | Where it actually lives                                  | Why it is not in the contract                                                                                            |
| ------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A menu / navigation entry | The `SIDEBAR_NAV_SLOT` slot, owned by shell              | The host does not know the application has a sidebar. A menu is data, read by a specific consumer                        |
| A required permission     | `useHasPermission` from identity, inside the page        | The host does not know what a permission is. Gating on permissions is the page's decision, not the route's               |
| The page title            | `documentTitle` from utils-admin, inside the page        | The host does not touch `document.title` at all                                                                          |
| Lazy loading              | `React.lazy` + `Suspense` inside the `element`           | `element` is an already-built node; code splitting is entirely the plugin's business                                     |
| Route order / priority    | The order of the plugin array and React Router's ranking | Priority between routes of different plugins is a collision, and the host declares collisions rather than resolving them |
| An initialization hook    | Ordinary React: an effect in a component                 | There is no full analogue of `onPluginInit` in the admin UI. The one “pre-render” phase is the wiring of slots           |

<details>
<summary>Why `CreateAdminOptions.locale` does not translate anything yet</summary>

The option controls three things: the value of `<html lang>`, the writing direction `<html dir>`, and `Intl` formatting (dates, numbers, plural forms). Translation — **no**: the admin UI has exactly one message catalogue — the `defaultMessage` of each descriptor — and no `messages` are passed to `IntlProvider`. The type is declared as `string` rather than a union of supported locales precisely because there is nothing to enumerate yet; narrowing the type is part of task ORT-141, so that the option stops promising what it does not do.

</details>

## 05. Starting the server: ten steps, in order

All of `createServer` is about a hundred lines, but the order within them is carefully worked out: nearly every step is justified by what would happen if it came earlier or later. Below is the actual sequence.

1. **Parsing the options and their defaults.** `port = 3000`, `globalPrefix = 'api'`, `bodyLimit = '1mb'`. `trustProxy`, `docs` and `staticDir` have no defaults — their absence is itself a mode.
   _1 MB is spelled out so as not to inherit express's 100 kB_
2. **The `onPluginInit` hooks, in array order, awaited.** Each in a `try/catch` that names the plugin. This is where `@orthacms/database` opens the pool, so by the next step the connection is already live.
   _a failure here = the server does not start, exit code 1_
3. **`NestFactory.create(ServerModule.forRoot(plugins))`.** The whole graph of modules and providers is built. The application exists, but is not listening on anything yet.
   _typed as NestExpressApplication — the adapter's methods are needed further down_
4. **`app.set('trust proxy', trustProxy)` — only if a value was given.** Necessarily **before** anything that reads `req.ip`: this setting determines which address `identity` counts sign-in attempts against and which address ends up in the session row.
   _an invalid value fails the boot right here — proxy-addr throws_
5. **Re-registering the body parsers** with an explicit ceiling: `json` and `urlencoded` (`extended: true`). This replaces the parsers Nest installs with express's defaults.
   _the 413 comes from the parser — above any controller, guard or protocol layer_
6. **`app.setGlobalPrefix('api')`.** Every plugin route moves under a shared prefix. Exactly once, which is why no plugin writes `api` into its own path.
7. **The global `ValidationPipe`** with three flags on: `whitelist` (undeclared fields are stripped), `forbidNonWhitelisted` (and additionally get a 400), `transform` (the body becomes a DTO instance with type coercion).
   _this is why a stray field in the body is a 400 for every plugin_
8. **`setupApiDocs(app, plugins, docs, globalPrefix)`.** After the prefix and the pipe — so the document describes the real URLs; before `listen` — so the reference is available from the first second the port is open.
   _returns the mount paths, or null if the docs are switched off_
9. **`serveAdmin(app, staticDir, globalPrefix)` — only if `staticDir` is set.** Strictly last among the mounts: by then Nest's router already holds every controller route and both reference routes, so the SPA fallback physically cannot intercept somebody else's.
   _a missing bundle is a warning, not a refusal: the API comes up without a UI_
10. **`app.enableShutdownHooks()`, then `await app.listen(port)`.** A `listen` error is also logged with the port and rethrown. Success prints the address; the function **returns the application**.
    _the return is not for main.ts but for tests and embedding hosts — without it a bootstrap cannot be closed, and therefore cannot be tested_

### 5.1 Why `trust proxy` sits exactly there, and why it is a security question

By default express ignores `X-Forwarded-For` entirely. Behind a load balancer that means **every request reports the proxy's address**, all clients collapse into one rate-limit bucket, and ten requests a minute from a single attacker are enough to deny sign-in to everybody. The opposite mistake is symmetric: a setting that is too trusting lets any client forge the header and mint itself an unbounded number of buckets.

Measured against a live server with a forged `X-Forwarded-For: 1.1.1.1, 2.2.2.2, 3.3.3.3` from a local peer:

| `TRUST_PROXY`               | `req.ip`           | Comment                                                                                            |
| --------------------------- | ------------------ | -------------------------------------------------------------------------------------------------- |
| unset / 0 / false           | the peer's address | the header is ignored entirely — direct-access mode                                                |
| 1                           | 3.3.3.3            | one hop **from the right**; past the count the client cannot forge anything — the recommended form |
| 2                           | 2.2.2.2            | two hops from the right                                                                            |
| true                        | 1.1.1.1            | the **leftmost** element — entirely under the client's control; only on a closed network           |
| loopback, ::1               | 3.3.3.3            | walks right to left past the trusted addresses                                                     |
| a subnet the peer is not in | the peer's address | fails **closed** — a list that does not match behaves exactly like “unset”                         |
| something unparseable       | —                  | `proxy-addr` throws on `app.set`: the boot fails with code 1 (a loud refusal)                      |

> **The row to watch**
>
> The second to last: a subnet correct in form but wrong in content degrades to “ignore the header” **without a single word**. The direction is safe, but it is indistinguishable from a correct configuration right up until you open a session row and find the load balancer's address in it.

### 5.2 The request-body ceiling: why the number is spelled out rather than inherited

`express.json()`'s own default is 100 kB — measured at exactly 102,400 bytes. A long article with embedded rich text exceeds it, and the parser answers `413` **above any controller, guard or protocol layer**: an MCP client would get a REST error instead of a JSON-RPC frame. That is, the ceiling on “how much content this CMS accepts” would be an accident of a dependency's default. 1 MB covers any realistic entry while still bounding how much an unauthenticated caller can make the parser allocate. File uploads do not land here: they are multipart and are bounded separately, through the media plugin's `MEDIA_MAX_UPLOAD_BYTES`.

### 5.3 Assembling OpenAPI: what happens inside step eight

1. **Checking the switch.** `enabled` defaults to `NODE_ENV !== 'production'`. Switched off, the function returns `null` and mounts **nothing**: both routes ride on one flag, so the JSON is unavailable whenever the UI is.
2. **Collecting the authentication schemes.** A walk over the plugins: `securitySchemes` and `defaultSecurity` go into the `DocumentBuilder`. Registration order decides who wins on a name clash.
3. **Generating the document.** `SwaggerModule.createDocument` with `autoTagControllers: false`. The global prefix is preserved in the paths, so the document describes the URLs a client actually calls.
4. **Tags by resource, not by controller.** `tagByResource` takes the first segment after the prefix (`/api/content/post` → `content`). The alternative is a tag per controller class name, but the codebase deliberately keeps one controller per scenario, and that would have produced some fifty groups of one operation each.
   _only the 8 operation keys are iterated: a path item can also carry parameters/$ref/summary, and writing tags into the parameters array would make the document invalid_
5. **The `decorate` passes.** Last and one at a time, each in its own `try/catch`. A plugin sees an already-finished, already-tagged document.
6. **Mounting onto the HTTP adapter.** The JSON route first — so that it beats the UI mount in the (default) case where it sits underneath it. Then Scalar itself.
   _registered on the adapter rather than in Nest's router: the routes end up outside the prefix, outside the guards and outside the ValidationPipe_

> **Calling it after app.init() is pointless and silent**
>
> `setupApiDocs` is exported separately — for a host that assembles its `INestApplication` itself. It must be called **before** `app.init()`/`listen()`, the way `createServer` does: it registers on the HTTP adapter, and a call after Nest's router is mounted adds a layer the router has already covered. The function will return the paths and serve nothing — with no error. The prefix must also be set by then, otherwise the document will describe URLs nobody serves.

### 5.4 Serving the admin bundle: one origin instead of two

`staticDir` is not a convenience but a cookie-security requirement. Identity issues the session as an `httpOnly`, `SameSite=lax` cookie, and a UI served from a _different_ origin simply will not send it on API calls. A deployment that splits those halves must either bring back a proxy or turn on CORS together with `SameSite=none` — and maintain both constructions forever. In the monorepo `apps/server` leaves the option unset (the admin UI is served by Vite, which proxies `/api` for exactly this reason), while a generated application sets it — in production there is no dev proxy.

The SPA fallback refuses to answer in four cases, and each refusal reflects a specific failure:

- **A path under the API prefix or under `/reference`.** Otherwise a typo in an endpoint would stop returning a JSON `404` and start returning a `200` with an HTML page. That is the most confusing failure this function is capable of producing: every client sees a success plus a JSON parse error, and nothing says the route does not exist.
- **The method is neither `GET` nor `HEAD`.**
- **The path has a file extension.** This is the primary filter. A stale `index.html` referencing a deleted hashed chunk must keep 404ing, otherwise the browser reports a MIME-type error and a bad deploy reads as a bundler bug. Measured on a real build: `GET /assets/deleted-chunk.js` was returning 200 and the page.
- **The client does not accept HTML.** A secondary filter — for a caller _explicitly_ asking for JSON. On its own it does not work: a browser requests scripts and styles with `Accept: */*`, and `accepts('html')` answers `*/*` in the affirmative.

### 5.5 Shutdown on SIGTERM

`enableShutdownHooks()` is called before `listen`. Without it SIGTERM — the way any orchestrator stops a pod — reaches Node's default handler and the process dies on the spot. Measured: six simultaneous sign-in requests ended in a connection reset; with the hooks enabled all six completed normally. With them, Nest closes the HTTP server, waits out the requests already accepted, calls `onModuleDestroy` on every module and only then re-raises the signal.

## 06. Starting the admin UI: nine steps, in order

`createAdmin` returns nothing — in a browser the document owns the application's life. Everything the function does fits into nine steps, of which the first seven happen **before** the first render.

1. **Parsing the options.** `rootElement = 'root'`, `locale = 'en'`.
2. **The document's language and writing direction.** `document.documentElement.lang = locale` and `dir = directionOf(locale)`. Before the render — so assistive technology sees it on the first paint rather than after a reconciliation.
   _WCAG 3.1.1: German content used to be read out by an English synthesiser_
3. **The `layout` collision warning.** If there is more than one contributor — a `console.warn` naming the winner and the losers and saying outright that private routes may end up unprotected.
4. **The route collision warning.** A “path → plugins” map is built, and every path with two or more owners produces a warning by name.
5. **Collapsing and splitting the routes.** A `flatMap` over every plugin, then a filter on `public` — two lists.
6. **Wiring the slots.** `wireSlotContributions` receives every plugin's contributions at once and registers them **from an empty state** rather than by appending.
   _idempotence is needed because of Vite's hot replacement, which re-executes the entry module_
7. **Choosing the layout.** `plugins.map(p => p.layout).find(Boolean)`, and in its absence a bare `<Outlet />`.
8. **Finding the container.** `getElementById(rootElement)` with an explicit check and a meaningful error naming the id it looked for. A type assertion would instead fail inside React with a message about a “target container” that does not say which id the host was looking for — and the page is blank either way.
9. **Rendering the provider tree.** `createRoot(container).render(…)`.

### 6.1 The provider tree, layer by layer

The nesting order is not accidental: every layer is where it is because of a specific failure.

```
<StrictMode>
  <AppearanceProvider>                     appearance: theme, density
    <QueryClientProvider client={queryClient}>   the single TanStack Query client
      <IntlProvider locale defaultLocale onError>  the one and only IntlProvider
        <DesignSystemLabels>                 translations of the library's own strings
          <TooltipProvider delayDuration={200}>
            <AppErrorBoundary>               the error boundary — ABOVE the router
              <BrowserRouter>
                <RouteAnnouncer />           the live region used for announcements
                <UnsavedChangesGuard>
                  <Routes>
                    {public routes — top-level siblings}
                    <Route element={layout}>
                      {private routes}
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Route>
                  </Routes>
                </UnsavedChangesGuard>
              </BrowserRouter>
            </AppErrorBoundary>
            <Toaster />                      OUTSIDE the error boundary
          </TooltipProvider>
        </DesignSystemLabels>
      </IntlProvider>
    </QueryClientProvider>
  </AppearanceProvider>
</StrictMode>
```

| Layer               | What it gives plugins                                                          | Why exactly here                                                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AppearanceProvider  | The theme and appearance settings                                              | Outside everything: the theme has to be visible to failure screens too                                                                                                                                                                                                      |
| QueryClientProvider | The single `queryClient` — `useQuery`/`useMutation` with no client of your own | The client itself lives in `utils-admin` rather than the host: a plugin must not depend on the composition root for the sake of one request                                                                                                                                 |
| IntlProvider        | The one source of formatting; the strings come from `defaultMessage`           | Above everything that draws text, including the crash card and the library's own labels                                                                                                                                                                                     |
| DesignSystemLabels  | Translations of the design system's own labels (“Close”, for instance)         | The library deliberately carries no i18n runtime — it is consumed outside this application too. Otherwise localising the close button would mean passing a `closeLabel` at twenty-odd call sites                                                                            |
| TooltipProvider     | A shared tooltip delay (200 ms)                                                | One policy for the whole application                                                                                                                                                                                                                                        |
| AppErrorBoundary    | The last line of defence: a card with a heading and a reload button            | **Above** `BrowserRouter` — so that a throw from the router itself is caught                                                                                                                                                                                                |
| RouteAnnouncer      | Announcing a page change                                                       | Inside the router (it needs `useLocation`) but outside `Routes` — it lives for the whole life of the application                                                                                                                                                            |
| UnsavedChangesGuard | The shared “leave and lose your edits” dialog                                  | The mechanism itself is in `utils-admin` and carries no strings; the host connects it to the design system's dialog and to `IntlProvider`                                                                                                                                   |
| Toaster             | The place notifications are rendered                                           | **Outside** the error boundary: a toast is how the rest of the application reports trouble, so it has to survive the trouble the boundary catches. The corner is set inside the design system itself; the host passes no `position` — it used to, and the two drifted apart |

### 6.2 The error boundary: why it has to be a class and has to be here

When a throw during the render phase reaches the root, React unmounts **the entire tree**, and `#root` is left with zero children: no sidebar to leave by, no message, nothing to put focus on, no hint that a reload helps. Two realistic sources: **a lazy chunk that never arrived** (a deploy while the tab was open; chunk names carry a content hash, and `Suspense` can wait but cannot fail, so it rethrows) and a page that read an unexpected shape of API response.

The failure card takes focus on mount: a crash replaces what the person was reading without a navigation the browser would report. Without the move, focus stays on an element that has vanished, the browser drops it onto `<body>` — and a keyboard user tabs from the top of a page nobody told them they had reached, while a screen reader carries on reading the buffer of unmounted content. The heading carries `tabIndex={-1}` so it can accept focus without entering the tab order.

Only a reload is offered, and that is not laziness: a failed lazy chunk is cached as failed by the module registry, and a render that fell over on bad state will fall over again — re-rendering saves neither case.

> **This is a floor, not a ceiling**
>
> A boundary this high up can only offer a reload. A plugin that can degrade one area gracefully must catch inside itself: `insights-admin` puts a boundary around each widget, `identity-admin` around the sign-in screens.

### 6.3 Announcing navigation: why it is harder than it looks

A transition inside an SPA changes the entire view without performing a navigation: `Routes` swaps the element, focus stays on the link that was clicked, the tab title does not change. Nothing is reported to a screen reader — the archetypal SPA failure under WCAG 4.1.3.

The host mounts one visually hidden polite live region for the whole life of the application (existing _before_ the message appears is a precondition for the message being announced at all) and writes the new view's name into it on every path change, **except the first**: the first load is a real navigation, which the browser has already reported.

The subtlety is that naively reading the `<h1>` right after a path change announces the page **you have just left**: the incoming route is a lazy chunk behind a `Suspense` skeleton, and for the first few frames the only heading in the DOM is the outgoing one. Measured on a live environment before the guard existed: the `/workspaces` → `/activity` transition announced “Workspaces” — which is worse than silence, because a person is told they are where they have just left. Hence:

- The last heading seen is remembered (**both the element and its text** — a page that fills its heading in asynchronously looks like the same element with different text).
- Polling every 100 ms, with a 5-second ceiling. No change found — **stay silent** rather than guess. The price: two routes with identical heading text will not be announced, and that is the right side of the trade.
- The heading is looked for inside the `<main>` landmark, if the layout provides one — so the chrome is not mistaken for the page.
- Headings inside `[aria-busy="true"]` are skipped: a lazy route's skeleton carries its own `sr-only` `<h1>` of the form “Loading X”, so the page stays navigable by headings — but that is the name of a _state_, not of a view (ORT-167).
- The state is kept in **module-level** variables rather than in a `useRef`: React 19's `StrictMode` mounts effects twice, the ref is recreated in between, and the deliberately silent first render would announce the landing page on the second pass.
- Focus is **not moved**. Where it should land is the arriving page's decision (the sign-in screens focus their heading, an editor may want the first field), and a host-level move would fight them. Keyboard bypass of the sidebar is the skip link, which belongs to shell.

### 6.4 The i18n error handler

`IntlProvider` logs every `MISSING_TRANSLATION` at `error` level, once per render per descriptor — 460 messages on a single load of `/activity` with `locale: 'de'` — and gives the host no way to lower the level, thin them out or aggregate them. That is not a style complaint: that volume buries everything real in the console, and the console is the one place a developer looks (ORT-141). The host installs its own handler with two rules: a locale matching the default has nothing to be missing — it stays completely silent; otherwise each identifier is reported **exactly once** and at `warn` level. Anything that is not a missing translation passes through untouched — those are genuine formatting errors.

## 07. The slot system

A slot is a named extension point into which plugins put **pure data**. The primitive lives in `@orthacms/utils-admin`, slots are defined by the consuming plugins, and the host does exactly one thing: it wires the contributions up before the first render. Today's build defines **26 slots across six packages**.

| Owner            | Slots | What is extended                                                                                                                                                                                                                       |
| ---------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| content/admin    | 14    | The Content Library: the records list's toolbar and columns, filter fields, menus and bulk actions, the side widgets and entry settings, entry tabs and menu, the header, overlays, pre-save, an extra revision block, a field control |
| shell/admin      | 5     | Sidebar navigation, sidebar sections, the sidebar footer, home-page sections, the command palette                                                                                                                                      |
| workspaces/admin | 3     | Navigation inside a workspace, sections, workspace routes                                                                                                                                                                              |
| insights/admin   | 2     | Dashboard widgets and band sections                                                                                                                                                                                                    |
| copilot/admin    | 1     | Rendering a tool's result in the transcript                                                                                                                                                                                            |
| wysiwyg/admin    | 1     | Media sources for the editor                                                                                                                                                                                                           |

### 7.1 The primitive in full

```
export function createSlot<T>(name: string): Slot<T> {
    const items: T[] = [];
    return {
        name,
        getItems: () => items.slice(),      // a copy, not the live array
        _register: (newItems: T[]) => items.push(...newItems),
        _reset: () => { items.length = 0; } // the length, not a new array
    };
}

export type SlotContribution<T = unknown> = {
    slot: Slot<T>;
    items: T[];
};
```

Two lines here each stand for one defect.

- **`getItems` hands back a copy.** A slot is read by several plugins, and handing out the internal list would turn any one consumer's `sort()` or `push()` into a change of shared plugin state.
- **`_reset` zeroes the length rather than reassigning the array.** `getItems` and `_register` close over that specific array; reassigning would leave them writing to and reading from an array nobody else can see.

### 7.2 Wiring up: why it is a function and not a loop at the call site

```
export function wireSlotContributions(
    contributions: readonly SlotContribution[]
): void {
    for (const slot of new Set(contributions.map((c) => c.slot))) {
        slot._reset();
    }
    for (const contribution of contributions) {
        contribution.slot._register(contribution.items);
    }
}
```

**Idempotence is a load-bearing property**, and it belongs to the slot mechanism rather than to the composition root. A slot closes over one array that lives as long as its module does, and `_register` is a bare `push`. Anything that runs the wiring a second time against those same closures doubles every contribution. Vite's hot update does exactly that — it re-executes the entry module instead of reloading the page. Observed in development: every navigation item and every workspace listed twice, accumulating on each save until a hard reload, with the symptom looking like a bug in whatever you happen to be editing. In a built application the entry module is not re-executed, so this was never a product defect — it cost development time.

The reset is a **separate pass** rather than folded into the registration loop: several plugins contribute to one slot, and clearing “before each contribution” would throw away what a previous plugin of the same run had registered.

### 7.3 What follows from “a slot is an object”

A slot is identified by an **object reference**, not by a name string. A slot does have a `name` field, but it is diagnostic. Three practical consequences follow:

- **You cannot miss a slot.** To contribute you must import the slot itself, that is, have a dependency on the owning package. A typo in a slot's name is impossible as a class of error.
- **Plugin registration order does not affect whether a contribution lands.** Slots are module-level singletons, and the host wires _all_ contributions before the first render. A plugin registered _earlier_ than the one defining the slot still lands. Measured on a live environment: moving `ContentPlugin` after `I18nPlugin` changes nothing but the order of the items inside the slot.
- **Slots are frozen as of load time.** The set of items does not change after the first render — which is exactly why a slot item can safely contain a hook that the render site calls in a loop.

> **What a “slot collision” actually means**
>
> There are never two slots with one name — they are different objects and different extension points. Only **items inside one slot** can collide, and the resolution rules belong to the _consumer_, not to the host and not to the primitive. An example: Insights dashboard sections are **merged by `id`, last one wins** — a deliberate way to rename, reorder or re-icon a built-in band without forking the plugin. Which is also the one place where the order of the admin plugin list genuinely decides something: `InsightsPlugin()` comes first among the in-workspace features precisely so that whoever overrides a band comes after it.

### 7.4 What a slot cannot do

- **It cannot sort by itself.** Item order is the consumer's concern: the typical rule is “by the `order` field first, then by registration order on a tie” (the sort is stable, so the result is deterministic).
- **It cannot filter by permission.** The check is the consumer's — Insights, for instance, filters widgets by `permission` before assembling its bands.
- **It cannot report a lost contribution.** That is on the consumer too, and a good implementation takes care of it: a widget naming a nonexistent section ends up in Insights' trailing “everything else” band, because a silently vanished card is the worst failure a plugin system can produce.
- **It is not a substitute for dynamic regions.** Shell's sidebar also has a route-dependent region (`useSidebarContent`) that the workspace shell takes over — that is a runtime override alongside the load-time slots, not a slot.

## 08. Registration order and collisions

Both hosts receive an **array**, not a set. Working out what a position in that array actually decides matters more than it seems: the intuition “earlier = more important” is wrong almost everywhere here, and is a recurring source of cargo cult in the comments.

### 8.1 The server: what order decides and what it does not

| Aspect                                 | Order-dependent? | Explanation                                                                                                                                                                                                                        |
| -------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency injection                   | no               | Plugin modules are global and Nest builds the whole graph. Measured: `IdentityPlugin` above `DatabasePlugin` — the server comes up and works                                                                                       |
| The `onPluginInit` hooks               | yes              | Run strictly in array order. Today exactly one plugin has a hook, so the effect is invisible — and that is precisely why `database` is kept first: the moment a second resource appears there will be nothing to catch the mistake |
| **Migrations**                         | yes              | The one place where the wrong order breaks the product. A transaction does not span two plugins; foreign keys between plugin schemas are declared nowhere                                                                          |
| Authentication schemes in the document | yes              | On a name clash the last one to register wins                                                                                                                                                                                      |
| The `decorate` passes                  | yes              | Run in registration order, the document is shared, the last writer wins                                                                                                                                                            |
| HTTP routes                            | no               | Routing is Nest's business; a duplicate path across two controllers is a conflict inside Nest, not a result of order in the host's array                                                                                           |

The real `apps/server/src/plugins.ts` list is 15 entries, and the comments in it spell out every dependency: `WorkspacesPlugin` after `IdentityPlugin` (the `memberships → users` foreign key); `ContentViewsPlugin` after identity and workspaces (the `saved_views` foreign keys) and taking `content` by value for the registry; `MediaServerPlugin` after workspaces and identity (it uses their guards); `TransferPlugin` after content and media; `AlarmsPlugin` and `SegmentsPlugin` after content; `McpPlugin` last — though here the order is pure readability, because tools register in `onModuleInit`, when the graph exists in full.

> **A duplicate migrations.table**
>
> The host does not check this situation at all. Two plugins sharing a bookkeeping table will glue their histories together: the second sees somebody else's rows and concludes there is nothing to apply. The `plugins.spec.ts` test checks the tables are unique for the application's build — that is the only protection, and it lives in the application, not the host.

### 8.2 The admin UI: two collisions the host warns about

The host deliberately **does not resolve** collisions; it declares them. The logic is simple: it cannot choose on the application's behalf — it has no information about what was meant; but nor is it obliged to do so in silence.

#### The `layout` collision

```
[bootstrap-admin] 2 plugins contribute a layout; only the first is mounted.
Using "custom-shell", ignoring "shell".
Every non-public route renders inside the winner, so if it is not
the app shell they are no longer gated.
```

The loser is determined by registration order — a decision nobody made. And it is not the chrome that loses: shell's layout is what assembles `RequireAuth`, so the sign-in check, the sidebar, the skip link and the `<main>` landmark go with it. **Every private route renders unprotected** — and it looks like a styling glitch rather than an access hole. Which is why `apps/admin/src/plugins.spec.ts` separately pins the fact that there is exactly one contributor and it is shell.

#### The route collision

```
[bootstrap-admin] route "/media" is contributed by "media", "assets";
only one of them will ever render.
```

React Router matches by **rank**, not by declaration order, so which element renders on a duplicated path is unspecified. React additionally logs a bare “two children with the same key”, which names the path but not the plugins behind it. Naming them is the difference between a five-minute fix and a lost day.

> **What the warnings do not cover**
>
> The host compares `path` **literally**. The route `/media` and the route `/media/*` are different strings, are not counted as a collision and produce no warning, even though they overlap in practice. Duplicate plugin `name`s are checked nowhere either, and they are exactly what makes the warnings themselves useless: the message “"content" and "content" conflict” clarifies nothing.

### 8.3 What order decides in the admin UI

| Aspect                                 | Order-dependent? | Explanation                                                                                                                 |
| -------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Choosing the `layout`                  | yes              | The first one found is taken — and this is the only positional dependency with security consequences                        |
| Whether a contribution lands in a slot | no               | Slots are module singletons, and everything is wired before the first render                                                |
| The order of items inside a slot       | yes              | As the secondary key after `order`: the sort is stable                                                                      |
| Merging by id (Insights sections)      | yes              | The last writer wins — which is why Insights comes first among the in-workspace features                                    |
| The public / private split             | no               | Split by the flag, not by index: a private route from a plugin registered _before_ shell still ends up under shell's layout |
| The winner of a route collision        | no               | Decided by React Router's ranking, not by position in the array                                                             |

The order in `apps/admin/src/plugins.ts`: identity first (the only contributor of public routes), shell second (the only contributor of a `layout`, and keeping it second is what makes an accidental competitor impossible), workspaces, Insights (for the section merge), then content and the plugins that fill its slots (i18n, wysiwyg, media, transfer, alarms, copilot, segments), then the global pages — users, activity, api-tokens. Everything after Insights is intent and readability rather than a requirement.

## 09. Configuration and environment

Neither host **reads `process.env` even once** — with one exception, covered below. The typed configuration is assembled by the application: `apps/server/ortha.config.ts` is the only place that touches the environment, and it hands `createServer` finished values.

```
// apps/server/src/main.ts
createServer({
    plugins: buildPlugins(config),
    port: config.port,
    globalPrefix: config.globalPrefix,
    trustProxy: config.trustProxy,
    bodyLimit: config.bodyLimit,
    docs: config.docs
}).catch((error: unknown) => {
    // The host owns the exit code; the package owns how the failure is named.
    Logger.error('The server failed to start.', /* … */);
    process.exit(1);
});
```

| Variable         | Read by                                | What it becomes                                                                | Default                           |
| ---------------- | -------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------- |
| PORT             | ortha.config.ts                        | `createServer.port`                                                            | 3000                              |
| TRUST_PROXY      | ortha.config.ts                        | `trustProxy`: a hop count → a boolean → a preset string, checked in that order | unset — proxy headers are ignored |
| MAX_REQUEST_BODY | ortha.config.ts                        | `bodyLimit`                                                                    | `'1mb'`                           |
| API_DOCS         | ortha.config.ts                        | `docs.enabled`                                                                 | `NODE_ENV !== 'production'`       |
| NODE_ENV         | **the host itself**, in `setupApiDocs` | the default for `docs.enabled` when the option is not passed                   | —                                 |
| DATABASE_URL     | ortha.config.ts                        | the `database` plugin's configuration, not the host's                          | required                          |
| ADMIN_PORT       | ortha.config.ts                        | the dev admin UI's origin, for plugin settings; nothing to do with the host    | 4200                              |

> **The one environment read inside the host**
>
> In `setupApiDocs` the default for `enabled` is computed as `process.env['NODE_ENV'] !== 'production'`. The application passes `docs.enabled` explicitly, so in practice that branch is unused, but it is there — and it **fails open, literally**: the comparison is a string equality, so `NODE_ENV=Production` and `NODE_ENV=prod` publish the reference exactly as an unset `NODE_ENV` does. That same unset variable also leaves the session cookie without `Secure` and turns on the GraphiQL sandbox — treat “is `NODE_ENV` exactly `production`” as **one** deployment check, not three.

The `API_DOCS` parse is strict too: `API_DOCS === 'true'`. The values `1` and `TRUE` do **not** publish the reference. Both routes — the UI and the JSON — ride on one flag, so `/reference/json` is unreachable exactly when `/reference` is.

### 9.1 The admin host's configuration

There is almost none — three fields, of which one truly matters.

| Option      | Default  | What it does                                                                                                 |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| plugins     | —        | The application's entire composition                                                                         |
| rootElement | `'root'` | The id of the element to mount into; its absence is an exception with readable text rather than a blank page |
| locale      | `'en'`   | `<html lang>`, `<html dir>` and `Intl` formatting. It does not yet translate anything (see 4.3)              |

The writing direction is derived from `Intl.Locale`, and where the browser lacks that API, from a short list of twelve right-to-left languages (`ar`, `arc`, `ckb`, `dv`, `fa`, `he`, `ks`, `ps`, `sd`, `ug`, `ur`, `yi`). The list is deliberately short: **a wrong `dir` is worse than a missing one**, and anything not on it gets the same `ltr` it had before. An unparseable tag is the caller's mistake, and `IntlProvider` will report it, not this function.

> **This is the interface locale, not the content's**
>
> An Arabic entry inside a German admin UI is two directions on one page. They are resolved by the `dir` the entry editor sets per field; the document declares which way the **chrome** runs.

## 10. Security and the cross-cutting harness

The host has not a single guard, not a single credential check and not a line about permissions. And yet almost everything that protects the application passes through it — as rules applied once to everybody.

#### Strict validation by default

`whitelist` + `forbidNonWhitelisted` + `transform`. An undeclared field is not merely ignored — it produces a `400` before the controller. That is what makes a whole class of “smuggle an extra key into the body” attacks impossible: an attempt to pass somebody else's `email` in an accept-invitation body is rejected by the host, not by the plugin.

#### One origin for the UI and the API

`staticDir` exists so that a `SameSite=lax` cookie is sent at all. Splitting the halves would require CORS and `SameSite=none` — weakening CSRF protection in exchange for a deployment-layout convenience.

#### A correct `req.ip`

A plugin that rate-limits or writes an address into the audit is exactly as correct as the `trust proxy` setting is. A mistake here produces an error nowhere — it quietly turns the sign-in limit into one shared bucket, or conversely into one forgeable by a header.

#### A bounded parser appetite

The body ceiling is the bound on how much memory an unauthenticated caller can make you allocate, before any permission check at all. 1 MB is chosen as the compromise between a genuinely long article and that bound.

#### The reference is off in production by default

An internal CMS's API is not obliged to publish its surface. The default is “on outside production”, one switch covers both routes, and it is the same “is this really production” signal as the cookie's `Secure` flag and GraphiQL.

#### A clean shutdown

Without shutdown hooks, any version rollout tears one request per connection per replica. Measured: six simultaneous sign-ins — six reset connections before, zero after.

### 10.1 A failure that names the culprit

Three different crashes — a throw in `onPluginInit`, an invalid `TRUST_PROXY`, a busy port — used to look identical: a bare unhandled-rejection dump without one line saying the server had not started. Now each is logged through `Logger.error` naming the plugin or the port, and `main.ts` catches the rejection, logs it and exits with code 1. The separation of duties here is literal: **the package owns how the failure is named; the application owns the exit code**.

### 10.2 Isolating a documentation failure

The `decorate` pass is wrapped per plugin, and the reasoning is exactly one line: the reference is a developer tool. A plugin that falls over while describing itself must cost its own contribution to the document and a line in the log, not the whole API. Before that guard, one bad `decorate` aborted `createServer` itself, and the server never started listening.

### 10.3 What the host does not protect — and you need to know it

- **There is no authorization gate.** A private route without a protective `layout` is open. The guarantee comes from the application, not the platform.
- **There is no plugin-name uniqueness.** Neither on the server nor in the admin UI.
- **There is no migration-table uniqueness.** It is checked by an application test.
- **There is no check that a `layout` actually protects anything.** The host sees an opaque `ReactNode` and cannot know what is inside.
- **There is no sanitisation of contributions to the OpenAPI document.** `decorate` can rewrite anything, including somebody else's part.
- **There is no connection-pool drain on shutdown.** The host enables the hooks, but `@orthacms/database` does not bind `onModuleDestroy`: the pool is not closed on shutdown. For a process that is exiting anyway this is harmless, and it is also the reason an embedding host that keeps running must call `closeDatabase()` itself.

## 11. Invariants

Statements that must always hold. This is at once a review list and a draft set of test assertions.

- **I-01** — The hosts contain no domain logic: no guards, no tables, no API routes, no screens. Adding a capability never requires editing a file in `packages/bootstrap`.
- **I-02** — Every `onPluginInit` runs **before** `NestFactory.create`, strictly in array order, each awaited.
- **I-03** — A throw in `onPluginInit` aborts the start, is logged with the **plugin's name** and is rethrown to the caller.
- **I-04** — `trust proxy` is applied **before** anything that reads `req.ip`, and only if a value was given.
- **I-05** — The body ceiling is set explicitly and never inherited from `express.json()`; exceeding it is a `413` from the parser, before any controller or guard.
- **I-06** — The global `ValidationPipe` always carries all three flags: `whitelist`, `forbidNonWhitelisted`, `transform`.
- **I-07** — The API documentation is generated **after** the prefix and the pipe are set and **before** `listen`.
- **I-08** — The reference routes are registered on the HTTP adapter rather than in Nest's router: they are outside the global prefix, outside the guards and outside the `ValidationPipe`.
- **I-09** — The JSON route is registered **before** the UI, so it wins the collision when it sits underneath it.
- **I-10** — Both documentation routes ride on one flag: the JSON is unreachable exactly when the UI is. Switched off, `setupApiDocs` returns `null` and mounts nothing.
- **I-11** — A throw in one plugin's `decorate` neither blocks the start nor cancels the other plugins' contributions.
- **I-12** — Operation tags are set only on the eight HTTP method keys; nothing writes `tags` into a path item's `parameters` or `$ref`.
- **I-13** — The SPA fallback never answers a path under the API prefix, under `/reference`, a non-GET/HEAD method, a path with a file extension, or a request that does not accept HTML.
- **I-14** — A missing admin bundle is a warning, not a failed start: the API comes up without a UI.
- **I-15** — Static serving is mounted **last**, after every controller and both reference routes.
- **I-16** — `enableShutdownHooks` is called before `listen`; SIGTERM drains requests rather than tearing connections.
- **I-17** — `createServer` **returns** the listening application — otherwise an embedding host and a test cannot close it.
- **I-18** — `migrations.dir` is a function, evaluated only at migration time and never at load time.
- **I-19** — Every plugin carrying migrations has its own bookkeeping table; plugin histories never intersect.
- **I-20** — Migrations are applied in plugin-array order, with no transaction spanning two plugins; a failure names the plugin and how many are already committed.
- **I-21** — Authentication schemes come **only** from `ServerPlugin.docs`; the host invents none.
- **I-22** — Every slot contribution is wired **before the first render**, in one call, **from an empty state** — a second run does not double the items.
- **I-23** — `Slot.getItems()` returns a copy: one consumer's changes are invisible to another.
- **I-24** — The host neither defines nor reads a single slot.
- **I-25** — Public routes are mounted as top-level siblings, private ones as children of exactly one pathless parent carrying the first `layout` found.
- **I-26** — The `*` → `/` wildcard lives **inside** the private group, not beside it.
- **I-27** — A second `layout` contributor and a duplicate `path` produce a `console.warn` naming the plugins involved; the host never picks a winner silently.
- **I-28** — A missing mount element is an exception naming the id it looked for, not a type assertion and a failure inside React.
- **I-29** — `<html lang>` and `<html dir>` are set **before** the render.
- **I-30** — The error boundary sits **above** `BrowserRouter` (catching a router throw) and **below** `Toaster` in terms of coverage — toasts survive a tree crash.
- **I-31** — The announcing live region is mounted and empty **before** the first navigation; the first page load is not announced.
- **I-32** — Only a **changed** heading is announced; if nothing changes within 5 seconds, no announcement happens at all.
- **I-33** — The announcer **does not move focus** — that is the arriving page's decision.
- **I-34** — A missing translation is reported at most once per identifier and at `warn` level; when the locale matches the default it is not reported at all.
- **I-35** — The admin host imports no authorization package at all: `identity-admin` is absent from its dependencies.
- **I-36** — The server host does not depend on `express` directly; the request and response types are declared structurally.

## 12. Testing checklist

Phrased as “action → expected result”, so they can go into a test case without rewriting. Most of the coverage sits in an application around the host, because a host only makes sense with one: `apps/server-e2e/src/harness/create-server.spec.ts` (the e2e file capable of failing on a host defect), `apps/server-e2e/src/harness/production-parity.spec.ts`, `apps/server-e2e/src/server/auth/login-throttle-proxy.spec.ts`, `apps/admin-e2e/src/host/*` and both applications' unit `plugins.spec.ts`. Both hosts now also carry a `test` target of their own (`packages/bootstrap/server/jest.config.js`, `packages/bootstrap/admin/vite.config.mts`), because the reasoning above only covers what a request or a browser can observe — the host's _ordering_ and its _diagnostics_ are neither: whether a hook ran before `NestFactory.create`, whether `trust proxy` was applied at all, which of two mounts went on first, what the layout-collision warning says.

### The request-body ceiling

- **POST to `/api/auth/login` with a 300 kB body** → 401 from the credential check, not a 413: the request reached the controller. That is the whole point of the check.
- **The same request with `bodyLimit: '20kb'` and a 30 kB body** → 413 from the parser.
- **A body under the configured ceiling** → the request is handled normally.
- **A file upload noticeably larger than `bodyLimit`** → goes through: multipart does not land here and is bounded by `MEDIA_MAX_UPLOAD_BYTES`.

### Failure at startup

- **A plugin whose `onPluginInit` throws** → `createServer` rejects, the log carries a `Logger.error` naming that plugin, and the process exits with code 1.
- **`TRUST_PROXY` with an unparseable value** → the boot fails loudly on `app.set` rather than degrading quietly.
- **The port is already taken** → a log naming the port, then the same exit with code 1.
- **A plugin whose `decorate` throws** → the error is logged with its name, the server comes up, the API answers and the reference is served — without that plugin's contribution.

### Proxy trust

- **Unset `TRUST_PROXY` + a forged `X-Forwarded-For`** → `req.ip` is the peer's address; the header is ignored.
- **`TRUST_PROXY=1`, a chain of three addresses** → `req.ip` is the **third** (one hop from the right).
- **`TRUST_PROXY=true`, the same chain** → `req.ip` is the **first**: entirely under the client's control.
- **Two different forwarded clients hitting the sign-in limit** → each has its own bucket; the session row carries the forwarded address, not the proxy's.
- **A subnet the peer is not in** → the peer's address, without a single warning — the quiet degradation you have to catch by eye.

### API documentation

- **`docs.enabled: false`** → `setupApiDocs` returned `null`; `/reference` and `/reference/json` both 404.
- **The default with `NODE_ENV=production`** → both routes are unavailable.
- **`NODE_ENV=Production` (capitalised)** → the reference **is published** — the comparison is strict; this is expected behaviour and a reason to check the deployment.
- **`API_DOCS=true` with `NODE_ENV=production`** → both routes are available.
- **`API_DOCS=1`** → the reference is **not** published.
- **The paths are given without a leading slash** → both are normalised and served.
- **The JSON path sits under the UI path (the default)** → `GET /reference/json` returns the document, not HTML: the JSON was registered first.
- **Open `/reference/json` without signing in** → the document is served: the route is outside the guards, which is the whole point of the flag.
- **Check the tags in the document** → operations are grouped by the first segment after the prefix (`content`, `auth`, `media`), not by controller class names.
- **Look for the schema of a code-defined content type in the document** → present — added by the content plugin's `decorate`, not by the scanner.
- **The reference's authorization panel** → offers both `session` and `apiToken` as alternatives.

### Serving the admin bundle

- **A real file from the bundle** → served as is.
- **A deep link like `/workspaces/1/entries/2`** → `index.html`, and the router picks it up on a hard reload.
- **A nonexistent path under `/api`** → a JSON 404, not a page.
- **A POST to a path the fallback would otherwise take** → not intercepted: GET and HEAD only.
- **`GET /assets/deleted-chunk.js`** → 404, not a 200 with a page — otherwise a bad deploy reads as a MIME-type error.
- **The same request with `Accept: text/html`** → still a 404: the extension decides, not the header.
- **A client with `Accept: application/json` on a client-side route** → a 404 it can parse.
- **`staticDir` points at an empty folder** → a warning in the log, the API works.
- **`staticDir` is unset** → nothing extra is served.

### Shutdown

- **Check the signal listeners after startup** → the handlers are installed.
- **Six simultaneous sign-ins + SIGTERM** → all six complete with a response, not one reset connection (verified by hand against a built bundle: a hard test is impossible — a jest worker cannot signal itself without ending the run).

### The application's composition

- **Compare the server's `buildPlugins()` with the expected set** → 15 plugins, the same set.
- **Check the order of the plugins carrying migrations** → the foreign keys resolve on a clean database.
- **Check the bookkeeping tables** → each plugin has its own, with no duplicates.
- **Compare the admin UI's `buildPlugins()` with the expected set** → 15 plugins, the same order.
- **Count the `layout` contributors** → exactly one, and it is `shell`.
- **Shell's position** → before any plugin contributing a private route.
- **Migrate a clean database with workspaces moved above identity** → a failure with `relation "users" does not exist`, the message naming the plugin and how many are already applied.
- **The same on an already-migrated database** → passes without a complaint — which is exactly why the mistake reaches a release.

### The admin host in a browser

- **A private route whose chunk fails to load** → a card with a heading and a reload button instead of an empty application.
- **Check focus after a crash** → focus on the card's heading, and the heading outside the tab order (`tabIndex={-1}`).
- **Raise a toast on a broken page** → the toast is visible: `Toaster` is outside the error boundary.
- **Load the application and navigate nowhere** → the live region is mounted and **empty**; the first load is not announced.
- **Go to another page** → the new page's name is announced, not the one just left.
- **Make a second navigation in a row** → the new one is announced, not the previous.
- **Go A → B → A** → A is announced again (the region is cleared before writing, otherwise unchanged text is not read out).
- **Measure the live region's size** → it takes up no space on screen.
- **The first Tab on a page** → a visible skip link; activating it moves focus inside `main`, bypassing the sidebar (shell's contribution, but checked here).
- **Point `rootElement` at something nonexistent** → an exception with the id it looked for in the text.
- **Register a second plugin with a `layout`** → a console warning naming the winner and the losers.
- **Register two plugins with the same `path`** → a warning naming both.
- **Save a file with the dev server running (hot replacement)** → navigation items and workspaces are **not** duplicated.
- **Start with `locale: 'de'`** → `<html lang="de">`, German date formatting, English strings, at most one console warning per identifier.
- **Start with `locale: 'ar'`** → `<html dir="rtl">`.
- **Start with the default locale** → missing translations are not reported at all.
- **Open a path that does not exist** → a redirect to `/` — the wildcard inside the private group.

> **Two things are deliberately covered thinly**
>
> `tagByResource`'s guard against non-operation keys **has no reachable reproduction**: `@nestjs/swagger` does not emit path-level `parameters`, and `decorate` runs _after_ the tags are laid out, so there is nothing to inject such a key with. And SIGTERM's effect on in-flight requests is asserted only as “the listeners are installed” — the drain itself was measured by hand.

> **Why create-server.spec.ts is a special file**
>
> Every other server e2e suite goes through `createTestApp`, which **reimplements** the bootstrap but stops at `app.init()`. That reimplementation is exactly what makes host defects invisible: they are deployment-shaped by nature — a body ceiling inherited from a dependency; a startup failure that does not name the plugin; a SIGTERM that drops requests — and a harness that rewrote the bootstrap cannot fail on any of them. So this file calls the real `createServer`, listens on an ephemeral port and closes the application — and that is the only reason `createServer` returns anything at all.

## 13. Boundaries of responsibility

| Area                                                         | Who owns it                                                        | What the host does                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication and permissions                               | `identity-server` / `identity-admin`                               | Nothing. There are no guards; the server host even takes the document's authentication schemes from a plugin's contribution                                           |
| Gating the admin UI's private routes                         | `shell-admin` (which assembles `AuthProvider` + `RequireAuth`)     | Mounts the first `layout` found as the single parent, without knowing what is inside                                                                                  |
| The database connection                                      | `@orthacms/database`                                               | Calls `onPluginInit` in order — which is enough for the pool to be open before the graph is built                                                                     |
| Applying migrations                                          | `@orthacms/cli` and `@orthacms/nx`                                 | Carries the `migrations` descriptor from the plugin over to the tooling; applies nothing itself                                                                       |
| The database schema                                          | each plugin its own                                                | Zero tables. Even the generated content collection tables belong to the _application_, not to the host and not to the package                                         |
| The HTTP client and the query client                         | `@orthacms/utils-admin`                                            | Imports `queryClient` to mount the provider; does not touch `apiClient` at all — plugins go there directly                                                            |
| The slot primitive                                           | `@orthacms/utils-admin`                                            | Calls `wireSlotContributions`; defines and reads not one slot                                                                                                         |
| The specific slots and navigation items                      | `shell`, `content`, `workspaces`, `insights`, `copilot`, `wysiwyg` | Does not know the application has a sidebar                                                                                                                           |
| Interface strings                                            | each plugin its own, next to the component                         | Provides the one `IntlProvider` and the missing-translation handler; has almost no strings of its own (the crash card, the unsaved-changes dialog, the “Close” label) |
| The document title                                           | pages, via `documentTitle`                                         | Does not touch `document.title`; touches only `lang` and `dir`                                                                                                        |
| Where focus goes after a navigation                          | the arriving page                                                  | Only announces the change of view; it does not move focus                                                                                                             |
| The corner toasts appear in                                  | `design-system`, inside `Toaster`                                  | Mounts `Toaster` with no `position` prop — it used to pass one, and the two drifted apart                                                                             |
| Per-operation documentation (descriptions, response schemas) | the plugins' controllers                                           | Generates the document, but `@ApiOperation`/`@ApiResponse` are none of its business                                                                                   |
| The process exit code                                        | `apps/server/src/main.ts`                                          | Names the failure and rethrows it; exiting is the application's job                                                                                                   |
| Closing the pool on shutdown                                 | nobody (not implemented)                                           | Enables the shutdown hooks; `database` does not bind to them — an embedding host calls `closeDatabase()` itself                                                       |

### What else is missing

- **A plugin registry and discovery.** The list is an array in the application's code. A plugin can neither be “found by name” nor loaded dynamically.
- **A declaration of dependencies between plugins.** Migration order today is a comment and a test, not a declaration; ORT-131 tracks turning it into a checkable statement.
- **A name-uniqueness check** — neither on the server nor in the admin UI.
- **An analogue of `onPluginInit` in the admin UI.** The one pre-render phase is the wiring of slots; everything else is ordinary React effects.
- **Translation catalogues.** There is a mechanism and a missing-translation handler, but no catalogues (ORT-141).
- **A `test` target of their own on either package.** A host only makes sense with an application around it, so its coverage is the e2e suites.
- **A way to switch a plugin off without editing the list.** There are no host-level enabled/disabled flags; a plugin that can switch itself off (`mcp`, `copilot`) does so through its own configuration.

## 14. Where the code and the documentation diverge

Found while reconciling this dossier with the sources. Not product bugs in themselves, but they mislead developer and tester alike — and in the case of the plugin contract the divergence actively hides an existing capability.

| Where                                                               | What it says                                                                                                                                             | How it actually is                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARCHITECTURE.md, §2                                                 | The `ServerPlugin` contract is given as four fields: `name`, `module`, `onPluginInit?`, `migrations?`                                                    | There are **five** fields: `docs?: PluginApiDocs` is missing — the only way to describe authentication and the only way for a plugin with a runtime contract (content) to reach the reference at all. A reader of that section will not learn the mechanism exists                                                                            |
| packages/bootstrap/server/AGENTS.md, “Key exports”                  | “`ServerPlugin` — the plugin contract: `{ name, module, onPluginInit? }`”                                                                                | The same thing, only worse: **two** fields are missing at once — `migrations` and `docs` — even though the same document describes both in detail further down. The document contradicts itself                                                                                                                                               |
| ARCHITECTURE.md, §4                                                 | “`packages/database` … It owns **no schemas and no migrations**”                                                                                         | It owns one table — the transactional outbox `outbox_events` — and carries its own migrations under `__drizzle_migrations_database`. This is the sanctioned exception, and the root `AGENTS.md` describes it correctly                                                                                                                        |
| docs/adr/0002-plugin-based-architecture.md                          | “the shared `@orthacms/database` plugin owns the single connection **but no schema**”                                                                    | The same divergence as above. The ADR is marked “Accepted” and has not been updated since                                                                                                                                                                                                                                                     |
| ARCHITECTURE.md, §6                                                 | “The Content Library defines **five** of its own (records toolbar/columns/filter-fields, entry sidebar/params)”                                          | `content/admin` has **14** slots today: the listed ones plus the records list's menu and bulk actions, the entry's tabs, menu and header, overlays, pre-save, the extra revision block and the field control. The system-wide total is 26                                                                                                     |
| ARCHITECTURE.md, §7 and §8                                          | “Sessions: … **signed** token in an httpOnly cookie”; “there is **no content model** … no LLM integration”                                               | A session is an opaque 256 bits of randomness, verified against a database row; there is no signature at all. And content, media and the copilot have long since shipped — the “what does not exist yet” section is stale in its entirety, and dangerous precisely because it reads as a current overview                                     |
| packages/bootstrap/admin/AGENTS.md, “Architecture”                  | The provider tree is described as “`createRoot` + `<StrictMode>` + `<QueryClientProvider>` + `<IntlProvider>` + `<TooltipProvider>` + `<BrowserRouter>`” | The real tree also has `AppearanceProvider` (the outermost) and `DesignSystemLabels`. The neighbouring “Not owned here” section mentions `AppearanceProvider`, but also forgets `DesignSystemLabels`, even though it is the very layer that localises the library's labels                                                                    |
| packages/bootstrap/admin/src/lib/createAdmin/index.tsx, lines 24–36 | A full JSDoc beginning “Warns when more than one plugin contributes a `layout`” sits immediately before `const DEFAULT_LOCALE = 'en'`                    | The comment is **detached from its function**: `warnOnLayoutCollision` is declared below (line 96) and carries no documentation at all, while the constant got somebody else's. Tools that read JSDoc will attach the layout-collision description to the locale. It also breaks the package's “every exported symbol has a JSDoc” convention |
| packages/bootstrap/admin/AGENTS.md, “Usage”                         | The example shows `createAdmin({ plugins: [ … ] })` with an array literal right inside `apps/admin/src/main.tsx`                                         | `main.tsx` is five lines today, and the list has moved to `./plugins`, built by a `buildPlugins()` function. The move was deliberate (so the composition can be covered by a unit test), and the example conceals it                                                                                                                          |
| AGENTS.md (root) and ARCHITECTURE.md §1                             | “`createServer({ plugins })` — runs each plugin's `onPluginInit`, imports its module, applies global prefix + `ValidationPipe`”                          | Formally true, but it lists three steps out of ten: proxy trust, the body ceiling, OpenAPI and Scalar generation, serving the admin bundle and the shutdown hooks are all left out — that is, exactly the ones that determine a deployment's behaviour                                                                                        |

> **The common pattern in these divergences**
>
> All of them are **truncations, not errors**: the document describes an earlier and poorer version of the host. That is most dangerous in the plugin contract: a developer reading a four-field `ServerPlugin` will not learn about `docs` and will write routes that never reach the reference at all — and since the reference is a developer tool, nobody will notice the absence.

---

**A dossier on the `packages/bootstrap` group.** The structure: business description → composition → the `ServerPlugin` contract → the `AdminPlugin` contract → starting the server → starting the admin UI → slots → order and collisions → configuration → security → invariants → checklist → boundaries → divergences. The “data model”, “HTTP API” and “roles and permissions” sections are deliberately absent: the hosts have no tables, no routes and no permissions — and that is the main thing to know about them.

The source is the source code: all of `packages/bootstrap/server/src/**` and `packages/bootstrap/admin/src/**`, `packages/utils/admin/src/lib/slot`, the composition roots `apps/server/src/{main.ts,plugins.ts}`, `apps/admin/src/{main.tsx,plugins.ts}`, `apps/server/ortha.config.ts`, the migration-descriptor consumer `packages/cli/src/lib/migrate.ts`, the `docs` contributions from `identity-server` and `content-server`, plus the `apps/server-e2e/src/harness/*` and `apps/admin-e2e/src/host/*` suites. The `AGENTS.md` and `ARCHITECTURE.md` documents and ADR-0002 were used as the frame, but every claim was checked against the implementation — the divergences are gathered in section 14.
