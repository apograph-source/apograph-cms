# @orthacms/mail-provider-console

Writes every message to the log instead of sending it, so a development install
can read an invitation link without a mail server.

**Installed unconditionally, offered by no picker, registered by no template** —
the `identity-provider-fake` pattern (ADR-0018 §6), and for a sharper reason
than usual. A scripted adapter that reached a real deployment would not fail
loudly: with a provider configured the API stops returning the link, so
invitations would appear to be sent and nobody would receive anything. ORT-148
records the same mistake with a copilot attached, where at least the wrong
answers were visible.

It declares `verifiable: false` and implements no `verify()`, which is the
honest pair: there is nothing to reach, and a boot check that always passes
proves nothing.

`includeBody: false` keeps the link out of the log for a deployment that wants
the trace without the secret — the console adapter's one genuine production-ish
use, and still not a way to deliver mail.
