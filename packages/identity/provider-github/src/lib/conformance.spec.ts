import {
    runSsoProviderConformance,
    SSO_PROVIDER_CONFORMANCE_CHECKS,
    type SsoProviderConformanceCase,
    type SsoProviderConformanceReport
} from '@orthacms/identity-domain';
import { createGithubProvider } from './github-provider';
import {
    callbackWith,
    CLIENT_ID,
    CORE_SECRETS,
    stubGithub,
    type StubOptions
} from './test-support';

function armed(options: StubOptions = {}) {
    const github = stubGithub(options);
    return createGithubProvider({
        clientId: CLIENT_ID,
        clientSecret: 'client-secret',
        fetch: github.fetch
    });
}

const testCase: SsoProviderConformanceCase = {
    authorize: () => ({ provider: armed(), request: CORE_SECRETS }),
    happyPath: () => ({ provider: armed(), callback: callbackWith() }),
    // GitHub has no signature to forge, so the analogue of a tampered response
    // is a code the provider refuses — which is what "this response did not
    // come from a legitimate authorization" looks like on this wire.
    tampered: () => ({
        provider: armed({ token: { error: 'bad_verification_code' } }),
        callback: callbackWith({ code: 'tampered-code' })
    }),
    // No nonce exists on this protocol, so `state` carries the whole of the
    // replay defence. Checking it here is what keeps the clause meaningful for
    // an OAuth2 adapter rather than quietly inapplicable.
    mismatchedNonce: () => ({
        provider: armed(),
        callback: callbackWith({ state: 'a-state-from-another-attempt' })
    }),
    providerError: () => ({
        provider: armed(),
        callback: callbackWith({ error: 'access_denied' })
    })
};

/**
 * The shared kit, run against the GitHub adapter.
 *
 * Three adapters now run it — the scripted one, OIDC, and this — and this is
 * the one that proves the port is not quietly OIDC-shaped: GitHub has no
 * identity token, no nonce and no PKCE, and still satisfies every clause.
 */
describe('GitHub provider conformance', () => {
    let report: SsoProviderConformanceReport;

    beforeAll(async () => {
        report = await runSsoProviderConformance(testCase);
    });

    it.each(SSO_PROVIDER_CONFORMANCE_CHECKS)('%s', (check) => {
        expect(report[check]).toBeNull();
    });
});
