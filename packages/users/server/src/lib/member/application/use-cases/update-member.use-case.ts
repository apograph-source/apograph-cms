import { Inject, Injectable } from '@nestjs/common';
import {
    attachActor,
    OutboxWriter,
    UnitOfWork,
    type DomainEvent
} from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import { MemberId } from '../../domain/value-objects/member-id';
import { Role } from '../../domain/value-objects/role';
import { MemberNotFoundError, SelfActionError } from '../../domain/errors';
import {
    MEMBER_EVENT_KINDS,
    memberEvent
} from '../../domain/events/member-events';
import {
    MEMBER_REPOSITORY,
    type MemberRepository
} from '../../domain/member.repository';
import type { UpdateMemberDto } from '../dto/update-member.dto';

/**
 * Partial update of a member's display name and/or role. A member cannot change
 * their own role ({@link SelfActionError}, mirroring the self-disable guard).
 *
 * When the patch **touches the role**, the member is loaded under the global
 * active-admin lock ({@link MemberRepository.findByIdForAdminGuard}); demoting
 * the last active admin is rejected inside the aggregate against a count read
 * under that lock, so two simultaneous demotions cannot both pass. A patch that
 * only renames takes no lock — it cannot change the admin count, and making it
 * wait serialised every member update in the deployment behind one global lock.
 * Drains `member.role_changed`
 * (from the aggregate) on a role change and mints `member.profile_updated` on a
 * rename — distinct facts the activity subscriber turns into the
 * `user.role_changed` / `user.profile_updated` audit rows. 404s an unknown
 * member.
 */
@Injectable()
export class UpdateMemberUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        @Inject(MEMBER_REPOSITORY)
        private readonly members: MemberRepository
    ) {}

    /** Runs the update. 404s an unknown member; throws the guard errors. */
    async execute(
        actor: PublicUser,
        id: string,
        dto: UpdateMemberDto
    ): Promise<void> {
        const memberId = MemberId.create(id);

        // Only a role change can violate the last-admin invariant, so only a
        // role change needs the global active-admin lock. A pure rename took it
        // too, which serialised *every* member update in the deployment behind
        // one lock — including edits that cannot affect the admin count.
        const touchesRole = dto.role !== undefined;

        await this.uow.run(async () => {
            const member = touchesRole
                ? await this.members.findByIdForAdminGuard(memberId)
                : await this.members.findById(memberId);
            if (!member) {
                throw new MemberNotFoundError(id);
            }

            const previousRole = member.role.value;
            const previousName = member.name;

            let roleChanged = false;
            if (dto.role !== undefined && dto.role !== previousRole) {
                // You cannot change your own role — the same self-protection
                // the disable path enforces, so an admin can't accidentally
                // strip their own access (or hand themselves a different role).
                if (actor.id === id) {
                    throw new SelfActionError(id);
                }
                const activeAdminCount = await this.members.countActiveAdmins();
                roleChanged = member.changeRole(
                    Role.create(dto.role),
                    activeAdminCount
                );
            }
            const nameChanged =
                dto.name !== undefined ? member.rename(dto.name) : false;

            if (!roleChanged && !nameChanged) {
                return;
            }
            await this.members.save(member);

            // The aggregate raises `member.role_changed`; a rename is a
            // secondary fact minted here (the aggregate stays quiet on it),
            // carrying the same before/after the audit row needs.
            const events: DomainEvent[] = member.pullEvents();
            if (nameChanged) {
                events.push(
                    memberEvent(MEMBER_EVENT_KINDS.PROFILE_UPDATED, id, {
                        name: { from: previousName, to: dto.name }
                    })
                );
            }
            await this.outbox.append(attachActor(events, actor));
        });
    }
}
