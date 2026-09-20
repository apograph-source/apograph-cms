# @orthacms/identity-admin

The identity **plugin** for the Ortha CMS admin UI — the admin-side counterpart
to [`@orthacms/identity-server`](../server/AGENTS.md). It contributes the
identity screens into the admin host. It ships the **login UI** at
`/identity/signin` (wired to `POST /api/auth/login` via `useLoginMutation`), the
**accept-invite UI** at `/identity/accept-invite?token=…`, the
**reset-password UI** at `/identity/reset-password?token=…` (the far end of the
link an admin generates on a member's Access tab), and
**owns the entire admin auth kit**: the auth context (`AuthState`, `useAuth`,
`AuthProviderContext`), the `AuthProvider` that fetches `GET /api/auth/me`
(`useCurrentUser`) and publishes the current user, and the `RequireAuth` route
gate. None of these are contributed to the host via a slot — the host is
auth-agnostic; the **shell** (`@orthacms/shell-admin`) imports `AuthProvider` +
`RequireAuth` and composes them into its `layout`. A successful sign-in refreshes
that state and returns the user to where `RequireAuth` sent them (or `/`). The
plugin's only `bootstrap-admin` reference is the `AdminPlugin` _type_.
User/role/access screens and logout land in later tickets (epic #3).

## Layout — layered (ADR-0003)

This plugin is **layered (tactical DDD)** — a light application of the shape,
proportionate to its small surface (it has no client domain rules; the server
owns auth). `src/lib` is organized into:

- **`domain/`** — an `Email` value object for instant login-field validation and
  a `Password` one carrying the length rule the accept **and reset** forms mirror
  from the server. Pure TS, no React.
- **`infrastructure/`** — the `authGateway` port + `httpAuthGateway`
  implementation (the sole `apiClient` user: login, logout, current-user).
- **`application/`** — the data hooks (`useLoginMutation` / `useLogoutMutation` /
  `useCurrentUser`) calling the gateway, not `apiClient`.
- **`presentation/`** — the login UI, pages, router, the plugin factory, and the
  **auth kit** (`auth/`: `AuthProvider` / `RequireAuth` / auth context). The auth
  mechanism itself is unchanged — the shell still imports `AuthProvider` +
  `RequireAuth` and `useHasPermission` works exactly as before.

## Package

- Name: `@orthacms/identity-admin`
- Import: `import { IdentityPlugin } from '@orthacms/identity-admin'`
- Grouped package (`packages/identity/admin`), admin-only. Consumed from source
  like the other workspace packages (`exports` → `./src/index.ts`,
  `customConditions: ["@orthacms/source"]`); the admin app's Vite transpiles it
  directly.

## Conventions

- Uses `type` for type contracts (not `interface`) — matches the admin host
- All exported symbols have JSDoc comments
- No `.js` extensions in TypeScript imports
- JSX enabled (`react-jsx`), DOM types available
- Components in `src/lib/components/<Name>/`; pages in `src/lib/pages/<Name>/`;
  the data layer (hooks + request fns) in `src/lib/api/`; the nested router in
  `src/lib/router/`; the plugin factory in `src/lib/utils/`; types in `src/types/`
- **File naming.** Every top-level module lives in its own folder as
  `<name>/index.ts(x)` — components in `PascalCase` (`LoginForm/index.tsx`),
  everything else in `camelCase` named for its export
  (`useLoginMutation/index.ts`, `authContext/index.ts`, `identityPlugin/index.tsx`,
  `types/auth/index.ts`). Tightly co-located sub-modules of a component may stay
  flat beside its `index` (e.g. `LoginForm/useLoginSchema.ts`). One concern per
  file — don't split a presentational page from its tiny route container; the
  page _is_ the container (see `LoginPage`)
- User-facing strings go through `react-intl` (`defineMessages` + `useIntl`);
  the host provides the single `IntlProvider`. **Each component co-locates its
  own descriptors** — a module-level `const messages = defineMessages({ … })`
  at the top of the component file, not a shared `messages.ts`. Keep the
  `id`s namespaced (`identity.<area>.<key>`) so they stay globally unique
  across components
- Forms use `@tanstack/react-form`
- Always import types with the `type` keyword

## Key exports

- `IdentityPlugin()` — factory returning an `AdminPlugin`; register it in
  `createAdmin({ plugins })`. Named to mirror the server's `IdentityPlugin`
  (the two never share a module — different apps).
- `IdentityAdminPlugin` — the plugin shape (currently a thin alias of
  `AdminPlugin`)
- `IdentityRouter` — the plugin's nested router (auth sub-routes); lazy-loads
  `LoginPage` behind a `Suspense` boundary so its chunk loads only at
  `/identity/signin`
- `LoginForm` / `AcceptInviteForm` / `AuthLayout` — the auth UI pieces.
  `LoginPage` and `AcceptInvitePage` are **not** re-exported: they are consumed
  only via the router's dynamic `import()`, and a static re-export would defeat
  the code split
- `PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH` — the client-side mirror of the
  server's credential rule
- `AuthProvider` — fetches `/api/auth/me` and publishes auth state; the shell
  wraps it around `RequireAuth` in its `layout`. It also owns the **session-lost**
  reaction (see below)
- `RequireAuth` — the route gate; redirects to `/identity/signin` while
  unauthenticated, preserving the attempted location for return-to, and renders
  the `AuthUnavailable` screen when the probe **failed** rather than answering
  "nobody". Reusable by any plugin that needs to gate its own sub-routes
  (imported from here, not the host)
- `useHasPermission(permission)` — whether the signed-in user holds a permission key
  (from `/auth/me`); fail-closed while loading. Gate permission-aware UI with it
  (e.g. the workspaces "New workspace" button on `workspaces:create`)
- `useAuth` — reads the current `AuthState`; `AuthState` / `AuthUser` are the
  types
- `useLogoutMutation` — `POST /api/auth/logout`, then writes `null` into
  `currentUserKey` and clears the rest of the cache, so the gate flips to
  unauthenticated and redirects to sign-in with nothing of the account left
  behind. A failed request keeps the UI signed in (the session was not revoked)
  and says so in a toast, rather than swallowing the click. Used by the toolbar
  account menu (`users-admin`)
- `LoginCredentials` / `AuthTokens` / `CurrentUser` — auth wire types

## Architecture

- **Plugin, not an app.** Mirrors the server side: exposes `IdentityPlugin()`
  returning the standard
  [`AdminPlugin`](../../bootstrap/admin/src/lib/types/adminPlugin/index.ts) shape,
  assembled by the host in `apps/admin/src/main.tsx`.
- **Nested routing.** The plugin contributes one wildcard route `/identity/*`
  whose element is `IdentityRouter`, a `react-router-dom` `<Routes>` that owns
  the sub-paths (`signin`, `accept-invite` and `reset-password`, with
  `/identity` → `/identity/signin`). New auth pages are added inside that
  router, not the host. Both token-bearing pages take their token from the
  **query string** (`?token=…`), never a path segment, so the secret is not part
  of a route pattern.

    **`reset-password` deliberately does not end signed in.** Accepting an invite
    lands the invitee inside the app, because the server sets a session cookie on
    the way; the reset redemption sets none — it revokes every session on the
    account instead — so the page finishes on a confirmation that hands off to the
    sign-in form. The success state is also checked _before_ the link-lookup
    states, because the token is spent by definition once the reset succeeds and a
    refetch would otherwise replace that confirmation with "this link no longer
    works".

- **Presentation vs. container.** `LoginForm` is presentation only: it manages
  field state with TanStack Form and delegates submission to an
  `onSubmit(credentials)` prop, with `isPending`/`error` props driving the button
  and alert — **no `fetch`/mutation lives in the form**. `LoginPage`
  (`pages/LoginPage/index.tsx`) is the route container the router mounts: it runs
  `useLoginMutation`, maps its `isPending`/`error` onto the form, and navigates
  to `/` on success.
- **API layer.** `src/lib/api/useLoginMutation/index.ts` issues the request via the
  shared `apiClient` from
  [`@orthacms/utils-admin`](../../utils/admin/AGENTS.md)
  (`apiClient.post('/auth/login', …)`) and wraps it in a TanStack Query
  `useMutation`. Failures are normalized to that library's `ApiError`
  (`toApiError`); `LoginPage` maps `error.status === HTTP_STATUS.UNAUTHORIZED` to
  the invalid-credentials message. `apiClient`/`queryClient` live in the shared
  library (the host mounts the query provider). The cookie is reached same-origin
  via the admin dev proxy (`/api` → the API).
- **Accept-invite.** `AcceptInvitePage` resolves the token via `useInvite`
  (`GET /api/auth/invite/:token`) and renders one of four states: a skeleton, a
  dead-link card (`InviteUnavailable` — the server returns one generic 404 for
  unknown/expired/used, so the UI has exactly one failure shape, plus a distinct
  message when the URL carried no token at all), an outage card
  (`InviteLookupFailed`, for any failure that is **not** a 404 — the token is
  fine, the server is not, so it offers a retry instead of telling the invitee
  to chase a replacement link), or `AcceptInviteForm`. The form
  collects **only a password, twice**: the invite's email and name render as
  `readOnly` fields — not `disabled`, so they stay focusable and announced —
  because letting someone edit the email on the way in would let them claim an
  identity that was never invited. On success the server has already set the
  session cookie, so the page invalidates `currentUserKey` and navigates to `/`.
- **Design system.** UI is built from `@orthacms/design-system` components
  (`Card`, `Alert`, `Input`, `Field*`, `Button`, `Logo`), not bespoke markup.
- **Session lost mid-visit.** A session can die while a tab is open — an admin
  suspends the account (the server revokes its sessions in the same
  transaction), it expires, or another device kills it. Two things pick that up,
  and both settle on the same "no cached user → gate redirects to sign-in":
    - `AuthProvider` installs `utils-admin`'s `setUnauthorizedHandler` while
      mounted, so **any** `401` on a request that expected a session writes
      `null` into `currentUserKey`. It deliberately does **not**
      `removeQueries`/`clear` — evicting queries that still have mounted
      observers makes them refetch, and each refetch `401`s straight back into
      the handler. The redirect unmounts the private tree instead.
    - `useCurrentUser` re-probes **on window focus** (bounded by `staleTime`)
      rather than resolving once per tab, so an idle tab whose account was
      suspended is caught on return without waiting for the next action. The
      refetch is invisible: `AuthProvider` keeps reporting the cached user while
      it is in flight, so focus never flashes the root loader.
- **A forced sign-out has to say so.** The redirect above replaces the whole
  view: focus was on a control that no longer exists so the browser drops it to
  `<body>`, a screen reader's virtual buffer still holds the unmounted page, and
  anything typed into a form is gone — and until ORT-135 nothing anywhere said
  why (WCAG 4.1.3 Status Messages, 2.4.3 Focus Order). Three pieces, none of them
  in `utils-admin`, whose `setUnauthorizedHandler` seam is deliberately
  meaning-free and owns no user-facing strings:
    - `AuthProvider`'s handler fires a **toast** into the host's live region,
      which lives outside the router and therefore survives the view being
      replaced. It fires only when a user was actually cached a moment ago — a
      `401` on a tab that never had a session is the ordinary signed-out state,
      and claiming otherwise would be a lie to someone who just opened a
      bookmark.
    - It also sets the one-shot flag in `application/sessionEnded`, which
      `LoginPage` latches into state on mount and renders as an `AuthNotice`.
      The toast is the announcement; the notice is what is still readable once
      it has expired. Module scope rather than router state because the two
      halves sit on opposite sides of the gate: `AuthProvider` wraps the private
      tree only, and `RequireAuth` — which issues the redirect — knows only that
      nobody is signed in _now_.
    - `AuthLayout` already moves focus to the screen's `<h1>` on arrival, so the
      visitor lands on the heading with the explanation immediately after it in
      reading order. `AuthNotice` therefore does **not** take focus (unlike
      `AuthAlert`) — a second focus move on the same mount would fight it.
- **An outage is not a sign-out.** `AuthState` has **four** statuses, not three:
  `loading`, `authenticated`, `unauthenticated`, and `unavailable`. The gateway
  turns a `401` on `/auth/me` into `data === null` (signed out) and rethrows
  everything else, so a `500`, a timeout or a dead connection resolves to
  `unavailable` and `RequireAuth` renders `AuthUnavailable` — a "we can't reach
  the server" card with a retry — instead of redirecting. Collapsing the two
  told a user with a valid session cookie that they were signed out and pointed
  them at a login form posting to the same dead API. `useHasPermission` stays
  fail-closed: everything but `authenticated` denies.
- **Arrival is not a navigation.** Every auth screen is reached by a transition
  the browser does not treat as one — the gate redirecting an expired session,
  the invite lookup resolving from skeleton to form, a submission failing — so
  focus stays wherever it was (often `<body>`, or a control that just
  unmounted) and nothing announces the change. Three pieces fix that, and each
  lives where the transition happens rather than in every screen:
    - **`AuthLayout` takes a `surface` prop** and moves focus to the current
      screen's `<h1>` whenever it changes. It is a prop rather than something
      inferred from `children` because these screens swap _inside one layout
      instance_ — `AcceptInvitePage` renders a skeleton, then a form or one of
      two failure cards, and React keeps the same `AuthLayout` mounted
      throughout, so nothing in its own lifecycle marks the moment the user
      arrived somewhere new. A busy state passes `focusHeading={false}`: the
      skeletons grew a visually-hidden `<h1>` of their own under `ORT-167` (a
      loading state is the state a slow connection sits in longest, so it is the
      one most likely to be navigated by heading), and without the opt-out the
      focus move would land the visitor on a heading that is about to be
      unmounted and replaced by the real page's.
    - **`AuthNotice`** is the sign-in page's standing explanation of _how you
      got here_ — today, a session that ended underneath you. It is the
      deliberate opposite of `AuthAlert` below on both counts: it does not take
      focus (the layout has already placed it on the heading) and it is not
      destructive (nothing the visitor did failed).
    - **`AuthAlert`** is the shared submission-failure banner for both forms, and
      it **takes focus as it appears**. `role="alert"` alone was not enough —
      focus stayed on the submit button, which sits _after_ the banner in DOM
      order, so Tab moved further away and the banner (not being in the tab
      order) was reachable only in browse mode. Render it conditionally: it
      focuses on mount and on `message` change, so it must never sit mounted and
      empty.
- **The tab title names the screen**, through `utils-admin`'s shared
  `useDocumentTitle`. This plugin used to carry a **second, naive copy** that
  snapshot `document.title` on mount and restored it on unmount, bypassing the
  registry entirely — which is why the sign-in tab said "Ortha CMS" where every
  registry-composed title said "Admin", and why losing a session on `/workspaces`
  and signing back in restored "Workspaces · Admin" over the home page. It is
  deleted (`ORT-140`); the descriptors here are page names now
  (`'Sign in'`), and the registry composes `{page} · {app}` and cooperates with
  `copilot-admin`'s unread badge through `setTitleDecorator` instead of fighting
  it.
- **A chunk that never arrives.** `AuthErrorBoundary` wraps the router's
  `Suspense`. `Suspense` handles waiting, not failing: when a deploy lands while
  a tab is open the old `index.html`'s content-hashed chunk is gone, the dynamic
  `import()` rejects, and with nothing to catch it the app unmounted to a blank
  page — on the one route a locked-out user needs. The boundary renders a card
  with a reload action, because only a fresh document request can fetch the new
  build's assets.
- **One tab, one identity.** Whenever the identity behind a tab changes —
  logout, login, accepting an invite — the mutation calls `resetSessionCache`,
  which removes every cached query outside this plugin's `auth` namespace. The
  session cookie is not the only state a session accumulates: the members
  roster, workspaces, activity and preferences all sit in the query cache for
  the whole page load, and without the sweep the next person to sign in on that
  tab inherits them until each query refetches. Logout does it on the way out
  and login on the way in, because a session can also end without a logout
  (revoked elsewhere, expired), and that path only nulls the probe.

## Usage

```typescript
// apps/admin/src/main.tsx
import { createAdmin } from '@orthacms/bootstrap-admin';
import { IdentityPlugin } from '@orthacms/identity-admin';
import './styles.css';

createAdmin({
    plugins: [IdentityPlugin()]
});
```

## Single sign-on on the sign-in page

`SsoProviders` renders the "or continue with" block from `GET /api/auth/sso`
(`useSsoProviders`). Four decisions worth knowing before touching it:

- **They are links, not buttons with handlers.** Signing in through a provider
  is a full-page navigation to `/api/auth/sso/:name/start`, which answers `302`.
  An anchor *is* a navigation, so middle-click and open-in-new-tab behave and no
  JavaScript stands between the person and the redirect. `Button asChild` is the
  design system's way to style one. The admin-e2e suite asserts the `link` role
  precisely so this cannot regress into a scripted click.
- **It renders nothing on loading, on error, and on an empty list.** The
  password form *is* the sign-in page; this is an addition to it. A spinner
  would make every visitor wait on a feature most deployments do not use, and an
  error would hand someone a problem they cannot act on while they are trying to
  sign in a way that still works.
- **It comes after the password form**, in DOM and tab order. A visitor who came
  to type a password should not tab past a list of providers to reach the field.
- **The destination is carried on the link**, not in router state:
  `?redirect=/workspaces`. The password form posts and the page navigates
  afterwards; an SSO link leaves the app entirely, so it has to take the
  destination with it. The server validates it as a same-origin path, so a value
  from router state cannot become an off-site redirect.

`LoginPage` also reads `?error=sso`, which is where every failed provider
sign-in lands. Every reason collapses to that one flag on purpose — the person
arriving is anonymous and the identity provider is not, so naming the step that
failed would tell anyone who can authenticate at a public provider which
addresses hold accounts here. A failed password submission wins over the flag:
once they have tried a password, that result is what they are waiting to hear.

## Not owned here (deferred)

- Mounting the gate — `RequireAuth` lives here, but it is the **shell** that
  composes it (with `AuthProvider`) into the `layout`; the public/private route
  split is the host's
- User/role/access screens and their data fetching
- Nav items and slot wiring — added with the host's slot system

## Tests

- **Unit (vitest)** — `src/**/*.spec.ts(x)`, configured in `vite.config.mts`
  (jsdom + the React plugin, so a component test needs no harness change).
  It covers the decisions this package makes on its own, layer by layer:
    - `domain/` — the `Email` and `Password` value objects, where the format
      rules live. Both mirror a server rule, so the specs pin the boundaries the
      two have to agree on — 320/321 characters for an email, 11/12 and 72/73
      for a password, plus the UTF-16-vs-bytes counting that `Password` shares
      with the server.
    - `presentation/auth/` — the **gate**. `useHasPermission` is fail-closed in
      every state but `Authenticated` (including with no provider mounted at
      all), the `AuthProvider` reducer keeps a failed probe distinct from a
      refused one (`Unavailable` ≠ `Unauthenticated`, so an outage does not
      bounce anyone to the sign-in form), and `RequireAuth` renders each of the
      four states. The reducer is private to `AuthProvider`, so it is driven
      through a render rather than imported.
    - `application/` — the cache rules a session change depends on:
      `resetSessionCache` removes every namespace but `auth` (and uses
      `removeQueries`, not `clear()`, so mutations survive), `sessionEnded` is a
      one-shot flag that survives StrictMode's double-invoke, and
      `useLogoutMutation` clears the cached user **before** it sweeps.
    - `infrastructure/` — `httpAuthGateway.getCurrentUser` returns `null` on
      `401` and throws on anything else. That split is what the `Unavailable`
      state is made of.
    - the form schemas — one message per empty field, and the byte-counted
      password ceiling.
- **End-to-end** — the wiring is covered from the browser in
  [`apps/admin-e2e/src/auth`](../../../apps/admin-e2e/AGENTS.md) (`login`,
  `logout`, `accept-invite`, `reset-password`, `private-routes`, `routing`,
  plus the `a11y` and
  `keyboard` suites), against mocked `/api` routes. Reach for it when what you
  are guarding only exists once the router, the query client and the gate are
  wired together — a redirect that carries `state.from`, a toast that fires on a
  real `401`. A rule that one module decides by itself belongs in a unit spec.

## Commands

- `npm exec nx typecheck @orthacms/identity-admin`
- `npm exec nx lint @orthacms/identity-admin`
- `npm exec nx test @orthacms/identity-admin`
