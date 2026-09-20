# `@orthacms/segments-server`

The **segmentation plugin** — reader entitlements enforced on the public content
API. Two tables, one predicate, and four ways in: the admin's screens, the entry
save's `extensions` bag, a bearer token, and an agent's tool catalogue.

```
src/lib/
  segments.module.ts          the one dynamic module
  schema/                     segments · entry_access
  application/
    segment-catalog.service.ts  every segment, cached, read synchronously
    reader.store.ts             who is reading, for one request
    segments.service.ts         the directory CRUD
    entry-access.service.ts     one entry's two lists — the whole write path
  tools/
    segments-tool.provider.ts   the MCP/copilot tools — list, read, and (MCP) set
  copilot/
    entry-access-proposal.provider.ts  the copilot's propose tool
    entry-access-proposal.applier.ts   …and what carries an accepted one out
  infrastructure/
    segment-read-scope.ts       the CONTENT_READ_SCOPE implementation
    access-filter.provider.ts   the records list's three access filter fields
    entry-access-write-extension.ts  the EntryWriteExtension — access, written
                                     inside the entry's save and versioned with it
  http/
    reader.middleware.ts        resolves the reader once per request
    segments.controller.ts      /api/segments
    entry-access.controller.ts  /api/segments/entries/:id
    public-entry-access.controller.ts  /api/v1/content/:type/:id/access
```

## What it owns

| Route                              | Scope        | Permission                          |
| ---------------------------------- | ------------ | ----------------------------------- |
| `/segments`                        | installation | `segments:read` / `segments:manage` |
| `/segments/lookup`                 | installation | `segments:read`                     |
| `/segments/:id`                    | installation | `segments:read`                     |
| `/segments/entries/:entryId`       | workspace    | `segments:read` / `segments:manage` |
| `/v1/content/:typeName/:id/access` | token bucket | `segments:read` / `segments:manage` |

…plus the `access` key of every entry save's `extensions` bag, which is how the
admin actually writes (see below). It carries no permission of its own: the save
it rides already required `content:create` / `content:update` on the record.

`segments:read` is held by contributor and viewer — an editor who cannot see
that an entry is restricted will publish one believing it is public.
`segments:manage` is admin-only: renaming a segment's tags changes who every
entry naming it is visible to.

## The decisions that are easy to get wrong

**Enabling the plugin must change nothing.** With no segment created, the
catalogue is empty, the read scope returns `undefined`, no fragment is emitted,
and a public read is byte-for-byte what it was before. That is the state every
existing installation is in, and it is the first thing to keep true.

**No row means unrestricted; no reader context means anonymous.** Two absences,
two opposite readings, both deliberate. An entry with no `entry_access` row is
open — that is what every entry starts as, and reading absence as a closed door
would black out an installation on install. A request the middleware did not
cover is an _anonymous reader_ — unrestricted content still serves, restricted
content does not — because treating an unknown caller as unconstrained would
turn every gap in coverage into an open door.

**Relations are covered, on all three protocols, by the same predicate.** A
reader who may see an article is not thereby allowed to see everything it links
to, so the scope is asked about the **target** type on every hop —
`RelationLinkService.targetVisibleWhere`, which the REST expansion, the
`/relations/:field` route, the MCP `content_relations` tool and GraphQL's nested
resolvers all reach. It sits inside the window and the `count(*) over`, so a
restricted target is missing from `items` **and** absent from `total`: counting
it would leak the cardinality of what is hidden ("5 links, 2 visible" says three
restricted records exist here). Admin reads pass no visibility and are untouched
— an editor must see the records their entry links to in order to manage them.

**The predicate is `canRead` in SQL, line for line.**

```sql
COALESCE((
  SELECT NOT (ea.deny && $reader)
     AND (cardinality(ea.allow) = 0 OR ea.allow && $reader)
  FROM entry_access ea WHERE ea.entry_id = article.id
), true)
```

The kernel's spec says the three rules are right; `segment-read-scope.spec.ts`
says the database agrees. `COALESCE(…, true)` is the load-bearing half — without
it the whole library goes dark the moment the plugin is installed.

**Every `&&` binds its ids through `uuidArray`, never inline.** Drizzle expands a
JS array in a `sql` template into one placeholder **per element** — which is what
makes an `in (…)` list work, and what makes `` sql`${ids}::uuid[]` `` a different
broken query for every length: `()::uuid[]` for the anonymous reader (a syntax
error), `($1)::uuid[]` with a scalar bound for one id (`malformed array literal`),
a row constructor for two. Both the read scope and the access filter shipped that
way and 500ed on every restricted read, because the unit specs assert the emitted
SQL's **shape** — which is right in all three cases. `uuidArray` binds the list as
one `sql.param`; its spec counts parameters rather than reading SQL, and the
server-e2e suites execute it.

**An entry id is checked against the workspace before anything is written.**
Content stamps `workspace_id` on create and filters its own reads and writes by
it — its table builder says outright that the isolation lives in the app layer,
because there is no foreign key to lean on. Three of the four write paths take
an entry id straight from a caller and were never inside content's services to
inherit that: the `PUT` route, the public route and `content_access_set`. Only
the entry save had already resolved the id inside the workspace.

It matters more than "tenant scoping" usually implies, because the enforcement
predicate matches on `entry_id` **alone** — `entry_access.workspace_id` is
carried for the admin's lists, not consulted by the read. So a row written
against a foreign id governed that entry's reads all the same: two empty lists
deleted another workspace's restriction outright, and a non-empty pair re-homed
the row to the caller's workspace, where the owning editor could no longer see
the restriction now hiding their own entry. `entryBelongsTo` is checked once in
`writeGroup`, so all four paths inherit it, and the refusal is the same `404` an
id that exists nowhere gets — telling those apart would make every write path an
oracle for entry ids, which is the flat answer the read side already gives by
scoping its query.

**A write is one upsert, and there is nothing else to re-derive.** The row an
editor saves is the row a reader is matched against, so a write that returns 200
means the change is live. That property is the entire return on the simple
model: no projection, no rule resolution, no re-projection sweep.

**The admin's write goes through the entry's own save, not the `PUT`.** The
plugin binds content's `EntryWriteExtension` port under the key `access`, so an
entry's audiences arrive in the save body's `extensions` bag and are applied on
the **save's own transaction**. Three things follow, and only the first is about
tidiness:

- The access row and the entry row commit together. A save cannot land with its
  restriction missing.
- The revision that save appends captures the access it **applied**. A separate
  later request could only ever be captured by the _next_ version — every
  version would record the access the entry used to have.
- Restoring a version puts its audiences back with its words. `capture` therefore
  runs for **every** snapshot, not only saves that touched access: a version that
  recorded nothing would restore as a version that had none, and quietly open the
  entry up.

`ACCESS_EXTENSION_KEY` is stable forever for the same reason — every version
already captured names it, and a restore that finds no bag leaves access alone.

**Access is not a translated field — it is written to the whole locale group.**
"Who may read this" is a fact about the record, not about the German wording of
it, so it travels the way a non-localized field does: set on one locale, set on
all of them. Left per-row it was a hole you could not see from any screen — an
editor restricted the English article and published the German one to everyone.

Three parts, and each covers a path the others do not:

- `EntryAccessService.setForGroup` is what every write path calls; the per-entry
  `set` is its building block rather than an alternative to it. The group is
  resolved by `localeGroupIds`, which reads **content's own** `locale_group_id`
  column rather than going through `@orthacms/i18n-server` — an entitlement rule
  must not depend on a plugin the deployment may not have, and the honest
  fallback (the entry is alone) is what a non-localized type already gets. It
  includes **soft-deleted** siblings, exactly as i18n's own propagation does: a
  locale in the trash comes back on restore, and it has to come back with the
  group's access.
- The skip-if-unchanged check asks `groupHas`, not `get`. A save matching the
  English row but not the German one still has work to do; asking about one row
  would leave the group half-restricted.
- **`inherit`** — content's create-only extension hook — is what covers "create a
  translation", which sends no `extensions` bag at all, so `apply` never runs.
  Without it the new row was born public beside a restricted sibling. It needs no
  `segments:manage`: nothing is being decided, the row is joining a record that
  already carries those audiences, and the alternative to inheriting is
  publishing it to everyone — which is what the permission exists to prevent.

**And every sibling it rewrote gets a revision.** `apply` returns the ids it
wrote, and content appends a snapshot for each — the same thing it does for the
rows i18n's shared-field sync rewrote. Without it a sibling's stored audiences
moved while its timeline did not: the history hid the change, and restoring any
of that row's versions would have silently undone it. One save can reach a
sibling through both paths (a shared field _and_ an audience); the ids are
deduplicated against the rows i18n reported, because two revisions for one row
read as two edits.

The workspace-scope check is relaxed across the group for the same reason it is
relaxed for ids an entry already holds: a segment narrowed away from the
workspace after the fact is still held by the row the editor is looking at, and
refusing it on a sibling that had not caught up would fail the whole save.

**The permission is checked in the extension, because no route checks it.** The
save this write rides asked for `content:create` / `content:update`; deciding who
may _read_ the record is `segments:manage`, a different authority, and without
the check a contributor could restrict — or un-restrict — any entry they can edit
by naming the key in the save body. A caller the principal store cannot identify
is refused rather than passed. A request that asks for exactly what is already
stored changes nothing and needs no authority, which is what keeps a **restore**
working for anyone who may restore; a restore that genuinely _would_ change the
audiences is refused, and that is right rather than a special case — it is a
change to who can read the entry, whatever button started it.

**`PrincipalStore` holds the request, not the user.** Middleware is the only
thing positioned to wrap the rest of a request in `AsyncLocalStorage.run`, and it
runs _before_ the guards that resolve `request.user`. Holding the request object
bridges that: the guard mutates the same object in place, so by the time the
write runs, `user` is there. Unlike `ReaderMiddleware` it never short-circuits —
the reader resolution is skippable when no segment exists, but a permission check
that silently stopped running would be the failure nobody notices.

The `PUT /segments/entries/:entryId` route stays, for an API client that is not
saving an entry. It simply gets neither the atomicity nor the version.

**A segment names the workspaces it is offered in, and empty means every one.**
`segments.workspace_ids` is a plain uuid array (no cross-plugin FK, like
`entry_access.workspace_id`), read as "offered everywhere" when empty — the same
reading as an entry's empty allow list, and the state every existing row is
already in. Taking emptiness for "nowhere" would have made every audience vanish
from every editor the day the column shipped.

It narrows **where an audience can be chosen**, never who it lets in. `canRead`
does not consult it and must not: a stored decision means what its editor meant,
and re-deciding it from a screen about where an audience is _offered_ would
change who can read published content with nothing on either screen to say so.
So `EntryAccessService.validate` refuses an out-of-scope id **only when the entry
does not already hold it** — which is also what keeps a restore working, since
putting back a version that named an audience the entry still holds is not a new
decision.

**The list is paginated, and it carries every matched id alongside the page.**
`ids` is not this page's — it is every id the filter matched, capped at the same
number an entry may name on one side. The entry editor's "set every audience
to…" acts on it, so a bulk action means the whole list rather than whichever
rows are on screen; past the cap `idsTruncated` tells the editor to say so
rather than silently doing part of the job.

**`GET /segments/lookup?ids=` exists because a page is not the whole list.** A
caller holding _ids_ — the entry header chip, a revision's captured access — can
no longer count on the first page containing the rows it has to name. Without it
those would print a uuid, or claim an audience was deleted when it is merely on
page three. Unknown ids are skipped rather than refused: a segment a revision
captured really can have been deleted since, and that is a state the caller
renders. It is declared **before** `:id` so the literal segment wins the match.

**Filtering the records list by access is three virtual fields, not a relation.**
`audienceAllowed` / `audienceDenied` (enums of the workspace's audiences) and
`accessRestricted` (a boolean), contributed through content's filter-field
registry so they join the list's own query builder — saveable as a view,
replayable as an alarm rule.

Not a relation, though the query builder has a picker for those: a relation there
means a **content type**, and the picker would fetch `/content/<target>` while
the surface walked the target's own fields. An audience is a row in this plugin's
table with no content model behind it, so modelling it as one would advertise a
traversal (`audience.tags eq …`) nothing can answer.

`in` is **any of** (array overlap); "both" is an `and` of two `eq` rules, which
the builder composes. Negation is deliberately absent: `audienceAllowed ne
"acme"` negates _inside_ the EXISTS — "has some allowed audience other than
Acme" — which an entry that also allows Acme satisfies. That reads as "not
visible to Acme" and is not it.

And it is a **list filter, not a visibility rule**: who may actually read an
entry is `SegmentReadScope` on the public API, unaffected by anything here.

**Two empty lists delete the row.** Storing them would work and would leave
every entry anyone ever opened paying for a row on the read path.

**Deleting a segment scrubs it from every entry, in one transaction.** Left
behind, the id would resolve to nobody — silently closing content on the allow
side and opening it on the deny side, with nothing on screen to say why.

**The catalogue is read synchronously, so it is loaded at boot.**
`CONTENT_READ_SCOPE` is called inside the query builder and cannot await.
`onApplicationBootstrap` runs inside `app.init()`, so a catalogue that cannot be
read aborts start-up rather than leaving a server that serves restricted content
as though nothing were configured.

**A registered scope, not a bound token.** Nest has no multi-provider: two
plugins binding one DI token do not merge, the second replaces the first
silently. For a visibility rule that means content quietly becoming visible, so
the scope is registered through `contentReadScopeRegistrar('segments', …)`.

**Middleware, and `{*splat}`.** The reader has to be resolved _around_ the rest
of the request, which is what `AsyncLocalStorage` needs and only middleware can
arrange. The pattern is `{*splat}` because Express 5 uses path-to-regexp 8,
where the historical `'*'` is a parse error rather than a wildcard — a mistake
no typecheck catches and that would leave the plugin silently never running.

**The resolver fails closed and never rejects the request.** An unreachable
entitlement source produces the anonymous reader, not a 500.

## The agent surfaces — MCP, the copilot, and a bearer token

Four ways in besides the admin's own screens, and the differences between them
are all about **who is acting**.

| Surface     | What it gets                                                    |
| ----------- | --------------------------------------------------------------- |
| MCP         | `segments_list`, `content_access_get`, `content_access_set`     |
| Copilot     | `segments_list`, `content_access_get`, `content_propose_access` |
| Public REST | `GET` / `PUT /api/v1/content/:typeName/:id/access`              |

**The reads are on both surfaces; the writes are not the same tool.** A bearer
token is its own authority — the registry has already checked `segments:manage`
against its scope, so `content_access_set` writes and returns. A copilot run acts
for a **person**, so its counterpart is `effect: 'propose'`
([ADR-0009](../../../docs/adr/0009-copilot-applies-directly.md)): the change is
drafted, shown on a card that names the audiences rather than their ids, and
carried out by `EntryAccessProposalApplier` under that person's own permissions.
The applier goes through `setForGroup`, so an accepted proposal cannot mean
anything the entry save and the `PUT` route do not.

**An agent that cannot ask about access is worse than one that cannot see the
entry.** Both scopes therefore carry `segments:read`: the read scope already
filters restricted entries out of `items` **and** `total`, so a client with no
way to ask reports a partial list as the whole one. That is why the read tools
have no scope gate beyond `read`.

**Entry access is exposed to tokens; the vocabulary is not.** `full` carries
`segments:manage` because setting who may read a record is an entry-level
editorial decision of the same weight as publishing or deleting it — both of
which `full` already grants. There is deliberately **no tool and no public route
over the directory**: renaming one audience's tags changes who every entry naming
it is visible to, installation-wide, and deleting one rewrites both lists on
every entry that held it. Those stay on a session-authenticated screen where a
person reads the consequence the dialog spells out, and a future tool over them
is a decision somebody has to make on purpose rather than one this scope mapping
already made.

**The agent-facing reads answer from `entry_access`, not through the public entry
read.** That read is reader-scoped, so an agent that had just restricted an entry
could not read back what it had done — the restriction it wrote being the thing
hiding the answer. Asking who may read a record is not reading the record, and
the workspace scope is what keeps it from being an enumeration oracle: an id from
another workspace answers as an unrestricted entry, exactly as an unknown one
does.

## OpenAPI (`src/lib/docs/`)

`SegmentsPlugin` contributes a `docs.decorate` pass — every route here answers a
framework-free `interface`, which the swagger scanner cannot see and ADR-0003
forbids decorating.

**Two surfaces, two tables**, for the reason content's pass learned the hard way:
`PUT /api/segments/entries/:entryId` and
`PUT /api/v1/content/:typeName/:id/access` are the same decision and do **not**
answer in the same shape — the public one carries the entry id and the derived
`restricted` flag. One table matching both spellings is how thirteen public
content operations came to be published with the admin's schemas.

**Nothing here is content-type-dependent**, which is worth stating because the
`/access` routes sit on a `{typeName}` path and the neighbouring content pass
generates a schema per registered type. What varies with the type there is the
**parameter**, not the payload: an entry's audiences are two lists of segment ids
whatever the entry is. Content's pass writes that parameter's enum; this one
writes the public route's **400** — the answer an ungranted type gets here, and
deliberately not the 404 the content routes give.

The schema descriptions carry the two sentences that are easiest to misread and
have nowhere else to live in a generated document: an empty `allow` list means
**everyone**, and an empty `workspaceIds` means **every workspace**.

## What is not here yet

- **Deletes are not hooked.** A hard-deleted entry leaves its `entry_access` row
  behind. Nothing joins to an id that no longer exists, so the cost is disk
  rather than correctness.
- **Defaults per collection or per workspace.** Every decision is per entry
  today. A default would be inheritance, which is the thing this design dropped
  on purpose; if it comes back it should come back as one explicit rule, not as
  a chain.

## e2e

`apps/server-e2e/src/server/segments/` holds five suites — the directory, the
entry-save write path (permissions, atomicity, revisions, restore, and the
workspace boundary), the public read scope including relations, the three filter
fields, and the agent surfaces (`agent-access.spec.ts`: the tool catalogue, the
public route, and the same boundary from a token). The harness bits are
in `src/support/segments.ts`: a **header** resolver (`x-reader-tags`), which is
the production seam rather than a test hook beside one, and
`reloadSegmentCatalogue`, which every suite must call after `resetDb` — the
catalogue is in-memory and the TRUNCATE goes behind its back.

## Commands

- `npx nx test @orthacms/segments-server`
- `npx nx run @orthacms/segments-server:db:generate --name=<change>` — commit the SQL
- `npx nx run server:db:migrate` — applies every plugin's pending migrations
