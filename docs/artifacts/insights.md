# Insights

_Package · packages/insights/admin_

**A workspace dashboard that knows not one of its own widgets**

Insights is the workspace dashboard at `/workspaces/:id/insights`: "what has changed and what has gone quiet". The package ships **only the frame** — the route, the button in the rail, the range picker, the section bands, the card shell, an error boundary around every card, and a set of chart primitives. **It contains not one widget of its own**, and it imports no other feature package. Every card arrives through the `INSIGHTS_WIDGET_SLOT` slot from whichever package owns the data behind it.

- **1** package (admin only)
- **0** widgets of its own
- **13** widgets in the registry
- **3** supplying packages
- **4** sections + a fallback
- **10** data routes
- **9** exported primitives
- **4** time ranges
- **0** database tables

## Contents

- [01. Business description](#01-business-description)
- [02. Its place in the system and the "frame only" principle](#02-its-place-in-the-system-and-the-frame-only-principle)
- [03. The widget slot contract](#03-the-widget-slot-contract)
- [04. The full widget registry](#04-the-full-widget-registry)
- [05. Routes and screens](#05-routes-and-screens)
- [06. Flows — how it works, step by step](#06-flows-how-it-works-step-by-step)
- [07. States: loading, empty, one widget failing, no permission](#07-states-loading-empty-one-widget-failing-no-permission)
- [08. The date range and how it reaches the requests](#08-the-date-range-and-how-it-reaches-the-requests)
- [09. Chart primitives and the palette](#09-chart-primitives-and-the-palette)
- [10. Accessibility](#10-accessibility)
- [11. Invariants](#11-invariants)
- [12. Testing checklist](#12-testing-checklist)
- [13. Boundaries of responsibility](#13-boundaries-of-responsibility)
- [14. Discrepancies between code and documentation](#14-discrepancies-between-code-and-documentation)

## 01. Business description

Insights answers the question an editorial team asks itself constantly and used to answer with exports: **what is happening to the content right now**. Not "how many entries do we have in total", but "how many were added in the chosen period", "what is published but has not been touched in a long time", "what is ready but not shipped", "where are the translations missing", "who works when".

### The problem it solves

- **Replacing manual exports.** All the numbers an editor used to obtain by filtering the content library and counting rows are gathered on one screen and recomputed by the server.
- **One shared period.** The range is chosen once for the whole page, not per card. A dashboard where each card counts its own period invites false comparisons between neighbouring numbers.
- **Visible debt, not only achievements.** Half the widgets show not successes but unfinished work: publications that have gone quiet, unshipped edits, images with no alt text, untranslated entries.
- **Extensibility without editing the dashboard.** A new plugin with data of its own adds its own card; the Insights code does not change at all.

### Who sees it

#### Editor / contributor

Sees volume and pace: how many entries, how many published, what has piled up in drafts, what has gone quiet. The `content:read` permission is held by all three system roles, the viewer included.

#### Localiser

The "Localisation & media" band: translation coverage by language and by content type, switching between those two cuts inside one card.

#### Editorial lead

The "Team" band: a heatmap of saves by day of week and hour (UTC) — when the work actually happens.

### What Insights is not

The boundaries matter more than the capabilities here, because they are what explains why the dashboard lacks half of what people expect from a dashboard:

- **It is not traffic analytics.** There is no data at all about requests to the public API: the only trace of a call is `api_tokens.last_used_at`. Metrics like "popular entries", "traffic" or "error rate" are impossible not because nobody got round to them, but because there is nothing to compute them from.
- **It is not a metrics store.** There are no projections, snapshots or aggregate tables: every request is a live aggregate over the working content, media and locale tables. The `insights/admin` package owns not one database table and has no server half.
- **It is not the activity log.** Who did what is the `activity` plugin. Insights shows only aggregates, with no names and no event rows.
- **It is not a dashboard builder.** There is no saved layout: a user can neither hide a card nor drag one. The composition of the page is determined entirely by the installed plugin set and by permissions.
- **It is not a data source.** Not a single API request is sent from this package — every widget fetches its own data itself, from its own package.

> **The key architectural idea**
>
> A dashboard is the module that **slides into "knows about everyone" more reliably than any other**. The usual implementation imports content, media, locales, activity and copilot — and becomes a node that breaks on any change anywhere. Here it is done the other way round: the dependency is inverted. Insights declares two slots and imports nothing; it is `content-admin`, `media-admin` and `i18n-admin` that depend on `@orthacms/insights-admin`, not the reverse. One command checks it: the package's `package.json` lists no feature package among its dependencies — only `bootstrap-admin`, `design-system`, `utils-admin`, `workspaces-admin` and `identity-admin`.

## 02. Its place in the system and the "frame only" principle

There is exactly one package: `packages/insights/admin` → `@orthacms/insights-admin`. There is no server half — there is nothing to compute, since all the arithmetic lives with the owners of the data. The plugin lives **strictly inside a workspace**: not one top-level route, not one entry in the global navigation.

| What it contributes            | Where                 | Value                                                                                 |
| ------------------------------ | --------------------- | ------------------------------------------------------------------------------------- |
| A button in the workspace rail | WORKSPACE_NAV_SLOT    | `to: 'insights'`, `order: 30`, the `BarChart3` icon, colour `text-nav-amber`          |
| The route                      | WORKSPACE_ROUTE_SLOT  | `insights/*`, the page loads lazily (`lazy` + `Suspense` with `InsightsPageSkeleton`) |
| The four default sections      | INSIGHTS_SECTION_SLOT | `DEFAULT_INSIGHTS_SECTIONS` — through its own slot, not around it                     |
| Widgets                        | —                     | **none at all**                                                                       |

### Sections are contributions too

There is no privileged set of bands. The four built-in ones — `overview`, `content`, `reach`, `team` — go through `INSIGHTS_SECTION_SLOT` exactly as anyone else's do. Three ways of changing the page's shape follow from that:

- **Add a band.** Contribute an `InsightsSection` with a new `id`. The built-in ones are numbered 10/20/30/40 — the step of ten is left so that somebody else's band fits between two without renumbering. Without an `order` an item gets `DEFAULT_INSIGHTS_ORDER = 100`, that is, it lands _after_ the built-in ones rather than in the middle.
- **Override a band.** Contribute the same `id`. Contributions are merged by `id`, the last one wins, **field by field**: `{ id: 'team', defaultTitle: 'People' }` renames the band without resetting its order, description and icon, and without moving it. On a merge the **first** position is kept.
- **Replace the set entirely.** `InsightsPlugin({ sections })` substitutes the set; `DEFAULT_INSIGHTS_SECTIONS` is exported so it can be spread and extended. `sections: []` gives a page where every band comes from plugins.

> **Registration order matters — but only for sections**
>
> Section merging takes the **last** contribution, so `InsightsPlugin()` must be registered _before_ any package that overrides one of its bands. In `apps/admin/src/plugins.ts` it stands first among the "workspace internals" — right after `WorkspacesPlugin()` and **before** `ContentPlugin()` — for exactly that reason. _Widget_ contributions do not depend on order: `createAdmin` collects every plugin's slots in a single pass after all the factories have run.

> **Nothing disappears silently**
>
> A widget naming a section nobody registered **does not vanish** — it lands in the trailing fallback band, "More" (`id: 'other'`). The band is marked with the attribute `data-section-fallback="true"`, so its appearance on a correctly assembled page is a bug you can and should assert against in a test. The previous behaviour (drop it, warn in dev only) was the worst possible one: the card is missing and nothing anywhere says so.

### Package layout

Per ADR-0003 the package is layered, but **with no `domain/` layer**: it is a read-only viewer with no client-side business rules.

| Path                             | What is there                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| utils/insightsPlugin             | The `AdminPlugin` factory + `DEFAULT_INSIGHTS_SECTIONS`                                                       |
| utils/resolveInsightsLayout      | A **pure fold**: section merging, permission filtering, sorting, the fallback band                            |
| utils/insightsRange              | The window as a value: the range set, the day counts, parsing and writing `?range=`                           |
| utils/chartTone                  | Palette roles: `series-1/2` and the `q0…q5` ladder                                                            |
| hooks/useInsightsLayout          | A thin adapter: two slots + the auth state → the pure fold                                                    |
| hooks/useInsightsRange           | The shared window and its provider, with the URL as the source of truth                                       |
| presentation/slots/insightsSlots | The two extension points and `INSIGHTS_SECTION_IDS`                                                           |
| presentation/pages/InsightsPage  | The page itself                                                                                               |
| presentation/components/\*       | The card shell, the error boundary, the section band, the range picker, 7 chart primitives, the page skeleton |

Every rule that could _silently lose_ somebody else's card is gathered into one pure function, `resolveInsightsLayout`, which takes plain data. That is why they are covered by ordinary unit tests (**17** cases, the `node` environment) — with no browser, no slot registry and no session. The range-parsing rules were moved there too, another **7** cases.

## 03. The widget slot contract

Two extension points, both declared with `createSlot` from `@orthacms/utils-admin`:

- `INSIGHTS_WIDGET_SLOT` — `createSlot<InsightsWidget>('insights.widget')`
- `INSIGHTS_SECTION_SLOT` — `createSlot<InsightsSection>('insights.section')`

### What a widget must declare

| Field        | Req. | Type                           | Why exactly this way                                                                                                                                                                                      |
| ------------ | ---- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | yes  | string                         | A stable identity: the React key, the `data-widget-id` attribute in the markup (which e2e hooks onto), and the handle a saved layout would rest on, if there were one                                     |
| section      | yes  | string                         | The band's `id`. An unregistered value is **not an error**: the widget moves to the fallback band                                                                                                         |
| order        | no   | number                         | The order within the band. Defaults to `DEFAULT_INSIGHTS_ORDER = 100`. The sort is stable, so an equal `order` across two plugins gives a deterministic page rather than one depending on traversal order |
| size         | no   | 'xs'\|'sm'\|'md'\|'lg'\|'full' | The width in twelfths: 3 / 4 / 6 / 8 / 12. Defaults to `md`. This is a **request, not a guarantee** — see below                                                                                           |
| permission   | no   | string                         | The permission without which the widget is not shown at all. Carried **on the slot item** and checked inside the component at the same time                                                               |
| titleId      | yes  | string                         | The `react-intl` key for the widget's name                                                                                                                                                                |
| defaultTitle | yes  | string                         | The fallback name. It is what the **error boundary** shows when the component has crashed                                                                                                                 |
| Component    | yes  | ComponentType                  | The widget's body. **No props**: it reads what it needs itself — the open workspace, the chosen range, its own query                                                                                      |

The shape repeats `HOME_SECTION_SLOT` from `shell-admin` rather than inventing a new one: a component with no props that picks up its own context. Otherwise the page would be forced to know what each widget's data looks like.

> **Why the permission is duplicated**
>
> `permission` sits on the slot item **and** is checked inside the component (`useHasPermission` in the data hook, `enabled: canRead` on the query). The duplication is deliberate: the page has to learn whether a band has even one visible widget _before_ it renders its heading — otherwise a viewer without `content:read` would get a "Content" heading above nothing. The same logic as in the workspace sidebar, which also checks twice.

> **Why a widget needs a name if it draws one itself**
>
> A widget's body prints its own heading, through `WidgetCard`. The `titleId`/`defaultTitle` on the slot item are for the case where the body **failed to render**: the error boundary substitutes them into the placeholder, because "Gone quiet has stopped working" is incomparably more useful than an anonymous broken card.

### What a section declares

| Field                              | Req. | Comment                                                                                         |
| ---------------------------------- | ---- | ----------------------------------------------------------------------------------------------- |
| id                                 | yes  | `InsightsWidget.section` refers to it; it reaches the markup as `data-section-id`               |
| titleId                            | yes  | The key for the band's heading                                                                  |
| defaultTitle                       | yes  | The fallback heading                                                                            |
| order                              | no   | Defaults to 100 — that is, after the built-in 10/20/30/40                                       |
| descriptionId / defaultDescription | no   | The line under the heading: somebody else's band can explain itself rather than be a bare label |
| icon                               | no   | The icon to the left of the heading                                                             |

A subtlety: if `defaultDescription` is given and `descriptionId` is not, the key is derived automatically as `{titleId}.description`.

### Width is a request, not a guarantee

| `size` | Twelfths at `lg`+ | Actual classes                          | What happens on a narrow screen              |
| ------ | ----------------- | --------------------------------------- | -------------------------------------------- |
| xs     | 3                 | col-span-6 lg:col-span-3                | Half a row — four tiles fold into two by two |
| sm     | 4                 | col-span-12 md:col-span-6 lg:col-span-4 | Half at `md`, full width below that          |
| md     | 6                 | col-span-12 lg:col-span-6               | Full width                                   |
| lg     | 8                 | col-span-12 lg:col-span-8               | Full width                                   |
| full   | 12                | col-span-12                             | Full width always                            |

A heatmap or a list of five bars squeezed into a third of a phone screen stops being readable, so below `lg` everything collapses to full width. The classes are written as **whole literals**: Tailwind scans the source text and never emits an interpolated class name.

> **Protection against somebody else's typo**
>
> `spanFor()` checks `Object.hasOwn(SIZE_SPAN, size)` rather than simply reading `SIZE_SPAN[size]`. A direct read on a typo gave `undefined`, `cn` discarded it, and the widget ended up in one column out of twelve — a sliver, with no error anywhere. `Object.hasOwn` also closes the case where `size` names a prototype member (`constructor`, `toString`) and reads as "truthy but not a string". The type forbids it — but the contribution is written by another package, which may not be compiled against that type.

### What a contribution looks like

From the owning plugin's factory; it needs a dependency on `@orthacms/insights-admin` — the same direction as for any slot filler:

| Step | What the contributor does                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Adds `@orthacms/insights-admin` to its own `package.json` dependencies                                                                        |
| 2    | Writes a component that internally renders a `<WidgetCard>` and one of the primitives                                                         |
| 3    | Sets up a data hook: its own `queryKey` with `workspace.id` (and `days`, if the widget depends on the period), `retry: 1`, `enabled: canRead` |
| 4    | Contributes an item into `INSIGHTS_WIDGET_SLOT` from its own `slots: [...]` factory, naming `section: INSIGHTS_SECTION_IDS.…`                 |

Insights does not change at all in the process. That is precisely the test of whether the frame is a frame.

## 04. The full widget registry

This is the artifact's central section: the only place where what the Insights page actually consists of is gathered together. No such list exists in the code — and cannot, because every row below is declared in _somebody else's_ package. Today there are **three** suppliers and **thirteen** widgets.

Permission legend: `content:read` and `media:read` — the permission is checked twice, on the slot item and inside the data hook. Range: `period` — the request depends on the chosen window, `snapshot` — it does not.

| Widget                                                                                  | Package       | Section  | What it shows                                                                                                                                                                                        | Data route                                                                   | Permission     |
| --------------------------------------------------------------------------------------- | ------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------- |
| **Entries**<br>`insights.content.entries`<br>order 10 · size xs                         | content-admin | overview | Total entries in the workspace, the "+N in the period" delta and a history sparkline. A `StatWidget` tile                                                                                            | GET /api/insights/content/totals<br>`period` `?days=`                        | `content:read` |
| **Published**<br>`insights.content.published`<br>order 20 · size xs                     | content-admin | overview | Published entries, the delta for the period, a sparkline. A `StatWidget` tile                                                                                                                        | GET /api/insights/content/totals<br>`period` the same request                | `content:read` |
| **Drafts**<br>`insights.content.drafts`<br>order 30 · size xs                           | content-admin | overview | Drafts, and instead of a delta, "N% of all entries": a draft has no meaningful delta for a period                                                                                                    | GET /api/insights/content/totals<br>`period` the same request                | `content:read` |
| **Media storage**<br>`insights.media.storage`<br>order 40 · size xs                     | media-admin   | overview | Storage used (the number and the unit are separated so the figure stays in tabular figures) and "N assets". Delta tone `flat`                                                                        | GET /api/insights/media/storage<br>`snapshot`                                | `media:read`   |
| **Gone quiet**<br>`insights.content.stale`<br>order 10 · size md                        | content-admin | content  | Published entries by time since the last edit: five buckets — up to 30 days, 31–90, 91–180, 181–365, more than a year. `BarRows` along the `q0…q5` ladder plus a warning chip, "N older than a year" | GET /api/insights/content/stale<br>`snapshot`                                | `content:read` |
| **Draft and published, by type**<br>`insights.content.pipeline`<br>order 20 · size md   | content-admin | content  | Where the workspace's weight sits: for each content type, how much is published and how much is in drafts. A two-segment `BarRows` (`series-1`/`series-2`)                                           | GET /api/insights/content/pipeline<br>`snapshot`                             | `content:read` |
| **Publishing velocity**<br>`insights.content.velocity`<br>order 30 · size lg            | content-admin | content  | Publications per time bucket within the window. The server picks the granularity itself (`day` / `week` / `month`), and the card's caption follows it. `AreaTrend` plus a chip with the period total | GET /api/insights/content/velocity<br>`period` `?days=`                      | `content:read` |
| **Waiting to go live**<br>`insights.content.unshipped`<br>order 40 · size sm            | content-admin | content  | Published entries carrying unpublished edits, by type and in total. An `ok` chip, "everything shipped", or a `warn` one, "N% of the live ones"                                                       | GET /api/insights/content/unshipped<br>`snapshot`                            | `content:read` |
| **Translation coverage**<br>`insights.i18n.coverage`<br>order 5 · size full             | i18n-admin    | reach    | How far each language has got. A cut switcher inside the card: "By language" / "By type". Three totals — fully localised, not started, started but incomplete                                        | GET /api/insights/i18n/coverage<br>`snapshot`                                | `content:read` |
| **What's using the storage**<br>`insights.media.storageBreakdown`<br>order 10 · size sm | media-admin   | reach    | Bytes and asset counts by kind: image, video, audio, document, archive. `BarRows`                                                                                                                    | GET /api/insights/media/storage<br>`snapshot` the same request as the tile's | `media:read`   |
| **Uploads**<br>`insights.media.uploads`<br>order 20 · size sm                           | media-admin   | reach    | How many assets were added per time bucket. `ColumnTrend` — columns rather than a line: these are discrete counts, and a line between them would imply intermediate values nobody measured           | GET /api/insights/media/uploads<br>`period` `?days=`                         | `media:read`   |
| **Images missing alt text**<br>`insights.media.alt`<br>order 30 · size sm               | media-admin   | reach    | The library's accessibility debt: how many images have alt text and how many do not, and the uncovered share. An `ok` chip, "all covered", or a `warn` one, "N% without alt"                         | GET /api/insights/media/alt<br>`snapshot`                                    | `media:read`   |
| **When the work happens**<br>`insights.content.punchcard`<br>order 10 · size full       | content-admin | team     | Saves by day of week and hour (UTC). A 7×24 `HeatGrid` plus a "quiet → busy" `RampLegend`                                                                                                            | GET /api/insights/content/punchcard<br>`period` `?days=`                     | `content:read` |

### Summary by supplier

#### content-admin — 8

Three tiles in Overview, four cards in Content, one in Team. All on `content:read`. The data comes from `content-server`, six routes under `/api/insights/content/*`.

#### media-admin — 4

A tile in Overview and three cards in Reach. All on `media:read`. The data comes from `media-server`, three routes under `/api/insights/media/*`.

#### i18n-admin — 1

One full-width card in Reach. The data comes from `i18n-server`, `/api/insights/i18n/coverage`.

> **Why translation coverage is an i18n card and not a content one**
>
> This card is worth reading as the model case. It is contributed by the package that owns the **question**, not the table. Coverage is a statement about the _configured locale set_, which `content-server` deliberately does not know. A card assembled there could say which languages occur in the data, but never which are missing. The rule: if a widget's honest answer requires a fact owned by exactly one package, the widget belongs to that package.

> **How each band fills up**
>
> **overview** — four `xs` tiles, exactly one row of twelfths (3+3+3+3). **content** — `md`+`md`, then `lg`+`sm` (8+4): which is precisely why "Publishing velocity" is declared `lg` and not `full` — otherwise "Waiting to go live" would move to a row of its own. **reach** — a `full` at the top (order 5, ahead of media's tens) and three `sm` beneath it (4+4+4). **team** — one `full` card. No band is assembled "however it came out": the numbers are picked so that each row closes exactly.

### Saving requests inside the registry

Thirteen widgets — but **ten** data routes and fewer network requests than widgets. The three content tiles (`Entries`, `Published`, `Drafts`) read the same `totals` and share one `queryKey`, so TanStack Query collapses them into **one** request. The same goes for media: the `Media storage` tile and the `What's using the storage` card read the same `storage`. Each still stays a separate widget with its own loading state and its own error — independent indicators without three round trips for one aggregate.

> **What the registry lacks, and why**
>
> **Public API traffic** — popular entries, read counts, error rates — is **impossible** today: nothing records a call to the public API except `api_tokens.last_used_at`. That is a separate piece of data-collection work, not "one more widget". There is **no saved layout**: a user can neither hide a card nor rearrange one; the handle such a feature would rest on is `InsightsWidget.id`. **There are no widgets from `activity`, `copilot`, `alarms`, `segments`, `transfer` or `users`** — none of those packages contributes anything to `INSIGHTS_WIDGET_SLOT`.

## 05. Routes and screens

### 5.1 The screen

There is exactly one screen. Inside a workspace, with no entry in the global navigation.

| Path                               | What it is                                                                                                                                                                      | How to get there                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| /workspaces/:id/insights           | The Insights page: a top bar with the breadcrumb and the range picker, the heading, the subtitle "What changed in _{workspace}_, and what's gone quiet", then the section bands | The "Insights" button in the workspace rail (`order: 30`, the bar-chart icon, an amber accent) |
| /workspaces/:id/insights?range=90d | The same screen with an explicit window; the link can be forwarded                                                                                                              | A choice in the segmented control; the URL is written with `replace`, not `push`               |

The route is declared as `insights/*` and loads lazily: until the chunk arrives, `InsightsPageSkeleton` is shown — a full page placeholder (the bar, the heading, three bands of placeholders) rather than blank space. The tab name is set through `useDocumentTitle`, otherwise a private route would simply be called "Admin" (WCAG 2.4.2).

### 5.2 Data routes

None of them belongs to Insights — they all live in the owners' server packages. The global `/api` prefix is applied by the host; the workspace arrives **only in the** `X-Workspace-Id` header, which is why it is in none of the paths. All ten are closed the same way: `@UseGuards(PermissionsGuard, WorkspaceGuard)` + `@RequirePermissions(...)`.

| Route                               | Owner          | Parameters | Permission     | Who reads it                            |
| ----------------------------------- | -------------- | ---------- | -------------- | --------------------------------------- |
| GET /api/insights/content/totals    | content-server | `days`     | `content:read` | Entries, Published, Drafts              |
| GET /api/insights/content/stale     | content-server | —          | `content:read` | Gone quiet                              |
| GET /api/insights/content/pipeline  | content-server | —          | `content:read` | Draft and published, by type            |
| GET /api/insights/content/velocity  | content-server | `days`     | `content:read` | Publishing velocity                     |
| GET /api/insights/content/unshipped | content-server | —          | `content:read` | Waiting to go live                      |
| GET /api/insights/content/punchcard | content-server | `days`     | `content:read` | When the work happens                   |
| GET /api/insights/media/storage     | media-server   | —          | `media:read`   | Media storage, What's using the storage |
| GET /api/insights/media/uploads     | media-server   | `days`     | `media:read`   | Uploads                                 |
| GET /api/insights/media/alt         | media-server   | —          | `media:read`   | Images missing alt text                 |
| GET /api/insights/i18n/coverage     | i18n-server    | —          | `content:read` | Translation coverage                    |

> **Why some routes take no period**
>
> This is not an omission but a substantive decision per widget. **Gone quiet**: the buckets are themselves the time axis, and they are fixed so that the answer means the same thing under any chosen window. **Waiting to go live**: an unshipped edit stays unshipped whether it was made this morning or last spring — a window could only hide part of the queue. **Images missing alt text**: accessibility debt is a standing total, not an event of the last 30 days; narrowing the window would show the user the debt "shrinking". **Translation coverage**: an untranslated entry is untranslated regardless of its creation date. **Media storage**: space used is a state, not a flow.

`days` is validated on the server as an integer from 1 to **365**, defaulting to 30. The server picks the bucket width from that same number: up to 31 days by day, up to 120 by week, beyond that by month. The client does not request a granularity; it receives one in the response (`granularity`) and substitutes the matching caption.

## 06. Flows — how it works, step by step

### 6.1 Opening the page

1. **The user presses "Insights" in the workspace rail.** The router lands on `insights/*`; the page chunk loads lazily, and until it arrives `InsightsPageSkeleton` is visible.
   _the button is contributed through WORKSPACE_NAV_SLOT, order 30_
2. **The page raises `InsightsRangeProvider`.** It reads `?range=` from the URL; a missing or unknown value gives `30d`.
3. **`useInsightsLayout` assembles the layout.** It reads `INSIGHTS_SECTION_SLOT.getItems()`, `INSIGHTS_WIDGET_SLOT.getItems()` and the permissions from the auth state **once**, rather than one hook per widget, and hands it all to the pure `resolveInsightsLayout`.
   _the permissions are read once precisely so the band heading's fate can be decided before it is rendered_
4. **The fold returns a list of bands.** Sections are merged by `id` and sorted; widgets are filtered by permission and sorted; empty bands are dropped entirely, heading included; orphans are gathered into the trailing "More".
5. **Each band renders its heading and a twelve-column grid.** Each cell gets a `data-widget-id` and a width class.
6. **Each widget is wrapped in a `WidgetBoundary`** with `resetKey = range` and is mounted with no props.
7. **Each widget opens its own request.** Insights takes no part in that and does not know how many requests went out. Tiles sharing a `queryKey` collapse into one.
   _retry: 1, staleTime — STALE_TIME.Standard, enabled: canRead_
8. **The cards fill in independently.** A slow aggregate delays its own card, not the page.

### 6.2 Changing the range

1. **The user picks "90d"** in the top bar's segmented control.
2. **`setRange` writes the parameter into the URL.** It does not replace the whole query string but **merges** with the existing one — the shell and the widgets may have parameters of their own, and changing the period has no right to wipe them. A default value is **removed** from the URL rather than written.
   _replace, not push: choosing a period is a view control, not a history step_
3. **The provider recomputes `days`** (7 / 30 / 90 / 365) and hands the new value out through the context.
4. **Period-dependent widgets refetch** — their `queryKey` contains `days`, so this is an ordinary cache miss rather than a manual invalidation. Snapshot widgets do not move at all.
5. **Every `WidgetBoundary` gets a new `resetKey`** and clears its recorded failure: a card that crashed on the previous window's data gets a second chance.

### 6.3 A new widget appearing in the system

1. **The owning package adds a dependency** on `@orthacms/insights-admin`.
2. **Writes a component** rendering a `WidgetCard` and one of the primitives; passes the four state flags of its own query into the card.
3. **Contributes an item into `INSIGHTS_WIDGET_SLOT`** from its own factory, naming the section through `INSIGHTS_SECTION_IDS`.
4. **The host picks the contribution up** at the next start. The plugin's registration order does not matter.
   _it does — only if the package overrides a section_
5. **Not one line of the Insights code changed.** That is the criterion by which the frame is checked to have stayed a frame.

### 6.4 An installation without some of the plugins

1. **A deployment without `media-admin`.** The slot holds not one media widget.
2. **The "Localisation & media" band stays registered** — Insights contributes it itself.
3. **But if `i18n-admin` is missing too**, the band is left with no visible widget, and `resolveInsightsLayout` drops it entirely — heading included.
4. **The user sees a page with no "hole"**: not a labelled empty block, just one band fewer.
5. **If no band is left at all**, the page shows a single line: "No insights are available yet. Widgets appear here as the plugins that own the data are installed."

## 07. States: loading, empty, one widget failing, no permission

A dashboard differs from an ordinary screen in that nine or more independent states live on it at once. So the state ladder is placed in **one place** — `WidgetCard` — and no contributor can accidentally collapse it.

### 7.1 The four-branch ladder

| Branch      | Flag      | What is rendered                                                                                    | What a screen reader hears                                                            |
| ----------- | --------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Loading** | isPending | A `role="status"` block with `skeletonRows` bars (4 by default) and `data-testid="widget-skeleton"` | "Loading _{name}_…" — **with the card's name**, because nine of them announce at once |
| **Failure** | isError   | A red banner, "This didn't load. Refresh to try again."                                             | `role="alert"` — assertive                                                            |
| **Empty**   | isEmpty   | A muted line, "Nothing to show for this period yet.", or a custom one through `emptyMessage`        | `role="status"` — polite: nothing is broken                                           |
| **Data**    | —         | `children`: the chart itself                                                                        | The chart's text alternative (section 10)                                             |

> **Why the branches must not be merged**
>
> A failure rendered as "empty" is **the most harmful thing a dashboard can do**. "Nothing needs attention" and "we could not ask" look identical and mean the opposite. The order of branches is fixed: `isError` outranks `isEmpty`. For the same reason `StatWidget` prints an **em dash** on failure rather than `0`: zero reads as "none", a dash as "unknown". The dash is marked `aria-hidden` (a screen reader would read it as "hyphen" or say nothing), so a hidden "Unavailable —" text sits beside it; otherwise the tile would announce only its label and be indistinguishable from a card that simply has no value.

Two more details of the same nature: **the chip in the card's corner is suppressed while there is no data** — "156 older than a year" next to a skeleton asserts a number that has not loaded yet. And **the summary caption under the body** is shown only in the "data" branch, not in "empty".

### 7.2 One widget failing

Two different mechanisms, and it matters not to confuse them:

#### The request failed

The widget gets `isError` and renders the failure branch inside its own card. The neighbours are untouched, because each has its own request. There is **one** retry, not TanStack's default three: three attempts with exponential backoff keep a broken card on its skeleton for about seven seconds, and on a page whose whole idea is that one card fails on its own, that reads as a hang rather than a failure.

#### The component threw

`WidgetBoundary` is a class component (React still has no hook equivalent of `componentDidCatch`, and what has to be caught is a throw during the render phase). It catches, logs `[insights] widget "name" failed to render` along with the component stack, and renders a placeholder with the widget's heading and the text "This widget stopped working. The rest of the page is unaffected."

> **Why an error boundary is mandatory here**
>
> The components arrive **from other packages**, and Insights has no way whatsoever to check what they render. One mapper tripping over an unexpected `null` in `media-admin` must not take the content and team sections down with it. Without a `resetKey`, a single throw would be **permanent** for the page: a card that crashed on one window's data would stay broken even after switching to a window where the data is fine. So the chosen range goes into `resetKey` — and "change the period" becomes the recovery action a crashed card otherwise does not have.

### 7.3 No permission

The gating has two levels, and the levels solve different problems:

1. **The layout level.** `resolveInsightsLayout` drops widgets whose `permission` is absent from the user's permission set. A widget with no `permission` is visible to everyone.
2. **The band level.** A band with no widget left after the filter disappears entirely — heading included. A viewer without `media:read` gets no labelled emptiness.
3. **The request level.** The data hook asks `useHasPermission` once more and sets `enabled: canRead` — even if the component were somehow mounted, no request would go out.
4. **The server level.** The route is closed by `PermissionsGuard` + `WorkspaceGuard`; the client-side gating is a convenience, not a defence.

An observation: all thirteen widgets today declare a permission, and it is either `content:read` or `media:read`. Both are held by all three system roles, so in a standard installation the full page is visible to a viewer as well. In practice a band collapses not because of a role but because a plugin is not installed.

### 7.4 An empty page

If no band survives the fold, the page prints one line instead of the grid. The wording is chosen to explain the _cause_ rather than to apologise: "widgets appear here as the plugins that own the data are installed". It is the only honest text, because an empty page here means exactly that.

## 08. The date range and how it reaches the requests

Four windows, one control for the whole page.

| Choice | Visible label | `days` in the request | Value in the URL | Server granularity |
| ------ | ------------- | --------------------- | ---------------- | ------------------ |
| 7d     | 7d            | 7                     | ?range=7d        | by day             |
| 30d    | 30d           | 30                    | **absent**       | by day             |
| 90d    | 90d           | 90                    | ?range=90d       | by week            |
| 12m    | 12m           | 365                   | ?range=12m       | by month           |

### Three rules, pinned down by tests

- **The source of truth is the URL, not component state.** A range in `useState` would mean that the "90-day dashboard" a person is telling a colleague about could be neither forwarded, nor bookmarked, nor survive a reload and a return from the entry editor — and the link would silently send the recipient to a different view. Every other list surface in the admin UI already solved this the same way, through `useTableUrlState`.
- **The default value is not written into the URL.** A bare `/insights` link must keep meaning "the current default window". If choosing 30d wrote `?range=30d`, every bookmark ever saved would be nailed forever to today's default, and a later change to it would never reach those links.
- **An unknown value falls back to the default** rather than throwing or giving an empty dashboard. A typo, a hand-edited URL, a link written for a window this version no longer has — the page has no way to tell the reader their link is wrong, so the useful behaviour is the one where the numbers are shown anyway.

> **The value's path to the request**
>
> `?range=90d` → `parseInsightsRange` → `InsightsRange` → `RANGE_DAYS[range]` → `days: 90` in the context → `useInsightsRange()` inside somebody else's hook → into both the **cache key** and the **request parameters** at once. The key and the parameter come from one value, so changing the period is an ordinary cache miss rather than a manual invalidation. A widget that does not need the period simply never calls `useInsightsRange`, and its key contains no period.

> **The hook does not throw outside its provider**
>
> `useInsightsRange` called without an `InsightsRangeProvider` returns the default and an empty `setRange` rather than crashing. The reason is concrete: the widget is written by _another_ package, which may well render it in its own test or component showcase where no Insights page surrounds it. A hard throw there would be a trap rather than a useful error.

Two more details of the control: Radix clears the value when the active item is pressed again, so `onValueChange` ignores an empty value — otherwise the widgets would be left with no window at all. And the URL write **merges** with the existing parameters rather than replacing them.

## 09. Chart primitives and the palette

**The project has no charting library**, and adding one has to be argued for rather than assumed. The whole page is lists of bars, one area chart and two heatmaps; Recharts weighs about 500 KB and brings its own reconciliation for labels that here amount to a few `div`s and one `path`. And the main point: these primitives read the **same design-system tokens** as the rest of the admin UI, so they follow the theme without a parallel styling system.

### 9.1 What is exported

| Export      | Shape                                         | When to reach for it                                                    | Who already uses it                                                                 |
| ----------- | --------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| WidgetCard  | The card shell                                | **Always**, except for tiles: it owns the four-state ladder             | 8 widgets                                                                           |
| WidgetChip  | A pill in the top-right corner                | The one number the card most wants to convey                            | Gone quiet, Waiting to go live, Publishing velocity, alt text, translation coverage |
| StatWidget  | A tile: number + delta + sparkline            | A headline figure in Overview. Its own card, not `WidgetCard`           | Entries, Published, Drafts, Media storage                                           |
| Sparkline   | A tiny line with no axes                      | Inside a tile. Rarely needed on its own                                 | `StatWidget`                                                                        |
| BarRows     | A list of horizontal bars, up to two segments | Comparing categories with a label on the left and a number on the right | Gone quiet, pipeline, unshipped, storage, coverage                                  |
| AreaTrend   | An area chart with an axis and a grid         | A continuous quantity over time                                         | Publishing velocity                                                                 |
| ColumnTrend | Compact columns                               | **Discrete counts** of events over time                                 | Uploads                                                                             |
| HeatGrid    | A grid of cells by intensity                  | Two categorical axes with a quantity at the intersection                | When the work happens                                                               |
| RampLegend  | The scale of the `q0…q5` ladder               | **Mandatory** beside a heatmap                                          | When the work happens                                                               |

Plus the palette roles: `toneBackground`, `toneForIntensity`, `toneInk`, `SEQUENTIAL_TONES` and the `ChartTone` type. **`WidgetBoundary` is not exported** — the section band installs it, and a contributor does not need it.

### 9.2 Colour rules a foreign widget must follow

The palette lives in `apps/admin/src/styles.css` as `--color-chart-*`, but is addressed by **roles** rather than colour names: a widget asks for "the second series" or "the fourth step", and the theme decides how that looks on whichever surface the card landed on.

- **Exactly two categorical slots.** `series-1` / `series-2` is the only pair that passes colour-blind distinguishability **simultaneously** on a light card (`#ffffff`) and a dark one (`#19191f`). Blue with purple — the obvious next candidate — fails at ΔE 1.9 under protanopia in the dark theme. A widget that needs a third category needs a **different chart**, not a third colour.
- **`q0…q5` is a sequential ladder**, for magnitude only. Never distinguish categories with it: the reader will infer an ordering that does not exist.
- **The ladder's direction flips between themes.** The bottom sits close to the card's surface and the top reads bright — so that "more" always means "more noticeable". Any caption about this scale must be phrased the same way: "the colour deepens with age", **never** "darker means older": that is true in exactly one theme. Which is also why `RampLegend` is captioned "quiet → busy" rather than with colours.
- **No text inside a fill.** The numbers are moved out into a reading column in the ink token. A figure printed on a bar would have to stay legible on whichever palette step it landed on, in both themes; moving it out removes that whole class of defect at once.
- **A zero segment is dropped rather than drawn.** Segments have a 3px floor so that a small-but-real value stays visible — and that floor turned an absent category into a sliver of colour: a locale with nothing missing drew a stroke in the "missing" hue, so the chart asserted the opposite of its own data. The filter sits inside `BarRows` so that no contributor has to think about it.
- **`WidgetChip`'s status colours are separated from the series palette** and always come with an icon: if a chip were painted in a series colour, the reader would reasonably associate it with the bar of the same colour below.

The palette values are stored in **hex** rather than `oklch` like the other tokens: this is the validator's output, and rewriting them into another system would introduce rounding drift away from the numbers that were actually checked.

### 9.3 Small things hidden inside the primitives

#### NaN protection

`BarRows`: a zero or negative denominator would give every bar a width of `NaN%`, which renders as a **full** bar — the most wrong conclusion possible. It falls back to 1: empty data draws nothing. `Sparkline`: a perfectly flat series has a zero span, and dividing by it would put every point at `NaN`; the span falls back to 1.

#### Emphasis on the last column

`ColumnTrend` gives the last column the deepest step of the ladder: on a dashboard it is the fresh column people look for, and the emphasis costs nothing here because the ladder encodes nothing else.

#### The sparkline scales to itself

The series is normalised to its own min/max rather than to zero: at that size the question is the shape of the change, not its magnitude relative to the origin. It is drawn only with two or more points.

#### A step for zero

`toneForIntensity(0)` is pinned to `q0` — the step closest to the card's surface — so that "nothing" recedes rather than reading as "a little of something". The remaining steps split the range at thresholds of 0.2 / 0.45 / 0.7 / 0.9.

## 10. Accessibility

A dashboard is a hard accessibility case: nine charts with no text, nine simultaneous loads, and a control whose labels are two characters long. Taken point by point.

| Problem                                                | Solution                                                                                                                                                                                                                                                                                                         | Criterion    |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| A chart has no text                                    | `AreaTrend` and `HeatGrid` have a **real table** in a "Table view" `<details>` below the chart. `role="img"` makes everything inside the chart presentational, so nothing but that one sentence can be extracted from it, and the cell tooltips are unreachable from the keyboard                                | 1.1.1        |
| The second value of a split bar arrives only as colour | Each `BarRows` track is a `role="img"` with an `aria-label` assembled from the labels of **all** the segments, zero ones included: "0 missing" is information the bar cannot draw but the string can state. The reading column names only the first series, so the second would otherwise arrive as a single hue | 1.4.1, 1.1.1 |
| The period labels are "7d", "90d"                      | The unit is added as **hidden text** inside the button rather than through `aria-label`. An `aria-label` of "90 days" would displace the visible "90d", and a voice-input user saying "click 90d" would hit nothing. The composition gives "90d days": it is pronounced in full and contains what is written     | 2.5.3        |
| Skeletons are invisible to assistive technology        | `role="status"` plus a hidden "Loading _{name}_…" caption, **named by the card's heading**: nine simultaneous announcements are otherwise indistinguishable                                                                                                                                                      | 4.1.3        |
| "Empty" was silent while "failure" spoke               | Both branches announce: failure as `role="alert"`, empty as `role="status"`. Exactly the pair the whole ladder exists to distinguish was previously heard by a screen reader only half the time                                                                                                                  | 4.1.3        |
| A failing tile announced nothing                       | The em dash is marked `aria-hidden`, with a hidden "Unavailable —" beside it                                                                                                                                                                                                                                     | 1.1.1        |
| A skipped heading level                                | The page owns the `h1`, a section band the `h2`, a card the `h3`. It used to be `h4`: axe's `heading-order` rule is best-practice, and the harness scans only the WCAG tag set, so nothing caught it                                                                                                             | 2.4.6        |
| The tab name was simply "Admin"                        | `useDocumentTitle` on the page                                                                                                                                                                                                                                                                                   | 2.4.2        |
| A line consisting of one untranslated phrase           | The `WidgetBoundary` placeholder renders a `<FormattedMessage>`: a class component cannot call `useIntl`, which is why that string stayed an English literal longer than any other                                                                                                                               | —            |

<details>
<summary>What the accessibility e2e suites check</summary>

`apps/admin-e2e/src/insights/a11y.spec.ts` — axe scans in three page states: everything loaded, everything loading, and **one card crashed**; plus the range picker's keyboard reachability and operability, and the presence of a text alternative for every chart. `announcements.spec.ts` — loading announcements by name, polite "empty" versus assertive "failure", the tile's "value unavailable", the absence of gaps in the heading structure, addressing a range option by the label printed on it, and the heatmap's table being a real table.

</details>

## 11. Invariants

Statements that must always hold. This doubles as a review list and as a starting set of test assertions.

- **I-01** — The package imports **not one** feature package. Its dependencies are only `bootstrap-admin`, `design-system`, `utils-admin`, `workspaces-admin`, `identity-admin`.
- **I-02** — The package contributes **not one** item into `INSIGHTS_WIDGET_SLOT`.
- **I-03** — No widget disappears silently: a widget with an unregistered section ends up in the trailing band marked `data-section-fallback="true"`.
- **I-04** — A band left with no visible widget is not rendered at all — heading included.
- **I-05** — Sections are merged by `id` and the last contribution wins — **field by field** and only for the fields actually given; the band's position stays the **first** one.
- **I-06** — Widget and section sorting is stable: an equal `order` across two plugins preserves registration order rather than leaving it to object traversal.
- **I-07** — An item with no `order` gets `DEFAULT_INSIGHTS_ORDER = 100`, that is, it lands **after** the built-in 10/20/30/40 rather than in the middle.
- **I-08** — A widget whose `permission` the user lacks is excluded from the layout; the permission filter applies to the orphans in the fallback band too.
- **I-09** — The permission is checked twice: on the slot item, before the band heading is rendered, and in the data hook, through `enabled`.
- **I-10** — `WidgetCard` resolves exactly one of the four branches; `isError` outranks `isEmpty`.
- **I-11** — On failure `StatWidget` **never** prints a number: an em dash plus hidden "Unavailable" text.
- **I-12** — The corner chip and the summary caption under the body are shown only when there is data.
- **I-13** — A throw inside one widget does not unmount its neighbours: each is wrapped in its own `WidgetBoundary`.
- **I-14** — Changing the range clears the failure recorded by the boundary (`resetKey = range`), so a crash is not permanent.
- **I-15** — Every widget opens **its own** request; the page itself makes not a single network request.
- **I-16** — Every Insights request sets `retry: 1` rather than the default three.
- **I-17** — Every widget's cache key contains the **workspace id**; period-dependent ones also contain `days`. The workspace reaches the server only in a header, which is not sent on a cache hit.
- **I-18** — The range's source of truth is the URL. The default value is **not written** into the URL; an unknown value falls back to the default; the write uses `replace` and **merges** with the existing parameters.
- **I-19** — `useInsightsRange` outside its provider returns the default and an empty `setRange` rather than throwing.
- **I-20** — An unknown `size` value gives the `md` width rather than one column out of twelve; the check is `Object.hasOwn`, not a plain key read.
- **I-21** — All width and palette classes are written as **whole literals**: Tailwind will not emit an interpolated class name, and the bars would render transparent.
- **I-22** — A zero `BarRows` segment is not drawn but **is named** in the track's `aria-label`.
- **I-23** — No caption for the `q0…q5` ladder describes colour ("darker", "lighter") — only magnitude: the ladder's direction flips between themes.
- **I-24** — The heading structure has no gaps: `h1` for the page, `h2` for a section band, `h3` for a card (the error boundary's placeholder included).
- **I-25** — The package owns no database table, has no server half, and ships no migrations.

## 12. Testing checklist

Phrased as "action → expected result", so they can go into a test case without rewriting. Existing coverage: unit tests of the pure fold and of range parsing (`17` + `7` cases, the `node` environment) and three e2e suites — `apps/admin-e2e/src/insights/{insights,a11y,announcements}.spec.ts` (`25` + `5` + `6` cases), where the `support/api/insights.ts` seed can fail or empty **exactly one** route.

### The frame and the slot contract

- **Open the page on a full installation** → all 13 cards are visible, each under its `data-widget-id`, and the bands under `data-section-id`.
- **Check the network panel** → each widget calls its own route; there are not three `totals` requests but one; `storage` is likewise one for two cards.
- **Contribute a widget with `section: 'nope'`** → the card is visible in the trailing "More" band with `data-section-fallback="true"` rather than disappearing.
- **Contribute a widget with no `order`** → it lands after everyone who set an `order`.
- **Two widgets with the same `order`** → the order matches registration order and does not change between reloads.
- **A widget with `size: 'huge'`** → renders as `md` (half a row) rather than as a sliver one column wide.
- **Contribute a section with an existing `id` and only a `defaultTitle` field** → the heading changed; the order, description and icon survived; the band did not move to the end.
- **Register the overriding plugin _before_ `InsightsPlugin()`** → the override **is not applied** — the last contribution wins. That is exactly the reason for the ordering in `plugins.ts`.
- **`InsightsPlugin({ sections: [] })`** → every built-in band is gone; the widgets have moved into "More".

### Layout and permissions

- **A user without `content:read`** → no content cards; no "Content" and "Team" bands, headings included; no requests to `/insights/content/*` go out.
- **A user without `media:read` but with `content:read`** → three tiles instead of four in Overview; only translation coverage is left in Reach.
- **An installation without `media-admin` and `i18n-admin`** → the "Localisation & media" band is not rendered at all.
- **No visible widget at all** → one explanatory line instead of the grid, with no empty bands.
- **Call `/api/insights/content/totals` directly without the permission** → 403 from `PermissionsGuard`: the client-side gating is a convenience, not a defence.
- **Without the `X-Workspace-Id` header** → refusal from `WorkspaceGuard`.

### The range

- **Choose 90d** → `?range=90d` appears in the URL; only the period-dependent widgets refetch (`totals`, `velocity`, `punchcard`, `uploads`); the rest do not stir.
- **Choose 30d again** → the parameter is **removed** from the URL rather than rewritten as `?range=30d`.
- **Press Back after eight switches** → the browser leaves the page rather than rewinding eight steps (`replace`).
- **Open `?range=90d&foo=1` and change the period** → `foo=1` is still there.
- **Open `?range=42q`** → the page shows 30 days of data, nothing crashes, the dashboard is not empty.
- **Forward a link with `?range=12m`** → the recipient sees exactly the same window; the requests carry `days=365`.
- **Press the active option again** → the selection is not cleared and the window stays as it was.
- **Render somebody else's widget outside the Insights page** → it gets the default window rather than an exception.

### States

- **Fail **one** route (500)** → its card shows the red banner; every other card and band is present and holding data.
- **Fail the translation-coverage route** → the "Localisation & media" band stays, and the media cards in it work.
- **Fail `totals`** → all three tiles show a dash rather than `0`; none renders "empty".
- **Serve an empty workspace (valid empty responses)** → the cards show "empty" rather than an error; the summary caption is not printed.
- **Measure the time to a visible failure** → one retry, not three; the card does not sit on a skeleton for ~7 seconds.
- **Delay one route by 5 s** → its card is on a skeleton while the others already hold data; the page is not blocked.
- **Make a widget component throw** → a placeholder **with the widget's name** in its place; the console holds `[insights] widget "…" failed to render`; the neighbours are alive.
- **Change the range after a throw** → the card remounts and tries again rather than staying broken until a page reload.
- **Switch workspace** → the numbers are refetched rather than taken from the previous workspace's cache.

### Charts and accessibility

- **An axe scan on the loaded, the loading and the partly crashed page** → no violations in any of the three states.
- **Work the range picker with the keyboard alone** → the control is reachable and operable; focus is visible.
- **Find an option by its printed label ("90d")** → the accessible name **contains** the visible text.
- **Expand the heatmap's "Table view"** → a real `<table>` with `scope="col"`/`scope="row"`, whose values read without a mouse hover.
- **Listen to a split bar** → **both** series are announced, the zero one included ("0 missing"), not only the drawn one.
- **A locale with nothing missing in coverage** → no stroke in the "missing" hue — the zero segment is not drawn.
- **Listen to the transition into loading** → each card is announced **by name**, not nine identical "Loading…"s.
- **Compare the "empty" and "failure" announcements** → the first is polite (`status`), the second assertive (`alert`); both are heard.
- **Walk the heading structure** → `h1` → `h2` → `h3` with no gaps.
- **Switch between the light and dark themes** → the ladder stays readable both ways, and the legend captions do not appeal to "darker/lighter".
- **Narrow the browser to phone width** → the heatmap and the bar lists go full width; the page does not scroll horizontally.
- **Serve data whose maximum is zero** → no bars are drawn at all, and none is stretched to full width.
- **Serve a perfectly flat series to a tile** → the sparkline draws as a straight line rather than disappearing or producing `NaN`.

## 13. Boundaries of responsibility

| Area                                     | Who owns it                                              | What Insights does                                                  |
| ---------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| The cards' content and their data        | `content-admin` / `media-admin` / `i18n-admin`           | Nothing. Declares a slot and renders whatever was put in it         |
| The aggregating SQL queries              | `content-server`, `media-server`, `i18n-server`          | Has no server half whatsoever                                       |
| Tables and migrations                    | the plugins that own the data                            | Owns no table; there are no projections and no snapshots            |
| The route and the workspace rail         | `workspaces-admin`                                       | Contributes one button and one route into its slots                 |
| Permission checks                        | `identity-admin` (client) and `identity-server` (server) | Reads the permission set from the auth state and filters the layout |
| Slot mechanics                           | `utils-admin` (`createSlot`)                             | Only declares two slots                                             |
| Plugin collection and registration order | the host (`apps/admin/src/plugins.ts`)                   | Requires being registered before anyone who overrides its sections  |
| UI components                            | `design-system`                                          | Its own are only the card shell and seven chart primitives          |
| The activity log, who did what           | `activity`                                               | Shows aggregates only; never touches names or events                |
| Public API analytics                     | nobody (not implemented)                                 | Cannot show it: calls are not recorded                              |

### What else is missing

- **A saved layout.** No hiding a card, no rearranging, no assembling your own set. The handle would be `InsightsWidget.id`.
- **Export and print.** No CSV download and no print view — the numbers live only on screen.
- **A custom range.** Four fixed windows, with no "from… to…" and no page-level comparison against the previous period (the delta exists only inside the tiles).
- **A page-level cut by author, type or section.** Filters, where they exist, live inside an individual card — like the cut switcher in translation coverage.
- **Auto-refresh.** The data arrives once on mount and lives by `staleTime`; there is no polling and no live stream.
- **Cross-workspace widgets.** The whole page is about one open workspace; there is no combined "all of them at once" view.
- **Public API traffic data.** The only existing trace is `api_tokens.last_used_at`; that is a separate collection effort, not one more widget.

## 14. Discrepancies between code and documentation

Found while checking this dossier against the source. Not product bugs in themselves, but they mislead developer and tester alike.

| Where                                                                 | What it says                                                                                                                      | How it actually is                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/insights/admin/AGENTS.md, "Contributing a widget"            | "Sizes … **only apply from the `lg` breakpoint up**; below that widgets collapse toward full width"                               | True only for `md`, `lg` and `full`. In `SIZE_SPAN` the `xs` size is `col-span-6 lg:col-span-3`, that is, **half a row** on any screen, and `sm` is `col-span-12 md:col-span-6 lg:col-span-4`, that is, half from `md` upward. That is exactly how Overview's four tiles fold "two by two" on a tablet. `InsightsSectionBand`'s own docstring notes the `sm` case but is silent about `xs` too |
| packages/insights/admin/AGENTS.md, "End-to-end cover"                 | Lists `apps/admin-e2e/src/insights/{insights,a11y}.spec.ts`                                                                       | There are **three** suites: there is also `announcements.spec.ts` — six cases covering loading announcements by name, polite "empty" versus assertive "failure", the tile's unavailable value, the heading structure, addressing a range option, and the heatmap's table. That is precisely the suite covering the package's subtlest decisions, and it is not mentioned                       |
| packages/insights/admin/AGENTS.md, "Not built yet"                    | "Top contributors and Copilot usage (**both sketched**, neither wired)"                                                           | There is no trace of either in the repository: no components, no routes, no branch in the registry — searching for both names finds only this line itself. The reader goes looking for a "sketch" that does not exist                                                                                                                                                                          |
| packages/insights/admin/AGENTS.md, "The time window lives in the URL" | "`useInsightsRange` is the **only place** that knows any of this"                                                                 | The rules for parsing and writing `?range=` were moved into `utils/insightsRange` — precisely so they could be tested without a browser; the hook is only the React and router wrapping. The neighbouring paragraph of the same document describes it correctly ("all pinned by `utils/insightsRange`'s spec"), so the document contradicts itself                                             |
| packages/insights/admin/AGENTS.md, "The extension points"             | "An `InsightsWidget` is `{ id, section, order, size?, permission?, … }`" — `order` without a question mark, unlike its neighbours | In the type it is `order?: number` — optional, defaulting to `DEFAULT_INSIGHTS_ORDER`. The difference matters: a contributor who believes the line will treat the field as required and never learn about the default behaviour                                                                                                                                                                |
| The root `AGENTS.md`, "Project overview"                              | Lists `alarms`, `segments`, `transfer`, `mcp`, `copilot` and others, but **does not mention `insights`**                          | The package is described only in `CONTEXT-MAP.md` (line 38, and the description is accurate). Formally this is not a contradiction — the root file does not claim to be an exhaustive list — but an agent or developer starting from the canonical context file will never learn that the dashboard and its slot exist                                                                         |

### Noticed along the way (not discrepancies, but worth knowing)

- **The `reach` section id and its "Localisation & media" heading have drifted apart.** A contributor writes `INSIGHTS_SECTION_IDS.Reach` — a word that says nothing about locales or media — and lands in a band that is called something else entirely on screen.
- **The permission set is joined with commas.** `useInsightsLayout` builds its memoisation key as `permissions.join(',')` and immediately parses it back with `split(',')`. While every permission key has the form `area:action` this is safe; a key containing a comma would fall apart into two non-existent ones.
- **The upper bound of the period coincides with the server's ceiling.** Choosing "12m" sends `days=365`, and the server DTO accepts a maximum of exactly 365. There is no headroom: any upward extension of the range set will require editing `MAX_INSIGHTS_DAYS` at the same time, or the outermost option will start returning 400.
- **The translation-coverage widget is gated on `content:read` rather than on a localisation permission.** i18n has no permission of its own, so that is the only possible choice — but it is not obvious from the registry.
- **Duplicated request state.** Three content tiles and two media cards read one shared `queryKey` each: there is one request but five cards, and each renders its own state. On a failure the user will see several messages about one and the same failure.

---

**A dossier of the `@orthacms/insights-admin` package.** Written in the same frame as the `identity` artifact: business description → place in the system → the extension contract → the registry → routes and screens → flows → states → the range → charts → accessibility → invariants → checklist → boundaries → discrepancies. The central section here is the **widget registry**: no such list exists in the code, and cannot, because every line of it is declared in somebody else's package.

The source is the source code: all of `packages/insights/admin/**`, the plugin factories of `content-admin`, `media-admin` and `i18n-admin`, their hooks and data gateways, the `/api/insights/*` controllers in `content-server`, `media-server` and `i18n-server`, the host's plugin composition and the e2e suites. The `AGENTS.md` files were used as a skeleton, but every claim was checked against the implementation — discrepancies went into section 14.
