# @orthacms/identity-provider-saml

SAML 2.0 — HTTP-Redirect for the request, HTTP-POST for the response.

**This package is why `callbackMethod` is in the port's descriptor from the
first release.** SAML's response is not a redirect: the identity provider
returns the person by POSTing a form to the callback. The adapter declares
`'POST'`, the plugin mounts the route that serves it, and nothing about the seam
had to change to add a second protocol shape — which was the whole bet
[ADR-0013](../../../docs/adr/0013-sso-provider-port.md) made.

## `@node-saml/node-saml` does the XML

Canonicalisation, signature validation and the conditions checks are its job.
That is a deliberate dependency: XML signature validation has a long history of
wrapping attacks that turn on parser details, and it is not a place to
demonstrate independence. ADR-0013 permits it here for exactly this reason and
forbids it in `identity-domain` and `identity-server`.

What **this** package owns is everything the library has no opinion about, and
that is where the interesting mistakes live.

## The decisions

- **`RelayState` is where `state` travels.** SAML has no nonce and no PKCE, so
  the core-minted `RelayState` is the only thing tying a response to an attempt.
  It is checked before anything is parsed.
- **`emailVerified` is always an operator's assertion.** **SAML carries no
  verification claim at all** — no assertion has the equivalent of
  `email_verified`, so there is nothing an adapter could read and be honest
  about. It defaults to `false`, which means a first sign-in cannot claim an
  existing account until someone sets it. That is usually true of a corporate
  IdP and is still not something to assume on their behalf.
- **A transient NameID is refused.** It is a different value on every sign-in —
  that is its entire purpose — so keying a link on one would mint a new link,
  and under provisioning a new account, every single time.
- **A NameID that is an email address is refused, with the fix named.** The core
  refuses it too, but a blank "sign-in did not complete" tells an operator
  nothing; the message here says to configure a persistent NameID or point
  `subjectAttribute` at an immutable directory id.
- **Attribute names are configuration with sensible fallbacks.** SAML attribute
  naming differs per identity provider more than anything else about it does, so
  the adapter tries the four common spellings for an address and the four for a
  display name, and takes an explicit name when given one.
- **A single group arrives as a string and several as an array** — the same
  attribute, two shapes, depending on how many groups the person is in.
  Normalised here; anything else is dropped rather than guessed at, because a
  role-mapping handler acts on it.
- **`validateInResponseTo` is off.** The core already guarantees one-time use —
  the attempt row is burned before anything is exchanged. A second, in-memory,
  per-process store on top would be the one that decides, since it runs first,
  and it is the one a multi-instance deployment gets wrong.
- **`logoutUrl` answers `null` on purpose.** SAML single logout is its own
  signed, bidirectional exchange, not a URL to redirect to; answering with one
  would send people somewhere that turns them away.

## Tests

The fixtures are **really signed**, with a self-signed certificate generated per
run and `xml-crypto` producing enveloped signatures over the assertion and then
the response — in that order, because an outer signature has to cover the inner
one. That is what lets "an assertion signed by a key the deployment does not
trust is refused" be a test rather than a claim.

`conformance.spec.ts` runs the shared kit, and this is the adapter that stretches
it furthest: a POST callback, no nonce, no PKCE, no JSON anywhere, and a refusal
that arrives as a signed status code rather than a query parameter.

**The kit caught a real bug here.** The first version of the refusal fixture
carried a `Responder` status *and* a signed assertion, and the adapter signed the
person in. A real identity provider never sends that shape — a refusal has
nobody to assert anything about — so the fixture was wrong; but the check is the
reason anyone found out.

## Package

- Name: `@orthacms/identity-provider-saml`
- Import: `import { createSamlProvider } from '@orthacms/identity-provider-saml'`
- Depends on `@orthacms/identity-domain` and `@node-saml/node-saml`.
