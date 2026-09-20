# @orthacms/identity-domain

The **framework-free core of identity's SSO seam**: the `SsoProvider` port, the
normalised `SsoProfile`, the errors both sides speak, the open-redirect guard,
and the conformance kit every adapter must pass.

It exists as its own package for one reason: an adapter
(`@orthacms/identity-provider-oidc`, `…-fake`, later `…-github` / `…-saml`)
must be able to depend on the port **without** depending on
`@orthacms/identity-server` — which would drag in NestJS, Drizzle, bcrypt and
the 108 import sites that pin identity's public barrel. This is the same split
`@orthacms/copilot-domain` makes for `ModelProvider`, for the same reason
([ADR-0013](../../../docs/adr/0013-sso-provider-port.md) §1).

## The one hard rule

**This package imports nothing.** No `@nestjs/*`, no `drizzle-orm`, no
`class-validator`, no `openid-client`, no `jose` — its `package.json` has no
`dependencies` key at all, and that is deliberate rather than an oversight. Node
built-ins only, and today not even those. If a change here needs a dependency,
the change belongs in the server plugin or in an adapter.

## What lives here

```
src/lib/sso/
  sso-provider.ts     # the port: descriptor / authorize / complete / logoutUrl
  sso-profile.ts      # SsoProfile + assertSsoProfile + normalizeSsoProfile
  redirect-target.ts  # safeRedirectPath — the open-redirect guard
  conformance.ts      # the kit every adapter runs in its own test suite
  errors/             # SsoVerificationError, UnknownSsoProviderError
```

### The three clauses

`SsoProvider` states three obligations that the core has no way to verify for
itself, and the conformance kit is what turns them from prose into tests:

1. **`complete` verifies, or it throws.** From the outside a decoded profile and
   a verified one are the same object, so an adapter that skips verification
   produces a sign-in that looks entirely normal.
2. **`subject` is stable, issuer-scoped, and never the email.**
   `assertSsoProfile` refuses the specific mistake — a subject equal to the
   email — because the link table keys on it.
3. **`emailVerified` reports what the provider claimed.** It is the only gate on
   claiming an account that already exists.

### Why the core mints `state`, `nonce` and the PKCE verifier

They arrive in `SsoAuthorizeRequest` and come back in `SsoCallback`; adapters
generate none of them. CSRF and replay defence is one rule, and implementing it
once where it can be tested once beats implementing it per adapter with a fresh
chance to differ — the same call as `resolveModel` living in `copilot-domain`
rather than in three model adapters.

One conformance check follows directly from this: **`authorize` must not put the
code verifier in the URL.** Only its `S256` challenge belongs there. An adapter
that passes the verifier itself hands the browser — and every log between here
and the provider — the one value PKCE exists to withhold.

### `safeRedirectPath`

An open redirect on a sign-in route is the most commonly botched rule in this
feature, so the check is a pure function with its own spec rather than three
lines inside a controller. It accepts a same-origin absolute path and nothing
else; `//host`, backslashes, control characters and absolute URLs all fall back.

## Package

- Name: `@orthacms/identity-domain`
- Import: `import type { SsoProvider } from '@orthacms/identity-domain'`
- Grouped package (`packages/identity/domain`), consumed from source like the
  rest of the workspace (`exports` → `./src/index.ts`,
  `customConditions: ["@orthacms/source"]`).
