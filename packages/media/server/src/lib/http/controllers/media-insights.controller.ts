import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { MediaInsightsQuery } from '../../infrastructure/queries/media-insights.query';
import type {
    MediaAltCoverageView,
    MediaStorageView,
    MediaUploadsView
} from '../../types/media-insights-view';

/** Window used when a request names none — matches the Insights page default. */
const DEFAULT_DAYS = 30;

/** Longest window an uploads read may ask for. */
const MAX_DAYS = 365;

/** Parses `?days=`, clamped to a sane window. */
function toDays(raw: string | undefined): number {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_DAYS;
    return Math.min(parsed, MAX_DAYS);
}

/**
 * `GET /api/insights/media/{storage,uploads,alt}` — the read-only aggregates
 * behind the media Insights widgets.
 *
 * Grouped in one controller, unlike content's four: these are three projections
 * of a **single table** with one dependency and one permission between them —
 * the read side of one resource rather than three separate use cases. Each
 * still gets its own route, so each widget owns its own request and one slow
 * aggregate can't blank the others.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.MEDIA_READ)
@Controller('insights/media')
export class MediaInsightsController {
    constructor(private readonly insights: MediaInsightsQuery) {}

    /** Assets and bytes per kind. */
    @Get('storage')
    storage(
        @CurrentWorkspace() workspaceId: string
    ): Promise<MediaStorageView> {
        return this.insights.storage(workspaceId);
    }

    /** Assets uploaded per time bucket. */
    @Get('uploads')
    uploads(
        @CurrentWorkspace() workspaceId: string,
        @Query('days') days?: string
    ): Promise<MediaUploadsView> {
        return this.insights.uploads(workspaceId, toDays(days));
    }

    /** Alt-text coverage across the workspace's images. */
    @Get('alt')
    alt(
        @CurrentWorkspace() workspaceId: string
    ): Promise<MediaAltCoverageView> {
        return this.insights.altCoverage(workspaceId);
    }
}
