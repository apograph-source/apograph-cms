import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { ContentInsightsQuery } from '../../infrastructure/queries/content-insights.query';
import type { ContentPunchcardView } from '../../types/content-insights-view';
import {
    DEFAULT_INSIGHTS_DAYS,
    InsightsRangeQueryDto
} from '../dto/insights-range-query.dto';

/**
 * `GET /api/insights/content/punchcard` — editing activity by weekday and hour.
 *
 * Reads `content_entry_revisions` rather than the activity log: a revision is
 * written on every save and carries a `workspace_id`, whereas `activity_events`
 * is a global table with no workspace column, so a workspace-scoped answer
 * simply isn't available from it. Saves are also the better signal — they cover
 * the editing work, not only the moments something went live.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.CONTENT_READ)
@Controller('insights/content')
export class ContentPunchcardController {
    constructor(private readonly insights: ContentInsightsQuery) {}

    @Get('punchcard')
    punchcard(
        @Query() query: InsightsRangeQueryDto,
        @CurrentWorkspace() workspaceId: string
    ): Promise<ContentPunchcardView> {
        return this.insights.punchcard(
            workspaceId,
            query.days ?? DEFAULT_INSIGHTS_DAYS
        );
    }
}
