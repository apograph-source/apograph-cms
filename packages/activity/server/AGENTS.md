# @ortha/activity-server

The audit-log **plugin** for the Ortha CMS server. It owns the
`activity_events` schema (and **ships its own migrations**), records events by
**subscribing to the transactional outbox**, and exposes the read API the
admin's Activity Log drives.

A **generic sink**: `kind` and `meta` are open (text / jsonb). Each emitting
plugin owns its own kinds — identity (auth, API tokens, workspaces), users
(member lifecycle), content (publish lifecycle), media (asset + folder
lifecycle) — so this package stays decoupled from any one domain's events.

> **Adding a producer means adding a mapper here.** An event kind with no entry
> in `FACET_MAPPERS` is not an error anywhere: the dispatcher finds no
> subscriber, stamps the row `dispatched_at`, and the action is simply never
> audited. That failure is completely silent, and it has happened four times
> (API tokens, entry publishes, the whole media library, and content
> export/import). The check is one query — compare
> `select distinct kind from outbox_events` against `AUDITED_EVENT_KINDS`.
>
> **And adding a mapper means adding a label.** The other half of the same
> failure lives in the admin, which restates these strings and prints the raw
> dotted token for one it does not know. Both halves are now pinned by
> `audit-event-mapping.spec.ts` — see **The catalogue** below.

> **Layered (ADR-0003 — tactical DDD inside plugins).** `activity` is a
> read-side / CRUD audit context: ADR-0003 says **don't force DDD on CRUD**, so
> there is **no aggregate**. The layering is light — a thin `ActivityService`
> query for the list read model, and the write side is one outbox
> `DomainEventSubscriber` under `activity/infrastructure/`. Wave 3 flipped this
> package from an in-band recorder to that subscriber.

Under `/api/activity`:

- `GET /activity` — filterable (`subjectType`/`subjectId`/`actorId`/`actorType`/
  `workspaceId`, `kind` CSV→`IN`, `actorEmail` search, `from`/`to` range),
  paginated (`page`/`pageSize`, 1-based), sortable (`sort=at|kind`,
  `order=asc|desc`, default `at desc`) audit log. Gated
  `@RequirePermissions(PERMISSIONS.ACTIVITY_READ)`. Drops `created_at` from the
  wire.
- `GET /activity/entries/:entryId` — **one entry's own trail**, gated
  `content:read` + `WorkspaceGuard` rather than `activity:read`.

    A different question with a different key, and that is the point. The full
    log is admin-only and correctly so — it carries invites, role changes and
    sign-in failures across the deployment — with the consequence that an
    **editor could not see the history of their own content**. The entry
    editor's History tab is the revision timeline: it records what the words
    were, and says nothing about who published the record, who took it down, or
    who changed who may read it.

    It **fails closed**: the query requires the row's `workspace_id` to match the
    open workspace, so an entry id from elsewhere reads as an empty history, and
    rows written before that column existed (which carry `null`) are excluded
    from this route. Losing old history on a narrow route is the right side to
    err on; the full log still has it.

- `GET /activity/dead-letters` — the events that **could not** be recorded
  (`dispatched_at IS NULL AND attempts >= MAX_DELIVERY_ATTEMPTS`), newest first,
  each with the reason it parked. Gated `activity:read`.

    This is the gap-in-the-trail route. The dispatcher logs the moment a row
    parks, but a log line is loud only to somebody tailing logs right then;
    afterwards "is anything missing from the log" had no answer short of a
    `psql` session, and a hole only visible to a person who thinks to go looking
    is barely a hole that has been noticed. The admin renders a non-zero `total`
    as a notice above the Activity table. It **reports rather than repairs**:
    replaying a parked row means clearing its `attempts`, a deliberate operator
    action against a fixed cause.

## The plugin describes its own responses (`src/lib/docs/`)

`ActivityEventView`, `ActivityListView` and `DeadLetterListView` are TypeScript
`interface`s, so the OpenAPI scanner emitted a bare `200` with no payload for
all three routes. `docs.decorate` writes the schemas on instead — the mechanism
and the reasoning are in
[`bootstrap/server`](../../bootstrap/server/AGENTS.md#the-response-schema-gap).

Two of the shapes are worth stating rather than inferring:

- **`kind`, `subjectType` and `actorType` are open strings, and stay open in the
  document.** Each emitting plugin owns its own kinds — that is the point of a
  generic sink — so an `enum` here would be a contract this package cannot keep,
  and `actor_type` is a plain text column that a row written before it existed
  leaves `null`.
- **A dead letter is the projection, not the row.**
  `OutboxDispatcher.deadLetters` selects seven columns and deliberately leaves
  the `payload` behind — it is arbitrary domain data, some of it user-authored,
  read over HTTP by an operator asking _what_ is stuck. Describing the table
  instead of the projection would advertise a field the route does not return.

## Recording (outbox subscriber — the live path)

`activity/infrastructure/audit-event.subscriber.ts` (`AuditEventSubscriber`) is
the **single live audit writer**. It self-registers with the
`OutboxDispatcher` (from `@ortha/database`) on `OnApplicationBootstrap`; the
dispatcher then delivers every audited domain event to it. `handle(event)` maps
the event to the same `activity_events` row the old in-band recorder wrote, via
the **pure** `audit-event-mapping.ts` (`toAuditRow`) — the event-kind → audit-kind
table (e.g. `member.* → user.*`, `auth.signed_in → user.signed_in`; workspace
kinds pass through). Producers put the actor on the event payload with
`attachActor(...)` before appending to the outbox, so the subscriber can recover
`actorId`/`actorEmail` from the event alone.

**Idempotent** (delivery is at-least-once): the row's primary key is the source
**event id** and the insert is `ON CONFLICT DO NOTHING`, so a re-delivered event
never double-records. The audit is derived downstream — the write path and the
audit path now evolve independently.

**A mapper may refuse.** `toAuditRow` returning `null` means "not an audited
kind, skip it" and the dispatcher marks the event delivered. Throwing
`UnmappableAuditEventError` means the opposite — this *should* be audited and
the payload cannot say who it is about — so the outbox row stays undispatched,
is retried with backoff, and parks at `MAX_DELIVERY_ATTEMPTS` for the
dead-letter query. `subject_id` is the only handle a row keeps on its subject
(no FK, no denormalised name), so a defaulted `''` is not a degraded row but an
unreadable one that no client can repair; refusing makes the gap loud instead.

**Parity is unit-tested** DB-free: `audit-event-mapping.spec.ts` asserts each
kind's produced row equals what the in-band `recorder.record(...)` wrote.

`ActivityService.record(...)` and the `ACTIVITY_RECORDER` token (the port lives
in **`@ortha/identity-server`**, the foundational package; this module binds
it) are **retained but `@deprecated`** — nothing writes through them anymore.
They keep the public surface stable. That indirection kept the package graph
acyclic (identity never depended on this package); the outbox now decouples them
entirely.

## Schema (isolation by design — the audit outlives its subjects)

- `actor_id` uuid with **no FK** (the actor may later be deleted);
  `actor_email` a frozen snapshot; `subject_id` **text** (not always a uuid);
  `meta` open jsonb (each emitter owns its shape); `at` (logical) vs
  `created_at` (write time). Indexes on `(subject_type, subject_id, at)`,
  `(actor_id, at)`, `(kind, at)`, `(workspace_id, at)`.
- `actor_type` — what `actor_id` names: `'user'` or `'api_token'`. It used to
  mean "a `users` row" and nothing else, so a write made with a bearer token had
  to pass **no actor at all** rather than name a person who did not do it: every
  write over the public REST API, GraphQL and MCP recorded as "System", and
  which of a workspace's tokens did it was unrecoverable. Naming the kind
  alongside the id is what lets a credential be the actor. Nullable — a
  system-initiated event still has none.
- **There is no retention, and the table grows without bound.** Every sign-in,
  every failed attempt and every token use is a row that is never trimmed —
  `api_token.used` alone can add one per token per minute, forever. Nothing
  deletes from this table and nothing is meant to: an audit trail that prunes
  itself answers "what happened in March" with silence. But that makes growth
  an operational fact somebody has to plan for, and it is stated here because
  `outbox_events` states the same thing in the neighbouring package while this
  section used to say nothing at all.
- `workspace_id` — nullable, and **not a scoping boundary**. The trail records
  invites, role changes and workspace lifecycle alongside content edits, and
  several of those belong to no workspace at all; `activity:read` is still what
  bounds the log. What the column buys is the ability to *ask* a
  workspace-shaped question, which previously had no answer at any price — and
  it is what makes the entry-scoped route above able to fail closed. Filled from
  the emitting event's own `payload.workspaceId`, so a producer that has one
  puts it there.
- **`meta` may carry a `via`** — *how* an action was performed, lifted off the
  actor. A copilot proposal applies under the authority of the person who
  accepted it, so the actor is correctly that human; without `via` the row was
  indistinguishable from one they typed, and under ADR-0009 "Ada updated three
  articles" could equally mean Ada edited three or that Ada accepted one agent
  turn that rewrote them. A revision restore reuses the same seam. Merged into
  the kind's own `meta` rather than replacing it, and absent on the
  overwhelming majority of rows.

## The catalogue — two lists, pinned in both directions

`AUDITED_EVENT_KINDS` is what the mappers **consume**; `AUDIT_KINDS` and
`AUDIT_SUBJECT_TYPES` are what they **produce**. They are different lists
(`member.*` and `user.disabled` collapse onto `user.*` audit kinds), and only
the second pair is a client contract.

The produced pair is declared by hand — deriving it would mean running every
mapper, and several legitimately throw on a payload that cannot name their
subject — so `audit-event-mapping.spec.ts` proves the declaration honest by
driving **every** mapper once, then checks it against the admin's
`ACTIVITY_KINDS` in both directions. A kind the server can write and the admin
would render as a raw token, and a dead label the server can no longer produce,
are both failing tests.

The spec reads the admin's catalogue module **as text**. An ordinary import
would work and would also put `@ortha/activity-admin` in this package's
project graph — `nx sync` adds the TypeScript project reference immediately, and
the audit plugin starts depending on a React package. Keep that module
import-free at the other end, or move both lists into a shared package.

## The copilot tool (`src/lib/copilot/`)

`ActivityCopilotToolProvider` binds one read tool, `activity_recent`, wrapping
`ActivityService.list`. It registers **itself**, from its own `onModuleInit`,
against an `@Optional()` `ToolRegistry` — the module simply lists it among the
providers. A deployment with neither the copilot nor MCP is normal, and the
optional injection is what makes the absence a working configuration rather
than a start-up failure.

**The tool is deployment-wide, not workspace-scoped, and that is not an
oversight.** The trail records invites, role changes and workspace lifecycle
alongside content edits, and several of those belong to no workspace at all.
`activity_events` now carries a nullable `workspace_id` (see Schema above), so
the tool *could* be narrowed where it once could not — but a narrowing that
silently drops every workspace-less row is not the same as a boundary, and the
thing that actually bounds this tool is `activity:read`. The description says
deployment-wide because that is what it is.

What bounds it is `activity:read`, admin-only in the v1 role matrix and the same
key guarding `GET /api/activity`. The copilot's capability profile withholds the
tool at **offer** time, so a viewer's or contributor's run is never told it
exists (ADR-0005 §3), and re-checks at execution. An admin asking their copilot
about the audit log reads exactly what the Activity page already shows them.

`meta` is passed through rather than stripped. It is an open per-kind payload
and some of it is user-authored, so it is untrusted — but it reaches the model
inside the run engine's `fenceUntrusted` envelope like every other tool result.
The fence is what makes that safe; omission would only make the tool less useful.

## Architecture

- `ActivityModule.forRoot()` is **global** and **exports `ActivityService`** +
  the `ACTIVITY_RECORDER` binding. `ActivityPlugin()` returns the `ServerPlugin`
  with a `migrations` descriptor (`__drizzle_migrations_activity`). Register it
  **after** `DatabasePlugin` + `IdentityPlugin`.
- DB via `@InjectDatabase()` (`Database` alias); guards from identity. Follows
  the `server-plugin` skill: feature-then-kind layout, thin controller,
  permission-by-constant, JSDoc on exports, `interface` for contracts.

## Commands

- `npx nx test @ortha/activity-server` — the unit suite, DB-free and a couple
  of seconds. Beyond the mapping parity net it holds three checks made of
  *absences*, which no e2e run can see: `package-shape.spec.ts` reads the source
  tree for a second writer, a connection opened here, a second table, or an
  UPDATE/DELETE against the log; `audit-event.subscriber.spec.ts` pins that the
  subscriber's `kinds` **is** `AUDITED_EVENT_KINDS` rather than `'*'`;
  `activity-list-order.spec.ts` and `activity-filter.spec.ts` render the built
  predicate and order clause with Drizzle's own dialect.
- `npx nx run "@ortha/activity-server:db:generate" --name=<change>` (commit the SQL)
- `npx nx typecheck @ortha/activity-server` / `npx nx lint @ortha/activity-server`
