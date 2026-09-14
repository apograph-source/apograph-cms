/**
 * Where a message's links point.
 *
 * **Built from configured `appUrl`, never from the request.** The CMS has never
 * needed an absolute URL, so `appUrl` is a new required setting wherever a
 * provider is configured; deriving one from the `Host` header instead would let
 * whoever sent the request decide the domain in the message, and an invitation
 * is the one message a recipient is certain to click (ADR-0018 §5).
 */

/**
 * The admin route that redeems an invite, owned by `@apograph/identity-admin`
 * (its router mounts `accept-invite` under `/identity`). Repeated here for the
 * reason the admin's own copy documents: a path string is not worth a package
 * dependency, and the tests assert the built link, so a drift fails loudly.
 */
export const ACCEPT_INVITE_PATH = 'identity/accept-invite';

/** The admin route that redeems a password reset, on the same footing. */
export const RESET_PASSWORD_PATH = 'identity/reset-password';

/**
 * Rejects an `appUrl` that cannot produce a working link, naming what is wrong.
 *
 * Called at construction rather than at send time: a deployment that typed the
 * setting wrong should learn on boot, not from an invitee holding a link to
 * nowhere.
 */
export function assertAppUrl(appUrl: string): void {
    let url: URL;
    try {
        url = new URL(appUrl);
    } catch {
        throw new Error(
            `mail: appUrl must be an absolute URL (got ${JSON.stringify(appUrl)}), ` +
                'e.g. https://cms.example.com — it is what every link in a message is built from.'
        );
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error(
            `mail: appUrl must be http or https (got ${url.protocol.replace(':', '')}).`
        );
    }
    if (url.search || url.hash) {
        throw new Error(
            'mail: appUrl must not carry a query string or fragment — the token is appended as ' +
                'a query parameter and would collide with one.'
        );
    }
}

/**
 * Joins a path and a token onto `appUrl`.
 *
 * The base is normalised to end in `/` first, so an `appUrl` that already
 * carries a path (`https://example.com/admin`) keeps it instead of having the
 * last segment replaced, which is what `new URL` does otherwise.
 */
function linkFor(appUrl: string, path: string, token: string): string {
    const base = appUrl.endsWith('/') ? appUrl : `${appUrl}/`;
    const url = new URL(path, base);
    url.searchParams.set('token', token);
    return url.toString();
}

/** The link an invitee follows to accept and set a password. */
export function inviteLink(appUrl: string, token: string): string {
    return linkFor(appUrl, ACCEPT_INVITE_PATH, token);
}

/** The link a member follows to choose a new password. */
export function passwordResetLink(appUrl: string, token: string): string {
    return linkFor(appUrl, RESET_PASSWORD_PATH, token);
}
