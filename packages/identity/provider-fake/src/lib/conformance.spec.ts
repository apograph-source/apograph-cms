import {
    runSsoProviderConformance,
    SSO_PROVIDER_CONFORMANCE_CHECKS,
    type SsoProviderConformanceCase,
    type SsoProviderConformanceReport
} from '@orthacms/identity-domain';
import { createFakeSsoProvider } from './fake-sso-provider';
import { CORE_SECRETS, callbackFrom } from './test-support';

const USERS = [{ subject: 'idp-ada', email: 'ada@example.com', name: 'Ada' }];

const provider = () => createFakeSsoProvider({ users: USERS });

const testCase: SsoProviderConformanceCase = {
    authorize: () => ({ provider: provider(), request: CORE_SECRETS }),
    happyPath: async () => {
        const built = provider();
        return { provider: built, callback: await callbackFrom(built) };
    },
    tampered: async () => {
        const built = provider();
        return {
            provider: built,
            callback: await callbackFrom(built, {
                code: 'bm90LXRoZS1zdWJqZWN0'
            })
        };
    },
    mismatchedNonce: async () => {
        const built = provider();
        return {
            provider: built,
            callback: await callbackFrom(built, {
                nonce_echo: 'a-nonce-from-another-attempt'
            })
        };
    },
    providerError: async () => {
        const built = provider();
        return {
            provider: built,
            callback: await callbackFrom(built, { error: 'access_denied' })
        };
    }
};

/**
 * The shared kit, run against the fake.
 *
 * Every adapter package runs this same suite — that is what makes the port's
 * three clauses a checked property rather than a paragraph of documentation.
 */
describe('fake SSO provider conformance', () => {
    let report: SsoProviderConformanceReport;

    beforeAll(async () => {
        report = await runSsoProviderConformance(testCase);
    });

    it.each(SSO_PROVIDER_CONFORMANCE_CHECKS)('%s', (check) => {
        expect(report[check]).toBeNull();
    });
});
