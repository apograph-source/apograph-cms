import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import {
    PASSWORD_RESET_REPOSITORY,
    type PasswordResetRepository
} from '../../domain/password-reset.repository';
import {
    SESSION_REPOSITORY,
    type SessionRepository
} from '../../domain/session.repository';
import {
    USER_ACCOUNT_REPOSITORY,
    type UserAccountRepository
} from '../../domain/user-account.repository';
import { UserId } from '../../domain/value-objects/user-id';
import { PasswordHash } from '../../domain/value-objects/password-hash';
import { InvalidResetTokenError } from '../../domain/errors';
import { HashingService } from '../../auth/services/hashing.service';

/**
 * Redeems a password-reset link: burns the one-time token, writes the new
 * credential, and revokes **every** live session the account holds — all in one
 * unit of work, so a failure anywhere leaves the link still usable rather than
 * stranding an account whose reset half-happened.
 *
 * **The revocation is the point, not a side effect.** A reset exists for the
 * case where the old credential can no longer be trusted, and a session is a
 * bearer credential that *the old password opened* — it outlives that password
 * by its full TTL. Setting a new password without evicting them would leave
 * whoever prompted the reset signed in for up to a week.
 *
 * Unlike {@link AcceptInviteUseCase}, this issues **no** session: someone who
 * has just proven only that they hold a link should land on the sign-in form
 * and use the credential they set. It is also why no session is spared from the
 * revocation — there is no "caller's own device" here.
 *
 * Only an `active` account can be reset. A `pending` one has no credential to
 * rotate (it is finished through the invite flow) and a `disabled` one is
 * locked out by design — resetting it would quietly restore a sign-in path an
 * admin deliberately closed. Both collapse into the same
 * {@link InvalidResetTokenError} as a dead token, so the endpoint reveals
 * nothing about the account behind a link.
 */
@Injectable()
export class ResetPasswordUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly hashing: HashingService,
        @Inject(PASSWORD_RESET_REPOSITORY)
        private readonly resets: PasswordResetRepository,
        @Inject(USER_ACCOUNT_REPOSITORY)
        private readonly accounts: UserAccountRepository,
        @Inject(SESSION_REPOSITORY)
        private readonly sessions: SessionRepository
    ) {}

    /**
     * Redeems `rawToken`, setting `password` as the account's credential.
     *
     * @returns How many live sessions the reset evicted.
     * @throws InvalidResetTokenError for every failure mode, indistinguishably.
     */
    async execute(rawToken: string, password: string): Promise<number> {
        const tokenHash = this.hashing.hashToken(rawToken);

        // Pre-check outside the transaction, then hash, then re-check under it.
        // Two costs are being balanced: bcrypt at cost 12 takes ~250ms, so
        // hashing *inside* the transaction would pin a connection and hold the
        // row lock for the duration, while hashing *before* looking at the token
        // would let anyone spend that CPU with a junk link. Reading first buys
        // both — a bogus token is rejected for the price of one indexed lookup,
        // and the transaction stays short. The read is advisory only: the
        // conditional `consume` below is what actually makes the link one-time,
        // so a token consumed in the gap still loses there.
        if (!(await this.resets.findPendingByTokenHash(tokenHash))) {
            throw new InvalidResetTokenError();
        }

        const passwordHash = PasswordHash.create(
            await this.hashing.hashPassword(password)
        );

        return this.uow.run(async () => {
            const reset = await this.resets.findPendingByTokenHash(tokenHash);
            if (!reset) {
                throw new InvalidResetTokenError();
            }

            // Burn the token before doing any work with it. The conditional
            // write is the one-time guarantee: a concurrent submission of the
            // same link gets `false` here and is rejected.
            if (!(await this.resets.consume(reset.tokenId))) {
                throw new InvalidResetTokenError();
            }

            const account = await this.accounts.findById(
                UserId.create(reset.userId)
            );
            // A live token whose account is gone, still pending, or suspended is
            // an unusable state, not a distinguishable one — same error.
            if (!account || !account.status.isActive) {
                throw new InvalidResetTokenError();
            }

            account.changeCredential(passwordHash);
            await this.accounts.save(account);

            const revoked = await this.sessions.revokeAllForUser(reset.userId);

            // The account holder is their own actor: an admin issued the link,
            // but the person who followed it is the one who chose the password.
            // The eviction count rides along so the audit row can state it —
            // the aggregate raised the event without it, having no idea sessions
            // exist.
            const events = account.pullEvents().map((event) => ({
                ...event,
                payload: { ...event.payload, sessionsRevoked: revoked }
            }));
            await this.outbox.append(
                attachActor(events, {
                    id: reset.userId,
                    email: reset.email
                })
            );
            return revoked;
        });
    }
}
