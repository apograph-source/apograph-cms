import {
    SsoVerificationError,
    type SsoProfile
} from '@orthacms/identity-domain';
import type { ResolvedOidcConfig } from './config';

/** An identity token's verified payload, as far as this adapter reads it. */
export type IdTokenClaims = Record<string, unknown>;

/**
 * Turns verified claims into the normalised profile the CMS resolves accounts
 * with.
 *
 * Every decision here is about being **faithful** rather than convenient: the
 * subject is `sub` and only `sub`, the email is whichever configured claim is
 * present first, and `email_verified` is reported exactly as the provider sent
 * it. The one place an operator can influence the answer is
 * `emailVerifiedWhenAbsent`, and only when the claim is missing entirely.
 */
export function toProfile(
    claims: IdTokenClaims,
    config: ResolvedOidcConfig
): SsoProfile {
    const subject = claims['sub'];
    if (typeof subject !== 'string' || subject === '') {
        throw new SsoVerificationError(
            'the identity token carries no `sub`, so there is nothing stable to key a link on'
        );
    }

    const email = firstString(claims, config.emailClaims);
    if (!email) {
        throw new SsoVerificationError(
            `the identity token carries no address in ${config.emailClaims.join(
                ', '
            )} — request the "email" scope, or point emailClaims at the claim this provider uses`
        );
    }

    return {
        subject,
        email,
        emailVerified: readEmailVerified(claims, config),
        name: readName(claims),
        ...(config.groupsClaim
            ? { groups: readGroups(claims[config.groupsClaim]) }
            : {}),
        sessionId: typeof claims['sid'] === 'string' ? claims['sid'] : null
    };
}

/**
 * Whether the provider vouches for the address.
 *
 * Three cases, and the middle one is the whole point:
 *
 * - the claim is present and boolean → that value, always, including `false`;
 * - the claim is present as the string `"true"`/`"false"` → some providers send
 *   it that way, and reading `"false"` as truthy would be the worst possible
 *   parsing bug to have here;
 * - the claim is absent → `emailVerifiedWhenAbsent`, which defaults to `false`
 *   and can only be turned on by an operator asserting that their directory is
 *   authoritative.
 */
function readEmailVerified(
    claims: IdTokenClaims,
    config: ResolvedOidcConfig
): boolean {
    const raw = claims['email_verified'];
    if (typeof raw === 'boolean') {
        return raw;
    }
    if (raw === 'true') {
        return true;
    }
    if (raw === 'false') {
        return false;
    }
    return config.emailVerifiedWhenAbsent;
}

/** A display name from the usual claims, or `null`. */
function readName(claims: IdTokenClaims): string | null {
    const name = claims['name'];
    if (typeof name === 'string' && name.trim()) {
        return name.trim();
    }
    const given = claims['given_name'];
    const family = claims['family_name'];
    const joined = [given, family]
        .filter(
            (part): part is string => typeof part === 'string' && !!part.trim()
        )
        .join(' ')
        .trim();
    return joined || null;
}

/**
 * Group claims, normalised to a string array.
 *
 * Providers disagree on the shape: an array (the common case), a single string
 * (one group), or a space-separated string (a few). Anything else is dropped
 * rather than coerced — a group list nobody can read is safer empty than
 * guessed at, because the next phase maps these to roles.
 */
function readGroups(raw: unknown): string[] {
    if (Array.isArray(raw)) {
        return raw.filter((item): item is string => typeof item === 'string');
    }
    if (typeof raw === 'string' && raw.trim()) {
        return raw.trim().split(/\s+/);
    }
    return [];
}

/** The first configured claim that holds a non-empty string, lower-cased. */
function firstString(
    claims: IdTokenClaims,
    names: readonly string[]
): string | null {
    for (const name of names) {
        const value = claims[name];
        if (typeof value === 'string' && value.trim()) {
            return value.trim().toLowerCase();
        }
    }
    return null;
}
