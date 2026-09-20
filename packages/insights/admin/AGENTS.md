# @orthacms/insights-admin

The **Insights feature plugin** for the Ortha CMS admin UI — a workspace
dashboard at `/workspaces/:id/insights`.

It ships the **frame and nothing else**: the route, the range picker, the
section bands, the widget card shell, a per-widget error boundary, and a small
set of chart primitives. It contributes **no widgets of its own** and imports no
other feature package. Every card on the page arrives through
`INSIGHTS_WIDGET_SLOT` from the plugin that owns the data behind it. That is the
whole point — a dashboard is the module most likely to slowly become the one
that has to know about every other one, and the slot is what prevents it.

## The extension points

```ts
export const INSIGHTS_WIDGET_SLOT =
    createSlot<InsightsWidget>('insights.widget');
export const INSIGHTS_SECTION_SLOT =
    createSlot<InsightsSection>('insights.section');
```

An `InsightsWidget` is `{ id, section, order, size?, permission?, titleId,
defaultTitle, Component }`. The shape follows `shell-admin`'s
`HOME_SECTION_SLOT` — a zero-prop `Component` that reads what it needs — rather
than inventing a new one.

Two details are load-bearing:

- **`permission` is on the item _and_ checked inside the component.** The page
  has to know whether a band has any visible widgets _before_ it renders that
  band's heading, or a reader without `content:read` gets a "Content" header
  sitting over nothing. Same reason the workspace sidebar checks twice.
- **`titleId` / `defaultTitle` exist for the error boundary.** The widget renders
  its own title through `WidgetCard`; the item's copy is what the boundary shows
  when the component throws, because "Gone quiet stopped working" is a far more
  useful failure than an anonymous broken card.

### Sections are contributions too

There is **no privileged set of bands**. The four the plugin ships —
`overview`, `content`, `reach`, `team` (`INSIGHTS_SECTION_IDS`) — go through
`INSIGHTS_SECTION_SLOT` exactly like anyone else's, so opening a new band and
replacing a built-in are the same act. Three ways to change the page's shape:

- **Add a band.** Contribute an `InsightsSection` with a fresh `id`. The
  built-ins are ordered 10/20/30/40, leaving gaps of ten so a new band can slot
  between two of them without renumbering anything. `order` is optional and
  defaults to `DEFAULT_INSIGHTS_ORDER` (100), so a contributor with no opinion
  lands after the standard bands rather than in the middle of them.
- **Override a band.** Contribute the **same `id`**. Contributions merge by id
  with the last one winning, **field by field** — `{ id: 'team', defaultTitle:
'People' }` renames the band without resetting its order, description or icon,
  and without moving it. This is why `InsightsPlugin()` must be registered
  _before_ any package that overrides one of its bands (it is first among the
  workspace-interior plugins in `apps/admin/src/main.tsx` for exactly that
  reason). Widget contributions are order-independent.
- **Replace them all.** `InsightsPlugin({ sections })` swaps the default set;
  `DEFAULT_INSIGHTS_SECTIONS` is exported to spread and extend, and
  `sections: []` gives a page whose every band comes from contributing plugins.

A section carries an optional `descriptionId`/`defaultDescription` and an
`icon`, so a contributed band can explain itself rather than being a bare label.

**Nothing is silently dropped.** A widget naming a section nobody registered
does _not_ vanish — it lands in a trailing catch-all band ("More"). A missing
card with no error anywhere is the worst failure mode a plugin system can have,
and the previous behaviour (drop it, warn in dev only) was exactly that. The
band carries `data-section-fallback="true"`, so its presence on a
correctly-wired page is a bug worth asserting against.

A band with no visible widgets renders nothing at all, heading included — so an
install without `media-admin` simply has no "Localisation & media" band.

## The rules live in a pure function

`utils/resolveInsightsLayout` owns every rule that could quietly lose a
contributed card — the permission filter, the section merge, the ordering, the
catch-all — and takes plain data, so all of it is unit-tested without a browser,
a slot registry or an auth session.
`useInsightsLayout` is a thin adapter that reads the two slots and the auth
state and calls it. Ordering is stable, so two plugins contributing at the same
`order` produce a deterministic page rather than one that depends on iteration
order.

## Layout — layered (ADR-0003)

A read-only viewer, so per ADR-0003 there is **no `domain/` layer** — nothing
here has client-side business rules:

```
src/lib/
  utils/insightsPlugin/        # the AdminPlugin factory
  utils/chartTone/             # palette ROLES (series-1/2, the q0..q5 ramp)
  utils/insightsRange/         # the window as a value + its `?range=` round-trip
  hooks/useInsightsRange/      # the shared window + its provider (URL-backed)
  utils/resolveInsightsLayout/ # the PURE fold — merge, gate, order, catch-all
  hooks/useInsightsLayout/     # thin adapter: slots + auth -> the fold above
  presentation/
    slots/insightsSlots/       # the two extension points
    pages/InsightsPage/
    components/                # the card shell + the chart primitives
```

## The time window lives in the URL

`?range=90d` is the source of truth, not component state (ORT-158). Every other
list surface in the admin already settled this the same way through
`useTableUrlState`, and a range held in `useState` meant a "90-day dashboard"
could not be shared, bookmarked, or survive a click into an entry and back out —
the link sent a colleague to a different view than the one being described,
silently.

Three rules, the first two pinned by `utils/insightsRange`'s spec and the third
by `hooks/useInsightsRange`'s:

- **The default is absent from the URL.** A bare `/insights` link keeps meaning
  "the current default window"; writing `?range=30d` on every visit would pin
  every bookmark ever taken from the page to today's default, forever.
- **An unrecognised value falls back to the default** rather than throwing or
  rendering an empty dashboard. The page has no way to tell a reader their URL
  is wrong, so the useful behaviour is the one that still shows numbers.
- **`replace`, not `push`.** The picker is a view control; making Back step
  through eight range changes before it leaves the page is what
  `useTableUrlState` deliberately avoids for search and filters.

`useInsightsRange` is the only place that knows any of this — every widget reads
`days` from it and is unaffected.

## Charts — hand-built, deliberately

There is **no charting dependency**, and adding one should be argued for rather
than assumed. The whole page is bar lists, one area chart and two heat grids;
Recharts is ~500 KB and brings its own reconciliation for marks that are a few
`div`s and one `path`. These primitives also read the same design tokens as the
rest of the admin, so they follow the theme instead of needing a parallel
styling system.

Exported for contributors: `BarRows`, `AreaTrend`, `ColumnTrend`, `HeatGrid`,
`RampLegend`, `StatWidget`, `Sparkline`, plus `WidgetCard` / `WidgetChip`.

### The colour rules a contributed widget must follow

The palette lives in `apps/admin/src/styles.css` as `--color-chart-*`, and is
addressed through `ChartTone` roles rather than by colour name.

- **Exactly two categorical slots.** `series-1` / `series-2` are the only pair
  that clears colourblind separation against **both** the light card (`#ffffff`)
  and the dark card (`#19191f`). Blue + violet — the obvious next choice — fails
  at ΔE 1.9 under protanopia in dark mode. A widget needing a third category
  needs a different chart, not a third colour.
- **`q0`…`q5` are a sequential ramp**, for magnitude only. Never use ramp steps
  to distinguish categories; readers infer an ordering that isn't there.
- **The ramp's direction flips between themes** — low sits near the surface and
  high reads bright, so "more" always means "more visible". Any caption written
  about it must be phrased that way: "colour intensifies with age", **never**
  "darker means older", which is true in exactly one theme.
- **No text inside a fill.** Values go in the readout column in an ink token.
  A number printed on a bar has to stay legible against whichever palette step
  it lands on in both themes; moving it out removes the whole class of bug.
- **A zero segment is dropped, not drawn** (`BarRows`). Segments carry a 3px
  floor so a small-but-real value stays visible, and that floor turned an absent
  category into a sliver of colour — a locale with nothing missing rendered a
  tick of the "missing" hue, i.e. the chart stating the opposite of its data.
  Filtered inside `BarRows`, so no contributed widget has to know.
- **Status colours (`WidgetChip`) are separate from the series palette** and
  always ship with an icon, so a chip can never be mistaken for a series.

The palette values are stored as **hex, not oklch** like every other token —
they are the validator's output, and re-expressing them would let rounding drift
from the numbers that were actually checked.

## State, loading and failure

`WidgetCard` owns the **four-branch ladder** — pending, error, empty, data — so
no contributed widget can collapse them by accident. A failed load rendered as
an empty state is the most misleading thing a dashboard can do: "nothing needs
attention" and "we couldn't ask" look identical and mean opposite things. The
same reason `StatWidget` renders an em dash rather than `0` on error.

Each widget owns **its own request**, so a slow or failing aggregate degrades one
card instead of blanking the page, and each is wrapped in a `WidgetBoundary` so a
throw from another package's component can't unmount its neighbours.

Insights queries set **`retry: 1`**, not TanStack's default 3. Three attempts
with exponential backoff leave a broken widget sitting on a skeleton for about
seven seconds — on a page whose premise is that one card fails alone, that reads
as a hang rather than a failure.

## Contributing a widget

From the owning plugin's factory — it needs a dependency on
`@orthacms/insights-admin`, the same direction as any slot filler:

```tsx
slots: [
    {
        slot: INSIGHTS_WIDGET_SLOT,
        items: [
            {
                id: 'insights.content.stale',
                section: INSIGHTS_SECTION_IDS.Content,
                order: 10,
                size: 'md',
                permission: CONTENT_READ,
                titleId: 'content.insights.stale.title',
                defaultTitle: 'Gone quiet',
                Component: StaleEntriesWidget
            }
        ]
    }
];
```

Sizes map to twelfths — `xs` 3, `sm` 4, `md` 6, `lg` 8, `full` 12 — and only
apply from the `lg` breakpoint up; below that widgets collapse toward full
width, because a heat grid in a third of a phone screen is not a smaller
dashboard, it is a broken one.

**Who contributes what today.** `content-admin`: three Overview stat tiles, Gone
quiet, Draft/published by type, Publishing velocity, Waiting to go live, and the
Team punchcard. `media-admin`: the storage stat tile, storage by kind, Uploads,
and alt-text coverage. `i18n-admin`: Translation coverage. Their endpoints live
in `content-server` (`/api/insights/content/*`), `media-server`
(`/api/insights/media/*`) and `i18n-server` (`/api/insights/i18n/coverage`) —
**live aggregates, no projection**; the seam to change that later is those query
classes alone.

`i18n-admin`'s card is the one worth reading as a pattern: it is contributed by
the plugin that owns the **question** rather than the table. Coverage is about
the configured locale set, which content-server deliberately does not know, so a
card built there could report which languages appear in the data but never which
ones are missing. If a widget's honest answer needs a fact only one package
holds, that package owns the widget.

## Not built yet

Top contributors and Copilot usage (both sketched, neither wired). Delivery
traffic — API reads, popular entries, error rates — is **not possible** today:
nothing records a public-API request beyond `api_tokens.last_used_at`, so it
needs its own capture work rather than another widget.

There is no saved layout; `InsightsWidget.id` is the handle one would key on.

## Package

- Name: `@orthacms/insights-admin`
- Grouped package (`packages/insights/admin`), admin-only. Consumed from source.
- Register after `WorkspacesPlugin()` — it contributes to the workspace shell's
  `WORKSPACE_NAV_SLOT` / `WORKSPACE_ROUTE_SLOT`.

## Conventions

`type` over `interface`; JSDoc on exports; `<name>/index.ts(x)` folders; one
component per file; co-located `react-intl` messages namespaced
`insights.<area>.<key>`; UI from `@orthacms/design-system` only.

## Unit cover — vitest + jsdom

The package runs **vitest in the `jsdom` environment** (`vite.config.mts`,
mirroring `workspaces-admin` and `shell-admin`), not the node-environment jest it
started with. Page *behaviour* still belongs in `admin-e2e`, and nothing here
re-tests what a browser can see; what lives here is the set of claims a browser
cannot reach:

- **A widget that throws.** The e2e seed shapes HTTP responses, and a failing
  response takes `WidgetCard`'s error branch — a different code path that never
  reaches `WidgetBoundary`. Making a *component* throw means supplying the
  component, which is what a slot item is, so the boundary's isolation and its
  `resetKey={range}` recovery are pinned in `InsightsSectionBand`'s spec.
- **The width a typo'd `size` resolves to**, including the `Object.hasOwn` guard
  against an `Object.prototype` member.
- **The fallback `useInsightsRange` gives outside its provider**, and the
  `replace` / merge-with-existing-params half of the URL contract.
- **Whole literal class names**, checked as *source text* — the rendered markup
  is identical whether the table is literal or interpolated; only the file tells
  Tailwind's two outcomes apart.
- **The package's own shape**: no feature package in the manifest or the import
  graph, no server half, no migrations.

## End-to-end cover

`apps/admin-e2e/src/insights/{insights,a11y}.spec.ts`, driven by `InsightsPage`
and seeded by `support/api/insights.ts` (which can fail or empty **one** route,
since degrading a single widget is the behaviour worth pinning). Covers the slot
contract, per-widget requests, error-vs-empty, the permission gate collapsing a
whole band, range refetching, and axe scans of the loaded, loading and
partially-failed states.

## Commands

- `npm exec nx typecheck @orthacms/insights-admin`
- `npm exec nx lint @orthacms/insights-admin`
- `npm exec nx test @orthacms/insights-admin` — the unit tests (vitest, jsdom)
