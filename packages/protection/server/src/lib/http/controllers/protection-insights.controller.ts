import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { ProtectionInsightsQuery } from '../../application/protection-insights.query';
import type { ProtectionInsightsView } from '../../types/protection-views';

/**
 * `GET /api/insights/protection/reviews` — the card's figures.
 *
 * Mounted under `insights/` rather than `protection/` because that is where the
 * dashboard's other aggregates live and a widget is read as part of the page it
 * sits on; the plugin still owns the route and the numbers.
 *
 * `content:read`, matching the card's own `permission` in the admin so the
 * widget is not rendered for somebody the request would then refuse.
 */
@ApiTags('protection')
@UseGuards(PermissionsGuard, WorkspaceGuard)
@Controller('insights/protection/reviews')
export class ProtectionInsightsController {
    constructor(private readonly insights: ProtectionInsightsQuery) {}

    /** Open review requests, and how many have waited too long. */
    @ApiOperation({
        summary: 'Outstanding review requests',
        description:
            'How many review requests are open in this workspace, and how ' +
            'many have been open longer than the reported threshold. No time ' +
            'window: a request waiting a fortnight is waiting whether it was ' +
            'asked this morning or last spring.'
    })
    @RequirePermissions(PERMISSIONS.CONTENT_READ)
    @Get()
    summary(
        @CurrentWorkspace() workspaceId: string
    ): Promise<ProtectionInsightsView> {
        return this.insights.summary(workspaceId);
    }
}
