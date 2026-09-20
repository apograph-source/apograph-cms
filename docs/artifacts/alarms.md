# Alarms

_Package group · packages/alarms_

**Rules that say “something is wrong here” — and never forbid a save**

Alarms closes the gap between “the schema allows it” and “the editorial team considers it a mistake”. A workspace declares for itself what counts as a problem (“a published article whose author is still a draft”), and the CMS flags such entries everywhere they are worked with. **No flag ever blocks a save or a publish** — that is a decision, not a current limitation (`ADR-0015`). A rule is **an entry-list filter stored verbatim**, evaluated by the same engine as the list itself, so it physically cannot mean anything else.

- **2** packages in the group
- **9** HTTP routes
- **2** database tables
- **2** migrations
- **2** permission keys
- **3** evaluation sources
- **3** severity levels
- **2** finding states
- **6** admin slots
- **1** copilot tool
- **0** blocking checks

## Contents

- [01. Business description](#01-business-description)
- [02. The package group's composition](#02-the-package-groups-composition)
- [03. Roles and permissions](#03-roles-and-permissions)
- [04. Data model](#04-data-model)
- [05. A finding's lifecycle](#05-a-findings-lifecycle)
- [06. Scenarios — how it works step by step](#06-scenarios-how-it-works-step-by-step)
- [07. HTTP API](#07-http-api)
- [08. The admin UI: screens, slots, states](#08-the-admin-ui-screens-slots-states)
- [09. Configuration](#09-configuration)
- [10. Security and resilience](#10-security-and-resilience)
- [11. Invariants](#11-invariants)
- [12. Testing checklist](#12-testing-checklist)
- [13. Boundaries of responsibility](#13-boundaries-of-responsibility)
- [14. Discrepancies between the code and the documentation](#14-discrepancies-between-the-code-and-the-documentation)

## 01. Business description

The CMS can already validate content strictly — but in exactly one place: a type's schema. `EntryValidationService` checks the values, `publish-gate.ts` decides whether publishing is allowed, and `EntryWriterService` counts the required relations. Those rules are hard, and rightly so: a field declared `required` cannot be missing from a published entry.

But a large class of real content problems is inexpressible there — and should be. Alarms exists for exactly those.

### What alarms catch

| The case                                                           | Why the schema cannot catch it                                                                                                                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A published article whose author is a draft                        | `publishedOnly` is a visibility filter **on reads**. The publish succeeds; the relation simply vanishes from the API response, the page ships without an author, and nobody is told |
| A published article with no cover image                            | The field cannot be made `required`: that would make an unfinished draft unsavable, and drafts exist for exactly that                                                               |
| Three thousand entries written before Tuesday's editorial decision | No event will ever be raised about them again. Policy arrives after the content                                                                                                     |

### The three rules everything rests on

#### An alarm does not block a write

Neither `info`, nor `warn`, nor `error` gates a save, a publish or anything at all. Severity orders the list and colours the badge — and that is all. A rule produces information; a person makes the decision.

#### A rule is a saved list filter

`alarm_rules.filter` stores **the very same JSON tree** the entry list puts into `?filter=`, and it is evaluated through content's `EntryMatchQuery`. Alarms has no query language of its own and never will.

#### A finding is state, not an event

One row per `(rule, entry)` pair. It opens when an entry starts matching the condition and closes itself when it stops. The history (`first_seen_at`) survives both closing and reopening.

> **The main product decision · ADR-0015**
>
> **The first thing people will ask for after launch is a blocking severity level. The answer to that is the ADR itself.** A level with a veto turns the alarms plugin and the publish gate into two competing authorities deciding whether an entry is valid — and they will diverge. After that neither can be trusted: the one that actually applies (the gate) is the one nobody reads. If something _must_ be unpublishable, that belongs in the content type's schema.

### Who sees it

#### The editor

Opens an article — and in the entry's right panel sees “The author is not published”. They need not know that any rules exist. This is **the surface everything was built for**.

#### The owner of editorial policy

Opens the workspace's Alarms page: what has been flagged across the whole workspace, grouped by alarm, and the alarms themselves. They are also the one who creates them — by filtering the entry list.

#### The copilot

One reading tool, `admin_alarms_findings` — so that the question “what is wrong with this workspace's content?” becomes answerable at all. There is no writing through a tool.

### What Alarms is not

- **It is not validation.** Validation refuses; an alarm reports. There is no overlap between them by construction.
- **It is not a query language.** A condition can be expressed with exactly what the entry list can be filtered by — no more and no less. If the operator you need is missing, the thing to extend is the **filter engine** (`FilterOperator` in `@orthacms/utils-server` and `buildEntryFilterSurface` in content), not alarms.
- **It is not aggregates.** “Two products share a slug”, “a section has fewer than three articles” are a `GROUP BY`, not a predicate over one row. That would need a second kind of rule and a second evaluator. It is **out of scope**, not “planned”.
- **It is not notifications.** No emails and no webhooks. Outbound delivery is a separate feature on the existing outbox with its retries and dead letters, not a queue inside alarms.
- **It is not about media and not about users.** A rule's subject is only a content entry. The mechanism generalises, but a port for generalising is worth designing after a second subject appears, not before.
- **There is no muting of an individual finding here.** It shipped, lived for one release and was **withdrawn entirely** (the `0001_drop_finding_mute` migration) — see section 5.

## 02. The package group's composition

The `packages/alarms` group is **two** packages. There is no separate `domain` package and none is needed: the domain kernel here is so thin (three files of pure TypeScript) that it lives as a `domain/` layer inside the server package.

| Package | npm name                | Role                                                                                                                                                    | What it owns                                                                                                                                                           |
| ------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| server  | @orthacms/alarms-server | The NestJS plugin: two controllers, the rule lifecycle service, the evaluator, the outbox subscriber, the periodic sweep, the schema and the migrations | 2 tables, 9 routes, 1 copilot tool, the `__drizzle_migrations_alarms` migration journal                                                                                |
| admin   | @orthacms/alarms-admin  | The admin plugin: the alarms page, the alarm editor and contributions into six slots                                                                    | `/workspaces/:id/alarms*` (3 routes), the checks block in the entry panel, the “Checks” column, the “Save as alarm” button, the rendering of the copilot tool's result |

### The server package's layout

The package has been moved onto layers (`ADR-0003`): `domain / application / infrastructure / http`. The `domain/` layer imports neither `@nestjs/*` nor `drizzle-orm` nor `class-validator`.

| File                                      | What it does                                                                                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain/alarm-severity.ts                  | `info \| warn \| error`, their order, `severityRank`, the `isAlarmSeverity` guard                                                                                                            |
| domain/finding-state.ts                   | `open \| resolved` and the pure `nextFindingState(matches)` function                                                                                                                         |
| domain/filter-tree-segments.ts            | The first path segment of each leaf of a filter tree — what “this rule travels across a relation” is recognised by. Pure, covered by unit tests, with a walk-depth limit of `MAX_DEPTH = 16` |
| application/alarm-rules.service.ts        | A rule's lifecycle: validate the filter → save → recompute. `preview` and `resolveType` live here too                                                                                        |
| infrastructure/alarm-rule.repository.ts   | Storing rules, finding “the rules that travel into this type”, translating a unique-index violation into a `DuplicateAlarmRuleNameError`                                                     |
| infrastructure/alarm-finding.store.ts     | `reconcile` (an idempotent upsert + closing), and the reads for the list, the batch and the counters                                                                                         |
| infrastructure/alarm-evaluator.service.ts | The three evaluation paths, all through `EntryMatchQuery`                                                                                                                                    |
| infrastructure/entry-event.subscriber.ts  | Outbox events → evaluation; the reverse pass lives here too                                                                                                                                  |
| infrastructure/alarm-sweep.service.ts     | The periodic sweep on an ordinary `setInterval`                                                                                                                                              |
| copilot/alarms-tool.provider.ts           | Registering `admin_alarms_findings` with the shared tool registry                                                                                                                            |

> **Why there is no aggregate and no repository port**
>
> ADR-0003 says so outright: **a thin context gets mappers and projections**, not a domain model it does not need. A rule's only invariant is name uniqueness, and that is an index in the database; a finding's state machine is one pure function. Forcing an aggregate and a port in here would be a _violation_ of the ADR rather than compliance with it.

### What it depends on, and why registration order matters

- `@orthacms/content-server` — `EntryMatchQuery` (evaluating the filter), `WorkspaceGrantsQuery` (the workspace's grants), the type registry. **AlarmsPlugin registers after ContentPlugin.**
- `@orthacms/database` — the database client through `@InjectDatabase()` and the `OutboxDispatcher`, which the subscriber registers with at bootstrap. **After DatabasePlugin.**
- `@orthacms/identity-server` — `PermissionsGuard`, `RequirePermissions`, `OriginGuard`, the `PERMISSIONS` catalogue.
- `@orthacms/workspaces-server` — `WorkspaceGuard` and `@CurrentWorkspace()`.
- `@orthacms/tools-server` — the shared tool registry; injected `@Optional()`, so a deployment without the copilot and without MCP simply does not register the tool.
- `@orthacms/utils-server` — `FilterException`, `isUniqueViolation`.

In `apps/server/src/plugins.ts` the plugin is registered as `AlarmsPlugin()` — **with no arguments at all**. Both packages are in the application generator's `CORE_PACKAGES`, that is, they are installed into a generated application unconditionally.

## 03. Roles and permissions

There are exactly two permissions, and they are split along one axis: **“who may see a finding”** separately from **“who decides what the workspace considers wrong”**.

| Permission    | What it opens                                                                                                                                                            | admin | contributor | viewer |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ----------- | ------ |
| alarms:read   | The rule list with its counters, the alarms page, an entry's findings, the severity summary; the checks block in the entry editor; the “Checks” column; the copilot tool | ✓     | ✓           | ✓      |
| alarms:manage | Create, change and delete a rule; preview the matches; recompute by hand (“Check now”); the “Save as alarm” button in the list toolbar                                   | ✓     | —           | —      |

> **Why reading is granted to all three roles**
>
> Findings are rendered **right inside the entry editor**, and they are there precisely so that a contributor can do something about them. A role that edits entries must be able to see them — otherwise the surface everything was built for is empty for that role. The comment in `packages/identity/server/src/lib/rbac/system-roles.ts` puts it this way: “a rule is editorial policy, not an edit”.

### How a permission reaches the code

- **On the server:** both controllers carry `@UseGuards(PermissionsGuard, WorkspaceGuard)` on the class, and every method carries `@RequirePermissions(PERMISSIONS.ALARMS_READ)` or `ALARMS_MANAGE`. Permissions are constants, not string literals.
- **`OriginGuard` goes on the route, not on the class.** It sits on all five writing routes (including `preview`, formally a POST) and does **not** sit on the reads. Content's controllers are built the same way: those routes authenticate with a cookie and are therefore CSRF-able, while reads change no state.
- **The scope is the workspace.** `WorkspaceGuard` reads the `X-Workspace-Id` header and `@CurrentWorkspace()` hands it to the controller. No request can reach another workspace — the `workspaceId` is in the `where` of every repository and finding-store query.
- **In the admin UI:** `useHasPermission('alarms:read' | 'alarms:manage')`. All three query hooks (`useAlarmRules`, `useAlarmSummary`, `useFindingsByEntry`) take an `enabled` and are **disabled** without the permission — a member without `alarms:read` does not send a request the server would return a 403 to anyway. The navigation item carries `permission: 'alarms:read'` and is not rendered at all.
- **Buttons are hidden, not disabled.** “Save as alarm” without `alarms:manage` (or without a `?filter=` in the URL) is simply not rendered: an unlabelled disabled button is a worse answer than no button.

> **An API token will never reach in here**
>
> An external API token's `scopePermissions` grants `content:*` plus `media:read`/`media:create` — and that is all. `alarms:read` is **minted by no token scope**. That is exactly why the copilot tool is declared as `surfaces: ['copilot']`: offered over MCP it would appear in `tools/list` and be refused on every call — worse than being absent, because it would advertise a capability that does not exist.

## 04. Data model

The plugin owns **two** tables and carries its own migrations (`drizzle.config.ts` + committed `migrations/*.sql`, its own `__drizzle_migrations_alarms` journal, applied by the host through `nx run server:db:migrate`). The plugin opens no database connection — the client is injected from `@orthacms/database`.

| Table          | Purpose                            | Key fields and constraints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| alarm_rules    | A rule the workspace watches for   | `id` uuid PK · `workspace_id` uuid · `content_type` text · `name` · `finding_title` · `description` nullable · `severity` text · `filter` **jsonb** · `enabled` bool = true · `broken_reason` nullable · `last_scan_at` nullable · `created_by` uuid nullable · `created_at` · `updated_at`.<br> Indexes: a **unique** `(workspace_id, name)` — rule names are the workspace's vocabulary, and two “Missing cover”s would make every finding ambiguous; an ordinary `(workspace_id, content_type, enabled)` — the evaluator's hot path, “every enabled rule for this type”, run for each entry. |
| alarm_findings | One rule's verdict about one entry | **PK `(rule_id, entry_id)`** · `rule_id` → `alarm_rules.id` **ON DELETE CASCADE** · `entry_id` uuid · `workspace_id` uuid · `content_type` text · `state` text · `detail` jsonb nullable · `first_seen_at` · `last_seen_at` · `resolved_at` nullable.<br> Indexes: `(workspace_id, state, rule_id)` — the alarms page; `(entry_id, state)` — the widget in the entry editor and the list's column, which ask “what is open on these entries” and never care about what is closed.                                                                                                               |

> **The primary key is the whole idempotency**
>
> Delivery from the outbox is **at-least-once**, which means the evaluator may be handed the same `entry.updated` twice. An upsert on `(rule_id, entry_id)` makes the second pass a no-op rather than a duplicate row. It is also what makes the state machine work: `first_seen_at` is written **only on insert** and never updated, so “this has been hanging around for three months” survives both a finding's closing and its reopening.

### What the schema deliberately lacks

- **An FK to the workspace.** The `workspaces` table belongs to another plugin, and this codebase does not scope rows with cross-plugin foreign keys.
- **An FK to the entry.** Entries live in host-generated `content_<name>` tables, one per type — there is simply nothing to point at. Integrity is maintained by the subscribers to `entry.deleted` / `entry.purged`.
- **An FK to the rule's author.** `created_by` is a uuid with no reference, like `activity_events.actor_id`: a rule must survive the deletion of whoever wrote it.
- **An enum for `severity` and `state`.** Both are stored as `text`, so that adding a severity level is not a migration. The price is having to coerce an unknown value: `coerceSeverity` and `severityLook` fall back to `warn`. Throwing would mean bringing down the whole alarms page because of one crooked string.

### The two migrations

| Migration                  | What it does                                                                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0000_init_alarms.sql       | Creates both tables, four indexes and the cascading FK. Note: in the original version `alarm_findings` carried three more columns — `muted_at`, `muted_by`, `muted_reason` |
| 0001_drop_finding_mute.sql | The withdrawal of muting. **First** an `UPDATE … SET state='open' WHERE state='muted'`, and only **then** the three `DROP COLUMN`s                                         |

> **Why the order inside 0001 is load-bearing**
>
> After the columns were dropped there would be nothing left to identify the formerly muted rows by. Left in a `muted` state no code knows any more, they would fall into a fork: any `state = 'open'` count **excludes** them and the list's `state <> 'resolved'` predicate **includes** them. The workspace's badge and its own list would disagree. Normalising to `open` is the honest outcome of withdrawing a feature: the alarm says what it thinks again.

## 05. A finding's lifecycle

**no row** — the entry started matching → **open** ⇄ stopped / started again ⇄ **resolved**

| State    | What it means                                             | Visible in the UI?                            | What happens to the history                                                |
| -------- | --------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| open     | The entry matches the rule's condition right now          | Yes — everywhere                              | `first_seen_at` is the moment of the first insert and never changes again  |
| resolved | It stopped matching (or the entry was moved to the trash) | No — only under an explicit `?state=resolved` | The row is kept along with its `first_seen_at`; `resolved_at` is filled in |

Why this is a state machine rather than “delete the row when it stops matching”: `resolved` keeps the `first_seen_at`, so an entry that starts matching again is **the very same finding with its history intact** rather than a fresh one that looks as though it appeared today. The transition is computed by one pure function, `nextFindingState(matches)`, and it is the only place that rule lives: its value is written into the upsert's `ON CONFLICT` clause, where a mistake would be silent data corruption rather than a failed query.

#### How an event's source affects the state

| Event                                    | What happens to the entry's findings                                                                       | Why exactly that                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| entry.created / updated                  | Re-evaluation against every active rule for the type; opening or closing                                   | The ordinary path                                                                                        |
| entry.published / unpublished / restored | The same + a **reverse pass** over the entries that reference this one                                     | Publishing an author changes the meaning of the articles, not of the author                              |
| entry.deleted                            | `resolveForEntry` — **closes** every finding on the entry, whichever rule raised it. Plus the reverse pass | A soft delete is reversible, and the history must come back with the entry. The rows must not be deleted |
| entry.purged                             | `deleteForEntry` — **physically deletes** every finding on the entry and stops there                       | The row in the content table is gone: a finding has nothing to point at and nothing to restore           |

> **Muting a finding: it existed, it was withdrawn, and no traces were left**
>
> A third state, `muted`, with the `muted_at` / `muted_by` / `muted_reason` fields and two routes, existed for one release. The argument for withdrawing it: **an alarm is either right about an entry or wrong about it**; muting entries one by one is a way of living with a bad condition instead of narrowing or turning off the alarm itself, where the next person will see that decision. The withdrawal was done **completely** — the state, the columns, both routes, the counters and the copilot projection — because a half-removed feature is worse than either of the two states. Its absence is pinned down by tests: `apps/server-e2e/.../alarm-findings.spec.ts` — “has no mute route left to call”; `apps/admin-e2e/src/alarms/alarms.spec.ts` — the “Muting → is offered nowhere” block, which checks that there is neither a button nor a tab.

#### A rule's lifecycle

| Flag                 | Meaning                                                                                               | The consequence for evaluation                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| enabled = true       | The rule is running                                                                                   | It takes part in all three paths                                                                                                          |
| enabled = false      | Switched off by hand                                                                                  | **Excluded** from `activeForType`, `allActive` and the reverse pass. Findings already open are **kept** and go on being shown             |
| broken_reason ≠ null | The stored filter tree has stopped parsing against its type (a field was renamed, a relation removed) | Excluded from those same three selections (a `broken_reason is null` in the `where`), but **shown in the interface** as needing attention |

Silently never matching is the worst thing a correctness tool can do: it looks exactly like “everything is fine”. So a broken rule is not merely skipped — it announces itself: a red `Alert` on the rule's card and on the editor page, carrying the filter engine's own error text.

> **The way back out of “broken” is only through editing the filter**
>
> `markBroken` is called from `safeMatch` on a `FilterException`. The flag is cleared by **one means only**: a `PATCH` with a `filter` key — the repository nulls `brokenReason` in the same `UPDATE` (“a filter that has just passed validation is by definition no longer broken”). A successful `rescan` does **not** clear the flag. So if the content type is fixed back (the field returns), the rule will not revive on its own — it has to be opened and its condition saved again.

## 06. Scenarios — how it works step by step

### 6.1 How an alarm is really born: “Save as alarm” in the list toolbar

This is the feature's main entry point, and it is designed around the sequence a person actually goes through: something looks wrong → they filter the entry list → they see fourteen entries and confirm it with their own eyes → they ask the CMS to keep watching. By the third step the condition is **already built and already checked against the rows they saw**.

1. **The person filters the entry list.** The ordinary Content Library query builder. The condition goes into the URL as `?filter=<JSON>` and the table beneath it redraws — the obvious consequence that makes the condition a checked one.
2. **A “Save as alarm” button appears in the toolbar.** It is rendered only when **two** conditions hold: the `alarms:manage` permission, and a non-empty `?filter=` in the URL. Both cases **hide** the button rather than disabling it.
   _SaveFilterAsRuleAction, a contribution into RECORDS_TOOLBAR_SLOT_
3. **The filter is read straight from the query string** through `useSearchParams` rather than from `RecordsToolbarContext.params`. The reason: the context carries only the keys an element has **declared as its own**, and `?filter=` belongs to content's own filter control. Declaring it as its own would mean its value travelling into the list request twice.
4. **The dialog asks for two strings and a severity.** The condition is **neither shown nor editable** in the dialog: it was built in the list the person is looking at right now, and presenting it again would invite them to re-check work they just did.
   _the two strings are not duplication, see the note below_
5. **While the person types, the dialog counts the matches.** `POST /alarms/rules/preview` returns `{ matched, total, sampleIds }`. The denominator is the half that turns a number into a judgement: “14” means nothing, “14 of 312” means the rule is roughly right, and “298 of 312” means it is inverted.
6. **Submission.** `POST /alarms/rules` with `{ contentType, name, findingTitle, severity, filter }`. The dialog hands over the filter **verbatim** — the same object that was in the URL.
7. **The server scans the collection without waiting for events, and only then answers.** The response carries both the rule and the first scan's result, so the toast says “saved, 14 entries flagged” rather than “saved” with an invitation to go and look.

> **The two strings that look like duplication**
>
> **The alarm's name** is what it is called in the list, in the language of editorial policy: “Relations point at published records”. **“What editors will see”** (`finding_title`) is the sentence that will appear next to one article: “The author is not published”. Collapse them and you get either a list made of instructions, or an editor being told about their text that “relations point at published records”.

> **The mine this button dug up**
>
> The query builder had a relative operator, `within_last`, which resolved into **a concrete cut-off date in the browser** at serialisation time. For a URL that is right: a shared “in the last 7 days” link must show the same rows the sender saw. For a **saved** filter it is a silent bug: a “not updated in 90 days” rule written today would mean “not updated since 24 August” forever, and would look perfectly normal doing so. So `within_last` became a real server-side operator (`col >= now() - make_interval(...)`, resolved by Postgres at query time), and `treeToJsonFilter` gained a `relativeDates` option. **The consequence to know:** an alarm saved from the list toolbar inherits the already-frozen date from the URL — a URL cannot say which of the two the person meant. Making the window sliding is a one-line edit in the alarm editor.

### 6.2 Creating from scratch, from the alarms page

The second path, added **at a user's request, reversing a documented decision**. The original reasoning has not gone anywhere, though.

1. **A “New alarm” button** in the alarms page's header, only with `alarms:manage` → the `alarms/rules/new` route, the same `AlarmRuleEditorPage` with a `mode="create"` prop.
   _one component for both modes: the forms are literally identical and differ only in one <Select>_
2. **First comes “what are we watching”.** A select of collections (`kind === 'collection'` only). Until a type is chosen, the condition builder is replaced by the phrase “Choose a collection above to set conditions”, and the “Edit conditions” button is disabled. Changing the type **clears the condition tree**: it belonged to the old type's fields.
3. **The conditions are built by the same query builder**, over the same `/content-schema/:name/filter-fields` surface.
4. **The live match counter is what makes this path acceptable.** An empty condition form invites writing an alarm against a collection nobody has looked into — and that is how you get a rule matching everything. The form leans on the counter: at `matched === total > 0` it says outright “these are all the collection's entries — the condition is probably inverted”. **If that counter degrades, the form turns into precisely the footgun the decision was about.**
5. **Saving** is the same `POST /alarms/rules`, the same immediate scan, a toast with the flagged count, and a return to the list.

### 6.3 Editing an alarm: Apply changes the chips, Save re-checks the collection

In the entry list, Apply has an obvious consequence — the table beneath it re-runs. In the alarm editor there is no table, so committing a condition changed nothing visible and Apply read as a dead button. Both halves of the cure are on screen at rest rather than behind another click.

1. **The form is seeded once, by `rule.id`.** The effect depends on the identifier and **not on the rule object**: otherwise a background TanStack Query refetch would re-seed the form with the server's copy and throw away edits in progress.
2. **The content type is neither shown nor changeable.** `UpdateAlarmRuleDto` contains no `contentType` at all. Changing the type would not edit the alarm — it would silently re-point every finding it has open at a different collection.
3. **The committed conditions are visible as chips** (`QueryBuilderSummary`) at rest. Press Apply and the chips change: the edit has visibly moved from the builder into the alarm. Removing a chip commits the change immediately, as in the list toolbar.
4. **The builder panel closes after Apply** (unlike in the list, where it stays open) — otherwise it would be covering the one thing that changed. Focus returns to the toggle button through a `requestAnimationFrame`: a collapsed region becomes `inert`, and focus inside it would fall through to `<body>`, with the next Tab restarting the traversal from the top of the document.
5. **The match counter recomputes itself** as soon as the conditions change. It used to sit behind a “Count matches” button — the only number that says whether a rule means what its author thinks was available only to someone who knew to ask for it. The effect is keyed on the **serialised filter through a ref** rather than on `preview.mutate`: a mutation's identity changes every render, and depending on it produced one collection scan per keystroke in the name field.
6. **The “conditions changed” notice** fires whenever the on-screen conditions diverge from the saved ones — **including when they have all been cleared** (the old `filterKey !== null` check treated that as “nothing to report”). It is rendered only when there is something to save: the empty state and a disabled Save have more specific words of their own.
7. **Save always sends the filter.** The key used to be omitted when the condition was empty, and the API reads a missing key as “leave it as it was” — that is, clearing every condition and pressing Save silently kept the old one. Now saving with no conditions is simply forbidden (Save is disabled): an alarm with no condition flags every entry in the collection.
8. **On receiving a new filter, the server recomputes _before_ answering.** Otherwise the findings table would go on describing the **previous** condition — and doing so with complete confidence.
   _AlarmRulesService.update: assertParses → repository.update → evaluator.rescan, and only then viewOf_

> **A subtlety: recomputation on an edit happens only for an enabled rule**
>
> `update` calls `rescan` on the condition `dto.filter !== undefined && updated.enabled`. `create` has no such check — a new rule is **always** scanned, even one created with `enabled: false`. The asymmetry is immaterial in practice (the interface does not let you create a disabled alarm), but it is worth knowing when working with the API directly.

### 6.4 The editor's condition — the list's full field surface, not half of it

This was a genuine bug, and it explains the least trivial piece of code in the package. The entry list offers **server-side** filter paths **plus** whatever plugins contribute through `RECORDS_FILTER_FIELDS_SLOT` — for instance i18n's `localeCount` / `hasLocale` / `missingLocale`, computed by that plugin's own subqueries. An alarm saved from such a list can carry either kind.

1. **Reading only `useFilterFields` was not enough.** A locale condition came back as “This field is no longer available — pick another one”, after which the Apply gate refused **any** edit to that alarm: it rejects every rule whose field it cannot resolve.
2. **`useFields` is a hook.** So it is called **unconditionally**, with a module-level `NO_SCHEMA` placeholder constant until the real schema loads. A conditional call on `schema.data` changed the number of hooks between renders and **dropped the page into the error boundary** — React counts hooks, not intentions, and the failure there is total rather than “the field list is incomplete”.
3. **The loading state travels with the fields.** An empty surface, one still loading and one that failed are three different facts. The panel receives `fieldsPending`, `fieldsError` and `onRetryFields`; and `schema.isPending` is mixed in **only when a type has been chosen at all** — a disabled query reports `isPending` forever, and the builder would claim to be loading on a page where nothing was requested.
4. **The related-entry picker is passed separately.** The query builder deliberately has no data layer of its own, so `renderRelationValue={RelationValuePicker}` must come from whoever mounts it. The list did that and the editor did not; which is why picking a related entry worked in the table and not here.

### 6.5 The event path: an entry changed

The cheapest of the three paths and the only one that runs on every entry. The `EntryEventSubscriber` registers with the `OutboxDispatcher` on `onApplicationBootstrap` — exactly like the activity log's subscriber.

1. **An event arrives from the outbox.** The permitted kinds: `entry.created`, `updated`, `published`, `unpublished`, `deleted`, `restored`, `purged`. The content type is read from `payload.contentType`; without it the handler exits silently.
2. **The special cases are dealt with before anything else.** `entry.purged` → `deleteForEntry` and exit. `entry.deleted` → `resolveForEntry`, then the reverse pass, and exit.
3. **The entry's workspace is determined.** `matches.workspaceOf(type, entryId)` reads it **from the entry's own table**. If the row vanished between the commit and the delivery — exit with no error: there is nothing to evaluate, and a deletion or purge event is already queued.
4. **The active rules for that type are fetched.** One indexed query on `(workspace_id, content_type, enabled)` with an additional `broken_reason is null`.
5. **Each rule is checked pointwise against the one entry.** `matchingIds(type, rule.filter, workspaceId, { entryIds: [entryId] })` — the same evaluation the list does, but explicitly narrowed to one row.
6. **The result is reconciled.** `reconcile(rule, examined=[entryId], matched)`: on a match, an upsert into `open`; on no match, an `UPDATE … state='resolved'` conditioned on `state <> 'resolved'`. Entries **outside** `examined` are not touched at all — otherwise a pass over three rows would wipe the rule's other findings.

> **A failure here is not a failure of the write that caused it**
>
> The event committed together with the entry, so the outbox will retry it with backoff and the findings simply lag. The “Check now” button is the manual recovery for a rule whose event eventually ended up parked.

### 6.6 The reverse pass: findings close themselves

The least obvious row in the path table — and the reason findings can close at all. “This published article references a draft author” is a fact about the **article**, while the event that fixes it arrives about the **author**.

1. **The pass runs on five event kinds only:** `published`, `unpublished`, `deleted`, `restored`, `purged`. Those are exactly the ones after which the _meaning_ of the entries referencing the changed one shifts, while they themselves have not changed.
2. **Candidate rules are found.** `byTraversedType` takes the workspace's enabled, unbroken rules and, for each, compares `filterTreeSegments(rule.filter)` (each leaf's first path segment) against its type's relation map. If a segment matched whose relation points at the changed type, the rule is a candidate — and we know the **relation field's name**.
   _the matching happens in TypeScript rather than in SQL: jsonb containment cannot express “any leaf whose field starts with this segment” without an index this table does not want_
3. **The related entries are gathered.** The filter `{ and: [{ field: '<relation>.id', op: 'eq', value: changedEntryId }] }` — **a tree we can compose**, not a string that would have to be re-parsed. Bounded by `maxDependentsPerEvent`.
4. **The entries the rule currently flags are added.** `liveEntryIds(rule.id)`, likewise capped at `maxDependentsPerEvent`: a rule with thousands of open findings must not turn one publish into a full reconciliation. The remainder is picked up by the next recompute or sweep.
5. **The union is checked against the rule's original filter and reconciled.** In one pass: an entry that started matching opens a finding, and one that stopped closes it.
6. **A failure of the reverse pass does not bring down the main reconciliation.** It is caught, logged as a `warn`, and does not make the dispatcher retry the whole event: the price is a stale finding until the next sweep.

### 6.7 A full recompute of one rule (rescan)

The only place the plugin touches a whole collection — hence the only one that needs a ceiling. It is called from three places: on rule creation, on a filter edit, and by hand from the “Check now” / “Re-check” button.

1. **It is checked whether the type is registered.** If not, the rule is marked broken (“Content type "…" is not registered.”) and a zero result is returned.
2. **The collection is enumerated page by page** at `scanBatchSize` entries, up to `maxScanEntries`. The enumeration goes through **the same** `matchingIds` with an **empty tree**, `{}` — “no predicate”. One code path, one notion of “which rows exist”.
3. **Each page is checked against the rule's filter** through `safeMatch`. If parsing the filter failed, the rule is marked broken and the function returns a **partial** result rather than declaring “nothing matched”.
4. **If the ceiling is reached, a warning goes into the log.** Silently reporting a clean scan of a truncated set is the worst thing a correctness tool can do.
5. **The entries the rule flags that the scan window did not see are added to the examined set** — entries in the trash or beyond the ceiling. **Adding them to `examined` without adding them to `matched` is exactly what closes them.** Without that, such a finding would hang open forever.
6. **Reconciliation and the `last_scan_at` stamp.**
7. **The response says what actually happened:** `{ ruleId, scanned, opened, resolved, open }`. The toast puts that into words — “checked 312, flagged 14, cleared 3” — because “done” answers no question at all.
   _scanned counts only the entries in the scan window, without the ones added “from outside” it_

> **Why opened deliberately undercounts**
>
> New means rows whose `first_seen_at === now`, that is, genuine inserts. A finding that was closed and then reopened is identified by its `resolved_at` being nulled, which a `RETURNING` cannot see. This is a choice in favour of **undercounting reopenings** rather than recounting steady state: “14 new” with 14 long-standing ones would be a lie, whereas “0 new” with one reopened is merely modest.

### 6.8 The periodic sweep

It exists for a whole class of rules that events cannot cover in principle.

1. **Why it is needed at all.** “Published and not updated in 90 days”, “a draft has sat for a month” — such rules describe an entry precisely because **nobody is touching it**. No `entry.updated` about it will ever arrive, and without a periodic pass the rule would only fire on rows edited for other reasons.
2. **Why an interval rather than a scheduler.** There is no scheduler in the repository, and introducing one for a single timer means a dependency and a deployment concern. The precedent is `OutboxDispatcher`: an ordinary `setInterval` in the process, with the work behind it made idempotent, so several API processes merely mean the sweep happens more often than configured.
3. **The first sweep is deliberately deferred by one interval.** Startup is the worst moment to be scanning collections, and nothing becomes more stale in the minute after a boot than it was in the minute before.
4. **The timer is `unref()`ed** — the process is not held open for a background recompute.
5. **The rules are swept sequentially.** A scan reads whole collections; twenty at once would turn background hygiene into the heaviest thing the database does. Parallel callers **coalesce onto the sweep already running** (`if (this.running) return this.running`) rather than starting a second one.
6. **One rule's failure does not end the sweep** — it is logged, the other rules are unrelated to it, and their findings must not silently stop updating.
7. **Shutdown waits for the running sweep.** Waiting matters even with idempotent work: a scan interrupted mid-rule has reconciled some of its batches and not the rest, and its findings describe neither the old state nor the new one until something runs again.

> **The sweep is per process, not per deployment**
>
> That is an honest trade-off rather than a free lunch. The sweep is **no good for anything that must happen exactly once**. `sweepIntervalMinutes: 0` turns it off entirely — and that is a real choice, which is why the configuration validation rejects only a negative value and lets zero through.

### 6.9 What happens where the three sources overlap

The three paths differ **only in which rows are examined**. All three end in the same `EntryMatchQuery` and the same `reconcile`.

| Source                                                           | Examines                                                                                   | What happens on an overlap                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **A lifecycle event**<br>from the outbox, at-least-once          | One entry against every active rule for its type (+ dependent entries on five event kinds) | A repeat delivery of the same event is a **no-op**: the upsert on `(rule_id, entry_id)` updates `last_seen_at` and nothing else         |
| **An explicit recompute**<br>create / update-filter / the button | A whole collection against **one** rule (up to the ceiling) + the entries that rule flags  | A recompute and a single-entry event write to the same row. Whoever is later wins; both evaluate one predicate, so they cannot disagree |
| **The periodic sweep**<br>an in-process interval                 | Every active rule across every workspace, in turn, through the same `rescan`               | Several processes = several sweeps = simply more often. A second sweep in one process coalesces onto the first                          |

The key to overlaps being safe is **the boundedness of `examined`**. Reconciliation touches only the entries a pass actually examined. So a one-row event pass cannot wipe findings just opened by a full scan, and a full scan cannot “roll back” a verdict about an entry that changed during it: the next event about that entry will arrive and rewrite the row.

The only aspect that is not idempotent in its numbers is the **counters in a scan's report** (`opened` / `resolved`). They describe a particular pass rather than a state, and when two passes overlap the sum of their reports need not match the final `open`. That final `open`, meanwhile, is read by a separate query after reconciliation and is always exact.

### 6.10 Deleting a rule, an entry and a workspace

| What is deleted                                 | What happens to the findings                                                     | The mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A rule** (`DELETE /alarms/rules/:id`)         | All its findings physically disappear                                            | The `alarm_findings.rule_id` FK with `ON DELETE CASCADE`. The logic: with the rule gone there is **nothing to interpret them with** — a finding's title, its severity and the alarm's name live in the rule's row, not in the finding's. The confirmation dialog says so outright: “"{name}" and everything it flagged will be deleted. The entries themselves are untouched”                                                                                                                                                                                                                                                                                                                    |
| **An entry — into the trash** (`entry.deleted`) | The findings are **closed** (`resolved`), not deleted                            | `resolveForEntry`. Restoring must bring the history back with the entry, and `first_seen_at` is that history. Plus the reverse pass: whatever referenced it may have changed meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **An entry — restored** (`entry.restored`)      | It is re-evaluated; matching findings reopen with their original `first_seen_at` | The ordinary event path + the reverse pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **An entry — purged for good** (`entry.purged`) | The findings are **deleted** physically                                          | `deleteForEntry`. The row in the content table is gone: there is nothing to point at and nothing to restore. This is the one case where deleting the row is right                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **A workspace**                                 | Its `alarm_findings` rows are deleted, then its `alarm_rules` rows               | `AlarmsWorkspacePurger` (`infrastructure/purge/`), registered with `workspaces-server`'s `WorkspacePurgeRegistry` from `onModuleInit`. Neither table carries an FK to `workspaces`, so nothing else would remove them — and an orphaned rule is **not inert**: the sweep reads `allActive()` without asking whether the workspace still exists, so it would be re-evaluated on every pass, forever, while being unreachable from an editor that no longer opens. The findings are deleted explicitly rather than left to the `rule_id` cascade, because the cascade removes them without counting them, and “removed 12 rules” reads very differently from “removed 12 rules and 4 000 findings” |

### 6.11 What an editor sees on opening an entry

1. **The widget is mounted into `ENTRY_SIDEBAR_WIDGET_SLOT`** at order 40 — below the built-in “Details” and publishing blocks. A finding is context about an entry, not the first thing needed on opening it.
2. **An entry being created is skipped.** It has no id yet — there is nothing to find, and no request is made at all.
3. **One batch request:** `GET /alarms/findings/by-entry?entryIds=<id>`. The same hook the list's column uses — which is why the entries page sends one request rather than one per row.
4. **Three states are distinguishable.** Loading → a spinner. Error → “Checks could not be loaded, so this record has not been checked”. Empty → “No alarm flags this record”. **An error must not be rendered as emptiness**: “nothing flagged” and “we could not check” look the same, but only the first is reassuring.
5. **Each finding is a severity icon + the finding's title + the alarm's name** in small type. The alarm's name is there so that an editor who wants to understand _why_ this is being asked of them knows where to start.
6. **The widget draws no frame of its own** — it uses `EntrySidebarSection`. A separate card would be the only floating box in a flat panel.

### 6.12 The copilot reads the findings

1. **There is one tool and it is read-only:** `admin_alarms_findings`, `readOnly: true`, `effect: 'read'`, `requires: ['alarms:read']`, `surfaces: ['copilot']`. It registers with the shared registry from `onModuleInit` through an `@Optional()`-injected `ToolRegistry`.
2. **It goes into the same `AlarmFindingStore`** the HTTP routes do, and the scope is the `ToolContext.workspaceId` resolved before dispatch. A call physically cannot read another workspace.
3. **The page and its severity breakdown are two reads of one predicate.** `severityCounts` shares its `where` builder with `list`, so the bar at the top cannot describe a different set from the list beneath it. It is a breakdown of **the whole set** rather than of the page: a selection describing itself as the workspace is precisely the kind of confident wrongness a model then repeats as fact.
4. **The projection is deliberately narrow.** `findings-tool-output.ts` (pure, covered by unit tests) drops the `detail` — an opaque jsonb bag whose shape belongs to whoever wrote the rule — and both raw timestamps in favour of `openForDays`. Days are rounded **down**: a four-hour-old finding is “0 days”, that is, “today”; rounding up would age everything by half a day, and the model would state that as a fact.
5. **The list is called `items` for a reason:** the run engine's shape-oriented `summarizeToolOutput` reads `{ items, total }` as “14 results” with no alarms-specific code at all.
6. **The result is rendered rather than left as JSON.** The admin UI contributes a `FindingsToolResult` into `COPILOT_TOOL_RESULT_SLOT` — rows with links. Most tool results are an answer's provenance; here a list of flagged entries **is** the answer, and every row has somewhere to lead.
7. **`readToolFindings` returns `null` rather than throwing.** A transcript is replayed from stored history, and a result written by an older build of the tool will reach today's renderer. Any unrecognised shape falls through to the raw payload, which `ToolStep` can display anyway: a JSON blob is incomparably better than a crashed conversation. A row with an unknown severity is **discarded** rather than drawn under someone else's; the header's count comes from `bySeverity`, so the total stays honest.
8. **The one thing found nowhere else in the product is a finding's age.** The alarms page shows a date, the entry panel shows nothing, and neither answers the question a person actually has when handed a list of problems: _which of these has been rotting the longest_. `FindingAgeBar` draws a bar scaled to the oldest finding in that same result (with a 4% floor, so that a fresh finding reads as a row rather than as its absence), with the number in text beside it: **the number is the data and the bar is only a comparison**, so a screen reader, forced colours or a printout lose the ranking at a glance and nothing else.
9. **There is no writing tool.** Creating an alarm is defensible as a `propose` tool, but only once the proposal can carry a live preview (“matches 14 of 312”): a JSON filter tree on a card is not something a reviewer can meaningfully approve.

## 07. HTTP API

Every path carries the global `/api` prefix the host sets, and all of them sit under `WorkspaceGuard` (the `X-Workspace-Id` header). Access legend: `permission` — a session and the named permission are required; `workspace` — plus membership of the workspace. **There is not a single public route here.**

| Method and path               | Access and guards                       | Input                                                                                              | Success                                                                                                                         | Failures                                                                                                                                                         |
| ----------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET /alarms/rules             | `alarms:read` `workspace`               | —                                                                                                  | `AlarmRuleView[]` — each rule with a live `openCount`, sorted by `name`                                                         | `401` / `403`                                                                                                                                                    |
| POST /alarms/rules            | `alarms:manage` `workspace` OriginGuard | `{ contentType, name, findingTitle, description?, severity, filter, enabled? }`                    | `201 { rule, scan }` — **after** a full scan of the collection                                                                  | `400` the filter does not parse (the engine's message); `404` an unknown **or** ungranted type; `409` the name is taken in the workspace; `403` a foreign Origin |
| POST /alarms/rules/preview    | `alarms:manage` `workspace` OriginGuard | `{ contentType, filter }`                                                                          | `200 { matched, total, sampleIds }` — `sampleIds` is at most 5                                                                  | `400`; `404`; `403`                                                                                                                                              |
| PATCH /alarms/rules/:id       | `alarms:manage` `workspace` OriginGuard | `{ name?, findingTitle?, description?, severity?, filter?, enabled? }` — **with no `contentType`** | `200 AlarmRuleView`. Changing the `filter` validates it, clears `brokenReason` and **triggers a recompute before the response** | `400`; `404` no such rule, or the type is not granted; `409`; `403`; an invalid uuid → `400` from `ParseUUIDPipe`                                                |
| DELETE /alarms/rules/:id      | `alarms:manage` `workspace` OriginGuard | —                                                                                                  | `204`, the findings leave by cascade                                                                                            | `404`; `403`                                                                                                                                                     |
| POST /alarms/rules/:id/rescan | `alarms:manage` `workspace` OriginGuard | —                                                                                                  | `200 { ruleId, scanned, opened, resolved, open }`                                                                               | `404`; `403`                                                                                                                                                     |
| GET /alarms/findings          | `alarms:read` `workspace`               | `?state=` `?ruleId=` `?severity=` `?page=` `?pageSize=`                                            | `{ items, total, page, pageSize }`, sorted by `last_seen_at DESC, entry_id`                                                     | `400` an invalid DTO; `401` / `403`                                                                                                                              |
| GET /alarms/findings/by-entry | `alarms:read` `workspace`               | `?entryIds=` — **comma-separated**, at most 100                                                    | `{ byEntry: { [entryId]: AlarmFindingView[] } }`, unresolved only                                                               | `400` more than 100 ids, or a non-uuid among them                                                                                                                |
| GET /alarms/findings/summary  | `alarms:read` `workspace`               | —                                                                                                  | `{ open: { error, warn, info }, openTotal }`                                                                                    | `401` / `403`                                                                                                                                                    |

### Decisions baked into the contract

- **An unknown type and an ungranted type answer identically.** One `UnknownAlarmContentTypeError`, one message, one `404`. This is content's own rule (`resolveGrantedType`): a rule editor that distinguished them would reopen a channel for enumerating a deployment's content model.
- **`filter` is declared as `@IsObject()`, and rightly so.** The authority on “is the tree valid” is `parseFilterTree` against the named type — the same parser the list uses. Restating its grammar with decorators would create a second, weaker copy that diverges from the first at the very first new operator.
- **A `FilterException` becomes a `400` with the engine's message.** The caller is a rule editor, and “unknown field author.statuss” is the whole answer needed.
- **Route order in the module.** The findings controller declares the literal `by-entry` and `summary` segments and lives under a different prefix from the rules controller — there is nothing to shadow them. They are still registered findings-first, following content's example, where `bulk` comes ahead of `:id`.
- **A double latch on `pageSize`.** The DTO bounds it with `@Max(100)`, and the controller clamps it **again** with `Math.min(MAX_PAGE_SIZE, …)`. The validator is defence in depth, not the boundary.
- **A list with no `?state=` excludes `resolved` rather than showing everything.** What is closed is history, available only on explicit request.
- **`entryIds` is comma-separated rather than a repeated parameter.** The string travels in a URL that a TanStack Query key is built from, and one stable string keys better than an array with a floating order.
- **The batch limit is 100, the size of one list page.** Asking for more than a page means making the endpoint do what it was not built for.

<details>
<summary>The lengths and ceilings baked into `alarms.constants.ts`</summary>

- `DEFAULT_PAGE_SIZE = 25`, `MAX_PAGE_SIZE = 100`
- `NAME_MAX_LENGTH = 120` — a rule's name and a finding's title
- `TEXT_MAX_LENGTH = 500` — a rule's description
- `FILTER_MAX_LENGTH = 8192` — a coarse first latch on the JSON tree, **before** the filter engine's own node and depth limits (the same layering as in `activity.constants.ts`). Declared but not applied in the DTO — see section 14
- `MAX_BATCH_ENTRY_IDS = 100`, `PREVIEW_SAMPLE_SIZE = 5`
- `WRITE_CHUNK = 500` in the finding store — **not a tuning knob but a correctness boundary**: Postgres accepts at most 65535 bind parameters per query, and at eight columns per row that caps a single insert at about 8000 findings, past which the driver fails the whole reconciliation. Five hundred leaves an order of magnitude of headroom and keeps the queries short enough for a slow one to stay interruptible

</details>

## 08. The admin UI: screens, slots, states

### Six slots, three routes

| Slot                      | Contribution                                                                             | For whom                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| ENTRY_SIDEBAR_WIDGET_SLOT | `EntryAlarmsWidget` — the “Checks” block in the entry panel, order 40                    | **The editor, on the page where it gets fixed.** The surface everything exists for |
| RECORDS_COLUMN_SLOT       | The “Checks” column (`AlarmsColumnCell`), `appliesTo: () => true`                        | Whoever is browsing a collection. **Off by default**                               |
| RECORDS_TOOLBAR_SLOT      | `SaveFilterAsRuleAction` — “Save as alarm”                                               | Whoever has just filtered the list and wants it watched                            |
| WORKSPACE_ROUTE_SLOT      | 3 routes: `alarms` (60), `alarms/rules/new` (61), `alarms/rules/:ruleId` (62) — all lazy | The owner of editorial policy                                                      |
| WORKSPACE_NAV_SLOT        | The “Alarms” item, the `BellRing` icon, order 40, `permission: 'alarms:read'`            | Everyone with read access                                                          |
| COPILOT_TOOL_RESULT_SLOT  | A `FindingsToolResult` for `admin_alarms_findings`                                       | Whoever asked the copilot                                                          |

The first three are Content Library's slots, and **not one of them required a single line of change in `content-admin`**. The same inversion principle applies to the copilot: the copilot package learns nothing about alarms. The `alarms` route has order 60 — noticeably later than content: landing in a workspace, a person should arrive in the library rather than in a list of problems.

> **The user-facing noun is “alarm”, the code's noun is “rule”**
>
> Every string a person reads says “alarm”: “Save as alarm”, “New alarm”, “Delete this alarm?”, and the third tab is “Alarms”. The **identifiers** — of messages, types, components, cache keys and the `/alarms/rules` API paths — keep `rule`. The split came from a bug report: “rule” is coherent inside a page headed Alarms and means nothing in the entry list's toolbar, where the button sits next to “Filters” and the column picker. The one place `rule` survives in the copy is the name of a message _placeholder_ (`{rule} · {contentType}`), which nobody reads.

### The alarms page: two tabs

- **Flagged** — what has been flagged, **grouped by alarm**, with the open count in the tab's badge (from `summary`).
- **Alarms** — rule cards with a count, the last-checked date and three actions: “Check now”, “Edit”, “Delete”. A disabled rule is marked “Off”; a broken one carries a red `Alert` with the error's text.

#### Why the findings are grouped rather than listed flat

A workspace with a thousand flagged entries produced forty pages of rows in which nothing said which alarm was responsible, and every row repeated the same sentence. The page's own documentation claimed grouping “because that is how this gets fixed” from the very first commit; the code did not do it.

- **The groups come from the alarms, not from a page of findings.** Each rule already carries its `openCount`, so both the group list and the number on each heading are exact without reading a single finding. Grouping a _page_ of findings on the client would produce headings describing the twenty-five rows that came back — “3 entries” over a pile of ninety.
- **A group's entries load when it is expanded.** A workspace with twenty alarms would otherwise fire twenty requests to draw a screen on which nineteen are closed.
- **Each group paginates itself**, ten at a time, and **clamps its page to `pageCount`**: a page past the end leaves the reader on an empty list with the pager hidden.
- **The order is louder first, then larger.** `error` first, and within a level, by descending count.
- **Only alarms that have something are drawn.** An alarm at zero is a row that exists to say nothing; its place is on the Alarms tab.
- **One group is expanded on arrival; with more than one, all are closed**, and the page reads as a summary you drill into. “N entries flagged” on an alarm's card no longer _filters_ the list: it expands that alarm's group while leaving the others visible — strictly more information for the same click.

> **A finding can only name an entry by its identifier**
>
> The server has no notion of a “display field” the store could join on, so the row shows the `contentType` + the entry id in tabular figures and makes it a link to `/workspaces/:id/content/:type/:entryId`. That is **the honest identifier available today**: giving a finding a human title is a server-side change worth making rather than faking on the client.

### Severity is a shape, not only a colour

`severityLook` is the only place a severity turns into an appearance, and it hands over an **icon** alongside the classes: a `CircleAlert` for error, a `TriangleAlert` for warn, an `Info` for info. The colours are the design system's reserved status tokens (`destructive` / `warning` / `info`), not arbitrary steps of the palette. Running the palette validator over the values actually shipped gives:

| Pair                              | ΔE under deuteranopia | ΔE with normal vision | Threshold |
| --------------------------------- | --------------------- | --------------------- | --------- |
| #a06108 (warn) ↔ #d40c1a (error) | **0.9**               | **14.8**              | 15        |

The two loudest levels are exactly the pair a reader will not tell apart by hue: a red and an orange of the same lightness. For a status token applied one at a time that is fine — that is what it was sized for. Here all three appear in one list, and the reader has to distinguish them. So severity is carried **primarily by shape**, the colour agrees with the shape, and the word is always present (visible on a chip, `sr-only` on a bare glyph). Three redundant encodings are what WCAG 1.4.1 requires.

The age bar in the copilot's result is **a single neutral colour**: the length already carries the magnitude, and colouring it by severity would hang two encodings on one mark, leaning on precisely the red-amber pair a colour-blind reader cannot separate.

### Details that are easy to lose

- **The cache keys carry the workspace id.** The scope is server-side, through the `X-Workspace-Id` header the shared `apiClient` attaches; without the id in the key, switching workspace would serve the previous one's findings from cache. The batch key additionally **sorts the ids**, so that two renders of one page hit the same cache entry regardless of row order.
- **The column respects `isVisible`.** Extension columns are hidden by default, and `useRowsData` runs on every render regardless — ignoring the flag, we would hit the network on every page of every list for data nobody is looking at.
- **`isError` is never rendered as an empty state.** The findings list, the rule list, the entry widget and the column cell each have their own words for a failure.
- **Empty states are a centred figure, not an `Alert`.** A full-width banner is the shape of a notice about what just happened; on a wide screen an empty page in such a frame reads as a warning. And “there are no alarms at all” differs from “there are alarms and nothing matched”: only the second is reassuring, and only the first has an action.
- **Mutations invalidate the `alarmsKeys.all(workspaceId)` root.** Editing an alarm triggers a server-side recompute that changes the counter on its card, the groups on the Flagged tab and the summary badge all at once. There is no narrower placement worth the bookkeeping — and distinguishing “a rename” from “a condition change” on the client would mean the client deciding whether the server rescanned: a fact only the server knows.
- **Controls nested in someone else's toolbar look like neighbours.** The column picker and the “Filters” toggle are ordinary-sized outline buttons with `shadow-none`; “Save as alarm” carried a `size="sm"` and a shadow and read as a different class of control wedged into their row.
- **An `Alert` with only a description puts the icon _inside_ the description.** `Alert` absolutely positions a top-level `<svg>` at `left-4 top-4` and pulls the block beside it up by 3px — a geometry meant for “a title above a description”. A one-line, title-less banner gets its icon at the top of the box and its sentence off the box's centre. Wrapping the icon and the text in a flex row takes them out from under the `[&>svg]` selectors.
- **Both pages carry a `PageTopBar`** — the same styling as any other workspace section, and it is where the way back lives: the editor's breadcrumbs are `Alarms › <alarm's name>`, so two open tabs are told apart by which alarm is being edited in them rather than both reading “Edit alarm”.

## 09. Configuration

Everything here **bounds the work**. The rules themselves live in the database, because they are a workspace's content rather than a deployment's setting. **The plugin reads no environment variable at all**: in `apps/server/src/plugins.ts` it is registered as `AlarmsPlugin()` — with no arguments, that is, on defaults alone.

| Field                 | Default  | Meaning                                                                                                                                                                                                                                                                                                                 |
| --------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| maxScanEntries        | `20,000` | The ceiling on entries examined by one full recompute of one rule. A recompute is the only place that touches a whole collection, hence the only one that needs a ceiling; the event path looks only at what changed. A scan that hit the ceiling **reports what it examined** rather than pretending it saw everything |
| scanBatchSize         | `500`    | How many entries one recompute reads at a time. It bounds peak memory on a large collection without changing the scan's conclusions                                                                                                                                                                                     |
| sweepIntervalMinutes  | `60`     | How often active rules are recomputed in the background. **`0` turns the sweep off entirely** — the only field where zero is a real choice                                                                                                                                                                              |
| maxDependentsPerEvent | `500`    | How far one event may fan out in the reverse pass. Applied twice: to the related entries and to the ones this rule already flags                                                                                                                                                                                        |

> **Configuration that silently does nothing is rejected at assembly**
>
> `assertConfig` in the plugin's factory refuses a non-integer or less-than-one value for the three “positive” fields. **Zero or negative here does not mean “no limit”** — it is a scan that examines zero rows and reports a clean collection. That is the one failure mode the plugin must never have, so it is caught in the constructor rather than discovered from a suspiciously empty alarms page. For `sweepIntervalMinutes` only a negative value is rejected.

<details>
<summary>Registration order and startup</summary>

`AlarmsPlugin` registers **after** `DatabasePlugin` (the database client and the outbox) and **after** `ContentPlugin` (the type registry, the filter surface, the grants query). The module is declared `global: true` — as every other plugin here is — so that its services are injectable from anywhere; `ALARMS_CONFIG`, `AlarmFindingStore`, `AlarmEvaluator` and `AlarmRulesService` are exported for surfaces that want to read findings otherwise than over HTTP. `EntryEventSubscriber` and `AlarmSweepService` register/arm on `onApplicationBootstrap`, that is, inside `app.init()`: after every module is assembled and before the server starts listening. `AlarmsCopilotToolProvider` registers earlier, on `onModuleInit`, through the `@Optional()` registry.

</details>

## 10. Security and resilience

#### No enumeration of the content model

An unregistered type and one not granted to the workspace give **the same** `404` with the same text. That rule came from content (`resolveGrantedType`), and a rule editor has no right to weaken it.

#### The scope is the workspace, always

`WorkspaceGuard` on both controllers, a `workspace_id` in every query's `where`, and a `ToolContext.workspaceId` for the copilot tool, resolved before dispatch.

#### CSRF is closed per route

`OriginGuard` sits on the five writing routes (the POST `preview` included) and not on the reads — just as in content's controllers. The routes authenticate with a cookie and are therefore CSRF-able.

#### The copilot tool is not available over MCP

`surfaces: ['copilot']` is declared explicitly rather than left to the permission check. A future token scope that accidentally included `alarms:read` would otherwise silently open an MCP surface nobody decided to open.

#### Idempotency instead of “exactly once”

At-least-once delivery, an upsert on a composite PK, set operations in the deletion and closing paths. No path relies on delivery happening once.

#### A broken tree does not bring the subscriber down

`safeMatch` catches a `FilterException`, marks the rule broken and returns `null`. Returning an empty array instead of `null` would mean “nothing matched” and would **close every one of the rule's findings** on the way to reporting success.

#### A depth bound on someone else's JSON

`filterTreeSegments` bounds the walk at `MAX_DEPTH = 16`. A stored tree is data, and data can be crooked or hostilely deep: a rule's row can be edited by hand or restored from a backup taken across a schema change.

#### An unknown value does not bring the page down

`coerceSeverity` on the server and `severityLook` in the admin UI fall back to `warn`. The column is text precisely so that a new severity is not a migration — which means an old build can receive a new value.

### Resilience: what happens when something breaks

| The failure                                            | The behaviour                                                                                       | Recovery                                                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| An event was not delivered / failed                    | The findings lag. The entry that raised the event is saved — it was not affected                    | The outbox's retries with backoff; ultimately the “Check now” button                         |
| The reverse pass failed                                | A `warn` in the log, with the main reconciliation already done                                      | The next sweep or recompute                                                                  |
| The filter stopped parsing                             | The rule is marked `broken`, excluded from evaluation and shown in red in the interface             | Open the editor, fix the condition and save (only a `PATCH` with a `filter` clears the flag) |
| A recompute hit the ceiling                            | A `warn` in the log, the findings past the ceiling not updated; the report honestly shows `scanned` | Raise `maxScanEntries` or narrow the rule                                                    |
| One rule fails during a sweep                          | A `warn` in the log, and the sweep continues with the rest                                          | The next interval                                                                            |
| The process stops mid-sweep                            | `onModuleDestroy` clears the timer and **waits out** the running sweep                              | An unfinished scan would leave findings describing neither the old state nor the new one     |
| The entry vanished between the commit and the delivery | The subscriber exits silently: there is nothing to evaluate                                         | A deletion or purge event is already queued                                                  |
| There is no tool registry in the deployment            | `@Optional()` — the tool is simply not registered                                                   | —                                                                                            |

## 11. Invariants

Statements that must always hold. At once a review checklist and a draft set of test assertions.

- **I-01** — No severity level blocks a write. The plugin has no path that returns a refusal to a save or a publish; `severity` is used only for sorting, colouring and filtering.
- **I-02** — A rule's condition is stored **verbatim** as an entry-list filter tree and evaluated through `EntryMatchQuery`. There is no second condition format in the system.
- **I-03** — All three evaluation paths (an event, an explicit recompute, the sweep) end in one `EntryMatchQuery` and one `AlarmFindingStore.reconcile`; they differ only in the set of rows examined.
- **I-04** — Reconciliation touches **only** the entries in `examined`. A one-row pass cannot close findings it did not ask about.
- **I-05** — A redelivered event changes nothing but `last_seen_at`: the upsert on `(rule_id, entry_id)` is idempotent.
- **I-06** — `first_seen_at` is written on insert only and never updated — the history survives a finding's closing and reopening.
- **I-07** — Creating a rule performs a full collection scan **before** answering; so does editing an enabled rule's filter.
- **I-08** — A rule whose filter has stopped parsing is marked `broken`, excluded from all three evaluation paths and **shown** in the interface. It never “silently fails to match”.
- **I-09** — A failure to evaluate a filter yields `null` rather than an empty matched set: “we could not check” must not turn into “nothing matched” and close every one of the rule's findings.
- **I-10** — A recompute adds the entries the rule flags that the scan window did not see into the examined set — otherwise such a finding stays open forever.
- **I-11** — A recompute that hit `maxScanEntries` writes a warning and does not report a clean scan of a truncated set.
- **I-12** — `entry.deleted` **closes** an entry's findings and `entry.purged` **deletes** them. A soft delete is reversible, a purge is not.
- **I-13** — Deleting a rule deletes its findings by a database cascade; a rule cannot be deleted from another workspace (a `workspace_id` in the `DELETE`'s `where`).
- **I-14** — A rule's name is unique within a workspace at the database level; a violation is translated into a `409` rather than an unhandled driver error.
- **I-15** — A rule's content type is immutable: `UpdateAlarmRuleDto` has no `contentType` field.
- **I-16** — An unregistered type and an ungranted one answer with an identical `404` and an identical message.
- **I-17** — Every route requires a session, workspace membership and one of the two permissions; reads take `alarms:read`, every write takes `alarms:manage`; every write additionally carries `OriginGuard`.
- **I-18** — The findings list with no explicit `?state=` excludes `resolved`; the per-entry batch always excludes `resolved`.
- **I-19** — The severity breakdown and the list's page are built from **one** predicate (`findingsWhere`) and cannot describe different sets.
- **I-20** — Muting a finding exists nowhere: no state, no columns, no route, no tab, no row action.
- **I-21** — A configuration with a zero or negative limit is rejected when the plugin is constructed; `sweepIntervalMinutes: 0` is a legitimate “do not sweep”.
- **I-22** — The reverse pass considers only rules whose filter tree mentions a relation pointing at the changed type, and is bounded by `maxDependentsPerEvent` on both sides.
- **I-23** — The sweep is sequential, coalesces parallel calls onto the one already running, and waits for completion when the module shuts down.
- **I-24** — The server package's `domain/` layer imports neither `@nestjs/*` nor `drizzle-orm` nor `class-validator`.
- **I-25** — Database writes are chunked at 500 rows — below Postgres's bind-parameter ceiling, which would otherwise fail the whole reconciliation.
- **I-26** — The alarm editor serialises the condition with `relativeDates: true`; a relative window stays relative rather than freezing on the date the rule was written.
- **I-27** — Saving with not a single condition is impossible: an alarm with no condition would flag every entry in the collection.
- **I-28** — Save always sends the `filter` key; the API reads a missing key as “do not touch”, and clearing the conditions would silently keep the old ones.
- **I-29** — A group's heading and count come from the rule's `openCount`, not from the page of findings beneath it.
- **I-30** — Every admin query is disabled (`enabled: false`) without the corresponding permission; the cache keys contain the workspace id.
- **I-31** — The “Checks” column makes no requests while it is hidden (`isVisible` is threaded into the hook's `enabled`).
- **I-32** — Severity carries at least three encodings: the glyph's shape, the colour and the word. No surface encodes it by colour alone.
- **I-33** — The “loading”, “error” and “empty” states are distinguishable on each of the four reading surfaces (the findings list, the rule list, the entry widget, the column cell).
- **I-34** — The copilot tool is read-only, declared `surfaces: ['copilot']`, bounded by the run's workspace, and has no writing counterpart.
- **I-35** — `readToolFindings` never throws: an unrecognised shape yields `null` and a fallback to the raw payload, a row with an unknown severity is discarded, and the count comes from `bySeverity`.

## 12. Testing checklist

The wording is “action → expected result”. The existing suites are `apps/server-e2e/src/server/alarms/` (3 files: `alarm-rules.spec.ts`, `alarm-findings.spec.ts`, `alarm-rule-edit.spec.ts`) and `apps/admin-e2e/src/alarms/alarms.spec.ts` (with `support/api/alarms.ts` as the seed). `filter-tree-segments`, `finding-state` and `findings-tool-output` on the server and `toolOutput` in the admin UI are covered by unit tests. The server side is checked with `curl` + `psql`, the admin side in a browser.

### Rules: creation and validation

- **Create a rule over a collection that already holds matching entries** → the response has `scan.open > 0`; `alarm_findings` holds rows with `state='open'`. The rule is right on its very first day.
- **A filter with a non-existent field** → 400 with the filter engine's message; no row appeared in `alarm_rules`.
- **A second rule with the same name in the same workspace** → 409.
- **The same name in a different workspace** → 201 — the uniqueness is composite.
- **A `contentType` that does not exist in the deployment** → 404, “Unknown content type "…"”.
- **A `contentType` that exists but is not granted to the workspace** → the same 404 with the same text, byte for byte.
- **An extra field in the body** → 400 from the global `ValidationPipe`.
- **A `severity` outside the three values** → 400.
- **A 121-character name** → 400.
- **A request with a foreign `Origin`** → 403 on all five writing routes, `preview` included.

### Rules: editing, recomputing, deleting

- **Change the filter to a narrower one** → the response arrives after the recompute; the findings the old condition opened are closed, and the ones the new one implies are open.
- **Change the filter, then call `rescan`** → the scan uses the **new** condition: it really was saved rather than merely applied once.
- **Rename a rule without touching the filter** → there is no recompute; `last_scan_at` is unchanged.
- **A PATCH with a `contentType` in the body** → 400 (an undeclared field).
- **A PATCH of a rule from another workspace** → 404.
- **A PATCH with an invalid uuid in the path** → 400 from `ParseUUIDPipe`.
- **Delete a rule with open findings** → 204; zero rows in `alarm_findings` with that `rule_id`; the content entries are untouched.
- **Delete a non-existent rule** → 404.
- **`rescan` a rule whose data has not changed** → `opened = 0`, `resolved = 0`, `open` unchanged; `last_scan_at` updated.
- **Run `rescan` twice in a row** → the second changes nothing — reconciliation is idempotent.

### Findings: opening, closing, idempotency

- **Publish an entry that matches a rule** → a finding opens through the outbox; `first_seen_at` is the moment of the insert.
- **Fix the entry (it stopped matching)** → the finding closes by itself, with no click at all; `first_seen_at` is preserved and `resolved_at` is filled in.
- **Break it again** → the same row returns to `open`, `first_seen_at` is **the original**, and `resolved_at` is nulled.
- **Deliver the same event twice** → one row; only `last_seen_at` changed.
- **Publish a _related_ entry (the author)** → the findings on the articles that referenced it close through the reverse pass.
- **Move an entry to the trash** → all of its findings are `resolved`; the rows are still there.
- **Restore it** → the matching findings are `open` again with their original `first_seen_at`.
- **Purge the entry for good** → no finding rows with that `entry_id` remain.
- **Leave an open finding and lower `maxScanEntries` so its entry falls outside the scan window** → the recompute still closes it if it stopped matching (it is added to the examined set “from outside the window”).

### Reads and permissions

- **A viewer reads `GET /alarms/rules`** → 200.
- **A viewer calls `POST /alarms/rules`** → 403.
- **A non-member of the workspace calls any route** → a refusal from `WorkspaceGuard`.
- **`GET /alarms/findings` with no `state`** → no `resolved` in the output.
- **`?state=resolved`** → only history comes back.
- **`?pageSize=1000`** → 400 from the DTO; if the pipe is bypassed, a clamp to 100.
- **`?page=0`** → 400 (`@Min(1)`).
- **`by-entry` with 101 ids** → 400.
- **`by-entry` with a non-uuid among the ids** → 400.
- **`by-entry` with an empty parameter** → 200 and `{ byEntry: {} }`, with no database query.
- **`summary` with no findings at all** → `{ open: { error: 0, warn: 0, info: 0 }, openTotal: 0 }`, not an empty object.
- **The sum of `summary.open` and the number of open items in the list** → they match: these are two reads of one predicate.

### A broken rule and the ceilings

- **Rename a field in a type's schema so that the stored filter stops parsing, then save an entry** → the rule gets a `broken_reason`; its findings are **not closed**; the rule's card carries a red alert with the error's text.
- **Save another entry of that type** → the broken rule is skipped and the other rules keep working.
- **Put the field back and call `rescan`** → the scan runs, but `broken_reason` **remains** — the rule is still excluded from the event path. Only a `PATCH` with a `filter` clears it.
- **A collection larger than `maxScanEntries`** → a warning in the log naming the rule and the ceiling; the response's `scanned` equals the ceiling.
- **A rule with more open findings than `maxDependentsPerEvent`, and a related entry published** → the reverse pass does not expand into a full reconciliation; the remainder is picked up by the next sweep.
- **A rule row with `severity = 'critical'` written into the database by hand** → the alarms page opens and the rule is shown as `warn`; nothing crashes.

### The sweep

- **A “not updated in N days” rule, with nobody touching anything** → after the interval the finding appears — there were no events, after all.
- **`sweepIntervalMinutes: 0`** → no timer is created at all.
- **`sweepIntervalMinutes: -1` / `maxScanEntries: 0`** → the application does not start, and the message names the field and the value received.
- **Two parallel calls to `sweep()`** → the second returns the same promise; there is no second pass.
- **One rule fails during the sweep** → a warning in the log, and the remaining rules are swept.
- **Stopping the application during a sweep** → `onModuleDestroy` waits for it to finish.

### The admin UI: creating an alarm

- **Filter the entry list** → “Save as alarm” appears in the toolbar, visually indistinguishable from the neighbouring controls.
- **Clear the filter** → the button disappears.
- **Sign in as a contributor** → the button is absent under any filter; a direct POST still gives a 403.
- **The dialog: save** → the toast names the alarm and the number of flagged entries; the alarm list has refreshed.
- **The dialog with an already-taken name** → an error message in the dialog, and the dialog does not close.
- **“New alarm” → choose a collection** → until one is chosen the condition builder is unavailable and prompts you to choose a collection.
- **Change the collection after typing conditions** → the conditions are cleared — they belonged to the old type's fields.
- **A condition matching the whole collection** → an explicit warning: “these are all the entries — the condition is probably inverted”.
- **Create with an empty condition** → the “Create alarm” button is disabled.

### The admin UI: the alarm editor

- **Open an alarm** → the saved condition is visible as chips **without** expanding the builder; the match count computed itself.
- **Type in the name field** → **no** additional preview requests — the effect is keyed on the conditions alone.
- **Change the condition and press Apply** → the chips changed, the panel collapsed, focus returned to the toggle button, and the count recomputed.
- **Remove every condition** → Save is disabled; an empty state is shown rather than the “conditions changed” notice.
- **Change the condition and do not save** → a yellow notice: “nothing is flagged or cleared until you save”.
- **Save** → the conditions on screen are what go to the server; back in the list, the rule's counter matches the new condition.
- **An alarm whose condition uses a slot field (a locale, say)** → it reads as an ordinary condition rather than “this field is no longer available”; Apply works and the alarm stays editable.
- **The field surface is still loading** → the builder shows a loading state rather than a “dead” Apply.
- **The fields request failed** → an explanation and a retry button.
- **A condition across a relation** → the value offers an entry picker rather than a text field.
- **Open an alarm as a contributor** → read-only fields and no save buttons.
- **Open a non-existent id** → “No such alarm” and a way back, not a blank screen.

### The admin UI: the page, the entry panel, the column

- **Open the alarms page** → a `PageTopBar` and two tabs with counters; with one group it is expanded, with several they are all closed.
- **Do not expand a group** → its entries are **not requested**.
- **Press “N entries flagged” on an alarm's card** → the Flagged tab opens and that alarm's group expands; the others stay visible.
- **Page a group to the end, then fix the last entries** → the group's page clamps to the last existing one, and the pager does not vanish with the contents.
- **The rules request fails** → a “Couldn't load findings” alert — **not** an empty state.
- **No alarms at all** → “No alarms yet” with an explanation of how they are made and a button (given `alarms:manage`).
- **There are alarms and nothing matches** → a different state: “Nothing is flagged. That is what a clean workspace looks like”.
- **Open a flagged entry** → the “Checks” block in the panel: the finding's title + the alarm's name + the severity glyph.
- **Open a clean entry** → “No alarm flags this record”.
- **Make `by-entry` fail** → “Checks could not be loaded” — not “nothing is flagged”.
- **Create a new entry** → the block is not rendered and makes no request.
- **The “Checks” column is off** → no `by-entry` requests on any list page.
- **Turn the column on** → one request per page; the cell shows a glyph per severity present, the count in figures, and an `sr-only` summary listing the titles.
- **A member without `alarms:read`** → there is no “Alarms” item in the navigation; visiting the URL directly gives a “You cannot view alarms” card; no network requests are sent.
- **Switch workspace** → the previous one's findings are not shown even for an instant (the workspace id is in the cache keys).
- **An axe pass over the screens** → no violations, with a finding on screen, with the builder open, or on an empty creation form.

### Muting: verifying its absence

- **Search for a button with the text /mute/i on the alarms page** → zero matches.
- **Search for a “Muted” tab** → it does not exist; the strip is “Flagged” and “Alarms”.
- **Call any of the former mute routes** → 404: the route does not exist.
- **Check `alarm_findings`'s columns in a migrated database** → no `muted_at`, no `muted_by`, no `muted_reason`.
- **Run the migrations on a database that had `state='muted'` rows** → all of them became `open`; not one row is in an unrecognisable state.
- **Hand the copilot result renderer an old payload with `muted` fields** → they are ignored rather than rendered.

### The copilot

- **Ask the copilot about the workspace's problems** → `admin_alarms_findings` is called; the result renders as rows with links rather than as JSON.
- **The age bar** → scaled to the oldest finding in that same result; the freshest one's width is not zero; the number of days sits in text beside it.
- **The result's header** → describes the whole set (`total` and `bySeverity`), while the “N more not shown” line describes the difference.
- **Feed the renderer junk instead of a result** → `null` and a fallback to the raw payload; the conversation does not crash.
- **Check the MCP endpoint's `tools/list`** → `admin_alarms_findings` is absent.
- **Call the tool as a viewer** → it works: `alarms:read` is held by all three roles.

## 13. Boundaries of responsibility

| Area                                           | Who owns it                                                                                                            | What Alarms does                                                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The database connection and running migrations | `@orthacms/database` + `@orthacms/nx`                                                                                  | Owns the schema and migration **files** but not the connection and not the application step                                                                                                                                                                                       |
| The filter grammar and its evaluation          | `utils-server` (`FilterOperator`, `parseFilterTree`) + `content-server` (`EntryMatchQuery`, `buildEntryFilterSurface`) | **Only calls them.** If the operator you need is missing, the engine is extended, not alarms                                                                                                                                                                                      |
| Hard content-validity rules                    | `content-server`: `EntryValidationService`, `publish-gate.ts`, `EntryWriterService`                                    | Nothing. An alarm does not refuse and cannot learn to refuse                                                                                                                                                                                                                      |
| Entry lifecycle events                         | `content-server` raises them, `OutboxDispatcher` delivers them                                                         | Subscribes to seven kinds; registers with the dispatcher at bootstrap                                                                                                                                                                                                             |
| A workspace's content grants                   | `content-server` (`WorkspaceGrantsQuery`)                                                                              | Asks before every operation on a type; repeats its `404` answer                                                                                                                                                                                                                   |
| Permissions, roles and route guarding          | `identity-server`                                                                                                      | Owns two keys (`alarms:read`, `alarms:manage`) — but they are declared in identity's catalogue                                                                                                                                                                                    |
| The workspace scope                            | `workspaces-server` (`WorkspaceGuard`)                                                                                 | Uses it; it has no membership check of its own                                                                                                                                                                                                                                    |
| The tool registry and call authorization       | `tools-server`                                                                                                         | Contributes one tool and declares its surface                                                                                                                                                                                                                                     |
| Rendering the chat and the transcript          | `copilot-admin`                                                                                                        | Contributes a renderer into `COPILOT_TOOL_RESULT_SLOT`; the copilot knows nothing about alarms                                                                                                                                                                                    |
| The entry list, the entry editor, the toolbar  | `content-admin`                                                                                                        | Contributes into three of its slots; **not one line of change in content-admin was required**                                                                                                                                                                                     |
| The query builder and its serialisation        | `query-builder-admin`                                                                                                  | Uses `QueryBuilderPanel`, `QueryBuilderSummary`, `treeToJsonFilter`, `jsonFilterToTree`; it is the admin UI's only caller that asks for `relativeDates`                                                                                                                           |
| The activity log                               | `activity`                                                                                                             | Nothing. Creating, editing and deleting a rule **do not reach** the activity log                                                                                                                                                                                                  |
| Cleanup when a workspace is deleted            | `workspaces-server` (`WorkspacePurgeRegistry`)                                                                         | Registers `AlarmsWorkspacePurger`, which removes the workspace's findings and then its rules. The registry decides when: every purger runs serially inside the delete's own transaction, and one that throws aborts the whole delete rather than leaving a half-deleted workspace |

### What else is missing

- **Aggregate rules.** “Two products share a slug”, “a section has fewer than three articles”, “the translation is older than the original” are a `GROUP BY`, not a row predicate. They need a second kind of rule and a second evaluator. Out of scope, not planned.
- **Subjects other than content entries.** Media with no `alt`, a user with no role. The mechanism generalises; a port for generalising is worth designing after a second subject appears.
- **Outbound delivery.** Webhooks are a separate feature on the existing outbox with its retries, backoff and dead letters.
- **A human-readable entry title in a finding.** The server has no notion of a display field; the row shows an id. That is a server-side change worth making.
- **An “enable/disable alarm” toggle in the interface.** The `enabled` field exists in the schema, in both DTOs and on the rule's card (“Off”), but **neither the editor nor the creation dialog sets it** — today an alarm can only be switched off with a direct `PATCH`.
- **Writing through the copilot.** Neither creating a rule nor changing a finding. See section 6.12.
- **A summary on the home page.** `GET /alarms/findings/summary` is described as “the numbers for the navigation badge and a dashboard panel”; today only the “Flagged” tab's counter reads it.
- **A scheduler.** The sweep is an in-process timer; it is no good for “exactly once” and never pretended to be.

## 14. Discrepancies between the code and the documentation

Found while reconciling this dossier with the sources. Not product bugs in themselves, but they disorient developers and testers alike. The overwhelming majority are **traces of the withdrawn muting feature**, about which `packages/alarms/admin/AGENTS.md` states outright: “Nothing here half-remembers it”.

| Where                                                                   | What it says                                                                                                                                                                                                                                                         | How it actually is                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| docs/design/alarms.md                                                   | The model is described as `finding ─ (rule, entry) → open \| muted \| resolved, first_seen_at, muted_reason`; a whole closing “Open question” section is devoted to who should be allowed to mute, and proposes “letting a contributor mute with a mandatory reason” | Muting **does not exist**: the `0001_drop_finding_mute` migration normalised the rows and dropped the three columns, and there are two states. The document is marked “Status: shipped”, that is, it reads as a description of current behaviour. **The most disorienting discrepancy in the group**                       |
| docs/adr/0015-…-non-blocking.md                                         | “Decision 3”: “…and can be muted with a reason that survives both”                                                                                                                                                                                                   | The same withdrawn feature. The ADR was accepted on 2026-08-24 and has not been updated since the withdrawal                                                                                                                                                                                                               |
| docs/design/alarms.md                                                   | “There is no create-rule page at all; `AlarmRuleEditorPage` edits an existing one”                                                                                                                                                                                   | The creation page exists: the `alarms/rules/new` route, the same component with `mode="create"`, and a “New alarm” button in the header. The package's `AGENTS.md` honestly says it was “added at a user's request, reversing a documented decision” — while the cross-cutting document never reflected the reversal       |
| packages/alarms/admin/src/lib/<br>infrastructure/alarmsGateway/index.ts | The `AlarmsGateway` type's last line is a dangling JSDoc, `/** Silences one finding. */`, right before the closing brace                                                                                                                                             | There is no method after the comment. A shard of muting that survived the withdrawal — precisely what `AGENTS.md` promises not to leave behind                                                                                                                                                                             |
| …/presentation/components/<br>FindingGroupList/index.tsx                | An `emptyMutedBody` message is declared (“Muting a flagged record silences it until someone unmutes it…”); the JSDoc says “The flagged and muted views” and “each row carries its own `openCount` / `mutedCount`”                                                    | The message is **used nowhere** (its only occurrence is the declaration itself), the `AlarmRule` type has no second counter, and there are two views                                                                                                                                                                       |
| …/presentation/pages/<br>AlarmsPage/index.tsx                           | JSDoc: “what is flagged, **what has been silenced**, and the rules behind both”; the type's comment: “Which of the **three** views the page is showing”; the `SegmentedControl`'s comment: “read as a header band rather than as **three** tabs”                     | The `AlarmsTab` type is `'open' \| 'rules'`, there are two tabs, and there is nothing to silence                                                                                                                                                                                                                           |
| …/FindingGroupList/<br>FindingGroup/index.tsx                           | The page-clamping effect's comment: “**Muting** the last row of a trailing page leaves this group's page past the end”                                                                                                                                               | There is no muting; the page runs past the end from **fixing** the last entries. The mechanics are right and the cause named does not exist                                                                                                                                                                                |
| …/copilot/alarms-tool.provider.ts                                       | JSDoc: “There is deliberately no write tool here. **Muting a finding** is the act of deciding an exception is acceptable, which is the one judgement this feature exists to ask a human for”                                                                         | The conclusion (“there is no write tool”) is correct, but the first of its two justifications rests on a removed feature                                                                                                                                                                                                   |
| packages/alarms/server/AGENTS.md                                        | The route table and the rest of the text are **accurate**. The one inaccuracy: the “Behaviour worth knowing” section does not mention that a successful `rescan` does not clear the `broken` flag                                                                    | The flag is cleared exclusively by a `PATCH` with a `filter` key (`alarm-rule.repository.ts`). A rule whose type was fixed does not revive on its own                                                                                                                                                                      |
| …/alarms.constants.ts                                                   | `TEXT_MAX_LENGTH` is commented as “Max length of a rule description **and of a mute reason**”; `FILTER_MAX_LENGTH = 8192` is documented as a “coarse first latch” before the engine's limits                                                                         | The mute reason does not exist. `FILTER_MAX_LENGTH` is **applied nowhere**: in `save-alarm-rule.dto.ts` the `filter` field carries only an `@IsObject()`, with no length limit. The practical effect is limited (the tree still passes the engine's node and depth limits), but the constant is misleading                 |
| …/types/alarm-views.ts + the controller                                 | `AlarmSummaryView` is commented as “Counts behind the workspace's alarms badge **and home panel**”; `AlarmRuleView.openCount` as “Findings currently open (i.e. **not resolved**)”                                                                                   | There is no home panel. `openCount` is counted strictly on `state = 'open'` rather than “not resolved” — currently the same thing, but the wording describes the former three-state model                                                                                                                                  |
| …/alarm-rules.service.ts (`update`)                                     | The package's `AGENTS.md`: “Editing a filter forces a rescan before the response returns”                                                                                                                                                                            | The recompute is conditioned on `updated.enabled`. For a disabled rule, changing the filter does **not** trigger a recompute — which is defensible (the rule is excluded from evaluation anyway) but contradicts the unconditional wording. For `create`, meanwhile, the scan is unconditional, even with `enabled: false` |
| packages/alarms/admin/AGENTS.md                                         | The layout is described as “utils/alarmsPlugin — the AdminPlugin factory — **routes + five slots**”                                                                                                                                                                  | There are **six** slot contributions (including `WORKSPACE_ROUTE_SLOT` itself); “five” only works if the routes are not counted as a slot, which they are. A trifle, but it throws the count off during a review                                                                                                           |
| The plugin as a whole                                                   | No document notes the absence of logging                                                                                                                                                                                                                             | Creating, editing and deleting a rule **write not a single outbox event** and never reach the activity log — even though a rule is a workspace's editorial policy, that is, exactly the class of decision the log exists to record                                                                                         |

---

**The second dossier in the series.** Written for the `packages/alarms` group in the pilot `identity` dossier's skeleton: business description → composition → permissions → data → lifecycle → scenarios → API → the admin UI → configuration → security → invariants → checklist → boundaries → discrepancies.

The source is the code: the controllers, DTOs, services, evaluator, subscriber, the Drizzle schema and both migrations on the server; the plugin factory, the hooks, the gateway, the pages and the components in the admin UI. `docs/adr/0015-alarms-are-non-blocking.md`, `docs/design/alarms.md` and both `AGENTS.md` files were read and cross-checked. The documentation files were used as a skeleton, but every statement was verified against the implementation — the divergences are collected in section 14.
