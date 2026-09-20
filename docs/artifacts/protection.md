# Publication protection

A per-content-type rule requiring N approvals before an entry may be published — the
third gate on publication, after the `content:publish` permission and after the publish
gate. It answers **who may ship this now**, never whether the entry is complete.

The decision behind it is [ADR-0017](../adr/0017-publication-protection.md); the
cross-cutting technical description is [`docs/design/protection.md`](../design/protection.md).
This dossier is the combined technical and business description, and every claim in it was
read out of the source rather than out of those two documents — where they disagree with
the code, §16 says so.

**Packages:** `@orthacms/protection-domain`, `@orthacms/protection-server`,
`@orthacms/protection-admin`. **Tables owned:** three. **Configuration:** none.

## Contents

1. [Business description](#01-business-description)
2. [Composition of the package group](#02-composition-of-the-package-group)
3. [Roles and permissions](#03-roles-and-permissions)
4. [The decision — the truth table](#04-the-decision--the-truth-table)
5. [Data model](#05-data-model)
6. [Lifecycles](#06-lifecycles)
7. [Scenarios — how it works step by step](#07-scenarios--how-it-works-step-by-step)
8. [HTTP API](#08-http-api)
9. [Agent surfaces](#09-agent-surfaces)
10. [The admin UI](#10-the-admin-ui)
11. [Configuration](#11-configuration)
12. [Security and resilience](#12-security-and-resilience)
13. [Invariants](#13-invariants)
14. [Testing checklist](#14-testing-checklist)
15. [Boundaries of responsibility](#15-boundaries-of-responsibility)
16. [Where the code and the documentation diverge](#16-where-the-code-and-the-documentation-diverge)

## 01. Business description

### The problem it solves

Before this plugin there was no editorial review in the CMS, and no way to arrange one out
of the parts that existed. The `contributor` role holds `content:publish` alongside
`content:create`, `content:update` and `content:delete` — the only role that can write is
also the role that can ship. An installation that wants "a writer drafts, an editor
publishes" could not express it, and one answering an auditor's four-eyes requirement could
not answer it at all.

A **protection rule** says that entries of one content type, in one workspace, need N
approvals before they may be published. It is branch protection, not a workflow: no chain
of stages, no assignment that transfers ownership, no new entry status. An approval either
exists on the current version or it does not.

### Three properties carry the design

- **An approval belongs to a revision.** `content_entry_revisions` already snapshots every
  save, numbered per entry and keyed per locale. A `review_approvals` row carries
  `revision_id`, so a later save leaves the vote off the head — **with no dismissal logic
  anywhere**. Nothing is deleted; the interface strikes the name through and says which
  version it was given on, because a counter that silently rolls back is unexplainable to
  the person who just pressed Save.
- **It authorizes, it never validates.** The publish gate keeps sole ownership of "is this
  entry complete" ([ADR-0015](../adr/0015-alarms-are-non-blocking.md)). Protection cannot
  read a field value — there is nowhere in `ProtectionInput` to put one.
- **It is inert until a rule exists.** No row in `protection_rules` means no predicate, no
  approval read, no revision read, no chip in the interface. Every installation that
  upgrades into this plugin is in that state.

### Who sees it

| Person                         | What they see                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A contributor writing an entry | A chip beside the title, a **Review** block in the properties rail, a Publish button held with the reason, and a way to ask named people to look                               |
| A reviewer                     | The workspace's **Reviews** page (an ask arrives against whichever type someone was editing, so no single collection's list can hold it), plus an Approve control on the entry |
| An administrator               | The workspace settings **Protection** tab, where a rule is written; and a confirmed bypass on a held entry                                                                     |
| A viewer                       | `content:approve` is withheld from them, so they read the state but never vote                                                                                                 |
| A reader of the public API     | **Nothing.** No status is added, and no review state is readable through REST, GraphQL, MCP or a webhook payload                                                               |

### What protection is not

- **Not a workflow engine.** `status` keeps its two values, `draft` and `published`. Review
  state is derived from the rule, the head revision and the votes on it — never stored on
  the entry.
- **Not a validator.** It never inspects content. A protected entry that fails the publish
  gate fails the publish gate, and a bypass does not change that.
- **Not a reader-visibility rule.** Who may _read_ published content is `segments`'
  question; who may _touch_ it is RBAC's and `workspace_content`'s.
- **Not an assignment model.** A request names people, and who was named never changes
  whose approval counts: anyone holding `content:approve` may approve, except the head
  revision's author when `require_other_person` is on.
- **Not a second opinion on content quality.** That is `alarms`, and alarms block nothing.

## 02. Composition of the package group

Three packages, one dependency arrow, and it points one way only — `protection → content`,
never back.

| Package                      | What it is                                                                                                                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protection/domain` | The framework-free kernel: `ProtectionRule`, `Approval`, `ProtectionActor`, `ProtectionInput`, and the two functions `evaluateProtection` / `countApprovals`. Four source files, `kernel-boundary.spec.ts` among them, which is what keeps Nest, Drizzle and React out |
| `packages/protection/server` | The plugin: three tables and their migrations, the publish guard, six controllers, the outbox subscriber, the records filter field, the Insights aggregate and the three agent tools                                                                                   |
| `packages/protection/admin`  | Eight slot contributions and one route of its own                                                                                                                                                                                                                      |

### The server package's layout

Layered, per [ADR-0003](../adr/0003-tactical-ddd-inside-plugins.md):

```
src/lib/
  application/      services + DTOs (rules, entry review, queue, status, insights)
  domain/errors/    six typed errors the controllers map to HTTP
  http/controllers/ six controllers
  infrastructure/   repositories, the publish guard, the head-revision query,
                    the outbox subscriber, the reviewState filter provider, the purger
  tools/            the three agent tools
  types/            the response views
  docs/             the OpenAPI decoration
  utils/            the `ProtectionPlugin()` factory
```

### What it depends on, and why registration order matters

`ProtectionPlugin()` must be registered **after** `ContentPlugin` — it reads content's type
registry and `WorkspaceGrantsQuery` to decide which types a workspace may write a rule for,
and registers itself into content's publish-guard registry and filter-field registry — and
after `WorkspacesPlugin`, whose guard scopes its routes and whose purge registry clears its
rows. Both registrars inject optionally, so a host that runs neither still boots.

The module is **global**, because the rule lookup has to be injectable from where the
publish path is actually guarded: `PublishProtectionGuard` runs inside content's write
transaction, not from a route of this package's own.

## 03. Roles and permissions

Two permission keys, and the asymmetry between them is deliberate.

| Key                 | Held by                                                               | What it opens                                                                             |
| ------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `content:approve`   | `admin`, `contributor` — **not** `viewer`, and **no API token scope** | Approving and withdrawing one's own vote; being offered in a reviewer picker              |
| `protection:manage` | `admin` only                                                          | Reading, writing and removing rules; withdrawing somebody else's request; taking a bypass |

There is **no `protection:read`** — the only asymmetry in the permission catalogue, and
`system-roles.ts` argues it: a contributor does need to know that _this entry_ wants two
approvals, but that answer comes from the entry itself under `content:read`, not from the
workspace's rule table, so nobody but an administrator has a reason to read the table, and
a key nobody needs is a key that only ever gets granted by accident.

Granting `content:approve` to `contributor` is what keeps every existing installation
behaving exactly as it does: the role that could already publish can now also approve, and
until somebody writes a rule neither key does anything new.

**No token scope grants `content:approve`** (`api-token-scope.spec.ts` lists `full`
exhaustively). A token names no person, and ADR-0017 §6's refusal to offer an approve tool
on any surface buys nothing if minting a key casts the vote the tool may not.

### How a permission reaches the code — three paths

1. **Routes** — `@UseGuards(PermissionsGuard, WorkspaceGuard)` plus
   `@RequirePermissions(PERMISSIONS.…)` by constant, never by string literal. Writes add
   `OriginGuard`.
2. **Inside the guard and the service** — `PermissionsService` + `AccessPolicy` resolve
   `protection:manage` for the acting user. It is the **permission**, not the `admin` role
   key: an operator who mints a custom role holding it has said that role administers
   protection, and reading the role key would silently ignore them. The publish guard and
   `EntryReviewService` use the same reading, so the editor cannot offer a bypass the API
   then refuses.
3. **The admin** — `useHasPermission('content:approve' | 'content:update')` gates the
   controls, and the nav item and settings tab carry `permission:` so a member without the
   key is shown no link rather than a tab that answers 403.

## 04. The decision — the truth table

`evaluateProtection` is the whole gate, and the order of its checks is load-bearing.

| #   | Condition                                         | Result                                                                                                 |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | No rule, or `enabled = false`                     | `allowed: true`, reason `unprotected`                                                                  |
| 2   | `actor.isToken` and `allow_token_publish = false` | `allowed: false`, reason `token-refused`                                                               |
| 3   | `given >= required_approvals`                     | `allowed: true`, reason `satisfied`                                                                    |
| 4   | otherwise                                         | `allowed: false`, reason `insufficient-approvals`, carrying `required`, `given`, `stale`, `bypassable` |

Two orderings inside that matter:

- **The token gate sits after the rule check**, so refusing a key on a type nobody chose to
  protect cannot break a deployment that never opted in.
- **`bypassable` is reported, never applied.** It says a bypass is possible; the caller must
  still ask for one explicitly (`{ bypass: true }`). A decision that allowed the publish
  here would ship it without the log row that is the whole reason bypassing is permitted.
  `bypassable = admin_bypass && actor.isAdmin && !actor.isToken` — a token never bypasses,
  because there is no name to write into the row.

### Counting

`countApprovals` is exported separately so the editor's "1 of 2", the records column and
the gate that refuses the publish are **one implementation**, not two that agree until
somebody switches on `countStaleApprovals`.

- **Distinct by user, in both modes.** `unique (revision_id, user_id)` stops one person
  voting twice on one version, but nothing stops them approving five versions in a row — and
  a naive sum would turn one reviewer into five the moment stale approvals are counted.
- **`stale`** is the number of distinct people whose only eligible approval sits on an
  earlier revision. It falls to zero on its own when `count_stale_approvals` is on, because
  then they are not stale.
- **A head author that cannot be named excludes nobody.** `headAuthorId = null` (a bearer
  token's write, an import, a migration) means the four-eyes exclusion drops out rather than
  refusing every approval on the entry.
- With **no rule at all**, the counting flags take their documented defaults — author
  excluded, stale not counted — which is what a type shows before anybody protects it.

### Three questions, not one

The editor's Publish button is up to two requests — a save, then the publish — so the
verdict has to be about the version Publish will actually ship. The server computes all
three through the same kernel:

| Read                                | Input                                                   | Answers                                      |
| ----------------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| `EntryReviewView` (the stored head) | the real head id and author                             | a clean editor                               |
| `EntryReviewView.afterSave`         | head id `''` (bound to by no vote), author = the caller | a dirty editor — saving starts a new version |
| `NewEntryProtectionView`            | no revision, no votes, author = the caller              | a create form                                |

## 05. Data model

Three tables, owned by `protection-server`, shipped with its own migrations and its own
journal table `__drizzle_migrations_protection`.

### `protection_rules`

| Column                     | Type                      | Notes                                                                                                                                     |
| -------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | `uuid` pk                 |                                                                                                                                           |
| `workspace_id`             | `uuid` not null           | No FK — cross-plugin FKs are not how this codebase scopes rows                                                                            |
| `kind`                     | `text` not null           | `collection` or `single`, carried by a **check constraint** rather than the `content_kind` enum, which belongs to another plugin's schema |
| `slug`                     | `text` not null           | The code-defined type name                                                                                                                |
| `enabled`                  | `boolean` default `false` | Off behaves exactly as no row. The row is kept so the settings screen remembers the numbers a workspace had chosen                        |
| `required_approvals`       | `integer` default `1`     | Check constraint `>= 1`: a rule that asks for nothing would be indistinguishable in the interface from one that works                     |
| `require_other_person`     | `boolean` default `true`  | The four-eyes switch                                                                                                                      |
| `count_stale_approvals`    | `boolean` default `false` | The editor labels it as not recommended                                                                                                   |
| `admin_bypass`             | `boolean` default `true`  | Off makes the rule absolute, administrators included                                                                                      |
| `allow_token_publish`      | `boolean` default `false` | Off means a bearer token cannot publish this type at all                                                                                  |
| `updated_by`               | `uuid`                    | No FK: the administrator may be deleted and the rule must outlive them                                                                    |
| `created_at`, `updated_at` | `timestamptz`             |                                                                                                                                           |

`unique (workspace_id, kind, slug)` — the same coordinate `workspace_content` uses, and what
lets the upsert avoid a read-then-write. Index on `workspace_id`, the settings tab's only
query.

### `review_requests`

| Column         | Type                    | Notes                                                                                                                                                |
| -------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | `uuid` pk               |                                                                                                                                                      |
| `workspace_id` | `uuid` not null         | Every read AND-s this in                                                                                                                             |
| `content_type` | `text` not null         |                                                                                                                                                      |
| `entry_id`     | `uuid` not null         | The live entry row — one per locale, as revisions are                                                                                                |
| `revision_id`  | `uuid` not null         | The head **at the moment of asking**. Trail only — the request stays open across later saves                                                         |
| `requested_by` | `uuid` not null         |                                                                                                                                                      |
| `reviewer_ids` | `uuid[]` default `'{}'` | Who was asked, in pick order. An array rather than a table: the set is small, always read and written whole, and never changes whose approval counts |
| `created_at`   | `timestamptz`           |                                                                                                                                                      |
| `resolved_at`  | `timestamptz`           | Set when the entry publishes, or when the requester withdraws                                                                                        |

`unique index (entry_id) where resolved_at is null` — one **open** request per entry, so
asking twice replaces the reviewers instead of stacking a second row into somebody's queue,
while resolved requests stay as history. Index on `(workspace_id, resolved_at)` for the
Reviews page.

### `review_approvals`

| Column                                     | Type            | Notes                                                                                                             |
| ------------------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`                                       | `uuid` pk       |                                                                                                                   |
| `workspace_id`, `content_type`, `entry_id` |                 | **Denormalised**, so the queue and the records column can count without joining a table this package does not own |
| `revision_id`                              | `uuid` not null | What makes an approval expire                                                                                     |
| `user_id`                                  | `uuid` not null |                                                                                                                   |
| `created_at`                               | `timestamptz`   |                                                                                                                   |

`unique (revision_id, user_id)`, index on `(workspace_id, entry_id)`. **A row is an
approval** — there is no decision column, because _request changes_ and the notes that went
with it were removed together.

### Four schema decisions worth knowing

1. **No foreign key to `content_entry_revisions`.** That table is host-owned —
   `content-server` emits no migrations for it — and a plugin cannot declare an FK into a
   table whose migration it does not own. The integrity that matters is not referential
   anyway: a revision that is gone leaves an approval that matches no head, which is exactly
   the wanted behaviour.
2. **`reviewer_ids` as an array.** It is read and written whole with its request and gates
   nothing, so a join table would buy nothing.
3. **`kind` as text plus a check.** Sharing the enum would mean importing another plugin's
   schema object.
4. **`updated_by` with no FK.** The rule outlives the administrator who wrote it; the audit
   row names the actor anyway, and this column is for the settings screen.

### The migrations

| File                                | What it does                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0000_init_protection.sql`          | The three tables as first shipped — including `review_approvals.decision` / `note` and `review_requests.note`                                                                                                                                                                 |
| `0001_drop_review_notes.sql`        | **Hand-edited.** `DELETE FROM review_approvals WHERE decision <> 'approved'` runs **before** the column is dropped — dropping it alone would silently turn every "changes requested" vote into an approval. Then the check constraint, `decision`, and both `note` columns go |
| `0002_review_request_reviewers.sql` | Adds `reviewer_ids uuid[] NOT NULL DEFAULT '{}'`                                                                                                                                                                                                                              |

The 0001 ordering is the one piece of this package where a careless migration would have
been a security defect rather than a data loss: every refusal on record would have become
consent.

## 06. Lifecycles

### 6.1 An installation's lifecycle

```
plugin not registered      → the port resolves to "always allowed"; the publish path is
                             the one that ran before the port existed              (I-01)
registered, no rule        → one indexed rule lookup, then allowed. No revision read,
                             no approval read, no permission resolution            (I-02)
a rule written, disabled   → identical to no row, a bearer token included          (I-04)
a rule enabled             → the third gate is live for that type in that workspace
```

### 6.2 A review request's lifecycle

```
opened      POST …/request with reviewerIds   → one open row per entry
re-asked    POST …/request again              → the SAME row, reviewers replaced
saved       the author edits and saves        → the request stays open; only approvals expire
withdrawn   DELETE …/request                  → resolved_at set (requester or protection:manage)
published   entry.published reaches the outbox → resolved_at set by the subscriber
```

A request is a standing ask. An author who fixes a typo after asking has not withdrawn it,
and re-opening one on every save would make the queue churn for reasons nobody watching it
cares about.

### 6.3 An approval's lifecycle

```
cast       POST …/approve → a row on the CURRENT head revision
counted    while the head is that revision
stale      the moment any save writes a new revision — the row is untouched, the count moves
withdrawn  DELETE …/approve, head only — a vote on an earlier version is already not counting,
           and removing it would erase the struck-through line that explains the number
```

Saving never deletes an approval, and always changes which approvals count. That sentence is
the feature.

## 07. Scenarios — how it works step by step

### 7.1 A workspace writes its first rule

1. An administrator opens **Workspace settings → Protection** (the tab is contributed into
   `WORKSPACE_SETTINGS_TAB_SLOT`; it is the one protection surface visible before a rule
   exists, because it is where a workspace goes to get one).
2. The page lists every **publishable** type the workspace was granted, each with its rule
   or "Not protected". A type with no publish step has no transition to hold.
3. Saving sends `PUT /api/protection/rules/:kind/:slug`. The service checks the type is
   registered, of that kind, and granted — all three failures answer with the same 404, so
   the tab cannot be used to enumerate the deployment's content model.
4. The row and a `protection.rule_changed` event commit in **one unit of work**, the event
   carrying both sides of the change. An audit trail that can disagree with the state it
   describes is worse than none.

### 7.2 An author asks for review

1. The entry editor's **Review** block offers _Request review_ to somebody holding
   `content:update`.
2. The picker is `GET …/reviewers` — the workspace's members holding `content:approve`,
   minus the caller. The request route refuses anybody outside that same list
   (422 `protection.reviewer_not_eligible`), so a person who could be picked is a person the
   server accepts, and nobody can be left standing in a request as a pending reviewer with
   no way to approve.
3. Asking is allowed on an **unprotected** type too. Wanting a second pair of eyes does not
   require a rule; what an unprotected type does not do is block.
4. `review.requested` reaches the entry's own history, keyed to the entry rather than to the
   request — somebody asking "why has this not gone out" looks at the record.

### 7.3 A reviewer approves

1. They find the ask on the workspace's **Reviews** page — until the mail port lands
   (ORT-207) that page is the only way anyone learns there is work.
2. _Approve_ sends `POST …/approve`. The vote is recorded against the **current head**, not
   against the revision the request named.
3. The four-eyes rule is enforced **here as well as at publish time**, with
   409 `protection.self_approval_refused`. It has to be: the kernel excludes the head author
   from the count, so a stored self-approval would be a row that never counts — the reviewer
   sees their name, the number does not move, and nothing says why. A 403 would be wrong and
   actively misleading, since the caller does hold `content:approve`.
4. `review.approved` carries the **revision number**, not only its id: an audit row read six
   months later cannot resolve a uuid to "version 7".

### 7.4 The author saves again

Nothing is dismissed. The new revision becomes the head, the earlier votes stop counting,
`given` drops and `stale` rises by the same amount, and the Review block shows those people
with a pending mark and the version their approval sits on. With `count_stale_approvals` on,
the count does not move and `stale` is zero — because then they are not stale.

### 7.5 Publish is pressed

```
PermissionsGuard — content:publish          → 403 (and the button was never rendered)
  publish gate — required field values      → 422 (button disabled, failing checks shown)
    CONTENT_PUBLISH_GUARD — protection      → 409 "2 approvals required on this version, 0 given"
      status → published
```

The editor's verdict comes from `ENTRY_PUBLISH_GUARD_SLOT`, a **hook** called on every
render of the actions cluster, so it may hold state — which is how the bypass dialog's open
flag lives in this plugin rather than in content. It answers for the version Publish will
actually ship: the stored head for a clean editor, `afterSave` for a dirty one, the type's
new-entry read on a create form. Reading only the head made the button offer an ordinary
publish that the API then refused.

It returns **no opinion** — `null` — on a non-publishable type, an unprotected one, and
while the read is in flight or has failed. A guard that blocked on a failed read would make
an unreachable API look like a refused publish; the server refuses regardless, with the
reason, so silence is the honest client-side default.

### 7.6 An administrator bypasses

1. The button stays an ordinary **Publish**; the click opens a confirmation. (The ADR
   originally had the button change label and tone; the 2026-09-11 amendment moved the
   announcement into the dialog.)
2. The dialog states the rule's numbers and says, **before** the click, that this will appear
   in the activity log as `entry.publish_bypassed` with the actor's name and the rule. There
   is **no reason field** — the log row already names who published past which rule and how
   far short it was.
3. Confirming goes back through the **editor's own publish**, so unsaved edits are saved and
   a create form's record created in the same press, with the same busy cover and toasts.
4. The guard returns `allowed: true` **with an event**, and content commits that event in the
   same transaction and outbox append as the status change: the row that excuses a publish
   cannot outlive or be lost by the publish it excused.
5. Where a bypass is not available the refusal is explicit: 403 `protection.bypass_refused`,
   with two different messages — "needs the `protection:manage` permission" when the rule
   allows bypasses, "the rule allows no bypass" when it does not.

### 7.7 A bearer token tries to publish

409 `protection.token_refused`, before any counting, unless `allow_token_publish` is on for
that type. A token holds `content:publish` in the `full` scope and names nobody in the log,
so a rule that let one through by default would be escaped by minting a key.

### 7.8 The entry publishes — the request closes itself

`EntryPublishedSubscriber` listens for `entry.published` on the outbox and resolves the open
request. A subscriber rather than a call in the publish path, because protection cannot reach
into content's use-case and content must not learn what a review request is — and because it
then covers **every** way an entry is published, the admin button, the public API, a bulk
publish and a bypass, with no list of routes to keep in step.

Delivery is at-least-once, so `resolve` is a conditional update and a second delivery finds
nothing open. A failure is **logged, not thrown**: the entry is already published, and a
retry loop over a committed publish is worse than a stale queue row.

### 7.9 The records list — column, filter, saved views

- A **Review column** is contributed for every publishable type, hidden by default like every
  extension column. When switched on it makes **one** request per page:
  `GET /api/protection/entries/:type/status?ids=…`, answered in four queries whatever the
  page holds — batched heads, every vote over the denormalised `entry_id`, the open requests
  over those same ids, and the workspace's rules. The hook is skipped entirely when the
  column is not visible.
- A **`reviewState` filter field** (`awaiting` / `not_requested`) joins the records list's own
  filter tree, which is what makes saved views and alarms' "Save as rule" work over review
  state with no code of their own.
- The filter deliberately does **not** offer the counter the column shows. A tally is not a
  property of a row — it depends on the head revision, on the four-eyes exclusion and on
  `count_stale_approvals` — and answering it in SQL would be a second implementation of
  `countApprovals` that drifts silently, because a filter that is merely wrong still returns
  rows. Whether an **open request exists** is a property of the row, and it is the question a
  reviewer actually saves a view for.
- The subquery is workspace-scoped; a virtual field that forgot that would turn a filter into
  a cross-tenant read.

### 7.10 Bulk publish

The bulk path runs the same guard, and **never sends `bypass`**: a bypass is a deliberate,
confirmed act on one record. Protected entries in a bulk selection are refused individually
and reported.

### 7.11 A grant is revoked, a workspace is deleted

- **Revoked grant.** `GET /protection/rules` still lists the leftover rule — filtering it out
  would leave a row nothing in the product could reach and nothing could delete. `DELETE` does
  **not** check the grant for the same reason: removing protection is always allowed to
  succeed, and it reports whether a row was actually there, because a delete that removed
  nothing is not a policy change and should not produce an audit row.
- **Deleted workspace.** `ProtectionWorkspacePurger` clears all three tables in one
  transaction — approvals, then requests, then rules, the order in which a partial failure
  leaves the least confusing state. It registers **optionally**, so a host without
  `WorkspacesPlugin` boots.

### 7.12 A model helps a reviewer read

`protection_review_diff` answers "what changed since the version I approved" from the
revisions themselves rather than by paraphrase — the question a returning reviewer actually
has. It reports the changed fields and how many are identical, so a model can say "and
nothing else".

## 08. HTTP API

All paths sit under the host's global prefix (`/api` by default) and carry
`PermissionsGuard` + `WorkspaceGuard`; writes add `OriginGuard`.

| Method & path                                   | Permission          | Input                                                          | Success                                                                                                                                                                                  | Failures                                                                         |
| ----------------------------------------------- | ------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /protection/rules`                         | `protection:manage` | —                                                              | Every rule the workspace holds, leftovers included                                                                                                                                       | 403                                                                              |
| `PUT /protection/rules/:kind/:slug`             | `protection:manage` | Six optional booleans/int; omitted means **default**, not null | The stored rule                                                                                                                                                                          | 400 (`required_approvals` outside 1…100), 404 (unknown / wrong kind / ungranted) |
| `DELETE /protection/rules/:kind/:slug`          | `protection:manage` | —                                                              | `204`, idempotent                                                                                                                                                                        | 403                                                                              |
| `GET /protection/entries/:type/:id`             | `content:read`      | —                                                              | `EntryReviewView` — counts, `blocked`, `bypassable`, `afterSave`, head id + number, `callerWroteHead`, `callerApprovedHead`, every vote with its version and staleness, the open request | 404                                                                              |
| `GET /protection/entries/:type/:id/reviewers`   | `content:update`    | —                                                              | `{ candidates: [{ userId, email }] }`                                                                                                                                                    | 404                                                                              |
| `POST /protection/entries/:type/:id/request`    | `content:update`    | `{ reviewerIds: uuid[1…50], unique }`                          | `201`; replaces the reviewers on an open request                                                                                                                                         | 404, 422 `protection.reviewer_not_eligible`                                      |
| `DELETE /protection/entries/:type/:id/request`  | `content:update`    | —                                                              | `204`                                                                                                                                                                                    | 403 (not yours, without `protection:manage`), 404                                |
| `POST /protection/entries/:type/:id/approve`    | `content:approve`   | —                                                              | `201`, upsert on `(revision, user)`                                                                                                                                                      | 404, 409 `protection.self_approval_refused`                                      |
| `DELETE /protection/entries/:type/:id/approve`  | `content:approve`   | —                                                              | `204`, idempotent, head only                                                                                                                                                             | 404                                                                              |
| `GET /protection/entries/:typeName/status?ids=` | `content:read`      | ≤ 100 comma-separated uuids                                    | `{ byEntry: { … } }`; an unreachable entry is **absent** rather than invented                                                                                                            | 400                                                                              |
| `GET /protection/queue?mine&limit&offset`       | `content:read`      | `mine` accepts `1`/`true`; `limit` ≤ 100, default 50           | `{ items, total }`, newest first                                                                                                                                                         | 400                                                                              |
| `GET /protection/types/:type`                   | `content:read`      | —                                                              | `NewEntryProtectionView` for a create form                                                                                                                                               | 404                                                                              |
| `GET /insights/protection/reviews`              | `content:read`      | —                                                              | `{ open, overdue, overdueAfterDays }`                                                                                                                                                    | 403                                                                              |

The publish route itself belongs to `content-server`; protection only contributes the verdict.
Its refusals arrive as `409` / `403` with `code` ∈ `protection.insufficient_approvals`,
`protection.token_refused`, `protection.bypass_refused`, and the insufficient case carries
`details: { required, given, stale, bypassable }`.

### Decisions baked into the contract

- **The queue read is `content:read`, not `content:approve`.** The "My requests" tab is an
  author checking on work they sent; somebody who cannot approve still has to see whether
  anyone has looked.
- **The status read is `content:read`, not `protection:manage`.** Gating it on the admin key
  would blank the records column for the people the column is for.
- **Unknown and ungranted answer identically** — on the rules tab and on every entry route —
  which is content's own `resolveGrantedType` reasoning applied one level down.
- **`PUT` replaces.** Omitted keys fall through to the six defaults, and an explicit
  `undefined` (what `class-transformer` produces for an omitted optional) is dropped before the
  spread, so "omitted means default" is true rather than nearly true. A rule saved with
  `{ enabled: true }` alone is the safest useful rule.
- **`bypassReason` is not a field.** The host's `ValidationPipe` runs with `whitelist` and
  `forbidNonWhitelisted`, so sending one is a 400 — nothing published, nothing logged.
- **Nothing here is public.** No route of this plugin is reachable by bearer token, and no
  review state appears in the REST, GraphQL, MCP or webhook surfaces.

## 09. Agent surfaces

Three tools, each declaring `surfaces: ['copilot', 'mcp']` **explicitly** — omitting the field
in `tools/server` means both, so silence would hand a tool to MCP by accident rather than by
decision.

| Tool                        | Requires         | Effect                                                                                                                                                               |
| --------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protection_review_status`  | `content:read`   | read-only                                                                                                                                                            |
| `protection_review_diff`    | `content:read`   | read-only — what changed since the caller's last approval                                                                                                            |
| `protection_request_review` | `content:update` | `apply`, so the copilot's run engine parks it for the in-the-moment prompt like any other write. What it applies is a **request** — never content, never an approval |

**There is no fourth tool, and there will not be one.** ADR-0017 §6 settles it: with a rule in
force the approval _is_ the step that unlocks publication, so handing a model `approve` while
withholding `publish` hands over the key and keeps the doorknob. Three further reasons, each
already written down in this repository:

- ADR-0009 deleted the copilot's approval queue because "one sentence and twelve approvals,
  nobody reads the twelfth". A tool is that failure without even the clicks.
- ADR-0005 §8: entry bodies are user-written. An entry whose text says _approve me_, meeting a
  model holding such a tool, is a self-approving entry — and unlike an ordinary content write
  there is no revision to restore, because the approval **is** the authorization.
- `require_other_person` compares user ids, and a copilot run acts as its caller. The rule
  would be satisfied while the guarantee quietly would not be. No check can tell those apart.

`protection:I-17` pins the absence against the **registry**, not against this file: a tool with
an approve effect must not appear for any role on any surface, wherever it were contributed
from. The status tool's own description tells the model to point the person at the Review
section instead.

## 10. The admin UI

**Eight contributions and one route.** Almost everything this plugin shows lives inside
somebody else's screen — three in the entry editor, where the requirement is met or missed,
and one in workspace settings, where a rule is made.

| Slot                                          | Contribution                  | Notes                                                                                                                                                                                       |
| --------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENTRY_HEADER_SLOT`                           | The review chip               | Beside the title, next to the status badge — the moment the requirement matters is a moment spent looking at the title                                                                      |
| `ENTRY_SIDEBAR_WIDGET_SLOT`                   | The **Review** block          | Renders `EntrySidebarSection`, so it is part of the rail rather than a floating card. Lands after Publish gate → Details → Revisions, which reads correctly: review is the gate after those |
| `ENTRY_PUBLISH_GUARD_SLOT`                    | `usePublishProtectionVerdict` | A hook, so it can hold the bypass dialog's state; the dialog is returned as an `overlay`, rendered outside the actions cluster so it stays mounted while the button re-renders              |
| `RECORDS_COLUMN_SLOT`                         | The **Review** column         | Every publishable type, so column order survives a settings toggle; one batched request per page, and only when the column is visible                                                       |
| `RECORDS_FILTER_FIELDS_SLOT`                  | `reviewState`                 | One contribution, three surfaces: the list, saved views, and alarms' "Save as rule"                                                                                                         |
| `INSIGHTS_WIDGET_SLOT`                        | "Waiting on review"           | In the Content section beside content's own debts; `permission: content:read`, matching the route                                                                                           |
| `WORKSPACE_NAV_SLOT` + `WORKSPACE_ROUTE_SLOT` | **Reviews** (`/reviews`)      | `order: 50`, after the content library and alarms; lazy, so it is its own chunk                                                                                                             |
| `WORKSPACE_SETTINGS_TAB_SLOT`                 | **Protection**                | `permission: protection:manage` — a member without it is shown no tab rather than one that answers 403                                                                                      |

Two of these slots did not exist before this feature: `ENTRY_PUBLISH_GUARD_SLOT` in
`content-admin` and `WORKSPACE_SETTINGS_TAB_SLOT` in `workspaces-admin`, whose tab strip was
hardcoded. Both are recorded in ADR-0017's consequences.

### States

- **The three entry contributions render nothing** on an unprotected type — and the Review
  block also on a create form and a non-publishable type. With no rule the feature is inert
  server-side, so a chip or a block describing a requirement that does not exist would be an
  invention. The settings tab is the deliberate exception: it must be visible before there is
  anything to see.
- **The Review block lists people, not votes**: everybody asked, in pick order, then anybody
  else who approved. A green check once they approved the current version, a pending mark
  otherwise — with the version their stale approval sits on, which is what turns "pending"
  into an explanation. Somebody who approved without being asked is still listed, because
  leaving them out would make the count disagree with the names beside it.
- **The Reviews page has two tabs**, both computed from one fetched page by `splitQueue`:
  _Waiting on me_ (the open requests naming me) and _My requests_ (the ones I opened). The
  counts cannot disagree because they come from one split.
- **The settings tab distinguishes three states** — not protected, switched off, and in force
  — and has its own denied, error and empty states. The error copy is explicit that a failed
  load "is not the same as nothing is protected".
- **Both the queue and the settings tab load into a skeleton**, not a spinner.

### Accessibility details worth keeping

- Every count is rendered as **text** — "Needs review · 0 of 2" — so the badge tone is a
  second signal rather than the only one.
- The bypass dialog takes over **focus return**: it captures the trigger at the moment of the
  click, because Radix restores focus to the node it captured when the content mounted, and
  that button belongs to `content-admin` and is re-rendered as the verdict changes. It
  restores only when the captured node is still connected — focusing a detached node silently
  does nothing, which is worse than letting Radix try.
- The dialog closes **before** it publishes, so it is not one more layer over the editor's
  busy cover.

### Cache keys

Every key carries the **workspace id**, because the reads are scoped by `apiClient`'s ambient
`X-Workspace-Id` header and that header is not sent on a cache hit — without it, switching
workspaces would serve one workspace's answer for another's entry. The records-status key also
carries the **sorted entry ids**: paging or filtering changes which rows are on screen, and a
key that ignored them would serve the previous page's numbers against the new page's rows,
which is wrong in a way that looks plausible. A rule write invalidates both the rules list and
every create form's answer in that workspace.

The entry-review key carries one more thing: the entry's **`updatedAt`**, as its **last**
component. A save moves the head revision and so changes which approvals count, so the answer
held against the previous version is about a version that no longer exists — and the editor
primes its read-one cache with the write's own response, so a new `updatedAt` mints a new key
and the panel reads afresh. That is the whole mechanism: protection never reaches into
content's save path, and content never learns protection exists. The position is load-bearing.
A vote moves no `updatedAt` at all — protection owns no content table — so approve, withdraw,
request and withdraw-request invalidate the key **without** the version, by prefix; a version
component anywhere earlier would leave all four silently refreshing nothing. The version is
`updatedAt` **except** when an answer already cached for the entry says `protected: false`, in
which case the previous token is reused so no new key is minted and no request is issued:
`reviewScopeOf` returns a scope for any saved publishable entry and cannot know whether a rule
exists, and a request per save to be told again that there is nothing to review is exactly the
inertness I-03/I-04 promise. It is safe because every reader bails on that flag before reading
another field, so nothing observable can have moved. `entryReviewVersion` is that decision,
pure and unit-tested. The reviewer-candidate key deliberately **omits** the version: a save
cannot change who may be asked (I-22).

A new key has no answer for as long as the read takes, and the publish verdict **holds** for
that beat rather than falling silent — the one in-flight read it does not treat as "no
opinion". `useEntryReview` reports `typeKnownProtected` beside the query, meaning an answer
already cached for the entry said a rule is in force; that is knowledge about the type, so it
outlives the version it arrived with, while a **failed** read and a type nothing is known about
both stay silence. Without the hold the primary button, the ⋯ menu's _Save & publish_ and an
offered bypass all went live with no reason on them for that beat (I-21), and the bypass was
missing from the action too — so the click published without `bypass: true` and the guard
answered 403 `protection.bypass_refused` where the confirmation should have opened, which is
exactly the editor-versus-guard disagreement I-18 forbids. The hold carries **no numbers**
forward: holding the previous answer would re-show a satisfied count about a version that no
longer exists, and offer an administrator a bypass dialog stating approvals the save had
already invalidated.

## 11. Configuration

**There is none.** `ProtectionPlugin()` takes no argument and `forRoot()` takes nothing: the
rule table is the whole configuration surface and its empty state is the off state. A plugin
that had to be switched on twice — once by the operator, once per workspace — is the settings
screen ADR-0009 deleted.

What is fixed in code rather than configured:

| Constant                          | Value    | Where                                                                                                                                            |
| --------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `REQUIRED_APPROVALS_MAX`          | 100      | the rule DTO (the floor, `>= 1`, is also a check constraint)                                                                                     |
| `REVIEWERS_MAX`                   | 50       | the request DTO                                                                                                                                  |
| `REVIEW_QUEUE_PAGE_MAX` / default | 100 / 50 | the queue query                                                                                                                                  |
| `REVIEW_STATUS_MAX_IDS`           | 100      | above the records list's largest page                                                                                                            |
| `TIMELINE_LOOKUP_CAP`             | 100      | how far back stale versions are resolved for their numbers                                                                                       |
| `OVERDUE_AFTER_DAYS`              | 3        | the Insights card — and it travels **with** the figures, so the caption cannot come to say "3 days" over a number counted against something else |

The Insights query deliberately takes **no `?days=` window**: a request waiting a fortnight is
waiting whether it was asked this morning or last spring, and a dashboard figure is believed.

## 12. Security and resilience

### The port is a registry, not a single binding

`content-server` declares `CONTENT_PUBLISH_GUARD` and protection registers into it. Nest has
no multi-provider, so two dynamic modules binding one token do not merge — the second silently
replaces the first. For a read scope that would mean content quietly becoming visible; for a
publish guard it would mean protection quietly **switched off**, which is worse, because the
installation that bought the rule is the one that would never notice. Several guards AND
together: any refusal refuses.

That single registration also reaches every caller of the publish path at once — the admin
button, the public REST route, the GraphQL mutation, the MCP tool, a bulk publish — so there is
no list of callers to keep up to date and a route added tomorrow is covered the day it is
written.

### What was done deliberately

- **The three gates keep their order and their meanings.** A bypass passes the third only; an
  incomplete entry stays unpublishable for an administrator too, because the publish gate
  refused before the guard was consulted.
- **One counting implementation.** The chip, the rail, the records column, the create form and
  the refusal all read `countApprovals` / `evaluateProtection`. A second count in SQL would
  disagree first on the paths nobody exercises — `count_stale_approvals` and the four-eyes bit.
- **Permission, not role.** `protection:manage` is resolved through `PermissionsService` +
  `AccessPolicy` in both the guard and the service, so the editor cannot offer a bypass the API
  refuses.
- **No enumeration signal.** Unknown type, wrong kind, ungranted type and unreachable entry all
  answer the same 404; a missing revision makes the guard answer "allowed" and lets content's
  own 404 own the answer, rather than turning a missing entry into a protection error that says
  more about what exists than the caller is entitled to know.
- **Tokens.** Refused before counting unless the rule opts in; never bypass; hold no
  `content:approve` in any scope.
- **Workspace scoping in the virtual filter.** The `reviewState` subquery AND-s the workspace
  id — a virtual field that forgot it would be a cross-tenant read.
- **Two audit families.** `entry.publish_bypassed` rides the publish's own transaction;
  `protection.rule_changed` records **both sides** of every rule write, including switching a
  rule off and lowering its count — without those rows the bypass is not a button somebody had
  to confirm, it is a settings tab left open for two minutes.
- **The removal migration deletes refusals before dropping the column**, so no "changes
  requested" vote was ever silently converted into consent.

### Resilience

| Failure                                                        | Behaviour                                                                                                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| The outbox subscriber throws                                   | Logged and swallowed — the publish already committed, and a retry loop over it is worse than a stale queue row                   |
| A duplicate `entry.published` delivery                         | `resolve` is conditional; the second finds nothing open                                                                          |
| A revision has been purged                                     | The vote reports `revisionNumber: null` rather than failing the read; the queue reports `given: 0` rather than dropping the line |
| The review read fails in the editor                            | The verdict is `null` — no opinion. The server still refuses, with the reason                                                    |
| No `ContentPlugin` / no `WorkspacesPlugin` / no `ToolRegistry` | The registrars and the purger inject optionally; the host boots                                                                  |
| A rule addressed at a revoked grant                            | Still listed, still deletable                                                                                                    |

## 13. Invariants

Numbered as `protection:I-01…I-22`, the same numbering the design document uses and that the
code cites — I-09 is **retired** (it pinned that `changes_requested` never lowered the count;
the vote no longer exists) and the number is kept so the later ones do not shift.

The first four say the same thing at four altitudes, because "inert until a rule exists" is a
claim about the uninstalled host, the unconfigured install, the empty slot and the missing row.

- **I-01** With no guard registered, the port resolves to allowed without consulting anything.
- **I-02** Installed but unconfigured pays for one indexed rule lookup and nothing else.
- **I-03** `ENTRY_PUBLISH_GUARD_SLOT` carrying no contribution leaves the publish button exactly
  as the publish gate alone had it.
- **I-04** With no `protection_rules` row for a type, publication behaves byte for byte as it
  does with the plugin uninstalled.
- **I-05** An approval counts only on the head revision, unless `count_stale_approvals` is on.
- **I-06** Saving never deletes an approval, and always changes which approvals count.
- **I-07** With `require_other_person`, the head revision's author is excluded from the count,
  administrators included.
- **I-08** One user contributes at most one vote per revision, and at most one to the count
  however many revisions they approved.
- **I-09** _Retired._
- **I-10** Protection never inspects field values and never overrides the publish gate. A
  bypass passes protection only.
- **I-11** A bearer token cannot publish a protected type unless `allow_token_publish` is on.
- **I-12** No API token scope grants `content:approve`.
- **I-13** Every successful bypass writes exactly one `entry.publish_bypassed` row naming the
  rule and how far short the count was, in the publish's own transaction.
- **I-14** Disabling a rule or lowering `required_approvals` writes `protection.rule_changed`.
- **I-15** `status` takes no value other than `draft` or `published`, and no review state is
  readable through the public API.
- **I-16** Deleting a workspace leaves zero rows in all three tables.
- **I-17** No tool in the registry can record an approval, on any surface.
- **I-18** The editor's verdict agrees with the guard for the version Publish ships: the stored
  head unchanged, `afterSave` when dirty, `GET /types/:type` on a create form.
- **I-19** Publishing an unchanged record appends no revision, so the approvals stay where the
  reviewers left them; a record carrying any unsaved state is still saved first.
- **I-20** A bypass publishes what is on screen — it rides the editor's own publish.
- **I-21** Every way to publish from the editor obeys the verdict: the primary button and the
  ⋯ menu's _Save & publish_ are held together, and an offered bypass opens the same dialog from
  either.
- **I-22** A review request names only people who could approve it, and whom it names never
  changes whose approval counts.

Two more this dossier adds, read out of the code and already covered by tests that do not
name an invariant:

- **I-23** A rule row cannot exist with `required_approvals < 1` — the API refuses it
  (`protection-rules.spec.ts`, "rejects fewer than one approval") and a check constraint is the
  floor under a direct SQL write.
- **I-24** A rule addressed at a type the workspace no longer holds stays listed and stays
  deletable; neither `GET` nor `DELETE` consults the grant
  (`protection-rules.service.spec.ts`, "does not check the grant" / "does not filter by the
  current grants").

## 14. Testing checklist

Existing suites: `apps/server-e2e/src/server/protection/` (`publish-guard`, `entry-review`,
`protection-rules`, `review-queue`, `review-status`, `new-entry-protection`),
`apps/admin-e2e/src/content/` (`protection-review`, `protection-publish-paths`,
`protection-records`, `review-queue`, `entry-publish-guard`),
`apps/admin-e2e/src/workspaces/protection-settings.spec.ts`, plus the kernel's own
`evaluate-protection.spec.ts` and `kernel-boundary.spec.ts`.

### Inertness

| Action                                                                 | Expected                                           |
| ---------------------------------------------------------------------- | -------------------------------------------------- |
| Boot a host that never registers the plugin, publish                   | Succeeds; the port resolves to always-allowed      |
| Register the plugin, write no rule, publish                            | Succeeds, and the approvals store is never queried |
| Write a rule with `enabled: false`, publish — as a person and by token | Succeeds both ways                                 |
| Render the entry editor with nothing in `ENTRY_PUBLISH_GUARD_SLOT`     | The button is the publish gate's own state         |

### The count

| Action                                                           | Expected                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Publish with a rule requiring 2, one approval given              | 409 `protection.insufficient_approvals`, `required: 2, given: 1`; the button was disabled |
| Approve, save the entry, read the state                          | Count back to 0, the approval listed as stale with its version                            |
| `count_stale_approvals` on, same sequence                        | Count stays 1, `stale: 0`                                                                 |
| One person approves five successive revisions, stale counting on | They count **once**                                                                       |
| Author approves own head with `require_other_person`             | 409 `protection.self_approval_refused`, and the button is not offered                     |
| Same author approves, then somebody else saves                   | The approval now counts — the head author changed                                         |
| Head written by a token or an import (`authorId` null)           | Nobody is excluded; the count is the plain distinct total                                 |

### The gates

| Action                                                 | Expected                                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Bypass while the publish gate fails                    | 422 from the gate — protection is not reached                                                            |
| Bypass by a non-administrator                          | 403 `protection.bypass_refused`, "needs the `protection:manage` permission"                              |
| Bypass under `admin_bypass: false`                     | 403, "the rule allows no bypass"                                                                         |
| A successful bypass                                    | Published; exactly one `entry.publish_bypassed` in the same transaction, naming rule, required and given |
| Bypass sending a `bypassReason`                        | 400; nothing published, nothing logged — the field does not exist                                        |
| Publish with a bearer token, `allow_token_publish` off | 409 `protection.token_refused`, before any counting                                                      |
| Bulk publish a selection including a protected entry   | That entry refused, no `bypass` sent                                                                     |
| Publish an entry whose German locale lacks approvals   | German refused by name, the other locales proceed                                                        |

### Requests and queue

| Action                                                       | Expected                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| Request review naming a viewer, yourself, or a non-member    | 422 `protection.reviewer_not_eligible`; no request opened |
| Request twice                                                | One open row, reviewers replaced                          |
| Withdraw somebody else's request without `protection:manage` | 403                                                       |
| Publish the entry                                            | The open request resolves via the outbox subscriber       |
| Deliver `entry.published` twice                              | Idempotent; no error                                      |
| Request review on an unprotected type                        | Allowed, and it blocks nothing                            |

### Reads, permissions, isolation

| Action                                                       | Expected                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `GET /protection/rules` as a contributor                     | 403                                                                       |
| `GET /protection/queue` as a viewer                          | 200 — the read is `content:read`                                          |
| Status for a page of 25 entries                              | The same count as for one entry — four, and flat. Only flatness is pinned |
| Status for an entry of another **real** workspace            | Absent from `byEntry` — unpinned today, see §16                           |
| `?ids=` with 101 ids                                         | 400                                                                       |
| Filter `reviewState = awaiting`                              | Only entries with an open request **in this workspace**                   |
| `reviewState` with an unsupported operator, or an empty `in` | 400                                                                       |
| Ask `scopePermissions` for either token scope                | `content:approve` in neither                                              |
| Offer the tool catalogue to any role                         | No tool with an approve effect appears                                    |
| Delete the workspace                                         | All three tables count zero (`workspace-delete-residue.spec.ts`)          |

### The editor

| Action                                                   | Expected                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Read `afterSave`, save, publish                          | 409 exactly when `afterSave.blocked` said so (I-18)                              |
| Read `GET /types/:type`, create, publish                 | 409 exactly when the read said `blocked` (I-18)                                  |
| Approve, open the editor, press Publish without editing  | No save request, no new revision; the publish succeeds (I-19)                    |
| Stage only a link or an audience, press Publish          | The save goes out first, carrying the staged change (I-19)                       |
| Edit a field as an administrator, press Publish, confirm | Save, then publish carrying `bypass: true` (I-20)                                |
| Same on a create form                                    | Create, then publish carrying `bypass: true` (I-20)                              |
| Open ⋯ on a held entry                                   | _Save & publish_ disabled; with a bypass offered it opens the same dialog (I-21) |
| Close the bypass dialog with Escape                      | Focus returns to the Publish button                                              |
| The review read fails                                    | No chip, no verdict, the rail says so — the button is not blocked by the client  |

## 15. Boundaries of responsibility

### What this package owns

- The three tables, their migrations and their purge.
- The decision "may this person ship this entry now", and every number derived from it.
- The review request, the approval, and the queue that makes them findable.
- Two permissions' meaning, and the refusal codes a client branches on.

### What it deliberately does not own

| Question                           | Owner                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Is this entry complete?            | `content`'s publish gate                                                                                                                   |
| Does this entry look wrong?        | `alarms`, which blocks nothing                                                                                                             |
| Who may read the published entry?  | `segments`                                                                                                                                 |
| Who may touch this type at all?    | RBAC + `workspace_content`                                                                                                                 |
| Which revision is the head?        | `content`'s `RevisionStore` — protection never reads `content_entry_revisions` directly, because it cannot migrate a table it does not own |
| Who is a member of this workspace? | `workspaces`                                                                                                                               |
| What a tool call is allowed to do  | `tools/server`, the one place a call is authorized                                                                                         |

### What is missing, and why

- **Mail on a review request (ORT-207).** Until the mail port lands, the Reviews page is the
  only way a reviewer learns there is work. That is the single largest usability gap in the
  feature as shipped.
- **The scheduled-publish re-check (ORT-210).** ADR-0017 requires the rule to be evaluated when
  a timer fires rather than when the schedule was set, and that a fired timer — having no human
  — cannot bypass. There is no scheduler yet, so there is nothing to hook.
- **Import.** Whether `transfer` may publish into a protected type is **not reachable** rather
  than unanswered: an import calls only `writer.create` / `.update`, and a create on a
  publishable type is stamped `draft`, so import never meets the guard. It becomes a real
  question the day import gains a publish step.
- **A non-publishing author role.** ADR-0017 leaves `content:approve` on `contributor` and
  notes that splitting `content:publish` out is a separate decision worth taking on its own
  merits.
- **No per-entry exception, no filtered rule, no reviewer groups.** All three were considered
  and refused in the ADR; the shortest reason is that "why is this entry blocked and its
  neighbour not" must answer in one word, and the word is the type.

## 16. Where the code and the documentation diverge

Found while writing this dossier, by reading the source against the two documents that describe
it. Three of the seven are the same stale fact: **the bypass reason was removed** (commit
`2d494ca`), and the sentences that mentioned it were not all removed with it.

**Two were repaired in the commit that added this dossier**, because one is read by every agent
that opens this repository and the other is published to API consumers — this section is not an
archive:

- Root [`AGENTS.md`](../../AGENTS.md) said "the two permissions (`protection:read` approves,
  …)". There is **no `protection:read`**; approving is `content:approve`, and
  `system-roles.ts` states outright that `protection:manage` has no read half beside it.
- `save-protection-rule.dto.ts` described `adminBypass` as a bypass "with a mandatory reason".
  There is no reason field, and sending one is a 400 — and that string is user-visible in the
  OpenAPI reference at `/reference`.

A coverage audit run after this dossier landed found three more, two of them the same shape
as the pair above — a comment naming a test as the thing that keeps a property true, where the
test does not exist or does not reach that far. All three are corrected in the commit that adds
this paragraph:

- `review-status.query.ts` said **"three queries"** and sent the reader to
  `review-status-batching.spec.ts`. There are four reads — the open-requests read behind the
  `requested` flag was added without updating the prose — and that filename appears nowhere in
  the repository but in that sentence. The test that does pin the property is
  `review-status.spec.ts`'s _"issues the same number of queries for 1 entry and 10"_, and it
  asserts **flatness, never a number**, which is exactly why the drift survived. **This dossier
  repeated the wrong count** in §10 and §14.
- `review-state-filter.provider.spec.ts` says _"a recorder beats a live database here, and the
  e2e covers the rendering"_. There is no e2e for `reviewState`; `grep -rn reviewState
apps/server-e2e` returns nothing.
- `protection-tool.provider.ts` claimed I-17 was pinned **against the registry**. The spec
  beside it reads the catalogue that one provider returns, so an approve-effect tool
  contributed from another package would pass it. The comment now separates the altitude the
  invariant is stated at from the one it is enforced at.

Two more claims were stronger than any test behind them, and are corrected rather than
recorded: the cross-workspace status read is exercised with an id that exists in no workspace,
and `apps/admin-e2e/src/content/entry-publish-guard.spec.ts` claimed to test an **empty**
publish-guard slot in an app that registers the plugin — it passed because its unmocked
protection read failed, which means a guard that blocked on a failed read would have been
caught by nothing.

What is still open, none of it behavioural:

| Where                                                     | What it says                                                                                            | What the code does                                                                                                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evaluate-protection.ts`, `ProtectionDecision.bypassable` | "the caller must still supply a reason to take one"                                                     | The caller must still ask explicitly (`{ bypass: true }`); no reason is supplied                                                                                                                                                                |
| `entry-review.service.ts`, `ReviewActor`                  | "The bypass itself is enforced by the publish guard, **which is a later PR**; here it is only reported" | The guard shipped in `42aa2d6`                                                                                                                                                                                                                  |
| `protection.module.ts` header                             | "three tables, **one controller**"                                                                      | Six controllers                                                                                                                                                                                                                                 |
| `review-state-filter.provider.ts`                         | `{@link countApprovals}`                                                                                | The symbol is not imported in that file, so the link does not resolve                                                                                                                                                                           |
| [ADR-0017](../adr/0017-publication-protection.md) §5 body | "the button changes its label and its tone, a reason is mandatory"                                      | Superseded by the record's own 2026-09-11 update note, which is above it. Left as it stands deliberately — an ADR records what was decided, and the amendment is the amendment — noted here only so a reader who lands mid-record is not misled |

Four of the five are comments rather than contracts, and the fifth is an ADR body its own update
note already corrects. Each is a sentence that outlived the change it described — the failure
mode this section exists to catch, not an argument for writing fewer of them.
