import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    NotFoundException,
    Param,
    Post,
    Res,
    UploadedFile,
    UseGuards,
    UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
    ApiConsumes,
    ApiOkResponse,
    ApiOperation,
    ApiTags
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    PermissionsService,
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
import {
    CONFLICT_POLICY,
    RELATION_POLICY,
    csvColumns,
    encodeCsv,
    type ImportPreview,
    type ImportResult,
    type TransferLimits
} from '@orthacms/transfer-domain';
import { TransferSchemaCatalog } from '../../../schema/schema-catalog.service';
import { InjectTransferLimits } from '../../../transfer.tokens';
import { TRANSFER_EVENT_KINDS, transferEvent } from '../../../transfer.events';
import { ImportEntriesUseCase } from '../../application/import-entries.use-case';
import {
    readUpload,
    type UploadedTransferFile
} from '../../infrastructure/upload-reader';
import { ImportRequestDto } from '../dto/import-request.dto';

/**
 * Import routes.
 *
 * The preview and the apply route take the same file and the same options and
 * differ by one flag, because they run the same pipeline. That is the contract
 * the dialog depends on: what the dry run showed is what the apply does.
 */
@ApiTags('transfer')
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceGuard, ContentGrantGuard)
@Controller('content')
export class ImportEntriesController {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly importEntries: ImportEntriesUseCase,
        private readonly catalog: TransferSchemaCatalog,
        @InjectTransferLimits() private readonly limits: TransferLimits,
        private readonly permissions: PermissionsService,
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter
    ) {}

    /** Dry run: report a per-record verdict, write nothing. */
    @Post(':typeName/import/preview')
    @HttpCode(HttpStatus.OK)
    @RequirePermissions(PERMISSIONS.CONTENT_IMPORT)
    @UseInterceptors(FileInterceptor('file'))
    @ApiConsumes('multipart/form-data')
    @ApiOperation({
        summary: 'Dry-run an import',
        description:
            'Parses the uploaded file and reports what each record would do — create, update, skip or fail — without writing anything.'
    })
    preview(
        @Param('typeName') typeName: string,
        @UploadedFile() file: UploadedTransferFile | undefined,
        @Body() body: ImportRequestDto,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<ImportPreview> {
        return this.run(typeName, file, body, workspaceId, true, user);
    }

    /** Applies the import, in one transaction. */
    @Post(':typeName/import')
    @HttpCode(HttpStatus.OK)
    @RequirePermissions(PERMISSIONS.CONTENT_IMPORT)
    @UseInterceptors(FileInterceptor('file'))
    @ApiConsumes('multipart/form-data')
    @ApiOperation({
        summary: 'Import entries',
        description:
            'Applies the uploaded document in a single transaction. Every write goes through the ordinary entry writer, so an import can never bypass validation, workspace scoping or permissions.'
    })
    async apply(
        @Param('typeName') typeName: string,
        @UploadedFile() file: UploadedTransferFile | undefined,
        @Body() body: ImportRequestDto,
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user?: PublicUser
    ): Promise<ImportResult> {
        const result = await this.run(
            typeName,
            file,
            body,
            workspaceId,
            false,
            user
        );
        await this.audit(typeName, workspaceId, result, user);
        return result;
    }

    /**
     * An empty CSV with this type's header row.
     *
     * Small, and it removes the worst part of a first import: guessing the
     * column names, getting one wrong, and having the file refused.
     */
    @Get(':typeName/import/template')
    @RequirePermissions(PERMISSIONS.CONTENT_READ)
    @ApiOperation({ summary: 'Download an empty CSV with this type’s columns' })
    @ApiOkResponse({ description: 'A one-line CSV: the header row.' })
    template(
        @Param('typeName') typeName: string,
        @Res() response: Response
    ): void {
        this.resolveType(typeName);
        const schema = this.catalog.schemaOf(typeName);
        if (!schema) {
            throw new NotFoundException(`Unknown content type "${typeName}".`);
        }
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader(
            'Content-Disposition',
            `attachment; filename="${typeName}-template.csv"`
        );
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.send(encodeCsv([csvColumns(schema)]));
    }

    private async run(
        typeName: string,
        file: UploadedTransferFile | undefined,
        body: ImportRequestDto,
        workspaceId: string,
        dryRun: boolean,
        user?: PublicUser
    ): Promise<ImportPreview & ImportResult> {
        this.resolveType(typeName);
        if (!file) {
            throw new BadRequestException('No file was uploaded.');
        }

        const { document, assets } = readUpload(file, {
            schemas: this.catalog.schemas(),
            identityFieldsOf: (type) => this.catalog.identityFieldsOf(type),
            defaultType: typeName,
            limits: this.limits
        });

        // The caller's own permissions, re-checked per write inside the use
        // case. `content:import` is permission to run an import; it is not
        // permission to create or update content, and an import must never be a
        // way around the keys that are.
        const held = new Set(
            user ? await this.permissions.forRole(user.roleId) : []
        );
        return this.importEntries.execute({
            document,
            assets,
            workspaceId,
            policy: body.policy ?? CONFLICT_POLICY.Skip,
            relations: body.relations ?? RELATION_POLICY.Link,
            dryRun,
            actor: user ? { id: user.id, email: user.email } : null,
            can: {
                create: held.has(PERMISSIONS.CONTENT_CREATE),
                update: held.has(PERMISSIONS.CONTENT_UPDATE)
            }
        });
    }

    private async audit(
        typeName: string,
        workspaceId: string,
        result: ImportResult,
        user?: PublicUser
    ): Promise<void> {
        const event = transferEvent(TRANSFER_EVENT_KINDS.IMPORTED, typeName, {
            workspaceId,
            ...result.counts
        });
        const events = user
            ? attachActor([event], { id: user.id, email: user.email })
            : [event];
        await this.uow.run(() => this.outbox.append(events));
    }

    private resolveType(typeName: string): AnyContentType {
        const type = this.registry.get(typeName);
        if (!type) {
            throw new NotFoundException(`Unknown content type "${typeName}".`);
        }
        return type;
    }
}
