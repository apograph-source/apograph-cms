# Outgoing mail — design

> **Status:** proposed, nothing built. The decision behind it is
> [ADR-0018](../adr/0018-mail-provider.md); this document is the technical
> description that record deliberately does not carry. Once the packages exist,
> their `AGENTS.md` files become the reference for their own internals.

## What it is

One **mail provider** per deployment, a queue in front of it, and four messages
the CMS actually needs to send. It exists because the product currently sends
nothing: an invitation and a reset link are returned to the administrator, who
relays them by hand, and self-service password recovery therefore does not exist
at all.

Three properties carry the design:

- **The message is built where the secret is** — inside the transaction that
  issues the token, because that is the only place the plaintext exists.
- **The network is never inside a transaction** — the worker claims a row,
  commits, and only then talks to a mail server. The rule
  [ADR-0016](../adr/0016-webhooks-deliver-from-a-queue.md) exists for.
- **It is inert without a provider** — no queue, no worker, no recovery route,
  and the invite response still carries the link, exactly as today.

## The path a message takes

```
InviteMemberUseCase                       ← inside uow.run
  ├─ member saved
  ├─ InviteTokenService.rotate()          ← plaintext exists here, and only here
  ├─ mail_deliveries row                  ← rendered message, link included
  └─ outbox: member.invited               ← the audit event, no secret on it
       │ commit
       ▼
MailWorker                                ← claims FOR UPDATE SKIP LOCKED, commits
       └─ MailProvider.send()             ← nothing open
            ├─ ok    → delete the row
            └─ fail  → attempts++, backoff; at the cap, a dead letter
```

The divergence from webhooks is the enqueue, not the send. Webhooks fan out from
an outbox subscriber because a subscriber can rebuild a delivery from the event;
here it cannot, so the row is written inline. Both keep the socket outside the
transaction, which is the part that matters.

## The port

```ts
// packages/mail/domain
export interface MailProvider {
    /** Stable id, recorded on the delivery row. The provider's own fact. */
    readonly id: string;
    readonly capabilities: MailCapabilities;
    /** Resolves on hand-off, rejects with a retryable/permanent distinction. */
    send(message: MailMessage): Promise<MailReceipt>;
    /** Optional boot check — a bad sender or credential refuses startup. */
    verify?(): Promise<void>;
}

export interface MailMessage {
    to: string;
    subject: string;
    text: string;              // always present
    html?: string;             // optional; text is never omitted
    headers?: Record<string, string>;
}

export interface MailReceipt {
    /** The provider's own id for the message, when it gives one. */
    providerMessageId?: string;
}
```

`text` is mandatory and `html` optional, in that order deliberately: a plain-text
part always renders, and for a message whose entire content is one link, HTML is
decoration.

**Retryable versus permanent** is the provider's judgement and part of the
contract. A `MailPermanentError` (a malformed address, a rejected sender) stops
the row immediately; anything else is retried. Without that split a typo in an
address consumes the whole attempt budget and lands in the dead letters beside
real outages.

### Adapters

| Package | Declares | Notes |
| --- | --- | --- |
| `mail-provider-smtp` | `nodemailer` | The default answer. SMTP reaches Resend, SES, Postmark, SendGrid, Mailgun, Google Workspace, Microsoft 365 and any relay inside a perimeter — for a self-hosted product this is the market, not a fallback. |
| `mail-provider-resend` | — | One `POST /emails`, bearer, JSON. Plain `fetch`. Earns its package because the wire genuinely differs from SMTP, and because a PaaS with outbound 25/465/587 closed cannot use SMTP at all. |
| `mail-provider-postmark` | — | Same shape, different JSON. Second phase. |
| `mail-provider-console` | — | Writes the message to the log. **Installed unconditionally, offered nowhere, registered by no template** — the `identity-provider-fake` pattern. |
| `mail-provider-testkit` | — | Captures messages in memory for assertions, like `media-provider-testkit`. Same install rule. |

"Declares" is literal: `pack.mjs` writes `tslib` into every staged manifest, so a
package that declares nothing still installs one dependency.

## Data model

One table, owned by `mail-server`, shipped with its own migrations.

### `mail_deliveries`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` pk | |
| `kind` | `text` not null | `invite` · `invite_resent` · `password_reset` · `password_recovery`. What it was, for the dead-letter surface. |
| `to_address` | `text` not null | |
| `subject` | `text` not null | |
| `body_text` | `text` not null | **Rendered, link included.** |
| `body_html` | `text` | |
| `user_id` | `uuid` | Who it concerns, for the audit trail. Nullable: a recovery request for an unknown address writes no row at all. |
| `provider_id` | `text` | Stamped by the worker when it hands over. |
| `attempts` | `integer` not null default 0 | |
| `next_attempt_at` | `timestamptz` not null | Claim ordering and backoff. |
| `expires_at` | `timestamptz` not null | The token's own expiry. A row past it is swept unsent — sending a dead link is worse than sending nothing. |
| `last_error` | `text` | |
| `created_at` | `timestamptz` | |

Index on `(next_attempt_at)` for the claim, and on `expires_at` for the sweep.
No `sent_at`: **a delivered row is deleted.** It carries an account-takeover
secret and exists only to survive a crash between commit and send.

There is no second table. A dead letter is a row at the attempt cap, which is
what the surface reads.

## The worker

The shape is `WebhookDeliveryWorker`'s, and the reasons are the same:

- Claim with `FOR UPDATE SKIP LOCKED`, ordered by `next_attempt_at`, in a short
  transaction that commits before any send.
- Exponential backoff on `attempts`, capped; at `MAX_ATTEMPTS` the row stops and
  is a dead letter.
- A retry re-sends **the same rendered body**, never a regenerated one — so both
  copies of a duplicated message carry the same working link.
- Rows past `expires_at` are swept without sending.

## HTTP API

Mail adds almost no surface of its own. Two routes, and one behaviour change to
routes that already exist.

| Method & path | Guard | Notes |
| --- | --- | --- |
| `POST /api/auth/password-recovery` | public | **Only mounted when a provider is configured.** Always `202`, always the same body, whether or not the address exists. Rate-limited per address and per source. A disabled member gets nothing — disabling already kills sessions in the same transaction, and this must not be a way around it. |
| `POST /api/users/:id/reveal-link` | `users:manage` | Returns the raw link for the open invite or reset, for when a message did not arrive. Audited. The only way to see a secret once a provider is configured. |
| `GET /api/mail/dead-letters` | `activity:read` | Deliveries at the attempt cap: kind, recipient, error, age. Sits beside `GET /api/activity/dead-letters`, which already does this for the outbox. |

**The behaviour change:** with a provider configured, `POST /api/users`
(invite), the resend route and the reset route stop returning the raw token.
The field is absent rather than empty, so a client that reads it fails loudly
instead of pasting `undefined` into a chat window.

## Configuration

| Key | Notes |
| --- | --- |
| `appUrl` | **New, required whenever a provider is configured.** The CMS has never needed an absolute URL and has no such config today. Never derived from the `Host` header: the caller controls it, and an invitation is the one message a recipient is certain to click. |
| `from`, `replyTo` | Sender identity. `verify()` checks the provider accepts `from` at boot. |
| `revealLinks` | Off. On returns the link **and** sends the message — a delivery-debugging mode, labelled as one. |

Provider credentials are not here: they belong to the factory the host imports,
typed by it, the same arrangement as media and the copilot.

## The messages

Four, all transactional, all triggered by somebody's action.

| Kind | Raised by | Phase |
| --- | --- | --- |
| `invite` | `InviteMemberUseCase` | 1 |
| `invite_resent` | `ResendInviteUseCase` | 1 |
| `password_reset` | `IssuePasswordResetUseCase` | 1 |
| `password_recovery` | The public recovery route | 2 |

The three phase-1 kinds replace the three `TODO(users-email)` markers, one each,
in the use cases that already exist.

### Templates

A template is a function from a typed payload to `{ subject, text, html? }`,
exported from `mail-domain` and overridable by the host in `MailPluginConfig` —
code, reviewed, in git, on the same grounds the content model is.

The first version is English only. `users` has no locale column, the server has
no i18n, and `ORT-113` already records that gap for the copilot's user-facing
text. Inventing server-side localisation here would be a second feature wearing
the first one's clothes; the override hook is what a deployment needing another
language uses meanwhile.

## Self-service password recovery

The one genuinely new capability. Four rules, each of which the feature is
useless or dangerous without:

1. **No enumeration signal.** Same status, same body, same timing envelope,
   whether or not the address is known. The product already holds this line
   elsewhere — an unknown workspace answers exactly `403`, indistinguishable
   from one that exists.
2. **Rate-limited by address and by source.** Otherwise the form is a way to
   mail-bomb a colleague and to burn the sending domain's reputation.
3. **Disabled members get nothing.** Disabling kills every live session in the
   same transaction; recovery must not reopen that door.
4. **Absent without a provider**, not erroring. A form with nowhere to send is
   worse than no form.

## Admin UI

Small, and none of it is a new page.

- **Reveal link** — an action on a member whose invite or reset is outstanding,
  behind a confirmation that says the link is a secret. Visible only when a
  provider is configured; without one the link is already on screen.
- **Delivery failed** — a notice where the member's status is shown, so an
  administrator who invited somebody learns the message never left rather than
  assuming it arrived.
- **Dead letters** — the mail rows beside the outbox's, in the activity area.

## Agent surfaces

**None.** No tool sends mail, on either surface, and none reveals a link. There
is no legitimate request that needs a model to trigger an outgoing message on a
person's behalf, and every illegitimate one — mailing an address the model was
talked into by entry content — is prompt injection with a delivery mechanism.
The tool registry gains nothing here, deliberately.

## What reaches the activity log

| Kind | When |
| --- | --- |
| `user.invite_link_revealed` | An administrator asked to see a secret. |
| `mail.delivery_failed` | A delivery reached the attempt cap. Carries the kind and the recipient, never the body. |

Invitation, resend and reset are already audited by their own use cases; mail
adds no duplicate for the happy path.

## How it meets the rest of the system

| | |
| --- | --- |
| **identity / users** | The three use cases gain one write each, inside the transaction they already open. `InviteTokenService` is unchanged: mail consumes the plaintext it already returns. |
| **create-apograph-app** | A fifth question — single-choice with **"Do not configure"** as the default, which is a group shape the wizard does not have yet (media is single-choice with no "none"; SSO and copilot are multi-choice). Entries: none, SMTP, Resend, with Postmark and SES greyed out through the existing `available: false`. `console` and `testkit` are offered nowhere. Every new package must be classified in `features.ts` or `features.spec.ts` fails. |
| **protection (ORT-226)** | Review-request mail lands after this, not with it. |
| **activity** | One new event kind and a dead-letter surface modelled on the outbox's. |
| **webhooks** | Its URL policy — which decides where this server may be talked into connecting — does **not** apply. A mail host is operator configuration, not user input. Stated so nobody copies the policy defensively. |
| **i18n** | Open: recipient locale. See Templates. |

## Invariants

- **I-01** With no provider configured, behaviour is byte for byte what it is
  today: the invite response carries the raw token, and no queue, worker or
  recovery route exists.
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
- **I-09** The recovery route's response does not vary with whether the address
  exists, and writes no row for an unknown one.
- **I-10** A disabled member receives no recovery message.
- **I-11** Links are built from `appUrl`; no request header reaches a URL in a
  message.
- **I-12** No tool in the registry can send mail or reveal a link.
- **I-13** `console` and `testkit` are registered by no template and offered by
  no picker.

## Testing checklist

| Action | Expected |
| --- | --- |
| Invite with no provider | Response carries the token; no `mail_deliveries` row |
| Invite with a provider | Response has no token field at all; one row; worker sends and the row disappears |
| Invite where the transaction rolls back | No row, no message |
| Provider rejects once, then succeeds | One message delivered, same body both attempts |
| Provider returns a permanent error | Row stops at once, shows in dead letters, budget untouched |
| Row older than `expires_at` | Swept, never sent |
| Recovery for a known and an unknown address | Identical status and body; a row only for the known one |
| Recovery for a disabled member | Identical response, no row |
| Recovery with no provider | `404` — the route is not mounted |
| Reveal link | Returns the secret once, writes `user.invite_link_revealed` |
| Boot with a `from` the provider rejects | Startup refuses, naming the address |
| Boot with a provider and no `appUrl` | Startup refuses |
| Offer the tool catalogue to any role | No tool sends mail or reveals a link |

## What this does not do

- **Not a newsletter.** Transactional messages only — the ones a person is
  waiting for after somebody's action. No digests, no subscriptions, no
  marketing.
- **Not inbound.** The port only sends. A reply goes wherever `replyTo` points.
- **No bounce handling.** We learn that we could not hand a message over, not
  that it was rejected downstream. No suppression list. A named gap.
- **No template editor.** Templates are code.
- **Not a notification abstraction.** No SMS, no push, no "channel" indirection
  for a second channel that does not exist.

## Phases

1. **Messages go out** — ADR accepted, `mail/domain`, `mail/server` with the
   queue and worker, SMTP and console adapters, the three phase-1 messages,
   `appUrl`, reveal-link, and the three `TODO(users-email)` markers closed.
2. **Self-service** — the recovery route with its four rules, rate limiting,
   dead letters, and the Resend and Postmark adapters.
3. **Seams** — the `create-apograph-app` question, review-request mail after
   ORT-226, recipient locale as its own decision, the feature page and the docs
   section.
