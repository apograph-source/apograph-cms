import {
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
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { DuplicateAssetUseCase } from '../../application/use-cases/duplicate-asset.use-case';
import { AssetViewQuery } from '../../infrastructure/queries/asset-view.query';
import type { AssetView } from '../../types/asset-view';
import { toHttp } from '../to-http';

/**
 * `POST /api/media/assets/:id/duplicate` — copy an asset (bytes + row). Gated on
 * `media:create`. Returns the new asset view.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.MEDIA_CREATE)
@Controller('media')
export class DuplicateAssetController {
    constructor(
        private readonly duplicate: DuplicateAssetUseCase,
        private readonly views: AssetViewQuery
    ) {}

    /** Duplicates an asset and returns the copy. */
    @Post('assets/:id/duplicate')
    async run(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user: PublicUser
    ): Promise<AssetView> {
        try {
            const newId = await this.duplicate.execute(id, workspaceId, user);
            const view = await this.views.byId(newId, workspaceId);
            if (!view) {
                throw new NotFoundException();
            }
            return view;
        } catch (error) {
            toHttp(error);
        }
    }
}
