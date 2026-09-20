/**
 * An SSO sign-in did not produce a session.
 *
 * **One error for every reason**, on the same terms as
 * `InvalidCredentialsError` and `InvalidInviteTokenError`: a missing cookie, a
 * spent attempt, a `state` that does not match, a provider that refused, an
 * unverified email, an account that is `pending` or `disabled`, an address no
 * account holds — all of it reaches the browser as the same failed sign-in.
 *
 * The distinction matters more here than on the password path, because the
 * caller is anonymous and the provider is not: someone who can authenticate at
 * a public identity provider could otherwise use this route to learn which
 * addresses hold Ortha accounts, without ever holding one themselves.
 *
 * `reason` is for the server log.
 */
export class SsoLoginFailedError extends Error {
    constructor(readonly reason: string) {
        super(`SSO sign-in failed: ${reason}.`);
        this.name = 'SsoLoginFailedError';
    }
}
