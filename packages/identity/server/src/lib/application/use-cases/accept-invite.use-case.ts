import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
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
    INVITE_REPOSITORY,
    type InviteRepository
} from '../../domain/invite.repository';
import {
    USER_ACCOUNT_REPOSITORY,
    type UserAccountRepository
} from '../../domain/user-account.repository';
import { UserId } from '../../domain/value-objects/user-id';
import { PasswordHash } from '../../domain/value-objects/password-hash';
import { InvalidInviteTokenError } from '../../domain/errors';
import { HashingService } from '../../auth/services/hashing.service';

/**
 * Accepts an invite: burns the one-time token, sets the invitee's first
 * credential, activates the account, and opens their session — all in one unit
 * of work, so a failure anywhere leaves the invite still usable rather than
 * stranding a `pending` account with a spent link.
 *
 * The account's email, name, and role were fixed by the inviting admin; the
 * invitee supplies only a password, so this touches neither the identity nor
 * the authorization the admin granted.
 *
 * Emits the aggregate's `user.activated` alongside `auth.signed_in` to the
 * transactional outbox, with the new user as their own actor — the same shape
 * {@link LoginUseCase} uses, so the audit trail reads consistently.
 *
 * Every failure raises the same {@link InvalidInviteTokenError}; the controller
 * maps it to one generic 404.
 */
@Injectable()
export class AcceptInviteUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly hashing: HashingService,
        @Inject(INVITE_REPOSITORY)
        private readonly invites: InviteRepository,
        @Inject(USER_ACCOUNT_REPOSITORY)
        private readonly accounts: UserAccountRepository,
        @Inject(SESSION_REPOSITORY)
        private readonly sessions: SessionRepository
    ) {}

    /**
     * Redeems `rawToken` with `password`, returning the session to set as a
     * cookie so the invitee lands signed in rather than at a login form.
     */
    async execute(
        rawToken: string,
        password: string,
        context: SessionContext = {}
    ): Promise<CreatedSession> {
        const tokenHash = this.hashing.hashToken(rawToken);

        return this.uow.run(async () => {
            const invite = await this.invites.findPendingByTokenHash(tokenHash);
            if (!invite) {
                throw new InvalidInviteTokenError();
            }

            // Burn the token before doing any work with it. The conditional
            // write is the one-time guarantee: a concurrent accept of the same
            // link gets `false` here and is rejected, so a link can never
            // activate an account twice.
            if (!(await this.invites.consume(invite.tokenId))) {
                throw new InvalidInviteTokenError();
            }

            const account = await this.accounts.findById(
                UserId.create(invite.userId)
            );
            // A live token whose account is gone or already active is an
            // inconsistent state, not a distinguishable one — same error.
            if (!account || !account.status.isPending) {
                throw new InvalidInviteTokenError();
            }

            // Hashed only once the token is known good, so an invalid link
            // costs no bcrypt work (the rate limit is the outer defense).
            const passwordHash = PasswordHash.create(
                await this.hashing.hashPassword(password)
            );
            account.activate(passwordHash);
            await this.accounts.save(account);

            const session = await this.sessions.issue(invite.userId, context);
            await this.outbox.append(
                attachActor(
                    [
                        ...account.pullEvents(),
                        identityEvent(
                            IDENTITY_EVENT_KINDS.SIGNED_IN,
                            invite.userId
                        )
                    ],
                    { id: invite.userId, email: invite.email }
                )
            );
            return session;
        });
    }
}
