import type { SsoProvider } from '@orthacms/identity-domain';
import { createOidcProvider } from './oidc-provider';
import type { OidcProviderConfig } from './config';

/** What every preset needs; the rest of {@link OidcProviderConfig} still applies. */
export type PresetConfig = Omit<OidcProviderConfig, 'issuer'> &
    Partial<Pick<OidcProviderConfig, 'issuer'>>;

/**
 * Google Workspace.
 *
 * Emits `email` and `email_verified` properly, so nothing here has to be
 * asserted on the operator's behalf.
 *
 * `hostedDomain` sets Google's `hd` parameter, which asks Google to show only
 * accounts in that domain. Treat it as a convenience, **not** a security
 * control: it shapes the account chooser, and the CMS's own rules — a verified
 * address matching an existing active account — are what actually decide who
 * gets in.
 */
export function createGoogleProvider(
    config: PresetConfig & { hostedDomain?: string }
): SsoProvider {
    const { hostedDomain, ...rest } = config;
    return createOidcProvider({
        issuer: 'https://accounts.google.com',
        label: 'Google',
        ...rest,
        ...(hostedDomain
            ? {
                  authorizationParams: {
                      hd: hostedDomain,
                      ...config.authorizationParams
                  }
              }
            : {})
    });
}

/**
 * Microsoft Entra ID (formerly Azure AD).
 *
 * `tenantId` builds the issuer. Use the directory's own GUID rather than
 * `common` or `organizations`: those multi-tenant issuers accept accounts from
 * **any** Microsoft directory, which is almost never what a CMS wants, and the
 * issuer check that would normally catch a foreign token cannot help when the
 * issuer is deliberately everyone's.
 *
 * **Entra does not emit `email_verified`.** A first sign-in therefore cannot
 * claim an existing account until an operator sets `emailVerifiedWhenAbsent:
 * true`, asserting that this directory is authoritative for the addresses it
 * reports. That assertion is usually true for a corporate tenant; it is simply
 * not one an adapter may make on the operator's behalf. Entra also often
 * reports the address in `preferred_username` rather than `email`, which the
 * default claim order already covers.
 */
export function createEntraProvider(
    config: PresetConfig & { tenantId: string }
): SsoProvider {
    const { tenantId, ...rest } = config;
    return createOidcProvider({
        issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
        label: 'Microsoft',
        ...rest
    });
}

/**
 * Okta.
 *
 * `domain` is the org's host (`acme.okta.com`), optionally with a custom
 * authorization server (`authorizationServerId`, e.g. `default`). Okta's
 * default org server issues at the bare domain; a custom one issues at
 * `/oauth2/<id>`, and the two are different issuers — pointing at the wrong one
 * fails at discovery rather than mysteriously later, which is why the issuer is
 * built here rather than typed by hand.
 */
export function createOktaProvider(
    config: PresetConfig & { domain: string; authorizationServerId?: string }
): SsoProvider {
    const { domain, authorizationServerId, ...rest } = config;
    const host = domain.startsWith('http') ? domain : `https://${domain}`;
    return createOidcProvider({
        issuer: authorizationServerId
            ? `${host}/oauth2/${authorizationServerId}`
            : host,
        label: 'Okta',
        ...rest
    });
}

/** Auth0. `domain` is the tenant host (`acme.eu.auth0.com` or a custom one). */
export function createAuth0Provider(
    config: PresetConfig & { domain: string }
): SsoProvider {
    const { domain, ...rest } = config;
    const host = domain.startsWith('http') ? domain : `https://${domain}`;
    return createOidcProvider({
        // Auth0 issues with a trailing slash, and the `iss` claim is compared
        // byte for byte. Omitting it is the single most common way to get a
        // working discovery document and a token that will not verify.
        issuer: `${host.replace(/\/+$/, '')}/`,
        label: 'Auth0',
        ...rest
    });
}

/**
 * Keycloak. `baseUrl` is the server root, `realm` the realm name.
 *
 * Groups are not in the token by default — a client scope has to map them. Pass
 * `groupsClaim: 'groups'` once that mapper exists, and not before: a claim that
 * is never sent reads as "this person is in no groups", which a future
 * role-mapping handler would quietly act on.
 */
export function createKeycloakProvider(
    config: PresetConfig & { baseUrl: string; realm: string }
): SsoProvider {
    const { baseUrl, realm, ...rest } = config;
    return createOidcProvider({
        issuer: `${baseUrl.replace(/\/+$/, '')}/realms/${realm}`,
        label: 'Keycloak',
        ...rest
    });
}
