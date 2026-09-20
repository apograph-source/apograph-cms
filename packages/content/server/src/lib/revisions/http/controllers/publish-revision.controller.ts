import {
    Controller,
    Param,
    ParseIntPipe,
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
import { ContentGrantGuard } from '../../../entries/http/guards/content-grant.guard';
import { InjectContentRegistry } from '../../../content.tokens';
import type { ContentTypeRegistry } from '../../../registry/content-type-registry';
import { resolveType } from '../../../entries/http/controllers/resolve-type';
import { toActor } from '../../../entries/http/controllers/to-actor';
import type { EntryRecord } from '../../../entries/types/entry-list-view';
import { PublishRevisionUseCase } from '../../application/use-cases/publish-revision.use-case';

/**
 * `POST /api/content/:typeName/:id/revisions/:number/publish` — make a specific
 * version the entry's **live** one. The newest version publishes in place; an
 * earlier one is restored (as a new revision) then published, so history stays
 * append-only. `OriginGuard` defends the write; `WorkspaceGuard` scopes it;
 * `content:publish` gates it. `400` on a non-publishable type, `404` on an
 * absent version, `422 { issues }` when the version fails the publish gate.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceGuard, ContentGrantGuard)
@RequirePermissions(PERMISSIONS.CONTENT_PUBLISH)
@Controller('content')
export class PublishRevisionController {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly publishRevision: PublishRevisionUseCase
    ) {}

    @Post(':typeName/:id/revisions/:number/publish')
    publish(
        @Param('typeName') typeName: string,
        @Param('id', ParseUUIDPipe) id: string,
        @Param('number', ParseIntPipe) number: number,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<EntryRecord> {
        const type = resolveType(this.registry, typeName);
        return this.publishRevision.execute(
            type,
            id,
            number,
            workspaceId,
            toActor(user) ?? null
        );
    }
}
