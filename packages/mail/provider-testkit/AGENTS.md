# @orthacms/mail-provider-testkit

Captures messages in memory instead of sending them, and can be told to fail —
retryably or permanently — so the worker's backoff and its dead-letter path are
exercisable without a mail server. The counterpart of
`@orthacms/media-provider-testkit`, installed under the same rule as the console
adapter: shipped with every app, offered by no picker, registered by no
template.

```ts
const provider = createTestkitMailProvider();
provider.failNext(1, 'connection refused'); // retryable: the row backs off
provider.failPermanently('550 unknown recipient'); // stops the row at once
provider.sent; // what was actually handed over, oldest first
```

A permanent rejection captures **nothing**: the message was never handed over,
and a test asserting on `sent` should not see one that does not exist.

`apps/server-e2e/src/support/mail.ts` holds the single instance the e2e harness
boots with — module-scoped, because the plugin takes one constructed provider
and a suite needs the same object the app is holding.
