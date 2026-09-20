# @orthacms/api-tokens-admin

The admin-side plugin for managing **external-API bearer tokens**. It contributes
a single global page at `/api-tokens` — reachable from the main sidebar's
`directory` group (next to Workspaces and Members), **not** a workspace-scoped
page — where an admin lists, creates, and revokes the tokens that authenticate
the external content API (`/api/v1/...`). This package and the
`identity-server` endpoints behind it are the token **lifecycle**; the public
API those tokens are spent against lives in `@orthacms/content-server`
(`public-api/`).

Layered per ADR-0003, mirroring `@orthacms/users-admin`:

```
domain/types/           view-model contracts (ApiToken, WorkspaceOption) — pure TS
infrastructure/
  apiTokenGateway/      the PORT the presentation talks to
  httpApiTokenGateway/  the impl — the ONLY apiClient user
  apiTokenMapper/       wire→view anti-corruption mapper (+ derived status)
  apiTokensKeys/        query-key factory + list params
application/
  useApiTokens/         list read hook (enabled on `tokens:read`)
  useWorkspaceOptions/  workspace-selector data (GET /api/workspaces)
  useApiTokensMutation/ create + revoke mutations (invalidate apiTokensKeys.all)
presentation/
  pages/ApiTokensPage/  the routed page (list/create/revoke/reveal + states)
  components/           table, create dialog, reveal-secret dialog, empty/skeleton/no-access
  apiTokensPlugin/      the AdminPlugin factory (route + SIDEBAR_NAV_SLOT item)
```

## Key behaviours

- **Global, not workspace-scoped.** The page lives in `SIDEBAR_NAV_SLOT`
  (`group: 'directory'`, `order: 30`), gated on `tokens:read`. The token's target
  workspaces are chosen in the **create dialog** (a `MultiSelect` fed by
  `GET /api/workspaces`), so the page needs no active workspace.
- **A token spans one or more workspaces.** `workspaceIds` is a list, not a
  scalar: the dialog requires at least one (matching the server's 400 on an
  empty bucket) and the table renders the bucket as one badge per workspace. A
  consumer names which workspace a request targets with `X-Workspace-Id`; a
  single-workspace token needs no header.
- **Reveal-once secret.** The create response carries the plaintext `secret`
  exactly once; `RevealSecretDialog` shows it with copy-to-clipboard and a
  "won't be shown again" warning. Four things about it are load-bearing, and
  each mirrors the equivalent one-time invite link in `users/admin`
  (`InviteLinkPanel` / `InviteLinkDialog`):
    - the secret is a **labelled, focusable `readOnly` input** that selects
      itself on focus — not a `<code>` block — so it can be read and copied
      without the Copy button;
    - the clipboard write is wrapped in `try`/`catch`; a refused write (insecure
      origin, denied permission, unfocused document) toasts "select it manually"
      rather than doing nothing;
    - **every** dismissal path (Done, Esc, the overlay, the close button) asks
      before discarding an uncopied secret;
    - `useCreateApiToken` sets **`gcTime: 0`** and the page calls `reset()` on
      dismissal _and_ on unmount. TanStack keeps a settled mutation — including
      its result, which holds the plaintext — for `gcTime` after the last
      observer detaches, and the mutation cache is not scoped to a route. At the
      default the credential would outlive the dialog by five minutes and follow
      the user across the SPA. `reveal-secret.spec.ts` pins this.
- **The page number lives in the URL** (`?page=`), like `/users` and
  `/activity`, so a list page is linkable and survives a reload; the clamp pulls
  a hand-typed out-of-range page back to the last one.
- **Permission mirror.** Create/revoke controls gate on
  `tokens:create`/`tokens:delete`, matching the server `PERMISSIONS` keys exactly
  (a typo silently hides/mis-shows UI).

## Server contract this plugin depends on

- `GET /api/api-tokens?page=&pageSize=&workspaceId=` → `{ items, total, page, pageSize }`
  (`workspaceId` matches tokens whose bucket _contains_ it)
- `POST /api/api-tokens` `{ name, workspaceIds, scope, expiresAt? }` → token + one-time `secret`
- `DELETE /api/api-tokens/:id` → 204
- `GET /api/workspaces` → `{ id, name, description, color }[]`

All are served by `@orthacms/identity-server`'s `ApiTokensController`.

## Commands

- `npx nx typecheck @orthacms/api-tokens-admin`
- `npx nx lint @orthacms/api-tokens-admin`
