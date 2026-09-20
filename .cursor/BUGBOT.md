# BUGBOT — recurring bug patterns

Patterns that have bitten this codebase or that the review skills call out as
high-risk. Reviewers (human and AI) and code-gen agents should actively check
for these. Each item: the trap, then what "correct" looks like.

Cursor reads repo context from `AGENTS.md`; this file is the bug-pattern
companion to it.

## Server (NestJS plugins)

- **Permission strings as literals.** Guard with shared permission *constants*,
  not inline `'users:read'` strings — a typo silently disables enforcement.
- **Count-then-write races.** Don't read a count and then mutate on a contended
  invariant (e.g. "is this the last admin?"). Lock the contended rows or rely on
  a DB constraint; otherwise two concurrent requests both pass the check.
- **Audit outside the transaction.** `ActivityService.record(...)` must run with
  the *same* transaction/executor as the mutation, so the audit row commits iff
  the mutation does. A separate connection can leave orphaned or missing audit.
- **Enumeration signal.** Auth/lookup endpoints must not reveal whether an email
  or resource exists (timing or distinct messages). Keep responses uniform.
- **Dropping filters/validation when consolidating endpoints.** When merging or
  refactoring controllers, preserve every existing filter, permission check, and
  DTO validation. Re-verify the DTO (`class-validator`) still constrains input.
- **Schema/migration drift.** After editing a plugin's Drizzle schema, generate
  its migration (`nx run <plugin>:db:generate`) and commit the SQL. Never hand-
  edit applied migrations.
- **A table not re-exported from the schema barrel.** drizzle-kit diffs
  **top-level table exports only**, so a table the barrel does not export is
  absent from every migration it emits — silently. Nothing else changes: the app
  boots, the type appears in the admin, and the first read or write fails on a
  table that was never created. Many-relation join tables are the ones to forget.
  `apps/server/src/content/index.spec.ts` derives the expected set from the
  registry and fails naming any table that is missing; do the same for any new
  barrel (ORT-130).
- **Plugin order in `plugins.ts` decides migrations, not DI.** Every plugin module
  is global and every `onPluginInit` runs before `NestFactory.create`, so array
  position cannot break injection. It *can* break `db:migrate`, which walks the
  array with no transaction spanning plugins: a plugin whose tables reference
  another's must come after it. The failure is invisible on an already-migrated
  database and only appears on a fresh one, so it ships (ORT-131).
- **`Number(process.env[x]) || default`.** Wrong in three directions at once and
  silent in all of them: `0` is falsy so it becomes the default, a negative is
  truthy so it is accepted, and `1e9` parses. Read env numbers through a
  validating helper that names the variable — `apps/server/ortha.config.ts`'s
  `readPositiveInt` is the pattern.
- **A provider name a plugin never checks.** A plugin that selects a backend by
  name must validate that name against what it was handed, at construction.
  Otherwise a typo boots clean and fails per request, with a bare `500` naming
  neither the provider nor the variable. Both plugins have now removed the
  setting rather than validating it: `copilot`'s default is the first entry of
  the provider list it is already handed, and `media` takes **one** provider
  object that carries its own `id` (ADR-0012) — a name that cannot be
  misspelled, because nobody types it.

## Composition roots & their test harnesses

- **The harness exercising a mirror instead of the thing.** `apps/server-e2e`
  builds its own `buildPlugins`, its own config and its own content types on
  purpose — that decoupling is right — and the consequence is that nothing in it
  ever reads `apps/server`. The same held for `apps/admin-e2e`, which drives the
  assembled app over mocked HTTP. Four of five `bootstrap-server` findings and
  every `app-server` config finding lived exactly there. When you add a mirror,
  ask what now has no coverage at all, and assert the real artefact directly
  (`apps/server/src/plugins.spec.ts`, `apps/admin/src/plugins.spec.ts`).
- **A plugin dropped from the registry degrades silently.** Cross-plugin ports are
  injected `@Optional()`, so removing a plugin boots clean with no warning and
  merely stops working — removing `ActivityPlugin` logs nothing, `/api/activity`
  404s, and audit rows stop being written. Pin the shipped list.
- **Which plugin's `layout` the admin host mounts.** `createAdmin` takes the
  **first** `layout` it finds, and the shell's is what composes identity's
  `RequireAuth` — so a layout contributed ahead of the shell renders every
  private route **ungated**. It reads as a styling accident and is an
  authorization one. Exactly one plugin contributes a layout today; keep it that
  way, or the host's warning is all that stands between you and a fail-open.

## Admin (React plugins)

- **Stale page after mutation.** After a delete/mutation that shrinks a list,
  clamp the current page to the new `pageCount` — otherwise the user lands on an
  empty page past the end.
- **Error masquerading as empty.** Distinguish a failed query from a genuinely
  empty result. Rendering the empty state on error hides outages.
- **Mapper fallbacks that rewrite data.** A `?? defaultValue` in a response
  mapper can silently invent data (e.g. coercing `null` role to `viewer`).
  Surface missing data; don't paper over it.
- **Over-invalidation.** Invalidate only the affected query keys, not the whole
  cache, on mutation — broad invalidation causes refetch storms and flicker.
- **Permission gating only in the UI.** `useHasPermission` hides affordances for
  UX; it is **not** security. The server guard is the real boundary — never rely
  on the hidden button alone.

## Agent tools (the shared registry — copilot + MCP)

One registry serves two consumers, so **every** review of a new or changed
`ToolDefinition` has to ask who it reaches. See
[`packages/tools/server/AGENTS.md`](../packages/tools/server/AGENTS.md#adding-a-tool-decide-surfaces-deliberately).

- **`surfaces` omitted by accident.** Omitting the field means **both**
  consumers, which is the right default but the wrong accident: a `propose` tool
  that forgets it becomes callable by an MCP client that has no way to accept
  the change, and an admin-scoped read leaks drafts to a `read` token. Treat
  `surfaces` as security-relevant, like `requires`. A tool should carry a
  comment saying why it is narrowed — or why it is not.
- **`surfaces` copy-pasted from the file next door.** The opposite failure, and
  the more common one: a genuinely neutral tool marked `['copilot']` because its
  neighbour is. `i18n_locales_list` and `i18n_translations_get` sit in one file
  and land on opposite surfaces. Ask what the tool would show a **token**
  holding `content:read`, not which consumer asked for it.
- **A permission no token scope mints.** `scopePermissions` yields only
  `content:*` plus `media:read`/`media:create`. A tool requiring `activity:read`
  or `users:read` can never list for a token, so it must say `['copilot']`
  rather than rely on that coincidence — a future scope would silently expose
  it.
- **Bare `Error` in a shared tool's handler.** The copilot reports
  `error.message`; MCP's `toToolError` treats a non-`HttpException` as a bug and
  returns an opaque 500 with the message withheld. Throw `NotFoundException` /
  `BadRequestException` / etc. so the failure is legible on both.
- **Branching on `ToolContext.surface` for anything but presentation.** It may
  choose a URL a caller can actually fetch. It may **not** gate a permission,
  widen a filter, or withhold a field — that is authority, and authority is
  `requires` + `can()`. A tool that wants `if (surface === …)` around a rule is
  two tools.
- **Cross-surface e2e not updated.** `mcp.spec.ts` and
  `copilot-read-catalogue.spec.ts` each assert what their surface is and is not
  shown. A new tool named in neither is a tool nobody is checking.

## Accessibility (every interactive UI)

- Label inputs via the design-system `Field`/`InputField`, not bare ARIA.
- Manage focus on route change, dialog open/close, and after async actions.
- Tables, pagination, dialogs, and menus must be keyboard-operable. Verify with
  the `admin-e2e` a11y/keyboard suites. See the `accessibility` skill.

<!-- Append new patterns as they are found in review or incidents. -->
