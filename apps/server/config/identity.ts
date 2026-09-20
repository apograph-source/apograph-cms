/** Identity — sessions, tokens, the SSO handshake, and the SSO providers. */
import type { IdentityPluginConfig } from '@orthacms/identity-server';
import type { OidcProviderConfig } from '@orthacms/identity-provider-oidc';
import type { GithubProviderConfig } from '@orthacms/identity-provider-github';
import type { SamlProviderConfig } from '@orthacms/identity-provider-saml';

import {
    defined,
    readEnv,
    readFlag,
    readList,
    readOptionalList,
    readOptionalPositiveInt,
    readPositiveInt,
    when
} from '@orthacms/utils-server';

import { isProduction } from './env';

/**
 * Identity settings, plus the connection settings for the identity providers
 * this deployment can reach.
 *
 * The provider settings live **here**, not inside `IdentityPluginConfig`: the
 * plugin is adapter-agnostic by decision (ADR-0013 §1), so it names no
 * protocol. `plugins.ts` already imports the adapter factories, so importing
 * their config type costs no new coupling — and adding a second identity
 * provider is a key here plus a line there, with nothing to change inside the
 * identity packages.
 *
 * A key is present only when the deployment configured that provider, exactly
 * as the copilot's backends are. A half-configured provider is worse than an
 * absent one: it appears on the sign-in page as a button that can only fail,
 * and every SSO failure deliberately looks the same, so the person clicking it
 * learns nothing.
 */
export interface OrthaIdentityConfig extends IdentityPluginConfig {
    /**
     * Identity providers, keyed by the name they are registered under. That
     * name appears in the sign-in URL and in every `sso_identities` row, so
     * changing it orphans the links that name it.
     */
    ssoProviders: {
        /**
         * A generic OpenID Connect provider — Okta, Auth0, Keycloak, Google,
         * Entra ID, Authentik, Zitadel and the rest all speak it. Present when
         * `SSO_OIDC_ISSUER` and `SSO_OIDC_CLIENT_ID` are both set.
         *
         * Registered under the name in `SSO_OIDC_NAME` (default `oidc`). To run
         * two at once — a staff directory and a contractor one — copy this key
         * and the matching line in `plugins.ts`; the adapter takes its whole
         * configuration as an argument, so nothing else changes.
         */
        oidc?: OidcProviderConfig & { name: string };
        /**
         * GitHub or GitHub Enterprise Server. Its own key because GitHub is
         * OAuth2, not OIDC — there is no identity token, so it is a different
         * adapter rather than a preset. Present when both credentials are set.
         */
        github?: GithubProviderConfig & { name: string };
        /**
         * A SAML 2.0 identity provider. Present when the entry point and the
         * signing certificate are both set — SAML has no discovery document, so
         * the certificate is the whole of the trust relationship and there is
         * nothing to fall back to.
         */
        saml?: SamlProviderConfig & { name: string };
    };
}

/**
 * The admin dev origin this checkout's stack serves from — `ADMIN_PORT` is the
 * per-worktree Vite port (`docs/parallel-stacks.md`), 4200 when unset.
 */
function defaultAdminOrigin(): string {
    return `http://localhost:${readPositiveInt('ADMIN_PORT', 4200)}`;
}

/** Identity — sessions, tokens, the SSO handshake, and the SSO providers. */
export function identityConfig(): OrthaIdentityConfig {
    return {
        // Origins allowed to call state-changing endpoints (login-CSRF
        // defense). Comma-separated; defaults to the dev admin origin —
        // which follows `ADMIN_PORT`, so a parallel worktree stack on
        // :4201 is not rejected by a default pinned to :4200.
        allowedOrigins: readList('ALLOWED_ORIGINS', defaultAdminOrigin()),
        session: {
            ttlSeconds: readPositiveInt(
                'SESSION_TTL_SECONDS',
                60 * 60 * 24 * 7
            ),
            cookieSecure: isProduction,
            cookieSameSite: 'lax'
        },
        token: {
            inviteTtlSeconds: readPositiveInt(
                'INVITE_TTL_SECONDS',
                60 * 60 * 24 * 7
            ),
            resetTtlSeconds: readPositiveInt('RESET_TTL_SECONDS', 60 * 60)
        },
        // Login rate limit. Defaults preserve the historical 10 req / 60s.
        rateLimit: {
            ttlSeconds: readPositiveInt('LOGIN_RATE_LIMIT_TTL_SECONDS', 60),
            limit: readPositiveInt('LOGIN_RATE_LIMIT', 10)
        },
        // Read through `readEnv`, so all three are trimmed and a whitespace-only
        // value is nothing rather than a value. That matters most for the
        // password: `ORTHA_ROOT_ADMIN_PASSWORD='   '` used to provision an
        // administrator whose password was three spaces, silently. Blank, it
        // now trips `MissingRootAdminPasswordError`, which names the account.
        rootAdmin: {
            email: readEnv('ORTHA_ROOT_ADMIN_EMAIL') ?? '',
            password: readEnv('ORTHA_ROOT_ADMIN_PASSWORD') ?? '',
            name: readEnv('ORTHA_ROOT_ADMIN_NAME') ?? ''
        },
        sso: ssoConfig(),
        ssoProviders: defined({
            oidc: oidcProvider(),
            github: githubProvider(),
            saml: samlProvider()
        })
    };
}

/**
 * The deployment shape of the single-sign-on handshake.
 *
 * The *providers* are not here — they are constructed adapters and are
 * registered in `plugins.ts`, the same split the copilot makes between
 * connection settings and built backends.
 */
function ssoConfig(): NonNullable<IdentityPluginConfig['sso']> {
    return defined({
        // The origin browsers reach this API on. It builds the `redirect_uri`
        // registered with each identity provider, and it is configured rather
        // than read from the request's `Host` header — which a client controls,
        // and could therefore point at an origin of its choosing. Unset, it
        // falls back to the first `allowedOrigins` entry, which is right
        // whenever the admin and the API share an origin: the deployed shape,
        // and the dev one where Vite proxies `/api`.
        publicBaseUrl: readEnv('SSO_PUBLIC_BASE_URL'),
        // How long one sign-in attempt stays live. Ten minutes by default: a
        // consent screen plus a second factor, and no longer — an attempt left
        // open in a forgotten tab should not be a credential sitting around for
        // the afternoon.
        requestTtlSeconds: readPositiveInt('SSO_REQUEST_TTL_SECONDS', 600),
        // Just-in-time provisioning, off unless a domain list is set. The list
        // is what makes this safe: an identity provider answers for everyone it
        // knows, and a public one knows everyone, so provisioning without one
        // means anybody with an account there can sign in here — and nothing
        // breaks to say so, the user list simply grows.
        provisioning: when(readEnv('SSO_PROVISION_DOMAINS'), () => ({
            domains: readList('SSO_PROVISION_DOMAINS', ''),
            defaultRole: readEnv('SSO_PROVISION_ROLE') ?? 'viewer'
        })),
        // Passwords stay on unless a deployment turns them off. The root
        // administrator keeps one regardless — see the note on
        // `IdentitySsoConfig.allowPasswordLogin`; without that exemption a
        // mis-scoped provider locks an operator out of their own CMS with no
        // way back short of a database client.
        allowPasswordLogin: readEnv('SSO_ALLOW_PASSWORD_LOGIN') !== 'false',
        // Shorter than the ordinary session lifetime for a provider with no
        // back-channel logout: without one, a session's own expiry is the only
        // thing that eventually ends access after somebody is offboarded.
        sessionTtlSeconds: readOptionalPositiveInt('SSO_SESSION_TTL_SECONDS')
    });
}

/**
 * The OIDC provider, or nothing when this deployment configured none.
 *
 * Both values gate it because both are needed: an issuer with no client id (or
 * the reverse) becomes a button on the sign-in page that can only fail.
 */
function oidcProvider(): (OidcProviderConfig & { name: string }) | undefined {
    const issuer = readEnv('SSO_OIDC_ISSUER');
    const clientId = readEnv('SSO_OIDC_CLIENT_ID');
    return when(issuer && clientId, () =>
        defined({
            // What the route and every link row call this provider. Stable by
            // necessity: renaming it orphans the links that name it.
            name: readEnv('SSO_OIDC_NAME') ?? 'oidc',
            issuer: issuer as string,
            clientId: clientId as string,
            clientSecret: readEnv('SSO_OIDC_CLIENT_SECRET'),
            label: readEnv('SSO_OIDC_LABEL'),
            scopes: readOptionalList('SSO_OIDC_SCOPES'),
            // Only when an operator says so. The claim is the sole gate on a
            // first sign-in claiming an existing account, so a provider that
            // omits it — Entra ID, notably — links nobody until someone asserts
            // that this directory owns the addresses it reports.
            emailVerifiedWhenAbsent: readFlag(
                'SSO_OIDC_EMAIL_VERIFIED_WHEN_ABSENT',
                false
            )
        })
    );
}

/** GitHub / GitHub Enterprise, present when both credentials are set. */
function githubProvider():
    | (GithubProviderConfig & { name: string })
    | undefined {
    const clientId = readEnv('SSO_GITHUB_CLIENT_ID');
    const clientSecret = readEnv('SSO_GITHUB_CLIENT_SECRET');
    return when(clientId && clientSecret, () =>
        defined({
            name: readEnv('SSO_GITHUB_NAME') ?? 'github',
            clientId: clientId as string,
            clientSecret: clientSecret as string,
            label: readEnv('SSO_GITHUB_LABEL'),
            enterpriseBaseUrl: readEnv('SSO_GITHUB_ENTERPRISE_URL'),
            organization: readEnv('SSO_GITHUB_ORG')
        })
    );
}

/**
 * A SAML 2.0 identity provider, present when the entry point and the signing
 * certificate are both set — SAML has no discovery document, so the certificate
 * is the whole of the trust relationship and there is nothing to fall back to.
 */
function samlProvider(): (SamlProviderConfig & { name: string }) | undefined {
    const entryPoint = readEnv('SSO_SAML_ENTRY_POINT');
    const idpCert = readEnv('SSO_SAML_IDP_CERT');
    return when(entryPoint && idpCert, () =>
        defined({
            name: readEnv('SSO_SAML_NAME') ?? 'saml',
            entryPoint: entryPoint as string,
            idpCert: idpCert as string,
            // The entity id the identity provider has registered for this
            // application. Defaults to the CMS's own origin, which is what most
            // administrators enter when nobody tells them otherwise.
            issuer:
                readEnv('SSO_SAML_ISSUER') ??
                readEnv('SSO_PUBLIC_BASE_URL') ??
                '',
            label: readEnv('SSO_SAML_LABEL'),
            subjectAttribute: readEnv('SSO_SAML_SUBJECT_ATTRIBUTE'),
            emailAttribute: readEnv('SSO_SAML_EMAIL_ATTRIBUTE'),
            groupsAttribute: readEnv('SSO_SAML_GROUPS_ATTRIBUTE'),
            // SAML carries no verification claim at all, so this is always an
            // operator's assertion that their directory owns the addresses it
            // reports.
            emailVerified: readFlag('SSO_SAML_EMAIL_VERIFIED', false)
        })
    );
}
