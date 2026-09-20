# @orthacms/identity-provider-oidc

The **generic OpenID Connect adapter**: authorization code flow, PKCE, and
identity tokens verified against the provider's published keys. Plus five thin
presets for the vendors people actually name.

One adapter covers most of the market — Okta, Auth0, Keycloak, Google, Entra ID,
Authentik, Zitadel, JumpCloud, Ping and GitLab all speak this. It is the SSO
equivalent of the copilot's OpenAI-compatible adapter, and it is the highest-
leverage thing in the whole feature after the seam itself.

## Why this is one package and not five

The copilot ships a package per vendor because the **SDKs** differ. Here the
**wire** does not: every provider above answers the same discovery document and
the same token endpoint, so a vendor is issuer + scopes + claim mapping. That is
a preset — `createGoogleProvider`, `createEntraProvider`, `createOktaProvider`,
`createAuth0Provider`, `createKeycloakProvider` — not a package.

GitHub and SAML are the exceptions that prove it: GitHub is OAuth2 with no
identity token, SAML is a POST binding with XML signatures. Those get their own
packages, which is why `kind` and `callbackMethod` are in the port's descriptor
from the first release.

## `jose` does the cryptography

`createRemoteJWKSet` caches the provider's keys, refetches on an unknown `kid`
(how key rotation is survived without a restart), and rate-limits that refetch —
which is what stops a stream of tokens bearing invented `kid`s from turning this
CMS into a load generator pointed at someone else's identity provider.

Hand-rolling JWT and JWKS validation is not where to demonstrate independence.
[ADR-0013](../../../docs/adr/0013-sso-provider-port.md) permits the dependency
**here** for exactly this reason, and forbids it in `identity-domain` and
`identity-server`.

Two notes on the dependency:

- **`jose` v6 is ESM-only.** Node 22 can `require()` it, so the Nest build is
  fine, but Jest resolves through its own registry and needs the package
  transformed — hence this package's `transformIgnorePatterns`, the one
  exception to "never transform `node_modules`".
- **JWKS fetching goes through the injected `fetch`** (`jose`'s `customFetch`).
  Without it, key fetching would quietly bypass a configured HTTP proxy while
  discovery and the token exchange honoured it — the kind of split that works
  everywhere except the one deployment that needed it.

## Decisions worth knowing before changing anything here

- **Reserved authorization parameters cannot be overridden.**
  `authorizationParams` is for a provider's own knobs (`hd`, `prompt`, `idp`).
  `state`, `nonce`, `code_challenge`, `redirect_uri`, `response_type`,
  `client_id` and `scope` are refused, loudly, at `authorize` time. Every one of
  them is either a security control the core owns or the thing that decides
  which flow runs — a typo that replaced one would not fail, it would produce a
  sign-in that works and is not protected.
- **The issuer is compared byte for byte**, in the discovery document and again
  on every token. Auth0 issues with a trailing slash; its preset keeps it, and
  omitting it is the single most common way to get a working discovery document
  and a token that will not verify.
- **The discovery path is appended to the issuer's path**, not to its origin.
  `https://sso.acme.com/realms/ortha` discovers at `…/realms/ortha/.well-known/…`.
  Treating an issuer as a bare origin is how this works against Google and fails
  against Keycloak, Auth0 custom domains, and every multi-tenant provider.
- **A failed discovery is never cached.** Caching it would turn a transient
  outage into a fixed window in which every sign-in fails for a reason that has
  already gone away. A successful one is cached, and concurrent first sign-ins
  share a single in-flight request.
- **The nonce is checked here, not by `jwtVerify`.** It is not a property of the
  token — it is the link between this token and the attempt the browser started.
  Without the check, a token captured from another attempt, validly signed and
  unexpired, would be accepted.
- **`emailVerifiedWhenAbsent` is an operator's assertion, never a default.**
  Microsoft Entra ID simply never emits `email_verified`, so a first sign-in
  cannot claim an existing account until someone says that this directory is
  authoritative for the addresses it reports. That is usually true of a
  corporate tenant; it is not something an adapter may decide. A provider that
  sends `email_verified: false` is believed regardless of this setting.
- **Groups are read only when a deployment names the claim.** A claim nobody
  asked for should not be collected, and — once role mapping exists — a claim
  that is never sent reads as "this person is in no groups", which a mapping
  handler would quietly act on.

## Tests

`conformance.spec.ts` runs the shared kit from `@orthacms/identity-domain`
against a stubbed provider that **signs real tokens** with a generated key pair.
That is what makes the tampering case mean something: the "tampered" scenario is
a token signed by a key the provider does not publish, and it fails because
`jose` checks a signature — not because a flag says so.

The same kit runs against `identity-provider-fake`. Two adapters with nothing in
common but the port, held to one contract.

## Package

- Name: `@orthacms/identity-provider-oidc`
- Import: `import { createOidcProvider, createKeycloakProvider } from '@orthacms/identity-provider-oidc'`
- Depends on `@orthacms/identity-domain` (the port) and `jose`.
