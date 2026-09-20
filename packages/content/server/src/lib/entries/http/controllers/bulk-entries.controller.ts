import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Param,
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
import { BulkPublishPreviewQuery } from '../../infrastructure/queries/bulk-publish-preview.query';
import { BulkPublishEntriesUseCase } from '../../application/use-cases/bulk-publish-entries.use-case';
import { BulkUnpublishEntriesUseCase } from '../../application/use-cases/bulk-unpublish-entries.use-case';
import { BulkIdsDto } from '../dto/bulk-ids.dto';
import type {
    BulkActionResult,
    BulkPublishPreview,
    BulkPublishResult
} from '../../types/bulk-publish';
import { resolveType } from './resolve-type';
import { toActor } from './to-actor';

/**
 * Bulk entry actions over a set of `{ ids }`. **Registered before the
 * single-item controllers** (see `content.module.ts`): the literal `bulk`
 * segment sits in the same slot as those controllers' `:id`, so it must match
 * first — otherwise `/bulk/publish` would resolve as `:id='bulk'` (and trip the
 * single-item `ParseUUIDPipe`). `WorkspaceGuard` scopes every action to a
 * workspace the caller belongs to. Per-route permissions: publish/unpublish need
 * `content:publish`, delete/restore need `content:delete`.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceGuard, ContentGrantGuard)
@Controller('content')
export class BulkEntriesController {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly writer: EntryWriterService,
        private readonly bulkPublishPreview: BulkPublishPreviewQuery,
        private readonly bulkPublishEntries: BulkPublishEntriesUseCase,
        private readonly bulkUnpublishEntries: BulkUnpublishEntriesUseCase
    ) {}

    /** Dry run: validate each id and report a per-entry verdict. Writes nothing. */
    @Post(':typeName/bulk/publish/preview')
    @HttpCode(HttpStatus.OK)
    @RequirePermissions(PERMISSIONS.CONTENT_PUBLISH)
    previewPublish(
        @Param('typeName') typeName: string,
        @Body() body: BulkIdsDto,
        @CurrentWorkspace() workspaceId: string
    ): Promise<BulkPublishPreview> {
        const type = resolveType(this.registry, typeName);
        return this.bulkPublishPreview.preview(type, body.ids, workspaceId);
    }

    @Post(':typeName/bulk/publish')
    @HttpCode(HttpStatus.OK)
    @RequirePermissions(PERMISSIONS.CONTENT_PUBLISH)
    publish(
        @Param('typeName') typeName: string,
        @Body() body: BulkIdsDto,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<BulkPublishResult> {
        const type = resolveType(this.registry, typeName);
        return this.bulkPublishEntries.execute(
            type,
            body.ids,
            workspaceId,
            toActor(user)
        );
    }

    @Post(':typeName/bulk/unpublish')
    @HttpCode(HttpStatus.OK)
    @RequirePermissions(PERMISSIONS.CONTENT_PUBLISH)
    unpublish(
        @Param('typeName') typeName: string,
        @Body() body: BulkIdsDto,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<BulkActionResult> {
        const type = resolveType(this.registry, typeName);
        return this.bulkUnpublishEntries.execute(
            type,
            body.ids,
            workspaceId,
            toActor(user)
        );
    }

    @Post(':typeName/bulk/delete')
    @HttpCode(HttpStatus.OK)
    @RequirePermissions(PERMISSIONS.CONTENT_DELETE)
    remove(
        @Param('typeName') typeName: string,
        @Body() body: BulkIdsDto,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<BulkActionResult> {
        const type = resolveType(this.registry, typeName);
        return this.writer.bulkRemove(
            type,
            body.ids,
            workspaceId,
            toActor(user)
        );
    }

    @Post(':typeName/bulk/restore')
    @HttpCode(HttpStatus.OK)
    @RequirePermissions(PERMISSIONS.CONTENT_DELETE)
    restore(
        @Param('typeName') typeName: string,
        @Body() body: BulkIdsDto,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<BulkActionResult> {
        const type = resolveType(this.registry, typeName);
        return this.writer.bulkRestore(
            type,
            body.ids,
            workspaceId,
            toActor(user)
        );
    }

    @Post(':typeName/bulk/purge')
    @HttpCode(HttpStatus.OK)
    @RequirePermissions(PERMISSIONS.CONTENT_DELETE)
    purge(
        @Param('typeName') typeName: string,
        @Body() body: BulkIdsDto,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<BulkActionResult> {
        const type = resolveType(this.registry, typeName);
        return this.writer.bulkPurge(
            type,
            body.ids,
            workspaceId,
            toActor(user)
        );
    }
}
