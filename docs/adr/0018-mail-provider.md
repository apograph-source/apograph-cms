# 0018 — One mail provider per deployment, and the message is built where the secret is

- **Status:** Accepted
- **Date:** 2026-09-07 (accepted 2026-09-14)
- **Deciders:** Engineering

> The technical description — the port, the queue, the templates, the API, the
> invariants and the test checklist — is
> [`docs/design/mail.md`](../design/mail.md).

## Context

The CMS sends nothing. An invitation and a password-reset link are returned to
the administrator in the API response, and they pass them to the person by hand.
Three use cases carry the same marker in the same place:

```ts
// TODO(users-email): send this link instead of returning it, once a
// mailer exists (identity epic #11).
```

The consequence is bigger than the inconvenience. There is **no self-service
password recovery at all**, and the `identity` dossier explains why in one
sentence: a public form would issue an account-takeover link and would have
nowhere to send it. Everything downstream of that — a team above about ten
people, an editor who forgets a password on a Friday, the review notifications
[ADR-0017](0017-publication-protection.md) wants — is blocked on the same
missing piece.

Two facts about the existing design shape any answer.

**The raw secret exists exactly once, inside a transaction.** `tokens` stores
`token_hash` and nothing else; the plaintext is returned by
`InviteTokenService.rotate` inside the `uow.run` block that saved the member, and
after that it is gone. So a message containing the link **cannot be assembled
later**. The outbox carries domain events for subscribers that can reconstruct
what they need from them, and a subscriber here provably cannot.

**Sending is network I/O, and network I/O has one rule here already.**
[ADR-0016](0016-webhooks-deliver-from-a-queue.md) established it: a subscriber
must not make outgoing requests, because `OutboxDispatcher` calls subscribers
inside its claim transaction, and a stranger's response time then holds a
database transaction and a pool client. Anything that talks to a mail server has
to obey the same rule, whatever else it does.

## Decision

We will add a **mail** plugin: one port, several adapters, and a queue. Seven
points.

**1. A deployment runs exactly one provider, and the plugin takes it as one
object.** The shape is
[ADR-0012](0012-one-storage-provider-per-deployment.md)'s, kept deliberately:

```ts
MailServerPlugin({
    provider: createSmtpMailProvider(config.plugins.mail.smtp),
    config: config.plugins.mail
});
```

A provider is a factory returning an object that describes itself — an `id`
recorded on the delivery row, and an optional `verify()` so a bad configuration
refuses the boot instead of surfacing on somebody's first invitation. Backend
settings live in the host's own config, typed by the factory the host imports.

**2. The message is enqueued in the same transaction that issues the token.**
Not from an outbox subscriber. A `mail_deliveries` row is written inside the
`uow.run` block, carrying the already-rendered message including the link,
because that is the only place the plaintext exists. This is a deliberate
divergence from ADR-0016's fan-out shape and not from its rule: **the worker
claims a row, commits, and only then opens a connection.** No network inside a
transaction, exactly as before.

**3. A delivered row is deleted, not stamped.** The row holds an
account-takeover secret; it exists to survive a crash between commit and send,
and it has no reason to outlive the send. This is the opposite of
`outbox_events`, which is stamped and never pruned — a table whose own schema
comment says so, and which is exactly why a secret must not be put there.

**4. With a provider configured, the API stops returning the raw link.** Two
copies of an account-takeover token are worse than one, and the second one lands
in an administrator's clipboard, their terminal scrollback, and whatever logs
the response passed through. The invite response becomes an ordinary `201`.
For the case the message does not arrive, a separate **reveal-link** action
remains: administrator only, one entry point, audited — the same operation that
happens silently today, now visible as the exception it is.

**5. The link is built from configured `appUrl`, never from the request.**
Mail needs an absolute URL and the CMS has never had one; there is no such
config today. It will not be derived from the `Host` header, which the caller
controls: an attacker-set `Host` turns an invitation from your domain into a
phishing link, and an invitation is the one message a recipient is certain to
click.

**6. The offline adapters are installed unconditionally and registered by
nobody.** `mail-provider-console` and `mail-provider-testkit` follow the
`identity-provider-fake` pattern already in `create-ortha-app`: shipped with
every app, offered in no picker, named by no template. `ORT-148` records what
the alternative costs — the copilot's fake provider became the production
default and nothing prevented it. Here the failure is quieter and worse:
invitations appear to be sent and nobody receives them.

**7. Self-service password recovery exists only with a provider, and gives no
signal.** The route is **absent** when none is configured, rather than answering
with an error. When present it answers identically whether or not the address
belongs to anyone, and it is rate-limited by address and by source — otherwise
the form is a staff directory and a way to burn the sending domain's reputation.

## Consequences

**Easier:**

- The three `TODO(users-email)` markers close, and the product stops depending on
  an administrator relaying secrets by hand.
- Password recovery becomes possible for the first time — the single genuinely
  new capability in this record; everything else moves an existing link from a
  clipboard into a message.
- ADR-0017's review notifications get somewhere to go, as does anything later
  that needs to reach a person.
- A deployment that configures nothing is unaffected: no provider, no queue, no
  route, and the invite response still carries the link. Inert by default, the
  same way `segments` is before its first audience.

**Harder / the cost we accept, stated plainly:**

- **A rendered secret sits in a row until the send succeeds.** This is the
  trade-off at the centre of the record, and it is accepted because the exposure
  is strictly smaller than today's: the same plaintext currently travels through
  an HTTP response, an administrator's clipboard and anywhere that response was
  logged. The row is deleted on success, swept on expiry, and covered by the
  same database access as `tokens` itself.
- **At-least-once delivery means a message can arrive twice.** A duplicate
  invitation is harmless; the retry deliberately re-sends the _same_ rendered
  message rather than regenerating one, so both copies carry the same working
  link.
- **A failure is silent unless surfaced.** An administrator who invites somebody
  and hears nothing must be told the message never left. This needs an event
  kind and a place to see it, beside the outbox dead letters that already exist.
- **Templates are server-authored English.** `users` has no locale column and the
  server has no i18n; `ORT-113` already records the same gap for the copilot.
  The first version ships English plus a host override hook, and the locale
  question is named rather than answered.
- **`appUrl` is a new required configuration.** Deployments upgrading into a
  configured mailer must set it, and the boot refuses without it.
- **No bounce handling.** The provider knows a message was rejected downstream;
  we only learn that we could not hand it over. A suppression list is out of
  scope, not pending.

**What this rules out:** a secret in `outbox_events`; a link assembled from a
request header; a provider chosen per workspace; and a mail path that opens a
socket while holding a transaction.

## Alternatives considered

- **Generate the token at send time**, so nothing sensitive is ever stored. The
  most attractive alternative, and the reason it fails is retries: a second
  attempt rotates the token and kills the link in a first message that may well
  have arrived. Trading a bounded storage exposure for a user who clicks a valid
  link and is told it expired is the wrong way round.
- **Send from an outbox subscriber, like webhooks.** The shape we would prefer
  for symmetry, and it cannot work: the subscriber cannot reconstruct the
  plaintext, and putting it on the event means writing an account-takeover
  secret into a table that is stamped and never pruned.
- **Keep returning the link and also send it.** Rejected as the default for the
  reason in §4, and kept as an explicit, audited action for delivery failures —
  which is what an operator actually needs when a message bounces.
- **Abstract the port to "notifications"** (mail, SMS, push, webhook) from the
  start. Rejected: there is no second channel and no user asking for one, so the
  abstraction would be designed blind. The port is named for what it does, and a
  second channel earns its own record.
- **One HTTP adapter with vendor presets**, the way `sso-provider-oidc` covers
  Okta, Auth0, Keycloak and the rest inside one package. Rejected because that
  pattern works on the back of a specification: OIDC vendors are conformant to
  one, and Resend, Postmark and SendGrid are three unrelated JSON APIs with
  nothing to be presets of.
- **Templates edited in the admin.** Rejected on the same grounds as the content
  model: a template is code, it goes through review, and it lands in git.
