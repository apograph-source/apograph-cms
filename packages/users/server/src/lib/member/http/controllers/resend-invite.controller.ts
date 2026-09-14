import {
    Controller,
    NotFoundException,
    Param,
    ParseUUIDPipe,
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
} from '@apograph/identity-server';
import { ResendInviteUseCase } from '../../application/use-cases/resend-invite.use-case';
import {
    InvalidMemberStateError,
    MemberNotFoundError,
    InviteRecentlySentError
} from '../../domain/errors';
import { conflict } from '../conflict';
import { MemberViewQuery } from '../../infrastructure/queries/member-view.query';
import type { InvitedMemberView } from '../../application/queries/member.view';

/**
 * `POST /api/users/:id/invites/resend` — rotates a pending member's invite
 * token, invalidating the previously sent link; requires `users:create` (the
 * same permission that issued the invite). 409s when the member is no longer
 * pending. Returns the member row plus the fresh raw `inviteToken` when no
 * mail provider is configured, so the admin can hand over the new link (the old
 * one is already dead); with a provider the message carries it and the field is
 * absent.
 */
@UseGuards(OriginGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.USERS_CREATE)
@Controller('users')
export class ResendInviteController {
    constructor(
        private readonly resendInvite: ResendInviteUseCase,
        private readonly views: MemberViewQuery
    ) {}

    @Post(':id/invites/resend')
    async resend(
        @CurrentUser() actor: PublicUser,
        @Param('id', ParseUUIDPipe) id: string
    ): Promise<InvitedMemberView> {
        try {
            const inviteToken = await this.resendInvite.execute(actor, id);
            const view = await this.views.byId(id);
            if (!view) {
                throw new NotFoundException();
            }
            return { ...view, ...(inviteToken ? { inviteToken } : {}) };
        } catch (error) {
            if (error instanceof MemberNotFoundError) {
                throw new NotFoundException();
            }
            if (error instanceof InvalidMemberStateError) {
                throw conflict(error.code, error.message);
            }
            if (error instanceof InviteRecentlySentError) {
                // Carry the wait so a client can say "try again in 42s"
                // rather than only that something conflicted.
                throw conflict(error.code, error.message, {
                    retryAfterSeconds: error.retryAfterSeconds
                });
            }
            throw error;
        }
    }
}
