import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import { UserId } from '../../domain/value-objects/user-id';
import { PasswordHash } from '../../domain/value-objects/password-hash';
import { UserAccountNotFoundError } from '../../domain/errors';
import {
    USER_ACCOUNT_REPOSITORY,
    type UserAccountRepository
} from '../../domain/user-account.repository';
import {
    SESSION_REPOSITORY,
    type SessionRepository
} from '../../domain/session.repository';
import { HashingService } from '../../auth/services/hashing.service';

/** Options narrowing what a credential change does beyond setting the hash. */
export interface ChangePasswordOptions {
    /**
     * The session row id (the token's SHA-256) to spare from the revocation —
     * the caller's own device, so a user changing their password from a
     * signed-in session is not logged out of the one they are using. Omit to
     * revoke **every** session, which is what an administrative reset wants.
     */
    keepSessionId?: string;
}

/**
 * Changes a user account's password. Loads the {@link UserAccount} aggregate,
 * applies {@link UserAccount.changeCredential} (which enforces the "not while
 * disabled" invariant and raises `user.password_changed`), persists it, revokes
 * the account's live sessions, and drains the event to the outbox — all in one
 * unit of work.
 *
 * **The revocation is part of the operation, not a nicety.** A session is a
 * bearer credential the old password opened, and it outlives that password by
 * its full TTL: without this, someone changing their password because it was
 * phished or shoulder-surfed would leave every session the attacker already
 * holds signed in for up to a week. Rotating the credential has to evict what
 * the previous credential authorized, and it has to happen in the same
 * transaction as the hash write, or a failure between the two leaves the
 * account in the worst combination — new password, old sessions.
 *
 * `keepSessionId` spares the caller's own session so the common self-service
 * case does not sign the user out of the device they are standing at.
 *
 * The `user.password_changed` event carries the actor, and the activity
 * plugin's audit subscriber turns it into a `user.password_changed` audit row —
 * a credential rotation is exactly the kind of event a security review reads
 * the log for.
 *
 * No HTTP route wires this yet (password reset / self-service change land in a
 * later ticket); it is the aggregate's credential-change flow, ready for that
 * controller.
 */
@Injectable()
export class ChangePasswordUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly hashing: HashingService,
        @Inject(USER_ACCOUNT_REPOSITORY)
        private readonly accounts: UserAccountRepository,
        @Inject(SESSION_REPOSITORY)
        private readonly sessions: SessionRepository
    ) {}

    /**
     * Hashes `newPassword`, sets it as `userId`'s credential, and revokes the
     * account's live sessions (all but `options.keepSessionId`).
     *
     * @returns How many sessions were revoked.
     * @throws UserAccountNotFoundError when `userId` names no account.
     * @throws PasswordTooLongError when `newPassword` exceeds bcrypt's byte
     * bound — hashing refuses rather than truncating.
     */
    async execute(
        userId: string,
        newPassword: string,
        options: ChangePasswordOptions = {}
    ): Promise<number> {
        const id = UserId.create(userId);
        // Hash outside the transaction: bcrypt at cost 12 takes ~250ms, and
        // holding a write transaction open for it would pin a connection and
        // lock the row for the duration.
        const passwordHash = PasswordHash.create(
            await this.hashing.hashPassword(newPassword)
        );

        return this.uow.run(async () => {
            const account = await this.accounts.findById(id);
            if (!account) {
                throw new UserAccountNotFoundError(userId);
            }
            account.changeCredential(passwordHash);
            await this.accounts.save(account);
            const revoked = await this.sessions.revokeAllForUser(userId, {
                exceptSessionId: options.keepSessionId
            });
            // The account holder is their own actor for a self-service change;
            // an administrative reset will pass its own once a route exists.
            // The eviction count rides along so the audit row can state it —
            // the aggregate raised the event without it, having no idea sessions
            // exist.
            const events = account.pullEvents().map((event) => ({
                ...event,
                payload: { ...event.payload, sessionsRevoked: revoked }
            }));
            await this.outbox.append(
                attachActor(events, {
                    id: userId,
                    email: account.email.value
                })
            );
            return revoked;
        });
    }
}
