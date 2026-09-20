# Workspaces

_Package group · packages/workspaces_

**The tenant boundary: where a person may work — and the reference layered layout**

Workspaces answers the question permissions do not: **where** an employee is allowed to act. A role says “what you may do” (edit content, delete); membership says “in which workspace”. Both checks must pass, and neither substitutes for the other. The plugin owns the workspaces themselves, the member lists and the content-type grants, plus the two guards and the decorator that _every other_ plugin uses to close off its workspace-scoped routes.

- **2** packages in the group
- **14** HTTP routes
- **3** database tables
- **1** migration
- **4** permission keys
- **8** use cases
- **9** domain events
- **4** admin routes

## Contents

- [01. Business description](#01-business-description)
- [02. The package group's composition](#02-the-package-groups-composition)
- [03. The layered layout (ADR-0003)](#03-the-layered-layout-adr-0003)
- [04. Roles and permissions](#04-roles-and-permissions)
- [05. Data model](#05-data-model)
- [06. A workspace's lifecycle](#06-a-workspaces-lifecycle)
- [07. Scenarios — how it works step by step](#07-scenarios-how-it-works-step-by-step)
- [08. HTTP API](#08-http-api)
- [09. The admin UI: routes, screens, states](#09-the-admin-ui-routes-screens-states)
- [10. Configuration and registration order](#10-configuration-and-registration-order)
- [11. Security and resilience](#11-security-and-resilience)
- [12. Invariants](#12-invariants)
- [13. Testing checklist](#13-testing-checklist)
- [14. Boundaries of responsibility](#14-boundaries-of-responsibility)
- [15. Discrepancies between the code and the documentation](#15-discrepancies-between-the-code-and-the-documentation)

## 01. Business description

A workspace is a separate working space inside a single CMS installation: its own content, its own members, its own set of permitted entry types. One company can keep a “Marketing site”, a “Documentation” and a “Product showcase” in one installation without mixing either the data or the people.

### The problem it solves

- **It separates “what you may do” from “where you may do it”.** A person's `content:update` permission is a single system-wide one — it does not say which workspace to use it in. Membership answers precisely that. The design decision: **both checks are mandatory**, and holding a permission never opens the door to someone else's workspace.
- **It does not let anyone enumerate other people's workspaces.** `GET /api/workspaces` returns only those the caller belongs to; an attempt to address someone else's identifier yields **exactly a 403**, indistinguishable from “no such workspace”. The list cannot be used as a tenant directory.
- **It limits which content types a workspace works with.** A grant (`workspace_content`) is an explicit row saying “this workspace is allowed the `article` type”. The Content Library and the public API read exactly that.
- **It provides a reversible “get it out of sight” and an irreversible deletion.** Archiving deletes nothing and is fully reversible; deletion is physical — and therefore hedged with checks, so that no entry is left dangling on a non-existent identifier.
- **It supplies primitives to the other plugins.** `WorkspaceGuard`, the `X-Workspace-Id` header and the `@CurrentWorkspace()` decorator are what content, media, segments and i18n close their routes with. **51** files outside this group use them.

### Who sees it

#### The administrator

Creates workspaces with a three-step wizard, maintains the member list, grants and revokes content-type grants, archives and deletes. The only role holding `workspaces:create/update/delete`.

#### A member (contributor, viewer)

Sees in the switcher and the sidebar exactly the workspaces they belong to. They can go inside and work with content; the settings are read-only for them — there are no edit buttons.

#### Another plugin

Attaches `@UseGuards(WorkspaceGuard)` and reads `@CurrentWorkspace()`. It need know neither the membership table nor the header's name — the contract is exported from the barrel.

### What Workspaces is not

The boundaries explain why the interface lacks things people usually expect from a workspace system:

- **It is not a second permission system.** There are no roles inside a workspace: membership is a _pure link_ “user ↔ workspace”, with no attributes. Permissions come from the user's single global role.
- **A workspace has no owner.** The creator is simply the first member. They are not protected from removal and hold no privileges over the rest. Any member with `workspaces:update` can add or remove any other, themselves included.
- **It is not a content store.** Entries live in `content-server` and files in `media-server`. A workspace merely defines the scope; it can only count entries with someone else's hands, through a port.
- **It is not an activity log.** The plugin raises nine kinds of domain event and puts them into the transactional outbox; the log rows are written by a subscriber from `activity/server`.
- **It is not database-level isolation.** One database, one schema, one connection pool. Isolation is at the application level: a guard plus a `workspace_id` predicate in the queries.
- **It is not quotas or billing.** There is no limit on the number of workspaces, on content volume, and no plans.
- **It is not an invitation system.** The creation wizard can “invite by address”, but that means only one thing: an account with status `pending` and the `viewer` role is created in `users`. No invitation token is issued and no email goes out — the code has a `TODO(invites)` in that spot.

> **The key architectural idea**
>
> Membership is the **only** tenant boundary, and the decision about it is made by **one** function: `authorizeWorkspaceAccess`. Both guards — the header one and the path one — call it, so “having access” cannot mean different things in different places. Everything else (lists, views, grants) is built on top of that single predicate.

## 02. The package group's composition

The `packages/workspaces` group is **two** packages, a server one and an admin one. There is no separate framework-free kernel package here: the domain layer lives inside `server` (unlike `content` or `copilot`, where the kernel is factored out into `domain`), because nobody consumes it outside the plugin — what people consume are the guards and the ports.

| Package | npm name                    | Role                                                                                                    | What it owns                                                                                                                                                                                                                 |
| ------- | --------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| server  | @orthacms/workspaces-server | A NestJS plugin: 13 controllers, 8 use cases, an aggregate, the database schema, migrations, two guards | 3 tables, 14 routes, `WorkspaceGuard` / `WorkspaceMemberGuard` / `@CurrentWorkspace()`, the `CONTENT_CATALOG` / `CONTENT_ENTRY_COUNTER` / `MEMBER_PROVISIONER` / `WorkspacePurger` ports, the purge registry, advisory locks |
| admin   | @orthacms/workspaces-admin  | An admin plugin: the list, the creation wizard, the workspace shell, the settings page                  | `/workspaces`, `/workspaces/new`, `/workspaces/:id/*`, `/workspaces/:id/settings/*`, three slots of its own, `useCurrentWorkspace()`, the `WorkspaceGateway`                                                                 |

### What is exported outwards and who consumes it

| Export                                                       | What it is                                                    | Who uses it                                                                                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WorkspaceGuard                                               | A guard on the `X-Workspace-Id` header                        | content, media, i18n, segments, insights — every workspace-scoped route                                                                                                                                   |
| WORKSPACE_HEADER                                             | The string `'x-workspace-id'`                                 | A plugin writing its own guard (the public content API's bearer guard, for instance), so as not to re-declare the header's name                                                                           |
| WORKSPACE_ID_PATTERN                                         | The UUID regex                                                | The same case — one shape for the identifier                                                                                                                                                              |
| WorkspaceMemberGuard                                         | A guard on the `:id` / `:workspaceId` path parameter          | The plugin's own routes; available to others too                                                                                                                                                          |
| CurrentWorkspace                                             | A parameter decorator handing over the verified id            | Any handler under `WorkspaceGuard`                                                                                                                                                                        |
| MembershipCheckQuery                                         | The membership check itself                                   | The rare route that derives the workspace from the resource rather than from the header — for example serving media bytes, which the browser requests through an `<img src>` and cannot send a header for |
| lockWorkspaceShared / lockWorkspaceExclusive                 | A pair of advisory locks                                      | `content-server` takes the **shared** one when writing an entry; deletion and grant revocation take the **exclusive** one                                                                                 |
| CONTENT_CATALOG / CONTENT_ENTRY_COUNTER                      | Ports **owned by this package** and bound by `content-server` | Dependency inversion: content depends on workspaces for the guards, so workspaces must not depend on content                                                                                              |
| WorkspacePurgeRegistry / WorkspacePurger                     | The registry and the port for cleanup on deletion             | `media-server` registers its own purger from `onModuleInit`                                                                                                                                               |
| the schema (`workspaces`, `memberships`, `workspaceContent`) | The Drizzle tables                                            | Plugins that need an FK to `workspaces.id` (copilot, saved views)                                                                                                                                         |

> **A port pointing the other way**
>
> `WORKSPACE_DIRECTORY` is declared by **identity** and bound by this package (the `WorkspaceExistenceQuery` adapter). The reason is the direction of the dependencies: `workspaces-server` imports `identity-server`, so identity cannot import back. The port exists so that issuing an API token can reject a scope naming a non-existent workspace: `api_token_workspaces` deliberately has no foreign key, and this check is all that stands between a typo and a token issued into the void. What is checked is **existence, not status**: an archived workspace is a legitimate scope.

## 03. The layered layout (ADR-0003)

This package is the **reference implementation** of tactical DDD inside a plugin, the first context moved onto layers; the rest copy their layout from it. The layers live under `src/lib/workspace/` and are mirrored one for one on the server and the admin side.

| Layer           | What it holds                                                                                                                                                                                                                                                                                                                                                                | What it _may not_ do                                                                                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain/         | The `Workspace` aggregate; the `Membership` and `ContentGrant` child entities; the `Slug`, `WorkspaceId`, `WorkspaceColor`, `WorkspaceStatus` value objects; the `WorkspaceRepository` port + the `WORKSPACE_REPOSITORY` symbol; the `SlugUniquenessService` domain service; the event factory; 12 transport-independent errors                                              | **Nothing** from `@nestjs/*`, `drizzle-orm`, `class-validator` or `infrastructure/`. Only the framework-free `createDomainEvent`/`DomainEvent` from `@orthacms/database` and Node's built-in modules are allowed |
| application/    | 8 use cases (one per state change); the `WorkspaceView` view types; DTOs with `class-validator`; the secondary ports (`CONTENT_CATALOG`, `CONTENT_ENTRY_COUNTER`, `MEMBER_PROVISIONER`, `WorkspacePurger`); the catalogue and counter readers; the pure `resolveGrants`; the purge registry                                                                                  | It does not touch Drizzle directly and knows nothing about HTTP. It does know Nest (`@Injectable`) — a deliberate compromise: a use case is a DI node                                                            |
| infrastructure/ | `DrizzleWorkspaceRepository`, `WorkspaceMapper`, `DrizzleMemberProvisioner`, the advisory locks, the unique-violation recogniser; five read models (`WorkspaceViewQuery`, `SlugAvailabilityQuery`, `MemberLookupQuery`, `MembershipCheckQuery`, `WorkspaceExistenceQuery`); the Drizzle schema; the external-references stub; the API-token grant purger; the mock catalogue | The only layer that knows Drizzle and `pg`. It contains no business rules — only their execution                                                                                                                 |
| http/           | 13 thin controllers; the two guards and the shared `authorizeWorkspaceAccess` function; the `@CurrentWorkspace()` decorator                                                                                                                                                                                                                                                  | It contains no logic: a controller calls a use case, catches a domain error and turns it into a status. There is nothing else in it                                                                              |

### The rule that is inviolable

> **ADR-0003's single hard rule**
>
> `domain/` **imports nothing** from `@nestjs/*`, `drizzle-orm`, `class-validator` or `infrastructure/`. The layer-boundary check in `@orthacms/nx` is not wired up yet — the rule is upheld by hand and at review. So that it is not broken in the least obvious place, `SlugUniquenessService` is an ordinary class without `@Injectable`, and the module binds it through a `useFactory` that injects the repository port. That is precisely the seam where Nest could have leaked into the domain, and it is closed explicitly.

### What the aggregate gives

- **A single point of change.** Every state change goes through a `Workspace` method. No use case writes to the child tables directly.
- **Idempotency as a contract.** Every mutator returns a `boolean` — “did anything actually change”. Adding a member again, granting an existing grant again, setting a status that is already set all return `false`, and then neither a row nor an event is written. That is how the log avoids being cluttered with “changes” that never happened.
- **Its own identity.** `WorkspaceId.generate()` mints the UUID in the aggregate rather than reading it from the database's `DEFAULT` — which is exactly why the `workspace.created` event already carries the identifier.
- **A delta instead of a full rewrite.** The aggregate accumulates `changes()` — which profile fields, which status, which members and grants were added or removed — and the repository writes minimal, idempotent SQL: `onConflictDoNothing` on the link inserts.
- **Invariants live here, not in a controller.** “You cannot remove the last member”, “you cannot revoke a grant for a non-empty type”, “you cannot delete a workspace that has entries” are `removeMember`, `revokeContent` and `assertDeletable`. No caller gets around them, because there is no other route to the state.

### The unit of work and the outbox

Every mutating use case is built the same way: `UnitOfWork.run` opens a transaction → the repository loads the aggregate through the port → **one** aggregate method is called → `save` → `outbox.append(attachActor(aggregate.pullEvents(), actor))`. The event commits in the same transaction as the change — atomicity comes from there, not from retries.

Reads (the list, the slug check, the counts, assembling a view) **bypass** the aggregate — they are thin CQRS queries. A read model reads the base connection and therefore sees committed state after the unit of work closes; hence the ordering in the controllers: first `await useCase.execute(...)`, then `views.byId(id)`.

### The same thing on the admin side

#### `domain/`

Pure TypeScript with no React: the `Slug` value object (the same regex and the same length of 120 as on the server), the `Workspace`/`WorkspaceMember` types, the `NAME_MAX`/`DESCRIPTION_MAX` constants, the `isActiveWorkspace` predicate, the resource-selection algebra.

#### `application/`

13 TanStack Query hooks — reads and mutations. Each calls the gateway, **never** `apiClient`. The wizard's submission orchestration is `useCreateWorkspaceFlow`.

#### `infrastructure/`

The `WorkspaceGateway` port and its HTTP implementation — the **only** place `apiClient` is used; the `toWorkspace` mapper as an anti-corruption layer; `isConflict`; assembling the request body.

#### `presentation/`

Pages, components, slots, the current-workspace provider, UI hooks. It sees only view models, never the wire format.

> **Where the layer boundary is deliberately softer**
>
> The strict rule is stated **only about `domain/`**. Above it the layers are permeable, and that is visible in the code: `add-member.use-case.ts` and `remove-member.use-case.ts` import the concrete `MemberLookupQuery` from `infrastructure/queries`, and the controllers inject `WorkspaceViewQuery` and `SlugAvailabilityQuery` directly. No port was created for those reads deliberately: a read model is a projection, not a rule, and wrapping it in an interface would mean paying in abstraction for something nobody intends to substitute. Reading the package as a reference, it is important not to mistake this softness for inversion — **only writes and what leaves the context are inverted**.

## 04. Roles and permissions

The plugin has **four** permission keys — one per CRUD operation. The keys are declared in `identity-server` (`PERMISSIONS.WORKSPACES_*`) and this package only references them: there is not a single string literal in a decorator.

| Permission        | What it opens                                                                                                                 | admin | contributor | viewer |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----- | ----------- | ------ |
| workspaces:create | create a workspace; check slug availability; see the content-type catalogue                                                   | ✓     | —           | —      |
| workspaces:read   | get the list of one's own workspaces                                                                                          | ✓     | ✓           | ✓      |
| workspaces:update | edit the profile; archive and unarchive; the member list; grant and revoke a grant; per-type entry counts; the type catalogue | ✓     | —           | —      |
| workspaces:delete | delete a workspace; the workspace's total entry count                                                                         | ✓     | —           | —      |

### Two independent dimensions, and both are mandatory

This is the plugin's central idea, and it is easy to lose while reading a single controller:

#### Permission — _what_

`PermissionsGuard` + `@RequirePermissions(...)`. Global to the role, with no relation to a particular workspace. An administrator with `workspaces:update` holds that permission **everywhere**.

#### Membership — _where_

`WorkspaceMemberGuard` (or `WorkspaceGuard`). It checks for a row in `memberships`. An administrator who is not a member of the workspace gets a **403** — the permission does not carry them across the tenant boundary.

From which follows something non-obvious: **a global administrator is not omnipotent inside someone else's workspace.** They can create a new one, but cannot edit one they were not added to. This is a deliberate choice: “the privilege of reading everything” would be a separate feature, and the system does not have one.

### How a permission reaches the code

- **The order of guards in the decorator is meaningful:** `@UseGuards(OriginGuard, PermissionsGuard, WorkspaceMemberGuard)`. The first closes CSRF, the second is “what”, the third is “where”. All three must pass.
- **Authentication is already behind us.** identity's global `AuthGuard` is registered as an `APP_GUARD`, so inside `authorizeWorkspaceAccess` a missing `request.user` means a **wiring bug** (a route marked `@Public()` by oversight), not an anonymous visitor — and the function throws a `401`.
- **The type catalogue is gated on “either of two”.** `GET /api/content-types` is needed both by the creation wizard (`workspaces:create`) and by the content tab in the settings (`workspaces:update`). Different audiences hold those permissions, so `@RequireAnyPermission(...)` is used: a single permission would have returned a `403` to whichever half it did not name.
- **The slug check is gated on the create permission.** Authentication alone was not enough: the endpoint answers “does such a slug exist” to anyone, and that is a tenant directory enumerable one guess at a time. Now the answer is available to exactly those who need it for something.
- **The preview counters are gated on the same permission as the action they guard.** The per-type count is `workspaces:update` (as is revoking a grant), and the workspace-wide count is `workspaces:delete` (as is deletion). Otherwise a counter would become a way to learn the size of someone else's content with a weaker permission.
- **In the admin UI:** `useHasPermission('workspaces:update')` and `('workspaces:delete')` hide the controls. That is interface honesty, not protection: the real check is always on the server.

## 05. Data model

The plugin owns **three** tables and carries **one** migration (`0000_init.sql`, journal `__drizzle_migrations_workspaces`). It opens no database connection — the client is injected from `@orthacms/database`. Generating migrations (`nx run workspaces-server:db:generate`) does not connect to the database at all.

| Table             | Purpose                          | Key fields and constraints                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| workspaces        | The workspace itself             | `id` uuid PK · `name` · `slug` **unique** (`workspaces_slug_unique`) · `description` **nullable** · `color` text, defaulting to `slate` · `status` enum `workspace_status` = active \| archived, defaulting to `active` · `created_at` · `updated_at` with `$onUpdate`.<br>The colour is stored as plain text rather than an enum: the palette belongs to the design system, and the server cannot depend on an admin package; validity is checked by the `WorkspaceColor` value object (7 keys). |
| memberships       | The user ↔ workspace link (M:N) | `id` uuid PK · `user_id` → `users(id)` **on cascade** · `workspace_id` → `workspaces(id)` **on cascade** · `created_at`.<br>**There is no role here and never will be** — this is a pure link. Uniqueness on `(user_id, workspace_id)` and a separate index on `workspace_id`: the unique index's left prefix already covers “a user's workspaces”, but not “a workspace's members”.                                                                                                              |
| workspace_content | A content-type grant (M:N)       | `id` uuid PK · `workspace_id` on cascade · `kind` enum `content_kind` = collection \| single · `slug` text · `created_at`.<br>Uniqueness on `(workspace_id, kind, slug)` + an index on `workspace_id`. The collections and pages themselves **live in code**, not in the database; a row means only an explicit grant. “All content” is expanded into a separate row per known slug on write, so the presence of a row **always** means an explicit grant.                                        |

### The external reference to identity

`memberships.user_id` carries a cross-context foreign key to `users(id)`. So that `drizzle-kit generate` assembles a **pure-Drizzle** graph, the schema references `users` through a **reference-only stub** — `infrastructure/schema/external-refs.ts`, with a single `id` column. The reason is technical and hard: importing identity's runtime barrel would drag its NestJS providers into drizzle-kit's esbuild pass, which has no `experimentalDecorators`, and generation would fail on the parameter decorators. The stub is **not re-exported** from `schema/index.ts`, so drizzle-kit references it only in the FK and does not emit a second `CREATE TABLE users`. At runtime the queries go against identity's real table; both objects resolve to one physical table.

### Workspace rows in other plugins

The workspace identifier is scattered all over the database, and the cleanup method depends on _what a row is_, not on where it lives:

| Mechanism         | Tables                                                                                                                             | Why this way                                                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cascade**       | `memberships`, `workspace_content`, `copilot_conversations`, `copilot_proposals`, `copilot_skills`, `saved_views`                  | They already have a foreign key — the database does the cleanup                                                                                                                                         |
| **Refusal (409)** | every `content_*` table                                                                                                            | Entries are **authored work**. A user deletes their own content deliberately; the system does not do it for them, so `assertDeletable` blocks deletion while anything is left                           |
| **Purge**         | `media_asset`, `media_folder`, `api_token_workspaces`, `alarm_rules` + `alarm_findings`, `entry_access`, `content_entry_revisions` | Pure **scopes** with no meaning of their own: a folder tree, a token's “basket”, a rule about content that no longer exists. They deliberately have no FK — a cross-plugin key would couple the schemas |

> **The remainder — closed 2026-08-30, except one**
>
> This section used to say that four groups of rows survived a delete pointing nowhere, and it was right: at the time only `media/server` and the local `ApiTokenGrantsPurger` implemented `WorkspacePurger`, two purgers for six tables that needed one. Reproduced on a live stack — the workspace, its memberships and its grants went, and the alarm rule stayed.
>
> Three purgers now close it: `alarms:rules-and-findings`, `segments:entry-access` and `content:entry-revisions`. That last table was **missing from this list**: `content_entry_revisions` escapes the refusal from the other side, because `countWorkspaceEntries` sums the live entry tables only — a workspace whose entries were all deleted counts as empty, deletes cleanly, and stranded its whole version history.
>
> **`segments.workspace_ids` is deliberately left dangling**, and listing it here as an oversight was this dossier's own mistake. It is an array, so it can carry no FK, and its column docblock records the reasoning: an id matching nothing _narrows_ the audience, while an empty array means _every_ workspace — so pruning it would walk the audience toward “offered everywhere”. Fail-safe beats tidy for a visibility rule, and a unit test now pins that choice so a later clean-up cannot reverse it in silence.

## 06. A workspace's lifecycle

POST /workspaces → **active** ⇄ archive / unarchive ⇄ **archived** — DELETE, only if empty → **deleted**

There are exactly two states; the third is the absence of a row. The transition to deleted is possible from **either** of the two: archiving is neither a precondition for deletion nor a substitute for it.

| State    | What it means                                                                                                                | Who sees it                                                                                                                                                                                                                       | What is forbidden                                                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| active   | The working state. A new workspace is always born here                                                                       | Members — everywhere: the list, the switcher, the sidebar, the command palette, the home-page tiles                                                                                                                               | Nothing                                                                                                                                                            |
| archived | “Out of sight”. Fully reversible, nothing is deleted                                                                         | Members — in the table under the “All” or “Archived” filter and in the switcher. **Hidden** from the sidebar's quick list, from the command palette and from the home page's panel; it does not count towards “active workspaces” | **Nothing.** The status is checked nowhere on the server: writing and reading content, uploading files, issuing a token scoped to this workspace all work as usual |
| deleted  | The row is gone. Memberships, grants, copilot conversations and saved views left by cascade; media and token scopes by purge | Nobody                                                                                                                                                                                                                            | Irreversible. There is no restore                                                                                                                                  |

> **Archiving is an interface state, not an access mode**
>
> Verified against the code: `SetWorkspaceStatusUseCase` only flips the field, and **no** guard and no content or media controller looks at `workspaces.status`. An archived workspace remains fully functional over the API — it merely leaves the admin UI's showcases. If the expectation was “archived = read-only”, that has to be implemented separately; today it is not so.

### The aggregate's transitions

- `Workspace.create(...)` — mints the id, adds the creator as the first member (`dedupe` preserves first-occurrence order), expands the grants, raises `workspace.created`.
- `setStatus(...)` — idempotent: setting an already-set status returns `false` and nothing goes into the outbox. Raises `workspace.archived` or `workspace.unarchived`.
- `updateProfile(patch)` — an empty patch returns `false`; otherwise `workspace.updated` with the **list of changed fields** in the payload.
- `assertDeletable(entryCount)` — does not delete but _permits_: on a non-zero count it throws `WorkspaceNotEmptyError`, otherwise it raises `workspace.deleted` with the name and slug. The deletion itself is the repository's business.

### The nine domain events

The string values match the activity-log record kinds, so moving the audit log from an “inline” call to the outbox required no data migration: `workspace.created`, `.updated`, `.archived`, `.unarchived`, `.deleted`, `.member_added`, `.member_removed`, `.content_granted`, `.content_revoked`. All carry `aggregateType: 'workspace'` and the workspace's identifier; the actor is attached in the use case through `attachActor`.

## 07. Scenarios — how it works step by step

### 7.1 Creating a workspace

A three-step wizard in the admin UI and one `POST` at the end. The wizard is a **full-page view**, not a dialog: three steps with state that survives the transitions live badly in a modal.

1. **Arriving at `/workspaces/new`.** The first thing the page does is check `useHasPermission('workspaces:create')`. Without the permission it is a `<Navigate replace>` back to the list with the router state `{ redirectNotice: 'create-denied' }`.
   _the route is declared inside the private layout, so the permission already reflects real grants rather than “not loaded yet”_
2. **Step 1, “Basics”.** Name, slug, description, accent colour. The slug is autofilled from the name (`slugify`) until the user edits it by hand; after an edit the autofill switches off (`slugEdited`), but there is a “regenerate” button.
3. **The live slug check.** Typing is debounced by 300 ms, then `GET /api/workspaces/slug-available?slug=` runs. There are **six** states: `Empty`, `Invalid` (the format did not pass `Slug.isValid`), `Checking`, `Available`, `Taken`, `Unknown`.
   _the “next” button unlocks only on Available_
4. **A failed check is not “available”.** On a request error `query.data` is `undefined`, and without an explicit branch the hook's last line would have reported the failure as a positive answer. Hence `SlugStatus.Unknown`: otherwise a person would walk through three steps only to get a `409` at the end.
5. **Step 2, “Members”.** A typeahead over the directory (`GET /api/users?search=`, debounced by 250 ms, with disabled accounts filtered out) plus the option to type an address that is not in the directory. A member has no role — no role control exists in the interface. The creator is implied and is not in the list.
6. **Step 3, “Content”.** Two separate selections — collections and pages — each in `specific` mode (an explicit list) or `all` (everything but the exclusions). The top-level “all content” decision collapses both.
7. **The state lives in `useWizard`, not in the step components.** A step unmounts on a transition; if the fields owned the state, going back would lose the input. The active step is mirrored in `?step=` and clamped to 1..3.
8. **Submission.** `useCreateWorkspaceFlow`: first `Slug.create(...)` as the form's last check, then assembling the body, then the mutation with an **optimistic insert** of the card at the top of the list (with a random `optimistic_*` id, so that two same-named creations do not collide on React keys).
9. **The server: one `UnitOfWork.run`.** `Slug.create` and `WorkspaceColor.create` outside the transaction (that is pure validation) → `SlugUniquenessService.assertAvailable` → resolving the members through the port → `resolveGrants` expands the selection into explicit `(kind, slug)` pairs → `Workspace.create` → `save` → the event into the outbox.
10. **Slug uniqueness is decided by the index, not by the pre-check.** A pre-check is racy by construction: two requests read “available” and both proceed. So the insert is wrapped, and a `unique_violation` on `workspaces_slug_unique` is turned back into a `SlugTakenError` → `409`. The recogniser **walks the `cause` chain**, because Drizzle wraps the driver's error and the nesting depth is a driver implementation detail.
    _without this, the loser of an ordinary race would get a 500 instead of a 409_
11. **Member resolution is bulk, not one at a time.** One query for all the invited addresses, one for the `viewer` role, one multi-row insert. It used to walk the array sequentially, up to three round trips per person, **inside the write transaction** — that is, the caller set the transaction's length.
12. **Addresses are normalised and ghost ids are dropped.** Invitees are matched by `lower(trim(email))`, so `Grace@…` and `GRACE@…` are one account. A non-invitee id that does not resolve to a real user is **silently discarded**, so that a stale identifier does not bring the whole creation down with a foreign-key violation.
13. **The response is a workspace view.** After the use case, the controller separately reads `views.byId(id)`. That call is safe **not because a guard stands there** (there is no `WorkspaceMemberGuard` on creation) but because the id was just minted by the use case itself and was not supplied by the caller.
14. **The admin UI reports the outcome in different ways.** Success is a toast and a move to the list. An error is split into three cases: an invalid slug format, a `409` “taken” (advice to “try again” would be outright harmful here — a retry cannot succeed), and everything else.

> **Why the creation body caps the member array**
>
> `@ArrayMaxSize(MAX_MEMBERS_PER_CREATE)` = 200. The limit is historical and retained: even after the move to bulk resolution, provisioning still happens inside the creation transaction, and an unbounded array would let any holder of `workspaces:create` keep a connection busy for as long as they liked. Two hundred is generous for reality (a workspace is seeded with a team, not with a mailing list) and far below the point where circumventing it becomes self-harm.

> **Why an invitee's email is validated as a real address**
>
> `@IsEmail()` rather than merely “not empty”: an invited member **is created as an account** keyed by that value — that is, anything that gets through here becomes a permanent directory row. A value of nothing but spaces normalised to `''`, created a single account with an empty address, and every subsequent empty invitation reused it — silently linking unrelated workspaces through one ghost user.

### 7.2 The access check: `WorkspaceGuard` and the `X-Workspace-Id` header

This is the primitive the package is exported outwards for in the first place. It works like this:

1. **The global `AuthGuard` has already run** and either put `request.user` on the request or answered `401`.
2. **The guard reads the header.** The value may arrive as an array (a duplicated header) — the first element is taken, not a concatenation.
3. **The shared `authorizeWorkspaceAccess` function decides everything else.** No user → `401` (that is a wiring bug). A missing or non-UUID identifier → `400` with a message specific to the source (“header” or “path”). Not a member → `403`.
4. **The refusal is flat.** “Not a member” and “no such workspace” return **the same** `403` with the same text. Distinguishable answers would turn any protected route into an identifier enumerator.
5. **Success stamps the request.** `request.workspaceId = workspaceId` — an already-verified value.
6. **The handler reads it through `@CurrentWorkspace()`.** The decorator **throws a `500`** if the field is missing rather than returning `undefined`. The reason is direct: an `undefined` scope would turn a scoped query into an unscoped one — that is, silently lift tenant isolation. Better an explicit wiring error.

`WorkspaceMemberGuard` is the same mechanism, differing in **exactly one line**: the identifier comes from `params.id ?? params.workspaceId` rather than from the header. Both call one function, so the meaning of “has access” cannot diverge between them.

> **Who sends the header from the admin UI, and how**
>
> `CurrentWorkspaceProvider` calls `setActiveWorkspaceId(workspace.id)` **during render**, not in an effect: the parent renders before its children, so the header is set before the first request from a child hook; the parent's effect would run _after_ the children's and would leave the first request without a scope. The second call is in a `useEffect` on a change of `workspace.id`. There is **deliberately no cleanup** on unmount: clearing it would race with background refetches (a window-focus refetch after moving to the list, for instance), which would then go out without the header and get a `400`. A lingering identifier is harmless — the header is only taken into account by workspace-scoped routes, and those always live inside the shell that resets it on entry. This also sidesteps the “setup → cleanup → setup” window in StrictMode.

### 7.3 The workspace list

1. `GET /api/workspaces` with the `workspaces:read` permission.
2. **The query itself contains the boundary.** `listForMember(actor.id)` is an `INNER JOIN memberships`. There is **no** unscoped `listAll()` in the read model at all, and that is deliberate: its absence means “forgetting to filter” is impossible.
3. **No deduplication is needed:** uniqueness on `(user_id, workspace_id)` makes the join “at most one row per workspace”.
4. **Assembling the view is two queries, not N+1.** The members and grants for the whole set of identifiers are pulled in by two `IN` queries in parallel (`Promise.all`) and laid out into `Map`s.
5. **Member order is deterministic** — by `created_at`, then by `id`. That is purely presentational: a member has no role, and being “first” means nothing.
6. **One showcase for everything.** This response draws the table, the switcher, the sidebar's quick list, the command palette, the tiles and the home page's panel. Scoping it here scoped all of them at once.

> **A dangerous neighbour: WorkspaceViewQuery.byId**
>
> The read model's second method **applies no scope**: it will return the full member list (ids, names, addresses) and every grant for any identifier passed in. A caller that passes someone else's id there without first checking membership discloses another tenant's workspace in full — there is no second line of defence. Today all five mutating controllers that call it sit behind `WorkspaceMemberGuard`, and the sixth — creation — is safe for a different reason (the id was just minted). Different callers have different reasons — which is precisely why the method's JSDoc names them one by one: the next caller must work out which case they fall into.

### 7.4 The member list

1. **Adding.** `POST /api/workspaces/:id/members` with `{ userId }`. Inside the transaction: load the aggregate → `MemberLookupQuery.findById` (an unknown user → `404`) → `workspace.addMember(userId)`.
2. **Adding again is not an error.** The aggregate returns `false`, the use case exits, and there is neither a row nor an event. The repository's insert carries `onConflictDoNothing` anyway — in case of a concurrent duplicate.
3. **The member's address is mixed into the event in the use case, not in the aggregate.** An email is not a workspace's concern and the aggregate does not carry one. But the log needs it, so the `member_added` event is completed with a snapshot of the address before going into the outbox.
4. **The audit entry is recorded against the _added_ person, not against the actor** — so that the event surfaces in the history of the person whose access changed.
5. **Removing.** `DELETE /api/workspaces/:id/members/:userId` → `204`. Removing a non-member and addressing a non-existent workspace are a **silent no-op**, also a `204`: the outcome “that person is not here” has already been achieved.
6. **The last member cannot be removed.** `removeMember` throws `LastMemberError` → `409`. The reason is not politeness: access is bounded by membership, so a workspace with no members is unreachable **by everyone, the global administrator included**, and there is no road back to it. The rule sits on the aggregate, so no path can get around it.
7. **Removing yourself is allowed** — if you are not the last one. That is simply ending your own access; the creator holds no special status.

### 7.5 Content-type grants

1. **The catalogue.** `GET /api/content-types` returns everything a grant can be issued for. The source of truth is the registry in `content-server`, reached through the `CONTENT_CATALOG` port; if the content plugin is not registered, a built-in mock of eight types is read, so that the workspace-creation flow works standalone.
2. **Granting.** `POST /api/workspaces/:id/content` with nothing but `{ slug }`. The kind (`collection`/`single`) is derived by the server from the catalogue — the client does not send it and cannot forge it. An unknown slug → `UnknownContentTypeError` → `400`.
3. **Granting is idempotent** and takes no lock: adding a grant orphans nothing.
4. **Revoking is an operation with a precondition.** `DELETE /api/workspaces/:id/content/:slug`. The aggregate is loaded through `findByIdForContentMutation`, that is, **under the workspace's exclusive advisory lock**.
5. **The “is the counter bound at all?” check comes before counting.** If `CONTENT_ENTRY_COUNTER` is not bound, `isBound` is false and the use case throws `EntryCountUnavailableError` → `503`.
6. **A non-zero count → `ContentTypeNotEmptyError` → `409`.** Revoking a grant for a type that has entries would leave the entries in the database but out of the workspace's reach.
7. **Revoking a grant that was never issued is a no-op.** The aggregate returns `false`, no event is raised, and the controller returns the current view.

> **Refusing “blind” rather than silently permitting**
>
> A missing bound counter reads as `0`. For **reading** preview endpoints that is acceptable; for destructive ones it is not: this is exactly the case where the protection is blind, and treating blindness as “empty” means letting through precisely what the protection exists for. The reasoning “no plugin, therefore no entries” is wrong: the `content_*` tables are created by migrations and survive any particular plugin list at startup. The error's comment records a measured case: a workspace with five rows returned `{"count":0}`, deleted with a `204` and orphaned all five. So destructive paths **fail closed**, while the reading counters keep answering.

### 7.6 Archiving and unarchiving

1. `POST /api/workspaces/:id/archive` and `.../unarchive` — two handlers in one controller, both reducing to `apply(actor, id, status)`.
2. **Both require `workspaces:update`, not `workspaces:delete`**: archiving is a soft, fully reversible change of state, and gating it on the delete permission would equate “out of sight” with destruction.
3. **Both are idempotent.** Archiving an already-archived workspace returns the current view and writes no event.
4. **In the admin UI the asymmetry is deliberate:** archiving asks for confirmation (a `ConfirmDialog`), unarchiving applies at once — it is low-risk.

### 7.7 Deleting a workspace — the busiest scenario

1. **The preview in the dialog.** Opening `DeleteWorkspaceDialog` fires `GET /api/workspaces/:id/entry-count` with `staleTime: 0` and `gcTime: 0` — the result is not cached between openings, so that an entry deleted a moment ago is reflected.
2. **The dialog blocks the button rather than catching an error.** The shared `BlockingConfirmDialog` enables the destructive button **only** when `count === 0`. The check is in flight → a spinner; the check failed → blocked, with “try again”; a count above zero → a warning with the number. The point: a person learns _why_ in advance rather than after clicking.
3. **A failed check also blocks.** We could not find out, so we do not permit: the same fail-closed logic as on the server.
4. **The server: the transaction opens and the aggregate is loaded under the exclusive lock.** `pg_advisory_xact_lock(0x574b, hashtext(workspaceId))` — transactional, released by itself on commit or rollback.
5. **The counter-binding check** (a `503` otherwise), then `countWorkspaceEntries`, then `assertDeletable(entryCount)` → a `409` when non-zero.
6. **The purge runs _before_ the workspace row is deleted.** That way a purger can still read it if it needs to, and an exception it throws rolls back the **whole** delete — “half a workspace deleted” is exactly the orphaning the mechanism exists to prevent.
7. **The purgers run sequentially, not in parallel.** They share one transaction, and a `UnitOfWork` transaction is one connection, which cannot interleave the statements of parallel callers.
8. **The purgers' order is the registration order, and it must not be relied on.** They remove rows in _different_ plugins, between which there are no foreign keys; if a dependency did appear, the cure would be a key inside a plugin, not a sequence here.
9. **A duplicate purger name is an exception at registration.** Two registrations of the same one would double the report and run the deferred cleanup twice, so the registry fails loudly rather than resolving it silently.
10. **The row is deleted, the event goes into the outbox, and it commits.** The rest leaves by cascade at the database level.
11. **The non-transactional part comes after the commit.** Bytes in object storage do not participate in a transaction, so a purger returns not a result but a **thunk**, `reclaim`, which the use case runs _after_ the commit. A rolled-back delete must not destroy the bytes of a row that still exists.
12. **A `reclaim` failure is logged and swallowed.** The rows are already deleted and committed; throwing here would report the failure of a deletion that succeeded and would give the caller nothing worth retrying. What remains is unaccounted-for rubbish in storage — a housekeeping matter, not a correctness one, and the log line is what that housekeeping will be built from.
13. **The admin UI does not wait for invalidation.** `useDeleteWorkspace` _deliberately does not return_ the `invalidateQueries` promise from `onSuccess`: waiting would delay `mutateAsync` until the list reloaded without this workspace, and the shell would have time to flash a “no access” state before the caller could `navigate('/workspaces')`.
14. **A `409` on the client is a safety catch, not the main path.** It is shown as a `toast.warning` (separately from `toast.error`) and means only one thing: content appeared between the check and the confirmation.

> **The “counted then wrote” race, and why the lock is the way it is**
>
> Checking “is it empty?” and then changing something are two operations, and an entry creation can slip in between. An ordinary row lock does not help here: the entries lie in **other people's** tables, and what must be locked is not a row but the _notion_ of “this workspace's content”. So a transactional advisory lock is taken, with a fixed class of `0x574b` (so that hashed keys do not collide with any other advisory lock in the application) and “many readers, one destroyer” semantics: **creating an entry takes the shared** lock (creations do not block each other and concurrent writing is preserved), while **deletion and revocation take the exclusive one**, waiting out every unfinished creation and blocking new ones for the duration of the check and the mutation.

### 7.8 Checking a workspace's existence for an API token's scope

1. **Identity issues a token** with a non-empty `workspaceIds` list and calls its `WORKSPACE_DIRECTORY` port.
2. **This package is the port's adapter** — `WorkspaceExistenceQuery.existing(ids)`: **one** `IN` query for the whole set, never one per identifier (a token's scope can hold a hundred).
3. **Existence is checked, not status.** An archived workspace is a legitimate token scope; only an identifier naming nothing is rejected.
4. **The port is optional.** If the workspaces plugin is not in the build, identity skips the check rather than failing.
5. **The flip side of the same thing — on deletion.** `ApiTokenGrantsPurger` clears out the deleted workspace's `api_token_workspaces` rows. It lives **here** rather than in identity precisely because the dependency points this way: identity cannot depend back. The token itself is **not revoked** — a token scoped to three workspaces keeps working in the remaining two, and a token left with no scopes simply reaches nothing. Revocation would be a policy decision, and a purger has no authority to make one.

### 7.9 Auditing

Auditing goes **entirely through the outbox**. The inline `ACTIVITY_RECORDER` calls the old documentation section described are no longer in the sources — a search finds only a comment. Every use case appends `aggregate.pullEvents()` in the same transaction as the change; the only consumer is `audit-event.subscriber.ts` in `activity/server`. Atomicity comes from the outbox write sharing the mutation's transaction; **calling the recorder in addition is forbidden** — that would produce a double record.

## 08. HTTP API

Every path carries the global `/api` prefix the host sets. Access legend: `session` — a valid session is required, `permission` — a session and the named permission, `member` — membership of workspace `:id` is additionally required. The plugin has **no public routes at all**.

| Method and path                               | Access and guards                        | Input                                                            | Success                                                                                  | Failures                                                                                                                                                            |
| --------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST /workspaces                              | `workspaces:create` Origin               | `{ name, slug, description, color, members[], content }`         | `201` + a `WorkspaceView`                                                                | `409` slug taken; `400` slug format, a colour outside the palette, more than 200 members, an invalid email; `403` no permission or a foreign Origin; `401`          |
| GET /workspaces                               | `workspaces:read`                        | —                                                                | `200` an array of `WorkspaceView`, one's own only; an empty array is a legitimate answer | `401`; `403`                                                                                                                                                        |
| GET /workspaces/slug-available                | `workspaces:create`                      | `?slug=` (1–120 characters)                                      | `200 { available: boolean }`                                                             | `400` an empty or over-long slug; `403` for contributors and viewers                                                                                                |
| PATCH /workspaces/:id                         | `workspaces:update` `member` Origin      | `{ name?, description?, color? }` — **the slug is not editable** | `200` + the updated view                                                                 | `404` no such workspace; `400` a colour outside the palette, an empty name, more than 120 / 2000 characters, an `:id` that is not a UUID; `403` not a member; `401` |
| POST /workspaces/:id/archive                  | `workspaces:update` `member` Origin      | —                                                                | `201` + a view with `status: archived`                                                   | `404`; `400` not a UUID; `403`. A repeat is a success with no event                                                                                                 |
| POST /workspaces/:id/unarchive                | `workspaces:update` `member` Origin      | —                                                                | `201` + a view with `status: active`                                                     | the same                                                                                                                                                            |
| DELETE /workspaces/:id                        | `workspaces:delete` `member` Origin      | —                                                                | `204`                                                                                    | `404`; `409` content entries remain; `503` the counter is not bound; `400` not a UUID; `403`                                                                        |
| POST /workspaces/:id/members                  | `workspaces:update` `member` Origin      | `{ userId }` (uuid)                                              | `201` + a view                                                                           | `404` no such workspace **or** no such user; `400` not a UUID; `403`. A repeat is a success and changes nothing                                                     |
| DELETE /workspaces/:id/members/:userId        | `workspaces:update` `member` Origin      | two uuids in the path                                            | `204`                                                                                    | `409` this is the last member; `400` not a UUID; `403`. A non-member and a non-existent workspace are also a `204`                                                  |
| POST /workspaces/:id/content                  | `workspaces:update` `member` Origin      | `{ slug }` (1–120 characters)                                    | `201` + a view with an updated `content[]`                                               | `400` unknown content type; `404` no such workspace; `403`. A repeat is a success with no event                                                                     |
| DELETE /workspaces/:id/content/:slug          | `workspaces:update` `member` Origin      | the slug in the path                                             | `200` + a view                                                                           | `409` the type still has entries; `503` the counter is not bound; `404`; `403`. Revoking a grant that was never issued is a successful no-op                        |
| GET /workspaces/:id/content/:slug/entry-count | `workspaces:update` `member`             | the slug in the path                                             | `200 { count }`; `0` if the content plugin is not bound                                  | `400` not a UUID; `403`; `401`. **Origin is not checked** — this is a read                                                                                          |
| GET /workspaces/:id/entry-count               | `workspaces:delete` `member`             | —                                                                | `200 { count }` across every type at once                                                | `400`; `403`; `401`                                                                                                                                                 |
| GET /content-types                            | `workspaces:create or workspaces:update` | —                                                                | `200` an array of `{ name, kind, label?, description?, path? }`                          | `403` when neither permission is held; `401`                                                                                                                        |

Every DTO passes through the host's global `ValidationPipe` with `whitelist` and `forbidNonWhitelisted`: an undeclared field in the body is a `400` before the controller. Every `:id` passes through `ParseUUIDPipe`; the guard independently checks the same format, so a malformed identifier is cut off twice and never reaches a database query. A running server serves the generated OpenAPI at `/reference`.

<details>
<summary>Why some POST routes return 201 rather than 200</summary>

In NestJS `@Post` answers `201 Created` by default, and on `archive`, `unarchive`, `members` and `content` that default is left as it is — `@HttpCode` is overridden only where the response is empty (a `204` on deletions). Semantically “archive” is not a creation, but changing the status for the sake of vocabulary purity would break already-written clients for cosmetics.

</details>

## 09. The admin UI: routes, screens, states

The plugin registers **after** `ShellPlugin()`, because it nests its routes inside the shell's closed layout and its items inside the shell's slots. Every page is lazily loaded (`React.lazy` + a `Suspense` with a skeleton).

| Route                       | Screen                  | What it does                                                                                                                                                        |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| /workspaces                 | `WorkspacesPage`        | The workspace table: search by name and description, status filter chips (All / Active / Archived) with counts, and a create button behind the permission           |
| /workspaces/new             | `CreateWorkspacePage`   | The full-page three-step wizard; gated on `workspaces:create` with an explanatory redirect                                                                          |
| /workspaces/:id/\*          | `WorkspaceShell`        | The workspace shell: resolves `:id`, publishes the context, **injects its own navigation into the application's sidebar**, and builds the nested routes from a slot |
| /workspaces/:id/settings/\* | `WorkspaceSettingsPage` | The General · Members · Content · Danger zone tabs, each a nested route; the index redirects to `general`                                                           |

The `/workspaces/new` route is statically more specific than `/workspaces/:id/*`, so React Router ranks it higher regardless of declaration order — a workspace with the identifier `new` cannot hijack the page.

### The list's states — four of them, and they cannot be collapsed

#### Loading

A `WorkspacesTableSkeleton` — the shape of the table to come, not a spinner.

#### Error

A separate `Alert role="alert"` with a “retry” button. **Never** the words “create your first workspace”: that would convince an operator that the account really has none.

#### Genuinely empty

The server's list is empty → “no workspaces yet” and a create button, if the permission is there.

#### Empty because of a filter

There are workspaces but the current view hid them → “nothing found” and “clear filters”. Clearing goes to **“All”** rather than the default “Active” — otherwise, in the “everything is archived” case, the clear button would be a dud and leave the table empty.

### The workspace shell and the “no access” state

- **Resolution happens against the list, not through a separate request.** The list is already bounded by membership on the server, so an **unresolved `:id` simply is** the “no access” case — never mind whether it is someone else's workspace or a non-existent one.
- **The interface does not distinguish between them** — it mirrors the API's flat `403`. The screen: `role="alert"`, “You do not have access to this workspace” and a “Back to workspaces” link; and no navigation is injected into the sidebar at all.
- **A failure to load the list is a separate screen**, not “no access”: the cause is different and so is the advice.
- **The navigation is injected through `useSidebarContent`,** which stores a _rendered element_ rather than a render function. That is why the dependencies list **every field the navigation renders** — id, name, colour, status, member count. Keying on the id alone meant that renaming, a colour change or archiving left the switcher (its `aria-label` included) showing the old values for the rest of the session, while the settings page right next to it showed the new ones.
- **Landing on the base path** redirects to the route with the lowest `order` — the Content Library. An unknown subpath leads there too.
- **The height is `h-full`, not `min-h-svh`:** the inset is already bounded by the viewport, and a second independent `svh` computation can diverge from the first by a pixel (noticeable at a browser zoom other than 100%) and give the inset a phantom scrollbar next to its own.

### The settings page

| Tab         | What is inside                                                                                                                                                                                                                                                                                                                  | Gate                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| General     | Name, description, accent colour (a `ColorSwatchRow`, shared with the wizard). The slug is shown **read-only** — it is immutable. Separately, a **copyable workspace identifier** (`WorkspaceIdField`): this is what the public API's `X-Workspace-Id` header takes, and otherwise it could only be read out of the address bar | `workspaces:update`                                                                                                      |
| Members     | A typeahead over the directory (only **existing** accounts — the add endpoint links a real id and there are no invitations by address here) and a roster where a member is removed through a `ConfirmDialog`                                                                                                                    | `workspaces:update`                                                                                                      |
| Content     | Grants in two titled groups — “Collections” and “Pages”. Granting is **a separate multi-select search per kind** (two `AddContentDialog` instances), each showing only the ungranted types of its kind. Revoking goes through a `RemoveContentDialog` with a pre-check                                                          | `workspaces:update`                                                                                                      |
| Danger zone | Archiving and unarchiving plus irreversible deletion through a `DeleteWorkspaceDialog` with a pre-check                                                                                                                                                                                                                         | The tab is visible with `workspaces:update` **or** `workspaces:delete`; inside, each half is gated on its own permission |

> **The gate stands on both the tab and the route**
>
> Danger zone is excluded from the tab bar **and** its nested route redirects to `general` when the permission is missing. Hiding the tab alone would not be enough: a direct link would go around it. The redirect carries a `state.redirectNotice`, and `useRedirectNotice` at the landing site does three things — it moves focus to `<main>` (already focusable for the skip link's sake), returns the message key **once** for rendering in a `role="status"`, and erases the router state so that a reload or a “back” does not replay the announcement. Without that, a `<Navigate replace>` is the SPA equivalent of a silent redirect: focus falls onto `<body>`, the next Tab starts from the very top of the document, and a screen-reader user hears silence.

### Data and caching

- **One key for everything:** `workspacesKey = ['workspaces']`. All seven mutations invalidate it — the shell reads the open workspace from that same list and therefore re-resolves itself.
- **Creation is optimistic:** the card is inserted at the top of the list at once, with a rollback on error and a reconciliation with the server in `onSettled`. The optimistic card's grants are empty — the server expands them.
- **The counters are fundamentally uncacheable:** `staleTime: 0`, `gcTime: 0`, and `enabled` only while the dialog is open. A cached counter is a permission granted on yesterday's data.
- **The type catalogue** is cached for 60 s, the directory search for 30 s (plus a 250 ms debounce), the slug check for 30 s (plus a 300 ms debounce).
- **The General form re-keys itself** on the string `id:name:description:color`: an external change (another administrator's edit arriving with a list refetch) re-bases the form and the colour state instead of leaving stale values that “Save” would then write over the top.

### Slots

| Slot                   | Owner           | What this plugin puts in                                                                        |
| ---------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| SIDEBAR_NAV_SLOT       | shell           | The “Workspaces” item, the `Layers` icon, `group: 'directory'`, `order: 10`                     |
| SIDEBAR_SECTION_SLOT   | shell           | The quick workspace list (`WorkspacesNavSection`), active ones only                             |
| COMMAND_SLOT           | shell           | Navigating to any **active** workspace from the command palette                                 |
| HOME_SECTION_SLOT      | shell           | Three tiles (active workspaces, unique members, unique content types) and a panel with the list |
| WORKSPACE_NAV_SLOT     | **this plugin** | Its own “Settings” entry with `order: 100` — last in the “Workspace” section                    |
| WORKSPACE_SECTION_SLOT | **this plugin** | Nothing of its own; this is where the Content Library puts the type list                        |
| WORKSPACE_ROUTE_SLOT   | **this plugin** | The `settings/*` route; Content, Media and Insights put their pages here too                    |

**The three slots of its own are precisely the “a plugin lives inside a workspace” contract.** A feature plugin contributes a route plus a navigation entry or a section and declares **neither** a top-level route nor a global menu item. A navigation entry's `to` is **relative** (`'media'`), and the workspace identifier is supplied by the slot's owner — a contributor never writes it. An entry has an optional `permission` field: `WorkspaceNav` reads the permission list once and hides entries whose permission was not granted.

### Accessibility

- **Focus after removing a member.** Radix returns focus to the dialog's trigger, but the mutation has just unmounted it along with the row, and focus fell onto `<body>`. A handler lands focus on the row that took the removed one's place, or on the roster's heading if the list is now empty.
- **The identifier field is `readOnly`, not `disabled`.** A disabled field cannot be focused, which means it can be neither selected nor copied from the keyboard. The same goes for the slug field.
- **A clipboard failure** (an insecure origin, a denied permission) degrades into a “select and copy manually” toast rather than into silence.
- **A wizard step change is announced** in a `role="status" aria-live="polite"`: “Step N of 3: …”.
- **The step's entry animation is `transform` only** (opacity stays at 1), is disabled under `prefers-reduced-motion`, and restarts via `key={step}`.
- **The navigation rows** use `SidebarMenuButton`, derive activeness through `useMatch` and set `aria-current="page"`.
- **The home page's tiles do not lie on failure:** a load error is a separate `role="alert"`, not three honestly drawn zeroes.

## 10. Configuration and registration order

**The plugin has no configuration of its own.** The `WorkspacesPlugin()` factory is called with no arguments and is exactly the standard `ServerPlugin` shape. The plugin reads not a single environment variable — no timeouts, no limits, no flags. Everything configurable is configured in code: the colour palette (7 keys), the member ceiling on creation (200), the advisory lock's class (`0x574b`), the maximum lengths (120 / 2000 / 120).

| What the factory sets | Value                             | Meaning                                                                                                       |
| --------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| name                  | `'workspaces'`                    | The plugin's name in the host's list                                                                          |
| module                | `WorkspacesModule.forRoot()`      | A **global** dynamic module: the guard and the membership check must be injectable from any plugin's injector |
| migrations.dir        | a lazy function                   | Called **only during a migration**, never at load time                                                        |
| migrations.table      | `__drizzle_migrations_workspaces` | Its own migration journal, separate from other plugins'                                                       |

> **The order in the plugins array is not a matter of style**
>
> `WorkspacesPlugin()` is registered **after `IdentityPlugin`** and **before `ContentPlugin`**. After identity — because `memberships` carries a foreign key to `users`, and that table must be migrated first, while the services read `users` and `roles`. Before content — because content closes its routes with the `WorkspaceGuard` from here and binds the `CONTENT_CATALOG` and `CONTENT_ENTRY_COUNTER` ports from here too.

<details>
<summary>What the module exports and why exactly that</summary>

There are five exports, and each answers a specific need of somebody else's injector. `MembershipCheckQuery` — so that a `@UseGuards(WorkspaceGuard)` instantiated in a consuming module can resolve the guard's dependency. `WorkspacePurgeRegistry` — so that a plugin with workspace-scoped rows of its own can inject the registry and register itself. `WORKSPACE_DIRECTORY` — so that `ApiTokenService`, constructed in identity's injector, can resolve the optional port. And both guards.

</details>

## 11. Security and resilience

#### One access rule, two entry points

The header guard and the path guard delegate to one `authorizeWorkspaceAccess` function. They physically cannot diverge on what “has access” means. The rule in full: authenticated, the identifier is a UUID, a row exists in `memberships`.

#### No tenant enumeration

A non-member gets a flat `403` with the same text as an attempt on a non-existent workspace. The guard fires **before** the handler, so the handler's own `404` is now reachable only for a workspace the caller _is_ a member of — that is, one deleted concurrently.

#### The scope is baked into the query

`listForMember` is an `INNER JOIN`, and there is no unscoped `listAll()` in the read model. A filter built into the query cannot be forgotten; a filter applied by the caller can.

#### The “counted then wrote” race is closed by a lock

A transactional advisory lock with a fixed class: creating an entry takes the shared one, deletion and grant revocation take the exclusive one. Many creators, one destroyer. It is released automatically on commit or rollback, so there is no such thing as a “forgotten” lock.

#### The loser of a slug race gets a 409, not a 500

The pre-check is racy by construction; the real arbiter is the unique index. Its refusal is recognised by walking the `cause` chain and translated back into a domain error. An ordinary collision must look like an ordinary collision.

#### Destruction fails closed

We could not measure, so we do not permit: `EntryCountUnavailableError` → `503` for deletion and revocation, while the reading counters keep answering `0`. Blindness is never read as “empty”.

#### The purge is part of the transaction; reclaiming bytes is not

The purgers run inside the delete transaction and roll back with it; everything non-transactional is handed over as a thunk and executed **after** the commit. A rolled-back delete must not destroy the bytes of a live row.

#### The last member is unremovable

Not a matter of politeness but of unreachability: a workspace with no members is visible to nobody, the global administrator included, and there is no way back to it. The rule sits on the aggregate.

#### CSRF on every mutation

identity's `OriginGuard` sits on every mutating route and on **none** of the reading ones — including the preview counters, which stay ordinary GETs.

#### The client does not choose a content type's kind

The grant body holds only a `slug`; the server derives the `kind` from the catalogue. Otherwise a client could declare a page to be a collection and shift the meaning of a row in the database.

#### A missing scope is an exception, not `undefined`

`@CurrentWorkspace()` throws a `500` rather than returning an empty value. An empty scope on a request is silently lifted tenant isolation; better a loud wiring error.

#### A duplicate purger is a startup failure

Registering the same `purgeName` twice would double the report and run the resource reclamation twice, so the registry throws at registration rather than sorting it out silently.

### Deliberately deferred

- **Purgers for alarms and segments** — their workspace-scoped rows survive a deletion today (see section 5).
- **A “read-only” mode for an archived workspace** — the status blocks nothing.
- **Roles and an owner inside a workspace** — the model is deliberately flat.
- **Invitation by address with a real token** — today only a `pending` account is created; the code has a `TODO(invites)`.
- **Changing the slug** — it is declared a stable URL identifier and is absent from `UpdateWorkspaceDto`.
- **A port for the read models** — the views are injected as concrete classes; only writes are inverted.
- **Automatic layer-boundary checking** — the lint from `@orthacms/nx` is not wired up yet, and the rule rests on review.

## 12. Invariants

Statements that must always hold. At once a review checklist and a draft set of test assertions.

- **I-01** — Permission and membership are checked **independently**, and both checks are mandatory: holding `workspaces:update` never opens access to a workspace the caller does not belong to.
- **I-02** — Both guards delegate the decision to the single `authorizeWorkspaceAccess` function. One documented exception: `media/server`'s download controller asks the same membership probe directly and answers **404** rather than 403, because it derives the workspace from the asset id and a 403 would confirm that the asset exists. So there is no second membership _probe_; there is one other call site, and it is deliberate.
- **I-03** — “Not a member” and “no such workspace” are indistinguishable: the same `403` with the same text, on every route and on the shell's screen.
- **I-04** — `GET /api/workspaces` returns **only** the caller's workspaces; no unscoped list exists in the read model.
- **I-05** — Every route of the form `/workspaces/:id/…` carries `WorkspaceMemberGuard` — both preview counters included.
- **I-06** — `@CurrentWorkspace()` either returns a verified identifier or throws; it never returns `undefined`.
- **I-07** — A membership carries no role; a workspace has no owner, and the creator is simply the first member with no privileges.
- **I-08** — The last member cannot be removed: `LastMemberError` → `409`. The rule sits on the aggregate and is not bypassed by any path.
- **I-09** — Every aggregate mutator is idempotent and returns whether anything changed; on `false` neither a row nor a domain event is written.
- **I-10** — A slug is system-wide unique; the arbiter is the unique index, and its violation is translated into a `409`, not a `500`.
- **I-11** — The slug format (lowercase Latin letters, digits, hyphen; 1–120) is checked by a value object rather than a DTO decorator, and identically on the server and in the admin UI.
- **I-12** — A workspace's colour always belongs to the seven-key palette; an arbitrary value cannot be written.
- **I-13** — A workspace's slug is immutable: the field is absent from `UpdateWorkspaceDto`, and there is no other way to change it.
- **I-14** — A workspace cannot be deleted while it holds content entries (`409`); a grant cannot be revoked while the type has entries in that workspace (`409`).
- **I-15** — If the entry counter is not bound, destructive operations **refuse** (`503`), while the reading counters keep answering `0`.
- **I-16** — Deletion and grant revocation load the aggregate under the workspace's **exclusive** advisory lock; writing an entry takes the **shared** one.
- **I-17** — Every purger runs **inside** the delete transaction and sequentially; a thrown exception rolls the whole deletion back.
- **I-18** — Non-transactional resource reclamation runs **only after** the commit, and its failure is logged and swallowed.
- **I-19** — Registering a purger with the same `purgeName` twice is an exception, not a silent overwrite.
- **I-20** — A content type's kind (`collection` or `single`) is derived by the server from the catalogue; the client sends only a slug, and an unknown slug gives a `400`.
- **I-21** — An “all content” grant is expanded into explicit rows per known slug: the presence of a row always means an explicit grant.
- **I-22** — Every state change puts its domain event into the outbox **in the same transaction**; there are no inline calls to the audit recorder.
- **I-23** — `domain/` imports neither `@nestjs/*` nor `drizzle-orm` nor `class-validator` nor `infrastructure/`.
- **I-24** — The `users` stub from `external-refs.ts` is not re-exported from `schema/index.ts`, so `drizzle-kit` emits no second `CREATE TABLE users`.
- **I-25** — Invited members are matched by normalised address; one address in different cases yields one account, not two.
- **I-26** — A user identifier that does not resolve to a real `users` row is discarded and does not bring workspace creation down.
- **I-27** — `WORKSPACE_DIRECTORY` answers the question of **existence**, not of status: an archived workspace is a legitimate API-token scope.
- **I-28** — Purging a token's scopes does not revoke the token itself.
- **I-29** — The slug-availability check requires `workspaces:create`; authentication is not enough.
- **I-30** — Every preview counter is gated on the same permission as the action it guards.
- **I-31** — In the admin UI a failure to load the list is never displayed as “there are no workspaces”.
- **I-32** — The dialog's destructive button is enabled **only** on a known zero count; both “checking” and “the check failed” block it.
- **I-33** — A failed slug check yields the `Unknown` state and does not unlock the move to the next step.
- **I-34** — Danger zone is gated on both the tab and the route: a direct link without the permission redirects to `general` with an explanation.

## 13. Testing checklist

The wording is “action → expected result”, so items can go into a test case without rewriting. The server side is checked with `curl` + `psql`, the admin side in a browser. The existing suites are `apps/server-e2e/src/server/workspaces/*` (8 files: create, update, access, content, delete-residue, lifecycle, members, regressions) and `apps/admin-e2e/src/workspaces/*` (6 files: workspaces, settings, permissions, keyboard, a11y, regressions).

### The tenant boundary

- **An administrator who is not a member of the workspace sends `PATCH /workspaces/:id`** → 403 reading “You are not a member of this workspace.”, and the data is unchanged.
- **The same request against a definitely non-existent UUID** → 403 with the same body — the responses are indistinguishable.
- **`GET /workspaces` as a user with no memberships** → 200 and an empty array, not a 403 and not a 404.
- **Two users in different workspaces** → each sees only their own in the list; the other's identifier does not appear in the response.
- **A request with another workspace's `X-Workspace-Id` on a content route** → 403 from `WorkspaceGuard`; the handler is not invoked.
- **A request with no `X-Workspace-Id` header on a route under `WorkspaceGuard`** → 400, “Missing or malformed X-Workspace-Id header.”.
- **A header with junk instead of a UUID** → 400, with no database access.
- **The header duplicated twice** → the first value is taken and the behaviour is deterministic.
- **An `:id` in the path that is not a UUID** → 400 (either `ParseUUIDPipe` or the guard fires — either way a 400).

### Creation

- **A valid creation** → 201, a view, a `memberships` row for the creator, a `workspace_content` row per granted slug, and `workspace.created` in the log.
- **The same slug in a second request** → 409, “Workspace slug already taken”.
- **Two concurrent creations with one slug** → exactly one 201 and one 409 (not a 500), with one workspace in the database.
- **A slug with capitals or an underscore** → 400 with a message about lowercase letters, digits and hyphens.
- **A 121-character slug** → 400.
- **A 121-character name or a 2001-character description** → 400 from the `ValidationPipe`.
- **A colour outside the palette** → 400.
- **201 members in the array** → 400 (`ArrayMaxSize`), and no workspace is created.
- **An invited member with an email of nothing but spaces** → 400 (`@IsEmail`), and no ghost account appears.
- **The same address invited twice in one request** → one `pending` account with the `viewer` role is created, with one membership.
- **The same address in a different case, with the account already existing** → the existing account is reused and no new one is created.
- **A non-existent uuid among the non-invited members** → the creation goes through, that member is simply not added, and there is no foreign-key error.
- **The creator additionally listed in `members`** → one membership row, not two.
- **`content.mode = 'all'`** → a row per catalogue type, with the right `kind`.
- **`mode: 'all'` with `excludedIds`** → the excluded slugs got no rows.
- **`mode: 'specific'` with a slug that is not in the catalogue** → it is silently discarded (an intersection with the known ones) rather than creating a grant into the void.
- **An extra field in the body** → 400 from the `ValidationPipe`.
- **A contributor tries to create one** → 403.

### Members

- **Adding an existing user** → 201, the view contains them, and a `member_added` event with the address in the payload.
- **Adding the same one again** → success, the roster is unchanged, and there is no second event.
- **Adding a non-existent user** → 404.
- **Removing a member when there are two or more** → 204, the row is gone, and a `member_removed` event.
- **Removing the last member** → 409 with the hint “delete the workspace or add another member”, and the row is still there.
- **Removing a non-member** → 204, nothing changed, no event.
- **Removing from a non-existent workspace** → 403 (the guard fires first — the caller is not a member).
- **Removing yourself when a second member exists** → 204; the next `GET /workspaces` no longer shows that workspace.
- **Deleting a user from identity's directory** → their memberships leave by cascade.

### Content grants

- **Granting a known slug** → 201, the slug appears in `content[]`, and a `content_granted` event with the kind.
- **Granting it again** → success, no duplicate row, no second event.
- **Granting an unknown slug** → 400.
- **Revoking a grant for an empty type** → 200, the slug disappears from `content[]`, and a `content_revoked` event.
- **Revoking a grant for a type that has entries** → 409, and the grant is still there.
- **Revoking a grant that was never issued** → 200 with the current view, and no event.
- **Revoking with no content plugin present** → 503, not a silent success.
- **In parallel: creating an entry and revoking that type's grant** → the exclusive lock serialises them; either the entry is created and the revocation gives a 409, or the revocation goes through and the entry is created afterwards — there are no orphaned rows.

### Lifecycle and deletion

- **Archiving an active workspace** → status `archived`, and a `workspace.archived` event.
- **Archiving it again** → success, with no second event.
- **Unarchiving** → status `active`, and a `workspace.unarchived` event.
- **Writing content into an archived workspace** → it goes through — the status blocks nothing. If a block is expected, that is a requirements defect, not a code one.
- **Deleting an empty workspace** → 204; the `memberships`, `workspace_content`, copilot conversations and proposals, skills and saved views are gone.
- **Deleting a workspace that has entries** → 409, nothing deleted.
- **Deleting with no content plugin present** → 503.
- **Deleting a workspace that has media** → the `media_asset` and `media_folder` rows are gone, the bytes are reclaimed after the commit, and the report shows the row count.
- **Deleting a workspace that is inside an API token's scope** → the `api_token_workspaces` row is gone, **the token itself is not revoked** and keeps working in the other workspaces.
- **Deleting a workspace that was a token's only scope** → the token is alive but reaches nothing.
- **A purger throws** → a complete rollback: the workspace is still there and not one other plugin's row was deleted.
- **Byte reclamation fails** → the request still succeeds (204), with a log line naming the purger and the workspace identifier.
- **In parallel: creating an entry and deleting the workspace** → serialised by the lock, with no orphaned entries.
- **After deletion, sweep every workspace-scoped table** → nothing is left behind: the six cascading tables and the seven purged ones (`media_asset`, `media_folder`, `api_token_workspaces`, `alarm_rules`, `alarm_findings`, `entry_access`, `content_entry_revisions`) all count zero. `workspace-delete-residue.spec.ts` is the exhaustive version of this check.
- **After deletion, check `segments.workspace_ids`** → the dead id **stays**, and that is correct rather than residue: an empty `workspace_ids` means “every workspace”, so pruning the last id would _widen_ who may read.
- **After deletion, check `webhook_endpoint_workspaces`** → gone. It has no foreign key, so `webhooks` registers a purger like the other five, and the table is now in the residue sweep. An endpoint that named only the deleted workspace survives with an empty set, which means "no workspace-carrying event" rather than "all" — the `all_workspaces` boolean is what makes that unambiguous.

### Permissions

- **A viewer: `GET /workspaces`** → 200, their own workspaces.
- **A viewer: `GET /workspaces/slug-available`** → 403.
- **A viewer: `GET /content-types`** → 403 (neither create nor update).
- **An administrator who is a member: `GET /content-types`** → 200; the same answer for a holder of `workspaces:create` alone.
- **A holder of `workspaces:update` but not `workspaces:delete`: `GET /workspaces/:id/entry-count`** → 403; while `/content/:slug/entry-count` is available to them.
- **A mutation with a foreign `Origin`** → 403 from `OriginGuard`.
- **The same `Origin` on a GET counter** → it goes through — reading routes carry no `OriginGuard`.

### The admin UI: the list and the wizard

- **The API answers 500 on the list** → an alert with a “retry” button, **not** “create your first workspace”.
- **The list really is empty** → the “no workspaces yet” state; the create button is visible only with the permission.
- **Every workspace is archived, with the default filter** → the “nothing found” state; “clear” switches to “All” and shows them.
- **The counts on the filter chips** → computed over the full list, not over the current view.
- **A viewer opens `/workspaces/new` by direct link** → a redirect to the list, an announcement in a `role="status"`, focus on `<main>`; a reload does not repeat the announcement.
- **Typing a taken slug** → the “taken” state, with the “next” button disabled.
- **The slug check fails (500)** → the transition stays blocked and “available” is not shown.
- **Go to step 2 and back to step 1** → every field is preserved.
- **Edit the slug by hand, then edit the name** → the slug is not overwritten; the “regenerate” button brings the autofill back.
- **`?step=7` in the address** → clamped to 3.
- **Submitting with a taken slug (a race)** → a toast reading “slug taken, pick another on the Basics step”, not a generic “try again”.
- **Submitting on a network error** → the optimistic card rolls back and the list returns to its previous state.
- **“Skip and create” on the content step** → the workspace is created with no grants, and the step's selection is not lost on a retry.

### The admin UI: the shell and the settings

- **A direct link to someone else's `/workspaces/:id`** → the “no access” screen with `role="alert"` and a link back; no navigation is injected into the sidebar.
- **A link to a non-existent workspace** → the same screen, with not a word about it not existing.
- **The list failed to load** → the error screen, **not** “no access”.
- **Rename a workspace in the settings** → the sidebar's switcher shows the new name at once, `aria-label` included.
- **Change the colour** → the switcher's avatar is repainted at once.
- **Archive from the Danger zone** → a confirmation, then an “Archived” badge in the settings header and disappearance from the quick list and the command palette.
- **Unarchive** → applied without a confirmation.
- **Open the delete dialog on a non-empty workspace** → a warning with the entry count, and the “Delete” button disabled.
- **The same dialog with the counter unavailable** → blocked with “we could not check”, and the button disabled.
- **Delete an empty workspace** → a toast, a move to the list, and **no** flash of the “no access” screen on the way.
- **Delete an entry and open the dialog again** → the count is recomputed, not taken from the cache.
- **Revoke a grant for a type with entries through the interface** → the “Remove” button is disabled with an explanation; the server's 409 is never reached.
- **The add-content dialogs** → there are two — “Add collections” and “Add pages” — each showing only the ungranted types of its kind.
- **Remove a member from the keyboard** → after the dialog closes, focus is on the row that took the removed one's place, or on the roster's heading.
- **Remove the last member through the interface** → the server answers 409; today a **generic** “couldn't remove that member” toast is shown — see section 15.
- **A viewer on the settings page** → read-only fields and no Danger zone tab; a direct link to `settings/danger` leads to `general` with an announcement.
- **Copy the workspace identifier** → a success toast; on an insecure origin, a “select and copy manually” toast, with the field still focusable.
- **A fully keyboard pass through the settings** → every tab and control is reachable and each shows focus.

## 14. Boundaries of responsibility

| Area                                              | Who owns it                           | What Workspaces does                                                                                                                                                                  |
| ------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication, roles, permissions                | `identity-server`                     | References `PERMISSIONS.WORKSPACES_*` and attaches `PermissionsGuard`; declares no permissions of its own                                                                             |
| The database connection and running migrations    | `@orthacms/database` + `@orthacms/nx` | Owns the schema and migration files but neither the connection nor the application step                                                                                               |
| Content entries and the type catalogue            | `content-server`                      | Owns the **ports** content binds; does the catalogue and the counting with someone else's hands                                                                                       |
| Media files and folders                           | `media-server`                        | Provides the guard for the routes and the purge registry; the media purger lives in media                                                                                             |
| The user directory, invitations                   | `users-server` / `identity-server`    | Reads `users` and `roles`; creates a `pending` account on workspace creation but issues no invitation token                                                                           |
| The activity log                                  | `activity-server`                     | Raises 9 kinds of domain event into the outbox; writes no log rows                                                                                                                    |
| An API token's scope                              | `identity-server`                     | Binds the `WORKSPACE_DIRECTORY` port and clears the scopes on deletion; does not manage tokens and does not revoke them                                                               |
| The admin shell, the sidebar, the command palette | `shell-admin`                         | Puts its items into the shell's slots; is not the shell itself                                                                                                                        |
| Interface components                              | `@orthacms/design-system`             | Assembles its pages only from ready-made components; introduces no home-made markup of its own. The wizard chassis (`Stepper`, `WizardStepCard`, `WizardFooter`) comes from there too |

### What else is missing

- **Roles and an owner inside a workspace** — the model is flat deliberately.
- **Restrictions on the archived state** — the status blocks nothing.
- **Moving content between workspaces** — that is the `transfer` group's business.
- **Quotas, limits and billing.**
- **Bulk operations** — several workspaces cannot be archived or deleted at once.
- **Server-side search and pagination** — the list is returned whole, and filtering and search are entirely client-side.
- **A real invitation by address** — a `TODO(invites)` in the provisioner.
- **Restoring a deleted workspace** — there is no “trash”.

## 15. Discrepancies between the code and the documentation

Found while reconciling this dossier with the sources. Not product bugs in themselves, but they disorient developers and testers alike.

| Where                                                 | What it says                                                                                 | How it actually is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| workspaces/server/AGENTS.md, “Deleting a workspace”   | The table of three mechanisms is presented as exhaustive: cascade, refusal, purge            | **Fixed 2026-08-30.** There are workspace-scoped tables **outside** all three: `alarm_rules`, `alarm_findings`, `entry_access` and the `segments.workspace_ids` array. At the time of the finding they had no foreign key and registered no purger — only media and the local `ApiTokenGrantsPurger` implemented `WorkspacePurger` anywhere in the repository — so after a deletion their rows pointed nowhere, precisely the class of orphaning the purge mechanism was introduced for. `alarms`, `segments/entry-access` and `content/revisions` have since shipped purgers of their own; `segments.workspace_ids` is deliberately left alone |
| workspaces/server/AGENTS.md, the “Cascade” row        | Lists `memberships`, `workspace_content`, `copilot_conversations` / `_proposals` / `_skills` | **Fixed 2026-08-30.** `saved_views` (`content/server`) also carries a cascading FK to `workspaces.id`. The list is incomplete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| workspaces/admin/AGENTS.md, “Architecture”            | `useUsersSearch` → `GET /api/users?q=`                                                       | **Fixed 2026-08-30.** The gateway sends `?search=` and `?pageSize=10`; the `ListMembersQueryDto` DTO declares a `search` field. There is no `q` parameter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| workspaces/admin/AGENTS.md, “Settings page → Members” | “a roster where **every** member is removable; no member is special”                         | **Fixed 2026-08-30.** The last member is **not** removable: the server answers `409 LastMemberError`. The client does not distinguish that case — `confirmRemoval` catches any error in one `catch` and shows a generic “Couldn’t remove that member. Please try again.”, even though a retry certainly will not help. The neighbouring dialogs (deleting a workspace, revoking a grant) already use `isConflict` and a separate wording for the same `409`                                                                                                                                                                                     |
| workspacesPlugin/index.tsx, JSDoc                     | “a `Layers` item contributed into `NAVBAR_START_SLOT` at `order: 20`”                        | **Fixed 2026-08-30.** The item is put into `SIDEBAR_NAV_SLOT` with `order: 10`. The plugin does not use a `NAVBAR_START_SLOT` at all. `AGENTS.md`, meanwhile, describes it all correctly — the document and the code comment contradict each other                                                                                                                                                                                                                                                                                                                                                                                              |
| workspacesPlugin/index.tsx, JSDoc                     | Lists two holdings: the management area and the workspace shell                              | **Fixed 2026-08-30.** The plugin also contributes into `COMMAND_SLOT` (the command palette) and `HOME_SECTION_SLOT` (the home page's tiles and panel). `AGENTS.md` mentions the home page but is silent about the command palette too                                                                                                                                                                                                                                                                                                                                                                                                           |
| WorkspacesPage/index.tsx, JSDoc                       | “searchable, status-filterable **grid of workspace cards**”                                  | **Fixed 2026-08-30.** The page renders a `WorkspacesTable` — a table, not a grid of cards. `AGENTS.md` says “table” correctly; it is the comment that is out of date, and the word “grid” leaked further — into `useDeleteWorkspace`'s comment and into a couple of state texts                                                                                                                                                                                                                                                                                                                                                                 |
| workspaces/server/AGENTS.md, “The one hard rule”      | The rule is presented as though it described the whole layout                                | It concerns **only** `domain/`. Above it the layers are permeable in fact: the member use cases import the concrete `MemberLookupQuery` from `infrastructure/`, and the controllers import `WorkspaceViewQuery` and `SlugAvailabilityQuery`. This is deliberate (a read model is a projection, not a rule), but someone reading the package as a reference could easily mistake for inversion something that is not there                                                                                                                                                                                                                       |
| workspaces/server/AGENTS.md, “Ports & adapters”       | “`DrizzleMemberProvisioner`: provisions pending users for invited emails, drops stale ids”   | True, but it omits what matters most to a tester: the provisioner **writes into another plugin's table**, identity's `users`, and assigns the `viewer` role, while a `TODO(invites)` right in the code records that no invitation token is issued in the process. That is, “invite by address” in the wizard sends nothing and gives the person no way to sign in                                                                                                                                                                                                                                                                               |
| The root `AGENTS.md`, the project map                 | The `workspaces` group has no row of its own                                                 | The map describes database, identity, copilot, tools, content/graphql, transfer, segments, alarms, mcp, nx, cli and the scaffolder in detail, but `packages/workspaces` is absent from the listing — even though it is the one named as ADR-0003's reference and its guard is used by 51 files in other packages                                                                                                                                                                                                                                                                                                                                |

### What the QA pass changed (2026-08-30)

This dossier was reconciled against the code and a live stack. Its own discrepancy list held up in full — every entry in it was real — but three statements elsewhere did not, and are corrected above: `segments.workspace_ids` was listed as an oversight when it is a deliberate fail-safe, `content_entry_revisions` was missing from the same list although it is the sixth uncovered table, and **I-02** was worded more strongly than it holds. Entries since fixed in the code are marked **Fixed**.

Four product defects were found and fixed in the pass. Rows in five tables survived a workspace delete pointing nowhere — reproduced, then closed with three new purgers. The sidebar's workspace quick-list rendered a failed load exactly as it renders an empty membership, because it never read `isError` while four sibling surfaces did. Removing the last member showed “Please try again”, discarding the actionable 409 the server had already sent. And dismissing that dialog dropped focus on `<body>`, because it is opened from state and Radix had no trigger to restore to — found by a keyboard test written in the same pass, not by hand.

Unit coverage of the invariants went from 4 of 34 to 30 of 34.

---

**The second dossier in the series.** Written for the `packages/workspaces` group in the pilot Identity dossier's skeleton, with one section added — “The layered layout (ADR-0003)” — because this package is its reference implementation and the other plugins look to it. The sections the package does not have (SSO, sessions, separate framework-free packages) have dropped out; configuration is reduced to registration order, since the plugin has no settings of its own.

The source is the code: 13 controllers, the DTOs, the two guards and the decorator, 8 use cases, the aggregate and value objects, the Drizzle schema and its single migration, and the admin UI's pages, hooks and slots. The `AGENTS.md` files were used as a skeleton, but every statement was verified against the implementation — the divergences are collected in section 15.
