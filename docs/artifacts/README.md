# Package dossiers

A combined technical and business description of every package in the monorepo: what it is
for and why it exists, the data model, the HTTP API, the admin screens, the invariants and a
testing checklist.

Written to serve as the basis for QA runs and for admin- and product-facing documentation.
The source of every claim is the **source code** as it stood when the dossier was written;
the `AGENTS.md` files were used as a skeleton, but each claim was checked against the
implementation. Discrepancies found along the way are collected in the last section of each
dossier.

Every file is Markdown, so a dossier is read, searched and diffed with the same tools as
the code it describes. They were authored as self-contained HTML pages and converted in
place; the published HTML copies that used to be linked here are no longer maintained and
will diverge from these.

## Contents

| Package          | File                                       |
| ---------------- | ------------------------------------------ |
| identity         | [identity.md](identity.md)                 |
| users            | [users.md](users.md)                       |
| workspaces       | [workspaces.md](workspaces.md)             |
| api-tokens       | [api-tokens.md](api-tokens.md)             |
| segments         | [segments.md](segments.md)                 |
| activity         | [activity.md](activity.md)                 |
| content          | [content.md](content.md)                   |
| media            | [media.md](media.md)                       |
| i18n             | [i18n.md](i18n.md)                         |
| wysiwyg          | [wysiwyg.md](wysiwyg.md)                   |
| alarms           | [alarms.md](alarms.md)                     |
| protection       | [protection.md](protection.md)             |
| transfer         | [transfer.md](transfer.md)                 |
| copilot          | [copilot.md](copilot.md)                   |
| tools            | [tools.md](tools.md)                       |
| mcp              | [mcp.md](mcp.md)                           |
| webhooks         | [webhooks.md](webhooks.md)                 |
| shell            | [shell.md](shell.md)                       |
| design-system    | [design-system.md](design-system.md)       |
| insights         | [insights.md](insights.md)                 |
| query-builder    | [query-builder.md](query-builder.md)       |
| bootstrap        | [bootstrap.md](bootstrap.md)               |
| database         | [database.md](database.md)                 |
| utils            | [utils.md](utils.md)                       |
| nx               | [nx.md](nx.md)                             |
| cli              | [cli.md](cli.md)                           |
| create-apograph-app | [create-apograph-app.md](create-apograph-app.md) |

## Structure of a dossier

Sections a package does not have are dropped; package-specific ones are added (the storage
adapter matrix in `media`, the `canRead` truth table in `segments`, the tool registry in
`tools`, the event-kind catalogue in `activity`).

1. Business description — why, for whom, what the value is, what it is **not**
2. Composition of the package group
3. Roles and permissions
4. Data model — tables, columns, constraints, migrations
5. Lifecycle of the key entity
6. Step-by-step flows — with the reasoning for "why it was done this way"
7. HTTP API — method, path, guard, input, success, failures
8. Admin UI — routes, screens, states, slots, accessibility
9. Configuration
10. Security and resilience
11. Invariants `I-01…` — usable as assertions for tests
12. Testing checklist — "action → expected result"
13. Boundaries of responsibility
14. Discrepancies between code and documentation

## Cross-cutting findings

Problems that surfaced independently in several dossiers. Every conclusion here comes from
reading the source, not from a live stack.

**Re-checked 2026-09-05, against the code rather than against the previous pass.** This
section had itself gone stale: it was quoted as a summary of what is wrong with the system
while three of its findings had already been fixed, and one of those was fed to a triage agent
as context and would have produced a false verdict. A finding that is repaired gets struck
from here in the same commit as the repair — this section is not an archive.

**The root documentation has fallen behind the code.** Still true, in every particular.
`ARCHITECTURE.md`, `CONTEXT-MAP.md` and ADR-0002 claim that `database` owns no schema (it owns
`outbox_events` and **three** migrations); the `ServerPlugin` contract is shown with four
fields, without its fifth, `docs`; "the Content Library defines five slots" — there are 14;
the session is called a "signed token" (it is opaque and unsigned, and the same file describes
the cookie correctly forty lines earlier); §8 denies that a content model and an LLM
integration exist, and also denies the queue/worker and the media library. Found by the
`bootstrap`, `database` and `workspaces` dossiers.

**Workspace deletion is swept, and what survives now survives on purpose.** Six packages
implement `WorkspacePurger`: `media`, the local `ApiTokenGrantsPurger`, `alarms`
(`alarm_rules` + `alarm_findings`), `segments` (`entry_access`), `content`
(`content_entry_revisions`) and `webhooks` (`webhook_endpoint_workspaces`).
`workspace-delete-residue.spec.ts` asserts all fourteen tables — six cascading, eight purged —
count zero after a delete. The last defect closed 2026-09-05: webhooks kept its subscription
rows, and fan-out re-read them on every content write. Its own dossier had called the stale id
"harmless — no event will ever carry it again", which is true of correctness and false of
everything else; that sentence is why it outlived two rounds of the same finding.

One thing still survives a deletion, and it is **correct**: `segments.workspace_ids` keeps the
dead id, because an empty `workspace_ids` means "every workspace" and pruning the last id would
widen who may read. Webhooks looks identical and gets the opposite treatment for a reason that
is in the schema rather than in taste — `all_workspaces` is a separate boolean, so an empty set
there means "none" and a prune can only narrow. Both readings are pinned by a test that names
the other. Found by the `workspaces`, `alarms` and `webhooks` dossiers.

**The filter grammar. Closed 2026-09-05, and the last piece was a real exposure.** The operator
dictionary is still duplicated — a browser cannot drag in NestJS and Drizzle — but it is no
longer unwatched: `operator-vocabulary-parity.spec.ts` imports `FilterOperator` and reads
`wireOp.ts` as text, and pins a **third** copy nobody had counted, `OPERATORS_BY_TYPE`, where an
operator in the vocabulary but on no type's list passes the unknown-operator check and is then
refused on every field there is. The `like` gap that started this is fixed and now has a general
rule behind it rather than one case.

`FILTER_MAX_LENGTH`'s odd 8192 turned out to be an accident that guarded nothing: **nothing
imported it**, and nothing could have — the field it would have capped is `@IsObject()`, and
`@MaxLength` is a string decorator. It is deleted rather than aligned; the other three re-export
one value from `utils-server`.

The engine's missing string-length budget was **not** covered by the DTOs, which is what the
earlier note assumed. Four callers reach `parseFilterTree` without one: an alarm rule at write
time, the same rule replayed out of its `jsonb` column by the subscriber and the sweep (where
there is no string left to measure), the copilot's `admin_content_search`, and GraphQL's entry
loader. On those the parser was the whole boundary and the next bound down was the 1 MB body
limit. `maxValueLength` is now the fifth budget, applied per element of an `in` list as well as
to a scalar. Its default equals `FILTER_MAX_LENGTH`, and the equality is the argument: a filter
that arrived as a string is already capped at that length in total, so the budget provably
refuses nothing an HTTP caller could already send, and exists only for the callers that never
meet a DTO. Found by the `query-builder` and `utils` dossiers.

**ADR statuses. Fixed 2026-09-05.** Nine records — 0003, 0004, 0005, 0006, 0007, 0009, 0010,
0011 and 0013 — sat in status `Proposed` while the code had been built on them for months, which
tells a reader the opposite of the truth. Each was checked against the implementation before
being moved to `Accepted`; none had to be left. The broken `0012-sso-provider-port.md` link in
`provider-oidc/AGENTS.md` and `provider-saml/AGENTS.md` now points at ADR-0013, and a sweep of
every ADR reference in the repo found no other dangling filename.

Two smaller things surfaced and are **still open**, both in accepted records rather than in
their statuses: ADR-0004 §5's second tier (`copilot_model_configs`, runtime model registration)
was never built, and ADR-0005's `Update (2026-08-24)` argues from the composition root ordering
"the offline `fake` adapter last", which stopped being true when the fake provider became a
private test fixture. Each wants an amending record, not an edit to an accepted one.

**The first-run experience breaks in one place, not three.** The generated app's README still
does not work literally: drizzle-kit resolves `schema` and `out` from the cwd rather than from
the config file, and the CLI runs it from the project root, so `out: ../../migrations` walks
two levels above the root (the correct target is `<root>/migrations`, which the template's own
plugin comment already uses). The same file also still points at the pre-`apps/` layout
(`src/server/plugins.ts` for `apps/server/src/plugins.ts`), and nothing tests its contents —
only that it exists. The other two are **fixed**: `apograph --help`, `-h`, bare `help` and empty
argv all print usage and exit 0 before the project root is even looked up, with regression
tests in `args.spec.ts` and `cli.spec.ts`; and `npm test` in a freshly created app is green —
`EXPECTED_PLUGINS` carries `content-views` and `webhooks` on both halves, and
`composition.spec.ts` now derives the expected names from the packages that define each factory
instead of grepping the template against itself, so a plugin added to `plugins.ts` and not to
the spec fails there.

**Operating the outbox.** There is still no cleanup of `outbox_events` — dispatched rows are
stamped, never deleted, and the schema comment says so outright ("a table nothing prunes").
After 15 attempts (≈33 minutes of doubling backoff, capped at five minutes) an event is parked
until an operator clears its `attempts`. It is no longer only findable with SQL:
`OutboxDispatcher.deadLetters()` backs `GET /api/activity/dead-letters` (gated on
`activity:read`), surfaced in the admin as the activity log's `DeadLetterNotice`.

**A package's manifest is not the package a consumer installs.** Six dossiers describe a
package as dependency-free, and every one of them is reading the checked-in `package.json`.
`tools/release/pack.mjs` writes `tslib` into every staged manifest — unconditionally, because
`importHelpers` is on workspace-wide and the emitted JS reaches for the helper runtime whether
or not the source ever mentions it. So `npm i @apograph/media-provider-s3` fetches four
packages, and `npx create-apograph-app` — whose empty `dependencies` field is a deliberate choice
about how long the very first command takes — fetches two. The gap is a few kilobytes and a
whole sentence, and nothing pinned it: `tslib` appeared in `pack.spec.ts` only as a fixture
value. Now pinned by "pack.mjs, resolving what a package depends on" (three cases,
mutation-proved), and four invariants — `content:I-37`, `identity:I-27`, `media:I-34`,
`segments:I-38` — say `declares` where they said `has`. `copilot`'s wording ("no
`dependencies` block at all") was already exact. Found by the `media` dossier, then swept.

## Updating

The file here and the published page are independent copies. After editing the HTML, republish
the page at its own link (for Claude Code: pass the URL from the table), otherwise you get a
second artifact instead of an updated one.
