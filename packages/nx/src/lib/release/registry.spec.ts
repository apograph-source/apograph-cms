import { probeRegistry, registryTokenFromEnv } from './registry';

const fetchMock = jest.fn();

beforeEach(() => {
    fetchMock.mockReset();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
});

/** A packument response with the given versions. */
function packument(...versions: string[]) {
    return {
        status: 200,
        ok: true,
        json: async () => ({
            versions: Object.fromEntries(versions.map((v) => [v, {}]))
        })
    };
}

describe('probeRegistry', () => {
    const request = { name: '@orthacms/media-server', version: '0.3.0' };

    it('escapes a scoped name the way npm’s own clients do', async () => {
        fetchMock.mockResolvedValue(packument('0.3.0'));

        await probeRegistry(request);

        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'https://registry.npmjs.org/@orthacms%2fmedia-server'
        );
    });

    it('appends the trailing slash a custom registry may be missing', async () => {
        fetchMock.mockResolvedValue(packument('0.3.0'));

        await probeRegistry({ ...request, registry: 'https://r.example' });

        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'https://r.example/@orthacms%2fmedia-server'
        );
    });

    it('sends the token as a bearer, so a restricted package reads as existing', async () => {
        fetchMock.mockResolvedValue(packument('0.3.0'));

        await probeRegistry({ ...request, token: 'npm_abc' });

        expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
            authorization: 'Bearer npm_abc'
        });
    });

    it('answers version-published when the exact version is already out', async () => {
        fetchMock.mockResolvedValue(packument('0.2.0', '0.3.0'));

        await expect(probeRegistry(request)).resolves.toBe('version-published');
    });

    it('answers name-exists when the name is there but this version is not', async () => {
        fetchMock.mockResolvedValue(packument('0.2.0'));

        await expect(probeRegistry(request)).resolves.toBe('name-exists');
    });

    it('answers name-absent on 404 — this publish would create the name', async () => {
        fetchMock.mockResolvedValue({ status: 404, ok: false });

        await expect(probeRegistry(request)).resolves.toBe('name-absent');
    });

    /**
     * A probe that cannot answer must never be the reason a release fails, so
     * every other outcome collapses to `unknown` and the publish is attempted.
     */
    it.each([
        ['a 5xx', async () => ({ status: 503, ok: false })],
        ['an auth-required registry', async () => ({ status: 401, ok: false })],
        [
            'unparseable JSON',
            async () => ({
                status: 200,
                ok: true,
                json: async () => {
                    throw new Error('not json');
                }
            })
        ]
        // covers: nx:I-24
    ])('answers unknown for %s', async (_label, response) => {
        fetchMock.mockImplementation(response);

        await expect(probeRegistry(request)).resolves.toBe('unknown');
    });

    it('answers unknown when the network is gone', async () => {
        fetchMock.mockRejectedValue(new Error('getaddrinfo EAI_AGAIN'));

        await expect(probeRegistry(request)).resolves.toBe('unknown');
    });
});

describe('registryTokenFromEnv', () => {
    it('prefers npm’s own per-registry key', () => {
        expect(
            registryTokenFromEnv({
                '//registry.npmjs.org/:_authToken': 'ignored',
                npm_config_registry: 'ignored',
                'npm_config_//registry.npmjs.org/:_authToken': 'per-registry',
                NPM_TOKEN: 'fallback'
            } as NodeJS.ProcessEnv)
        ).toBe('per-registry');
    });

    it('falls back to NPM_TOKEN, then NODE_AUTH_TOKEN', () => {
        expect(
            registryTokenFromEnv({
                NPM_TOKEN: 'npm',
                NODE_AUTH_TOKEN: 'gha'
            } as NodeJS.ProcessEnv)
        ).toBe('npm');
        expect(
            registryTokenFromEnv({
                NODE_AUTH_TOKEN: 'gha'
            } as NodeJS.ProcessEnv)
        ).toBe('gha');
    });

    it('is undefined when the environment carries no token', () => {
        expect(registryTokenFromEnv({} as NodeJS.ProcessEnv)).toBeUndefined();
    });
});
