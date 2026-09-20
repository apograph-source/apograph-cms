import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { CreateFolderUseCase } from '../../application/use-cases/create-folder.use-case';
import { CreateFolderDto } from '../../application/dto/create-folder.dto';
import { toHttp } from '../to-http';

/**
 * `POST /api/media/folders` — create a folder. `OriginGuard` defends this
 * state-changing POST; `media:create` gates it; `WorkspaceGuard` scopes it.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.MEDIA_CREATE)
@Controller('media')
export class CreateFolderController {
    constructor(private readonly createFolder: CreateFolderUseCase) {}

    /** Creates a folder and returns its id. */
    @Post('folders')
    async create(
        @Body() body: CreateFolderDto,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user: PublicUser
    ): Promise<{ id: string }> {
        try {
            const id = await this.createFolder.execute(
                { workspaceId, name: body.name, parentId: body.parentId },
                user
            );
            return { id };
        } catch (error) {
            toHttp(error);
        }
    }
}
