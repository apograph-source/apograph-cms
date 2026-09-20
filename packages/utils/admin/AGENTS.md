# @orthacms/utils-admin

Shared **admin frontend library** — the cross-plugin data/HTTP layer. Not a
plugin (it contributes no routes or module) and not the host: it's a small leaf
package that both the host and feature plugins import, so shared client
singletons live in one place instead of inside `bootstrap-admin`.

## Package

- Name: `@orthacms/utils-admin`
- Import: `import { apiClient, queryClient } from '@orthacms/utils-admin'`
- Grouped package (`packages/utils/admin`), admin-only. Consumed from source
  (`exports` → `./src/index.ts`); no build step.

## Key exports

- `apiClient` — the shared axios instance (`baseURL: '/api'`, `withCredentials`).
  Plugins call it (`apiClient.post('/auth/login', …)`) instead of importing
  `axios`, so base URL, credentials, and interceptors have a single home: the
  `X-Workspace-Id` request header and the global `401` handling below.
- `setUnauthorizedHandler(fn | null)` — installs the callback the response
  interceptor fires when the API answers `401` to a request that expected a live
  session (revoked, expired, or the account suspended mid-visit). The transport
  seam lives here; the **auth state it flips does not** — `identity-admin`'s
  `AuthProvider` registers a handler that drops the cached current user, so the
  route gate redirects to sign-in. That inversion is what keeps this leaf from
  depending on the identity plugin. The interceptor always rethrows, so a
  caller's own error handling still runs, and it skips the paths where a `401`
  is the endpoint's own answer (`/auth/login`, `/auth/logout`, `/auth/me`,
  `/auth/invite`) — a rejected sign-in must not read as a lost session. That
  exemption is matched on **whole path segments** of the normalized request
  path, never as a bare `startsWith` on the string the caller passed. Both
  directions of a prefix test are wrong: `apiClient.post('auth/login', …)` (no
  leading slash — axios resolves it fine against `baseURL`) would fall _out_ of
  the list and sign the user out on a typo'd password, and a future
  `/auth/logins-report` would fall _into_ it and never sign them out when the
  session really did die. The handler is also called inside a `try` — a throw
  from it must not replace the caller's `401` rejection.
- `queryClient` — the app's single TanStack Query `QueryClient`. The host wires
  it into `QueryClientProvider`; plugins use `useQuery`/`useMutation`. It sets
  one app-wide default: **a `4xx` is not retried.** A client error is the
  server's considered answer — a 404 for a deleted record, a 400 for an
  out-of-range page — so repeating the request cannot change it, and the default
  3× backoff ladder just parks the user on a loading skeleton for ~12s before the
  page can show the state it already knew about. Network failures and `5xx` are
  transient and still retried. A hook that wants different behaviour overrides
  `retry` itself (`usePreferences` disables it outright).
- `ApiError` / `toApiError(error)` — a normalized transport error carrying
  `status: number | null` (`null` for a network failure), `details` (the parsed
  response body when the server responded, else `undefined`) and
  `retryAfterSeconds` (the `Retry-After` header, when the server sent a usable
  one). `toApiError` unwraps an axios error so call sites never touch axios
  internals. **Transport only** — it carries the status, the raw body and that
  one header, not domain meaning; the consumer decides what a code means and
  narrows `details` to its endpoint's error shape (e.g. identity treats `401` as
  invalid credentials and turns a `429` plus `retryAfterSeconds` into "try again
  in 45 seconds"; content-admin reads a 422's `details.issues` to map field
  errors).

    `retryAfterSeconds` is here rather than in identity because every throttled
    route answers the same way, and it is `undefined` unless the header parses
    to a positive number of seconds — the header's other legal form is an HTTP
    date, and a wrong countdown is worse than none.

- `HTTP_STATUS` — named status codes (`UNAUTHORIZED`, `FORBIDDEN`,
  `TOO_MANY_REQUESTS`) so call sites branch on `HTTP_STATUS.UNAUTHORIZED`, not a
  bare `401`.
- `STALE_TIME` — named TanStack Query `staleTime` presets in ms
  (`None`/`Short`/`Standard`/`Forever`) so data hooks pass
  `staleTime: STALE_TIME.Standard` instead of a bare `60_000`. The same few
  durations recur across plugins' hooks; one source keeps "how long is reference
  data fresh?" a single decision.
- `createSlot<T>(name)` / `Slot<T>` / `SlotContribution<T>` — the plugin
  extension-point primitive. A slot is a named, shared list: a consumer creates
  it and reads `getItems()`, plugins contribute items via the host, and the host
  wires contributions in once at boot. Pure data (no `react`), so it lives in
  this leaf rather than the host. The _generic_ mechanism only — concrete slots
  (e.g. the shell's `SIDEBAR_NAV_SLOT`) are defined by their owning plugin.
  `getItems()` returns a **copy**: one slot is read by every plugin that
  consumes it, so handing back the internal array would make one consumer's
  in-place `sort()` or `push()` a rewrite of shared plugin state. Read it fresh
  rather than holding the array across a registration.
- `wireSlotContributions(contributions)` — what the host calls at boot to
  register every plugin's contributions. It registers **from empty**, which is
  the load-bearing part: a slot closes over one array that lives as long as its
  module and `_register` is a bare `push`, so anything that runs the boot wiring
  twice doubles every contribution. A Vite hot update does exactly that (it
  re-executes the entry module instead of reloading the page), and the dev
  sidebar filled with duplicates that compounded with each save. The reset is a
  **separate pass** over the distinct target slots, because several plugins
  contribute to one slot and clearing per contribution would drop what an
  earlier plugin in the same run had just registered.

- `slugify(input)` — derives a URL slug (`^[a-z0-9-]+$`) from free text. Pure,
  framework-free.
- `useDebouncedValue(value, delayMs)` — a generic debounce hook. Cross-plugin
  helpers like this live here rather than inside a feature; it's why the package
  takes a `react` dependency (alongside the `@tanstack/react-query` it already
  uses). Keep only **generic, framework-level** hooks here — feature/auth state
  stays in its owning plugin.

- `useTableUrlState({ searchKey, defaultPageSize })` — the URL-as-source-of-truth
  plumbing for list pages. The search box is **two-way**: it debounces into the
  URL (300 ms), and it re-syncs _back_ whenever the URL changes for a reason
  other than that debounce — Back/Forward, a link to the bare list, a saved
  view. A one-way box looks fine until you press Back and the filter reappears,
  because the effect writes it out again; the guards on both sides
  (`searchParam !== debouncedSearch` on the way in, `debouncedSearch ===
searchInput` on the way out) are what keep the round trip from looping or
  clobbering keystrokes typed during the debounce window.
- `UnsavedChangesProvider` / `useUnsavedChanges(dirty, key)` — the app-wide
  "you have unsaved changes" guard. Two rules it is easy to get wrong:
    - **Confirming answers for one form, not all of them.** The dirty set is not
      cleared on confirm; each form clears its own key as it unmounts. Clearing
      the set would disarm every other mounted form (a docked composer, a dialog
      form) permanently, since `useUnsavedChanges` only re-registers when its
      own inputs change.
    - **A confirmed navigation goes through the router** (`useNavigate`), so the
      provider must be mounted inside the router. Re-dispatching it as
      `history.pushState({}, '', url)` + a synthetic `popstate` looks equivalent
      and is not: it overwrites the state React Router keeps its history index
      in, so the index reads back `undefined`, every later push writes `NaN`,
      and Back/Forward deltas are wrong for the rest of the session.
- `avatarColorForId(id)` — hashes an id into `AVATAR_COLORS` (FNV-1a over code
  points). Not a sum of character codes: a sum is order-insensitive, so ids that
  are permutations of each other collide, and colour is one of the cues a roster
  uses to distinguish two people.

> Auth state is **not** here — context, gate, and `/auth/me` all live in
> `@orthacms/identity-admin`. This package is the shared HTTP/data + generic
> utility leaf, not a home for feature state.

## Layout

- One concern per folder, each an `index.ts`: `src/lib/apiClient/`,
  `src/lib/queryClient/`, `src/lib/staleTime/`, `src/lib/apiError/`,
  `src/lib/httpStatus/`, `src/lib/slot/`. The package surface is `src/index.ts`.

## Architecture

- **Leaf, not host.** The host (`@orthacms/bootstrap-admin`) imports
  `queryClient` to mount the provider; plugins import `apiClient`. Keeping these
  here (rather than in the host) means a plugin never has to depend on the
  composition root just to make a request.
- **Admin-only.** There is no server counterpart — the server doesn't call its
  own API. Genuinely cross-cutting _types_ shared with the server would warrant
  a separate type-only package, not a mirrored `utils-server`.

## Conventions

- `type` over `interface`; JSDoc on exports; `import type` for type-only imports
- Each module is a `camelCase` folder with an `index.ts` (`apiClient/index.ts`)

## Tests

`npm exec nx test @orthacms/utils-admin` (vitest + jsdom, co-located
`index.spec.ts(x)` beside each module). Every admin plugin inherits this
package, so a defect here is a defect everywhere at once — which is why the
seams are pinned here rather than in whichever page happened to notice: the
`401` exemption match driven through the real interceptor stack, the query
retry predicate read off the shipped client, the URL/search round trip, and the
unsaved-changes guard against a real `BrowserRouter`. Component _behaviour_
still belongs in `admin-e2e`.

## Commands

- `npm exec nx typecheck @orthacms/utils-admin`
- `npm exec nx lint @orthacms/utils-admin`
- `npm exec nx test @orthacms/utils-admin`
