import { Body, Controller, Delete, UseGuards } from '@nestjs/common';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { DeleteAssetsUseCase } from '../../application/use-cases/delete-assets.use-case';
import { DeleteAssetsDto } from '../../application/dto/delete-assets.dto';
import { toHttp } from '../to-http';

/**
 * `DELETE /api/media/assets` — bulk-delete assets by id. Gated on
 * `media:delete`. Returns the number actually removed.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.MEDIA_DELETE)
@Controller('media')
export class DeleteAssetsController {
    constructor(private readonly deleteAssets: DeleteAssetsUseCase) {}

    /** Deletes the given assets and reports the count removed. */
    @Delete('assets')
    async remove(
        @Body() body: DeleteAssetsDto,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user: PublicUser
    ): Promise<{ deleted: number }> {
        try {
            const deleted = await this.deleteAssets.execute(
                body.ids,
                workspaceId,
                user
            );
            return { deleted };
        } catch (error) {
            toHttp(error);
        }
    }
}
