import { SsoVerificationError } from '@apograph/identity-domain';
import { createGithubProvider } from './github-provider';
import {
    callbackWith,
    CLIENT_ID,
    CORE_SECRETS,
    stubGithub,
    type StubOptions
} from './test-support';

function providerFor(options: StubOptions = {}) {
    const github = stubGithub(options);
    return {
        github,
        provider: createGithubProvider({
            clientId: CLIENT_ID,
            clientSecret: 'client-secret',
            fetch: github.fetch
        })
    };
}

describe('createGithubProvider — configuration', () => {
    it('refuses a missing client secret, because there is no PKCE to stand in', () => {
        expect(() =>
            createGithubProvider({ clientId: CLIENT_ID, clientSecret: '  ' })
        ).toThrow(/no PKCE/);
    });

    it('refuses an empty clientId', () => {
        expect(() =>
            createGithubProvider({ clientId: '', clientSecret: 's' })
        ).toThrow(/needs a clientId/);
    });

    it('refuses a plain-HTTP enterprise host', () => {
        expect(() =>
            createGithubProvider({
                clientId: CLIENT_ID,
                clientSecret: 's',
                enterpriseBaseUrl: 'http://github.acme.com'
            })
        ).toThrow(/clear text/);
    });

    it('reports itself as OAuth2, not OIDC', () => {
        const { provider } = providerFor();

        expect(provider.descriptor()).toEqual({
            kind: 'oauth2',
            label: 'GitHub',
            callbackMethod: 'GET'
        });
    });
});

describe('createGithubProvider — authorize', () => {
    it('builds the authorization URL', async () => {
        const { provider } = providerFor();

        const { url } = await provider.authorize(CORE_SECRETS);
        const parsed = new URL(url);

        expect(parsed.origin + parsed.pathname).toBe(
            'https://github.com/login/oauth/authorize'
        );
        expect(parsed.searchParams.get('client_id')).toBe(CLIENT_ID);
        expect(parsed.searchParams.get('state')).toBe(CORE_SECRETS.state);
        expect(parsed.searchParams.get('scope')).toBe('read:user user:email');
    });

    it('sends neither a nonce nor a PKCE challenge, which GitHub has no use for', async () => {
        const { provider } = providerFor();

        const { url } = await provider.authorize(CORE_SECRETS);
        const parsed = new URL(url);

        expect(parsed.searchParams.get('nonce')).toBeNull();
        expect(parsed.searchParams.get('code_challenge')).toBeNull();
        expect(url).not.toContain(CORE_SECRETS.codeVerifier);
    });

    it('points at an enterprise host when one is configured', async () => {
        const github = stubGithub();
        const provider = createGithubProvider({
            clientId: CLIENT_ID,
            clientSecret: 's',
            enterpriseBaseUrl: 'https://github.acme.com/',
            fetch: github.fetch
        });

        const { url } = await provider.authorize(CORE_SECRETS);

        expect(url).toContain('https://github.acme.com/login/oauth/authorize');
    });
});

describe('createGithubProvider — complete', () => {
    it('returns the verified profile', async () => {
        const { provider } = providerFor();

        const profile = await provider.complete(callbackWith());

        expect(profile).toMatchObject({
            // The numeric id, not the login: a login can be changed, and a
            // released one can be claimed by somebody else.
            subject: '4242',
            email: 'ada@example.com',
            emailVerified: true,
            name: 'Ada Lovelace'
        });
    });

    it('reads the verified address, never the public profile one', async () => {
        // `/user.email` is whatever the person typed into their profile. Using
        // it would be the clause-3 mistake in its most literal form.
        const { provider } = providerFor({
            user: { id: 1, login: 'ada', email: 'anything-i-like@example.com' },
            emails: [
                { email: 'real@example.com', primary: true, verified: true }
            ]
        });

        const profile = await provider.complete(callbackWith());

        expect(profile.email).toBe('real@example.com');
    });

    it('prefers the primary verified address', async () => {
        const { provider } = providerFor({
            emails: [
                {
                    email: 'secondary@example.com',
                    primary: false,
                    verified: true
                },
                { email: 'primary@example.com', primary: true, verified: true }
            ]
        });

        expect((await provider.complete(callbackWith())).email).toBe(
            'primary@example.com'
        );
    });

    it('falls back to the first verified address when none is primary', async () => {
        const { provider } = providerFor({
            emails: [
                { email: 'only@example.com', primary: false, verified: true }
            ]
        });

        expect((await provider.complete(callbackWith())).email).toBe(
            'only@example.com'
        );
    });

    it('refuses an account with no verified address at all', async () => {
        const { provider } = providerFor({
            emails: [
                {
                    email: 'unverified@example.com',
                    primary: true,
                    verified: false
                }
            ]
        });

        await expect(provider.complete(callbackWith())).rejects.toThrow(
            /no verified email address/
        );
    });

    it('falls back to the login when the profile has no name', async () => {
        const { provider } = providerFor({
            user: { id: 7, login: 'ada' }
        });

        expect((await provider.complete(callbackWith())).name).toBe('ada');
    });

    it('sends the code with the client secret and the same redirect_uri', async () => {
        const { provider, github } = providerFor();

        await provider.complete(callbackWith());

        expect(github.lastTokenBody?.get('client_secret')).toBe(
            'client-secret'
        );
        expect(github.lastTokenBody?.get('redirect_uri')).toBe(
            CORE_SECRETS.redirectUri
        );
        expect(github.lastAuthHeader).toBe('Bearer gho_test');
    });

    it('refuses a foreign state before it exchanges anything', async () => {
        const { provider, github } = providerFor();

        await expect(
            provider.complete(callbackWith({ state: 'someone-else' }))
        ).rejects.toBeInstanceOf(SsoVerificationError);
        expect(github.calls.token).toBe(0);
    });

    it("refuses GitHub's 200-with-an-error answer", async () => {
        // GitHub reports a bad code as `200` with an `error` field, so the
        // status alone is not the check.
        const { provider } = providerFor({
            token: { error: 'bad_verification_code' }
        });

        await expect(provider.complete(callbackWith())).rejects.toThrow(
            /bad_verification_code/
        );
    });

    it('refuses a token response with no access token', async () => {
        const { provider } = providerFor({ token: { scope: 'read:user' } });

        await expect(provider.complete(callbackWith())).rejects.toThrow(
            /no access token/
        );
    });

    it('refuses a profile with no id', async () => {
        const { provider } = providerFor({ user: { login: 'ada' } });

        await expect(provider.complete(callbackWith())).rejects.toThrow(
            /nothing stable to key a link on/
        );
    });

    it('refuses an addresses endpoint that errors', async () => {
        const { provider } = providerFor({ emailsStatus: 403 });

        await expect(provider.complete(callbackWith())).rejects.toBeInstanceOf(
            SsoVerificationError
        );
    });

    it("refuses the provider's own denial", async () => {
        const { provider, github } = providerFor();

        await expect(
            provider.complete(callbackWith({ error: 'access_denied' }))
        ).rejects.toThrow(/access_denied/);
        expect(github.calls.token).toBe(0);
    });
});

describe('createGithubProvider — logout', () => {
    it('implements no back-channel logout, which is what makes that route answer 404', () => {
        // GitHub posts no logout notification there is anything to verify, and
        // the port makes the method optional for exactly this case: an adapter
        // that cannot verify one does not have it, so the endpoint says 404
        // rather than pretending to have ended somebody's sessions.
        expect(providerFor().provider.verifyLogoutToken).toBeUndefined();
    });
});
