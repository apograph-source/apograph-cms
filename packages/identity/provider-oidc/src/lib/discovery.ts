import { SsoVerificationError } from '@orthacms/identity-domain';
import type { OidcEndpoints, ResolvedOidcConfig } from './config';

/** The fields this adapter reads out of a discovery document. */
interface DiscoveryDocument {
    issuer?: unknown;
    authorization_endpoint?: unknown;
    token_endpoint?: unknown;
    jwks_uri?: unknown;
    end_session_endpoint?: unknown;
}

/**
 * Resolves a provider's endpoints, from configuration or from discovery, and
 * caches the answer.
 *
 * **Single-flight.** The in-flight promise is shared, so ten people signing in
 * during the same second produce one discovery request rather than ten. Without
 * it, the first traffic after a restart is the moment the CMS is least polite
 * to the identity provider — which is also the moment an operator is most
 * likely to be watching.
 *
 * The cache holds only the *successful* answer. A failed discovery is not
 * cached, because caching it would extend a transient outage into a fixed
 * window during which every sign-in fails for a reason that has already gone
 * away.
 */
export class EndpointResolver {
    private cached: { endpoints: OidcEndpoints; expiresAt: number } | null =
        null;
    private inFlight: Promise<OidcEndpoints> | null = null;

    constructor(private readonly config: ResolvedOidcConfig) {}

    /**
     * The endpoints already in hand — configured, or from a discovery document
     * fetched earlier — without fetching one.
     *
     * For the synchronous parts of the port. `logoutUrl` is declared sync
     * because a caller building a redirect has nowhere to await, so it can only
     * answer from what is already known; before the first sign-in that is
     * nothing, and `null` is the correct answer then.
     */
    cachedEndpoints(): OidcEndpoints | null {
        if (this.config.endpoints) {
            return this.config.endpoints;
        }
        if (this.cached && this.cached.expiresAt > Date.now()) {
            return this.cached.endpoints;
        }
        return null;
    }

    /** The endpoints, fetching and caching a discovery document if needed. */
    async endpoints(): Promise<OidcEndpoints> {
        if (this.config.endpoints) {
            return this.config.endpoints;
        }
        if (this.cached && this.cached.expiresAt > Date.now()) {
            return this.cached.endpoints;
        }
        if (this.inFlight) {
            return this.inFlight;
        }

        this.inFlight = this.discover()
            .then((endpoints) => {
                this.cached = {
                    endpoints,
                    expiresAt: Date.now() + this.config.discoveryCacheMs
                };
                return endpoints;
            })
            .finally(() => {
                this.inFlight = null;
            });
        return this.inFlight;
    }

    private async discover(): Promise<OidcEndpoints> {
        const url = discoveryUrl(this.config.issuer);
        let response: Response;
        try {
            response = await this.config.fetch(url, {
                headers: { accept: 'application/json' }
            });
        } catch (error) {
            throw new SsoVerificationError(
                `the provider's discovery document at ${url} could not be fetched (${
                    error instanceof Error ? error.message : String(error)
                })`
            );
        }
        if (!response.ok) {
            throw new SsoVerificationError(
                `the provider's discovery document at ${url} answered ${response.status}`
            );
        }

        const document = (await response.json()) as DiscoveryDocument;

        // The issuer is checked here as well as on the token, because a
        // discovery document that names a different issuer means this adapter
        // is pointed at the wrong place — and the resulting failure would
        // otherwise appear one step later, as an unexplained token rejection.
        if (document.issuer !== this.config.issuer) {
            throw new SsoVerificationError(
                `the discovery document at ${url} names issuer "${String(
                    document.issuer
                )}", not the configured "${this.config.issuer}"`
            );
        }

        return {
            authorization: requireUrl(
                document.authorization_endpoint,
                'authorization_endpoint',
                url
            ),
            token: requireUrl(document.token_endpoint, 'token_endpoint', url),
            jwks: requireUrl(document.jwks_uri, 'jwks_uri', url),
            ...(typeof document.end_session_endpoint === 'string'
                ? { endSession: document.end_session_endpoint }
                : {})
        };
    }
}

/**
 * The well-known discovery URL for an issuer.
 *
 * The path is appended to the issuer's own path rather than replacing it —
 * `https://login.example.com/realms/acme` discovers at
 * `…/realms/acme/.well-known/openid-configuration`, which is what Keycloak,
 * Auth0's custom domains and every multi-tenant provider actually serve.
 * Treating the issuer as an origin is the classic way to make this work against
 * Google and fail against everything else.
 */
export function discoveryUrl(issuer: string): string {
    return `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
}

/** Reads a required absolute URL out of a discovery document. */
function requireUrl(value: unknown, field: string, source: string): string {
    if (typeof value !== 'string' || !value) {
        throw new SsoVerificationError(
            `the discovery document at ${source} has no usable ${field}`
        );
    }
    return value;
}
