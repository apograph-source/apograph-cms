# @orthacms/workspaces-admin

The **workspaces feature plugin** for the Ortha CMS admin UI. It owns the
Workspaces management experience: the private `/workspaces` route (a searchable,
status-filterable **table** of workspaces), the full-page **create wizard** at
`/workspaces/new`, and its sidebar nav entry + a "Workspaces" quick-list section.
It also owns the **workspace shell** at `/workspaces/:id/*` — which, when a row
is clicked, **injects a per-workspace nav (`WorkspaceNav`: switcher + Content +
Workspace sections) into the app sidebar** (via `useSidebarContent`) and renders
the section content in the inset.

## Layout — layered (ADR-0003)

This plugin is **layered (tactical DDD)** — the admin-side reference for
ADR-0003. `src/lib` is organized into four layers, not the legacy per-hook
`api/` layout:

- **`domain/`** — pure TS, no React: the `Slug` value object (the single
  client-side slug rule, mirroring the server), shared view types, and UX-invariant
  helpers.
- **`application/`** — the TanStack Query hooks (reads + mutation/use-case hooks).
  Each calls the gateway, never `apiClient`. The create wizard's submit
  orchestration is `useCreateWorkspaceFlow` (validate `Slug` → create → toast →
  navigate), so the wizard page is layout + fields.
- **`infrastructure/`** — the `WorkspaceGateway` **port** + its `httpWorkspaceGateway`
  implementation (the one place `apiClient` is used) and `workspaceMapper` (the
  wire→view anti-corruption layer, formerly the inline `toWorkspace`).
- **`presentation/`** — pages, components, slots, and the `currentWorkspace`
  provider; consumes view models + hooks only, never wire types or `apiClient`.

The admin stays **thin** — no client aggregates or repositories; the server owns
business truth (ADR-0003 frontend guidance).

## Package

- Name: `@orthacms/workspaces-admin`
- Import: `import { WorkspacesPlugin } from '@orthacms/workspaces-admin'`
- Grouped package (`packages/workspaces/admin`), admin-only. Consumed from source
  (`exports` → `./src/index.ts`); no build step.
- Register it in `createAdmin({ plugins })` **after** `ShellPlugin()` — it
  contributes its `/workspaces` route into the shell's gated layout and its nav
  item into the shell's `SIDEBAR_NAV_SLOT` (so it depends on
  `@orthacms/shell-admin`).

## Key exports

- `WorkspacesPlugin()` — factory returning an `AdminPlugin`: the lazy-loaded,
  private `/workspaces` (list) and `/workspaces/new` (create wizard) routes plus
  the `Layers` nav item (`group: 'directory'`, `order: 10`), the "Workspaces"
  quick-list section, and the home stat tiles + workspaces panel — contributed
  to the shell's `SIDEBAR_NAV_SLOT`, `SIDEBAR_SECTION_SLOT`, and
  `HOME_SECTION_SLOT`.
- `useWorkspaces` / `workspacesKey` — TanStack Query list hook + its key.
- `useCreateWorkspace` — create mutation with optimistic insert at the top;
  takes `{ body, creator }` (the `creator` seeds the stub's first member).
- `Workspace` / `WorkspaceMember` / `WorkspaceStatus` — the data model.
- **Workspace shell slots** — `WORKSPACE_NAV_SLOT` (the "Workspace" section's
  labeled nav rows), `WORKSPACE_SECTION_SLOT` (custom sidebar sections, e.g. the
  Content Library's content-type list), `WORKSPACE_ROUTE_SLOT` (pages mounted
  inside the shell; `WorkspaceRoute.order` picks the default landing), and
  `WORKSPACE_SETTINGS_TAB_SLOT` (a section on the **settings** page — see
  below), plus the `WorkspaceNavItem` / `WorkspaceSectionItem` /
  `WorkspaceRoute` / `WorkspaceSettingsTab` item types. A
  feature plugin that lives inside a workspace (Content Library, Media Library,
  Insights) contributes a route + either a nav entry or a section to these — and
  **no** top-level route or global nav item.
- `useCurrentWorkspace()` — reads the open workspace from the shell's context
  (no re-fetch); throws if called outside a shell route.

## Access is scoped to membership

`GET /api/workspaces` returns **only the workspaces the signed-in user is a
member of** (the server enforces this; see `workspaces-server`'s AGENTS.md).
Every surface here renders from that one `useWorkspaces()` list — the sidebar
quick-list, the `WorkspaceSwitcher`, the command palette, the home stat tiles +
panel, the workspaces table, and the Content Library's nav section — so none of
them can show a workspace the user doesn't belong to. **Don't add a client-side
membership filter**: the list is already the user's own, and filtering again
would silently hide workspaces the server did grant.

The one way to reach a foreign workspace is a deep link, and `WorkspaceShell`
handles it: the `:id` doesn't resolve against the list, so instead of the
workspace it renders a **no-access** state (`role="alert"`, "You don't have
access to this workspace" + a "Back to workspaces" link) and injects no sidebar
nav. It deliberately does **not** distinguish "not a member" from "doesn't
exist", mirroring the API's flat 403.

## Workspace shell (`/workspaces/:id/*`)

- `WorkspaceShell` resolves the `:id` param against `useWorkspaces()` (the
  membership-scoped list, so an unresolved id _is_ the no-access case),
  publishes it via `CurrentWorkspaceProvider`, and **injects `WorkspaceNav` into
  the app sidebar** via `useSidebarContent(() => <WorkspaceNav workspace={current}/>,
[current.id])`, clearing it on unmount. Its own render is just the content
  area whose nested `<Routes>` are built from `WORKSPACE_ROUTE_SLOT`; landing on
  the base redirects to the lowest-`order` route (the Content Library).
- `WorkspaceNav` (rendered in the app sidebar, so **above**
  `CurrentWorkspaceProvider` — it takes `workspace` as a prop) is: a "← Ortha
  CMS" back link + a full-width `WorkspaceSwitcher` (design-system `Popover`
  listing workspaces + "New workspace"), then the `WORKSPACE_SECTION_SLOT`
  sections (the Content Library's content-type nav), then the "Workspace"
  section (`WORKSPACE_NAV_SLOT` — Media, Insights, Settings) as labeled rows.
  Nav rows use `SidebarMenuButton`, resolve their **relative** `to` against the
  active `:id`, derive active state via `useMatch`, and gate on
  `useHasPermission`.
- The workspace accent tints the switcher avatar; the persistent account footer
  (from the shell) stays below.
- Workspaces owns the last **Settings** entry (`WORKSPACE_NAV_SLOT`, `order:
100`) + its `/workspaces/:id/settings` page; the Content and Media/Insights
  sections come from the feature plugins.

## Settings page (`/workspaces/:id/settings/*`)

- A **tabbed** page (`pages/WorkspaceSettingsPage`) mirroring the user-detail
  layout: a shared-width `Container`, a header, then the
  `components/WorkspaceSettingsTabs` underline tab bar (design-system `TabNav`
  of absolute-path `NavLink`s) above the active section, each a **nested
  route** (`settings/general` · `/members` · `/content` · `/danger`; the index
  redirects to `general`). Mounted at `settings/*` so the page owns those child
  routes (same shape as the content library's `content/*`).
- The sections: **General** (name / description / avatar color; TanStack Form +
  the `useWorkspaceProfileSchema` Zod hook, the slug shown read-only since it's
  immutable, plus a **copyable workspace id** — `WorkspaceIdField`, an
  `InputGroup` with a copy button, since the id is what the public content API's
  `X-Workspace-Id` header takes and was otherwise only readable off the address
  bar. Unlike the slug it is `readOnly` but **not** `disabled`: a disabled input
  can't be focused, so it could be neither selected nor copied by keyboard.
  Clipboard failure — insecure origin, denied permission — falls back to an
  error toast telling the user to select the id manually), **Members** (a directory typeahead that assigns **existing** users
  — no invite-by-email, since the add endpoint links a real id — plus a roster
  where a member is removed behind a `ConfirmDialog`. Access is purely
  permission-based, so no member is privileged — but the **last** one cannot go:
  a workspace with nobody in it is unreachable, and the server answers 409
  `LastMemberError`. The dialog narrows that status with `isConflict` and says
  what would help, the way the content-revoke and delete dialogs already do,
  **Content** (the granted types shown as two titled groups — **Collections** and
  **Pages** (`GrantedContentGroup`, each row its title + description), granted
  through a **separate search + multi-select popup per kind** — two
  `AddContentDialog` instances, "Add collections" / "Add pages", each listing
  only that kind's ungranted types and synced with the grants; revoke through
  `RemoveContentDialog`, which reads
  `GET /workspaces/:id/content/:slug/entry-count` on open and **blocks** the
  Remove button with a warning while the type still has entries, so the server
  `409` is only a safety net), and a **Danger zone**
  (archive/unarchive behind a confirm; permanent delete through
  `DeleteWorkspaceDialog`, which reads `GET /workspaces/:id/entry-count` on open
  and **blocks** Delete with a warning until the workspace holds no content at
  all — the same block-before-you-act pattern as content revoke, with the server
  `409` as the safety net; delete returns to the list).
- **Permission-gated end to end** via `useHasPermission`: `workspaces:update`
  drives every edit (a viewer sees a read-only page with the controls hidden),
  `workspaces:delete` gates delete; the Danger tab entry **and** its route only
  exist when the user can act on it (the route redirects to `general` otherwise,
  so a deep link can't reach it). The section bodies live in top-level
  `components/Workspace{General,Members,Content,Danger}Settings/` (their
  one-off parts nested inside).
- **A plugin adds a settings section through `WORKSPACE_SETTINGS_TAB_SLOT`.**
  A contribution names a `path`, a label (`labelId` + `defaultLabel`), an
  `icon`, an `order` and the `element` to render; `WorkspaceSettingsTabs` links
  to it and `WorkspaceSettingsPage` mounts it as a nested route.
  `@orthacms/protection-admin` is the first contributor. Three rules worth
  knowing:
    - **Contributed tabs sit between Content and Danger zone**, and `order`
      sorts them only against each other. Danger zone is last because it is
      where a workspace is destroyed; a plugin that could sort past it would put
      a routine setting beyond the point everything else treats as the end.
    - **A tab's `permission` hides the entry, and the route stays mounted.**
      `SettingsTabLink` does the check, as a component rather than a
      `useHasPermission` inside the parent's `.map` — slot items are frozen at
      boot so the list cannot actually move, but writing it the other way makes
      the next contributor's change a rules-of-hooks bug rather than an
      addition. The route is left mounted deliberately: a deep link reaching a
      section that explains the refusal beats a redirect somewhere nobody asked
      for.
    - **An empty slot changes nothing**, and `WorkspaceSettingsTabs`' spec pins
      it — that is the state the seam spends almost all of its life in, and
      nothing else would record that the default was a decision.
- Each area owns its mutation hook under `lib/application/` — `useUpdateWorkspace`,
  `useSetWorkspaceStatus`, `useDeleteWorkspace`, `useAddWorkspaceMember` /
  `useRemoveWorkspaceMember`, `useAddWorkspaceContent` /
  `useRemoveWorkspaceContent` (each calling `httpWorkspaceGateway`, not
  `apiClient`) — all invalidating `workspacesKey` on success so
  the shell (which reads the open workspace from that list) re-resolves — plus
  the read-only `useWorkspaceContentCount` / `useWorkspaceEntryCount` backing the
  revoke and delete pre-checks. The
  avatar-color picker `components/ColorSwatchRow/` is shared by the settings
  General tab and the create wizard's Basics step.

## Create wizard (`/workspaces/new`)

- A full-page, 3-step wizard (Basics → Members → Content), **not** a dialog. The
  page (`pages/CreateWorkspacePage`) owns navigation + submission; all form state
  lives in `hooks/useWizard` (the single source of truth) so it survives moving
  between steps. The active step is mirrored to `?step=` and clamped.
- The generic wizard **chrome lives in the design-system** — `Stepper` (the
  progress rail), `WizardStepCard` (the animated step card), and `WizardFooter`
  (back/skip/primary). The page configures them with its steps + intl labels; the
  workspace-specific step bodies (Basics/Members/Content) stay here.
- Supporting hooks: `useSlug` (auto-fill + regenerate + availability),
  `useResourceSelection` (controlled `specific`/`all` model), `useBasicsSchema`
  (localized Zod). Generic helpers (`slugify`, `useDebouncedValue`) come from
  `@orthacms/utils-admin`.
- Step entrance motion is the `wizard-step-in` keyframe shipped by the
  design-system stylesheet — **transform only** (opacity stays 1), disabled under
  `prefers-reduced-motion`, replayed via `key={step}` on the `WizardStepCard`.

## Architecture

- **Wired to the real API through a gateway seam.** Every request goes through
  `infrastructure/httpWorkspaceGateway` (the sole `apiClient` user; same-origin,
  cookie-authed) behind the `WorkspaceGateway` port; `application/` hooks
  (`useWorkspaces` → `GET /api/workspaces`, `useCreateWorkspace` →
  `POST /api/workspaces`, `useSlugAvailability`, `useUsersSearch` → `GET /api/users?search=&pageSize=10`,
  `useContentTypes` → `GET /api/content-types`, plus the settings mutations) call
  the gateway, not `apiClient`. Wire→view mapping lives in
  `infrastructure/workspaceMapper` (`toWorkspace`/`toMember`) — the anti-corruption
  layer, deriving presentation-only member `initials`/`color` on the client (the
  server stores neither) via the shared `initialsOf`/`asAvatarColor`/
  `avatarColorForId` from `@orthacms/utils-admin`. Generic helpers (`slugify`,
  `useDebouncedValue`) live in `@orthacms/utils-admin`, not here.
- **Membership is a pure link; there is no per-member role and no owner.** The
  server ignores any role on a member — a user's permissions come from their
  single global role. The Members step adds people (existing or invite-by-email)
  with no role control; the creator is just the first member (added from the
  session), with no special status.
- **Accent color.** Workspace and member avatars are tinted with the shared
  `AvatarColor` palette from `@orthacms/design-system` (the `--color-avatar-*`
  tokens in the host's `styles.css`) — the only color in the otherwise-neutral
  admin. New tokens/types live in the design-system, not here.
- **The table row opens the workspace; it has no actions menu and shows no
  role** — role is a property of the current user, not the row. Clicking it
  navigates to `/workspaces/:id`, which the shell redirects to the first section
  (the Content Library). The row surfaces member + content-type counts and a
  status pill; the status filter is a segmented chip group (All/Active/Archived).

## Conventions

- `type` over `interface`; JSDoc on exports; `import type` for type-only imports
- Every module is a `<name>/index.ts(x)` folder, grouped by layer (ADR-0003):
  components in `src/lib/presentation/components/<Name>/`, pages in
  `src/lib/presentation/pages/<Name>/`, query/mutation/use-case hooks in
  `src/lib/application/<useThing>/`, the gateway + mapper in
  `src/lib/infrastructure/`, value objects in `src/lib/domain/`, the plugin
  factory in `src/lib/presentation/workspacesPlugin/` (`camelCase` for
  non-components)
- **`pages/` stays flat** — each page is just `pages/<Name>/index.tsx`, no
  child component folders. Every component lives under `components/`. A
  component used only by **another component** nests inside that component's
  folder; a component used by a **page** sits at the top of `components/`. So
  the whole `components/CreateWorkspaceWizard/` subtree (Basics/Members/Content
  step bodies and their parts) nests under the wizard, and `WorkspaceNavButton`
  / `WorkspaceSwitcher` nest under `components/WorkspaceNav/`. The page-level
  components — `WorkspacesTable`, `WorkspaceToolbar`, `WorkspacesEmpty`,
  `CreateWorkspaceWizard` — and the shared pieces — `WorkspaceAvatar`,
  `StatusChip`, `WorkspacesSkeleton`, `WorkspaceNav`, `WorkspacesNavSection`,
  `WorkspaceStats`, `WorkspacesHomePanel` — all sit at the top of `components/`.
- User-facing strings go through `react-intl` (`defineMessages` + `useIntl`),
  co-located in the component file; ids namespaced `workspaces.<area>.<key>`
- Simple forms use TanStack Form + a `use<Name>Schema` Zod hook. The **create
  wizard is the exception**: its cross-step state lives in `useWizard` (controlled
  fields) and validates with the `useBasicsSchema` Zod hook directly, so state
  isn't lost when a step unmounts.
- presentational/stateful UI hooks live in `src/lib/presentation/hooks/<useThing>/`;
  data hooks (queries/mutations/use-cases) in `src/lib/application/<useThing>/`
- UI is built only from `@orthacms/design-system` components, not bespoke markup

## Commands

- `npm exec nx typecheck @orthacms/workspaces-admin`
- `npm exec nx lint @orthacms/workspaces-admin`
