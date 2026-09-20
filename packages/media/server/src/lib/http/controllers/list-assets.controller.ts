import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { ListAssetsQuery } from '../../infrastructure/queries/list-assets.query';
import type { AssetListView } from '../../types/asset-view';
import { toHttp } from '../to-http';

/** Default page size when the client omits `pageSize`. */
const DEFAULT_PAGE_SIZE = 24;
/** Upper bound on `pageSize` to cap a single page. */
const MAX_PAGE_SIZE = 100;

function toPositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * `GET /api/media/assets` — one page of a folder's assets. Filter with
 * `?folderId=&search=&kind=&sort=&page=&pageSize=` (folderId omitted = the
 * workspace root). Gated on `media:read`.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.MEDIA_READ)
@Controller('media')
export class ListAssetsController {
    constructor(private readonly query: ListAssetsQuery) {}

    /**
     * Lists one page of assets.
     *
     * `folderId` and `kind` land in a `WHERE` against typed columns (`uuid` and
     * the `media_kind` enum), so an unparseable value used to reach Postgres and
     * come back as a **500**. The query now rejects them up front with a domain
     * error, which `toHttp` maps to the `400` a client typo deserves.
     */
    @Get('assets')
    async list(
        @CurrentWorkspace() workspaceId: string,
        @Query('folderId') folderId?: string,
        @Query('search') search?: string,
        @Query('kind') kind?: string,
        @Query('sort') sort?: string,
        @Query('page') page?: string,
        @Query('pageSize') pageSize?: string
    ): Promise<AssetListView> {
        try {
            return await this.query.execute({
                workspaceId,
                folderId: folderId ?? null,
                search,
                kind,
                sort,
                page: toPositiveInt(page, 1),
                pageSize: Math.min(
                    toPositiveInt(pageSize, DEFAULT_PAGE_SIZE),
                    MAX_PAGE_SIZE
                )
            });
        } catch (error) {
            toHttp(error);
        }
    }
}
