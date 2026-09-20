import { Controller, Get, UseGuards } from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { ContentInsightsQuery } from '../../infrastructure/queries/content-insights.query';
import type { ContentUnshippedView } from '../../types/content-insights-view';

/**
 * `GET /api/insights/content/unshipped` — entries that are live but carry
 * unpublished edits (the admin's **Modified** state), per type and in total.
 *
 * Takes no `?days=`, for the same reason `stale` doesn't: a pending edit is
 * pending whether it was made this morning or last spring, and windowing it
 * would quietly answer "changes made recently that are unpublished" under a name
 * that promises the backlog.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.CONTENT_READ)
@Controller('insights/content')
export class ContentUnshippedController {
    constructor(private readonly insights: ContentInsightsQuery) {}

    @Get('unshipped')
    unshipped(
        @CurrentWorkspace() workspaceId: string
    ): Promise<ContentUnshippedView> {
        return this.insights.unshipped(workspaceId);
    }
}
