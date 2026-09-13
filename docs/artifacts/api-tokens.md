# API Tokens

_Package · packages/api-tokens/admin_

**Keys for machines: how an external bearer token is born, lives and dies**

An external application — a site builder, a migration script, an AI agent — needs access to the content, and it must not go in under somebody's user account. An **API token** is exactly that: a separate machine identity with its own name, its own set of workspaces, its own scope, its own expiry and its own revoke button. This package is the **only screen** on which such a key is born and the only one on which it can be killed.

- **1** package in the group (admin only)
- **18** source files
- **1** admin route
- **3** management routes
- **2** database tables (owned by identity)
- **3** permission keys
- **2** token scopes
- **5** screen states
- **4** admin e2e suites

## Contents

- [01. Business description](#01-business-description)
- [02. Package composition](#02-package-composition)
- [03. Permissions and token scope](#03-permissions-and-token-scope)
- [04. Data model](#04-data-model)
- [05. Token lifecycle](#05-token-lifecycle)
- [06. Flows — how it works, step by step](#06-flows-how-it-works-step-by-step)
- [07. HTTP API](#07-http-api)
- [08. Admin UI: the screen, its states, its behaviour](#08-admin-ui-the-screen-its-states-its-behaviour)
- [09. Constants and limits](#09-constants-and-limits)
- [10. Security: what was done and why](#10-security-what-was-done-and-why)
- [11. Invariants](#11-invariants)
- [12. Testing checklist](#12-testing-checklist)
- [13. Boundaries of responsibility](#13-boundaries-of-responsibility)
- [14. Discrepancies between code and documentation](#14-discrepancies-between-code-and-documentation)

## 01. Business description

A CMS does not store content only so that it can be looked at in the admin UI. The site's front end pulls it, a mobile app reads it, a migration script edits it, an external agent pages through it over MCP. All of these consumers need access, and none of them should go in under a living employee's account: that person will leave, change their password or lose a permission — and production goes down with them.

**An API token is a separate identity for a machine.** It has a name ("Production storefront"), a list of workspaces it is allowed to work in, an access level (read-only or full CRUD), an optional expiry, and exactly one operation that cuts it off — revocation. The `@apograph/api-tokens-admin` package is the interface over all of that: the `/api-tokens` page in the global sidebar.

### The problem it solves

- **Separate machine access from human access.** A token does not inherit the permissions of whoever issued it: it acts in its own name, and the creator's role is never read during an access check. So revoking the token is a sufficient measure, whoever issued it and whatever that person can do afterwards.
- **Limit the blast radius.** A token is bound to a _set_ of workspaces and to one of two scopes. A leaked storefront key gives read access to one workspace's public content — not access to the admin UI, not user management, not the issuing of further tokens.
- **Make issuing a key accountable.** Issue and revoke are written to the activity log as `token.created` / `token.revoked`, together with the name, the scope, the workspace list and the non-secret prefix. "Who issued this key, when, and for what" has an answer in a log row.
- **Give an honest "once".** The secret is shown exactly once, at issue time, and is nowhere recoverable afterwards. Not because that is stricter, but because it is not in the database — only a SHA-256 is.

### Who sees it

#### Administrator

The only role that sees the "API Tokens" item in the sidebar at all. Issues a token, copies the secret, hands it to a developer, then sees in the table when the token was last used, and revokes it in one action.

#### Integration developer

Never sees this page. Receives a string of the form `apograph_…` from an administrator and puts it in their secret manager. From then on they call with `Authorization: Bearer` and, if the token covers more than one workspace, with an `X-Workspace-Id` header.

#### Contributor and viewer

They hold no `tokens:*` permission at all. There is no sidebar item; navigating straight to `/api-tokens` gives the "no access" screen and **not a single API request** — while a direct API call would give `403`.

### What this package is not

The boundaries matter more than the capabilities here: tokens are a topic smeared across three packages, and confusing them is expensive.

- **It is not the token server.** The `POST`/`GET`/`DELETE /api/api-tokens` routes, the `api_tokens` and `api_token_workspaces` tables, secret generation, hashing, verification and revocation live in `@apograph/identity-server` (the `src/lib/api-tokens/` folder). What lives here is only a client to them. The server mechanics are described in detail in the Identity dossier; this document retells them only as far as is needed to understand the lifecycle.
- **It is not the public API.** What a token is spent against is `/api/v1/…` from `@apograph/content-server` (plus media, segments, GraphQL and MCP). The bearer guard, the workspace resolution and the content-grant check are there.
- **It is not workspaces.** The list for the selector comes from `GET /api/workspaces`; the package itself knows nothing about workspaces beyond their `id` and `name`.
- **It is not the activity log.** The events are produced by `identity-server`, the log rows are written by `activity`, and the `/activity` page displays them.
- **It is not a second credential store.** MCP and GraphQL do not mint keys of their own: they accept exactly the same tokens, verified by the same `ApiTokenService.verify`. Revoking on this page kills access there too.

> **The key idea**
>
> The page is **one-directional**. The secret leaves the system in exactly one place — in the response to `POST /api/api-tokens` — and lives in the browser exactly until the dialog is closed. Everything else the table shows (the prefix, the scope, the workspaces, the dates) is non-secret metadata. That is why the screen has no "show it again" and no "copy an existing one": those operations do not exist in the system, not merely in the interface.

## 02. Package composition

The `packages/api-tokens` group consists of **one** package — `admin`. It has no server half, deliberately: tokens are part of authentication, authentication is owned by Identity, and standing up a second server plugin for three routes would mean tearing `ApiTokenService` and `HashingService` apart into different packages.

Inside is the layered layout from ADR-0003, copied from `users-admin`: `domain / infrastructure / application / presentation`. Eighteen files, about 1,900 lines.

| Layer and module                             | What it is                                                                                                 | The key point                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| domain/types/apiToken                        | The view-model contracts: `ApiToken`, `ApiTokenList`, `ApiTokenScope`, `ApiTokenStatus`, `CreatedApiToken` | Pure TypeScript, no React and no axios. `CreatedApiToken` is the only type with a `secret` field                      |
| domain/types/workspaceOption                 | A workspace as the selector sees it: `id`, `name`, `description`, `initials`, `color`                      | Initials and colour are computed on the client (`initialsOf`, `asAvatarColor`)                                        |
| infrastructure/apiTokenGateway               | The **port**: `list`, `create`, `revoke`, `listWorkspaceOptions`                                           | The seam the presentation layer never looks behind                                                                    |
| infrastructure/httpApiTokenGateway           | The HTTP implementation of the port                                                                        | **The only place in the package that uses `apiClient`**; every error is normalised through `toApiError`               |
| infrastructure/apiTokenMapper                | The anti-corruption wire→view mapper                                                                       | ISO strings → `Date`; this is also where `status` is derived (see section 5)                                          |
| infrastructure/apiTokensKeys                 | The cache-key factory and the list parameter type                                                          | `all = ['api-tokens']` — the root both mutations invalidate                                                           |
| application/useApiTokens                     | Reading a page of the list                                                                                 | `keepPreviousData`; `enabled` only under `tokens:read`; `DEFAULT_PAGE_SIZE = 25` mirrors the server constant          |
| application/useWorkspaceOptions              | The data for the workspace selector                                                                        | Key `['workspaces','options']`, `staleTime` 60 s; the page and the dialog share one cache                             |
| application/useApiTokensMutation             | `useCreateApiToken` + `useRevokeApiToken`                                                                  | **`gcTime: 0`** on creation is a security setting, not a performance one (section 6.3)                                |
| presentation/pages/ApiTokensPage             | The whole page: states, pagination, mutations, orchestration of the two dialogs                            | 373 lines — the largest file in the package                                                                           |
| presentation/components/ApiTokensTable       | A 7–8 column table plus the revoke confirmation                                                            | The actions column is rendered only under `tokens:delete`                                                             |
| presentation/components/CreateApiTokenDialog | The issue form: name, workspaces, scope, expiry                                                            | Assembles a finished `CreateApiTokenInput`, with the expiry preset already turned into ISO                            |
| presentation/components/RevealSecretDialog   | Showing the secret once                                                                                    | Three load-bearing details: a focusable field, a wrapped clipboard, and protection against closing without copying    |
| presentation/components/ApiTokensSkeleton    | Two skeletons: table and full page                                                                         | The full-page one is the `Suspense` fallback of the lazy route; its header is **real**, only the body is skeletonised |
| presentation/components/ApiTokensEmpty       | The empty state                                                                                            | The "New token" button appears only under `tokens:create`                                                             |
| presentation/components/ApiTokensNoAccess    | The "no access" screen                                                                                     | Rendered _instead of_ all content, before any request                                                                 |
| presentation/apiTokensPlugin                 | The `AdminPlugin` factory                                                                                  | One `/api-tokens` route (lazy) plus one item in `SIDEBAR_NAV_SLOT`                                                    |

The package's public API (`src/index.ts`) is deliberately narrow: the plugin factory, the `useApiTokens` hook, the key factory and the view-model types. The gateway, the mapper and the components are not exported — nobody should reuse them, because reusing them means starting a second surface for handling credentials.

> **Neighbours that are easy to confuse**
>
> **`@apograph/identity-server`** — `ApiTokenService`, `DrizzleApiTokenRepository`, `ApiTokensController`, both tables, both migrations, the `scopePermissions` function. **`@apograph/content-server`** — `ApiTokenGuard` and `ApiTokenWorkspaceGuard`, that is, _spending_ a token. **`@apograph/workspaces-server`** — the `WORKSPACE_HEADER` constant (`x-workspace-id`) and the adapter for the `WORKSPACE_DIRECTORY` port. **`@apograph/activity`** — the log rows.

## 03. Permissions and token scope

There are two _tiers_ of permission here, and they must not be confused. The first is **who may manage tokens**: three `tokens:*` keys held by the administrator role. The second is **what the token itself may do**: its scope (`scope`), which is expanded into a set of permissions on the public API side.

### Tier 1. Management permissions

| Permission    | What it opens on the server  | What it opens in the UI                                                                     | admin | contributor | viewer |
| ------------- | ---------------------------- | ------------------------------------------------------------------------------------------- | ----- | ----------- | ------ |
| tokens:read   | `GET /api/api-tokens`        | The "API Tokens" sidebar item, the page itself, the list request and the workspaces request | ✓     | —           | —      |
| tokens:create | `POST /api/api-tokens`       | The "New token" button in the header and in the empty state                                 | ✓     | —           | —      |
| tokens:delete | `DELETE /api/api-tokens/:id` | The whole actions column in the table (not a disabled button — an absent column)            | ✓     | —           | —      |

The `admin` role holds the full permission list (`[...PERMISSION_KEYS]`), so it has all three. `contributor` and `viewer` have none: their lists are enumerated by name and no `tokens:*` appears in them. The permissions are split into three keys rather than collapsed into one `tokens:manage` so that a future custom role can be given list access without being given the power to issue.

#### How a permission reaches the code

- **In the sidebar:** the `permission: 'tokens:read'` field on the slot item. The shell hides the row for a role without the permission — the same field also filters the item out of the sidebar search.
- **On the page:** three `useHasPermission` calls (`tokens:read` / `create` / `delete`). The hook is **fail-closed**: it returns `true` only in the `Authenticated` state and only if the string is in the list from `GET /api/auth/me`.
- **On the server:** `@UseGuards(PermissionsGuard)` on the controller plus `@RequirePermissions(PERMISSIONS.TOKENS_*)` on every method. The UI merely shows honestly what the server would decide anyway.

> **The permission strings are duplicated, and that is worth remembering**
>
> In the admin UI the permissions are written as literals (`'tokens:read'`), and on the server as `PERMISSIONS.TOKENS_READ` constants. A typo in the literal will not break the build: it will **silently** hide a button from an administrator, or show one to somebody the server will refuse anyway. Checking that the strings match is the job of review and e2e, not of the compiler.

### Tier 2. The token's scope and what it expands into

The scope is either `read` or `full`. The `scopePermissions` function (framework-free, in `identity-server/src/lib/api-tokens/domain/api-token-scope.ts`) turns it into a set of permission keys, and `tokenActor` wraps the token into the same `Actor` the session guard produces. From there the decision is made by the **same** `AccessPolicy`. That is why `@RequirePermissions` on a public route means the same thing for a human and for a machine.

| Permission                  | read (3) | full (9) | Why exactly this way                                                                                                                                                                                                 |
| --------------------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| content:read                | ✓        | ✓        | Reading entries — the minimum a token is created for in the first place                                                                                                                                              |
| content:create              | —        | ✓        | The full CRUD of the public API: create, edit, publish, delete                                                                                                                                                       |
| content:update              | —        | ✓        |                                                                                                                                                                                                                      |
| content:publish             | —        | ✓        |                                                                                                                                                                                                                      |
| content:delete              | —        | ✓        |                                                                                                                                                                                                                      |
| media:read                  | ✓        | ✓        | Reading an entry already returns an asset's metadata and a link to the file. Refusing the bytes to that same token would make the metadata useless: a read token is precisely the thing that wants to show a picture |
| media:create                | —        | ✓        | A `field.media` field stores asset ids, and the writer rejects an id that is not its own. A token that can create an entry but cannot upload a file would never fill a media field at all                            |
| media:update / media:delete | —        | —        | **Given to nobody.** Attaching an asset to an entry is authorship; renaming or deleting somebody else's file in the library is media administration, and the public API does not need it                             |
| segments:read               | ✓        | ✓        | Audiences decide which published entries are visible at all. A token that cannot ask whether an entry is restricted is a client that silently passes off a partial list as a complete one                            |
| segments:manage             | —        | ✓        | Deciding who an entry is available to is an editorial decision of the same weight as publishing. But the **audience dictionary** stays closed: the directory routes are session-only, and a token cannot reach them  |

> **The creator's role is not inherited**
>
> `tokenActor` supplies **the token's own id** as the identity, not `createdBy`. The role permissions of the administrator who issued it are never read. That is exactly the property the token exists for: **revoking the token must be sufficient**. The `createdBy` field reaches the public API only as _attribution_ — an uploaded asset's `uploaded_by` column is declared NOT NULL, and what goes into it is the person answerable for that key.

## 04. Data model

The `api-tokens/admin` package **owns no table at all** — it never touches the database. Both tables belong to `identity-server` and travel in its migrations (`0002_api_tokens.sql`, `0003_api_token_workspaces.sql`).

| Table                | Purpose                   | Key columns and constraints                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| api_tokens           | The key itself            | `id` uuid PK · `name` · `token_hash` **unique** — a SHA-256 and nothing else; the uniqueness also provides the lookup index · `lookup_prefix` — the non-secret leading characters, for display · `scope` — the `api_token_scope` enum (`read`\|`full`) · `expires_at` **nullable** (null = never) · `created_by` → `users.id`, `ON DELETE CASCADE` · `last_used_at` · `revoked_at` · `created_at`.<br>**There is no status column** — it is derived (section 5). |
| api_token_workspaces | The token's workspace set | PK `(token_id, workspace_id)` — the pair _is_ the grant's identity · `token_id` → `api_tokens.id` with cascade · `workspace_id` — a plain uuid **with no foreign key** · an extra `api_token_workspaces_workspace_id_idx` index for the reverse lookup "which tokens cover this workspace".                                                                                                                                                                      |

> **Why there is no foreign key onto the workspace**
>
> The `workspaces` table belongs to another plugin, and `identity` has no right to depend on it — `workspaces-server` depends on `identity-server`, and the FK would close the package graph into a cycle. Instead of a reference there is the `WORKSPACE_DIRECTORY` port: at issue time the service asks it which of the submitted ids exist, and throws `UnknownWorkspaceError` → `400` on the difference. The port is injected as `@Optional()`: if the workspaces plugin is not in the build there is nothing to check against, and the check is skipped rather than failing every issue. What is checked is **existence, not status** — an archived workspace remains a legitimate scope.

<details>
<summary>Schema history: how a single-workspace token became a set</summary>

Migration `0002` created `api_tokens` with a `workspace_id` column — one token, one workspace. Migration `0003` moved that to a many-to-many relation and contains a **hand-written backfill**:

`INSERT INTO api_token_workspaces (token_id, workspace_id) SELECT id, workspace_id FROM api_tokens ON CONFLICT DO NOTHING;` — and only after it, `ALTER TABLE api_tokens DROP COLUMN workspace_id`.

The order is load-bearing: `drizzle-kit` generates only the shape change, and without that line every live token would silently have lost its scope. This is the case where a generated migration is edited by hand rather than regenerated.

</details>

### The client-side view model

The `toApiToken` mapper is the only boundary between the wire and the interface. It does three things and not one more: turns ISO strings into `Date`s, copies the fields across one to one, and **adds a computed `status`**. Separately there is `toCreatedApiToken`, which additionally carries `secret` through — and that is the only function in the whole package that knows a plaintext secret exists.

> **The mapper deliberately substitutes no placeholders**
>
> `expiresAt`, `lastUsedAt` and `revokedAt` stay `null` when the server sent `null`. Replacing `null` with "today" or with an empty string would mean rewriting the data in transit: the table would show an expiry for a token that never expires. Rendering "Never" is the table's own business, at the formatting level.

## 05. Token lifecycle

**active** — expires_at arrived → **expired** ↘ **revoked**

There are three states, but **there is no state column in the database**. There are two independent facts — `revoked_at` and `expires_at` — from which the status is derived afresh every time, both on the server and on the client.

| Status  | How it is derived                                                      | Admitted to the public API? | Can it be revoked?                                                              |
| ------- | ---------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| active  | `revoked_at IS NULL` and (`expires_at IS NULL` or it is in the future) | Yes                         | Yes — the only status with an actions menu                                      |
| expired | `revoked_at IS NULL` but `expires_at ≤ now()`                          | No                          | There is no button: there is nothing left to switch off                         |
| revoked | `revoked_at IS NOT NULL` — **revocation wins** whatever the expiry     | No                          | A repeat revoke returns `204` but changes nothing and writes nothing to the log |

The client-side `statusOf` checks in exactly that order: `revokedAt` first, then `expiresAt`. The order is load-bearing — a revoked token may well have an expiry in the future, and showing it as "active" would be a direct lie about access. The server's `ApiTokenService.verify` is built symmetrically: refuse on `revokedAt` first, then on the expiry.

> **"Expired" on the client is computed from the browser's clock**
>
> `statusOf` compares `expiresAt` with `Date.now()` **in the browser**, while the access decision is made by the server against its own time. With a skewed workstation clock the table can show "Active" for a token the server no longer admits (or the other way round). There is no practical risk — the status here is informational and is never sent anywhere — but when investigating "why is the integration getting 401 while the admin UI shows a green badge", this is the first thing to remember.

#### What the lifecycle does not have

- **Rotation.** You cannot issue a new secret for an existing row: issuing creates a new row, and "replacing a key" is always the pair of actions "issue the new one → revoke the old one", performed by the administrator by hand.
- **Editing.** Neither the name, nor the scope, nor the workspace list, nor the expiry can be changed after issue — there is no `PATCH` route. The token is immutable by construction: changing a live key's scope is silently widening access that somebody already holds in their hands.
- **Suspension.** There is no "temporarily disable". There is revocation, and it is irreversible.
- **Deleting the row.** Revocation sets `revoked_at` rather than deleting the record: a revoked token must stay visible in the list — otherwise the trace that it ever existed disappears too. The row goes only by cascade behind a deleted creator.

## 06. Flows — how it works, step by step

### 6.1 How an administrator reaches the page at all

Not an idle question: the page is global, while all the rest of the CMS's content lives inside a workspace.

1. **The plugin puts one item into `SIDEBAR_NAV_SLOT`.** Group `directory`, `order: 30`, the `KeyRound` icon, the `text-nav-orange` accent, `permission: 'tokens:read'`.
   _directory: Workspaces (10) · Members (20) · API Tokens (30) · Audiences (40)_
2. **The shell filters the item by permission.** A contributor or viewer has no row at all — neither in the sidebar nor in the sidebar search, which reads the same slot.
3. **The `/api-tokens` route is private.** It carries no `public` flag, so the host mounts it inside the shell's authenticated layout, behind `RequireAuth`. Someone not logged in never gets there.
4. **The page loads lazily.** `React.lazy` + `Suspense` with a full-page skeleton: the chunk is fetched only by someone who actually came to this page.
5. **The permission check is repeated on the page itself.** The sidebar gate hides only the row; navigating straight to the address bypasses it. Without `tokens:read` the page renders `ApiTokensNoAccess` and **makes not a single request** — both hooks are switched off by their `enabled` flag.

> **Why the page is global rather than inside a workspace**
>
> Because **a token can cover several workspaces at once**. Putting the screen inside a workspace would mean a token spanning three workspaces has three different "homes" — each showing it as its own. Worse, revoking it from one workspace would kill access in the other two, which nothing in that context would have warned about. A token is an installation-level entity, so it lives in the directory next to workspaces and members. The workspace set is chosen in the **issue dialog** rather than taken from context — which is exactly why the page needs no active workspace.

### 6.2 Issuing a token

1. **The administrator presses "New token".** The button is in the container header and in the empty state, both only under `tokens:create`.
2. **The dialog opens with focus straight in the "Name" field** (`autoFocus`). Opening the dialog triggers the workspace load: `useWorkspaceOptions(open)`.
   _the key is shared with the page, so most often the data is already cached and the selector fills instantly_
3. **Workspaces are chosen** — a `MultiSelect` with search. Its popover is portalled **inside** the dialog element (`container={dialogEl}`): Radix locks page scrolling while the dialog is open, and without this the list could not be scrolled with the mouse wheel.
   _below the selector is a hint about the X-Workspace-Id header, wired up through aria-describedby_
4. **If the workspace list failed to load, it says so plainly.** An empty selector looks exactly like an installation with no workspaces; the administrator would conclude there is nothing to pick rather than that a request failed. So on error an `Alert` with a "Retry" button appears next to it.
5. **A scope is chosen** — `Read-only` (the default) or `Full access`. The default is the narrower of the two: this is the choice people make without thinking.
6. **An expiry is chosen** — `Never` (the default), 30 days, 90 days, 1 year. The preset is turned into an ISO string right in the dialog: `new Date(Date.now() + days·86 400 000).toISOString()`. There is no free-form date entry.
7. **The "Create token" button is enabled only with a non-empty name and a non-empty workspace list.** This mirrors the server's `400` on an empty set: the form must not let you submit what the server will reject.
8. **Submission.** `POST /api/api-tokens` with `{ name, workspaceIds, scope, expiresAt? }`. While the request is in flight the button is disabled and shows a spinner — there will be no double issue.
9. **The server collapses duplicates and checks the workspaces.** `[...new Set(workspaceIds)]`, then `assertWorkspacesExist` through the port. A non-existent id → `UnknownWorkspaceError` → `400` listing the "bad" ids.
   _naming them is safe: the caller sent them, and only an administrator can get this far_
10. **The secret is generated.** `'apograph_'` + 32 random bytes in base64url — 256 bits of entropy. What goes into the database is the SHA-256 of that value and a `lookup_prefix` — the first 15 characters (`apograph_` plus 6 characters of the secret).
11. **The token row and its workspace set are written in one transaction**, and into the same transaction's **outbox** goes the `api_token.created` event. A token that exists with no audit row behind it is exactly the key nobody can account for.
    _in the event payload: name, scope, workspaceIds, lookupPrefix, expiresAt — and never the secret or its hash_
12. **The response carries the metadata plus the `secret`.** The issue dialog closes, the secret goes into page state, and the reveal dialog opens immediately.
13. **The list is invalidated wholesale** (`apiTokensKeys.all`): the new row may land on any page, so patching one page precisely would be a lie.

> **The selector shows not every workspace, only "yours"**
>
> `GET /api/workspaces` returns the workspaces **the caller is a member of** — membership is the tenant boundary here. Two consequences follow that look like bugs but are not. First: an administrator who is not a member of a workspace cannot pick it in the dialog (even though the server would accept that id — `WORKSPACE_DIRECTORY` only checks existence). Second: in the table a workspace that is not "yours" shows a raw uuid instead of a name, because the name resolver feeds on the same list and falls through to `?? id`.

### 6.3 Revealing the secret: exactly once

This is the most consequential screen in the package. The secret exists in plaintext in three places, all three temporary: the HTTP response body, the mutation result in the TanStack cache, and page state. The dialog promises there will be "no second time", and four details turn that promise from text into behaviour.

1. **The secret is a focusable `readOnly` field with a label, not a `<code>` block.** On focus it selects its own content (`event.currentTarget.select()`). So it can be copied from the keyboard (Tab → Ctrl+C) and read by a screen reader — **without** the "Copy" button. The button is convenient but not required, and that is the point: the single copy of a credential must not depend on one mechanism.
2. **The clipboard write is wrapped in `try/catch`.** `navigator.clipboard.writeText` rejects on an insecure origin, with the permission denied, and with an inactive document. A silent failure here would mean lost credentials, so the `catch` holds a toast — "select the token above and copy it manually" — rather than nothing.
3. **A successful copy is marked**: the icon turns into a tick, a toast appears, and the `copied` flag is set.
4. **Every path to closing goes through one gate.** The "Done" button, `Esc`, a click on the backdrop, the cross — all of them arrive at `onOpenChange(false)`, which calls `requestClose()`. If `copied` is not set yet, the dialog **does not close**, but shows a red banner — "you have not copied the token yet, it cannot be shown again" — and swaps the footer for two options: "Keep it open" and "Close without copying".
5. **A new secret resets both flags.** A `useEffect` on `secret` clears `copied` and `confirmingClose`: a second issue must not inherit "already copied" from the first.
6. **On close the page forgets the secret twice.** `forgetSecret()` clears `secret` from state **and** calls `createToken.reset()`. A separate `useEffect` with empty dependencies does the same on unmount — leaving the page with the dialog open does not go through the close handler.
7. **The mutation is created with `gcTime: 0`.** TanStack keeps a finished mutation — _together with its result, which holds the plaintext secret_ — for `gcTime` after the last observer detaches, and the mutation cache is not tied to the route. At the 5-minute default the credential would outlive the dialog that just promised it was gone, and would follow the user around the whole SPA. Zero removes the entry immediately.

> **What happens if the secret was not copied**
>
> After confirming "Close without copying" the plaintext secret is left **nowhere**: not in state, not in the mutation cache, not in the query cache, not in the DOM, not in `localStorage`/`sessionStorage`, not in the URL. It cannot be recovered — the database holds only a SHA-256. The only way out is to issue a new token, which is exactly what the confirmation text says.
>
> **But the abandoned token stays alive.** The row in `api_tokens` was created, its status is `active`, and it will sit in the list until an administrator revokes it by hand. There is no automatic cleanup. In practice it is a key nobody has — it cannot be used — but it clutters the list, and in the audit it looks like a key that was handed out. The right habit: revoke that row immediately after "Close without copying".

The same outcome follows from any break between the server and the eye: if the `POST` response never reached the browser, the token has already been created on the server and the event already recorded, while nobody saw the secret. That is the price of not storing it: its only copy travels in one HTTP response.

### 6.4 How a token is spent against the public API

This half belongs to `content-server` and its neighbours; it is here so the lifecycle is described end to end.

1. **The client sends `Authorization: Bearer apograph_…`** to `/api/v1/…`. The routes are marked `@Public()`, so the global session `AuthGuard` lets them through, and all of the authentication is `ApiTokenGuard`.
2. **The header scheme is parsed case-insensitively.** No header, a different scheme, an empty value — all give one and the same bare `401`.
3. **The token is verified by hash.** `ApiTokenService.verify` computes the SHA-256 of the presented value, looks up the row, and rejects a revoked or expired one. **Unknown, revoked and expired are indistinguishable** — otherwise the endpoint would become an enumeration tool.
4. **A session cookie is not accepted in place of a token.** Deliberately: a cookie rides along with the request by itself, which is what makes CSRF possible; a bearer never does. Accepting both on an endpoint whose purpose is to let an agent write content would put CSRF back where it was removed from.
5. **The scope becomes permissions.** `scopePermissions` + `tokenActor` → `AccessPolicy.canAll` against the route's `@RequirePermissions`. Not enough — `403`, "the token's scope does not allow this operation" (as distinct from an authentication `401`).
6. **The workspace is resolved.** `ApiTokenWorkspaceGuard`: an `X-Workspace-Id` header is present → it must be a valid uuid (`400`) and **be in the token's set** (`403`); no header and the token covers exactly one workspace → that one is used; no header and several workspaces → `400` with a blunt message, "the token covers N workspaces, name the one you mean".
   _not in the set and not existing give the same 403, so a token cannot be used to enumerate workspace ids_
7. **The content grants are checked.** The type from `:typeName` must be both registered and granted to this workspace (`workspace_content`). Otherwise `404` — the same one a non-existent type gives: the grant set is the workspace's declared content surface.
8. **`last_used_at` is updated.** Fire and forget, throttled to 60 seconds and with the error swallowed: updating a timestamp has no right to fail the request it accompanies. That column is what the table later shows as "Last used" — and it is what answers "is this key still in use?".

The same pair of guards stands on four surfaces: REST content (`/api/v1/content`, `/api/v1/content-types`), media (`/api/v1/media`), audience access (`/api/v1/content/:type/:id/access`) and GraphQL (`POST /api/v1/graphql`). MCP (`POST /api/v1/mcp`) cannot reuse the guards — it is one route carrying many operations — so `McpAuthService` repeats their rule point for point and additionally accepts `?workspaceId=` in the URL, because MCP clients are configured by address and not all of them let you set a header. On a conflict the header wins, and both are checked against the token's set identically.

### 6.5 Revocation

1. **The actions menu exists only on an active row** and only under `tokens:delete`. For an expired or revoked token the cell is empty — there is nothing to switch off.
2. **The kebab is named after its row:** `aria-label` = "Actions for {name}". In a table of ten identical "more" buttons a screen reader could not tell them apart otherwise.
3. **Confirmation is mandatory.** A `ConfirmDialog` with a destructive button and honest text: "any application using '{name}' will lose access immediately; this cannot be undone".
4. **`DELETE /api/api-tokens/:id`**, with `ParseUUIDPipe` on the path, `OriginGuard` on top, and a `204` response.
5. **Revocation is a conditional write.** `UPDATE … SET revoked_at = now() WHERE id = :id AND revoked_at IS NULL RETURNING id`. No row returned means the token was unknown or already revoked, and that is **not an error**.
6. **The event is written only on a real revocation.** Inside the same transaction the row is read first (so the event can name the name, scope, workspaces and prefix), then the conditional `UPDATE` runs; if it revoked nothing, no `api_token.revoked` appears. A repeat `DELETE` gives `204` and **zero** new log rows.
7. **The UI: the row changes in place.** `apiTokensKeys.all` is invalidated, a "Token revoked" toast appears, the row's status becomes `Revoked`, and the actions menu disappears.
8. **Focus returns to a live element.** The kebab that opened the confirmation unmounts in the same re-render that brought the new status, so Radix restores focus onto a dead node and it falls through to `<body>`. The page catches that: on a `requestAnimationFrame` after the mutation settles it checks whether `document.activeElement` has become the document body, and if so moves focus to the results wrapper (`tabIndex={-1}`).
   _the one-frame delay is there so as not to race Radix's own focus restoration but to run after it_
9. **A failed revocation changes nothing.** A "could not revoke" toast, and the row stays active. Lying about revoked access is not allowed.

> **Why idempotency here is a property, not an indulgence**
>
> Revoking credentials is done in a hurry and often blind: a script killing a dozen keys, a retry after a timeout, an administrator's second tab. A `204` on "already revoked" means **it is safe to repeat**, and the `revoked_at IS NULL` condition in the SQL guarantees that the first `revoked_at` will not be overwritten with a later time. Of two concurrent revocations exactly one wins, and only that one writes a log row.

### 6.6 Pagination and the page's address

1. **The page number lives in the URL** (`?page=`), as on `/users` and `/activity`. So a page of the list can be sent to a colleague as a link, and it survives a reload and the back button.
2. **The first page does not clutter the address.** At `next <= 1` the parameter is removed rather than written as `page=1`. Navigation uses `{ replace: true }` so that paging does not fill up the browser history.
3. **Parsing the parameter is defensive:** `readPage` accepts only an integer ≥ 1, and everything else (`abc`, `0`, `-3`, `2.5`) silently becomes the first page.
4. **Clamping after mutations and for a hand-typed address.** `pageCount = max(1, ceil(total / pageSize))`; if `page > pageCount` and the data has arrived, the page is moved to the last one. Without this, revoking the last token on the last page would leave the administrator on an empty screen that looks like "there are no tokens".
5. **The page size is 25**, the `DEFAULT_PAGE_SIZE` constant mirroring the server's `API_TOKENS_DEFAULT_PAGE_SIZE`. It is needed only for page arithmetic before the first response: after that the `pageSize` from the response is used.
6. **The paginator is drawn only when `pageCount > 1`** and is captioned "Page N of M" — back/forward buttons without that number do not tell you where you are.
7. **`keepPreviousData` holds the current rows** while the next page loads: the table does not flash a skeleton while paging.

### 6.7 Filtering by workspace

The server supports `GET /api/api-tokens?workspaceId=…`: the filter is a **set-membership** check implemented as `id IN (SELECT token_id FROM api_token_workspaces WHERE workspace_id = …)`, not a join. The difference matters: a join would multiply a token spanning three workspaces into three rows of one page, while the subquery leaves it as exactly one. A token covering several workspaces appears under **each** of them — once.

> **There is no such filter in the UI**
>
> The `ApiTokensListParams` type declares it, the gateway passes it, the server understands it and e2e checks it — but the page calls `useApiTokens({ page, pageSize })` and never sends `workspaceId`. There is no control for it in the interface. So the capability exists at every level except the last; for a tester that means the filter can only be exercised through the API.

### 6.8 Audit

1. **Issue and revoke put a domain event into the transactional outbox** — in the same transaction as the write itself. Either there is both a token and an event, or there is neither.
2. **The actor is passed as a snapshot.** The controller sends the current user's `{ id, email }` separately from `createdBy`: what must remain in the log is a frozen email, not a foreign key to a user who will later be renamed or deleted.
3. **The `activity` plugin maps the events into log rows:** `api_token.created` → `token.created`, `api_token.revoked` → `token.revoked`, the subject is `api_token`, the payload is `{ name, scope, workspaceIds, lookupPrefix }`.
4. **Neither the secret nor its hash is in the log.** That is a direct requirement, not a side effect: the database stores only a SHA-256 precisely so that a leak yields no working keys, and the log has no right to become a second point of leakage. A dedicated e2e serialises every audit row and searches them for the secret.

### 6.9 Expiry

Expiry is the only transition that happens **by itself**, without anybody's action and without a log entry. Nobody writes anything: the moment simply arrives when `expires_at ≤ now()`, and `verify` starts returning `null`. The consequences worth keeping in mind:

- **There is no warning of an approaching expiry.** The integration learns it has expired from the first `401`.
- **It cannot be extended.** An expired token means issuing a new one and moving the secret into the integration.
- **The default is "Never".** A key that never expires is the default because the alternative is to offer an expiry nobody will track and get a production outage at an unknown moment. Responsibility for rotation is deliberately left with the operator.
- **An expiry in the past is rejected by the server** (`400 expiresAt must be in the future`). A token born expired is always the caller's mistake. It is unreachable through the UI: there are only four presets there, all in the future.

## 07. HTTP API

All paths carry the global `/api` prefix the host applies. Access legend: `bearer` — API-token authentication, `session` — a valid session is required, `permission` — a session plus the named permission.

### The management routes — what this package works with

| Method and path        | Access and guards      | Input                                         | Success                                                   | Failures                                                                                                                                                                                                                                       |
| ---------------------- | ---------------------- | --------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST /api-tokens       | `tokens:create` Origin | `{ name, workspaceIds[], scope, expiresAt? }` | `201` metadata + `secret` — **the only time**             | `400`: an empty or oversized set, a non-uuid in the set, a non-existent workspace, a name longer than 120, an `expiresAt` in the past, an undeclared field · `401` without a session · `403` without the permission or with a foreign `Origin` |
| GET /api-tokens        | `tokens:read`          | `?workspaceId=&page=&pageSize=`               | `{ items, total, page, pageSize }` — **never** a `secret` | `400`: a non-uuid in `workspaceId`, `page < 1`, a `pageSize` outside 1…100 · `401` · `403`                                                                                                                                                     |
| DELETE /api-tokens/:id | `tokens:delete` Origin | a uuid in the path                            | `204`                                                     | `400` non-uuid · `401` · `403`. Unknown and already revoked are **also 204**, but without an event                                                                                                                                             |
| GET /workspaces        | `workspaces:read`      | —                                             | An array of the workspaces **the caller is a member of**  | `401`; `403`                                                                                                                                                                                                                                   |

> **Token management is unreachable with a token**
>
> All three routes are session-only: they are closed by the global `AuthGuard` plus `PermissionsGuard`, and none of them carries `@Public()`. A bearer token gets nowhere near them under any scope — **a token cannot issue itself another token, list tokens, or revoke somebody else's**. That is a dedicated e2e scenario ("does not open the management API to a bearer token"), not an implication left to be assumed.

### The surfaces a token is spent against

They belong to other packages; they are listed because without them the token's lifecycle is not fully described.

| Path                                                                                          | Access   | Permission required (granted by the scope)                | Owner                                 |
| --------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------- | ------------------------------------- |
| GET /v1/content-types<br>GET /v1/content-types/:name                                          | `bearer` | `content:read` → **read and full**                        | content-server                        |
| GET /v1/content/:type…<br>(list, by id, by locale group, relations, media, translations)      | `bearer` | `content:read` → **read and full**                        | content-server                        |
| POST / PATCH / DELETE /v1/content/:type…<br>(including bulk operations and publish/unpublish) | `bearer` | `content:create\|update\|publish\|delete` → **full only** | content-server                        |
| GET /v1/media/assets/:id/raw                                                                  | `bearer` | `media:read` → **read and full**                          | media-server                          |
| POST /v1/media (upload)                                                                       | `bearer` | `media:create` → **full only**                            | media-server                          |
| GET /v1/content/:type/:id/access                                                              | `bearer` | `segments:read` → **read and full**                       | segments-server                       |
| PUT /v1/content/:type/:id/access                                                              | `bearer` | `segments:manage` → **full only**                         | segments-server                       |
| POST /v1/graphql<br>GET /v1/graphql (sandbox)                                                 | `bearer` | `content:read` at the door, then per resolver             | content-graphql                       |
| POST /v1/mcp                                                                                  | `bearer` | per each tool's `requires`                                | mcp-server (enabled by `MCP_ENABLED`) |

The `X-Workspace-Id` header applies to all of the surfaces listed; MCP has an equivalent alternative, `?workspaceId=` on the endpoint URL. The header constant (`WORKSPACE_HEADER`) and the id-validation pattern live in `@apograph/workspaces-server`, so that the session path and the token path name a workspace the same way.

## 08. Admin UI: the screen, its states, its behaviour

The plugin contributes **one** private route and **one** sidebar item. Everything else is the page's internals.

| What is contributed | Where                                      | Details                                                                                                            |
| ------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| route /api-tokens   | The private zone (inside the shell layout) | `React.lazy` + `Suspense fallback={<ApiTokensPageSkeleton />}`                                                     |
| SIDEBAR_NAV_SLOT    | Group `directory`, `order: 30`             | `labelId: 'apiTokens.nav.label'`, the `KeyRound` icon, `iconColor: 'text-nav-orange'`, `permission: 'tokens:read'` |

### The five screen states

| State     | When                               | What is shown                                                                                       | Why exactly this way                                                                                                                                                      |
| --------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No access | No `tokens:read`                   | `ApiTokensNoAccess`: a `ShieldAlert` icon, a heading, the text "ask for the tokens:read permission" | Checked **first of all** and rendered instead of all content. Not one request goes out — both hooks are disabled                                                          |
| Loading   | `isPending`                        | `ApiTokensSkeleton`: real `Table` primitives in the same card as the loaded table                   | The columns and header match to the pixel, so nothing jumps on the swap. One `role="status"` with hidden text; the table itself is `aria-hidden`                          |
| Error     | `isError`                          | `Alert variant="destructive" role="alert"` plus a "Retry" button (`refetch`)                        | Separate from the empty state: "the list failed to load" and "there are no tokens" are different facts, and offering to create a token against an unknown list is harmful |
| Empty     | Data arrived, `items.length === 0` | `ApiTokensEmpty`: an icon, a heading, an explanation, a "New token" button                          | The button appears **only** under `tokens:create` — otherwise the state explains the situation without offering a way out that does not exist                             |
| Table     | There are rows                     | 7 columns (plus an eighth for actions), with a paginator beneath it when `pageCount > 1`            | —                                                                                                                                                                         |

### Table columns

| Column     | Source         | How it renders                                                                                                        |
| ---------- | -------------- | --------------------------------------------------------------------------------------------------------------------- |
| Name       | `name`         | Bold text                                                                                                             |
| Workspaces | `workspaceIds` | **One badge per workspace.** The name is resolved from the `useWorkspaceOptions` cache; on a miss the raw id is shown |
| Token      | `lookupPrefix` | `apograph_ab12cd…` in monospace — recognise the key without seeing the secret                                         |
| Access     | `scope`        | A badge: `full` is the accented `default`, `read` the muted `secondary`                                               |
| Status     | derived        | A badge: active → `default`, expired → `secondary`, revoked → `outline`                                               |
| Expires    | `expiresAt`    | `dateStyle: 'medium'` in the locale, or "Never"                                                                       |
| Last used  | `lastUsedAt`   | The same, or "Never" — the column that reveals dead integrations                                                      |
| Actions    | —              | A kebab **only** on an active row; the whole column is absent without `tokens:delete`                                 |

### Accessibility and announcements

- **The tab title.** `useDocumentTitle('API tokens')` — before it every private route except workspaces was simply called "Admin" (WCAG 2.4.2, ticket `ORT-140`). The title names the page in the tab strip, in history, and in a screen reader's window announcement.
- **A live region with the result count.** Creating, revoking and paging change the table _without_ navigation and _without_ a title change, so beneath the header sits a hidden `role="status" aria-live="polite"` reading "N API tokens" (WCAG 4.1.3). It renders only when there is data — not while loading and not on error.
- **The focus anchor** wraps _all_ of the result states, not just the table: a mutation can leave the page in any of them, and the anchor has to be mounted in each. `tabIndex={-1}` makes it focusable programmatically without adding an extra tab stop.
- **Labels on the Radix selects.** Both `Select`s in the issue dialog are not native controls, so a `<Label>` without `htmlFor` would label nothing, and both would be announced as unnamed comboboxes distinguishable only by their current value ("Read-only", "Never"). Each has an `id` from `useId`, as does the name field.
- **The multiselect popover is portalled into the dialog** — otherwise, with page scrolling locked, its list cannot be scrolled with the wheel.
- **`min-w-0` on the secret's row.** `DialogContent` is a grid whose items default to `min-width: auto`, so the unbreakable token string would stretch the row past `max-w-lg` and push the "Copy" button outside the panel. With `min-w-0` it is the field that shrinks, not the control (`shrink-0`).
- **Eight columns at 320 px** must scroll rather than be clipped — there is a dedicated e2e for that, as there is for the paginator's reachability at the same width.

### Internationalisation

Every component carries its own `defineMessages` — the package has no shared `messages.ts`. The id namespace is flat and predictable: `apiTokens.page.*`, `apiTokens.table.*`, `apiTokens.create.*`, `apiTokens.reveal.*`, `apiTokens.empty.*`, `apiTokens.noAccess.*`, `apiTokens.skeleton.*`, `apiTokens.nav.label`. The result count is a `plural` message and dates go through `intl.formatDate`: both depend on the locale, and hardcoding either would break on the first translation.

> **The copy lags behind the capabilities**
>
> The page subtitle is "Bearer tokens for reading content through the external API", and the warning in the reveal dialog is "Anyone with it can read **this workspace's** content". Both were written for an earlier model: one workspace, and read-only. Today a token can cover several workspaces, and the `full` scope grants creating, editing, publishing and deleting content plus uploading media. Formally this is only copy, but it is read by the person deciding which key to hand out.

## 09. Constants and limits

This package has no configuration at all: `ApiTokensPlugin()` takes no arguments, reads no environment variables, and the plugin type is a thin alias of `AdminPlugin`, named separately only to give future settings somewhere to land. Everything that could be called a setting is a constant, and some of them are duplicated on both sides of the wire.

| Quantity                     | Value                        | Where it is declared                      | Meaning                                                                                                    |
| ---------------------------- | ---------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| TOKEN_PREFIX                 | `apograph_`                  | identity-server                           | A human-readable prefix: the string is recognisable as an Apograph key in somebody else's config              |
| TOKEN_ENTROPY_BYTES          | `32` (256 bits)              | identity-server                           | The random part of the secret, in base64url                                                                |
| LOOKUP_PREFIX_LENGTH         | `15` = 9 + 6                 | identity-server                           | How many characters of the raw token are kept as a non-secret label                                        |
| LAST_USED_TOUCH_INTERVAL_MS  | `60 000`                     | identity-server                           | Throttling of the `last_used_at` write: a burst of calls must not write a row per request                  |
| NAME_MAX_LENGTH              | `120`, minimum 1             | DTO                                       | The name limit. **Not duplicated on the client** — the form only checks for non-emptiness                  |
| WORKSPACE_IDS_MAX            | `100`, minimum 1             | DTO                                       | The upper bound of the set. Generous, but it bounds the insert a single request can provoke                |
| API_TOKENS_DEFAULT_PAGE_SIZE | `25`                         | DTO + `DEFAULT_PAGE_SIZE` in the admin UI | The default page size; the client copy is needed for page arithmetic before the first response             |
| API_TOKENS_MAX_PAGE_SIZE     | `100`                        | DTO                                       | The hard ceiling on `pageSize`                                                                             |
| workspaces staleTime         | `60 000` ms                  | `useWorkspaceOptions`                     | The workspace list changes rarely; an extra request on every dialog open is unnecessary                    |
| create mutation gcTime       | `0`                          | `useCreateApiToken`                       | **A security setting:** a finished mutation must not outlive the dialog together with the plaintext secret |
| Expiry presets               | `never` · 30 · 90 · 365 days | `CreateApiTokenDialog`                    | The only way to set an expiry through the UI; there is no free-form date                                   |

One thing worth remembering separately: `OriginGuard` and its `allowedOrigins` whitelist are **Identity's** configuration, but they apply to `POST`/`DELETE /api/api-tokens` too. If the admin UI is served from an origin that is not on the list, issue and revoke will answer `403` with entirely correct permissions.

## 10. Security: what was done and why

#### The secret is not stored at all

`api_tokens` holds an unsalted SHA-256 (the value is high-entropy anyway, and a deterministic hash is needed for key lookup) and the non-secret `lookup_prefix`. A read-only leak of a dump or a backup yields not one working key. That is also where "shown once" comes from — it is not interface strictness but the physics of the storage.

#### A flat refusal with no enumeration signal

An unknown, revoked or expired token gives one `401 Invalid API token`. A missing header and a foreign scheme give the same `401`. A foreign workspace and a non-existent workspace give one `403`. No response tells you which of these actually happened.

#### The token acts in its own name

`tokenActor` supplies the token's id, not the user's. The creator's role permissions are never read, so promoting or demoting an administrator does not change what a key they issued can do, and revoking the token is a sufficient and complete measure.

#### A session cookie does not stand in for a bearer

The public API and MCP do not accept a cookie. A cookie rides ambient with the request — which is exactly what makes CSRF possible; a bearer never does. Accepting both on an endpoint whose purpose is to let an external agent write content would put CSRF right back into it.

#### Management is closed twice over

The global `AuthGuard` (session) plus `PermissionsGuard` (`tokens:*`, held only by an administrator), and on the mutating routes `OriginGuard` as well. The `tokens:*` permissions belong to no token scope, so the "token issues a token" escalation is impossible by construction rather than by oversight.

#### The audit is in the same transaction

Issue and revoke are committed together with their event through `UnitOfWork` + the outbox. There is no such thing as a token without an audit row. The event payload carries the name, scope, workspaces and prefix; the secret and its hash are not there, and a dedicated e2e checks that by serialising the whole log and searching it for the secret.

#### The plaintext secret lives as briefly as possible

In the browser it exists in page state and in the mutation result; both are wiped when the dialog closes and on unmount, and `gcTime: 0` stops the mutation cache outliving the dialog. An e2e walks the fibre tree, pulls out the `QueryClient` and checks both cache structures, both storages, the URL and the DOM: after closing, the secret is nowhere.

#### The scope is not read-only

`full` grants writing, publishing and deleting content, uploading media, and managing an entry's audience access. This is not "read+" but a fully entitled editor with no human in it. The form's default is `Read-only`, because a default is chosen without thinking.

### Deferred or deliberately absent

- **There is no secret rotation.** Replacing a key is issuing a new one and revoking the old one, by hand.
- **There is no cleanup of expired rows.** An expired token stays in the table; that is its trace.
- **There is no auto-revocation of an abandoned (uncopied) token.** The row stays active until somebody revokes it.
- **There are no warnings about an approaching expiry.** Not in the UI and not by email (there is no email in the system at all).
- **There is no per-token rate limiting.** The public API does not throttle by `api_token.id`, even though the id is deliberately carried onto the request for it.
- **There are no restrictions by IP, by content type or by individual entry.** The granularity of access is a workspace plus a scope, and that is all.

## 11. Invariants

Statements that must always hold. This doubles as a review list and as a starting set of test assertions.

- **I-01** — The plaintext secret is returned exactly once — in the response to `POST /api/api-tokens` — and appears in no other response, no event and no log.
- **I-02** — The database stores only the secret's SHA-256 and the non-secret `lookup_prefix`; the secret itself is persisted nowhere.
- **I-03** — After the reveal dialog closes, the secret is absent from page state, the mutation cache, the query cache, the DOM, `localStorage`/`sessionStorage` and the URL.
- **I-04** — No path out of the reveal dialog (button, `Esc`, backdrop, cross) discards an uncopied secret without an explicit confirmation.
- **I-05** — A token's workspace set is non-empty **at issue**: an empty one is rejected by the server (`400`) and cannot be submitted from the form, and the token row and its set are written in one transaction. It does **not** stay non-empty for life, and the stronger wording this invariant used to carry — "a token without a scope is observable in no read" — was disproved on a live stack. Deleting a workspace narrows every token's basket and deliberately stops short of revoking the credential, which is not the purger's call to make, so a live token with an empty basket is reachable. It now answers `403` naming that cause, rather than the `400` that used to ask the caller to name one of zero workspaces.
- **I-06** — Duplicates in `workspaceIds` are collapsed; the set in the response is what was actually granted.
- **I-07** — A non-existent workspace in the set gives `400` rather than a token pointing nowhere; with no `WORKSPACE_DIRECTORY` bound, the check is skipped rather than failing the issue.
- **I-08** — An archived workspace is a legitimate scope: existence is checked, not status.
- **I-09** — An `expiresAt` in the past is rejected (`400`), and so is one that is not a valid ISO timestamp. An **absent** expiry means "never" — that includes an explicit `null`, which for a while was the one spelling that could _not_ issue a non-expiring token: `@IsOptional()` skips the rest of the chain for `null`, the parser guarded on `=== undefined`, and `new Date(null)` is the epoch, so the plainest way of saying "no expiry" came back as a date in the past. Fixed 2026-08-30; all four spellings are pinned together.
- **I-10** — The status is derived rather than stored, and **revocation beats expiry**: a token with `revoked_at` is `revoked` whatever its `expires_at`.
- **I-11** — Revocation is idempotent: a repeat `DELETE` answers `204`, does not change `revoked_at` and does **not** add a log row. Only the call that actually killed a live token writes an event.
- **I-12** — Issue and revoke are committed together with their event in one transaction: there is no token without an audit row and no audit row without a token.
- **I-13** — An event payload never contains the secret or its hash — only the name, scope, workspaces, prefix and expiry.
- **I-14** — The token management routes are reachable only with a session holding a `tokens:*` permission and **never** with a bearer token, whatever its scope.
- **I-15** — The decision "may this caller perform this operation" is made by one `AccessPolicy`: the token's scope is expanded into an `Actor` and checked against the same `@RequirePermissions` as a session.
- **I-16** — The permissions of the token creator's role never take part in an access decision; `createdBy` is used only as attribution on a write.
- **I-17** — Unknown, revoked and expired tokens are indistinguishable from the outside — one `401`.
- **I-18** — A token cannot work in a workspace outside its set: a foreign `X-Workspace-Id` is `403`, even if the token covers exactly one workspace.
- **I-19** — The header is required exactly when the set is larger than one: with a single workspace it is unnecessary, with several its absence is `400` rather than a silent choice made on the caller's behalf.
- **I-20** — A token with several workspaces appears in the list under **each** of them and exactly once (the filter is set membership, not a join).
- **I-21** — `last_used_at` is updated no more than once every 60 seconds, never blocks the request and never fails it if the write errors.
- **I-22** — The UI is fail-closed: without `tokens:read` the page makes not a single request; without `tokens:create` there are no issue buttons; without `tokens:delete` the whole actions column is gone.
- **I-23** — A list load error and an empty list are different screen states; a workspace load error in the dialog is likewise separated from "there are no workspaces".
- **I-24** — The page number lives in the URL, an invalid value collapses to the first page, and a page beyond the list is clamped to the last.
- **I-25** — Revocation does not leave focus on `<body>`: it is moved to a live element if Radix's restoration lost it.

## 12. Testing checklist

Phrased as "action → expected result". The server side is exercised with `curl` + `psql`. Note that the coverage is **not** in one file: `api-tokens-management.spec.ts` holds the management routes, but the authorization story is spread over eight more — `api-tokens-bearer`, the four public-content suites, GraphQL, MCP, media and segments — because every one of those consumers accepts the same credential. Looking only under `server/api-tokens/` understates it badly. The admin side is exercised with a browser (`apps/admin-e2e/src/api-tokens/`: `api-tokens`, `reveal-secret`, `keyboard`, `a11y` — 1,059 lines).

### Issuing

- **Issue a token for one workspace** → the response contains a `secret` starting with `apograph_`; the database holds only the hash and the prefix; the log holds a `token.created` row.
- **Issue a token for several workspaces** → `api_token_workspaces` holds as many rows as were selected; the table shows as many badges.
- **Pass the same id twice** → the duplicate is collapsed and the response set has no repeats.
- **An empty `workspaceIds`** → 400; and the form's submit button is not even enabled.
- **A set containing a non-existent id** → 400 listing the "bad" ids, no token created, no log row.
- **A set mixing a real and an invented workspace** → 400 for the whole thing; there is no partial issue.
- **An archived workspace in the set** → the issue goes through.
- **An `expiresAt` in the past** → 400 `expiresAt must be in the future`.
- **The "30 days" preset in the UI** → the request body carries an ISO timestamp roughly 30 days ahead.
- **A name longer than 120 characters** → 400 from `ValidationPipe`; in the UI a generic error toast, with no field highlighting.
- **A name with RTL and multi-byte characters** → stored and read back undistorted.
- **An extra field in the body** → 400 (`forbidNonWhitelisted`).
- **A double click on "Create token"** → one request goes out: the button is disabled while in flight.
- **A failed issue (500 from the API)** → the form and the entered values stay on screen, with an error toast.
- **The workspace list failed to load** → an alert with an explanation and a "Retry" button below the selector, not an empty selector.

### Revealing the secret

- **After issuing** → the dialog opened, with the secret in a labelled focusable field rather than a block of text.
- **Put focus in the field** → the content is fully selected; `Ctrl+C` works without the button.
- **A secret longer than the field's width** → the clipboard and the selection get the **whole** value, not the visible part.
- **Press "Copy" with a working clipboard** → the icon becomes a tick, with a "Copied to clipboard" toast.
- **Deny clipboard access** → a "copy it manually" toast rather than silence.
- **"Done" without copying** → the dialog does not close; the red banner and the two options are shown.
- **`Esc` without copying** → the same — the path out makes no difference.
- **"Done" after copying** → the dialog closes immediately, with no questions.
- **Close, then read the client state** → the secret is not in the mutation cache, the query cache, the storages, the URL or the DOM.
- **Reload the page right after issuing** → the token row is there, the secret is not, and the dialog does not come back.
- **Issue a second token straight away** → the new dialog has not inherited the "already copied" flag from the first.
- **Leave the page with the dialog open** → the mutation is reset on unmount and the secret does not stay in memory.

### The list, statuses and pagination

- **A table with a token spanning two workspaces** → two badges with names; for a workspace absent from the cache, the raw uuid is shown.
- **A token with `revoked_at` and a future `expires_at`** → status `Revoked`, not `Active`.
- **A token with a past `expires_at`** → status `Expired`, with no actions menu.
- **A token never used** → "Never" under "Last used".
- **A list load error** → an alert with "Retry", **not** the empty state; "Retry" restores the list.
- **An installation with no tokens** → the empty state with a create button (under `tokens:create`) and without it (without the permission).
- **Pagination: 60 tokens at 25 per page** → three pages, with no token lost and none repeated.
- **`?page=999` typed by hand** → the page is clamped to the last one.
- **`?page=abc`, `?page=0`, `?page=-3`** → the first page, with no errors.
- **Go to page 2 and reload** → we stay on page 2; the link is reproducible.
- **A single screen of results** → the paginator is not drawn at all.
- **`pageSize=100` and `pageSize=101`** → the first is accepted, the second is a 400.
- **A non-uuid `?workspaceId=`** → 400.
- **`?workspaceId=` for a token spanning three workspaces** → the token is visible under each of the three, once each.

### Revocation

- **Revoke an active token** → 204; the row changes status in place; a "Token revoked" toast; a `token.revoked` row in the log.
- **Cancel the confirmation** → not one request went out.
- **Repeat the revoke on the same id** → 204 again; `revoked_at` unchanged; no second log row.
- **Revoke a non-existent id (a valid uuid)** → 204 and an empty log.
- **Revoke by a non-uuid** → 400 from `ParseUUIDPipe`.
- **A revoke error (500)** → an error toast, and the row stays active.
- **Revoke the last token on the last page** → the page moves to the previous one rather than showing emptiness as "there are no tokens".
- **Check focus after a revoke** → it is on a live element, not on `<body>`.
- **Call the public API with the revoked token** → 401, indistinguishable from the 401 for an invented token.

### Permissions

- **Log in as a contributor or viewer** → there is no "API Tokens" item in the sidebar and the sidebar search does not find it.
- **Open `/api-tokens` directly without `tokens:read`** → the "no access" screen and **zero** network requests.
- **Call `GET /api/api-tokens` as a contributor** → 403.
- **A role with `tokens:read` but without `tokens:create`** → no issue buttons, in the header or in the empty state.
- **A role with `tokens:read` but without `tokens:delete`** → the actions column is absent entirely.
- **Try to issue a token with a bearer token** → 401 — the route is session-only.
- **A `POST` with a foreign `Origin`** → 403 from `OriginGuard`.

### Spending a token

- **A single-workspace token with no header** → works; the workspace is filled in automatically.
- **A multi-workspace token with no header** → 400 stating how many workspaces it covers.
- **A foreign `X-Workspace-Id`** → 403, and the same for a non-existent workspace.
- **A malformed `X-Workspace-Id`** → 400 "Malformed".
- **A `read` token tries to create an entry** → 403 "the scope does not allow it", not 401.
- **A `read` token fetches media bytes** → 200 — `media:read` is in both scopes.
- **A `full` token uploads a file** → 200; `uploaded_by` holds the token's creator.
- **A session cookie instead of the header** → 401.
- **A type not granted to the workspace** → 404, the same as for a non-existent type.
- **Two requests in a row within a minute** → `last_used_at` was updated at most once.
- **The same token against `/api/v1/mcp` and GraphQL** → the same permissions and the same workspace rule; revoking kills every surface at once.

## 13. Boundaries of responsibility

| Area                                                                    | Who owns it                                                                          | What this package does                                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Generating, hashing, verifying and revoking a token                     | `identity-server` (`ApiTokenService`)                                                | Calls three HTTP routes and nothing else                                             |
| The `api_tokens` and `api_token_workspaces` tables and their migrations | `identity-server`                                                                    | Owns no table and never touches the database                                         |
| Expanding a scope into permissions (`scopePermissions`)                 | `identity-server`, the `domain/` layer                                               | Shows the scope as a "Read-only" / "Full" badge and lets you choose it at issue time |
| Bearer authentication and workspace resolution                          | `content-server` (`ApiTokenGuard`, `ApiTokenWorkspaceGuard`)                         | Explains the rule in a hint under the selector; checks nothing itself                |
| The public content API, media, audiences, GraphQL, MCP                  | `content-server`, `media-server`, `segments-server`, `content-graphql`, `mcp-server` | Nothing — those are the consumers of the keys it issues                              |
| The existence of workspaces and their list                              | `workspaces-server` (the `WORKSPACE_DIRECTORY` port, `GET /api/workspaces`)          | Reads the list for the selector and for resolving names in the table                 |
| The activity log                                                        | `activity`                                                                           | Writes nothing; the rows come from identity's events                                 |
| Permissions and roles                                                   | `identity-server` (RBAC) + `identity-admin` (`useHasPermission`)                     | Only mirrors the three `tokens:*` keys in the UI                                     |
| Mounting the route and the sidebar                                      | `bootstrap-admin` + `shell-admin`                                                    | Hands over one `route` and one slot item; where they end up is not its decision      |

### What the product still does not have

- **A workspace filter in the UI** — the server, the parameter type and the gateway support it; there is no control.
- **Search and sorting in the list** — the order is always newest first, and there is no search by name.
- **Editing a token** — not the name, not the scope, not the workspace set, not the expiry.
- **Rotation and "issue a replacement"** — no such single action exists.
- **A token detail screen** — all the information is in the table row; there is no usage history beyond the single `last_used_at` stamp.
- **Bulk operations** — revocation is one at a time.
- **Showing which surfaces the chosen scope opens** — the table in section 3 exists only in the code and in this document, while the issue form offers two options with no explanation.

## 14. Discrepancies between code and documentation

Found while checking this dossier against the source. Most of it is not a product bug, but it misleads developer and tester alike, and two items are visible to an external API consumer.

| Where                                                              | What it says                                                                                                                              | How it actually is                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| create-api-token.dto.ts (and through it the OpenAPI on /reference) | "`read` grants `content:read`; `full` grants the complete content CRUD set"                                                               | **Fixed 2026-08-30** — the description now names `media:read` and `segments:read` for `read`, and `media:create`/`segments:manage` for `full`. Both scopes are wider than described: `read` = `content:read` + `media:read` + `segments:read`; `full` additionally adds `media:create` + `segments:manage`. The only complete source is `scopePermissions`. This description travels into the generated OpenAPI, so it misleads an external integrator |
| schema/api-tokens.ts                                               | The comment on `apiTokenScope`: "`read` maps to `content:read`; `full` maps to the full content CRUD set"                                 | **Fixed 2026-08-30** — the description now names `media:read` and `segments:read` for `read`, and `media:create`/`segments:manage` for `full`. The same discrepancy, a second copy of the same stale wording                                                                                                                                                                                                                                           |
| api-tokens/admin/AGENTS.md                                         | Lists the server contract with the `?workspaceId=` filter as if it were in use                                                            | The page calls `useApiTokens({ page, pageSize })` and never passes `workspaceId`; there is no filter control in the UI                                                                                                                                                                                                                                                                                                                                 |
| api-tokens/admin/AGENTS.md                                         | "Four things about it are load-bearing" about the reveal dialog                                                                           | `RevealSecretDialog` itself says "three things" in its own documentation and lists three; the fourth (`gcTime: 0`) lives in `useApiTokensMutation` and in the page. Both statements are true in substance, but the counts disagree, and a reader of the component never learns about the fourth                                                                                                                                                        |
| ApiTokensTable, doc block                                          | "`revokingId` marks the row whose revoke is in flight so its button shows a busy state and can't double-submit"                           | That state cannot be observed: `onConfirm` calls `onRevoke(id)` and immediately `setPending(null)`, the dialog closes synchronously, and the expression `busy={pending !== null && revokingId === pending.id}` is never true. What prevents a double submit is the dialog closing, not the flag; the `revokingId` prop is effectively unused                                                                                                           |
| The page and reveal-dialog copy                                    | "Bearer tokens for **reading** content…", "Anyone with it can read **this workspace's** content", "…let an external app **read** content" | Written for the "one workspace, read-only" model. A token can cover several workspaces, and the `full` scope grants writing, publishing, deleting, uploading media and managing an entry's access. The risk warning understates the risk exactly where it matters most                                                                                                                                                                                 |
| ApiTokensSkeleton                                                  | The skeleton repeats the loaded table's shape "to the pixel"                                                                              | It always draws the eighth actions column, while the loaded table draws it only under `tokens:delete`. For a role with `tokens:read` but not `tokens:delete`, the column will disappear on the swap. Unreachable today (only admin holds all three permissions), but reachable with the first custom role                                                                                                                                              |

### Inconsistencies inside the code itself

> **The issue form is not reset on every path out**
>
> `CreateApiTokenDialog` calls `reset()` inside its `Dialog onOpenChange` wrapper, that is, on `Esc`, a backdrop click and the cross. But the **"Cancel"** button calls the `onOpenChange(false)` prop directly, bypassing the wrapper, and after a successful issue the page does `setCreateOpen(false)` — bypassing it too. The component stays mounted throughout, so the name, the chosen workspaces, the scope and the expiry survive. The result: close with `Esc` and the form is clean; close with "Cancel", or issue a token, and the form reopens filled with the previous values. The practical risk is small (the next issue starts with somebody else's name and workspace set, which is noticeable), but the behaviour is unpredictable for the user and depends on how they closed it.

> **The name-length limit is not duplicated on the client**
>
> The form checks only for non-emptiness, while the server rejects a name longer than 120 characters. The user gets a generic "Couldn't create the token. Please try again." toast with no field named and no reason — advice that will not help, because trying again gives the same result. A `maxLength` on the field or an explicit validation would close this in one line.

### What the QA pass changed (2026-08-30)

This dossier was reconciled against the code and a live stack. Three of its statements did not survive and are corrected above — **I-05** (a token without a scope _is_ observable), **I-09** (`null` was the one spelling that could not mean "never"), and the claim that one file covers the server side when the authorization story is spread over nine.

The most consequential finding was not a defect at all but its cause: `packages/api-tokens/admin` had **no `test` target** — no vitest config, no spec tsconfig — unlike every sibling admin plugin. Seven of these twenty-five invariants live on that side, and the sharpest of them are about a plaintext credential leaving no trace: not in page state, not in a cache, not in the DOM, not in storage, not in the URL. There was nowhere to assert any of it except a browser, and a browser cannot see a React cache. The harness now exists, and two of the eight defects surfaced on it within minutes.

The other defects: an unparseable `expiresAt` reached `mint` as an Invalid Date because `NaN <= Date.now()` is false; the create dialog's Cancel left the form filled, so a cancelled token could be minted twice under the same name; focus after the reveal dialog landed on `<body>`, which is the failure **I-25** names for the revoke path but not for the path where a credential has just been handed over; and the `MultiSelect` popover was an unnamed `role="dialog"`, so a screen-reader user opening the workspace picker heard "dialog" and nothing else.

---

**The second artifact in the series.** Written from the `packages/api-tokens/admin` package in the same frame as the Identity dossier: business description → composition → permissions → data → lifecycle → flows → API → admin UI → constants → security → invariants → checklist → boundaries → discrepancies. The server-side mechanics of tokens belong to `@apograph/identity-server` and are described in the Identity dossier; here they are retold only as far as the token's lifecycle needs to hold together.

The source is the source code: all of `packages/api-tokens/admin/**`, `packages/identity/server/src/lib/api-tokens/**` (the service, the repository, the controller, the DTOs, the domain scope function), `packages/identity/server/src/lib/schema/api-tokens.ts` and migrations `0002`/`0003`, the guards in `packages/content/server/src/lib/public-api/http/guards/**`, the event mapping in `packages/activity/server`, plus the e2e suites in `apps/admin-e2e/src/api-tokens/` and `apps/server-e2e/src/server/api-tokens/`. The `AGENTS.md` files were used as a skeleton, but every claim was checked against the implementation — discrepancies went into section 14.
