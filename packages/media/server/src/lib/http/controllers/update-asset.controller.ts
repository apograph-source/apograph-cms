import {
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
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { UpdateAssetUseCase } from '../../application/use-cases/update-asset.use-case';
import { AssetViewQuery } from '../../infrastructure/queries/asset-view.query';
import { UpdateAssetDto } from '../../application/dto/update-asset.dto';
import type { AssetView } from '../../types/asset-view';
import { toHttp } from '../to-http';

/**
 * `PATCH /api/media/assets/:id` — edit an asset (rename / move / retag / set
 * alt / attach captions). Gated on `media:update`. Returns the updated asset
 * view.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.MEDIA_UPDATE)
@Controller('media')
export class UpdateAssetController {
    constructor(
        private readonly update: UpdateAssetUseCase,
        private readonly views: AssetViewQuery
    ) {}

    /** Applies a partial edit and returns the refreshed asset. */
    @Patch('assets/:id')
    async patch(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: UpdateAssetDto,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user: PublicUser
    ): Promise<AssetView> {
        try {
            await this.update.execute(
                id,
                workspaceId,
                {
                    name: body.name,
                    folderId: body.folderId,
                    tags: body.tags,
                    alt: body.alt,
                    tracks: body.tracks
                },
                user
            );
            const view = await this.views.byId(id, workspaceId);
            if (!view) {
                throw new NotFoundException();
            }
            return view;
        } catch (error) {
            toHttp(error);
        }
    }
}
