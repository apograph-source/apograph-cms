# @orthacms/bootstrap-admin

The admin-side **host** for the Ortha CMS. Turns a list of plugins into a
running React SPA. Owns the mount + router shell that must exist exactly once;
contains no features.

## Package

- Name: `@orthacms/bootstrap-admin`
- Import: `import { createAdmin, type AdminPlugin } from '@orthacms/bootstrap-admin'`
- Admin-only. Consumed from source; the admin app's Vite transpiles it directly.
- Lives at `packages/bootstrap/admin` (grouped layout); npm name stays
  hyphenated.

## Conventions

- Uses `type` for type contracts (not `interface`)
- All exported symbols have JSDoc comments
- No `.js` extensions in TypeScript imports
- JSX enabled (`react-jsx`), DOM types available
- Types go in `src/lib/types/<name>/index.ts`; the bootstrap entry in
  `src/lib/createAdmin/index.tsx`. Every module is a `<name>/index.ts(x)` folder
  (`camelCase` for non-components)
- Always import types with the `type` keyword

## Key exports

- `createAdmin(options)` — mounts the React root, wraps it in `BrowserRouter`,
  splits routes into public siblings + a single private group under the
  contributed `layout`, and renders a catch-all redirect
- `AdminPlugin` — the plugin contract: `{ name, routes?, layout?, slots? }`
- `RouteItem` — a contributed route: `{ path, element, public? }`
- `CreateAdminOptions` — `{ plugins, rootElement?, locale? }`

The host is **auth-agnostic** — it owns no `RequireAuth`, no auth context, no
`signInPath`. Authentication (state + gate) lives entirely in
[`@orthacms/identity-admin`](../../identity/admin/AGENTS.md); the shell composes
identity's `AuthProvider` + `RequireAuth` inside the `layout` it contributes.

## Architecture

- **Mount + shell.** `createAdmin` is the single place the SPA is created
  (`createRoot` + `<StrictMode>` + `<QueryClientProvider>` + `<IntlProvider>` +
  `<TooltipProvider>` + `<BrowserRouter>`).
- **Plugin assembly.** It flattens every plugin's `routes`, then splits them by
  the `public` flag: public routes mount as top-level siblings, while every
  other route mounts under one pathless parent route whose element is the first
  plugin-provided `layout` (or a bare `<Outlet/>`). All private pages render in
  that layout's outlet; the `*` catch-all (→ `/`) lives inside the group.
- **Collisions are warned about, not resolved.** Two plugins contributing a
  `layout`, or two contributing the same route `path`, are both "first one wins"
  — and the loser is decided by registration order, which nobody chose. The host
  cannot pick for the app, so it `console.warn`s and names the plugins involved.
  The layout case is the one that bites: the shell's layout is what composes
  identity's `RequireAuth`, so a layout registered ahead of it takes the auth
  gate, the sidebar, the skip link and the `<main>` landmark with it, and every
  private route renders **ungated**.
- **A missing mount element is an error, not a blank page.** `rootElement` is
  looked up and checked; a missing id throws with the id in the message, rather
  than being cast to `HTMLElement` and failing inside React.
- **One error boundary above everything** (`AppErrorBoundary`). A render-phase
  throw that reaches the React root unmounts the whole tree, leaving `#root`
  with zero children — no chrome to navigate away with and nothing to focus. The
  realistic cause is a **lazy chunk that never arrives** (a deploy while the tab
  was open: chunk names are content-hashed, and `Suspense` handles waiting, not
  failing). The fallback is a real `<h1>` plus a Reload control, and it takes
  focus on mount. It sits outside `BrowserRouter` (so a router throw is caught
  too) and outside `Toaster` (so notifications outlive the failure). It is a
  floor, not a substitute: a plugin that can degrade one region should catch
  there, as `insights-admin` does per widget and `identity-admin` around the auth
  screens.
- **Navigation is announced** (`RouteAnnouncer`). A client-side navigation swaps
  the view without the browser navigating, so nothing reports it: focus stays on
  the link that was activated and the tab title does not change. The host mounts
  one `sr-only` polite live region for the app's life and writes the new view's
  `<h1>` into it on every pathname change after the first (WCAG 4.1.3). It
  deliberately does **not** move focus — where focus belongs is the arriving
  page's decision (identity's auth screens focus their own heading), and the
  keyboard path past the sidebar is the shell's skip link.
- **Auth-agnostic by design.** The host attaches no auth meaning to the
  public/private split — it only knows "private routes render under the
  `layout`." Whether the layout _gates_ them is the layout's business: the shell
  wraps its chrome in identity's `AuthProvider` + `RequireAuth`. So a `public:false`
  route with no gating `layout` renders **ungated** (fail-open) — the host does
  not guarantee a gate. This keeps the host free of any auth code; the trade is
  that gating is an application choice (the shell opts in), not a host guarantee.
- **Data.** The `QueryClient` and the axios `apiClient` live in
  [`@orthacms/utils-admin`](../../utils/admin/AGENTS.md), a shared leaf library.
  The host only imports `queryClient` to mount `<QueryClientProvider>`; plugins
  import `apiClient`/`queryClient` from there directly. Keeping these out of the
  host means a plugin never depends on the composition root just to make a
  request — the host stays purely the app shell.
- **Slots.** The plugin contract carries an optional `slots` — each a
  `{ slot, items }` contribution to a `createSlot` extension point (the primitive
  lives in `@orthacms/utils-admin`). Before render, `createAdmin` wires every
  plugin's contributions into their target slots, through
  `wireSlotContributions`. The host is **slot-agnostic**: it only wires; it
  never defines or reads a slot. A consuming plugin owns each concrete slot
  (e.g. the shell owns the sidebar's `SIDEBAR_NAV_SLOT` and reads it in its
  `layout`).

    It wires **from empty**, not by appending, and that matters in dev: a slot
    closes over one array that lives as long as its module, so a Vite hot update —
    which re-executes `main.tsx` rather than reloading the page — ran the wiring a
    second time against those same closures and doubled every contribution,
    compounding with each save until a hard reload. A production build never
    re-executes the entry, so this was never a shipped-app bug; it cost dev time
    because the symptom looks like a bug in whatever you were editing.

- **i18n.** The host owns the single `react-intl` `IntlProvider` (`locale`
  defaults to `en`; messages resolve from each descriptor's `defaultMessage`).
  Plugins author strings with `defineMessages` + `useIntl` and **co-locate
  their descriptors in the component file** (a module-level
  `const messages = defineMessages({ … })`), not a shared `messages.ts`. IDs
  are namespaced (`<plugin>.<area>.<key>`) to stay globally unique.
- The host renders no chrome of its own yet — with no plugins it serves a blank
  shell. Global styles are imported by the **app** (`main.tsx`), not the host.

## Usage

```typescript
// apps/admin/src/main.tsx
import { createAdmin } from '@orthacms/bootstrap-admin';
import './styles.css';

createAdmin({
    plugins: [
        // { name: 'users', routes: [{ path: '/users/*', element: <Users /> }] }
    ]
});
```

## Not owned here (deferred until a plugin needs it)

- Anything auth — state, gate, and `/api/auth/me` all live in
  `@orthacms/identity-admin`; the host never imports them
- The authenticated shell/chrome — contributed via a plugin's `layout`
  (see `@orthacms/shell-admin`); the host only mounts it
- Concrete slots & nav items — the host wires `slots` contributions but defines
  none; the shell owns the sidebar's `SIDEBAR_NAV_SLOT` and its nav items
- Providers beyond `AppearanceProvider`, `QueryClientProvider`, `IntlProvider`,
  `TooltipProvider`, the router and `Toaster` — add when a plugin requires them.
  The toast **corner** is not owned here: it is declared once in the design
  system's `Toaster`, and the host passes no `position` (it used to, and the two
  disagreed)
- Actual pages — those live in feature plugins

## Tests

Coverage is split by what can observe the defect.

**`apps/admin-e2e/src/host/*`** drives the assembled app in a browser: the error
boundary's card, the live region, the announcement on a second navigation.
**`apps/admin/src/plugins.spec.ts`** pins the shipped composition — one layout
contributor, and it is the shell.

**The package's own unit specs** (vitest + jsdom;
`npm exec nx test @orthacms/bootstrap-admin`) cover what neither can. Both of the
above run in the direction where nothing is wrong, so between them every
diagnostic in `createAdmin` could be deleted unnoticed — and the diagnostics
exist for the composition nobody has assembled yet:

- `src/lib/createAdmin/index.spec.tsx` — the layout-collision and duplicate-path
  warnings (I-27), the named exception for a missing mount element (I-28),
  `<html lang>`/`dir` set before the root is created (I-29), slot contributions
  wired before the render (I-22), the public/private split and its single
  pathless parent (I-25), the `*` redirect living inside that parent (I-26), and
  the once-per-id missing-translation report (I-34). The collision, mount and
  `lang`/`dir` cases boot **without** a mount element on purpose: the host warns,
  then throws on the missing container before `createRoot`, so one call exercises
  the diagnostics with no tree to tear down and the throw doubles as proof of
  what ran before the render.
- `src/lib/RouteAnnouncer/index.spec.tsx` — the announcer names the arriving page
  and does **not** move focus (I-33). Each case re-imports the module, because
  the announcer keeps its "what did I last see" state at module level.
- `src/host-boundaries.spec.ts` — the two claims about what is _absent_, which no
  rendered page can show: the host wires slots without defining or reading one
  (I-24), and imports no authorization package at all (I-35).

## Commands

- `npm exec nx typecheck @orthacms/bootstrap-admin`
- `npm exec nx build @orthacms/bootstrap-admin`
