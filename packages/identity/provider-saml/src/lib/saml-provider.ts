import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import {
    SsoVerificationError,
    type SsoAuthorizeRedirect,
    type SsoAuthorizeRequest,
    type SsoCallback,
    type SsoLogoutRequest,
    type SsoProfile,
    type SsoProvider,
    type SsoProviderDescriptor
} from '@orthacms/identity-domain';
import { resolveSamlConfig, type SamlProviderConfig } from './config';
import { toProfile, type SamlAssertionProfile } from './profile';

/**
 * SAML 2.0 sign-in — HTTP-Redirect for the request, HTTP-POST for the response.
 *
 * **Its own package, and the reason `callbackMethod` is in the port's
 * descriptor from the first release.** SAML's response is not a redirect: the
 * identity provider returns the person by POSTing a form to the callback, so
 * this adapter declares `'POST'` and the plugin mounts the route that serves
 * it. Nothing about the seam had to change to add a second protocol shape,
 * which was the whole bet.
 *
 * **`@node-saml/node-saml` does the XML.** Canonicalisation, signature
 * validation, and the conditions checks are its job. That is a deliberate
 * dependency: XML signature validation has a long history of wrapping attacks
 * that turn on parser details, and it is not a place to demonstrate
 * independence. ADR-0012 permits it here for exactly this reason and forbids it
 * in `identity-domain` and `identity-server`.
 *
 * What *this* file owns is everything the library has no opinion about: which
 * attribute means what, that a transient NameID cannot key a link, and that
 * `RelayState` is where the core's `state` travels.
 */
export function createSamlProvider(config: SamlProviderConfig): SsoProvider {
    const resolved = resolveSamlConfig(config);
    const descriptor: SsoProviderDescriptor = Object.freeze({
        kind: 'saml',
        label: resolved.label,
        callbackMethod: 'POST'
    });

    /**
     * One configured `SAML` instance per callback URL.
     *
     * The library takes the callback URL at construction while the port supplies
     * it per request, and in practice there is exactly one — so this is a cache
     * of size one that survives a deployment changing its public base URL
     * without a restart, rather than rebuilding an XML validator on every
     * sign-in.
     */
    const instances = new Map<string, SAML>();
    const samlFor = (callbackUrl: string): SAML => {
        const existing = instances.get(callbackUrl);
        if (existing) {
            return existing;
        }
        const saml = new SAML({
            callbackUrl,
            entryPoint: resolved.entryPoint,
            issuer: resolved.issuer,
            idpCert: resolved.idpCert,
            wantAssertionsSigned: resolved.wantAssertionsSigned,
            wantAuthnResponseSigned: resolved.wantAuthnResponseSigned,
            acceptedClockSkewMs: resolved.clockToleranceSeconds * 1000,
            // The core already guarantees one-time use: the attempt row is
            // burned before anything is exchanged. Asking the library to keep
            // its own in-memory `InResponseTo` cache on top would add a second,
            // per-process store that a multi-instance deployment gets wrong —
            // and it would be the one that decides, since it runs first.
            validateInResponseTo: ValidateInResponseTo.never,
            ...(resolved.privateKey ? { privateKey: resolved.privateKey } : {}),
            ...(resolved.signingCert
                ? { publicCert: resolved.signingCert }
                : {})
        });
        instances.set(callbackUrl, saml);
        return saml;
    };

    return {
        descriptor: () => descriptor,

        async authorize(
            request: SsoAuthorizeRequest
        ): Promise<SsoAuthorizeRedirect> {
            // `RelayState` is SAML's spelling of `state`: an opaque value the
            // identity provider echoes back untouched. The core mints it, and
            // it is the only thing tying a response to an attempt — SAML has no
            // nonce and no PKCE.
            const url = await samlFor(request.redirectUri).getAuthorizeUrlAsync(
                request.state,
                undefined,
                {}
            );
            return { url };
        },

        async complete(callback: SsoCallback): Promise<SsoProfile> {
            const { params } = callback;
            if (params['RelayState'] !== callback.state) {
                throw new SsoVerificationError(
                    'the echoed RelayState is not the one this attempt stored'
                );
            }
            const response = params['SAMLResponse'];
            if (!response) {
                throw new SsoVerificationError(
                    'the form carried no SAMLResponse'
                );
            }

            let profile: SamlAssertionProfile | null;
            try {
                const validated = await samlFor(
                    callback.redirectUri
                ).validatePostResponseAsync({
                    SAMLResponse: response,
                    RelayState: params['RelayState']
                });
                profile = validated.profile as SamlAssertionProfile | null;
            } catch (error) {
                throw new SsoVerificationError(
                    `the assertion did not validate (${
                        error instanceof Error ? error.message : String(error)
                    })`
                );
            }
            if (!profile) {
                throw new SsoVerificationError(
                    'the response validated but carried no assertion'
                );
            }

            return toProfile(profile, resolved);
        },

        logoutUrl(_request: SsoLogoutRequest): string | null {
            // Deliberately not implemented. SAML single logout is its own
            // signed, bidirectional exchange — not a URL to redirect to — and
            // pretending otherwise would send people to an endpoint that
            // rejects them. Ending the CMS session still works; the identity
            // provider's does not end with it, which is the honest answer.
            return null;
        }
    };
}
