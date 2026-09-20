# 0016 — Webhooks deliver from a queue, never from the outbox subscriber

- **Status:** Accepted
- **Date:** 2026-08-29
- **Deciders:** Engineering

## Context

The CMS already has exactly the right seam for outgoing notifications. Every
state change writes its domain events to the transactional outbox in the same
transaction ([ADR-0003](0003-tactical-ddd-inside-plugins.md)), and after the
commit `OutboxDispatcher` delivers each event to every subscriber that asked for
its kind. The activity log is one such subscriber; the alarms evaluator is
another. Adding a third that posts to an HTTP endpoint looks like the obvious
next step, and it is what almost every "add webhooks" sketch starts with.

It does not work, and the reason is in `OutboxDispatcher.drainOnce`:

```ts
await this.db.transaction(async (tx) => {
    const rows = await tx.select()… .for('update', { skipLocked: true });
    for (const row of rows) {
        for (const subscriber of this.subscribersFor(row.kind)) {
            await subscriber.handle(event);   // ← inside the transaction
        }
        await tx.update(outboxEvents).set({ dispatchedAt: new Date() })…
    }
});
```

Three consequences follow, and each one is worse than the last:

1. **A subscriber that makes an outgoing request holds a database transaction
   and a pool client for a stranger's response time.** At a ten-second timeout
   and a batch of a hundred, one slow receiver stalls the whole drain — and the
   dispatcher's own comments already warn that concurrent drains competing for
   pool clients are a deadlock with no timeout and no recovery.

2. **A throw counts against the outbox row's attempt budget.** After
   `MAX_DELIVERY_ATTEMPTS` the row is parked as a dead letter. So an
   unreachable webhook receiver would eventually stop the **activity log** and
   the **alarms evaluator** from ever seeing that event. A third party's
   downtime would silently corrupt our own audit trail.

3. **Retries would be shared.** The outbox's backoff is one schedule for one
   row; two endpoints subscribed to the same event, one healthy and one not,
   cannot both be served correctly by it.

There is a second, quieter question underneath: how much a delivery should
carry. A webhook that inlines the record's field values is more convenient for
the receiver, and it routes around `publishedOnly` visibility, the reader
entitlements a segment defines ([`segments`](../../packages/segments/AGENTS.md)),
and the API token scoping — all of which are enforced on the **read** path the
webhook would be bypassing.

## Decision

**Webhook delivery is a queue of its own. The outbox subscriber only enqueues.**

- `WebhookFanoutSubscriber` runs inside the drain's transaction and does exactly
  two things: one `SELECT` over the enabled endpoints, and one batched `INSERT`
  into `webhook_deliveries`. No network, no third query.
- `WebhookDeliveryWorker` claims rows `FOR UPDATE SKIP LOCKED`, **commits the
  claim**, and only then makes the request. Nothing is open while it waits.
- Retries, backoff and the dead-letter decision belong to the delivery row, not
  to the outbox row, so one broken receiver costs one endpoint.
- Idempotency comes from a partial unique index on
  `(endpoint_id, event_id) WHERE redelivery_of IS NULL`. Outbox delivery is
  at-least-once, and this makes the repeat a no-op rather than a second POST.

**The envelope carries references, not content.** A delivery names the event,
the workspace, the actor and the record's id and type. A receiver reads the
record back through the public API with its own token, where every visibility
rule still applies.

There is deliberately **no opt-in to inline the values**, not even a column for
one. A flag that is accepted and does nothing is worse than an absent feature:
somebody sets it and spends an afternoon wondering why the body is unchanged. If
one is ever added, the snapshot has to be assembled through `PublicEntriesQuery`
— the same read path — so that "include the content" never quietly becomes "skip
the rules".

**Entry events carry `workspaceId`.** The workspace is the subscription filter,
and it cannot be recovered from the row after `entry.purged` because there is no
row. Alarms works around its absence today by reading the entry back, and its
own comments admit the gap. Stamping it where the fact occurs closes it for both.

## Consequences

**What this makes easy.**

- A receiver that is down for the night costs one endpoint's deliveries and
  nothing else. The audit trail and the alarms evaluator never notice.
- Delivery scales out for free: `SKIP LOCKED` means several API processes take
  disjoint rows, so more processes simply send faster.
- The log is the queue. "Did it arrive?", "what exactly did we send?" and "send
  it again" are all reads and writes of one table, not a separate observability
  story bolted on afterwards.
- Sending can be switched off per process (`deliveryIntervalMs: 0`) while
  queueing continues, so a deployment can dedicate one node to egress.

**What this costs.**

- One more table, and one more background timer per process.
- A delivery is not sent the instant the event commits — it waits for the next
  tick (two seconds by default). For a cache purge that is invisible; for
  anything wanting sub-second propagation it is the wrong mechanism, and always
  would have been.
- The delivery log grows at the rate content is edited. `retentionDays` prunes
  it; an installation that sets it to `0` is choosing an unbounded table.

**What this rules out, deliberately.**

- **Ordering guarantees.** Attempts are retried on independent schedules and
  several workers may be sending at once, so deliveries can arrive out of order.
  Receivers deduplicate on `X-Ortha-Event-Id` and order by `occurredAt`. This is
  documented prominently rather than quietly.
- **Exactly-once delivery.** It is at-least-once end to end, as the outbox is.
- **Aggregated events.** Publishing five hundred records produces five hundred
  deliveries. An `entry.bulk_published` kind could be added to the catalogue
  later, but it is a different contract for the receiver, not a tuning knob.
