# mail — package dossier

> **Phase 1.** What is described here is what ships: the port, the queue, the
> worker, the three transactional messages, `reveal-link`, and the SMTP,
> console and testkit adapters — plus phase 3's scaffolder question, which
> `create-apograph-app` now asks. Self-service password recovery, the
> dead-letter API and the Resend and Postmark adapters are phase 2 of
> [ADR-0018](../adr/0018-mail-provider.md); they are named in section 13 rather
> than described as if they existed.

## 1. Business description

The CMS used to send nothing. An invitation and a password-reset link were
returned to the administrator in the API response, and they passed them to the
person by hand — three use cases carried the same `TODO(users-email)` marker.
The consequence was larger than the inconvenience: there was **no self-service
password recovery at all**, because a public form would have issued an
account-takeover link and had nowhere to send it.

This package is the missing half. One **mail provider** per deployment, a queue
in front of it, and the three messages the product actually needs to send.

**What it is not.** Not a newsletter — transactional messages only, the ones a
person is waiting for after somebody's action. Not inbound: the port only sends,
and a reply goes wherever `replyTo` points. No bounce handling and no
suppression list: we learn that we could not hand a message over, never that it
was rejected downstream. No template editor — templates are code.

**Inert by default.** A deployment that names no backend has no queue, no
worker, and an invite response that still carries the raw link: byte for byte
the behaviour the product shipped with (I-01).

## 2. Composition

| Package                           | What it is                                                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@apograph/mail-domain`           | The kernel. Two ports (`MailProvider` outward, `MailDispatcher` inward), the message and its receipt, `MailPermanentError`, the links, the templates, the retry schedule. **No dependencies at all**, asserted by a test. |
| `@apograph/mail-server`           | The plugin. One table, the dispatcher adapter, the worker, the boot check.                                                                                                                                                |
| `@apograph/mail-provider-smtp`    | The backend a deployment runs, over `nodemailer`.                                                                                                                                                                         |
| `@apograph/mail-provider-console` | Writes messages to the log. Ships with every app, offered by no picker.                                                                                                                                                   |
| `@apograph/mail-provider-testkit` | Captures messages, and can be told to fail. Same install rule.                                                                                                                                                            |

There is no `mail/admin`. The admin changes this feature needs are in
`users-admin`, where the invitation and reset flows already live.

## 3. Roles and permissions

One new key: **`users:manage`**, held by `admin` only, and required by
`POST /api/users/:id/reveal-link`. It is separate from `users:update` because
that key is about editing somebody's name and role, and this one hands over a
secret that takes over their account.

No agent surface, on either the copilot or MCP: no tool sends mail and none
reveals a link (I-12). There is no legitimate request that needs a model to
trigger an outgoing message on a person's behalf, and every illegitimate one —
mailing an address the model was talked into by entry content — is prompt
injection with a delivery mechanism.

## 4. Data model

One table, `mail_deliveries`, owned by `mail-server` and migrated under
`__drizzle_migrations_mail`.

| Column                                            | Notes                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                              | uuid pk                                                                                                                               |
| `kind`                                            | `invite` · `invite_resent` · `password_reset`. Text, not an enum: a new message should be a template and a use case, not a migration. |
| `to_address`, `subject`, `body_text`, `body_html` | The message, **already rendered**.                                                                                                    |
| `link`                                            | The link on its own, so `reveal-link` need not parse a body.                                                                          |
| `user_id`                                         | Who it concerns, for the audit trail and for `reveal-link`.                                                                           |
| `provider_id`                                     | Stamped by the worker when it hands over.                                                                                             |
| `attempts`, `next_attempt_at`, `last_error`       | The retry state. `next_attempt_at` is also the **claim lease**.                                                                       |
| `expires_at`                                      | The token's own expiry. A row past it is swept unsent.                                                                                |
| `dead_at`                                         | When the message was given up on — budget spent, or permanently rejected.                                                             |
| `created_at`                                      |                                                                                                                                       |

Three indexes: the claim (partial, on `next_attempt_at` where `dead_at is
null`), the expiry sweep, and `(user_id, created_at)` for `reveal-link`.

**No `sent_at`, because a delivered row is deleted** (I-05). It holds an
account-takeover secret and exists only to survive a crash between commit and
send. This is the exact opposite of `outbox_events`, which is stamped and never
pruned — and precisely why a secret must not be put there.

## 5. Lifecycle of a message

```
InviteMemberUseCase                       ← inside uow.run
  ├─ member saved
  ├─ InviteTokenService.rotate()          ← plaintext exists here, and only here
  ├─ mail_deliveries row                  ← rendered message, link included
  └─ outbox: member.invited               ← the audit event, no secret on it
       │ commit
       ▼
MailDeliveryWorker                        ← claims FOR UPDATE SKIP LOCKED, leases, commits
       └─ MailProvider.send()             ← nothing open
            ├─ ok        → delete the row
            ├─ retryable → attempts++, backoff
            └─ permanent → dead_at, budget untouched
```

The lease is `next_attempt_at` pushed forward by `claimLeaseMs`, so a second
worker skips a row that is in flight and a process that dies mid-send releases
it by timeout. No `delivering` status, and no reaper.

## 6. Scenarios

- **Invite with no provider** → response carries the token; no row.
- **Invite with a provider** → response has no token field at all; one row; the
  worker sends it and the row disappears.
- **Invite whose transaction rolls back** → no row, no message.
- **Relay rejects once, then succeeds** → one message delivered, the same body
  both attempts.
- **Relay returns 5xx** → the row stops at once and shows as a dead letter, with
  its remaining budget unspent.
- **Row older than `expires_at`** → swept, never sent.
- **Reveal link on an undelivered message** → the secret, once, plus
  `user.invite_link_revealed` in the audit trail.
- **Reveal link after delivery** → `409 NO_REVEALABLE_LINK`: the row and the only
  readable copy of the token went out with the message.
- **Boot with a relay that refuses the credential** → startup refuses, naming
  the backend and the configured sender.

## 7. HTTP API

Mail adds **one** route of its own and changes three that already exist.

| Method & path                     | Guard          | Notes                                                                                                                                                                                                |
| --------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/users/:id/reveal-link` | `users:manage` | The link of the newest undelivered message for this member. Audited. `409` when the deployment sends no mail (`MAIL_NOT_CONFIGURED`) or when there is nothing left to reveal (`NO_REVEALABLE_LINK`). |

**The behaviour change:** with a provider configured, `POST /api/users/invites`,
`POST /api/users/:id/invites/resend` and `POST /api/users/:id/password-reset`
stop returning the raw token. The field is **absent** rather than empty, so a
client that reads it fails loudly instead of pasting `undefined` into a chat
window.

## 8. Admin UI

Nothing new, and two flows adapted. `users-admin` already showed the link after
an invitation, a resend and a reset; with a provider configured there is no link
to show, so the invite wizard's last step says the invitation is on its way and
holds nobody on the page, and the resend and reset paths confirm with a toast
instead of opening an empty hand-off dialog.

## 9. Configuration

| Key                          | Notes                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `MAIL_PROVIDER`              | `smtp` or `console`. Unset — the default — is a complete configuration: nothing is sent and the links come back in the API. |
| `APP_URL`                    | **Required** with a provider. Every link is built from it.                                                                  |
| `MAIL_FROM`, `MAIL_REPLY_TO` | Sender identity.                                                                                                            |
| `MAIL_PRODUCT_NAME`          | What the copy calls the product.                                                                                            |
| `MAIL_REVEAL_LINKS`          | Return the link **and** send the message. A delivery-debugging mode, labelled as one.                                       |
| `MAIL_DELIVERY_INTERVAL_MS`  | `0` queues without sending from this process.                                                                               |
| `MAIL_MAX_ATTEMPTS`          | Attempts before a message becomes a dead letter.                                                                            |
| `SMTP_*`                     | The relay, read only when `MAIL_PROVIDER=smtp`.                                                                             |

Provider credentials are not in `MailPluginConfig`: they belong to the factory
the host imports, the same arrangement media and the copilot use.

## 10. Security

- The queue holds a rendered account-takeover secret until the send succeeds.
  This is the trade-off at the centre of ADR-0018, and it is accepted because
  the exposure is strictly **smaller** than what it replaces: the same plaintext
  used to travel through an HTTP response, an administrator's clipboard, and
  anywhere that response was logged. The row is deleted on success, swept on
  expiry, and sits behind the same database access as `tokens` itself.
- The audit trail records that a link was revealed, never the link (`meta`
  carries the address and the message kind).
- Links never come from a request header (I-11).
- Delivery is at-least-once: a message can arrive twice, and the retry
  deliberately re-sends the **same rendered body**, so both copies carry the
  same working link.

## 11. Invariants

Numbered as in [`docs/design/mail.md`](../design/mail.md), which is where they
were first written; the tests that pin one name it in a comment.

- **I-01** With no provider configured, behaviour is byte for byte what it was:
  the invite response carries the raw token, and no queue, worker or route
  exists.
- **I-02** With a provider configured, no route returns a raw token except
  `reveal-link`, and every reveal is audited.
- **I-03** A `mail_deliveries` row is written in the same transaction as the
  token it carries, or not at all.
- **I-04** The worker holds no database transaction while a provider call is in
  flight.
- **I-05** A successfully delivered row is deleted, never stamped.
- **I-06** A retry sends the same rendered body as the first attempt.
- **I-07** A row past `expires_at` is never sent.
- **I-08** A permanent provider error stops the row without consuming the
  remaining attempt budget.
- **I-09** _(phase 2)_ The recovery route's response does not vary with whether
  the address exists, and writes no row for an unknown one.
- **I-10** _(phase 2)_ A disabled member receives no recovery message.
- **I-11** Links are built from `appUrl`; no request header reaches a URL in a
  message.
- **I-12** No tool in the registry can send mail or reveal a link.
- **I-13** `console` and `testkit` are registered by no template and offered by
  no picker.

## 12. Testing checklist

| Action                                    | Expected                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| Invite with no provider                   | Token in the response; no row                                              |
| Invite with a provider                    | No token field at all; one row; the worker sends it and the row disappears |
| Invite with a poisoned `Host` header      | The link still points at `appUrl`                                          |
| Provider rejects once                     | `attempts` 1, `dead_at` null, the error recorded                           |
| Provider rejects permanently              | Dead on the first attempt, budget unspent                                  |
| Reveal an undelivered link                | The secret, and `user.invite_link_revealed` in the log                     |
| Reveal after delivery                     | `409 NO_REVEALABLE_LINK`                                                   |
| Reveal as a contributor                   | `403`                                                                      |
| Boot with a relay that refuses the sender | Startup refuses, naming the address                                        |
| Boot with a provider and no `appUrl`      | Startup refuses                                                            |
| Offer the tool catalogue to any role      | No tool sends mail or reveals a link                                       |

## 13. Boundaries and what is not built yet

- **`users` owns the messages' triggers.** This package renders and delivers;
  which actions produce a message is a decision in the use case that takes
  them.
- **`identity` owns the tokens.** `InviteTokenService` is unchanged except that
  `rotate` now returns the expiry alongside the secret — the queue needs the
  instant the row was written, not a second computation of it.
- **`activity` owns the audit trail.** One new kind,
  `user.invite_link_revealed`.
- **The webhooks URL policy does not apply.** A mail host is operator
  configuration, not user input. Stated so nobody copies the policy
  defensively.
- **Not built (phase 2):** `POST /api/auth/password-recovery` with its four
  rules, the `GET /api/mail/dead-letters` surface, the `mail.delivery_failed`
  event, and the Resend and Postmark adapters.
- **Built (phase 3):** the `create-apograph-app` question. The scaffolder's
  fifth question is single-choice with **"Do not configure"** as its default;
  picking SMTP installs `mail-server` and `mail-provider-smtp` and writes
  `config/mail.ts`, the `mailPlugin()` helper and the `MAIL_*` / `SMTP_*` keys,
  while `mail-domain`, `mail-provider-console` and `mail-provider-testkit` are
  installed in every app and offered in no picker.
- **Not built (phase 3):** review notifications after ORT-226, and the
  recipient-locale decision.

## 14. Discrepancies and open questions

- **Two columns the design document did not have**, both now recorded in it:
  `link` (so `reveal-link` does not parse a rendered body) and `dead_at` (so a
  permanent rejection and a spent budget both read as dead letters without
  faking the attempt count).
- **`reveal-link` can only ever produce an undelivered message's link.** A
  delivered row is gone, secret and all. That is the feature working as
  intended, but it is not what "reveal the invite link" sounds like, and an
  administrator will meet the `409` before they read this.
- **A failure is only visible if somebody looks.** Phase 1 has no dead-letter
  surface and no notice on the member's row: an administrator who invites
  somebody and hears nothing has to ask the API. This is the largest gap in the
  shipped slice and the first item of phase 2.
- **Templates are English**, and a deployment needing another language
  overrides the functions. Named, not answered — see ORT-113.
