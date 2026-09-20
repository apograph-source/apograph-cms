import {
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    UseGuards
} from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { InjectContentRegistry } from '@orthacms/content-server';
import type { ContentTypeRegistry } from '@orthacms/content-server';
import {
    LocaleGroupService,
    type EntryLocalesView
} from '../services/locale-group.service';
import { resolveI18nType } from './resolve-type';

/**
 * `GET /api/i18n/content/:typeName/:id/locales` — the locale panel of one
 * entry: every configured locale with the group's row in it (id, status,
 * updatedAt) or null. Workspace-scoped like every entry read; gated on
 * `content:read`.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.CONTENT_READ)
@Controller('i18n/content')
export class GetEntryLocalesController {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly groups: LocaleGroupService
    ) {}

    @Get(':typeName/:id/locales')
    get(
        @Param('typeName') typeName: string,
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentWorkspace() workspaceId: string
    ): Promise<EntryLocalesView> {
        const type = resolveI18nType(this.registry, typeName);
        return this.groups.entryLocales(type, id, workspaceId);
    }
}
