import {
    Body,
    Controller,
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
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { RenameFolderUseCase } from '../../application/use-cases/rename-folder.use-case';
import { RenameFolderDto } from '../../application/dto/rename-folder.dto';
import { toHttp } from '../to-http';

/**
 * `PATCH /api/media/folders/:id` — rename a folder. Gated on `media:update`.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.MEDIA_UPDATE)
@Controller('media')
export class RenameFolderController {
    constructor(private readonly renameFolder: RenameFolderUseCase) {}

    /** Renames a folder. */
    @Patch('folders/:id')
    async rename(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: RenameFolderDto,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user: PublicUser
    ): Promise<{ id: string }> {
        try {
            await this.renameFolder.execute(id, workspaceId, body.name, user);
            return { id };
        } catch (error) {
            toHttp(error);
        }
    }
}
