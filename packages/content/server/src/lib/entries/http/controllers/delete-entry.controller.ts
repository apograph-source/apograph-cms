import {
    Controller,
    Delete,
    HttpCode,
    HttpStatus,
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
import { EntryWriterService } from '../../infrastructure/persistence/entry-writer.service';
import type { EntryRecord } from '../../types/entry-list-view';
import { resolveType } from './resolve-type';
import { toActor } from './to-actor';

/**
 * Single-entry removal lifecycle, all gated on `content:delete`:
 * - `DELETE /api/content/:typeName/:id` — soft delete (stamp `deleted_at`) for a
 *   paranoid type, hard delete otherwise; 204.
 * - `POST   /api/content/:typeName/:id/restore` — clear the tombstone (paranoid
 *   only); returns the restored record.
 * - `DELETE /api/content/:typeName/:id/permanent` — permanently remove a
 *   tombstoned row (paranoid only); 204.
 *
 * `OriginGuard` defends these state-changing writes; `WorkspaceGuard` scopes them
 * to a workspace the caller belongs to.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceGuard, ContentGrantGuard)
@RequirePermissions(PERMISSIONS.CONTENT_DELETE)
@Controller('content')
export class DeleteEntryController {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly writer: EntryWriterService
    ) {}

    @Delete(':typeName/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    async remove(
        @Param('typeName') typeName: string,
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<void> {
        const type = resolveType(this.registry, typeName);
        await this.writer.remove(type, id, workspaceId, toActor(user));
    }

    @Post(':typeName/:id/restore')
    restore(
        @Param('typeName') typeName: string,
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<EntryRecord> {
        const type = resolveType(this.registry, typeName);
        return this.writer.restore(type, id, workspaceId, toActor(user));
    }

    @Delete(':typeName/:id/permanent')
    @HttpCode(HttpStatus.NO_CONTENT)
    async purge(
        @Param('typeName') typeName: string,
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<void> {
        const type = resolveType(this.registry, typeName);
        await this.writer.purge(type, id, workspaceId, toActor(user));
    }
}
