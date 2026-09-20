import type {
    SsoAuthorizeRequest,
    SsoCallback
} from '@orthacms/identity-domain';
import type { FakeSsoProvider } from './fake-sso-provider';

/**
 * The one-attempt secrets a core would have minted. Fixed values, because the
 * fake is the deterministic adapter and a random verifier here would make the
 * "the URL never contains it" check pass by luck on a short string.
 */
export const CORE_SECRETS: SsoAuthorizeRequest = {
    redirectUri: 'http://localhost:3000/api/auth/sso/fake/callback',
    state: 'state-2f6a1c9d',
    nonce: 'nonce-8b0e47aa',
    codeVerifier: 'verifier-4c1d55e0f39b2a7681ce'
};

/**
 * Runs `authorize`, reads the scripted response straight back out of the URL,
 * and shapes it as the callback the core would hand to `complete`.
 *
 * `overrides` replaces individual response parameters, which is how a scenario
 * expresses tampering, a replayed nonce, or a provider-side refusal without
 * needing a second entry point into the adapter.
 */
export async function callbackFrom(
    provider: FakeSsoProvider,
    overrides: Record<string, string> = {}
): Promise<SsoCallback> {
    const { url } = await provider.authorize(CORE_SECRETS);
    const params = Object.fromEntries(new URL(url).searchParams.entries());
    return {
        params: { ...params, ...overrides },
        state: CORE_SECRETS.state,
        nonce: CORE_SECRETS.nonce,
        codeVerifier: CORE_SECRETS.codeVerifier,
        redirectUri: CORE_SECRETS.redirectUri
    };
}
