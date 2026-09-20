import {
    SsoVerificationError,
    type SsoAuthorizeRedirect,
    type SsoAuthorizeRequest,
    type SsoCallback,
    type SsoProfile,
    type SsoProvider,
    type SsoProviderDescriptor
} from '@orthacms/identity-domain';
import {
    resolveGithubConfig,
    type GithubProviderConfig,
    type ResolvedGithubConfig
} from './config';

/** The `/user` fields this adapter reads. */
interface GithubUser {
    id?: unknown;
    login?: unknown;
    name?: unknown;
    email?: unknown;
}

/** One entry of `/user/emails`. */
interface GithubEmail {
    email?: unknown;
    primary?: unknown;
    verified?: unknown;
}

/**
 * GitHub sign-in.
 *
 * **Its own package because GitHub is not OpenID Connect.** There is no
 * identity token, so "verify" cannot mean "check a signature": it means
 * spending the authorization code for an access token over TLS, then reading
 * the profile back from GitHub with it. The port allows this — `complete`
 * returns a profile and never promises how it was obtained — which is exactly
 * the flexibility a second protocol needed.
 *
 * Three consequences of that difference, all of them load-bearing:
 *
 * - **The client secret is required.** There is no PKCE in this flow, so the
 *   secret is the only thing proving the code is being redeemed by the
 *   application it was issued to.
 * - **`state` is the only replay defence**, since there is no `nonce` to bind
 *   into a token. The core mints and re-checks it, and this adapter checks it
 *   too rather than assuming the caller did.
 * - **The verified address comes from `/user/emails`, not from `/user`.**
 *   `/user.email` is the *public profile* address: a person can set it to
 *   anything, and it is frequently empty. Trusting it would be the clause-3
 *   mistake in its most literal form — an unverified string used as if the
 *   provider had vouched for it.
 */
export function createGithubProvider(
    config: GithubProviderConfig
): SsoProvider {
    const resolved = resolveGithubConfig(config);
    const descriptor: SsoProviderDescriptor = Object.freeze({
        kind: 'oauth2',
        label: resolved.label,
        callbackMethod: 'GET'
    });

    return {
        descriptor: () => descriptor,

        authorize(request: SsoAuthorizeRequest): Promise<SsoAuthorizeRedirect> {
            const url = new URL(resolved.authorizeUrl);
            url.searchParams.set('client_id', resolved.clientId);
            url.searchParams.set('redirect_uri', request.redirectUri);
            url.searchParams.set(
                'scope',
                [
                    ...new Set([...resolved.scopes, ...(request.scopes ?? [])])
                ].join(' ')
            );
            url.searchParams.set('state', request.state);
            // No `nonce`, and no PKCE challenge: GitHub supports neither, and
            // sending them would be noise that reads as protection.
            if (resolved.organization) {
                url.searchParams.set('login', resolved.organization);
            }
            return Promise.resolve({ url: url.toString() });
        },

        async complete(callback: SsoCallback): Promise<SsoProfile> {
            const { params } = callback;
            if (typeof params['error'] === 'string' && params['error']) {
                throw new SsoVerificationError(
                    `the provider answered error=${params['error']}${
                        params['error_description']
                            ? ` (${params['error_description']})`
                            : ''
                    }`
                );
            }
            if (params['state'] !== callback.state) {
                throw new SsoVerificationError(
                    'the echoed state is not the one this attempt stored'
                );
            }
            const code = params['code'];
            if (!code) {
                throw new SsoVerificationError(
                    'the response carried no authorization code'
                );
            }

            const accessToken = await exchange(resolved, code, callback);
            const user = await readUser(resolved, accessToken);
            const email = await readVerifiedEmail(resolved, accessToken);

            const subject = user.id;
            if (typeof subject !== 'number' && typeof subject !== 'string') {
                throw new SsoVerificationError(
                    'the profile carries no numeric id, so there is nothing stable to key a link on'
                );
            }

            return {
                // GitHub's numeric id, as a string. Not the login: a login can
                // be changed, and released logins can be claimed by somebody
                // else — the same failure mode that keeps an email out of this
                // field.
                subject: String(subject),
                email,
                // Always true, and honestly so: the address came from the
                // verified-addresses endpoint, and an unverified one is filtered
                // out below rather than reported as unverified.
                emailVerified: true,
                name:
                    (typeof user.name === 'string' && user.name.trim()) ||
                    (typeof user.login === 'string' ? user.login : null),
                sessionId: null
            };
        }
    };
}

/** Spends the authorization code for an access token. */
async function exchange(
    config: ResolvedGithubConfig,
    code: string,
    callback: SsoCallback
): Promise<string> {
    let response: Response;
    try {
        response = await config.fetch(config.tokenUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                // Without this GitHub answers `application/x-www-form-urlencoded`
                // — a body that parses as an empty object under `.json()` and
                // reads as "no access token" three lines later.
                accept: 'application/json'
            },
            body: new URLSearchParams({
                client_id: config.clientId,
                client_secret: config.clientSecret,
                code,
                redirect_uri: callback.redirectUri
            }).toString()
        });
    } catch (error) {
        throw new SsoVerificationError(
            `the token exchange could not reach ${config.tokenUrl} (${
                error instanceof Error ? error.message : String(error)
            })`
        );
    }

    const payload = (await response.json().catch(() => ({}))) as {
        access_token?: unknown;
        error?: unknown;
    };

    // GitHub answers `200` with an `error` field rather than a status code, so
    // the status alone is not the check.
    if (!response.ok || payload.error) {
        throw new SsoVerificationError(
            `the token exchange failed${
                payload.error
                    ? ` (${String(payload.error)})`
                    : ` with ${response.status}`
            }`
        );
    }
    if (typeof payload.access_token !== 'string' || !payload.access_token) {
        throw new SsoVerificationError(
            'the token response carried no access token'
        );
    }
    return payload.access_token;
}

/** Reads the authenticated profile. */
async function readUser(
    config: ResolvedGithubConfig,
    accessToken: string
): Promise<GithubUser> {
    return apiGet<GithubUser>(config, accessToken, '/user');
}

/**
 * The address to sign in with: **primary and verified**, or the first verified
 * one if GitHub reports no primary.
 *
 * An account with no verified address is refused outright rather than reported
 * as unverified. The distinction matters: `emailVerified: false` would still
 * let a deployment link the account if it ever relaxed that rule, and there is
 * no address here worth linking — GitHub has told us it does not know whether
 * anyone can be reached at it.
 */
async function readVerifiedEmail(
    config: ResolvedGithubConfig,
    accessToken: string
): Promise<string> {
    const emails = await apiGet<GithubEmail[]>(
        config,
        accessToken,
        '/user/emails'
    );
    if (!Array.isArray(emails)) {
        throw new SsoVerificationError(
            'the addresses endpoint did not answer with a list'
        );
    }

    const verified = emails.filter(
        (entry) => entry.verified === true && typeof entry.email === 'string'
    );
    const chosen =
        verified.find((entry) => entry.primary === true) ?? verified[0];

    if (!chosen) {
        throw new SsoVerificationError(
            'the account has no verified email address'
        );
    }
    return String(chosen.email).trim().toLowerCase();
}

/** One authenticated GET against the GitHub API. */
async function apiGet<T>(
    config: ResolvedGithubConfig,
    accessToken: string,
    path: string
): Promise<T> {
    const url = `${config.apiBaseUrl}${path}`;
    let response: Response;
    try {
        response = await config.fetch(url, {
            headers: {
                authorization: `Bearer ${accessToken}`,
                accept: 'application/vnd.github+json',
                'x-github-api-version': '2022-11-28'
            }
        });
    } catch (error) {
        throw new SsoVerificationError(
            `${url} could not be reached (${
                error instanceof Error ? error.message : String(error)
            })`
        );
    }
    if (!response.ok) {
        throw new SsoVerificationError(`${url} answered ${response.status}`);
    }
    return (await response.json()) as T;
}
