# @apograph/activity-admin

The audit-log **admin plugin**: the global **Activity Log** page at `/activity`,
its sidebar nav entry, and the home dashboard's recent-activity panel. Mirrors
the Members page patterns.

## Layout — layered (ADR-0003), no domain layer

This plugin is **layered (tactical DDD)**. It is a projection viewer with
**one** mutation and **no client-side domain rules**, so — per ADR-0003 ("don't
force DDD on CRUD / read-side contexts") — it has **no `domain/` layer**. Adding
empty `domain/` folders here would be a _violation_ of ADR-0003, not compliance.
This mirrors `activity/server`, which is likewise a read-side/CRUD audit context
with **no aggregate**.

The single mutation is `useRetryDeadLetter` — `POST /activity/dead-letters/:id/retry`,
the one action this plugin **performs** rather than records. It writes no
`activity_events` row (the log stays append-only, `activity:I-01`); it resets a
parked row in another package's table through Activity's own route. It carries
no rule the client could own: whether an event may be retried is the server's
answer — `404` unknown or already delivered, `409` still climbing its backoff —
and the admin renders that answer rather than predicting it. That is exactly the
case ADR-0003 says not to build a `domain/` layer for.

`src/lib` is organized into three layers plus a shared type kernel:

- **`infrastructure/`** — the `ActivityGateway` **port** + its
  `httpActivityGateway` implementation (the **one place `apiClient` is used** in
  this plugin, normalizing failures to `ApiError` via `toApiError`),
  `activityMapper` (the wire→view anti-corruption layer, formerly
  `utils/toActivityEvent`), and `activityKeys` (the query-key factory +
  `ActivityListParams`).
- **`application/`** — the TanStack Query hooks: `useActivityLog`,
  `useEntryActivity`, `useDeadLetters`, the one mutation `useRetryDeadLetter`,
  and `useRefreshDeadLetters`. Every one of them calls the gateway, never
  `apiClient`. `useDeadLetters` did import `apiClient` directly, which made the
  sentence above it false for as long as it stood; if you add a hook here, the
  seam is the port.

    `useRetryDeadLetter` invalidates `activityKeys.deadLettersRoot` and nothing
    else. Not `activityKeys.all`, and specifically **not** the log list: the
    retried event has not been delivered yet, so refetching every cached log
    page would be a storm for a change that has not happened. There is no
    optimistic removal either — the retention sweep moves this list underneath
    the reader — so the row leaves when the refetch lands.

    `useRefreshDeadLetters` is that same invalidation, for the paths that are
    **not** a successful retry: the `404`/`409` refusal (the client has just
    been told the row is not parked) and the dialog's own "Try again". It exists
    because there is one list and **two** cache entries — the banner's five rows
    and the dialog's fifty — so a refresh that names one of them by its `limit`
    leaves the other reporting rows it has been told are gone. The refused retry
    refetched only the dialog's page, and the banner went on counting and naming
    the kind of a row the client knew about. If you add a third place that
    refreshes this list, call this hook rather than a single query's `refetch`.

- **`presentation/`** — the pages, components, the `activityPlugin` factory,
  `activityFilterFields`, and `activityMessages`. Consumes the view models +
  the hook only; **nothing here imports `apiClient`**.
- **`types/`** — the wire-independent **view-model contract** shared by the
  mappers (infra) and the presentation: `activityEvent` (`ActivityEvent` /
  `ActivityActor` / `ActivityList` / `ActivityMeta`), `deadLetter` (`DeadLetter`
  / `DeadLetterList` / `RetriedDeadLetter`) and `activityKinds` (the
  `ActivityKind` union the admin restates locally, since it can't import the
  server plugins). Kept as a top-level kernel — not under `presentation/` — so
  the infrastructure mappers can produce these types without depending on the
  presentation layer.

## What it owns

- The private `/activity` route (lazy + `<Suspense>`), rendered in the shell's
  authenticated layout.
- A `SIDEBAR_NAV_SLOT` entry (`group: 'overview'`, `order: 20`) carrying
  `permission: 'activity:read'`, so the entry is **hidden** for users who lack
  it (the shell's `SidebarNavButton` honors the optional `permission` field).
  The page itself also gates on `useHasPermission('activity:read')`.
- A `HOME_SECTION_SLOT` panel (`RecentActivityPanel`) — the latest events on the
  home dashboard, reusing `useActivityLog` and gated on `activity:read`.
- An `ENTRY_TAB_SLOT` tab (`EntryActivityTab`, slug `ENTRY_TAB.Activity`) —
  **one entry's own trail**, in the content editor. It reads a different route
  (`GET /activity/entries/:id`) under a different permission (`content:read`),
  which is the whole point: the editor's built-in History tab is the _revision_
  timeline — what the words were at each save — and cannot say who published the
  record, who took it down, or who changed who may read it. Those rows existed
  and were reachable only from the admin-only Activity page, so the person most
  likely to ask was the one who could not.

    It was a **section of the Properties rail** until `ORT-198`. The rail is
    240px wide and shared by widgets from four plugins, so the list showed six
    wrapped rows; and it collapses as one column, so a reader who closed the
    panel lost the record's history with it. Tabs here are **routes**, which
    also means the open one survives the remounts this editor takes from
    navigations it does not own (a locale switch re-targets it at the sibling
    record) and can be linked to. The slug is declared in content-admin's
    `ENTRY_TAB`, not here: the set is closed, because the route table would
    otherwise match a segment `entryTabFromPath` cannot resolve.

- A `DeadLetterNotice` on the Activity page — how many events could **not** be
  recorded (`GET /activity/dead-letters`). It renders nothing when there are
  none, and nothing while loading or on error: a caveat about a list must never
  be the reason the page looks broken.

    Its **Review and retry** button — gated on `activity:manage` and **hidden**
    rather than disabled without it — opens `DeadLettersDialog`, nested inside
    the notice's folder because nothing else uses it. The dialog is where
    `lastError`, `occurredAt` and `attempts` are finally rendered: they have
    been on the wire since the read route shipped and appeared nowhere, and
    `lastError` is the one field that says whether the cause is fixed. The retry
    is **per row and only per row** — the banner shows five of an unbounded
    `total` and no ids, so a bulk action would act on rows the operator has
    never seen. No confirmation step: the audit insert is
    `ON CONFLICT DO NOTHING` (`activity:I-03`), so a repeat is ignored.

    The dialog **does** render its error state, which is the opposite of the
    banner's rule and deliberately so: the banner is a caveat nobody asked for,
    the dialog is an answer somebody asked for, and an empty table would answer
    "nothing is stuck".

    Retrying the last one is a focus trap in waiting: `total` hits 0, the notice
    returns `null`, and Radix restores focus to a trigger that no longer exists.
    So the notice closes the dialog in `onSuccess` and moves focus to
    `#main-content` on the transition to zero — the same fix `ActivityLogPage`'s
    `clearFilters` already carries, and only when this reader's own retry caused
    it.

    "Caused it" is a flag armed by the retry and **spent by the very next answer
    the list gives**, whatever that answer says — which is why the effect depends
    on the query's `dataUpdatedAt`/`errorUpdatedAt` and not only on `total`. A
    flag that survived until some later fetch happened to reach zero is a latch,
    and a latch moves focus for the retention sweep clearing the last row, for
    another operator's retry, or for a poll landing on a tab regaining focus —
    the precise theft the flag was added to prevent.

## The page

`ActivityLogPage` — `Container`/`ContainerHeader`, a filter toolbar (action/kind
select + actor-email search), the **When · Actor · Action · Subject** table with
**expandable rows** (a leading toggle reveals a details panel — subject, actor,
exact time, raw metadata — animated via a grid-rows `0fr↔1fr` transition,
`aria-hidden` + `inert` on the whole detail `<tr>` when collapsed, reduced-motion
aware), pagination, and a loading **skeleton** (`ActivityLogSkeleton`, used for
both the lazy fallback and `isPending`) plus empty/error/no-access states. The
**URL query string is the source of truth** for every filter and page
(deep-linkable); `page` is clamped to `pageCount` after a filter narrows the
result, and `pageSize` is clamped to the largest option the server accepts.

## Three things about this page that are load-bearing

**The log is deployment-wide, and the copy must say so.** This page sends no
workspace context, and the subtitle and empty state must keep saying "this
deployment": telling an admin of a multi-workspace deployment that the figure is
scoped, on the page whose whole job is being the record of record, is the defect
that copy exists to prevent.

`activity_events` **does** now carry a nullable `workspace_id`, and
`GET /activity` accepts a `workspaceId` filter — so a workspace filter is
buildable where it once was not. It is deliberately not built: the trail records
invites, role changes, sign-in failures and workspace lifecycle alongside
content edits, several of those belong to no workspace at all, and a filter that
silently drops them from a page called Activity would be worse than the absence
of one. If it is ever added it has to say what it excludes. It is **not** a
scoping boundary either way — `activity:read` still is.

**`ACTIVITY_KINDS` must stay in step with the server, and nothing enforces it at
runtime.** The admin restates the kind strings locally because it cannot import
the server plugins. A kind the server writes and this list omits is not a type
error and not a runtime error: the mapper casts `dto.kind as ActivityKind`,
`formatActivityAction` finds no descriptor, and the Action column silently prints
the raw dotted wire token. Six `workspace.*` kinds, `user.activated`, all seven
`media.*` kinds and all three `user.sso_*` kinds shipped that way.

Three things now guard it, and the third is the one that was missing:

- Inside the package, `ACTION_MESSAGES` is typed `Record<ActivityKind, …>`, so a
  kind added to the list without a label is a **compile error**.
- `apps/admin-e2e/src/activity/activity-kinds.spec.ts` proves every kind
  actually **renders** — **update its `ALL_KINDS_ACTIVITY` seed when the server
  gains a kind.**
- `audit-event-mapping.spec.ts`'s "the admin catalogue" block (in
  `activity/server`) compares this list with the server's `AUDIT_KINDS` in both
  directions, so a kind the server can write and the admin cannot render is a
  failing test. **The e2e suite alone could never catch that** — its seed is
  written from this same list, so it proves the list is self-consistent and
  nothing more. That is precisely how the SSO kinds shipped with every test
  green.

The same applies to `ACTIVITY_SUBJECT_TYPES`.

**Keep `types/activityKinds` free of imports.** The server-side check reads that
file as text rather than importing it, because an import would put this React
package in the audit plugin's TypeScript project graph. Two bare `as const`
arrays is what makes that work; if the module ever needs an import, move both
lists into a shared package rather than dropping the check.

**`at` may be an `Invalid Date`, on purpose.** `toActivityEvent` will not
substitute an instant for a timestamp the wire got wrong — inventing one for an
audit row is exactly the silently-rewriting mapper fallback to avoid. The cost is
that `Date.prototype.toISOString` **throws** on the result, and calling it
unguarded in render once blanked the entire SPA (there is no error boundary above
the home slots). Every `<time datetime>` in this plugin therefore goes through
`presentation/activityDateTime`, and every visible date through
`intl.formatDate`, which is total.

## Conventions

- Every module is a `<name>/index.ts(x)` folder, grouped by layer (ADR-0003):
  the gateway/mapper/keys in `infrastructure/`, the query hook in
  `application/`, pages/components/plugin/filter-fields/messages in
  `presentation/`, and the shared view types in `types/` (`camelCase` for
  non-components).
- `presentation/pages/` stays **flat** — only `pages/<Page>/index.tsx`, never
  child component folders. Every component lives under `presentation/components/`.
  A component used only by **another component** nests inside that parent's
  folder (the cells `ActivityActionCell`/`ActivityActorCell`/`ActivitySubjectCell`
  under `components/ActivityTable/`); a component a **page** uses sits at the
  **top level** of `components/` (`ActivityTable`, `ActivityToolbar`,
  `ActivityPagination`, `ActivityEmpty`, `ActivityNoAccess`, and the shared
  `ActivityLogSkeleton`, consumed by both the page's `isPending` body and the
  lazy route's `Suspense` fallback).
- Data flows through the gateway seam: every `application/` hook calls
  `httpActivityGateway` behind the `ActivityGateway` port (the sole `apiClient`
  user), never `apiClient` directly; wire→view mapping lives in
  `infrastructure/activityMapper` and `infrastructure/deadLetterMapper`.
- `activityKeys.deadLetters` takes the **limit**, because the banner and the
  dialog ask for different page sizes. It used to take no parameter while the
  request hard-coded `limit: 5`, so a second caller would have overwritten the
  banner's cache entry — and the banner computes its kinds line from `items`,
  so its copy would have changed depending on whether the dialog had been
  opened.
- `types/activityKinds` restates the kind strings **and** the subject types
  locally (the admin can't import the server plugins);
  `presentation/activityMessages` maps a kind → an "Action" label, a subject type
  → a readable name, and `meta` → a "Details" string — **no hardcoded action
  strings**, no central contract package. Details summaries read **one**
  descriptive field per kind rather than assuming a shared `meta` shape: media's
  payloads differ per kind by design, and the expanded row's Metadata line always
  shows the whole record anyway.
- Co-located `defineMessages` (ids `activity.<area>.<key>`); `type` over
  `interface`; design-system primitives only; a11y per the `accessibility` skill.

## Commands

- `npx nx typecheck @apograph/activity-admin` / `npx nx lint @apograph/activity-admin`
- `npx nx test @apograph/activity-admin` — the unit suite. `testEnvironment: 'node'`
  and `testMatch` is `*.spec.ts` only, matching `alarms-admin` / `copilot-admin`:
  what is tested here is the **pure** part — the mapper's refusal to invent a
  timestamp, the `<time datetime>` guard, and `ACTION_MESSAGES` against
  `ACTIVITY_KINDS`. Rendering belongs in `admin-e2e`, which drives a real browser.
- `npx nx e2e admin-e2e -- --project=chromium` — exercises `/activity` in a browser.
