import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { ContentInsightsQuery } from '../../infrastructure/queries/content-insights.query';
import type { ContentTotalsView } from '../../types/content-insights-view';
import {
    DEFAULT_INSIGHTS_DAYS,
    InsightsRangeQueryDto
} from '../dto/insights-range-query.dto';

/**
 * `GET /api/insights/content/totals` — entry, published and draft counts for
 * the workspace, with the change over the window and a short history for the
 * stat tiles' sparklines.
 *
 * Its own endpoint rather than a field on a combined Insights response: each
 * widget on the page owns its own request, so a slow or failing aggregate
 * degrades one card instead of blanking the dashboard.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.CONTENT_READ)
@Controller('insights/content')
export class ContentTotalsController {
    constructor(private readonly insights: ContentInsightsQuery) {}

    @Get('totals')
    totals(
        @Query() query: InsightsRangeQueryDto,
        @CurrentWorkspace() workspaceId: string
    ): Promise<ContentTotalsView> {
        return this.insights.totals(
            workspaceId,
            query.days ?? DEFAULT_INSIGHTS_DAYS
        );
    }
}
