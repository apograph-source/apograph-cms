/** Public API of @orthacms/transfer-server. */

export { TransferPlugin } from './lib/utils/transfer-plugin';
export type { TransferServerPluginType } from './lib/utils/transfer-plugin';
export type { TransferPluginConfig } from './lib/types/transfer-config';

export { TransferModule } from './lib/transfer.module';
export { TRANSFER_CONFIG, TRANSFER_LIMITS } from './lib/transfer.tokens';

export { TRANSFER_EVENT_KINDS } from './lib/transfer.events';

export { TransferSchemaCatalog } from './lib/schema/schema-catalog.service';

export { EntryGraphWalker } from './lib/export/infrastructure/entry-graph.walker';
export type {
    WalkRequest,
    WalkResult,
    WalkedAsset
} from './lib/export/infrastructure/entry-graph.walker';
export { ExportEntriesUseCase } from './lib/export/application/export-entries.use-case';
export type {
    ExportCommand,
    ExportDownload
} from './lib/export/application/export-entries.use-case';
export { ExportPreviewQuery } from './lib/export/application/export-preview.query';
export type { ExportPreview } from './lib/export/application/export-preview.query';

export { ImportEntriesUseCase } from './lib/import/application/import-entries.use-case';
export type { ImportCommand } from './lib/import/application/import-entries.use-case';

// The archive container, exported so a test (and a future async-job runner)
// can build and read one without going through an HTTP route.
export { createZipStream } from './lib/archive/zip-writer';
export type { ZipMember } from './lib/archive/zip-writer';
export {
    ZipReadError,
    looksLikeZip,
    readZipDirectory,
    readZipEntry
} from './lib/archive/zip-reader';
export type { ZipEntry } from './lib/archive/zip-reader';
