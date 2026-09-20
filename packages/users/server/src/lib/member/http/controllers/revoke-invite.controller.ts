import {
    Controller,
    Delete,
    HttpCode,
    HttpStatus,
    NotFoundException,
    Param,
    ParseUUIDPipe,
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
import { conflict } from '../conflict';
import { RevokeInviteUseCase } from '../../application/use-cases/revoke-invite.use-case';
import {
    InvalidMemberStateError,
    MemberNotFoundError
} from '../../domain/errors';

/**
 * `DELETE /api/users/:id/invites` — revokes a pending invite by deleting the
 * placeholder user row (cascades drop the token and any memberships);
 * requires `users:delete`. Real accounts are never deleted this way — a
 * non-pending target 409s.
 */
@UseGuards(OriginGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.USERS_DELETE)
@Controller('users')
export class RevokeInviteController {
    constructor(private readonly revokeInvite: RevokeInviteUseCase) {}

    @Delete(':id/invites')
    @HttpCode(HttpStatus.NO_CONTENT)
    async revoke(
        @CurrentUser() actor: PublicUser,
        @Param('id', ParseUUIDPipe) id: string
    ): Promise<void> {
        try {
            await this.revokeInvite.execute(actor, id);
        } catch (error) {
            if (error instanceof MemberNotFoundError) {
                throw new NotFoundException();
            }
            if (error instanceof InvalidMemberStateError) {
                throw conflict(error.code, error.message);
            }
            throw error;
        }
    }
}
