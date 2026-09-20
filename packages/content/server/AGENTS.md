# @orthacms/content-server

The content-modeling **plugin** for the Ortha CMS server. It turns
**code-defined** content types into physical Postgres tables, holds them in a
runtime **registry**, serves that schema to the admin, and validates entry
values against it. It owns **no database connection and no migrations of its
own** — the HOST owns the generated tables and their migrations (see below).

## The DSL (`collection()` / `single()` + `field.*`)

Content types are declared in code, in the host app (collections in
`apps/server/src/collections`, pages/singles in `apps/server/src/pages`):

```typescript
export const post = collection('post', {
    label: 'Blog posts',
    fields: {
        title: field.text({ required: true, minLength: 3 }),
        author: field.relation({
            to: () => author,
            required: true,
            onDelete: 'restrict'
        }),
        tags: field.relation({ to: () => tag, many: true })
    }
});
```

- `collection()` (multi-entry) and `single()` (one entry, routed at `path`)
  normalize options, run `assertName` + `assertFields`, build the tables, and
  return a typed `ContentType`.
- `field.*` field builders (`text`/`richtext`/`number`/`money`/`boolean`/`date`/
  `datetime`/`select`/`multiselect`/`json`/`relation`/`media`) each return a JSON-serializable
  `FieldSpec` carrying its value type as a phantom generic (for `InferEntry`).
- Every builder takes an optional **`lang`** — the BCP-47 language this field's
  content is written in, when it is not the entry's own (WCAG 3.1.2). A
  malformed tag is rejected at **define time**, since a `lang` no user agent can
  parse is worse than none.
- `relation({ to })` takes a **lazy thunk** so mutually-referencing collection
  files can import each other. `onDelete` defaults to `'cascade'` when
  `required`, else `'set null'`. A **required single relation with
  `onDelete: 'set null'` is rejected** at define time — a NOT NULL FK can't be
  nulled on delete. `unique: true` makes a single relation **one-to-one** — a
  `UNIQUE` constraint on the `<field>_id` FK (nullable-unique, so unrelated rows
  don't collide); combining it with `many: true` is rejected (a join table has
  no column to constrain). On an **`i18n`** type the constraint is scoped to the
  locale instead — see _Relations across locales_ below, since a localized
  record is one row per language and one-to-one has to be counted in records.

### Two-way relations (`relationInverse`)

`field.relationInverse({ of: () => owner, field: 'x' })` declares the **inverse**
(back-reference) side of a relation whose storage lives on `owner.x`. It emits
**no column or join table** — reads/writes reuse the owning side's FK/join table
(source/target swapped), so editing either side mutates the same links and they
can't drift. The registry validates the pairing at boot (the referenced field
must be a storage-owning relation on `owner` that points back). Because it's
virtual, adding one produces **no migration**. Defaults to to-many. Two files
referencing each other create a TS _inference_ cycle — annotate one thunk's
return `: AnyContentType` to break it (see `apps/server/src/collections/tag.ts`).

### Relation cardinalities

The two storage forms cover all four cardinalities. **many-to-one** is a plain
single relation (`field.relation({ to })`); its inverse is **one-to-many**,
which carries no storage of its own — model it as the single relation on the
"many" side (e.g. `comment.article`). **one-to-one** is a single relation with
`unique: true`. **many-to-many** is `many: true` (the generated join table). See
the reference collections in `apps/server/src/collections` (`article` wires up
`author`, `seo_meta`, `tag`, and `comment`).

### Rich-text fields (`field.richtext`) — a structured document

A `richtext` value is the **document** the admin editor produces (the
ProseMirror/TipTap node tree), stored in a `jsonb` column — not an opaque HTML
string. That is what lets the platform express and check a body's heading
order, its tables' header cells, its link text, and the language of a quoted
passage (WCAG 1.3.1 / 2.4.6 / 3.1.2); the rules themselves live once, in
`@orthacms/content-domain`'s rich-text module, so the admin applies exactly
what the server enforces.

Three consequences worth knowing:

- **A legacy HTML string is still a valid value.** Bodies written before this
  change are stored as strings and read, validate and render as such; the
  migration is `USING to_jsonb(col)`, so nothing was parsed and nothing could be
  lost. The admin's editor rewrites one as a document the next time the record
  is saved, so content upgrades as it is edited. Anything reading a `richtext`
  value has to accept both — `richTextPlainText` / `asRichTextDocument` are how.
- **`minLength`/`maxLength` count the body's text**, not its markup. Bolding a
  word used to cost the author `<strong></strong>` out of their budget.
  `validation: { structure: 'off' }` opts a field out of the structural rules,
  for a body that is genuinely not a document.
- **`richtext` is no longer filterable or sortable** (`scalarTypeFor` returns
  `null`): `equals`/`starts with` over a document would compare serializations
  of a tree, not prose. Free-text `?search=` still reaches it — the column is
  cast to text for the `ILIKE`, which searches the serialized tree; a stored,
  indexed text projection is the real answer when search is next revisited.

### Media fields (`field.media`)

`field.media({ multiple?, accept?, required?, localized? })` attaches **Media
Library** assets to a record. Storage lives **in the values bag**, not a join
table: a single field is a `uuid('<field>')` column, a `multiple: true` field a
`jsonb('<field>')` array of ids (mirroring `multiselect`). Asset ids are **plain
uuids, not a Postgres FK** — the assets live in the media plugin's own schema, so
(exactly like `workspace_id`) there is no cross-plugin FK, and existence + the
`accept` restriction are enforced in the app layer, not the DB. Because media
values ride the values bag, they are captured by the **revision snapshot**,
synced across locale siblings when **shared** (unmarked), and per-locale when
`localized: true` — all for free, like any scalar. `accept` restricts the
allowed assets by coarse `kinds` (image/video/audio/document/archive) and/or
`mimeTypes` (exact or `type/*` glob); an unknown kind is rejected at define time.

**The `MEDIA_ASSET_RESOLVER` port.** The pure kernel only shape-checks a media
id (uuid / uuid[]). Verifying an asset **exists in the workspace** and **matches
`accept`** needs the media table, so content-server _declares_ a DI port
(`extension/media-asset-resolver.ts`: `MEDIA_ASSET_RESOLVER` symbol +
`MediaAssetResolver` interface) that the media plugin _binds_ — the same
inversion as `CONTENT_ENTRY_EXTENSION`. `EntryWriterService.assertMediaTargets`
injects it `@Optional()` and runs alongside `assertRelationTargets`: a missing,
cross-workspace, or disallowed asset is a uniform **422** (no
not-found-vs-forbidden enumeration signal). Unbound (media plugin absent) it is a
no-op — media fields shape-validate and store, but skip existence/restriction.
`GET /content/:type/:id/media` (`MediaRefsQuery`) resolves an entry's media ids
to display refs (name/thumbnail-url/kind), and the revision detail's `mediaRefs`
reuses the same query; both no-op without a resolver.

### Metadata flags (`publishable` / `paranoid` / `i18n`)

Optional booleans on `collection()` / `single()` add platform-owned envelope
columns:

- `publishable: true` → a `status` (`draft`/`published`, `DEFAULT 'draft'`)
  **and** a nullable `published_at` (timestamptz) column — the two halves of the
  publish workflow. A **non-publishable** type has neither: it carries no publish
  state and every row is simply live.
- `paranoid: true` → a nullable `deleted_at` (timestamptz) column (soft delete).
- `i18n: true` → `locale` (text NOT NULL) + `locale_group_id` (uuid NOT NULL,
  `DEFAULT gen_random_uuid()`) columns, plus a `(locale_group_id, locale)`
  unique index (**partial** `WHERE deleted_at IS NULL` on paranoid types) and a
  `(workspace_id, locale[, status])` list index. **Row-per-locale**: each locale
  of an entry is a full row; siblings share a `locale_group_id`. Per-field,
  `field.*({ localized: true })` marks a value as varying per locale (rejected
  at define time on a non-i18n type); an unmarked field is **shared** across the
  group. Relations follow their own rule — see **Relations across locales**
  below. This
  package owns the storage _shape_ only — what a locale _means_
  (allowed slugs, the default, scoping, sync) lives behind the
  `CONTENT_ENTRY_EXTENSION` port (see below), so content-server stays
  locale-agnostic.

`published_at`/`deleted_at` are **nullable with no default** (null = "not yet
published" / "not deleted"; the service layer stamps them). `status`,
`published_at`, `deleted_at`, `locale`, and `locale_group_id` are
**reserved unconditionally** — an author cannot define a field that maps to them
(rejected by `assertFields`), and a client cannot set them: they aren't in
`type.fields`, so `coerceValues` **drops them from the bag** before storage or
validation ever sees them (`toColumns` projects declared fields only). Note the
consequence, which is easy to misread from `EntryValidationService`'s
`rejectUnknownKeys: true`: the writer validates the **coerced** bag, so an
unknown key — reserved or simply misspelt — is silently ignored rather than
answered with a 422, on publishable and non-publishable types alike. That is
deliberate in one direction (a **stored revision snapshot** that outlived a
removed field is still restorable) and a rough edge in the other (a client
typo writes nothing and says nothing). The public API's `?fields=` and the
copilot's propose tools _do_ reject unknown names, because there the caller is
naming something they expect back. The
flags are carried on `ContentType` and serialized in the schema summary
(`i18n` on the summary, `localized` per field).

### Relations across locales (`syncAcrossLocales`)

A relation on an `i18n` type belongs to the **record**, not to the language: the
default is that assigning it in one locale assigns it in all of them. Two things
decide what actually happens, and only one of them is the author's:

- **The author** sets `field.relation({ …, syncAcrossLocales })` — a boolean,
  default `true`. `localized: true` on a relation is an **alias** for `false`
  (declaring both in contradiction is rejected at define time, as is setting it
  on a type with no locale siblings).
- **The target type** decides how a synced link is stored, because that is a
  storage fact rather than a preference. A non-`i18n` target means one row for
  the whole group, so every sibling holds the same id. An `i18n` target means
  each sibling must name that record's row **in its own locale** — a shared FK
  there would be exactly the cross-locale link `assertSameLocale` forbids.

`extension/relation-locale-sync.ts` is the one place that rule lives, consulted
by the schema serializer, the i18n sibling sync, and the copilot's translation
applier so the three cannot drift:

| `relationLocaleSync` | when                                        | stored                                       |
| -------------------- | ------------------------------------------- | -------------------------------------------- |
| `shared`             | sync on, target not `i18n`                  | the same target id in every sibling          |
| `mirrored`           | sync on, target `i18n`                      | that target's **group**, resolved per locale |
| `none`               | sync off, an inverse, or a non-`i18n` owner | nothing propagates                           |

Cardinality does **not** enter into it — a single FK, an owning many-to-many and
their join tables all follow the same rule. An **inverse** is always `none`: it
reuses the owning side's rows, so syncing from both ends would write them twice.

`isPerLocaleField` (also exported) is the _other_ question — does this row's
value differ from its siblings' — and it is what the serializer reports as
`localized`. Note the two are not opposites: a **mirrored** relation is
per-locale _and_ propagated, the id differing per row precisely so each row
points at the right translation. `relation.localeSync` is serialized on the wire
(on localized types only) so the editor can say what a save will reach.

**`unique: true` means one-to-one per _record_, and on a localized type a record
is N rows.** So the constraint is scoped to the locale there: `columnFor` omits
the column-wide `UNIQUE` on an `i18n` type and `buildTables` emits a partial
`uniqueIndex(<field>_id, locale)` instead (partial on paranoid types, like the
`(locale_group_id, locale)` pair, so a trashed row can't hold a target hostage).
The English and German rows of one article may therefore share one SEO record —
which is exactly what a **shared** relation does — while another article still
cannot claim it. A column-wide `UNIQUE` would have read "one _row_ may point
here" and made the second translation of any such record a flat constraint
violation.

The FK **leads** that index (`(<field>_id, locale)`, not the reverse).
Uniqueness of a pair is order-independent, but the leading column decides what
else the index serves — and the plain per-FK index is skipped for `unique`
relations on the assumption one already exists, which the inverse side's
`inArray(<fk>, sourceIds)` page read depends on.

Enforcement is in **both** places, deliberately. The index is the guarantee (it
is the only thing that holds under concurrency);
`EntryWriterService.assertUniqueRelations` runs first purely for the message,
turning what would be a 500 with a constraint name into the same
`{ field, message }` 422 as every other entry error. It compares translation
**groups**, not row ids — excluding only the row being written would make a
record's own second locale look like a rival claimant. A race that slips between
the two is caught by `uniqueGuarded`, which reads the violated constraint name
(`violatedConstraint`, from `utils-server`) to tell the two indexes on a
localized table apart: reporting a taken one-to-one as "this locale is already
occupied" would send the caller to fix the wrong thing.

### The entries extension port (`CONTENT_ENTRY_EXTENSION`)

`src/lib/extension/entry-extension.ts` declares a DI port (a `Symbol` + the
`ContentEntryExtension` interface) that a downstream plugin (e.g.
`@orthacms/i18n-server`) **binds** to extend the generic entries pipeline —
the same inversion as identity's `CONTENT_CATALOG`, roles swapped: the consumer
of the behavior declares the port here, the provider binds it. `EntriesService`
and `EntryWriterService` inject it with `@Optional()` and call it
**unconditionally**; an implementation MUST no-op for types it doesn't apply to.
Methods: `listScope` (extra list `WHERE`), `filterExtension` (virtual filter
fields resolved via the engine's `extensionFields` + `resolveExtension` seam),
`createColumns` (extra envelope columns on INSERT — may be **async**, e.g. to
validate a group id against the DB), `beforeWrite` (**optional**; the first
statement in the write transaction), `afterUpdate` (in-tx side-effects after a
save — runs on **both create and update**, e.g. syncing shared fields and
relation links to locale siblings; must no-op when nothing applies),
`describeFanout` (**optional**; the read-only counterpart of `afterUpdate` —
see below).

**`describeFanout` answers "what else would this write touch", before it is
written.** The pipeline never calls it: a save just saves. It exists for callers
that must _describe_ a change before making it — the copilot's `content_propose_*`
tools, whose receipt is the only place a user learns their content moved. It
reads only and takes **no locks** (it runs outside the write transaction, and a
`FOR UPDATE` held for the length of a model's turn is not a trade worth making),
so its answer is advisory by construction. Returning `undefined` — never an empty
description — is how an extension says "an ordinary single-row edit", which is
the common case and must stay silent.

**`beforeWrite` exists so an extension can order its locks, and nothing else
can.** By the time `afterUpdate` runs, the transaction already holds a row lock
on the entry being saved — taken by this service's own `UPDATE`, outside any
ordering the extension controls. An extension that then locks a wider set (i18n
locks the translation group's siblings `FOR UPDATE`) therefore cannot make the
acquisition deterministic from `afterUpdate`: two concurrent saves on two
members of one set each hold the row the other is about to request, whatever
order the extension's own select uses, and Postgres aborts one with
`deadlock detected`. `beforeWrite` runs **ahead of the row lock**, so a lock
taken there imposes a total order on the set (i18n takes a transaction-scoped
advisory lock on the `locale_group_id`) and the second saver waits instead. The
hook is handed the write's **stored** extension scope — on an update the row's
own `localeGroupId`, not the request's — since that is the set the write
actually contends on.

`afterUpdate` receives an **`EntryWriteContext`** (`{ created }`) because the two
writes are not symmetric. On an **update** the edited row is the authority and its
state propagates outward. On a **create** it is the opposite: a translation
arrives carrying the source's shared values but **none of its relations** (they
are join-backed, or per-locale and deliberately dropped by the client), so
treating it as the authority would push those gaps onto rows that were already
right — wiping the group's links. An implementation may also amend `row` **in
place** for columns it derives for that row; the caller snapshots `row` _after_
the call, so a database-only write would leave version 1 describing something the
row never held.

The `?locale=` / `?localeFallback=`
query params and the create body
`locale` + `localeGroupId` are declared on the DTOs as **opaque strings** (the
strict `ValidationPipe` rejects undeclared keys) and forwarded to the port
without interpretation — `localeGroupId` on a create is what makes the new row a
**sibling** in an existing translation group (the extension stamps + validates
it), so there is no separate "create translation" route. `create` wraps its
insert in `uniqueGuarded`, so a duplicate `(group, locale)` on an `i18n` type is
a clean **409**. A boot check (`EntryExtensionBootCheck`) fails start-up if an
`i18n: true` type has no extension bound. Only one binding is supported (a
second consumer would need a composite).

### The read-scope port (`CONTENT_READ_SCOPE`)

`src/lib/extension/read-scope.ts` declares a second DI port, for narrowing what
the **public** content API returns. `PublicEntriesQuery` and
`PublicExpansionQuery` inject it `@Optional()` and AND every returned fragment
onto the visibility predicate they already state, so a scope can only ever
subtract rows — there is no return value that widens a read.
`@orthacms/segments-server` is the first implementation (reader entitlements,
over the `@orthacms/segments-domain` kernel); with nothing registered — the
state of an installation that has not enabled it — the port costs a length
check.

Three things distinguish it from `CONTENT_ENTRY_EXTENSION`:

- **A registry, not a DI token.** Nest has **no multi-provider**: two dynamic
  modules binding one token do not merge, the second silently replaces the
  first, and for a visibility rule that means content quietly becoming visible.
  So a plugin registers at bootstrap with
  `contentReadScopeRegistrar('<label>', <ScopeClass>)` — the same shape
  `copilotToolsRegistrar` uses, for the same reason. `CONTENT_ENTRY_EXTENSION`
  stays a single binding held by i18n: a composite over it would fuse "narrow a
  read" and "extend a write" into one provider where a fault in either silently
  drops the other's clause.
- **Synchronous.** The predicate is assembled inside the query builder, and
  making that path async would ripple through every public read for one
  provider's benefit. An implementation needing I/O — resolving who the caller
  is — must do it earlier in the request and read the result from its own
  request-scoped state.
- **Public reads only.** The fragments are not applied to the admin's entries
  list. An admin caller is a member of the workspace looking at their own CMS,
  while a reader entitlement is about who may consume published content; scoping
  the editor's list by it would hide from an author the rows they are
  responsible for. The same split content grants already make.

It is applied in `liveWhere` rather than `readableWhere`, which is what makes it
unmissable: the list, the single-entry read and the translation lookup that
deliberately steps around the locale scope all pass through the former.
**Every hop asks separately, about the _target_ type** — a reader allowed to see
an entry is not thereby allowed to see everything it points at, so a scope keyed
to the requested type would leave every relation target unguarded. Two places
apply it, and both have to: `PublicExpansionQuery` when it hydrates linked
entries, and `RelationLinkService.targetVisibleWhere` — the one predicate every
relation read shares — which is what keeps `total` honest.

That second one is the subtle half. While the scope was applied only at
hydration, `items` was correct and `total` was not: a reader denied three of five
linked records saw two items under a `total` of five, and could infer that three
restricted records existed there. Paging for them returned nothing. The scope now
rides `RelationTargetVisibility` alongside `publishedOnly` — one flag, because
they answer one question and are needed at exactly the same call sites — so the
restriction goes _inside_ the window and the count.

### The publish-guard port (`CONTENT_PUBLISH_GUARD`)

`src/lib/extension/publish-guard.ts` declares a fourth port: how a downstream
plugin **refuses a publish**, without this package learning why.
`@orthacms/protection-server` is the first implementation (approval rules over
the `@orthacms/protection-domain` kernel).

**It is the third gate, and the order is load-bearing.** The
`content:publish` permission answers first (403, and the admin never rendered
the button); the **publish gate** answers second, inside `Entry.publish` (422,
with the failing checks); this port answers last (409 by default). A guard is
therefore never asked about an entry that would fail validation anyway — and a
guard's **bypass**, which is a caller-supplied `bypass: true` the port forwards
without interpreting, passes only the third. An incomplete entry stays
unpublishable for an administrator, which is the whole difference between
authorizing and validating (ADR-0015).

Consulted from `PublishEntryUseCase` and `BulkPublishEntriesUseCase`, which is
why one registration covers the admin route, the public REST write, the GraphQL
mutation and the MCP tool at once. Nothing enumerates them.

- **A registry, not a token**, for the reason `CONTENT_READ_SCOPE` documents —
  and more sharply here: a silently-replaced read scope makes content visible, a
  silently-replaced publish guard makes a rule _stop applying_, and the
  installation that bought the rule is the one that would never notice. Register
  with `contentPublishGuardRegistrar('<label>', <Class>)`. Several guards AND
  together: the first refusal wins and no later guard is asked.
- **With nothing registered it returns without awaiting anything.** Not "the same
  outcome after one extra query" — the same path. That is `protection:I-01`, and
  `publish-guard.spec.ts` asserts it directly.
- **A refusal carries its own status, code and details, and content relays
  them.** Content has no vocabulary for what makes a publish refusable, so the
  guard names it. `409` is the default because `403` would be
  indistinguishable from lacking `content:publish` — the caller has to be able to
  tell "ask an administrator for a permission" from "ask a colleague for an
  approval".
- **An allowing verdict may carry domain events**, which the use-case appends to
  the outbox alongside its own and stamps with the actor. That is how a bypass's
  audit row commits in the same transaction as the publish it excuses, without
  content knowing what a bypass is.
- **A guard runs inside the publish transaction** and must authorize rather than
  validate. One that inspected field values would be the second authority
  ADR-0015 refuses.

On the bulk path each id is asked **separately** — on a localized type those ids
are one record's translations, and a rule is satisfied per locale — and a refused
one becomes a `skipped` entry with the `guard-refused` verdict rather than
failing the batch. That is also the server half of "publish every locale": the
i18n menu sends the sibling ids as one bulk publish, so a per-id verdict is a
per-locale verdict.

### The entry-write extension port (`ENTRY_WRITE_EXTENSION`)

`src/lib/extension/entry-write-extension.ts` declares a third port: how a
downstream plugin stores state **about** an entry — in a table content-server
knows nothing about — inside the entry's own write transaction and inside the
entry's own version history. `@orthacms/segments-server` binds one under the key
`access`, so who may read a record is set on Save.

The wire is the save body's `extensions` bag (`SaveEntryDto.extensions`),
declared **opaque** exactly as `locale` is: content forwards it to the registry
and never looks inside. `EntryWriterService.create`/`update` call `applyAll`
inside the transaction, just before appending the revision, then `captureAll`
into `RevisionSnapshot.extra`; `RestoreRevisionUseCase` passes a restored
version's `extra` straight back through `update`.

Four decisions worth knowing:

- **It exists for the version, not for tidiness.** A plugin could always have
  called a `PUT` of its own after the save. What it could not do is have the
  revision record what it wrote: a revision is built _inside_ the write, so a
  later request is only ever captured by the **next** save — every version would
  record the access the entry used to have. And a restore would put back a
  version's words without its audiences, which is the quiet half of a restore
  nobody thinks to check.
- **`apply` runs only for keys the caller sent; `capture` runs for every
  snapshot.** The asymmetry is load-bearing in both directions. A save that says
  nothing about a plugin's state must leave it alone, so an omitted key is not a
  clear. But a _version_ that recorded state only when it changed would restore
  as a version that had none — including the locale siblings an extension
  rewrote, which get their own revisions.
- **`apply` reports the other rows it changed, and they get revisions too.** It
  returns entry ids; `applyAll` collects and deduplicates them, and the writer
  feeds them to `appendRevisionsFor` alongside the rows `CONTENT_ENTRY_EXTENSION`
  rewrote — resolving them to rows itself, since an extension wrote a table of
  its own and has none to hand back. It is the same defect either path would
  otherwise have: a row whose stored state moved while its timeline did not is a
  history that hides the change, and restoring one of that row's versions undoes
  it silently. The dedup matters because one save can reach a sibling through
  both paths — a shared field _and_ an audience — and two revisions for one row
  read as two edits.
- **`inherit` is the create-only third call, and it exists because of that
  asymmetry.** On a create, `inheritAll` runs right after `applyAll` and lets an
  extension give a just-inserted row whatever the rest of its **locale group**
  already holds. "Create a translation" sends no `extensions` bag at all, so
  `apply` never runs — and segments' state is not a column, so nothing in
  `CONTENT_ENTRY_EXTENSION`'s own sibling sync reaches it. Without this hook,
  translating a restricted article produced a public German copy of it: the
  failure mode a reader notices and an editor never does. It is optional, runs
  after `apply` so a caller who just said what to store is not overwritten, and
  is the same create-only posture as i18n's relation inheritance.
- **An unknown key is ignored, not refused.** The bag comes from a client that
  may be talking to a deployment without that plugin; a 400 would make one
  request work on one install and fail on another. What the version then records
  is still the truth, since `capture` reports no state for a key nothing owns.
- **A registry, not a token**, for the reason `CONTENT_READ_SCOPE` documents:
  Nest cannot merge two bindings of one token, and an extension that silently
  stopped being called writes nothing and captures nothing — a restriction that
  quietly stops applying. Register with
  `entryWriteExtensionRegistrar('<label>', <Class>)`.

**Authorization stays with the extension.** The save's own gate is
`content:create`/`content:update`, which is not the same authority as deciding
who may _read_ the record — so segments checks `segments:manage` itself, inside
`apply`, and refuses a caller it cannot identify. A request that asks for exactly
what is already stored changes nothing and needs none, which is what keeps a
restore working for anyone who may restore. The port carries no permissions of
its own: only the extension knows what its own state is worth.

The **public API's** `PublicSaveEntryDto` deliberately has no `extensions` key,
so a bearer token cannot reach this path at all.

### The virtual filter-field registry (`ENTRY_FILTER_PROVIDER`)

`CONTENT_ENTRY_EXTENSION.filterExtension` already declares virtual filter fields
(i18n's `hasLocale` / `missingLocale` / `localeCount`), but that port is a
**single binding** and i18n holds it — so a second plugin binding the token would
silently replace the first, which for a filter surface means fields quietly
vanishing from the picker and saved filters starting to 400.

`src/lib/extension/entry-filter-provider.ts` is the registry a second
contributor uses instead (`entryFilterProviderRegistrar('<label>', <Class>)`),
the same shape and the same reason as `contentReadScopeRegistrar`.
`EntryFilterProviderRegistry.compose(type, bound)` folds the bound extension and
every registered provider into the one `EntryFilterExtension` the query path
already understands, so `EntriesService.listWhere` and `EntryMatchQuery` changed
by one call each and nothing downstream moved.
`@orthacms/segments-server` fills it with **who can read this** — `audienceAllowed`,
`audienceDenied`, `accessRestricted`.

Three rules a contribution owes:

- **Every emitted subquery MUST scope to the workspace it is handed.** A virtual
  field is a subquery over a table this package knows nothing about; one that
  forgets the workspace turns a filter into a cross-tenant read.
- **Only declare fields you can answer, with only the operators you support.**
  The declared `fields` become the SQL whitelist, so an operator the resolver
  refuses reaches the user as "couldn't load this collection" over a rule the
  picker itself proposed — narrow the admin's `FilterField.operators` to match.
- **A filter narrows a list; it is not a visibility rule.** Reachability is
  `CONTENT_READ_SCOPE`'s job and is applied separately.

`compose` routes each rule to **whoever declared its field**, and keeps the
first declarer of a duplicated name. Letting the last writer win would make what
a saved filter _means_ depend on plugin registration order.

### The copilot tools (`src/lib/copilot/`)

This package **binds** the copilot's tool port, the same inversion again with
the roles swapped back: `copilot/server` declares `COPILOT_TOOL_PROVIDER` (in
`copilot-domain`) and never imports content, while content — which already owns
`EntriesService`, `EntryWriterService` and the registry — supplies the tools as
thin wrappers over them. No query logic is duplicated and no refactor was needed.

- `ContentCopilotToolProvider` ships phase 1's three **read-only** tools:
  `admin_content_types`, `admin_content_search`, `admin_content_get`. Between
  them they reach the same query surface the admin's records table does —
  free-text search, the structured `?filter=` tree, sorting, paging, locales,
  and sparse fieldsets — so "which German articles has Ada not published?" is
  one tool call rather than a page-by-page crawl the run's step limit ends
  first.
- **`status` alone is not the publish state, and three things had to agree
  before the copilot could say so.** The envelope carries `status` _and_
  `publishedAt` (`projectEntry` always keeps both — `fields` narrows `values`
  only), so "modified" is expressible as `status eq draft` AND `publishedAt op
null value false`. It was not _reachable_, though: **`admin_content_types`
  advertises the admin PICKER's list**, and `scalarWireOf` pushes `status` plus
  the type's own fields, deliberately leaving the envelope timestamps out — a
  person reading a **Modified** badge does not need `publishedAt` in a picker.
  The filter grammar meanwhile tells the model only listed paths are accepted,
  so it fell back to `status eq draft` (counting never-published drafts as
  edits) or invented `status eq "modified"` (an enum error). Fixed by having
  `describeFilterFields` union the **root of the SQL `FilterSchema`** — the
  security boundary itself, so a field added to `scalarFieldsOf` is offered
  automatically — minus `locale`/`localeGroupId`, which have a dedicated tool
  parameter and whose filter spelling would AND against the extension's own
  scope and read zero rows from a valid query. The picker is untouched. On top
  of that the search tool's description names the filter, and the system prompt
  (v6) carries the concept, since the pair is true of every publishable type
  rather than of one tool.
- **`filter` is the query builder's own grammar** (`copilot/filter-schema.ts`):
  a node is a group (`{and: […]}` / `{or: […]}`) or a rule
  (`{field, op, value}`), so the model emits exactly what the admin's UI emits
  and `parseFilterTree` validates both. The model gets an **object** and the
  tool stringifies it — the wire wants JSON in a query param, but an object is
  far easier for a model to build correctly. It never writes SQL: every path is
  checked against the type's schema, so an unknown field or an ungranted
  relation hop is a rejected filter. The paths on offer come from
  `admin_content_types`, which returns `filterableFields` built with
  `grantedTypes` — the same grant-pruning the public API applies, so a hop into
  a type the workspace was never granted is never advertised.
- **`fields` projects `values`** (`copilot/project-entry.ts`) and is what makes
  "list all the articles" possible at all: a full `EntryRecord` carries every
  richtext body, so a page of 25 exhausts the run's token ceiling long before
  its row cap. The envelope — `id` above all — is always kept, since a
  projection that could drop it would break the follow-up `admin_content_get`.
  An unknown name is **ignored**, not a 400 as on the public API: there a typo
  is a developer's bug worth surfacing, here the name came from a model that
  may have mis-remembered a field, and the returned `values` already say what
  was found.
- **`locale` / `localeFallback`** are forwarded verbatim to the bound
  `CONTENT_ENTRY_EXTENSION`, which validates the slug and scopes the rows —
  content-server stays locale-agnostic here as everywhere. An unknown locale is
  a tool error, never a silent read of the default. `admin_content_get` takes no
  `locale`: an entry id already names one row including its locale.
- `RevisionCopilotToolProvider` ships the **version-history** pair,
  `admin_content_revisions` and `admin_content_diff`. A second provider rather
  than more methods on the first: revisions are their own feature folder with
  their own port, and the registry takes any number of providers. `diffRevisions`
  returns **only the changed fields** plus a count of the unchanged ones — the
  admin's dialog renders every field because a person wants unchanged rows for
  context, but on a wide type the unchanged richtext bodies alone would dominate
  a run's token budget. The comparison rules (`copilot/diff-snapshots.ts`, pure
  and unit-tested) mirror `content-admin`'s `diffRevision` exactly: empties
  collapse, link sets compare order-sensitively. The duplication is deliberate
  until the two sides' schema types are unified — noted at the call site.
- Both providers are registered by `copilotToolsRegistrar('content', …)` from
  `@orthacms/copilot-server`, in `ContentModule.forRoot`'s `providers`.
  Registration is a **runtime `register(...)` call**, not a multi-provider
  binding: Nest cannot merge a multi-provider token across independent dynamic
  modules, so a second binder (media, i18n, …) would silently replace this one.
  The helper exists because the hand-written registrar it replaced had to inject
  the registry `@Optional()`, and a `Foo | null` parameter type emits `Object`
  for `design:paramtypes` — Nest then injects `undefined` silently, producing a
  copilot with no content tools and no error anywhere. A factory's `inject` list
  names its dependencies as values, so there is no reflected type to get wrong.
- `EntryProposalToolProvider` ships the **write** tools,
  `content_propose_create`, `content_propose_update` and
  `content_propose_bulk_save` (all `effect: 'propose'`).
  Neither writes anything: they compute a change and hand it back, and the run
  engine records it for a human to accept. That is the whole point of the split
  — the tool is a pure function of the model's arguments plus the current
  entry, so a prompt-injected "just save it" has nowhere to land. `proposeEdit`
  reads the live entry so the proposal carries a real before/after diff, drops
  fields that would not actually change, and refuses an edit that changes
  nothing.
- **An edit that reaches other locales says so.** On a localized type a field the
  type does not mark `localized` is _shared_, so writing it propagates to every
  sibling in the translation group — correctly, since "shared" means shared, and
  refusing it would leave no way to edit a shared field at all
  (`i18n_propose_translation` rejects them outright, so the content tools are the
  only route). What was missing is that nobody was told: under ADR-0009 the
  change applies as it is drafted, so one accepted proposal could rewrite a
  record in four languages while `copilot_proposals` recorded a single-entry
  edit. `proposeEdit` and `proposeBulk` now ask the bound extension's
  `describeFanout` — against the **patched** values, so the disclosure names what
  will actually be written rather than everything the model sent — and fold the
  answer into the `summary` plus a structured `target.fanout`. The summary
  because of where a summary _goes_: it is the card's title, the audit row's
  `output_summary`, and the run engine's `Applied: …` receipt, so one string
  reaches the person, the log and the model — and the model correcting itself
  ("that touched every language; a translation wants `i18n_propose_translation`")
  is worth as much as the card. `content_propose_create` does not ask: a create
  starts its own group and has no siblings to reach. An unknown field name is an **error** here, unlike the reads'
  `fields`: the cost is a human approving a change they believe writes a field
  that does not exist. Join-backed relations are refused for the same reason —
  their links never travel in the values bag, so a value for one would be
  silently dropped. **No `status` parameter exists at any role** (ADR-0005 §7):
  the copilot may prepare a publishable draft; a person presses publish.
- **`content_propose_bulk_save` is one change, not a loop.** "Translate these
  eight posts" used to be eight tool calls — eight steps against a bounded run,
  and eight cards in the transcript for one instruction, none of which said what
  the other seven were. It takes `items[]` with the smaller half of the public
  API's addressing (an `id` updates, no `id` creates; no group-addressed update,
  since the admin tools hand the model entry ids), reads every edited entry at
  propose time so the card carries a real diff, and prefixes each change's
  `field` by position because the card keys its rows on that name. Fields that
  would not change are dropped and an item left with none is dropped whole —
  more than card hygiene here, since writing an entry its own current values
  still appends a revision and takes a **live** entry back to draft, so a model
  re-sending twenty unchanged records would unpublish twenty live pages. There is
  deliberately **no** bulk publish and no bulk delete: batching is a way of
  asking, not a route to authority a single-entry tool was never given
  (ADR-0005 §7). `BulkSaveEntriesProposalApplier` writes the items one at a time
  through the same `EntryWriterService` methods and **stops at the first
  failure**, throwing a message that names how many landed — a proposal is one
  row with one status, so carrying on would grow the number of entries written
  under a receipt that then reports failure. (The public API's `bulkSave` does
  the opposite, because there every item gets its own verdict.)
- **Neither create tool takes a `localeGroupId` any more**, and that is a rule
  rather than a simplification. Joining a translation group looks like a create
  with two extra arguments and is not one: a create is a whole row, so every
  shared field the change did not name arrives as `null`, and the i18n
  extension propagates a create's shared columns **outward** onto every sibling
  — blanking the record in every other language, silently where the siblings
  are drafts. Doing it right means inheriting the source row's shared values at
  apply time, which is knowledge the i18n plugin owns, so
  `i18n_propose_translation` / `i18n_propose_bulk_translation` are the route and
  these tools create new records only. `locale` stays: a **new** record written
  in French starts its own group and has no siblings to blank. The appliers
  refuse a stored `localeGroupId` outright (`assertStartsItsOwnGroup`), which
  covers the one case a schema change cannot — a proposal drafted before this,
  left `pending` by a failed apply, carried out later. The public API's `/bulk`
  is unaffected: a client there sends the whole document, which is what a create
  joining a group needs.
- `CreateEntryProposalApplier` / `UpdateEntryProposalApplier` carry those
  changes out, through **`EntryWriterService.create` / `.update` — the same
  methods the HTTP routes call**. Not "similar to": the same, which is what
  makes an accepted proposal validated, advisory-locked, snapshotted as a
  revision and passed through the i18n extension exactly as a hand-typed entry
  is. The update **merges** rather than replacing (the admin's `PATCH` replaces
  because the editor submits the whole document; a proposal carries only what a
  reviewer approved), and it reads the entry **now**, so a proposal accepted an
  hour later writes the approved fields onto whatever the entry has become
  instead of rewinding it. Grants are re-checked at apply time, not trusted from
  the row — a stored `typeName` is an argument like any other.
- **Every tool re-checks the workspace's content grants** via
  `WorkspaceGrantsQuery` — which is **exported from this package and from the
  global module** for the same reason: i18n and media bind their own
  content-scoped tools, each takes a type name from the model, and that check
  needs one implementation rather than one per binder. `WorkspaceGuard` proved the caller belongs to the
  workspace, not that the workspace may reach a given type — and the type name
  arrives from the _model_, which is steerable by content it has read. "Not
  granted" and "does not exist" return the **same** message, so a run in one
  workspace cannot enumerate the deployment's other content types.
- Page size is clamped in `run` as well as declared in the input schema: the
  schema validator is defence in depth, not the boundary, and a model ignoring
  `maximum` must not be able to pull a whole table into a prompt.

## Generated storage (`buildTables`)

One `content_<name>` table per type; one `content_<name>_<field>` join table per
**many-relation** (`source_id`, `target_id`, and a float `position` for the
source's ordering of its links). Every table carries the base envelope: `id`, `workspace_id`
(plain uuid, no FK — the `workspaces` table is identity-owned; entries are
scoped to it in the app layer, see HTTP surface), `created_at`, `updated_at`.
A `publishable` type additionally gets `status` (`draft`/`published`) +
`published_at`; a `paranoid` type gets `deleted_at`. The list index is
`(workspace_id, status)` for publishable types, else `(workspace_id)`.
A required `boolean` gets `DEFAULT false`. Field/column collisions (two fields
snake-casing to the same column, a field clashing with a relation's `<field>_id`,
or a reserved envelope column) are rejected by `assertFields`.

**Required ⇒ NOT NULL only for non-publishable types.** A publishable type has a
draft stage, so its required fields stay **nullable** columns — "required" means
"required _to publish_", enforced by `EntryValidationService` at publish time, not
the DB (else an incomplete draft couldn't be saved). A non-publishable type is
always live, so its required fields are `NOT NULL`. `EntryWriterService` mirrors
this: create/update on a publishable type always produce a **draft** working copy
and are **not** eagerly validated (a draft may be incomplete); publish
re-validates the stored row. A non-publishable type validates every write.
**Editing a published entry moves it back to draft** (`status → draft`): the save
is unpublished working changes, while the entry's previously-published _version_
stays live in history until the next publish (see Revisions). To make content
live again you publish — the entry's latest, or any specific version.

`published_at` is **kept** across that edit — it records that the entry _has_ a
live version, which editing doesn't retract; only `unpublish` clears it
(`markDraft`). So the pair carries three states, not two: `published` = live and
current, `draft` + a `published_at` = live content with unpublished changes on
top (the admin's **Modified** badge), `draft` + no `published_at` = never
published. Note this makes `?filter=` on `publishedAt` mean "last went live at",
not "is currently live" — filter on `status` for the latter.

A **required link-managed relation** (an owning many-to-many, or the inverse of
one) can't be checked by `EntryValidationService` — its links never travel in the
`values` bag. `EntryWriterService.assertRequiredRelations` enforces it separately
by **counting the entry's links**: eagerly for non-publishable creates/updates
(inside the write transaction so it sees the just-written rows) and at publish
against the stored links. A required such relation with zero links is the same
`422 is required`. A required single relation is still an FK in `values`,
validated there; an inverse-of-single owns no writable link from this side, so it
isn't enforced.

## The `/define` vs main-barrel split — IMPORTANT

Collection files and the host's drizzle-kit schema entry MUST import from
`@orthacms/content-server/define`, **not** the main barrel. drizzle-kit bundles
the schema's whole import graph with plain esbuild, which rejects the NestJS
decorators the main barrel pulls in via its controllers. `/define` re-exports
only the decorator-free DSL (`collection`, `single`, `field`, `joinTableOf`, types).

## Migrations: the content model is HOST-owned, `saved_views` is not

The **generated collection tables** emit no migrations from here. The HOST
(`apps/server`) re-exports every generated table from `src/content.ts` (use
`joinTableOf(type, field)` for join tables — it throws if a many-relation was
renamed, instead of silently dropping the table from the diff), runs
`db:generate` against its own `drizzle.config.ts`, and commits the SQL.
`ContentPlugin({ types, migrations })` carries a `migrations` descriptor
(`__drizzle_migrations_content`) so the standard `db:migrate` applies them with
every other plugin's. That is the rule for anything derived from a host's
code-defined content types: their shape is per-app, so their migrations are too.

The package does own **fixed platform tables** — currently `saved_views` and
`saved_view_defaults` (see [The `views` feature](#the-views-feature--saved-list-views)).
Those ship from here, with this package's own `drizzle.config.ts` and
`migrations/`, because their shape is the same in every installation.

They ride a **second `ServerPlugin` entry**, `ContentViewsPlugin`, rather than
`ContentPlugin`. Not a style choice: `ServerPlugin.migrations` is a single
`{ dir, table }` descriptor, and content's is already spent on the host's
generated tables. A second entry is how one package ships two independently
tracked migration sets without widening that contract. The host lists it after
`ContentPlugin`, and after identity and workspaces — `saved_views` has foreign
keys into `users` and `workspaces`, and `applyPluginMigrations` walks the plugin
array in order with nothing declaring that dependency.

Generate this package's own migrations with:

```bash
npx nx run "@orthacms/content-server:db:generate" --name=<change>
```

## HTTP surface (`/api/content-schema`, `/api/content`)

**Every `/content/:typeName…` entry route is workspace-scoped.** Each carries
identity's `WorkspaceGuard` (after `OriginGuard`/`PermissionsGuard`, so a request
rejected for CSRF or lacking permission never incurs the membership DB probe): it reads
the `X-Workspace-Id` header (400 if missing/malformed), 403s a caller who isn't a
member of that workspace, and exposes the id via `@CurrentWorkspace()`. The
entries services thread it through — `create` stamps `workspace_id`, and the
list + every read/write/bulk op filters by it — so an entry never leaks across
workspaces and an id from another workspace reads as a 404.

**Every `/content/:typeName…` route is also grant-scoped.** `ContentGrantGuard`
(`entries/http/guards/content-grant.guard.ts`, listed right after
`WorkspaceGuard` so it can read `request.workspaceId`) refuses a `:typeName`
the open workspace was never granted in `workspace_content`, with the **same
404 an unknown type gets** — grants read before any registry decision, same
status, same message, so the routes disclose nothing about the content model
outside the caller's workspace. Membership is not access: the grant set is the
workspace's declared content surface, the nav renders from it, and revoking a
grant is refused while entries still exist. Every other surface over this
content already applied the rule (the public REST API's `resolveGrantedType`,
the GraphQL adapter, the MCP tools, the copilot's read/propose tools); the
session-side admin API used to be the one exception, so a member of a workspace
granted only `article` could list, read, create, edit, publish, delete and read
the revision history of any other registered type in it.

The **catalogue** route `GET /content-schema` stays unscoped — content types
are code-defined and global, and the admin's ⌘K palette reads it with no
workspace open, then intersects it per workspace client-side. `:name` and
`:name/filter-fields` are both workspace-scoped and grant-checked.

`EntryCounterService.countWorkspaceEntries` deliberately keeps counting **every**
registered type, granted or not — it backs the workspace-delete guard, where
missing a row means deleting a workspace that still holds data (see its JSDoc).

- `GET /content-schema` — summaries of every type (wizard-compatible). The one
  route here with no workspace scope.
- `GET /content-schema/:name` — the full field schema (types, validation, admin
  props). **Workspace-scoped + grant-checked**: an unknown _and_ an ungranted
  name are the same 404.
- `GET /content-schema/:name/filter-fields` — the type's **filterable surface**:
  every scalar path the records-table query builder may filter on, including
  **recursive relation paths** (`author.name`, `author.company.name`, to a
  default 2-hop budget). Built by `buildEntryFilterSurface`
  (`entries/infrastructure/queries/entry-filter-surface.ts`) in **one traversal**
  that produces BOTH this wire list AND the SQL `FilterSchema` the list endpoint
  enforces, so the picker can never offer a path the API rejects (an
  `entry-filter-surface.spec` drift test pins it). **Workspace-scoped**
  (`WorkspaceGuard`) and **grant-pruned**: `WorkspaceGrantsQuery`
  (`content-types/queries/`) reads the workspace's `workspace_content` slugs, an
  ungranted `:name` 404s exactly like an unknown one (no enumeration signal),
  and the slugs are passed as the builder's `grantedTypes` so the picker never
  offers a traversal into a collection the caller cannot open. Cardinalities map
  to the engine's `RelationKind` (owning single →
  `many-to-one`, owning many → `many-to-many`, inverse-of-single → `one-to-many`,
  inverse-of-many → `many-to-many` swapped, self single → `self-referential`;
  self many-to-many skipped in v1), and every emitted relation carries a `scope`
  (workspace + soft-delete) so a relation filter never matches a soft-deleted or
  foreign target. The list endpoint (`EntriesService.listWhere`) derives its
  filter schema from the same builder — **lazily**, only when `?filter=` is
  present, since building it walks the whole relation graph — so **relation
  filtering works over the API** regardless of the UI. The list's schema is
  deliberately **not** grant-pruned: it is the SQL whitelist, not a visibility
  boundary, and pruning it would make the same saved filter 400 or change
  meaning depending on which workspace opened it.
- `GET /content/:typeName` — one page of a collection's entries
  (`?search=&filter=&sort=&page=&pageSize=&deleted=` → `{ items, total, page, pageSize }`).
  Resolves `:typeName` via the registry (404 if unknown), then runs the **generic**
  pipeline in `entries/` (`EntriesService`): an ILIKE search over text-like
  columns, the query-builder `?filter=` tree (translated against a `FilterSchema`
  **derived per-request** from the type's fields by `buildEntryFilterSchema`), a
  whitelisted sort with an `id` tiebreaker, and `LIMIT/OFFSET`. `status` is
  searchable/filterable/sortable and returned **only on publishable types**;
  paranoid types exclude soft-deleted rows by default, or list **only** them with
  `?deleted=only` (the trash view). A malformed filter → 400.
  **Relation preview (opt-in).** `?relations=preview&relationFields=a,b` adds a
  `relations` map to each row — per named field, one **capped page** of
  `RelationRef`s (`RELATION_PAGE_SIZE`) plus the true `total`. It is opt-in
  because the relation **picker** reuses this endpoint for candidates and must
  not pay for expansion; the admin sends it only for the records table's
  **visible** relation columns, so a hidden column costs nothing. Unknown names
  in `relationFields` are dropped (only keys on `type.fields` reach a query).
  Resolution is `RelationLinkService.previewForEntries` — **batched across the
  whole page**: one windowed query per relation _field_
  (`row_number()` for the cap, `count(*)` for the total, partitioned by the
  owning id) plus a batched `refsFor` for titles, covering owning single, owning
  many, and inverse alike. It is deliberately **not** built on the per-entry
  `readAll` (that would be an N+1 over rows); `relation-preview.spec.ts` pins
  the query count flat as the page grows. `values` is untouched — an owning
  single relation still carries its raw FK there, which is what a save submits.
- **Entry writes** (`EntryWriterService`, generic over the type like the reader;
  `entry-row.ts` holds the shared row↔record mappers). All validate via
  `EntryValidationService` — a failure is **422** with `{ message, issues:
[{ field, message }] }`. Each resolves `:typeName` (404), guards state-changing
  requests with `OriginGuard` (CSRF), and is permission-gated: - `POST /content/:typeName` — create a draft (`content:create`). The insert
  runs in a transaction that first takes the workspace's **shared** advisory
  lock (`lockWorkspaceShared` from identity), coordinating with the workspace
  delete / content-revoke emptiness guards (which take it exclusively) so a
  new entry can't be orphaned by a concurrent delete/revoke. - `GET /content/:typeName/:id` — read one live entry (`content:read`). - `GET /content/:typeName/:id/relations` — every relation field's **first
  page** + total (`{ relations: { <field>: { items: RelationRef[], total } } }`,
  `RelationRef = { id, title, slug?, status?, missing? }`), for owning single/many
  **and** inverse back-references. A link whose target can't be resolved
  (soft-deleted, or outside the workspace) still yields a ref — id-only and
  flagged **`missing: true`**, so `items` never runs shorter than `total` —
  and the admin renders it as an unavailable record rather than printing the
  raw id. `slug` is the target's slug-field value —
  the field flagged `admin.widget === 'slug'`, else one literally named
  `slug` (`entrySlug` in `entry-row.ts`) — present only when the target has
  one and the row's slug is non-empty; the admin renders it as a `/handle`.
  `RelationLinkService.readAll` reads each field independently (paginated),
  so a relation with many links contributes only its first page, never every
  id. The editor titles single relations and seeds the section counts from it
  (`content:read`). - `GET /content/:typeName/:id/relations/:field?page=&pageSize=` — one page of
  a single relation field's links (`{ items, total }`), ordered by
  `position`. Drives the editor's **infinite-scroll** of a many/inverse
  relation. 400 if `field` isn't a relation (`content:read`). - `PATCH /content/:typeName/:id` — replace values (`content:update`). - `POST /content/:typeName/:id/publish` · `/unpublish` — stamp/clear
  `status`+`published_at`; publish **re-validates the stored row**; 400 on a
  non-publishable type (`content:publish`). - `DELETE /content/:typeName/:id` — soft delete (paranoid) or hard delete;
  `POST .../restore` + `DELETE .../permanent` for paranoid types
  (`content:delete`). - `POST /content/:typeName/bulk/{publish/preview,publish,unpublish,delete,restore,purge}` —
  `{ ids }` batch ops; `publish/preview` is a dry run returning a per-entry
  verdict (will-publish / already-published / blocked+issues / not-found),
  and `publish` re-validates and publishes only the valid drafts.
- **Routing order matters:** `BulkEntriesController` is registered **before** the
  single-item controllers in `ContentModule.forRoot` so the literal `bulk`
  segment wins over `:id` (single-item `:id` also carries `ParseUUIDPipe` as a
  backstop).
- **Relation persistence** (`RelationLinkService`): an owning **single** relation
  is a plain `<field>_id` FK column (written by `toColumns`, read off the row).
  Everything **join-backed** — an owning **many-to-many** and the **inverse**
  side of a two-way relation (which reuses the owning join table, source/target
  swapped) — is **paginated** on read and edited by an **incremental delta**
  carried in the save body (`SaveEntryDto.relations = { <field>: { link?, unlink?,
order? } }`): inside the create/update transaction `applyDelta` unlinks the
  removed pairs, appends the new ones at `max(position)+1` for their source
  (`ON CONFLICT DO NOTHING`), and renumbers to `order` (owning side only) — so a
  relation with thousands of links is never sent or held whole, and the row and
  its links commit as one. The `max(position)+1` append is a read-modify-write on
  a contended column, so it first takes a **transaction-scoped advisory lock on
  the physical source list** (`<join table>:<sourceId>`, via `lockSource`) — the
  owning side, the inverse side, and a whole-set write all target the same list,
  and without it two concurrent appenders could read the same `max` and collide
  on `position`; the inverse loop locks its owners in sorted order to stay
  deadlock-free. A `relations` key that owns no writable link from this
  side — a single relation, an inverse-of-single (one-to-many), or an unknown
  key — is a **400** (so a delta is never silently dropped); a structurally
  malformed delta (`link`/`unlink`/`order` not a uuid array, an unknown inner
  key, an over-large id array, or too many fields) is a **400** at the DTO
  (`IsRelationDeltaMap`, which size-bounds the arrays and the map and rejects
  non-whitelisted inner keys), never a 500.
  `assertTargets` validates every linked id exists in the same workspace (uniform
  422, no enumeration signal). Join rows carry a float `position` (the source's
  own ordering) so a reorder survives a reload; the inverse reads by it but can't
  set it. An inverse of a _single_ relation (one-to-many) owns no writable link
  from its side. The whole-document write still supports a many-relation
  submitted in the entry body (`writeLinks`, replace-set, position = array
  index) — used on **create** and by any legacy/bulk caller; a field absent from
  the body is left untouched (never wiped).
- Reads gated `@RequirePermissions(PERMISSIONS.CONTENT_READ)`; writes on the
  matching `content:create`/`update`/`publish`/`delete` (admin holds all,
  contributor create/update/publish/delete, viewer read-only).

## Public content API (`/api/v1`, `src/lib/public-api/`)

The **token-authenticated read surface** an external site or app fetches content
with — the consumer side of the bearer tokens `identity-server` mints and the
admin's API Tokens page manages. Layered per ADR-0003, sibling to `entries/`:

```
public-api/
  http/
    api-token-request.ts          # PublicApiToken + the request it rides on
    guards/api-token.guard.ts     # Authorization: Bearer → verified token + scope check
    guards/api-token-workspace.guard.ts  # which of the token's workspaces this request targets
    decorators/current-api-token.decorator.ts
    controllers/                  # public-entries, public-content-types, resolve-granted-type
    dto/                          # the narrow published query contract
  infrastructure/
    public-entries.query.ts       # the published-only read
    public-entry-row.ts           # row → PublicEntry projection (pure, unit-tested)
  types/public-entry.ts           # the WIRE CONTRACT — a published API, kept still
```

**Routes** (all `@Public()`, so the session `AuthGuard` skips them — a bearer
token is the only way in, and a session cookie is _not_ accepted):

- `GET /v1/content-types` — summaries of every type the workspace was granted.
- `GET /v1/content-types/:name` — one type's full field schema.
- `GET /v1/content/:typeName` — one page of published entries
  (`?search=&filter=&sort=&page=&pageSize=&fields=&locale=`). Serves **singles
  too** — with i18n a single still has one row per locale, so the list envelope
  is honest for both; take `items[0]`.
- `GET /v1/content/:typeName/:id` — one published entry (`?fields=&locale=`,
  plus the same expansion params as the list).
- `GET /v1/content/:typeName/:id/relations/:field?page=&pageSize=` — one page of
  one relation field's links.
- `GET /v1/content/:typeName/:id/media` — every media field, resolved to asset
  metadata + URLs.
- `GET /v1/content/:typeName/:id/translations` — the entry's other locale rows.

### Writes (`full`-scope tokens)

| Route                                                        | What it does                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| `POST /v1/content/:typeName`                                 | create a **draft** (`values`, `relations`, `locale`, `localeGroupId`) |
| `PATCH /v1/content/:typeName/:id`                            | **partial** update + relation deltas                                  |
| `POST /v1/content/:typeName/:id/publish` \| `/unpublish`     | the publish lifecycle                                                 |
| `DELETE /v1/content/:typeName/:id`                           | soft delete (paranoid) or hard delete                                 |
| `POST /v1/content/:typeName/bulk`                            | **batch save** — create and/or update many entries                    |
| `POST /v1/content/:typeName/bulk/{publish,unpublish,delete}` | the batch forms of the lifecycle writes                               |

Plus `/v1/media/assets` (upload) and `/v1/media/assets/:id/raw` (bytes), which
live in **media-server** — see its AGENTS.md.

**Batches** exist because an external client is usually syncing a _list_, and
one HTTP round trip per record is the difference between a job that finishes and
one that times out. They are a way of asking, never a second set of rules: each
runs the same use-case its single-entry sibling does. Two contracts, and the
difference between them is not arbitrary:

- **`/bulk` (save) reports per item and keeps going.** `EntryWriterService`
  opens its own transaction per write, so there is no batch to roll back even in
  principle — and rejecting forty-nine good rows because the fiftieth names a
  missing relation would defeat the endpoint. The response is always a 200
  carrying a verdict per item in request order, each failure repeating the
  status and message (and a 422's `issues`) the single-entry call would have
  given; the caller retries what it can fix. Items are written **in order, one
  at a time** — every write takes the workspace's shared content lock, so a
  fan-out would mostly contend with itself. Both `content:create` and
  `content:update` are required, since one request may do either.
- **`/bulk/publish` delegates to `BulkPublishEntriesUseCase`** rather than
  looping over the single publish: that use-case selects the candidates
  `FOR UPDATE` and re-validates inside **one** transaction, which is the only
  thing that closes the window between "this draft validates" and "publish it".
  It answers in the admin's own `BulkPublishResult` / `BulkActionResult` shapes,
  so a consumer moving between the two surfaces learns one body, not two.

Each item of a save carries the addressing a single-entry write takes from its
**URL** (`resolveBulkSaveOp`, unit-tested): an `id` updates, neither `id` nor
`localeGroupId` creates, and a bare `localeGroupId` is genuinely ambiguous —
"add this record's German row" or "change the German row it already has" — so it
requires `op`. An `op` that contradicts the addressing is an error rather than a
silent preference. The batch actions take `{ ids }`, entry ids only: a group
names a record across languages, and publishing "the record" would publish
translations the caller never listed.

**This same surface is also served over GraphQL** at `POST /api/v1/graphql`, by
[`@orthacms/content-graphql`](../graphql/AGENTS.md). That package is an
_adapter_, not a second API: its resolvers assemble the DTOs below and call
`PublicEntriesQuery` / `PublicEntryWritesService`, so everything documented here
— the bearer guards, the grant gate, `readableWhere`, the draft rule, the write
invariants — applies identically to both protocols. Practical consequence when
editing this folder: `ContentModule` **exports** those collaborators and the
barrel re-exports them, so a change to a signature here changes two protocols.
See [ADR-0008](../../../docs/adr/0008-graphql-as-a-protocol-adapter.md).

Five decisions worth knowing before touching this:

- **The write side reuses `EntryWriterService`; the read side deliberately did
  not reuse `EntriesService`.** Opposite calls, opposite reasons. The read
  avoided reaching through a wide API because `?deleted=only` alone selects rows
  a token must never see. A write has no such hazard and far more to get right —
  validation, relation deltas, media-target checks, revision numbering under a
  per-entry advisory lock, the outbox, and i18n's sibling sync. A second
  implementation of any of that is how you get duplicate version numbers and
  translations that drift. `PublicEntryWritesService` adds the locator, the
  grant gate, and the wire shape, and delegates everything else.
- **`PATCH` merges; the admin's `PATCH` replaces.** The editor always submits
  the full document, so replace is right there. An API client sends the two
  fields it changed — and because value rules are only enforced at publish (see
  below), silently nulling the rest stays invisible until some later publish
  fails on fields the caller never touched. Merge is by **key presence**, so
  `{"excerpt": null}` still clears.
- **Value validation runs when content goes live, not when it is written.** On a
  **publishable** type a draft may be incomplete _and_ malformed — a bad select,
  a number in a text field — and `POST`/`PATCH` return 201/200; `publish` is
  where the type's rules bite, with the failing fields named. On a
  **non-publishable** type there is no later moment, so the same rules run at
  create. Media-target checks (does the workspace own this asset?) are not value
  rules and always run at write time.
- **Writes return a re-read, not a mapped `EntryRecord`.** One extra SELECT,
  and the guarantee that a write's response shape is identical to a read's —
  including the reference fields `values` omits, which a hand-written mapper
  would have to keep remembering to strip.
- **No `OriginGuard`.** The admin's write controllers carry it because they are
  cookie-authenticated and CSRF-able. A bearer token is never sent ambiently by
  a browser, and demanding an `Origin` header would break every non-browser
  client.

**Relations may not cross locales.** When both the owner and the target type
are `i18n`, a link must stay inside one locale — the English article links the
English tag. The admin has always enforced this in its **picker** (same-locale
candidates only); it is now enforced in the **writer**, so a direct API call
cannot bypass it. `assertSameLocale` (exported from `relation-link.service.ts`)
is the single implementation, reached from all three write paths: the join-table
ones via `RelationLinkService.assertTargets` (deltas + whole-set arrays) and the
owning single FK via `EntryWriterService.assertRelationTargets`. It compares
against the **source row's own** locale, read from the row being written rather
than from a request parameter — on create from the extension's stamped columns
(resolved before the target checks for exactly this reason), on update from a
one-off `localeOf` lookup. A target type that is _not_ localized is untouched: a
shared author or SEO record is legitimately linked from every translation, and
breaking that is the real risk in tightening the rule.

**Linking by translation group (`by: "localeGroup"`).** The rule above is only
usable if a client can name a target without knowing its per-locale id, so a
relation delta may set `by: "localeGroup"` and pass **group** ids: each resolves
to that group's row in the source entry's locale. A client that thinks in
stories then holds one id per story instead of one per language, and the server
— the only party that knows the source row's locale for certain — does the
picking. A group with no row in this locale is a 422 saying so; the mode on a
non-localized target, or from a non-localized owner, is a 400.

An owning **single** relation is addressed the same way through the delta's
`set` key — `relations: { author: { set: "<gid>", by: "localeGroup" } }`, with
`set: null` clearing it. It lives there rather than in `values` because that bag
is the content type's own contract, where a relation field means _an entry id_
and there is no room for a `by`; without `set`, a single relation would be the
one relation that could not be addressed by group. The resolved id is folded
into `values` **before** the write, so it passes through the same existence,
workspace, and same-locale checks as any other — no second implementation. A
field sent in both bags is a 400 (one would have to win silently), as is mixing
`set` with the arrays (a field is a single or a join, not both). The public
API's partial-update merge drops only its **own** re-supplied value for a
`set` field, so a genuinely ambiguous request still reaches that 400.

A **malformed** relation id is now a uniform 422 rather than a 500. A single
relation's FK arrives inside the free-form `values` bag where no DTO decorator
reaches it, and `inArray(<uuid column>, ['not-a-uuid'])` is a Postgres cast
error.

**Drafts and `?status=`.** Reads default to published-only. A write-scoped token
may pass `?status=draft|any`, gated by `DraftVisibilityGuard` — a guard, so the
rule has one home and covers every route including the ones that reach drafts
indirectly. Without it the write API would be write-only: a create returns the
record once and it is then invisible forever. `PublicEntry.status` is exposed for
the same reason — it used to be omitted as a constant, and is now real
information. The pair with `publishedAt` is what distinguishes a never-published
draft (`draft` + `null`) from live content with unpublished edits (`draft` +
a timestamp — the admin's **Modified**).

**Every single-entry route exists twice**: once under `:id` and once under
`group/:localeGroupId` (`…/group/:gid`, `…/group/:gid/relations/:field`,
`…/group/:gid/media`, `…/group/:gid/translations`). Anything a consumer can do
holding an entry id, it can do holding the group id plus a `?locale=` — the
identity a localized front-end actually carries, since a group is stable across
languages and each locale's `id` is not. Both spellings funnel into one
`EntryLocator` in `PublicEntriesQuery`, so the pair is a routing detail and never
a behavioural fork; each of the four reads has exactly one implementation and one
shared controller handler. Only the **list** has no group form — a group names
one entry, which is what the entry routes are for.

The `group/…` routes are declared **first**. They cannot be shadowed on segment
count alone (`:typeName/:id/relations/:field` needs a literal `relations` where a
group route carries the group id), but Express matches in declaration order, so
literal-prefixed routes go ahead of the wildcards to keep that true as the
pattern set grows.

**There is deliberately no `/:id/relations`.** An all-fields relation route
existed and returned exactly what `GET /:id?relations=preview` already returns
minus the entry — a second spelling of one read, on a contract that has to stay
still. Paging one field past the preview's cap is the one thing a query parameter
cannot express, so `/relations/:field` is the one relation route that survives.
(The same argument applies to `/:id/media` and `/:id/translations`, which are
also pure duplicates of their preview params; they are kept for now because a
media field has no per-field pager to fall back on.)

**An id-addressed read is NOT locale-scoped; a group-addressed one is.** An
entry id already names exactly one row, so AND-ing the locale scope onto it could
only ever turn a valid id into a 404 — which it did, and which the write API made
untenable (updating a German article by its own id would have needed `?locale=de`
bolted onto a request that already named the row). `entryWhere` therefore applies
the extension's `listScope` **only** for a group locator, where the locale is
what picks the row out of the group. The narrowing is safe because `liveWhere`
still carries the whole visibility rule — workspace, publish state, soft delete;
`listScope` is, per its name and its one implementation, about choosing rows out
of a _set_, and a request naming one row has already chosen. It is still
**validated**, though: `entryWhere` calls `listScope` for an id locator too and
discards the predicate, because that call is also the only thing that checks the
slug. Without it `?locale=zz` on `/:id` stopped being a 400 and became silently
ignored — a typo answered with another language's content, which is worse than
either 404-ing or rejecting it.

**A group-addressed WRITE takes its locale from the query string**, never from
`body.locale` — that field is create-only (it stamps a new row's locale), and
reading it for addressing let a body that omitted it silently retarget the write
at the default-locale row. A live check caught a German update rewriting the
English article; the e2e pins it.

**Authentication + authorization.** `ApiTokenGuard` hashes the presented bearer,
resolves it through identity's `ApiTokenService.verify` (unknown / revoked /
expired are one flat 401), and attaches it as `request.apiToken`. Authorization
reuses the **same** machinery as the session routes — `scopePermissions` turns
the token's `read`/`full` scope into a permission set and the route's
`@RequirePermissions(...)` is evaluated by identity's pure `AccessPolicy` — so
a requirement means the same thing for a token and a logged-in user, and adding
a write route later needs no guard change. A token acts as **itself**: the
minting user's role grants are deliberately not consulted, so revoking the token
is enough to revoke its access.

**Workspace resolution** (`ApiTokenWorkspaceGuard`, the token-authenticated
counterpart of workspaces' membership-based `WorkspaceGuard`): a token now
carries a **bucket** of workspaces. `X-Workspace-Id` picks one — malformed is a
400, outside the bucket a 403 (same as no-such-workspace, so ids can't be
probed). With the header absent, a token covering exactly one workspace uses it
(the common case needs no header); a token covering several 400s rather than
guessing. The resolved id lands on `request.workspaceId`, so `@CurrentWorkspace()`
works unchanged.

**What a token can see** — one predicate, in `PublicEntriesQuery.readableWhere`:
the resolved workspace, **published only** on publishable types, **not
soft-deleted** on paranoid types (that trio is `liveWhere`), plus the bound
`CONTENT_ENTRY_EXTENSION`'s scope (so i18n locale handling comes for free — the
one read that must span locales, the translation lookup, drops exactly that
clause by building on `liveWhere` instead). It is deliberately **not** built
on `EntriesService`: that service's knobs are the admin's, and `?deleted=only`
alone selects rows this API must never serve — stating a narrow WHERE beats
reaching through a wide one and subtracting.

**Search + filter** reuse the admin's machinery, so one query language covers
both surfaces: `?search=` is the shared `buildSearchPredicate` (ILIKE over
text-like columns, metacharacters escaped — extracted to
`entries/infrastructure/queries/entry-search.ts` so the two callers can't drift
on the escaping), and `?filter=` is the same query-builder tree, parsed against
a surface from `buildEntryFilterSurface`. Both are **AND-ed onto**
`readableWhere`, so neither can widen what a token sees — only narrow it. Two
deliberate departures from the admin's list:

- **Grant-pruned.** The surface is built with `grantedTypes`, so a hop into a
  content type the workspace was never granted 400s (`FILTER_UNKNOWN_RELATION`)
  instead of resolving. Without it, `author.name eq "Ada"` would let a token
  infer relation data by watching which entries match — data the entry read
  deliberately omits. The admin's list leaves `grantedTypes` unset on purpose
  (there the schema is a SQL whitelist, not a visibility boundary); here it is
  exactly a visibility boundary.
- **`status` is removed from the schema.** The read already forces
  `status = published`, so a `status` rule could only be a no-op or match
  nothing; a 400 (`FILTER_UNKNOWN_FIELD`) beats a confusingly empty page.

The surface is built **lazily**, only when `?filter=` is present, since it walks
the whole relation graph to the hop budget.

**Sparse fieldsets** (`?fields=title,slug`, `field-selection.ts`) narrow `values`
to the named fields — and narrow the **SQL projection** with them, so an
unselected richtext column is never read (proven against a live server: the
SELECT drops from every column to the envelope plus the named ones). Notes:

- Selection covers `values` **only**; the envelope is always returned. `id` in
  particular is what makes an entry addressable, so letting a selection drop it
  would be a foot-gun for no real payload saving.
- An unknown name is a **400**, not a silent drop — a sparse fieldset is an
  explicit request, so a typo should say so. A relation or media name gets a
  _different_ message ("cannot be selected"), because "not selectable yet" is a
  different fact from "no such field".
- `?fields=` present but empty reads as "no preference", not "no fields".
- WHERE and ORDER BY may reference unselected columns, so filtering and sorting
  stay unrestricted by the selection.

**Grant-pruned.** `:typeName` must be registered **and** in the workspace's
`workspace_content` grants; anything else is the same 404
(`resolveGrantedType`). Stricter than the admin's own entries list, on purpose:
an admin caller is a member looking at their own CMS, a token is an external
credential, and the grant set is the workspace's declared content surface.
`/v1/content-types` lists exactly the names that won't 404, so nothing is left
to guess.

**Relation + media expansion** (opt-in, `public-expansion.query.ts`):
`?relations=preview&relationFields=author,tags` and
`?media=preview&mediaFields=coverImage` add `relations` / `media` maps to each
entry — on the **list** and the single-entry route alike. Naming fields is
optional: `?relations=preview` on its own expands **every** relation field whose
target the workspace was granted (ungranted ones are skipped, not refused, since
the caller named nothing to correct), and `?media=preview` every media field. A
type with more expandable fields than `MAX_EXPANDED_FIELDS` is a 400 asking the
caller to name them, never a silent truncation.

A linked entry is returned as a **full `PublicEntry`** — the same envelope +
`values` shape as a base record — so a consumer renders it with the model it
already has. Linked entries are **not themselves expanded** (no `relations` /
`media` on them), which is what bounds a request to one level of the graph.
Hydration is one batched `IN (…)` read per target _type_, so the count stays
flat: measured at 7 content queries for both `pageSize=1` and `pageSize=50`.

**Per-field item limits.** `?relationLimit=` / `?mediaLimit=` set how many
links / assets each expanded field returns (1…`MAX_PAGE_SIZE`, default
`DEFAULT_EXPANSION_LIMIT` = 20); `relationLimit` is also the default page size
for `/relations/:field`. The field's `total` always reports the **true** visible count, so
a low limit is observable as `items.length < total` and never passes a slice off
as the whole set — page the rest via `/relations/<field>`. Worth knowing that
these are per field _per entry_, so a large page multiplies: `pageSize` × fields
× limit is the real bound on a response, and the limit is the knob for it. Both are **batched across the page** — verified against a live server:
`pageSize=1` and `pageSize=50` each issue the same 6 content queries (count,
page, one `refsFor` per single relation, a windowed pass + titles per join-backed
one, and **one** media resolve). Notes:

- **Unreachable targets are neither shown nor counted.** `RelationLinkService`
  takes an optional `RelationTargetVisibility` (`{ publishedOnly }`) that the
  public reads pass and the admin never does. It turns on two restrictions —
  published-only **and** the bound `CONTENT_READ_SCOPE` providers, asked about
  the _target_ type — and both go _inside_ the window (`count(*) over`) and
  inside the sub-select the join reads restrict by, so `total` cannot advertise
  links a caller cannot reach. Confirmed live for the draft half: the same entry
  reads `total: 2` for the admin and `total: 1` publicly.
  The two ride one flag deliberately: they answer one question ("may this caller
  reach this target?") and are needed at exactly the same call sites. A second
  flag would be a second thing to remember on a path where forgetting it leaks
  the cardinality of what is hidden.
- **Grant-pruned.** Expanding into a type the workspace wasn't granted is a
  **400**, on the query params and on `/relations/:field` alike — matching how
  `?filter=` treats a traversal into one.
- **Media is batched by hand**, deliberately _not_ through
  `MediaRefsQuery.forValues`: that takes one entry's values, so a page would call
  it per row — exactly the N+1 the relation preview exists to avoid.
- **`MAX_EXPANDED_FIELDS = 10`** per kind. Cost scales with _fields_, not rows,
  and the admin bounds only the raw string length — too loose for a public
  endpoint.
- A `?fields=` selection still carries the columns an expansion needs (a single
  relation's FK, a media field's ids), even though they never appear in `values`.
- **Media URLs require a session.** The returned `url`/`thumbUrl` are the CMS's
  own media routes, which are `media:read` + membership gated; a bearer token
  gets **401** (verified). They identify the asset and work for a session-holding
  server-side caller, but a browser `<img src>` will not load one. A
  token-fetchable URL needs either a token-authenticated media route or signed
  URLs — neither exists yet.

**Localization.** A localized type stores one row per locale, siblings sharing a
`locale_group_id`. Every public read already scopes to a single locale through
the extension's `listScope` (`?locale=`, defaulting to the configured default,
unknown → 400). Three additions make the _group_ addressable:

- **`localeGroupId` is filterable.** `scalarFieldsOf` whitelists it alongside
  `locale` on i18n types, so `?filter={"and":[{"field":"localeGroupId","op":"eq",
"value":"…"}]}&locale=de` returns that group's German row. It is whitelisted
  for **SQL only** — `scalarWireOf`, which builds the admin's filter _picker_,
  deliberately does not list it, so the admin UI is unchanged.
- **`GET /v1/content/:typeName/group/:localeGroupId`** is the single-record form
  of the same idea, and the one a localized front-end actually wants: the group
  id is the stable identity of "this story" across languages, while each
  locale's `id` is not — so a page renders in the visitor's language by varying
  `?locale=` alone, with no per-locale id map. A group with no **published** row
  in the requested locale is the same 404 as an unknown group.
- **`?translations=preview`** attaches the entry's **other** published locale
  rows as `translations`, on the list and both single-entry routes, with
  `/:id/translations` as the sibling route. Each is a full `PublicEntry`
  honouring the root's `?fields=`, ordered by locale slug; the entry itself is
  never repeated (`[entry, ...entry.translations]` is the full set). An entry
  that is the only published row in its group reports `[]`, not a missing key.

Implementation notes: the sibling read is the one place that must span locales,
so `readableWhere` was split — `liveWhere` (workspace + published + not deleted)
is what the translation query uses, and `readableWhere` is `liveWhere` AND the
extension's locale scope. It stays **one** query for a whole page (`locale_group_id
IN (…)`, ridden by the `(locale_group_id, locale)` index), verified live: a list
with `translations=preview` issues the same 3 content queries at `pageSize=1` and
`pageSize=25`. No cap is applied — a group holds at most one row per configured
locale, so its size is bounded by host config, not user data. Asking for any of
these on a type that is **not** localized is a **400**, not an empty result:
`[]` would read as "this entry has no other locales" when the truth is "this
content is not localized".

**The wire shape** (`types/public-entry.ts`) is its own contract, not the
admin's `EntryRecord` — a published API must be free to stay still while the
admin's internals move. `values` carries the entry's **own** data only: text,
richtext, number, money, boolean, date, datetime, select, multiselect, json.
Every **reference** field is omitted — `relation` in all four cardinalities
(including an owning single, whose FK _is_ a column on the row) and `media`.
Neither is resolvable through this API yet, so a bare uuid would be an
identifier with no route to follow. That omission is **provisional**: the
schema endpoint still describes those fields because they are part of the real
model, and when relation/media reads land they start appearing in `values`,
which only ever adds keys. `status` is not exposed (it would be a constant
"published"); `publishedAt` is, along with `locale`/`localeGroupId` on i18n
types.

## Agent tools (`src/lib/mcp/`)

The same content CRUD, contributed to the shared **tool registry** in
`@orthacms/mcp-server` — so an MCP client (and, once its run engine lands, the
copilot) can do what the public API does. [ADR-0006](../../../docs/adr/0006-cms-as-an-mcp-server.md).

```
mcp/
  content-tools.provider.ts  # the ToolProvider: sixteen tools + the type resources
  tool-schemas.ts            # JSON Schema for the tool ARGUMENTS (generic, hand-written)
  tool-input.ts              # DTO-backed validation, the locator, the draft-visibility rule
```

**Every handler delegates to the objects the public controllers call** —
`resolveGrantedType`, `PublicEntriesQuery`, `PublicEntryWritesService`. That is
the whole design: published-only reads, the grant gate, the locale rules,
publish-time validation, revision numbering, the outbox are not restated and
therefore cannot drift. The provider adds tool descriptions, argument
validation, and the mapping — nothing else. This is also why the tools live
**here** rather than in the MCP package: those services are internal to content
and exporting them so an outside package could drive the read path is exactly
how a second, diverging copy of the visibility rules gets written.

**Sixteen generic tools, not a set per content type.** `content_types_list`,
`content_type_get`, `content_list`, `content_get`, `content_relations`,
`content_media`, `content_translations`, `content_create`, `content_update`,
`content_publish`, `content_unpublish`, `content_delete`, and the batches
`content_bulk_save`, `content_bulk_publish`, `content_bulk_unpublish`,
`content_bulk_delete`. `typeName` is an
argument, exactly as it is a path segment on the HTTP routes. Generating
`article_create`, `author_create`, … would put the whole content model in every
conversation's context (a client loads all tool schemas on connect) and could
not be a fixed set anyway, since visible types depend on the token's grants. A
model discovers one type's shape on demand with `content_type_get`, whose
`valuesSchema` comes from the same `docs/field-schema.ts` the OpenAPI document
uses. Granted types are also exposed as MCP **resources**
(`ortha://content-type/<name>`), through the same grant gate.

**Authorization is declared, not implemented.** Each tool names its permissions
in `requires`, and `ToolRegistry.call` enforces them before dispatch — the
analogue of `@RequirePermissions(...)`. No handler contains a line saying a
`read` token cannot write. The one authorization decision a handler _does_ make
is `assertDraftVisibility`, because that is a rule about an argument
(`status=draft|any` needs `content:update`) rather than about the operation —
the same rule `DraftVisibilityGuard` applies to the routes.

**Arguments validate through the real HTTP DTOs** (`validateToolInput` runs
`PublicListEntriesQueryDto` / `PublicSaveEntryDto` with the host's
`ValidationPipe` options). Hand-checking them would fork the contract the first
time a bound moved — `pageSize` would cap at 100 on the route and at whatever
this file said on the tool. Unknown arguments are rejected rather than ignored,
which matters more for a model than a developer: a silently dropped typo
produces a plausible-looking wrong answer.

One thing to know when adding a tool: on `content_update` the `locale` argument
is the **addressing** locale and is passed separately, never folded into the
save DTO — `body.locale` is create-only, and reading it for addressing is how a
group-addressed German update silently rewrites the English row.

## OpenAPI — the types describe themselves (`src/lib/docs/`)

The host generates an OpenAPI document at boot and serves it as a Scalar
reference. `@nestjs/swagger` reflects **static** TypeScript, and this plugin's
contract is runtime data: one generic controller set serves every code-defined
type, so the scanner sees `/content/{typeName}` with an opaque string param and
no response shape at all. The registry is what knows `article` from `home_page`.

So the plugin describes itself, through `ServerPlugin.docs.decorate` (see
[`bootstrap-server`](../../bootstrap/server/AGENTS.md)) — `ContentPlugin` closes
over its registry and hands `registry.serializeAll()` to `describeContentApi`,
which runs **after** the document is built and amends only the paths this plugin
owns:

- **A schema trio per registered type**, from the same `SerializedContentType`
  the admin renders forms from: `<Type>Values` (one property per column-backed
  field), `<Type>Entry` (the storage envelope around it), `<Type>ListPage`.
  `article` → `ArticleValues` / `ArticleEntry` / `ArticleListPage`.
- **`typeName` becomes an enum** of the registered names, so the reference
  offers a picker instead of a free-text box.
- **Response schemas** on every content route — `anyOf` the per-type schemas for
  the entry/list reads (the shape depends on `typeName`, which OpenAPI can't
  express as a dependency), the fixed shared shapes elsewhere
  (`EntryRelations`, `RevisionDetail`, `BulkPublishPreview`, `ContentTypeSchema`,
  …), plus the documented `404` and, on the validated writes, `422`.
  `anyOf` and not `oneOf`: the alternatives are not mutually exclusive — an
  empty `items` array satisfies every list schema there is — and `oneOf` means
  _exactly one_, so it rejected responses the API really returns.

### Two surfaces, described separately

`/api/content/...` and `/api/v1/content/...` are two surfaces over the same
content types and they **do not answer in the same shapes**. A public relation
page carries whole `PublicEntry` objects where the admin's carries `RelationRef`s
(id + title); a public media read is `Record<string, { items, total }>` where the
admin's is `Record<string, MediaRef[]>`; the public `values` bag drops every
reference field including the owning single relation's FK, which the admin's
keeps.

So `docs/public-api-schemas.ts` builds a second set — `Public<Type>Values` /
`Public<Type>Entry` / `Public<Type>ListPage` plus the public fixed shapes
(`PublicEntryMedia`, `PublicRelationFieldPage`, `PublicEntryTranslations`,
`PublicContentTypeList`, `PublicBulkSaveResult`, …) — and
`describe-content-api.ts` holds a route table per surface, matching the `/v1/`
patterns **first**. The order is load-bearing: `ENTRY_ROUTE_RE` also matches the
`/v1/` spelling, and letting it win is exactly how the published contract came
to be documented with the admin's schemas.

The rule when adding a public route: add it to `PUBLIC_ENTRY_ROUTES`, never to
`ENTRY_ROUTES`. Adding it to neither leaves the operation with a response that
has no schema at all, which the document is otherwise mostly made of — see
[`bootstrap-server`](../../bootstrap/server/AGENTS.md#the-response-schema-gap).

### Routes other plugins mount under `{typeName}`

Both tables carry a few `FOREIGN` entries — transfer's `/export*` and
`/import*`, segments' `/{id}/access`. Those routes belong to other plugins,
which describe their **bodies** themselves; what this pass writes onto them is
the `typeName` **parameter**, because which names are valid there is this
plugin's contract and the registry is the only thing that knows them.

It writes nothing else, and that restraint is the point: the failure codes
differ per owner — transfer 404s an unknown type, segments' public `/access`
answers **400** — so stamping this plugin's usual 404 on them would publish
something the API does not do.

### The saved-views pass

`ContentViewsPlugin` carries a **second** `decorate`
(`docs/describe-views-api.ts` + `docs/views-schemas.ts`), because saved views
ship as their own `ServerPlugin` entry and a plugin describes what it registers.
Keeping the two apart also keeps the route tables honest: neither can
accidentally claim the other's paths. `SavedView.scope` is `content:<typeName>`,
so it is generated from the registry the same way the entry schemas are — an
enum of the real lists, falling back to a plain string when nothing is
registered (an empty `enum` is a schema nothing can satisfy, the same class of
defect as a `nullable` that does not widen one).

Both passes write through `docs/openapi-writer.ts`, whose rule is that a schema
goes onto **whichever 2xx key the scanner already emitted** and a `204` gets
none. That guard is unreachable from either pass's own tests — a `204` route is
never in a route table — so it is pinned by `openapi-writer.spec.ts` directly;
verified by mutation, since deleting it left every pass-level assertion green.

**Nullability is not one flag.** `nullable: true` in OpenAPI 3.0 modifies a
schema's `type`, so it is inert on a bare `oneOf` (a `richtext` body) and does
not widen an enumeration (a `select`). `fieldSchema`'s `nullable()` helper adds
`{ type: 'null' }` to the union and `null` to the enum for exactly that reason —
without it an entry with an unset `select` failed its own `Values` schema, which
is every draft.

Three rules the mapping follows, each mirroring real behavior:

- **Join-backed relations are absent from `Values`** — a many-relation and an
  inverse own no column, exactly as `toRecord` builds a record. The schema
  description names them and points at `/relations`.
- **A publishable type lists no `required`** — required means "required _to
  publish_", so a draft may legitimately omit a field; a non-publishable type
  (always live) does list them.
- **Every property is `nullable`** — an unset field reads back as `null`.

`field-schema.ts` (field spec → JSON Schema) and `describe-content-api.ts` are
pure and unit-tested; neither touches Nest, the registry, or a live document.
Adding a field type means extending `valueSchema` there.

## The `entries` feature — layered (ADR-0003)

The **entries** feature is migrated to the tactical-DDD layering under
`src/lib/entries/`; the rest of the plugin (the DSL, registry, extension port,
schema builder) stays in its established shape — see the note below.

```
entries/
  domain/            # framework-free — the one hard rule
    entry.ts                       # Entry focused domain model (publish lifecycle)
    entry-publish-blocked.error.ts # transport-agnostic gate failure (carries issues)
    events/entry-events.ts         # entry.* domain-event factory + kinds
  application/
    use-cases/                     # publish / unpublish / bulk-publish / bulk-unpublish
  infrastructure/
    persistence/  # EntryWriterService (engine), entry-row (toColumns/toRecord),
                  # relation-link, entry-counter, bulk-publish-verdicts
    queries/      # EntriesService (list), entry-filter-schema, bulk-publish-preview
  http/
    controllers/  # thin controllers + resolve-type
    dto/          # class-validator DTOs (shape checks only)
  types/          # wire contracts (EntryRecord/EntryListView, bulk-publish)
```

**Why a focused domain model, not a full aggregate.** The entries engine is
**generic and registry-driven** — one `EntryWriterService`/`EntriesService`
backs _every_ content type, with no per-aggregate table or fixed field set. A
classic row⇄aggregate aggregate + mapper would fight that metamodel (ADR-0003:
"DDD where it pays, CRUD where it doesn't"). So the part with real invariants —
the **publish lifecycle** — is modelled by the `Entry` domain object
(`draft ↔ published` via the `@orthacms/content-domain` state machine + publish
gate, raising `entry.published`/`entry.unpublished`), while the heavy,
battle-tested column/relation/extension persistence stays as the
`EntryWriterService` **infrastructure engine**. `domain/` imports nothing from
`@nestjs/*`, `drizzle-orm`, `class-validator`, or `infrastructure/`
(grep-enforced) — only the pure kernel and `@orthacms/database`'s framework-free
`createDomainEvent`/`DomainEvent`.

**The kernel (`@orthacms/content-domain`).** Field-value validation and the
publish gate live in the shared kernel; `EntryValidationService` delegates to it
(no behavior change) and the `Entry` model uses its `assertTransition`. See that
package's `AGENTS.md`.

**Use-cases + unit-of-work + outbox.** `publish`/`unpublish`/`bulk-publish`/
`bulk-unpublish` run through use-cases inside a `UnitOfWork` (from
`@orthacms/database`), so the status write and the `entry.*` outbox event commit
**atomically**; the status SQL is small executor-parameterized primitives on the
engine (`markPublished`/`markDraft`/`loadLiveByIdsForUpdate`/…). Bulk publish
keeps its **single locked (`FOR UPDATE`) transaction** (the TOCTOU protection the
original defended) and reports partial success; bulk unpublish reports
`{ count }` = **real `published → draft` transitions**, the same set it emits an
event for. It used to count every live row the ids matched — so unpublishing a
list containing a draft counted it, against what the route's own OpenAPI
description promises, and stamped `updated_at` on a row nothing happened to. Reads (list / get / relations / bulk-publish
preview) stay thin query services. **CRUD writes** (create / update / delete /
restore / purge and their bulk variants) stay on the engine directly — they carry
no publish-state transition, so per ADR-0003 they are not forced through the
lifecycle machinery; their domain rule (value validation) is already the kernel.
There is **no in-band `ACTIVITY_RECORDER`** in content today, so nothing to keep
in lockstep — the `entry.*` events are the audit seam the activity subscriber
consumes.

**Every entry write now runs inside the `UnitOfWork` and raises its event.**
`create`/`update`/`remove`/`restore`/`purge` (and their bulk forms) used to own
their own `db.transaction`, which is why event emission was deferred: an outbox
append outside a unit of work commits on its own connection, so the event could
outlive a rolled-back write. They call `uow.run(...)` instead and take the
executor from `uow.current()` — the same transaction, the same advisory locks,
the same extension hooks — so the fact and the row it describes commit together.
The seven kinds are in `domain/events/entry-events.ts`:

| kind                                    | raised by                 | payload                   |
| --------------------------------------- | ------------------------- | ------------------------- |
| `entry.created`                         | `create`                  | `{ contentType }`         |
| `entry.updated`                         | `update`                  | `{ contentType, fields }` |
| `entry.published` / `entry.unpublished` | the `Entry` model         | `{ contentType }`         |
| `entry.deleted`                         | `remove` / `bulkRemove`   | `{ contentType, soft }`   |
| `entry.restored`                        | `restore` / `bulkRestore` | `{ contentType }`         |
| `entry.purged`                          | `purge` / `bulkPurge`     | `{ contentType }`         |

Three decisions inside that:

- **Only the publish pair goes through the `Entry` aggregate.** The other five
  carry no invariant — nothing about "created" can be violated — and routing
  them through the model would mean fabricating a publish status a
  non-publishable type does not have. They are minted by builders in the same
  domain module and raised by the write path.
- **`entry.updated` names the changed fields, and is not raised at all when
  nothing changed.** The writer reads the stored row inside the transaction and
  diffs it against the written one over `type.fields` (envelope columns every
  save rewrites are excluded). That is the `workspace.updated` precedent, and
  it is also the answer to the volume question the event raises: a re-submitted
  editor, or a restore of the version already live, is a round trip rather than
  an editorial change, so it produces no row. No coalescing window is needed on
  top — the admin has no autosave, so a save is a person pressing a button.
- **A bulk write raises one event per row it actually changed**, not per id the
  caller listed — the same rule bulk unpublish already followed.

The acting user rides every one of them (`attachActor`), which is why the
delete/restore/purge controllers gained `@CurrentUser()` and the writer takes an
`EventActor` where it used to take a bare `actorId`. A **token-authenticated**
write passes `null`: revisions record a user id and a token is not one, so
`System` is the honest answer until token attribution gets a column of its own.
Bulk **publish**/**unpublish** are the remaining unattributed writes — their
use-cases take no actor yet.

**`CONTENT_ENTRY_EXTENSION` stays SYNCHRONOUS and unchanged.** It is an
**in-transaction open-host port** (i18n binds it for per-locale scoping,
column-stamping, and sibling sync). Its methods run _inside_ the entry write
transaction — `createColumns` on the INSERT, `afterUpdate` after the row/relation
writes — so their effects commit or roll back with the write. It is **not** a
domain event and must not become one: an event fires post-commit, which would be
too late to stamp a NOT NULL `locale` column or to keep a save atomic with its
sibling sync. It is correct as-is and is left untouched by this migration.

The DSL / registry / schema-builder / extension-port machinery is deliberately
**not** turned into aggregates — that is the content framework/metamodel, and
forcing it into a domain shape would violate ADR-0003, not honor it. It keeps its
current layout and public API.

## Revisions — version history (`src/lib/revisions/`)

Every save keeps an immutable **snapshot** of the whole document, so an entry has
a browsable version history and can be restored. Layered per ADR-0003
(`domain / application / infrastructure / http`), sibling to `entries/`.

- **Storage.** One generic **HOST-owned** table, `content_entry_revisions`
  (defined in `revisions/infrastructure/persistence/revision-table.ts`, exported
  from the decorator-free `/define` barrel and re-exported by the host's
  `src/content/index.ts` for drizzle-kit — like every `content_<name>` table).
  One mechanism for all types, matching the generic `EntryWriterService`. Keyed
  **per-locale** (`entry_id` = the live row), so each translation has its own
  timeline. Because every content type shares that one table, **every read is
  keyed on `(content_type, entry_id, workspace_id)`** — `DrizzleRevisionStore.scope()`.
  The `content_type` leg is not decoration: the routes address an entry as
  `:typeName/:id`, so leaving it out meant the `:typeName` in the URL was never
  checked against the revision returned, and any registered type name served any
  entry's history (including its full snapshot). The same key applies to the
  copilot's `_revisions` / `_diff` tools. `snapshot` (jsonb) is `{ values, relations }`: the field values bag
  (scalars, localized + shared, single-relation FKs) plus the **full ordered
  link sets** of every join-backed relation (`RelationLinkService.snapshotLinks`).
- **Snapshot-on-save.** `EntryWriterService.create`/`update` append a **draft**
  revision **inside their existing transaction** (via the `REVISION_STORE` port),
  so the version commits atomically with the row + relation writes; the entry's
  advisory lock serializes concurrent savers so version numbers can't collide.
  The live row still edits in place. No `entry.revision.created` outbox event is
  emitted — the save's own `entry.created`/`entry.updated` already records that
  the document changed, and a second event per version would double every row in
  the log; the `Revision` model stays event-ready if a version ever needs to be
  addressable on its own. A **restore** of an earlier version reaches the log as
  the `entry.updated` its save raises, naming the fields it put back.
- **Publish transition.** A revision is born a `draft`; publishing the entry
  promotes its history too. The `publish` / `unpublish` use-cases (and their bulk
  variants) call `RevisionStore.markPublished` / `markUnpublished` **on the same
  unit-of-work transaction** as the entry-row status write, so the row and its
  timeline commit together. `markPublished` promotes one revision to `published`
  and demotes any prior published one to `superseded`, keeping at most one live
  version per entry — the entry-level publish targets the **latest** (exactly the
  just-published live row, since every save appends one), while publish-a-version
  passes the chosen `revisionNumber`; `markUnpublished` reverts the published revision to
  `draft`. Without this the timeline would always read `draft` even for a live
  entry (`RevisionSummary.status` / `isPublished` back the admin's Live/Draft/
  Superseded badge). Because a save moves the entry to draft **but leaves the
  published revision published**, an editor can accumulate draft versions while
  the previously-published one stays live — then publish any version.
- **Publish a specific version** (`PublishRevisionUseCase`). Publishing marks
  **that version itself** live — `markPublished` takes the target
  `revisionNumber` and flips it in place, demoting the prior live one to
  `superseded`. Publishing an **earlier** version first re-applies its content
  onto the live row (`RestoreRevisionUseCase` with **`appendRevision: false`**)
  so the live document matches what is published, but records **no** version for
  it: publishing v2 leaves the timeline at its existing length with v2 marked
  live, instead of minting a v6 copy of v2 on every publish. History is still
  never rewritten or deleted — only version _statuses_ move, which is what
  publishing is. One consequence to know: after publishing an earlier version the
  **latest** version is no longer the live content (it is a newer draft that was
  not published), so `isLatest` ≠ "equals the live row" in that window — the next
  save appends a version equal to the live row again. Composes the existing
  restore + entry-publish use-cases; publishing re-validates through the publish
  gate (a `422` leaves the content re-applied as a draft, a recoverable state).
- **The batched head read (`RevisionStore.heads`).** `list` answers for one
  entry in three queries, so a caller wanting the head of a whole records page —
  a contributed column, a per-page aggregate — would issue one `list` per row:
  an N+1 that grows with the page size the _user_ chose. `heads(contentType,
entryIds, workspaceId)` answers the same question for many entries in **one**
  query (`DISTINCT ON (entry_id) … ORDER BY entry_id, revision_number DESC`,
  riding the `(entry_id, revision_number)` unique index). It is a batched
  variant of an existing read on an existing port, **not** a new seam — the
  contrast with `ENTRY_PUBLISH_GUARD_SLOT` and `WORKSPACE_SETTINGS_TAB_SLOT`,
  which are extension points and are counted as such. Rows come back in no
  guaranteed order and an id with no revision is simply **absent**: to a caller
  "not yours", "wrong type" and "does not exist" are one fact, and reporting
  them apart would be an enumeration signal. `@orthacms/protection-server`'s
  records column is the first consumer, and `review-status.spec.ts` pins its
  query count flat as the page grows.
- **HTTP** (workspace-scoped, same guards as the entry routes):
  `GET :typeName/:id/revisions` (timeline, newest first), `.../revisions/:number`
  (one snapshot), `POST .../revisions/:number/restore` (`content:update`). The
  single-revision detail is **enriched with resolved relation refs**
  (`RevisionRefsQuery` → `RelationLinkService.resolveRefs`): each relation field's
  snapshot ids (owning-single FK from `values`, join-backed list from `relations`)
  become titled `RelationRef`s (`relationRefs`/`relationTotals`, capped at
  `PREVIEW_RELATION_REF_CAP`), so the admin preview lists the actual linked
  records rather than raw uuids — a soft-deleted / cross-workspace target flagged
  `missing`, no title leak. `POST .../revisions/:number/publish`
  (`content:publish`) makes a specific version live (`PublishRevisionUseCase`).
  `RestoreRevisionUseCase` re-applies a snapshot through `EntryWriterService.update`
  — which appends a **new** revision — so history is append-only (a restore of v2
  yields a fresh v6 equal to v2, never a rewrite).

## Insights read-model (`/api/insights/content/*`, `src/lib/insights/`)

The aggregates behind the content widgets on the Insights page
(`@orthacms/insights-admin`). Six routes, all `content:read` +
`WorkspaceGuard`, all read-only:

| Route       | Answers                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `totals`    | entry / published / draft counts, the change over `?days=`, and a short history for the stat tiles' sparklines |
| `stale`     | published entries bucketed by time since last edit (30/90/180/365/older)                                       |
| `pipeline`  | draft-vs-published per content type                                                                            |
| `velocity`  | entries published per time bucket across `?days=`                                                              |
| `punchcard` | edits by weekday and hour, from `content_entry_revisions`                                                      |
| `unshipped` | live entries carrying unpublished edits (the admin's **Modified**), per type and in total                      |

Six endpoints rather than one combined payload because **each widget owns its
own request** — a slow or failing aggregate degrades one card instead of
blanking the dashboard. `stale`, `pipeline` and `unshipped` deliberately take no
`?days=`: the staleness buckets _are_ the time axis, the pipeline is a snapshot
of what exists, and a pending edit is pending whether it was made this morning
or last spring — so windowing any of them would answer a different question
under the same name.

**`unshipped` is the one figure `status` alone cannot express**, which is why it
is an endpoint rather than a filter on an existing one. The publish state is two
stored values carrying three meanings (see _Generated storage_ above):
`draft` + a `published_at` is live content with unpublished changes, `draft` + no
`published_at` is a draft nobody ever shipped, and counting them together turns a
fresh workspace into a backlog. Two further rules:

- **A non-publishable type contributes nothing at all**, not even to `live`. It
  has no draft stage, so every row is trivially current; folding those rows into
  the denominator would make "3 of 900 live records have pending edits" a
  statement about always-live singletons nobody can publish.
- **The three counts come out of one grouped query per type**, not three
  `countOf` calls: they partition the same rows, so a scan that has already
  found a row can decide which of the three it belongs to.

Four things worth knowing before changing `ContentInsightsQuery`:

- **Live aggregation, no projection.** Every figure is computed on demand from
  the collection tables, hitting the existing `(workspace_id, …)` list indexes.
  A projection would add a table, migrations and a rebuild path to maintain
  before anything proved it was needed; this class is the only seam that would
  have to change, since the HTTP contract doesn't say where numbers come from.
- **Every method fans out per content type.** There is no single table to group
  over — a collection is its own generated `content_<name>` table — so "entries
  in this workspace" is inherently a loop plus an in-memory merge.
- **`scope()` is shared because forgetting `deleted_at` is silent.** A
  tombstoned entry is still a row, and a count that misses the soft-delete
  clause reports deleted content as live — exactly the kind of wrong number a
  dashboard is believed on.
- **`punchcard` reads revisions, not the activity log.** `activity_events` has
  no `workspace_id` column, so a workspace-scoped answer is not available from
  it; a revision is written on every save and carries one. Saves are also the
  better signal — they cover the editing work, not only publishes. Hours come
  out in the database session's timezone (UTC), and the widget's caption says
  so: shifting the labels to local time without regrouping would mislabel the
  buckets.

There is deliberately **no draft delta** in `totals`. Nothing records an entry
moving _back_ to draft — `published_at` says when something went live and never
that it stopped — so a change figure for drafts could only be invented.

## The `views` feature — saved list views (`src/lib/views/`)

The named filter/sort/column slices an editor returns to (`Needs review`,
`Готово к публикации`), served at `/api/views` and rendered by the admin's view
switcher above the records table.

**The two tables.** `saved_views` holds one slice per row — `workspace_id`,
`scope` (`content:<typeName>`), `owner_id`, `visibility`, `name`, and the
`payload` jsonb. `saved_view_defaults` is a separate table keyed
`(user_id, scope)` rather than an `is_default` column, because the choice is
**personal**: one shared view may be one member's landing view and not another's,
which a column on the view itself cannot express.

**The payload mirrors the URL, it does not re-model it.** `filter` and `sort`
are the raw `?filter=` / `?sort=` strings the records page already owns, so a
saved view and a hand-edited link replay through the same code path. Two things
are absent on purpose: `search` is a one-off question rather than a property of
the slice, and `page` is a reading position, so a view always opens on page 1.
`extra` carries the slot-owned list params (i18n's `?locale=`) as an **opaque**
string map — the keys come from `RECORDS_TOOLBAR_SLOT.listParamKeys` at runtime,
so naming them in a DTO would break the next plugin's params silently.

**A view is a bookmark, not a grant.** The stored payload is replayed through
the ordinary list query with the reader's own permissions, workspace scope and
content grants, so a shared view shows a narrower reader _fewer_ rows, never
more. Nothing in this feature widens a query.

**Three authorization rules**, none of which fit in a decorator:

- Every route is gated on `content:read` (a view is a saved way of reading
  content) and carries `WorkspaceGuard`.
- **Only the owner writes.** Editing or deleting someone else's view is a 403
  even for an administrator — the remedy for disagreeing with a shared view is
  "Save as new", not a silent rewrite. Setting a _default_ is deliberately not
  owner-gated: that is the reader's own landing choice.
- **Sharing is a permission.** `visibility: 'workspace'` requires `views:share`;
  it is checked per write because it depends on the body, not the route. Every
  role can still save private views.

**`scope` is grant-checked, not trusted.** `ViewScopeService` resolves
`content:<typeName>` through the registry _and_ the workspace's content grants,
answering the **same 404** an unknown type gets. Without it the endpoint would be
a way around `ContentGrantGuard` — saving a view over `content:salaries` would
confirm that the type exists.

**Validation is shape-only, on purpose.** The server bounds the payload (known
keys, lengths, array sizes) but does not check the filter against the type's
filter surface: a view outlives the field it references, and the admin drops
unknown rules with a notice when it applies one. Deep validation would need this
feature to depend on the entries filter machinery in both directions; the
degrade-on-apply path is where a stale view has to be survivable anyway.

The `scope` column is deliberately generic (`content:` today) so the switcher can
reach the Members and Activity lists — which already share `useTableUrlState` —
without a data migration.

## Architecture

- `ContentModule.forRoot(registry)` is **global** and exports the
  `CONTENT_REGISTRY` token + `EntryValidationService`. `ContentPlugin({ types })`
  builds the registry **eagerly** — duplicate names and unresolvable relation
  targets throw at construction, failing boot rather than the first request.
- It **binds identity's ports** to the registry: `CONTENT_CATALOG` (the type
  catalogue, so `GET /api/content-types` + the workspace-grant flow see the real
  code-defined types) and `CONTENT_ENTRY_COUNTER` (an `EntryCounterService`
  counting a type's rows in a workspace — and the workspace's total across all
  types — so identity's "revoke a content grant only when empty" and "delete a
  workspace only when it holds no content" checks see the real stored entries).
  Same inversion as `ACTIVITY_RECORDER` — identity owns the port, this plugin
  binds it.
- Register **after** `DatabasePlugin` + `IdentityPlugin` (it uses identity's
  `PermissionsGuard` and, for the entries list, the shared Drizzle client).
  Depends on `@orthacms/identity-server` (guards), `@orthacms/bootstrap-server`,
  `@orthacms/database` (`@InjectDatabase()` in `EntriesService`), and
  `@orthacms/utils-server` (the `?filter=` engine).
- `EntryValidationService` is the server-side authority for entry values (the
  admin renders the same rules as a courtesy). `EntryWriterService` calls it on
  every create/update and re-checks the stored row before any publish, so nothing
  invalid is written or published.
- Follows the `server-plugin` skill: thin controllers, permission-by-constant,
  JSDoc on exports, `interface` for contracts. The **`entries`** feature is
  layered per ADR-0003 (see above); the DSL / registry / schema machinery keeps
  the feature-then-kind layout.
- The **`views`** feature ships its own tables and rides its own plugin entry,
  `ContentViewsPlugin({ content })` — see
  [Migrations](#migrations-the-content-model-is-host-owned-saved_views-is-not).
  Register it after `ContentPlugin`, identity and workspaces.

## Commands

- `npx nx typecheck @orthacms/content-server` / `npx nx lint @orthacms/content-server`
- Migrations for the **generated collection tables** are generated on the host:
  `npx nx run server:db:generate --name=<change>`
- Migrations for this package's **own** tables (`saved_views`):
  `npx nx run "@orthacms/content-server:db:generate" --name=<change>`
