# @orthacms/users-admin

The members **admin plugin**: the **Members** page at `/users`, the **Invite
member** page at `/users/invite`, the **user detail** page at `/users/:id`, and
the sidebar nav entry.

## Layout — layered (ADR-0003)

This plugin is **layered (tactical DDD)**, mirroring the `workspaces/admin`
pilot. `src/lib` is organized into four layers, not the legacy per-hook `api/` +
`utils/` layout:

- **`domain/`** — pure TS, no React: shared view types (`types/member`,
  `types/session`, `types/workspaceOption`), the `Email` value object
  (`value-objects/email`, the single client-side email rule for instant invite
  validation), and the `MemberEntity` client entity (`member/`) exposing the
  **UX invariants** the admin mirrors from server facts —
  `canChangeRole(viewerId)` and `canBeRemoved(viewerId)` return `{ ok, reason }`
  so a control disables itself with a reason instead of failing on submit. Both
  take the **viewer's id**: the server refuses self-actions (you cannot disable
  your own account, or change your own role), and a guard that doesn't know who
  is asking can only mirror half the rules — which is how the Role tab used to
  invite a click that could never succeed and then report a generic "please try
  again". `canChangeRole` additionally vetoes a member whose `role` is `null`
  (see below).
- **`application/`** — the TanStack Query hooks (reads + mutations). Each calls
  the gateway, never `apiClient`. The invite wizard's submit orchestration is
  `useInviteMemberFlow` (validate `Email` → invite → toast → navigate), so the
  invite page is layout + fields; `useMembersMutation` is the shared mutation
  shell (normalize + invalidate `membersKeys.all`).
- **`infrastructure/`** — the `MemberGateway` **port** + its `httpMemberGateway`
  implementation (the one place `apiClient` is used), `memberMapper` (the
  wire→view anti-corruption layer, formerly `utils/toMember`, keeping the
  presentation-only `initials`/`color` enrichment), and `membersKeys`.
  - **The mapper does not invent a role.** A key outside the three assignable
    system roles maps to `role: null`, not to a guessed `viewer` — the server's
    `Role.create` accepts any non-empty key, so a custom role is a shape this
    admin must expect. Everything downstream renders `roleName` (the server's own
    label) when `role` is `null` and refuses to offer a change, so the UI never
    asserts a privilege level someone does not hold.
  - **`membersKeys.sessions(id)` is rooted at `member-sessions`, not under the
    member's detail key.** TanStack matches by prefix, so nesting it would make
    every member mutation invalidate every cached session list — which no member
    mutation can affect, and which runs at `staleTime: 0` so it refetches
    immediately. The separate root is what keeps the broad `membersKeys.all`
    invalidation honest. `membersKeys/index.spec.ts` pins the scoping.
- **`presentation/`** — pages, components, the `usersPlugin` factory, the
  `userDetailContext` Outlet provider, and `membersFilterFields`; consumes view
  models + hooks + the `MemberEntity` only, never wire types or `apiClient`.

The admin stays **thin** — no client aggregates or repositories; the server owns
business truth. `MemberEntity` wraps the plain `Member` view model on demand (so
React Query's structural sharing keeps working) rather than replacing it.

## What it owns

- The private `/users`, `/users/invite`, and `/users/:id/*` routes (lazy +
  `<Suspense>`), rendered in the shell's authenticated layout.
- A `SIDEBAR_NAV_SLOT` entry (`group: 'directory'`, `order: 20`). The pages gate
  on the `users:read` permission via `useHasPermission`.
- The sidebar-footer **account menu** (`AccountMenu`), contributed to the
  shell's `SIDEBAR_FOOTER_SLOT`: a full-width row (avatar + name + email) that
  opens a dropdown with **My profile** (→ their own `/users/:id` detail page)
  and **Logout** (identity's `useLogoutMutation`). It reads the current user
  from identity's `useAuth`. The plugin contributes an invisible `ThemeSync`
  into the **same footer slot**: it pulls the signed-in user's saved theme from
  `GET /api/preferences` into the design-system `AppearanceProvider`, so the
  choice takes effect app-wide on load. It must live in the footer, not
  `SIDEBAR_SECTION_SLOT` — the section slot belongs to `GlobalSidebar`, which a
  route can replace wholesale via `useSidebarContent` (the workspace shell
  does), so a hydrator mounted there would never run for a user who deep-links
  into a workspace. The footer is the region the shell keeps mounted in both
  contexts.

## The pages

`MembersPage` — `Container`/`ContainerHeader`, a search toolbar, the
**Member · Role · Status · Workspaces · Joined** table plus an actions column
(its header is there for screen readers), pagination, a loading
**skeleton** (`MembersTableSkeleton`), and empty/no-access states. Each row is a
shortcut to the member's detail page (the name is a real link for keyboard
users); the row's kebab menu mirrors the detail tab bar — an **Account**
group (General/Role/Workspaces) plus permission-gated **Audit**
(Sessions/Activity) and **Access** (Sign-in access) groups that navigate
straight to a tab — followed by the status quick actions (Resend/Revoke invite,
Disable/Enable). Editing name/role now lives on the detail page, not an inline
dialog. `InviteMemberPage` — the invite form (role + workspaces), gated the same
way.

`UserDetailLayout` (`/users/:id/*`, via `UserDetailRouter`'s nested `<Routes>`)
— fetches one member once (`useUserDetail`) and shares it with every tab through
the Outlet context (`presentation/userDetailContext`), so a tab read is free. Renders
the back link, `UserHero`, `UserStatsStrip`, and the `UserDetailTabs` underline
tab bar (design-system `TabNav`) above the active tab. Seven tab pages:
**General** (edit name), **Role** (`RolePicker` +
confirm), **Workspaces** (`WorkspaceMembershipCard` + `AddToWorkspacesDialog`),
**Sessions** (`SessionCard` + revoke), **Activity** (reuses
`@orthacms/activity-admin`'s `useActivityLog`, pinned to `subjectId`),
**Access** (suspend/reactivate **plus the password-reset link**), and
**Preferences** (`UserPreferencesPage` —
the colour-theme picker Light/Dark/System over `/api/preferences`, applied
optimistically through the design-system `AppearanceProvider`). The Audit
(Sessions, Activity) and Access tabs are permission-gated **at the route
level** — without `users:update` / `activity:read` the tab bar hides them and
the route redirects to General. **Preferences is self-only** — it carries the
current user's own app settings, so it is gated on `useAuth().user.id ===
member.id` (hidden and route-redirected on anyone else's profile).

## Destructive actions are confirmed, named, and give focus back

Two member actions are irreversible from the UI: **Revoke invite** deletes the
pending account outright (cascading its token and workspace assignments), and
**Disable** locks a person out and kills their live sessions. Both now go
through the design-system `ConfirmDialog`, naming the member — matching what the
Access tab (Suspend), the Workspaces tab (Remove) and the Role tab already did.
They previously fired straight off `onSelect`, which meant one extra `↓` past
"Resend invite" destroyed an account before the key was released, with the first
feedback arriving in a success toast afterwards (WCAG 3.3.4).

**Focus has to be placed by hand after a row-removing mutation.** Radix restores
focus to whatever opened the overlay, but that trigger is the row's kebab and the
row has just unmounted — so focus falls to `<body>` and a keyboard user restarts
at the top of the document (WCAG 2.4.3). The row menu therefore targets a stable
anchor explicitly: the member's own kebab when the row survives (disable, resend),
and `MEMBERS_RESULTS_ANCHOR_ID` (`presentation/membersResultsAnchor`,
`tabIndex={-1}`) when it does not. That anchor wraps **all four** result states —
skeleton, error, empty, table — not the table alone: revoking the last row on
screen swaps the table for the empty state, so an anchor living on the table
would unmount at exactly the moment focus needed somewhere to land. The Sessions tab does the same with its card heading. A `requestAnimationFrame`
defers the move so it lands after Radix's own restoration rather than racing it.

**Per-item accessible names carry the target.** Every session's visible label is
just "Revoke", so the `aria-label` names the device and last-seen time, and the
confirm dialog's *title* does too — a dialog's accessible name is its title, and
"Revoke this session?" on all four cards tells a screen-reader user nothing.

## The invite link hand-off

Nothing emails an invite yet (identity epic #11), so the **admin is the delivery
channel** and the raw token comes back exactly once. Two surfaces exist for that
one moment, both built on `InviteLinkPanel` (read-only link + copy button +
a plain warning that whoever opens it becomes that person):

- the invite wizard ends on `InviteSent` instead of redirecting — navigating
  away before copying would mean resending;
- **Resend invite** opens `InviteLinkDialog` with the rotated link, because the
  resend already invalidated whatever link the invitee had.

`inviteLinkFor(token)` builds the URL from `window.location.origin` — the admin
is already looking at the app on the origin the invitee should use, so there is
no `publicBaseUrl` to misconfigure and no host header to poison. A server-side
base URL becomes necessary only when the mailer lands.

**Losing the link is guarded, because losing it is not recoverable.** Esc, an
overlay click and the close button all reach `onOpenChange(false)` by reflex, and
a resend has *already* rotated the token — so a dismissal before copying leaves
the invitee with a dead link and the admin with no live one, fixable only by
resending, which rotates again. `InviteLinkDialog` therefore tracks whether Copy
was pressed (`InviteLinkPanel`'s `onCopied`) and intercepts the first uncopied
dismissal with a warning; once copied it closes freely. The wizard's `InviteSent`
step registers with the app-wide `useUnsavedChanges` guard for the same reason —
that covers links, programmatic navigation and reload (`beforeunload`), which no
component here could intercept on its own.

## The password-reset link hand-off

The Access tab's `PasswordResetCard` mints a single-use reset link for an
**active** member and reveals it through `PasswordResetLinkDialog` /
`PasswordResetLinkPanel` — the same reveal-once shape as the invite pair,
because it is the same situation: no mailer exists, so the admin is the delivery
channel and the raw token is readable exactly once.

Three details are deliberate:

- **The card gates itself on status.** A `pending` member has no password to
  reset (resend their invite) and a `disabled` one cannot sign in, so the button
  locks with the reason rather than letting the server 409 a click that was
  never going to work.
- **The dismissal guard matters more here than for invites.** The server refuses
  a second mint for a minute (`PASSWORD_RESET_RECENTLY_SENT`), so closing the
  dialog without copying is not even immediately recoverable — the dialog
  intercepts the first uncopied dismissal, exactly like `InviteLinkDialog`.
- **The 409 is read, not flattened.** `PASSWORD_RESET_RECENTLY_SENT` carries
  `retryAfterSeconds`, so the toast says how long to wait; anything else falls
  back to the generic conflict message.

`passwordResetLinkFor(token)` builds the URL the same way `inviteLinkFor` does,
and points at identity's `/identity/reset-password` route.

## Conventions

- Every module is a `<name>/index.ts(x)` folder, grouped by layer (ADR-0003):
  components in `presentation/components/<Name>/`, pages in
  `presentation/pages/<Name>/`, query/mutation/use-case hooks in
  `application/<useThing>/`, the gateway/mapper/keys in `infrastructure/`, value
  objects + entity + view types in `domain/` (`camelCase` for non-components).
- `pages/` stays **flat** — each page is just `presentation/pages/<Page>/index.tsx`,
  with no child component folders. Every component lives under
  `presentation/components/`. A component used by exactly one **other component**
  nests inside that component's folder: the row pieces (`MemberRoleChip`,
  `MemberRowActions`, `MemberStatusBadge`, `MemberWorkspaces`) live under
  `components/MembersTable/`. A component used by a **page** sits at the top level
  of `components/` — `MembersTable`, `MembersToolbar`, `MembersPagination`,
  `MembersEmpty`, `MembersNoAccess`. **Shared** pieces also sit at the top of
  `components/` — `MemberAvatar` (used by the table, `MemberWorkspaces`, and the
  invite page) and `MembersSkeleton` (the page's `isPending` body, the invite
  page, and the lazy routes' `Suspense` fallback).
- Data flows through the gateway seam: `application/` hooks call
  `httpMemberGateway` behind the `MemberGateway` port (the sole `apiClient`
  user), never `apiClient` directly; wire→view mapping lives in
  `infrastructure/memberMapper`. Presentation-only member initials/avatar colors
  come from the shared `initialsOf`/`asAvatarColor`/`avatarColorForId` in
  `@orthacms/utils-admin` (no local copies).
- Co-located `defineMessages` (ids `users.<area>.<key>`); `type` over
  `interface`; design-system primitives only; a11y per the `accessibility` skill.

## Tests

Component *behaviour* lives in `apps/admin-e2e`, which drives a real browser —
`src/users/` covers the roster, the wizard, the detail tabs, the destructive-action
confirmations and the Role tab's guardrails. The package's own `vitest` specs
(`npx nx test @orthacms/users-admin`) hold only what a browser can't reach: the
mapper's coercion rules, the `MemberEntity` guardrail matrix, and the query-key
scoping — each needs inputs the API won't produce on demand (a custom role key, a
member who is both you and the last admin).

## Commands

- `npx nx typecheck @orthacms/users-admin` / `npx nx lint @orthacms/users-admin`
- `npx nx test @orthacms/users-admin` — the unit specs above
