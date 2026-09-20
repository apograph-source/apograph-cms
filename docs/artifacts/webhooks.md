# Webhooks

_Package group · packages/webhooks_

**Telling somebody else's system that content changed — from a queue, signed, and retried**

A CMS is rarely the last stop. A storefront rebuilds, a search index re-crawls, a cache purges — and each of them needs to hear that an entry was published. Webhooks is how this CMS says so: an administrator registers an endpoint, narrows it to the workspaces, event kinds and content types worth hearing about, and every matching change becomes an HMAC-signed `POST`. The structural decision of the whole package is that **the outbox subscriber never touches the network** (`ADR-0016`): fan-out only writes delivery rows, and a worker claims them, commits, and only then makes the request.

- **3** packages in the group
- **11** HTTP routes
- **3** database tables
- **1** migration
- **2** permission keys
- **8** event kinds
- **5** delivery states
- **6** retry steps
- **4** admin routes
- **0** network calls inside a transaction

## Contents

- [01. Business description](#01-business-description)
- [02. The package group's composition](#02-the-package-groups-composition)
- [03. Roles and permissions](#03-roles-and-permissions)
- [04. Data model](#04-data-model)
- [05. A delivery's lifecycle](#05-a-deliverys-lifecycle)
- [06. Scenarios](#06-scenarios)
- [07. HTTP API](#07-http-api)
- [08. The admin UI](#08-the-admin-ui)
- [09. Configuration](#09-configuration)
- [10. Security and resilience](#10-security-and-resilience)
- [11. Invariants](#11-invariants)
- [12. Testing checklist](#12-testing-checklist)
- [13. Boundaries](#13-boundaries)
- [14. Discrepancies and open questions](#14-discrepancies-and-open-questions)

## 01. Business description

Every integration around a CMS begins with the same question: **how do I find out that something changed?** Without an answer there are only two options, and both are bad. Poll the public API on a timer — which is slow when the interval is long, expensive when it is short, and wrong either way for a purge. Or wire the integration into the CMS itself, which turns every consumer into a change to this codebase.

Webhooks is the answer: the CMS pushes. A change becomes an HTTP request to an address the integrator controls, carrying enough to act on and signed well enough to trust.

### What this makes possible

| The case                                                        | What the endpoint is subscribed to                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A static storefront rebuilds when an article ships              | `entry.published` / `entry.unpublished` on one workspace, one content type                 |
| A search index re-crawls a changed page and drops a deleted one | `entry.updated`, `entry.deleted`, `entry.purged` — everything, including types added later |
| A CDN purges the cached URL of one entry                        | every kind, one workspace                                                                  |
| An analytics warehouse records editorial activity               | every kind, every workspace, no type filter                                                |

### The three rules everything rests on

#### The subscriber does not make requests

`OutboxDispatcher` calls subscribers **inside** the transaction that claims a batch. Fan-out therefore does one `SELECT` and one batched `INSERT` and returns; the worker claims rows, commits, and only then opens a socket. `ADR-0016`.

#### An empty filter means everything

A subscription is three sets intersected — workspaces × event kinds × content types. An **empty** set reads as “all, including what does not exist yet”, so an endpoint keeps covering a workspace or event kind added next month.

#### Delivery is at-least-once and unordered

A retry can duplicate; two endpoints and two workers give no ordering. The envelope carries a stable `X-Ortha-Event-Id` for exactly this — the receiver deduplicates, and the CMS does not pretend to a guarantee it cannot keep.

> **The main engineering decision · ADR-0016**
>
> **Sending from inside the subscriber would have cost two things that are not the sender's to spend.** First, the dispatcher's transaction and its pool client stay open for a stranger's response time — a receiver that takes 30 seconds holds a database connection for 30 seconds. Second, the failure would count against the **outbox row**, whose attempt budget is shared: enough webhook failures and the event dead-letters for the activity log and the alarms evaluator too, which never asked to depend on anybody's storefront being up.

### Who sees it

#### The administrator

Registers endpoints and reads the delivery log. This is the **only** human surface — and it is deliberately not editorial: an endpoint spans every workspace it names and its row holds a signing secret.

#### The integrator

Never opens the admin UI. They receive the request, verify `X-Ortha-Signature`, deduplicate on `X-Ortha-Event-Id`, and answer `2xx` fast.

#### The editor

Sees nothing, and should not. Publishing an entry cannot fail because a webhook receiver is down — the write commits, the delivery queues behind it.

### What Webhooks is not

- **It is not a message bus.** No ordering, no consumer groups, no replay of a period. What exists is a per-delivery redelivery button and a retention window.
- **It is not an event stream of the whole product.** The catalogue is content entries plus a test ping. Media, users, workspaces and tokens raise domain events too, and they are deliberately **not** offered yet — see section 13.
- **It is not templating.** The body is one fixed envelope. A receiver that wants a different shape transforms it on its own side; a payload language here would be a second content API nobody asked for.
- **It is not an inbound integration.** Nothing here receives a webhook. That is the MCP endpoint's and the public API's job.
- **It is not per-workspace configuration.** There is no workspace-scoped endpoint list, because a single endpoint may name several workspaces and its secret is not a workspace's to hold.

## 02. The package group's composition

Three packages. Unlike `alarms`, the kernel here earned a package of its own: the signing, the retry ladder and the URL policy are pure functions with sharp edges, and they are worth testing without a Nest module or a database anywhere near them.

| Package                                                 | Owns                                                                                                                                                                       | Depends on                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `@orthacms/webhooks-domain`<br>packages/webhooks/domain | The event catalogue, the subscription filter, the HMAC envelope and its verification, the retry policy, the URL policy, the delivery vocabulary. **No framework, no I/O.** | Nothing but `node:crypto`                                       |
| `@orthacms/webhooks-server`<br>packages/webhooks/server | Three tables and one migration, the outbox subscriber, the delivery worker, the HTTP client, the three controllers.                                                        | `database`, `identity-server`, `webhooks-domain`, `undici`      |
| `@orthacms/webhooks-admin`<br>packages/webhooks/admin   | Four routes in the sidebar's `directory` group: the endpoint list, the editor (create and edit), the endpoint page with its two tabs.                                      | `design-system`, `identity-admin`, `shell-admin`, `utils-admin` |

> **The admin does not import the domain package**
>
> It would be the obvious thing to do — the vocabulary is right there — and it takes the whole admin down at load. The domain barrel re-exports the signature helpers, which import `node:crypto`, and Vite happily bundles that into the browser. The delivery-status vocabulary and the custom-header rule are therefore **deliberately copied** into `webhooks-admin`'s own `domain/` layer, each with a comment saying why. The server remains the enforcement point for both.

## 03. Roles and permissions

| Key               | Grants                                                                                   | Held by            |
| ----------------- | ---------------------------------------------------------------------------------------- | ------------------ |
| `webhooks:read`   | The nav row, both read pages, every endpoint and delivery query, the event catalogue.    | Administrator only |
| `webhooks:manage` | Create, edit, delete, rotate the secret, send a test, redeliver. The editor page itself. | Administrator only |

**Even reading is withheld from an editor**, which is unlike `alarms:read` or `segments:read`. Two reasons, both structural rather than cautious: an endpoint reaches across every workspace it names, so a workspace member reading the list would learn about workspaces they are not in; and the row holds a signing secret, whose hint and whose rotation are already more than an editorial role should carry. The system-role table grew from 30 keys to 32 when this package landed, both on the administrator.

The editor page gates on **`webhooks:manage`, not `webhooks:read`**. Reaching `/webhooks/new` by URL without the key answers exactly as the navigation does, rather than rendering a form whose Save the server would refuse.

## 04. Data model

Three tables, one migration (`0000_init_webhooks.sql`), applied under `__drizzle_migrations_webhooks`. No table outside this package is touched.

### `webhook_endpoints` — the subscription

| Column                                    | Type                   | Notes                                                                                                                                               |
| ----------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                      | uuid PK                |                                                                                                                                                     |
| `name`, `url`                             | text                   | The URL is re-checked against the policy on every write **and** on every send                                                                       |
| `secret`                                  | text                   | **Plaintext.** It signs; it is never verified against a stored copy, so a hash would make it useless — see section 10                               |
| `secret_hint`                             | text                   | The last four characters, so the UI can say “Ends in a1b2” without holding the secret                                                               |
| `enabled`                                 | boolean                | Fan-out selects on it; the worker re-checks it before sending                                                                                       |
| `event_kinds`, `content_types`            | jsonb, default `[]`    | Empty means **all**, including kinds and types that do not exist yet                                                                                |
| `all_workspaces`                          | boolean, default false | The one filter whose “all” is an explicit flag rather than an empty set — a record with no workspace can only reach an endpoint that takes them all |
| `headers`                                 | jsonb, default `{}`    | Static custom headers; `X-Ortha-*` and the transport's own are refused                                                                              |
| `disabled_reason`, `consecutive_failures` | text, integer          | Auto-disable state. Re-enabling by hand clears both                                                                                                 |
| `created_by`, `created_at`, `updated_at`  | uuid, timestamptz      |                                                                                                                                                     |

Plus `webhook_endpoint_workspaces`: a composite-PK join of `(endpoint_id, workspace_id)` with `ON DELETE CASCADE` and an index on the workspace, so “which endpoints care about this workspace” is one index scan.

### `webhook_deliveries` — one attempt-bearing row per (endpoint, event)

| Column                                                              | Type                  | Notes                                                                                                                                    |
| ------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                | uuid PK               | Minted by fan-out rather than by the database, so the id inside the frozen envelope and the one in `X-Ortha-Delivery` are the same value |
| `endpoint_id`                                                       | uuid → endpoints      | `ON DELETE CASCADE`                                                                                                                      |
| `event_id`, `event_kind`                                            | uuid, text            | `event_id` is the outbox event's id and is **stable across redeliveries**                                                                |
| `workspace_id`, `content_type`                                      | uuid, text — nullable | Copied off the event so the log can be filtered without re-reading content                                                               |
| `payload`                                                           | jsonb                 | The envelope **frozen at fan-out**. A redelivery sends what happened, not what is true now                                               |
| `status`                                                            | text                  | `pending` · `delivering` · `succeeded` · `failed` · `dead`                                                                               |
| `attempts`, `next_attempt_at`, `claimed_at`                         | integer, timestamptz  | The retry ladder's state                                                                                                                 |
| `last_status_code`, `last_error`, `response_snippet`, `duration_ms` |                       | What came back; the snippet is capped at `responseSnippetBytes`                                                                          |
| `redelivery_of`                                                     | uuid, nullable        | Set on a manual resend, which is what lets it escape the unique index below                                                              |

> **The two indexes that carry the design**
>
> `webhook_deliveries_endpoint_event_unique` is a **partial** unique index on `(endpoint_id, event_id) WHERE redelivery_of IS NULL`. It makes fan-out idempotent — a redelivered outbox event cannot queue the same delivery twice — while leaving deliberate resends unconstrained. And `webhook_deliveries_claimable_idx` on `next_attempt_at WHERE status IN ('pending','failed')` is what keeps the worker's claim query off a full scan as the log grows.

## 05. A delivery's lifecycle

**pending** → **delivering** → **succeeded** · **failed** → **dead**

1. **A content write commits.** The row and the domain event land in one transaction — the outbox is what makes “the entry changed” and “somebody was told” impossible to get out of step.
2. **`OutboxDispatcher` claims a batch** and calls every subscriber that declares the kind, **inside its own transaction**.
   _this is the constraint the whole package is shaped around_
3. **`WebhookFanoutSubscriber` matches and inserts.** One `SELECT` for the enabled endpoints whose filter matches, one batched `INSERT` of delivery rows. No socket is opened.
4. **The dispatcher's transaction commits.** Only now does anything exist for a worker to pick up.
5. **`WebhookDeliveryWorker` claims due rows** with `FOR UPDATE SKIP LOCKED`, marks them `delivering` and **commits the claim**.
   _two workers cannot claim the same row; a claim lost to a crash expires after claimTimeoutMs_
6. **And only then it POSTs.** Nothing is open while the receiver is answering — no transaction, no pool client beyond the one the next update needs.

| State      | Means                                                                                                                | Leaves for                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| pending    | Queued, never attempted                                                                                              | `delivering` when a worker claims it                                                                         |
| delivering | Claimed; a request is in flight                                                                                      | `succeeded`, `failed` or `dead` — or back to claimable after `claimTimeoutMs` if the process died holding it |
| succeeded  | A `2xx` came back                                                                                                    | Terminal. Pruned after `retentionDays`                                                                       |
| failed     | A retryable failure, with a next attempt scheduled                                                                   | `delivering` at `next_attempt_at`; `dead` once the budget runs out                                           |
| dead       | Given up on: attempts exhausted, a non-retryable status, or the endpoint was deleted or switched off before the send | Terminal. A person may redeliver it, which creates a **new** row                                             |

### The retry ladder

Six steps, in `webhooks-domain`: **10s → 60s → 5m → 30m → 2h → 6h**, each with ±20% jitter so a fleet of workers does not synchronise on a receiver that just came back. `maxAttempts` defaults to 6, after which the row is `dead`.

- **Retryable:** `408`, `429`, any `5xx`, and every transport failure (timeout, DNS, reset).
- **Not retryable:** every other `4xx`. A `404` or a `401` will not fix itself on a timer, and burning six attempts on it only delays the operator finding out.
- **`Retry-After` is honoured** when the receiver sends one, capped at one hour so a hostile or broken header cannot park a row for a week.

### Auto-disable

Failures are counted **on the endpoint**, not on the delivery. After `autoDisableAfter` consecutive failures (20 by default) the endpoint is switched off with a `disabled_reason`, and the counter resets on the first success. The count and the switch move in **one** `UPDATE` with a `CASE`, so two workers failing at the same moment cannot race past the threshold and leave it enabled.

## 06. Scenarios

### 6.1 An editor publishes an entry

1. `EntryWriterService` commits the row and appends `entry.published` to the outbox in the same transaction, carrying `contentType`, `workspaceId` and a frozen `title`.
2. The dispatcher claims the event and calls every subscriber that declares the kind — the activity log, the alarms evaluator, and this one.
3. Fan-out asks for enabled endpoints whose filter matches, in **one** query, and inserts one delivery row per endpoint in **one** batched statement. It opens no socket and reads no content.
4. Within `deliveryIntervalMs` (2s) the worker claims up to `batchSize` (20) due rows, commits, and sends them.
5. The storefront answers `200`; the row becomes `succeeded` and the endpoint's failure counter resets.

### 6.2 The receiver is down

The first attempt times out after `timeoutMs` (10s). The row goes `failed` with `next_attempt_at` ten seconds out, then a minute, then five. The editor is told nothing — the publish committed long ago — and the endpoint's page shows the attempts climbing. After the sixth the row is `dead`; after twenty consecutive failures across rows the endpoint switches itself off and says so on its page and in the list.

### 6.3 An administrator resends one delivery

A new row is inserted with the **same** `event_id`, a new `id`, and `redelivery_of` pointing at the original — which is what lets it past the partial unique index. The payload is the one that was frozen at fan-out. The receiver sees a new `X-Ortha-Delivery` and the **same** `X-Ortha-Event-Id`, which is exactly the pair it needs to recognise a repeat.

### 6.4 An entry is purged

The row is gone, so nothing can be read back from content. This is why the entry events carry `workspaceId` and a frozen `title` on the payload: the delivery for `entry.purged` can still be routed to the right endpoints and still name what was destroyed. A subscriber that resolved the workspace by querying the entry would find nothing and drop the event.

### 6.5 The endpoint is switched off between queueing and sending

The worker re-reads the endpoint after claiming. If it is gone the row is closed as `dead` with “The endpoint was deleted before this delivery was sent”; if it is disabled, with “…was disabled before this delivery was sent”. Sending anyway would defeat the switch, and silently dropping the row would leave the log lying about what happened.

### 6.6 Somebody points an endpoint at the CMS's own network

The URL is refused twice over: `assertUrlShape` at write time (scheme, embedded credentials, a literal private address) answers `422` with a message written for whoever typed it, and `assertAddressAllowed` runs again at connect time against the **resolved** address, inside undici's `lookup`. The second check is the one that matters: a hostname that resolves to `169.254.169.254` only reveals itself there, and a DNS answer that changes between the check and the connection is the classic rebinding attack.

### 6.7 Send test

The `test` route builds a synthetic `ping` envelope, sends it **synchronously**, and returns the status code, the duration and a response snippet. It writes no delivery row and takes no retries: it answers “can this CMS reach that URL right now”, which is a different question from “did this event arrive”. `ping` is in the catalogue but excluded from the subscribable set, so it can never be subscribed to.

## 07. HTTP API

All eleven routes sit under the app's global prefix, behind the session `AuthGuard` and `PermissionsGuard`. There is no bearer-token path here: this is deployment configuration, not a content API.

| Route                                                 | Permission | Answers                                                                                  |
| ----------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| `GET /webhooks`                                       | `read`     | Every endpoint, each with its last delivery's status — a bare array, no paging           |
| `GET /webhooks/:id`                                   | `read`     | One endpoint. **Never** the secret; only `secretHint`                                    |
| `POST /webhooks`                                      | `manage`   | `201` with the endpoint **and the plaintext secret — the only time it is ever returned** |
| `PATCH /webhooks/:id`                                 | `manage`   | The updated endpoint. Re-enabling clears `disabled_reason` and the failure counter       |
| `DELETE /webhooks/:id`                                | `manage`   | `204`. The delivery log goes with it by cascade                                          |
| `POST /webhooks/:id/secret`                           | `manage`   | A new secret, shown once. The old one stops signing immediately                          |
| `POST /webhooks/:id/test`                             | `manage`   | A synchronous `ping`: `ok`, status code, duration, error, snippet                        |
| `GET /webhooks/:id/deliveries`                        | `read`     | One page of the log; filterable by `status` and `eventKind`                              |
| `GET /webhooks/:id/deliveries/:deliveryId`            | `read`     | One delivery with the frozen request body and the response snippet                       |
| `POST /webhooks/:id/deliveries/:deliveryId/redeliver` | `manage`   | `201` with the new row                                                                   |
| `GET /webhook-events`                                 | `read`     | The subscribable catalogue, for the editor's picker                                      |

### The event catalogue

Two independent predicates, not one flag: `scopedByContentType` says whether a content-type filter can narrow the kind at all, and `carriesWorkspace` says whether the event names a workspace. They differ for a reason — an event may belong to a workspace without belonging to a type — and collapsing them into one would have made the filter lie about one of the two.

| Kind                | Group   | Raised when                                                        | By type | Workspace |
| ------------------- | ------- | ------------------------------------------------------------------ | ------- | --------- |
| `entry.created`     | content | A new entry row exists                                             | yes     | yes       |
| `entry.updated`     | content | Its values changed; the payload names the changed fields           | yes     | yes       |
| `entry.published`   | content | A status transition the `Entry` model owns                         | yes     | yes       |
| `entry.unpublished` | content | The same transition, the other way                                 | yes     | yes       |
| `entry.deleted`     | content | Trashed or hard-deleted; the payload's `soft` says which           | yes     | yes       |
| `entry.restored`    | content | A tombstone was cleared                                            | yes     | yes       |
| `entry.purged`      | content | The row is destroyed — the last time anything can be said about it | yes     | yes       |
| `ping`              | system  | **Only** by Send test. Not subscribable                            | no      | no        |

### What a receiver gets

Six `X-Ortha-*` headers plus a fixed `User-Agent`, and one envelope shape. `X-Ortha-Workspace` is **omitted** rather than sent empty when the event has no workspace. The signature is `t=<unix seconds>,v1=<hex hmac>`, computed with HMAC-SHA256 over `"{timestamp}.{raw body}"` — the timestamp is inside the signed string, which is what makes the 300-second tolerance a replay defence rather than a decoration.

## 08. The admin UI

Four routes under one sidebar entry in the `directory` group, beside API tokens — global, with no workspace in the URL, because an endpoint is not scoped to one.

| Route                | Screen                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/webhooks`          | The endpoint table: name, URL, **Sends** (the subscription as chips), State, last delivery. Empty, error, no-access and loading states are all distinct |
| `/webhooks/new`      | The editor, create mode                                                                                                                                 |
| `/webhooks/:id`      | One endpoint: **Deliveries** (the default tab) and **Settings**                                                                                         |
| `/webhooks/:id/edit` | The same editor, edit mode                                                                                                                              |

**Deliveries is the default tab on purpose.** “What does this send?” is asked once, when the endpoint is made; “did it arrive?” is asked every time afterwards. The log polls itself only while a row on the page is still in flight, and stops once every row is terminal.

### The decisions inside the editor

#### A page, not a modal

Eight questions across three filters, two of which open popovers. In a dialog that meant a scrolling box with popovers portalled into it to survive the scroll lock. On a page the two halves sit side by side and the back button is the way out.

#### “All …” is a toggle over a picker

Three filters, each an “All …” checkbox above a multi-select. Turning one on sends **no value**, which is how the server spells “everything, including what does not exist yet”. `allWorkspaces` defaults **off** and the other two **on**: reaching across every workspace should be chosen, while an endpoint subscribed to nothing is not safer, it is broken.

#### Types come after workspaces

The type section does not exist until the workspace question is answered, and then lists only what those workspaces were granted. A delivery needs both halves to match, so a type none of them can hold could only produce silence.

#### The type list is open

The picker's search box offers “Add …” for a name the registry has no row for — a type is code, and an endpoint is routinely configured before the type exists. A selected name this build does not define is kept and labelled, because dropping it would widen the endpoint to every type on the next save.

#### Turning it off asks

The status control is a switch reading Enabled / Disabled. Off opens a confirmation: events during the pause are never queued, so there is nothing to catch up on, and waiting deliveries are closed as failed. On asks nothing.

#### A refused URL stays in the form

The `422` carries a message written for whoever typed it. It lands beside the field with the typed value intact, rather than behind a generic toast.

Accessibility is covered by a dedicated axe suite (WCAG 2.1 A/AA plus `best-practice`) over the list, its empty/error/no-access states, the editor with every picker revealed, the turn-off confirmation, the reveal-once dialog, both detail tabs and one open delivery — plus the two checks axe cannot make: that the list scrolls rather than clips at 320px, and that the delivery-state filter has a real accessible name.

## 09. Configuration

The plugin takes its config at the composition root (`apps/server/config/webhooks.ts`), which reads the environment. Every value is optional; the defaults are the shipped behaviour.

| Option                 | Env                               | Default | What it decides                                                                                                                                                                                                                                   |
| ---------------------- | --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deliveryIntervalMs`   | `WEBHOOKS_DELIVERY_INTERVAL`      | 2000    | How often the worker looks for due rows. `0` stops the worker entirely                                                                                                                                                                            |
| `batchSize`            | —                                 | 20      | Rows claimed per tick                                                                                                                                                                                                                             |
| `timeoutMs`            | `WEBHOOKS_TIMEOUT`                | 10000   | How long a receiver has to answer                                                                                                                                                                                                                 |
| `claimTimeoutMs`       | —                                 | 30000   | When a row claimed by a dead process becomes claimable again. **Must exceed `timeoutMs`** — the plugin refuses to boot otherwise, because a shorter claim window means a live request gets re-claimed and the receiver is hit twice for one event |
| `maxAttempts`          | —                                 | 6       | Attempts before a row is `dead`                                                                                                                                                                                                                   |
| `autoDisableAfter`     | —                                 | 20      | Consecutive endpoint failures before it switches itself off                                                                                                                                                                                       |
| `retentionDays`        | `WEBHOOKS_RETENTION_DAYS`         | 30      | How long completed deliveries stay readable. Pruned at most hourly; `0` keeps them forever                                                                                                                                                        |
| `responseSnippetBytes` | —                                 | 2048    | How much of a response body is stored. A receiver that answers with a megabyte of HTML does not get to fill the database                                                                                                                          |
| `allowInsecureUrls`    | `WEBHOOKS_ALLOW_INSECURE_URLS`    | false   | Permits `http://`. For local development                                                                                                                                                                                                          |
| `allowPrivateNetworks` | `WEBHOOKS_ALLOW_PRIVATE_NETWORKS` | false   | Permits private and loopback addresses. **Both checks** — the write-time one and the connect-time one — respect it                                                                                                                                |

## 10. Security and resilience

### Where this server may be talked into connecting

An endpoint URL is attacker-adjacent by construction: it is a request this server makes, to an address somebody else chose. The policy runs twice.

- **At write time** — scheme (`https` unless allowed otherwise), no embedded credentials, and a literal IP is checked against the private ranges. The refusal is a `422` with a human message.
- **At connect time** — undici's `Agent` is built with a custom `lookup` that runs `assertAddressAllowed` on the address DNS actually returned. This is what stops a hostname resolving to `127.0.0.1`, to a link-local metadata address, or to a different answer on the second query than on the first.
- **No redirects.** undici's `request` does not follow them, and that is left deliberately as it is: a `302` to an internal address would walk straight around both checks.

The private-range test covers IPv4 (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`), IPv6 (`::1`, `fc00::/7`, `fe80::/10`) and IPv4-mapped `::ffff:` addresses. Zero-padded octets are refused outright rather than parsed, because `0177.0.0.1` is a loopback address in some resolvers and a different number in others.

### The signature

`X-Ortha-Signature: t=1756468320,v1=<hex>`, HMAC-SHA256 over `"{t}.{raw body}"`. Verification is a constant-time comparison with a 300-second default tolerance. Because `t` is inside the signed string, a captured request cannot be replayed later with a fresh timestamp.

> **The secret is stored in plaintext, deliberately**
>
> Everywhere else in this product a secret is hashed — a session, an API token, a password. Those are **verified**: the server compares an incoming value with a stored digest. A signing key is the opposite: the server must reproduce it to sign, so a digest would make it unusable. The mitigations are elsewhere — it is returned exactly once on mint and on rotation, never afterwards; only the last four characters are readable; and it can be rotated at any time. Encrypting it at rest with a deployment key is a reasonable next step and is **not** done today.

### Custom headers

Two families are refused, in the editor and again on every write: anything starting with `X-Ortha-`, and the transport's own (`Host`, `Content-Type`, `Content-Length`, `Transfer-Encoding`, `Connection`, `User-Agent`). The first would let a delivery claim to be a different event or to carry someone else's signature; `Host` is how a request aimed at one virtual host gets served by another. A header **value** is a credential for somebody else's system and the API returns it in full to anyone holding `webhooks:read` — administrators, the same people who can rotate the signing secret — which is why the read-only view lists names only.

### What survives what

- **A crash mid-send.** The row stays `delivering` until `claimTimeoutMs` passes, then becomes claimable again. At-least-once, by design.
- **A slow receiver.** It holds a socket and nothing else — no transaction, no advisory lock, and one row of the batch.
- **A deleted endpoint.** Its deliveries go with it by cascade; a claim that lost the race closes its row honestly instead of sending into the void.
- **A failing tick.** Caught and logged; the interval survives, and the next tick starts from whatever the database says.

## 11. Invariants

Statements that must always hold. At once a review checklist and a draft set of test assertions.

- **I-01** — The fan-out subscriber performs **no** network I/O. It runs one `SELECT` and one batched `INSERT` and returns — it is called inside the dispatcher's claim transaction.
- **I-02** — A delivery's claim is **committed** before the HTTP request is made. No database transaction is open while a receiver is answering.
- **I-03** — An empty `event_kinds`, `content_types` or workspace set matches **everything**, including kinds, types and workspaces that do not exist yet.
- **I-04** — An event with no workspace reaches only endpoints with `all_workspaces = true`.
- **I-05** — An unknown event kind matches nothing. The subscriber declares the subscribable set, and `ping` is not in it.
- **I-06** — `event_id` is stable across redeliveries; `id` (and therefore `X-Ortha-Delivery`) is not. The receiver deduplicates on the former.
- **I-07** — The envelope inside `payload` is frozen at fan-out. A redelivery sends what happened, never what is true now.
- **I-08** — The partial unique index makes fan-out idempotent: a redelivered outbox event cannot queue the same `(endpoint, event)` twice, while a manual resend is not blocked by it.
- **I-09** — The plaintext secret is returned by exactly two routes — create and rotate — and by nothing else, ever.
- **I-10** — The URL policy is applied at write time **and** at connect time, the second against the resolved address. Redirects are not followed.
- **I-11** — A custom header may not begin with `X-Ortha-` nor name a transport header. Enforced on every write, not only in the UI.
- **I-12** — `4xx` other than `408` and `429` is terminal; `5xx`, `408`, `429` and transport failures retry. `Retry-After` is honoured up to one hour.
- **I-13** — Auto-disable increments the counter and flips `enabled` in one statement, so concurrent workers cannot both step over the threshold and leave the endpoint on.
- **I-14** — Re-enabling an endpoint by hand clears `disabled_reason` and zeroes `consecutive_failures`: the reason on screen can never outlive the condition.
- **I-15** — A disabled or deleted endpoint never receives a delivery that was queued before the switch — the worker re-reads it after claiming and closes the row instead.
- **I-16** — `claimTimeoutMs > timeoutMs` is checked at boot. The plugin refuses to start otherwise.
- **I-17** — The response snippet stored is capped at `responseSnippetBytes`.
- **I-18** — Both permission keys are administrator-only, and the editor page requires `webhooks:manage`, not merely `webhooks:read`.
- **I-19** — Deleting a workspace removes it from every endpoint's subscription set, and never removes the endpoint. Pruning is safe here precisely because `all_workspaces` is a separate boolean: an empty set means "none", so a prune can only narrow — the opposite of `segments.workspace_ids`, where an empty set means "every workspace" and the same prune would widen.

## 12. Testing checklist

The wording is “action → expected result”. The existing suites are `apps/server-e2e/src/server/webhooks/` (`webhook-endpoints.spec.ts`, `webhook-delivery.spec.ts`) and `apps/admin-e2e/src/webhooks/` (`webhooks.spec.ts`, `a11y.spec.ts`, seeded by `support/api/webhooks.ts`). The domain kernel — signature, retry policy, URL policy, subscription matching, the event catalogue — is covered by unit tests, as are the fan-out subscriber, the delivery worker and the admin's mappers and pure rules. The server side is checked with `curl` + `psql`, the admin side in a browser.

### Endpoints: creation and validation

- **Create an endpoint with no filters at all** → `201`; `event_kinds = []`, `content_types = []`, `all_workspaces` as sent. The response carries a `whsec_…` secret.
- **Fetch that endpoint back** → no `secret` key anywhere in the body; `secretHint` is its last four characters.
- **A `http://` URL with `WEBHOOKS_ALLOW_INSECURE_URLS` unset** → `422` with a message naming the scheme; no row written.
- **A URL with embedded credentials (`https://u:p@host/`)** → `422`.
- **`https://127.0.0.1/hooks` and `https://[::1]/hooks`** → `422` from the literal-address check.
- **A hostname that resolves to a private address** → the write succeeds; the **send** fails with the policy's error, and the delivery is `dead` rather than retried.
- **A header named `X-Ortha-Signature`** → `422` naming the header. Same for `Host` and `User-Agent`.
- **An unknown event kind in `eventKinds`** → `400` from the DTO's `IsIn`.
- **An extra field in the body** → `400` from the global `ValidationPipe`.
- **Any write as a non-administrator** → `403`; the read routes too.

### Fan-out

- **Publish an entry with one matching endpoint** → exactly one `webhook_deliveries` row, `status='pending'`, `payload` holding the envelope, `workspace_id` and `content_type` copied from the event.
- **Publish with the endpoint disabled** → no row at all. Nothing is queued for later.
- **Publish with two matching endpoints** → two rows, one `INSERT`; both share the same `event_id` and differ in `id`.
- **An endpoint filtered to another workspace** → no row.
- **An endpoint filtered to another content type** → no row.
- **An event with a null workspace** → rows only for `all_workspaces` endpoints.
- **Redeliver the same outbox event (a dispatcher retry)** → still one row — the partial unique index absorbs it.
- **Purge an entry** → a row for `entry.purged` whose `workspace_id` is filled, even though the entry no longer exists.

### Delivery and retries

- **A receiver answering `200`** → `succeeded`, `attempts=1`, `duration_ms` set, `completed_at` set; the endpoint's `consecutive_failures` is 0.
- **A receiver answering `500`** → `failed` with `next_attempt_at` about ten seconds out; the endpoint's counter is 1.
- **A receiver answering `404`** → `dead` on the first attempt — no ladder.
- **A receiver answering `429` with `Retry-After: 120`** → retried, and `next_attempt_at` follows the header rather than the ladder.
- **`Retry-After: 86400`** → capped at one hour.
- **A receiver that never answers** → the attempt ends at `timeoutMs`, not later.
- **Six failures** → `dead`; no seventh attempt.
- **Twenty consecutive endpoint failures** → `enabled=false` with a `disabled_reason`; the list shows “Stopped after failures”, not “Paused”.
- **Disable an endpoint with a pending row, then let the worker run** → the row is `dead` with “disabled before this delivery was sent”; no request is made.
- **Delete an endpoint with pending rows** → the rows are gone by cascade.
- **Kill the process mid-send** → the row stays `delivering` and becomes claimable again after `claimTimeoutMs`.
- **Two workers, one due row** → one request. `FOR UPDATE SKIP LOCKED` gives the row to one claimer.

### What the receiver sees

- **Verify `X-Ortha-Signature` with the minted secret** → it matches over `"{t}.{raw body}"`. Re-verifying against a re-serialised body must be tried too — it should be done against the **raw** bytes.
- **Replay a captured request 10 minutes later** → the reference verifier refuses it: the timestamp is signed and outside tolerance.
- **Rotate the secret, then send a test** → the old secret no longer verifies; the new one does.
- **An event with no workspace** → `X-Ortha-Workspace` is absent, not empty.
- **Redeliver** → a new `X-Ortha-Delivery`, the same `X-Ortha-Event-Id`, and a byte-identical body.
- **A custom `Authorization` header** → present on the request, alongside the signature rather than instead of it.

### The admin UI

- **An endpoint with empty filters** → the row reads “All events”, “All workspaces” — never “0 events”.
- **A paused endpoint beside an auto-disabled one** → “Paused” and “Stopped after failures” are visibly different states.
- **Create with the URL policy refusing** → the server's message appears in the form; the page stays on `/webhooks/new` with the typed URL intact.
- **The secret dialog, dismissed with Esc** → a warning that it has not been copied; the dialog stays open.
- **The type section before a workspace is chosen** → it is not there — one line explains why.
- **Choose a workspace granted `blog_post` and `product`** → the picker offers those two and nothing else.
- **Type a name the registry does not know and add it** → it becomes a chip marked as undefined here and reaches the request body.
- **Edit an endpoint subscribed to a type this build lacks, and save** → the type is still in the `PATCH` body. Losing it would widen the endpoint to every type.
- **Turn the status switch off** → a confirmation first; declining leaves it on.
- **The delivery log with a pending row** → it refreshes itself, and stops once every row is terminal.
- **Open one delivery** → the frozen body, the response snippet, and the event id labelled as the thing to deduplicate on.
- **A contributor visiting `/webhooks`** → the no-access state, with an `<h1>`; no table, and no nav row either.

## 13. Boundaries

- **Content owns the events.** This package subscribes to what content raises and adds no instrumentation of its own. A new subscribable kind is a change in the raising package first, and in the catalogue second.
- **The outbox owns delivery to subscribers.** Ordering, the attempt budget and dead-lettering of the **event** are `database`'s; retries of the **HTTP request** are this package's. The two ladders are deliberately separate.
- **Identity owns authorisation.** Both keys live in the system-role table; this package only names them on its guards.
- **Media, users, workspaces and tokens are out.** They raise domain events and are not offered here yet. Adding one is a catalogue entry plus a payload contract — cheap, and deliberately not done on speculation.
- **Workspace deletion.** `WebhookWorkspacesPurger` registers with the `workspaces` plugin's purge registry from `onModuleInit` and strips the dead id from `webhook_endpoint_workspaces` inside the delete transaction. The endpoint itself is never touched — see I-19.

## 14. Discrepancies and open questions

Everything here was found by reading the source. Nothing in this list is a bug filed against a promise the code makes — they are the places where the shipped behaviour and a reasonable expectation of it diverge.

- **A deleted workspace left rows behind. Fixed 2026-09-05.** `webhook_endpoint_workspaces` holds a bare `workspace_id` with no FK, and this package implemented no `WorkspacePurger`, so fan-out re-read the dead rows on every content write. This entry called the stale id "harmless — no event will ever carry it again", which is exactly the reasoning that let it sit: it is true of correctness and false of everything else, and it was the last member of a class the `workspaces` and `alarms` dossiers had already flagged twice. `WebhookWorkspacesPurger` now removes them, pinned by `workspace-delete-residue.spec.ts`.
- **The signing secret is not encrypted at rest.** Deliberate and explained in section 10, but worth a decision: a deployment key would make a database dump less interesting without changing any of the flows.
- **Header values are readable by every administrator.** The API returns them in full. That is the same audience that can rotate the secret, so it is defensible — but a bearer token for a third-party system is a credential this product now stores and shows.
- **There is no per-endpoint rate limit.** A workspace-wide bulk publish of a thousand entries queues a thousand deliveries, and the worker will send them as fast as `batchSize` and the interval allow. A receiver's own `429` plus `Retry-After` is the only brake today.
- **Retention is a wall-clock sweep, not a bound on rows.** With `retentionDays = 0` the log grows forever, and nothing warns about that.
- **The delivery log has no cross-endpoint view.** “What has this CMS failed to deliver anywhere in the last hour?” takes one query per endpoint in the UI.
- **Nothing tells anyone that an endpoint switched itself off** except the list and the endpoint's page. There is no email, and no activity-log row for it.
- **Open product questions**, carried over from the plan and still unanswered: whether `media.asset.*` belongs in v1's catalogue; whether a receiver should be able to ask for a slimmer payload; and whether `retentionDays = 30` is the right default for a deployment that treats the log as an audit trail.

---

**The dossier for the newest package in the repository.** Written in the series' skeleton: business description → composition → permissions → data → lifecycle → scenarios → API → the admin UI → configuration → security → invariants → checklist → boundaries → discrepancies.

The source is the code: the controllers, DTOs, the endpoints service, the fan-out subscriber, the delivery worker, the HTTP client and the Drizzle schema with its migration on the server; the event catalogue, the subscription filter, the signature, the retry policy and the URL policy in the domain kernel; the plugin factory, the hooks, the gateway, the pages and the components in the admin UI. `docs/adr/0016-webhooks-deliver-from-a-queue.md`, `docs/design/webhooks.md` and all three `AGENTS.md` files were read and cross-checked. The documentation was used as a skeleton, but every statement was verified against the implementation — the divergences are collected in section 14.
