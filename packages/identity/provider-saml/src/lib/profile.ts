import {
    SsoVerificationError,
    type SsoProfile
} from '@orthacms/identity-domain';
import {
    DEFAULT_EMAIL_ATTRIBUTES,
    DEFAULT_NAME_ATTRIBUTES,
    type ResolvedSamlConfig
} from './config';

/** The parts of a validated SAML profile this adapter reads. */
export interface SamlAssertionProfile {
    /** The `NameID`. */
    nameID?: unknown;
    /** Its format URI — `transient` is refused; see below. */
    nameIDFormat?: unknown;
    /** The IdP's session identifier, for back-channel logout. */
    sessionIndex?: unknown;
    /** Everything else the assertion carried, keyed by attribute name. */
    attributes?: Record<string, unknown>;
    /** node-saml also lifts some attributes onto the profile itself. */
    [key: string]: unknown;
}

/** The `NameID` format that is explicitly *not* stable. */
const TRANSIENT_FORMAT = 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient';

/**
 * Turns a validated assertion into the normalised profile the CMS resolves
 * accounts with.
 *
 * Separated from the adapter so it can be tested exhaustively without a signed
 * assertion: signature validation belongs to `@node-saml/node-saml` and is not
 * re-implemented here, but *which field means what* is this adapter's own
 * decision and is where the interesting mistakes live. SAML's attribute names
 * differ per identity provider more than anything else about it does.
 */
export function toProfile(
    assertion: SamlAssertionProfile,
    config: ResolvedSamlConfig
): SsoProfile {
    const subject = readSubject(assertion, config);
    const email = readEmail(assertion, config);

    if (!email) {
        throw new SsoVerificationError(
            `the assertion carried no email attribute. Configure emailAttribute to name the one your identity provider sends.`
        );
    }
    if (subject.toLowerCase() === email) {
        // The core refuses this too, but naming the fix here is what turns a
        // blank "sign-in did not complete" into something an operator can act
        // on: the NameID format is `emailAddress`, and an address follows a
        // person's mailbox rather than the person.
        throw new SsoVerificationError(
            'the NameID is the email address, which is not a stable identifier. Configure the identity provider to send a persistent NameID, or set subjectAttribute to an immutable directory id.'
        );
    }

    return {
        subject,
        email,
        // No claim exists to read — see `SamlProviderConfig.emailVerified`.
        // This is the operator's assertion, reported faithfully as such.
        emailVerified: config.emailVerified,
        name: readName(assertion, config),
        ...(config.groupsAttribute
            ? {
                  groups: readGroups(
                      attribute(assertion, config.groupsAttribute)
                  )
              }
            : {}),
        sessionId:
            typeof assertion.sessionIndex === 'string'
                ? assertion.sessionIndex
                : null
    };
}

/** The stable identifier: a configured attribute, or the `NameID`. */
function readSubject(
    assertion: SamlAssertionProfile,
    config: ResolvedSamlConfig
): string {
    if (config.subjectAttribute) {
        const value = attribute(assertion, config.subjectAttribute);
        const subject = firstString([value]);
        if (!subject) {
            throw new SsoVerificationError(
                `the assertion carried no "${config.subjectAttribute}" attribute to key this person on`
            );
        }
        return subject;
    }

    if (assertion.nameIDFormat === TRANSIENT_FORMAT) {
        // A transient NameID is a different value on every sign-in — that is
        // its entire purpose. Keying a link on one would create a new link, and
        // a new account under provisioning, every single time.
        throw new SsoVerificationError(
            'the identity provider sent a transient NameID, which is a different value on every sign-in. Configure a persistent NameID, or set subjectAttribute.'
        );
    }
    const nameId = firstString([assertion.nameID]);
    if (!nameId) {
        throw new SsoVerificationError(
            'the assertion carried no NameID and no subjectAttribute is configured'
        );
    }
    return nameId;
}

/** The address, from the configured attribute or the usual spellings. */
function readEmail(
    assertion: SamlAssertionProfile,
    config: ResolvedSamlConfig
): string | null {
    const names = config.emailAttribute
        ? [config.emailAttribute]
        : DEFAULT_EMAIL_ATTRIBUTES;
    const found = firstString(names.map((name) => attribute(assertion, name)));
    if (found) {
        return found.toLowerCase();
    }
    // Last resort: some identity providers put the address in the NameID and
    // send no attribute at all. Only usable when it actually looks like one.
    const nameId = firstString([assertion.nameID]);
    return nameId?.includes('@') ? nameId.toLowerCase() : null;
}

/** A display name, or `null`. */
function readName(
    assertion: SamlAssertionProfile,
    config: ResolvedSamlConfig
): string | null {
    const names = config.nameAttribute
        ? [config.nameAttribute]
        : DEFAULT_NAME_ATTRIBUTES;
    return firstString(names.map((name) => attribute(assertion, name)));
}

/**
 * One attribute, looked for in both places node-saml puts them: the
 * `attributes` bag, and lifted onto the profile itself.
 */
function attribute(assertion: SamlAssertionProfile, name: string): unknown {
    return assertion.attributes?.[name] ?? assertion[name];
}

/**
 * Group membership, normalised.
 *
 * A SAML attribute with one value arrives as a string and with several as an
 * array — the same attribute, two shapes, depending on how many groups the
 * person happens to be in. Anything else is dropped rather than coerced: a
 * group list nobody can read is safer empty than guessed at, because a
 * role-mapping handler acts on it.
 */
function readGroups(raw: unknown): string[] {
    if (Array.isArray(raw)) {
        return raw.filter((item): item is string => typeof item === 'string');
    }
    return typeof raw === 'string' && raw.trim() ? [raw.trim()] : [];
}

/** The first non-empty string among `values`, trimmed. */
function firstString(values: readonly unknown[]): string | null {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
        if (Array.isArray(value)) {
            const first = value.find(
                (item): item is string =>
                    typeof item === 'string' && !!item.trim()
            );
            if (first) {
                return first.trim();
            }
        }
    }
    return null;
}
