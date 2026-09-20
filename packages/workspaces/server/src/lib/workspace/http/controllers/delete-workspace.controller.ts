import {
    ConflictException,
    ServiceUnavailableException,
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
import { WorkspaceMemberGuard } from '../guards/workspace-member.guard';
import { DeleteWorkspaceUseCase } from '../../application/use-cases/delete-workspace.use-case';
import {
    EntryCountUnavailableError,
    WorkspaceNotEmptyError,
    WorkspaceNotFoundError
} from '../../domain/errors';

/**
 * `DELETE /api/workspaces/:id` — permanently deletes a workspace (memberships +
 * content grants cascade); requires the stronger `workspaces:delete`. Returns
 * 204; a missing workspace maps to 404, and one that still holds content entries
 * to 409 (delete them first, so nothing is orphaned). Guarded by `OriginGuard`.
 *
 * Also guarded by `WorkspaceMemberGuard`: a caller who isn't a member of
 * `:id` gets a flat 403 — indistinguishable from a workspace that doesn't
 * exist — so a permission never reaches another tenant's workspace.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceMemberGuard)
@RequirePermissions(PERMISSIONS.WORKSPACES_DELETE)
@Controller('workspaces')
export class DeleteWorkspaceController {
    constructor(private readonly deleteWorkspace: DeleteWorkspaceUseCase) {}

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    async remove(
        @CurrentUser() actor: PublicUser,
        @Param('id', ParseUUIDPipe) id: string
    ): Promise<void> {
        try {
            await this.deleteWorkspace.execute(actor, id);
        } catch (error) {
            if (error instanceof WorkspaceNotFoundError) {
                throw new NotFoundException();
            }
            if (error instanceof WorkspaceNotEmptyError) {
                throw new ConflictException(
                    'Workspace still has content entries'
                );
            }
            if (error instanceof EntryCountUnavailableError) {
                throw new ServiceUnavailableException(
                    'Cannot verify existing content right now, so this change is blocked.'
                );
            }
            throw error;
        }
    }
}
