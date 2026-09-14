# @apograph/mail-provider-smtp

The SMTP mail adapter, over `nodemailer`. **The default answer, not a
fallback**: Resend, SES, Postmark, SendGrid, Mailgun, Google Workspace,
Microsoft 365 and every relay inside a perimeter speak SMTP, so for a
self-hosted product one adapter covers the market. A vendor HTTP adapter earns
its own package when the wire genuinely differs (ADR-0018), which is why
`mail-provider-resend` is a phase-2 package and not a preset here.

## What it decides

**Which failures are permanent** (`smtp-error.ts`). A 5xx reply, or nodemailer's
`EENVELOPE` / `EMESSAGE`, means the relay refused the envelope or the message
itself and will refuse it again — the row stops at once, with its attempt budget
untouched. Everything else is retryable, and that deliberately includes `EAUTH`:
bad credentials are a property of the deployment, not of this message, and a
rotation that flaps for a minute should not kill every queued invitation at
once. It dead-letters through the ordinary budget instead, which is where an
operator is looking.

**What `last_error` says.** The relay's own reply text (`550 5.1.1 recipient
rejected`) is the useful half, so it is preferred over a generic message
wherever nodemailer carries one.

**What refuses construction**: no host, a port that is not a TCP port, and a
password with no user — which is almost always a half-filled environment, and
would otherwise connect unauthenticated and be refused with no hint as to why.

## Testing it

`SmtpMailProviderOptions.transport` takes a double. It is typed as the local
`SmtpTransport` (the two methods this adapter uses) rather than
`Pick<Transporter, …>`: nodemailer's own type is generic over the transport's
result and carries a dozen overloads, so a double satisfying it is a page of
casts — and this is the seam a test has to replace, since the alternative is
standing up an SMTP server to assert that a subject line was passed through.
