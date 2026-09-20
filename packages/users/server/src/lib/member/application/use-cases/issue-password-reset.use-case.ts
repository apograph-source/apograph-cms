import { Inject, Injectable, Optional } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@ortha/database';
import type { PublicUser } from '@ortha/identity-server';
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
import {
    MAIL_DISPATCHER,
    MAIL_KINDS,
    shouldReturnToken,
    type MailDispatcher
} from '../ports/mail-notifier.port';

/**
 * Mints a one-time password-reset link for an `active` member — the
 * admin-driven half of the reset flow. The self-service half (a public "forgot
 * password" form) is phase 2 of ADR-0018 and deliberately not here: it needs
 * rules of its own about enumeration and rate limiting, which an
 * administrator-gated route does not.
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
        private readonly members: MemberRepository,
        // Optional: nothing is bound when no mail plugin is registered.
        @Optional()
        @Inject(MAIL_DISPATCHER)
        private readonly mail?: MailDispatcher
    ) {}

    /**
     * Runs the issue, returning the raw token for the admin to deliver — the
     * only moment it exists in readable form, since only its hash is stored —
     * or `null` once a provider is configured and the message carries it.
     */
    async execute(actor: PublicUser, id: string): Promise<string | null> {
        const memberId = MemberId.create(id);

        return this.uow.run(async () => {
            const member = await this.members.findById(memberId);
            if (!member) {
                throw new MemberNotFoundError(id);
            }
            member.ensureCanResetPassword();

            // Refuse an issue that would destroy a link handed over moments ago:
            // the raw token is unrecoverable, so a double-clicked button can
            // otherwise leave the admin holding the dead first response.
            const reset = await this.resetTokens.rotate(
                member.id.value,
                this.uow.current(),
                { minIntervalSeconds: PASSWORD_RESET_COOLDOWN_SECONDS }
            );

            // In-band with the rotation: the plaintext exists only here.
            await this.mail?.enqueue({
                kind: MAIL_KINDS.PASSWORD_RESET,
                to: member.email,
                userId: member.id.value,
                recipientName: member.name,
                actorName: actor.name ?? actor.email,
                token: reset.raw,
                expiresAt: reset.expiresAt
            });

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

            return shouldReturnToken(this.mail) ? reset.raw : null;
        });
    }
}
