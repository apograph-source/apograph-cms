# @orthacms/webhooks-server

The **webhooks plugin** — outgoing HTTP notifications about content changes.
Owns three tables, subscribes to the transactional outbox, and sends from a
worker that holds no transaction while it waits on someone else's server.

Layout: **layered (ADR-0003)** — `domain / application / infrastructure / http`.
It is a thin context by design: a queue and some CRUD, so there are no
aggregates and no value objects, which would be empty ceremony here.

## What it is, in one paragraph

An **endpoint** is a URL, a signing secret, and three filters (workspaces, event
kinds, content types). A **delivery** is one event's journey to one endpoint —
the queue row and the log row are the same row. `WebhookFanoutSubscriber` turns
an outbox event into delivery rows; `WebhookDeliveryWorker` sends them.

## The five decisions worth knowing before changing anything here

### 1. The subscriber must never touch the network

This is the one rule that cannot bend, and
[ADR-0016](../../../docs/adr/0016-webhooks-deliver-from-a-queue.md) is the long
version. `OutboxDispatcher.drainOnce` calls subscribers **inside** the
transaction that claims a batch. A subscriber that made an outgoing request
would hold that transaction and a pool client for a stranger's response time —
and a throw would count against the **outbox row's** attempt budget, eventually
dead-lettering an event the activity log and the alarms evaluator also needed.

So `WebhookFanoutSubscriber.handle` is one `SELECT` and one batched `INSERT`.
If you find yourself wanting a third query there, put it in the worker.

The worker is the mirror image: `WebhookDeliveryRepository.claim` opens a short
transaction, marks the batch `delivering`, **commits**, and only then does
`WebhookDeliveryWorker` call the HTTP client.

### 2. Idempotency is a partial unique index

`unique (endpoint_id, event_id) WHERE redelivery_of IS NULL`. Outbox delivery is
at-least-once, so fan-out may see the same event twice; `ON CONFLICT DO NOTHING`
makes the repeat a no-op. It is **partial** so a deliberate redelivery — which
keeps the original `event_id` on purpose, because that is what a receiver
deduplicates on — is exempt.

The delivery id is minted by the **caller**, not by the database, because the
envelope carries it: the body and the `X-Ortha-Delivery` header have to name the
same delivery.

### 3. The secret is stored in the clear, and that is the honest answer

An API token is only ever _verified_, so `api_tokens` stores a SHA-256 hash. A
webhook secret is used to **sign**, and a signing key that cannot be read back
cannot sign anything. Pretending otherwise would be worse than saying so.

What is done instead: it is returned by exactly two routes (`POST /webhooks` and
`POST /webhooks/:id/secret`), never by a read route, and `secretHint` — its last
four characters — is what every view carries. If you add a route that returns an
endpoint, check that it returns a `WebhookEndpointView` and not a row.

### 4. The envelope carries references, not field values

A receiver reads the record back through the public API with its own token,
where `publishedOnly` visibility and the audience entitlements an editor set on
the entry still apply. Inlining the values would route around all of them at
once. There is no opt-in to inline them and no column for one — a flag that is
accepted and does nothing is worse than an absent feature. If one is added, the
snapshot must come from `PublicEntriesQuery` — the same read path — so that
"include the content" never becomes "skip the rules".

### 5. Stale claims are recovered by the claim itself

A worker that dies mid-request leaves a row in `delivering` with no error, no
retry and no way out. Rather than a second reaper query, `claim` also picks up
rows whose `claimed_at` is older than `claimTimeoutMs`. That is why the plugin
factory refuses a `claimTimeoutMs` at or below `timeoutMs`: a live request would
be reclaimed underneath itself and every slow delivery sent twice.

## Layout

```
src/lib/
  webhooks.module.ts            the one dynamic module
  webhooks.tokens.ts            the config token
  types/webhooks-config.ts      the plugin's public config contract
  domain/
    webhook-secret.ts           minting, and the displayable hint
    webhook-views.ts            the read shapes — note what is missing: `secret`
    errors/                     transport-agnostic, mapped to HTTP by `http/`
  application/
    webhook-endpoints.service.ts  orchestration over the two repositories
    dto/                          class-validator + @ApiProperty
  infrastructure/
    schema/                     the three tables
    webhook-endpoint.repository.ts
    webhook-delivery.repository.ts   the queue and the log
    webhook-fanout.subscriber.ts     ← runs in the drain's transaction
    webhook-delivery.worker.ts       ← the only thing that touches the network
    webhook-http.client.ts           undici + the address check
    event-mapping.ts            the one file that knows both vocabularies
  http/controllers/             three thin controllers
  docs/                         the OpenAPI response schemas (see below)
  utils/webhooks-plugin.ts      the factory
```

## The reference describes what comes back

`docs/` is this plugin's `ServerPlugin.docs.decorate` pass. It exists because
every response view here is an `interface`, which `@nestjs/swagger` cannot see —
so without it each route is published with a bare `200` and no body. The pass
writes plain schema objects onto the operations this plugin owns and nothing
else, always onto whichever 2xx key the scanner already emitted (the `204`
delete keeps its empty body).

Two things in it are load-bearing:

- **Create and rotate get their own schema.** `WebhookEndpointWithSecret` is a
  separate component from `WebhookEndpoint`, not the same one with an optional
  `secret` — decision 3 above is only readable in the document if the two
  responses are two shapes. No read route references it.
- **`POST /webhooks/:id/deliveries/:deliveryId/redeliver` is documented as the
  detail shape**, because that is what it returns: it is _typed_
  `WebhookDeliveryView` and implemented as `findDetail(...)`, so `payload` and
  `responseSnippet` come back with it. If that method is ever narrowed to match
  its type, narrow the route table with it.

The delivery vocabularies come from `@orthacms/webhooks-domain` rather than
being restated, so an enum in the reference cannot drift from the one the server
enforces.

## Route order

`WebhookDeliveriesController` (`webhooks/:id/deliveries`) is registered **before**
`WebhookEndpointsController` (`webhooks`), so the literal segment matches before
the parameter that would otherwise swallow it — the same reason content registers
`bulk` ahead of `:id`.

## Permissions

`webhooks:read` and `webhooks:manage`, **both administrator-only**. Stricter than
the read/manage splits elsewhere, deliberately: an endpoint is not scoped to a
workspace, it reaches across every workspace it names, and its log records where
this installation talks to on the network. Redelivery needs `manage`, not `read`
— it causes an outgoing request to someone else's system, which is a write
however it is spelled.

## Testing

Unit tests cover the fan-out's filtering and the worker's verdict handling with
fakes. The path that only a booted app can prove — a content write reaching a
real socket, signed — is `apps/server-e2e/src/server/webhooks/`.

Two things about the e2e harness are worth knowing before you change it:

- The sender's interval is **off** (`deliveryIntervalMs: 0`); suites drive one
  batch with `WebhookDeliveryWorker.runOnce()`. A background tick would post a
  delivery mid-assertion.
- The rule in decision 1 is pinned by `webhook-transaction-boundary.spec.ts`,
  and it is pinned by **observation, not by outcome**: `recordWebhookSends`
  watches the HTTP client itself across a real fan-out (so "the subscriber
  tried and failed" is not mistaken for "the subscriber did not try"), and
  `observeDeliveryRow` — called from inside the receiver's request handler,
  while the worker is blocked on `await request()` — asks a **second
  connection** what it can see. A claim still open would leave the row reading
  `pending` and would refuse a `FOR UPDATE NOWAIT` with `55P03`. If you move
  where the transaction starts or ends, that suite is the one that will say so.
- `resetDb` **deletes** the endpoints rather than truncating them. Since the
  fan-out subscriber reads `webhook_endpoints` from inside the outbox drain, a
  `TRUNCATE` naming both that table and `outbox_events` deadlocks against a
  drain in flight. `DELETE` takes ROW EXCLUSIVE, which does not conflict with
  the drain's ACCESS SHARE.

## Commands

- `npx nx test @orthacms/webhooks-server`
- `npx nx run @orthacms/webhooks-server:db:generate --name=<change>`
- `npx nx run-many -t typecheck lint -p @orthacms/webhooks-server`
