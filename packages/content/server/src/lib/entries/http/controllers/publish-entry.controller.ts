import {
    Body,
    Controller,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards
} from '@nestjs/common';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    type PublicUser,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { ContentGrantGuard } from '../guards/content-grant.guard';
import { InjectContentRegistry } from '../../../content.tokens';
import type { ContentTypeRegistry } from '../../../registry/content-type-registry';
import { PublishEntryUseCase } from '../../application/use-cases/publish-entry.use-case';
import { UnpublishEntryUseCase } from '../../application/use-cases/unpublish-entry.use-case';
import type { EntryRecord } from '../../types/entry-list-view';
import { PublishEntryDto } from '../dto/publish-entry.dto';
import { resolveType } from './resolve-type';
import { toActor } from './to-actor';

/**
 * `POST /api/content/:typeName/:id/publish` and `.../unpublish` — the publish
 * workflow for a single entry. Publish revalidates the stored row (a 422 if the
 * draft no longer passes), then stamps `status='published'` + `published_at`;
 * unpublish reverts to draft. Both 400 on a non-publishable type and 404 on a
 * missing live row. `OriginGuard` defends the writes; `WorkspaceGuard` scopes
 * them to a workspace the caller belongs to; `content:publish` gates them.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceGuard, ContentGrantGuard)
@RequirePermissions(PERMISSIONS.CONTENT_PUBLISH)
@Controller('content')
export class PublishEntryController {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly publishEntry: PublishEntryUseCase,
        private readonly unpublishEntry: UnpublishEntryUseCase
    ) {}

    @Post(':typeName/:id/publish')
    publish(
        @Param('typeName') typeName: string,
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentWorkspace() workspaceId: string,
        @Body() body?: PublishEntryDto,
        @CurrentUser() user?: PublicUser
    ): Promise<EntryRecord> {
        const type = resolveType(this.registry, typeName);
        return this.publishEntry.execute(
            type,
            id,
            workspaceId,
            toActor(user),
            undefined,
            body?.bypass === true
        );
    }

    @Post(':typeName/:id/unpublish')
    unpublish(
        @Param('typeName') typeName: string,
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<EntryRecord> {
        const type = resolveType(this.registry, typeName);
        return this.unpublishEntry.execute(
            type,
            id,
            workspaceId,
            toActor(user)
        );
    }
}
