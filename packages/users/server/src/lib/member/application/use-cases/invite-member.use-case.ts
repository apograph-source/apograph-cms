import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@apograph/database';
import type { PublicUser } from '@apograph/identity-server';
import { Member } from '../../domain/member';
import { Role } from '../../domain/value-objects/role';
import { EmailTakenError } from '../../domain/errors';
import {
    MEMBER_REPOSITORY,
    type MemberRepository
} from '../../domain/member.repository';
import {
    WORKSPACE_LINKER,
    type WorkspaceLinker
} from '../ports/workspace-linker.port';
import { InviteTokenService } from '../../infrastructure/persistence/invite-token.service';
import type { InviteMemberDto } from '../dto/invite-member.dto';

/**
 * Invites a person: creates a `pending` {@link Member} holding the given role,
 * issues their invite token, and optionally links them to workspaces — all in
 * one unit of work. The email must be free: checked up front for a friendly
 * {@link EmailTakenError}, with the DB's case-insensitive unique index as the
 * race-proof backstop (its violation, surfaced by the repository, maps to the
 * same error). Drains `member.invited` (carrying the actor), where the activity
 * subscriber turns it into the `user.invited` audit row.
 *
 * Returns the raw invite token alongside the new member's id. Until a mailer
 * exists (identity epic #11) the inviting admin is the delivery channel: the
 * controller hands them the link once, the same reveal-once shape API tokens
 * use. The token itself is only ever stored hashed.
 */
@Injectable()
export class InviteMemberUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly inviteTokens: InviteTokenService,
        @Inject(MEMBER_REPOSITORY)
        private readonly members: MemberRepository,
        @Inject(WORKSPACE_LINKER)
        private readonly workspaceLinker: WorkspaceLinker
    ) {}

    /** Runs the invite, returning the new member's id and their raw token. */
    async execute(
        actor: PublicUser,
        dto: InviteMemberDto
    ): Promise<InvitedMember> {
        const email = dto.email.toLowerCase();
        if (await this.members.existsByEmail(email)) {
            throw new EmailTakenError(dto.email);
        }

        return this.uow.run(async () => {
            const member = Member.invite({
                email,
                name: dto.name ?? null,
                role: Role.create(dto.role)
            });
            await this.members.save(member);

            // TODO(users-email): send this link instead of returning it, once a
            // mailer exists (identity epic #11).
            const inviteToken = await this.inviteTokens.rotate(
                member.id.value,
                this.uow.current()
            );

            await this.workspaceLinker.link(
                member.id.value,
                dto.workspaceIds ?? []
            );

            // Audit is derived downstream from the domain event by the activity
            // subscriber; the actor rides along on the event payload.
            await this.outbox.append(attachActor(member.pullEvents(), actor));

            return { id: member.id.value, inviteToken };
        });
    }
}

/** What an invite produces: the new member's id and their one-time token. */
export interface InvitedMember {
    /** The `pending` member's user id. */
    id: string;
    /**
     * The raw invite token — the secret half of the invite link. Returned
     * exactly once, never readable again (only its hash is stored).
     */
    inviteToken: string;
}
