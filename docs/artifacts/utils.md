# Utils

_Package group · packages/utils_

**Two leaf libraries: the admin UI's shared HTTP layer and the server's filter engine**

Utils is the one group in the monorepo that **does nothing itself**. It boots no application, registers no routes, owns no tables and shows not a single screen. Its contents are the admin UI's shared client singletons (one axios, one query cache, one slot system) and the server's translator from a user filter into SQL. The value here is measured not in functions but in the fact that sixteen admin plugins and seven server plugins make the same decisions the same way.

- **2** packages in the group
- **59** public exports
- **16** consuming plugins (admin)
- **7** consuming plugins (server)
- **13** filter operators
- **14** filter error codes
- **245** unit tests
- **0** tables and **0** routes

## Contents

- [01. Business description](#01-business-description)
- [02. Composition of the group](#02-composition-of-the-group)
- [03. Inventory of the exports: @apograph/utils-admin](#03-inventory-of-the-exports-apographutils-admin)
- [04. The admin UI's load-bearing seams](#04-the-admin-uis-load-bearing-seams)
- [05. Inventory of the exports: @apograph/utils-server](#05-inventory-of-the-exports-apographutils-server)
- [06. The filter grammar and its limits](#06-the-filter-grammar-and-its-limits)
- [07. Scenarios — how it works, step by step](#07-scenarios-how-it-works-step-by-step)
- [08. Rules for authors: what belongs here and what does not](#08-rules-for-authors-what-belongs-here-and-what-does-not)
- [09. Invariants](#09-invariants)
- [10. Testing checklist](#10-testing-checklist)
- [11. Boundaries of responsibility](#11-boundaries-of-responsibility)
- [12. Divergences between code and documentation](#12-divergences-between-code-and-documentation)

## 01. Business description

The monorepo has two categories of code that are easy to confuse. There is the **host** — the composition root that knows about every plugin and assembles an application out of them (`@apograph/bootstrap-admin`, `@apograph/bootstrap-server`). And there are the **plugins** — self-contained pieces of the product that bring routes, screens, tables and permissions. Utils is neither. It is a **leaf of the dependency tree**: a package everyone imports and which imports none of its consumers.

### Why a separate leaf was needed

The problem statement goes like this: _a plugin needs a shared axios to make a request. Where do you put it?_ There are three options, and two of them are bad.

- **In the host.** Then every plugin, in order to make a request, depends on the composition root — that is, on the list of every other plugin. The dependency tree closes into a ring, the build drags pages into the bundle that nobody needs, and a plugin stops being detachable: you cannot extract and reuse it without taking the whole application along.
- **One per plugin.** Then “one axios” becomes sixteen, each with its own base URL and its own interceptors. The workspace header will be attached in thirteen of the sixteen, and the global reaction to a `401` in one.
- **In a leaf.** One package that both the host and the plugins depend on, and which depends on none of them. That is `utils`.

The server half solves the same problem from the other side: five plugins have to be able to take a `?filter=…` string from a client and turn it into a `WHERE`. Written five times, such a translator gives a 500 on an `ilike` against a date five times and loses `NULL` rows on a negation five times. Written once, it is fixed once — and everyone is fixed together.

> **The key idea**
>
> A defect in this group is a defect in the whole product at once. Hence the disproportionately high test density per line of code (245 unit tests over 15 + 13 modules), and hence too almost every comment in the sources, which explains not “what the code does” but **which incident happened when it did otherwise**.

### Who sees it

#### The admin plugin developer

Writes `apiClient.get('/entries')` and gets for free: the right base URL, the session cookies, the current workspace's header, no pointless retries on 4xx, and a correct sign-out on a dead session.

#### The server plugin developer

Declares a `FilterSchema` — which columns and which relations are allowed — and gets parsing, validation, type coercion, payload-inflation protection and parameterized SQL. The schema _is_ the security boundary.

#### The end user

Sees nothing, and should not. But this is exactly where these live: the “you have unsaved changes” prompt, the tab title they find the right window by, and the unread counter in that title.

### What Utils is not

- **It is not a place for meaning.** The transport knows a 401 arrived. What it _means_ — “you have been logged out” or “wrong password” — is the consumer's call. Hence `setUnauthorizedHandler`: the seam exists, the decision does not.
- **It is not a place for user-facing strings.** The package contains not one piece of text a human will see, and no `react-intl`. The “unsaved changes” dialog is described by the `UnsavedChangesDialog` type, and the dialog with its copy is brought in by the host.
- **It is not “miscellaneous”.** The name `utils` invites a junk drawer. The actual criterion is stricter: only what _several_ plugins need and what carries _no domain knowledge_ gets in here. Authentication state, for example, lives in `identity-admin`, even though it is technically “shared”.
- **It is not a matched pair.** `utils-admin` and `utils-server` do not mirror each other and share not a single type. Only the word in the name coincides: the server does not call its own API, so the client HTTP layer has no server twin and cannot have one.

## 02. Composition of the group

Two packages, no shared codebase between them, different runtimes and different dependencies. Both are `0.4.2` and are released in the common lockstep with everything else.

| Package               | npm name               | Runtime                | Dependencies                                                                                                   | Modules | Exports |
| --------------------- | ---------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------- | ------- | ------- |
| packages/utils/admin  | @apograph/utils-admin  | The browser (React 19) | `axios` ^1.6, `@tanstack/react-query` ^5, `react` ^19, `@apograph/design-system`; peer — `react-router-dom` ^6 | 15      | 31      |
| packages/utils/server | @apograph/utils-server | Node (NestJS)          | `@nestjs/common` ^11, `drizzle-orm` ^0.45                                                                      | 13      | 28      |

### Who consumes them

The dependency is declared in the `package.json` of 16 admin packages and 7 server ones (`utils` itself does not count). In the sources there are 127 import sites for `@apograph/utils-admin` and 25 for `@apograph/utils-server`.

| Side           | Consumers                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **admin** (16) | `activity`, `alarms`, `api-tokens`, `bootstrap`, `content`, `copilot`, `i18n`, `identity`, `insights`, `media`, `segments`, `shell`, `transfer`, `users`, `workspaces`, `wysiwyg` |
| **server** (7) | `activity`, `alarms`, `content`, `i18n`, `segments`, `transfer`, `users`                                                                                                          |

Note who is absent from those lists. `query-builder/admin` builds the very filters `utils-server` parses, but does not depend on it: it repeats the operator vocabulary locally (`wireOp.ts`) — otherwise the browser bundle would drag in NestJS and Drizzle. This is deliberate duplication, the only one in the group, and it is worth remembering when adding an operator.

### How it resolves

Both packages are consumed **from source**: their `exports` point at `./src/index.ts`, and `tsconfig.base.json` sets `customConditions: ["@apograph/source"]`. There is no build step to consume them — the admin UI's Vite transpiles the leaf's TypeScript directly. The practical consequence: an edit in `utils-admin` shows up in the dev stack instantly, and a type error in it breaks `typecheck` for all sixteen consumers at once.

> **Both packages are the scaffolder's CORE_PACKAGES**
>
> In `packages/create-apograph-app/src/lib/features.ts` both are listed in the unconditional core, even though the template barely uses them. The reason is named right there: it is the first thing the author of their own page or their own plugin reaches for, and relying on npm hoisting is a phantom dependency that works until the first version conflict and never works under pnpm.

### File layout

```
packages/utils/admin/src/          packages/utils/server/src/
  index.ts        (barrel)          index.ts        (barrel)
  lib/apiClient/                    lib/clamp-int.ts
  lib/apiError/                     lib/pg-errors.ts
  lib/avatarColor/                  lib/filters/
  lib/byOrder/                        types.ts
  lib/documentTitle/                  parse-filter-tree.ts
  lib/httpStatus/                     resolve-leaf.ts
  lib/initials/                       operator-support.ts
  lib/isComposingText/                tree-to-drizzle.ts
  lib/queryClient/                    relation-exists.ts
  lib/slot/                           scalar-op.ts
  lib/slugify/                        negation.ts
  lib/staleTime/                      table-helpers.ts
  lib/unsavedChanges/                 own-property.ts
  lib/useDebouncedValue/              filter-exceptions.ts
  lib/useTableUrlState/
```

The admin convention: one concern, one `camelCase` folder with an `index.ts`, the spec sitting next to it (`index.spec.ts(x)`). The server convention: flat files, tests in `__test__/`. Both conventions are pinned in their own `AGENTS.md` and diverge from each other deliberately — these are two packages, not two faces of one.

## 03. Inventory of the exports: `@apograph/utils-admin`

The `src/index.ts` barrel serves **31 symbols**: 25 values and 6 types. Below is the full list, with no omissions; the “import sites” column counts files importing the symbol from `@apograph/utils-admin` (`utils` itself and the specs do not count).

| Symbol                 | Kind        | What it does                                                                                                                                                        | Who uses it                                                                                                                                                                         | Sites |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| apiClient              | `singleton` | The shared axios instance: `baseURL: '/api'`, `withCredentials: true`, two interceptors (the workspace header and the global 401)                                   | Every plugin with data: `content`, `media`, `users`, `identity`, `workspaces`, `activity`, `alarms`, `segments`, `transfer`, `copilot`, `i18n`, `api-tokens`, `insights`, `wysiwyg` | 30    |
| setActiveWorkspaceId   | `setter`    | Sets (or, with `null`, clears) the workspace id the interceptor attaches as `X-Workspace-Id` to every request                                                       | `workspaces-admin`, `CurrentWorkspaceProvider` — the only call site                                                                                                                 | 1     |
| setUnauthorizedHandler | `seam`      | Registers a callback the interceptor invokes on an “unexpected” 401. It carries no meaning: what to do is decided by whoever registers it                           | `identity-admin`, `AuthProvider` — the only call site                                                                                                                               | 1     |
| queryClient            | `singleton` | The application's one `QueryClient`. One applied default: **4xx is not retried**                                                                                    | The host only — `bootstrap-admin` mounts it in a `QueryClientProvider`; plugins reach it with the `useQueryClient()` hook                                                           | 1     |
| STALE_TIME             | `constants` | Named freshness presets: `None` 0, `Short` 30,000, `Standard` 60,000, `Forever` `Infinity` ms                                                                       | Data hooks across every plugin — instead of bare `60_000`s                                                                                                                          | 17    |
| HTTP_STATUS            | `constants` | The six codes the UI actually branches on: 400, 401, 403, 404, 409, 429                                                                                             | Form and page error handlers; `apiClient` itself compares against `UNAUTHORIZED`                                                                                                    | 9     |
| ApiError               | `class`     | A normalized transport error: `status: number \| null` (`null` means there was no network) and `details: unknown` (the response body as is)                         | Everywhere an error is shown: `instanceof`, reading `status`, parsing `details.issues`                                                                                              | 23    |
| toApiError             | `function`  | Unwraps an arbitrary thrown value (usually an axios error) into an `ApiError`, so the caller never touches axios internals                                          | Every query function's `catch`; internally, `queryClient`'s retry predicate                                                                                                         | 18    |
| createSlot\<T>         | `factory`   | Creates a named extension point: `name`, `getItems()` (returns a **copy**), and the internal `_register` / `_reset`                                                 | 25 slots across 6 plugins: `content` (14), `shell` (4), `workspaces` (3), `insights` (2), `copilot` (1), `wysiwyg` (1)                                                              | 8     |
| wireSlotContributions  | `host only` | Registers every plugin's contributions **from scratch**: first a separate pass clearing the target slots, then the filling                                          | `bootstrap-admin`, `createAdmin` — the only call site                                                                                                                               | 1     |
| Slot\<T>               | `type`      | The slot contract. Exported for the signatures of plugins that declare slots of their own                                                                           | Inferred from `createSlot`; no explicit imports                                                                                                                                     | 0     |
| SlotContribution\<T>   | `type`      | `{ slot, items }` — what a plugin puts in its descriptor's `slots` field                                                                                            | `bootstrap-admin` (the type of the `AdminPlugin.slots` field)                                                                                                                       | 1     |
| byOrder                | `function`  | Sorts ascending by `order` **into a new array** (`slice()` before `sort()`)                                                                                         | Slot consumers: the sidebar, the records toolbar, the editor's tabs, the widgets                                                                                                    | 6     |
| slugify                | `function`  | String → an `^[a-z0-9-]+$` slug: NFKD, diacritics stripped, lowercased, non-alphanumerics collapsed to a hyphen, edge hyphens trimmed                               | Forms where a slug is derived from a name: content types, workspaces, audiences                                                                                                     | 3     |
| useDebouncedValue      | `hook`      | Returns a value with a delay; resets the timer on every change                                                                                                      | Slug-availability checks, directory search; internally, `useTableUrlState`                                                                                                          | 5     |
| isComposingText        | `function`  | Whether an event's target is somewhere text is being typed (`input`, `textarea`, `select`, any `contenteditable`). Typed structurally rather than through `Element` | Global keyboard shortcuts: `shell` (⌘K), `content` (the palette), `copilot` (⌘J)                                                                                                    | 3     |
| useTableUrlState       | `hook`      | The URL as the source of truth for lists: `search`/`filter`/`page`/`pageSize`, a two-way debounce on search (300 ms), an `updateParams` reducer                     | List pages: members, the activity journal and others                                                                                                                                | 3     |
| TableUrlState          | `type`      | The hook's return value: including `searchPending` — “the field holds something the list has not caught up with”                                                    | Inferred from the hook; no explicit imports                                                                                                                                         | 0     |
| TableUrlStateOptions   | `type`      | `{ searchKey, defaultPageSize }`                                                                                                                                    | Inferred from the hook; no explicit imports                                                                                                                                         | 0     |
| asAvatarColor          | `function`  | Narrows an arbitrary string to a design-system palette colour, otherwise `slate`                                                                                    | Wherever a colour came from the API and could have gone stale                                                                                                                       | 3     |
| avatarColorForId       | `function`  | A deterministic colour from an id: FNV-1a over code points, modulo the palette's length                                                                             | Avatars where no colour is stored: the activity journal, member lists                                                                                                               | 3     |
| initialsOf             | `function`  | Up to two uppercase initials from a name; split on whitespace runs, the first **code point** of each part                                                           | Avatars across every plugin                                                                                                                                                         | 16    |
| initialsFromEmail      | `function`  | The same from an email's local part; split on `.` `-` `_` `+`                                                                                                       | `activity-admin`, the actor cell (when there is no name but there is an address)                                                                                                    | 1     |
| UnsavedChangesProvider | `host only` | The application-wide guard for unsaved edits: link clicks intercepted in the capture phase, `beforeunload`, programmatic navigation                                 | `bootstrap-admin`, `UnsavedChangesGuard` — supplies the dialog and its copy                                                                                                         | 1     |
| useUnsavedChanges      | `hook`      | Registers a form's dirtiness under its own key; unregisters on unmount                                                                                              | `content-admin` (the entry editor), `users-admin` (an uncopied invite link)                                                                                                         | 2     |
| useUnsavedChangesApi   | `hook`      | Access to the guard's API, or `null` outside the provider — for programmatic navigation through `confirmNavigation`                                                 | `i18n-admin`, the locale switcher                                                                                                                                                   | 1     |
| UnsavedChangesCopy     | `type`      | The shape of the confirmation copy (a title, a description, two buttons) — the contract for the host                                                                | Imported by nobody                                                                                                                                                                  | 0     |
| UnsavedChangesDialog   | `type`      | The dialog renderer function the host passes as the `dialog` prop                                                                                                   | Inferred from the prop; no explicit imports                                                                                                                                         | 0     |
| useDocumentTitle       | `hook`      | Sets the tab title for a route's lifetime and restores the bare application name on unmount                                                                         | Practically every page in every plugin                                                                                                                                              | 19    |
| setDocumentTitle       | `function`  | The imperative version of the same: `{page} · {application}`, with `null` giving the application name alone                                                         | Imported by nobody — used only from inside `useDocumentTitle`                                                                                                                       | 0     |
| setTitleDecorator      | `function`  | Sets (or clears) a **transformation** over the assembled title — a function, not a value                                                                            | `copilot-admin`, `useTabBadge` — the `(3)` unread prefix                                                                                                                            | 1     |

A zero in the “sites” column for a type is normal: types are inferred from values. A zero for `setDocumentTitle` is not: that is a value which is exported but unused (see section 12).

## 04. The admin UI's load-bearing seams

Six of the fifteen modules carry the behaviour of the whole application. Each is about one non-obvious decision with either an incident or an accessibility requirement behind it.

### apiClient: two interceptors and one exception list

The request interceptor attaches `X-Workspace-Id` when an active workspace is set, and attaches nothing when it is not (the login page, the workspace grid). The response interceptor is the one place in the product where a 401 is handled globally.

The rule itself is simple: _if the server answered 401 to a request that expected a live session, invoke the registered handler and re-throw the error anyway_. The difficulty is in the word “expected”.

| Path         | Why a 401 here is an answer, not a lost session                                          |
| ------------ | ---------------------------------------------------------------------------------------- |
| /auth/login  | Rejected credentials. Logging someone out over a typo in their password is absurd        |
| /auth/logout | Signing out when the session is already dead                                             |
| /auth/me     | The “who am I” probe; “nobody” is a legitimate answer, and the route gate is built on it |
| /auth/invite | The public invitation endpoints, including `/auth/invite/:token`                         |

The comparison runs **over whole path segments**, not as a prefix of the string the caller passed. Both sides of the naive comparison are wrong, and in opposite directions:

- `apiClient.post('auth/login', …)` — with no leading slash; axios resolves it against `baseURL` correctly, and a bare `startsWith('/auth/login')` does not. The person would be thrown out of the application over a wrong password.
- A hypothetical `/auth/logins-report` — an ordinary protected route; a prefix check would treat it as an exemption, and a genuine session death would go unnoticed. That is a failure in the “open” direction, which is worse.

`requestPath()` therefore normalizes what the caller passed: it strips the `?query` and `#hash`, takes an absolute URL's `pathname` and removes the `/api` prefix, and prepends a leading slash. After that the match is either exact or on a segment boundary (`path === exempt || path.startsWith(exempt + '/')`).

> **The handler is called inside a try, and that is not belt-and-braces**
>
> An exception thrown from the handler would **replace** the original failure: the caller's `catch` would receive the handler's error instead of its own 401 and would tell the user the wrong thing. So the exception is logged and a `Promise.reject(error)` with the original goes out.

### queryClient: 4xx is not retried

The one applied default is the retry predicate. The logic: **a 4xx is a considered answer from the server** (a 404 for a deleted entry, a 400 for a page beyond the range, a 403 for a missing permission), and repeating the same request will not change it. By default TanStack Query would make three attempts with a growing pause — some 12 seconds of loading skeleton before showing a state that was known on the first attempt.

| Error class                     | Retried | Why                                                  |
| ------------------------------- | ------- | ---------------------------------------------------- |
| No response (`status === null`) | yes     | A transport failure — the canonical case for a retry |
| `408 Request Timeout`           | yes     | A transient condition, not an answer on the merits   |
| `429 Too Many Requests`         | yes     | The client is told outright to wait, not to give up  |
| Other `4xx`                     | no      | An answer on the merits; a repeat changes nothing    |
| `5xx`                           | yes     | The server broke — possibly temporarily              |

The maximum is 3 attempts. A hook that needs otherwise overrides `retry` for itself. The predicate reads the status through `toApiError`, so it works with an axios error and with an already-normalized `ApiError` alike.

### Slots: a copy on read, registration from scratch on write

A slot is a named shared list. A consumer creates it and reads `getItems()`, plugins put contributions in through their descriptor, and the host wires everything once at startup. The mechanism here is only the _shared_ part; the individual slots (for instance `shell.sidebar.nav`) are declared by the plugin that owns them. The implementation is pure data, with no React, which is why it lives in the leaf rather than the host.

1. **`getItems()` returns a copy.**One slot is read by several plugins. Hand out the internal array and someone's in-place `sort()` rewrites the shared state for everyone else. For the same reason sorting is factored out into `byOrder`, which also copies.
   _items.slice()_
2. **`_reset()` zeroes the length rather than re-creating the array.**`getItems` and `_register` close over that specific array; reassigning it would leave them writing to and reading from an array nobody else can see.
   _items.length = 0_
3. **`wireSlotContributions` registers from scratch.**A slot closes over an array that lives as long as the module, and `_register` is a bare `push`. Anything that runs the wiring a second time doubles every contribution. Vite's hot reload does exactly that: in dev the sidebar filled with duplicates that multiplied with every save.
   _first a reset over the set of slots, then the pushes_
4. **The reset is a separate pass.**Several plugins contribute into one slot. Clear inside the registration loop and a plugin that ran earlier in the same pass has its contribution wiped.
   _new Set(contributions.map(c => c.slot))_

### UnsavedChanges: a guard that knows not a single word

A form registers its dirtiness under a key, and from that moment **any** departure asks for confirmation. Three ways out, three mechanisms:

#### In-app links

A document-level click interception **in the capture phase**, before React Router handles it. It covers every `<Link>` anywhere without touching a single call site.

#### Programmatic navigation

`confirmNavigation(proceed)` — there is no DOM event to intercept, so the call is explicit.

#### Leaving the page

The native `beforeunload` — the only thing browsers allow on reload, close and an external URL. Custom copy cannot be shown there by design.

What the click interception does **not** catch: modified clicks (a new tab or window), `download`, a `target` other than `_self`, `#…` anchors, a foreign origin, and navigating to the same path with the same query. None of these loses any edits.

> **Three mistakes pinned in the code as “don't”**
>
> **1. Not clearing the key set on confirmation.** The user's answer applies to the form that was asked about; it will drop its own key on unmount. Clearing every key would disarm any other mounted form (a docked composer, a form in a dialog) for the rest of the session — `useUnsavedChanges` only re-registers when its own inputs change.
>
> **2. Confirmed navigation goes through the router** (`useNavigate`), so the provider must be mounted inside the router. The seemingly equivalent `history.pushState({}, '', url)` plus a synthetic `popstate` clobbers the state React Router keeps its history index in: the index reads as `undefined`, every subsequent transition writes `NaN`, and the Back/Forward deltas are wrong for the rest of the session.
>
> **3. No `stopPropagation()`.** The listener is in the capture phase: stopping the event hid the click from every other interceptor on the page (close-on-outside-click for dropdowns, analytics) — and only while a form was dirty, which made the consequences intermittent and untraceable (`ORT-136`). Navigation is stopped by `preventDefault()`; suppressing the event for everyone else was never part of that.

From the same place — `ORT-136` on links inside SVG: `closest('a')` also finds an `SVGAElement`, which has no parsed `origin`/`pathname`/`search`, so the origin check bailed out early and the link navigated away without a warning. The href is now taken as `getAttribute('href')` or `href.baseVal` and resolved against the document.

### useTableUrlState: two-way search

The URL is the source of truth for lists. The search field writes to the URL with a 300 ms delay and **reads back from it** when the URL changed for any other reason — Back/Forward, a link to a bare list, a saved view. The one-way version looks like it works right up to the first Back: the effect immediately puts the filter back.

```
// inbound (URL → field): re-sync only if the URL moved
// to something OTHER than the value we ourselves just committed
if (lastSearchParam !== searchParam) {
    setLastSearchParam(searchParam);
    if (searchParam !== debouncedSearch) setSearchInput(searchParam);
}

// outbound (field → URL): write only once the debounce has caught up
useEffect(() => {
    if (debouncedSearch !== searchInput) return;   // still typing
    if (debouncedSearch === searchParam) return;   // already written
    updateParams({ [searchKey]: debouncedSearch || undefined });
}, [...]);
```

Two guards — one per direction — are the whole mechanism: without the first the loop closes into a cycle, without the second the characters typed inside the debounce window are erased. `searchPending` (`searchInput !== searchParam`) exists because the list's `isFetching` is a poor “searching” indicator: it turns on only _after_ the debounce commits, and on a fast network the request itself takes milliseconds, so visibly nothing happens.

`updateParams` merges a patch into the existing parameters, drops empty values and by default resets `page` (a narrower selection means fewer pages); the write is always `{ replace: true }` so that every keystroke does not settle into history.

### documentTitle: the title is assembled, not written

The module holds three things: the **application name**, read once at module load from the host markup's `<title>` (`apps/admin/index.html`) — the leaf does not own the product's name; the **current page's title** (or `null`); and a **decorator** — a transformation over the assembled string.

```
compose() = page ? `${page} · ${APP_NAME}` : APP_NAME
render()  = document.title = decorate(compose())
```

The decorator is a _transformation_, not a write, and that matters: a page-title change and an unread-badge change cannot clobber each other, because whoever went last reassembles the string from the same clean base rather than from whatever happened to be in `document.title`. If the copilot wrote the title directly, the counters would stack on top of each other, and the first chat opened would pin the tab forever to whichever page was open at that moment.

The motivation is not cosmetic: a tab's title is the main landmark when switching windows and the label for history entries and bookmarks. One static title makes every route in the product indistinguishable (WCAG 2.4.2 Page Titled).

### What exactly the modules hold

The package deliberately consists of singletons. For an SPA with no SSR that is fine (no per-request isolation is needed), but knowing what survives navigation is mandatory.

| Module        | State                               | Who changes it                                 | When it is cleared                                                                |
| ------------- | ----------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| apiClient     | `activeWorkspaceId: string \| null` | `workspaces-admin` on entering a workspace     | Never automatically — **there is deliberately no cleanup on unmount** (see below) |
| apiClient     | `unauthorizedHandler`               | `identity-admin`, in an effect                 | `setUnauthorizedHandler(null)` when `AuthProvider` unmounts                       |
| documentTitle | `APP_NAME`, `page`, `decorate`      | Routes and the copilot                         | `page` — on route unmount; `decorate` — when the badge is cleared                 |
| slot          | The array of contributions per slot | The host only, through `wireSlotContributions` | On every wiring (in the first pass)                                               |
| queryClient   | The whole server-state cache        | Plugins' hooks                                 | By cache garbage collection; signing out clears the current user's key            |

> **Why the workspace id is not cleared on the way out**
>
> `CurrentWorkspaceProvider` sets it **during render** (the parent renders before its children, otherwise a child hook's first request would go out without the header) and updates it in an effect when the workspace changes. There is deliberately no cleanup on unmount: clearing it would race with background refetches (for instance a content-list refetch on window focus after you have already left for the workspace grid), which would go out without `X-Workspace-Id` and get a 400 from the guard. A lingering id is harmless: the header is read only by workspace-scoped routes, and those always live inside the shell, which resets it on entry.

## 05. Inventory of the exports: `@apograph/utils-server`

The barrel serves **28 symbols**: 15 values and 13 types. Five of the values are “constant object + same-named type” pairs (`FilterOperator`, `ScalarFieldType`, `RelationKind`, `WithinLastUnit`, `FilterErrorCode`): the code uses them both as a value in a `switch` and as a type in a signature. The package has no NestJS module — it is a plain library anyone can import.

### The filter engine

| Symbol                  | Kind               | What it does                                                                                                                                             | Who uses it                                                                                           | Sites |
| ----------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----- |
| parseFilterTree         | `function`         | Parses a payload (a JSON `string` or an already-parsed object) into a `ParsedNode` tree, checking it against the schema. `null` means there is no filter | `content` (records, the public API, the copilot's tools), `users`, `activity`, `alarms`               | 6     |
| applyFilterTree         | `async function`   | Translates a tree into a single Drizzle `SQL` fragment. `undefined` means there is nothing to translate. Async because of the extensions                 | The same, minus `alarms` (rules there are validated but executed through content's `EntryMatchQuery`) | 6     |
| FilterSchema            | `type`             | One endpoint's public filter surface: `fields`, `relations`, `extensionFields` and four limits                                                           | `users`, `activity`, `content` (in content the schema is assembled dynamically per type)              | 3     |
| FieldSchema             | `type`             | `Record<string, ScalarFieldSchema>` — the columns exposed on one table                                                                                   | `content` (an entry's filter surface, the extensions), `segments`, `i18n`                             | 6     |
| ScalarFieldSchema       | `type`             | `{ type, enumValues? }` — one column's coercion rules                                                                                                    | `content`                                                                                             | 2     |
| ScalarFieldType         | `constants + type` | Six types: `string`, `number`, `boolean`, `uuid`, `date`, `enum`                                                                                         | The package's most-used symbol — every filterable column is declared with it                          | 8     |
| FilterOperator          | `constants + type` | The vocabulary's thirteen operators                                                                                                                      | `content`, `segments` — wherever a predicate is assembled by hand                                     | 2     |
| RelationKind            | `constants + type` | Five relation kinds, the discriminant of the subquery's shape                                                                                            | `content`, an entry's filter surface                                                                  | 1     |
| RelationSchema          | `type`             | A discriminated union of five variants — the description of one traversable relation                                                                     | `content`                                                                                             | 1     |
| RelationScope           | `type`             | `(target) => SQL \| undefined` — a predicate glued **inside** the EXISTS: the workspace boundary and soft-delete                                         | `content`                                                                                             | 1     |
| WithinLastUnit          | `constants + type` | Three window units: `minutes`, `hours`, `days`                                                                                                           | Inside the package; not imported outward                                                              | 0     |
| WithinLastValue         | `type`             | `{ n, unit }` — the one object-valued value in the whole grammar                                                                                         | Inside the package                                                                                    | 0     |
| ParsedRule              | `type`             | A leaf of the tree: `{ kind:'rule', path, op, value }`                                                                                                   | `content` — the extensions' `resolveExtension` signature                                              | 4     |
| ParsedGroup             | `type`             | A group node: `{ kind:'group', combinator, children }`                                                                                                   | Inside the package                                                                                    | 0     |
| ParsedNode              | `type`             | The union of node and leaf — what the parser and the translator exchange                                                                                 | Inferred from `parseFilterTree`                                                                       | 0     |
| ApplyFilterTreeOptions  | `type`             | The translator's options; today there is one — `resolveExtension`                                                                                        | Inferred from the call                                                                                | 0     |
| FilterExtensionResolver | `type`             | `(rule) => Promise<SQL>` — the host answers for a “virtual” field                                                                                        | Inferred from the options                                                                             | 0     |
| DbLike                  | `type`             | The minimal database shape: only `select().from().where()` and `innerJoin`                                                                               | Inferred from the call                                                                                | 0     |
| TableLike               | `type`             | `object`. Deliberately not drizzle's `Table`: a protected field in drizzle's generics breaks structural assignability across packages under `nodenext`   | Inferred from the call                                                                                | 0     |
| OPERATORS_BY_TYPE       | `table`            | Which operators are allowed for each column type                                                                                                         | Inside the package; not imported outward                                                              | 0     |
| operatorsFor            | `function`         | Reads the table through `Object.hasOwn`; `undefined` means the type is unknown (a schema bug, not a client's)                                            | Inside the package                                                                                    | 0     |
| FilterException         | `400`              | A `BadRequestException` with a machine-readable `code` and a structured `context`                                                                        | Caught (`instanceof`) in `alarms` and content's controllers; **nobody outside throws it**             | 2     |
| FilterErrorCode         | `constants + type` | Fourteen categories of parse error                                                                                                                       | Not imported: the code is read from the HTTP response body                                            | 0     |
| FilterSchemaException   | `500`              | An `InternalServerErrorException`, code `FILTER_SCHEMA_INVALID`: the request is fine, and the schema the plugin's author wrote is broken                 | `content`, assembling an entry's filter surface                                                       | 1     |

### Outside filters

| Symbol                | What it does                                                                                                                                                              | Who uses it                                              | Sites |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----- |
| clampInt              | `(raw, fallback, min, max)`: non-numeric gives `fallback`, numeric is truncated to an integer and clamped into range. For pagination parameters                           | `content` — the entry and revision controllers           | 2     |
| isUniqueViolation     | Whether an error (or its `cause`, up to 5 levels deep) is a Postgres `23505` unique violation                                                                             | `users`, `workspaces`, `content` (saved views), `alarms` | 3     |
| violatedConstraint    | The **name** of the index that fired, `''` when the driver gave no name, `undefined` when it is not a 23505                                                               | `content`, `EntryWriterService`                          | 1     |
| isForeignKeyViolation | A `23503` foreign-key violation. Deliberately a boolean rather than a name: unlike several unique indexes on one table, the answer here does not depend on which FK fired | `content`, `EntryWriterService`                          | 1     |

> **Why the index's name rather than just “a conflict”**
>
> One table can carry several unique indexes. A localized content table has two — the `(locale_group_id, locale)` pair and the within-locale one-to-one relation index. Reporting one as the other sends an editor off to fix something that is not broken. Returning `''` for an unattributed violation lets the caller distinguish “uniqueness was violated, but we do not know which” from “this is not about uniqueness at all” without making a second call.

### What a schema declaration looks like

The schema _is_ the security boundary: only the fields, operators and relations it lists reach the SQL. Below is the real member filter schema from `users-server`, in full:

```
export const MEMBER_FILTER_SCHEMA: FilterSchema = {
    fields: {
        email:     { type: ScalarFieldType.String },
        name:      { type: ScalarFieldType.String },
        status:    { type: ScalarFieldType.Enum,
                     enumValues: ['pending', 'active', 'disabled'] },
        createdAt: { type: ScalarFieldType.Date }
    },
    relations: {
        role: {
            kind: 'many-to-one',
            table: roles,
            fk: users.roleId,
            fields: {
                key:  { type: ScalarFieldType.String },
                name: { type: ScalarFieldType.String }
            }
        }
    }
};
```

Anything not present here will never be filterable — `passwordHash` included. No limits are given, so the defaults apply (depth 3, 50 nodes, group nesting 5, an `in` list length of 100).

## 06. The filter grammar and its limits

The client sends `?filter=<json>`. A two-step pipeline turns that into a piece of `WHERE` that the caller glues onto its own conditions — the engine never owns the whole `WHERE`.

```
parseFilterTree(raw, schema)                   → ParsedNode | null
applyFilterTree(node, schema, table, db, opts) → SQL | undefined

// at the caller:
const where = and(mySearch, myStatusGuard, filterFragment);
```

### The shape of a node

Two input forms are accepted: a JSON string (a controller may pass `?filter=` straight through) and an already-parsed object. Inside there are three kinds of node:

```
{ "and": [ node, node, … ] }          // an AND group
{ "or":  [ node, node, … ] }          // an OR group
{ "field": "author.name", "op": "ilike", "value": "%ada%" }   // a rule
```

- A node declaring **both** `and` **and** `or` is an error (`FILTER_INVALID_NODE`): there must be exactly one combinator.
- An empty child array is an error: a group must contain at least one child.
- Key presence is checked with `Object.hasOwn` rather than `in`: the input may be an already-parsed object whose prototype carries those names. A node's shape is what the payload itself declared.
- Empty input (`undefined`, `null`, an empty string, `{}`) is `null`, not an error: the caller simply skips the `WHERE`.

### Thirteen operators and what each is allowed

| Operator    | SQL                           | string / enum | number | boolean | uuid | date |
| ----------- | ----------------------------- | ------------- | ------ | ------- | ---- | ---- |
| eq          | `=`                           | yes           | yes    | yes     | yes  | yes  |
| ne          | `<> OR IS NULL`               | yes           | yes    | yes     | yes  | yes  |
| gt / gte    | `>` / `>=`                    | yes           | yes    | yes     | yes  | yes  |
| lt / lte    | `<` / `<=`                    | yes           | yes    | yes     | yes  | yes  |
| in          | `IN (…)`                      | yes           | yes    | yes     | yes  | yes  |
| nin         | `NOT IN (…) OR IS NULL`       | yes           | yes    | yes     | yes  | yes  |
| null        | `IS NULL` / `IS NOT NULL`     | yes           | yes    | yes     | yes  | yes  |
| like        | `~~`                          | yes           | no     | no      | no   | no   |
| ilike       | `~~*`                         | yes           | no     | no      | no   | no   |
| nilike      | `!~~* OR IS NULL`             | yes           | no     | no      | no   | no   |
| within_last | `>= now() - make_interval(…)` | no            | no     | no      | no   | yes  |

> **The third axis of validation appeared after a real incident**
>
> A leaf has three axes — field, operator, value — and the allowlist covered two. `?filter={"field":"embargoUntil","op":"ilike","value":"%2020%"}` named an existing field, carried an acceptable value, and reached Postgres as `"embargo_until" ilike $3`, which gives `operator does not exist: timestamp with time zone ~~* unknown`. That was a **user-triggerable 500 behind a shareable link**, on every filterable endpoint. Now it is `FILTER_OPERATOR_NOT_ALLOWED` (400) with `path`, `op`, `fieldType` and an `allowed` list.
>
> The table describes **what a column is capable of**, not what the interface offers. It is broader than `OPS_FOR_TYPE` in the admin's query builder (which removes `eq` from dates and everything but `eq` from booleans — that is editor ergonomics, not SQL legality). This is the boundary an API token, a hand-written URL and the GraphQL adapter all cross: forbidding a legitimate `publishedAt eq <instant>` would be a regression, not a fix.

The operator check runs **before** value coercion — so that the response states the real reason (“ilike is unavailable on a date field”) rather than a derived one (“not a date: %2020%”). An unknown declared type is skipped by the check: that is a schema bug, and `FilterSchemaException` (500) shouts about it separately — blaming the client with a 400 would hide it.

### The limits

| Limit                    | Schema field       | Default    | What it bounds                                                                                                   | Error code                    |
| ------------------------ | ------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Path depth               | maxDepth           | 3          | The number of segments in `a.b.c` — that is, the number of relation hops                                         | FILTER_DEPTH_EXCEEDED         |
| Node count               | maxNodes           | 50         | Rules + groups across the whole tree, counted on entry to each node                                              | FILTER_MAX_NODES_EXCEEDED     |
| Group nesting            | maxGroupDepth      | 5          | The depth of nested `and`/`or`; independent of `maxDepth`                                                        | FILTER_GROUP_DEPTH_EXCEEDED   |
| List length              | maxInListLength    | 100        | Elements in one `in`/`nin`: one rule is one node, but the list inside it is not bounded by `maxNodes`            | FILTER_MAX_IN_LIST_EXCEEDED   |
| The `within_last` window | not configurable   | 10,000,000 | The upper bound on `n`; below, why it exists at all                                                              | FILTER_INVALID_VALUE          |
| **Filter string length** | not in the package | —          | Bounded by the **caller** in its own DTO: 4096 characters in `content`, `users` and `activity`, 8192 in `alarms` | 400 from the `ValidationPipe` |

> **The engine has no length limit**
>
> `parseFilterTree` will accept a string of any size and `JSON.parse` it before a single node counter fires. Trimming the input is the caller's responsibility, and today the `FILTER_MAX_LENGTH` constant is declared in four places independently of one another, with different values (see section 12). A new endpoint that forgets `@MaxLength` will not get this protection automatically.

### Values

- **A scalar or nothing.** `string`, `number` and `boolean` are accepted (a JSON client may legitimately send any of the three for a URL-shaped API). `null`, a missing `value` key, objects and arrays give `FILTER_INVALID_VALUE`.
- **Why this matters more than it looks.** The value used to be run through `String(v)` and _matched_: `null` → `"null"`, a missing key → `"undefined"`, `{}` → `"[object Object]"`, `[]` → `""` → `0` for a numeric field. A 200 with a wrong, usually empty, result set is the one silent failure mode in a library that answers 400 to everything else. “Is the field empty” is the `null` operator, not a `null` value.
- **Coercion by the declared type**: `number` — `Number.isFinite`; `boolean` — only the strings `'true'`/`'false'`; `uuid` — the canonical 8-4-4-4-12 form (a loose `[0-9a-f-]{36}` would let through 36 hyphens and turn Postgres's cast into a 500 instead of an honest 400); `date` — `new Date` with a `NaN` check; `enum` — exact membership in `enumValues`.
- **Lists** for `in`/`nin`: an array, or a string split on commas. An empty list is rejected — Drizzle renders `IN ()` as `false` and `NOT IN ()` as `true`, so the filter silently becomes either “nothing” or “everything”.
- **`null`** takes only `true`/`false` (as strings too).

### within_last: the window is computed by Postgres, not by the caller

The value is the only object in the grammar: `{ n, unit }`, where `unit` is one of the three units. It emits `col >= now() - make_interval(…)`, so the cutoff is computed **at query time**.

1. **In a URL the difference is invisible.**When serializing a filter into a link, the admin's query builder _freezes_ its own “in the last N days” into a concrete `gte` cutoff: a shared deep link must show the same rows the sender saw.
   _query-builder/admin, treeToJsonFilter_
2. **In a saved filter the difference decides everything.**The same builder passes `relativeDates: true` when the filter goes off to be stored and replayed later. An alarm rule “not updated in 90 days” would otherwise mean forever “not updated since the day the rule was written”.
   _the relativeDates flag_
3. **The unit is not interpolated into SQL.**`make_interval`'s argument names cannot be parameterized, so assembling the fragment from a variable would mean `sql.raw` over a value that arrived over the wire. Instead there is a `switch` over the three units: a path by which a wire value reaches `raw` simply does not exist.
   _scalar-op.ts, withinLast()_
4. **The upper bound on n is not decorative.**`now() - make_interval(days => 1e9)` falls outside the timestamp range and gives Postgres error `22008`, which the caller sees as a 500. A client asking for such a window means “everything”, and it should be told so with a 400. Ten million minutes is comfortably larger than any real window and comfortably inside the range.
   _MAX_WITHIN_LAST_N = 10,000,000_

### Five relation kinds and the shape of the subquery

Any path longer than one segment is translated into an `EXISTS(...)`. The subquery's shape is chosen by the `kind` discriminant.

| Kind                      | What lives where                                   | Shape                                                               | The subtlety                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| one-to-one<br>one-to-many | An FK on the target table points at the parent     | `EXISTS(SELECT 1 FROM target WHERE fk = parentKey AND scope AND …)` | `parentKey` defaults to `parent.id`; the FK itself is **never** rebound, it lives on the target side                                                                           |
| many-to-one               | An FK on the parent points at the target           | `EXISTS(SELECT 1 FROM target WHERE targetKey = parent.fk AND …)`    | `fk` is a parent column, so it goes through `rebind`                                                                                                                           |
| many-to-many              | A `through` join table with two FKs                | `EXISTS(SELECT 1 FROM through [INNER JOIN target] WHERE …)`         | The “by `id` only” fast path reads the target FK straight off the join row — and **must give way** when a `scope` is set                                                       |
| self-referential          | The parent points at another row of the same table | `EXISTS(SELECT 1 FROM t AS alias WHERE alias.id = parent.fk AND …)` | The alias is mandatory and must be unique **per occurrence in the tree**, not per relation: two rules over the same self-relation would otherwise collide on correlation names |

> **Two correlation traps, each of which yields valid SQL and wrong rows**
>
> **An unaliased self-join.** The parent and the target are physically one table, so a subquery without an alias would bind both sides of the correlation to the inner scope and degenerate into “a row that is its own parent”.
>
> **Parent columns captured in advance.** The `fk` of a `many-to-one`/`self-referential` and any `parentKey` are built against the **physical** table. As soon as the parent becomes an alias — which happens for everything nested under a self-relation — an unaliased `t.col` inside the subquery still resolves from the outer `FROM t`. Postgres will not complain: `parent.author.name` will filter the _root_ row's author, and `parent.parent.name` will collapse to `parent.name`. The cure is `rebind()` — re-resolving by the column's own database name against the table the translator is actually querying; on an unaliased chain it is a no-op.

`RelationScope` is a _function_ `(target) => SQL | undefined` rather than a ready-made `SQL` for exactly the same reason: on a self-relation the predicate must bind to the alias, not the physical table. It is glued **inside** the EXISTS, so a relation filter cannot walk over rows the root query itself excludes (a soft-deleted target, or one from another workspace).

### Negation: two rules, both non-obvious

#### On a relation path — `NOT EXISTS(… the positive form …)`

A negating leaf (`ne`, `nin`, `nilike` and `null: true`) is rewritten: the negation wraps the **outermost** hop, so a multi-step path is negated as a whole.

The naive `EXISTS(… the negation …)` asserts the _opposite_ as soon as a relation can hold more than one row: `tags.name nin ['x']` would mean “there is at least one tag that is not x” and would match an entry tagged `[x, y]`. It also makes `relation.id null:true` (“the relation is empty”) a dead filter — a target's `id` is a NOT NULL primary key.

#### On an ordinary column — the negation **includes NULL**

`col <> v OR col IS NULL`. SQL's three-valued logic would otherwise drop the NULL rows.

On a publishable type the required fields stay nullable (they are required only for publication), so “Title does not contain foo” must not hide drafts with no title. An empty value is not the value being excluded, so it belongs in the result set. A pleasant side effect of the rewrite on relations: “the author is not Ada” now includes entries with no author at all, i.e. it behaves the same as the same rule on a column.

### own(): why an allowlist is read through Object.hasOwn

Every allowlist in the package — `fields`, `relations`, the nested `RelationSchema` maps, drizzle's own column map — is an ordinary object literal. Which means `map[name]` resolves `constructor`, `toString`, `valueOf`, `hasOwnProperty` and the rest of `Object.prototype` to truthy values, and the `if (!map[name])` check lets through a name nobody declared.

| Request                                    | What used to happen                                                                                                                                                                        | Outcome                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| ?filter={"field":"constructor",…}          | The scalar path reached `columnOf`, which pulled that same inherited member out of the column map and handed drizzle a `Function` disguised as a `Column`. The fragment came out as `$1 =` | **A user-triggerable 500**, on any filterable endpoint           |
| ?filter={"field":"toString.constructor",…} | A relation-looking path fell out of `switch (rel.kind)` as `undefined`                                                                                                                     | The predicate was **silently dropped** — a 200 with no filtering |

Both are pinned in `__test__/own-property-whitelist.spec.ts` and by the end-to-end test `apps/server-e2e/src/server/users/list-users-filter.spec.ts`. The same protection is duplicated in `columnOf` and `primaryKey`: the parser's allowlist is the primary barrier, but this is where a leaked name turns into malformed SQL rather than an error, so the place guards itself.

### Fourteen error codes

| Code                        | When                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| FILTER_INVALID_JSON         | The string did not parse as JSON                                                                                                                |
| FILTER_INVALID_SHAPE        | The top level is not an object (a string, an array)                                                                                             |
| FILTER_INVALID_NODE         | The node is neither a group nor a rule; two combinators at once; an empty child array; a non-string `field`/`op`; an extension with no resolver |
| FILTER_EMPTY_PATH           | A leaf with no path segments                                                                                                                    |
| FILTER_DEPTH_EXCEEDED       | A dotted path longer than `maxDepth`                                                                                                            |
| FILTER_GROUP_DEPTH_EXCEEDED | Group nesting deeper than `maxGroupDepth`                                                                                                       |
| FILTER_MAX_NODES_EXCEEDED   | More nodes than `maxNodes`                                                                                                                      |
| FILTER_UNKNOWN_OPERATOR     | The operator is not in the vocabulary of thirteen                                                                                               |
| FILTER_OPERATOR_NOT_ALLOWED | The operator is real, but the column's type does not answer to it                                                                               |
| FILTER_UNKNOWN_FIELD        | The last segment is not declared in `fields`                                                                                                    |
| FILTER_UNKNOWN_RELATION     | An intermediate segment is not declared in `relations`                                                                                          |
| FILTER_INVALID_VALUE        | The value is not a scalar, did not coerce to the type, is outside the enum, or is a malformed `within_last`                                     |
| FILTER_EMPTY_IN_LIST        | An empty list on `in`/`nin`                                                                                                                     |
| FILTER_MAX_IN_LIST_EXCEEDED | A list longer than `maxInListLength`                                                                                                            |

### The response envelope: 400 to the client, 500 to the schema's author

```
// FilterException — the client's fault
{
  "statusCode": 400,
  "error": "Bad Request",
  "code": "FILTER_UNKNOWN_FIELD",
  "message": "filter: unknown field \"secretField\"",
  "path": "secretField"          // ← context fields are lifted to the root
}

// FilterSchemaException — the plugin author's fault
{
  "statusCode": 500,
  "error": "Internal Server Error",
  "code": "FILTER_SCHEMA_INVALID",
  "message": "filter schema: many-to-many filter on target field requires `table`"
}
```

`context` is spread **first**, and the four service keys are written after it. The class's whole contract is that a client can branch on `code` and on the status; a context field named `message` or `code` must not be able to overwrite the very envelope the class exists for.

The 400/500 split is a contract too. `FilterSchemaException` is thrown where the request is fine and the allowlist accepted it, but **the declared schema cannot be translated**: a `many-to-many` with target fields but no `table`; a `fields` naming a column that does not exist; nested `fields` with no matching entry in `relations`; a table with no `id` and no explicit key; an unrecognized scalar `type` or relation `kind`. Answering 400 would blame the client, hide the breakage from alerting (4xx is a client error) and leave the schema bug alive. These places used to throw a bare `Error`, which reached the transport as an opaque 500 and, over MCP, as an untyped internal JSON-RPC error.

### Extensions: virtual fields

`extensionFields` is a set of names the translator does not translate itself but hands to the host's `resolveExtension(rule) => Promise<SQL>` hook. The fragment is substituted in the leaf's place, so an extension composes with ordinary rules inside `and`/`or`. Every such name **must** also be declared in `fields` — otherwise the parser has nothing to validate the value against (it never reads the extension set at all; that is the translator's business). Referencing an extension with no resolver passed is a 400, not a silent no-op.

The only consumer today is `content-server`: filter providers (the segments contribution, for instance) add their fields into an entry's filter surface. The hooks are called sequentially during the walk, so an extension that hits the database adds its latency linearly per leaf — the data must be prepared once per request and captured in the closure.

## 07. Scenarios — how it works, step by step

### Scenario A. A request goes out and comes back

A records list page inside a workspace makes an ordinary `useQuery`.

1. **The plugin's hook calls its query function.**The plugin knows neither the base URL nor that cookies are needed. It knows a path.
   _content-admin → apiClient.get('/entries', { params })_
2. **The request interceptor adds the workspace header.**The value was set by `CurrentWorkspaceProvider` during the shell's render — before the first child hook fired. Outside a workspace there is no header at all.
   _X-Workspace-Id: <activeWorkspaceId>_
3. **The request goes out with `withCredentials`.**The httpOnly session cookie rides along; in dev, Vite proxies `/api` to `:3000`.
   _baseURL '/api' + the path_
4. **The server answers.**On other routes the header is simply ignored.
   _WorkspaceGuard reads the header on workspace-scoped routes_
5. **Success — the data goes into the cache.**Freshness is set by the caller through `STALE_TIME.*`, not by a number.
   _queryClient_
6. **On an error the response interceptor looks at the status.**The handler is called inside a `try`, and either way a `Promise.reject(error)` follows — the global sign-out is a side effect, not a replacement for the caller's own error handling.
   _401 and not an exemption → unauthorizedHandler()_
7. **The query function normalizes what was thrown.**Downstream, only an `ApiError` with a `status` and `details` exists.
   _catch (e) { throw toApiError(e) }_
8. **TanStack Query decides whether to retry.**404 and 403 are not retried — the page shows its state immediately rather than after 12 seconds of skeleton. 429, 408, 5xx and “there was no response” are retried.
   _retry: failureCount < 3 && isWorthRetrying(error)_
9. **The page parses `details` for its own endpoint.**The transport does not know what is in there, and should not: the meaning lives at the consumer.
   _for instance 422 → details.issues → field errors_

### Scenario B. The session died — who decides what that means

An administrator disabled an employee while their tab was open. A background list refetch gets a 401.

1. **The interceptor normalizes the request path.**Comparing the raw string will not do: axios accepts several spellings of the same endpoint.
   _strips the query and hash, takes an absolute URL's pathname and removes /api_
2. **It checks the exemptions on a segment boundary.**`/entries` is not on the list, so a 401 here means a lost session rather than the endpoint's answer.
   _path === exempt || path.startsWith(exempt + '/')_
3. **It invokes the registered handler.**And there the leaf's role ends. It does not know the words “your session has ended”; it has neither `react-intl` nor access to authentication state.
   _utils-admin: unauthorizedHandler?.()_
4. **identity-admin decides what happened.**It first reads whether anyone was logged in _before_ writing: the presence of a user in the cache distinguishes “your session ended” from an ordinary signed-out state, which a background request can also produce.
   _AuthProvider_
5. **It answers the probe with “nobody” rather than invalidating it.**There is no session, and a refetch would get another 401. And deliberately not `removeQueries`: evicting queries with live observers makes them refetch, and every refetch comes back into this same handler.
   _queryClient.setQueryData(currentUserKey, null)_
6. **It announces the fact to two audiences.**The toast lives in an area outside the router and survives the view swap; the flag is there so the explanation stays on screen after the toast expires (WCAG 4.1.3, 2.4.3).
   _a toast in the host's live region + a flag for the login page_
7. **The route gate sees “not authenticated” and moves to the login page.**The data stays inactive and goes to the cache's garbage collector.
   _the private tree unmounts_
8. **The original 401 still reaches the caller.**A mutation that was in flight sees its own failure and shows its own toast — the global sign-out did not eat its handling.
   _Promise.reject(error)_

> **Why this inversion**
>
> If the transport itself knew what to do with a 401, `utils-admin` would depend on `identity-admin`, and that on `utils-admin`. The leaf would stop being a leaf. Registering a callback is the minimum price for keeping the dependency tree a tree.

### Scenario C. The tab title is assembled from three sources

1. **The application's name is read once at module load.**The source is the `<title>` in `apps/admin/index.html`. The leaf does not hardcode the product's name: the snapshot is taken before anyone has decorated anything.
   _document.title.trim() || 'Admin'_
2. **A route sets its title.**The hook writes into the module cell and re-renders; on unmount it restores `null`, i.e. the bare application name.
   _useDocumentTitle('Records')_
3. **The string is assembled.**Assembled, that is, rather than appended to whatever is in `document.title` right now.
   _`${page} · ${APP_NAME}`_
4. **The copilot attaches a decorator.**A transformation, not a write. The user moves to another page — the title reassembles, the badge stays. The count changes — the title reassembles from the same clean base, and counts do not stack.
   _setTitleDecorator(title => badgedTitle(title, count))_
5. **The result is written.**Any of the three sources can change independently, and the order of changes does not matter.
   _document.title = decorate(compose())_
6. **The badge is removed.**The decorator returns to the identity; the copilot restores the tab's favicon separately and best-effort.
   _setTitleDecorator(null)_

### Scenario D. A filter from a link becomes SQL

An editor sent a colleague a link to a records list with the filter “author is not Ada, updated in the last 7 days”.

1. **The controller validates the string's length.**This is the one limit that is **not** in the engine itself.
   _@MaxLength(FILTER_MAX_LENGTH) — 4096 in content_
2. **parseFilterTree parses the JSON.**Empty input is `null`, and the caller simply adds no conditions.
   _invalid JSON → FILTER_INVALID_JSON_
3. **The walk counts nodes and group depth.**The node counter increments on entry to each node, groups included.
   _maxNodes 50, maxGroupDepth 5_
4. **Every leaf goes through resolveLeaf.**Path segments are looked up with `own()`; the intermediate ones in `relations`, the last in `fields`.
   _path → allowlist → operator → value_
5. **The operator is checked against the column's type.**`within_last` is legal on a date; had it been `ilike`, a 400 with the allowed list rather than a 500 out of the driver.
   _operatorsFor(field.type)_
6. **The value is coerced.**Scalars are checked for being a scalar at all before any coercion.
   _{ n: 7, unit: 'days' } — the one object in the grammar_
7. **applyFilterTree walks the tree.**A group whose every child collapsed to `undefined` becomes `undefined` itself; a single child is returned as is.
   _group → and()/or(), rule → scalar()/relationExists()_
8. **The negation on the relation is rewritten.**Rather than `EXISTS(… name <> 'Ada' …)`, which would mean “there is some author other than Ada”.
   _author.name ne 'Ada' → NOT EXISTS(… name = 'Ada' …)_
9. **The scope is glued inside the EXISTS.**A relation filter does not walk over rows the root query itself excludes.
   _the workspace boundary + soft-delete_
10. **The date reaches Postgres as a relative one.**In a link the admin UI would freeze the window into a concrete cutoff; shown here is the stored case (an alarm rule), where the relativity has to survive as far as the server.
    _updatedAt >= now() - make_interval(days => 7)_
11. **The caller glues the fragment onto its own conditions.**The engine never owns the whole `WHERE`.
    _and(search, status, fragment)_
12. **The values are parameterized.**Which is exactly why the interval's unit is chosen by a `switch` over three variants.
    _no wire value ever reaches sql.raw_

### Scenario E. The host assembles the slots at startup

1. **Plugins declare their slots at module level.**25 slots across six plugins; the array inside a slot lives as long as the module.
   _createSlot<SidebarItem>('shell.sidebar.nav')_
2. **Each plugin lists its contributions in its descriptor.**A contributing plugin need not know the owning plugin at runtime — only its slot.
   _plugin.slots = [{ slot, items }]_
3. **createAdmin gathers every contribution into one list.**Before React mounts, so that consumers see the full set from the first render.
   _plugins.flatMap(p => p.slots ?? [])_
4. **wireSlotContributions clears the target slots.**Separate, because several plugins contribute into one slot.
   _over the set of distinct slots, in a separate pass_
5. **Then it registers everything again.**A second run gives the same result rather than a doubled one — which is what protects dev from Vite's hot reloads.
   _slot.\_register(items)_
6. **The consumer reads and sorts a copy.**Both steps copy. Holding the array between registrations is not allowed — it must be read afresh.
   _byOrder(SLOT.getItems())_

## 08. Rules for authors: what belongs here and what does not

A package named `utils` is a natural candidate for a junk drawer. The criteria below are derived from what is already in it and from what is deliberately not.

#### Yes, here

- A client singleton that must be **exactly one** per application (the HTTP client, the query cache).
- A general framework-level hook with no domain knowledge (`useDebouncedValue`).
- A pure function several plugins need (`slugify`, `initialsOf`, `clampInt`).
- An extension mechanism both the host and the plugins must see (`slot`).
- A shared contract for a transport or database error (`ApiError`, `pg-errors`).
- Named constants instead of magic numbers (`HTTP_STATUS`, `STALE_TIME`).

#### No, not here

- **Any string a human will see.** The package has no `react-intl` and must not acquire one.
- **The meaning of a response code.** The transport reports a status; “what it means” belongs to the consumer.
- **Feature state.** Authentication, the current workspace as data, permissions — in their own plugins.
- **A component.** There is not one JSX element here beyond a context provider with no markup.
- **Something one consumer needs.** A lone utility lives at home until a second one appears.
- **An import of a plugin.** A leaf that imports a consumer stops being a leaf.

> **The one exception to “a leaf imports nothing”**
>
> `avatarColor` imports `AVATAR_COLORS` from `@apograph/design-system`, so `utils-admin` depends on the design system. This is not a violation — the design system is a leaf too, and no cycle arises — but it is the package's only dependency on another monorepo package, and adding a second must be a deliberate act.

### How to add an export properly

1. **Make sure there is more than one consumer.**Shared code with no second consumer is premature generality.
   _otherwise it goes in your own package_
2. **Check that it carries no domain knowledge.**If you cannot, it does not belong here.
   _the test: can you explain what it does without naming a single product feature_
3. **Create a camelCase folder with an index.ts.**The two packages' conventions differ, and they must not be mixed.
   _admin: src/lib/<name>/index.ts; server: a flat file in src/lib_
4. **Write JSDoc on every export.**The custom here is to document not “what it does” but “why not otherwise”: a reference to an incident is worth more than a retelling of the signature.
   _both AGENTS.md files demand this explicitly_
5. **Put the spec next to it.**A defect in the leaf is a defect in every consumer at once.
   _admin: index.spec.ts(x); server: **test**/<name>.spec.ts_
6. **Add it to the barrel.**Deep-path exports are impossible: `exports` serves only the root and `package.json`.
   _src/index.ts_
7. **Run the consumers' typecheck.**The package resolves from source, so a type error breaks 16 projects at once.
   _npx nx sync when project dependencies change_

### The typography of the conventions

| Convention      | admin                                                                 | server                                                     |
| --------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| Declaring types | `type` rather than `interface`                                        | `interface` for contracts                                  |
| Layout          | a `camelCase` folder + `index.ts`                                     | a flat file in `src/lib`, the filters in `src/lib/filters` |
| Tests           | next to the module, vitest + jsdom                                    | in `__test__/`, jest                                       |
| Type imports    | `import type`                                                         | `import type`, with no `.js` extensions                    |
| Shared          | JSDoc on every export; 4 spaces and single quotes (the root Prettier) |                                                            |

## 09. Invariants

Statements where violating any one is a defect rather than a change in behaviour. Almost every one is backed by a test (section 10) and almost every one appeared after the opposite once made it to production.

#### General

- **I-01** — **The leaf does not import its consumers.** Neither `utils-admin` nor `utils-server` depends on any plugin or any host. The only internal dependency is admin's `@apograph/design-system`.
- **I-02** — **The packages contain no user-facing strings.** Not one piece of text a human will see, and no `react-intl`. The copy is brought by whoever mounts it.
- **I-03** — **Neither package owns tables, routes or permissions.** Zero migrations, zero controllers, zero permission keys.

#### The admin transport

- **I-04** — **One axios per application.** A plugin does not create its own instance and does not import `axios` directly for requests to its own API.
- **I-05** — **`X-Workspace-Id` is set only when a workspace is set.** Outside a workspace there is no header at all, not an empty string.
- **I-06** — **The 401 exemptions are matched on whole path segments** of the normalized request — never with a bare `startsWith` over the string the caller passed.
- **I-07** — **The interceptor always re-throws the original error.** The handler is a side effect; its exception is logged and does not replace the failure the caller sees.
- **I-08** — **The transport does not decide what a status means.** The package has not one branch of the form “401 means a wrong password”.
- **I-09** — **`ApiError.status === null` means “there was no response”.** That is the only way to tell a network failure from a server answer, and the retry predicate leans on exactly that.
- **I-10** — **4xx is not retried**, except 408 and 429. Network failures and 5xx are retried, at most three times.

#### Slots

- **I-11** — **`getItems()` returns a copy.** The internal array never leaves.
- **I-12** — **`_reset()` zeroes the length rather than re-creating the array** — otherwise the `getItems`/`_register` closures stay on the old one.
- **I-13** — **Wiring is idempotent.** Calling `wireSlotContributions` again with the same input gives the same result rather than a doubled one.
- **I-14** — **The reset is a separate pass over the distinct slots**, before the registration loop.
- **I-15** — **`byOrder` does not sort in place.**

#### Forms, navigation, the title

- **I-16** — **Confirming a departure does not clear other keys.** Each form drops its own on unmount.
- **I-17** — **Confirmed navigation goes through the router** (`useNavigate`), not through `history.pushState` plus a synthetic `popstate`.
- **I-18** — **The click interception does not call `stopPropagation()`** — only `preventDefault()`.
- **I-19** — **The guard degrades to “no guard” outside the provider** rather than throwing: `useUnsavedChangesApi()` returns `null`.
- **I-20** — **The tab title is assembled, not appended to.** The decorator is a transformation over a freshly assembled string; nobody writes to `document.title` around `render()`.

#### The filter engine

- **I-21** — **The schema is the security boundary.** Only what is listed in `fields`/`relations` reaches the SQL; everything else is a 400.
- **I-22** — **Every lookup of a user-supplied name in a map goes through `own()`** (or a direct `Object.hasOwn`), never through bare bracket notation.
- **I-23** — **A leaf's value is a scalar.** `null`, a missing key, an object and an array give a 400; `String(v)` is never applied to them.
- **I-24** — **The operator is checked against the field's type**, not only against the vocabulary — and before the value is coerced.
- **I-25** — **A negation on a relation path is `NOT EXISTS(… the positive form …)`**, wrapped around the outermost hop.
- **I-26** — **A negation on an ordinary column includes NULL.**
- **I-27** — **`scope` is glued inside the EXISTS**, and when it is present the `many-to-many` fast path by `id` is disabled.
- **I-28** — **Parent columns are re-resolved by `rebind`** against the table the translator is querying; a `one-to-many`'s target `fk` never is.
- **I-29** — **No value that arrived over the wire reaches `sql.raw`.** The interval's unit is chosen by a `switch` over three constants.
- **I-30** — **An untranslatable schema is a 500** (`FilterSchemaException`), not a 400. Every `default:` in a `switch` throws rather than returning `undefined`: an `undefined` predicate silently drops out of `and()`/`or()` and widens the result set.
- **I-31** — **An empty `in`/`nin` is rejected** — otherwise the filter silently means “nothing” or “everything”.
- **I-32** — **`context` does not overwrite the error envelope**: the service keys are written after the context is spread.

## 10. Testing checklist

The group currently has **27 spec files and 245 tests**: 13 files / 103 tests in admin (vitest + jsdom) and 14 files / 142 tests in server (jest). Below is what is covered and what to look at during a manual check. Component behaviour is not in scope here: it lives in `admin-e2e`, and the filter's end-to-end path in `apps/server-e2e`.

| Spec file                                                                                                               | Tests                 | What it covers                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| admin · unsavedChanges                                                                                                  | 17                    | The guard against a real `BrowserRouter`: link interception, the exemptions, `beforeunload`, the keys |
| admin · slot                                                                                                            | 12                    | A copy on read, idempotent wiring, `_reset`'s behaviour                                               |
| admin · apiClient                                                                                                       | 11                    | The 401 through the real interceptor stack, the exemption list, the workspace header                  |
| admin · useTableUrlState                                                                                                | 11                    | The URL/search-field round trip, `searchPending`, the page reset                                      |
| admin · apiError / queryClient                                                                                          | 8 + 8                 | Error normalization; the retry predicate read off the shipped client                                  |
| admin · avatarColor / documentTitle / initials                                                                          | 8 + 7 + 6             | Hash determinism and distribution; title composition and the decorator; code points                   |
| admin · slugify / byOrder / httpStatus / useDebouncedValue                                                              | 5 + 4 + 2 + 4         | The small things that break quietly                                                                   |
| server · parse-filter-tree                                                                                              | 32                    | Node shapes, the limits, parse errors                                                                 |
| server · resolve-leaf-coercion                                                                                          | 21                    | Coercion of the six types, refusal on non-scalars, lists                                              |
| server · negation                                                                                                       | 14                    | Both negation rules                                                                                   |
| server · operator-support / pg-errors                                                                                   | 11 + 11               | The “type × operator” table; the `cause` walk and index names                                         |
| server · tree-to-drizzle / within-last                                                                                  | 10 + 8                | Tree translation; the relative window and its bounds                                                  |
| server · own-property-whitelist                                                                                         | 7                     | Inherited names do not pass the allowlist                                                             |
| server · relation-nesting / schema-misconfiguration / filter-exceptions / relation-scope / clamp-int / extension-fields | 6 + 6 + 5 + 4 + 4 + 3 | Aliases and rebinding; a 500 on a malformed schema; the error envelope; the scope inside the EXISTS   |

#### The admin transport

- **A 401 on `/auth/login` does not sign you out** — a wrong password leaves the form in place with its own message
- **A 401 on the same path with no leading slash does not sign you out either** — `apiClient.post('auth/login', …)`
- **A 401 on `/auth/invite/<token>` does not sign you out** — an exemption on a segment boundary, not on an exact match
- **A 401 on an ordinary route sends you to the login page** — and shows the explanation if the person was logged in
- **That same 401 is still visible to the caller** — an in-flight mutation shows its own toast
- **An exception from the handler does not replace the error** — the caller's `catch` holds the 401, the console holds the handler's trace
- **A request outside a workspace goes out with no header** — the login page, the workspace grid
- **A child hook's first request already carries the header** — check the network panel when entering a workspace
- **Switching workspaces re-scopes subsequent requests** — with no page reload
- **A 404 is not retried** — the empty state shows immediately rather than after ~12 seconds
- **A 429 is retried** — the request repeats with a delay, at most three times
- **Disabling the network gives `status: null` and a retry** — offline mode in devtools

#### Slots and the host

- **The sidebar does not double after editing a file in dev** — the main symptom of non-idempotent wiring
- **One consumer's sorting does not change another's order** — the copy from `getItems()`
- **Contributions from several plugins into one slot are all preserved** — the reset in a separate pass
- **A plugin with no `slots` field breaks nothing** — the `?? []` in the host

#### Unsaved changes

- **Clicking any internal link from a dirty form asks** — the sidebar, the breadcrumbs, a table row
- **Ctrl/Cmd-click opens in a new tab without asking** — nothing is lost
- **A link inside an SVG is intercepted too** — the `ORT-136` regression
- **Confirming navigates by route, and Back/Forward work correctly afterwards** — the router's history index is not clobbered
- **After confirming, a second dirty form asks again** — other keys were not cleared
- **A dropdown closes on an outside click even with a dirty form** — no `stopPropagation`
- **Reloading the page gives the browser's warning** — `beforeunload`, only while dirty
- **An unmounted form drops its key** — the guard does not get stuck

#### The tab title

- **Every route gives its own title** — WCAG 2.4.2; checked against the tab list and history
- **Leaving a route restores the bare application name**
- **The copilot's counter does not stack on itself** — `(1)`, `(2)`, but not `(1) (2)`
- **Changing pages with an active counter preserves both**

#### Filters

- **An `ilike` on a date gives a 400 with the list of allowed operators** — rather than a 500 out of the driver
- **`?filter={"field":"constructor",…}` gives `FILTER_UNKNOWN_FIELD`** — not a 500 and not a 200
- **`toString.constructor` gives `FILTER_UNKNOWN_RELATION`** — the predicate must not silently disappear
- **`value: null` gives a 400** — “is the field empty” is the `null` operator
- **A missing `value` key gives “value is required”**
- **An empty `in` gives a 400** — rather than “nothing found”
- **A list of 101 elements gives a 400 under the defaults**
- **A four-segment path gives a 400 under the defaults**
- **“Title does not contain foo” shows drafts with no title** — NULL-inclusive negation
- **“No tag x” does not match an entry tagged `[x, y]`** — `NOT EXISTS`, not `EXISTS(NOT …)`
- **“The relation is empty” finds entries with no related rows** — `relation.id null:true` must not be a dead filter
- **A relation filter does not see soft-deleted or other-workspace targets** — the `scope` inside the EXISTS
- **`relation.id in […]` respects the boundaries when a scope is set too** — the fast path gave way
- **`parent.parent.name` filters the grandparent, not the parent** — `rebind` on the alias
- **Two rules over the same self-relation do not conflict** — a unique alias per occurrence
- **An alarm rule “not updated in 90 days” means the same thing a month later** — `within_last` survived to the server
- **A link with “in the last 7 days” shows the same rows tomorrow** — the admin UI froze the window into a `gte`
- **`within_last` with `n = 1e9` gives a 400** — rather than a `22008` and a 500
- **A plugin's malformed schema gives a 500 with the code `FILTER_SCHEMA_INVALID`** — visible to alerting, not dumped on the client
- **A filter string longer than the DTO's limit is rejected before the parser** — check this separately on every new filterable endpoint

## 11. Boundaries of responsibility

A quick answer to “why is this not in utils” — and where to go instead.

| Task                              | Utils does                                                                           | Utils does not                                                                    | Who does                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| An HTTP request from the admin UI | The base URL, the cookies, the workspace header, the global 401, error normalization | Knows not one of the product's endpoints                                          | The plugin — its own hook, its own query key, its own query function                   |
| Authentication                    | The `setUnauthorizedHandler` seam                                                    | Stores no user, knows nothing of `/auth/me`, shows no messages                    | `identity-admin` (the context, the gate), `identity-server` (sessions)                 |
| The current workspace             | The cell holding the id and the request header                                       | Does not resolve the workspace, does not store its data, does not check access    | `workspaces-admin` / `workspaces-server`                                               |
| The server-state cache            | One `QueryClient` and the retry rule                                                 | Declares no query keys and invalidates nobody else's                              | The plugins' hooks                                                                     |
| UI extension points               | The slot mechanism and its idempotent wiring                                         | Declares not one concrete slot                                                    | The owning plugin (`shell`, `content`, `workspaces`, `insights`, `copilot`, `wysiwyg`) |
| The “unsaved changes” dialog      | All the mechanics: the interception, the keys, `beforeunload`                        | Contains neither the dialog nor the copy                                          | `bootstrap-admin` (`UnsavedChangesGuard`) + the design system                          |
| The tab title                     | The “page · application” composition and the decorator                               | Does not own the product's name — it reads it from the host markup                | `apps/admin/index.html`, the plugins' routes, `copilot-admin`                          |
| Filtering a list                  | Parsing, validation, coercion and translation into SQL                               | Does not own the `WHERE`, knows nothing of workspaces, permissions or soft-delete | The caller: gluing predicates together, and the `scope` in the schema                  |
| Bounding a request's size         | The node, depth and list limits                                                      | Does not bound the input string's length                                          | The caller's DTO (`@MaxLength`)                                                        |
| The filter builder's UI           | Nothing                                                                              | Has no client half — it could not depend on NestJS                                | `query-builder-admin`, which repeats the vocabulary locally                            |
| Database errors                   | Recognizing `23505`/`23503` and the index's name                                     | Does not decide which HTTP code it becomes or what to tell the user               | The plugin's service (409 on a race, 400 on “unlink it first”)                         |
| Assembling the application        | Nothing                                                                              | Does not boot React, does not create a Nest module, does not apply migrations     | `bootstrap-admin` / `bootstrap-server`                                                 |

> **A practical rule**
>
> If the description of a change names a product feature, it probably does not belong in `utils`. If it contains the word “every” (“every request”, “every list”, “every form”), it probably belongs in `utils`.

## 12. Divergences between code and documentation

Every statement in both `AGENTS.md` files was checked against the implementation. Below is what diverged, plus observations about the code itself. None of it breaks behaviour today, but each can mislead the author of the next change.

| Where                              | What it says                                                                                                 | How it actually is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| admin/AGENTS.md · Layout           | “One concern, one folder: `apiClient/`, `queryClient/`, `staleTime/`, `apiError/`, `httpStatus/`, `slot/`”   | There are fifteen folders. Not listed: `avatarColor`, `byOrder`, `documentTitle`, `initials`, `isComposingText`, `slugify`, `unsavedChanges`, `useDebouncedValue`, `useTableUrlState`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| admin/AGENTS.md · Key exports      | The section describes 12 symbols                                                                             | The barrel serves 31. Undescribed: `setActiveWorkspaceId`, `byOrder`, `isComposingText`, `asAvatarColor`, `initialsOf`, `initialsFromEmail` and the whole tab-title trio (`useDocumentTitle`, `setDocumentTitle`, `setTitleDecorator`) — even though `useDocumentTitle` is the package's third most-used symbol                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| admin/AGENTS.md · HTTP_STATUS      | “named codes (`UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`)”                                             | There are six codes: `BAD_REQUEST`, `NOT_FOUND` and `CONFLICT` have been added                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| admin/AGENTS.md · dependencies     | “that is the reason the package takes a `react` dependency (alongside the existing `@tanstack/react-query`)” | There are four dependencies, and two are unnamed: `@apograph/design-system` (needed by `avatarColor`) and the peer dependency `react-router-dom` ^6 (needed by `useTableUrlState` and `unsavedChanges`). The second matters: it is what makes “the provider mounts inside the router” a requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| server/AGENTS.md · Filter pipeline | “`applyFilterTree(…)` → `SQL \| undefined`”                                                                  | The function is async: `Promise<SQL \| undefined>`. This is mentioned further down the document, but not in the pipeline diagram                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| server/AGENTS.md · FilterSchema    | “…and the `maxDepth` / `maxNodes` / `maxGroupDepth` guards”                                                  | There are four guards: `maxInListLength` (default 100) is unnamed, even though both of its error codes exist in the package                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| server/AGENTS.md · pg-errors       | “two functions — `isUniqueViolation` and `violatedConstraint`”                                               | Three: `isForeignKeyViolation` (`23503`) is also exported, and `EntryWriterService` uses it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| server/AGENTS.md · extensionFields | “…for instance the `role` filter”                                                                            | In `MEMBER_FILTER_SCHEMA` today `role` is an ordinary `many-to-one` relation onto the roles table, not an extension. The only consumer of the extension mechanism is `content-server`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| server/AGENTS.md · Internal files  | “Internal files (not exported): … `table-helpers.ts` …”                                                      | The `DbLike` and `TableLike` types are exported from it — they are in the barrel. The file is exported partially, which the list does not reflect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Code · the filter's length         | The documentation says nothing about the input's length                                                      | The engine has no length limit; `FILTER_MAX_LENGTH` is declared independently in four packages — 4096 in `content`, `users` and `activity`, and 8192 in `alarms`. A new filterable endpoint will not get the protection automatically                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Code · setDocumentTitle            | Exported from the barrel as public API                                                                       | Not one import site: it is used only from inside `useDocumentTitle`. Either document it as the imperative alternative for non-React code, or drop it from the barrel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Code · UnsavedChangesCopy          | An exported type, “the confirmation copy supplied by the host”                                               | Imported by nobody: the host passes a ready-made `dialog` renderer and keeps the copy inside it, so the type describes a contract nobody uses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Code · coverage                    | “a spec next to every module”                                                                                | There are 13 specs for 15 modules: `isComposingText` and `staleTime` have none. The second is a table of constants, the first is a predicate with non-trivial structural typing, and it guards the global keyboard shortcuts in three plugins                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Code · the operator vocabulary     | —                                                                                                            | The operator vocabulary exists in two independent copies: `FilterOperator` in `utils-server` and its wire twin in `query-builder-admin/src/lib/utils/wireOp.ts`. **Fixed 2026-09-05.** The duplication is forced (a browser cannot drag in NestJS and Drizzle), and an operator still needs an edit in both places — but a test notices now. `operator-vocabulary-parity.spec.ts` imports `FilterOperator` and reads `wireOp.ts` as text, the idiom `audit-event-mapping.spec.ts` already uses for the same reason: a real import would put a React package into the filter engine's project graph. It also pins a **third** copy nobody had named — `OPERATORS_BY_TYPE`, where an operator present in the vocabulary but absent from every type's list passes the unknown-operator check and is then refused on every field there is |

<details>
<summary>What was checked and diverged in nothing</summary>

The 401 exemption list and how it is matched; the retry predicate and its set of codes; the `STALE_TIME` values; the idempotence and pass ordering in `wireSlotContributions`; the copying in `getItems` and `byOrder`; the absence of `stopPropagation` and the router-based navigation in the guard; title composition through the decorator; the thirteen operators and their mapping onto types; both negation rules; `own()`'s behaviour; the order in which `context` is spread; the 400/500 split between `FilterException` and `FilterSchemaException`; the refusal on a non-scalar value; `within_last`'s bounds; the absence of tables, routes and a Nest module; and both packages being listed in the scaffolder's `CORE_PACKAGES`.

</details>

---

**The dossier of the `packages/utils` group.** The skeleton is the same as the pilot `identity` artifact's: business description → composition → inventory → mechanics → scenarios → rules → invariants → checklist → boundaries → divergences. There are no sections on database tables, permissions or HTTP routes, because the group has none of the three.

The source is the source code: the whole of `packages/utils/admin/src/**` and `packages/utils/server/src/**`, plus the consumption sites across sixteen admin plugins, seven server plugins and both hosts. The numbers come from counting across the repository: 31 and 28 barrel exports, 127 and 25 import sites, 25 slots, 27 spec files and 245 tests. The `AGENTS.md` files were used as a skeleton, but every statement was checked against the implementation — what diverged is collected in section 12.
