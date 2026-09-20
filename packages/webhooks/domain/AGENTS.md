# @orthacms/webhooks-domain

The framework-free kernel behind outgoing webhooks. Everything a delivery
_means_ lives here: which events can be subscribed to, whether one belongs to an
endpoint, what the posted body looks like, how it is signed, when a failed
attempt is retried, and which URLs this server may be talked into reaching.

**Imports no framework.** No NestJS, no Drizzle, no React, no HTTP client. The
only Node built-in it uses is `node:crypto`, for the HMAC — the same latitude
`@orthacms/database`'s `createDomainEvent` takes. That is what makes all of it
testable without a database, a socket or a clock, and it is why the contract
external receivers depend on cannot accidentally acquire a dependency on how the
outbox happens to store an event today.

## What lives here

| Module            | What it decides                                                     |
| ----------------- | ------------------------------------------------------------------- |
| `event-catalogue` | Which kinds are subscribable, and how the filters apply to each     |
| `subscription`    | `matches(endpoint, event)` — the whole routing decision             |
| `envelope`        | The JSON body, built from a framework-free `WebhookSourceEvent`     |
| `signature`       | HMAC-SHA256 over `"{timestamp}.{body}"`, and its verifier           |
| `retry-policy`    | What a status code means, and when the next attempt is due          |
| `url-policy`      | Where this server may connect — the SSRF surface, as pure functions |
| `delivery`        | The status vocabulary and the delivery headers                      |

## The five decisions worth knowing before changing anything here

### 1. The catalogue is data, not a `switch`

`WEBHOOK_EVENTS` is an array of descriptors. The admin's picker, the DTO's
`@IsIn`, the `GET /api/webhook-events` response and the documentation all read
it, so adding a kind is one entry rather than four edits that drift.

A descriptor carries **two** predicates, `scopedByContentType` and
`carriesWorkspace`, and they are deliberately separate. "Not tied to a content
type" and "not tied to a workspace" are different facts; conflating them either
drops deliveries an endpoint asked for or sends ones it did not.

### 2. An empty filter means "everything", including what does not exist yet

All three sets read that way. It is the opposite of an API token's workspace
bucket, which forbids an empty set — but a token's set is the **bounds of its
authority**, where "all" would be a hole, while this one is a **subscription
filter**, where "all" is an ordinary answer. An endpoint that asked for
everything should not silently stop covering the next workspace someone creates.

`matches` returns `false` for a kind that is not in the catalogue. Without a
descriptor there is no way to know whether the filters even apply to it, and
"not yours" is the only safe answer.

### 3. The timestamp is inside the signed string

`signedPayload(t, body)` is `` `${t}.${body}` ``. Signing the body alone would
let anyone who captured one delivery replay it verbatim for as long as the
secret lives, and the receiver would have no way to tell. The `v1=` prefix is
what makes a future scheme change possible without breaking every receiver on
the day it ships.

`verifySignature` is exported and is the same code the tests and the documented
receiver snippet use. A verifier written twice is a verifier that disagrees with
itself eventually.

### 4. Every 4xx except 408 and 429 is fatal

A rejected body or a wrong path will not be accepted on the sixth attempt, and
hammering a receiver that already said no for nine hours is the behaviour that
gets a sender blocklisted. `408` and `429` describe a moment rather than the
request, so they are retried; `429` may name its own delay, capped at an hour so
a receiver cannot park us.

The jitter in `nextAttemptDelayMs` is not decoration: retries scheduled together
stay together for every subsequent round, so a receiver coming back from an
outage would be hit by its whole accumulated backlog on one tick.

### 5. The URL policy is domain logic, not a client concern

A webhook is, precisely, "the server makes a request to an address a user
typed". So the check lives here and runs in two places — when the endpoint is
saved (so a refusal reaches the form) and on **every send** (so a hostname
re-pointed afterwards is refused too).

`assertUrlShape` judges what needs no network: the scheme, embedded credentials,
and a literal IP host. `assertAddressAllowed` judges a **resolved address**, and
the server package calls it inside the connection agent's own DNS lookup — a
name checked at save time and connected to later is the textbook DNS-rebinding
hole.

`parseIpv4` refuses zero-padded octets rather than trying to honour them:
`010.0.0.1` is `8.0.0.1` to an octal parser and `10.0.0.1` to a decimal one, and
guessing is how a blocklist gets walked around.

## Adding an event kind

1. Add a descriptor to `WEBHOOK_EVENTS`, deciding both predicates.
2. Make sure the event's payload actually carries what the predicates claim —
   `workspaceId` above all. Media events, for instance, do **not** yet, which is
   exactly why they are not in the catalogue.
3. Nothing else. The picker, the validation and the docs endpoint follow.

## Commands

- `npx nx test @orthacms/webhooks-domain`
- `npx nx run-many -t typecheck lint -p @orthacms/webhooks-domain`
