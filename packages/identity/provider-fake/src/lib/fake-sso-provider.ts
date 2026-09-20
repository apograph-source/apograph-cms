import { createHash, timingSafeEqual } from 'node:crypto';
import {
    SsoVerificationError,
    type SsoLogoutNotice,
    type SsoAuthorizeRedirect,
    type SsoAuthorizeRequest,
    type SsoCallback,
    type SsoProfile,
    type SsoProvider,
    type SsoProviderDescriptor
} from '@orthacms/identity-domain';
import type { FakeSsoProviderConfig, FakeSsoUser } from './config';

/** Default signing value. Nothing secret rides on it — see the config doc. */
const DEFAULT_SECRET = 'fake-idp-signing-key';

/** The scripted provider, plus the controls a suite drives it with. */
export interface FakeSsoProvider extends SsoProvider {
    /**
     * Who the **next** `authorize` hands back. Throws for a subject the
     * provider was not configured with, so a typo in a suite fails where it was
     * written rather than as a puzzling verification error one call later.
     */
    signInAs(subject: string): void;
    /** Makes the next `complete` refuse, as a provider-side denial would. */
    failNextVerification(reason?: string): void;
    /** How many times each half of the handshake has run. */
    calls(): { authorize: number; complete: number };
    /**
     * A back-channel logout notification this provider will accept, in the
     * shape its `verifyLogoutToken` expects.
     *
     * Minting it here rather than in a suite keeps the token's format a detail
     * of the adapter — a suite that hand-built one would be asserting against
     * this file's internals instead of against the behaviour.
     */
    logoutToken(notice: SsoLogoutNotice): string;
}

/**
 * A deterministic identity provider: no network, no tenant, no clock skew.
 *
 * **Shipped, not test scaffolding** (ADR-0013). It is how `server-e2e` drives
 * the entire redirect handshake in CI, and how a contributor exercises the
 * sign-in page with no identity provider to hand. Unlike the copilot's scripted
 * adapter — a private test fixture since ADR-0004 §3 was amended — no host
 * registers this one, so shipping it costs a deployment nothing.
 *
 * It is a *real* verifier rather than a stub that always says yes. `authorize`
 * signs the response it scripts; `complete` re-derives that signature, checks
 * `state`, and checks that the echoed `nonce` is the one the core stored. Each
 * check has its own failure, so the conformance kit's rejection cases exercise
 * distinct code rather than one shared `throw`.
 *
 * The signature covers **`code` and `state` only, never the nonce**, which is
 * what lets a replayed-nonce scenario be told apart from a tampered one: change
 * the nonce and the signature still verifies, so the sign-in is refused by the
 * nonce check that is actually under test.
 */
export function createFakeSsoProvider(
    config: FakeSsoProviderConfig
): FakeSsoProvider {
    if (config.users.length === 0) {
        throw new Error(
            'createFakeSsoProvider needs at least one user — a provider that can sign nobody in has no scenario to script.'
        );
    }
    const secret = config.secret ?? DEFAULT_SECRET;
    const descriptor: SsoProviderDescriptor = Object.freeze({
        kind: 'oidc',
        label: config.label ?? 'Fake IdP',
        callbackMethod: 'GET'
    });

    let current: FakeSsoUser = config.users[0];
    let failure: string | null = null;
    let authorizeCalls = 0;
    let completeCalls = 0;

    const find = (subject: string): FakeSsoUser | undefined =>
        config.users.find((user) => user.subject === subject);

    return {
        descriptor: () => descriptor,

        signInAs(subject: string): void {
            const user = find(subject);
            if (!user) {
                throw new Error(
                    `createFakeSsoProvider was not configured with the subject "${subject}". Known: ${config.users
                        .map((known) => known.subject)
                        .join(', ')}.`
                );
            }
            current = user;
        },

        failNextVerification(
            reason = 'the provider refused the sign-in'
        ): void {
            failure = reason;
        },

        calls: () => ({ authorize: authorizeCalls, complete: completeCalls }),

        authorize(request: SsoAuthorizeRequest): Promise<SsoAuthorizeRedirect> {
            authorizeCalls += 1;
            const code = encodeSubject(current.subject);
            const url = new URL(request.redirectUri);
            url.searchParams.set('code', code);
            url.searchParams.set('state', request.state);
            url.searchParams.set('nonce_echo', request.nonce);
            url.searchParams.set('sig', sign(code, request.state, secret));
            // The challenge, never the verifier. A real provider only ever sees
            // this half, and the conformance kit checks that the verifier does
            // not appear in the URL — so putting it here would be caught, which
            // is the reason to put the challenge here at all.
            url.searchParams.set(
                'code_challenge',
                challengeFor(request.codeVerifier)
            );
            url.searchParams.set('code_challenge_method', 'S256');
            return Promise.resolve({ url: url.toString() });
        },

        logoutToken(notice: SsoLogoutNotice): string {
            const body = JSON.stringify({
                sessionId: notice.sessionId ?? null,
                subject: notice.subject ?? null
            });
            const encoded = Buffer.from(body, 'utf8').toString('base64url');
            return `${encoded}.${signLogout(encoded, secret)}`;
        },

        verifyLogoutToken(token: string): Promise<SsoLogoutNotice> {
            // Signed and verified for real, like the authorization response.
            // A stub that accepted any string would leave the route's most
            // dangerous property — that an unverified notification cannot sign
            // people out — asserted nowhere.
            const [encoded, signature] = token.split('.');
            if (
                !encoded ||
                !signature ||
                signLogout(encoded, secret) !== signature
            ) {
                return Promise.reject(
                    new SsoVerificationError(
                        'the logout token signature does not verify'
                    )
                );
            }
            try {
                const parsed = JSON.parse(
                    Buffer.from(encoded, 'base64url').toString('utf8')
                ) as SsoLogoutNotice;
                return Promise.resolve(parsed);
            } catch {
                return Promise.reject(
                    new SsoVerificationError('the logout token is unreadable')
                );
            }
        },

        complete(callback: SsoCallback): Promise<SsoProfile> {
            completeCalls += 1;
            if (failure) {
                const reason = failure;
                failure = null;
                return Promise.reject(new SsoVerificationError(reason));
            }

            const { params } = callback;
            if (params['error']) {
                return Promise.reject(
                    new SsoVerificationError(
                        `the provider answered error=${params['error']}`
                    )
                );
            }
            const code = params['code'];
            if (!code) {
                return Promise.reject(
                    new SsoVerificationError(
                        'the response carried no authorization code'
                    )
                );
            }
            if (params['state'] !== callback.state) {
                return Promise.reject(
                    new SsoVerificationError(
                        'the echoed state is not the one this attempt stored'
                    )
                );
            }
            if (!verify(code, callback.state, params['sig'] ?? '', secret)) {
                return Promise.reject(
                    new SsoVerificationError(
                        'the response signature does not verify'
                    )
                );
            }
            if (params['nonce_echo'] !== callback.nonce) {
                return Promise.reject(
                    new SsoVerificationError(
                        'the echoed nonce is not the one this attempt stored'
                    )
                );
            }

            const subject = decodeSubject(code);
            const user = subject ? find(subject) : undefined;
            if (!user) {
                return Promise.reject(
                    new SsoVerificationError(
                        'the response names a subject this provider does not know'
                    )
                );
            }

            return Promise.resolve({
                subject: user.subject,
                email: user.email,
                emailVerified: user.emailVerified ?? true,
                name: user.name ?? null,
                ...(user.groups ? { groups: user.groups } : {}),
                sessionId: `fake-session-${user.subject}`
            });
        }
    };
}

/** The subject, wrapped so a scenario can corrupt it as one opaque token. */
function encodeSubject(subject: string): string {
    return Buffer.from(subject, 'utf8').toString('base64url');
}

/** The inverse, tolerant of the garbage a tampering scenario produces. */
function decodeSubject(code: string): string | null {
    try {
        const decoded = Buffer.from(code, 'base64url').toString('utf8');
        return decoded === '' ? null : decoded;
    } catch {
        return null;
    }
}

/** SHA-256 over the code and state — never the nonce. See the factory doc. */
function sign(code: string, state: string, secret: string): string {
    return createHash('sha256')
        .update(`${code}.${state}.${secret}`)
        .digest('hex');
}

/** Constant-time comparison, so the fake models the real thing here too. */
function verify(
    code: string,
    state: string,
    presented: string,
    secret: string
): boolean {
    const expected = Buffer.from(sign(code, state, secret), 'utf8');
    const actual = Buffer.from(presented, 'utf8');
    return (
        expected.length === actual.length && timingSafeEqual(expected, actual)
    );
}

/** The signature over a scripted logout token's body. */
function signLogout(encoded: string, secret: string): string {
    return createHash('sha256')
        .update(`logout.${encoded}.${secret}`)
        .digest('hex');
}

/** The PKCE `S256` challenge for a verifier. */
function challengeFor(codeVerifier: string): string {
    return createHash('sha256').update(codeVerifier).digest('base64url');
}
