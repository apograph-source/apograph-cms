import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@apograph/database';
import type { PublicUser } from '@apograph/identity-server';
import { INVITE_RESEND_COOLDOWN_SECONDS } from '../../member.constants';
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
import { InviteTokenService } from '../../infrastructure/persistence/invite-token.service';

/**
 * Rotates the invite token for a still-`pending` member, invalidating the
 * previously sent link ({@link InvalidMemberStateError} otherwise). Only
 * meaningful while the invite is unaccepted. The member's own aggregate state is
 * unchanged, so the application mints `member.invite_resent` directly (mirroring
 * identity's `auth.*` flow events); the activity subscriber turns it into the
 * `user.invite_resent` audit row. 404s an unknown member.
 */
@Injectable()
export class ResendInviteUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly inviteTokens: InviteTokenService,
        @Inject(MEMBER_REPOSITORY)
        private readonly members: MemberRepository
    ) {}

    /**
     * Runs the resend, returning the fresh raw token for delivery. 404s an
     * unknown member; 409s a non-pending one.
     */
    async execute(actor: PublicUser, id: string): Promise<string> {
        const memberId = MemberId.create(id);

        return this.uow.run(async () => {
            const member = await this.members.findById(memberId);
            if (!member) {
                throw new MemberNotFoundError(id);
            }
            member.ensureCanResendInvite();

            // TODO(users-email): send this link instead of returning it, once a
            // mailer exists (identity epic #11).
            // Refuse a rotation that would destroy a link handed over moments
            // ago: the raw token is unrecoverable, so a double-clicked resend
            // can otherwise leave the admin holding the dead first response.
            const inviteToken = await this.inviteTokens.rotate(
                member.id.value,
                this.uow.current(),
                { minIntervalSeconds: INVITE_RESEND_COOLDOWN_SECONDS }
            );

            await this.outbox.append(
                attachActor(
                    [
                        memberEvent(MEMBER_EVENT_KINDS.INVITE_RESENT, id, {
                            email: member.email
                        })
                    ],
                    actor
                )
            );

            return inviteToken;
        });
    }
}
