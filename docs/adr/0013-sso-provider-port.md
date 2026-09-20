# 0013 — SSO is a provider port, and the core owns the handshake

- **Status:** Accepted
- **Date:** 2026-08-23
- **Deciders:** Engineering

> The feature this decision serves is described in
> [`docs/design/sso.md`](../design/sso.md). This ADR settles only *how Ortha
> reaches an external identity provider, and what it may do with the person it
> gets back*.

## Context

Operators want their staff to sign in to the admin with the directory they
already run — Google Workspace, Entra ID, Okta, Auth0, Keycloak — and enterprise
buyers ask for SAML on top of that.

Ortha is self-hosted, so the same force that produced
[ADR-0004](0004-model-agnostic-copilot-provider.md) applies: we do not know
which IdP an operator runs, we cannot ask them to fork to add one, and a
deployment must be able to run the whole login flow in CI with no network and no
tenant.

Two things about the existing identity plugin constrain the design more than the
protocols do:

- **Ortha is invite-only.** There is no public registration; the only route into
  an account is an admin's invite. An SSO login that provisions accounts changes
  that property of the product, and does so silently if it is a default.
- **Sessions and one-time tokens are opaque values checked against a row**, not
  signed blobs. `IdentityPluginConfig` documents the absence of a signing secret
  as a decision, not an omission — a previous inert `sessionSecret` gave
  operators a rotation runbook that did nothing.

And the hard parts of SSO are not protocol parsing. They are `state`, `nonce`
and PKCE; whether a verified email may claim an existing account; whether an IdP
group may overwrite a role an admin set; and what happens to a live session when
the IdP disables the person holding it.

## Decision

We will treat an identity provider as a **replaceable backend behind a port**,
structurally identical to the model provider and the storage provider — and we
will keep every security-critical step of the handshake in the core.

1. **The core depends on an interface, never a vendor.** `SsoProvider` is
   declared in a new framework-free package, `@orthacms/identity-domain`:
   `authorize(request)` returning a redirect, and `complete(callback)` returning
   a verified, normalised `SsoProfile`. No protocol library may be imported by
   `identity/domain` or `identity/server`. Adapters may depend on one —
   `openid-client`, `jose` — on the same terms `copilot-provider-anthropic`
   depends on `@anthropic-ai/sdk`.

2. **The core generates `state`, `nonce` and the PKCE verifier**, persists them
   in an `sso_auth_requests` row keyed by an opaque token, and hands them to the
   adapter. Adapters do not mint them. CSRF and replay defence is one rule
   implemented once, not three times with three chances to differ — the same
   call as `resolveModel` living in `copilot-domain`.

3. **Handshake state is a row, not a signed cookie.** The browser holds an
   opaque request id; the row holds everything else and is consumed by the same
   conditional `UPDATE … WHERE consumed_at IS NULL RETURNING` the invite and
   reset flows use. This introduces no signing secret, no rotation procedure,
   and no new answer to "what does a database backup now contain".

4. **Three clauses bind every adapter**, because the core cannot verify any of
   them for itself: `complete` verifies signature, issuer, audience, `nonce` and
   expiry or throws; `subject` is stable, issuer-scoped and never the email; and
   `emailVerified` reports what the IdP claimed rather than a convenient
   default.

5. **SSO authenticates; it does not, by default, provision.** An SSO login may
   sign in an `active` account it is already linked to, and may link to an
   `active` account when the IdP asserts a verified matching email. It creates
   no accounts and touches no roles unless the host explicitly opts in —
   `provisioning: 'jit'` with a required email-domain allow-list, and a
   `resolveRole` handler for group mapping. Both are off in a default install.

6. **The composition root registers the providers**, by name and
   already-constructed, exactly as `CopilotPlugin` and `MediaServerPlugin` do.
   An empty list means SSO is not mounted.

## Consequences

**Easier:**

- An operator adds an IdP by configuring one, with no fork and no redeploy of
  the identity packages.
- CI runs the full redirect handshake deterministically against a shipped fake
  adapter, with no tenant and no network.
- One generic OIDC adapter covers most of the market; the named vendors are
  presets over it rather than packages of their own, because the wire is
  identical. SAML and GitHub, whose wires are not, get their own packages —
  which is why `kind` and `callbackMethod` are in the descriptor from the start.

**Harder / the cost we accept:**

- **A second way into an account.** Every rule that protected the password path
  — `disabled` accounts stay locked out, credential changes evict sessions —
  now has to be enforced on a second path, and tested there.
- **A new package on identity's critical path.** `@orthacms/identity-domain`
  exists so an adapter need not depend on Nest and Drizzle. Identity's public
  barrel stays untouched, but the workspace gains a package that
  `create-ortha-app`'s coverage guard will require a decision about.
- **Offboarding is not instant, and we must say so.** A session is a row with a
  TTL; an IdP disabling someone does not reach it. Until back-channel logout
  exists, the honest answer is `SESSION_TTL_SECONDS`.
- **`cookieSameSite: 'strict'` becomes incompatible** with SSO, and the plugin
  must refuse to boot in that combination rather than serve a login that cannot
  succeed.

**What this rules out:** importing a protocol library into `identity/domain` or
`identity/server`; letting an adapter mint its own `state` or `nonce`; keying an
identity link on an email address; and provisioning accounts from an IdP by
default.

## Alternatives considered

- **Use an off-the-shelf auth framework** (Passport, Auth.js, Keycloak as the
  only front door). Rejected: each brings its own session and user model, and
  Ortha already has both — opaque revocable session rows, a global role per
  user, and an invite lifecycle. Adopting one would mean reconciling two
  identity models forever, for a surface that is one file plus adapters.
- **Ship only a generic OIDC adapter, with no port.** Tempting, since nearly
  every IdP speaks OIDC. Rejected: GitHub does not, SAML does not, and the
  absence of a port would put "verify the token" inside the plugin where a
  second protocol cannot join it.
- **Keep the handshake state in a signed cookie.** Fewer moving parts and no
  table. Rejected: it reintroduces exactly the signing secret this codebase
  removed on purpose, and it makes a stuck login unobservable.
- **Provision accounts on first login by default.** The usual behaviour
  elsewhere, and what most operators expect. Rejected as a *default*: an OIDC
  client with no domain restriction turns "sign in with Google" into "the
  internet has an account here", and the failure is silent until someone reads
  the user list.
