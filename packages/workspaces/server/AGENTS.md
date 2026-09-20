# @orthacms/workspaces-server

The **workspaces** bounded context — the tenancy boundary (workspaces, their
memberships, and their content-access grants) and the `WorkspaceGuard` every
workspace-scoped route in other plugins is protected by.

> **Reference implementation of ADR-0003 (tactical DDD inside plugins).** This
> is the first context extracted into the layered shape; later contexts copy it.
> When a layering question is ambiguous, this package is the worked example.

## Layered layout

Unlike a feature-folder plugin (see the `server-plugin` skill), this package is
organized into the four tactical-DDD layers under `src/lib/workspace/`:

```
domain/          # framework-free core — the one hard rule below
  workspace.ts                     # Workspace aggregate root
  membership.ts / content-grant.ts # child entities
  value-objects/                   # Slug, WorkspaceId, WorkspaceColor, WorkspaceStatus
  workspace.repository.ts          # WorkspaceRepository PORT + WORKSPACE_REPOSITORY symbol
  slug-uniqueness.service.ts       # domain service (cross-aggregate rule)
  events/workspace-events.ts       # domain-event factory + kinds
  errors/                          # transport-agnostic domain errors
application/     # orchestration — one use case per state change
  use-cases/                       # create / update / set-status / add|remove-member / grant|revoke-content / delete
  queries/workspace.view.ts        # read-model view types
  content/                         # catalogue + entry-counter readers, content-selection resolver
  ports/                           # secondary ports (CONTENT_CATALOG, CONTENT_ENTRY_COUNTER,
                                   #                  MEMBER_PROVISIONER, WorkspacePurger)
  workspace-purge.registry.ts      # the cross-plugin delete fan-out
  dto/                             # class-validator DTOs (shape checks only)
infrastructure/  # adapters — the only layer that knows Drizzle/pg
  persistence/  # DrizzleWorkspaceRepository, WorkspaceMapper, DrizzleMemberProvisioner, workspace-lock
  purge/        # ApiTokenGrantsPurger — identity's rows, purged from this side (see below)
  queries/      # read models (WorkspaceViewQuery — membership-scoped list, SlugAvailabilityQuery,
                #              MemberLookupQuery, MembershipCheckQuery)
  schema/       # Drizzle tables + external-refs stub
  content/      # the mock catalogue fallback
http/            # thin controllers + the two workspace guards + @CurrentWorkspace
```

## The tenancy boundary — membership, not permissions

**Membership decides _where_ a user may act; permissions decide _what_ they may
do. Both must pass.** Holding `workspaces:update` does not grant reach into a
workspace you don't belong to, and no endpoint ever returns one.

- **`GET /api/workspaces` is membership-scoped.** It serves
  `WorkspaceViewQuery.listForMember(actor.id)`; there is deliberately **no**
  unscoped `listAll()` on the query. The admin's sidebar quick-list, workspace
  switcher, command palette, home widgets, and the workspaces table all render
  from this one response, so scoping it here scopes all of them at once — and
  the list can't be used to enumerate ids.
- **Every `/workspaces/:id/…` route carries `WorkspaceMemberGuard`** alongside
  `PermissionsGuard` (update, archive/unarchive, delete, add/remove member,
  grant/revoke content, and both entry-count pre-checks).
- **Two guards, one rule.** `WorkspaceGuard` resolves the workspace from the
  `X-Workspace-Id` header (what feature plugins like content and media use);
  `WorkspaceMemberGuard` resolves it from the `:id` path param (what this
  context's own routes use). Both delegate to `authorizeWorkspaceAccess`
  (`http/guards/workspace-access.ts`), so what "has access" means can't drift
  between them. Both are exported from the barrel and provided globally.
- **A non-member always gets a flat 403 — never a 404.** "Not a member" and "no
  such workspace" are indistinguishable, so the routes leak no ids. The guard
  runs before the handler, so the handler's own `WorkspaceNotFoundError → 404`
  is now only reachable for a workspace the caller _is_ a member of (i.e. one
  deleted concurrently).
- **There is still no per-workspace owner or role.** Membership is a pure link:
  any member with `workspaces:update` can add or remove any other member,
  including themselves — self-removal simply ends their own access. The one
  exception is the **last** member, which is refused (see the aggregate's
  invariants): with nobody left, membership-scoping makes the workspace
  unreachable rather than merely unowned.

## The one hard rule

**`domain/` imports NOTHING from `@nestjs/*`, `drizzle-orm`, `class-validator`,
or `infrastructure/`.** It may use `@orthacms/database`'s framework-free
`createDomainEvent`/`DomainEvent` and node built-ins only. The `@orthacms/nx`
layer-boundary lint isn't wired yet — self-enforce it. (The domain service and
value objects are plain classes; the module wires `SlugUniquenessService` via a
`useFactory` so the domain never sees `@Injectable`.)

## The aggregate

`Workspace` is the aggregate root. It owns its `Membership` links and
`ContentGrant`s, mints its own id, and is the **only** way to change workspace
state. Every mutator is idempotent and returns whether it actually changed
anything (so the application records an audit event only on a real change) and
raises a domain event. Invariants guarded here:

- **slug format** — via the `Slug` value object (the regex moved off the DTO's
  `@Matches` into `Slug.create`);
- **no orphaned content** — a workspace can't be deleted while it holds content
  entries (`assertDeletable`), and a grant can't be revoked while that type has
  entries (`revokeContent`); the entry counts come from the content context via
  the `CONTENT_ENTRY_COUNTER` port, so the application supplies them and the
  aggregate decides. When **no counter is bound** the port's fallback reads `0`,
  which is fine for the read-only pre-check endpoints but is _not_ proof of
  emptiness — the `content_*` tables outlive any one boot's plugin list — so the
  delete and revoke use cases check `ContentEntryCounterReader.isBound` and
  refuse (`EntryCountUnavailableError` → 503) rather than trust it. This rule
  covers **content entries only** — the other cross-plugin rows are handled by
  the purge below, not by refusing;
- **no memberless workspace** — `removeMember` throws `LastMemberError`
  (→ 409) rather than removing the final member. Access is membership-scoped,
  so a workspace with no members is unreachable by everyone, including a global
  admin, with no route back to it.

The aggregate exposes its accumulated `changes()` (a small persistence delta) so
`DrizzleWorkspaceRepository.save` emits minimal, idempotent SQL
(`onConflictDoNothing` membership/grant writes) — identical effects to the
transaction-script services this replaced.

## Deleting a workspace — three mechanisms, by what the rows _are_

A workspace's rows live in many plugins, and only some can carry a foreign key
back to `workspaces`. Which mechanism clears a table is a property of what its
rows mean, not of where they live:

| Mechanism        | Tables                                                                                                                                        | Why                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cascade**      | `memberships`, `workspace_content`, `saved_views` (+ `saved_view_defaults` via `view_id`), `copilot_conversations` / `_proposals` / `_skills` | They already have an FK; the database does it.                                                                                                                       |
| **Refuse** (409) | every `content_*` table                                                                                                                       | Entries are **authored records**. A user deletes their content deliberately — we never do it for them, so `assertDeletable` blocks the delete while any remain.      |
| **Purge**        | `media_asset`, `media_folder`, `api_token_workspaces`, `alarm_rules` + `alarm_findings`, `entry_access`, `content_entry_revisions`            | Pure **scoping** rows with no independent meaning once the workspace is gone: a folder tree, a token's workspace bucket, a rule about content that no longer exists. |

The purge closes a real gap: those tables have no FK by design (a cross-plugin
FK would couple their schemas to this one), and nothing removed them, so a
delete left rows pointing at an id that resolved to nothing — a credential still
scoped to a dead workspace, and media rows whose blobs no later request could
reach to reclaim. An alarm rule was the worst of them, because it is not inert:
the sweep reads `allActive()` without asking whether the workspace still exists,
so an orphan is re-evaluated forever while being unreachable from an editor that
no longer opens. Revisions escape the **Refuse** column in both directions —
`countWorkspaceEntries` sums live entry tables only, so a workspace whose entries
were all deleted counts as empty and strands its whole version timeline.

**One table is deliberately left dangling: `segments.workspace_ids`.** It is an
array, so it can carry no FK, and its own docblock records the reasoning — an id
that matches nothing _narrows_ the audience, while removing it would silently
widen who may read an entry. Fail-safe beats tidy here.

Adding a workspace-scoped table means choosing one of these three. If it is
neither cascading nor covered by the refusal, it needs a `WorkspacePurger` — see
`application/ports/workspace-purger.port.ts` for where the implementation lives
(dependency direction decides, not taste).

`WorkspacePurgeRegistry` (`application/`) is the fan-out, and
`WorkspacePurger` (`application/ports/`) is what a contributing plugin
implements. Registration is a **call from `onModuleInit`**, not a DI
multi-binding — Nest has no multi-provider token — exactly like `ToolProvider`.

Two rules that are easy to get wrong:

- **`purge()` runs inside the delete's transaction**, so its rows commit or roll
  back with the workspace, and a throwing purger aborts the whole delete. A
  partial purge is precisely the orphaning this exists to prevent.
- **Anything non-transactional is deferred.** Blobs in object storage cannot
  join a transaction, so a purger returns a `reclaim` thunk and the use case
  runs it **after** the commit — the same ordering media's own asset delete
  uses. A failed reclaim is logged and swallowed: the rows are already gone, so
  raising would report a failed delete that succeeded.

**Where an implementation lives follows the dependency direction.**
`media/server` depends on this package, so its purger lives there and registers
itself. Identity is the reverse — _this_ package depends on identity, so
identity cannot depend back — which is why `ApiTokenGrantsPurger` sits here in
`infrastructure/purge/`, reaching into identity's table the same way
`DrizzleMemberProvisioner` already reaches into `users`. Purging a token's
bucket narrows what that credential can reach; it does **not** revoke the token,
which would be a policy decision this has no standing to make.

## Ports & adapters

- `WorkspaceRepository` (`WORKSPACE_REPOSITORY`) → `DrizzleWorkspaceRepository`.
  `findByIdForContentMutation` loads under the workspace's **exclusive** advisory
  content lock — the loading strategy for delete/revoke, serializing against
  concurrent entry writes (which take the _shared_ lock, exported for
  `content-server`). The lock is private infrastructure.
- `MemberProvisioner` (`MEMBER_PROVISIONER`) → `DrizzleMemberProvisioner`:
  provisions pending users for invited emails, drops stale ids.
- `CONTENT_CATALOG` / `CONTENT_ENTRY_COUNTER`: secondary ports **this context
  owns** and `content-server` binds — the acyclic inversion (content depends on
  workspaces for its route guards, so workspaces must not depend on content).
- `WORKSPACE_DIRECTORY` → `WorkspaceExistenceQuery`: the same inversion pointing
  the other way. **Identity** owns this port (this package depends on identity,
  so identity cannot depend back), and binds it here so minting an API token can
  reject a bucket naming a workspace that does not exist —
  `api_token_workspaces` deliberately carries no cross-plugin foreign key, so
  this is the only thing standing between a typo and a token scoped to nothing.
  Answers **existence**, not status: an archived workspace is still a valid
  scope.

## Unit of work + outbox

Each state-changing use case runs inside `UnitOfWork.run` (one transaction),
loads the aggregate via the repo port, calls one aggregate method, `save`s, and
appends `aggregate.pullEvents()` to the transactional outbox (`OutboxWriter`).
Reads (list / check-slug / counts / view assembly) bypass the aggregate as thin
CQRS query services.

## Audit — outbox only

Audit runs **entirely through the outbox**; the in-band `ACTIVITY_RECORDER`
calls this section used to describe are gone (`grep -rn ACTIVITY_RECORDER
packages/workspaces/server/src` finds only a comment). Each use case appends
`aggregate.pullEvents()` inside the same transaction as the state change, and
`activity/server`'s `audit-event.subscriber.ts` is the single consumer. Atomicity
comes from the outbox write sharing the mutation's transaction — do **not** also
call a recorder. The event `kind` strings match the audit kinds, which is why
that move needed no data change.

## Schema note

`memberships.user_id` carries a cross-context FK to identity's `users(id)`. The
schema references `users` via a **reference-only stub**
(`infrastructure/schema/external-refs.ts`, not re-exported), so `drizzle-kit
generate` bundles a pure-Drizzle graph (importing identity's runtime barrel would
pull its NestJS providers into drizzle-kit's esbuild, which has no
`experimentalDecorators`). Runtime queries use identity's real table via the
services. Identity owns and migrates the physical `users` table (applied first).

## OpenAPI response schemas (`src/lib/docs/`)

The plugin describes its own responses through `ServerPlugin.docs.decorate`.
`@nestjs/swagger` reads the request side from the DTOs' `@ApiProperty`, but
every response here is a plain `interface` — `WorkspaceView`,
`{ count: number }`, `{ available: boolean }` — which is erased at compile time
and carries no metadata, so the scanner published `{ '200': { description: '' } }`
for all thirteen operations and a client author had to curl the API to learn
the shape. Rather than turn the view types into decorated classes, the pass
writes plain OpenAPI schema objects straight onto the finished document (the
mechanism is documented in
[`packages/bootstrap/server/AGENTS.md`](../../bootstrap/server/AGENTS.md#the-response-schema-gap)).

- `workspace-schemas.ts` — the schemas as data. `color` and `status` are
  enumerated **from the value objects that already constrain them**
  (`WORKSPACE_COLORS`, `WORKSPACE_STATUSES`), so the document cannot claim a
  value `WorkspaceColor.create` would reject.
- `describe-workspaces-api.ts` — the route table, keyed by what follows
  `/workspaces`, and the pass itself.

Two rules the content plugin learned the hard way and this one inherits:

- **Never invent a status code.** The schema goes onto whichever 2xx key the
  scanner already emitted (`201` for a `@Post`, `200` elsewhere). The two
  `DELETE`s answer `204` and are deliberately absent from the table — there is
  nothing to say about a response that has no body.
- **Match routes precisely.** One regex, anchored so only a segment boundary or
  the end of the path may follow `/workspaces`. Content's pattern once matched
  two surfaces at once and published the admin's shapes on the public API.

The documented failure on the `{id}`-scoped routes is **403, not 404** — and
that is the interesting line. `WorkspaceMemberGuard` answers a flat 403 both for
a workspace the caller is not a member of and for one that does not exist,
precisely so the two cannot be told apart; a documented 404 would describe an
existence probe this API refuses to offer. Verified against a running server,
not read off the controller.
