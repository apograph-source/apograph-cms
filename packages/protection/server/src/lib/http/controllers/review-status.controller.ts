import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { ReviewStatusQuery } from '../../application/review-status.query';
import { ReviewStatusQueryDto } from '../../application/dto/review-status-query.dto';
import type { EntryReviewStatusMapView } from '../../types/protection-views';

/**
 * The records column's batched read:
 * `GET /api/protection/entries/:typeName/status?ids=…`.
 *
 * `content:read`, like the single-entry review route and for the same reason: a
 * contributor looking at their own drafts has to see which of them are waiting
 * on somebody. Gating it on `content:approve` would blank the column for the
 * people whose work it is about.
 *
 * It deliberately does **not** check the workspace's content grants. The caller
 * has already listed the entries through `/api/content/:typeName`, which is
 * grant-guarded — so a caller who could not reach the type has no ids to ask
 * about, and every id is scoped to the workspace inside the read anyway. An id
 * from elsewhere is simply absent from the answer.
 */
@ApiTags('protection')
@UseGuards(PermissionsGuard, WorkspaceGuard)
@Controller('protection/entries/:typeName/status')
export class ReviewStatusController {
    constructor(private readonly status: ReviewStatusQuery) {}

    /** Where each named entry stands, keyed by entry id. */
    @ApiOperation({
        summary: 'Review status for a page of entries',
        description:
            'The batched read behind the records list’s Review column. One ' +
            'request per page, never one per row. An id with no revision in ' +
            'this workspace under this type is absent from the answer rather ' +
            'than reported as unprotected, since the two are different facts. ' +
            'Counts come from the same kernel function the publish gate obeys.'
    })
    @RequirePermissions(PERMISSIONS.CONTENT_READ)
    @Get()
    async byEntry(
        @CurrentWorkspace() workspaceId: string,
        @Param('typeName') typeName: string,
        @Query() query: ReviewStatusQueryDto
    ): Promise<EntryReviewStatusMapView> {
        const byEntry = await this.status.forEntries(
            workspaceId,
            typeName,
            query.ids
        );
        return { byEntry: Object.fromEntries(byEntry) };
    }
}
