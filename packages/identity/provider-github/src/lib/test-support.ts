import type {
    SsoAuthorizeRequest,
    SsoCallback
} from '@apograph/identity-domain';

/** What `fetch` accepts as its first argument, from the platform's signature. */
type FetchInput = Parameters<typeof globalThis.fetch>[0];

export const CLIENT_ID = 'Iv1.apograph';
export const REDIRECT_URI = 'https://cms.test/api/auth/sso/github/callback';

/** The one-attempt secrets a core would have minted. */
export const CORE_SECRETS: SsoAuthorizeRequest = {
    redirectUri: REDIRECT_URI,
    state: 'state-2f6a1c9d',
    // Both present, and both unused by this adapter: GitHub supports neither a
    // nonce nor PKCE. They are here so a test can assert they are not sent.
    nonce: 'nonce-8b0e47aa',
    codeVerifier: 'verifier-4c1d55e0f39b2a7681ce'
};

/** How the scripted GitHub answers. */
export interface StubOptions {
    /** The token endpoint's body. */
    token?: Record<string, unknown>;
    /** The token endpoint's status. */
    tokenStatus?: number;
    /** The `/user` body. */
    user?: Record<string, unknown> | null;
    /** The `/user/emails` body. */
    emails?: unknown;
    /** The `/user/emails` status. */
    emailsStatus?: number;
}

/** A stubbed GitHub: a token endpoint and two API reads. */
export interface StubGithub {
    fetch: typeof globalThis.fetch;
    calls: { token: number; user: number; emails: number };
    lastTokenBody: URLSearchParams | null;
    lastAuthHeader: string | null;
}

/** Builds a scripted GitHub. */
export function stubGithub(options: StubOptions = {}): StubGithub {
    const state: StubGithub = {
        fetch: (() =>
            Promise.reject(new Error('unset'))) as typeof globalThis.fetch,
        calls: { token: 0, user: 0, emails: 0 },
        lastTokenBody: null,
        lastAuthHeader: null
    };

    state.fetch = (async (input: FetchInput, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();

        if (url.includes('/login/oauth/access_token')) {
            state.calls.token += 1;
            state.lastTokenBody = new URLSearchParams(String(init?.body ?? ''));
            return json(
                options.token ?? { access_token: 'gho_test' },
                options.tokenStatus ?? 200
            );
        }
        if (url.endsWith('/user/emails')) {
            state.calls.emails += 1;
            return json(
                options.emails ?? [
                    {
                        email: 'Ada@Example.COM',
                        primary: true,
                        verified: true
                    },
                    { email: 'old@example.com', primary: false, verified: true }
                ],
                options.emailsStatus ?? 200
            );
        }
        if (url.endsWith('/user')) {
            state.calls.user += 1;
            state.lastAuthHeader =
                ((init?.headers ?? {}) as Record<string, string>)[
                    'authorization'
                ] ?? null;
            return json(
                options.user === null
                    ? {}
                    : (options.user ?? {
                          id: 4242,
                          login: 'ada',
                          name: 'Ada Lovelace',
                          email: 'public-profile@example.com'
                      })
            );
        }
        throw new Error(`stub GitHub got an unexpected request: ${url}`);
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

/** The callback the core would build from GitHub's redirect back. */
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
