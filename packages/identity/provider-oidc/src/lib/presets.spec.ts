import {
    createAuth0Provider,
    createEntraProvider,
    createGoogleProvider,
    createKeycloakProvider,
    createOktaProvider
} from './presets';
import { CLIENT_ID, CORE_SECRETS } from './test-support';

/** What `fetch` accepts as its first argument, from the platform's signature. */
type FetchInput = Parameters<typeof globalThis.fetch>[0];

/**
 * A stub that answers discovery for whatever issuer it is asked about, so a
 * preset's *constructed issuer* is what these assert — the one thing a preset
 * exists to get right.
 */
async function discoveryFor(issuer: string) {
    const seen: string[] = [];
    const fetchStub = (async (input: FetchInput) => {
        const url = typeof input === 'string' ? input : input.toString();
        seen.push(url);
        return new Response(
            JSON.stringify({
                issuer,
                authorization_endpoint: `${issuer}/authorize`,
                token_endpoint: `${issuer}/token`,
                jwks_uri: `${issuer}/jwks`
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
        );
    }) as typeof globalThis.fetch;
    return { fetchStub, seen };
}

describe('presets build the right issuer', () => {
    it('Google', async () => {
        const { fetchStub, seen } = await discoveryFor(
            'https://accounts.google.com'
        );
        const provider = createGoogleProvider({
            clientId: CLIENT_ID,
            fetch: fetchStub
        });

        await provider.authorize(CORE_SECRETS);

        expect(seen[0]).toBe(
            'https://accounts.google.com/.well-known/openid-configuration'
        );
        expect(provider.descriptor().label).toBe('Google');
    });

    it('Google carries a hosted domain as `hd`', async () => {
        const { fetchStub } = await discoveryFor('https://accounts.google.com');
        const provider = createGoogleProvider({
            clientId: CLIENT_ID,
            fetch: fetchStub,
            hostedDomain: 'acme.com'
        });

        const { url } = await provider.authorize(CORE_SECRETS);

        expect(new URL(url).searchParams.get('hd')).toBe('acme.com');
    });

    it('Entra, from the tenant id', async () => {
        const issuer = 'https://login.microsoftonline.com/tenant-guid/v2.0';
        const { fetchStub, seen } = await discoveryFor(issuer);
        const provider = createEntraProvider({
            clientId: CLIENT_ID,
            tenantId: 'tenant-guid',
            fetch: fetchStub
        });

        await provider.authorize(CORE_SECRETS);

        expect(seen[0]).toBe(`${issuer}/.well-known/openid-configuration`);
    });

    it('Okta, at the org domain', async () => {
        const { fetchStub, seen } = await discoveryFor('https://acme.okta.com');
        const provider = createOktaProvider({
            clientId: CLIENT_ID,
            domain: 'acme.okta.com',
            fetch: fetchStub
        });

        await provider.authorize(CORE_SECRETS);

        expect(seen[0]).toBe(
            'https://acme.okta.com/.well-known/openid-configuration'
        );
    });

    it('Okta, at a custom authorization server', async () => {
        const issuer = 'https://acme.okta.com/oauth2/default';
        const { fetchStub, seen } = await discoveryFor(issuer);
        const provider = createOktaProvider({
            clientId: CLIENT_ID,
            domain: 'acme.okta.com',
            authorizationServerId: 'default',
            fetch: fetchStub
        });

        await provider.authorize(CORE_SECRETS);

        expect(seen[0]).toBe(`${issuer}/.well-known/openid-configuration`);
    });

    it('Auth0 keeps the trailing slash its tokens are issued with', async () => {
        const { fetchStub, seen } = await discoveryFor(
            'https://acme.eu.auth0.com/'
        );
        const provider = createAuth0Provider({
            clientId: CLIENT_ID,
            domain: 'acme.eu.auth0.com',
            fetch: fetchStub
        });

        await provider.authorize(CORE_SECRETS);

        // The discovery path is appended to the issuer, trailing slash and all.
        expect(seen[0]).toBe(
            'https://acme.eu.auth0.com/.well-known/openid-configuration'
        );
    });

    it('Keycloak, from base URL and realm', async () => {
        const issuer = 'https://sso.acme.com/realms/orthacms';
        const { fetchStub, seen } = await discoveryFor(issuer);
        const provider = createKeycloakProvider({
            clientId: CLIENT_ID,
            baseUrl: 'https://sso.acme.com/',
            realm: 'orthacms',
            fetch: fetchStub
        });

        await provider.authorize(CORE_SECRETS);

        // The realm path survives: treating an issuer as a bare origin is how
        // this works against Google and fails against everything else.
        expect(seen[0]).toBe(`${issuer}/.well-known/openid-configuration`);
    });
});

describe("presets do not lose the caller's settings", () => {
    it('keeps an explicit label', async () => {
        const { fetchStub } = await discoveryFor('https://accounts.google.com');
        const provider = createGoogleProvider({
            clientId: CLIENT_ID,
            label: 'Acme Workspace',
            fetch: fetchStub
        });

        expect(provider.descriptor().label).toBe('Acme Workspace');
    });

    it("keeps extra authorization parameters alongside a preset's own", async () => {
        const { fetchStub } = await discoveryFor('https://accounts.google.com');
        const provider = createGoogleProvider({
            clientId: CLIENT_ID,
            fetch: fetchStub,
            hostedDomain: 'acme.com',
            authorizationParams: { prompt: 'select_account' }
        });

        const { url } = await provider.authorize(CORE_SECRETS);

        expect(new URL(url).searchParams.get('hd')).toBe('acme.com');
        expect(new URL(url).searchParams.get('prompt')).toBe('select_account');
    });
});
