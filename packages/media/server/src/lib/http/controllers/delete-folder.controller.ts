import {
    Controller,
    Delete,
    HttpCode,
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
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { DeleteFolderUseCase } from '../../application/use-cases/delete-folder.use-case';
import { toHttp } from '../to-http';

/**
 * `DELETE /api/media/folders/:id` — delete a folder **and everything inside
 * it**: every descendant folder and every asset in any of them, in one
 * transaction. Gated on `media:delete`. The confirmation that names what will
 * go is the admin's job; this route is unconditional (it used to `409` on a
 * non-empty folder, which made a populated tree undeletable without emptying it
 * by hand).
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.MEDIA_DELETE)
@Controller('media')
export class DeleteFolderController {
    constructor(private readonly deleteFolder: DeleteFolderUseCase) {}

    /** Deletes the folder and its whole subtree. */
    @Delete('folders/:id')
    @HttpCode(204)
    async remove(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user: PublicUser
    ): Promise<void> {
        try {
            await this.deleteFolder.execute(id, workspaceId, user);
        } catch (error) {
            toHttp(error);
        }
    }
}
