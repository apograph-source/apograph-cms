import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

/**
 * What `fetch` accepts as its first argument.
 *
 * Derived from the platform's own signature rather than written as
 * `RequestInfo | URL`: that name comes from the DOM lib, which these
 * Node-targeted packages do not include, so spelling it out would compile here
 * and break the moment the lib set changed.
 */
type FetchInput = Parameters<typeof globalThis.fetch>[0];
import type {
    SsoAuthorizeRequest,
    SsoCallback
} from '@apograph/identity-domain';

export const ISSUER = 'https://idp.test';
export const CLIENT_ID = 'apograph-cms';
export const REDIRECT_URI = 'https://cms.test/api/auth/sso/idp/callback';

/** The one-attempt secrets a core would have minted. */
export const CORE_SECRETS: SsoAuthorizeRequest = {
    redirectUri: REDIRECT_URI,
    state: 'state-2f6a1c9d',
    nonce: 'nonce-8b0e47aa',
    codeVerifier: 'verifier-4c1d55e0f39b2a7681ce'
};

/** What one scripted provider answers with. */
export interface StubOptions {
    /** Claims to merge into (or delete from) the identity token. */
    claims?: Record<string, unknown>;
    /** Sign with a key the published JWKS does not contain. */
    signWithForeignKey?: boolean;
    /** Answer the token endpoint with this status instead of 200. */
    tokenStatus?: number;
    /** Answer the token endpoint with this body instead of an id_token. */
    tokenBody?: Record<string, unknown>;
    /** Answer discovery with these fields merged in. */
    discovery?: Record<string, unknown>;
    /** Fail the discovery request with this status. */
    discoveryStatus?: number;
}

/** A stubbed identity provider: discovery, JWKS and a token endpoint. */
export interface StubIdp {
    /** Drop-in for `fetch`. */
    fetch: typeof globalThis.fetch;
    /**
     * The key the stub signs with, for tokens a test mints itself.
     *
     * Typed from `generateKeyPair`'s own return rather than as `CryptoKey`:
     * that name comes from the DOM lib, which these Node-targeted packages do
     * not include.
     */
    privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
    /** How many requests reached each endpoint. */
    calls: { discovery: number; jwks: number; token: number };
    /** The last form body the token endpoint received. */
    lastTokenBody: URLSearchParams | null;
    /** The last `Authorization` header the token endpoint received. */
    lastTokenAuth: string | null;
}

/**
 * Builds a stubbed OpenID provider that signs **real** identity tokens.
 *
 * Signing for real is what makes the tampering scenario mean something: a
 * flipped byte fails because `jose` verifies a signature, not because a flag
 * says so. It is also the only way to check that the adapter rejects a token
 * signed by a key the provider does not publish, which is the failure a
 * signature check exists to catch.
 */
export async function stubIdp(options: StubOptions = {}): Promise<StubIdp> {
    const { privateKey, publicKey } = await generateKeyPair('RS256', {
        extractable: true
    });
    const foreign = await generateKeyPair('RS256', { extractable: true });
    const publicJwk: JWK = {
        ...(await exportJWK(publicKey)),
        kid: 'test-key',
        alg: 'RS256',
        use: 'sig'
    };

    const state: StubIdp = {
        fetch: (() =>
            Promise.reject(new Error('unset'))) as typeof globalThis.fetch,
        privateKey,
        calls: { discovery: 0, jwks: 0, token: 0 },
        lastTokenBody: null,
        lastTokenAuth: null
    };

    const claims: Record<string, unknown> = {
        sub: 'idp-subject-1',
        email: 'ada@example.com',
        email_verified: true,
        name: 'Ada Lovelace',
        nonce: CORE_SECRETS.nonce,
        ...options.claims
    };
    for (const [key, value] of Object.entries(options.claims ?? {})) {
        if (value === undefined) {
            delete claims[key];
        }
    }

    const idToken = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(ISSUER)
        .setAudience(CLIENT_ID)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(options.signWithForeignKey ? foreign.privateKey : privateKey);

    state.fetch = (async (input: FetchInput, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();

        if (url.includes('.well-known/openid-configuration')) {
            state.calls.discovery += 1;
            if (options.discoveryStatus) {
                return json({}, options.discoveryStatus);
            }
            return json({
                issuer: ISSUER,
                authorization_endpoint: `${ISSUER}/authorize`,
                token_endpoint: `${ISSUER}/token`,
                jwks_uri: `${ISSUER}/jwks`,
                end_session_endpoint: `${ISSUER}/logout`,
                ...options.discovery
            });
        }
        if (url.endsWith('/jwks')) {
            state.calls.jwks += 1;
            return json({ keys: [publicJwk] });
        }
        if (url.endsWith('/token')) {
            state.calls.token += 1;
            state.lastTokenBody = new URLSearchParams(String(init?.body ?? ''));
            state.lastTokenAuth =
                ((init?.headers ?? {}) as Record<string, string>)[
                    'authorization'
                ] ?? null;
            if (options.tokenStatus && options.tokenStatus !== 200) {
                return json(options.tokenBody ?? {}, options.tokenStatus);
            }
            return json(options.tokenBody ?? { id_token: idToken });
        }
        throw new Error(`stub IdP got an unexpected request: ${url}`);
    }) as typeof globalThis.fetch;

    return state;
}

/** A JSON `Response`, as the stub's endpoints answer with. */
function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
    });
}

/**
 * Signs a back-channel logout token with the stub's key.
 *
 * A real signature, like the identity tokens: the checks under test are "did
 * this verify" and "is this actually a logout token", and a hand-built string
 * could only exercise the second.
 */
export async function signLogoutToken(
    idp: StubIdp,
    claims: Record<string, unknown> = {}
): Promise<string> {
    const payload: Record<string, unknown> = {
        events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
        sid: 'provider-session-1',
        sub: 'idp-subject-1',
        ...claims
    };
    for (const [key, value] of Object.entries(claims)) {
        if (value === undefined) {
            delete payload[key];
        }
    }
    return new SignJWT(payload)
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(ISSUER)
        .setAudience(CLIENT_ID)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(idp.privateKey);
}

/** The event claim that marks a token as a logout notification. */
export const BACKCHANNEL_LOGOUT_EVENT =
    'http://schemas.openid.net/event/backchannel-logout';

/** The callback the core would build from a provider's redirect back. */
export function callbackWith(
    overrides: Record<string, string> = {}
): SsoCallback {
    return {
        params: {
            code: 'authorization-code-1',
            state: CORE_SECRETS.state,
            ...overrides
        },
        state: CORE_SECRETS.state,
        nonce: CORE_SECRETS.nonce,
        codeVerifier: CORE_SECRETS.codeVerifier,
        redirectUri: REDIRECT_URI
    };
}
