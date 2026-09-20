import {
    Body,
    Controller,
    HttpCode,
    Param,
    Post,
    UseGuards
} from '@nestjs/common';
import {
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { InjectContentRegistry } from '@orthacms/content-server';
import type { ContentTypeRegistry } from '@orthacms/content-server';
import { LocaleSummaryDto } from '../dto/locale-summary.dto';
import {
    LocaleGroupService,
    type LocaleSummaryView
} from '../services/locale-group.service';
import { resolveI18nType } from './resolve-type';

/**
 * `POST /api/i18n/content/:typeName/locale-summary` — the records table's
 * batched read: per requested translation-group id, the group's live members
 * with per-row status. Gated on `content:read`, workspace-scoped.
 *
 * **A POST that is a read**, because a page of group uuids outgrows a query
 * string — so it answers `200`, not a `201` that would claim it created
 * something.
 *
 * It still carries `OriginGuard`, unlike the reads that are shaped like reads.
 * The guard keys off the **verb** a browser sees, not off what the handler
 * happens to do with it: `POST` is the shape every cross-site form and
 * `fetch` uses, this route is reachable with nothing but the session cookie,
 * and "it only reads" is a property of today's handler that no test pins and
 * a later edit could quietly retract. The guard is free for every legitimate
 * caller — the admin sends its `Origin`, non-browser clients send none — so
 * exempting it bought nothing and left the contract ("state-changing routes
 * are origin-checked") disagreeing with the code. The body's shape is the
 * batching decision; the guard is not part of it.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.CONTENT_READ)
@Controller('i18n/content')
export class LocaleSummaryController {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly groups: LocaleGroupService
    ) {}

    @Post(':typeName/locale-summary')
    @HttpCode(200)
    summarize(
        @Param('typeName') typeName: string,
        @Body() body: LocaleSummaryDto,
        @CurrentWorkspace() workspaceId: string
    ): Promise<LocaleSummaryView> {
        const type = resolveI18nType(this.registry, typeName);
        return this.groups.summaries(type, body.groupIds, workspaceId);
    }
}
