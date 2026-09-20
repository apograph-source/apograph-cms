import { Inject, Injectable, Optional } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@ortha/database';
import type { PublicUser } from '@ortha/identity-server';
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
import {
    MAIL_DISPATCHER,
    MAIL_KINDS,
    shouldReturnToken,
    type MailDispatcher
} from '../ports/mail-notifier.port';
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
 * With a mail provider configured the invitation is **queued in this same
 * transaction** — that is the only place the plaintext token exists, so the
 * message cannot be assembled later (ADR-0018 §2) — and the token is *not*
 * returned: two copies of an account-takeover secret are worse than one. With
 * no provider the behaviour is what it has always been, byte for byte: the raw
 * token comes back and the inviting admin is the delivery channel, the same
 * reveal-once shape API tokens use. The token itself is only ever stored
 * hashed.
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
        private readonly workspaceLinker: WorkspaceLinker,
        // Optional: a deployment with no mail provider registers no mail
        // plugin, so nothing is bound and nothing is sent.
        @Optional()
        @Inject(MAIL_DISPATCHER)
        private readonly mail?: MailDispatcher
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

            const invite = await this.inviteTokens.rotate(
                member.id.value,
                this.uow.current()
            );

            // Inside the transaction, and necessarily so: `invite.raw` exists
            // nowhere else, so a message assembled after the commit could not
            // carry the link. The worker still opens no socket until this has
            // committed (ADR-0016's rule, kept).
            await this.mail?.enqueue({
                kind: MAIL_KINDS.INVITE,
                to: member.email,
                userId: member.id.value,
                recipientName: member.name,
                actorName: actor.name ?? actor.email,
                token: invite.raw,
                expiresAt: invite.expiresAt
            });

            await this.workspaceLinker.link(
                member.id.value,
                dto.workspaceIds ?? []
            );

            // Audit is derived downstream from the domain event by the activity
            // subscriber; the actor rides along on the event payload.
            await this.outbox.append(attachActor(member.pullEvents(), actor));

            return {
                id: member.id.value,
                inviteToken: shouldReturnToken(this.mail) ? invite.raw : null
            };
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
     *
     * `null` once a mail provider is configured: the message carries the link,
     * and the token stops travelling back through an HTTP response, an
     * administrator's clipboard and whatever logs that response passed through.
     * `POST /api/users/:id/reveal-link` is the audited way to see it when a
     * message does not arrive.
     */
    inviteToken: string | null;
}
