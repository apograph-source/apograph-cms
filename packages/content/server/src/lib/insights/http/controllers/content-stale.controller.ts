import { Controller, Get, UseGuards } from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { ContentInsightsQuery } from '../../infrastructure/queries/content-insights.query';
import type { ContentStaleView } from '../../types/content-insights-view';

/**
 * `GET /api/insights/content/stale` — published entries bucketed by how long
 * ago they were last edited.
 *
 * Takes no `?days=`: the buckets *are* the time axis, and they are fixed
 * (30/90/180/365/older) so the answer means the same thing whichever range the
 * page is set to. "What has nobody touched in a year" is not a question about
 * the last 7 days.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.CONTENT_READ)
@Controller('insights/content')
export class ContentStaleController {
    constructor(private readonly insights: ContentInsightsQuery) {}

    @Get('stale')
    stale(@CurrentWorkspace() workspaceId: string): Promise<ContentStaleView> {
        return this.insights.stale(workspaceId);
    }
}
