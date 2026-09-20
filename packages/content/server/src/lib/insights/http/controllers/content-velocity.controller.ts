import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { ContentInsightsQuery } from '../../infrastructure/queries/content-insights.query';
import type { ContentVelocityView } from '../../types/content-insights-view';
import {
    DEFAULT_INSIGHTS_DAYS,
    InsightsRangeQueryDto
} from '../dto/insights-range-query.dto';

/**
 * `GET /api/insights/content/velocity` — entries published per time bucket
 * across the selected window.
 *
 * Counts `published_at`, so an entry that was published, unpublished and
 * published again contributes at its latest publish only. The column records a
 * state, not a log, and the widget's caption is written to match.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.CONTENT_READ)
@Controller('insights/content')
export class ContentVelocityController {
    constructor(private readonly insights: ContentInsightsQuery) {}

    @Get('velocity')
    velocity(
        @Query() query: InsightsRangeQueryDto,
        @CurrentWorkspace() workspaceId: string
    ): Promise<ContentVelocityView> {
        return this.insights.velocity(
            workspaceId,
            query.days ?? DEFAULT_INSIGHTS_DAYS
        );
    }
}
