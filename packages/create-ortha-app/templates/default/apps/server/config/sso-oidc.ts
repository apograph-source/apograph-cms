// ortha:if sso-oidc
import type { OidcProviderConfig } from '@orthacms/identity-provider-oidc';
import { defined, readEnv, readFlag } from '@orthacms/utils-server';

/**
 * The OIDC provider, or nothing.
 *
 * Present only when both values are set: an issuer with no client id becomes a
 * sign-in button that can only fail, and every SSO failure looks the same, so
 * whoever clicks it learns nothing.
 */
export function oidcProvider(): (OidcProviderConfig & { name: string }) | undefined {
    const issuer = readEnv('SSO_OIDC_ISSUER');
    const clientId = readEnv('SSO_OIDC_CLIENT_ID');
    if (!issuer || !clientId) {
        return undefined;
    }
    return defined({
        name: readEnv('SSO_OIDC_NAME') ?? 'oidc',
        issuer,
        clientId,
        clientSecret: readEnv('SSO_OIDC_CLIENT_SECRET'),
        label: readEnv('SSO_OIDC_LABEL'),
        // The only gate on a first sign-in claiming an existing account. A
        // provider that omits the claim — Entra ID, notably — links nobody
        // until an operator asserts that this directory owns the addresses it
        // reports.
        emailVerifiedWhenAbsent: readFlag(
            'SSO_OIDC_EMAIL_VERIFIED_WHEN_ABSENT',
            false
        )
    });
}
// ortha:end
