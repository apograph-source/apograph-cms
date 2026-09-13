# Outgoing webhooks

> **Status:** shipped. The decision behind it is
> [ADR-0016](../adr/0016-webhooks-deliver-from-a-queue.md); the packages are
> [`webhooks/domain`](../../packages/webhooks/domain/AGENTS.md),
> [`webhooks/server`](../../packages/webhooks/server/AGENTS.md) and
> [`webhooks/admin`](../../packages/webhooks/admin/AGENTS.md), whose `AGENTS.md`
> files are the reference for their own internals. This document is the
> cross-cutting picture, and the one a receiver's author should read.

## What it is

A **webhook endpoint** is a URL this CMS posts to when content changes, plus
three filters that say which changes are worth sending. Endpoints are configured
globally — in the admin sidebar's directory group, beside API tokens — because
one endpoint can span several workspaces and holds a signing secret. Both
`webhooks:read` and `webhooks:manage` are administrator-only.

## The path an event takes

```
a write commits
   └─ domain event → outbox_events            (same transaction as the write)
        └─ OutboxDispatcher drains
             └─ WebhookFanoutSubscriber        ← one SELECT, one INSERT, no network
                  └─ webhook_deliveries rows
                       └─ WebhookDeliveryWorker  ← claims, commits, then POSTs
                            └─ your endpoint
```

The split at the fan-out is the whole design, and
[ADR-0016](../adr/0016-webhooks-deliver-from-a-queue.md) is why: the dispatcher
calls subscribers **inside** the transaction that claims a batch, so an HTTP
request there would hold a database transaction open for a stranger's response
time — and a failure would count against the outbox row, eventually
dead-lettering an event the activity log and the alarms evaluator also needed.

## The subscription model

Three sets, intersected. **An empty set means "everything", including things
that do not exist yet.**

| Filter        | Empty means                                        |
| ------------- | -------------------------------------------------- |
| Workspaces    | every workspace, including ones created later      |
| Event kinds   | every kind, including ones added to the catalogue  |
| Content types | every type, including ones added to the code later |

That is the opposite of an API token's workspace bucket, which forbids an empty
set — but a token's set is the bounds of its authority, where "all" would be a
hole, while this one is a subscription filter, where "all" is an ordinary answer.

There is no expression language. A second query grammar is a second thing to
document and a second place for a rule to mean something the UI does not.

**A record with no workspace** (`content_*.workspace_id` is nullable) can only
satisfy an endpoint that takes them all. The editor says so next to the field.

**The type filter is scoped by the workspace filter.** The editor only asks
about content types once the workspaces are decided, and then offers the union
of what those workspaces were granted (`workspace_content`) — a delivery needs
both halves to match, so a type none of them can hold would produce nothing but
silence. "All workspaces" widens it back to the whole registry, since a
workspace created later may be granted anything.

**Content types are named, not enumerated.** The editor's picker is filled from
content's own registry (`GET /api/content-schema`), but a name that is not in it
is still accepted and still saved: a type is code, so an endpoint is routinely
configured before the type it subscribes to is written. The server validates the
field as a bounded list of strings for the same reason — a closed enum here
would make "subscribe to the type I am about to add" inexpressible. The cost is
that a typo cannot be rejected, only shown: the editor marks a subscribed name
the running build does not define, which is the one place an endpoint silently
receiving nothing becomes visible.

## Custom headers

An endpoint may carry static headers sent with every delivery — an
`Authorization: Bearer …` for a receiver that wants its own credential on top of
the signature, an `X-Api-Key`, a routing header for a gateway. They are edited
on the endpoint form and stored on the row.

Two families are refused, in the editor and again on every write
(`isAllowedCustomHeader`): anything starting with **`X-Apograph-`**, and the
transport's own (`Host`, `Content-Type`, `Content-Length`,
`Transfer-Encoding`, `Connection`, `User-Agent`). The first would let a delivery
claim to be a different event, or to be signed by someone else; `Host` is how a
request aimed at one virtual host gets served by another.

A header value is a credential for somebody else's system, and the API returns
it in full to anyone holding `webhooks:read` — which is administrators only, the
same people who can rotate the signing secret. The endpoint's read-only view
lists header **names** for that reason; the values live in the editor.

Custom headers are not a substitute for the signature. A receiver still verifies
`X-Apograph-Signature`: a bearer token proves who sent the request, the HMAC proves
the body was not changed on the way.

## What a receiver gets

```http
POST /hooks/apograph HTTP/1.1
Content-Type:       application/json
User-Agent:         Apograph-Webhooks/1
X-Apograph-Event:      entry.published
X-Apograph-Delivery:   3f2b…      # this delivery; changes on a redelivery
X-Apograph-Event-Id:   9c41…      # the event; STABLE across redeliveries
X-Apograph-Workspace:  b71e…      # omitted when the event has no workspace
X-Apograph-Attempt:    2
X-Apograph-Signature:  t=1756468320,v1=5d41402abc4b2a76…
```

```json
{
    "id": "3f2b…",
    "event": "entry.published",
    "eventId": "9c41…",
    "occurredAt": "2026-08-29T10:12:04.881Z",
    "workspaceId": "b71e…",
    "actor": { "id": "d0a2…", "email": "editor@example.com" },
    "data": {
        "kind": "content_entry",
        "id": "5ac9…",
        "contentType": "article"
    }
}
```

**The body carries references, not field values**, and there is no option to
change that. Read the record back through the public API with your own token:
that read passes through the visibility rules and the audience entitlements an
editor set on the entry, and a webhook that inlined the values would route
around all of them.

`actor` is `null` for a write made with an API token or by the system. Naming a
person who did not do it would be worse than saying nothing.

## Verifying a delivery

The signature is HMAC-SHA256 over `"{timestamp}.{raw body}"`. Sign the **raw
bytes** you received, not a re-serialised object — key order is not guaranteed
to survive a round trip.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret, header, rawBody, toleranceSeconds = 300) {
    const parts = Object.fromEntries(
        header.split(',').map((part) => part.trim().split('='))
    );
    const timestamp = Number(parts.t);
    if (!Number.isInteger(timestamp)) return false;

    // Reject a delivery captured earlier and replayed now.
    const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
    if (age > toleranceSeconds) return false;

    const expected = createHmac('sha256', secret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

    return (
        expected.length === parts.v1.length &&
        timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1))
    );
}
```

`@apograph/webhooks-domain` exports `verifySignature` with exactly this
behaviour, so a JavaScript receiver can import it rather than reimplement it.

## What a receiver must handle

- **Deduplicate on `X-Apograph-Event-Id`.** Delivery is at-least-once, and a
  redelivery deliberately reuses the id so a receiver that already handled the
  event ignores the repeat.
- **Do not rely on order.** Attempts retry on independent schedules and several
  workers may send at once. Order by `occurredAt` if order matters.
- **Answer quickly.** The default timeout is ten seconds. Acknowledge with a
  `2xx` and do the work afterwards.
- **Expect duplicates and gaps in time, not in content.** Every committed change
  is delivered at least once, eventually, or lands in the log as `dead` where an
  operator can see it and press "Send again".

## Retries

Six attempts: `10s → 1m → 5m → 30m → 2h → 6h`, jittered by ±20 % so a receiver
coming back from an outage is not hit by its whole backlog on one tick. About
nine hours end to end.

| Response                                 | What happens                                    |
| ---------------------------------------- | ----------------------------------------------- |
| `2xx`                                    | Delivered; the endpoint's failure streak resets |
| `408`, `429`, `5xx`, timeout, no connect | Retried                                         |
| `429` with `Retry-After`                 | Honoured, capped at one hour                    |
| any other `4xx`                          | Given up on immediately                         |

Other `4xx` responses are fatal on purpose: a rejected body or a wrong path will
not be accepted on the sixth attempt, and hammering a receiver that already said
no is how a sender gets blocklisted.

After **20 consecutive** failed deliveries the endpoint switches itself off with
a reason shown in the admin. Without that, a staging URL torn down months ago
keeps generating six requests per save for the life of the deployment.

## Where this server may connect

A webhook is, precisely, "the server makes a request to an address a user
typed", so the URL policy is part of the domain rather than a check in the HTTP
client. It runs on **every send**, not only on save — a hostname re-pointed
afterwards has to be refused too.

- `https://` only (`WEBHOOKS_ALLOW_INSECURE_URLS=true` for local development).
- No credentials in the URL; the signature is how a receiver authenticates us.
- Private, loopback, link-local and reserved addresses are refused, the cloud
  metadata endpoint included (`WEBHOOKS_ALLOW_PRIVATE_NETWORKS=true` for a
  self-hosted install whose receiver shares the cluster).
- The check runs on the **resolved address**, inside the connection agent's own
  DNS lookup, so a rebinding hostname cannot be connected to after passing an
  earlier check.
- Redirects are not followed. A `3xx` is a failed delivery.
- The response body is read to 2 KB and the rest abandoned.

## The signing secret

It is stored in the clear, unlike an API token's hash. That is a consequence of
the job: a token is only ever _verified_, so a hash suffices, but a webhook
secret is used to **sign**, and a key that cannot be read back cannot sign
anything.

What is done instead: the secret is shown exactly once, on mint and on rotation;
no read route ever returns it (`secretHint` — its last four characters — is what
the UI shows); and rotating takes effect immediately, including for deliveries
already queued, because they are signed when they are sent.

## Configuration

| Variable                          | Default | What it does                                         |
| --------------------------------- | ------- | ---------------------------------------------------- |
| `WEBHOOKS_DELIVERY_INTERVAL`      | `2000`  | Sender tick, in ms. `0` queues but never sends here. |
| `WEBHOOKS_TIMEOUT`                | `10000` | Per-request timeout, in ms.                          |
| `WEBHOOKS_RETENTION_DAYS`         | `30`    | How long a completed delivery stays in the log.      |
| `WEBHOOKS_ALLOW_INSECURE_URLS`    | `false` | Permit `http://`.                                    |
| `WEBHOOKS_ALLOW_PRIVATE_NETWORKS` | `false` | Permit loopback and RFC 1918.                        |

## What this does not do

- **Incoming webhooks.** Apograph is the sender, not a receiver.
- **Per-workspace management.** The section is global and administrator-only.
- **Body templating.** The envelope is fixed.
- **Media, transfer, workspace and account events.** They already exist on the
  outbox; adding one to `WEBHOOK_EVENTS` is one entry, but the media events do
  not yet carry their workspace on the payload — the same gap this release
  closed for entries — and account events are administrative audit with a
  different audience and different sensitivity.
- **Transports other than HTTP POST**, and sub-second propagation. Both were
  always the wrong shape for this mechanism.
