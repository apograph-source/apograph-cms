import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@apograph/database';
import type { PublicUser } from '@apograph/identity-server';
import { PASSWORD_RESET_COOLDOWN_SECONDS } from '../../member.constants';
import { MemberId } from '../../domain/value-objects/member-id';
import { MemberNotFoundError } from '../../domain/errors';
import {
    MEMBER_EVENT_KINDS,
    memberEvent
} from '../../domain/events/member-events';
import {
    MEMBER_REPOSITORY,
    type MemberRepository
} from '../../domain/member.repository';
import { PasswordResetTokenService } from '../../infrastructure/persistence/password-reset-token.service';

/**
 * Mints a one-time password-reset link for an `active` member — the
 * admin-driven half of the reset flow (nothing self-service exists yet: there
 * is no mailer, so a "forgot password" form would have nowhere to send the
 * link, identity epic #11).
 *
 * Issuing rotates the member's reset token, so a previously issued link stops
 * working the moment this one is created. The member's own aggregate state is
 * unchanged — no password is set here and no session is touched; that happens
 * only when the *member* redeems the link — so the application mints
 * `member.password_reset_issued` directly, mirroring `member.invite_resent`.
 * The activity subscriber turns it into the `user.password_reset_issued` audit
 * row: handing someone a link that can take over an account is exactly the kind
 * of act a security review needs attributed to the admin who performed it,
 * whether or not it is ever redeemed.
 *
 * 404s an unknown member; 409s a non-active one.
 */
@Injectable()
export class IssuePasswordResetUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly resetTokens: PasswordResetTokenService,
        @Inject(MEMBER_REPOSITORY)
        private readonly members: MemberRepository
    ) {}

    /**
     * Runs the issue, returning the raw token for delivery — the only moment it
     * exists in readable form, since only its hash is stored.
     */
    async execute(actor: PublicUser, id: string): Promise<string> {
        const memberId = MemberId.create(id);

        return this.uow.run(async () => {
            const member = await this.members.findById(memberId);
            if (!member) {
                throw new MemberNotFoundError(id);
            }
            member.ensureCanResetPassword();

            // TODO(users-email): send this link instead of returning it, once a
            // mailer exists (identity epic #11).
            // Refuse an issue that would destroy a link handed over moments ago:
            // the raw token is unrecoverable, so a double-clicked button can
            // otherwise leave the admin holding the dead first response.
            const resetToken = await this.resetTokens.rotate(
                member.id.value,
                this.uow.current(),
                { minIntervalSeconds: PASSWORD_RESET_COOLDOWN_SECONDS }
            );

            await this.outbox.append(
                attachActor(
                    [
                        memberEvent(
                            MEMBER_EVENT_KINDS.PASSWORD_RESET_ISSUED,
                            id,
                            { email: member.email }
                        )
                    ],
                    actor
                )
            );

            return resetToken;
        });
    }
}
