import { Controller, Get, UseGuards } from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { ContentInsightsQuery } from '../../infrastructure/queries/content-insights.query';
import type { ContentPipelineView } from '../../types/content-insights-view';

/**
 * `GET /api/insights/content/pipeline` — the draft/published split for every
 * content type that has at least one entry in the workspace.
 *
 * Takes no `?days=`: this is a snapshot of what exists now, not a flow over
 * time. Filtering it by a window would answer a different and much less useful
 * question ("what was created recently") under the same name.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.CONTENT_READ)
@Controller('insights/content')
export class ContentPipelineController {
    constructor(private readonly insights: ContentInsightsQuery) {}

    @Get('pipeline')
    pipeline(
        @CurrentWorkspace() workspaceId: string
    ): Promise<ContentPipelineView> {
        return this.insights.pipeline(workspaceId);
    }
}
