import {
    runSsoProviderConformance,
    SSO_PROVIDER_CONFORMANCE_CHECKS,
    type SsoProviderConformanceCase,
    type SsoProviderConformanceReport
} from '@orthacms/identity-domain';
import { createOidcProvider } from './oidc-provider';
import {
    callbackWith,
    CLIENT_ID,
    CORE_SECRETS,
    ISSUER,
    stubIdp,
    type StubOptions
} from './test-support';

/** A provider armed against a freshly-scripted identity provider. */
async function armed(options: StubOptions = {}) {
    const idp = await stubIdp(options);
    return createOidcProvider({
        issuer: ISSUER,
        clientId: CLIENT_ID,
        clientSecret: 'client-secret',
        label: 'Test IdP',
        fetch: idp.fetch
    });
}

const testCase: SsoProviderConformanceCase = {
    authorize: async () => ({
        provider: await armed(),
        request: CORE_SECRETS
    }),
    happyPath: async () => ({
        provider: await armed(),
        callback: callbackWith()
    }),
    // A token signed by a key the provider never published. This is the failure
    // a signature check exists to catch, and it is only meaningful because the
    // stub signs for real.
    tampered: async () => ({
        provider: await armed({ signWithForeignKey: true }),
        callback: callbackWith()
    }),
    mismatchedNonce: async () => ({
        provider: await armed({
            claims: { nonce: 'nonce-from-another-attempt' }
        }),
        callback: callbackWith()
    }),
    providerError: async () => ({
        provider: await armed(),
        callback: callbackWith({ error: 'access_denied' })
    })
};

/**
 * The shared kit, run against the OIDC adapter.
 *
 * The same suite runs against `identity-provider-fake`. Two adapters with
 * nothing in common but the port, held to one contract — which is what makes
 * the port's three clauses a checked property rather than a paragraph of
 * documentation.
 */
describe('OIDC provider conformance', () => {
    let report: SsoProviderConformanceReport;

    beforeAll(async () => {
        report = await runSsoProviderConformance(testCase);
    });

    it.each(SSO_PROVIDER_CONFORMANCE_CHECKS)('%s', (check) => {
        expect(report[check]).toBeNull();
    });
});
