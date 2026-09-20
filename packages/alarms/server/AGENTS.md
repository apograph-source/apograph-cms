# @orthacms/alarms-server

The **alarms plugin** — non-blocking content rules and the findings they
produce. A workspace declares what it considers wrong ("a published article
whose author is still a draft"), and the CMS says so wherever that content is
touched, without ever refusing a save or a publish.

Layout: **layered (ADR-0003)** — `domain / application / infrastructure / http`.

## What it is, in one paragraph

A **rule** is a content type plus a saved records-list filter plus a severity. A
**finding** is one rule's verdict about one entry. Rules are evaluated from
entry lifecycle events off the shared outbox, from an explicit rescan, and from
a periodic sweep; every path funnels into `EntryMatchQuery` — content's own
filter evaluation — so a rule means exactly what the records list means by the
same filter.

## The four decisions worth knowing before changing anything here

### 1. An alarm never blocks a write

No severity has authority. `error` is louder than `warn`, and that is all it is
([ADR-0015](../../../docs/adr/0015-alarms-are-non-blocking.md)). The moment a
severity can refuse a publish, this plugin and content's publish gate become two
competing authorities on whether an entry is valid, and they will disagree. If
something genuinely must not be publishable, it belongs in the content type's
schema, where `EntryValidationService` enforces it.

### 2. A rule is a saved list filter, not a query language

`alarm_rules.filter` stores the exact JSON the admin's query builder puts in
`?filter=`. That is why:

- the rule editor is the existing query-builder component over
  `/content-schema/:name/filter-fields`, with no new grammar to learn or
  document;
- "save this list filter as a rule" is a real one-click flow rather than a
  re-entry of the same condition;
- "show me the matching entries" links straight into the records list;
- the reverse pass can **compose** a stored rule (`AND author.id = <id>`)
  instead of re-parsing a string.

Never add a parallel condition format. If a rule needs something the filter
engine cannot express, extend the engine — `@orthacms/utils-server`'s
`FilterOperator` and content's `buildEntryFilterSurface`, which are built in one
traversal precisely so the picker and the parser cannot disagree.

**What this model cannot express**, and deliberately does not try to: anything
that is a _group by_ rather than a predicate on one row. "Two products share a
slug", "this section has fewer than three articles". Those need a second kind of
rule and a second evaluator; they are out of scope, not pending.

### 3. The primary key is the idempotency

`alarm_findings` is keyed `(rule_id, entry_id)`. Outbox delivery is
**at-least-once**, so the evaluator can be handed the same `entry.updated`
twice; the upsert makes the second pass a no-op. `first_seen_at` is written by
the insert and never updated, so "this has been open for three months" survives
the finding resolving and re-opening.

**Muting one finding at a time existed and was withdrawn** (`0001_drop_finding_mute`).
An alarm is either right about a record or wrong about it; silencing them
individually is a way of living with a bad condition instead of narrowing or
disabling the alarm, where the next person can see the decision. The removal was
whole — the state, the `muted_at`/`muted_by`/`muted_reason` columns, both routes,
the counts and the copilot projection — because a half-removed feature is worse
than either state. The migration normalises surviving `muted` rows to `open`
**before** dropping the columns: afterwards there is nothing left to identify
them by, and they would sit in a state no code recognises, excluded from every
`state = 'open'` count yet included by the list's `state <> 'resolved'`.

### 4. Findings close themselves, and the reverse pass is why

"This published article links to a draft author" is a fact about the **article**,
but the event that fixes it arrives about the **author**. So
`entry.published` / `unpublished` / `deleted` / `restored` / `purged` trigger a
second pass: rules whose filter tree mentions a relation pointing at the changed
type are re-evaluated for the entries that link to it, plus the entries they
currently flag. Without it, "links to a draft" would open correctly and never
close.

`filterTreeSegments` (pure, unit-tested) is what identifies a traversing rule —
the first path segment of every leaf, matched against the type's relation
targets. The pass is bounded twice: only rules that mention such a relation are
considered, and each is limited to `maxDependentsPerEvent` entries.

## Layout

```
src/lib/
  alarms.module.ts            # the one dynamic module (global)
  alarms.tokens.ts            # ALARMS_CONFIG
  alarms.constants.ts         # page sizes, length caps
  domain/                     # pure TS — no Nest, no Drizzle
    alarm-severity.ts         #   info | warn | error, and their order
    finding-state.ts          #   open | resolved + nextFindingState
    filter-tree-segments.ts   #   which relations a stored filter traverses
    errors/                   #   transport-agnostic errors
  application/
    alarm-rules.service.ts    # the rule lifecycle (validate → store → rescan)
    dto/                      # class-validator + @ApiProperty shapes
  infrastructure/
    schema/                   # alarm_rules, alarm_findings
    alarm-rule.repository.ts  # rule storage + the traversing-rule lookup
    alarm-finding.store.ts    # reconcile / read — the idempotent half
    alarm-evaluator.service.ts# the three evaluation paths
    entry-event.subscriber.ts # outbox → evaluation
    alarm-sweep.service.ts    # the periodic rescan
  http/controllers/           # thin, permission-gated
  docs/                       # the OpenAPI response schemas (see below)
```

`domain/` imports nothing from `@nestjs/*`, `drizzle-orm` or `class-validator`.

**Why no aggregate and no repository port.** ADR-0003 is explicit that a thin
context gets mappers and projections rather than a domain model it does not
need. A rule's only invariant is name-uniqueness, which is a database index; a
finding's state machine is one pure function. Forcing an aggregate and a port
onto that would be a violation of the ADR, not compliance with it.

## Routes

All under `/api/alarms`, all behind `WorkspaceGuard`. Reads need `alarms:read`,
every write needs `alarms:manage` — the split that keeps "who may see a finding"
apart from "who decides what the workspace considers wrong". Writes additionally
carry `OriginGuard`, per route rather than per class, matching content's
controllers: these are cookie-authenticated and therefore CSRF-able.

| Route                              | Permission      |
| ---------------------------------- | --------------- |
| `GET    /alarms/rules`             | `alarms:read`   |
| `POST   /alarms/rules`             | `alarms:manage` |
| `POST   /alarms/rules/preview`     | `alarms:manage` |
| `PATCH  /alarms/rules/:id`         | `alarms:manage` |
| `DELETE /alarms/rules/:id`         | `alarms:manage` |
| `POST   /alarms/rules/:id/rescan`  | `alarms:manage` |
| `GET    /alarms/findings`          | `alarms:read`   |
| `GET    /alarms/findings/by-entry` | `alarms:read`   |
| `GET    /alarms/findings/summary`  | `alarms:read`   |

A content type that is unregistered and one the workspace was never granted
produce the **same** 404 with the same message — content's own rule
(`resolveGrantedType`), so the rule editor cannot be used to enumerate the
deployment's content model.

## Behaviour worth knowing

- **Creating a rule scans immediately.** Otherwise the rule would only ever see
  entries edited after it existed — reporting a clean collection on the one day
  it is most likely to be wrong.
- **Editing a filter forces a rescan before the response returns.** Otherwise
  the findings table describes the _previous_ condition, confidently.
- **A rule whose filter stops parsing is marked `broken`**, skipped by the
  evaluator, and surfaced in the UI. Silently never matching looks exactly like
  "everything is fine", which is the worst thing a correctness tool can do.
- **A rescan that hits `maxScanEntries` logs a warning** rather than reporting a
  clean scan of a truncated set.
- **`entry.deleted` resolves an entry's findings; `entry.purged` deletes them.**
  A soft delete can be undone and the history has to come back with it; a purge
  leaves nothing to point at.
- **The sweep is per-process, on a plain interval.** It exists for rules about
  entries **nobody is touching** ("not updated in 90 days"), which by definition
  produce no events. `OutboxDispatcher` is the precedent for the mechanism. It
  is therefore not suitable for anything that must happen exactly once.

## The copilot can read findings

`AlarmsCopilotToolProvider` registers one tool with the shared registry
(`@orthacms/tools-server`): **`admin_alarms_findings`**, a read over the same
`AlarmFindingStore` the HTTP routes use. It exists because the feature's whole
claim is that "what is wrong with this workspace's content?" is now answerable,
and until it the copilot could search entries and read revisions while knowing
nothing about which of them a rule had flagged. A finding carries an `entryId`,
so the model's natural next call is `admin_content_get`.

- **`surfaces: ['copilot']`, and the reason is recorded in the provider's
  JSDoc.** Per the checklist in
  [`tools/server/AGENTS.md`](../../tools/server/AGENTS.md#adding-a-tool-decide-surfaces-deliberately)
  the first yes decides it, and this is a yes at (3): `scopePermissions` mints
  `content:*` plus `media:read`/`media:create` and nothing else, so `alarms:read`
  can never be held by an API token. Offered to MCP the tool would appear in
  `tools/list` and be refused on every call — worse than absent, because it
  advertises a capability that does not exist.
- **The page and its severity tally are two reads of one predicate.**
  `severityCounts` shares `list`'s `where` builder, so the tally can never
  describe a different set from the list beside it. It is the whole set's tally,
  not the page's — a sample describing itself as the workspace is exactly the
  kind of confident wrongness a model repeats as fact.
- **The projection is narrow on purpose.** `findings-tool-output.ts` (pure,
  unit-tested) drops `detail` — a jsonb bag whose shape belongs to the rule that
  wrote it — and both raw timestamps in favour of `openForDays`. The
  list is named `items` so the run engine's shape-driven `summarizeToolOutput`
  reads it as "14 results" with no tool-specific code.
- **There is no write tool.** Creating an alarm is defensible as a `propose`
  tool, but only once the proposal can carry the live preview ("matches 14 of
  312") — a JSON filter tree on a card is not something a reviewer can
  meaningfully approve.

`@orthacms/alarms-admin` renders the result rather than leaving it as JSON —
see its AGENTS.md.

## The reference describes the filter tree

`docs/` is this plugin's `ServerPlugin.docs.decorate` pass — the response
schemas, written as plain objects because the views are `interface`s the OpenAPI
scanner cannot see. It writes onto whichever 2xx key the scanner already emitted
and leaves the `204` delete alone.

The part worth keeping is `AlarmFilterNode`. Decision 2 says a rule stores the
records-list filter **verbatim**, and that tree is recursive — groups holding
rules and groups — so it is described as three named components that reference
each other (`AlarmFilterNode` → `AlarmFilterGroup` → `AlarmFilterNode`) rather
than flattened or left as a bare `object`. The operator list comes from
`@orthacms/utils-server`'s `FilterOperator`, so extending the engine extends the
published grammar in the same edit, and `within_last` is in it for the reason
decision 2 gives: a stored filter keeps the operator where a shared link
resolves it.

`AlarmFilterNode` uses `anyOf`, not `oneOf`. `oneOf` means _exactly one_, and
the group and rule alternatives are not disjoint enough for that to be safe —
the honest-looking operator turns a valid tree into a validation failure.

## Schema

Two tables, migrations committed here (`__drizzle_migrations_alarms`).
`workspace_id`, `entry_id` and `created_by` carry **no FK** — the first two
point at identity- and host-owned tables, and the last must outlive the user it
names, exactly like `activity_events.actor_id`.

## Commands

- `npx nx run-many -t typecheck lint test -p @orthacms/alarms-server`
- `npx nx run @orthacms/alarms-server:db:generate --name=<change>` (commit the SQL)
- `npx nx run server:db:migrate` applies it with every other plugin's
