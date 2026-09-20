# Shell

_Package · packages/shell/admin_

**The authenticated application's chrome — sidebar, slots, palette and access gate**

Shell is the only package that knows **what a signed-in admin looks like**. It gives the host one `layout`, and inside that layout sit two things at once: the **interface frame** (left sidebar, page area, right panel) and the **authorization gate** — an `AuthProvider` around a `RequireAuth`. The host knows nothing about authorization at all: it merely mounts the layout as the single parent of every non-public route. Shell has almost no content of its own — it declares five slots and renders whatever other plugins put into them.

- **1** package, admin only
- **5** declared slots
- **15** contributions into them
- **7** contributing plugins + shell itself
- **1** route of its own
- **10** components + **1** page
- **26** public exports
- **0** database tables and HTTP routes

## Contents

- [01. Business description](#01-business-description)
- [02. Package composition and place in the system](#02-package-composition-and-place-in-the-system)
- [03. Roles and permissions: what exactly is gated in the navigation](#03-roles-and-permissions-what-exactly-is-gated-in-the-navigation)
- [04. Slot map](#04-slot-map)
- [05. Routes and screens](#05-routes-and-screens)
- [06. Scenarios — how it works step by step](#06-scenarios-how-it-works-step-by-step)
- [07. States and behaviour](#07-states-and-behaviour)
- [08. The tab title and its registry](#08-the-tab-title-and-its-registry)
- [09. Configuration](#09-configuration)
- [10. Accessibility and the keyboard](#10-accessibility-and-the-keyboard)
- [11. Invariants](#11-invariants)
- [12. Testing checklist](#12-testing-checklist)
- [13. Boundaries of responsibility](#13-boundaries-of-responsibility)
- [14. Discrepancies between the code and the documentation](#14-discrepancies-between-the-code-and-the-documentation)

## 01. Business description

Everything the user sees after signing in is drawn by this package — or slotted into a hole this package left. The sidebar on the left, the context bar on top, the right panel, the home dashboard, the ⌘K command palette: that is shell. And yet it is almost empty in itself — all the product functionality arrives from outside.

### The problem it solves

- **One frame for the whole application.** The sidebar, the content area and the right panel are mounted **once** and survive any navigation. A route change redraws only the contents of `<Outlet/>`: the sidebar does not flicker, the scroll port is not reset, an open chat is not reloaded.
- **The authorization gate where the frame is.** A route's privacy is not a flag on the route but **the fact of being nested** inside a layout that closes itself. A plugin need not remember `RequireAuth`: it simply does not set `public: true`, and its page ends up behind the check.
- **Extensibility without editing shell.** A new section appears — the plugin puts an entry into `SIDEBAR_NAV_SLOT`, and the navigation row appears by itself, in the right group and at the right position. Shell imports no feature plugin and knows none of their names.
- **One set of keyboard conventions.** ⌘K is the palette, ⌘B the sidebar, Tab from the very start is “skip navigation”. Not something every page invents for itself.
- **A place for what a page wants to push out into the chrome.** The “Publish” button belongs to the entry editor, but it has to be drawn in the top bar; the properties panel belongs to the same page but lives in a separate column. Shell provides two portals for that.

### Who sees it

#### The content editor

Lives in the sidebar: workspaces, content types, the CMS ⇄ Agents switch. Collapses the panel with ⌘B when a table needs the width, and brings it back the same way.

#### The administrator

Sees two more navigation rows — “Members”, “API tokens” and “Segments” appear only with the corresponding permission. The home dashboard assembles statistics and recent activity for them.

#### The plugin developer

Does not touch shell at all. Puts an entry into a slot, a route into `routes`, opens a portal into the top bar if needed — and their page looks like part of the product.

### What Shell is not

- **It is not authentication.** `AuthProvider`, `RequireAuth`, `useHasPermission`, the sign-in screen — all of that is `identity-admin`. Shell only _places_ two of them in the right order.
- **It is not the router.** Splitting routes into public and private, the ordering, path collisions, the catch-all — that is `bootstrap-admin`.
- **It is not the design system.** `Sidebar`, `SidebarProvider`, `TopBar`, `CommandDialog`, the sidebar-state cookie, ⌘B, the mobile breakpoint — those are `@orthacms/design-system` primitives. Shell composes them and translates their labels.
- **It is not the workspace shell.** The sidebar's contextual area inside `/workspaces/:id/*` is taken over entirely by `workspaces-admin` through `useSidebarContent`. At that moment shell draws only the footer.
- **It is not search.** The palette is a shell: the “Go to” list is built from the navigation slot, and everything else is supplied by plugins.

> **The key architectural idea**
>
> **The layout _is_ the gate.** The host takes the first `layout` it comes across in the plugin list (`plugins.map(p => p.layout).find(Boolean)`) and mounts it as the single parent of all private routes. Shell returns not a bare frame but `<AuthProvider><RequireAuth><AppShell/></RequireAuth></AuthProvider>`. The consequence with the sign reversed: **a plugin registered before shell that supplies its own `layout` silently disables authorization for the whole application** — along with the sidebar, the skip link and the `<main>` landmark. That is why the host prints a warning when there are two layout contributors, and why `apps/admin/src/plugins.spec.ts` asserts that there is exactly one contributor and that it is shell.

## 02. Package composition and place in the system

This is a **grouped** package with a single group member: `packages/shell/admin` → `@orthacms/shell-admin`. There is no server half and none is intended — shell owns neither tables nor API routes. It resolves from source (`exports` → `./src/index.ts`) and needs no build.

### 2.1 Modules

| Path under `src/lib`                                   | What it is                                                                                                                                            | Exported |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| utils/shellPlugin                                      | The `ShellPlugin()` factory: `layout`, the `/` route, the “Home” contribution into its own navigation slot                                            | yes      |
| components/AppShell                                    | The frame: `SidebarContentProvider` → `PageChromeProvider` → `SidebarProvider` + skip link + sidebar + `SidebarInset` + right panel + floating toggle | yes      |
| components/AppShell/SidebarToggle                      | The floating expand button (fixed top-left), hides itself through `:has()`                                                                            | no       |
| components/AppSidebar                                  | The sidebar itself: the contextual area (global navigation or an override) + a permanent footer from a slot                                           | no       |
| components/AppSidebar/GlobalSidebar                    | The default content: brand, the “hide” trigger, search, the Overview / Directory groups, sections from a slot                                         | no       |
| components/AppSidebar/SidebarNavButton                 | One navigation row: the link, the active state, the permission gate                                                                                   | no       |
| components/AppSidebar/SidebarSearch                    | The search trigger + the ⌘K command palette, including rendering `COMMAND_SLOT`                                                                       | yes      |
| components/AppSidebar/SidebarSearch/SidebarCommandItem | One “Go to” row in the palette, with the same permission gate                                                                                         | no       |
| components/PageTopBar                                  | The shared page-context bar: the icon tile + breadcrumbs + `PageActions`                                                                              | yes      |
| components/PageActions                                 | The trailing area of the top bar: the actions portal host + the right panel's restore button                                                          | yes      |
| components/AppRightPanel                               | The third column: a heading, the “hide” button, an always-mounted portal host, an overlay on mobile                                                   | no       |
| pages/HomePage                                         | The `/` page: a time-of-day greeting + the dashboard from `HOME_SECTION_SLOT`                                                                         | yes      |
| slots/sidebarSlots                                     | The three sidebar slots + their types                                                                                                                 | yes      |
| slots/homeSlots                                        | The home dashboard's slot + types                                                                                                                     | yes      |
| slots/commandSlots                                     | The command palette's slot + types                                                                                                                    | yes      |
| utils/sidebarContent                                   | The context for overriding the sidebar's contextual area: the provider, `useSidebarContent`, the internal `useSidebarContentOverride`                 | partly   |
| utils/pageChrome                                       | The right panel's state, the two portals, passing focus between the toggle's two halves                                                               | partly   |

### 2.2 Dependencies

| Dependency                | Why this one specifically                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @orthacms/identity-admin  | `AuthProvider`, `RequireAuth` (the layout), `useHasPermission` (the row gate), `useAuth` + `AuthStatus` (the name in the greeting, recomputing group visibility) |
| @orthacms/design-system   | `Sidebar`/`SidebarProvider`/`SidebarInset`/`SidebarTrigger`, `TopBar`, `CommandDialog`, `Container`, `Logo`, `Kbd`, `useIsMobile`, `cn`                          |
| @orthacms/utils-admin     | `createSlot`, `byOrder`, `useDocumentTitle`, `isComposingText`                                                                                                   |
| @orthacms/bootstrap-admin | only the `AdminPlugin` type                                                                                                                                      |
| lucide-react              | icons (`HomeIcon`, `Search`, `PanelRightOpen`, `PanelRightClose`)                                                                                                |
| react-intl                | 27 keys, `defineMessages` co-located in every component, the `shell.` prefix                                                                                     |

> **The direction of the dependency**
>
> Shell depends on `identity-admin`, but **not the other way round**, and no feature plugin is imported by shell. The reverse direction — plugins importing slots from `@orthacms/shell-admin` — is the entire extension mechanism. There are no cycles: a slot is pure data, and there is no React in the slot module.

### 2.3 Load order

1. **The host reads routes and slots.** `createAdmin` splits `routes` by the `public` flag and calls `wireSlotContributions` once with all the contributions of all the plugins.
   _registration starts “from zero”: first a \_reset() on each affected slot, then \_register — otherwise Vite's hot reload would double every sidebar row_
2. **The host picks a layout.** The first non-null one among the plugins; with two or more — a `console.warn` naming the winner and the losers.
3. **Rendering.** Public routes are top-level siblings; all the rest are children of a pathless `<Route element={layout}>`, plus the catch-all `*` → `<Navigate to="/" replace/>`, also inside the layout, that is, also behind the gate.
4. **Slots are read during rendering.** `SIDEBAR_NAV_SLOT.getItems()` is called in the component body, not in an effect — by that point registration is already finished, so the order in which plugins are registered does not affect visibility.

## 03. Roles and permissions: what exactly is gated in the navigation

Shell introduces no permissions of its own and makes no access decisions. It does exactly one thing: **it hides a navigation row if the user lacks the permission declared in the row itself**. This mirrors the server-side gate rather than replacing it — the page behind the link checks itself in any case, and so does the API.

### 3.1 The visibility rule

The rule is written down twice and the two must agree: once per row in `SidebarNavButton` and `SidebarCommandItem`, and once at the group level in `GlobalSidebar`.

- **No `permission` field** → the row is visible to anyone signed in.
- **A `permission` is present** → visible only if the key is in `auth.user.permissions`.
- **The hook is always called.** `useHasPermission(item.permission ?? '')` — an empty key is never granted, but the order of hooks stays stable for any set of fields.
- **`useHasPermission` is fail-closed:** `false` in every state except `Authenticated`. While the “who am I” probe is in flight, nothing gated flickers.
- **A whole group disappears** if no rows survive the filter — otherwise the “Directory” heading would hang over an empty body. For that, `GlobalSidebar` reads the permission set once instead of calling the hook per item.

### 3.2 What is gated today

| Row        | Package          | Group     | order | Permission required |
| ---------- | ---------------- | --------- | ----- | ------------------- |
| Home       | shell-admin      | overview  | 10    | `none`              |
| Activity   | activity-admin   | overview  | 20    | `activity:read`     |
| Workspaces | workspaces-admin | directory | 10    | `none`              |
| Members    | users-admin      | directory | 20    | `users:read`        |
| API Tokens | api-tokens-admin | directory | 30    | `tokens:read`       |
| Segments   | segments-admin   | directory | 40    | `segments:read`     |

So four of the six rows are gated. “Home” and “Workspaces” are visible to anyone signed in deliberately: the home page is the landing point after sign-in, and the workspace list is scoped by membership on the server anyway.

### 3.3 What is _not_ gated in shell itself

- **Sidebar sections and the footer.** `SIDEBAR_SECTION_SLOT` and `SIDEBAR_FOOTER_SLOT` hand over a whole component, and it is the component that decides “should I show myself”. And that is how it is done: `WorkspacesNavSection` disappears when there are no active workspaces and no permission to create one; `AccountMenu` is not drawn until the user resolves; `CopilotLauncher` stays silent outside a workspace, without `copilot:use`, and on a deployment with the copilot turned off.
- **The dashboard.** `HOME_SECTION_SLOT` — the same rules: the tile decides for itself.
- **The right panel and the actions area.** They are filled by the page, which has already passed its own checks.

> **The palette mirrors the sidebar**
>
> `SidebarCommandItem` applies the same check as `SidebarNavButton`: you cannot “go to” a place in the palette that you cannot click to. That is not a convenience but a requirement of the gate — otherwise ⌘K would be a hole around the navigation checks (even if one that runs into a server-side refusal).

## 04. Slot map

A slot is a named extension point created by `createSlot<T>(name)` from `@orthacms/utils-admin`. It is pure data: the slot module imports no React and knows nothing about who writes into it or who reads it. A plugin declares its contributions declaratively in the `slots` field, and the host registers them all at once before the first render.

### 4.1 The mechanics — what to know before reading the tables

- **A slot is a module-level singleton.** One array for the application's whole lifetime. That is why the order in which plugins are registered does not affect a contribution's _visibility_: a plugin may write into a slot declared by a plugin that registers later.
- **`getItems()` returns a copy.** A consumer that sorts or filters the list in place will not spoil it for the next consumer.
- **Registration is idempotent.** `wireSlotContributions` first `_reset()`s every affected slot in _a separate pass_ (otherwise clearing inside the loop would erase the contribution of a plugin registered earlier in the same run), and only then registers. This cures a real symptom: Vite's hot update re-executes the entry module, and without the reset every sidebar row and every workspace was duplicated on each save.
- **The order is `byOrder`, and the sort is stable.** `items.slice().sort((a,b) => a.order - b.order)`. On equal `order`, the plugin registration order from `apps/admin/src/plugins.ts` wins.
- **A slot is not shell's only extension mechanism.** There are two more, built differently: overriding the contextual area (`useSidebarContent` — exactly one node) and the page portals (`PageActionsPortal`, `RightPanelPortal`). See 4.4 and 4.5.

### 4.2 The slots shell declares

| Slot                 | Name                  | Who renders it                                                                                                | What is rendered                                                                                                           | Order                                                                                               |
| -------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| SIDEBAR_NAV_SLOT     | shell.sidebar.nav     | `GlobalSidebar` (rows are `SidebarNavButton`); the same list is read by `SidebarSearch` for the “Go to” group | A declarative record: `labelId`, `defaultLabel`, `to`, `end?`, `group`, `order`, `icon`, `iconColor?`, `permission?`       | Groups in the fixed order **overview → directory**, and within a group — `byOrder`                  |
| SIDEBAR_SECTION_SLOT | shell.sidebar.section | `GlobalSidebar`, directly below `<nav>`                                                                       | An arbitrary component with no props (`{ id, order, Component }`) — it may be tied to a query                              | `byOrder`                                                                                           |
| SIDEBAR_FOOTER_SLOT  | shell.sidebar.footer  | `AppSidebar` — **outside** the contextual area, so it survives an override                                    | An arbitrary component with no props (`{ id, order, Component }`)                                                          | `byOrder`; `<SidebarFooter>` is not rendered at all when there are no items                         |
| HOME_SECTION_SLOT    | shell.home.section    | `HomePage`                                                                                                    | `{ id, region: 'stat' \| 'panel', order, Component }`; `stat` is an auto grid from 180px, `panel` is two columns from `lg` | First the split by `region`, then `byOrder` within the region. An empty region renders no container |
| COMMAND_SLOT         | shell.command         | `SidebarSearch`, inside `CommandList`, after the static “Go to” group                                         | `{ id, order, Component }`; the component receives a `close: () => void` prop                                              | `byOrder`; mounted **only while the palette is open**                                               |

### 4.3 Who writes into them — the full list of contributions

Fifteen entries from eight packages — seven contributing plugins and shell itself. That is everything in the repository as of this review.

| Slot            | Package          | id / label                    | order      | What it is on screen                                                                                                                                                          |
| --------------- | ---------------- | ----------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SIDEBAR_NAV     | shell-admin      | Home (`to: '/'`, `end: true`) | 10         | The “Home” row in the Overview group, with an orange icon accent when active                                                                                                  |
| SIDEBAR_NAV     | activity-admin   | Activity (`/activity`)        | 20         | The activity log; blue accent; the `activity:read` permission                                                                                                                 |
| SIDEBAR_NAV     | workspaces-admin | Workspaces (`/workspaces`)    | 10         | The workspace list in the Directory group; violet accent                                                                                                                      |
| SIDEBAR_NAV     | users-admin      | Members (`/users`)            | 20         | Members; green accent; the `users:read` permission                                                                                                                            |
| SIDEBAR_NAV     | api-tokens-admin | API Tokens (`/api-tokens`)    | 30         | External tokens; orange accent; the `tokens:read` permission                                                                                                                  |
| SIDEBAR_NAV     | segments-admin   | Segments (`/segments`)        | 40         | Reader audiences; purple accent; the `segments:read` permission                                                                                                               |
| SIDEBAR_SECTION | workspaces-admin | workspaces.quicklist          | 10         | A quick list of active workspaces; the heading works as a collapse trigger (Radix `Collapsible`), and “+” leads to creation given the `workspaces:create` permission          |
| SIDEBAR_FOOTER  | users-admin      | users.themeSync               | 0          | Renders nothing: it pulls in the user's saved theme. It lives in the footer precisely because sidebar sections disappear when the area is overridden, and the footer does not |
| SIDEBAR_FOOTER  | copilot-admin    | copilot                       | 10         | The Ortha AI dock: the single entry point into the chat, ⌘J; silent outside a workspace and without `copilot:use`                                                             |
| SIDEBAR_FOOTER  | users-admin      | users.account                 | 10         | The account: avatar, name, email, and the “My profile” / “Sign out” menu                                                                                                      |
| HOME_SECTION    | workspaces-admin | workspaces.home.stats         | 10 · stat  | Workspace metric tiles — the dashboard's top row                                                                                                                              |
| HOME_SECTION    | workspaces-admin | workspaces.home.panel         | 10 · panel | The “Workspaces” panel — the left column                                                                                                                                      |
| HOME_SECTION    | activity-admin   | activity.home.recent          | 20 · panel | The “Recent activity” panel — the right column                                                                                                                                |
| COMMAND         | workspaces-admin | workspaces.command            | 10         | The “Workspaces” group: every active workspace as a result, navigating to its base                                                                                            |
| COMMAND         | content-admin    | content.command               | 20         | The content types of every workspace, each labelled with its workspace's name                                                                                                 |

> **An order tie in the footer**
>
> `copilot` and `users.account` are both declared with `order: 10`. The on-screen order (the dock above the account) rests not on the numbers but on the fact that `CopilotPlugin()` is registered before `UsersPlugin()` in `apps/admin/src/plugins.ts`, and that `byOrder` is a stable sort. The comment in the copilot's code claims the account sits “at a higher order”; that is wrong, and swapping two lines in `plugins.ts` would silently change the footer's order.

### 4.4 Adjacent slots: other packages', but rendered inside shell's frame

Inside `/workspaces/:id/*` the sidebar's contextual area is taken by `WorkspaceNav` from `workspaces-admin`. It reads **its own** slots — shell does not and cannot know about them. They are still worth knowing about: visually this is the same sidebar, and half the product extends itself right here.

| Slot                                        | Declared by      | Rendered by                             | Who writes                                                                                                                        | What appears                                                                                                 |
| ------------------------------------------- | ---------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| WORKSPACE_NAV_SLOT<br>workspace.nav         | workspaces-admin | `WorkspaceNav`, the “Tools” group       | media (Media Library, 20), insights (Insights, 30), alarms (Alarms, 40, the `alarms:read` permission), workspaces (Settings, 100) | Workspace tool rows; `to` is relative (`'media'`), and the slot's owner supplies the base                    |
| WORKSPACE_SECTION_SLOT<br>workspace.section | workspaces-admin | `WorkspaceNav`, above the “Tools” group | copilot (`copilot.viewSwitcher`, 5), content (`content.nav`, 10)                                                                  | The CMS ⇄ Agents switch and the content-type list with favourites + the ⌘K palette over content              |
| WORKSPACE_ROUTE_SLOT<br>workspace.routes    | workspaces-admin | `WorkspaceShell` (nested `<Routes>`)    | content, media, insights, alarms, copilot, workspaces                                                                             | The pages inside a workspace; the lowest `order` is the default section when landing on the workspace's base |

There are **no** `NAVBAR_START_SLOT` / `NAVBAR_END_SLOT` slots and no top toolbar in the repository: they were replaced by the sidebar. The names survive only in `createSlot`'s JSDoc example and in “formerly” comments inside the types.

### 4.5 Not slots, but extension points all the same

#### Overriding the contextual area — `useSidebarContent`

The area holds **exactly one node**, which is why this is not a slot. A consumer calls `useSidebarContent(render, deps)`, and `AppSidebar` renders `override ?? <GlobalSidebar/>`. Two mounted at once — the last one wins, and that is by design. What was **not** by design was that the loser's cleanup wiped the winner's content and the whole middle of the sidebar stayed empty until the next route change: now every caller holds a `Symbol` token, and `clearContent` is a no-op if the caller is no longer the one being shown.

**What is stored is a rendered element, not a function.** That is why `deps` must list every field the node actually renders: `WorkspaceShell` keys on `id, name, color, status, members.length` — keying on `id` alone left the switcher with the old name and colour (the `aria-label` included) for the rest of the session.

#### Page portals — `PageActionsPortal`, `RightPanelPortal`

Shell **renders both areas but fills neither**. Filling goes through `createPortal` rather than passing a node upwards, and that is fundamental: React resolves context by where a node is _rendered_, so a node drawn by shell would be cut off from everything below it — from the open workspace, from the plugin's slot contexts, from a form's handlers and busy state. A portal moves only the DOM and preserves the React tree.

The cost of the alternative is visible in `ContentNavSection`: it renders _above_ `CurrentWorkspaceProvider` and is forced to recompute the open workspace from the route by hand.

The portal hosts are **always** mounted — a portal needs an existing target, and a right panel host that is never unmounted means collapsing it does not throw away the filler's state or re-fetch its data.

### 4.6 How to add a new section — a checklist

1. **Decide the scope.** A global section → `SIDEBAR_NAV_SLOT` + the plugin's `routes`. A tool inside a workspace → `WORKSPACE_NAV_SLOT` + `WORKSPACE_ROUTE_SLOT` (and then **neither** a global route **nor** a row in the global sidebar).
2. **Pick a group and an `order`.** `overview` is for overview screens, `directory` for directories. The step between existing values is 10.
3. **Declare a `permission` if the page is gated.** Omitting the field means “visible to everyone signed in”, and then the row must lead to a page that shows something to everyone.
4. **Give it an icon and, optionally, an `iconColor`.** The `text-nav-*` utilities are chosen for the sidebar's dark surface; the accent is applied only in the active state.
5. **Render a `PageTopBar` on the page** with **the same** icon as in the navigation row. Otherwise the frame and the context bar will disagree, and on top of that the page will get a floating toggle that has no business being there.
6. **Check the palette.** A new row appears under “Go to” automatically — a separate `COMMAND_SLOT` contribution is needed only for dynamic results.

## 05. Routes and screens

### 5.1 What shell mounts itself

| What     | Value                                                                    | Comment                                                             |
| -------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `name`   | shell                                                                    | The plugin's name, the same one that appears in the host's warnings |
| `layout` | \<AuthProvider>\<RequireAuth>\<AppShell/>\</RequireAuth>\</AuthProvider> | The application's only layout contributor                           |
| `routes` | \[{ path: '/', element: \<HomePage/> }\]                                 | No `public` flag → the route is private                             |
| `slots`  | one entry in `SIDEBAR_NAV_SLOT`                                          | “Home”, the overview group, `order: 10`, `end: true`                |

### 5.2 What ends up inside the frame

Every route listed below is rendered into the `<Outlet/>` inside `SidebarInset` and behind a single `RequireAuth` check. Shell does not declare them — it contains them.

| Route                | Package          | Its own context bar                                                                                |
| -------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| /                    | shell-admin      | no — the only page without a bar                                                                   |
| /activity            | activity-admin   | `PageTopBar`                                                                                       |
| /workspaces          | workspaces-admin | `PageTopBar`                                                                                       |
| /workspaces/new      | workspaces-admin | `PageTopBar`                                                                                       |
| /workspaces/:id/\*   | workspaces-admin | a bar from the nested section (`ContentTopBar`, `MediaTopBar`, Insights, `AgentsTopBar`, settings) |
| /users               | users-admin      | `PageTopBar`                                                                                       |
| /users/invite        | users-admin      | `PageTopBar`                                                                                       |
| /users/:id/\*        | users-admin      | `PageTopBar` (in `UserDetailLayout`)                                                               |
| /api-tokens          | api-tokens-admin | `PageTopBar`                                                                                       |
| /segments            | segments-admin   | `PageTopBar`                                                                                       |
| /segments/new        | segments-admin   | `PageTopBar`                                                                                       |
| /segments/:segmentId | segments-admin   | `PageTopBar`                                                                                       |
| \*                   | bootstrap-admin  | a redirect to `/`, `replace` — also inside the layout, that is, behind the gate                    |

There is exactly one public route in the application — `/identity/*` from `identity-admin` (sign-in, accepting an invitation, password reset). It is a top-level sibling and never sees shell's frame.

### 5.3 The screens and regions shell renders

#### The home page `/`

A `Container` with top padding, an `<h1>` heading — a greeting based on the local hour (`<12` morning, `<18` afternoon, otherwise evening) with `user.name ?? user.email ?? ''` substituted in, a subheading, then a row of `stat` tiles and a grid of `panel` panels. Sets the tab title to “Home”. With no contributions into `HOME_SECTION_SLOT`, only the greeting remains — the containers of empty regions are not rendered.

#### The sidebar

Three regions: the **header** (the “Ortha CMS” brand, the “Hide navigation” trigger, search), the **contextual area** (global navigation or an override), and the **permanent footer** from a slot. The panel is a `complementary` landmark named “Sidebar”; inside it sits `<nav aria-label="Primary">`. On mobile it is a Radix `Sheet` named “Navigation” with a description.

#### The command palette

A `CommandDialog`: an input field, the static “Go to” group from the navigation slot, then sections from `COMMAND_SLOT`, and at the bottom a key legend of ↑ ↓ / ↵ / esc. It opens by clicking the trigger or with ⌘K / Ctrl+K.

#### The top bar and the right panel

`PageTopBar` — an icon tile + breadcrumbs + the actions area. The bar **portals itself** out of the scroll port into `SidebarInset`'s fixed bar, so the content scrolls underneath it. `AppRightPanel` is a 22rem column with an `h-12` header in line with the bar; with no panel registered, its width is 0 and it is `inert`.

> **Why the floating toggle is visible only on Home**
>
> `SidebarToggle` hides itself with the selector `[main:has([data-slot=top-bar])~&]:hidden` — a sibling combinator relative to `<main>`. Any page with a `TopBar` carries its own built-in expand trigger inside the bar, and the floating button is unnecessary. The only page without a bar is the home page, and that is where the button appears. Hence the hard requirement: `SidebarToggle` must be a **direct** sibling of `<main>` — a wrapper around it breaks the selector and brings the button back on every page.

## 06. Scenarios — how it works step by step

### 6.1 The first entry into the application

1. **The host mounts.** `createAdmin` sets `<html lang>` and `dir`, warns about layout and path collisions, registers every slot from scratch, and renders the provider tree: theme → `QueryClient` → `IntlProvider` → design-system labels → tooltips → error boundary → `BrowserRouter`.
   _slots are registered before the first render, so the sidebar is full from the first frame_
2. **The route matches into the private branch.** `/`, for instance. The parent's element turns out to be shell's layout.
3. **`AuthProvider` starts the “who am I” probe.** While it is in flight, `useAuth()` returns `Loading`.
4. **`RequireAuth` branches on four states.** `Loading` → a full-screen `AppLoader`. `Unavailable` (the probe failed for a reason other than 401) → an “unavailable” screen with a retry, **not** a redirect. `Unauthenticated` → `<Navigate to="/identity/login" replace state={{ from: location }}/>`. `Authenticated` → the children.
   _the distinction between Unauthenticated and Unavailable is why an API outage does not look like being signed out_
5. **`AppShell` mounts the frame's providers.** `SidebarContentProvider` (an empty override) → `PageChromeProvider` (reads `localStorage` for the right panel) → `AppShellChrome`.
6. **`SidebarProvider` reads the `sidebar_state` cookie.** No cookie, or a junk value → open. It attaches the ⌘B listener to `window`.
7. **The frame is rendered.** The skip link (the document's first focusable element) → `AppSidebar` → `SidebarInset` with `id="main-content"` and the `<Outlet/>` → `AppRightPanel` (zero width, `inert`) → `SidebarToggle`.
8. **The sidebar is filled from the slots.** `GlobalSidebar` filters navigation by permissions, collapses empty groups and renders sections; `AppSidebar` adds the footer.
9. **The page sets the tab title.** `HomePage` calls `useDocumentTitle('Home')` → `document.title = 'Home · Admin'`.

### 6.2 Moving between sections

1. **A click on a sidebar row.** `SidebarNavButton` is a `<Link>` inside a `SidebarMenuButton asChild`, that is, ordinary client-side navigation.
2. **Activeness is recomputed.** `useMatch(item.end ? item.to : item.to + '/*')`. Only “Home” has the `end` flag — otherwise the root path would count as active on every route at once.
3. **The active row is marked twice:** visually (`isActive` + the icon's accent colour) and semantically (`aria-current="page"`).
4. **The frame is not redrawn.** Only the contents of the `<Outlet/>` change; the sidebar, the scroll port, the right panel and everything mounted inside them stay put.
5. **The host announces the new screen.** `RouteAnnouncer` polls for an `<h1>` inside `<main>` every 100 ms for up to 5 s, skips headings inside `[aria-busy="true"]` (the skeletons of lazy chunks) and writes the settled name into a polite region.
   _this works only because shell provided the single <main> the announcer scopes itself to_
6. **The page sets its own tab title** and removes it on unmount, restoring the bare “Admin”.

### 6.3 Collapsing and expanding the sidebar

1. **There are three ways to collapse it:** the trigger in the sidebar's header (“Hide navigation”), ⌘B / Ctrl+B, or — on mobile — closing the `Sheet`.
2. **⌘B yields to the editor.** The `window` listener checks `ownsBoldShortcut(event.target)`: in a text field, a `textarea`, a `select` and inside `contenteditable`, the chord means **bold**, and there it is not intercepted. Otherwise the author would get both a collapsed sidebar and formatting that did not happen.
3. **The state is written to a cookie.** `sidebar_state=true|false; path=/; max-age=604800; SameSite=Lax`. The write is wrapped in `try/catch` — in a sandboxed iframe without `allow-same-origin`, touching `document.cookie` throws, and losing the setting is survivable while losing the toggle is not.
4. **The panel slides away rather than unmounting.** The `offcanvas` mode: the container shifts to `left: -var(--sidebar-width)` over 300 ms, and the neighbouring “gap” element animates its width to zero. A collapsed panel gets `inert` + `aria-hidden`, so its links and search leave the tab order and the accessibility tree.
5. **Focus is handed to the survivor.** The button used to collapse it has just travelled into an `inert` subtree. `SidebarProvider` catches the expanded → collapsed transition, verifies that focus really is lost (`null`, `<body>`, or an element inside `[inert]`) and moves it to the first `[data-sidebar="trigger"]` that is outside `inert` and does not have `tabindex="-1"` — that is, to the built-in trigger in the `TopBar` or to the floating toggle.
   _without this, a keyboard user ended up on the body and had to tab from the top of the document_
6. **To expand: the same ⌘B, the bar's built-in trigger, or the floating button.** The first two are always available; the third is visible only where there is no bar.

### 6.4 The ⌘K command palette

1. **Opening.** A click on the “search field” trigger in the sidebar header, or ⌘K / Ctrl+K. Before it opens, `document.activeElement` is remembered.
2. **The chord yields to the caret.** If the palette is closed and `isComposingText(event.target)`, the handler bails out without calling `preventDefault()`. This is WCAG 3.2.2: a change of context in response to typing into a _different_ element, and one that destroys the keystroke the user meant, at that.
   _the “close” half deliberately does not depend on this check — the palette's own field is a text field too_
3. **The contents.** The “Go to” group is `SIDEBAR_NAV_SLOT`, sorted `byOrder` and filtered per row by permission. Then `COMMAND_SLOT` sections by `order`: workspaces, then content types. Nothing found → `CommandEmpty`, “No results.”.
4. **Choosing a result.** `go(to)`: the remembered focus element is **cleared**, the palette closes, and `navigate` runs. Restoring focus is deliberately skipped — dragging it back to the sidebar trigger would mean fighting the incoming page.
5. **Closing without navigating.** Esc or another ⌘K → `closePalette()`: `setOpen(false)`, then, via `setTimeout(…, 0)`, focus returns to the remembered element if it is still `isConnected`, otherwise to the trigger. It is deferred by a tick so as to land after the dialog's focus scope unmounts.
   _Radix does not do its own restore here, although it does for the account menu's dropdown — from the same library_
6. **No double binding arises.** `SidebarSearch` lives only in `GlobalSidebar`. Inside a workspace the whole contextual area is replaced by `WorkspaceNav`, the global palette is unmounted, and ⌘K is owned by `ContentNavSection` with its content-type palette.

### 6.5 Entering a workspace: overriding the contextual area

1. **Navigation to `/workspaces/:id/*`.** The route belongs to `workspaces-admin` and renders into shell's `<Outlet/>`.
2. **`WorkspaceShell` resolves `:id`** against the workspace list. The list is scoped by membership on the server, so an unresolved `:id` simply _is_ “no access”, with no distinction between “does not exist” and “not yours”.
3. **It calls `useSidebarContent`.** The hook takes a `Symbol` token for the component's whole lifetime and, in an effect, puts `<WorkspaceNav workspace={current}/>` into the context together with the token.
4. **`AppSidebar` re-renders** and draws the `override` instead of `GlobalSidebar`. The brand, the global navigation, the quick workspace list and the global search all disappear.
5. **The footer stays.** It is outside the contextual area: `ThemeSync` keeps working, the copilot dock and the account menu are still there. That is exactly why `ThemeSync` was put in the footer rather than in the sections — arriving in a workspace by direct link, the sections would simply never have mounted.
6. **`WorkspaceNav` brings its own landmark.** `<nav aria-label="Tools">`. The overriding node must carry one: `<nav aria-label="Primary">` belonged to `GlobalSidebar` and left with it.
7. **Leaving the workspace.** `WorkspaceShell` unmounts, `clearContent(owner)` checks the token and, if it is still the one being shown, resets the area — the sidebar returns to the global navigation.

> **Why an ownership token is needed**
>
> The area holds a single node, so two simultaneously mounted callers mean “the last one wins”. That is by design. What was not by design was this: the _loser_'s cleanup on unmount wiped the _winner_'s content, and the whole middle of the sidebar stayed empty until the next route change. Now `clearContent` is a no-op if the owner has already changed.

### 6.6 Switching between CMS and Agents

The control belongs to `copilot-admin` and is rendered into `WORKSPACE_SECTION_SLOT` with `order: 5` — that is, below the workspace switcher and above the content navigation.

1. **It is present in both modes.** The full-page “Agents” view, arrived at from a navigation row, is the sort of place people do not know how to leave. A segmented control visible in both places says that there are two modes and which one you are in, and costs one click in either direction.
2. **While you are in the CMS, the path is remembered.** An effect writes `pathname + search` into `sessionStorage` under the key `ortha:agents:return:<workspaceId>`. `sessionStorage` specifically: the control unmounts and remounts on every rebuild of the contextual area, and “where I was” has no business surviving until next week.
3. **Switching to Agents** is `navigate(agentsPath(workspaceId))`.
4. **Returning to the CMS goes to the same page you left:** `readCmsPath(workspaceId) ?? '/workspaces/:id'`. Interrupted mid-edit on an entry to ask a question — you come back to it, not to the default section.
5. **Clicking the active half again is ignored.** Radix clears the value when the selected item is clicked; that is a deselection, not a toggle, and there is no third state.
6. **The control is not rendered at all** outside a workspace, without the `copilot:use` permission, and on a deployment where the copilot is off (checked by the same cached request as the dock).

### 6.7 The right panel: registering, collapsing, restoring

1. **The page opens a portal.** `<RightPanelPortal title="…">` calls `registerPanel(title)` in an effect. Today's only consumer is the entry editor's properties panel in `content-admin`.
2. **Registration _is_ the panel's existence.** A non-zero registration count (an array of titles) → `present: true`, the column gets a width, and a button appears in the header. Zero → width 0 and `inert`. The counter is ref-counted precisely so that an overlap while the page remounts does not read as “the panel is gone”; the title comes from the latest registration.
3. **Collapsing.** The “Hide {title}” button inside the panel calls `toggle()`: `animate` is armed, `focusTarget = 'bar'` is assigned, and `open` becomes `false`.
4. **Handing over focus is a mandatory part.** The toggle's two halves live in different components, and only one is reachable at a time: collapsing carries “Hide” into the `inert` `<aside>`, and expanding unmounts “Show” in the bar. That is, **any switch destroys the control that performed it**, and the browser drops focus onto `<body>`. The survivor is named in `focusTarget` and claims focus through `usePanelFocusHandoff` in the very commit that reveals it.
   _both directions were broken; a handoff on collapse only looks complete and is not_
5. **An unclaimed handoff expires.** If the control never appeared, a `0` ms timer clears `focusTarget` — otherwise the **next** control to mount would claim it, and a page opened ten minutes later would steal focus out of nowhere. Children's effects run before the parent's, so a control that is already shown manages to clear the target before the timer is armed.
6. **Animation only on demand.** The width transition is gated on `animate`, which is armed **only** by `toggle` and cleared by a 330 ms timer. The panel does not slide in on the first frame, nor every time a page registers it: movement means “you just did that”, and nothing else.
7. **Restoring.** The “Show {title}” button in the bar's actions area. It exists only while the panel is registered and collapsed, carries `aria-controls="app-right-panel"` and `aria-expanded={false}`; the paired button inside the panel has the same `aria-controls` and `aria-expanded`.

### 6.8 A page pushes actions into the top bar

1. **The bar mounts a host.** `PageActions` hands the `ref` of an empty `<div>` to `setActionsHost`. The host is always there, whether the area is filled or not.
2. **The page portals its controls.** `<PageActionsPortal>` renders its children into that host via `createPortal`. While there is no host it is `null`, so a page that mounts before its bar simply appears a frame later.
3. **Context is preserved.** The children stay in their page's React tree: handlers, permissions, busy state and the open workspace resolve as if nothing happened.
4. **`PageActions` must be `TopBar`'s last child.** The area is `ml-auto`, and anything after it will be pushed off the edge of the bar. `PageTopBar` already gets this right; a page that composes a `TopBar` itself must add `<PageActions />` as the last child.

> **Why this is a component rather than part of TopBar**
>
> The design system cannot reach shell's context — it knows nothing about it and should not. So the actions area is factored out into a shell component that is inserted into the bar primitive. Of all the pages that compose a `TopBar` directly, only `ContentTopBar` renders `<PageActions />` today.

## 07. States and behaviour

### 7.1 The sidebar

**expanded** ⇄ ⌘B / the header trigger **collapsed (offcanvas)** · **mobile: Sheet closed** ⇄ **mobile: Sheet open**

| Aspect                    | Desktop (≥768px)                                                                       | Mobile (\<768px)                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| What kind of element      | A fixed `16rem` panel + an animated “gap” in the flow                                  | A Radix `Sheet` — an `18rem`-wide overlay drawer with a focus trap                                      |
| State                     | `open` from `SidebarProvider`, the `sidebar_state` cookie                              | a separate `openMobile`, **not** persisted, starts closed                                               |
| What `toggleSidebar` does | `setOpen(!open)`                                                                       | `setOpenMobile(!openMobile)`                                                                            |
| When collapsed            | the panel stays in the DOM, shifted past the left edge, marked `inert` + `aria-hidden` | the `Sheet`'s content is unmounted                                                                      |
| The floating toggle       | visible only when `collapsed` and only on a page without a `TopBar`                    | always visible (except on pages with a `TopBar`) — `isMobile` bypasses the `state === 'expanded'` check |
| The screen-reader name    | `complementary` “Sidebar”                                                              | the “Navigation” dialog + the description “The main navigation for Ortha CMS.”                          |

**`SidebarRail` is deliberately not rendered.** It is an invisible 16px strip hanging off the edge of the panel. In `offcanvas` mode it ends up _outside_ the panel and, on hover, paints a hairline and a `bg-sidebar` block — that is, it reads as a stray strip in the page that nothing explains. On top of that it is `tabIndex={-1}`, that is, a purely mouse-only duplicate of the three toggles that already exist.

### 7.2 The right panel

**not registered (w-0, inert)** → RightPanelPortal **open (22rem)** ⇄ toggle **collapsed (w-0, inert)**

| Aspect             | Desktop (≥768px)                                   | Mobile (\<768px)                                                            |
| ------------------ | -------------------------------------------------- | --------------------------------------------------------------------------- |
| Geometry           | a column after `SidebarInset`, width `22rem` ⇄ `0` | `fixed inset-y-0 right-0`, width `min(22rem, 88vw)`, `translate-x` 0 ⇄ 100% |
| Role               | `complementary`, named after the panel's title     | `role="dialog"` + `aria-modal` — but only while it is shown                 |
| What is underneath | nothing is covered                                 | an `aria-hidden` scrim; `SidebarInset` and the floating toggle get `inert`  |
| Esc                | not handled                                        | closes it, if nothing is stacked above                                      |
| Initial state      | from `localStorage`                                | **always collapsed**, regardless of what was saved                          |
| Writing to storage | written                                            | **not written**                                                             |

> **What persists is the decision, not the layout**
>
> On a narrow screen the panel is an overlay on top of the page, and nobody asked for an overlay covering the page on arrival. So `readOpen()` returns `false` when `(max-width: 767px)` matches, bypassing storage. And — this is the second half, without which the first breaks the product — the persistence effect on the same match **bails out without writing anything**. It used to write: one page load on a phone permanently overwrote the desktop setting, and on the next visit from a wide screen the panel was collapsed with no explanation whatsoever.

**Why not a Radix `Sheet`.** A `Sheet` unmounts its content when it closes, and the panel's body is a **portal host** that must stay mounted, otherwise collapsing throws away the filler's state and re-fetches its data. So the one thing a `Sheet` would have given for free — Esc — is written by hand, and focus inside the overlay is held by putting `inert` on everything beneath it.

**The Esc handler yields.** It bails out if the document contains a `[role="dialog"]:not(#app-right-panel)`, a `[role="alertdialog"]`, a `[role="menu"]` or a `[role="listbox"]`. Excluding the panel itself is essential: at that breakpoint it _is_ a `role="dialog"`, and without the exclusion the handler found it, decided something was stacked above, and yielded to itself — Esc stopped working at precisely the moment the attribute was added.

**The scrim is decoration, not a control.** It used to be a `<button aria-hidden tabIndex={-1}>`: a role announced to nobody, and an element unreachable from the keyboard. The keyboard equivalents are Esc and the “Hide {title}” button inside the panel, so a `<div aria-hidden onClick>` is more honest.

### 7.3 What survives a reload, and where

| What                         | Where          | Key                       | Lifetime                                  | Owner                    |
| ---------------------------- | -------------- | ------------------------- | ----------------------------------------- | ------------------------ |
| Sidebar open/collapsed       | cookie         | sidebar_state             | 7 days, `path=/`, `SameSite=Lax`          | design-system            |
| Right panel open/collapsed   | localStorage   | ortha:right-panel         | indefinite; not written below 768px       | shell (`pageChrome`)     |
| Where to return from Agents  | sessionStorage | ortha:agents:return:\<id> | the tab                                   | copilot-admin            |
| The sidebar's mobile `Sheet` | —              | —                         | in memory only                            | design-system            |
| The contextual-area override | —              | —                         | while the overriding component is mounted | shell (`sidebarContent`) |

Every read and every write is wrapped in `try/catch`: private mode, disabled site data, an iframe sandbox and the quota all raise an exception rather than yielding a missing value. The degradation is “the setting lives in memory only”, not a blank screen.

### 7.4 Empty and degenerate states

- **Not a single navigation row passed the permission filter** → the whole group, heading included, is not rendered.
- **No items in `SIDEBAR_FOOTER_SLOT`** → `<SidebarFooter>` and its top border are not rendered at all.
- **No contributions into `HOME_SECTION_SLOT`** → only the greeting remains on the home page; the region containers never appear.
- **The palette found nothing** → `CommandEmpty`, “No results.”.
- **The right panel is not registered** → a zero-width, `inert` column and no button in the bar.
- **No `PageChromeProvider` around it** (a bar rendered in isolation in a test or a storybook) → `useRightPanel()` returns `null`, `usePanelFocusHandoff` returns a no-op ref, and the bar simply shows no panel controls. `PageActionsPortal`, `RightPanelPortal` and `useSidebarContent`, on the other hand, **throw** outside their providers, with an intelligible message.

## 08. The tab title and its registry

The registry lives in `@orthacms/utils-admin` (`src/lib/documentTitle`), but shell is its first and exemplary consumer, and it is shell's frame that makes the tab title the only stable landmark when switching windows.

### 8.1 How it works

- **The application name is read once** — from the host HTML's own `document.title` (`apps/admin/index.html`, which carries `<title>Admin</title>`), at module load time, before anything has had a chance to decorate it. The product name is not hard-coded into the utility.
- **Composition:** ``page ? `${page} · ${APP_NAME}` : APP_NAME``. The module variable `page` is the current route's title or `null`.
- **`useDocumentTitle(title)`** sets the title for the lifetime of the route's mount and, on unmount, restores `null`, that is, the bare application name.
- **`setTitleDecorator(fn)`** installs a **transformation** over the composed title.

### 8.2 Why a decorator and not a write

> **Decoration is a transformation, not a write**
>
> The copilot's unread badge (a `(3)` before the title) and a change of page title are two independent sources. If the badge wrote straight into `document.title`, it would “seal in” whichever page happened to be open at the moment of the first chat, and any route change would erase the badge. With a decorator both sides move freely: whoever moved last redraws from **the same composed base** rather than from whatever happened to be in `document.title`. Counters do not accumulate.

### 8.3 Who uses what

| API               | Consumers                                                                                                                                                                   | The resulting title                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| useDocumentTitle  | 19 calls across 10 admin packages: identity (3), users (3), workspaces (3), segments (2), copilot (2), api-tokens, activity, media, content, insights, **shell (HomePage)** | `Home · Admin`, `Members · Admin`, …      |
| setTitleDecorator | only one — `useTabBadge` in `copilot-admin`                                                                                                                                 | `(2) Home · Admin` + a dot on the favicon |
| setDocumentTitle  | no direct calls outside the utility itself                                                                                                                                  | —                                         |

The tab badge is the entire notification mechanism for a chat running in the background: no permissions and no prompt. An honest boundary: it reaches you in **another tab**, but not in another window and not in another application — that would take the Notification API, with a prompt that is granted only once. The icon is drawn best-effort: no `<link rel=icon>`, a format the canvas will not take, a cross-origin icon that taints the canvas — the dot is simply skipped and the counter stays in the text.

## 09. Configuration

Shell has **no** configurable parameters. `ShellPlugin()` takes no arguments, the package reads no environment variables and has no configuration files. The `ShellAdminPlugin` type is kept as a named alias of `AdminPlugin` — “so that future configuration has somewhere to live”.

### 9.1 What is configured outside the package but affects it

| What                                                     | Where                                                 | Effect on shell                                                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| The order and set of plugins                             | apps/admin/src/plugins.ts                             | Determines the contents of all five slots and resolves `order` ties. `ShellPlugin()` must come before any other `layout` contributor |
| The interface locale                                     | `createAdmin({ locale })`                             | All 27 `shell.*` keys; the host also sets `<html lang>` and `dir`                                                                    |
| The application name in the title                        | apps/admin/index.html                                 | The right-hand half of the `“{page} · {application}”` composition                                                                    |
| The mount point                                          | `createAdmin({ rootElement })`                        | Defaults to `root`; a missing element is an explicit error naming the id                                                             |
| Sidebar widths, the breakpoint, the ⌘B chord, the cookie | design-system/…/ui/sidebar.tsx                        | The primitive's constants: `16rem` / `18rem` mobile / `3rem` icon mode, `768px`, `'b'`, `sidebar_state`                              |
| The visual theme                                         | `AppearanceProvider` + `ThemeSync` from `users-admin` | Shell provides the footer `ThemeSync` lives in; it never touches the theme itself                                                    |

### 9.2 Constants inside shell

| Constant        | Value                      | Where         | Meaning                                                                                            |
| --------------- | -------------------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| MAIN_CONTENT_ID | 'main-content'             | AppShell      | The skip link's target, the `id` of the `<main>` landmark                                          |
| RIGHT_PANEL_ID  | 'app-right-panel'          | pageChrome    | The `aria-controls` link between the bar's button and the panel; the exclusion in the Esc selector |
| STORAGE_KEY     | 'ortha:right-panel'        | pageChrome    | The values `'open'` / `'collapsed'`                                                                |
| PANEL_SLIDE_MS  | 330                        | pageChrome    | Slightly more than `duration-300` — the window in which animation is allowed                       |
| MOBILE_QUERY    | '(max-width: 767px)'       | pageChrome    | Matches `useIsMobile`'s breakpoint (768px already counts as desktop)                               |
| GROUPS          | \['overview','directory'\] | GlobalSidebar | The fixed order of the navigation groups                                                           |

## 10. Accessibility and the keyboard

The application frame is exactly the code that either gives every page a correct structure for free or breaks it for all of them at once. Below is what shell is obliged to hold.

### 10.1 The skip link

- **The document's first focusable element** is an `<a href="#main-content">` inside `SidebarProvider`, before the sidebar. WCAG 2.4.1 Bypass Blocks.
- **Visually hidden until focused**: `sr-only focus:not-sr-only` + a fixed position, a background, padding and a focus ring. That is, it is visible when it is needed.
- **The target is focusable.** `SidebarInset` gets `tabIndex={-1}`, so following the fragment really does land focus in `<main>` instead of leaving it on the link — otherwise the next Tab would return the user to the sidebar, that is, to the very block they asked to skip.
- **While the right panel's mobile overlay is up**, the link gets `tabIndex={-1}` and `aria-hidden`: it is first in the document, that is, exactly where a wrapping Tab out of the overlay used to land.

### 10.2 Landmarks

| Landmark               | Who provides it                                  | Name              | Why                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| complementary          | `Sidebar` via the `label` prop from `AppSidebar` | “Sidebar”         | Without a name, the brand in the header and any group a plugin contributed ended up **outside every landmark** — content that cannot be reached by landmark and has to be tabbed to                                                             |
| navigation             | `GlobalSidebar`                                  | “Primary”         | Only the primary navigation links. `complementary` specifically, rather than a second `navigation` around the whole panel: otherwise the panel would claim to consist of nothing but links                                                      |
| navigation             | `WorkspaceNav` (the override)                    | “Tools”           | The overriding node must bring its own — “Primary” left along with `GlobalSidebar`                                                                                                                                                              |
| main                   | `SidebarInset`                                   | —                 | The document's only `<main>`; `RouteAnnouncer` scopes itself to it too                                                                                                                                                                          |
| complementary / dialog | `AppRightPanel`                                  | the panel's title | On a narrow screen it becomes a `dialog` + `aria-modal` — but **only** because `AppShellChrome` really does make everything beneath it inert at that moment. A truthful `complementary` beats a `dialog` whose promise the markup does not keep |
| group                  | `SidebarInset`, the `scrollLabel` prop           | “Page content”    | The scroll port is focusable on purpose (WCAG 2.1.1: a scrollable region must be reachable from the keyboard) and used to be a nameless, roleless stop. `group` names it without adding another landmark next to the `<main>` it sits inside    |

### 10.3 The keyboard

| Key                 | Where it is listened for    | Action                            | When it yields                                                                                                                     |
| ------------------- | --------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Tab (the first one) | —                           | Focus the skip link               | The panel's mobile overlay is up                                                                                                   |
| ⌘B / Ctrl+B         | `window`, `SidebarProvider` | Collapse/expand the sidebar       | The caret is in a text field, a `textarea`, a `select`, or `contenteditable` — there it means **bold**                             |
| ⌘K / Ctrl+K         | `window`, `SidebarSearch`   | Open/close the palette            | With the palette **closed** — if `isComposingText(target)`. The “close” half is not gated: the palette's own field is a text field |
| ↑ ↓                 | cmdk inside the palette     | Move through the results          | —                                                                                                                                  |
| ↵                   | cmdk                        | Go to the selected result         | —                                                                                                                                  |
| Esc                 | Radix Dialog                | Close the palette + restore focus | —                                                                                                                                  |
| Esc                 | `document`, `AppRightPanel` | Close the panel's mobile overlay  | There is an open `dialog` (other than the panel itself), `alertdialog`, `menu` or `listbox`                                        |
| ⌘J                  | copilot-admin               | Open the chat                     | The caret is in text — through the same `isComposingText`                                                                          |

`isComposingText` was moved into `utils-admin` as a single implementation: before that it existed as three copies (shell's ⌘K, the content palette, the design system's ⌘B guard), and the copilot's ⌘J had none at all — so the chat opened straight out of the editor.

### 10.4 Focus management — the three places where it is otherwise lost

1. **Collapsing the sidebar.** The button travels into `inert`. `SidebarProvider` verifies that focus really is lost and moves it to the first live `[data-sidebar="trigger"]`.
2. **Toggling the right panel.** Both directions: `focusTarget` + `usePanelFocusHandoff`, with focus moving in the very commit that makes the survivor focusable. An unclaimed handoff expires on the next tick.
3. **Closing the palette without navigating.** A tick-deferred return to the remembered element or to the trigger. When a result is chosen, the return is deliberately skipped.

### 10.5 Internationalisation

- 27 `defineMessages` keys, all prefixed `shell.`, co-located in the component files — there is no shared `messages.ts`. Plus `shell.nav.home`, declared as a `labelId` right in the plugin factory.
- **The design system's labels are translated by the consumer.** The design system does not pull in `react-intl`, so names arrive as props: `mobileTitle`, `mobileDescription`, `Sidebar`'s `label`, `SidebarTrigger`'s `label`, `SidebarInset`'s `scrollLabel`. Without them the mobile sidebar would announce itself with the English default “Sidebar” in every locale.
- **The toggles are named after the action, not the component.** The header trigger is reachable only while the sidebar is open → “Hide navigation”. The floating one is rendered only while the sidebar is hidden → “Show navigation”. A generic “Toggle Sidebar” would name the component rather than the result of pressing it.
- **Parameterised panel labels:** “Hide {title}” / “Show {title}” — both halves of the toggle name exactly what they control.

## 11. Invariants

Statements that must always hold. This is at once a review checklist and a draft set of test assertions.

- **I-01** — The application has exactly one `layout` contributor, and it is shell. A second one registered earlier disables authorization for every private route.
- **I-02** — The `layout` is **precisely** `AuthProvider` on the outside, `RequireAuth` inside it, `AppShell` at the centre. Swapping the provider and the gate makes the gate blind.
- **I-03** — No shell route carries `public: true`. The home page is private, as is the catch-all redirect, which is also mounted inside the layout.
- **I-04** — Shell imports no feature plugin. Extension happens only through slots, the area override and the portals.
- **I-05** — All contributions are registered **before the first render** and **from scratch** (`_reset` in a separate pass), so hot reloading does not double the sidebar's contents.
- **I-06** — `getItems()` returns a copy: a consumer that sorts or filters in place does not spoil the list for the next one.
- **I-07** — The order inside a slot is `byOrder`, stably; on equal `order`, the plugin registration order decides.
- **I-08** — A navigation row without a `permission` is visible to everyone signed in; a row with a `permission` only to a holder of that key. The rule is the same in the sidebar and in the palette.
- **I-09** — `useHasPermission` is called **unconditionally** (with `''` when the field is absent), so that the hook order does not depend on slot data.
- **I-10** — A navigation group is not rendered if no rows survive the permission filter — a heading never hangs over emptiness.
- **I-11** — The sidebar's contextual area holds **exactly one** node; `clearContent` is a no-op if the caller is no longer the owner.
- **I-12** — An overriding node brings **its own named landmark**: `<nav aria-label="Primary">` belongs to `GlobalSidebar` and leaves with it.
- **I-13** — The sidebar footer lives **outside** the contextual area and survives any override — it is the only region guaranteed to be mounted in both contexts.
- **I-14** — `useSidebarContent` takes a **factory** + `deps`; raw JSX would be recreated every render and loop the effect. `deps` must list every field the node renders.
- **I-15** — Both fillable areas are filled with `createPortal` rather than by handing a node to shell — otherwise the content loses its page's context.
- **I-16** — Both portal hosts are **always** mounted, filled or not; a collapsed right panel does not unmount its filler or re-fetch its data.
- **I-17** — The right panel exists exactly when there is at least one registration; at zero, the column is zero-width and `inert`.
- **I-18** — Any toggle of the panel hands focus to the surviving half of the toggle — **in both directions**. A handoff on collapse only does not count.
- **I-19** — An unclaimed focus handoff expires on the next tick and cannot be picked up by the next control to mount.
- **I-20** — The panel's animation is gated on `animate`, which only `toggle` arms: neither the first frame nor a page registering the panel causes movement.
- **I-21** — On a narrow viewport (a `MOBILE_QUERY` match) the panel starts collapsed regardless of storage, and that state is **not written back**.
- **I-22** — The mobile overlay's Esc handler excludes the panel itself from the “is anything stacked above” check — otherwise it yields to itself.
- **I-23** — The overlay's scrim is an `aria-hidden` decoration, not a `<button>`: a control unreachable from the keyboard is worse than no control at all.
- **I-24** — `SidebarToggle` is a **direct** sibling of `<main>`; a wrapper breaks the `[main:has([data-slot=top-bar])~&]:hidden` selector and brings the floating button back to pages with a bar.
- **I-25** — The skip link is the document's first focusable element, and its target is focusable (`tabIndex={-1}`).
- **I-26** — The global chords (⌘K, ⌘B, ⌘J) do not fire in an input field or in `contenteditable`. ⌘K and ⌘J share `isComposingText` from `utils-admin`; ⌘B uses the design system’s own `ownsBoldShortcut`, because the library carries no dependency on `utils-admin` and the chord means _bold_ there, so its check is deliberately wider.
- **I-27** — The palette restores focus when closed **without** navigating and deliberately does not restore it when navigating.
- **I-28** — The active row is marked both visually and via `aria-current="page"`; only the root route has `end: true`.
- **I-29** — Every label the design system exposes as a prop really is passed and translated — `mobileTitle`, `mobileDescription`, `label`, `scrollLabel`.
- **I-30** — Every read from and write to cookies / localStorage / sessionStorage is wrapped in `try/catch`; a storage failure degrades to in-memory state, not to an error.
- **I-31** — A route sets the tab title through `useDocumentTitle` and clears it on unmount; the unread badge is applied by a **decorator**, not by writing to `document.title`.
- **I-32** — There is exactly one `<main>` in the document — both the skip link and `RouteAnnouncer`'s scope depend on it.

## 12. Testing checklist

The wording is “action → expected result”, so items can go into a test case without rewriting. Verified in a browser: the package has **not a single** unit test of its own. The existing suites are `apps/admin-e2e/src/shell/command-palette.spec.ts` (9 tests), `apps/admin-e2e/src/shell/right-panel.spec.ts` (7), `apps/admin-e2e/src/home/dashboard.spec.ts` (2), plus `apps/admin-e2e/src/host/host.spec.ts` (15) and `host/reflow.spec.ts` (3), which test the frame as such.

### The gate and mounting

- **Open `/` without a session** → a redirect to `/identity/login`, `replace`, with `state.from`; the sidebar does not flash.
- **The “who am I” probe answers 500** → an “unavailable” screen with a retry, **not** a redirect to the sign-in form.
- **The probe is in flight** → a full-screen loader; neither the sidebar nor any page content.
- **Open a non-existent path with a live session** → a redirect to `/`, with the frame in place.
- **Open a non-existent path without a session** → the sign-in form: the catch-all is inside the layout too.
- **Remove `ShellPlugin()` from `plugins.ts`** → `plugins.spec.ts` goes red; private routes render into a bare `<Outlet/>` and **without** the gate.
- **Add a second plugin with a `layout`** → the host's warning naming the winner and the losers + a red `plugins.spec.ts`.

### The sidebar and the slots

- **Sign in as an administrator** → Overview: Home, Activity. Directory: Workspaces, Members, API Tokens, Segments — in exactly that order.
- **Sign in as a user without `users:read`, `tokens:read`, `segments:read`, `activity:read`** → the Overview group contains only Home, the Directory group only Workspaces; no headings over empty bodies.
- **Try to empty a group by taking permissions away** → you cannot, and that is not a bug: `workspaces-admin` contributes “Workspaces” to Directory with no `permission`, and the shell contributes “Home” to Overview the same way, so every account keeps one row in each group. The rule (I-10) is real but unobservable against the shipped nav — it is pinned in `GlobalSidebar/index.spec.tsx`, on a fixture whose Directory rows are all gated.
- **Click “Members”** → the row gets `aria-current="page"`; “Home” does not (it has `end: true`).
- **Remove every item from `SIDEBAR_FOOTER_SLOT`** → the footer and its top border are not rendered.
- **Save a file in dev mode (Vite hot update)** → navigation rows and workspaces are **not** duplicated.
- **Swap `CopilotPlugin()` and `UsersPlugin()`** → the footer's order changes — the `order: 10` tie is settled by registration (see section 14).

### Collapsing the sidebar

- **Press ⌘B on the home page** → the panel slides away over 300 ms, the content takes the full width, and a floating “Show navigation” button appears at the top left.
- **Press ⌘B on any page with a bar** → there is **no** floating button; the expand trigger appears as the first element inside the `TopBar`.
- **Collapse it from the keyboard using the header trigger** → focus ends up on the bar's built-in trigger (or on the floating button on Home), not on `<body>`.
- **Collapse it, then reload the page** → the sidebar stays collapsed (the `sidebar_state=false` cookie).
- **Tab through a collapsed sidebar** → neither search nor the links nor the footer receive focus — the panel is `inert`.
- **Press ⌘B with the caret in the entry search field and in a rich-text body** → the sidebar does not move; in rich text, “bold” fires.
- **Narrow the window below 768px** → the sidebar becomes an overlay drawer, is announced as the “Navigation” dialog, and closes on Esc and on an outside click.
- **Wrap `<SidebarToggle>` in a `<div>`** → a regression: the floating button appears on every page, on top of the bar.

### The command palette

- **Press ⌘K on the home page** → the palette opens with focus in the field; “Go to” holds every available navigation row, with the workspace and content-type groups below.
- **Press ⌘K with the caret in a page's search field** → the palette does not open and the “k” lands in the field.
- **Press ⌘K while the palette is already open** → it closes, even though focus is in the palette's text field.
- **Open the palette and press Esc** → focus returns to whatever element held it before opening (or to the trigger if that element is gone).
- **Choose a result** → the navigation happens and focus is **not** dragged back into the sidebar.
- **The ↑ ↓ arrows** → the announced selection changes, not just the highlight.
- **A user without `users:read` searches for “Members”** → no result.
- **Open a workspace and press ⌘K** → the content-type palette opens (`content-admin`), not the global one; nothing opens twice.

### The workspace and the area override

- **Enter a workspace** → the middle of the sidebar is replaced by the workspace nav; the footer (the dock, the account) stays.
- **Leave the workspace for `/`** → the global navigation comes back.
- **Move quickly from one workspace to another** → the middle of the sidebar does not stay empty (the ownership-token check).
- **Rename a workspace in its settings** → the sidebar's switcher shows the new name at once, `aria-label` included.
- **Open a direct link into a workspace in a new tab** → the user's saved theme is applied (`ThemeSync` in the footer is mounted).
- **Go to Agents and back to the CMS** → you return to the page you left, query string included.
- **Click the already-active half of the switcher** → nothing happens; there is no third state.
- **A user without `copilot:use`** → there is no CMS ⇄ Agents switcher at all.

### The right panel

- **Open an entry in the editor** → a 22rem column with a heading appears, **without** a slide-in animation.
- **Collapse the panel from the keyboard** → focus on the “Show {title}” button in the bar.
- **Expand it from the keyboard** → focus on the “Hide {title}” button inside the panel.
- **Collapse the panel, work in the form, expand it** → the panel's content is in the same state and no requests were repeated.
- **Collapse it and reload the page** → the panel stays collapsed (`ortha:right-panel=collapsed`).
- **Open the same entry on a phone** → the panel is collapsed regardless of what was saved; `localStorage` is **unchanged**.
- **After that phone visit, open it on the desktop** → the panel is open, just as it was.
- **Expand the panel on a narrow screen** → an overlay on top of the page, `role="dialog"` + `aria-modal`, everything beneath it `inert`; Tab does not escape onto the page and does not wrap to the skip link.
- **Press Esc in the overlay** → the panel closes and focus lands somewhere useful.
- **Open a menu inside the overlay and press Esc** → the menu closes and the panel stays.
- **Click the scrim** → the panel closes; and Tab never reaches the scrim — it is not a control.
- **Leave the page that had the panel** → the column disappears, width 0, `inert`; there is no button in the bar.

### The tab title and announcements

- **Open `/`** → the tab title is “Home · Admin”.
- **Go to `/users` and back** → the title changes to “Members · Admin” and back.
- **Receive unread messages in the chat** → “(2) Home · Admin” + a dot on the favicon; on a page change the counter stays and the base changes.
- **Close the chat** → the title comes back without the prefix and the favicon is restored.
- **Client-side navigation** → the new screen's name is announced in the polite region **after** the skeleton has been replaced by the real heading.

### Accessibility

- **The first Tab on any private page** → a visible “Skip to main content” link.
- **Activate it** → focus inside `<main>`; the next Tab does not return to the sidebar.
- **Navigate by landmarks** → complementary “Sidebar”, navigation “Primary” (or “Tools” in a workspace), main; the “Ortha CMS” brand is **inside** the sidebar's landmark.
- **Tab as far as the scroll port** → the stop is named “Page content”; the arrow keys scroll it.
- **Load the application with `locale: 'de'`** → the mobile sidebar is not announced with the English “Sidebar”; missing translations are logged once per key rather than on every render.
- **Run axe on the home page, inside a workspace, and with the panel open** → no violations; in particular, no dangling `aria-controls` on the collapsible workspace list.
- **A width of 320px** → no horizontal document scroll, and the skip link takes focus and lands inside the viewport.
- **`prefers-reduced-motion`** → the panel changes state without sliding (`motion-reduce:transition-none`).

## 13. Boundaries of responsibility

| Area                                                                                    | Who owns it                          | What Shell does                                                                                            |
| --------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| The “who am I” probe, auth states, permissions                                          | `identity-admin`                     | Places `AuthProvider` and `RequireAuth` in the right order and reads `useHasPermission` for row visibility |
| The sign-in screen and one-time links                                                   | `identity-admin`                     | Nothing — those are the only public routes and they live outside the frame                                 |
| Splitting routes, collisions, the catch-all, the providers                              | `bootstrap-admin`                    | Hands over one `layout` and one route; knows nothing about `Routes`                                        |
| The sidebar primitives, the state cookie, ⌘B, the breakpoint, `TopBar`, `CommandDialog` | `design-system`                      | Composes them and translates their labels; deliberately does **not** render `SidebarRail`                  |
| The slot mechanism, `byOrder`, the title registry, `isComposingText`                    | `utils-admin`                        | Declares five slots and consumes the utilities                                                             |
| The sidebar's contents inside a workspace                                               | `workspaces-admin`                   | Hands over the area through `useSidebarContent` while continuing to render the footer                      |
| The account menu, signing out, theme synchronisation                                    | `users-admin`                        | Provides the footer slot, which survives an area override                                                  |
| The chat, the dock, the tab badge, the CMS ⇄ Agents switch                              | `copilot-admin`                      | Provides the footer slot and the title registry (through `utils-admin`)                                    |
| The home dashboard's tiles and panels                                                   | `workspaces-admin`, `activity-admin` | Provides the page, the greeting and the two regions                                                        |
| The palette's dynamic results                                                           | `workspaces-admin`, `content-admin`  | Provides the dialog, the field, the static “Go to” group and the slot                                      |
| Filling the right panel and the actions area                                            | `content-admin` (the entry editor)   | Renders the chrome: the column, the heading, the toggle, persistence, the focus handoff                    |
| Announcing a screen change                                                              | `bootstrap-admin` (`RouteAnnouncer`) | Provides the single `<main>` the announcer scopes itself to                                                |

### What else is missing

- **Not a single test of its own.** `packages/shell/admin` has no `*.spec.ts(x)` and no `test` target — all the coverage lives in `apps/admin-e2e`. For a frame that is defensible, but `useSidebarContent` with its ownership tokens and `pageChrome` with its expiring focus handoff are pure logic, and cheaper to check with unit tests.
- **Focus in the right panel's mobile overlay is not _trapped_.** It is constrained by making everything outside inert, and that closes the practical hole; but Tab from the panel's last element still does not wrap to its first — it goes out into the browser chrome.
- **There is no global content search.** The palette searches only destination labels and whatever the plugins contributed.
- **There are exactly two navigation groups** and they are hard-coded in `GROUPS`. A third would require editing shell — the slot's extensibility does not extend to groups.
- **There is one right panel per application.** Registrations are ref-counted, but the title shown is the latest one and the body is a shared host; there is never more than one panel at a time.
- **The floating toggle is not configurable.** Its visibility is determined entirely by a CSS selector on whether the page has a `TopBar`.

## 14. Discrepancies between the code and the documentation

Found while reconciling this dossier with the sources. Not product bugs in themselves, but they disorient developers and testers alike.

| Where                                               | What it says                                                                                                                                                                                   | How it actually is                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/shell/admin/AGENTS.md                      | The “It owns the sidebar's slots” section lists **four** slots, and “Key exports” omits the fifth too                                                                                          | `COMMAND_SLOT` (`shell.command`) is declared, exported from `src/index.ts`, read by `SidebarSearch` and filled by two plugins. The package's document **never mentions it once**                                                                                                                                                                                             |
| packages/shell/admin/AGENTS.md                      | “`SidebarSearch` — the sidebar's search-trigger UI (**reused by the workspace nav**; the global command palette **is not yet wired**)”                                                         | Both statements are out of date. `WorkspaceNav` does not import `SidebarSearch` at all — in the whole repository only `GlobalSidebar` renders it. The global palette is fully wired: a slot, two contributions and an e2e suite of nine tests                                                                                                                                |
| packages/shell/admin/AGENTS.md                      | On the right panel's mobile overlay: “Focus is still not _contained_ in the overlay; that half is open”                                                                                        | That half is closed: `AppShellChrome` computes `overlayUp` and puts `inert` on `SidebarInset` and on the floating toggle, and removes the skip link from the tab order (`ORT-154`). All that remains open is wrapping focus inside the panel                                                                                                                                 |
| packages/shell/admin/AGENTS.md                      | “The shell contributes Home; feature plugins contribute the rest (**Activity, Workspaces, Members**)”                                                                                          | There are six rows, not four: **API Tokens** (`api-tokens-admin`, `order: 30`) and **Segments** (`segments-admin`, `order: 40`) go unnamed                                                                                                                                                                                                                                   |
| packages/shell/admin/AGENTS.md                      | `AppShell`'s JSDoc and description: a collapsed sidebar is expanded “with the floating `SidebarToggle`”; the list of what `AppShell` mounts names `SidebarProvider` + `SidebarContentProvider` | There are three providers (`PageChromeProvider` was added), and the frame includes a fourth element — `AppRightPanel`. The main way to expand it today is the built-in trigger in the `TopBar`; the floating button is visible only on the home page. In `AppShell/index.tsx` itself the JSDoc is silent about this, although `SidebarToggle` and `AGENTS.md` do describe it |
| packages/copilot/admin/…/copilotPlugin/index.tsx    | The comment on the footer contribution: “Before the account menu (**which sits at a higher order**)”                                                                                           | Both have `order: 10`. The order rests on `CopilotPlugin()` being registered before `UsersPlugin()` and on `byOrder`'s sort being stable. Swapping two lines in `apps/admin/src/plugins.ts` silently changes how the footer looks                                                                                                                                            |
| packages/workspaces/admin/…/WorkspaceNav/index.tsx  | JSDoc: “It replaces the global nav with: a back link…, the workspace switcher, **a search trigger**, any custom sections…”                                                                     | There is no search trigger in `WorkspaceNav`. Content search arrives inside `ContentNavSection` (a `WORKSPACE_SECTION_SLOT` section), that is, only in a workspace with content-type grants and the `content:read` permission                                                                                                                                                |
| packages/utils/admin/src/lib/slot/index.ts          | `createSlot`'s JSDoc example: `const NAVBAR_START_SLOT = createSlot<NavbarItem>('shell.navbar.start')`                                                                                         | Neither a `shell.navbar.*` slot nor a `NavbarItem` type exists in the repository — the top toolbar was replaced by the sidebar. The example teaches a name that does not exist                                                                                                                                                                                               |
| packages/bootstrap/admin/…/RouteAnnouncer/index.tsx | “…unlike the document title, **which most routes never set** (they inherit the host HTML's "Admin")”                                                                                           | Out of date: `useDocumentTitle` is called 19 times across 10 admin packages, shell's own home page included. The rationale for choosing `<h1>` still holds (the title is set after mounting), but the reason given is no longer true                                                                                                                                         |
| CONTEXT-MAP.md, the `shell/admin` row               | “Defines `SIDEBAR_NAV_SLOT` / `SIDEBAR_SECTION_SLOT` / `SIDEBAR_FOOTER_SLOT` / `HOME_SECTION_SLOT`”                                                                                            | The same omission as in `AGENTS.md`: `COMMAND_SLOT` goes unnamed                                                                                                                                                                                                                                                                                                             |
| packages/shell/admin/AGENTS.md, “Conventions”       | The layout is described as `components/`, `pages/`, `utils/<camelCase>/`                                                                                                                       | There is also a `slots/` directory with three modules — that is, a third of the package's public surface lives in a folder the layout description does not have                                                                                                                                                                                                              |

### Observations that are not documentation discrepancies

- **Only `ContentTopBar` renders `<PageActions />`.** Three other pages compose a `TopBar` directly — `MediaTopBar`, `InsightsPage`, `AgentsTopBar` — and do not wire the actions area. Today that affects nothing (only the entry editor uses the portals), but a page that wants to push a button into the bar on any of those three will get a silent “nothing rendered”.
- **The `ShellAdminPlugin` type is an empty alias** of `AdminPlugin`, kept “for future configuration”. There is no configuration yet; this is a deliberate placeholder, not forgotten code.
- **The comment in `AppShell` about the mobile sidebar not needing inertness** is correct and useful: on a phone it is either closed and unmounted or open with Radix's own focus trap.

---

**Dossier for the `packages/shell/admin` package.** The structure is the same as in the pilot `identity` dossier, adapted to the fact that this is not a server plugin: business description → composition → permissions in navigation → **slot map** → routes and screens → **step-by-step scenarios** → states and behaviour → the tab title → configuration → accessibility → invariants → checklist → boundaries → discrepancies. The sections an admin package does not have — data model, HTTP API, migrations — have simply dropped out.

The source is the code: the whole of `packages/shell/admin/src/**`, plus cross-checks against the adjacent packages — `bootstrap-admin` (`createAdmin`), `identity-admin` (`RequireAuth`, `authContext`), `design-system` (`ui/sidebar.tsx`, `ui/top-bar.tsx`, `hooks/use-mobile`), `utils-admin` (`slot`, `byOrder`, `documentTitle`, `isComposingText`), as well as the factories of every contributing plugin and the `apps/admin-e2e/src/{shell,home,host}` suites. The `AGENTS.md` file was used as a skeleton, but every statement was verified against the implementation — the divergences are collected in section 14.
