import { Module, type DynamicModule } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { resolveLimits, type TransferLimits } from '@orthacms/transfer-domain';
import { ExportEntriesUseCase } from './export/application/export-entries.use-case';
import { ExportPreviewQuery } from './export/application/export-preview.query';
import { EntryGraphWalker } from './export/infrastructure/entry-graph.walker';
import { ExportEntriesController } from './export/http/controllers/export-entries.controller';
import { ImportEntriesUseCase } from './import/application/import-entries.use-case';
import { ImportMediaService } from './import/infrastructure/import-media.service';
import { ImportEntriesController } from './import/http/controllers/import-entries.controller';
import { TransferSchemaCatalog } from './schema/schema-catalog.service';
import { TRANSFER_CONFIG, TRANSFER_LIMITS } from './transfer.tokens';
import type { TransferPluginConfig } from './types/transfer-config';

/**
 * The transfer plugin's module.
 *
 * Not global, and it exports nothing: nothing else in the system needs to call
 * into a transfer. Everything it needs comes the other way — content's
 * registry and entry writer, media's storage and upload path, identity's
 * permissions — all from modules that are already global.
 */
@Module({})
export class TransferModule {
    static forRoot(config: TransferPluginConfig): DynamicModule {
        const limits = resolveLimits(config.limits);
        return {
            module: TransferModule,
            imports: [
                // The upload cap belongs to the request layer, and it has to
                // agree with `maxUploadBytes` — multer refusing at a different
                // size than the reader checks would mean one of the two numbers
                // is decoration.
                MulterModule.register({
                    limits: { fileSize: limits.maxUploadBytes }
                })
            ],
            controllers: [ExportEntriesController, ImportEntriesController],
            providers: [
                { provide: TRANSFER_CONFIG, useValue: config },
                {
                    provide: TRANSFER_LIMITS,
                    useValue: limits satisfies TransferLimits
                },
                TransferSchemaCatalog,
                EntryGraphWalker,
                ExportEntriesUseCase,
                ExportPreviewQuery,
                ImportMediaService,
                ImportEntriesUseCase
            ]
        };
    }
}
