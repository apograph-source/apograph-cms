# @apograph/mail-domain

The framework-free kernel behind outgoing mail: **two ports**, the copy between
them, and the retry schedule. No NestJS, no Drizzle, no vendor SDK — and, by a
test, **no dependencies at all** (`package-manifest.spec.ts`). That rule is the
package's reason to exist: `npm i @apograph/mail-provider-smtp` should install
an SMTP client, not a web framework. `@apograph/media-domain` holds the same
line for the same reason.

## What is here

| File                 | What it holds                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mail-provider.ts`   | The `MailProvider` port every adapter implements — `id`, declared `capabilities`, `send`, optional `verify` — plus `MailMessage`, `MailReceipt` and `MailPermanentError`. |
| `mail-dispatcher.ts` | The `MailDispatcher` port a use case queues through, `MAIL_KINDS`, and the `TransactionalMail` it takes.                                                                  |
| `links.ts`           | Where a message's links point, built from configured `appUrl` and never from a request header.                                                                            |
| `templates.ts`       | The three templates and the `MailTemplates` map a host may override.                                                                                                      |
| `retry-policy.ts`    | The backoff schedule and the attempt budget.                                                                                                                              |

## The decisions that live here

**The retryable/permanent split is the provider's judgement**, and part of the
contract rather than a convenience: without it a typo in an address consumes the
whole attempt budget over twenty minutes and lands in the dead letters beside a
real outage, where an operator cannot tell the two apart. An adapter rejects
with `MailPermanentError` for a failure that will never succeed and with
anything else for one that might.

**`text` is mandatory and `html` optional, in that order.** A plain-text part
always renders, and for a message whose entire content is one link, HTML is
decoration.

**Links come from `appUrl`.** Never from the `Host` header, which the caller
controls: an attacker-set host turns an invitation from your own domain into a
phishing link, and an invitation is the one message a recipient is certain to
click (ADR-0018 §5). `assertAppUrl` refuses a relative, non-HTTP or
query-carrying value at construction, not at send time.

**`MAIL_KINDS` lists only what something can actually produce.** The
self-service `password_recovery` message is phase 2 of ADR-0018 and is
deliberately absent: a kind with a template and no producer is a branch nobody
executes.

**Templates are English, and the gap is named rather than papered over.**
`users` has no locale column and the server has no i18n (ORT-113 records the
same gap for the copilot's user-facing text). The override hook in
`MailPluginConfig.templates` is what a deployment needing another language uses
meanwhile — templates are code, reviewed, in git, on the same grounds the
content model is.

## The two ports, and why there are two

`MailProvider` is the **outward** seam: one implementation per deployment,
constructed at the composition root. `MailDispatcher` is the **inward** one:
`users-server` injects it `@Optional()` so a use case that has just minted a
token can get a message queued **inside its own transaction** without depending
on the mail plugin. A deployment that configured no provider binds nothing, and
that absence is the switch ADR-0018 §4 reads — the invite and reset routes keep
returning the raw token exactly as they always have.

## Working here

- Adding a message kind: a `MAIL_KINDS` entry, a template, and the use case that
  raises it. All three, or none — see above.
- Changing copy is a code change like any other. There is no template editor and
  no plan for one.
- The design document is [`docs/design/mail.md`](../../../docs/design/mail.md);
  the decision is [ADR-0018](../../../docs/adr/0018-mail-provider.md).
