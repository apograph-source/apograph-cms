import type {
    SsoRoleContext,
    SsoRoleResolver
} from '@orthacms/identity-domain';
import {
    createFakeSsoProvider,
    type FakeSsoProvider
} from '@orthacms/identity-provider-fake';

/** The scripted people the e2e identity provider can sign in. */
export const SSO_SUBJECTS = {
    /** Matches a seeded, active account by verified email. */
    linked: 'idp-subject-linked',
    /** Matches a seeded account, but the provider will not vouch for the address. */
    unverified: 'idp-subject-unverified',
    /** Verified, but no Ortha account holds the address. */
    stranger: 'idp-subject-stranger',
    /**
     * Verified, no account — and in a domain that merely *ends with* an allowed
     * one. `evil-example.com` passes a naive `endsWith('example.com')` and must
     * fail an exact domain match, which is the whole of the just-in-time
     * provisioning rule.
     */
    suffix: 'idp-subject-suffix'
} as const;

/** The addresses those subjects report. Suites seed accounts against them. */
export const SSO_EMAILS = {
    linked: 'sso-linked@example.com',
    unverified: 'sso-unverified@example.com',
    stranger: 'sso-stranger@example.com',
    suffix: 'sso-suffix@evil-example.com'
} as const;

/**
 * The identity provider the e2e app boots with — scripted, offline, and a real
 * verifier (it signs its own responses, so tampering is refused by code rather
 * than by assumption).
 *
 * Constructed at module scope and shared, like the copilot's fake model
 * providers, because `buildTestPlugins` needs the same instance a suite drives
 * with `signInAs`.
 */
export const fakeSsoProvider: FakeSsoProvider = createFakeSsoProvider({
    label: 'Fake IdP',
    users: [
        {
            subject: SSO_SUBJECTS.linked,
            email: SSO_EMAILS.linked,
            name: 'SSO Linked'
        },
        {
            subject: SSO_SUBJECTS.unverified,
            email: SSO_EMAILS.unverified,
            emailVerified: false,
            name: 'SSO Unverified'
        },
        {
            subject: SSO_SUBJECTS.stranger,
            email: SSO_EMAILS.stranger,
            name: 'SSO Stranger'
        },
        {
            subject: SSO_SUBJECTS.suffix,
            email: SSO_EMAILS.suffix,
            name: 'SSO Lookalike'
        }
    ]
});

/**
 * The role-mapping handler for the current test, or `null` for "map nothing" —
 * the default and the shipped behaviour.
 *
 * Module scope, with a stable delegating handler registered once, for the same
 * reason the copilot's fake model provider is a facade: the plugin list is
 * built once per spec **file**, while each test needs its own answer.
 */
let roleScript: SsoRoleResolver | null = null;

/** Script the role-mapping handler for one test. */
export function scriptSsoRole(resolver: SsoRoleResolver | null): void {
    roleScript = resolver;
}

/** Clear the script — called between tests, like `resetDb`. */
export function resetSsoRole(): void {
    roleScript = null;
}

/**
 * The handler registered with `IdentityPlugin`. Always present, so the wiring
 * is exercised on every boot; answers `null` unless a test scripted something,
 * which is exactly what "no handler configured" means to the use case.
 */
export const ssoRoleResolver: SsoRoleResolver = (context: SsoRoleContext) =>
    roleScript ? roleScript(context) : null;
