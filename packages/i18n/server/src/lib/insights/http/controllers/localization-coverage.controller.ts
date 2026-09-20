import { Controller, Get, UseGuards } from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { LocalizationCoverageQuery } from '../../infrastructure/queries/localization-coverage.query';
import type { I18nCoverageView } from '../../types/i18n-insights-view';

/**
 * `GET /api/insights/i18n/coverage` — how much of the workspace's localized
 * content exists in each configured locale, and how many records are fully
 * translated, untranslated, or part-way.
 *
 * Mounted under `insights/` beside content's and media's widgets rather than
 * under this plugin's own `i18n/` prefix: the Insights page's endpoints are
 * grouped by what they are, and a reader looking for the card's data should
 * find it next to the other cards'.
 *
 * Gated on `content:read` — it counts content, and a reader who may not see
 * entries must not learn how many there are by counting the gaps. Takes no
 * `?days=`: an untranslated record is untranslated regardless of when it was
 * written, so a window could only hide part of the backlog.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.CONTENT_READ)
@Controller('insights/i18n')
export class LocalizationCoverageController {
    constructor(private readonly coverage: LocalizationCoverageQuery) {}

    @Get('coverage')
    localization(
        @CurrentWorkspace() workspaceId: string
    ): Promise<I18nCoverageView> {
        return this.coverage.coverage(workspaceId);
    }
}
