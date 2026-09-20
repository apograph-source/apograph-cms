# @orthacms/shell-admin

The **shell plugin** for the Ortha CMS admin UI — the authenticated app chrome.
It contributes the layout (a **left sidebar** — `AppSidebar` — beside a `<main>`
inset) that wraps every private route, plus the home page at `/`. The sidebar is
**collapsible (offcanvas)**: an in-header trigger hides it (`⌘B` also toggles);
when collapsed (or on mobile, where it's an overlay drawer) the reveal trigger
renders **inline in the page's `TopBar`** (the design-system primitive owns
that), and the floating `SidebarToggle` (fixed top-left) is only the fallback
for bar-less pages — it hides itself via `:has()` whenever the open page
renders a top bar (today that means it shows on Home only). shadcn's
`SidebarRail` is deliberately **not** rendered: it's a 16px invisible strip
hanging off the panel edge that (under `offcanvas`) sits outside the panel and
paints a hairline plus a `bg-sidebar` block on hover — a stray bar in the page
with nothing explaining it — and being `tabIndex={-1}` it's a mouse-only
duplicate of three toggles that already exist. It
**owns the gating wiring**: its `layout` composes identity's
`AuthProvider` (auth-state source) around `RequireAuth` (the gate) around
`AppShell`. The host mounts that `layout` as the single parent of all
non-`public` routes but stays auth-agnostic — so the shell is what makes private
routes render only for signed-in users.

## Page-fillable chrome regions (`utils/pageChrome`)

Besides the sidebar, the shell owns two regions it does **not** fill — a page
does, from inside its own tree:

- **The top bar's trailing actions** — `<PageActions />` draws the region (a
  design-system `TopBarActions`); a page pushes controls into it with
  `<PageActionsPortal>`. `PageTopBar` renders `PageActions` already; a page that
  composes `TopBar` itself (content-admin's `ContentTopBar`) adds it as the bar's
  **last** child, since the region is `ml-auto`.
- **The right panel** — `AppRightPanel` (rendered by `AppShell` as the column
  after `SidebarInset`) supplies a header aligned to the top bar (`h-12` +
  bottom border, so the two read as one band) over an independently scrolling
  body; a page fills it with `<RightPanelPortal title="…">`. Registering a panel
  is what makes the column and its toggle exist at all — with none registered
  the column is zero-width and `inert`. Collapsed, the column disappears and the
  reopen button appears in the top bar's actions region, because the panel has
  no width left to draw a control in. The open/collapsed state lives in
  `PageChromeProvider` (persisted, `ortha:right-panel`) rather than with the
  filler, since the control that flips it is chrome.

  **The toggle pair hands focus between its halves**, and this is not optional.
  "Hide {title}" lives inside the panel, "Show {title}" in the top bar, and only
  one is reachable at a time — collapsing puts the first inside the `inert`
  `<aside>`, reopening unmounts the second — so **every toggle destroys the
  control that caused it** and the browser drops focus to `<body>`. `toggle`
  therefore names the survivor (`PanelFocusTarget`) and that control claims focus
  via `usePanelFocusHandoff` in the same commit that reveals it. Both directions
  were broken; a handoff that covers only collapsing looks complete and is not.

  **Persistence records a decision, not a layout.** A viewport under
  `MOBILE_QUERY` starts the panel collapsed whatever was stored (an overlay
  covering the page on arrival is nobody's request), and the persist effect
  **must not write that back** — it used to, so a single load on a phone
  overwrote the desktop preference for good.

  **On a narrow viewport it is an overlay with a hand-wired `Esc`**, and it is
  deliberately **not** a Radix `Sheet`: a Sheet unmounts its content, and the
  panel's body is a portal host that has to stay mounted or collapsing throws
  away the filler's state and refetches its data. So the one affordance a Sheet
  would have brought for free is added by hand. The scrim is `aria-hidden`
  decoration, not a `<button>` — a dismiss control no keyboard could reach was
  worse than none, now that `Esc` exists. Focus is still not *contained* in the
  overlay; that half is open.

**Both are filled by `createPortal`, not by handing the shell a node** the way
`useSidebarContent` does. React resolves context by where a node is _rendered_,
so shell-rendered content is cut off from everything below the shell — the open
workspace, a plugin's slot context, a page's form handlers and busy state. A
portal moves the DOM and keeps the React tree. (`ContentNavSection` in
content-admin shows the cost of the alternative: it re-resolves the open
workspace by hand because it renders above `CurrentWorkspaceProvider`.) The
portal hosts stay mounted whether or not anything fills them — a portal needs its
target to exist, and keeping the panel host mounted means collapsing never
unmounts the filler and throws away its state.

It **owns the sidebar's slots** — all `createSlot` extension points (primitive
from `@orthacms/utils-admin`):

- `SIDEBAR_NAV_SLOT` — the primary nav, grouped Overview / Directory (each
  `SidebarItem` carries a `group` + `icon`). The shell contributes Home; feature
  plugins contribute the rest (Activity, Workspaces, Members).
- `SIDEBAR_SECTION_SLOT` — data-driven sections below the nav (the Workspaces
  quick-list, from `workspaces-admin`).
- `SIDEBAR_FOOTER_SLOT` — persistent footer widgets (the account menu, from
  `users-admin`).
- `HOME_SECTION_SLOT` — the home dashboard's stat tiles + panels.

`AppSidebar` reads each sorted by `order`, so new nav/sections appear without
editing the shell. There is **no top toolbar** — the old `NAVBAR_*` slots and
navbar were replaced by this sidebar.

**Dynamic contextual region.** The sidebar's middle swaps by route: `AppSidebar`
renders the global nav by default, but a descendant can take it over via
`useSidebarContent(render, deps)` (backed by `SidebarContentProvider`, which
`AppShell` mounts around the outlet). The workspace shell uses this to inject its
per-workspace nav. The footer stays persistent across both contexts.

The region holds **one** node, so two callers mounted at once are
last-writer-wins — that part is by design. What was not: the loser's unmount
cleanup cleared the *winner's* content, blanking the sidebar's whole middle until
the next route change. Each caller now holds an ownership token and `clearContent`
is a no-op unless it is still the one showing. An override is also expected to
carry **its own labelled landmark** — the `<nav aria-label="Primary">` belongs to
`GlobalSidebar`, so a node that omits one leaves the region unnamed
(`workspaces-admin`'s `WorkspaceNav` supplies "Content types" / "Tools").

**⌘K ignores editable targets.** `SidebarSearch` binds on `window`, so the
shortcut used to fire with the caret in a page's search box or the rich-text body
— opening the palette, taking the focus, and `preventDefault()`ing away the
keystroke the user meant (WCAG 3.2.2). The *close* half still works from the
palette's own input, which is a text field too. The palette also **restores focus**
when closed without navigating; Radix does not do it here, though it does for every
other overlay in the app.

## Package

- Name: `@orthacms/shell-admin`
- Import: `import { ShellPlugin } from '@orthacms/shell-admin'`
- Grouped package (`packages/shell/admin`), admin-only. Consumed from source
  (`exports` → `./src/index.ts`); no build step.

## Key exports

- `ShellPlugin()` — factory returning an `AdminPlugin` with `layout` (the
  `AppShell`), the private `/` route, and the sidebar nav-item `slots`. Register
  it in `createAdmin({ plugins })`, after `IdentityPlugin()`.
- `ShellAdminPlugin` — the plugin shape (thin alias of `AdminPlugin`).
- `AppShell` — the authenticated layout; renders `AppSidebar` + `<main>`
  `<Outlet/>` inside `SidebarProvider` + `SidebarContentProvider`.
- `PageTopBar` / `PageTopBarCrumb` — the shared incident.io-style page-context
  bar (colored icon tile + breadcrumb, sticky; hosts the inline sidebar-reveal
  trigger when the sidebar is hidden). Every page except Home renders one; pass
  the same icon the page's sidebar nav entry uses and a soft tile pair matching
  its nav accent.
- `SidebarSearch` — the sidebar's search-trigger UI (reused by the workspace
  nav; the global command palette is not yet wired).
- `HomePage` — greets the signed-in user and renders the dashboard from
  `HOME_SECTION_SLOT`.
- `SIDEBAR_NAV_SLOT` / `SidebarItem` (`{ labelId, defaultLabel, to, end?, group,
order, icon, permission? }`) — the primary nav slot; `group` is
  `'overview' | 'directory'`.
- `SIDEBAR_SECTION_SLOT` / `SidebarSectionItem` (`{ id, order, Component }`) —
  data-driven sections below the nav.
- `SIDEBAR_FOOTER_SLOT` / `SidebarFooterItem` (`{ id, order, Component }`) — the
  persistent footer (account menu).
- `HOME_SECTION_SLOT` / `HomeSectionItem` (`{ id, region: 'stat' | 'panel',
order, Component }`) — the home dashboard's tiles + panels.
- `useSidebarContent(render, deps)` / `SidebarContentProvider` — the mechanism a
  route uses to take over the sidebar's contextual region.
- `PageActionsPortal` / `RightPanelPortal` / `PageActions` / `useRightPanel` —
  the page-fillable chrome regions (see above). `AppShell` mounts their
  `PageChromeProvider`; `AppRightPanel` draws the panel column.

## Architecture

- **Layout _and_ gate.** The host (`@orthacms/bootstrap-admin`) owns only the
  public/private split and mounts the `layout` as the parent of private routes —
  it is auth-agnostic. This plugin makes the layout gated by composing identity's
  pieces: `<AuthProvider><RequireAuth><AppShell/></RequireAuth></AuthProvider>`.
  So `AuthProvider` (the `/auth/me` source) and `RequireAuth` (the gate) wrap the
  private subtree; private pages render in `AppShell`'s `<Outlet/>` behind one
  check. This is why the shell **depends on `@orthacms/identity-admin`**.
- **Private by default.** The routes carry no `public` flag, so they mount under
  the gated layout. Public screens (sign-in) come from the identity plugin and
  sit outside the shell.
- **Slot-driven sidebar.** `AppSidebar` renders `SIDEBAR_NAV_SLOT.getItems()`
  (grouped Overview / Directory), then `SIDEBAR_SECTION_SLOT`, then the
  persistent `SIDEBAR_FOOTER_SLOT` — each sorted by `order`. The shell
  contributes its own Home item; the host wires all plugins' contributions
  before render, so the sidebar is open to extension without the shell knowing
  which plugins exist. Built on the design-system `Sidebar` primitive.
- **Dynamic region + dashboard.** `SidebarContentProvider` (mounted in
  `AppShell` around the outlet) lets a descendant route replace the sidebar's
  contextual region via `useSidebarContent` — the workspace shell injects its
  per-workspace nav there. `HomePage` assembles the dashboard from
  `HOME_SECTION_SLOT` (stat tiles + panels) the same way.

## Conventions

- `type` over `interface`; JSDoc on exports; `import type` for type-only imports
- Every module is a `<name>/index.ts(x)` folder — components in
  `src/lib/components/<Name>/`, pages in `src/lib/pages/<Name>/`, the plugin
  factory in `src/lib/utils/shellPlugin/` (`camelCase` for non-components). A
  single-consumer, non-exported component co-locates under its consumer:
  `GlobalSidebar`, `SidebarNavButton`, and `SidebarSearch` live under
  `components/AppSidebar/` (only `AppSidebar` uses them), not in `components/`.
- User-facing strings go through `react-intl` (`defineMessages` + `useIntl`),
  co-located in the component file; ids namespaced `shell.<area>.<key>`
- UI is built from `@orthacms/design-system` components, not bespoke markup

## Commands

- `npm exec nx typecheck @orthacms/shell-admin`
- `npm exec nx lint @orthacms/shell-admin`
- `npm exec nx test @orthacms/shell-admin` — vitest + jsdom (`vite.config.mts`,
  `src/test-setup.ts`). What lives here is the handful of rules a browser cannot
  attribute: the contextual area's ownership token and the `useSidebarContent`
  factory+deps contract, the portal hosts staying mounted across a collapse, the
  focus handoff expiring unclaimed, the empty-nav-group guard (unreachable in a
  browser — the shipped Directory group always has an ungated row), and the
  floating toggle's DOM position, which exists only to satisfy a `~` selector.
  Page *behaviour* stays in `apps/admin-e2e`.
