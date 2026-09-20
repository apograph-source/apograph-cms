import { SsoVerificationError } from '@ortha/identity-domain';
import { createSamlProvider } from './saml-provider';
import {
    callbackWith,
    CORE_SECRETS,
    ENTRY_POINT,
    signedResponse,
    signingIdentity,
    SP_ISSUER,
    type SigningIdentity
} from './test-support';

let idp: SigningIdentity;

beforeAll(async () => {
    // One key pair for the whole file: generating an RSA key is the slowest
    // thing here by an order of magnitude, and every scenario can share it.
    idp = await signingIdentity();
});

function provider(over: Record<string, unknown> = {}) {
    return createSamlProvider({
        entryPoint: ENTRY_POINT,
        issuer: SP_ISSUER,
        idpCert: idp.cert,
        emailVerified: true,
        ...over
    });
}

describe('createSamlProvider — configuration', () => {
    it('reports itself as SAML, answering on a POST callback', () => {
        expect(provider().descriptor()).toEqual({
            kind: 'saml',
            label: 'SAML',
            callbackMethod: 'POST'
        });
    });

    it('refuses a non-absolute entryPoint', () => {
        expect(() => provider({ entryPoint: 'idp.test/sso' })).toThrow(
            /absolute entryPoint/
        );
    });

    it('refuses a plain-HTTP entryPoint that is not localhost', () => {
        expect(() => provider({ entryPoint: 'http://idp.test/sso' })).toThrow(
            /clear text/
        );
    });

    it('refuses a missing certificate — there is no discovery to fall back to', () => {
        expect(() => provider({ idpCert: '  ' })).toThrow(
            /signing certificate/
        );
    });

    it('refuses a private key with no matching certificate', () => {
        expect(() => provider({ privateKey: 'x' })).toThrow(/signingCert/);
    });

    it('treats addresses as unverified unless an operator says otherwise', async () => {
        // SAML carries no verification claim at all, so `true` can only ever be
        // an assertion an operator makes.
        const strict = provider({ emailVerified: undefined });

        const profile = await strict.complete(
            callbackWith({ SAMLResponse: signedResponse(idp) })
        );

        expect(profile.emailVerified).toBe(false);
    });
});

describe('createSamlProvider — authorize', () => {
    it('sends the browser to the identity provider with RelayState', async () => {
        const { url } = await provider().authorize(CORE_SECRETS);
        const parsed = new URL(url);

        expect(parsed.origin + parsed.pathname).toBe(ENTRY_POINT);
        // `RelayState` is SAML's spelling of `state`, and the only thing tying
        // a response back to an attempt.
        expect(parsed.searchParams.get('RelayState')).toBe(CORE_SECRETS.state);
        expect(parsed.searchParams.get('SAMLRequest')).toBeTruthy();
    });

    it('never sends the PKCE verifier, which SAML has no concept of', async () => {
        const { url } = await provider().authorize(CORE_SECRETS);

        expect(url).not.toContain(CORE_SECRETS.codeVerifier);
    });
});

describe('createSamlProvider — complete', () => {
    it('validates a signed assertion and returns the profile', async () => {
        const profile = await provider().complete(
            callbackWith({ SAMLResponse: signedResponse(idp) })
        );

        expect(profile).toMatchObject({
            subject: 'idp-subject-1',
            email: 'ada@example.com',
            emailVerified: true,
            name: 'Ada Lovelace',
            sessionId: 'idp-session-1'
        });
    });

    it('refuses an assertion signed by a key the deployment does not trust', async () => {
        // The check the whole protocol rests on, and the reason the fixtures
        // are really signed rather than hand-written.
        const attacker = await signingIdentity();

        await expect(
            provider().complete(
                callbackWith({
                    SAMLResponse: signedResponse(idp, { signWith: attacker })
                })
            )
        ).rejects.toBeInstanceOf(SsoVerificationError);
    });

    it('refuses an expired assertion', async () => {
        await expect(
            provider().complete(
                callbackWith({
                    SAMLResponse: signedResponse(idp, { expired: true })
                })
            )
        ).rejects.toBeInstanceOf(SsoVerificationError);
    });

    it('refuses a foreign RelayState before it parses anything', async () => {
        await expect(
            provider().complete(
                callbackWith({
                    RelayState: 'a-state-from-another-attempt',
                    SAMLResponse: signedResponse(idp)
                })
            )
        ).rejects.toThrow(/RelayState/);
    });

    it('refuses a form with no SAMLResponse', async () => {
        await expect(provider().complete(callbackWith())).rejects.toThrow(
            /no SAMLResponse/
        );
    });

    it('refuses a SAMLResponse that is not XML at all', async () => {
        await expect(
            provider().complete(callbackWith({ SAMLResponse: 'bm90LXhtbA==' }))
        ).rejects.toBeInstanceOf(SsoVerificationError);
    });

    it('refuses a transient NameID, which is different on every sign-in', async () => {
        // Keying a link on one would mint a new link — and, under provisioning,
        // a new account — every time the same person signed in.
        await expect(
            provider().complete(
                callbackWith({
                    SAMLResponse: signedResponse(idp, {
                        nameIdFormat:
                            'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
                        nameId: 'random-per-login-value'
                    })
                })
            )
        ).rejects.toThrow(/transient NameID/);
    });

    it('names the fix when the NameID is the email address', async () => {
        await expect(
            provider().complete(
                callbackWith({
                    SAMLResponse: signedResponse(idp, {
                        nameId: 'ada@example.com'
                    })
                })
            )
        ).rejects.toThrow(/persistent NameID, or set subjectAttribute/);
    });

    it('keys on a configured attribute when the NameID is an address', async () => {
        const profile = await provider({
            subjectAttribute: 'employeeId'
        }).complete(
            callbackWith({
                SAMLResponse: signedResponse(idp, {
                    nameId: 'ada@example.com',
                    attributes: {
                        employeeId: 'E-1701',
                        email: 'ada@example.com'
                    }
                })
            })
        );

        expect(profile).toMatchObject({
            subject: 'E-1701',
            email: 'ada@example.com'
        });
    });

    it('reads the address from whichever spelling the provider used', async () => {
        const profile = await provider().complete(
            callbackWith({
                SAMLResponse: signedResponse(idp, {
                    attributes: {
                        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress':
                            'Grace@Example.COM'
                    }
                })
            })
        );

        expect(profile.email).toBe('grace@example.com');
    });

    it('falls back to a NameID that is an address when no attribute carries one', async () => {
        const profile = await provider({
            subjectAttribute: 'employeeId'
        }).complete(
            callbackWith({
                SAMLResponse: signedResponse(idp, {
                    nameId: 'ada@example.com',
                    attributes: { employeeId: 'E-1701' }
                })
            })
        );

        expect(profile.email).toBe('ada@example.com');
    });

    it('refuses an assertion with no address anywhere', async () => {
        await expect(
            provider().complete(
                callbackWith({
                    SAMLResponse: signedResponse(idp, { omitAttributes: true })
                })
            )
        ).rejects.toThrow(/no email attribute/);
    });

    it('reads groups only when a deployment names the attribute', async () => {
        const response = signedResponse(idp, {
            attributes: {
                email: 'ada@example.com',
                memberOf: ['cms-editors', 'everyone']
            }
        });

        expect(
            (
                await provider().complete(
                    callbackWith({ SAMLResponse: response })
                )
            ).groups
        ).toBeUndefined();
        expect(
            (
                await provider({ groupsAttribute: 'memberOf' }).complete(
                    callbackWith({ SAMLResponse: response })
                )
            ).groups
        ).toEqual(['cms-editors', 'everyone']);
    });

    it('normalises a single group, which arrives as a bare string', async () => {
        const profile = await provider({
            groupsAttribute: 'memberOf'
        }).complete(
            callbackWith({
                SAMLResponse: signedResponse(idp, {
                    attributes: {
                        email: 'ada@example.com',
                        memberOf: 'cms-editors'
                    }
                })
            })
        );

        expect(profile.groups).toEqual(['cms-editors']);
    });
});

describe('createSamlProvider — logout', () => {
    it('offers no logout URL, rather than one that would be rejected', () => {
        // SAML single logout is its own signed, bidirectional exchange, not a
        // URL to redirect to. Answering with one would send people somewhere
        // that turns them away.
        expect(
            provider().logoutUrl?.({ returnTo: 'https://cms.test/' })
        ).toBeNull();
    });

    it('implements no back-channel logout, which is what makes that route answer 404', () => {
        // The port makes `verifyLogoutToken` optional so an adapter that cannot
        // verify a notification simply does not have one — the alternative, a
        // method that accepted whatever was posted, would be an unauthenticated
        // way to sign arbitrary people out of the CMS.
        expect(provider().verifyLogoutToken).toBeUndefined();
    });
});
