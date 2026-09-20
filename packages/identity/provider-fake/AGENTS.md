# @orthacms/identity-provider-fake

A **scripted identity provider**: no network, no tenant, no clock skew, the same
answer every run.

**Shipped, not test scaffolding** (ADR-0013): it is how `apps/server-e2e` drives
the _entire_ SSO redirect handshake in CI, and how a contributor exercises the
sign-in page with no identity provider to hand. A deployment that registers it
gets a working SSO button that signs in whoever the composition root scripted —
which is why no host registers it, and why shipping it is harmless in a way the
copilot's scripted adapter was not. That one was registered unconditionally and
last, making it the whole catalogue of a deployment with no key; it is a private
test fixture now (ADR-0004 §3).

## It really verifies

The temptation with a fake is a stub that always says yes. That would make the
conformance kit vacuous on the one adapter that runs in every CI job, so this
one does the real shape of the work:

- `authorize` scripts a response and **signs** it;
- `complete` re-derives that signature, checks `state`, checks that the echoed
  `nonce` is the one the core stored, and decodes the subject.

Each check raises its own `SsoVerificationError`, so the kit's rejection
scenarios exercise distinct code paths rather than one shared `throw`.

**The signature covers `code` and `state`, never the nonce.** That is what lets
a replayed-nonce scenario be told apart from a tampered one: change the nonce
and the signature still verifies, so the refusal comes from the nonce check that
is actually under test.

It also puts the PKCE **challenge** in the authorization URL and never the
verifier — the conformance kit checks exactly that, so including the challenge
is what makes the check meaningful.

## Driving it

```typescript
const idp = createFakeSsoProvider({
    users: [
        { subject: 'idp-ada', email: 'ada@example.com', name: 'Ada' },
        {
            subject: 'idp-grace',
            email: 'grace@example.com',
            emailVerified: false
        }
    ]
});

idp.signInAs('idp-grace'); // who the NEXT authorize hands back
idp.failNextVerification(); // the next complete refuses, once
idp.calls(); // { authorize, complete } — assert none was made
```

`signInAs` throws for a subject the provider was not configured with, so a typo
in a suite fails where it was written rather than as a puzzling verification
error one call later.

## Package

- Name: `@orthacms/identity-provider-fake`
- Import: `import { createFakeSsoProvider } from '@orthacms/identity-provider-fake'`
- Depends only on `@orthacms/identity-domain` (the port) and `node:crypto`.
