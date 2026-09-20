# Users

_Package group · packages/users_

**The editorial roster: who was let in, with what role, and how access is taken away**

Users is the CMS's **HR department**. Identity answers “who has arrived and what may they do”, while users decides **who appears in the system at all**: it issues invitations, assigns roles, disables a person along with every live session of theirs, and hands an administrator a password-reset link. The package owns not a single table of its own — it writes into other people's, through explicitly declared ports, and owns only the rules.

- **2** packages in the group
- **9** HTTP routes
- **0** tables of its own
- **0** migrations
- **4** permission keys
- **9** admin screens
- **6** machine-readable 409 codes
- **8** domain events
- **1** copilot tool

## Contents

- [01. Business description](#01-business-description)
- [02. The package group's composition](#02-the-package-groups-composition)
- [03. Roles and permissions](#03-roles-and-permissions)
- [04. Data model](#04-data-model)
- [05. A member's lifecycle](#05-a-members-lifecycle)
- [06. Step-by-step scenarios](#06-step-by-step-scenarios)
- [07. HTTP API](#07-http-api)
- [08. The admin UI: routes, screens, states](#08-the-admin-ui-routes-screens-states)
- [09. Configuration](#09-configuration)
- [10. Security and resilience](#10-security-and-resilience)
- [11. Invariants](#11-invariants)
- [12. Testing checklist](#12-testing-checklist)
- [13. Boundaries of responsibility](#13-boundaries-of-responsibility)
- [14. Where the code and the documentation diverge](#14-where-the-code-and-the-documentation-diverge)

## 01. Business description

You cannot sign up for Ortha. The only door in is an invitation, and it is this plugin that issues it. Everything that happens to a person after they become a member of the editorial team — a role change, being disabled, a link reissued, a password recovered — is here too. Identity can check a pass; users decides who gets a pass and who has one taken away.

### The problem it solves

- **Controlled entry into a closed system.** An administrator names an address and a role — an account appears with the `pending` status and a one-time link. No self-registration and no “leave us a request”: an editorial roster is a management decision, not self-service.
- **Instant disabling.** Disabling a member is not only a flag on the account's row: in the **same transaction** every live session of theirs is killed. A person loses access where they are sitting rather than “when the cookie goes stale”.
- **Protection against shooting yourself in the foot.** The system does not let you end up with no administrator and does not let an administrator take away their own rights. Both rules are checked under a lock, that is, they hold against two simultaneous attempts rather than only sequential ones.
- **Password recovery, with or without a mail server.** A deployment that configures none behaves as it always has: the administrator issues the link and **hands it over in person**, which is an honest model rather than a stub. A deployment that configures one (`MAIL_PROVIDER`, [ADR-0018](../adr/0018-mail-provider.md)) sends the invitation and the reset itself — and then the routes stop returning the raw token, because two copies of an account-takeover secret are worse than one. A self-service “forgot your password?” form is still absent: it needs rules of its own about enumeration and rate limiting, and it is phase 2 of that record.
- **A directory of people.** The member list with search, pagination and a query builder — one and the same readable source for the “Members” screen, for a member's card, and (in a narrow, workspace-bounded form) for the copilot.

### Who sees it

#### The administrator

The only role with access to every action: invite, resend, revoke an invitation, change a name and a role, disable and re-enable, issue a reset link, view and kill other people's sessions.

#### Anyone signed in

Sees the member directory and a person's card — name, address, role, status, workspaces. The `users:read` permission is held by all three system roles, the viewer included.

#### The invitee

Never appears in the plugin itself: they receive a link from the administrator's hands and go off to redeem it in identity. Until that moment they are a row with the `pending` status and no password.

### What Users is not

This package's boundaries are unusually strict: it owns not a single table and not a single sign-in screen. The list of what it does not contain explains half the architecture:

- **It is not authentication.** Signing in and out, cookies, password checking, redeeming an invitation and a reset are entirely `identity`. Users _issues_ one-time links and identity _redeems_ them; the `tokens` table belongs to identity.
- **It is not email.** It _raises_ three messages — invite, resend, password reset — by queueing them through the `MailDispatcher` port inside the transaction that mints the token, which is the only place the plaintext exists. Rendering, the queue, the worker and the provider are all `mail`'s. With no mail plugin registered nothing is bound, nothing is sent, and the raw token comes back in the response exactly once, as it always did. The three `TODO(users-email)` markers are closed.
- **It is not workspaces.** Users can only _create_ a workspace membership at invitation time (through a port), while the tables, routes and rules themselves belong to `workspaces`.
- **It is not the audit log.** The plugin raises `member.*` domain events into the transactional outbox; the log rows are written by a subscriber in `activity`, which translates them into `user.*`.
- **It is not about deleting people.** Only a “blank” can be deleted — an unaccepted invitation. A real account is disabled, not erased: content authorship and an action history stand behind it.
- **It is not self-service.** The only thing a person changes for themselves is the visual theme, and even that goes through identity's `/api/preferences` route. Name and role are edited by an administrator.

> **The key architectural idea**
>
> The plugin **owns rules, not data**. It reads and writes other people's tables (`users`, `roles`, `tokens`, `sessions` — identity's; `memberships`, `workspaces` — workspaces') and carries not a single migration. Everything genuinely its own is the `Member` aggregate with its invariants, six use cases, the catalogue of machine-readable error codes, and the two locks that make the invariants race-proof.

## 02. The package group's composition

The `packages/users` group is **two** packages, a server one and an admin one. There is no separate `domain` package here (unlike in `content` or `copilot`): the domain kernel lives inside each of the two, in a `domain/` layer, because there is no need to share it between the server and the browser — their rules are different in nature (the server forbids, the admin UI explains).

| Package | npm name               | Role                                                                                                                      | What it owns                                                                                                                                                                                    |
| ------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| server  | @ortha/users-server | The NestJS plugin: 9 routes under `/api/users`, 6 use cases, the aggregate, the ports and adapters, the read model        | The `Member` aggregate, the “last admin” and “not on yourself” invariants, the two one-time-token services, the `workspace_members_list` copilot tool. **Not one table and not one migration.** |
| admin   | @ortha/users-admin  | The admin plugin: 3 routes (`/users`, `/users/invite`, `/users/:id/*`), 9 screens, 3 contributions into the shell's slots | The members screen, the invitation wizard, the member's card with seven tabs, the account menu in the sidebar's footer, the invisible theme synchroniser                                        |

### The layered layout (ADR-0003)

Both packages have been moved onto tactical DDD. The server side is a single bounded context, `member`:

#### `users/server/src/lib/member/`

- `domain/` — the `Member` aggregate, the `MemberRepository` port, the `MemberId` / `Role` / `MemberStatus` value objects, 8 event kinds, 11 error classes. **Not a single import** from Nest, Drizzle or class-validator.
- `application/` — six use cases, three DTOs, the `SESSION_REVOKER` and `WORKSPACE_LINKER` secondary ports, the filter schema, the read-model types.
- `infrastructure/` — `DrizzleMemberRepository`, `MemberMapper`, `InviteTokenService`, `PasswordResetTokenService`, the two port adapters, the two query services.
- `http/` — eight thin controllers and the `conflict()` helper.

#### `users/admin/src/lib/`

- `domain/` — the client-side `MemberEntity` with its UX invariants, the `Email` value object, the view types.
- `application/` — 16 TanStack Query hooks: the reads, the mutations, the invitation wizard's orchestration.
- `infrastructure/` — the `MemberGateway` port and its HTTP implementation (the only place `apiClient` is used), the mapper, the cache keys, the link builders.
- `presentation/` — the pages, the components, the plugin factory, the member-card context.

### The copilot tool

The server package adds exactly one tool to the shared registry — `workspace_members_list` (`surfaces: ['copilot']`, `readOnly: true`, requires `users:read`). It answers “who is on this team?” and turns an `actorEmail` from the log or a revision's `authorId` into a person's name.

Importantly, it reads **not** the general directory but a separate query, `WorkspaceMembersQuery` (`memberships ⋈ users ⋈ roles`). The `users:read` permission would be enough to enumerate every account in the installation, but a copilot run is bounded by a workspace — and a narrower answer here is both safer and more useful at once. What goes out are the same columns the members screen renders: address, name, the role's key and name, status. No tokens and no sessions.

> **Neighbours that are easy to confuse**
>
> **`@ortha/identity-server`** — sign-in, sessions, RBAC, the `users`/`roles`/`tokens`/`sessions` tables, redeeming an invitation (`POST /api/auth/invite/accept`) and a reset (`POST /api/auth/reset`), plus the member-session and personal-preference routes that users' admin UI is the one to render. **`@ortha/workspaces-server`** — the `workspaces`/`memberships` tables and the routes for adding and removing a workspace member, which the “Workspaces” tab calls. **`@ortha/activity-*`** — the log: an outbox subscriber translates `member.*` into `user.*` and renders the “Activity” tab.

## 03. Roles and permissions

The plugin declares no roles of its own: it operates on identity's three system roles (`admin`, `contributor`, `viewer`) and on the four permission keys of the `users:*` family. Only those three keys can be assigned through the API — the `ASSIGNABLE_ROLE_KEYS` list is fixed as an explicit tuple rather than derived from `SYSTEM_ROLES`, so that the API's contract is visible at a glance and lands in an `@IsIn`.

| Permission    | What it opens in this plugin                                                                                                                                                   | admin | contributor | viewer |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ----------- | ------ |
| users:read    | The member list (`GET /users`) and a card (`GET /users/:id`). The copilot tool requires the same key                                                                           | ✓     | ✓           | ✓      |
| users:create  | Inviting (`POST /users/invites`) and **resending** an invitation (`POST /users/:id/invites/resend`) — the same permission that issued the link in the first place              | ✓     | —           | —      |
| users:update  | Editing a name and a role (`PATCH /users/:id`), disabling and re-enabling, **issuing a reset link**. The same key (in identity) opens listing and revoking a member's sessions | ✓     | —           | —      |
| users:delete  | Revoking an unaccepted invitation (`DELETE /users/:id/invites`) — the only delete operation in the whole plugin                                                                | ✓     | —           | —      |
| activity:read | **Another package's permission** that this one merely reads: the “Activity” tab on a member's card is shown and opened only with it                                            | ✓     | —           | —      |

> **An asymmetry that looks like a mistake and is not**
>
> The member directory, **email addresses included**, is open to a viewer: `users:read` is held by all three roles. That is deliberate and consistent with workspaces — people in an organisation know each other by address anyway. A member's **sessions** (IP and `User-Agent`), on the other hand, require `users:update`, that is, they are available to an administrator only: those are already facts about where and from what a person works.

### How a permission reaches the code

- **Authentication** — identity's global `AuthGuard` (an `APP_GUARD`). No users route is marked `@Public()`: **the package has no public routes whatsoever**.
- **Authorization** — `@UseGuards(PermissionsGuard)` + `@RequirePermissions(PERMISSIONS.USERS_*)` at the controller level. The permissions come from shared constants rather than string literals.
- **CSRF** — every _mutating_ controller also carries `OriginGuard`, **before** `PermissionsGuard`: `@UseGuards(OriginGuard, PermissionsGuard)`. The two reading controllers (`list-members`, `get-member`) deliberately do not carry it — a GET changes nothing, and a browser can read it cross-origin regardless.
- **The identifier in the path** — a `ParseUUIDPipe` everywhere, so a non-UUID is cut off as a `400` before any business logic.
- **In the admin UI** — `useHasPermission('users:read' | 'users:create' | 'users:update' | 'users:delete')`. The hook is fail-closed: any state other than “authenticated” yields `false`. That is interface honesty, not protection: the real check is always on the server.

<details>
<summary>The plugin's registration order</summary>

`UsersPlugin()` registers **after** `DatabasePlugin` and `IdentityPlugin`, whose tables it reads and writes and whose migrations must have been applied, or the routes do not work. Formally identity's `AuthGuard` is assembled globally regardless of order, but the `PermissionsService` the route guards inject comes from identity's global module — and `WorkspacesPlugin` is needed for the workspace-linking port. The `UsersModule` is **not global** and exports nothing: all its providers are private.

</details>

## 04. Data model

**The plugin has no tables of its own. Not one.** There is no `drizzle.config.ts` file, no `migrations/` folder and no migration journal table. The `db:generate` Nx target is not inferred on this project, because there is nothing to infer.

That is not an omission but a consequence of how the contexts are laid out: the account schema belongs to identity, because it is identity that decides what an account is and how it authenticates. Users is a second context over that same `users` row: it looks at it as “a member of the editorial team” and changes only what its own rules concern (name, role, status), reaching everything else through ports.

| Table         | Owner              | What users does with it                                                                                                                                                                                                                                                                                                            |
| ------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| users         | identity-server    | **Reads and writes.** Inserts a row on invitation (`status='pending'`, no `password_hash`), updates `name` / `role_id` / `status`, deletes the row when an invitation is revoked. The case-insensitive uniqueness of the address — an index on `lower(email)` — serves as a race-proof understudy for the “address is taken” check |
| roles         | identity-server    | **Reads only.** Resolves a role's key into its `id` on insert and on a role change; a missing seeded system role is treated as a broken deployment (a `500`) rather than as an input error                                                                                                                                         |
| tokens        | identity-server    | **Writes.** Rows with `type='invite'` and `type='reset'`: deleting the live ones + inserting a new one under a lock. Only a SHA-256 is stored; the raw token is unrecoverable. Redemption does not happen here                                                                                                                     |
| sessions      | identity-server    | **Writes.** Exactly one action: `revoked_at = now()` across all of the user's rows when they are disabled, through the `SESSION_REVOKER` port, inside the same transaction                                                                                                                                                         |
| workspaces    | workspaces-server  | **Reads only.** Filters the identifiers passed at invitation time down to the ones that really exist; reads the name, description and colour for the member's card                                                                                                                                                                 |
| memberships   | workspaces-server  | **Writes.** Insert only, at invitation time, through the `WORKSPACE_LINKER` port, with an `onConflictDoNothing`. Removing a membership is a workspaces route                                                                                                                                                                       |
| outbox_events | @ortha/database | **Writes.** Through the `OutboxWriter`, in each use case's transaction: eight kinds of `member.*` event                                                                                                                                                                                                                            |

### The read model: what the API actually returns

Reads do not go through the aggregate — they are a thin CQRS query, `MemberViewQuery`, over the base connection (not the transaction), so it sees committed state after the unit of work closes. The response's shape is a `MemberView`:

| Field       | Type                          | Meaning                                                                                                                                                                                                                        |
| ----------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| id          | uuid                          | The account's identifier. Minted by the aggregate at invitation time (`MemberId.generate()`) rather than read back from the database — so that the `member.invited` event can carry it                                         |
| email       | string                        | The address; for a `pending` member, the invitee's address. Stored lowercased (normalised in the use case)                                                                                                                     |
| name        | string \| null                | `null` until the invitee sets a name. The admin UI substitutes the address for it                                                                                                                                              |
| role        | { id, key, name }             | The single global role, joined from `roles`                                                                                                                                                                                    |
| status      | pending \| active \| disabled | A mirror of identity's `user_status` enum                                                                                                                                                                                      |
| createdAt   | Date                          | When the row was created; for a `pending` member that is the invitation's date rather than a joining date                                                                                                                      |
| isLastAdmin | boolean                       | An **advisory flag**: the admin role + active status + a total of ≤ 1 active admins. It is computed for the UI so that the button can be disabled with an explanation; on a write the invariant is checked under a lock anyway |
| workspaces  | an array                      | The member's workspaces (`id`, `name`, `description`, `color`), sorted by name with an `id` tie-break                                                                                                                          |

Two envelope extensions exist on **exactly three routes**: `InvitedMemberView` = `MemberView` + `inviteToken` (inviting and resending), and `PasswordResetMemberView` = `MemberView` + `resetToken` (issuing a reset). Any other read returns a bare `MemberView`, so a token physically cannot leak into a route that merely displays people.

### The list's filterable surface

`MEMBER_FILTER_SCHEMA` describes what the query builder may ask about at all: the scalar `email`, `name`, `status` (a three-value enum), `createdAt` (a date) and the many-to-one `role` relation with its `key` and `name` fields. The relation expands into an `EXISTS (… roles …)` subquery rather than a JOIN — that way one and the same condition fits both the count query and the page query. `role.key` is typed as a free-form string rather than an enum: a custom, non-system role must remain filterable.

> **Three queries instead of one wide JOIN**
>
> The list runs the `count`, the page's row selection and the selection of that page's workspaces separately. The first two run **in parallel** (`Promise.all`), so the request costs the maximum of two times rather than their sum. One wide JOIN would repeat the user's columns for each of their workspaces and would spoil both the `LIMIT` and the `count`.

## 05. A member's lifecycle

There are three states, and they are stored in someone else's `users.status` column. A fourth, “deleted”, is not a state — it is the disappearance of a row, and it is reachable from exactly one place.

**no row** — invited → **pending** — accepted the invitation (identity) → **active** — disabled → **disabled**

**disabled** — re-enabled → **active** and separately: **pending** — the invitation was revoked → **the row is deleted**

| Transition            | Who performs it                              | What else happens                                                                                                                           | What is forbidden                                                                                                                                   |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| none → `pending`      | `POST /users/invites` (users)                | A `users` row, a `tokens` row with `type='invite'`, optionally workspace memberships, and a `member.invited` event                          | An address that already belongs to any account — a `409 EMAIL_TAKEN`                                                                                |
| `pending` → `active`  | **identity**, `POST /api/auth/invite/accept` | A password is set, the token is redeemed and a session is issued at once                                                                    | Users takes no part in this transition at all                                                                                                       |
| `pending` → `pending` | `POST /users/:id/invites/resend`             | Token rotation: the old link dies and a new one is returned once; a `member.invite_resent` event. The status does not change                | A non-`pending` member — a `409 INVALID_MEMBER_STATE`; a repeat within 60 s — a `409 INVITE_RECENTLY_SENT`                                          |
| `pending` → deleted   | `DELETE /users/:id/invites`                  | The row is deleted, the token and any pre-issued memberships leave by cascade; the `member.removed` event carries a snapshot of the address | Any non-`pending` status — a `409`. Real accounts are never deleted through this route                                                              |
| `active` → `disabled` | `POST /users/:id/disable`                    | **In the same transaction** every live session is revoked; a `member.disabled` event                                                        | Your own account — a `409 SELF_ACTION`; the last active admin — a `409 LAST_ADMIN_PROTECTED`; a non-`active` member — a `409 INVALID_MEMBER_STATE`  |
| `disabled` → `active` | `POST /users/:id/enable`                     | A `member.reactivated` event, minted by the application (the aggregate stays silent on re-enabling)                                         | A non-`disabled` member — a `409`. The “yourself” and “last admin” checks are **unnecessary** here: re-enabling only increases the number of admins |
| `active` → `active`   | `POST /users/:id/password-reset`             | Rotation of the `type='reset'` token, a `member.password_reset_issued` event — **at issuance time**, not at redemption                      | `pending` — there is nothing to reset; `disabled` — the door is closed deliberately. Both are a `409`                                               |
| any → the same        | `PATCH /users/:id`                           | A name and/or role change; the `member.profile_updated` and/or `member.role_changed` events                                                 | Your own role — a `409 SELF_ACTION`; demoting the last active admin — a `409 LAST_ADMIN_PROTECTED`                                                  |

> **The “yourself” asymmetry**
>
> The prohibition on acting on yourself extends to **disabling** and to **changing your own role**, but not to renaming: an administrator can change their own name. That is exactly what the code checks — a `SelfActionError` is thrown in `disable()` before the transaction, and in `UpdateMemberUseCase` only on the role-change branch. Re-enabling yourself is impossible too — but not because of a guard: a disabled administrator cannot sign in.

### The eight domain events

All of them go into the transactional outbox and are picked up there by the `activity` plugin's subscriber, which translates them into its own `user.*` catalogue. The catalogues are **deliberately different** (unlike in the `workspaces` pilot, where they coincide), so the transition is a mapping rather than a reuse of strings.

| Event                        | Who mints it    | Payload                  | The log's row              |
| ---------------------------- | --------------- | ------------------------ | -------------------------- |
| member.invited               | the aggregate   | `{ email }`              | user.invited               |
| member.invite_resent         | the application | `{ email }`              | user.invite_resent         |
| member.removed               | the aggregate   | `{ email }`              | user.invite_revoked        |
| member.role_changed          | the aggregate   | `{ from, to }`           | user.role_changed          |
| member.profile_updated       | the application | `{ name: { from, to } }` | user.profile_updated       |
| member.disabled              | the aggregate   | `{}`                     | user.suspended             |
| member.reactivated           | the application | `{}`                     | user.reactivated           |
| member.password_reset_issued | the application | `{ email }`              | user.password_reset_issued |

The “minted by the aggregate” / “minted by the application” split is not arbitrary: the aggregate raises an event only on a **primary transition of its own state**. Resending an invitation and issuing a reset do not change the member's state at all (what changes is someone else's `tokens` row), while renaming and re-enabling are secondary facts; so their events are assembled in the use case. The actor (`attachActor`) is added to the event in the application layer: the aggregate does not know who called it.

## 06. Step-by-step scenarios

Every mutating scenario is one use case, one `UnitOfWork.run` (one transaction), one load of the aggregate through the port, one call to an aggregate method, a `save` and a drain of the events into the outbox. Below is what that scheme does not show: why the steps come in exactly that order.

### 6.1 Inviting a new member

1. **Checking the body's shape.** The global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`) cuts extra fields off before the controller. `email` is an `@IsEmail`, `role` is one of three keys, `name` is optional, and `workspaceIds` is an array of unique UUIDs.
   _the name is trimmed by an @Transform before the @IsNotEmpty — otherwise “ ” would pass as valid_
2. **Why the name is trimmed.** The `users.name` row is the **only** source of a human-readable identifier: the table row's heading, the avatar's initials, an action's accessible name and the log's actor column all come from it. A whitespace name would leave every one of those surfaces empty, and the client could not reconstruct it (508 §504.2). So it is a `400` rather than stored emptiness.
3. **The address is lowercased** and checked for being taken: `existsByEmail` is a friendly pre-check for the sake of an intelligible `409 EMAIL_TAKEN`.
   _the race-proof understudy is the unique index on lower(email); a 23505 violation maps to the same error_
4. **The transaction opens.** The `Member.invite()` aggregate mints its own `id`, enters `pending` and raises `member.invited`. The repository inserts the row, resolving the role's key into its `id`.
5. **The invitation token is issued.** `InviteTokenService.rotate` receives **the same transaction**: it takes a per-user advisory lock, deletes the live `invite` rows and inserts a new one. The lifetime comes from identity's `token.inviteTtlSeconds` configuration.
   _only a SHA-256 goes into the database; the raw token exists only in this response_
6. **The workspaces are linked.** The `WORKSPACE_LINKER` port filters the identifiers passed down to the ones that really exist and inserts memberships with an `onConflictDoNothing`. **An unknown identifier is ignored** rather than failing the invitation: a stale reference to a deleted workspace must not cost a person their access to the system.
7. **The events are drained into the outbox** with the actor attached; the transaction commits.
8. **The controller re-reads the view** through `MemberViewQuery.byId` and adds the `inviteToken` to it. The administrator gets both the list's row and the link in one response.
   _the re-read is already outside the transaction: the read model works on the base connection and sees committed state_

> **Why the response carries a secret**
>
> There is no email, which means only a person can deliver the link. Returning the raw token is the same “shown once” shape as identity's API tokens: it is unrecoverable by the administrator, by support, and from a database dump. Hence every subsequent measure in the interface (intercepting the dialog's close, registering with the unsaved-changes guard): losing that response is irreversible.

### 6.2 Resending an invitation

1. **Loading the aggregate without a lock.** Resending cannot change the number of administrators, so the global lock is not taken.
2. **`ensureCanResendInvite()`** — `pending` only. There is nothing to resend to an active member: their invitation has already been redeemed.
3. **Rotation with a cool-off window.** `rotate(..., { minIntervalSeconds: 60 })`: if the current token row is younger than a minute, a `409 INVITE_RECENTLY_SENT` with a `retryAfterSeconds` field.
   _the check runs INSIDE the per-user lock, otherwise two simultaneous resends would both read “there is no recent token”_
4. **The `member.invite_resent` event** is minted by the application: the member's state did not change.
5. **The response is the member plus the new raw token.** The old link is already dead by the time the response is sent, so the new one must reach the caller in the same call.

> **Why a refusal rather than “return the previous link”**
>
> Rotation is unconditionally destructive, and the raw token is **unrecoverable** — only its SHA-256 is in the database. Which means the server physically _cannot_ “return the link already issued” on too fast a repeat. The only way to stop a double click from killing a link issued a second ago is to refuse the second call while leaving the first alive. A minute was chosen as a window that covers a double click and an impatient repeat while barely delaying a considered “wrong address, let's do it again”.

### 6.3 Revoking an invitation

1. **Loading the aggregate, then `revokeInvite()`** — it checks that the member is `pending` and raises `member.removed` with a **snapshot of the address** in the payload.
2. **The row is deleted entirely.** The invitation token and every pre-issued workspace membership leave by cascade.
3. **Why the address goes into the event.** The log's row references its subject through a textual `subject_id` with no foreign key, so it survives the account's deletion — but without a snapshot of the address it would be talking about an identifier with nothing behind it any more.
4. **The response is a `204` with no body.** There is nothing to show: the entity no longer exists.
   _the package's only route that answers 204_

### 6.4 Editing a name and a role

1. **Branching on the patch's contents.** If `role` is present, the aggregate is loaded through `findByIdForAdminGuard` (with the global active-admins lock). If this is a **pure rename**, through the ordinary `findById`, with no lock.
2. **Why that matters.** The lock is a single global key, that is, everything that takes it is serialised across the whole deployment. A rename cannot change the number of administrators; making it wait would queue _every_ member edit in the installation into one line.
3. **Changing a role to the same one is not an operation** (`changeRole` returns `false`), and the checks do not run.
4. **The “your own role” check** runs only when the role really changes — a `409 SELF_ACTION`.
5. **The “last admin” check** runs inside the aggregate against a counter read under the lock: demoting a current `admin` with an active status while `activeAdminCount ≤ 1` is a `409 LAST_ADMIN_PROTECTED`.
6. **If neither the name nor the role actually changed**, the use case exits with no write and no events; the controller still returns a fresh view. An empty body is a legitimate no-op.
7. **The repository writes only the columns that changed** — the aggregate's `changes()` gives three flags, which a partial `UPDATE` is assembled from.

### 6.5 Disabling a member

1. **The “yourself” check comes before the transaction.** `actor.id === id` is cut off at once: there is no point opening a transaction and taking a global lock for a foregone refusal.
2. **Loading under the lock.** `findByIdForAdminGuard` first takes a `pg_advisory_xact_lock` on the shared “active admins” key, then reads the aggregate.
3. **The counter is read under that same lock** and passed into `member.disable(activeAdminCount)`. The order of checks inside the aggregate: the status first (`active` only), then “last admin”.
4. **The status is saved, then the sessions are killed** — `UPDATE sessions SET revoked_at = now() WHERE user_id = …` through `UnitOfWork.current()`, that is, in **the same transaction**. Either the person is disabled and thrown out everywhere, or neither happened.
   _this is the primary but not the only line: identity refuses to open a session for a non-active account and refuses to resolve an existing one into a non-active user_
5. **The `member.disabled` event** drains into the outbox, the transaction commits, and the controller returns the member's fresh view.

> **Why a lock rather than “count and write”**
>
> Under READ COMMITTED isolation, two simultaneous transactions read the same administrator count, both see “two, that is fine” — and both write. The result: zero administrators and nobody who can fix it. An advisory lock taken **on the load that precedes the check** makes those sections mutually exclusive. It is transactional, that is, released on commit/rollback, and there is nothing to unlock by hand.

### 6.6 Re-enabling a member

1. **No lock — and that is stated positively:** re-enabling only _increases_ the number of active administrators, so it is incapable of breaking the “at least one admin” invariant.
2. **`enable()`** requires the `disabled` status; anything else is a `409 INVALID_MEMBER_STATE`.
3. **Sessions are not restored** — a revoked session is revoked forever. The person signs in again.
4. **The `member.reactivated` event** is minted by the application: the aggregate is deliberately silent on this transition.

### 6.7 Issuing a password-reset link

An entirely administrative scenario. Users decides **who** is owed a link; identity redeems it through the `POST /api/auth/reset` route.

1. **The permission is `users:update`**, the same one that already governs _what_ an account is. A separate permission was deliberately not created: issuing a recovery link is no weaker than changing a role.
2. **`ensureCanResetPassword()` — `active` only.** A `pending` member has no password yet (they need the invitation resent, and a reset link does not activate the account and would leave the person unable to sign in). A `disabled` one is locked out by an administrator's decision, and issuing a link that sets credentials would read as quietly opening a closed door. Identity refuses for the same reason — so this prohibition merely turns a dead link into an honest `409`.
3. **Rotation with a 60 s cool-off window** and a **different lock space** from invitations (`0x52534554` versus `0x494e5654`): a reset for one person must not queue behind an invitation rotation for another whose identifier happened to hash into the same slot.
   _unlike an invitation, there is no “first issuance” here — the window always applies_
4. **The lifetime is `token.resetTtlSeconds`**, separate from the invitation's TTL: a reset link is handed to a person waiting right there, while an invitation may sit in a mailbox for days.
5. **The event is written at issuance time** rather than at redemption. Handing over a link capable of taking over an account is an administrative act in its own right, and it must be attributed to whoever performed it, whether or not the link is used.
6. **Redemption is a separate log row** (`user.password_changed`, with the account's owner as the actor). The two records together let an auditor say _who opened the door_ and _who walked through it_.
7. **The response is the member plus a raw `resetToken`**. The previous link is already dead by that point.

### 6.8 The list and a member's card

1. **The `users:read` permission**, with no `OriginGuard` — a GET changes nothing.
2. **The parameters:** `search` (up to 255 characters), `status` (one of three), `filter` (a JSON tree, up to 4096 characters), `page` (from 1), `pageSize` (up to 100, 10 by default). The numbers are coerced with `@Type(() => Number)`, because the global `ValidationPipe` transforms but does not convert implicitly.
3. **The search escapes LIKE metacharacters** (`\ % _`), so a query for “100%” looks for exactly “100%” rather than “100 and anything”.
4. **`?filter=` is parsed against the schema** and **intersected** (AND) with `search` and `status`; an invalid tree is a `400` from the filter engine. The string-length limit is a coarse first line before the engine's node-count and depth limits.
5. **Who passes `status`.** The member grid never does (it shows every status); it is used by the workspace-member typeahead, so as not to offer disabled and unaccepted people.
6. **Sorting is by name with an `id` tie-break**, that is, stable between requests, including rows with an empty name.
7. **`GET /users/:id` answers with the same `MemberView`**; an unknown identifier is a `404`. The body is not empty — it is Nest's `{"message":"Not Found","statusCode":404}` — but it is byte-identical whatever the reason, which is the property that matters. The permission is the same as the list's: the directory is open to everyone signed in anyway, so hiding “does this id exist” makes no sense.

### 6.9 A member's sessions as an administrator sees them

The “Sessions” tab on a member's card is **other people's routes**: `GET /api/users/:id/sessions` and `DELETE /api/users/:id/sessions/:sessionId` are implemented in `identity-server`, because the `sessions` table is its. users-admin only renders them. A session's card shows the device, the IP, and the creation and last-use times; the administrator's own session carries a `current` flag, and its revoke button is **disabled** — so that you cannot throw yourself out of your own workstation.

### 6.10 A member's workspaces

The “Workspaces” tab also reaches outwards: adding is `POST /api/workspaces/:id/members` and removing is `DELETE /api/workspaces/:id/members/:userId`, both belonging to `workspaces-server`. The only thing users does to memberships _with its own hands_ is inserting them at invitation time through the port. The workspace list for the wizard and the add dialog comes from `GET /api/workspaces` and is cached for a minute.

### 6.11 Personal preferences and the visual theme

The card's “Settings” tab is the plugin's **only self-service** surface, and it is open only on one's own profile. It reads and writes `GET`/`PUT /api/preferences` (identity's routes, bound to the `@CurrentUser()` rather than to an identifier in the path). The same request feeds the invisible `ThemeSync` component nested in the sidebar's footer: it pulls the saved theme into the shared `AppearanceProvider`, so that the choice applies across the whole application even if the person never opened the settings tab.

### 6.12 The copilot tool

1. **Registration is optional.** `WorkspaceCopilotToolProvider` injects the `ToolRegistry` through `@Optional()` and registers in `onModuleInit`. A deployment without the copilot and without MCP simply does not get this tool — there is no error.
2. **One tool, read-only.** `workspace_members_list` with `readOnly: true`, `effect: 'read'`, `requires: ['users:read']`, `surfaces: ['copilot']` — it is not offered to the MCP surface.
3. **The page size is bounded twice:** in the JSON schema (`maximum: 50`) and in the handler (a `Math.min`). The schema validator is defence in depth, not the boundary.
4. **The scope is the run's workspace** (`ctx.workspaceId`), not the whole installation.

## 07. HTTP API

Every path carries the global `/api` prefix the host sets. Legend: `public` — no session (there are **none of these** in this plugin), `session` — a valid session is required, `permission` — a session plus the named permission. Every mutating route additionally carries `OriginGuard`, and every identifier in a path passes through a `ParseUUIDPipe`.

### The routes the plugin owns

| Method and path                | Access and guards     | Input                                      | Success                                                         | Failures                                                                                                                                             |
| ------------------------------ | --------------------- | ------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET /users                     | `users:read`          | `?search=&status=&filter=&page=&pageSize=` | `{ items, total, page, pageSize }` — an array of `MemberView`   | `401`; `403`; `400` — a `pageSize>100`, a `page<1`, a `search` longer than 255, a `filter` longer than 4096 or unparseable                           |
| GET /users/:id                 | `users:read`          | a uuid in the path                         | a `MemberView`                                                  | `404` an unknown member (body `{"message":"Not Found","statusCode":404}`, identical for every cause); `400` a non-uuid; `401`; `403`                 |
| POST /users/invites            | `users:create` Origin | `{ email, role, name?, workspaceIds?[] }`  | a `MemberView` + an `inviteToken` — **the raw token, once**     | `409 EMAIL_TAKEN`; `400` an invalid address, an unknown role, a whitespace name, non-unique or non-uuid workspace identifiers, an extra field; `403` |
| PATCH /users/:id               | `users:update` Origin | `{ name?, role? }`                         | a `MemberView` (fresh)                                          | `404`; `409 SELF_ACTION` for your own role; `409 LAST_ADMIN_PROTECTED`; `400` a whitespace name or an unknown role; `403`                            |
| POST /users/:id/disable        | `users:update` Origin | a uuid in the path                         | a `MemberView` with `status: 'disabled'`; every session revoked | `409 SELF_ACTION`; `409 LAST_ADMIN_PROTECTED`; `409 INVALID_MEMBER_STATE` for a non-active member; `404`; `403`                                      |
| POST /users/:id/enable         | `users:update` Origin | a uuid in the path                         | a `MemberView` with `status: 'active'`                          | `409 INVALID_MEMBER_STATE` for a non-disabled member; `404`; `403`                                                                                   |
| POST /users/:id/invites/resend | `users:create` Origin | a uuid in the path                         | a `MemberView` + a new `inviteToken`                            | `409 INVALID_MEMBER_STATE` for a non-pending member; `409 INVITE_RECENTLY_SENT` + a `retryAfterSeconds`; `404`; `403`                                |
| DELETE /users/:id/invites      | `users:delete` Origin | a uuid in the path                         | `204`, with no body                                             | `409 INVALID_MEMBER_STATE` for a non-pending member; `404`; `403`                                                                                    |
| POST /users/:id/password-reset | `users:update` Origin | a uuid in the path                         | a `MemberView` + a `resetToken` — **the raw token, once**       | `409 INVALID_MEMBER_STATE` for a non-active member; `409 PASSWORD_RESET_RECENTLY_SENT` + a `retryAfterSeconds`; `404`; `403`                         |

### A conflict's body: a machine code next to the text

Every `409` in this package has the shape `{ statusCode, error, message, code }`, where `code` comes from the `MEMBER_ERROR_CODES` catalogue. The first three fields are repeated **deliberately**: when handed an object, Nest replaces the body entirely, and adding a `code` was not meant to take away what clients already read.

| Code                         | When                                                                                                                 | Extra fields      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------- |
| EMAIL_TAKEN                  | An invitation to an address that already belongs to an account (the comparison is case-insensitive)                  | —                 |
| LAST_ADMIN_PROTECTED         | Demoting or disabling the last active administrator                                                                  | —                 |
| SELF_ACTION                  | Disabling your own account or changing your own role                                                                 | —                 |
| INVALID_MEMBER_STATE         | The operation does not apply to the current status (a reset for a `pending` member, a revoke for an `active` one, …) | —                 |
| INVITE_RECENTLY_SENT         | Reissuing an invitation sooner than 60 s                                                                             | retryAfterSeconds |
| PASSWORD_RESET_RECENTLY_SENT | Reissuing a reset link sooner than 60 s                                                                              | retryAfterSeconds |

The maintenance rule: **a `code` is part of the contract — codes are added to, never renamed.** The English `message` stays alongside as a debugging fallback. A new code is added to `MEMBER_ERROR_CODES` and the domain error is given a `readonly code: MemberErrorCode` field — typing it as a union rather than a `string` is what makes `conflict()` reject a code outside the catalogue.

### The routes this plugin's admin UI merely uses

| Method and path                        | Owner             | Access              | Where it is shown                                     |
| -------------------------------------- | ----------------- | ------------------- | ----------------------------------------------------- |
| GET /users/:id/sessions                | identity-server   | `users:update`      | The “Sessions” tab on a member's card                 |
| DELETE /users/:id/sessions/:sessionId  | identity-server   | `users:update`      | The “Revoke” button on a session's card               |
| GET /preferences                       | identity-server   | `session`           | The “Settings” tab and the invisible `ThemeSync`      |
| PUT /preferences                       | identity-server   | `session`           | The theme switcher                                    |
| POST /workspaces/:id/members           | workspaces-server | `workspaces:update` | The “Add to workspaces” dialog                        |
| DELETE /workspaces/:id/members/:userId | workspaces-server | `workspaces:update` | A membership card on the “Workspaces” tab             |
| GET /workspaces                        | workspaces-server | `workspaces:read`   | The invitation wizard's third step and the add dialog |
| POST /auth/logout                      | identity-server   | `public`            | The “Sign out” item in the account menu               |

All nine of its own routes are documented in the generated OpenAPI (via `@ApiProperty`/`@ApiPropertyOptional` decorators on the DTOs), which a running server serves as a Scalar reference at `/reference`.

## 08. The admin UI: routes, screens, states

The admin plugin contributes **three** routes and **three** elements into two of the shell's slots. Every page is lazily loaded (`React.lazy` + `Suspense`) — a member directory is far from needed in every content session.

| Route         | Screen             | What it does                                                                  | Gate                                                                       |
| ------------- | ------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| /users        | `MembersPage`      | The directory: search, the query builder, the table, pagination               | `users:read` — otherwise a “no access” screen and **not a single request** |
| /users/invite | `InviteMemberPage` | A three-step wizard: details → role → workspaces, then the issued-link screen | `users:create` — otherwise a `<Navigate to="/users" replace />`            |
| /users/:id/\* | `UserDetailRouter` | A member's card: its own nested router over seven tabs                        | `users:read` on the layout; the tabs are gated separately                  |

The order in the router matters: the static `/users/invite` is declared before the splat route `/users/:id/*`, so the word “invite” will not be parsed as a member's identifier.

### The member card's seven tabs

| Tab            | Path        | Contents                                                          | Who sees it                                                                                            |
| -------------- | ----------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| General        | general     | Editing the display name; the address is shown read-only          | Everyone with `users:read`; only `users:update` can edit the fields                                    |
| Role           | roles       | A `RolePicker` over three roles + a confirmation                  | Everyone; the control is disabled on `self`, `lastAdmin`, `customRole`                                 |
| Workspaces     | workspaces  | Membership cards + the add dialog (workspaces' routes)            | Everyone with `users:read`                                                                             |
| Sessions       | sessions    | Live sessions and revocation (identity's routes)                  | **`users:update`**; otherwise the tab is hidden **and** the route redirects to `general`               |
| Activity       | activity    | `useActivityLog` from `activity-admin`, pinned to the `subjectId` | **`activity:read`**; likewise hidden and redirecting                                                   |
| Sign-in access | access      | Disabling/re-enabling **plus** the reset-link issuance card       | **`users:update`**; the tab's heading carries a “Disabled” marker when the status is `disabled`        |
| Settings       | preferences | The Light / Dark / System theme                                   | **Your own profile only** (`auth.user.id === member.id`); on someone else's it is hidden and redirects |

> **The gate is at the route level, not only on the tab**
>
> Hiding a tab is not enough: a bookmark or a direct link to `/users/:id/sessions` would go around such “hiding”. So every protected route inside `UserDetailRouter` either renders the page or returns a `<Navigate to="../general" replace />`. An unknown subpath is also sent to `general`. This is interface honesty on top of the server's check, not a replacement for it.

### The screens' states

| State         | The members screen                                                                                                     | A member's card                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| No permission | `MembersNoAccess`: the page heading is in place, the body is an explanation, and there are no requests                 | The same `MembersNoAccess`, with the read disabled by the `enabled` flag               |
| Loading       | `MembersTableSkeleton` — skeleton rows rather than a spinner                                                           | Skeletons of the hero, the stats bar and the tabs                                      |
| Error         | An `Alert role="alert"` with a “Retry” button (`refetch`)                                                              | A `404` → a separate “this member no longer exists”; anything else → a retryable error |
| Empty         | Two different texts: “nobody found” with a clear-search button **or** “there are no members yet” with an invite button | Not applicable                                                                         |
| Success       | A six-column table: Member, Role, Status, Workspaces, Joined, Actions                                                  | Breadcrumbs, a back link, the hero, the stats bar, the tab strip                       |

**The subheading with the count is not shown while the count is unknown.** During the first load, or when the read failed, “0 people” would be a claim about the editorial roster rather than a description of what happened — so the subheading is simply absent.

### The shell's slots

| Slot                | Contribution                                                                                        | Why here specifically                                                                                                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SIDEBAR_NAV_SLOT    | The “Members” item, `group: 'directory'`, `order: 20`, the `Users` icon, `permission: 'users:read'` | Without a declared permission the item would be a dead link: the page would show “no access”, that is, the navigation would promise what it will not deliver                                                                                                                                  |
| SIDEBAR_FOOTER_SLOT | `ThemeSync` (`order: 0`, renders `null`) and `AccountMenu` (`order: 10`)                            | The footer is the only area the shell keeps mounted **both** in the global and in the workspace sidebar. In `SIDEBAR_SECTION_SLOT` the theme synchroniser would not run for someone arriving straight through a deep link into a workspace: the workspace shell replaces the section entirely |

**The account menu** is a full-width row in the footer (avatar, name, address) that opens a two-item dropdown: “My profile” (navigating to one's own card, `/users/:id`) and “Sign out” (identity's logout mutation). It takes the current user from `useAuth`.

### The cache and its boundaries

| Key                         | What it holds                     | Specifics                                                                                                                                                                                                                                         |
| --------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| \['members'\]               | The root: lists and cards         | Invalidated wholesale after almost any mutation — the changed row may be on any page                                                                                                                                                              |
| \['members','list',params\] | One page of the list              | `keepPreviousData`: on a page or search change the old rows stay on screen and the table does not flash empty                                                                                                                                     |
| \['members','detail',id\]   | One card                          | Read once by the layout and handed to every tab through the Outlet context — moving between tabs is free                                                                                                                                          |
| \['member-sessions',id\]    | A member's sessions               | **A separate root, not a nesting inside `detail`.** TanStack matches keys by prefix, and nesting would make every member edit invalidate every session list — which at `staleTime: 0` is an immediate refetch of something a rename cannot affect |
| \['preferences',userId\]    | Personal preferences              | Keyed by the **identifier** rather than a flat `'me'`: at `staleTime: Infinity`, another user signing in on the same machine would otherwise read someone else's theme and never correct it                                                       |
| \['workspace-options'\]     | The workspace list for the picker | `staleTime: 60_000`, with loading deferred until the wizard's relevant step                                                                                                                                                                       |

Two mutations do **not** invalidate: resending an invitation and issuing a reset link. Neither changes a single field visible in the list, and an extra refetch of the member list on their account would be pure waste.

### Accessibility and destructive actions

- **A confirmation instead of an instant action.** “Revoke invitation” (which deletes a blank account) and “Disable” (which throws a person out everywhere) go through a `ConfirmDialog` with **the member's name in the heading**. They used to fire straight from `onSelect`: one extra “down” press past “Resend” destroyed an account before the key was released, and the first feedback was a success toast (WCAG 3.3.4).
- **Focus is restored by hand.** Radix returns focus to whatever opened the overlay — but what opened it was the row's “kebab” button, and the row has just unmounted. Focus would fall onto `<body>` and a keyboard user would start from the top of the document (WCAG 2.4.3). So the row's menu explicitly targets a stable anchor: its own kebab button when the row survives (disabling, resending), and the results region's anchor when it does not. The move is deferred to a `requestAnimationFrame`, so as not to race Radix's own focus restoration.
- **The anchor wraps all four result states** (skeleton / error / empty / table) rather than the table alone: revoking the last row on screen replaces the table with an empty state — that is, a table-level anchor would unmount at exactly the moment it is needed.
- **Accessible names carry the target.** Each session's visible label is simply “Revoke”, so the `aria-label` names the device and the last-active time, and **so does the dialog's heading**: a dialog's accessible name is its heading, and “Revoke this session?” on all four cards tells a screen-reader user nothing.
- **The result count is announced.** Search and filtering change the table without navigation, so the number found is mirrored into a hidden `role="status" aria-live="polite"` (WCAG 4.1.3).
- **The document's title** is set through `useDocumentTitle` — otherwise every private route would simply be called “Admin” (WCAG 2.4.2).
- **The page is pulled back into range.** After a mutation or a narrowing filter there may be fewer pages than the current number; an effect pulls `page` back — but only once the response has arrived, otherwise a deep link of `?page=3` would be reset to the first page before the first load.

### Handing links over in person

Both links — the invitation and the reset — are built in the browser: `inviteLinkFor()` and `passwordResetLinkFor()` take `window.location.origin` and append identity's path (`/identity/accept-invite` or `/identity/reset-password`) with the token in the query. The administrator is _already looking_ at the application on the address the invitee must arrive at — so the origin is correct by construction: there is no `publicBaseUrl` to get wrong and no `Host` header to forge. A server-side base address will only be needed once email delivery exists.

> **Losing a link is irreversible — and the interface knows it**
>
> Esc, a click on the backdrop and the close cross are three reflexive ways to close a dialog, and a resend has **already** rotated the token. So `InviteLinkDialog` tracks whether “Copy” was pressed and **intercepts the first attempt to close the dialog without copying**, showing a warning; after copying it closes freely. The wizard's “invitation created” screen registers with the shared unsaved-changes guard (`useUnsavedChanges`) — which covers links, programmatic navigation and a reload (`beforeunload`), none of which any single component can intercept. The wizard **deliberately does not navigate away** after success: leaving would throw away the link's only copy.
>
> For a reset this protection matters even more: the server refuses to reissue within a minute, so closing the dialog without copying cannot be fixed even immediately.

### Client-side UX invariants

`MemberEntity` is a thin wrapper over the member model that returns `{ ok, reason }` rather than a boolean, so that a control can **explain itself** instead of merely being greyed out:

| Method                  | Refusal reasons                                                                                                                                                                          | Where it is applied                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| canChangeRole(viewerId) | `self` — your own account; `lastAdmin` — the only active admin; `customRole` — a role outside the three assignable ones, which a three-way switch can neither display nor safely replace | The “Role” tab                                                               |
| canBeRemoved(viewerId)  | `self`, `lastAdmin`. Re-enabling is never blocked, so callers apply the check only to the “disable” direction                                                                            | The “Disable” item in the row menu, the “Suspend” button on the “Access” tab |

**Both methods require the viewer's identifier.** The server refuses actions on yourself, and a guard that does not know who is asking would mirror only half the rules — which is exactly how the “Role” tab once invited a click that could not succeed and answered with a generic “please try again”.

> **The mapper does not invent a role**
>
> The server's `Role.create` accepts any non-empty key, that is, a custom role is a shape the admin UI must expect. A key outside the three system ones turns into `role: null` and **not** into a guessed `viewer`: substituting one would assert a privilege level the person does not have. From then on everything displays the `roleName` — the server's own label — and refuses to offer a change.

## 09. Configuration

**The plugin has no configuration of its own.** `UsersPlugin()` is called with no arguments, so is `UsersModule.forRoot()`, and the plugin's type is a plain alias of `ServerPlugin` with no `config` field. Nevertheless the plugin **reads two values from someone else's configuration**, and four more are fixed as constants.

| Value                           | Where from                                                 | Value                                        | What it affects                                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| token.inviteTtlSeconds          | identity's configuration, through `InjectIdentityConfig()` | Set by the deployment (`INVITE_TTL_SECONDS`) | The lifetime of an issued invitation link. Seven days used to be hard-coded here, and a deployment that configured the variable silently got nothing         |
| token.resetTtlSeconds           | identity's configuration                                   | Set by the deployment                        | A reset link's lifetime. A separate knob deliberately: a reset is handed to a person standing right there, while an invitation may sit in a mailbox for days |
| DEFAULT_PAGE_SIZE               | A package constant                                         | **10**                                       | `GET /users`'s default page size; mirrored in the admin UI as a fallback for computing the page count before the first response                              |
| MAX_PAGE_SIZE                   | A package constant                                         | **100**                                      | The ceiling on `?pageSize=`; anything larger is a `400`                                                                                                      |
| FILTER_MAX_LENGTH               | A package constant                                         | **4096**                                     | The maximum length of the raw `?filter=` string — a coarse line before the filter engine's own limits                                                        |
| INVITE_RESEND_COOLDOWN_SECONDS  | A package constant                                         | **60**                                       | The window during which a resend is rejected                                                                                                                 |
| PASSWORD_RESET_COOLDOWN_SECONDS | A package constant                                         | **60**                                       | The window during which a reissued reset is rejected                                                                                                         |
| MAX_TOOL_PAGE_SIZE              | A copilot-tool constant                                    | **50**                                       | The page ceiling for `workspace_members_list`; mirrored in the JSON schema and in the handler                                                                |

<details>
<summary>Why the cool-off windows are constants rather than settings</summary>

They protect not against abuse but against a **double click**: their point is that the interval is reliably shorter than the human pause between “pressed” and “realised I pressed twice”. A configurable knob here would give an operator the chance to set zero and bring back exactly the defect the window exists for — or to set an hour and turn fixing a typo in an address into an incident. The page sizes follow the same logic: they are an API contract rather than an environment parameter.

</details>

## 10. Security and resilience

#### A secret lives for exactly one response

Invitation and reset tokens are 32 random bytes; only a SHA-256 goes into the database. The raw value exists in three API responses and nowhere else: not in the list, not on a card, not in the log, not in a dump. From which it also follows that **the server cannot “repeat” an issuance** — only issue a new one, killing the previous.

#### Disabling shares a transaction with revoking sessions

The status flag and every session's `revoked_at` commit together. That is the primary line but not the only one: identity refuses to open a session for a non-`active` account and refuses to resolve an existing session into a non-`active` user — which covers a sign-in that committed simultaneously with the disabling.

#### The “at least one admin” invariant is protected by a lock, not by a check

The advisory lock is taken **on the load that precedes the check** and held to the end of the transaction. A “count, then write” scheme under READ COMMITTED allows two transactions both to see “there are two admins” and both to demote — the lock makes those sections mutually exclusive.

#### The lock is taken only where it might be needed

Its key is a single one across the whole deployment, so a pure rename loads without it, and re-enabling all the more so. Otherwise every member edit in the installation would queue in one global line for the sake of an invariant it cannot break.

#### The per-user token locks are in separate spaces

Invitations use `0x494e5654` and resets `0x52534554`, both paired with a `hashtext(userId)`. A shared space would mean a reset for one person blocking on an invitation rotation for another whose identifier happened to hash into the same slot.

#### The window check is inside the lock

If the cool-off window were checked in the use case, two simultaneous resends would both read “there is no recent token” and both rotate — precisely the race the lock exists for.

#### CSRF: Origin before permissions

All five mutating controllers carry `@UseGuards(OriginGuard, PermissionsGuard)` in exactly that order. The package once shipped without that guard at all, and that was latent only thanks to the session cookie's `SameSite=Lax`; the `origin-guard.spec.ts` e2e suite pins down every mutation, so that a change of cookie policy cannot bring the defect back.

#### Address uniqueness rests on an index, not on a check

The pre-check exists for the sake of an intelligible message; the real guarantee is a case-insensitive unique index, and its violation (a `23505`, including one wrapped in a `cause`) is recognised and turned into the same `409 EMAIL_TAKEN`.

#### The copilot's scope is narrower than the permission

`users:read` allows enumerating every account in the deployment. The copilot tool does not do that: it reads a separate, workspace-bounded query. Extending the general directory with a “workspace” parameter was deliberately rejected — it would have dragged a workspace through the entire member-list contract for a caller that needs strictly less.

#### Auditing the issuance, not only the use

The log row about issuing a reset link is written at issuance time. Handing over a link capable of taking over an account is an administrative act in its own right, and it is attributed to whoever performed it, even if the link was never used.

### The interface's resilience

- **An unknown workspace identifier does not fail an invitation** — it is simply filtered out. A stale link in a form must not cost a person their access to the system.
- **A missing seeded system role is a `500`, not a `400`.** Roles are seeded at startup; their absence means a broken deployment rather than bad input, and masking that as a client error would be harmful.
- **The background theme sync is silent on failure** — a background fetch is not worth a toast on every route. But it is not silent everywhere: the “Settings” tab reads the same query and shows the error where something can be done about it.
- **The read model is re-read outside the transaction.** After a mutation the controllers call `MemberViewQuery`, which works on the base connection — so they see committed rather than intermediate state.

### What is deliberately absent

- Rate limiting (a `Throttler`) on users' routes — all of them require a session and administrator rights.
- Bulk operations: you cannot invite a list of addresses or disable a group in one call.
- Deleting a real account — only disabling; content authorship and a history stand behind the row.
- Changing your own name through a separate route — the edit goes through the same `PATCH` and requires `users:update`.
- Per-workspace permissions: a role is global and membership is a separate plane.

## 11. Invariants

Statements that must always hold. At once a review checklist and a draft set of test assertions.

- **I-01** — There is always **at least one active administrator** in the system: the last one can be neither demoted nor disabled. The check runs against a counter read under a global advisory lock taken when the aggregate is loaded.
- **I-02** — A member cannot **disable themselves** and cannot **change their own role**. They can rename themselves.
- **I-03** — Disabling and revoking sessions commit in **one transaction**: there is no “disabled but the sessions are alive” state, nor the reverse.
- **I-04** — A user has **at most one** live invitation token and **at most one** reset token at a time. This is ensured by a delete+insert pair under a per-user lock.
- **I-05** — The raw token is returned by **exactly three** routes (inviting, resending, issuing a reset) and **exactly once**. No read carries it.
- **I-06** — Rotating a token sooner than 60 s is rejected with a `409` carrying a `retryAfterSeconds`; the check runs inside the same lock as the rotation itself.
- **I-07** — Through this API **only** a row with the `pending` status can be deleted. A real account is never deleted.
- **I-08** — A reset link is issued **only** to a member with the `active` status; `pending` and `disabled` are a `409`.
- **I-09** — Resending an invitation is possible **only** for `pending`; disabling only for `active`; re-enabling only for `disabled`.
- **I-10** — An address is unique case-insensitively; the guarantee is a unique index on `lower(email)`, not a check in the code.
- **I-11** — A member's name, when set, cannot be empty or made of spaces: both DTOs trim the value **before** validation.
- **I-12** — Every mutating route is closed by `OriginGuard` and every route by `PermissionsGuard` with a permission constant; the package has no public routes.
- **I-13** — The package owns no table and ships no migrations; every write goes into a table migrated by identity or workspaces.
- **I-14** — Every state change raises **exactly one** event of the corresponding kind into the transactional outbox, with the actor attached, in the same transaction as the write.
- **I-15** — The `domain/` layer imports neither `@nestjs/*` nor `drizzle-orm` nor `class-validator` nor `infrastructure/`.
- **I-16** — The `isLastAdmin` flag is advisory: it affects only the state of controls, and its divergence from reality cannot lead to a violation of I-01.
- **I-17** — The copilot tool answers with **only** the members of the current run's workspace and returns neither tokens nor session data.
- **I-18** — The module is not global and exports nothing from DI: none of the package's providers is available to its neighbours.

## 12. Testing checklist

The wording is “action → expected result”, so items can go into a test case without rewriting. The server side is checked with `curl` + `psql`, the admin side in a browser. The existing suites are `apps/server-e2e/src/server/users/*` (9 files) and `apps/admin-e2e/src/users/*` (11 files, `a11y` and `keyboard` included).

### Inviting

- **Invite a free address** → 201 (no `@HttpCode`, so Nest's default for a POST); a `users` row with `status='pending'` and `password_hash IS NULL`; a `tokens` row with `type='invite'`; a non-empty `inviteToken` in the response.
- **Compare the `inviteToken` with `tokens.token_hash`** → they do not match; the hash equals the SHA-256 of the token.
- **Invite an address in a different case** (`Grace@…` when `grace@…` exists) → 409 with `code: "EMAIL_TAKEN"`.
- **Two simultaneous invitations to one address** → exactly one succeeds and the second is a 409 `EMAIL_TAKEN` (the index fired, not the check).
- **A name of nothing but spaces** → 400, rather than a stored empty string.
- **A role outside the three keys** → 400 from the `@IsIn`.
- **An extra field in the body** → 400 from the `ValidationPipe`.
- **A non-existent `workspaceIds`** → 201; the invitation is created, the membership is not, and there is no error.
- **Duplicates in `workspaceIds`** → 400 from the `@ArrayUnique`.
- **Check the list after inviting** → the new row is visible with the “Invited” status; the `inviteToken` is **absent** from the list's body.

### Resending and revoking an invitation

- **Resend immediately after inviting** → 409 `INVITE_RECENTLY_SENT` with a `retryAfterSeconds` in the 1…60 range.
- **Age the token, then resend** → 201; `tokens` still holds **one** `invite` row for the user, with a changed hash.
- **Try the old link after a resend** (`GET /api/auth/invite/:token`) → 404: the previous link is dead.
- **Two simultaneous resends after the cooldown** → exactly one succeeds; one live token remains.
- **Resend to an active member** → 409 `INVALID_MEMBER_STATE`.
- **Revoke an invitation** → 204; the `users` row is gone; the token and the provisional memberships went with it, by cascade.
- **Revoke the invitation of an active member** → 409, the account is untouched.
- **The journal after a revoke** → the `user.invite_revoked` row with the address survives, even though the account no longer does.
- **Revoke a nonexistent id** → 404; a non-uuid — 400.

### The last administrator, and acting on yourself

- **Demote the only active admin** → 409 `LAST_ADMIN_PROTECTED`; the role did not change.
- **Disable the only active admin** → 409 `LAST_ADMIN_PROTECTED`; the status did not change, the sessions are alive.
- **Disable yourself** → 409 `SELF_ACTION`; no transaction was ever opened.
- **Change your own role** → 409 `SELF_ACTION`.
- **Rename yourself** → 200: that one is allowed.
- **Two admins, two simultaneous requests to demote each other** → one succeeds, one 409s; the system is left with one active admin.
- **Demote an admin while the second admin is `disabled`** → 409: only _active_ admins count.
- **Send a `PATCH` carrying the same role** → 200 with no write and no events; the “last admin” and “yourself” checks do not fire.

### Disabling, enabling, sessions

- **Disable an active member holding a live session** → 201; `users.status='disabled'`; every one of their `sessions` rows has `revoked_at` stamped.
- **The disabled member's next request** → 401; the tab shows a toast and sends them to the sign-in page.
- **Disable someone already disabled** → 409 `INVALID_MEMBER_STATE`.
- **Enable a disabled member** → 201; status `active`; the revoked sessions do **not** come back to life.
- **Enable an active or an invited member** → 409.
- **An observer opens `GET /users/:id/sessions`** → 403 (the `users:update` permission).
- **Revoke your own session from the card** → the button on the card marked “current” is disabled.

### Password reset

- **Issue a link to an active member** → 201; the response carries a `resetToken`; a `tokens` row with `type='reset'`; a `user.password_reset_issued` journal row with the administrator as the actor.
- **Issue a second one immediately** → 409 `PASSWORD_RESET_RECENTLY_SENT` with a `retryAfterSeconds`.
- **Issue one to a `pending` member** → 409 `INVALID_MEMBER_STATE`.
- **Issue one to a `disabled` member** → 409 `INVALID_MEMBER_STATE`.
- **Redeem the link through `POST /api/auth/reset`** → 201; every session of the member is revoked; no cookie is issued; a **second** journal row appears, with the account's owner as the actor.
- **Feed an invite token to the reset route** → 404: the `type='reset'` predicate keeps the two purposes from being confused.
- **Issue a second link after the cooldown, then open the first** → the first is dead (404), only the latest works.
- **A contributor calls the reset route** → 403.

### The list, search, filters

- **Ask for `?pageSize=101`** → 400.
- **Ask for `?page=0`** → 400.
- **Search for a substring containing `%`** → treated literally, not as a LIKE metacharacter.
- **Search by a fragment of the address and by a fragment of the name** → both find it, and the comparison is case-insensitive.
- **`?status=active`** → invited and disabled members are absent from the result.
- **Filter by `role.key = admin`** → administrators only; `total` agrees with the number of rows.
- **Filter and search at once** → the conditions intersect (AND) rather than replacing one another.
- **Broken JSON in `?filter=`** → 400, not 500.
- **A `?filter=` longer than 4096 characters** → 400 from the DTO, before the filter engine.
- **Two consecutive pages of members sharing the same name** → rows are neither repeated nor lost (the tie-break on `id`).
- **A member with no name** → takes part in the sort and does not break the listing.

### Permissions and route guards

- **An observer opens `GET /users`** → 200: the directory is open to every role.
- **An observer invites / edits / disables / revokes** → 403 on each of those routes.
- **A contributor invites** → 403 (only the admin holds `users:create`).
- **Any mutation with a foreign `Origin`** → 403; the state did not change.
- **A mutation with no `Origin` header** (curl) → goes through.
- **A `GET` with a foreign `Origin`** → goes through: reads deliberately have no guard.
- **Any route without a session** → 401.
- **A non-uuid in the path** → 400, before the business logic.

### The admin UI: the members screen

- **Sign in as an observer** → the “Members” item is in the sidebar, the “Invite” button is not, and the row actions are trimmed.
- **Take away `users:read`** → the navigation item disappears, a direct visit gives the “no access” screen, and no network requests are made.
- **The first load** → skeleton rows rather than a spinner; the counter subtitle is absent while the counter is unknown.
- **The API answers 500** → an alert with a “Retry” button, not an empty table.
- **An empty database** → “no members yet” with an invite button; with a search that matches nothing — different text, with a button that clears the search.
- **Go to page 3, then revoke rows until only 2 pages are left** → the page number is pulled back, and an empty page is never shown.
- **Open the deep link `?page=3`** → page three does open; there is no reset to the first page before the load.
- **Search and filter** → both are reflected in the query string, so the link can be forwarded and yields the same view.
- **Change the search** → the number of matches is announced in a live region; the previous rows stay on screen until the new ones arrive.

### The admin UI: destructive actions and focus

- **Pick “Revoke invitation”** → a confirmation opens carrying the member's address; a single click does not delete.
- **Confirm the revoke of the last row on screen** → the table gives way to the empty state, and focus moves to the results region rather than to `<body>`.
- **Confirm a disable** → the row stays (the status badge changes), and focus returns to its kebab button.
- **The disable fails** → an error toast, focus on the kebab button, the dialog closed.
- **Walk the row menu with the keyboard alone** → every item is reachable, and a blocked “Disable” carries a visible reason in its tooltip.
- **Open a session card and revoke** → the confirmation heading names the device rather than “this session”; on success focus lands on the card's heading.

### The admin UI: invitations and links

- **Type an invalid address** → the step forward is blocked immediately; the message itself appears after the field is first left (`InviteMemberPage` gates it behind `emailTouched`, set on `onBlur`) and updates per keystroke thereafter.
- **Finish the wizard** → the page does **not** navigate back to the list; a screen with the link and a copy button is shown.
- **Try to leave the page without copying the link** → the unsaved-changes guard fires — on internal navigation and on a reload alike.
- **Close the resend dialog without copying** → the first close is intercepted with a warning; once the link is copied the dialog closes freely.
- **Check the link that was built** → the current tab's origin + `/identity/accept-invite?token=…` (for a reset — `/identity/reset-password?token=…`).
- **Open the invitation link in a different browser** → identity's accept-invitation screen with the address filled in.
- **Press “Generate link” twice in a row** → the second time — a toast with the exact number of seconds to wait, not a generic “something went wrong”.
- **Open the reset card for a `pending` and for a `disabled` member** → the button is blocked with the reason spelled out; no request is sent.

### The admin UI: the member card

- **Open the card without `users:update`** → the “Sessions” and “Sign-in access” tabs are hidden; a direct link to them lands on “General”.
- **Open the card without `activity:read`** → the “Activity” tab is hidden and unreachable by direct link.
- **Open somebody else's profile** → there is no “Settings” tab; a direct link lands on “General”.
- **Open your own profile** → the “Settings” tab is there, a theme change applies at once and survives a reload.
- **Switch between tabs** → the member is not re-fetched — the data is handed out through context.
- **Open the card of a deleted member** → the “this member no longer exists” state, not a generic error.
- **A member holding a custom (non-system) role** → the role's name is shown as the server gave it; the role switcher is blocked with a reason rather than falling back to “viewer”.
- **The “Role” tab on your own profile** → applying is blocked, with the “you cannot change your own role” explanation.
- **The “Role” tab for the only admin** → blocked, with a suggestion to appoint a second administrator first.
- **Add a member to a workspace, then go back to the list** → the “Workspaces” column has refreshed (the `members` root is invalidated).

### The account menu and the theme

- **Open the account menu in the sidebar footer** → the current user's name and address are visible, along with two items: “My profile” and “Sign out”.
- **“My profile”** → navigates to your own member card.
- **“Sign out”** → the session ends and the sign-in page appears; another user's cached data does not survive the switch.
- **Change the theme, then sign in from another device** → the theme was pulled from the server without ever opening the settings tab.
- **Enter the app straight through a deep link into a workspace** → the theme synchronised all the same: the synchroniser lives in the footer, which is mounted in both sidebar variants.
- **Sign in as a second user on the same machine** → their theme is shown, not the previous user's (the cache key carries the identifier).

## 13. Boundaries of responsibility

Users is a plugin where **almost everything adjacent belongs to a neighbour**. The table below answers “why isn't this in users?” for everything usually expected of it.

| Area                                                         | Who owns it                           | What users does                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The schema of accounts, roles, permissions, sessions, tokens | `identity-server`                     | Reads and writes somebody else's tables; ships **not one migration**                                                                                                                                                                                                               |
| Sign-in, sign-out, password verification, the session cookie | `identity-server`                     | Nothing; it merely uses the global `AuthGuard` and `PermissionsGuard`                                                                                                                                                                                                              |
| **Redeeming** an invitation and a reset                      | `identity-server`                     | **Issues** both links and decides who is entitled to them; identity redeems them (`POST /api/auth/invite/accept`, `POST /api/auth/reset`)                                                                                                                                          |
| The accept-invitation and change-password screens            | `identity-admin`                      | Only builds the link to those routes out of the raw token                                                                                                                                                                                                                          |
| Listing and revoking a member's sessions                     | `identity-server`                     | Draws the “Sessions” tab over somebody else's routes; it touches sessions itself **exactly once** — on disable, through a port                                                                                                                                                     |
| Personal settings and the theme                              | `identity-server`                     | Draws the “Settings” tab and keeps an invisible theme synchroniser in the sidebar footer                                                                                                                                                                                           |
| Workspaces and memberships                                   | `workspaces-server`                   | Inserts memberships at invite time through the `WORKSPACE_LINKER` port; deletion and every route belong to workspaces                                                                                                                                                              |
| The action journal                                           | `activity`                            | Emits `member.*` events into the outbox; the `user.*` rows are written by activity's subscriber, and the “Activity” tab is drawn by its hook                                                                                                                                       |
| Sending email                                                | `mail-server`, optionally             | Queues the invite, resend and reset messages through the `MAIL_DISPATCHER` port inside the token's own transaction. Injected `@Optional()`: with no mail plugin registered nothing is bound, nothing is sent, and the raw token is returned to the calling administrator as before |
| The agent tool registry                                      | `tools-server`                        | Registers one tool in it, optionally — with no registry present, the registration simply does not happen                                                                                                                                                                           |
| The database connection and running migrations               | `@ortha/database` + `@ortha/nx` | Gets the client through DI, and transactions through `UnitOfWork`                                                                                                                                                                                                                  |

### The boundary with identity, in one sentence

> **Who does what with a one-time link**
>
> **Users decides who is entitled to a link and issues it. Identity owns the table it sits in and redeems it.** Every derived fact follows: the TTL comes from identity's configuration, not users'; the `type` predicate separates an invitation from a reset on both sides; and the “active members only” check is duplicated in both plugins — users turns a dead link into an honest `409` up front, while identity refuses at redemption time.

### What the plugin still does not have

- **Email delivery** — and with it the whole self-service “forgot password” branch, which is impossible without it.
- **Bulk invites** — neither a list of addresses nor an import.
- **Deleting a real account** — only disabling.
- **Custom roles through the API** — only the three system keys can be assigned, even though the plugin can read and display an arbitrary role.
- **A “my sessions” screen** — the session list is available only to an administrator, and only by member id.
- **User-chosen list sorting** — the order is fixed (name, then `id`).

## 14. Where the code and the documentation diverge

Found while reconciling this dossier with the sources. Not product bugs in themselves, but they mislead developer and tester alike.

| Where                                                       | What it says                                                                                                                                                            | How it actually is                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| users/server/AGENTS.md, “Audit transition”                  | “Audit is **still recorded in-band** via the `ACTIVITY_RECORDER` token inside each use case… **Do NOT double-record**. Wave 3 moves auditing onto an outbox subscriber” | **Fixed 2026-08-30.** Wave 3 **has already happened**. The package contains not one mention of `ACTIVITY_RECORDER` and not one `recorder.record(...)` call; the use cases write only to the outbox, and the journal rows are created by a subscriber in `activity/server`. The `users.module.ts` docstring already says the right thing (“Auditing is no longer in-band”), so the documentation contradicts both the code and itself                                                  |
| member/application/member-activity.ts                       | Exports `USER_ACTIVITY_KINDS` as “kinds the users plugin records in-band”                                                                                               | **Fixed 2026-08-30.** **Dead code.** The constant is used nowhere in the package (it is only mentioned in two docstrings); the real catalogue is duplicated in `activity/server/…/audit-event-mapping.ts`, which says so there in as many words                                                                                                                                                                                                                                       |
| users/server/AGENTS.md, “The copilot tool”                  | “Registered by `copilotToolsRegistrar('workspace', …)` in `UsersModule.forRoot`, which injects the copilot registry **optionally**”                                     | **Fixed 2026-08-30.** No such function **exists** in the repository (it is mentioned only in other packages' comments, as an analogy). The provider registers the tool itself: `WorkspaceCopilotToolProvider` implements `OnModuleInit` and calls `this.toolRegistry?.register(this)`, with `@Optional()` on the registry injection. The resulting behaviour is the same, but the named mechanism does not exist                                                                      |
| users/server/AGENTS.md, “Architecture notes”                | “`origin-guard.spec.ts` pins all **five** mutations”                                                                                                                    | **Fixed 2026-08-30.** There are **seven** mutating routes, and the suite pins all seven: `PATCH /users/:id`, `POST /users/invites`, `disable`, `enable`, `invites/resend`, `DELETE /users/:id/invites`, `password-reset` (plus a “reads are unaffected” block)                                                                                                                                                                                                                        |
| users.module.ts, docstring                                  | “It takes no config: **the invite TTL** and page sizes are deliberate constants, not host knobs”                                                                        | **Fixed 2026-08-30.** True of the page sizes, false of the TTL: `InviteTokenService` and `PasswordResetTokenService` inject identity's configuration and read `token.inviteTtlSeconds` / `token.resetTtlSeconds`. That exact fact is the one `AGENTS.md` separately calls “load-bearing” — so the docstring reintroduces an already-fixed defect in the form of a claim                                                                                                               |
| domain/member.ts, the `rename` and `enable` docstrings      | “Raises no domain event (**the application records the … audit in-band**)”                                                                                              | The first half is true (the aggregate stays silent), the second is stale: the application does not “record an audit”, it mints `member.profile_updated` / `member.reactivated` events into the outbox                                                                                                                                                                                                                                                                                 |
| users/admin/AGENTS.md, “The pages”                          | “**Six** tab pages” — and then lists seven                                                                                                                              | There are **seven** tabs: General, Role, Workspaces, Sessions, Activity, Access, Preferences. `UserDetailRouter` carries exactly that many routes                                                                                                                                                                                                                                                                                                                                     |
| users/admin/AGENTS.md, “Destructive actions…”               | The focus anchor is called `MEMBERS_TABLE_ANCHOR_ID` — “the table wrapper”                                                                                              | **Fixed 2026-08-30.** In the code it is `MEMBERS_RESULTS_ANCHOR_ID` (`presentation/membersResultsAnchor`), and it wraps **all four** result states rather than the table. The difference matters: an anchor on the table would unmount when the last row is revoked — and that was the one case where focus was still being lost                                                                                                                                                      |
| presentation/usersPlugin, docstring                         | “…its toolbar nav entry, contributed to the shell's `NAVBAR_START_SLOT` at `order: 30` (after Workspaces)”                                                              | **Fixed 2026-08-30.** In the code the contribution goes to `SIDEBAR_NAV_SLOT` with `group: 'directory'` and `order: 20`; `NAVBAR_START_SLOT` is not imported in the file at all. Beyond that, the docstring speaks only of the `/users` route, whereas the plugin declares three routes and a second slot                                                                                                                                                                             |
| users/admin/AGENTS.md, “The pages”                          | The table is described as “**Member · Role · Status · Workspaces**”                                                                                                     | There are six columns: Member, Role, Status, Workspaces, **Joined** and the actions column with an accessible header                                                                                                                                                                                                                                                                                                                                                                  |
| presentation/membersFilterFields, docstring                 | “A static mirror of the server's `USERS_FILTER_SCHEMA`”                                                                                                                 | **Fixed 2026-08-30.** The server schema is called `MEMBER_FILTER_SCHEMA` (`member/application/member-filter.ts`); the identifier `USERS_FILTER_SCHEMA` does not exist in the repository                                                                                                                                                                                                                                                                                               |
| users/server/AGENTS.md, “Conflict bodies…”                  | The rationale for the codes: the client will be able to say “promote another admin first” instead of a generic message (WCAG 3.3.1 / 3.3.3)                             | Half of that promise is **not implemented** on the client. The `409` body is read only by `PasswordResetCard` (which distinguishes `PASSWORD_RESET_RECENTLY_SENT`). The “Role” tab and the row menu show generic text for any error; the actual reason reaches the user only because both controls are blocked **up front** through `MemberEntity`. There is no dedicated text for `INVITE_RECENTLY_SENT` either                                                                      |
| application/useAddWorkspaceMember, useRemoveWorkspaceMember | Invalidate `membersKeys.detail(userId)` first, then `membersKeys.all`                                                                                                   | The second subsumes the first: `all` is the prefix `['members']`, while `detail` is `['members','detail',id]`. The first call is redundant (harmless, but misleading to read)                                                                                                                                                                                                                                                                                                         |
| apps/server-e2e/src/server/users/                           | Nine suites cover the package's routes                                                                                                                                  | **Withdrawn — this entry was itself wrong.** `POST /users/:id/password-reset` is covered in full, including the cooldown, the refusal for `pending`/`disabled` and the rotation of the previous token — by `apps/server-e2e/src/server/auth/password-reset.spec.ts`, where the whole issue → redeem story lives because identity owns the redemption half. Looking only under `server/users/` found nothing and concluded there was nothing. Coverage does not follow directory names |

### What the QA pass changed (2026-08-30)

This dossier was reconciled against the code and a live stack. Five of its own statements did not survive that check and are corrected above: the success codes (POST answers **201**, not 200 — Nest's default, since no route sets `@HttpCode`), the “empty” 404 body, the claim that the password-reset route had no server suite, and the promise that the invite form's email error appears as you type. The drift entries that have since been fixed in the code are marked **Fixed**.

One product defect was found and fixed in the same pass: `PATCH /api/users/:id` with `{"name": null}` answered 200 and cleared the stored name, while `""` and `" "` were 400s. `@IsOptional()` skips the rest of the validator chain for `null` as well as `undefined`, and the use case tested presence with `!== undefined` — so the two layers disagreed about what counts as a supplied field. Invariant **I-11** now holds for all four spellings.

---

**One of a series.** Written for the `packages/users` group in the same frame as the `identity` dossier: business description → composition → permissions → data → lifecycle → scenarios → API → admin UI → configuration → security → invariants → checklist → boundaries → divergences. Sections the plugin has no use for would simply be dropped; here the only one dropped is its own tables — in its place the “Data model” lists whose tables the plugin uses.

The source is the source code: eight controllers, three DTOs, six use cases, the `Member` aggregate with its value objects and error catalogue, two one-time-token services, three port adapters, two query services, the copilot tool provider; and on the admin side — the plugin factory, three routes, seven tabs, sixteen hooks, the gateway, the mapper and the cache keys. The `AGENTS.md` files were used as the frame, but every claim was checked against the implementation — the divergences are gathered in section 14.
