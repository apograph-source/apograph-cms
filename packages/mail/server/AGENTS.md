# @apograph/mail-server

The plugin that actually sends. Owns one table — `mail_deliveries` — and ships
its migrations; renders the three transactional messages the product sends;
hands them to the one provider the deployment configured, from a worker that
holds no transaction while it waits on a mail server.

**Layout: layered (ADR-0003)** — `application / infrastructure`, with the
framework-free half in `@apograph/mail-domain`. There is no `domain/` folder
here and no aggregate: a queued message is a row with a body and an attempt
count, and forcing empty `value-objects/` onto it would be a violation of
ADR-0003 rather than compliance with it.

## The one thing to understand first

**The enqueue is inline; the send is not.** The raw token exists exactly once,
inside the transaction that issued it (`InviteTokenService.rotate` returns it
and `tokens` keeps only its SHA-256), so a message containing the link **cannot
be assembled later** — an outbox subscriber provably could not rebuild it. The
row is therefore written by `MailDispatcherService` inside the caller's open
transaction, already rendered.

That is a deliberate divergence from ADR-0016's _shape_ and not from its
**rule**: `MailDeliveryWorker` claims a batch in a short transaction, commits,
and only then opens a socket. Nothing here ever talks to a network with a
transaction held.

## Composition

| File                                         | Role                                                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `utils/mail-plugin.ts`                       | The factory. Refuses a bad `appUrl`, a missing `from`, a provider that declares nothing, and pacing values that would stall the worker.         |
| `mail.module.ts`                             | The one global dynamic module. Binds `MAIL_PROVIDER`, `MAIL_CONFIG`, and `MAIL_DISPATCHER` → `MailDispatcherService`.                           |
| `application/mail-dispatcher.service.ts`     | Renders a `TransactionalMail` and queues it. The adapter behind the port `users-server` injects.                                                |
| `infrastructure/mail-delivery.repository.ts` | The queue and the dead-letter log over one table. `enqueue` runs on `UnitOfWork.current()`; everything the worker does runs on the base client. |
| `infrastructure/mail-delivery.worker.ts`     | Claim → commit → hand over → delete, with backoff and the expiry sweep.                                                                         |
| `infrastructure/mail-provider.check.ts`      | Refuses the boot on a backend that cannot send.                                                                                                 |

## `mail_deliveries`, and the two columns the design document did not have

A delivered row is **deleted**, not stamped: it holds an account-takeover
secret, it exists to survive a crash between commit and send, and it has no
reason to outlive the send. The opposite of `outbox_events`, which is stamped
and never pruned — and exactly why the secret cannot go there.

Two columns were added while implementing it, both recorded in
[`docs/design/mail.md`](../../../docs/design/mail.md):

- **`link`** — the link on its own, so `reveal-link` hands back the secret
  without parsing a rendered body. It is the same secret the body already
  carries, in the same row, deleted at the same moment; the alternative makes
  the copy and a security-relevant route load-bearing on each other.
- **`dead_at`** — what "given up on" means. The design said a dead letter is a
  row at the attempt cap, but a **permanent** rejection stops a row on its first
  attempt with its budget untouched (I-08), and both have to read as dead
  letters.

There is no `status` column and no second table. The claim leases a row by
pushing `next_attempt_at` forward, so a concurrent worker skips it and a process
that dies mid-send releases it by timeout — no reaper, and no state machine.

## Registering it changes the API

With this plugin registered, `POST /api/users/invites`, the resend route and the
reset route stop returning the raw token (ADR-0018 §4). That is the point, and
it is why the host registers it only when `MAIL_PROVIDER` names a backend.
`revealLinks` keeps the token alongside the message for debugging a delivery
problem; `POST /api/users/:id/reveal-link` (`users:manage`, audited) is the
supported way to see one otherwise.

## Configuration

`appUrl` and `from` are required; everything else has a default
(`MAIL_DEFAULTS`). Provider credentials are **not** here — they belong to the
factory the host imports, typed by it, the same arrangement media and the
copilot use. `deliveryIntervalMs: 0` queues without sending from this process,
which is how a deployment dedicates one node to outgoing traffic.

## Working here

- Authoring rules: the **`server-plugin`** skill.
- Generate a migration with
  `npx nx run @apograph/mail-server:db:generate --name=<change>` and commit the
  SQL.
- The e2e suite is `apps/server-e2e/src/server/users/mail-delivery.spec.ts`; it
  boots the harness with `createTestApp({ mail: {} })`, which is the only way to
  get the plugin registered there.
