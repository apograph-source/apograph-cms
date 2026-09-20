# apps/admin

The admin **UI** — a React 19 + Vite SPA. This app is a thin entry point: it
holds almost no logic. It assembles the product by handing a list of **admin
plugins** to the `@orthacms/bootstrap-admin` host.

## What's here

- `src/plugins.ts` — the **plugin registry** (`buildPlugins()`). Adding a feature
  to the admin means registering its `AdminPlugin` here. This is the file you edit
  most. Also add the package to `package.json`'s `dependencies` — Nx infers the
  graph from imports, so nothing breaks if you forget, which is exactly why the
  manifest had drifted two entries behind `main.tsx`.
- `src/main.tsx` — three lines: hand `buildPlugins()` to `createAdmin`.
- `src/plugins.spec.ts` — the composition's own guarantees. The load-bearing one:
  `createAdmin` mounts the **first** plugin `layout` it finds, and the shell's
  layout is what composes identity's `RequireAuth` — so a layout contributed by a
  plugin registered ahead of the shell renders every private route **ungated**
  while signed out. Exactly one plugin in the repo contributes a layout today,
  which is what makes the shipped order safe; the spec is what keeps it that way.
  Relative order between slot-filling plugins is *not* asserted, because it does
  not matter: slots are module-level singletons registered before the first
  render.
- Vite config, HTML entry, app-level wiring. No domain logic. Both ports come
  from this checkout's `.env` (`ADMIN_PORT`, `API_PORT`/`PORT`) so parallel
  worktree stacks do not read each other's database — see
  [`docs/parallel-stacks.md`](../../docs/parallel-stacks.md).
- `index.html` carries an inline **pre-paint theme script**, which covers a
  **returning** browser and only that. The durable, cross-device theme lives on
  the server and the script can only read `localStorage`, so a browser that has
  never run the app resolves `system` against the OS, paints, and then flips one
  network round trip later when `users-admin`'s `ThemeSync` hands the real value
  to the provider. Anyone whose account preference disagrees with their OS
  setting sees that once per browser (and again after clearing site data).

  What makes it *once* rather than every load is that the provider persists the
  hydrated value — pinned by
  `packages/design-system/src/lib/appearance/index.spec.tsx`. Closing the
  first-load case needs the preference served **with the document**, which a
  static SPA behind a Vite/CDN origin cannot do; it is not a bug in the script.
  (ORT-151.)

## How it fits

- The host (`createAdmin({ plugins })`) mounts the React root, router, and
  providers (TanStack Query, `IntlProvider`), then mounts each plugin's routes,
  layout, and slot contributions.
- Workspace packages resolve **from source** — Vite transpiles plugin/design-
  system source directly; no build step to consume them.

## Working here

- Authoring or changing an admin plugin is governed by the **`admin-plugin`**
  skill (module layout, lazy routes, per-hook TanStack Query data layer,
  `useHasPermission` gating, co-located `react-intl` messages).
- UI must meet WCAG 2.1 AA — see the **`accessibility`** skill.
- E2E coverage lives in `apps/admin-e2e` (Playwright POM, `/api` mocked) — see
  the **`admin-e2e`** skill.
- Common front-end traps: `.cursor/BUGBOT.md` (Admin section).

See [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) for the full picture.
