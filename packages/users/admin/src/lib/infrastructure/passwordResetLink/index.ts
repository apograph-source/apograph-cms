/**
 * The admin route that redeems a password reset. Owned by
 * `@orthacms/identity-admin` (its router mounts `reset-password` under
 * `/identity`); repeated here for the same reason the invite path is — a path
 * string is not worth a package dependency, and the e2e suites assert the built
 * link so a drift would fail loudly.
 */
const RESET_PASSWORD_PATH = '/identity/reset-password';

/**
 * Builds the reset link an admin hands to a member, from the raw token the API
 * returned once.
 *
 * The origin comes from the browser rather than server config on purpose: the
 * admin is *already* looking at the app on the URL the member should use, so
 * `window.location.origin` is right by construction — no `publicBaseUrl` to
 * misconfigure, and no host header to poison. When the mailer lands (identity
 * epic #11) the server will need its own configured base URL; this stays the
 * copy-it-yourself path.
 */
export function passwordResetLinkFor(token: string): string {
    const url = new URL(RESET_PASSWORD_PATH, window.location.origin);
    url.searchParams.set('token', token);
    return url.toString();
}
