import {
    Controller,
    Get,
    NotFoundException,
    Param,
    ParseIntPipe,
    ParseUUIDPipe,
    Query,
    UseGuards
} from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { ContentGrantGuard } from '../../../entries/http/guards/content-grant.guard';
import { clampInt } from '@orthacms/utils-server';
import { MAX_PAGE_SIZE } from '../../../entries/entries.constants';
import { InjectContentRegistry } from '../../../content.tokens';
import type { ContentTypeRegistry } from '../../../registry/content-type-registry';
import { resolveType } from '../../../entries/http/controllers/resolve-type';
import {
    InjectRevisionStore,
    type RevisionStore
} from '../../application/ports/revision-store';
import type {
    RevisionDetail,
    RevisionListView
} from '../../types/revision-view';
import { RevisionRefsQuery } from '../../infrastructure/queries/revision-refs.query';
import { REVISIONS_PAGE_SIZE } from '../../revisions.constants';

/**
 * `GET /api/content/:typeName/:id/revisions` — the version timeline of one entry
 * (newest first, paginated), and `.../revisions/:number` — one version with its
 * full snapshot (for preview / restore). Both scoped to a workspace the caller
 * belongs to and gated on `content:read`; a 404 on an unknown type or an
 * absent version.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard, ContentGrantGuard)
@RequirePermissions(PERMISSIONS.CONTENT_READ)
@Controller('content')
export class RevisionsController {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        @InjectRevisionStore() private readonly revisions: RevisionStore,
        private readonly refs: RevisionRefsQuery
    ) {}

    @Get(':typeName/:id/revisions')
    list(
        @Param('typeName') typeName: string,
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentWorkspace() workspaceId: string,
        @Query('page') page?: string,
        @Query('pageSize') pageSize?: string
    ): Promise<RevisionListView> {
        const type = resolveType(this.registry, typeName);
        return this.revisions.list(
            type.name,
            id,
            workspaceId,
            clampInt(page, 1, 1, Number.MAX_SAFE_INTEGER),
            clampInt(pageSize, REVISIONS_PAGE_SIZE, 1, MAX_PAGE_SIZE)
        );
    }

    @Get(':typeName/:id/revisions/:number')
    async get(
        @Param('typeName') typeName: string,
        @Param('id', ParseUUIDPipe) id: string,
        @Param('number', ParseIntPipe) number: number,
        @CurrentWorkspace() workspaceId: string
    ): Promise<RevisionDetail> {
        const type = resolveType(this.registry, typeName);
        const detail = await this.revisions.get(
            type.name,
            id,
            workspaceId,
            number
        );
        if (!detail) {
            throw new NotFoundException(
                `No revision #${number} for entry "${id}".`
            );
        }
        // Resolve the snapshot's relation ids to display refs so the preview can
        // list the actual linked records, not raw uuids.
        return this.refs.enrich(type, detail, workspaceId);
    }
}
