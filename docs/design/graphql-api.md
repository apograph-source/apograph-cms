# Public GraphQL API — design

The same public content API, over GraphQL. Same bearer tokens, same workspace
bucket, same scopes, same visibility rules — a second **protocol** in front of
the surface `content/server`'s `public-api/` already serves over REST, not a
second API.

This document is the design write-up that preceded the build. **It has shipped**
— see [`packages/content/graphql/AGENTS.md`](../../packages/content/graphql/AGENTS.md)
for what the package actually does, and
[ADR-0008](../adr/0008-graphql-as-a-protocol-adapter.md) for the decisions of
record. Kept for the reasoning; where the two disagree, the package's own
`AGENTS.md` wins.

**Status:** implemented. Every phase in §10 landed, minus the two things §13
records as deliberately deferred. Six things changed during the build; they are
listed at the end.

---

## 1. What already exists, and why that decides most of this

`/api/v1/...` is a complete, token-authenticated content API today
(`packages/content/server/src/lib/public-api/`, documented in that package's
`AGENTS.md`). It is not a thin CRUD wrapper — it carries a set of decisions
that took work to get right:

| Concern                 | Where it lives today                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication          | `ApiTokenGuard` — `Authorization: Bearer` → `ApiTokenService.verify` → `request.apiToken`. Unknown / revoked / expired are one flat 401.                                        |
| Authorization           | `scopePermissions(scope)` → `Actor` → the **same** `AccessPolicy` the session routes use.                                                                                       |
| Which workspace         | `ApiTokenWorkspaceGuard` — `X-Workspace-Id`, or the only one when the token covers exactly one.                                                                                 |
| Which types are visible | `resolveGrantedType` — registered **and** granted to the workspace (`workspace_content`), else one 404.                                                                         |
| Published-only reads    | `PublicEntriesQuery.readableWhere` (+ `DraftVisibilityGuard` gating `?status=`).                                                                                                |
| Locale semantics        | The `CONTENT_ENTRY_EXTENSION` port, bound by `i18n/server`.                                                                                                                     |
| Write invariants        | `PublicEntryWritesService` → `EntryWriterService` + the publish use-cases (validation, relation deltas, media targets, revisions under an advisory lock, outbox, sibling sync). |
| Wire shape              | `types/public-entry.ts` — a deliberately still, published contract.                                                                                                             |

**The design principle for this whole feature follows from that table: the
GraphQL layer is an adapter, not a second implementation.** A resolver's job is
to translate a GraphQL field + arguments into the DTO the existing service
already takes, call it, and hand the result back. Every rule above is then
enforced once, in the place that already enforces it, and the two protocols
cannot drift on what a `read`-scoped token may see.

Concretely, a resolver builds a `PublicListEntriesQueryDto` / `PublicEntryQueryDto`
and calls `PublicEntriesQuery.list` / `.getOne` / `.relationField` / `.mediaOf` /
`.translationsOf`, or builds a `PublicSaveEntryDto` and calls
`PublicEntryWritesService`. No new SQL, no second visibility rule, no second
validation path.

## 2. The invariants a GraphQL surface must not break

Four rules from the REST API are easy to lose in a naive GraphQL port. They are
the acceptance criteria for this feature:

1. **A token cannot enumerate the content model beyond its workspace's grants.**
   REST prunes `/v1/content-types` and 404s an ungranted `:typeName`. A single
   global GraphQL schema would hand every token the full model through
   introspection. → §5: the schema is built **per grant set**.
2. **A `read`-scoped token never sees a draft.** REST enforces this with
   `DraftVisibilityGuard` on `?status=`. In GraphQL `status` is a field
   argument, and a guard cannot see it. → §8.
3. **Not-found and not-permitted stay indistinguishable.** No enumeration
   signal via error text or error class.
4. **Media URLs are still authenticated routes.** GraphQL changes nothing here;
   the same caveat on `PublicMediaRef` applies verbatim.

Plus one new one, because GraphQL introduces an amplification surface REST did
not have: **a single request must have a bounded cost** (§9).

## 3. Where the code goes

A new package, `packages/content/graphql` → **`@orthacms/content-graphql`**, a
sibling of `content/server` inside the `content` group.

Why its own package rather than a folder inside `content/server`:

- The `graphql` dependency (and any future GraphiQL asset) stays out of the
  content plugin, which every deployment loads. A deployment that does not want
  a GraphQL endpoint simply does not register the plugin — which is exactly what
  ADR-0002's plugin model is for.
- It is a _protocol adapter over_ the public API, not part of the content model.
  Keeping it separate makes the direction of the dependency obvious and stops
  `public-api/` growing a second head.

Why not a top-level `packages/graphql/*` group: it serves content and nothing
else, and grouping it under `content` says so. (`content` already had a third
sibling — `domain`, the framework-free kernel — so this needed no new
convention, only a clarifying sentence in `AGENTS.md` §"Package layout".)

The package is small on purpose — schema builder, resolvers, executor, limits:

```
packages/content/graphql/
  src/lib/
    graphql.plugin.ts              # ContentGraphqlPlugin({ config })
    graphql.module.ts
    http/
      controllers/graphql.controller.ts   # POST /v1/graphql (+ GET → SDL)
      dto/graphql-request.dto.ts          # query / variables / operationName
    schema/
      build-schema.ts              # registry + grant set → GraphQLSchema
      schema-cache.ts              # memoised per grant set
      naming.ts                    # blog_post → BlogPost / blogPost / blogPosts
      field-types.ts               # FieldSpec → GraphQLOutputType
      input-types.ts               # FieldSpec → GraphQLInputType (mutations)
      scalars.ts                   # JSON, DateTime, Money
    resolvers/
      entry.resolvers.ts           # list / single / relations / media / translations
      mutation.resolvers.ts        # create / update / publish / unpublish / delete
      selection.ts                 # GraphQL selection set → ?fields= / ?relationFields=
    execution/
      execute-operation.ts         # parse → validate → execute
      limits.ts                    # depth, complexity, aliases, single-operation
      errors.ts                    # HttpException → GraphQLError extensions
```

## 4. Transport: `graphql-js` inside a Nest controller, not `@nestjs/graphql`

The endpoint is an ordinary Nest controller:

```ts
@Public()
@UseGuards(ApiTokenGuard, ApiTokenWorkspaceGuard)
@RequirePermissions(PERMISSIONS.CONTENT_READ)
@ApiSecurity('apiToken')
@Controller('v1/graphql')
export class GraphqlController { … }
```

which parses, validates and executes the operation with the `graphql` package
directly. **We do not use `@nestjs/graphql` + Apollo.** Four reasons, in order
of weight:

1. **The schema must vary per request.** Apollo/`GraphQLModule.forRoot` fixes one
   schema at boot. Invariant §2.1 requires a schema built from the caller's
   grant set. Everything else about the Nest integration would then be fighting
   that.
2. **Guard reuse is free this way.** `ApiTokenGuard` and
   `ApiTokenWorkspaceGuard` are exported from `content-server` for exactly this
   ("so a plugin adding a route to the same surface reuses the exact
   authentication and workspace-resolution rules"). With `@nestjs/graphql` they
   would need a `GqlExecutionContext` adapter, because `context.switchToHttp()`
   returns nothing useful there — a fork in the auth path, which is the one
   place we least want one.
3. **One dependency** (`graphql`, ~1 MB) instead of `@nestjs/graphql` +
   `@nestjs/apollo` + `@apollo/server`, and no second HTTP layer negotiating
   with the host's global prefix, `ValidationPipe`, and Scalar docs.
4. **The endpoint stays visible to the existing tooling** — it appears in the
   OpenAPI document like any other route, and `apps/server-e2e` drives it with
   supertest with no new harness.

What we give up, and how it is covered: query depth/complexity limits, batching,
and GraphiQL are not handed to us. Depth and complexity are ~120 lines of
validation rule (§9) and we want our own budget anyway; batching is §7;
GraphiQL is a static dev-only page in phase 4.

Two mechanical notes: the route is `@Public()` so the session `AuthGuard` skips
it (a session cookie is not an accepted credential on `/v1`, same as REST), and
the body needs a real DTO — the host's `ValidationPipe` runs with
`forbidNonWhitelisted: true`, so `{ query, variables, operationName }` must be
declared or every request is a 400.

## 5. The schema, built per grant set

`buildSchema(registry, grantedSlugs)` produces a `GraphQLSchema` containing
**only** the types the workspace was granted. `SchemaCache` memoises on the
sorted grant set (the grant set is small and stable, so a handful of schemas
exist in practice), and the whole cache is invalidated when grants change —
simplest correct version is a TTL plus an explicit bust hook on the
workspace-grant write path.

Consequence, and it is intended: **introspection differs per token.** A
consumer's SDL is the contract for _its_ workspace. That is a feature — it is
what makes §2.1 hold — and it goes in the docs prominently, because a developer
comparing two tokens' schemas will otherwise file a bug.

### Naming

`ContentTypeRegistry` names are `snake_case`. `blog_post` becomes:

- object type `BlogPost`, list envelope `BlogPostList`, input `BlogPostInput`
- query fields `blogPost(…)` (single) and `blogPosts(…)` (list)
- mutation fields `createBlogPost`, `updateBlogPost`, `publishBlogPost`,
  `unpublishBlogPost`, `deleteBlogPost`

Two content types that collide after camelisation (`blog_post` / `blogPost`)
are a **boot failure**, checked once against the whole registry rather than
per-workspace — otherwise a collision would be invisible until a workspace
happened to be granted both.

### Field mapping

| Field kind                  | GraphQL                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `text`                      | `String`                                                                                                      |
| `richtext`                  | `JSON` — a structured document (ORT-84); a legacy HTML body comes back as a JSON string                       |
| `number`                    | `Int` when `validation.integer`, else `Float`                                                                 |
| `money`                     | see the open question in §13 — minor units, so `Int` overflows above ~$21.4M                                  |
| `boolean`                   | `Boolean`                                                                                                     |
| `date`, `datetime`          | `DateTime` scalar (ISO 8601 string; same value REST sends)                                                    |
| `select`                    | generated enum from `options`, else `String`                                                                  |
| `multiselect`               | `[String!]` (enum-typed when `options` are set)                                                               |
| `json`                      | `JSON` scalar                                                                                                 |
| `relation` (owning single)  | the target object type, resolved on demand                                                                    |
| `relation` (many / inverse) | `TargetList!` with `(page, pageSize)`                                                                         |
| `media`                     | `[MediaAsset!]!` (single-valued fields still return a list of ≤1, so the shape does not change with the spec) |

`required: true` does **not** become `String!` on a publishable type: `required`
means _required to publish_, and drafts are legally incomplete (a `full`-scope
token reads them with `status: DRAFT`). Non-null output types would make a
perfectly valid draft unreadable. Only envelope fields the storage guarantees
(`id`, `createdAt`, `updatedAt`) are non-null.

Enum values are generated from `select` options, which are author-chosen strings
and may not be valid GraphQL names (`in-progress`). Sanitise to a valid name,
fail boot on a collision after sanitisation, and fall back to `String` for a
type whose options cannot be represented — never silently rename a value on the
wire.

### Root fields

```graphql
type Query {
    article(
        id: ID
        localeGroupId: ID
        locale: String
        status: EntryVisibility
    ): Article
    articles(
        page: Int
        pageSize: Int
        sort: String
        search: String
        filter: JSON
        locale: String
        status: EntryVisibility
    ): ArticleList!

    homePage(locale: String, status: EntryVisibility): HomePage # a `single`
    contentTypes: [ContentTypeInfo!]! # the /v1/content-types mirror
    contentType(name: String!): ContentTypeInfo
}
```

- `article(…)` takes **either** `id` **or** `localeGroupId` + `locale` — the two
  addressing forms REST spells as two routes, collapsed into one field with an
  either/or argument check (naming both, or neither, is a validation error).
- `filter` stays the **same JSON filter tree** the admin query builder emits and
  the REST `?filter=` accepts, passed through as a `JSON` scalar. A typed filter
  input generated per content type is nicer GraphQL and is the obvious phase-5
  upgrade; v1 reuses the existing engine verbatim so there is exactly one filter
  language and one validator.
- A `single` type gets the singular field only. This is a genuine improvement
  over REST, where a single is served by the list route and callers take
  `items[0]`.
- `contentTypes` is kept even though introspection overlaps it: `publishable` /
  `paranoid` / `i18n` are not expressible in SDL, and a client that switches
  protocols should not lose them.

## 6. Reads — resolvers as an adapter

`articles(…)` maps its arguments onto a `PublicListEntriesQueryDto` and calls
`PublicEntriesQuery.list(type, dto, workspaceId, granted)`. The interesting part
is deriving the _expansion_ arguments from the GraphQL selection set rather than
from query parameters:

- selected value fields → `fields` (the `?fields=` CSV) → the existing
  `parseFieldSelection` → the same narrowed SQL projection. A GraphQL query that
  asks for `{ id title }` must not read the `richtext` body column, and this is
  how that stays true for free.
- selected relation fields → `relations: 'preview'` + `relationFields` +
  `relationLimit` (from the field's `pageSize` argument, capped).
- selected media fields → `media: 'preview'` + `mediaFields` + `mediaLimit`.
- `translations` selected → `translations: 'preview'`.

So a one-level query costs exactly what the equivalent REST call costs, because
it _is_ the equivalent REST call. `PublicExpansionQuery.relationsForRows` /
`mediaForRows` already take a set of rows and return per-row views — they are
batch loaders in all but name, which is what makes this work without a DataLoader
at depth 1.

### Nesting deeper than one level

`hydrateRelationViews` deliberately does not expand linked entries ("their
`relations` and `media` are absent" — that is what stops one request walking the
whole graph). GraphQL callers will nest anyway, so we resolve **level by level,
batched per level**:

1. Collect every child id needed at level _N_ across all parents (one field, one
   type).
2. Load them in one call to `PublicEntriesQuery.list` with a
   `{ field: 'id', op: 'in', value: [...] }` filter tree and the level's own
   derived selection. `id` is filterable on the public surface and `in` is a
   supported operator, so this needs **no new query code and no new visibility
   rule** — an unpublished or cross-workspace child is filtered out by the same
   `readableWhere` as everything else.
3. Restore per-parent order and shape from the parent's relation view.

`MAX_PAGE_SIZE` (100) caps a page, so a level with more than 100 ids is chunked.
Cost is O(levels × fields) queries, not O(rows) — and depth is capped anyway
(§9). A per-request `DataLoader` is the natural refactor if this ever needs to
batch across sibling fields too; it is not needed for correctness.

## 7. Writes

Mutations mirror the write routes one-for-one and delegate to
`PublicEntryWritesService`, which keeps validation, relation deltas, media
target checks, revision numbering, the outbox and i18n sibling sync in their
single home:

```graphql
type Mutation {
    createArticle(
        input: ArticleInput!
        locale: String
        localeGroupId: ID
    ): Article!
    updateArticle(
        id: ID
        localeGroupId: ID
        locale: String
        input: ArticleInput!
    ): Article!
    publishArticle(id: ID, localeGroupId: ID, locale: String): Article!
    unpublishArticle(id: ID, localeGroupId: ID, locale: String): Article!
    deleteArticle(id: ID, localeGroupId: ID, locale: String): Boolean!
}
```

`ArticleInput` is **generated per content type** from the field specs — the
whole point of putting a typed protocol in front of the API. Every input field
is nullable, because the REST `PATCH` merges by key presence: an omitted key
means "leave alone", an explicit `null` means "clear". `graphql-js` preserves
that distinction in coerced input objects (an absent key stays absent unless the
field declares a default), so we must _not_ give input fields defaults. This is
worth a dedicated unit test — it is the subtlest correctness detail in the
feature.

Relation deltas ride a separate argument shaped like the REST `relations` bag,
generated per type so the field names are checked by the schema:

```graphql
input ArticleRelationsInput {
    tags: RelationDeltaInput # { link: [ID!], unlink: [ID!], order: [ID!], by: RelationRefBy }
    author: RelationDeltaInput
}
```

The `MAX_DELTA_FIELDS` / `MAX_DELTA_IDS` caps are enforced by reusing the
existing `IsRelationDeltaMap` validator on the assembled `PublicSaveEntryDto` —
we build the DTO and run `class-validator` on it inside the resolver rather than
re-stating the limits in GraphQL.

Deletes return `Boolean!` rather than the deleted entry: REST answers 204, and
inventing a payload would be the two protocols disagreeing about what a delete
means.

## 8. Authorization

Authentication and workspace resolution are unchanged — the two exported guards
run on the controller, so a request reaching a resolver already has a verified
`request.apiToken` and a resolved `request.workspaceId`.

What moves is the **permission check**, because one endpoint serves both reads
and writes and `@RequirePermissions` is per route:

- The controller keeps `@RequirePermissions(PERMISSIONS.CONTENT_READ)` — the
  floor for touching the endpoint at all.
- Each mutation resolver additionally asserts its own permission
  (`content:create` / `update` / `publish` / `delete`) before doing anything,
  through the same `AccessPolicy` + `scopePermissions` pair the guard uses.
- The draft rule (`status: DRAFT|ANY` ⟹ `content:update`) is asserted in the
  resolver wherever the argument is accepted — the logic `DraftVisibilityGuard`
  holds today, called from a shared helper so there is one authority.

To keep that from being a re-implementation, `identity-server` exports one small
addition: `tokenActor(token: PublicApiToken): Actor` (the four lines
`ApiTokenGuard` builds inline today), and `ApiTokenGuard` is refactored to use
it. Everything else it needs — `AccessPolicy`, `scopePermissions`, `PERMISSIONS`
— is already exported.

**A permission failure inside a resolver is a GraphQL error, and the HTTP status
is 200.** That is how GraphQL works, and it is worth stating in the docs because
it will surprise anyone porting from the REST client. The error carries
`extensions.code: 'FORBIDDEN'` and `extensions.status: 403` so a client can
branch on it. Ungranted content types are the one exception that stays a hard
protocol-level failure — they are absent from the schema, so naming one is a
`GRAPHQL_VALIDATION_FAILED` before any resolver runs, which is a _stronger_
guarantee than the REST 404.

### Error mapping

`errors.ts` maps a thrown `HttpException` to a `GraphQLError` with
`extensions.status` + a stable `extensions.code`, and 422 validation failures
keep their per-field issues under `extensions.issues` — so a client gets the
same information GraphQL-shaped. Anything that is _not_ an `HttpException` is
logged and replaced with a generic "Internal server error", so a stack trace or
a Postgres message can never reach a token holder.

## 9. Cost limits

REST bounded a request structurally: one route, one page, `MAX_PAGE_SIZE`.
GraphQL does not, so the executor enforces a budget before running anything.
All limits are plugin config with defaults:

| Limit                     | Default               | Why                                                                                            |
| ------------------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| max depth                 | 8                     | Bounds the level-by-level loader (§6).                                                         |
| max complexity            | 1000                  | `Σ pageSize` multiplied down the nesting path — the honest estimate of rows a query can touch. |
| max aliases per operation | 30                    | Aliasing the same expensive field N times sidesteps a depth cap.                               |
| max query length          | 16 KB                 | Cheap first line of defence, before parsing.                                                   |
| operations per request    | 1                     | No operation-array batching; it multiplies every other budget.                                 |
| `pageSize`                | `MAX_PAGE_SIZE` (100) | Reuses the existing constant.                                                                  |

Introspection stays **enabled** — the endpoint is authenticated, the schema is
already pruned to the caller's grants, and disabling it would remove most of the
reason to offer GraphQL at all.

Rate limiting is out of scope here and is a gap on the REST surface too: the
public API has no throttle today (only login does). Worth its own issue; the
token id on `request.apiToken` is the natural key.

## 10. Roadmap

Each phase is independently shippable and independently reviewable.

**Phase 0 — walking skeleton.** Package scaffold (`AGENTS.md` + `CLAUDE.md`,
`project.json`, `tsconfig`, `package.json`), the `graphql` dependency, the
plugin + module, `POST /api/v1/graphql` behind the two guards, and a
hard-coded one-field schema. Registered in `apps/server/src/plugins.ts` and
`apps/server-e2e/src/support/plugins.ts`. e2e: no token → 401, bad workspace →
403, valid token → 200. _Proves the auth path end-to-end before any schema work._

**Phase 1 — reads, flat.** Schema generation from the registry (scalars,
envelope, enums, naming, collision check), grant pruning + cache, list/single
root fields, selection → `?fields=`, search/filter/sort/pagination/locale.
e2e: a parity suite that fetches the same entry over REST and GraphQL and
deep-compares.

**Phase 2 — relations, media, translations.** Nested fields, per-level batching,
the depth/complexity/alias limits, the SDL endpoint (`GET /api/v1/graphql`).

**Phase 3 — mutations.** Per-type input objects, relation delta inputs, the
publish lifecycle, per-resolver permission assertions, `status: DRAFT` reads for
`full`-scope tokens, the error mapper's 422 path.

**Phase 4 — polish.** A dev-only GraphiQL page (same `docs` config flag as the
Scalar reference), the API Tokens page showing a GraphQL example next to the
curl one, ADR-0008 recording the "adapter, not second implementation" and
"per-grant-set schema" decisions.

## 11. What changes outside the new package

Small and mostly mechanical — the point of §1 is that this list stays short:

- `packages/content/server/src/lib/content.module.ts` — add `PublicEntriesQuery`,
  `PublicEntryWritesService`, `PublicExpansionQuery`, `WorkspaceGrantsQuery`,
  `ApiTokenGuard`, `ApiTokenWorkspaceGuard` to `exports`. The module is already
  `global: true`, so exporting is all that is needed for the new plugin to
  inject them without an import cycle.
- `packages/content/server/src/index.ts` — export those provider classes and
  `resolveGrantedType`, `parseFieldSelection`, and the `PublicEntryQueryDto` /
  `PublicListEntriesQueryDto` / `PublicSaveEntryDto` types.
- `packages/identity/server` — export `tokenActor` (§8) and refactor
  `ApiTokenGuard` onto it.
- `apps/server/ortha.config.ts` + `src/plugins.ts` — register the plugin and its
  config block (`enabled`, `maxDepth`, `maxComplexity`, `graphiql`).
- `apps/server-e2e/src/support/plugins.ts` — same registration for tests.
- Root `package.json` — `graphql`.
- Docs — `CONTEXT-MAP.md` project table, `AGENTS.md` package-layout note,
  `packages/content/server/AGENTS.md` cross-reference, ADR-0008.

No migrations. No schema. No change to the token model: **a token minted today
works against GraphQL with no admin change at all**, which is the main reason
this is cheap.

## 12. Testing

- **Unit** (vitest, in-package): naming + collision detection, field→GraphQL
  type mapping, grant pruning, selection-set → `?fields=` derivation, the
  omitted-vs-null input coercion rule (§7), depth/complexity rules, error
  mapping.
- **e2e** (`apps/server-e2e/src/server/content/graphql-*.spec.ts`, per the
  `server-e2e` skill):
    - _auth parity_ — missing/invalid/revoked/expired token → one flat 401;
      workspace outside the bucket → 403; multi-workspace token with no header → 400.
    - _grant pruning_ — a type the workspace was not granted is absent from
      introspection and its query field does not exist.
    - _visibility_ — a `read` token asking `status: DRAFT` is refused; a `full`
      token reads back the draft it just created.
    - _read parity_ — the highest-value test: same fixture, REST vs GraphQL,
      deep-equal after shape normalisation.
    - _relations / media / translations_, including one two-level nest.
    - _mutations_ — create → update (merge semantics, explicit null clears) →
      publish → unpublish → delete.
    - _limits_ — an over-deep and an over-complex query are rejected before
      execution.

## 13. Open questions

1. **`money`.** Stored as integer minor units. `Int` is 32-bit signed, so it
   overflows above ~$21.4M in cents. Options: `Float` (exact for integers well
   past that), a `Money` custom scalar serialised as a string, or `Int` with a
   documented ceiling. Leaning `Float` for v1 to match what REST already sends
   as JSON, with the caveat documented.
2. **Typed filter inputs.** v1 passes the existing filter tree through a `JSON`
   scalar — one filter language, zero risk. Generating a typed
   `ArticleFilterInput` per type is better GraphQL and a natural phase 5; worth
   deciding now whether the `JSON` shape is a temporary or a permanent part of
   the contract.
3. **Schema cache invalidation on grant change.** TTL is the simple version; an
   explicit bust hook on the workspace-grant write path is correct but needs a
   port from `workspaces-server` (or an outbox subscription) — probably phase 2.
4. **Read-only first?** Phases 1–2 are useful on their own, and most consumers
   of a content API only read. Shipping reads and deciding on mutations
   afterwards is a legitimate stopping point.

---

## 14. What changed during the build

Recorded because a design doc that quietly disagrees with the code is worse than
no design doc.

1. **An owning single relation resolves to the target, not a list.** §5 mapped
   every relation to `TargetList!`. The generated SDL made the problem obvious:
   a many-to-one holds at most one target, and `author { items { name } }` makes
   a consumer unwrap a list that structurally cannot have a second element. Only
   join-backed relations (owning many-to-many, and either inverse) keep the
   paged envelope.

2. **The list envelope dropped `page`/`pageSize`.** The caller passed them;
   echoing them back is noise in a protocol where the arguments are in the
   document. `{ items, total }` for both root lists and relations.

3. **Complexity does not count `items`.** The first estimator squared every list
   — a five-by-five query scored 10,605 against a budget of 1,000. `items` is
   the page its parent field already sized, so it recurses without multiplying.
   Caught by a unit test, not by review.

4. **`money` is `Float`.** §13 left this open. Stored as integer minor units;
   `Int` is 32-bit and overflows around $21.4M in cents, while `Float` is exact
   for every integer to 2^53 and matches what REST already sends as JSON.

5. **Enum sanitising is a documented rename, not a refusal.** §5 claimed we
   "never silently rename a value on the wire". Not achievable — a GraphQL enum
   _name_ is the wire spelling, so `in-progress` must become `in_progress`. What
   the code actually guarantees is that the mapping is never **ambiguous**: an
   option that cannot be a name at all, or two options colliding after
   sanitising, falls the whole field back to `String`.

6. **A relation into an ungranted type is pruned from writes too**, not only
   reads — a settable field pointing at an invisible type would advertise that
   type in the SDL, which is exactly the enumeration §2.1 exists to prevent. A
   deliberate divergence from REST, which would allow the write.

7. **GraphiQL shipped after all.** §10 phase 4 and §13 deferred it. Added on
   request at `GET /v1/graphql/playground`, gated on `docs.enabled` so it is off
   in production, and served self-contained rather than from a CDN. That choice
   pinned the package to **graphql 16** — every prebuilt-GraphiQL package peers
   on ≤16, and bundling `graphiql` ourselves needs a build step these packages
   do not have. No code changed in the downgrade; `coercedVariables` already
   handled both shapes.

Not built, as §13 anticipated: typed per-type filter inputs, and the
grant-change cache-invalidation hook (the TTL covers it).
