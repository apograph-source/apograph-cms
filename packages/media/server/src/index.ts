export { MediaServerPlugin } from './lib/utils/media-plugin';
export type {
    MediaServerPluginDefinition,
    MediaPluginOptions
} from './lib/utils/media-plugin';
export { MediaModule } from './lib/media.module';
export type { MediaModuleOptions } from './lib/media.module';
export type { MediaPluginConfig } from './lib/types/media-config';
export type {
    StorageProvider,
    StorageCapabilities,
    StoredObject,
    PutObject,
    DirectUrlOptions
} from '@orthacms/media-domain';
export { STORAGE_PROVIDER } from '@orthacms/media-domain';
export type { DirectServeMode } from './lib/http/direct-serve';
// Re-exported for the plugins that already depend on this package. The provider
// packages take it from `@orthacms/media-domain` instead: it is a *value*, and
// importing it from here dragged this barrel — and with it `MediaModule` and
// NestJS — into every adapter's require graph.
export { ObjectNotFoundError } from '@orthacms/media-domain';
// The upload use case, exported for the plugins that write assets on someone's
// behalf — `@orthacms/transfer-server` recreates an archive's files on import.
// Deliberately the *same* use case the upload controller calls, for the reason
// content-server exports `EntryWriterService`: an importer reaching past it
// would skip the kind derivation, the image derivatives and the outbox event,
// and produce asset rows the rest of the plugin has never seen the like of.
export { UploadAssetUseCase } from './lib/application/use-cases/upload-asset.use-case';
export type { UploadAssetCommand } from './lib/application/use-cases/upload-asset.use-case';

export type { AssetView, AssetListView } from './lib/types/asset-view';
export type { FolderView, FoldersView } from './lib/types/folder-view';
export * from './lib/infrastructure/schema';
