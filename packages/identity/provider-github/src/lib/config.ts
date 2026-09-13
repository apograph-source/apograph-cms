/** How the GitHub OAuth app is reached and read. */
export interface GithubProviderConfig {
    /** The OAuth app's client id. */
    clientId: string;
    /**
     * The OAuth app's client secret. **Required**, unlike the OIDC adapter's.
     *
     * GitHub's authorization code exchange has no PKCE, so the secret is the
     * only thing proving that the code is being redeemed by the application it
     * was issued to. A public client is not an option here.
     */
    clientSecret: string;
    /** Button text. Defaults to `GitHub`. */
    label?: string;
    /**
     * Scopes to request. Defaults to `read:user user:email` — enough to read a
     * profile and the verified addresses on it, and nothing more. GitHub scopes
     * are coarse, so anything wider hands the CMS access it has no use for.
     */
    scopes?: readonly string[];
    /**
     * Base URL of a GitHub Enterprise Server installation, e.g.
     * `https://github.acme.com`. Omit for github.com.
     */
    enterpriseBaseUrl?: string;
    /**
     * Restrict the button to one organisation's members, via GitHub's `login`
     * hint. Cosmetic, like Google's `hd`: the CMS's own rules decide who gets
     * in, and this only shapes what the account chooser offers.
     */
    organization?: string;
    /** The `fetch` used for the exchange and the profile reads. */
    fetch?: typeof globalThis.fetch;
}

/** Defaults applied once, so no code path has to remember them. */
export interface ResolvedGithubConfig extends GithubProviderConfig {
    label: string;
    scopes: readonly string[];
    authorizeUrl: string;
    tokenUrl: string;
    apiBaseUrl: string;
    fetch: typeof globalThis.fetch;
}

/** The scopes requested when a deployment names none. */
export const DEFAULT_SCOPES = ['read:user', 'user:email'] as const;

/**
 * Applies the defaults and rejects a configuration that cannot work.
 *
 * Eager, at construction: a missing secret would otherwise surface as a failed
 * sign-in, and every failed SSO sign-in looks identical by design, so the one
 * message a person sees would say nothing about the setting that caused it.
 */
export function resolveGithubConfig(
    config: GithubProviderConfig
): ResolvedGithubConfig {
    if (!config.clientId.trim()) {
        throw new Error(
            'createGithubProvider needs a clientId — it is how GitHub knows which application is asking.'
        );
    }
    if (!config.clientSecret.trim()) {
        throw new Error(
            "createGithubProvider needs a clientSecret. GitHub's code exchange has no PKCE, so the secret is the only thing proving the code is being redeemed by the application it was issued to."
        );
    }

    const enterprise = config.enterpriseBaseUrl?.replace(/\/+$/, '');
    if (enterprise) {
        let parsed: URL;
        try {
            parsed = new URL(enterprise);
        } catch {
            throw new Error(
                `createGithubProvider needs an absolute enterpriseBaseUrl; got "${config.enterpriseBaseUrl}".`
            );
        }
        if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
            throw new Error(
                `createGithubProvider refuses the non-HTTPS enterpriseBaseUrl "${config.enterpriseBaseUrl}": the client secret and the access token would cross the network in clear text.`
            );
        }
    }

    return {
        ...config,
        label: config.label ?? 'GitHub',
        scopes: config.scopes ?? DEFAULT_SCOPES,
        authorizeUrl: enterprise
            ? `${enterprise}/login/oauth/authorize`
            : 'https://github.com/login/oauth/authorize',
        tokenUrl: enterprise
            ? `${enterprise}/login/oauth/access_token`
            : 'https://github.com/login/oauth/access_token',
        // Enterprise Server serves its API under `/api/v3`; github.com has its
        // own host. Getting this wrong is a 404 on the profile read, one step
        // after a token exchange that appeared to work.
        apiBaseUrl: enterprise
            ? `${enterprise}/api/v3`
            : 'https://api.github.com',
        fetch: config.fetch ?? globalThis.fetch
    };
}
