import { SsoVerificationError } from '@ortha/identity-domain';
import { createFakeSsoProvider } from './fake-sso-provider';
import { CORE_SECRETS, callbackFrom } from './test-support';

const USERS = [
    { subject: 'idp-ada', email: 'ada@example.com', name: 'Ada' },
    {
        subject: 'idp-grace',
        email: 'grace@example.com',
        emailVerified: false,
        groups: ['cms-editors']
    }
];

describe('createFakeSsoProvider', () => {
    it('refuses to build a provider that can sign nobody in', () => {
        expect(() => createFakeSsoProvider({ users: [] })).toThrow(
            /at least one user/
        );
    });

    it('signs in the first configured user until told otherwise', async () => {
        const provider = createFakeSsoProvider({ users: USERS });

        const first = await provider.complete(await callbackFrom(provider));
        expect(first.subject).toBe('idp-ada');

        provider.signInAs('idp-grace');
        const second = await provider.complete(await callbackFrom(provider));
        expect(second.subject).toBe('idp-grace');
    });

    it('fails loudly when a suite names a subject it never configured', () => {
        const provider = createFakeSsoProvider({ users: USERS });
        expect(() => provider.signInAs('idp-nobody')).toThrow(
            /was not configured with the subject "idp-nobody"/
        );
    });

    it("reports the provider's own verification claim rather than assuming it", async () => {
        const provider = createFakeSsoProvider({ users: USERS });
        provider.signInAs('idp-grace');

        const profile = await provider.complete(await callbackFrom(provider));

        expect(profile.emailVerified).toBe(false);
        expect(profile.groups).toEqual(['cms-editors']);
    });

    it('puts the PKCE challenge in the URL and never the verifier', async () => {
        const provider = createFakeSsoProvider({ users: USERS });

        const { url } = await provider.authorize(CORE_SECRETS);

        expect(url).not.toContain(CORE_SECRETS.codeVerifier);
        expect(new URL(url).searchParams.get('code_challenge_method')).toBe(
            'S256'
        );
    });

    it('counts both halves of the handshake, so a suite can assert no call was made', async () => {
        const provider = createFakeSsoProvider({ users: USERS });
        expect(provider.calls()).toEqual({ authorize: 0, complete: 0 });

        await provider.complete(await callbackFrom(provider));

        expect(provider.calls()).toEqual({ authorize: 1, complete: 1 });
    });

    it('refuses once when armed to fail, then behaves normally again', async () => {
        const provider = createFakeSsoProvider({ users: USERS });
        const callback = await callbackFrom(provider);

        provider.failNextVerification('the user cancelled');
        await expect(provider.complete(callback)).rejects.toThrow(
            SsoVerificationError
        );

        await expect(provider.complete(callback)).resolves.toMatchObject({
            subject: 'idp-ada'
        });
    });

    it.each([
        ['a tampered code', { code: 'bm90LXRoZS1zdWJqZWN0' }],
        ['a replayed nonce', { nonce_echo: 'a-nonce-from-another-attempt' }],
        ['a foreign state', { state: 'someone-else-state' }],
        ['no code at all', { code: '' }],
        ['a provider-side refusal', { error: 'access_denied' }]
    ])('rejects %s', async (_label, over) => {
        const provider = createFakeSsoProvider({ users: USERS });
        const callback = await callbackFrom(provider, over);

        await expect(provider.complete(callback)).rejects.toBeInstanceOf(
            SsoVerificationError
        );
    });
});
