import { SsoVerificationError } from '@apograph/identity-domain';
import { createOidcProvider } from './oidc-provider';
import {
    BACKCHANNEL_LOGOUT_EVENT,
    callbackWith,
    CLIENT_ID,
    CORE_SECRETS,
    ISSUER,
    REDIRECT_URI,
    signLogoutToken,
    stubIdp,
    type StubOptions
} from './test-support';

async function providerFor(options: StubOptions = {}) {
    const idp = await stubIdp(options);
    return {
        idp,
        provider: createOidcProvider({
            issuer: ISSUER,
            clientId: CLIENT_ID,
            clientSecret: 'client-secret',
            label: 'Test IdP',
            fetch: idp.fetch
        })
    };
}

describe('createOidcProvider — configuration', () => {
    it('refuses a non-absolute issuer', () => {
        expect(() =>
            createOidcProvider({ issuer: 'idp.test', clientId: CLIENT_ID })
        ).toThrow(/absolute issuer URL/);
    });

    it('refuses a plain-HTTP issuer that is not localhost', () => {
        expect(() =>
            createOidcProvider({
                issuer: 'http://idp.test',
                clientId: CLIENT_ID
            })
        ).toThrow(/clear text/);
    });

    it('allows plain HTTP on localhost, for development', () => {
        expect(() =>
            createOidcProvider({
                issuer: 'http://localhost:8080/realms/apograph',
                clientId: CLIENT_ID
            })
        ).not.toThrow();
    });

    it('refuses a scope set without openid', () => {
        expect(() =>
            createOidcProvider({
                issuer: ISSUER,
                clientId: CLIENT_ID,
                scopes: ['profile', 'email']
            })
        ).toThrow(/"openid" scope/);
    });

    it('refuses an empty clientId', () => {
        expect(() =>
            createOidcProvider({ issuer: ISSUER, clientId: '  ' })
        ).toThrow(/needs a clientId/);
    });
});

describe('createOidcProvider — authorize', () => {
    it('builds an authorization URL from the discovery document', async () => {
        const { provider } = await providerFor();

        const { url } = await provider.authorize(CORE_SECRETS);
        const parsed = new URL(url);

        expect(parsed.origin + parsed.pathname).toBe(`${ISSUER}/authorize`);
        expect(parsed.searchParams.get('response_type')).toBe('code');
        expect(parsed.searchParams.get('client_id')).toBe(CLIENT_ID);
        expect(parsed.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
        expect(parsed.searchParams.get('scope')).toBe('openid profile email');
        expect(parsed.searchParams.get('state')).toBe(CORE_SECRETS.state);
        expect(parsed.searchParams.get('nonce')).toBe(CORE_SECRETS.nonce);
    });

    it('sends the PKCE challenge and never the verifier', async () => {
        const { provider } = await providerFor();

        const { url } = await provider.authorize(CORE_SECRETS);

        expect(url).not.toContain(CORE_SECRETS.codeVerifier);
        expect(new URL(url).searchParams.get('code_challenge_method')).toBe(
            'S256'
        );
        expect(new URL(url).searchParams.get('code_challenge')).toHaveLength(
            43
        );
    });

    it('fetches discovery once and reuses it', async () => {
        const { provider, idp } = await providerFor();

        await provider.authorize(CORE_SECRETS);
        await provider.authorize(CORE_SECRETS);

        expect(idp.calls.discovery).toBe(1);
    });

    it('makes concurrent first sign-ins share one discovery request', async () => {
        const { provider, idp } = await providerFor();

        await Promise.all([
            provider.authorize(CORE_SECRETS),
            provider.authorize(CORE_SECRETS),
            provider.authorize(CORE_SECRETS)
        ]);

        expect(idp.calls.discovery).toBe(1);
    });

    it('carries provider-specific parameters through', async () => {
        const idp = await stubIdp();
        const provider = createOidcProvider({
            issuer: ISSUER,
            clientId: CLIENT_ID,
            fetch: idp.fetch,
            authorizationParams: { hd: 'acme.com', prompt: 'select_account' }
        });

        const { url } = await provider.authorize(CORE_SECRETS);

        expect(new URL(url).searchParams.get('hd')).toBe('acme.com');
        expect(new URL(url).searchParams.get('prompt')).toBe('select_account');
    });

    it.each([
        'state',
        'nonce',
        'code_challenge',
        'redirect_uri',
        'response_type'
    ])(
        'refuses to let configuration overwrite the reserved parameter %s',
        async (param) => {
            const idp = await stubIdp();
            const provider = createOidcProvider({
                issuer: ISSUER,
                clientId: CLIENT_ID,
                fetch: idp.fetch,
                authorizationParams: { [param]: 'attacker-chosen' }
            });

            await expect(provider.authorize(CORE_SECRETS)).rejects.toThrow(
                /reserved authorization parameter/
            );
        }
    );

    it('rejects a discovery document naming a different issuer', async () => {
        const { provider } = await providerFor({
            discovery: { issuer: 'https://somewhere-else.test' }
        });

        await expect(provider.authorize(CORE_SECRETS)).rejects.toThrow(
            /names issuer/
        );
    });

    it('does not cache a failed discovery', async () => {
        const idp = await stubIdp({ discoveryStatus: 503 });
        const provider = createOidcProvider({
            issuer: ISSUER,
            clientId: CLIENT_ID,
            fetch: idp.fetch
        });

        await expect(provider.authorize(CORE_SECRETS)).rejects.toThrow();
        await expect(provider.authorize(CORE_SECRETS)).rejects.toThrow();

        // Both attempts really tried: caching the failure would turn a
        // transient outage into a fixed window of guaranteed failure.
        expect(idp.calls.discovery).toBe(2);
    });
});

describe('createOidcProvider — complete', () => {
    it('exchanges the code and returns the verified profile', async () => {
        const { provider, idp } = await providerFor();

        const profile = await provider.complete(callbackWith());

        expect(profile).toMatchObject({
            subject: 'idp-subject-1',
            email: 'ada@example.com',
            emailVerified: true,
            name: 'Ada Lovelace'
        });
        expect(idp.lastTokenBody?.get('grant_type')).toBe('authorization_code');
        expect(idp.lastTokenBody?.get('code_verifier')).toBe(
            CORE_SECRETS.codeVerifier
        );
        expect(idp.lastTokenBody?.get('redirect_uri')).toBe(REDIRECT_URI);
    });

    it('authenticates with client_secret_basic, keeping the secret out of the body', async () => {
        const { provider, idp } = await providerFor();

        await provider.complete(callbackWith());

        expect(idp.lastTokenAuth).toMatch(/^Basic /);
        expect(idp.lastTokenBody?.get('client_secret')).toBeNull();
    });

    it('rejects a token signed by a key the provider does not publish', async () => {
        const { provider } = await providerFor({ signWithForeignKey: true });

        await expect(provider.complete(callbackWith())).rejects.toBeInstanceOf(
            SsoVerificationError
        );
    });

    it('rejects a token whose nonce belongs to another attempt', async () => {
        const { provider } = await providerFor({
            claims: { nonce: 'nonce-from-an-earlier-attempt' }
        });

        await expect(provider.complete(callbackWith())).rejects.toThrow(
            /nonce from a different attempt/
        );
    });

    it('rejects a token with no nonce at all', async () => {
        const { provider } = await providerFor({
            claims: { nonce: undefined }
        });

        await expect(provider.complete(callbackWith())).rejects.toThrow(
            /nonce from a different attempt/
        );
    });

    it("rejects the provider's own error response before exchanging anything", async () => {
        const { provider, idp } = await providerFor();

        await expect(
            provider.complete(callbackWith({ error: 'access_denied' }))
        ).rejects.toThrow(/access_denied/);
        expect(idp.calls.token).toBe(0);
    });

    it('rejects a callback with no code', async () => {
        const { provider } = await providerFor();

        await expect(
            provider.complete(callbackWith({ code: '' }))
        ).rejects.toThrow(/no authorization code/);
    });

    it('rejects a token endpoint that answers an error', async () => {
        const { provider } = await providerFor({
            tokenStatus: 400,
            tokenBody: { error: 'invalid_grant' }
        });

        await expect(provider.complete(callbackWith())).rejects.toThrow(
            /invalid_grant/
        );
    });

    it('rejects a token response with no identity token', async () => {
        const { provider } = await providerFor({
            tokenBody: { access_token: 'only-an-access-token' }
        });

        await expect(provider.complete(callbackWith())).rejects.toThrow(
            /no identity token/
        );
    });

    it('reports an unverified address as unverified', async () => {
        const { provider } = await providerFor({
            claims: { email_verified: false }
        });

        const profile = await provider.complete(callbackWith());

        expect(profile.emailVerified).toBe(false);
    });

    it('treats a missing email_verified as unverified by default', async () => {
        const { provider } = await providerFor({
            claims: { email_verified: undefined }
        });

        const profile = await provider.complete(callbackWith());

        expect(profile.emailVerified).toBe(false);
    });

    it('honours an operator asserting the directory is authoritative', async () => {
        const idp = await stubIdp({ claims: { email_verified: undefined } });
        const provider = createOidcProvider({
            issuer: ISSUER,
            clientId: CLIENT_ID,
            fetch: idp.fetch,
            emailVerifiedWhenAbsent: true
        });

        const profile = await provider.complete(callbackWith());

        expect(profile.emailVerified).toBe(true);
    });

    it('still believes a provider that says false, whatever the operator asserted', async () => {
        const idp = await stubIdp({ claims: { email_verified: false } });
        const provider = createOidcProvider({
            issuer: ISSUER,
            clientId: CLIENT_ID,
            fetch: idp.fetch,
            emailVerifiedWhenAbsent: true
        });

        const profile = await provider.complete(callbackWith());

        expect(profile.emailVerified).toBe(false);
    });

    it('falls back to preferred_username, as Entra reports it', async () => {
        const { provider } = await providerFor({
            claims: {
                email: undefined,
                preferred_username: 'Grace@Example.COM'
            }
        });

        const profile = await provider.complete(callbackWith());

        expect(profile.email).toBe('grace@example.com');
    });

    it('reads groups only when a deployment names the claim', async () => {
        const idp = await stubIdp({ claims: { groups: ['cms-editors'] } });
        const withoutMapping = createOidcProvider({
            issuer: ISSUER,
            clientId: CLIENT_ID,
            fetch: idp.fetch
        });
        const withMapping = createOidcProvider({
            issuer: ISSUER,
            clientId: CLIENT_ID,
            fetch: idp.fetch,
            groupsClaim: 'groups'
        });

        expect(
            (await withoutMapping.complete(callbackWith())).groups
        ).toBeUndefined();
        expect((await withMapping.complete(callbackWith())).groups).toEqual([
            'cms-editors'
        ]);
    });
});

describe('createOidcProvider — logoutUrl', () => {
    it('answers null before any discovery has happened', async () => {
        const { provider } = await providerFor();

        expect(
            provider.logoutUrl?.({ returnTo: 'https://cms.test/' })
        ).toBeNull();
    });

    it('builds the end-session URL once discovery has run', async () => {
        const { provider } = await providerFor();
        await provider.authorize(CORE_SECRETS);

        const url = provider.logoutUrl?.({ returnTo: 'https://cms.test/' });

        expect(url).toContain(`${ISSUER}/logout`);
        expect(url).toContain('post_logout_redirect_uri=');
    });
});

describe('createOidcProvider — back-channel logout', () => {
    it('accepts a signed logout token and names the session it ends', async () => {
        const { provider, idp } = await providerFor();
        const token = await signLogoutToken(idp);

        const notice = await provider.verifyLogoutToken?.(token);

        expect(notice).toEqual({
            sessionId: 'provider-session-1',
            subject: 'idp-subject-1'
        });
    });

    it('accepts a subject-only notification — the offboarding shape', async () => {
        const { provider, idp } = await providerFor();
        const token = await signLogoutToken(idp, { sid: undefined });

        const notice = await provider.verifyLogoutToken?.(token);

        expect(notice).toMatchObject({
            sessionId: null,
            subject: 'idp-subject-1'
        });
    });

    it('refuses an identity token presented as a logout token', async () => {
        // The whole reason the `events` claim is checked. Same issuer, same
        // audience, same signing key, and it names a `sub` — so without this,
        // anyone holding a stolen identity token could sign its owner out.
        const { provider, idp } = await providerFor();
        const token = await signLogoutToken(idp, { events: undefined });

        await expect(provider.verifyLogoutToken?.(token)).rejects.toThrow(
            /not a logout token/
        );
    });

    it('refuses a logout token carrying a nonce, which only an identity token has', async () => {
        const { provider, idp } = await providerFor();
        const token = await signLogoutToken(idp, { nonce: 'n-1' });

        await expect(provider.verifyLogoutToken?.(token)).rejects.toThrow(
            /carries a nonce/
        );
    });

    it('refuses a token signed by a key the provider does not publish', async () => {
        const { provider } = await providerFor();
        const foreign = await stubIdp({ signWithForeignKey: true });
        const token = await signLogoutToken(foreign);

        await expect(
            provider.verifyLogoutToken?.(token)
        ).rejects.toBeInstanceOf(SsoVerificationError);
    });

    it('refuses a token naming neither a session nor a subject', async () => {
        const { provider, idp } = await providerFor();
        const token = await signLogoutToken(idp, {
            sid: undefined,
            sub: undefined,
            events: { [BACKCHANNEL_LOGOUT_EVENT]: {} }
        });

        await expect(provider.verifyLogoutToken?.(token)).rejects.toThrow(
            /neither a session nor a subject/
        );
    });
});
