import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
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
import { EntryWriterService } from '../../infrastructure/persistence/entry-writer.service';
import { SaveEntryDto } from '../dto/save-entry.dto';
import type { EntryRecord } from '../../types/entry-list-view';
import { resolveType } from './resolve-type';
import { toActor } from './to-actor';

/**
 * `POST /api/content/:typeName` — create a draft entry from a validated values
 * bag. The `:typeName` resolves via the registry (404 if unknown); the body is
 * validated against the type's field specs (422 with the issue list on failure).
 * `OriginGuard` defends this state-changing POST (CSRF); `WorkspaceGuard` scopes
 * it to a workspace the caller belongs to; `content:create` gates it. The
 * synchronous CSRF + permission guards run before `WorkspaceGuard` so a rejected
 * request never incurs its membership DB probe.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceGuard, ContentGrantGuard)
@RequirePermissions(PERMISSIONS.CONTENT_CREATE)
@Controller('content')
export class CreateEntryController {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly writer: EntryWriterService
    ) {}

    @Post(':typeName')
    create(
        @Param('typeName') typeName: string,
        @Body() body: SaveEntryDto,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<EntryRecord> {
        const type = resolveType(this.registry, typeName);
        return this.writer.create(
            type,
            body.values,
            workspaceId,
            body.relations,
            body.locale,
            body.localeGroupId,
            toActor(user),
            body.extensions
        );
    }
}
