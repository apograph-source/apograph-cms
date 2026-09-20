# `@orthacms/protection-server`

The **publication-protection plugin** — a per-content-type rule requiring N
approvals before an entry may be published
([ADR-0017](../../../docs/adr/0017-publication-protection.md)). Three tables, the
rule surface, and the review surface those rules govern.

**Layout: layered (ADR-0003)**, in the thin-context shape `alarms` uses — a
Drizzle-backed repository and a service, not an aggregate. The only invariant
here is a unique index, and ADR-0003 is explicit that a thin context gets
mappers rather than a domain port with one implementation.

```
src/lib/
  protection.module.ts        the one dynamic module — takes no config
  protection.events.ts        the four domain-event kinds and their builders
  domain/errors/              transport-agnostic failures
  application/
    protection-rules.service.ts  which types a workspace may protect, + defaults
    entry-review.service.ts      the state of one entry, and the four writes
    review-queue.service.ts      every open request in the workspace
    dto/                         save-rule · request-review · no-body · queue-query
  infrastructure/
    schema/                   protection_rules · review_requests · review_approvals
    protection-rule.repository.ts  storage, and the upsert
    review-request.repository.ts   the ask; resolved, never deleted
    review-approval.repository.ts  the votes; every revision, not just the head
    head-revision.query.ts         asks content which version is the head
    reviewer-candidates.query.ts   who may be asked: other members holding content:approve
    purge/                    clears all three when a workspace is deleted
  http/controllers/
    protection-rules.controller.ts  /api/protection/rules
    entry-review.controller.ts      /api/protection/entries/:type/:id
    new-entry-protection.controller.ts  /api/protection/types/:type
    review-queue.controller.ts      /api/protection/queue
  docs/                       the OpenAPI pass — the view is an interface
```

## What it owns

| Route                                        | Scope     | Permission          |
| -------------------------------------------- | --------- | ------------------- |
| `GET /protection/rules`                      | workspace | `protection:manage` |
| `PUT /protection/rules/:kind/:slug`          | workspace | `protection:manage` |
| `DELETE /protection/rules/:kind/:slug`       | workspace | `protection:manage` |
| `GET /protection/entries/:type/:id`          | workspace | `content:read`      |
| `GET /protection/types/:type`                | workspace | `content:read`      |
| `POST /protection/entries/:type/:id/request` | workspace | `content:update`    |
| `DELETE …/request`                           | workspace | `content:update`    |
| `GET …/reviewers`                            | workspace | `content:update`    |
| `POST …/approve`                             | workspace | `content:approve`   |
| `DELETE …/approve`                           | workspace | `content:approve`   |
| `GET /protection/queue`                      | workspace | `content:read`      |

`protection:manage` is administrator-only and has **no `protection:read` beside
it** — the only such asymmetry in the catalogue. A contributor does need to know
that _this entry_ wants two approvals, and that answer comes from
`GET /protection/entries/:type/:id` under `content:read`, not from the
workspace's rule table. Nobody else has a reason to read the table, and a key
nobody needs is a key that only ever gets granted by accident.

`content:approve` is granted to **contributor and admin, never viewer** —
approving is an editorial act — and to **no API token scope at all**
(`protection:I-12`, pinned in identity's `api-token-scope.spec.ts`). A token
names nobody, so ADR-0017 §6's refusal to offer an approve tool on any agent
surface would buy nothing if minting a key cast the vote the tool may not.

The **decision** these rules feed — may this person publish this entry — is
`evaluateProtection` in `@orthacms/protection-domain` and is not re-implemented
here. `EntryReviewService` reads the rule, the head revision and the votes, and
hands all three to the kernel; `PublishProtectionGuard` does the same on the
publish path.

## The guard is where a rule becomes real

`PublishProtectionGuard` implements `content-server`'s `ContentPublishGuard` and
is registered with `contentPublishGuardRegistrar('protection', …)`. Because that
port is consulted from the publish **use-cases**, one registration covers every
caller at once — the admin's button, the public REST route, the GraphQL mutation
and the MCP tool all funnel through `PublishEntryUseCase` or
`BulkPublishEntriesUseCase`. Nothing here enumerates them, which is the entire
argument for a port over a patch: a publish route added tomorrow is guarded the
day it is written.

**The order of its own checks is load-bearing.** The rule lookup comes first, so
an installation with the plugin registered and no rule on this type pays for one
indexed read and nothing else (`protection:I-02`, asserted on the collaborators
that were _not_ called, since a passing publish would prove nothing). The token
gate comes second, before the count and regardless of it. Only then are the head
revision and the votes read.

**A refusal is 409, never 403.** A 403 is indistinguishable from lacking
`content:publish`, and the caller has to tell "ask an administrator for the
permission" from "ask a colleague for an approval". The two 403s the guard does
emit are about the **bypass** — a thing the caller may not do. A bypass is an
explicit `{ bypass: true }` on content's publish route and carries no reason:
bypass reasons were removed with review notes, and the row records the actor,
the rule and how far short the count was.

**`isAdmin` is `protection:manage`, not the role key** — the same reading
`EntryReviewService` uses to tell the panel a bypass is available. If they
diverged the editor would offer a button the API then refused.

**The bypass event is returned, not written.** The guard hands
`entry.publish_bypassed` back in its verdict and content appends it to the outbox
with the status change, so the row that excuses a publish commits with it or not
at all. The actor is stamped by the use-case, which is the layer that knows what
to call them.

**Closing a request on publish is a subscriber, not a call.** `entry.published`
already exists; `EntryPublishedSubscriber` reacts to it and resolves the open
request. So the ask closes however the entry went out — button, API, bulk,
bypass — with no list of publish routes to keep in step. Delivery is
at-least-once, so it is idempotent, and a failure is logged rather than thrown:
the entry is already published and a retry loop over a committed publish is worse
than a stale queue row.

## How the head revision is reached

An approval is bound to a **revision**, so recording one means knowing which
version is currently the head and who wrote it. `content_entry_revisions` is
**host-owned** and modelled by `content-server`: this package owns none of it,
cannot declare a foreign key into it, and has no business knowing its column
names.

So `HeadRevisionQuery` asks content through its existing `RevisionStore` port,
which the review-routes PR exports from `content-server`'s barrel and its module
— the whole change to content in that PR. `RevisionStore.list` already answers
"newest-first, for this content type, in this workspace", which is both the
question and the authorization check an entry route needs before it records
anything: an entry with no revision under that type in that workspace is one
this workspace cannot review.

A new narrow port (`CONTENT_HEAD_REVISION`) was considered and rejected — a
second port over the same table is a second thing to keep in step for no gain.
Reaching into the table directly was rejected for the reason above.

## Every number comes from the kernel

`ProtectionDecision` carries `given` and `stale` only on its **refusal** branch:
the publish path needs them to say "2 required, 1 given", and a satisfied
publish needs no numbers. The editor does need them — it draws "2 of 2" — and
the obvious fix, counting the votes in the service, is the one thing this
package must not do. A count computed twice is a panel that disagrees with the
API refusing the publish, and it would disagree first on exactly the paths
nobody exercises: `countStaleApprovals` and the four-eyes exclusion.

So the kernel exports **`countApprovals`** beside `evaluateProtection`, and
`evaluateProtection` calls it: one answers _may this ship_, the other _where does
the count stand_, over one implementation. The panel asks for the numbers rather
than asking the gate a question rigged to be refused. `PublishProtectionGuard`
takes the same route in the other direction — it reads the decision, never the
counts — so the button and the refusal are the same arithmetic.

## Verdicts for a version that does not exist yet

The editor's Publish saves whatever is unsaved before it publishes, and on a
create form it creates the entry. Both write a version **no vote is bound to,
authored by the person pressing the button** — so the stored head's verdict is
not the one that publish meets. A button reading only the head offered an
ordinary publish the guard then refused.

Two reads answer for that version, and neither counts anything itself: each
hands `evaluateProtection` a head id no stored vote can match (the empty
string — every vote names a real revision uuid) with the caller as its author.

- **`EntryReviewView.afterSave`** — the entry's votes against that hypothetical
  head. The four-eyes exclusion then removes the caller's own approvals, and
  `countStaleApprovals` keeps everybody else's, exactly as they would after a
  real save.
- **`GET /protection/types/:type`** (`NewEntryProtectionController`) — the same
  with no votes at all, for a create form. Unknown and ungranted types are one
  404, for the reason every route here gives.

The admin also stopped saving an **unchanged** record before publishing it
(content's `usePublishEntryFlow`). That save used to move the head off the
version reviewers had just approved, and the publish that followed was refused
for the approval it had itself made stale.

## The decisions that are easy to get wrong

**Registering the plugin must change nothing.** With no rule row, publication
behaves byte for byte as it does with the plugin uninstalled — that is
[`protection:I-04`](../../../docs/design/protection.md), it is the state every
existing installation is in, and it is the first thing to keep true. The plugin
takes **no configuration** for the same reason: the rule table is the whole
configuration surface and its empty state is the off state.

**`PUT` replaces; it does not patch.** Every field is optional and every omitted
one takes its _default_, not its previous value. The settings form always sends
all six, and a partial body that quietly kept old values would make "what does
this rule do" a question about history rather than about the request. The
defaults live in `RULE_DEFAULTS` in the service — once, next to the reason — and
`definedOnly()` is what makes "omitted means default" true rather than nearly
true: `class-transformer` materialises an omitted optional as an explicit
`undefined`, which spread over the defaults would store a null.

**Unknown, wrong-kind and ungranted all answer 404.** Content's own
`resolveGrantedType` makes the same choice: telling them apart lets a member of
one workspace enumerate the deployment's content model through this tab.

**`DELETE` checks no grant and is idempotent.** Asking for a type to be
unprotected succeeds when it already is, and a rule stranded by a revoked grant
is precisely the row an administrator is trying to clear — a 404 would leave one
nothing in the product could reach. For the same reason `GET /rules` does **not**
filter by the current grants.

**A request is resolved, never deleted; an approval is deleted, never resolved.**
Withdrawing a request frees the partial unique index for the next ask while
leaving the row as history, so "sent for review on Tuesday, pulled back an hour
later" stays answerable and the audit row still points at something. Withdrawing
an _approval_ removes it outright — and only on the head. A vote on an earlier
version is already not counting, and deleting that one would erase the
struck-through line that is the only explanation for why the number moved after
a save.

**A request names people; it never gates.** `review_requests.reviewer_ids` is who
was asked, in the order they were picked — the editor lists them and "Waiting on
me" filters by them — but it is not an input to `evaluateProtection`: anyone
holding `content:approve` except the head's author may still approve
(`protection:I-22`). Every named reviewer must come from
`ReviewerCandidatesQuery` — another member holding `content:approve` — so nobody
sits in a request as a pending reviewer with no way to approve; anybody else is
one 422 that names nobody. It is an array on the row, not a table: always read and
written whole with its request, and small.

**There are no notes and no _request changes_.** Review notes, approval notes and
the changes-requested vote were removed together (migration `0001` deletes those
votes before dropping `decision`, so none of them turns into an approval). A row
in `review_approvals` is an approval. The approve route declares an empty body
so a client still sending `note` is told with a 400 instead of believing it was
stored. Historic `review.changes_requested` rows stay in the activity log.

**The four-eyes check refuses the write, not just the count.** The kernel
excludes the head author from the count, so a stored self-approval would be a row
that silently never counts: the reviewer sees their name in the list, the number
does not move, and nothing says why. `POST …/approve` answers **409** — not 403,
because the caller does hold `content:approve` and a 403 would send them asking
an administrator for a permission they already have.

**`managesProtection` is a permission, not a role.** Withdrawing somebody else's
request and being told a bypass is available both hang off `protection:manage`
rather than off the `admin` role key, because `system-roles.ts` says outright
that _"the routes gate on the permission, never on the role"_ — an operator who
mints a custom role holding that key has said that role administers protection
here.

**The upsert is one statement, not read-then-write.** Two administrators saving
the same tab would both find no row and both insert, and the second would 500 on
the unique constraint. `onConflictDoUpdate` lets the database arbitrate, which
it already knows how to do.

## The tables

Three, and **not one of them carries a foreign key into another plugin's
schema**:

- `workspace_id` — `workspaces` belongs to `workspaces-server`, and cross-plugin
  FKs are not how this codebase scopes rows. `ProtectionWorkspacePurger` is what
  removes them instead (`protection:I-16`, swept by
  `workspace-delete-residue.spec.ts`).
- `updated_by` / `requested_by` / `user_id` — the person may be deleted and the
  rule must outlive them.
- **`revision_id` — `content_entry_revisions` is host-owned**: `content-server`
  emits no migrations for it, the host's drizzle config re-exports it into the
  diff, and a plugin cannot declare an FK into a table whose migration it does
  not own. The integrity that matters is not referential anyway — a deleted
  revision leaving an approval that matches no head is exactly the wanted
  behaviour.

`kind` is `text` with a **check constraint**, not the `content_kind` enum: that
enum belongs to `workspaces`' schema, and importing another plugin's schema
object to share a type is a dependency this package should not take.

`review_requests` has a **partial** unique index on `entry_id where resolved_at
is null` — one _open_ request per entry, so asking twice replaces the reviewers rather
than stacking a second row into the reviewer's queue, while a resolved request
stays as history and does not block the next ask.

## The batched status read

`ReviewStatusQuery` answers "where does each of these entries stand" for a whole
records page in **four queries whatever the page holds** — the heads (through
content's batched `RevisionStore.heads`), every vote on those entries (one query
over the denormalised `entry_id`), the open requests over those same ids (one,
for the `requested` flag), and the workspace's rules (one, and the rule set is
one row per protected type).

The shape is the point. A column asking the single-entry review route per row is
an N+1 over a page whose size the user chose, and it is the reason `heads` was
added to content's port at all. `review-status.spec.ts` pins the count **flat** — one page against
another, never a number — and that test, not this paragraph, is what keeps the
shape true: mutating the query into a per-entry read takes it from 8 to 17. The
number itself is documentation, which is how this paragraph said "three" for as
long as the open-requests read has existed.

It counts through **`countApprovals`**, the same kernel function
`evaluateProtection` calls. A cell reading "2 of 2" beside a Publish button that
then refuses is the failure this avoids, and it is the third time that rule has
had to be stated — see _Every number comes from the kernel_ above.

## The `reviewState` filter field

Contributed through content's `ENTRY_FILTER_PROVIDER` registry, so it joins the
records list's own query builder — which is what makes saved views and alarms'
"Save as rule" work over review state with no code of their own.

**It filters on whether a review was asked for, not on the tally.** The obvious
field is the counter the column shows, and it is deliberately absent: the tally
depends on the head revision, on `requireOtherPerson` against the head's author,
and on `countStaleApprovals`, so answering it in SQL means a second
implementation of `countApprovals` written in Drizzle. That would drift
**silently**, because a filter that is merely wrong still returns rows. Whether
an open request exists is one row keyed by entry id with no counting in it, and
it is the question a reviewer actually saves a view for.

The three obligations the registry states are met and tested: the subquery is
workspace-scoped (a virtual field is a subquery over a table content has never
heard of, and forgetting the workspace turns a filter into a cross-tenant read),
only `eq` and `in` are declared and the admin's `FilterField.operators` is
narrowed to match, and it narrows a list rather than deciding visibility.

## The three tools, and the fourth that does not exist

`protection_review_status`, `protection_review_diff` and
`protection_request_review`. Each declares `surfaces` **explicitly** — omitting
the field in `tools/server` means _both_ consumers, so silence would hand a tool
to MCP by accident rather than by decision.

`review_diff` is the valuable one: what changed between the head and the last
version _this caller_ approved. Revisions make that exact rather than a
paraphrase, and it is the question a returning reviewer actually has. It compares
through content's own `diffSnapshots` rather than a second comparison written
here, for the same reason nothing here counts votes.

`protection_request_review` names reviewers **by email** (or id): a model has no
roster to read ids from. It resolves them against `ReviewerCandidatesQuery` and
writes through `EntryReviewService.requestReview`, the route's own path, so a run
cannot ask somebody the picker would not offer; an unknown name fails with the
list of who can be asked, which is what lets a model correct itself in one turn.

**There is no approve tool**, on any surface, now or
later. ADR-0017 §6 carries the argument. `protection:I-17` pins it against the
**catalogue** rather than a list of names — anything that could record an
approval would have to appear there to be callable — and until this PR the
invariant held vacuously, because the plugin contributed no tools at all.

## Not here yet

Deliberately:

- **Scheduled publishing.** The rule must be evaluated when the timer fires
  rather than when the schedule is set, and a fired timer has no human, so a
  bypass cannot apply to it. That needs the scheduler to exist (ORT-210).
- **Mail on a review request.** After the mail port (ORT-207). Until then the
  reviews page is the only way a reviewer learns there is work.
- **`transfer` on a protected type** is not an open question so much as an
  unreachable one: `ImportEntriesUseCase` calls only `writer.create`/`.update`,
  and a create on a publishable type is stamped `draft`, so an import cannot
  publish and never meets the guard. It becomes a real question the day import
  gains a publish step.
