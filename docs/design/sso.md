# SSO — design

Signing in to the admin with an identity the operator already runs: Google
Workspace, Entra ID, Okta, Auth0, Keycloak — and, later, SAML. The person still
gets an Ortha account with an Ortha role; what changes is who checks the
credential.

**Status:** proposed. Nothing is built. This document is the plan, and the
decision it depends on is drafted as
[ADR-0013](../adr/0013-sso-provider-port.md).

---

## 1. What we should do first

**Not an OIDC client.** The first slice is the _seam_ — the port, the link
table, the redirect routes and a deterministic fake adapter — with account
resolution restricted to accounts that already exist. A real IdP is the second
slice, and it is small once the seam is right.

The reason is that every hard question in SSO is an **authority** question, not
a protocol one: who may get an account, what role they land on, what happens
when the IdP disables someone, and whether a password is still allowed. Those
answers shape the schema and the port. Writing an OIDC client first means
answering them later, under a migration.

So phase 0 is:

1. **ADR-0013** — the port, and the authority rules that go with it.
2. **`@orthacms/identity-domain`** — a new framework-free package holding the
   `SsoProvider` port, exactly as `@orthacms/copilot-domain` holds
   `ModelProvider`. It has to be its own package: an adapter must be able to
   depend on the port without dragging in Nest, Drizzle and identity's 108
   import sites.
3. **`@orthacms/identity-provider-fake`** — scripted, deterministic, no network.
   It is how `server-e2e` drives the whole redirect dance in CI and how a
   contributor exercises the login page offline. Unlike the copilot's scripted
   adapter it is not registered by any host, and never was: a scripted identity
   provider in a running deployment signs people in without anyone
   authenticating. (`copilot-provider-fake` was once shipped on those terms and
   is now a private test fixture too — see
   [ADR-0004](../adr/0004-model-agnostic-copilot-provider.md) §3.)
4. **Two tables + a migration** in `identity/server` — `sso_identities` and
   `sso_auth_requests`.
5. **Three routes** — list, start, callback — issuing the _existing_ session
   cookie through the _existing_ `CookieService`.
6. **One account rule**: an SSO login may only sign in a user who already
   exists and is `active`. It creates nobody. Provisioning is phase 2.

That last point is what keeps phase 0 small and safe. Ortha is invite-only by
design; phase 0 keeps it invite-only and replaces only the _credential check_.
A deployment that turns SSO on gets "our staff sign in with Google" without
also getting "anyone with a Google account has an account here".

## 2. What the codebase already gives us

Four facts shape the design, and all four are load-bearing:

- **Sessions are rows, not signed blobs.** `IdentityPluginConfig`'s own comment
  is explicit that there is no signing secret and that revocation is a delete.
  So SSO must not introduce one either — the `state`/`nonce`/PKCE verifier go in
  a table keyed by an opaque token, not into a signed cookie. No new key to
  configure, no rotation runbook, and a stuck login is a row you can look at.
- **The one-time-token pattern is already correct.** `DrizzleInviteRepository.consume`
  is a conditional `UPDATE … WHERE consumed_at IS NULL RETURNING`, so a link
  can never be redeemed twice. An auth request is the same shape, and should
  reuse it rather than re-derive it.
- **A provider registry precedent, twice over.** `MediaServerPlugin` and
  `CopilotPlugin` both take named, already-constructed adapters from the
  composition root, with an optional `resolve` handler. SSO is the third
  instance and should not invent a fourth shape.
- **Roles are global and seeded.** A user holds exactly one role
  (`users.role_id`), and `admin`/`contributor`/`viewer` are seeded idempotently.
  Group-to-role mapping therefore has somewhere to land, but it has to answer
  "does the IdP win over an admin's edit?" — see §5.

## 3. The one interface

`ModelProvider` normalises two wire formats into one event vocabulary so the
engine never branches per vendor. `SsoProvider` does the same job for a redirect
handshake: the core owns every security-critical step, the adapter owns the
protocol.

```ts
/** What the login page renders, without a round trip. */
export interface SsoProviderDescriptor {
    kind: 'oidc' | 'oauth2' | 'saml';
    label: string;
    /** How the IdP returns the user. SAML POSTs; OIDC redirects. */
    callbackMethod: 'GET' | 'POST';
}

export interface SsoProvider {
    descriptor(): SsoProviderDescriptor;
    authorize(request: SsoAuthorizeRequest): Promise<SsoAuthorizeRedirect>;
    complete(callback: SsoCallback): Promise<SsoProfile>;
    /** RP-initiated logout, when the IdP supports one. */
    logoutUrl?(request: SsoLogoutRequest): string | null;
}
```

Three clauses bind every adapter, in the spirit of `ModelProvider.stream`'s
three — each one is something the core cannot check for itself:

1. **`complete` verifies, or it throws.** Signature, issuer, audience, `nonce`
   and expiry are checked inside the adapter, and any failure raises
   `SsoVerificationError`. An adapter must never return a profile it did not
   verify: the core has no way to tell a verified profile from a decoded one.
2. **`subject` is stable and issuer-scoped, and is never the email.** People
   change email addresses; a link keyed on email silently hands an account to
   whoever inherits the address. `sso_identities` is unique on
   `(provider, subject)` for this reason.
3. **`emailVerified` reports what the IdP actually claimed.** It is the sole
   gate on linking to an existing account, so an adapter that defaults it to
   `true` converts "sign in with a work Google account" into "sign in with any
   account that types the right address".

**The core generates `state`, `nonce` and the PKCE verifier, not the adapter.**
They arrive in `SsoAuthorizeRequest` and come back in `SsoCallback`. This is the
same call as putting `resolveModel` in `copilot-domain` instead of in three
adapters: CSRF and replay defence is one rule, and it should be implemented once
where it can be tested once, not re-implemented per vendor with three chances to
get it wrong.

Registration mirrors the copilot exactly, and a provider is present only when it
was configured:

```ts
IdentityPlugin({
    ...config.plugins.identity,
    sso: {
        providers: [
            { name: 'google', provider: createOidcProvider({ … }) },
            { name: 'entra',  provider: createEntraProvider({ … }) }
        ]
    }
});
```

An empty list means SSO is not mounted at all — no routes, no buttons on the
login page.

## 4. The handshake, and what it stores

```
GET  /api/auth/sso                        → [{ name, label, kind }]   @Public
GET  /api/auth/sso/:provider/start        → 302 to the IdP            @Public
GET  /api/auth/sso/:provider/callback     → 302 into the admin        @Public
```

`start` writes an `sso_auth_requests` row (`state`, `nonce`, `code_verifier`,
`redirect_to`, `expires_at`, `consumed_at`) and sets a short-lived `httpOnly`
cookie holding the opaque request id. `callback` consumes that row with the
conditional update, calls `provider.complete`, resolves the account, and opens a
session with the existing `CookieService.setSession`.

Two notes that will otherwise be discovered the hard way:

- **`OriginGuard` cannot protect the callback.** It is a top-level GET arriving
  from a third party with no `Origin` header. `state` plus PKCE is the defence
  there, which is precisely why the core owns generating them.
- **`cookieSameSite: 'strict'` breaks SSO.** A strict cookie is not sent on the
  IdP's cross-site redirect, so the request row can never be found and every
  login fails with a generic error. The plugin should refuse to boot with SSO
  providers registered and `strict` configured, rather than serve a login that
  cannot succeed.

New tables, both owned by `identity/server` and shipped in its `migrations/`:

| Table               | Purpose                               | Key constraint                                             |
| ------------------- | ------------------------------------- | ---------------------------------------------------------- |
| `sso_identities`    | Links an Ortha user to an IdP subject | unique `(provider, subject)`; unique `(provider, user_id)` |
| `sso_auth_requests` | In-flight handshake state             | one-time `consumed_at`, short `expires_at`                 |

## 5. Decisions to settle in the ADR

These are the reason the ADR comes before the code.

| Question                       | Recommendation                                                                                                                                                        | Why                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can SSO create accounts?       | Not in phase 0. Opt-in `provisioning: 'jit'` in phase 2, with a required email-domain allow-list.                                                                     | A Google OIDC client with no domain restriction means every Google account on earth can sign in. The allow-list should be required, not defaulted. |
| Linking to an existing account | Only when `emailVerified` is true and the account is `active`. Never to `pending` or `disabled`.                                                                      | Linking to a `disabled` account reopens a door an admin closed — the same rule the password-reset flow already applies.                            |
| Do IdP groups set the role?    | Only if the host supplies a `resolveRole` handler. Otherwise the admin's setting stands.                                                                              | Silent role rewrites on every login would undo admin edits with no audit trail. Make it an explicit opt-in, and record it.                         |
| Can passwords be turned off?   | Yes, `allowPasswordLogin: false` — but the root admin keeps a break-glass path.                                                                                       | An operator who mis-scopes their IdP and disabled passwords has locked themselves out of their own CMS with no recovery.                           |
| Offboarding                    | Say plainly that a disabled IdP user keeps their Ortha session for up to `SESSION_TTL_SECONDS`. Offer a shorter TTL for SSO sessions; back-channel logout is phase 3. | Operators buy SSO expecting instant offboarding. Left unsaid, this is a security surprise rather than a documented limit.                          |

## 6. Providers, in the order they earn their keep

The copilot ships a package per vendor because the SDKs genuinely differ. SSO
diverges here on purpose: **the wire is the same**, so most vendors are a
preset, not a package.

- **Generic OIDC** — `@orthacms/identity-provider-oidc`. One adapter covering
  Okta, Auth0, Keycloak, Google, Entra ID, Authentik, Zitadel, JumpCloud, Ping
  and GitLab through discovery + JWKS. This is the SSO equivalent of the
  copilot's OpenAI-compatible adapter, and it is the highest-leverage thing to
  build after the seam.
- **Named presets in that same package** — `createGoogleProvider`,
  `createEntraProvider`, `createOktaProvider`, `createAuth0Provider`,
  `createKeycloakProvider`. Each is issuer URL, scopes and claim mapping, and
  each exists so an operator writes a tenant id instead of assembling five URLs
  by hand.
- **GitHub** — its own package. GitHub OAuth is not OIDC: there is no
  `id_token`, so verification means calling `/user` and `/user/emails` rather
  than validating a JWT. The port already accommodates it, because `complete`
  returns a profile and does not promise how it was obtained.
- **SAML 2.0** — its own package, phase 3, and the reason `callbackMethod` and
  `kind` are in the descriptor from day one. SAML arrives as a POSTed
  `SAMLResponse` with `RelayState` instead of `state`, plus IdP-initiated flows
  and metadata exchange. Enterprise buyers ask for it; designing the port as if
  it did not exist would force a rewrite of the port rather than an addition to
  it.
- **`fake`** — the deterministic one, shipped, built first.

**Adapters may use a vetted library.** `provider-anthropic` depends on
`@anthropic-ai/sdk`; an OIDC adapter should depend on `openid-client` / `jose`
on exactly the same terms. The rule is that no such dependency reaches
`identity-domain` or `identity-server`. Hand-rolling JWT and JWKS validation is
not a place to demonstrate independence.

## 7. Phases

- **Phase 0 — the seam.** ADR-0013, `identity-domain`, `identity-provider-fake`,
  both tables, the three routes, link-only account resolution, a `server-e2e`
  suite driving the full redirect dance offline. _Done when_ a fake IdP signs an
  existing user in and the resulting session is indistinguishable from a
  password login.
- **Phase 1 — a real IdP.** The generic OIDC adapter plus the five presets,
  discovery and JWKS caching with rotation, and the provider buttons on the
  login page. _Done when_ a Keycloak in `docker-compose` signs a seeded user in.
- **Phase 2 — authority.** JIT provisioning behind a domain allow-list, the
  `resolveRole` handler, the admin's SSO settings view, and `auth.sso_signed_in`
  / `user.sso_linked` through the existing outbox so the activity log tells the
  truth. _Done when_ the audit trail distinguishes a provisioned account from an
  invited one.
- **Phase 3 — the long tail.** GitHub, SAML, back-channel logout and an
  SSO-specific session TTL.

## 8. Ripples outside identity

- `create-ortha-app/src/lib/features.ts` must classify every new package, and
  `features.spec.ts` fails until it does. An "SSO providers" wizard group,
  defaulting to none, matches how the copilot backends are asked about.
- `ortha.config.ts` gains an `sso` block under `plugins.identity`, with each
  provider key present only when its settings are — the same rule the copilot
  providers follow, and for the same reason.
- The login page needs the provider list _before_ anyone is authenticated, so
  `GET /api/auth/sso` is `@Public()` and must not leak whether a given email is
  known to any IdP.
- The `redirect` parameter on `start` must be validated as a relative path
  against an allow-list. An open redirect on a login route is the most common
  bug in this entire feature.
