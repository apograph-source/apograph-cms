/**
 * The normalised person an {@link SsoProvider} hands back once it has verified
 * the identity provider's response.
 *
 * "Normalised" is the whole point: OIDC calls it `sub`, SAML calls it a
 * `NameID`, GitHub calls it a numeric `id`, and each spells the email and the
 * verification flag differently. Collapsing them here is what lets the account
 * resolution rules be written once instead of per vendor.
 */
export interface SsoProfile {
    /**
     * The identity provider's stable, issuer-scoped identifier for this person.
     *
     * **Never the email address.** People change email addresses, and a link
     * keyed on one silently hands the account to whoever inherits it. The link
     * table's unique key is `(provider, subject)` for exactly this reason.
     */
    subject: string;
    /**
     * The email the provider reports, lower-cased by the adapter. Used for
     * display, and — only when {@link emailVerified} is true — to claim an
     * account that already exists.
     */
    email: string;
    /**
     * Whether the identity provider asserts it has verified {@link email}.
     *
     * This must report what the provider actually claimed. An adapter that
     * defaults it to `true` turns "sign in with your work account" into "sign
     * in with any account that types the right address", because it is the sole
     * gate on linking to an existing user.
     */
    emailVerified: boolean;
    /** Display name, when the provider supplies one. */
    name?: string | null;
    /**
     * Group / role claims, when the provider supplies them. Untouched by the
     * core until a host configures a role-mapping handler — the CMS never
     * infers authority from a claim nobody asked it to read.
     */
    groups?: readonly string[];
    /**
     * The provider's own session identifier (`sid` in OIDC, `SessionIndex` in
     * SAML), when it issues one. Recorded so a back-channel logout can find the
     * Ortha sessions a given provider session opened.
     */
    sessionId?: string | null;
}

/** The failure {@link assertSsoProfile} reports, naming the offending field. */
export class MalformedSsoProfileError extends Error {
    constructor(reason: string) {
        super(`The identity provider returned an unusable profile: ${reason}.`);
        this.name = 'MalformedSsoProfileError';
    }
}

/**
 * Checks the parts of {@link SsoProfile} the core *can* check.
 *
 * It cannot verify a signature on the core's behalf — that is the adapter's
 * first clause — but it can refuse a profile whose shape would corrupt the link
 * table: an empty subject (which would collide with every other empty subject
 * under the same provider), an empty email, or a subject that is simply the
 * email address, which is the clause-2 mistake stated as data rather than prose.
 *
 * @throws MalformedSsoProfileError when the profile cannot be safely stored.
 */
export function assertSsoProfile(profile: SsoProfile): void {
    if (typeof profile.subject !== 'string' || profile.subject.trim() === '') {
        throw new MalformedSsoProfileError('the subject is empty');
    }
    if (typeof profile.email !== 'string' || profile.email.trim() === '') {
        throw new MalformedSsoProfileError('the email is empty');
    }
    if (typeof profile.emailVerified !== 'boolean') {
        throw new MalformedSsoProfileError(
            'emailVerified is not a boolean, so the provider reported nothing about it'
        );
    }
    if (
        profile.subject.trim().toLowerCase() ===
        profile.email.trim().toLowerCase()
    ) {
        throw new MalformedSsoProfileError(
            'the subject is the email address, which is not a stable identifier'
        );
    }
}

/**
 * The profile with its email lower-cased and its strings trimmed — the form the
 * link table and the account lookup both expect.
 *
 * Applied by the core after {@link assertSsoProfile}, so an adapter that forgets
 * to normalise cannot produce a second link row for the same person by
 * capitalising their address differently.
 */
export function normalizeSsoProfile(profile: SsoProfile): SsoProfile {
    return {
        ...profile,
        subject: profile.subject.trim(),
        email: profile.email.trim().toLowerCase(),
        name: profile.name?.trim() || null
    };
}
