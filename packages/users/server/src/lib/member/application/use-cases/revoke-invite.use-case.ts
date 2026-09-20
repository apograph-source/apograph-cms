import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import { MemberId } from '../../domain/value-objects/member-id';
import { MemberNotFoundError } from '../../domain/errors';
import {
    MEMBER_REPOSITORY,
    type MemberRepository
} from '../../domain/member.repository';

/**
 * Revokes a `pending` invite by deleting the placeholder member row; the
 * cascades drop their invite token and any pre-assigned memberships. Only
 * `pending` rows qualify ({@link InvalidMemberStateError} otherwise) — real
 * accounts are disabled, not deleted. Drains `member.removed` (carrying the
 * email snapshot + the actor), where the activity subscriber turns it into the
 * `user.invite_revoked` audit row. Because `subject_id` is text with no FK, that
 * row stands on its own once the placeholder member row is gone. 404s an
 * unknown member.
 */
@Injectable()
export class RevokeInviteUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        @Inject(MEMBER_REPOSITORY)
        private readonly members: MemberRepository
    ) {}

    /** Runs the revoke. 404s an unknown member; 409s a non-pending one. */
    async execute(actor: PublicUser, id: string): Promise<void> {
        const memberId = MemberId.create(id);

        await this.uow.run(async () => {
            const member = await this.members.findById(memberId);
            if (!member) {
                throw new MemberNotFoundError(id);
            }
            member.revokeInvite();

            await this.members.delete(member);
            await this.outbox.append(attachActor(member.pullEvents(), actor));
        });
    }
}
