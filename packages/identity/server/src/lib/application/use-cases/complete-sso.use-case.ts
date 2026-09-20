import { Inject, Injectable, Logger } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import {
    normalizeSsoProfile,
    assertSsoProfile,
    SSO_REGISTRY,
    SSO_ROLE_RESOLVER,
    SsoVerificationError,
    type SsoCallback,
    type SsoProfile,
    type SsoProvider,
    type SsoRegistry,
    type SsoRoleResolver
} from '@orthacms/identity-domain';
import type { DomainEvent } from '@orthacms/database';
import { Optional } from '@nestjs/common';
import {
    IDENTITY_EVENT_KINDS,
    identityEvent
} from '../../domain/events/identity-events';
import type { SessionContext } from '../../domain/session';
import {
    SESSION_REPOSITORY,
    type CreatedSession,
    type SessionRepository
} from '../../domain/session.repository';
import {
    SSO_AUTH_REQUEST_REPOSITORY,
    type SsoAuthRequestRepository
} from '../../domain/sso-auth-request.repository';
import {
    INVITE_REPOSITORY,
    type InviteRepository
} from '../../domain/invite.repository';
import {
    SSO_IDENTITY_REPOSITORY,
    type SsoIdentityRepository
} from '../../domain/sso-identity.repository';
import {
    SSO_PROVISIONING_REPOSITORY,
    type SsoProvisioningRepository
} from '../../domain/sso-provisioning.repository';
import { isProvisionableEmail } from '../../domain/sso-provisioning-policy';
import {
    USER_ACCOUNT_REPOSITORY,
    type UserAccountRepository
} from '../../domain/user-account.repository';
import { UserId } from '../../domain/value-objects/user-id';
import { SsoLoginFailedError } from '../../domain/errors';
import { UserLookupQuery } from '../../infrastructure/queries/user-lookup.query';
import type { IdentityPluginConfig } from '../../types';
import { InjectIdentityConfig } from '../../identity.tokens';
import { ssoCallbackUrl } from '../../sso/sso-settings';

/**
 * The role key an SSO role-mapping handler is never allowed to move an account
 * away from. See {@link CompleteSsoUseCase.applyRoleMapping}.
 */
const ADMIN_ROLE_KEY = 'admin';

/** What the callback route hands in. */
export interface CompleteSsoInput {
    /** The registered provider name from the route. */
    provider: string;
    /** The opaque token from the request cookie, or null when absent. */
    requestToken: string | null;
    /** What the identity provider returned — query params or form body. */
    params: Readonly<Record<string, string>>;
    /** Client metadata for the session row. */
    context?: SessionContext;
}

/** A completed sign-in: the session to set, and where to land. */
export interface CompletedSsoSignIn {
    /** The session cookie value. */
    session: CreatedSession;
    /** The already-validated same-origin path to redirect to. */
    redirectTo: string;
}

/**
 * Finishes an SSO sign-in: burns the attempt, has the adapter verify the
 * provider's response, resolves the account, and opens a session.
 *
 * **The ordering here is the security design, so it is worth reading as one
 * sequence:**
 *
 * 1. The attempt is found by the browser's cookie. No cookie, no attempt, and
 *    no amount of correct-looking response parameters substitutes for one.
 * 2. `state` is compared **before** anything is exchanged, so a forged callback
 *    costs one indexed lookup rather than a round trip to the provider.
 * 3. The attempt is **burned before the exchange**, not after. Burning
 *    afterwards would let a replayed callback drive a second token exchange
 *    before the first finished; burning first means a replay finds nothing.
 *    The cost is that a network failure during the exchange strands the attempt
 *    and the person clicks the button again — the right trade.
 * 4. The exchange itself runs **outside any transaction**. It is a call to a
 *    third party, and holding a write transaction across one is how a slow
 *    identity provider turns into database contention. Same reasoning as
 *    `ResetPasswordUseCase` keeping bcrypt out of its transaction.
 * 5. Only then does one unit of work resolve the account, create or refresh the
 *    link, open the session and append the event — so a link can never outlive
 *    a sign-in that failed. A link that survived a failed sign-in would grant
 *    the *next* attempt a path that skips the verified-email check entirely.
 *
 * **What it will not do (this phase).** It signs in accounts that already
 * exist. It creates none, and it changes nobody's role. Ortha is invite-only by
 * design, and this replaces the credential check rather than the way in.
 *
 * Every failure raises the same {@link SsoLoginFailedError}. The caller is
 * anonymous and the identity provider is not: told apart, these failures would
 * let anyone who can authenticate at a public provider discover which addresses
 * hold Ortha accounts.
 */
@Injectable()
export class CompleteSsoUseCase {
    private readonly logger = new Logger(CompleteSsoUseCase.name);

    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        @Inject(SSO_REGISTRY) private readonly registry: SsoRegistry,
        @Inject(SSO_AUTH_REQUEST_REPOSITORY)
        private readonly requests: SsoAuthRequestRepository,
        @Inject(SSO_IDENTITY_REPOSITORY)
        private readonly identities: SsoIdentityRepository,
        @Inject(SSO_PROVISIONING_REPOSITORY)
        private readonly provisioning: SsoProvisioningRepository,
        @Inject(INVITE_REPOSITORY)
        private readonly invites: InviteRepository,
        // Optional because a deployment that maps no groups binds no handler,
        // which is the default and the common case.
        @Optional()
        @Inject(SSO_ROLE_RESOLVER)
        private readonly resolveRole: SsoRoleResolver | null,
        @Inject(USER_ACCOUNT_REPOSITORY)
        private readonly accounts: UserAccountRepository,
        @Inject(SESSION_REPOSITORY)
        private readonly sessions: SessionRepository,
        private readonly users: UserLookupQuery,
        @InjectIdentityConfig() private readonly config: IdentityPluginConfig
    ) {}

    async execute(input: CompleteSsoInput): Promise<CompletedSsoSignIn> {
        const adapter = this.registry.get(input.provider);

        if (!input.requestToken) {
            throw this.fail('the request cookie was missing');
        }
        const attempt = await this.requests.findPendingByToken(
            input.requestToken
        );
        if (!attempt) {
            throw this.fail('no live attempt matches the request cookie');
        }
        if (attempt.provider !== input.provider) {
            throw this.fail(
                'the attempt was started against a different provider'
            );
        }
        if (input.params['state'] !== attempt.state) {
            throw this.fail('the echoed state is not the one we stored');
        }
        if (!(await this.requests.consume(attempt.id))) {
            throw this.fail('the attempt had already been spent');
        }

        const profile = await this.verify(adapter, {
            params: input.params,
            state: attempt.state,
            nonce: attempt.nonce,
            codeVerifier: attempt.codeVerifier,
            redirectUri: ssoCallbackUrl(this.config, input.provider)
        });

        const session = await this.signIn(
            input.provider,
            profile,
            attempt.inviteTokenHash,
            input.context ?? {}
        );
        return { session, redirectTo: attempt.redirectTo };
    }

    /**
     * Runs the adapter's verification and normalises what comes back.
     *
     * `assertSsoProfile` is not distrust of a specific adapter — it is the
     * check the core *can* make. An empty subject would collide with every
     * other empty subject under the same provider, and a subject that is just
     * the email address is the clause-2 mistake in data rather than in prose.
     */
    private async verify(
        adapter: SsoProvider,
        callback: SsoCallback
    ): Promise<SsoProfile> {
        let profile: SsoProfile;
        try {
            profile = await adapter.complete(callback);
        } catch (error) {
            if (error instanceof SsoVerificationError) {
                throw this.fail(error.reason);
            }
            throw error;
        }
        try {
            assertSsoProfile(profile);
        } catch (error) {
            throw this.fail(
                error instanceof Error ? error.message : String(error)
            );
        }
        return normalizeSsoProfile(profile);
    }

    /**
     * Resolves the account, records the link and any authority change, and
     * opens the session — all in one unit of work.
     *
     * Events are collected rather than appended as they happen, so the whole
     * sign-in produces one ordered batch with one actor. A provisioned account
     * therefore reads as "created, linked, signed in" in the log, in that order,
     * rather than as three unrelated rows.
     */
    private signIn(
        provider: string,
        profile: SsoProfile,
        inviteTokenHash: string | null,
        context: SessionContext
    ): Promise<CreatedSession> {
        return this.uow.run(async () => {
            const events: DomainEvent[] = [];
            const link = await this.identities.findBySubject(
                provider,
                profile.subject
            );

            const account = link
                ? await this.resolveLinked(link.userId)
                : inviteTokenHash
                  ? await this.acceptInvite(
                        provider,
                        profile,
                        inviteTokenHash,
                        events
                    )
                  : await this.claimOrProvision(provider, profile, events);

            if (link) {
                await this.identities.recordLogin(
                    link.id,
                    profile.email,
                    new Date()
                );
            }

            await this.applyRoleMapping(
                provider,
                profile,
                account.userId,
                // A just-provisioned account already had its role decided while
                // it was being created; running the handler again here would
                // ask the same question twice and raise a change event for a
                // role that never moved. An *invited* account is not new in
                // this sense — an administrator chose its role, and a mapping
                // handler is entitled to have an opinion about it.
                events.some(
                    (event) =>
                        event.kind === IDENTITY_EVENT_KINDS.SSO_PROVISIONED
                ),
                events
            );

            const session = await this.sessions.issue(account.userId, context, {
                // Recorded so a back-channel logout can find exactly the
                // sessions this provider session opened — and so one provider's
                // notification can never end sessions opened through another.
                ssoProvider: provider,
                ssoSessionId: profile.sessionId ?? null,
                ...(this.config.sso?.sessionTtlSeconds
                    ? { ttlSeconds: this.config.sso.sessionTtlSeconds }
                    : {})
            });
            events.push(
                identityEvent(IDENTITY_EVENT_KINDS.SIGNED_IN, account.userId, {
                    method: 'sso',
                    provider
                })
            );
            await this.outbox.append(
                attachActor(events, {
                    id: account.userId,
                    email: account.email
                })
            );
            return session;
        });
    }

    /** The account an existing link points at — it must still be usable. */
    private async resolveLinked(
        userId: string
    ): Promise<{ userId: string; email: string }> {
        const account = await this.accounts.findById(UserId.create(userId));
        if (!account) {
            throw this.fail('the linked account no longer exists');
        }
        if (!account.status.isActive) {
            // A `disabled` account with a live link is exactly the case an
            // admin closed the door on. A `pending` one has never accepted its
            // invite, so signing it in here would skip the step that makes an
            // account real.
            throw this.fail(
                `the linked account is ${account.status.value}, not active`
            );
        }
        return { userId, email: account.email.value };
    }

    /**
     * Redeems an invitation with a verified profile instead of a password.
     *
     * The invited person clicks "continue with <provider>" on the accept
     * screen; the token rides along on the attempt row, and this is where it is
     * spent. The account ends up `active` with **no credential of its own** —
     * the identity provider is the only way in, which is exactly what the
     * person chose by using this path.
     *
     * Two checks that are not negotiable:
     *
     * - **The provider must vouch for the address**, as everywhere else here.
     * - **The address must be the one that was invited.** Without this, anyone
     *   holding an invite link could redeem it with an account of their own and
     *   walk away with the role an administrator granted to someone else — the
     *   password path forbids the same thing by only ever collecting a
     *   password, never an email.
     *
     * The invite is burned with the same conditional write the password path
     * uses, before the account is touched, so a link can never activate an
     * account twice.
     */
    private async acceptInvite(
        provider: string,
        profile: SsoProfile,
        inviteTokenHash: string,
        events: DomainEvent[]
    ): Promise<{ userId: string; email: string }> {
        if (!profile.emailVerified) {
            throw this.fail(
                `${provider} did not assert that ${profile.email} is verified`
            );
        }

        const invite =
            await this.invites.findPendingByTokenHash(inviteTokenHash);
        if (!invite) {
            throw this.fail('the invite link is unknown, spent or expired');
        }
        if (invite.email.trim().toLowerCase() !== profile.email) {
            throw this.fail(
                'the invited address is not the one the provider vouched for'
            );
        }
        if (!(await this.invites.consume(invite.tokenId))) {
            throw this.fail('the invite link had already been redeemed');
        }

        const account = await this.accounts.findById(
            UserId.create(invite.userId)
        );
        if (!account || !account.status.isPending) {
            throw this.fail('the invited account is not awaiting acceptance');
        }
        account.activateWithoutCredential();
        await this.accounts.save(account);

        await this.identities.link({
            userId: invite.userId,
            provider,
            subject: profile.subject,
            email: profile.email
        });
        events.push(
            ...account.pullEvents(),
            identityEvent(IDENTITY_EVENT_KINDS.SSO_LINKED, invite.userId, {
                provider
            })
        );
        return { userId: invite.userId, email: account.email.value };
    }

    /**
     * The account a first-time sign-in gets: one that already exists, or — when
     * the deployment opted in — a new one.
     *
     * **A verified address is required either way.** Without it, any provider
     * that lets a person type an unverified address becomes an
     * account-takeover path into every matching Ortha account, and a
     * registration form for every address they can think of.
     */
    private async claimOrProvision(
        provider: string,
        profile: SsoProfile,
        events: DomainEvent[]
    ): Promise<{ userId: string; email: string }> {
        if (!profile.emailVerified) {
            throw this.fail(
                `${provider} did not assert that ${profile.email} is verified`
            );
        }

        const existing = await this.users.credentialsByEmail(profile.email);
        if (existing) {
            if (existing.status !== 'active') {
                throw this.fail(
                    `the account is ${existing.status}, not active`
                );
            }
            await this.identities.link({
                userId: existing.userId,
                provider,
                subject: profile.subject,
                email: profile.email
            });
            events.push(
                identityEvent(
                    IDENTITY_EVENT_KINDS.SSO_LINKED,
                    existing.userId,
                    { provider }
                )
            );
            return { userId: existing.userId, email: existing.email };
        }

        return this.provisionAccount(provider, profile, events);
    }

    /**
     * Creates an account from a verified profile.
     *
     * Off unless the deployment configured it, and then only for the email
     * domains it listed. An identity provider answers for everyone it knows and
     * a public one knows everyone, so "create on first sign-in" with no domain
     * restriction means the internet has an account here — and nothing breaks
     * to say so; the user list simply grows.
     */
    private async provisionAccount(
        provider: string,
        profile: SsoProfile,
        events: DomainEvent[]
    ): Promise<{ userId: string; email: string }> {
        const settings = this.config.sso?.provisioning;
        if (!settings) {
            // The default. Ortha is invite-only, and SSO replaces the
            // credential check rather than the way in.
            throw this.fail('no account holds that address');
        }
        if (!isProvisionableEmail(profile.email, settings.domains)) {
            throw this.fail(
                `${profile.email} is outside the domains this deployment provisions for`
            );
        }

        const requested =
            this.resolveRole?.({
                provider,
                profile,
                isNewAccount: true
            }) ?? null;
        const roleKey = requested ?? settings.defaultRole;
        const roleId = await this.roleIdFor(roleKey, settings.defaultRole);

        const created = await this.provisioning.provision({
            email: profile.email,
            name: profile.name ?? null,
            roleId
        });
        await this.identities.link({
            userId: created.userId,
            provider,
            subject: profile.subject,
            email: profile.email
        });
        events.push(
            identityEvent(
                IDENTITY_EVENT_KINDS.SSO_PROVISIONED,
                created.userId,
                { provider, role: roleKey }
            ),
            identityEvent(IDENTITY_EVENT_KINDS.SSO_LINKED, created.userId, {
                provider
            })
        );
        return created;
    }

    /**
     * Runs the host's role-mapping handler against an account that already
     * existed.
     *
     * Three rules, and each exists because of what its absence would do:
     *
     * - **No handler means no change.** A mapping that ran regardless would
     *   silently undo an administrator's edit on the person's next sign-in,
     *   with nothing in the product to say why it did not stick.
     * - **An unknown role key is logged and ignored**, never a failed sign-in.
     *   A typo in a handler should not lock a whole directory out of the CMS.
     * - **An account holding `admin` is never demoted here.** Administrator is
     *   a deliberate grant and a directory group is not; last-admin protection
     *   lives in the users context and does not run on this path, so without
     *   this rule one group edit could lock every administrator out.
     */
    private async applyRoleMapping(
        provider: string,
        profile: SsoProfile,
        userId: string,
        isNewAccount: boolean,
        events: DomainEvent[]
    ): Promise<void> {
        if (!this.resolveRole || isNewAccount) {
            return;
        }
        const requested = this.resolveRole({
            provider,
            profile,
            isNewAccount: false
        });
        if (!requested) {
            return;
        }

        const current = await this.provisioning.roleKeyOf(userId);
        if (current === ADMIN_ROLE_KEY && requested !== ADMIN_ROLE_KEY) {
            this.logger.warn(
                `SSO role mapping wanted to move an administrator to "${requested}"; refused. Change an administrator's role in the admin, not through a directory group.`
            );
            return;
        }

        const roleId = await this.provisioning.findRoleIdByKey(requested);
        if (!roleId) {
            this.logger.warn(
                `SSO role mapping asked for the role "${requested}", which this deployment does not have. Leaving the account's role unchanged.`
            );
            return;
        }
        if (await this.provisioning.setRole(userId, roleId)) {
            events.push(
                identityEvent(IDENTITY_EVENT_KINDS.SSO_ROLE_MAPPED, userId, {
                    provider,
                    role: requested
                })
            );
        }
    }

    /**
     * The role id for a key, falling back to the configured default when a
     * handler named one that does not exist.
     *
     * @throws When neither resolves — a deployment whose `defaultRole` names no
     *   role cannot provision anybody, and saying so beats creating accounts
     *   against a role chosen at random.
     */
    private async roleIdFor(
        requested: string,
        fallback: string
    ): Promise<string> {
        const roleId = await this.provisioning.findRoleIdByKey(requested);
        if (roleId) {
            return roleId;
        }
        this.logger.warn(
            `SSO provisioning asked for the role "${requested}", which this deployment does not have. Falling back to "${fallback}".`
        );
        const fallbackId = await this.provisioning.findRoleIdByKey(fallback);
        if (!fallbackId) {
            throw this.fail(
                `neither "${requested}" nor the configured default role "${fallback}" exists`
            );
        }
        return fallbackId;
    }

    /** Logs the real reason and returns the one error every caller sees. */
    private fail(reason: string): SsoLoginFailedError {
        this.logger.warn(`SSO sign-in refused: ${reason}`);
        return new SsoLoginFailedError(reason);
    }
}
