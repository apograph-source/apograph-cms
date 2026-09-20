import { SignedXml } from 'xml-crypto';
import { generate } from 'selfsigned';
import type {
    SsoAuthorizeRequest,
    SsoCallback
} from '@orthacms/identity-domain';

export const ENTRY_POINT = 'https://idp.test/sso';
export const SP_ISSUER = 'https://cms.test/saml';
export const IDP_ISSUER = 'https://idp.test';
export const CALLBACK = 'https://cms.test/api/auth/sso/saml/callback';

/** The one-attempt secrets a core would have minted. */
export const CORE_SECRETS: SsoAuthorizeRequest = {
    redirectUri: CALLBACK,
    state: 'state-2f6a1c9d',
    // Present and unused: SAML has neither a nonce nor PKCE, and `RelayState`
    // carries the whole of the replay defence.
    nonce: 'nonce-8b0e47aa',
    codeVerifier: 'verifier-4c1d55e0f39b2a7681ce'
};

/** A throwaway signing identity for the scripted identity provider. */
export interface SigningIdentity {
    privateKey: string;
    cert: string;
}

/**
 * Generates a self-signed certificate for the scripted identity provider.
 *
 * A real key and a real certificate, because the assertions below are **really
 * signed**: the only interesting thing about a SAML adapter's failure paths is
 * that a response which does not verify is refused, and a fixture nobody signed
 * could not show that.
 */
export async function signingIdentity(): Promise<SigningIdentity> {
    const pems = await generate([{ name: 'commonName', value: 'idp.test' }], {
        keySize: 2048
    });
    return { privateKey: pems.private, cert: pems.cert };
}

/** What one scripted assertion says. */
export interface AssertionOptions {
    nameId?: string;
    nameIdFormat?: string;
    sessionIndex?: string;
    attributes?: Record<string, string | string[]>;
    /** Skip the attribute statement entirely. */
    omitAttributes?: boolean;
    /** Backdate the assertion so its conditions have expired. */
    expired?: boolean;
    /** Sign with this identity instead of the one the adapter trusts. */
    signWith?: SigningIdentity;
    /**
     * A non-success status — SAML's way of saying "the person did not
     * authenticate". There is no `error` query parameter on this protocol; a
     * refusal is a `StatusCode` inside a signed response.
     */
    status?: string;
}

const PERSISTENT = 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent';

/** Builds a signed `Response`, base64-encoded as the form field carries it. */
export function signedResponse(
    idp: SigningIdentity,
    options: AssertionOptions = {}
): string {
    const now = Date.now();
    const issued = new Date(options.expired ? now - 3_600_000 : now);
    const expires = new Date(options.expired ? now - 3_540_000 : now + 300_000);
    const iso = (date: Date) => date.toISOString();

    const attributes = options.omitAttributes
        ? ''
        : `<saml:AttributeStatement>${Object.entries(
              options.attributes ?? {
                  email: 'ada@example.com',
                  displayName: 'Ada Lovelace'
              }
          )
              .map(([name, value]) => {
                  const values = Array.isArray(value) ? value : [value];
                  return `<saml:Attribute Name="${name}">${values
                      .map(
                          (item) =>
                              `<saml:AttributeValue>${item}</saml:AttributeValue>`
                      )
                      .join('')}</saml:Attribute>`;
              })
              .join('')}</saml:AttributeStatement>`;

    // A real refusal carries a status and **no assertion** — there is nobody to
    // assert anything about. Building it any other way would test a shape no
    // identity provider emits.
    if (options.status && !options.status.endsWith(':Success')) {
        const refusal =
            `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ` +
            `xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ` +
            `ID="_response1" Version="2.0" IssueInstant="${iso(issued)}" ` +
            `Destination="${CALLBACK}">` +
            `<saml:Issuer>${IDP_ISSUER}</saml:Issuer>` +
            `<samlp:Status><samlp:StatusCode Value="${options.status}"/></samlp:Status>` +
            `</samlp:Response>`;
        return Buffer.from(
            sign(refusal, options.signWith ?? idp, 'Response'),
            'utf8'
        ).toString('base64');
    }

    const xml =
        `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ` +
        `xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ` +
        `ID="_response1" Version="2.0" IssueInstant="${iso(issued)}" ` +
        `Destination="${CALLBACK}">` +
        `<saml:Issuer>${IDP_ISSUER}</saml:Issuer>` +
        `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
        `<saml:Assertion ID="_assertion1" Version="2.0" IssueInstant="${iso(issued)}">` +
        `<saml:Issuer>${IDP_ISSUER}</saml:Issuer>` +
        `<saml:Subject>` +
        `<saml:NameID Format="${options.nameIdFormat ?? PERSISTENT}">${
            options.nameId ?? 'idp-subject-1'
        }</saml:NameID>` +
        `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
        `<saml:SubjectConfirmationData NotOnOrAfter="${iso(expires)}" Recipient="${CALLBACK}"/>` +
        `</saml:SubjectConfirmation>` +
        `</saml:Subject>` +
        `<saml:Conditions NotBefore="${iso(issued)}" NotOnOrAfter="${iso(expires)}">` +
        `<saml:AudienceRestriction><saml:Audience>${SP_ISSUER}</saml:Audience></saml:AudienceRestriction>` +
        `</saml:Conditions>` +
        `<saml:AuthnStatement AuthnInstant="${iso(issued)}" SessionIndex="${
            options.sessionIndex ?? 'idp-session-1'
        }">` +
        `<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>` +
        `</saml:AuthnStatement>` +
        attributes +
        `</saml:Assertion>` +
        `</samlp:Response>`;

    const signer = options.signWith ?? idp;
    // Assertion first, then the whole response: an outer signature has to cover
    // the inner one, so signing in the other order invalidates it immediately.
    const signedAssertion = sign(xml, signer, 'Assertion');
    const signed = sign(signedAssertion, signer, 'Response');

    return Buffer.from(signed, 'utf8').toString('base64');
}

/** Adds an enveloped signature over one element, in place. */
function sign(
    xml: string,
    identity: SigningIdentity,
    element: 'Response' | 'Assertion'
): string {
    const sig = new SignedXml({
        privateKey: identity.privateKey,
        publicCert: identity.cert,
        signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
        canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#'
    });
    sig.addReference({
        xpath: `//*[local-name(.)='${element}']`,
        transforms: [
            'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
            'http://www.w3.org/2001/10/xml-exc-c14n#'
        ],
        digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256'
    });
    sig.computeSignature(xml, {
        // Immediately after the element's own `Issuer`, which is where the
        // schema puts a signature and where every identity provider emits it.
        location: {
            reference: `//*[local-name(.)='${element}']/*[local-name(.)='Issuer']`,
            action: 'after'
        }
    });
    return sig.getSignedXml();
}

/** The callback the core would build from an identity provider's form POST. */
export function callbackWith(
    overrides: Record<string, string> = {}
): SsoCallback {
    return {
        params: {
            RelayState: CORE_SECRETS.state,
            ...overrides
        },
        state: CORE_SECRETS.state,
        nonce: CORE_SECRETS.nonce,
        codeVerifier: CORE_SECRETS.codeVerifier,
        redirectUri: CALLBACK
    };
}
