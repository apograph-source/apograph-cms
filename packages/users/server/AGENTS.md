# @orthacms/users-server

The users **plugin** for the Ortha CMS server: the member-management API the
admin's Members page drives. Exposes, under `/api/users`:

- `GET /users` — searchable (`?search=`, name/email `ILIKE`), paginated
  (`?page=&pageSize=`, 1-based) member list; each row joins the global role, the
  member's workspaces, and a server-computed `isLastAdmin` flag the UI uses to
  disable guarded controls. Also honours a query-builder `?filter=` tree.
- `GET /users/:id` — one member's full view (the same `MemberView` the list
  returns), backing the admin user detail page; `users:read`, 404 on unknown id.
- `POST /users/invites` — invite by email: creates a `pending` user + invite
  token, and optionally links the new member to `workspaceIds` (memberships;
  unknown ids are ignored). **No email is sent yet** (`TODO(users-email)`,
  identity epic #11), so the response is an `InvitedMemberView` — the member row
  plus the raw `inviteToken`, returned **once** for the admin to turn into a
  link. Only its hash is stored; the list and detail reads never carry it.
- `PATCH /users/:id` — edit display name and/or role.
- `POST /users/:id/disable` / `POST /users/:id/enable` — flip account status;
  disabling also revokes the member's live sessions.
- `POST /users/:id/invites/resend` — rotate a pending member's invite token,
  returning the fresh one the same reveal-once way. Rotation kills the link the
  invitee may already hold, so handing the new one over is the rest of the
  operation, not a nicety.
- `DELETE /users/:id/invites` — revoke a pending invite by deleting the
  placeholder row (cascades drop token + memberships). Real accounts are
  **never deleted** through this API.
- `POST /users/:id/password-reset` — mint a single-use password-reset link for
  an **active** member (`users:update`), returned the same reveal-once way. This
  is the whole password-recovery story today: with no mailer, a public "forgot
  password" form would have nowhere to send a link, so the flow runs through an
  admin. Redeeming the link is identity's job (`POST /api/auth/reset`); this
  context only decides **who** may be reset. 409s a `pending` member (no
  password yet — resend their invite) and a `disabled` one (locked out on
  purpose).

> **Layered per ADR-0003 (tactical DDD inside plugins).** This is Wave 2 of the
> migration; the structure copies the `@orthacms/workspaces-server` pilot —
> when a layering question is ambiguous, that package is the worked example.

## Layered layout

Organized into the four tactical-DDD layers under `src/lib/member/`:

```
domain/          # framework-free core — the one hard rule below
  member.ts                        # Member aggregate root (identity's users row)
  member.repository.ts             # MemberRepository PORT + MEMBER_REPOSITORY symbol
  value-objects/                   # MemberId, Role, MemberStatus
  events/member-events.ts          # domain-event factory + kinds (member.*)
  errors/                          # transport-agnostic domain errors
application/     # orchestration — one use case per state change
  use-cases/                       # invite / update / set-status / resend-invite / revoke-invite
                                   # + issue-password-reset
  queries/member.view.ts           # read-model view types (MemberView …)
  ports/                           # secondary ports (SESSION_REVOKER, WORKSPACE_LINKER)
  dto/                             # class-validator DTOs (shape checks only)
  member-filter.ts                 # query-builder filter schema
infrastructure/  # adapters — the only layer that knows Drizzle/pg
  persistence/  # DrizzleMemberRepository, MemberMapper, member-lock, InviteTokenService,
                # PasswordResetTokenService, DrizzleSessionRevoker, DrizzleWorkspaceLinker
  queries/      # MemberViewQuery (the paginated list + byId read model)
http/            # thin controllers (routes/permissions/error-mapping unchanged)
member.constants.ts                # page sizes, filter length cap
```

## The one hard rule

**`domain/` imports NOTHING from `@nestjs/*`, `drizzle-orm`, `class-validator`,
or `infrastructure/`.** It may use `@orthacms/database`'s framework-free
`createDomainEvent`/`DomainEvent` and node built-ins only. The layer-boundary
lint isn't wired yet — self-enforce it.

## The aggregate

`Member` is the aggregate root — a person who can authenticate, mapping to
identity's `users` row (a single global `Role` + a `MemberStatus`). Workspace
memberships and invite tokens live in other contexts and are orchestrated by the
application layer via ports, not owned here. Every state change goes through a
method that enforces the invariants and (for the primary transitions) raises a
domain event. Invariants guarded here:

- **last-admin protection** — the last remaining _active admin_ can be neither
  demoted (`changeRole`) nor disabled (`disable`); the current admin count is
  supplied by the application under a lock and the aggregate decides;
- **lifecycle validity** — only `active` disables **and only `active` gets a
  password-reset link**, only `disabled` enables, only `pending`
  resends/revokes (`InvalidMemberStateError`).

The **self-action** guard (a member cannot disable or re-role their own account)
needs the acting user's identity, which the aggregate does not know, so the
application enforces it (`SelfActionError`).

## Ports & adapters

- `MemberRepository` (`MEMBER_REPOSITORY`) → `DrizzleMemberRepository` over
  identity's `users`/`roles` tables. `findByIdForAdminGuard` loads under the
  transaction-scoped **active-admin advisory lock** — the loading strategy for
  demote/disable, serializing against concurrent admin-count mutations so
  `countActiveAdmins()` returns a count the aggregate can trust (the lock is
  private infrastructure, `member-lock.ts`). Insert maps the DB's
  case-insensitive unique-email violation to `EmailTakenError`.
- `SessionRevoker` (`SESSION_REVOKER`) → `DrizzleSessionRevoker`: revokes a
  disabled member's live sessions (identity's `sessions`), in the disable's own
  transaction, so a suspended member is signed out where they sit rather than at
  next expiry. It is the **primary** lockout, not the only one — identity
  refuses to open a session for a non-`active` account and refuses to resolve one
  to a non-`active` user, which covers a session that outlives the suspension
  (a login committing concurrently with the disable).
- `WorkspaceLinker` (`WORKSPACE_LINKER`) → `DrizzleWorkspaceLinker`: links an
  invited member to workspaces (the workspaces context's `memberships`).

## Last-admin race-safety

The write path takes `pg_advisory_xact_lock` at the guarded load
(`findByIdForAdminGuard`), then reads the admin count under it, so two
concurrent demotes/disables cannot both pass and drop the active-admin count
below one. The read model's `isLastAdmin` flag is advisory (UI hint) and needs
no lock.

**Take the lock only when the patch can move the count.** The lock is a single
global key, so everything that takes it serialises deployment-wide.
`UpdateMemberUseCase` therefore branches: a patch that touches `role` loads via
`findByIdForAdminGuard` (locked), and a **pure rename** loads via `findById`
(unlocked) — a rename cannot change the admin count, and making it wait put
every member edit in the deployment behind one lock. `enable` is unlocked for
the same reason, stated positively: enabling only ever *increases* the count, so
it cannot violate the invariant.

## Conflict bodies carry a machine code

Every `409` from this package is `{ statusCode, error, message, code }`, where
`code` is one of `MEMBER_ERROR_CODES` (`domain/errors/error-codes.ts`) and the
HTTP layer builds it through the `conflict()` helper (`http/conflict.ts`).

The domain already distinguishes these precisely — `SelfActionError` is not
`LastAdminProtectedError` — but HTTP used to flatten all of them to a 409 whose
only distinguishing feature was an English sentence. A client that wants to say
"promote another admin first" could then only string-match prose, so
`users-admin` showed one generic message for every conflict and the actionable
reason never reached the user in any language (WCAG 3.3.1 / 3.3.3).

Two rules:

- **`code` is a wire contract — append, never rename.** The English `message`
  stays alongside as a developer-facing fallback, and `statusCode` / `error` are
  repeated deliberately: Nest replaces the whole body when given an object, so
  adding `code` must not remove fields clients already read.
- Add a new code by adding to `MEMBER_ERROR_CODES` and giving the domain error a
  `readonly code: MemberErrorCode`. Typing it as the union (not `string`) is
  what makes `conflict()` reject a code that isn't in the catalogue.

## The password-reset mint

`POST /:id/password-reset` mirrors the resend path deliberately, because it has
the same shape and the same hazards: `PasswordResetTokenService.rotate` keeps at
most one live `reset` token per user, takes its own per-user advisory lock
(a **different** namespace from the invite lock, so a reset for one person never
queues behind an invite rotation for another), reads its TTL from identity's
`token.resetTtlSeconds`, and refuses a second mint inside
`PASSWORD_RESET_COOLDOWN_SECONDS` (60) with
`409 PASSWORD_RESET_RECENTLY_SENT` + `retryAfterSeconds`.

Two things are worth stating outright:

- **Only `active` members qualify** (`Member.ensureCanResetPassword`). A
  `pending` member has no credential to rotate, and a link that sets one without
  activating the account would leave them unable to sign in anyway. A `disabled`
  member is locked out by an admin's decision, and minting a credential-setting
  link for them reads as reopening it. Identity's redemption refuses a
  non-active account for the same reason, so this guard only turns a link to
  nowhere into an honest 409.
- **The audit row is written at mint time**, not at redemption
  (`member.password_reset_issued` → `user.password_reset_issued`). Handing
  someone a link that can take over an account is an administrative act in its
  own right and has to be attributed to the admin who performed it, whether or
  not the link is ever used. The redemption is a *separate* row
  (`user.password_changed`), actored by the account holder — the two together
  are what let a reviewer say who opened the door and who walked through it.

## The resend cooldown

`POST /:id/invites/resend` refuses to rotate a token issued in the last
`INVITE_RESEND_COOLDOWN_SECONDS` (60), answering `409 INVITE_RECENTLY_SENT` with
a `retryAfterSeconds`.

This is **not** the obvious fix, so the reasoning matters: rotation is
unconditionally destructive, and the raw token is *unrecoverable* — only its
SHA-256 is stored. The server therefore **cannot** "return the existing link
instead" when a resend arrives too soon. Refusing the second call is the only
way a double-clicked Resend doesn't leave the admin holding the dead first
response, which is exactly what it did before.

The check runs **inside** the per-user advisory lock in `InviteTokenService`,
not in the use case — otherwise two concurrent resends both read "no recent
token" and both rotate, which is the race the lock exists for. The invite path
passes no `minIntervalSeconds`: a first issue has nothing to protect.

A spec that resends right after inviting must age the token first
(`ageInviteTokens` in `apps/server-e2e/src/support/seed.ts`) or assert the
conflict deliberately.

## Unit of work + outbox

Each state-changing use case runs inside `UnitOfWork.run` (one transaction),
loads the aggregate via the repo port, calls one aggregate method, `save`s, and
appends `aggregate.pullEvents()` to the transactional outbox (`OutboxWriter`).
Reads (list / byId) bypass the aggregate as a thin CQRS query service
(`MemberViewQuery`).

## Auditing is out of band

Use cases write **only** to the outbox. There is no `ACTIVITY_RECORDER` in this
package and no `recorder.record(...)` call anywhere in it: the audit rows are
written by the outbox subscriber in `activity/server`, which maps `member.*` to
`user.*`. So a new state change needs exactly one thing here — a `member.*`
event — and its audit line is added on the activity side.

Unlike the workspaces pilot, the users event kinds (`member.*`) intentionally
**differ** from the audit kinds (`user.*`), which is why that step is a mapping
rather than a reuse of the same strings. The `user.*` catalogue lives with the
subscriber that writes it (`USER_AUDIT_KINDS` in
`activity/server/…/audit-event-mapping.ts`), spelled as literals so the audit
sink stays decoupled from every producer.

## The copilot tool (`src/lib/copilot/`)

`WorkspaceCopilotToolProvider` binds one read tool, `workspace_members_list` —
who is on the current workspace, with role and account status. It is what turns
an `actorEmail` from `activity_recent` or an `authorId` on a revision into a
person. The provider registers itself: it implements `OnModuleInit` and calls
`this.toolRegistry?.register(this)`, with `@Optional()` on the registry inject —
so a deployment running neither the copilot nor MCP simply never gets the tool
instead of failing to boot.

It reads through a purpose-built `WorkspaceMembersQuery`
(`member/infrastructure/queries/`) — `memberships ⋈ users ⋈ roles`, paginated —
rather than through `MemberViewQuery`. That one is the deployment-wide directory
the users grid renders and has no workspace predicate at all; adding one would
thread a workspace through the whole member-list contract for a caller that
wants strictly less and none of its extras (`isLastAdmin`, the per-member
workspace list, the `?filter=` tree).

**The scoping is the point.** A copilot run is workspace-scoped, so "who is on
this team?" must not answer with every account in the deployment — which
`users:read` alone would permit. Nothing security-relevant is returned: email,
name, role key and status, exactly the columns the members page renders for the
same permission. No invite tokens, no session data.

## Architecture notes

- **The plugin describes its own responses** (`src/lib/docs/describe-users-api.ts`).
  `docs.decorate` writes plain OpenAPI schema objects onto the finished
  document, because every member view is a TypeScript `interface` and is erased
  before `@nestjs/swagger` reflects the controllers — the scanner emits a status
  code and no payload. The pass writes onto whichever 2xx key it already emitted
  (so `POST /users/:id/enable` stays the `201` it really answers, and the `204`
  revoke keeps no body), and `memberRouteTail` accepts one prefix segment or
  none so `/api/v1/users/:id` cannot be silently claimed. `InvitedMember` and
  `PasswordResetMember` are separate schemas rather than `Member` with an
  optional token field: a one-time token is returned by exactly those routes and
  is never readable again, and an "optional" field would suggest the list might
  carry one. `/users/:id/sessions` is absent from the table — identity mounts it
  on the same prefix and describes it itself.
- Plain `ServerPlugin` factory (`UsersPlugin()`), no config, **no migrations**
  — every table it touches (`users`, `roles`, `memberships`, `workspaces`,
  `sessions`, `tokens`) is owned and migrated by `@orthacms/identity-server`
  (and, for `workspaces`/`memberships`, `@orthacms/workspaces-server`).
- Authorization: identity's `PermissionsGuard` bound per controller with
  `@RequirePermissions(PERMISSIONS.USERS_READ | USERS_CREATE | USERS_UPDATE |
  USERS_DELETE)` — the shared constants, never inline strings (`.cursor/BUGBOT.md`
  §Server). Authentication is identity's global `AuthGuard`.
- **CSRF:** every *state-changing* controller also carries `OriginGuard`, ahead
  of `PermissionsGuard` — `@UseGuards(OriginGuard, PermissionsGuard)` — matching
  `workspaces/server` and the `ARCHITECTURE.md §5.3` request-flow invariant. The
  two read controllers (`list-members`, `get-member`) deliberately do not: a GET
  changes nothing and a browser can read it cross-origin anyway. This package
  shipped without the guard on any route, which is only latent because the
  session cookie is `SameSite=Lax`; `apps/server-e2e/src/server/users/origin-guard.spec.ts`
  pins all seven mutations — invite, resend, revoke, patch, disable, enable,
  password-reset — so it cannot regress on a cookie-policy change.
- Module is **not** global and exports nothing; every provider is private.
- **`name` is trimmed before validation** on both write DTOs
  (`@Transform` → `@IsNotEmpty`). `@IsNotEmpty` alone rejects `''` but accepts
  `'   '`, and this row is the only source of a person's human identifier — a
  blank one leaves the members table, the avatar initials and the audit log's
  actor column with no accessible name to render, which no client can recover
  (508 §504.2). A whitespace-only name is a `400`.
- `InviteTokenService` mirrors identity's hashing convention: only the SHA-256
  of an invite token is stored; rotation keeps at most one live invite per user.
  Two properties are load-bearing:
    - **Lifetime comes from config** — identity's `token.inviteTtlSeconds`, via
      the exported `InjectIdentityConfig()`. It used to hard-code 7 days, so a
      deployment setting `INVITE_TTL_SECONDS` silently got nothing.
    - **Rotation takes a per-user advisory lock** (`pg_advisory_xact_lock`,
      namespaced + `hashtext(userId)`). Without it two concurrent resends can
      each take their `DELETE` snapshot before the other's `INSERT` commits,
      leaving two live links where the contract promises one.
      Redeeming a token is **not** here — identity owns the `tokens` table and the
      accept/reset endpoints; this context only decides who gets invited and who
      gets a reset link. `PasswordResetTokenService` is its sibling for the
      `reset` rows, with the same two load-bearing properties.

## Commands

- `npm exec nx typecheck @orthacms/users-server`
- `npm exec nx lint @orthacms/users-server`
- `npm exec nx test @orthacms/users-server`
