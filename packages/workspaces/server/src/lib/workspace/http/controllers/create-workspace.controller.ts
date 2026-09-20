import {
    BadRequestException,
    Body,
    ConflictException,
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
import { CreateWorkspaceUseCase } from '../../application/use-cases/create-workspace.use-case';
import { CreateWorkspaceDto } from '../../application/dto/create-workspace.dto';
import { WorkspaceViewQuery } from '../../infrastructure/queries/workspace-view.query';
import type { WorkspaceView } from '../../application/queries/workspace.view';
import {
    InvalidSlugError,
    InvalidWorkspaceColorError,
    SlugTakenError
} from '../../domain/errors';

/**
 * `POST /api/workspaces` — creates a workspace owned by the current user. The
 * owner is derived from the session (`@CurrentUser()`), never the body. A
 * duplicate slug maps to 409; a malformed slug/color to 400.
 *
 * Requires `workspaces:create` (`PermissionsGuard`) and is guarded by
 * `OriginGuard` (CSRF); authentication is enforced by the app-wide `AuthGuard`.
 */
@UseGuards(OriginGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.WORKSPACES_CREATE)
@Controller('workspaces')
export class CreateWorkspaceController {
    constructor(
        private readonly createWorkspace: CreateWorkspaceUseCase,
        private readonly views: WorkspaceViewQuery
    ) {}

    @Post()
    async create(
        @Body() body: CreateWorkspaceDto,
        @CurrentUser() user: PublicUser
    ): Promise<WorkspaceView> {
        try {
            const id = await this.createWorkspace.execute(body, user);
            const view = await this.views.byId(id);
            if (!view) {
                throw new NotFoundException();
            }
            return view;
        } catch (error) {
            if (error instanceof SlugTakenError) {
                throw new ConflictException('Workspace slug already taken');
            }
            if (
                error instanceof InvalidSlugError ||
                error instanceof InvalidWorkspaceColorError
            ) {
                throw new BadRequestException(error.message);
            }
            throw error;
        }
    }
}
