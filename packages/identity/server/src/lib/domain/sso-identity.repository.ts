/** A stored link between an Ortha account and a provider identity. */
export interface SsoIdentityLink {
    /** The link row's id. */
    id: string;
    /** The account this identity signs in. */
    userId: string;
    /** The provider's registered name. */
    provider: string;
    /** The provider's stable identifier for the person. */
    subject: string;
}

/** What a new link needs. */
export interface LinkSsoIdentityInput {
    /** The account to link. */
    userId: string;
    /** The provider's registered name. */
    provider: string;
    /** The provider's stable identifier for the person. */
    subject: string;
    /** The address the provider reported, lower-cased. Display only. */
    email: string;
}

/**
 * The persistence **port** for SSO identity links.
 *
 * Deliberately narrow for the seam: find one, create one, and record that it
 * was used. Listing and unlinking arrive with the admin surface that needs
 * them, rather than as unused methods a reader has to check for callers.
 */
export interface SsoIdentityRepository {
    /**
     * The link for `(provider, subject)`, or `null` when this person has never
     * signed in here. The sign-in lookup — and the only one, because a link is
     * never found by email.
     */
    findBySubject(
        provider: string,
        subject: string
    ): Promise<SsoIdentityLink | null>;

    /**
     * Creates a link. Joins the calling use case's transaction, so a link and
     * the session it opened commit together.
     *
     * The `(provider, subject)` and `(provider, user_id)` unique indexes are
     * what make this safe against two simultaneous first sign-ins: the loser
     * gets a constraint violation rather than a second row, which is the right
     * outcome and the reason the adapter does not check-then-insert.
     */
    link(input: LinkSsoIdentityInput): Promise<SsoIdentityLink>;

    /**
     * Stamps `lastLoginAt` and refreshes the recorded address on an existing
     * link. Called on every sign-in through it, so an operator can tell a live
     * link from one nobody has used since it was created.
     */
    recordLogin(id: string, email: string, at: Date): Promise<void>;
}

/**
 * DI token the infrastructure adapter binds to an {@link SsoIdentityRepository}.
 * A plain `Symbol`, so the domain declares it without importing `@nestjs/*`.
 */
export const SSO_IDENTITY_REPOSITORY = Symbol('SSO_IDENTITY_REPOSITORY');
