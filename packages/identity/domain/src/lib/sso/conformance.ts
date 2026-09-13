import { SsoVerificationError } from './errors/sso-verification.error';
import type { SsoProfile } from './sso-profile';
import type {
    SsoAuthorizeRequest,
    SsoCallback,
    SsoProvider
} from './sso-provider';

/** One armed provider plus the authorize request that drives it. */
export interface SsoAuthorizeScenario {
    /** A provider whose next `authorize` answers without a live network. */
    provider: SsoProvider;
    /** The request to authorize, carrying the core-minted secrets. */
    request: SsoAuthorizeRequest;
}

/** One armed provider plus the callback the kit should hand it. */
export interface SsoCallbackScenario {
    /** A provider whose next `complete` answers without a live network. */
    provider: SsoProvider;
    /** The callback, already carrying the stored state/nonce/verifier. */
    callback: SsoCallback;
}

/**
 * What one adapter supplies to be checked against the port.
 *
 * Every factory is called fresh per check and may be async, so an adapter that
 * has to arm a stubbed transport (a mocked `fetch`, a scripted IdP) can do it
 * there rather than sharing one provider across checks.
 */
export interface SsoProviderConformanceCase {
    /** Arms an authorization that should succeed. */
    authorize(): SsoAuthorizeScenario | Promise<SsoAuthorizeScenario>;
    /** Arms a callback that should verify to a profile. */
    happyPath(): SsoCallbackScenario | Promise<SsoCallbackScenario>;
    /**
     * The same callback with the provider's response tampered with — a flipped
     * byte in the code, the assertion, or the signature.
     */
    tampered(): SsoCallbackScenario | Promise<SsoCallbackScenario>;
    /**
     * The same callback where the provider echoed a `nonce` other than the one
     * the core stored — a replayed response from an earlier attempt.
     */
    mismatchedNonce(): SsoCallbackScenario | Promise<SsoCallbackScenario>;
    /**
     * A callback carrying the provider's own refusal (OIDC `error=`, SAML a
     * non-success status) rather than a credential.
     */
    providerError(): SsoCallbackScenario | Promise<SsoCallbackScenario>;
}

/** The checks {@link runSsoProviderConformance} runs, in order. */
export const SSO_PROVIDER_CONFORMANCE_CHECKS = [
    'descriptor-is-stable',
    'descriptor-declares-a-label',
    'authorize-returns-an-absolute-url',
    'authorize-carries-the-core-state',
    'authorize-never-sends-the-code-verifier',
    'complete-returns-a-usable-profile',
    'complete-reports-email-verification-as-a-boolean',
    'complete-subject-is-not-the-email',
    'complete-rejects-a-tampered-response',
    'complete-rejects-a-mismatched-nonce',
    'complete-rejects-a-provider-error'
] as const;

/** One checked clause of {@link SsoProvider}. */
export type SsoProviderConformanceCheck =
    (typeof SSO_PROVIDER_CONFORMANCE_CHECKS)[number];

/**
 * What the kit found: `null` for a check the adapter passed, otherwise the
 * sentence naming what it did instead.
 *
 * A report rather than thrown assertions, so the kit needs no test framework —
 * this package imports nothing, and a caller in any runner turns each entry
 * into one test.
 */
export type SsoProviderConformanceReport = Record<
    SsoProviderConformanceCheck,
    string | null
>;

/** Runs every clause of the port against one adapter and reports the result. */
export async function runSsoProviderConformance(
    testCase: SsoProviderConformanceCase
): Promise<SsoProviderConformanceReport> {
    return {
        'descriptor-is-stable': await descriptorIsStable(testCase),
        'descriptor-declares-a-label': await descriptorHasLabel(testCase),
        'authorize-returns-an-absolute-url':
            await authorizeIsAbsolute(testCase),
        'authorize-carries-the-core-state':
            await authorizeCarriesState(testCase),
        'authorize-never-sends-the-code-verifier':
            await authorizeHidesVerifier(testCase),
        'complete-returns-a-usable-profile':
            await completeReturnsProfile(testCase),
        'complete-reports-email-verification-as-a-boolean':
            await completeReportsVerification(testCase),
        'complete-subject-is-not-the-email': await subjectIsNotEmail(testCase),
        'complete-rejects-a-tampered-response': await rejects(
            testCase.tampered.bind(testCase),
            'a tampered response'
        ),
        'complete-rejects-a-mismatched-nonce': await rejects(
            testCase.mismatchedNonce.bind(testCase),
            'a mismatched nonce'
        ),
        'complete-rejects-a-provider-error': await rejects(
            testCase.providerError.bind(testCase),
            "the provider's own error response"
        )
    };
}

async function descriptorIsStable(
    testCase: SsoProviderConformanceCase
): Promise<string | null> {
    const { provider } = await testCase.authorize();
    const first = provider.descriptor();
    const second = provider.descriptor();
    if (JSON.stringify(first) !== JSON.stringify(second)) {
        return 'descriptor() answered differently on two calls, so a rendered sign-in page and the route table can disagree';
    }
    return null;
}

async function descriptorHasLabel(
    testCase: SsoProviderConformanceCase
): Promise<string | null> {
    const { provider } = await testCase.authorize();
    const { label, kind, callbackMethod } = provider.descriptor();
    if (typeof label !== 'string' || label.trim() === '') {
        return 'descriptor().label is empty, so the sign-in page has no button text';
    }
    if (!['oidc', 'oauth2', 'saml'].includes(kind)) {
        return `descriptor().kind is "${kind}", which is not a protocol this port knows`;
    }
    if (callbackMethod !== 'GET' && callbackMethod !== 'POST') {
        return `descriptor().callbackMethod is "${callbackMethod}", so no callback route can be mounted for it`;
    }
    return null;
}

async function authorizeIsAbsolute(
    testCase: SsoProviderConformanceCase
): Promise<string | null> {
    const { provider, request } = await testCase.authorize();
    const { url } = await provider.authorize(request);
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return `authorize() returned "${url}", which is not an absolute URL a browser can be sent to`;
    }
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
        return `authorize() returned a ${parsed.protocol} URL for a non-local host, so the handshake would cross the network in clear text`;
    }
    return null;
}

async function authorizeCarriesState(
    testCase: SsoProviderConformanceCase
): Promise<string | null> {
    const { provider, request } = await testCase.authorize();
    const { url } = await provider.authorize(request);
    if (!url.includes(request.state)) {
        return 'authorize() dropped the core-minted state, so the callback has nothing to check the response against';
    }
    return null;
}

async function authorizeHidesVerifier(
    testCase: SsoProviderConformanceCase
): Promise<string | null> {
    const { provider, request } = await testCase.authorize();
    const { url } = await provider.authorize(request);
    if (url.includes(request.codeVerifier)) {
        return 'authorize() put the PKCE code verifier in the URL, which hands the browser (and every log between here and the provider) the secret PKCE exists to withhold';
    }
    return null;
}

async function completeReturnsProfile(
    testCase: SsoProviderConformanceCase
): Promise<string | null> {
    const profile = await completeHappy(testCase);
    if (typeof profile === 'string') {
        return profile;
    }
    if (typeof profile.subject !== 'string' || profile.subject.trim() === '') {
        return 'complete() returned an empty subject, which cannot key a link row';
    }
    if (typeof profile.email !== 'string' || profile.email.trim() === '') {
        return 'complete() returned an empty email';
    }
    return null;
}

async function completeReportsVerification(
    testCase: SsoProviderConformanceCase
): Promise<string | null> {
    const profile = await completeHappy(testCase);
    if (typeof profile === 'string') {
        return profile;
    }
    if (typeof profile.emailVerified !== 'boolean') {
        return 'complete() left emailVerified unset, so the core cannot tell a verified address from an unverified one — and that flag is the only gate on claiming an existing account';
    }
    return null;
}

async function subjectIsNotEmail(
    testCase: SsoProviderConformanceCase
): Promise<string | null> {
    const profile = await completeHappy(testCase);
    if (typeof profile === 'string') {
        return profile;
    }
    if (
        profile.subject.trim().toLowerCase() ===
        profile.email.trim().toLowerCase()
    ) {
        return 'complete() used the email address as the subject, so the account follows whoever inherits that address';
    }
    return null;
}

/** Runs the happy path, returning the profile or the sentence that failed. */
async function completeHappy(
    testCase: SsoProviderConformanceCase
): Promise<SsoProfile | string> {
    const { provider, callback } = await testCase.happyPath();
    try {
        return await provider.complete(callback);
    } catch (error) {
        return `complete() threw on the happy path: ${
            error instanceof Error ? error.message : String(error)
        }`;
    }
}

/** Asserts a scenario is refused with {@link SsoVerificationError}. */
async function rejects(
    arm: () => SsoCallbackScenario | Promise<SsoCallbackScenario>,
    label: string
): Promise<string | null> {
    const { provider, callback } = await arm();
    try {
        const profile = await provider.complete(callback);
        return `complete() accepted ${label} and returned a profile for "${profile.subject}" — from the outside, that profile is indistinguishable from a verified one`;
    } catch (error) {
        if (error instanceof SsoVerificationError) {
            return null;
        }
        return `complete() rejected ${label} with ${
            error instanceof Error ? error.name : typeof error
        } rather than SsoVerificationError, so the transport cannot tell a refusal from a fault`;
    }
}
