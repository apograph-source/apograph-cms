// ortha:if sso-saml
import type { SamlProviderConfig } from '@orthacms/identity-provider-saml';
import { defined, readEnv, readFlag } from '@orthacms/utils-server';

/**
 * The SAML provider, or nothing.
 *
 * All three of the entry point, the certificate and this app's entity id are
 * required, and there is nothing to fall back to: SAML has no discovery
 * document and no key endpoint, so the certificate an operator copies out of
 * their IdP is the whole of the trust relationship.
 */
export function samlProvider():
    | (SamlProviderConfig & { name: string })
    | undefined {
    const entryPoint = readEnv('SSO_SAML_ENTRY_POINT');
    const idpCert = readEnv('SSO_SAML_IDP_CERT');
    const issuer = readEnv('SSO_SAML_ISSUER');
    if (!entryPoint || !idpCert || !issuer) {
        return undefined;
    }
    return defined({
        name: readEnv('SSO_SAML_NAME') ?? 'saml',
        entryPoint,
        // A PEM body on one line, `\n` escapes and all: an environment
        // variable cannot hold real newlines, so they are put back here rather
        // than left for the XML parser to fail on.
        idpCert: idpCert.replace(/\\n/g, '\n'),
        issuer,
        label: readEnv('SSO_SAML_LABEL'),
        // Worth setting whenever the IdP's NameID format is `emailAddress`: an
        // address is not a stable identifier, and a profile whose subject is
        // one is refused.
        subjectAttribute: readEnv('SSO_SAML_SUBJECT_ATTRIBUTE'),
        emailAttribute: readEnv('SSO_SAML_EMAIL_ATTRIBUTE'),
        nameAttribute: readEnv('SSO_SAML_NAME_ATTRIBUTE'),
        groupsAttribute: readEnv('SSO_SAML_GROUPS_ATTRIBUTE'),
        // Defaults to false, and stays an assertion rather than a reading:
        // **SAML carries no verification claim at all**, so there is nothing
        // an adapter could inspect and be honest about. Setting it says this
        // directory is authoritative for the addresses it reports — which is
        // the only gate on a first sign-in claiming an existing account.
        emailVerified: readFlag('SSO_SAML_EMAIL_VERIFIED', false)
    });
}
// ortha:end
