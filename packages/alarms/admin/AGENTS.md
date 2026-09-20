# @orthacms/alarms-admin

The admin half of **content alarms** — the workspace's alarms page and rule
editor, plus the three Content Library slot contributions that put a finding
where it actually gets fixed.

Layout: **layered** (`domain` omitted — see below), per ADR-0003.

## The surface that matters is not the page

Nobody opens an alarms page to find out their article is broken. They open the
article. So the primary contribution here is the **entry rail's checks block**
(`ENTRY_SIDEBAR_WIDGET_SLOT`): an editor sees "Author is not published" beside
the record, with a link to the author, without knowing a rule exists.

The page is for the person who owns editorial policy — what is flagged across
the workspace, grouped by alarm, and the alarms themselves.

## The user-facing noun is **alarm**; the code's is `rule`

Every string a person reads says "alarm" — "Save as alarm", "New alarm",
"Delete this alarm?", and the third tab is **Alarms**. Message **ids**, types,
components, query keys and the API's `/alarms/rules` paths all keep `rule`.

The split is deliberate and came from a bug report: "rule" is coherent inside a
page titled Alarms and means nothing in the records toolbar, where the button
sits beside Filters and the column picker. The one place `rule` survives in copy
is as a message _placeholder_ name (`{rule} · {contentType}`), which nobody
reads.

## How an alarm gets made

Two ways, and the first is much better:

1. **"Save as alarm"** in the records toolbar (`RECORDS_TOOLBAR_SLOT`). The
   sequence a person actually goes through is: something looks wrong, so they
   filter the content list; they see the fourteen records and confirm it with
   their eyes; they ask the CMS to keep watching. At the third step the
   condition is already built and already verified against rows they looked at.
2. **New alarm**, from the alarms page — `AlarmRuleEditorPage` in
   `mode="create"` at `alarms/rules/new`, with a content-type picker in front of
   the condition builder.

The second was **added at a user's request, reversing a documented decision**,
and the original reasoning still holds: a blank condition form invites writing
an alarm against a collection nobody has looked at, which is how you get one
that matches everything. What makes it acceptable is the live match count — the
form runs the preview on every condition change and says "312 of 312 — that is
every record in the collection, the condition is probably inverted" before
anything is saved. If that readout regresses, this form becomes the footgun the
decision was about.

One component serves both modes, keyed by a `mode` prop rather than by sniffing
the route param. The two forms _are_ the same form; the only genuine difference
is whether the collection is chosen or already fixed, and an alarm's type is
fixed on purpose — changing it would not edit the alarm, it would silently
repurpose every finding it has already opened.

Two fields on both forms look redundant and are not:

- **Alarm name** — how it is listed, in the language of editorial policy:
  "Relations point at published records".
- **What editors will see** — the finding's title, on the record itself:
  "Author is not published".

Collapsing them gives you either a list full of instructions or an editor
being told about "relations pointing at published records" while looking at the
piece they are writing.

## The condition editor offers the records list's **full** field surface

`useFilterFields` alone is not enough, and this was a real bug: the records list
offers the server-derived paths **plus** whatever plugins contribute through
`RECORDS_FILTER_FIELDS_SLOT` — i18n's `localeCount` / `hasLocale` /
`missingLocale`, resolved at evaluation time by that plugin's own virtual-field
subqueries. An alarm saved from that list can carry either kind. Reading only
the server half meant a locale condition came back as _"This field is no longer
available — pick another one"_, and the Apply gate then refused **every** edit
to that alarm, because it rejects any rule whose field it cannot resolve.

Two things about the fix are easy to get wrong:

- **`useFields` is a hook**, so it is called unconditionally with a
  module-constant placeholder schema until the real one loads. Guarding the call
  on `schema.data` changes the hook count between renders and takes the page
  down with the error boundary — React counts hooks, not intentions, and the
  crash is total rather than a degraded field list.
- **The load state travels with the fields.** `useFilterFields` documents this
  itself: an empty surface, a still-loading surface and a failed request are
  three different things, and collapsing them "makes Apply a silent no-op with
  nothing on screen explaining why". The panel gets `fieldsPending`,
  `fieldsError` and `onRetryFields`, and the schema's own pending state is
  folded in — gated on there _being_ a type, since a disabled query reports
  `isPending` for ever.

## Apply changes the chips; Save re-checks the collection

In the records list, Apply has an obvious consequence: the table underneath
re-runs. The rule editor has no table, so committing a condition changed nothing
a person could see and Apply read as a dead button. Both halves of the fix are
on screen at rest rather than behind another click:

- The committed conditions render as **`QueryBuilderSummary` chips**, so Apply
  visibly moves the edit out of the builder and into the alarm. Removing a chip
  re-commits immediately, exactly as in the records toolbar.
- The **match count re-runs on its own** whenever those conditions change. It
  used to sit behind a button labelled "Count matches" — the one number that
  says whether the alarm means what its author thinks, available only if you
  knew to ask for it. The auto-preview keys on the serialised filter through a
  ref, not on `preview.mutate`: that identity changes every render, so
  depending on it fired one collection scan per keystroke in the name field.

An unsaved-conditions notice completes the split in words. It fires whenever the
on-screen conditions differ from the stored ones — **including when they have
been cleared**, which an earlier `filterKey !== null` guard treated as "nothing
to report" — but renders only when there is something saveable, because the
empty state and a disabled Save already say something more specific.

**Save always sends the filter.** It used to omit the key when the condition was
empty, which the API reads as "leave it alone" — so clearing every condition and
pressing Save silently kept the old one. Saving with no conditions is refused
instead: an alarm with no condition flags every record in the collection.

## Findings are grouped by alarm, not listed flat

A workspace with a thousand flagged records used to give forty pages of rows in
which nothing said which alarm was responsible and every row repeated the same
sentence. The page's own documentation had claimed grouping "because that is how
they get fixed" since the first commit; the code never did it. This is that
claim implemented.

- **The groups come from the alarms, not from a page of findings.** Each alarm
  row already carries its `openCount`, so the list of groups and the
  number on each header are exact without reading a single finding. Grouping a
  _page_ of findings client-side would have produced headers describing
  whichever twenty-five rows came back — "3 records" over a pile of ninety.
- **A group's records load when it is opened.** A workspace with twenty alarms
  would otherwise fire twenty list requests to draw a screen on which nineteen
  are shut. `useAlarmFindings(..., open)`.
- **Each group pages on its own**, ten at a time, and clamps its page the way
  the flat list used to — a page past the end otherwise strands the reader on an
  empty list with the pager hidden, now once per group.
- **Ordered loudest first, then biggest.** Someone scanning this wants the
  errors and the pile-ups at the top, not whatever order the API returned.
- **One group opens on arrival**; more than one and everything starts closed, so
  the page is a summary you drill into. An alarm card's "N records flagged" no
  longer _filters_ the list — it opens that alarm's group and leaves the rest
  visible, which is strictly more information for the same click.
- **A grouped row is one dense line**, indented under the header: which record
  and how long. The alarm, the sentence editors read and the severity are all on
  the header, so repeating them per row is the noise this exists to remove. It
  carries no action either — see muting, below.

**A finding can only name its record by id.** There is no display-field concept
on the server for the store to join, so the row shows `contentType` + the entry
id in tabular figures and links it. That is the honest identifier available
today; giving a finding a human title is a server change worth making and not
one to fake client-side.

## The one non-obvious call in the code

`AlarmRuleEditorPage` serialises with
`treeToJsonFilter(tree, new Date(), { relativeDates: true })`.

By default the query builder resolves a "within the last N days" rule into a
concrete cutoff, which is right for a URL — a shared link should keep showing
the same rows — and silently wrong for a **stored** filter, which would then
mean "since the day I was written" for ever while looking entirely normal in the
editor. This is the only place in the admin that stores a filter rather than
linking one, so it is the only place that asks for the relative spelling.

A consequence worth knowing: a rule saved from the records toolbar inherits the
URL's already-frozen cutoff, because the URL has no way to say which of the two
the person meant. Making it a rolling window is a one-line edit in the rule
editor.

## Layout

```
src/lib/
  utils/
    alarmsPlugin/            # the AdminPlugin factory — routes + five slots
    alarmsColumnMessages/    # the one descriptor the factory itself needs
  application/               # TanStack hooks over the gateway
    useAlarmRules, useAlarmFindings, useFindingsByEntry, useAlarmSummary
    useAlarmRuleMutations
  infrastructure/
    alarmsGateway/           # the port the presentation layer depends on
    httpAlarmsGateway/       # its impl — the only file importing apiClient
    alarmMapper/             # wire → view (the anti-corruption layer)
    alarmsKeys/              # query keys, all prefixed with the workspace id
  presentation/
    severityLook/            # severity → icon + classes (the one place)
    pages/AlarmsPage, pages/AlarmRuleEditorPage  # the editor serves create + edit
    components/…             # SeverityBadge, RuleList, the slots
      FindingGroupList/      # one collapsible group per alarm, + FindingGroup
      FindingRow/            # one record, inside its alarm's group
      FindingsPager/         # previous/next, one per open group
      AlarmsEmpty/           # the centred nothing-here figure
      FindingsToolResult/    # the copilot's `admin_alarms_findings`, rendered
  types/alarm/               # the view models
```

**No `domain/` layer**, deliberately. ADR-0003 is explicit that a read-mostly
viewer gets a mapper and query hooks rather than client value objects it would
have nothing to validate. The one real invariant — a finding's state machine —
is enforced server-side and merely rendered here.

## The copilot's findings, rendered

`FindingsToolResult` is contributed to `COPILOT_TOOL_RESULT_SLOT` for
`admin_alarms_findings`, so a copilot answer about flagged content renders as
rows with links instead of a JSON blob. Most tool results are provenance — the
answer is the assistant's prose and the call is the receipt. This one is
different: a list of flagged records **is** the answer, and every row has
somewhere to go.

**The one thing on it that exists nowhere else in the product is how long each
finding has been open.** The alarms page shows a date; the entry rail shows
none. Neither answers the question a person actually has when handed a list of
problems — _which of these have been rotting?_ — and that question is what turns
a list into a priority. `FindingAgeBar` draws it scaled to the oldest finding in
the same result (`ageBarWidth`, 4% floor so a brand-new finding still reads as a
row rather than as an absence), with the number in text beside it: the number is
the data, the bar is only the comparison, so a screen reader, forced colors or a
printout loses the ranking-at-a-glance and nothing else.

The bar is a single neutral colour deliberately. Length already carries
magnitude, and colouring it by severity would put two encodings on one mark
while leaning on exactly the red/amber pair a colourblind reader cannot
separate. Severity is the glyph at the start of the row instead.

- **`readToolFindings` returns `null` rather than throwing.** A transcript is
  replayed from stored history, so a result written by an older build of the tool
  reaches today's renderer. Every malformed shape falls through to the raw
  payload `ToolStep` renders anyway — a JSON blob is a far better outcome than a
  crashed conversation. A row whose severity this build does not know is dropped
  rather than rendered under the wrong one; the header's count comes from
  `bySeverity`, so the total stays honest either way.
- **The header describes the whole set, not the page.** `total` and `bySeverity`
  are the tool's, and the "N more not shown" line is the difference — a strip
  saying "1 warning" over a workspace with fourteen is worse than no strip.

## Severity has a shape, not only a colour

`severityLook` is the one place a severity becomes a look, and it hands back an
**icon** as well as classes: `CircleAlert` for error, `TriangleAlert` for warn,
`Info` for info. The colours are the design system's reserved status tokens
(`destructive` / `warning` / `info`), not raw palette steps — and the icons are
not decoration. Converting those tokens to hex and running the dataviz skill's
palette validator puts error against warn at **ΔE 0.9 under deuteranopia and
14.8 with normal vision**, below the 15 floor: the two loudest severities are
the pair a reader cannot tell apart by hue. Shape carries the distinction, the
label carries it in words, and the colour is the redundant third.

Anything new that renders a severity goes through `severityLook`. A hue picked
locally is a hue nobody measured.

## Details worth keeping

- **Query keys carry the workspace id.** Scoping is server-side via the
  `X-Workspace-Id` header the shared `apiClient` attaches, so without the id in
  the key, switching workspaces would serve the previous one's findings out of
  cache.
- **The records column honours `isVisible`.** Extension columns are hidden by
  default and `useRowsData` runs on every render regardless, so ignoring it
  would fetch on every page of every list for data nobody is looking at.
- **`isError` is never the empty state.** "Nothing is flagged" and "we could not
  check" render identically if you let the error fall through, and only one of
  them is reassuring. The findings list, the rule list, the entry widget and the
  records cell each give the failure its own words.
- **Each group clamps `page` to `pageCount`.** A page past the end leaves the
  pager hidden and the user stranded on an empty list.
- **Empty states are the centred figure, not an `Alert`.** A full-width bordered
  banner is the shape of a notification about something that just happened; on a
  wide screen an otherwise blank page wearing one reads as a warning strip.
  `AlarmsEmpty` matches `ApiTokensEmpty` and the rest of the admin — and it
  tells "no alarms at all" apart from "alarms exist and nothing matches", since
  only the second is reassuring and only the first has something to do about it.
- **A description-only `Alert` puts its icon _inside_ the description.** `Alert`
  absolutely positions a top-level `<svg>` at `left-4 top-4` and nudges the
  block beside it up 3px — geometry tuned for a title over a description. A
  one-line banner with no title gets the icon near the top of the box and the
  sentence off its centre. Wrapping icon and text in a flex row means none of
  the `[&>svg]` selectors match. (Five other call sites in users and api-tokens
  have the same defect; a generic `Alert` grid rewrite would fix them all.)
- **Slot-contributed toolbar controls match their neighbours.** The column
  picker and the Filters toggle are default-size outline buttons with
  `shadow-none`; "Save as alarm" carried `size="sm"` and a shadow, so it read as
  a different class of control wedged into their row.
- **Mutations invalidate the workspace's alarms root.** An alarm edit triggers a
  server-side rescan, which changes the count on its own card, the groups on the
  Flagged tab and the summary badge at once. There is no narrower placement
  worth the bookkeeping.
- **Severity is a word as well as a colour.** Encoding the whole meaning of a
  finding in hue fails WCAG 1.4.1 and fails anyone who cannot tell the three
  apart. Two surfaces had lost the word without looking like they had: a
  group header's `sr-only` severity sat inside a `CollapsibleTrigger` carrying
  an `aria-label`, which **replaces** descendant text in the accessible name,
  so it was never read; and the records column's summary named the count and
  the finding titles only, with the glyphs beside it `aria-hidden`. On any
  element with an `aria-label`, the word has to be part of that label.
- **Muting one finding at a time is gone.** It shipped, briefly, and was
  withdrawn: an alarm is either right about a record or wrong about it, and
  silencing them individually is a way of living with a bad condition instead of
  narrowing or disabling the alarm, where the next person can see the decision.
  Nothing here half-remembers it — no tab, no per-row action, no state — and
  `alarms.spec.ts` asserts the absence, because a withdrawn affordance that
  leaves a stub is worse than either state.
- **Both pages carry a `PageTopBar`.** It is the chrome every other workspace
  section has, and it is where the way back lives: the editor's breadcrumb is
  `Alarms › <the alarm's name>`, so two open tabs are told apart by which alarm
  they are editing rather than both reading "Edit alarm".

## Commands

- `npx nx run-many -t typecheck -p @orthacms/alarms-admin`
- `npx nx test @orthacms/alarms-admin` — `toolOutput` is unit-tested
  (`testEnvironment: 'node'`, as in copilot-admin: the tested code is pure)
- `npx eslint packages/alarms/admin`
- `npx nx e2e admin-e2e -- --project=chromium src/alarms` — the browser suite
  (`apps/admin-e2e/src/alarms`, seeded by `support/api/alarms.ts`). It covers the
  page chrome, the condition chips and the live match count, an
  alarm over a **slot-contributed** locale field, the create flow, the
  filterable-field load states, and axe scans of every state. `ALL_PERMISSIONS`
  in `support/api/auth.ts` had to gain `alarms:read` / `alarms:manage` first —
  without them this whole surface renders for nobody and no browser test can see
  it, which is why it shipped with a `window.prompt` in it.
