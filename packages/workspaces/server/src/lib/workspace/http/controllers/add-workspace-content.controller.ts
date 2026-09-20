import {
    BadRequestException,
    Body,
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
} from '@orthacms/identity-server';
import { WorkspaceMemberGuard } from '../guards/workspace-member.guard';
import { GrantContentUseCase } from '../../application/use-cases/grant-content.use-case';
import { AddWorkspaceContentDto } from '../../application/dto/add-workspace-content.dto';
import { WorkspaceViewQuery } from '../../infrastructure/queries/workspace-view.query';
import type { WorkspaceView } from '../../application/queries/workspace.view';
import {
    UnknownContentTypeError,
    WorkspaceNotFoundError
} from '../../domain/errors';

/**
 * `POST /api/workspaces/:id/content` — grants the workspace access to one
 * content type (by slug); requires `workspaces:update`. Idempotent. A missing
 * workspace maps to 404; a slug that names no known content type to 400. Guarded
 * by `OriginGuard` (CSRF).
 *
 * Also guarded by `WorkspaceMemberGuard`: a caller who isn't a member of
 * `:id` gets a flat 403 — indistinguishable from a workspace that doesn't
 * exist — so a permission never reaches another tenant's workspace.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceMemberGuard)
@RequirePermissions(PERMISSIONS.WORKSPACES_UPDATE)
@Controller('workspaces')
export class AddWorkspaceContentController {
    constructor(
        private readonly grantContent: GrantContentUseCase,
        private readonly views: WorkspaceViewQuery
    ) {}

    @Post(':id/content')
    async add(
        @CurrentUser() actor: PublicUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: AddWorkspaceContentDto
    ): Promise<WorkspaceView> {
        try {
            await this.grantContent.execute(actor, id, body.slug);
            const view = await this.views.byId(id);
            if (!view) {
                throw new NotFoundException();
            }
            return view;
        } catch (error) {
            if (error instanceof WorkspaceNotFoundError) {
                throw new NotFoundException();
            }
            if (error instanceof UnknownContentTypeError) {
                throw new BadRequestException(error.message);
            }
            throw error;
        }
    }
}
