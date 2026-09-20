# Identity

_Package group · packages/identity_

**Who this is and what they may do — the foundation of access in Apograph**

Identity answers the two questions without which no other plugin works: **who has arrived** (authentication) and **what they are allowed to do** (roles and permissions). It owns accounts, sessions, roles, one-time links, external API tokens and sign-in through a corporate provider. There is no signing up off the street: the only way into the system is an administrator's invitation.

- **7** packages in the group
- **19** HTTP routes
- **11** database tables
- **7** migrations
- **30** permission keys
- **3** system roles
- **3** public admin screens

## Contents

- [01. Business description](#01-business-description)
- [02. Composition of the package group](#02-composition-of-the-package-group)
- [03. Roles and permissions](#03-roles-and-permissions)
- [04. Data model](#04-data-model)
- [05. Account lifecycle](#05-account-lifecycle)
- [06. Flows — how it works, step by step](#06-flows-how-it-works-step-by-step)
- [07. HTTP API](#07-http-api)
- [08. Admin UI: screens, states, behaviour](#08-admin-ui-screens-states-behaviour)
- [09. Configuration](#09-configuration)
- [10. Security: what was done and why](#10-security-what-was-done-and-why)
- [11. Invariants](#11-invariants)
- [12. Testing checklist](#12-testing-checklist)
- [13. Boundaries of responsibility](#13-boundaries-of-responsibility)
- [14. Discrepancies between code and documentation](#14-discrepancies-between-code-and-documentation)

## 01. Business description

Identity is the CMS's "pass office". Everything else (content, media, workspaces, the copilot, the public API) proceeds from the assumption that somebody has already been verified and granted permissions. If Identity does not work, nothing works.

### The problem it solves

- **A closed editorial team.** There is no public registration at all. An account appears only when an administrator has written an invitation. This is a deliberate product choice: a CMS is an organisation's working tool, not a self-service product.
- **Instantly revocable access.** A session is a row in the database, not a signed token. So access can be taken away at once: disable an employee and their sessions die in the same transaction rather than "expiring sometime".
- **A comprehensible permission model.** Three roles out of the box (administrator, contributor, viewer) and a flat list of 30 permissions. One role per person, no overlaps and no inheritance — so that "why could they see that?" always has a short answer.
- **Machine access separate from human access.** External integrations (a site build, scripts) call with bearer tokens carrying a limited scope and a workspace list, rather than under somebody's account.
- **Corporate sign-in.** An organisation can connect its own provider (Google, Okta, Entra, Keycloak, Auth0, GitHub, SAML) and switch passwords off — while an emergency login for the root administrator remains.

### Who sees it

#### An invited employee

Receives a link, chooses a password, and is inside immediately. They can change neither their email, nor their name, nor their role — an administrator has already decided those.

#### Administrator

Invites, disables, issues a password-reset link, views and kills other people's sessions, issues API tokens. Every action reaches the activity log.

#### Integration / external agent

Lives by an API token: read-only or full content CRUD, only in the permitted workspaces, revocable in one click.

### What Identity is not

The boundaries matter more than the capabilities — they explain why the interface lacks things people expect of it:

- **It is not user management.** The member list, inviting, disabling and issuing a reset link are the `users` plugin. Identity owns only the _redemption_ of one-time links and the account model itself.
- **It is not email.** Sending belongs to `mail` ([ADR-0018](../adr/0018-mail-provider.md)), and issuing the links belongs to `users`; identity only _redeems_ them. On a deployment that configures no provider the links are still returned to the administrator in the API response and passed on by hand. **Self-service "forgot your password?" is still absent** — it needs a public route with its own rules about enumeration and rate limiting, which is phase 2 of that record — but the reason has changed: there is now somewhere to send it.
- **It is not workspaces.** Permissions are global to a role; workspace membership is checked by a separate plugin.
- **It is not the audit log.** Identity produces events; the log rows are written by the `activity` plugin.

> **The key architectural idea**
>
> A session and an API token are **256 bits of randomness verified against a row in the database**. There is no signature and no signing key, and that is a decision rather than an omission: revocation reduces to a `DELETE` rather than to a key rotation that throws everybody out at once. The database holds only SHA-256 hashes, so a leaked dump yields no working sessions.

## 02. Composition of the package group

The `packages/identity` group is seven packages. The split is not cosmetic: a provider adapter has to be able to depend on the port _without_ dragging NestJS, Drizzle and bcrypt along with it.

| Package         | npm name                           | Role                                                                                                                           | What it owns                                                                         |
| --------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| server          | @apograph/identity-server          | The NestJS plugin: routes, use cases, guards, the database schema, migrations, seeders                                         | 11 tables, 19 routes, RBAC, sessions, API tokens, the SSO core                       |
| admin           | @apograph/identity-admin           | The admin plugin: the sign-in and one-time-link screens plus the "auth kit" (context, provider, route gate)                    | `/identity/*`, `AuthProvider`, `RequireAuth`, `useHasPermission`                     |
| domain          | @apograph/identity-domain          | The framework-free core of the SSO seam: the `SsoProvider` port, the profile, open-redirect protection, a conformance test set | The contract every adapter must fulfil. **Zero dependencies** in its `package.json`  |
| provider-oidc   | @apograph/identity-provider-oidc   | Generic OpenID Connect plus 5 presets (Google, Entra, Okta, Auth0, Keycloak)                                                   | Authorization Code + PKCE, id-token verification through `jose`/JWKS                 |
| provider-github | @apograph/identity-provider-github | GitHub and GitHub Enterprise — OAuth2 with no id token                                                                         | Exchanging the code for a token, reading `/user/emails`, subject = the numeric id    |
| provider-saml   | @apograph/identity-provider-saml   | SAML 2.0: the request by redirect, the response by POST form                                                                   | XML signature verification (`@node-saml/node-saml`), `RelayState` instead of `state` |
| provider-fake   | @apograph/identity-provider-fake   | A scriptable provider for e2e and local development                                                                            | The whole handshake is deterministic, but the signature and nonce checks are real    |

> **Neighbours that are easy to confuse**
>
> **`@apograph/users-server` / `users-admin`** — issuing invitations (`POST /api/users/invites`), disabling and re-enabling a member, issuing a reset link (`POST /api/users/:id/password-reset`), the members screen. **`@apograph/api-tokens-admin`** — the token UI; the token server, meanwhile, lives inside `identity-server`. **`@apograph/shell-admin`** — it is what assembles `AuthProvider` + `RequireAuth` into the layout; the host itself knows nothing about authorisation.

## 03. Roles and permissions

The model is as flat as it gets: **an account has exactly one role**, a role is a named set of permissions, and a permission is a string of the form `area:action`. There is no inheritance, no negation and no per-object permission. The administrator holds the **fully enumerated** set of every permission — there is deliberately no wildcard `*`, so that a new permission does not silently "arrive" for the admin.

The three system roles are created at application start idempotently (`ON CONFLICT DO NOTHING` in one transaction) and are **protected from deletion** by the SQL condition `is_system = false` — so the check is atomic rather than "read first, then delete".

| Permission                        | What it opens                                                                                         | admin | contributor | viewer |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- | ----- | ----------- | ------ |
| workspaces:create                 | create a workspace                                                                                    | ✓     | —           | —      |
| workspaces:read                   | see the workspace list                                                                                | ✓     | ✓           | ✓      |
| workspaces:update                 | edit a workspace, its membership and content grants; **and also list and revoke a member's sessions** | ✓     | —           | —      |
| workspaces:delete                 | delete a workspace                                                                                    | ✓     | —           | —      |
| users:read                        | the member directory                                                                                  | ✓     | ✓           | ✓      |
| users:create                      | invite, resend an invitation                                                                          | ✓     | —           | —      |
| users:update                      | edit a member, disable/enable, issue a reset, **sessions**                                            | ✓     | —           | —      |
| users:delete                      | revoke an invitation / delete                                                                         | ✓     | —           | —      |
| activity:read                     | the activity log                                                                                      | ✓     | —           | —      |
| activity:manage                   | retry a parked outbox event (the audit trail's plumbing, not its contents)                            | ✓     | —           | —      |
| content:read                      | read entries                                                                                          | ✓     | ✓           | ✓      |
| content:create / update / publish | create, edit, publish                                                                                 | ✓     | ✓           | —      |
| content:delete                    | delete entries                                                                                        | ✓     | —           | —      |
| content:export / import           | content transfer                                                                                      | ✓     | ✓           | —      |
| media:read                        | view the media library                                                                                | ✓     | ✓           | ✓      |
| media:create / update             | upload and edit files                                                                                 | ✓     | ✓           | —      |
| media:delete                      | delete files                                                                                          | ✓     | —           | —      |
| tokens:read / create / delete     | external API tokens                                                                                   | ✓     | —           | —      |
| copilot:use                       | talk to the copilot                                                                                   | ✓     | ✓           | ✓      |
| copilot:skills:manage             | manage the copilot's skills                                                                           | ✓     | —           | —      |
| alarms:read                       | see check findings (in the entry editor)                                                              | ✓     | ✓           | ✓      |
| alarms:manage                     | write check rules                                                                                     | ✓     | —           | —      |
| views:share                       | share saved views                                                                                     | ✓     | ✓           | —      |
| segments:read                     | see audiences                                                                                         | ✓     | ✓           | ✓      |
| segments:manage                   | manage audiences                                                                                      | ✓     | —           | —      |

> **A deliberate tightening · BUG-identity-server-04**
>
> Viewing a member's sessions requires `users:update` rather than the weaker `users:read`. A session row contains an IP and a `User-Agent` — data about where a person works from and on what, which is surveillance of a colleague rather than a directory. `users:read` is held by all three roles, the viewer included — with it, any logged-in user would see a colleague's location.

### How a permission reaches the code

- **On the server:** `@UseGuards(PermissionsGuard)` + `@RequirePermissions('users:update')`. The guard pulls the role's permissions through `PermissionsService.forRole` and **delegates the decision** to the pure domain object `AccessPolicy` — so that "may this actor do this?" has exactly one implementation in the codebase. There is also `@RequireAnyPermission(...)` — any one of those listed is enough.
- **For a bearer token:** the public content API's guard lives in `content-server`, but uses the same `PERMISSIONS_KEY`, `Permission` and `AccessPolicy` — so checking a token's scope _is_ that same decision.
- **In the admin UI:** `useHasPermission('workspaces:create')` reads the permission list from `GET /api/auth/me`. The hook is **fail-closed**: any state other than "authenticated" returns `false`. This is only the interface being honest — the real check is always on the server.

## 04. Data model

Identity owns eleven tables and **carries its own migrations** (`drizzle.config.ts` plus committed `migrations/*.sql`, applied by the host through `nx run server:db:migrate`, with its own migration journal table `__drizzle_migrations_identity`). The plugin opens no database connection — the client is injected from `@apograph/database`.

| Table                | Purpose                                              | Key columns and constraints                                                                                                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| users                | An account                                           | `id` uuid PK · `email` · `name` nullable · `password_hash` **nullable** (absent for an invitee and for an SSO-provisioned account) · `role_id` → roles · `status` = pending \| active \| disabled.<br>**Email uniqueness is case-insensitive**, through a unique index on `lower(email)`, with no citext extension. |
| roles                | A role                                               | `key` unique · `name` · `is_system` — the delete-protection flag                                                                                                                                                                                                                                                    |
| permissions          | The permission catalogue                             | `key` unique — filled by a seeder from `PERMISSIONS`                                                                                                                                                                                                                                                                |
| role_permissions     | The role↔permission link                            | PK `(role_id, permission_id)`, cascading on both sides                                                                                                                                                                                                                                                              |
| sessions             | A live session                                       | `id` = **the SHA-256 of the token itself** (not the token!) · `user_id` with cascade · `expires_at` · `revoked_at` · `last_used_at` · `user_agent` · `ip_address` · `sso_provider` + `sso_session_id`.<br>Indexes: on `user_id` (bulk revocation) and on the SSO field pair (back-channel logout).                  |
| tokens               | One-time links                                       | `type` = invite \| reset · `token_hash` unique · `expires_at` · `consumed_at`.<br>The split by `type` is **load-bearing**: an invitation token must not open the reset path.                                                                                                                                        |
| user_preferences     | Personal settings                                    | PK = `user_id` · `theme` = light \| dark \| system (system by default)                                                                                                                                                                                                                                              |
| api_tokens           | An external access key                               | `token_hash` unique (a SHA-256 only) · `lookup_prefix` — the non-secret prefix for display · `scope` = read \| full · `expires_at` nullable · `revoked_at` · `last_used_at` · `created_by`                                                                                                                          |
| api_token_workspaces | The token's scope                                    | PK `(token_id, workspace_id)`, cascading on the token. **There is no FK onto the workspace** — plugins are not bound by schema; existence is checked through the `WORKSPACE_DIRECTORY` port                                                                                                                         |
| sso_identities       | The link between an account and an external provider | Unique both on `(provider, subject)` and on `(provider, user_id)` · `last_login_at`                                                                                                                                                                                                                                 |
| sso_auth_requests    | One SSO sign-in attempt                              | `id` = the SHA-256 of the browser token · `state` unique · `nonce` · `code_verifier` · `redirect_to` · `invite_token_hash` nullable · `consumed_at`                                                                                                                                                                 |

> **The secret-storage rule**
>
> Not one secret sits in the database in plaintext. A password is bcrypt (cost 12, the salt inside the hash). A session token, an invitation token, a reset token, an API token and an SSO attempt descriptor are all unsalted SHA-256 (the value is high-entropy anyway, and a deterministic hash is needed for key lookup). An API token's secret is shown **once** at issue time and is nowhere recoverable afterwards.

## 05. Account lifecycle

**pending** — accepted the invitation → **active** ⇄ disable / enable ⇄ **disabled**

| Status   | What it means                                                  | Can sign in? | Has a password?                     |
| -------- | -------------------------------------------------------------- | ------------ | ----------------------------------- |
| pending  | An administrator invited them, the person has not accepted yet | No           | No (`password_hash` = null)         |
| active   | A full member                                                  | Yes          | Yes — or an SSO link instead of one |
| disabled | An administrator closed their access                           | No           | The hash is kept but useless        |

The transitions are described on the `UserAccount` aggregate and guarded by it: `activate` (pending → active, setting the first password), `activateWithoutCredential` (the same, but through SSO), `disable` (active → disabled), `enable` (disabled → active), `changeCredential` (for anything not disabled). Every transition raises a `user.*` domain event.

> **Three blocking points for a disabled account**
>
> A disabled employee is stopped in **three independent places**: (1) sign-in refuses to open a session for a non-`active` account; (2) disabling in `users-server` revokes their live sessions in the same transaction; (3) `AuthService.currentUser` resolves a session **only** into an `active` user. The third point is defence in depth: a session committed concurrently with the disabling would be inserted after the revocation's snapshot. From the outside all of this looks like an ordinary `401`, so a disabled account is indistinguishable from an expired session.

### Password rules

- **A minimum of 12 characters**, with no composition requirements. Length is what actually resists offline cracking, while "one digit and one symbol" pushes people towards predictable substitutions.
- **A maximum of 72 UTF-8 _bytes_** — bcrypt's truncation point. The units differ **deliberately**: the floor is in characters, the ceiling in bytes. The ceiling must be checked with `@MaxByteLength` rather than class-validator's `@MaxLength`: that one counts UTF-16 units and would let through `'é'.repeat(72)` — 72 characters and 144 bytes, exactly half of which bcrypt would hash.
- We **refuse rather than truncate**: what a person typed must be what protects them. `HashingService.hashPassword` throws `PasswordTooLongError` as insurance for the paths with no DTO (a password change from code, the root administrator from an environment variable).
- The client side mirrors the same rule (`PASSWORD_MIN_LENGTH` = 12, `PASSWORD_MAX_BYTES` = 72, counted through `TextEncoder`).

## 06. Flows — how it works, step by step

### 6.1 An invitation and its acceptance

Issuing the link is the `users` plugin; redeeming it is Identity. In between: the message, when a mail provider is configured — and otherwise the administrator, passing the link to the person by hand.

1. **The administrator invites.** `POST /api/users/invites` (permission `users:create`): a `users` row is created with status `pending` and a pre-assigned role, plus a `tokens` row with `type='invite'`. The lifetime comes from Identity's configuration (`token.inviteTtlSeconds`).
   _the response contains the raw token — the only moment it exists in plaintext_
2. **The person opens the link** `/identity/accept-invite?token=…`. The token is in the query, never in a path segment, so that a secret does not become part of a route template.
3. **The screen learns who the link is for.** `GET /api/auth/invite/:token` → `{ email, name }`. A read-only operation, so opening the link twice is fine.
   _a public route, under a rate limit_
4. **The form collects only the password, twice.** Email and name are shown as `readOnly` (not `disabled` — so they stay focusable and are announced). Being able to edit the email would mean being able to assume somebody else's identity on the way in.
5. **Submission.** `POST /api/auth/invite/accept` with `{ token, password, confirmPassword }`. Any extra field is rejected by the global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`) before the controller.
6. **The server consumes the token first of all.** Inside one transaction: find an unconsumed, unexpired token → a **conditional** `UPDATE … WHERE consumed_at IS NULL RETURNING` → if no row came back, somebody got there first and this is a refusal. Only then is the bcrypt hash computed (so that a useless link does not cost ~250 ms of CPU).
   _that is the single-use guarantee — not "read, then write"_
7. **The account is activated and a session is issued straight away.** The response is `{ ok: true }` plus the `apograph_session` cookie. The invitee is inside the application with no separate sign-in.
8. **The admin UI clears its cache and goes to "/".** `resetSessionCache` removes everything except its own `auth` namespace, so the tab does not inherit the previous user's data.

> **Every refusal looks identical**
>
> An unknown, expired, already used or revoked token gives one and the same `InvalidInviteTokenError`, rendered as a **bare 404 with no body**. Otherwise the endpoint would become a tool for enumerating live invitations.

### 6.2 Signing in with a password

1. **The form sends** `POST /api/auth/login` with `{ email, password }`.
   _@Public + ThrottlerGuard (10 requests / 60 s by default) + OriginGuard_
2. **The "are passwords switched off" check.** If `sso.allowPasswordLogin: false`, passwords are accepted **only for the root administrator**. Even then the refusal still performs one bcrypt comparison — otherwise the emergency address could be found by response timing.
3. **Finding the user and comparing.** The comparison is **always** performed: if there is no user, or they have no hash, a pre-computed "empty" hash is used. Response time must not distinguish "no such address" from "wrong password".
4. **A single refusal.** An unknown email, a pending invitee (`password_hash = null`), a disabled status, a wrong password — one `InvalidCredentialsError` → `401 Invalid credentials`. No session is created.
5. **Success: one transaction.** A session is issued (32 random bytes; the database holds their SHA-256) and an `auth.signed_in` event with the actor goes into the transactional outbox. The event is committed if and only if the session is.
6. **The cookie is set by the controller.** `apograph_session`: `httpOnly`, with `secure` and `sameSite` from the configuration, `maxAge` = the session TTL, `path=/`.
7. **The admin UI refreshes "who am I" and goes where it was heading.** It invalidates `['auth','me']`, then navigates to the address the `RequireAuth` gate saved, or to `/`.

### 6.3 Checking the session on every request

The global `AuthGuard` is registered as an `APP_GUARD`, so **everything is protected by default** and exceptions are marked `@Public()`.

1. **Is the route public?** If the handler or the class carries `@Public()` — through with no checks.
2. **The cookie is read** from the raw `Cookie` header (with no `cookie-parser`, so the feature stays self-contained).
3. **The token resolves to a user.** `RefreshSessionUseCase` looks up a live session (not revoked, not expired) by the token's SHA-256 and, if `last_used_at` is older than 60 seconds, updates it — throttled so as not to write to the database on every request.
4. **The user must be `active`.** Otherwise `null` and a `401`. The password hash takes no part in that select at all, so it cannot leak by this path.
5. **The user is placed on the request** and read by the handler through `@CurrentUser()`.

### 6.4 Signing out

1. `POST /api/auth/logout` — **public** (otherwise you could not sign out of an already dead session) and protected by `OriginGuard`.
2. **Only the presented session is revoked.** Other devices keep working — this is signing out of a device, not "everywhere".
3. **Idempotency.** No cookie, or a session already dead — it is still a `200` and the cookie is cleared. An `auth.signed_out` event is written only if something was actually revoked.
4. **The admin UI clears "who am I" and wipes the cache** (`resetSessionCache`). If the request failed, the interface stays logged in and shows a toast: the session was not revoked, and lying about that is not allowed.

### 6.5 Resetting a password

The flow is entirely administrative: `POST /api/users/:id/password-reset` (permission `users:update`) issues the link, and Identity redeems it.

1. **The screen learns whose account it is.** `GET /api/auth/reset/:token` → `{ email, name }`. Read-only; opening it twice is harmless.
2. **A pre-check outside the transaction.** The token is read _before_ the transaction opens: bcrypt costs ~250 ms, and hashing under a row lock means holding it for all that time; while hashing before looking at the token means letting anybody burn that CPU with a junk link. The pre-check is advisory.
3. **The transaction:** a repeat lookup → conditional consumption → the account must be `active`.
   _a pending account has nothing to rotate (that is the invitation path), and a disabled one is closed deliberately — a reset would quietly open a door the administrator shut_
4. **The new password and a full session revocation.** **All** of the account's live sessions are revoked, with no exceptions: an unauthenticated caller has no "own device".
5. **No session is issued.** The person proved only possession of the link, so they end on the sign-in form — with the password they have just chosen.
6. **The response is simply `{ ok: true }`.** The number of discarded sessions does not reach the response: that is not something an anonymous caller is entitled to learn. The number goes into the event and from there into the log.

### 6.6 Changing a password from inside

`ChangePasswordUseCase` exists and works fully, but **it has no HTTP route yet** — self-service is planned separately. The rule it carries: changing a password revokes the account's live sessions in the same unit of work, except the caller's own session (`keepSessionId`). The logic is simple: a session is a bearer key opened by the _old_ password, and it lives on for its whole TTL; without revocation, changing a compromised password would leave an attacker inside for a week. The barrel export exists so that the e2e suite can drive this scenario from DI while there is no route.

### 6.7 Signing in through an external provider (SSO)

1. **The sign-in page shows the buttons.** `GET /api/auth/sso` returns the registered providers; an empty list is an **answer**, not a 404. The buttons do not depend on the address entered: an endpoint that changed with the email would be an oracle for enumerating accounts.
2. **Starting an attempt.** `GET /api/auth/sso/:provider/start?redirect=…&invite=…`: the core (not the adapter!) generates the `state`, the `nonce` and the PKCE verifier, writes an `sso_auth_requests` row, sets the short-lived `apograph_sso_request` cookie and issues a `302` to the provider.
   _the redirect goes through safeRedirectPath — only an absolute path on the same origin is accepted_
3. **The provider sends the person back.** `GET …/callback` — or `POST …/callback` for SAML, where the response arrives as a form. The two handlers differ in exactly one thing: where the parameters were taken from.
4. **The core's checks, in order:** the cookie exists → the attempt is alive → the provider is the same one → the `state` echo matches → **the attempt is consumed before the token exchange**. The order is load-bearing: consuming after the exchange would allow a replay, and exchanging inside the transaction would hold a row lock for the duration of a third-party call.
5. **The adapter verifies and returns a profile.** A three-point contract: `complete` either verifies or throws; the `subject` is stable, bound to the issuer and **never equal to the email**; `emailVerified` reports exactly what the provider asserted.
6. **The account is found or created.** An `sso_identities` link exists → sign in. No link but an `invite` → the address is checked and the invitation consumed. Neither → claiming an existing account **only with a verified email**, or JIT creation if it is switched on.
7. **Session, cookie, redirect into the admin UI.** The session row additionally records the `sso_provider` and `sso_session_id`.

#### What an SSO sign-in is entitled to do to an account

By default, **nothing**: it lets in accounts that already exist and are `active`, creates nobody, and changes no roles. Three things are switched on separately:

#### JIT creation

Creates an `active` account with no password. **The domain list is required and must be non-empty** — checked when the application is assembled. The match is exact on the domain rather than on a suffix: `acme.com` will never admit `evil-acme.com`.

#### Role mapping

Ordinary code at the composition root returning a role key or `null`. An unknown key is logged and ignored (a typo must not lock out the whole department), and **an account with the admin role is never demoted** by the mapping.

#### Invitation through a work account

`/start?invite=…` puts the token on the attempt row; the callback checks that the provider vouched **for exactly the invited address**. A repeat pass over a spent link by the same person is simply a sign-in; by somebody else, a refusal.

> **One refusal for every case**
>
> Any SSO failure is an `SsoLoginFailedError` and a redirect to `?error=sso`. Not a 401: the person is in the middle of navigation from the provider, and a bare status would leave them on a blank page. The real reason goes into the server log. Distinguishable errors would let anybody who can authenticate with a public provider find out which addresses have accounts here.

#### Signing out on the provider's signal

`POST /api/auth/sso/:provider/backchannel-logout` is the only mechanism that ends a session here _immediately_ when somebody is disabled in the corporate directory. Without it, the honest answer to "we fired them, are they out?" would be "within `SESSION_TTL_SECONDS`".

- **`sid`** in the notification closes only the sessions opened by that provider session: a laptop and a phone signed in through two different provider sessions do not kill each other.
- **`sub` without `sid`** closes every session of the linked account. That is the termination case, and the bluntness is the point.
- **The adapter does the verification** through the optional `verifyLogoutToken`. A provider that cannot verify does not implement the method, and the route answers `404` rather than pretending it did something: the endpoint is unauthenticated and open to anyone.
- `200` whether or not anything was revoked (providers retry — the route has to be idempotent), `400` on a refusal with no details, and always `cache-control: no-store`: a `200` cached by an intermediary would swallow every subsequent notification.
- **A subject with no account is not an error.** A provider legitimately notifies about people who never signed in here; any other answer would make the route an oracle for "which of our employees uses this CMS".

### 6.8 External API tokens

1. **Issue.** `POST /api/api-tokens` (permission `tokens:create`): a name (1–120 characters), a **non-empty** `workspaceIds` list (up to 100, duplicates collapsed), a scope of `read` or `full`, and an optional `expiresAt` in the future.
2. **Workspaces checked through the port.** There is no foreign key, so the ids are checked against `WORKSPACE_DIRECTORY`. What is checked is **existence, not status** — an archived workspace is a legitimate scope. If nothing is bound to the port (no workspaces plugin), the check is skipped.
3. **The secret is handed over once.** The response carries the `secret`; the database holds only the SHA-256 and the non-secret `lookup_prefix` for display.
4. **The event is mandatory.** Issue and revoke go through a unit of work with an `api_token.created` / `api_token.revoked` event → a log row. A long-lived key to the content must be accountable. The event payload carries the name, the scope, the workspace list and the prefix, **never** the secret or its hash.
5. **Use.** The public content API's guard checks `Authorization: Bearer`; unknown, revoked and expired tokens are rejected identically. `last_used_at` is updated fire-and-forget, throttled to 60 s.
6. **Revoke.** `DELETE /api/api-tokens/:id` → `204`. A repeat revoke adds no event: only the call that actually killed a live token is an event.

> **The token management routes are session-only**
>
> `POST`/`GET`/`DELETE /api/api-tokens` require `tokens:create|read|delete`, which only an administrator holds, and are **unreachable with a bearer token**. A token cannot issue itself another token.

### 6.9 Personal preferences

`GET`/`PUT /api/preferences` — the current user's theme (`light`/`dark`/`system`). The route is bound to `@CurrentUser()` rather than to an id in the path — that is the form in which self-service is possible at all in this system.

### 6.10 A member's sessions as an administrator sees them

1. `GET /api/users/:id/sessions` (`users:update`) returns the live sessions: the id, `userAgent`, `ipAddress`, `createdAt`, `lastUsedAt`, `expiresAt` and a `current` flag.
2. **The `current` flag** is computed by hashing the caller's own cookie — so it is true only when an administrator is looking at their own sessions, and it exists so they do not throw themselves off their working device.
3. `DELETE /api/users/:id/sessions/:sessionId` (`users:update` + `OriginGuard`) → `204`. **Idempotent:** an unknown session, an already revoked one, or one belonging to another user also gives 204.

## 07. HTTP API

All paths carry the global `/api` prefix the host applies. Access legend: `public` — no session, `session` — a valid session is required, `permission` — a session plus the named permission.

| Method and path                             | Access and guards                              | Input                                                        | Success                                                   | Failures                                                                                 |
| ------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| POST /auth/login                            | `public` Throttler, Origin                     | `{ email, password }`                                        | `200 { ok: true }` + `Set-Cookie: apograph_session`       | `401` for everything; `403` a foreign Origin; `429` the rate limit; `400` an invalid DTO |
| POST /auth/logout                           | `public` Origin                                | — (reads the cookie)                                         | `200 { ok: true }`, the cookie cleared                    | `403` a foreign Origin. With no session it is still a 200                                |
| GET /auth/me                                | `session`                                      | —                                                            | `{ id, email, name, roleId, status, permissions[] }`      | `401`                                                                                    |
| GET /auth/invite/:token                     | `public` Throttler                             | the token in the path                                        | `{ email, name }`                                         | `404` — one shape for unknown / expired / consumed                                       |
| POST /auth/invite/accept                    | `public` Throttler, Origin                     | `{ token, password, confirmPassword }`                       | `200 { ok: true }` + a session                            | `404` the token; `400` the password length or a confirmation mismatch; `403`; `429`      |
| GET /auth/reset/:token                      | `public` Throttler                             | the token in the path                                        | `{ email, name }`                                         | `404` — including the "the account is no longer active" case                             |
| POST /auth/reset                            | `public` Throttler, Origin                     | `{ token, password, confirmPassword }`                       | `200 { ok: true }`, **no cookie**, every session revoked  | `404`; `400`; `403`; `429`                                                               |
| GET /auth/sso                               | `public` Throttler                             | —                                                            | `[{ name, label, kind }]`, possibly `[]`                  | —                                                                                        |
| GET /auth/sso/:provider/start               | `public` Throttler                             | `?redirect=`, `?invite=`                                     | `302` to the provider + the `apograph_sso_request` cookie | `404` an unregistered provider                                                           |
| GET /auth/sso/:provider/callback            | `public` Throttler; **deliberately no Origin** | the provider's query                                         | `302` into the admin UI + a session                       | `302` to `?error=sso` — on any failure                                                   |
| POST /auth/sso/:provider/callback           | `public` Throttler                             | a form post (SAML)                                           | the same as the GET callback                              | the same                                                                                 |
| POST /auth/sso/:provider/backchannel-logout | `public` Throttler                             | `{ logout_token }`                                           | `200 { revoked: N }`, `cache-control: no-store`           | `400 { error: "invalid_request" }`; `404` if the provider cannot verify                  |
| GET /users/:id/sessions                     | `users:update`                                 | a uuid in the path                                           | an array of sessions with a `current` flag                | `401`; `403`; `400` non-uuid                                                             |
| DELETE /users/:id/sessions/:sessionId       | `users:update` Origin                          | a uuid + the session id                                      | `204`                                                     | `401`; `403`. An unknown session is also a 204                                           |
| GET /preferences                            | `session`                                      | —                                                            | `{ theme }`                                               | `401`                                                                                    |
| PUT /preferences                            | `session` Origin                               | `{ theme: light\|dark\|system }`                             | `{ theme }`                                               | `400` any other value; `401`; `403`                                                      |
| POST /api-tokens                            | `tokens:create` Origin                         | `{ name, workspaceIds[], scope, expiresAt? }`                | `{ …the token, secret }` — the secret once                | `400` a non-existent workspace, a past `expiresAt`, an empty list; `403`                 |
| GET /api-tokens                             | `tokens:read`                                  | `?workspaceId=&page=&pageSize=` (25 by default, 100 maximum) | `{ items, total, page, pageSize }`                        | `400` invalid parameters; `403`                                                          |
| DELETE /api-tokens/:id                      | `tokens:delete` Origin                         | a uuid                                                       | `204`                                                     | `403`; a repeat revoke is also 204, but with no event                                    |

A live server serves the generated OpenAPI at `/reference` (raw JSON at `/reference/json`). Both security schemes — `session` (the cookie) and `apiToken` (the bearer) — are declared by Identity: it owns authentication, so it owns its description too.

## 08. Admin UI: screens, states, behaviour

The admin plugin contributes **one** route template, `/identity/*`, marked `public`, with its own nested router inside it. Every page loads lazily (`React.lazy`), because a logged-in user never needs them.

| Route                            | Screen              | What it does                                                                      |
| -------------------------------- | ------------------- | --------------------------------------------------------------------------------- |
| /identity                        | —                   | A redirect to `signin`                                                            |
| /identity/signin                 | `LoginPage`         | The sign-in form plus the SSO provider block plus the "your session ended" banner |
| /identity/accept-invite?token=…  | `AcceptInvitePage`  | Accepting an invitation; ends up **inside** the application                       |
| /identity/reset-password?token=… | `ResetPasswordPage` | Changing a password by link; ends with **a confirmation and a move to sign-in**   |

### Four authorisation states, not three

This is the most important detail of the client side. `AuthState` distinguishes:

#### `loading`

The probe is in flight — the initial load or a re-check after signing in or out. The gate shows a branded loader rather than the sign-in form, so it does not flash at somebody already logged in.

#### `authenticated`

The user was returned; their permissions are published into the context.

#### `unauthenticated`

The server answered "nobody" (`401` → `data === null`). A redirect to sign-in, saving the address they were heading to.

#### `unavailable`

**The probe failed** — a 500, a timeout, a dropped connection. A "we cannot reach the server" card with a retry is shown. Collapsing this state into the previous one told a user with a valid cookie that they had been signed out and led them to a form that knocks on the same dead API.

### The session died while the tab was open

This happens regularly: an administrator disabled the account, the term expired, the session was killed from another device. It is caught by two mechanisms, and both converge on one state:

- **A global 401 handler.** For its lifetime `AuthProvider` installs `setUnauthorizedHandler`: any `401` writes `null` into the current user's key. It **deliberately does not remove** queries from the cache — they have mounted observers, and each would refetch and get another 401. The private tree is unmounted by the redirect itself.
- **A re-check on window focus.** An idle tab is checked when it is returned to, not only on the next action. The refetch is invisible: while it is in flight the cached user is published, so focus does not flash a loader.

> **A forced sign-out has to explain itself**
>
> The redirect replaces the whole screen: focus was on an element that no longer exists, and the browser drops it onto `<body>`; the screen reader's buffer holds an unmounted page; everything typed into the form is gone. Hence: (1) a toast into the host's live region — it lives outside the router and survives a view change; (2) a one-shot flag the sign-in page latches into state and renders as an `AuthNotice` — the thing that stays readable after the toast disappears; (3) `AuthLayout` moves focus to the `<h1>`, so a person lands on the heading with the explanation next in reading order. The toast fires **only if the user was in the cache a moment ago** — a 401 in a tab that never had a session is the ordinary "you are not signed in", and claiming otherwise means lying to somebody who simply opened a bookmark.

### The states of the invitation and reset screens

| State                | When                             | What is shown                                                                                                                                                                                        |
| -------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No token             | There is no `?token=` in the URL | A "this link does not work" card with its own text about the missing token                                                                                                                           |
| Loading              | The link probe is in flight      | A skeleton plus a visually hidden `<h1>` and `role="status"`; **focus is not moved to the heading** (`focusHeading={false}`), or it would land on a heading about to be replaced                     |
| A dead link          | A `404` response                 | An "ask for a new link" card. One refusal shape, because the server returns one 404 for every cause                                                                                                  |
| A connection failure | An error that is **not** a 404   | A failure card with a "retry" button. The token is fine — the server is not; sending the person for a new link would be harmful, all the more so since a new one would kill the existing one         |
| The form             | The link is described            | Invitation: email and name `readOnly` plus the password twice. Reset: the account's address plus the password twice                                                                                  |
| Done (reset only)    | The mutation succeeded           | A confirmation with a link to sign-in. Checked **before** the link states: the token is by definition already spent, and a refetch would replace the congratulation with "this link no longer works" |

### The SSO block on the sign-in page

- **These are links, not buttons with handlers.** Signing in through a provider is a full-page navigation to `/api/auth/sso/:name/start`, which answers with a 302. The anchor _is_ the navigation: the middle mouse button and "open in a new tab" work, and no JavaScript stands between the person and the redirect. The e2e suite checks for the `link` role precisely so this does not degrade into a scripted click.
- **Nothing is rendered** while loading, on an error, and for an empty list. The password form _is_ the sign-in page, and this is an addition to it: a spinner would make everybody wait for a feature most of them do not have.
- **The block comes after the form** in the DOM and in tab order: somebody who came to type a password should not have to tab past a provider list.
- **The destination address travels on the link itself** (`?redirect=/workspaces`) rather than in router state: SSO leads out of the application, so the target has to leave with it. The server validates it as a same-origin path.

### One tab, one identity

Any change of identity (signing in, signing out, accepting an invitation, a reset) calls `resetSessionCache`: everything except the `auth` namespace is removed from the cache. The cookie is not the only thing a session accumulates: the member list, workspaces, activity and settings sit in the cache for the page's whole lifetime, and without a wipe the next person to sign in would inherit them until the first refetch.

Other details that are easy to break: the tab title goes through the shared `useDocumentTitle` (the registry composes "Page · Application" and coexists with the copilot's unread badge); `AuthErrorBoundary` wraps the `Suspense` so that a deploy while a tab is open does not turn the sign-in page into a white screen once the old chunk is gone; `AuthAlert` (a submission error) **takes focus** and so must be rendered conditionally, while `AuthNotice` (the explanation of how you got here) does **not** take focus, so as not to fight the move of focus to the heading.

## 09. Configuration

Configuration flows from `apps/server/apograph.config.ts` (the `plugins.identity` section, with values from environment variables) into the `IdentityPlugin(config, options)` factory. The first argument is a typed view of the environment; the second is what is not environment at all (SSO adapter instances and the role-mapping handler).

| Field                                          | Type / default          | Meaning                                                                                                                                                      |
| ---------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| allowedOrigins                                 | `string[]`              | The Origin whitelist for `OriginGuard`. A request with no Origin (a non-browser client) passes                                                               |
| session.ttlSeconds                             | `number`                | The session's lifetime; also the cookie's `maxAge`                                                                                                           |
| session.cookieSecure                           | `boolean`               | The `Secure` attribute                                                                                                                                       |
| session.cookieSameSite                         | `lax \| strict \| none` | **With SSO providers registered, `strict` is forbidden** — the plugin refuses to start                                                                       |
| token.inviteTtlSeconds                         | `number`                | The invitation link's lifetime (also read by the issuing `users` plugin)                                                                                     |
| token.resetTtlSeconds                          | `number`                | The reset link's lifetime                                                                                                                                    |
| rateLimit.ttlSeconds / limit                   | `60` / `10` by default  | The limit on public routes. **In-memory, per instance** — scaling out needs a shared store                                                                   |
| rootAdmin.email / password / name?             | optional                | Idempotent provisioning of the root administrator at start. Non-destructive: an existing address is left alone, and `name` is written only on first creation |
| sso.publicBaseUrl / apiPathPrefix / signInPath | optional                | What the exact callback URL and the redirect addresses are assembled from                                                                                    |
| sso.requestTtlSeconds                          | optional                | The lifetime of a sign-in attempt row                                                                                                                        |
| sso.provisioning.domains / defaultRole         | optional                | JIT creation. **The domain list must be non-empty** and the role a non-empty string; checked at assembly rather than on the first sign-in                    |
| sso.allowPasswordLogin                         | `true`                  | `false` switches passwords off for everybody except the root administrator                                                                                   |
| sso.sessionTtlSeconds                          | optional                | A shortened TTL specifically for SSO sessions — a partial measure for providers with no back-channel logout                                                  |

> **A host setting Identity is answerable for**
>
> The rate limit counts by `req.ip`, and that is the _client's_ address only if the host enabled `trust proxy` (the `trustProxy` option of `createServer`, from the `TRUST_PROXY` variable). Forget it and, behind a proxy, every caller looks like one address, the deployment shares one bucket, and ten requests a minute from one attacker **lock sign-in for everyone**. Covered by an e2e suite that boots the application both ways.

> **There are no signing secrets here — and none were lost**
>
> `sessionSecret` and `tokenSecret` were once in the configuration and were documented as signing keys. **Nobody read them.** Measured: starting with empty values issues a working session, and a cookie issued under a "real" secret keeps being accepted after a restart. Both fields have been removed from the type, from the host configuration, from `.env.example` and from the app generator. The defect was not in the mechanism but in a configuration surface describing a different mechanism: an operator would set up two high-entropy values, put them in a secret manager and add "rotate the session secret" to their incident runbook — and all of it would have been inert.

<details>
<summary>Plugin registration order and startup</summary>

`IdentityPlugin` is registered **after** `DatabasePlugin` — the database client is injected from its global module. The seeders implement `OnApplicationBootstrap`, so they run inside `app.init()`: after every module is assembled and before the server starts listening. That means seeding finishes before the first request, and a failure in it aborts startup. `RootAdminSeeder` is declared **after** `SystemRolesSeeder` so that the `admin` role already exists.

</details>

## 10. Security: what was done and why

#### No account enumeration

A wrong email and a wrong password refuse identically **in both body and timing**: the bcrypt comparison is always performed, against a pre-computed "empty" hash when there is no user. The same rule governs the refusal when passwords are switched off: otherwise the emergency root address could be found by timing.

#### Single use through a conditional write

An invitation, a reset and an SSO attempt are consumed with a single `UPDATE … WHERE consumed_at IS NULL RETURNING`. Of two concurrent attempts exactly one gets the row. No "read, check, write".

#### CSRF protection on sign-in

`OriginGuard` rejects state-changing requests with a foreign `Origin`. Requests with no header pass — a browser always adds one to a cross-site POST, and that is the case being covered. A full CSRF token for more expensive mutations is **deferred**.

#### The cookie is unsigned, the token is hashed

The cookie holds only 256 opaque bits; validity is re-checked against the database each time (`revoked_at`/`expires_at`), so there is nothing to forge. The session table's PK is the token's SHA-256, so a read-only dump leak yields no working sessions.

#### One origin in development

The admin UI (`:4200`) and the API (`:3000`) are brought together by Vite's dev proxy (`/api` → `:3000`), so the browser sees one origin and the cookie is first-party with no CORS. The rejected alternative was different origins with CORS and `SameSite=none`.

#### The open redirect is closed by a function

`safeRedirectPath` is a pure function with its own spec, not three lines in a controller. Only an absolute same-origin path is accepted; `//host`, backslashes, control characters and absolute URLs fall back to the default.

#### PKCE and state are minted by the core

The adapters generate neither the `state`, nor the `nonce`, nor the verifier. Protection against CSRF and replay is one rule, implemented and tested once. A conformance check makes sure an adapter **does not put the verifier in the URL** — only its S256 challenge belongs there.

#### Attempt state is a row, not a signed cookie

The plugin documents the absence of a signing secret as a decision, and handshake state must not have been the thing that brought one back. The row's `id` is the SHA-256 of the browser token, exactly as for sessions.

### Deliberately deferred

- A CSRF token for expensive mutations (currently `OriginGuard` + `SameSite`).
- `helmet`'s security headers — the host's business, not the plugin's.
- Cleanup of expired sessions (the rows remain but are invalid).
- A shared store for the rate limit — needed with more than one instance.
- An interactive CLI / break-glass command: the root administrator is provisioned only from configuration and the environment.

## 11. Invariants

Statements that must always hold. This doubles as a review list and as a starting set of test assertions.

- **I-01** — Every route is closed by default: `AuthGuard` is registered as an `APP_GUARD`, and being public is only ever explicit, through `@Public()`.
- **I-02** — Only an account with status `active` gets a session; the status check is repeated on **every** request, not only at sign-in.
- **I-03** — Every reason for a failed sign-in is indistinguishable — in the response and in timing alike.
- **I-04** — Every reason for an invalid one-time token renders as one bare `404` with no body.
- **I-05** — A one-time token activates an account or changes a password **exactly once**, even under concurrent requests.
- **I-06** — Consuming a reset revokes **all** of the account's sessions and issues **no** new one.
- **I-07** — Signing out revokes **only** the presented session and always succeeds (idempotency).
- **I-08** — Changing a password revokes the account's live sessions, keeping the caller's own session when one is named.
- **I-09** — Not one secret is stored in plaintext: passwords are bcrypt(12); session, link, API and SSO-attempt tokens are SHA-256.
- **I-10** — An API token's secret is returned exactly once, at issue time, and never reaches an event, a log or a repeat response.
- **I-11** — A password is accepted at ≥ 12 **characters** and ≤ 72 **UTF-8 bytes**; exceeding the ceiling is a refusal, not silent truncation.
- **I-12** — Email is unique case-insensitively at the database level.
- **I-13** — System roles cannot be deleted (the SQL condition `is_system = false`), and role seeding is idempotent and safe when several instances start at once.
- **I-14** — The `admin` role holds the full permission set **by enumeration**; there are no wildcard permissions in the system.
- **I-15** — The decision "may this actor perform this action" is made by a single implementation — `AccessPolicy`; both the session guard and the content API's bearer guard delegate to it.
- **I-16** — Listing and revoking somebody else's sessions requires `users:update`, not `users:read`.
- **I-17** — The `current` flag in the session list is true only for the caller's own session.
- **I-18** — An API token's scope is a non-empty workspace set; a non-existent id gives `400` rather than a token issued "into nowhere".
- **I-19** — The API-token management routes are gated on the `tokens:read` / `tokens:create` / `tokens:delete` permissions rather than on the `admin` role, and answer only to a session — never to a bearer token, not even one of the tokens they mint.
- **I-20** — Any SSO failure is one and the same redirect to `?error=sso`; no distinguishable reason leaves the system.
- **I-21** — An SSO attempt is consumed **before** the token exchange, and the exchange happens outside the transaction.
- **I-22** — A first SSO sign-in claims an existing account only with `emailVerified: true`; `pending` and `disabled` are rejected exactly as on the password path.
- **I-23** — Role mapping never demotes an account that already holds the `admin` role; an unknown role key is logged and ignored.
- **I-24** — JIT creation is impossible without a non-empty domain list; the match is exact on the domain, not on a suffix.
- **I-25** — Back-channel logout is idempotent, always carries `cache-control: no-store`, and answers `404` for a provider that cannot verify a logout token.
- **I-26** — The application refuses to start with SSO providers registered and `cookieSameSite: 'strict'`.
- **I-27** — The `identity-domain` package declares no dependencies; the `domain/` layer in `identity-server` imports neither NestJS, nor Drizzle, nor class-validator.
- **I-28** — In the admin UI, a "who am I" probe failing for any reason other than `401` gives the `unavailable` state rather than a redirect to sign-in.
- **I-29** — `useHasPermission` is fail-closed: `false` in every state except `authenticated`.
- **I-30** — A change of identity in a tab clears the whole query cache except the `auth` namespace.

## 12. Testing checklist

Phrased as "action → expected result", so they can go into a test case without rewriting. The server side is exercised with `curl` + `psql` and the admin side with a browser; the existing suites are `apps/server-e2e/src/server/auth/*` (21 files) and `apps/admin-e2e/src/auth/*` (13 files, including `a11y`, `keyboard`, `reflow` and `reduced-motion`).

### Sign-in and sessions

- **Correct credentials** → 200, an `apograph_session` cookie with `HttpOnly`, a `sessions` row in the database, and the cookie's value ≠ `sessions.id`.
- **A non-existent email with a well-formed password** → 401 with the same body and comparable timing as an existing email with a wrong password.
- **An account in status `pending`** → 401, no session created.
- **A `disabled` account** → 401.
- **11 sign-in requests in a minute** → the eleventh gives 429.
- **A POST with a foreign `Origin`** → 403.
- **A request with no `Origin` (curl)** → passes.
- **An extra field in the body** → 400 from `ValidationPipe`.
- **Disable a user while they are working** → their next request gives 401; the tab shows a toast and leads to sign-in with an explanation.
- **Set a session's `expires_at` into the past** → `GET /auth/me` gives 401.
- **Two requests in a row within 60 s** → `last_used_at` is updated no more than once a minute.

### Invitations

- **Open `GET /auth/invite/:token` twice** → 200 both times with the same body.
- **A junk token / an expired one / an already consumed one** → 404 with an empty body in every case.
- **Accept the invitation** → 200 + a cookie; `users.status` = `active`; `tokens.consumed_at` filled in.
- **Accept again with the same token** → 404.
- **Two concurrent `accept`s with one token** → exactly one success, the second a 404, and consistent state.
- **An 11-character password** → 400.
- **A password of 72 "é" characters (144 bytes)** → 400, not silent truncation.
- **`confirmPassword` does not match** → 400 with a field error.
- **An attempt to send a different `email` in the body** → 400 (an undeclared field).
- **The screen: a URL with no `?token=`** → the "this link does not work" card with the missing-token text, and no network request.
- **The screen: the API answers 500** → a failure card with a "retry" button, **not** "the link is dead".

### Password reset

- **Redeeming the link** → 200, **no cookie**, every `sessions` row for that user revoked.
- **A link for a `pending` account** → 404.
- **A link for a `disabled` account** → 404.
- **Feed an invitation token into `POST /auth/reset`** → 404 (the `type='reset'` predicate).
- **The screen: refresh the state after success** → the confirmation remains rather than turning into "this link no longer works".
- **Sign in with the old password after a reset** → 401.

### Permissions and roles

- **`GET /auth/me` under each of the three roles** → the `permissions` list matches the matrix in section 3.
- **A viewer calls `GET /users/:id/sessions`** → 403.
- **A contributor calls `GET /api-tokens`** → 403.
- **An attempt to delete a system role** → refusal; the row is still in the database.
- **Starting the application twice** → roles and permissions are not duplicated.
- **Permission-gated buttons under a viewer** → not rendered; a direct API call still gives 403.

### API tokens

- **Issue** → the response holds a `secret`; the database holds only the hash and the prefix; the activity log holds a `token.created` row.
- **Viewing the list again** → no `secret`.
- **An empty `workspaceIds`** → 400.
- **A non-existent workspace in the list** → 400, no token created.
- **An `expiresAt` in the past** → 400.
- **A two-workspace token, filtered by `?workspaceId=`** → it appears under each, once each.
- **Revoke, then revoke again** → 204 both times; exactly one event.
- **Call the content API with a revoked / expired / invented token** → an identical refusal in all three cases.

### SSO

- **No providers configured** → `GET /auth/sso` = `[]`, and the sign-in page shows no block and flashes no spinner.
- **A provider button** → it is an element with the `link` role pointing at `/api/auth/sso/:name/start`; the middle mouse button opens it in a new tab.
- **A callback with a foreign `state`** → a redirect to `?error=sso`, no session created.
- **A callback with no attempt cookie** → the same.
- **A repeat callback with the same parameters** → refusal (the attempt is already consumed).
- **A profile with `emailVerified: false` and an existing account** → refusal, no claiming happens.
- **JIT on, a domain outside the list** → refusal, no account created.
- **The mapping returns a role for an administrator account** → the `admin` role is kept.
- **The mapping returns a non-existent key** → the sign-in goes through, the role does not change, and a warning appears in the log.
- **`?redirect=//evil.example`** → after sign-in, a move to the safe default path.
- **Back-channel logout with a `sid`** → only that provider session's sessions die.
- **The same with a `sub` and no `sid`** → every session of the account dies.
- **A repeat notification** → 200, `revoked: 0`, with the `cache-control: no-store` header.
- **A notification about a subject with no account** → 200, not an error.
- **Starting with a `strict` cookie and providers** → the application does not start, and the message explains why.

### Admin UI: accessibility and resilience

- **Arriving on any auth screen** → focus on the screen's `<h1>`; the loading states have their own hidden heading and `role="status"`.
- **A form submission error** → the banner appears and **takes focus**; a second error with different text takes it again.
- **A forced sign-out** → a toast in the live region plus a banner on the sign-in page that outlives the toast.
- **A 401 in a tab that never had a session** → the "your session ended" toast is **not** shown.
- **The API is unreachable (500 / timeout)** → a "we cannot reach the server" card with a retry, not a redirect to sign-in.
- **Return to an idle tab after the account was disabled** → the focus re-check catches it with no user action; no loader flash.
- **A deploy with the tab open, then navigating to `/identity/signin`** → a card suggesting a reload, not a white screen.
- **Sign out and sign in as a different user in the same tab** → no data from the previous account anywhere in the interface.
- **A fully keyboard-driven pass over the sign-in form** → the SSO block comes after the fields; every element has a visible focus ring.
- **The tab title** → the "Page · Application" format, with no leftover title from the previous page after the session is lost and restored.

## 13. Boundaries of responsibility

| Area                                                 | Who owns it                           | What Identity does                                                                      |
| ---------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- |
| The database connection and running migrations       | `@apograph/database` + `@apograph/nx` | Owns the schema and migration **files**, but not the connection and not the apply step  |
| Issuing invitations and reset links, the member list | `users-server` / `users-admin`        | Owns the `tokens` table and the **redemption** of links                                 |
| Sending email                                        | nobody (not implemented)              | Hands the raw token to the calling administrator; sends nothing itself                  |
| The activity log                                     | `activity`                            | Produces the events and owns the `ACTIVITY_RECORDER` port                               |
| Checking workspace membership                        | `workspaces-server`                   | Checks existence only — through the `WORKSPACE_DIRECTORY` port                          |
| The API-token UI                                     | `api-tokens-admin`                    | Owns the entire server side of tokens                                                   |
| Mounting the authorisation gate                      | `shell-admin`                         | Supplies `AuthProvider` and `RequireAuth`, but does not decide where they stand         |
| The public content API's bearer guard                | `content-server`                      | Gives it `ApiTokenService` and the RBAC primitives so that the decision is the same one |

### What is still missing

- **Self-service password change** — the use case is implemented, the route is not.
- **A public "forgot password"** — impossible without email (see section 1).
- **User and role screens inside this plugin** — they are in `users-admin`.
- **Its own "my sessions" screen** — today the session list is available only to an administrator, by member id.
- **Permissions scoped to a workspace** — the `scope` parameter in `AccessPolicy` is reserved, but the decision is still global.

## 14. Discrepancies between code and documentation

Found while checking this dossier against the source. Not product bugs in themselves, but they mislead developer and tester alike.

| Where                              | What it says                                                                                                                                 | How it actually is                                                                                                                                                                                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/identity/server/AGENTS.md | Describes `workspaces/`, `users/` (except search) and `content/` features inside `identity-server`, with a dozen routes on `/api/workspaces` | Those folders **do not exist** in `src/lib`. What is there: `auth`, `rbac`, `root-admin`, `api-tokens`, `preferences`, `sso`, `activity`, `schema` plus the `domain/application/infrastructure` layers. Workspaces and members moved into packages of their own long ago         |
| provider-oidc/AGENTS.md            | The link `[ADR-0012](…/0012-sso-provider-port.md)`                                                                                           | **Fixed 2026-09-05.** ADR-0012 is "one storage provider per deployment"; the SSO port is ADR-0013, and `0012-sso-provider-port.md` never existed. Both provider `AGENTS.md` files now link ADR-0013, and `provider-saml`'s first mention — which had no link at all — is one now |
| provider-saml/AGENTS.md            | Mentions "the ADR-0012 bet" twice, and the dependency permitted by it                                                                        | The same thing: ADR-0013 is meant                                                                                                                                                                                                                                                |
| server/AGENTS.md, the header       | "Behaviour is still partly pending: tokens and full user management land in later tickets"                                                   | API tokens are fully implemented (service, routes, tables, events), and member management is in `users`. The wording is stale                                                                                                                                                    |
| admin/AGENTS.md, "Conventions"     | The layout is described as `components/ pages/ api/ router/ utils/` under `src/lib`                                                          | The package has already moved to layers: `domain / application / infrastructure / presentation`, with the components and pages inside `presentation/`. The neighbouring "Layout — layered" section describes it correctly, so the document contradicts itself                    |

---

**The pilot artifact.** Written from the `packages/identity` group as a model for the structure: business description → composition → permissions → data → lifecycle → flows → API → admin UI → configuration → security → invariants → checklist → boundaries → discrepancies. The other plugins are described in the same frame; sections a plugin does not have (SSO or database tables, say) simply drop out.

The source is the source code on the `claude/plugin-artifacts-descriptions-pgiou1` branch: controllers, DTOs, guards, use cases, the Drizzle schema, and the admin UI's hooks and pages. The `AGENTS.md` files were used as a skeleton, but every claim was checked against the implementation — discrepancies went into section 14.
