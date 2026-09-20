import {
    Body,
    Controller,
    Param,
    ParseUUIDPipe,
    Patch,
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
import { SaveEntryDto } from '../dto/save-entry.dto';
import type { EntryRecord } from '../../types/entry-list-view';
import { resolveType } from './resolve-type';
import { toActor } from './to-actor';

/**
 * `PATCH /api/content/:typeName/:id` — replace a live entry's values with a
 * validated bag (the editor always submits the full document). 404 if there's no
 * live row; 422 with the issue list on validation failure. `OriginGuard` defends
 * this state-changing write; `WorkspaceGuard` scopes it to a workspace the caller
 * belongs to; `content:update` gates it.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceGuard, ContentGrantGuard)
@RequirePermissions(PERMISSIONS.CONTENT_UPDATE)
@Controller('content')
export class UpdateEntryController {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly writer: EntryWriterService
    ) {}

    @Patch(':typeName/:id')
    update(
        @Param('typeName') typeName: string,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: SaveEntryDto,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<EntryRecord> {
        const type = resolveType(this.registry, typeName);
        return this.writer.update(
            type,
            id,
            body.values,
            workspaceId,
            body.relations,
            toActor(user),
            { extensions: body.extensions }
        );
    }
}
