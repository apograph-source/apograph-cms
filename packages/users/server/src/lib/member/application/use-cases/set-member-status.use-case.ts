import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import { MemberId } from '../../domain/value-objects/member-id';
import { MemberNotFoundError, SelfActionError } from '../../domain/errors';
import {
    MEMBER_EVENT_KINDS,
    memberEvent
} from '../../domain/events/member-events';
import {
    MEMBER_REPOSITORY,
    type MemberRepository
} from '../../domain/member.repository';
import {
    SESSION_REVOKER,
    type SessionRevoker
} from '../ports/session-revoker.port';

/**
 * Flips a member's account status. `disable` rejects self-disable
 * ({@link SelfActionError}) and disabling the last active admin
 * ({@link LastAdminProtectedError}), and revokes the member's live sessions in
 * the same transaction so the lockout is immediate. `enable` reactivates a
 * disabled member. Only the applicable lifecycle state is accepted
 * ({@link InvalidMemberStateError}).
 *
 * Disable loads the member under the active-admin lock
 * ({@link MemberRepository.findByIdForAdminGuard}) and checks the count read
 * under it, so concurrent disables cannot race the admin count below one.
 * Drains `member.disabled` (from the aggregate) and mints `member.reactivated`
 * on enable — the activity subscriber turns them into the `user.suspended` /
 * `user.reactivated` audit rows.
 */
@Injectable()
export class SetMemberStatusUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        @Inject(MEMBER_REPOSITORY)
        private readonly members: MemberRepository,
        @Inject(SESSION_REVOKER)
        private readonly sessions: SessionRevoker
    ) {}

    /** Disables an active member. 404s an unknown member; throws the guards. */
    async disable(actor: PublicUser, id: string): Promise<void> {
        if (actor.id === id) {
            throw new SelfActionError(id);
        }
        const memberId = MemberId.create(id);

        await this.uow.run(async () => {
            const member = await this.members.findByIdForAdminGuard(memberId);
            if (!member) {
                throw new MemberNotFoundError(id);
            }
            const activeAdminCount = await this.members.countActiveAdmins();
            member.disable(activeAdminCount);

            await this.members.save(member);
            await this.sessions.revoke(id);

            await this.outbox.append(attachActor(member.pullEvents(), actor));
        });
    }

    /** Re-enables a disabled member. 404s an unknown member. */
    async enable(actor: PublicUser, id: string): Promise<void> {
        const memberId = MemberId.create(id);

        await this.uow.run(async () => {
            const member = await this.members.findById(memberId);
            if (!member) {
                throw new MemberNotFoundError(id);
            }
            member.enable();
            await this.members.save(member);

            // Enable is not a primary aggregate transition, so the reactivation
            // fact is minted here for the audit subscriber.
            await this.outbox.append(
                attachActor(
                    [memberEvent(MEMBER_EVENT_KINDS.REACTIVATED, id, {})],
                    actor
                )
            );
        });
    }
}
