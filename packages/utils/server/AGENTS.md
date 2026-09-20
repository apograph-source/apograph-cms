# @orthacms/utils-server

Server-side shared utilities for Ortha CMS. Three concerns:

- the **filter query builder** — translates a REST-style `?filter=` payload into
  a Drizzle SQL fragment that callers splice into their `WHERE` clause (the bulk
  of this document);
- **Postgres error introspection** (`pg-errors.ts`) — `isUniqueViolation` and
  `violatedConstraint`, for mapping a `23505` to a clean HTTP error instead of a 500. `violatedConstraint` returns the offending index's **name** (or `''` when
  the driver didn't supply one, so a caller can still tell "unattributed
  violation" from "not a violation"): a table with several unique indexes needs
  to know _which_ one tripped, because reporting one as the other tells the user
  to fix something that isn't wrong.
- **Environment readers** (`env.ts`) — `readEnv`, `requireEnv`,
  `readPositiveInt` / `readOptionalPositiveInt`, `readList` /
  `readOptionalList`, `readFlag`, `readTrustProxy`, `readNodeEnv` /
  `isProduction`, plus `when` and `defined`. What a host's `ortha.config.ts`
  turns `process.env` into. Here rather than in each host because this repo's
  host and the scaffolder's template had a copy each and they had already
  drifted; see below.

The package has no NestJS module of its own — it's a pure helper library any
plugin can import.

## Package

- Name: `@orthacms/utils-server`
- Import: `import { applyFilterTree, parseFilterTree } from '@orthacms/utils-server'`

## Environment readers (`env.ts`)

Every reader **throws rather than guesses**, which is the whole point of the
module: the failure mode of environment parsing is silence. A number that is
not a plain positive decimal integer, a `NODE_ENV` that is not one of the three
recognised modes, a required variable that is empty — each refuses at import,
naming the variable, instead of producing a deployment that looks configured.
`Number(process.env[x]) || default` was wrong in three directions at once (a
falsy `0` became the default, a truthy negative was accepted, `1e9` parsed) and
silent in all of them.

Four things here are decisions rather than details:

- **`readEnv` is the one every other reader is built on.** "Empty means not
  configured" is decided in exactly one place, which is what makes
  `ANTHROPIC_API_KEY=` leave a deployment with no Claude backend rather than one
  registered with an empty key — a backend that is in the picker and fails on
  the first message.
- **`readOptionalPositiveInt` exists alongside `readPositiveInt`** (and
  `readOptionalList` alongside `readList`). A _ceiling_ whose owner ships its
  own default cannot be handed `{ maxSteps: undefined }` — spreading that
  overwrites the default with nothing — so the optional form yields `undefined`
  and the caller drops the key.
- **`when` and `defined` read nothing**, and are here anyway. They are what a
  host does with that `undefined`: `when(configured, build)` yields a block or
  nothing, `defined(obj)` strips the keys that were never set. Without them
  every host writes `...(x ? { key } : {})` at each optional setting, which is
  the duplication this module exists to end — and the shape that made the
  erasure above easy to get wrong.
- **`readTrustProxy` returns `boolean | number | string` structurally**, rather
  than importing `TrustProxySetting` from `@orthacms/bootstrap-server`. This is
  a leaf helper package and the host that imports it must not become a
  dependency of it; the host's own `trustProxy?: TrustProxySetting` field is
  what checks the two still agree.

`isProduction` is a **function**, not a constant, because a library cannot
decide when a host reads its environment. `apps/server/config/env.ts` re-derives
it as a constant at import for its own reasons, which is the shape a host is
free to choose.

## Conventions

- Uses `interface` for type contracts (not `type`)
- All exported symbols must have JSDoc comments
- No `.js` extensions in TypeScript imports
- Filter-only types/interfaces go in `src/lib/filters/types.ts`
- Always import types/interfaces with the `type` keyword

## Filter pipeline

Translate a user-supplied `?filter=<json>` into a Drizzle `SQL` fragment:

1. `parseFilterTree(raw, schema)` → `ParsedNode | null` (group/rule tree,
   validated against a `FilterSchema`; `null` for an empty filter)
2. `applyFilterTree(node, schema, table, db, opts)` → `SQL | undefined`
   (Drizzle fragment, or `undefined` for an empty tree)

Callers `and()` the result with their own search/status predicates — the
engine never owns the full WHERE clause.

Key concepts:

- **`FilterSchema`** declares which columns are filterable (`fields`), which
  relations are traversable (`relations`), optional `extensionFields` resolved
  by a host-supplied `resolveExtension` hook (e.g. a `role` filter), and the
  `maxDepth` / `maxNodes` / `maxGroupDepth` / `maxInListLength` /
  `maxValueLength` guards — all five defaulted in `filters/budgets.ts`.
- **The budgets are the only thing bounding a stranger's tree, and one of them
  counts text.** Four of the five bound the tree's _structure_; `maxValueLength`
  (default 4096, applied to each element of an `in` list as well as to a bare
  scalar) bounds one clause's string. It exists because the `@MaxLength` a
  caller puts on its serialised `?filter=` does not reach every path: an alarm
  rule's `filter` is an object (`@IsObject()`), the **stored** rule is replayed
  straight out of its `jsonb` column by the sweep and the outbox subscriber with
  no string to measure, the copilot's `admin_content_search` takes an object
  whose contents the registry's `anyOf`-blind check does not inspect, and
  GraphQL's entry loader builds a tree in code and casts past the DTO. On those
  four the parser is the whole boundary, and the next bound down was the 1 MB
  body limit. `budgets.ts` carries that list beside the numbers.
- **`FILTER_MAX_LENGTH` lives here too**, exported from the package root, and is
  what a caller's DTO puts on its own `?filter=` field. It was declared
  separately in `activity`, `content`, `users` and `alarms`, and the `alarms`
  copy said 8192 while claiming in its own comment to use "the same layering"
  as the 4096 one — a number that had, in fact, never been applied to anything,
  because `@MaxLength` is a string decorator and that field is an object. One
  declaration now; the three packages that still need the name re-export it.
- **Relation kinds** — `one-to-one` / `one-to-many` / `many-to-one` /
  `many-to-many` / `self-referential` — discriminate the EXISTS subquery
  shape. `self-referential` aliases the target so the correlation binds to
  the outer row (an unaliased self-join would degrade to "a row that is its
  own parent"). Each `RelationSchema` variant takes an optional `scope`
  (`RelationScope = (target) => SQL | undefined`) ANDed **inside** the
  EXISTS — the host's workspace + soft-delete guard, so a relation filter
  never traverses rows the root query excludes. It is a function, not a
  prebuilt `SQL`, because a self-join must scope the alias, not the physical
  table; when a `scope` is set the many-to-many junction-only fast path
  yields to the full target join.
- **Parent-side columns are re-bound to the queried table.** A relation's
  `fk` (on `many-to-one` / `self-referential`) and any `parentKey` are
  prebuilt against the _physical_ parent table, which is wrong whenever the
  parent is an **alias** — i.e. for anything nested under a
  `self-referential` hop. Postgres resolves the unaliased column from the
  outermost `FROM` instead of erroring, so `parent.author.name` would filter
  the ROOT row's author and `parent.parent.name` would collapse to
  `parent.name`. `rebind()` (in `table-helpers.ts`) re-resolves those columns
  against whatever table the translator is querying; it is a no-op on an
  unaliased chain. Never rebind a target-side `fk` (`one-to-many`).
- **Operators** — `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `like`,
  `ilike`, `nilike`, `null`, `within_last` — each mapped to a parameterized
  Drizzle helper. Values are never string-interpolated into SQL.
- **`within_last` is date-only and resolved by Postgres, not by the caller.** It
  takes `{ n, unit }` (`minutes` / `hours` / `days`) and emits
  `col >= now() - make_interval(...)`, so the window is measured at **query
  time**. The distinction is invisible in a URL and decisive in a stored filter:
  the admin's query builder still freezes its own `within_last` into a concrete
  `gte` cutoff when serialising into a link (a shared deep link should keep
  showing the same rows), and passes `relativeDates` to keep the relative
  spelling when the filter is going to be **stored and replayed** — an alarm
  rule reading "not updated in 90 days" would otherwise mean "not updated since
  the day it was written", for ever. `n` is bounded because
  `now() - make_interval(days => 1e9)` is a Postgres `22008` the caller sees as
  a 500. The unit is never interpolated into SQL — the translator switches over
  the three, so there is no path by which a wire value could reach `sql.raw`.
- **An operator is checked against the field's type, not just against the
  vocabulary** (`operator-support.ts`). A leaf has three axes — field, operator,
  value — and the whitelist used to cover two: `ilike` on a `date`/`number`/
  `boolean`/`uuid` named a real field, carried an acceptable value, and reached
  Postgres as `~~*`, which those column types have no operator for. That was a
  **user-triggerable 500 from a shareable link** on every filterable endpoint;
  it is now `FILTER_OPERATOR_NOT_ALLOWED` (400) carrying `path`, `op`,
  `fieldType` and the `allowed` list. The table states what the **column** can
  answer, so it is wider than the admin picker's `OPS_FOR_TYPE` (which drops
  `eq` on dates and all but `eq` on booleans for editor reasons): only the
  text-only `~~` family — `like`/`ilike`/`nilike` — is withheld, and only from
  non-textual types.
- **Negation has two rules, both non-obvious** (`negation.ts`):
    - **On a relation path**, a negating leaf (`ne` / `nin` / `nilike`, and
      `null: true`) is rewritten into `NOT EXISTS(… positive …)` — the
      negation wraps the **outermost** hop, so a multi-hop path negates the
      whole chain. The naive `EXISTS(… negated …)` asserts the _opposite_
      once a relation can hold >1 row: `tags.name nin ['x']` would mean "has
      some tag that isn't x" and match an entry tagged `[x, y]`. It also
      makes `relation.id null:true` ("is empty") a dead filter, since a
      target's `id` is a NOT NULL primary key.
    - **On a plain column**, negative operators are **NULL-inclusive**
      (`col <> v OR col IS NULL`). SQL's three-valued logic would otherwise
      drop NULL rows, and a publishable type keeps its required fields
      nullable — "Title does not contain foo" must not hide untitled drafts.
- **Scalar coercion** — `string` / `number` / `boolean` / `uuid` / `date` /
  `enum`; the parser coerces raw URL strings to the declared type before they
  hit Drizzle.
- **Values must be scalars.** `string` / `number` / `boolean` are accepted (a
  JSON client legitimately sends any of the three for a URL-shaped API);
  `null`, a missing `value` key, objects and arrays are a
  `FILTER_INVALID_VALUE` 400. They used to be run through `String(v)` and
  _matched against_: `null` → `"null"`, no `value` → `"undefined"`,
  `{}` → `"[object Object]"`, `[]` → `""` → `0` for a number field — a 200 with
  a wrong, usually empty, result set, which is the only silent failure mode a
  library that 400s every other bad value can have. "Is null" is the `null`
  operator, not a `null` value.
- **`FilterException`** (a `BadRequestException`) carries a `FilterErrorCode`
  so controllers translate validation failures to clean HTTP 400s. Its
  `context` is spread **before** the reserved keys, so a context field named
  `code` / `statusCode` / `error` / `message` can never rewrite the envelope the
  class exists to guarantee.
- **`FilterSchemaException`** (an `InternalServerErrorException`, code
  `FILTER_SCHEMA_INVALID`) is the other half: the request was well-formed and
  the whitelist accepted it, but the **schema the caller declared** cannot be
  translated — a `many-to-many` with target `fields` but no `table`, a `fields`
  entry naming a column that is not on the table, a nested `fields` map with no
  matching `relations` entry, a table with no `id` and no explicit key, an
  unrecognised scalar `type` or relation `kind`. Deliberately a **500**: a 400
  would blame the client, hide the fault from alerting, and leave the schema bug
  in place. These four sites used to throw a bare `Error`, which reaches a
  transport as an opaque 500 and, through MCP, an untyped JSON-RPC internal
  error.

The schema is the security boundary: only whitelisted fields/ops/relations
reach SQL, and depth/node caps bound payload blow-up.

**Every lookup of a user-supplied name in a schema map goes through
`own()` (`own-property.ts`), never bare bracket notation.** `fields`,
`relations`, a `RelationSchema`'s nested maps and drizzle's own column map are
all plain object literals, so `map[name]` resolves `constructor`, `toString`,
`valueOf`, `hasOwnProperty` and the rest of `Object.prototype` to truthy values
and a `if (!map[name])` guard accepts a name nobody declared. Both downstream
outcomes were live defects reachable from any filterable endpoint with a
one-word query param: a scalar path handed a `Function` to drizzle as a
`Column` and emitted `$1 = `, a Postgres syntax error — a **user-triggerable
500**; a relation-shaped path (`toString.constructor`) fell out of
`relationExists`'s `switch` as `undefined` and the predicate was **silently
dropped**, answering 200 unfiltered. Both are pinned by
`__test__/own-property-whitelist.spec.ts` and, end-to-end, by
`apps/server-e2e/src/server/users/list-users-filter.spec.ts`.

Internal files (not exported): `parse-filter-tree.ts`, `tree-to-drizzle.ts`,
`relation-exists.ts`, `scalar-op.ts`, `negation.ts`, `resolve-leaf.ts`,
`table-helpers.ts`, `own-property.ts`.

## Commands

- `npx nx typecheck @orthacms/utils-server`
- `npx nx test @orthacms/utils-server`
