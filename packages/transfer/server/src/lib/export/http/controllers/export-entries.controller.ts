import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    NotFoundException,
    Param,
    Post,
    Res,
    UseGuards
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import {
    ContentGrantGuard,
    InjectContentRegistry,
    type AnyContentType,
    type ContentTypeRegistry
} from '@orthacms/content-server';
import { OutboxWriter, UnitOfWork, attachActor } from '@orthacms/database';
import { resolveDepth } from '@orthacms/transfer-domain';
import { ExportEntriesUseCase } from '../../application/export-entries.use-case';
import {
    ExportPreviewQuery,
    type ExportPreview
} from '../../application/export-preview.query';
import { TRANSFER_EVENT_KINDS, transferEvent } from '../../../transfer.events';
import { ExportRequestDto } from '../dto/export-request.dto';

/**
 * Export routes.
 *
 * The guard stack is copied from content-server's own bulk controller, and
 * deliberately so: `ContentGrantGuard` is what keeps a member of a workspace
 * granted only `article` from exporting `tag` by naming it in the URL — the
 * same rule every other surface over this content already applies. An export
 * route that skipped it would be a way to read past the workspace's content
 * surface, which is worse here than on a list endpoint because it leaves with
 * the data.
 */
@ApiTags('transfer')
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceGuard, ContentGrantGuard)
@Controller('content')
export class ExportEntriesController {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly exportEntries: ExportEntriesUseCase,
        private readonly previewQuery: ExportPreviewQuery,
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter
    ) {}

    /** Counts what an export would carry. Writes nothing, streams nothing. */
    @Post(':typeName/export/preview')
    @HttpCode(HttpStatus.OK)
    @RequirePermissions(PERMISSIONS.CONTENT_EXPORT)
    @ApiOperation({
        summary: 'Count what an export would carry',
        description:
            'Runs the same graph walk the export runs and reports the counts, so the depth toggles can show their cost before the download starts.'
    })
    @ApiOkResponse({ description: 'Record, relation, file and byte counts.' })
    preview(
        @Param('typeName') typeName: string,
        @Body() body: ExportRequestDto,
        @CurrentWorkspace() workspaceId: string
    ): Promise<ExportPreview> {
        const type = this.resolveType(typeName);
        return this.previewQuery.preview(
            type,
            body.ids,
            workspaceId,
            resolveDepth(body.depth),
            body.format
        );
    }

    /** Streams the export as a file download. */
    @Post(':typeName/export')
    @HttpCode(HttpStatus.OK)
    @RequirePermissions(PERMISSIONS.CONTENT_EXPORT)
    @ApiOperation({
        summary: 'Export entries',
        description:
            'Walks one hop out from the selected records — their relations, files and locales — and streams the result in the requested format.'
    })
    async export(
        @Param('typeName') typeName: string,
        @Body() body: ExportRequestDto,
        @CurrentWorkspace() workspaceId: string,
        @Res() response: Response,
        @CurrentUser() user?: PublicUser
    ): Promise<void> {
        const type = this.resolveType(typeName);
        const depth = resolveDepth(body.depth);

        const download = await this.exportEntries.execute({
            type,
            ids: body.ids,
            workspaceId,
            format: body.format,
            depth
        });

        // Recorded before a byte leaves, so an interrupted download still
        // leaves a trace. See `transfer.events.ts`.
        await this.audit(type, workspaceId, body, download, user);

        response.setHeader('Content-Type', download.mimeType);
        response.setHeader(
            'Content-Disposition',
            `attachment; filename="${download.filename}"`
        );
        // The count is useful to a script that never opens the file, and to the
        // admin's success toast.
        response.setHeader(
            'X-Transfer-Records',
            String(download.result.records.length)
        );
        // Nothing downstream may sniff this into something executable.
        response.setHeader('X-Content-Type-Options', 'nosniff');

        await pipeline(download.body, response);
    }

    private async audit(
        type: AnyContentType,
        workspaceId: string,
        body: ExportRequestDto,
        download: Awaited<ReturnType<ExportEntriesUseCase['execute']>>,
        user?: PublicUser
    ): Promise<void> {
        const event = transferEvent(TRANSFER_EVENT_KINDS.EXPORTED, type.name, {
            workspaceId,
            format: body.format,
            selected: body.ids.length,
            ...download.result.counts
        });
        const events = user
            ? attachActor([event], { id: user.id, email: user.email })
            : [event];
        await this.uow.run(() => this.outbox.append(events));
    }

    /**
     * The type behind `:typeName`.
     *
     * `ContentGrantGuard` has already refused a type this workspace was not
     * granted, with a 404 that is deliberately indistinguishable from this one
     * — so neither route tells a caller which types exist elsewhere.
     */
    private resolveType(typeName: string): AnyContentType {
        const type = this.registry.get(typeName);
        if (!type) {
            throw new NotFoundException(`Unknown content type "${typeName}".`);
        }
        return type;
    }
}
