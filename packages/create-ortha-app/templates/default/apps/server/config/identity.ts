/** Identity — sessions, tokens, the SSO handshake, and the first admin. */
import type { IdentityPluginConfig } from '@orthacms/identity-server';
// ortha:if sso-oidc
import type { OidcProviderConfig } from '@orthacms/identity-provider-oidc';
// ortha:end
// ortha:if sso-github
import type { GithubProviderConfig } from '@orthacms/identity-provider-github';
// ortha:end
// ortha:if sso-saml
import type { SamlProviderConfig } from '@orthacms/identity-provider-saml';
// ortha:end
import {
    defined,
    isProduction,
    readEnv,
    readList,
    readPositiveInt
} from '@orthacms/utils-server';

// ortha:if sso-oidc
import { oidcProvider } from './sso-oidc';
// ortha:end
// ortha:if sso-github
import { githubProvider } from './sso-github';
// ortha:end
// ortha:if sso-saml
import { samlProvider } from './sso-saml';
// ortha:end

/**
 * Identity settings, plus the identity providers this app can reach.
 *
 * The provider settings live here rather than inside `IdentityPluginConfig`,
 * for the same reason the copilot's backends do: the plugin names no protocol,
 * and this file is the one place that reads the environment. The constructed
 * adapters are registered in `src/plugins.ts`.
 */
export interface AppIdentityConfig extends IdentityPluginConfig {
    /**
     * Identity providers, keyed by the name they are registered under. That
     * name appears in the sign-in URL and in every `sso_identities` row, so
     * renaming one orphans the links that name it.
     *
     * Optional, and absent unless this app was generated with single sign-on.
     */
    ssoProviders?: {
        // ortha:if sso-oidc
        /** A generic OpenID Connect provider. Present when both env vars are set. */
        oidc?: OidcProviderConfig & { name: string };
        // ortha:end
        // ortha:if sso-github
        /** GitHub or GitHub Enterprise Server. Present when both env vars are set. */
        github?: GithubProviderConfig & { name: string };
        // ortha:end
        // ortha:if sso-saml
        /** A SAML 2.0 identity provider. Present when all three env vars are set. */
        saml?: SamlProviderConfig & { name: string };
        // ortha:end
    };
}

/** Identity — sessions, tokens, the SSO handshake, and the first admin. */
export function identityConfig(): AppIdentityConfig {
    return {
        // Origins allowed to make state-changing calls (login-CSRF defence).
        // In development that is the Vite dev server; in production the app is
        // same-origin, so this list is what a separately-hosted admin would
        // need adding to.
        allowedOrigins: readList(
            'ALLOWED_ORIGINS',
            `http://localhost:${readPositiveInt('ADMIN_PORT', 4200)}`
        ),
        session: {
            ttlSeconds: readPositiveInt('SESSION_TTL_SECONDS', 60 * 60 * 24 * 7),
            cookieSecure: isProduction(),
            cookieSameSite: 'lax' as const
        },
        token: {
            inviteTtlSeconds: readPositiveInt(
                'INVITE_TTL_SECONDS',
                60 * 60 * 24 * 7
            ),
            resetTtlSeconds: readPositiveInt('RESET_TTL_SECONDS', 60 * 60)
        },
        rateLimit: {
            ttlSeconds: readPositiveInt('LOGIN_RATE_LIMIT_TTL_SECONDS', 60),
            limit: readPositiveInt('LOGIN_RATE_LIMIT', 10)
        },
        sso: ssoConfig(),
        // ortha:if sso
        ssoProviders: defined({
            // ortha:if sso-oidc
            oidc: oidcProvider(),
            // ortha:end
            // ortha:if sso-github
            github: githubProvider(),
            // ortha:end
            // ortha:if sso-saml
            saml: samlProvider()
            // ortha:end
        }),
        // ortha:end
        // With an email set, an admin is provisioned on boot — idempotent and
        // non-destructive. This is how you get your first login.
        // Read through `readEnv`, so all three are trimmed and a whitespace-only
        // value is nothing rather than a value — a password of three spaces
        // would otherwise be provisioned as the administrator's, silently.
        rootAdmin: {
            email: readEnv('ORTHA_ROOT_ADMIN_EMAIL') ?? '',
            password: readEnv('ORTHA_ROOT_ADMIN_PASSWORD') ?? '',
            name: readEnv('ORTHA_ROOT_ADMIN_NAME') ?? ''
        }
    };
}

/**
 * The shape of the single sign-on handshake. The providers themselves are
 * constructed in `src/plugins.ts`; these settings say how the round trip runs.
 */
function ssoConfig(): NonNullable<IdentityPluginConfig['sso']> {
    return defined({
        // The origin browsers reach this API on. It builds the redirect_uri
        // you register with each provider, and it is configured rather than
        // read from the request's Host header, which a client controls. Leave
        // it unset when the admin and the API share an origin — the usual case.
        publicBaseUrl: readEnv('SSO_PUBLIC_BASE_URL'),
        requestTtlSeconds: readPositiveInt('SSO_REQUEST_TTL_SECONDS', 600)
    });
}
