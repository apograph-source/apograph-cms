import {
    BadRequestException,
    Body,
    Controller,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Patch,
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
import { UpdateWorkspaceUseCase } from '../../application/use-cases/update-workspace.use-case';
import { UpdateWorkspaceDto } from '../../application/dto/update-workspace.dto';
import { WorkspaceViewQuery } from '../../infrastructure/queries/workspace-view.query';
import type { WorkspaceView } from '../../application/queries/workspace.view';
import {
    InvalidWorkspaceColorError,
    WorkspaceNotFoundError
} from '../../domain/errors';

/**
 * `PATCH /api/workspaces/:id` — edits a workspace's profile (name, description,
 * color); requires `workspaces:update`. Only supplied fields are written; a
 * missing workspace maps to 404. Guarded by `OriginGuard` (CSRF).
 *
 * Also guarded by `WorkspaceMemberGuard`: a caller who isn't a member of
 * `:id` gets a flat 403 — indistinguishable from a workspace that doesn't
 * exist — so a permission never reaches another tenant's workspace.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceMemberGuard)
@RequirePermissions(PERMISSIONS.WORKSPACES_UPDATE)
@Controller('workspaces')
export class UpdateWorkspaceController {
    constructor(
        private readonly updateWorkspace: UpdateWorkspaceUseCase,
        private readonly views: WorkspaceViewQuery
    ) {}

    @Patch(':id')
    async update(
        @CurrentUser() actor: PublicUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: UpdateWorkspaceDto
    ): Promise<WorkspaceView> {
        try {
            await this.updateWorkspace.execute(actor, id, body);
            const view = await this.views.byId(id);
            if (!view) {
                throw new NotFoundException();
            }
            return view;
        } catch (error) {
            if (error instanceof WorkspaceNotFoundError) {
                throw new NotFoundException();
            }
            if (error instanceof InvalidWorkspaceColorError) {
                throw new BadRequestException(error.message);
            }
            throw error;
        }
    }
}
