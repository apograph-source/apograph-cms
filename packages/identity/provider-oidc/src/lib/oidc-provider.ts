import { createHash } from 'node:crypto';
import {
    createRemoteJWKSet,
    customFetch,
    jwtVerify,
    type JWTVerifyGetKey
} from 'jose';
import {
    SsoVerificationError,
    type SsoAuthorizeRedirect,
    type SsoAuthorizeRequest,
    type SsoCallback,
    type SsoLogoutNotice,
    type SsoLogoutRequest,
    type SsoProfile,
    type SsoProvider,
    type SsoProviderDescriptor
} from '@ortha/identity-domain';
import { toProfile, type IdTokenClaims } from './claims';
import { resolveOidcConfig, type OidcProviderConfig } from './config';
import { EndpointResolver } from './discovery';

/**
 * Protocol parameters an operator's `authorizationParams` may not overwrite.
 *
 * Every one of them is either a security control the core owns (`state`,
 * `nonce`, the PKCE pair) or the thing that decides what flow is running
 * (`response_type`, `redirect_uri`). A config typo that silently replaced one
 * would not fail — it would produce a sign-in that works and is not protected.
 */
const RESERVED_PARAMS = new Set([
    'response_type',
    'client_id',
    'redirect_uri',
    'scope',
    'state',
    'nonce',
    'code_challenge',
    'code_challenge_method'
]);

/**
 * The claim that marks a token as a back-channel logout notification.
 *
 * Checked because everything *else* about a logout token matches an identity
 * token — same issuer, same audience, same signing key. Without this check,
 * anyone holding a stolen identity token could sign its owner out at will.
 */
const BACKCHANNEL_LOGOUT_EVENT =
    'http://schemas.openid.net/event/backchannel-logout';

/** The token endpoint's response, as far as this adapter reads it. */
interface TokenResponse {
    id_token?: unknown;
    error?: unknown;
    error_description?: unknown;
}

/**
 * A generic OpenID Connect adapter: authorization code flow, PKCE, and identity
 * tokens verified against the provider's published keys.
 *
 * One adapter covers most of the market — Okta, Auth0, Keycloak, Google, Entra
 * ID, Authentik, Zitadel, JumpCloud, Ping and GitLab all speak this. That is
 * why SSO diverges from the copilot's package-per-vendor shape: the copilot
 * splits because the *SDKs* differ, and here the wire does not. The named
 * vendors are presets over this, in `presets.ts`.
 *
 * **`jose` does the cryptography.** `createRemoteJWKSet` caches the provider's
 * keys, refetches on an unknown `kid` (which is how key rotation is survived)
 * and rate-limits that refetch (which is what stops a stream of junk tokens
 * from turning this CMS into a load generator aimed at someone else's identity
 * provider). Hand-rolling JWT and JWKS validation is not where to demonstrate
 * independence — ADR-0012 permits the dependency here for exactly this reason,
 * and forbids it in `identity-domain` and `identity-server`.
 */
export function createOidcProvider(config: OidcProviderConfig): SsoProvider {
    const resolved = resolveOidcConfig(config);
    const endpoints = new EndpointResolver(resolved);
    const descriptor: SsoProviderDescriptor = Object.freeze({
        kind: 'oidc',
        label: resolved.label,
        callbackMethod: 'GET'
    });

    /**
     * The key set, built once and reused.
     *
     * Lazy, because the JWKS URL may come from discovery, and a provider that
     * is unreachable at boot must not stop the CMS from starting — SSO is one
     * way in, not the only one.
     */
    let keys: JWTVerifyGetKey | null = null;
    const keySet = async (): Promise<JWTVerifyGetKey> => {
        if (!keys) {
            const { jwks } = await endpoints.endpoints();
            keys = createRemoteJWKSet(new URL(jwks), {
                // A `kid` this set has not seen triggers a refetch, which is
                // how a rotated signing key is picked up without a restart…
                cacheMaxAge: 600_000,
                // …and this is the floor between two such refetches, so a
                // stream of tokens bearing invented `kid`s cannot turn into a
                // stream of requests aimed at the provider.
                cooldownDuration: 30_000,
                // The same `fetch` the rest of the adapter uses. Without this,
                // key fetching would quietly bypass a configured HTTP proxy —
                // and a test's stubbed transport — while discovery and the
                // token exchange honoured it, which is the kind of split that
                // works everywhere except the one deployment that needed it.
                // jose types this hook loosely on purpose; see its own note.
                [customFetch]: resolved.fetch as never
            });
        }
        return keys;
    };

    return {
        descriptor: () => descriptor,

        async authorize(
            request: SsoAuthorizeRequest
        ): Promise<SsoAuthorizeRedirect> {
            const { authorization } = await endpoints.endpoints();
            const url = new URL(authorization);

            for (const [key, value] of Object.entries(
                resolved.authorizationParams ?? {}
            )) {
                if (RESERVED_PARAMS.has(key)) {
                    throw new Error(
                        `The OIDC provider "${resolved.label}" tries to set the reserved authorization parameter "${key}". That parameter is either a security control the CMS owns (state, nonce, PKCE) or the one that decides which flow runs — overriding it would produce a sign-in that appears to work and is not protected.`
                    );
                }
                url.searchParams.set(key, value);
            }

            url.searchParams.set('response_type', 'code');
            url.searchParams.set('client_id', resolved.clientId);
            url.searchParams.set('redirect_uri', request.redirectUri);
            url.searchParams.set(
                'scope',
                [
                    ...new Set([...resolved.scopes, ...(request.scopes ?? [])])
                ].join(' ')
            );
            url.searchParams.set('state', request.state);
            url.searchParams.set('nonce', request.nonce);
            // The challenge, never the verifier: the browser carries this URL,
            // and the verifier is the half that must not travel with it.
            url.searchParams.set(
                'code_challenge',
                challengeFor(request.codeVerifier)
            );
            url.searchParams.set('code_challenge_method', 'S256');

            return { url: url.toString() };
        },

        async complete(callback: SsoCallback): Promise<SsoProfile> {
            const { params } = callback;

            // A provider's own refusal comes back as a parameter, not an HTTP
            // error, so it has to be read before anything else is attempted.
            if (typeof params['error'] === 'string' && params['error']) {
                throw new SsoVerificationError(
                    `the provider answered error=${params['error']}${
                        params['error_description']
                            ? ` (${params['error_description']})`
                            : ''
                    }`
                );
            }
            const code = params['code'];
            if (!code) {
                throw new SsoVerificationError(
                    'the response carried no authorization code'
                );
            }

            const idToken = await exchange(code, callback);
            const claims = await verify(idToken, callback);
            return toProfile(claims, resolved);
        },

        logoutUrl(request: SsoLogoutRequest): string | null {
            // Synchronous by contract, so this answers only from a discovery
            // document already in hand. Before the first sign-in there is none,
            // and `null` is the correct answer then: the CMS session ends
            // either way, and the provider's simply does not.
            const endSession = endpoints.cachedEndpoints()?.endSession;
            if (!endSession) {
                return null;
            }
            const url = new URL(endSession);
            url.searchParams.set('client_id', resolved.clientId);
            url.searchParams.set('post_logout_redirect_uri', request.returnTo);
            return url.toString();
        },

        async verifyLogoutToken(token: string): Promise<SsoLogoutNotice> {
            let claims: IdTokenClaims;
            try {
                const verified = await jwtVerify(token, await keySet(), {
                    issuer: resolved.issuer,
                    audience: resolved.clientId,
                    clockTolerance: resolved.clockToleranceSeconds,
                    // The spec gives logout tokens their own `typ`. Providers
                    // are inconsistent about sending it, so it is not required
                    // — the `events` claim below is the check that actually
                    // separates a logout token from an identity one.
                    typ: undefined
                });
                claims = verified.payload as IdTokenClaims;
            } catch (error) {
                throw new SsoVerificationError(
                    `the logout token did not verify (${
                        error instanceof Error ? error.message : String(error)
                    })`
                );
            }

            // Without this, a **stolen identity token** would be accepted here:
            // same issuer, same audience, same signature, and it names a `sub`.
            // Anyone who obtained one could then sign that person out at will.
            // The `events` claim is what says "this token is a logout
            // notification and nothing else".
            const events = claims['events'];
            if (
                typeof events !== 'object' ||
                events === null ||
                !(BACKCHANNEL_LOGOUT_EVENT in events)
            ) {
                throw new SsoVerificationError(
                    'the token carries no back-channel logout event, so it is not a logout token'
                );
            }
            // The spec forbids a `nonce` on a logout token, precisely because
            // its presence means somebody handed us an identity token.
            if ('nonce' in claims) {
                throw new SsoVerificationError(
                    'the logout token carries a nonce, which only an identity token has'
                );
            }

            const sessionId =
                typeof claims['sid'] === 'string' ? claims['sid'] : null;
            const subject =
                typeof claims['sub'] === 'string' ? claims['sub'] : null;
            if (!sessionId && !subject) {
                throw new SsoVerificationError(
                    'the logout token names neither a session nor a subject'
                );
            }
            return { sessionId, subject };
        }
    };

    /** Spends the authorization code and the PKCE verifier for a token. */
    async function exchange(
        code: string,
        callback: SsoCallback
    ): Promise<string> {
        const { token } = await endpoints.endpoints();
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            // Sent again, and it must match the authorization request byte for
            // byte: most providers bind the code to it, and a mismatch comes
            // back as a flat `invalid_grant` with nothing pointing at the cause.
            redirect_uri: callback.redirectUri,
            code_verifier: callback.codeVerifier,
            client_id: resolved.clientId
        });

        const headers: Record<string, string> = {
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json'
        };
        if (resolved.clientSecret) {
            // `client_secret_basic`: the spec prefers it, every shipped preset
            // accepts it, and it keeps the secret out of a body that
            // intermediaries are more likely to log.
            headers['authorization'] = `Basic ${Buffer.from(
                `${encodeURIComponent(resolved.clientId)}:${encodeURIComponent(
                    resolved.clientSecret
                )}`
            ).toString('base64')}`;
        }

        let response: Response;
        try {
            response = await resolved.fetch(token, {
                method: 'POST',
                headers,
                body: body.toString()
            });
        } catch (error) {
            throw new SsoVerificationError(
                `the token exchange could not reach ${token} (${
                    error instanceof Error ? error.message : String(error)
                })`
            );
        }

        const payload = (await response
            .json()
            .catch(() => ({}))) as TokenResponse;

        if (!response.ok) {
            throw new SsoVerificationError(
                `the token exchange answered ${response.status}${
                    payload.error ? ` (${String(payload.error)})` : ''
                }`
            );
        }
        if (typeof payload.id_token !== 'string' || !payload.id_token) {
            throw new SsoVerificationError(
                'the token response carried no identity token, so there is nothing to verify'
            );
        }
        return payload.id_token;
    }

    /** Verifies signature, issuer, audience, expiry — and the nonce. */
    async function verify(
        idToken: string,
        callback: SsoCallback
    ): Promise<IdTokenClaims> {
        let claims: IdTokenClaims;
        try {
            const verified = await jwtVerify(idToken, await keySet(), {
                issuer: resolved.issuer,
                audience: resolved.clientId,
                clockTolerance: resolved.clockToleranceSeconds
            });
            claims = verified.payload as IdTokenClaims;
        } catch (error) {
            throw new SsoVerificationError(
                `the identity token did not verify (${
                    error instanceof Error ? error.message : String(error)
                })`
            );
        }

        // Checked here rather than left to `jwtVerify`, because it is not a
        // property of the token — it is the link between this token and the
        // attempt the browser started. Without it a token captured from another
        // attempt, still validly signed and unexpired, would be accepted.
        if (claims['nonce'] !== callback.nonce) {
            throw new SsoVerificationError(
                'the identity token carries a nonce from a different attempt'
            );
        }
        return claims;
    }
}

/** The PKCE `S256` challenge for a verifier. */
function challengeFor(codeVerifier: string): string {
    return createHash('sha256').update(codeVerifier).digest('base64url');
}
