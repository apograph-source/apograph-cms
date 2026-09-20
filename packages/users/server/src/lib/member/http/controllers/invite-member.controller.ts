import {
    Body,
    Controller,
    NotFoundException,
    Post,
    UseGuards
} from '@nestjs/common';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@orthacms/identity-server';
import { InviteMemberDto } from '../../application/dto/invite-member.dto';
import { InviteMemberUseCase } from '../../application/use-cases/invite-member.use-case';
import { MEMBER_ERROR_CODES, EmailTakenError } from '../../domain/errors';
import { conflict } from '../conflict';
import { MemberViewQuery } from '../../infrastructure/queries/member-view.query';
import type { InvitedMemberView } from '../../application/queries/member.view';

/**
 * `POST /api/users/invites` — invites a person by email. Creates the pending
 * member and issues their invite token; requires `users:create`. Returns the
 * new member row so the admin list can show it immediately with its
 * "Invited" status, plus the raw `inviteToken` when — and only when — no mail
 * provider is configured to deliver it (ADR-0018 §4).
 */
@UseGuards(OriginGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.USERS_CREATE)
@Controller('users')
export class InviteMemberController {
    constructor(
        private readonly inviteMember: InviteMemberUseCase,
        private readonly views: MemberViewQuery
    ) {}

    @Post('invites')
    async invite(
        @CurrentUser() actor: PublicUser,
        @Body() body: InviteMemberDto
    ): Promise<InvitedMemberView> {
        try {
            const { id, inviteToken } = await this.inviteMember.execute(
                actor,
                body
            );
            const view = await this.views.byId(id);
            if (!view) {
                throw new NotFoundException();
            }
            // Absent rather than null when a mailer has it: a client reading
            // the field blindly should fail, not build a link to `undefined`.
            return { ...view, ...(inviteToken ? { inviteToken } : {}) };
        } catch (error) {
            if (error instanceof EmailTakenError) {
                throw conflict(
                    MEMBER_ERROR_CODES.EMAIL_TAKEN,
                    'A user with this email already exists'
                );
            }
            throw error;
        }
    }
}
