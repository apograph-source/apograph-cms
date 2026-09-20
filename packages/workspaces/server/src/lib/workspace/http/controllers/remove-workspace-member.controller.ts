import {
    ConflictException,
    Controller,
    Delete,
    HttpCode,
    HttpStatus,
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
import { WorkspaceMemberGuard } from '../guards/workspace-member.guard';
import { RemoveMemberUseCase } from '../../application/use-cases/remove-member.use-case';
import { LastMemberError } from '../../domain/errors';

/**
 * `DELETE /api/workspaces/:id/members/:userId` — removes a user's membership;
 * requires `workspaces:update`. Removing a non-member is a no-op (still 204).
 * Removing the **last** member is refused with a `409`: access is
 * membership-scoped, so it would leave the workspace unreachable by everyone.
 * Guarded by `OriginGuard` (CSRF).
 *
 * Also guarded by `WorkspaceMemberGuard`: a caller who isn't a member of
 * `:id` gets a flat 403 — indistinguishable from a workspace that doesn't
 * exist — so a permission never reaches another tenant's workspace.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceMemberGuard)
@RequirePermissions(PERMISSIONS.WORKSPACES_UPDATE)
@Controller('workspaces')
export class RemoveWorkspaceMemberController {
    constructor(private readonly removeMember: RemoveMemberUseCase) {}

    @Delete(':id/members/:userId')
    @HttpCode(HttpStatus.NO_CONTENT)
    async remove(
        @CurrentUser() actor: PublicUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Param('userId', ParseUUIDPipe) userId: string
    ): Promise<void> {
        try {
            await this.removeMember.execute(actor, id, userId);
        } catch (error) {
            if (error instanceof LastMemberError) {
                throw new ConflictException(
                    'Cannot remove the last member of a workspace. Delete the workspace instead, or add another member first.'
                );
            }
            throw error;
        }
    }
}
