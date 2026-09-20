import {
    BadRequestException,
    Body,
    Controller,
    NotFoundException,
    Post,
    UploadedFile,
    UseFilters,
    UseGuards,
    UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Readable } from 'node:stream';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { UploadAssetUseCase } from '../../application/use-cases/upload-asset.use-case';
import { AssetViewQuery } from '../../infrastructure/queries/asset-view.query';
import { UploadAssetDto } from '../../application/dto/upload-asset.dto';
import type { AssetView } from '../../types/asset-view';
import { MulterUploadFilter } from '../multer-upload.filter';
import { toHttp } from '../to-http';

/** The subset of a multer file the controller reads (avoids an @types/multer dep). */
interface UploadedMediaFile {
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
}

/**
 * `POST /api/media/assets` — multipart upload. The file arrives as the `file`
 * part; `folderId` and `alt` are optional text fields. Gated on `media:create`,
 * scoped to the caller's workspace.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceGuard)
@UseFilters(MulterUploadFilter)
@RequirePermissions(PERMISSIONS.MEDIA_CREATE)
@Controller('media')
export class UploadAssetController {
    constructor(
        private readonly upload: UploadAssetUseCase,
        private readonly views: AssetViewQuery
    ) {}

    /**
     * Uploads one file and returns its asset view.
     *
     * `FileInterceptor` is given **no** local options on purpose: it then falls
     * back to the `MulterModule` options `MediaModule.forRoot` registers from
     * `config.plugins.media.maxUploadBytes`. The cap used to be a module-level
     * `process.env` read here, which made the host's config value inert.
     */
    @Post('assets')
    @UseInterceptors(FileInterceptor('file'))
    async create(
        @UploadedFile() file: UploadedMediaFile | undefined,
        @Body() body: UploadAssetDto,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user: PublicUser
    ): Promise<AssetView> {
        if (!file) {
            throw new BadRequestException('file is required');
        }
        try {
            const id = await this.upload.execute(
                {
                    workspaceId,
                    folderId: body.folderId ?? null,
                    fileName: file.originalname,
                    contentType: file.mimetype,
                    body: Readable.from(file.buffer),
                    alt: body.alt ?? null
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
