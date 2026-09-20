import {
    runSsoProviderConformance,
    SSO_PROVIDER_CONFORMANCE_CHECKS,
    type SsoProviderConformanceCase,
    type SsoProviderConformanceReport
} from '@orthacms/identity-domain';
import { createSamlProvider } from './saml-provider';
import {
    callbackWith,
    CORE_SECRETS,
    ENTRY_POINT,
    signedResponse,
    signingIdentity,
    SP_ISSUER,
    type SigningIdentity
} from './test-support';

/**
 * The shared kit, run against the SAML adapter.
 *
 * The fourth adapter to run it, and the one that stretches the port furthest: a
 * POST callback, no nonce, no PKCE, no JSON anywhere, and a refusal that
 * arrives as a signed status code rather than a query parameter. Two of the
 * kit's scenarios therefore mean something different here, and saying so is the
 * point — a clause that quietly did not apply would be a clause nobody checked.
 */
describe('SAML provider conformance', () => {
    let report: SsoProviderConformanceReport;

    beforeAll(async () => {
        const idp: SigningIdentity = await signingIdentity();
        const attacker: SigningIdentity = await signingIdentity();
        const provider = () =>
            createSamlProvider({
                entryPoint: ENTRY_POINT,
                issuer: SP_ISSUER,
                idpCert: idp.cert,
                // The operator's assertion, which the kit's profile checks need
                // and which SAML can never supply on its own.
                emailVerified: true
            });

        const testCase: SsoProviderConformanceCase = {
            authorize: () => ({
                provider: provider(),
                request: CORE_SECRETS
            }),
            happyPath: () => ({
                provider: provider(),
                callback: callbackWith({ SAMLResponse: signedResponse(idp) })
            }),
            // A correctly-formed assertion signed by a key the deployment does
            // not trust — the exact failure an XML signature exists to catch.
            tampered: () => ({
                provider: provider(),
                callback: callbackWith({
                    SAMLResponse: signedResponse(idp, { signWith: attacker })
                })
            }),
            // There is no nonce on this protocol, so `RelayState` carries the
            // whole of the replay defence and this is where it is checked.
            mismatchedNonce: () => ({
                provider: provider(),
                callback: callbackWith({
                    RelayState: 'a-state-from-another-attempt',
                    SAMLResponse: signedResponse(idp)
                })
            }),
            // A refusal is a signed status code, not a query parameter.
            providerError: () => ({
                provider: provider(),
                callback: callbackWith({
                    SAMLResponse: signedResponse(idp, {
                        status: 'urn:oasis:names:tc:SAML:2.0:status:Responder'
                    })
                })
            })
        };

        report = await runSsoProviderConformance(testCase);
    });

    it.each(SSO_PROVIDER_CONFORMANCE_CHECKS)('%s', (check) => {
        expect(report[check]).toBeNull();
    });
});
