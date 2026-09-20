import { Inject, Injectable, Logger } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import {
    SSO_REGISTRY,
    SsoVerificationError,
    type SsoRegistry
} from '@orthacms/identity-domain';
import {
    IDENTITY_EVENT_KINDS,
    identityEvent
} from '../../domain/events/identity-events';
import {
    SESSION_REPOSITORY,
    type SessionRepository
} from '../../domain/session.repository';
import {
    SSO_IDENTITY_REPOSITORY,
    type SsoIdentityRepository
} from '../../domain/sso-identity.repository';
import { SsoLogoutFailedError } from '../../domain/errors';
import { UserLookupQuery } from '../../infrastructure/queries/user-lookup.query';

/** What the back-channel route hands in. */
export interface BackchannelLogoutInput {
    /** The registered provider name from the route. */
    provider: string;
    /** The `logout_token` the provider posted. */
    token: string | null;
}

/**
 * Ends Ortha sessions because the identity provider says the person's session
 * there has ended.
 *
 * **This is the answer to the one thing operators assume SSO already does.** A
 * session in this CMS is a row with a TTL; disabling somebody in the directory
 * does not reach it, so until this existed the honest answer to "we offboarded
 * them, are they out?" was "within `SESSION_TTL_SECONDS`". The provider calls
 * this endpoint directly, with no browser in the loop, which is why it works
 * after the person has closed the tab — and why it is the only mechanism that
 * ends access promptly.
 *
 * Two shapes of notification, and the difference is deliberate:
 *
 * - **A `sid`** names one provider session, and only the Ortha sessions opened
 *   from it are revoked. Someone signed in on a laptop and a phone through two
 *   separate provider sessions keeps the other one, which is what "you signed
 *   out of this browser" should mean.
 * - **A `sub` with no `sid`** ends every session the linked account holds. That
 *   is the offboarding case, and being blunt is the point.
 *
 * **Verification is the adapter's**, and an adapter that cannot verify does not
 * implement the method — the route then answers `404` rather than pretending to
 * have acted. This endpoint is unauthenticated and reachable by anyone, so an
 * unverified notification would be an open way to sign arbitrary people out.
 */
@Injectable()
export class SsoBackchannelLogoutUseCase {
    private readonly logger = new Logger(SsoBackchannelLogoutUseCase.name);

    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        @Inject(SSO_REGISTRY) private readonly registry: SsoRegistry,
        @Inject(SESSION_REPOSITORY)
        private readonly sessions: SessionRepository,
        @Inject(SSO_IDENTITY_REPOSITORY)
        private readonly identities: SsoIdentityRepository,
        private readonly users: UserLookupQuery
    ) {}

    /** @returns how many live sessions were revoked. */
    async execute(input: BackchannelLogoutInput): Promise<number> {
        const adapter = this.registry.get(input.provider);
        if (!adapter.verifyLogoutToken) {
            throw new SsoLogoutFailedError(
                `${input.provider} does not support back-channel logout`
            );
        }
        if (!input.token) {
            throw this.fail('the request carried no logout token');
        }

        let notice;
        try {
            notice = await adapter.verifyLogoutToken(input.token);
        } catch (error) {
            if (error instanceof SsoVerificationError) {
                throw this.fail(error.reason);
            }
            throw error;
        }

        if (notice.sessionId) {
            return this.revokeBySession(input.provider, notice.sessionId);
        }
        if (notice.subject) {
            return this.revokeBySubject(input.provider, notice.subject);
        }
        throw this.fail(
            'the logout token named neither a session nor a subject, so there is nothing to end'
        );
    }

    /** The precise case: one provider session, and only what it opened. */
    private async revokeBySession(
        provider: string,
        ssoSessionId: string
    ): Promise<number> {
        const revoked = await this.sessions.revokeBySsoSession(
            provider,
            ssoSessionId
        );
        this.logger.log(
            `Back-channel logout from ${provider} ended ${revoked} session(s).`
        );
        return revoked;
    }

    /**
     * The blunt case: everything the linked account holds.
     *
     * A subject with no link is **not an error**. A provider legitimately
     * notifies about people who never signed in here, and answering anything
     * other than "fine, nothing to do" would turn this endpoint into an oracle
     * for which of a directory's members hold accounts in this CMS.
     */
    private async revokeBySubject(
        provider: string,
        subject: string
    ): Promise<number> {
        const link = await this.identities.findBySubject(provider, subject);
        if (!link) {
            this.logger.log(
                `Back-channel logout from ${provider} named a subject with no account here; nothing to end.`
            );
            return 0;
        }

        return this.uow.run(async () => {
            const revoked = await this.sessions.revokeAllForUser(link.userId);
            if (revoked > 0) {
                const email = await this.users.emailById(link.userId);
                await this.outbox.append(
                    attachActor(
                        [
                            identityEvent(
                                IDENTITY_EVENT_KINDS.SIGNED_OUT,
                                link.userId,
                                { method: 'sso_backchannel', provider }
                            )
                        ],
                        // The address as a snapshot, or nothing — never an
                        // empty string. `EventActor.email` is nullable, the
                        // log's `actor_email` column is nullable, and every
                        // other producer passes the null through; `''` is a
                        // third value none of them expect, and it renders in
                        // the activity table as a blank cell rather than as
                        // the "Unknown" an absent address is meant to show.
                        { id: link.userId, email }
                    )
                );
            }
            this.logger.log(
                `Back-channel logout from ${provider} ended ${revoked} session(s) for the linked account.`
            );
            return revoked;
        });
    }

    /** Logs the real reason and returns the one error every caller sees. */
    private fail(reason: string): SsoLogoutFailedError {
        this.logger.warn(`Back-channel logout refused: ${reason}`);
        return new SsoLogoutFailedError(reason);
    }
}
