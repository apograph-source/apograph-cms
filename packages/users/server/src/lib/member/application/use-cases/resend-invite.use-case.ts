import { Inject, Injectable, Optional } from '@nestjs/common';
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
import {
    MAIL_DISPATCHER,
    MAIL_KINDS,
    shouldReturnToken,
    type MailDispatcher
} from '../ports/mail-notifier.port';

/**
 * Rotates the invite token for a still-`pending` member, invalidating the
 * previously sent link ({@link InvalidMemberStateError} otherwise). Only
 * meaningful while the invite is unaccepted. The member's own aggregate state is
 * unchanged, so the application mints `member.invite_resent` directly (mirroring
 * identity's `auth.*` flow events); the activity subscriber turns it into the
 * `user.invite_resent` audit row. 404s an unknown member.
 *
 * With a mail provider configured the fresh invitation is queued in this same
 * transaction and the token is not returned; with none, the raw token comes
 * back for the admin to hand over, exactly as before (ADR-0018 §4).
 */
@Injectable()
export class ResendInviteUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly inviteTokens: InviteTokenService,
        @Inject(MEMBER_REPOSITORY)
        private readonly members: MemberRepository,
        // Optional: nothing is bound when no mail plugin is registered.
        @Optional()
        @Inject(MAIL_DISPATCHER)
        private readonly mail?: MailDispatcher
    ) {}

    /**
     * Runs the resend, returning the fresh raw token for the admin to deliver —
     * or `null` once a provider is configured and the message carries it. 404s
     * an unknown member; 409s a non-pending one.
     */
    async execute(actor: PublicUser, id: string): Promise<string | null> {
        const memberId = MemberId.create(id);

        return this.uow.run(async () => {
            const member = await this.members.findById(memberId);
            if (!member) {
                throw new MemberNotFoundError(id);
            }
            member.ensureCanResendInvite();

            // Refuse a rotation that would destroy a link handed over moments
            // ago: the raw token is unrecoverable, so a double-clicked resend
            // can otherwise leave the admin holding the dead first response —
            // or, with a mailer, send two messages of which only the second
            // works.
            const invite = await this.inviteTokens.rotate(
                member.id.value,
                this.uow.current(),
                { minIntervalSeconds: INVITE_RESEND_COOLDOWN_SECONDS }
            );

            // In-band with the rotation: the plaintext exists only here.
            await this.mail?.enqueue({
                kind: MAIL_KINDS.INVITE_RESENT,
                to: member.email,
                userId: member.id.value,
                recipientName: member.name,
                actorName: actor.name ?? actor.email,
                token: invite.raw,
                expiresAt: invite.expiresAt
            });

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

            return shouldReturnToken(this.mail) ? invite.raw : null;
        });
    }
}
