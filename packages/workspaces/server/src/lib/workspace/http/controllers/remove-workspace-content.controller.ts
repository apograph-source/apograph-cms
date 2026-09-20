import {
    ConflictException,
    ServiceUnavailableException,
    Controller,
    Delete,
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
import { RevokeContentUseCase } from '../../application/use-cases/revoke-content.use-case';
import { WorkspaceViewQuery } from '../../infrastructure/queries/workspace-view.query';
import type { WorkspaceView } from '../../application/queries/workspace.view';
import {
    ContentTypeNotEmptyError,
    EntryCountUnavailableError,
    WorkspaceNotFoundError
} from '../../domain/errors';

/**
 * `DELETE /api/workspaces/:id/content/:slug` — revokes a workspace's access to a
 * content type; requires `workspaces:update`. Refuses (409) when the type still
 * holds entries in the workspace, so a revoke never orphans reachable records.
 * Revoking a grant the workspace never held is a no-op. Returns the updated
 * view; a missing workspace maps to 404. Guarded by `OriginGuard` (CSRF).
 *
 * Also guarded by `WorkspaceMemberGuard`: a caller who isn't a member of
 * `:id` gets a flat 403 — indistinguishable from a workspace that doesn't
 * exist — so a permission never reaches another tenant's workspace.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceMemberGuard)
@RequirePermissions(PERMISSIONS.WORKSPACES_UPDATE)
@Controller('workspaces')
export class RemoveWorkspaceContentController {
    constructor(
        private readonly revokeContent: RevokeContentUseCase,
        private readonly views: WorkspaceViewQuery
    ) {}

    @Delete(':id/content/:slug')
    async remove(
        @CurrentUser() actor: PublicUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Param('slug') slug: string
    ): Promise<WorkspaceView> {
        try {
            await this.revokeContent.execute(actor, id, slug);
            const view = await this.views.byId(id);
            if (!view) {
                throw new NotFoundException();
            }
            return view;
        } catch (error) {
            if (error instanceof WorkspaceNotFoundError) {
                throw new NotFoundException();
            }
            if (error instanceof ContentTypeNotEmptyError) {
                throw new ConflictException(
                    'Content type still has entries in this workspace'
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
