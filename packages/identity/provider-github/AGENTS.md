# @orthacms/identity-provider-github

GitHub sign-in — github.com and GitHub Enterprise Server.

**Its own package because GitHub is not OpenID Connect.** There is no identity
token, so "verify" cannot mean "check a signature": it means spending the
authorization code for an access token over TLS, then reading the profile back
from GitHub with it. The port allows this — `complete` returns a profile and
never promises how it was obtained — which is exactly the flexibility a second
protocol needed, and the reason this package exists rather than a preset in
`identity-provider-oidc`.

## Three consequences of not being OIDC

- **The client secret is required.** There is no PKCE in this flow, so the
  secret is the only thing proving the code is being redeemed by the application
  it was issued to. `resolveGithubConfig` refuses a configuration without one.
- **`state` is the whole replay defence.** There is no `nonce` to bind into a
  token, so the adapter checks the echoed `state` itself rather than assuming
  the caller did — and sends neither a nonce nor a PKCE challenge, because
  sending values a provider ignores is noise that reads as protection.
- **The address comes from `/user/emails`, never `/user`.** `/user.email` is the
  *public profile* address: a person can set it to anything, and it is
  frequently empty. Trusting it would be the port's third clause broken in its
  most literal form — an unverified string used as if the provider had vouched
  for it.

An account with **no verified address is refused outright** rather than reported
as `emailVerified: false`. The distinction matters: a `false` would still let a
deployment link the account if it ever relaxed that rule, and there is no
address here worth linking — GitHub has told us it does not know whether anyone
can be reached at it.

## Other things this file decided

- **The subject is the numeric id**, as a string — never the login. A login can
  be changed, and a released login can be claimed by someone else, which is the
  same failure mode that keeps an email out of that field.
- **`accept: application/json` on the token exchange.** Without it GitHub
  answers form-encoded, which parses as an empty object under `.json()` and
  reads as "no access token" three lines later.
- **A `200` with an `error` field is a failure.** GitHub reports a bad code that
  way, so the status alone is not the check.
- **Enterprise Server serves its API under `/api/v3`**, while github.com uses a
  separate host. Getting that wrong is a 404 on the profile read, one step after
  a token exchange that appeared to work.
- **`organization` is cosmetic**, like Google's `hd`: it shapes the account
  chooser, and the CMS's own rules decide who gets in.

## Tests

`conformance.spec.ts` runs the shared kit from `@orthacms/identity-domain`. Two
of its scenarios mean something different on this wire, and saying so is the
point — a clause that quietly did not apply would be a clause nobody checked:

- **tampered** is a code the provider refuses, which is what "this response did
  not come from a legitimate authorization" looks like without a signature;
- **mismatchedNonce** is a foreign `state`, because that is the only replay
  defence this protocol has.

This is the adapter that proves the port is not quietly OIDC-shaped.

## Package

- Name: `@orthacms/identity-provider-github`
- Import: `import { createGithubProvider } from '@orthacms/identity-provider-github'`
- Depends only on `@orthacms/identity-domain`. No SDK: the two endpoints and two
  reads are plain `fetch`, and there is no cryptography here to get wrong.
