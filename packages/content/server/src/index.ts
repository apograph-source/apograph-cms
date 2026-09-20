/** Public API of @orthacms/content-server. */

export { ContentPlugin } from './lib/utils/content-plugin';
export type {
    ContentPluginOptions,
    ContentServerPlugin
} from './lib/utils/content-plugin';

// Saved list views. A second `ServerPlugin` entry from this package because
// `ServerPlugin.migrations` holds one descriptor and content's is already the
// HOST's generated collection tables — see `content-views-plugin.ts`.
export { ContentViewsPlugin } from './lib/utils/content-views-plugin';
export type { ContentViewsPluginOptions } from './lib/utils/content-views-plugin';
export { ContentViewsModule } from './lib/views/content-views.module';
export {
    savedViews,
    savedViewDefaults,
    viewVisibility
} from './lib/views/infrastructure/schema';
export {
    VIEW_VISIBILITY,
    VIEW_VISIBILITY_VALUES
} from './lib/views/domain/saved-view';
export type {
    SavedView,
    SavedViewPayload,
    ViewVisibility
} from './lib/views/domain/saved-view';

export { collection, single, joinTableOf } from './lib/collection/define';
export { field } from './lib/fields';

export { ContentModule } from './lib/content.module';
export { CONTENT_REGISTRY, InjectContentRegistry } from './lib/content.tokens';

// The workspace's content grants. Exported (and exported from the global
// module) for plugins that bind their own copilot tools over content-scoped
// data — i18n's translations, media's assets. Every such tool takes its type
// name from the *model*, so each has to re-check the grants, and that check
// needs exactly one implementation rather than one per binder.
export { WorkspaceGrantsQuery } from './lib/content-types/queries/workspace-grants.query';

// The entry write engine, exported for the plugins that apply the copilot's
// proposals over content. Deliberately the *same* service the HTTP controllers
// call — ADR-0005 §5 requires an applied proposal to run the ordinary
// use-case, so an applier reaching for anything else is the bug the port
// exists to prevent.
export { EntryWriterService } from './lib/entries/infrastructure/persistence/entry-writer.service';
// Exported for the bound CONTENT_ENTRY_EXTENSION, which syncs relation links
// across locale siblings and must write them through the same service the
// entries pipeline does.
export { RelationLinkService } from './lib/entries/infrastructure/persistence/relation-link.service';

// The workspace's content-grant gate as a route guard, exported for the same
// reason `ApiTokenGuard` is: a plugin adding a route over this same content
// must reuse the exact rule rather than restate it. `@orthacms/transfer-server`
// puts export and import routes beside the entries routes, and skipping this
// would make either one a way to reach past the workspace's content surface.
export { ContentGrantGuard } from './lib/entries/http/guards/content-grant.guard';

export { CONTENT_ENTRY_EXTENSION } from './lib/extension/entry-extension';
export type {
    ContentEntryExtension,
    EntryFilterContext,
    EntryFilterExtension,
    EntryScopeParams,
    EntryTransaction,
    EntryWriteContext,
    EntryWriteFanout
} from './lib/extension/entry-extension';
export {
    RELATION_LOCALE_SYNC,
    relationLocaleSync,
    isPerLocaleField,
    isJoinBackedRelation,
    type RelationLocaleSync
} from './lib/extension/relation-locale-sync';

// The read-scope port. Separate from CONTENT_ENTRY_EXTENSION on purpose — that
// one is single-binding and i18n holds it; see the file header for why a
// composite was the wrong shape here.
export {
    ContentReadScopeRegistry,
    contentReadScopeRegistrar
} from './lib/extension/read-scope';
export type {
    ContentReadScope,
    ContentReadScopeContext
} from './lib/extension/read-scope';

// The publish-guard port — how a plugin refuses a publish without this package
// knowing why. A registry for the same reason the read scope is one: Nest has no
// multi-provider, and a silently-replaced publish rule is a rule the
// installation that bought it would never notice was gone.
export {
    ContentPublishGuardRegistry,
    contentPublishGuardRegistrar
} from './lib/extension/publish-guard';
export type {
    ContentPublishGuard,
    ContentPublishGuardContext,
    PublishActor,
    PublishAllowed,
    PublishRefused,
    PublishVerdict
} from './lib/extension/publish-guard';

// The entry-write extension port — how a plugin stores state *about* an entry
// inside the entry's own write transaction, and has it captured by (and restored
// from) the entry's own version history.
export {
    EntryWriteExtensionRegistry,
    entryWriteExtensionRegistrar
} from './lib/extension/entry-write-extension';
export type {
    EntryWriteExtension,
    EntryWriteExtensionInput,
    EntryWriteExtensionTarget
} from './lib/extension/entry-write-extension';

// The virtual filter-field registry — how a plugin other than the single bound
// `CONTENT_ENTRY_EXTENSION` adds fields to a type's `?filter=` surface.
export {
    EntryFilterProviderRegistry,
    entryFilterProviderRegistrar
} from './lib/extension/entry-filter-provider';
export type { EntryFilterProvider } from './lib/extension/entry-filter-provider';
// The transaction handle an extension is handed. Exported because an
// implementation lives in another package and has to name the type of the
// executor it must write on — the one rule of the port.
export type { DbTransaction } from './lib/entries/infrastructure/persistence/relation-link.service';

export {
    MEDIA_ASSET_RESOLVER,
    InjectMediaAssetResolver
} from './lib/extension/media-asset-resolver';
export type {
    MediaAssetResolver,
    ResolvedMediaAsset
} from './lib/extension/media-asset-resolver';

// Row ↔ record mappers, exported for extension plugins (e.g. i18n's
// translation copy) so their wire shapes can't drift from the pipeline's.
export {
    toColumns,
    toRecord
} from './lib/entries/infrastructure/persistence/entry-row';
export type {
    EntryListView,
    EntryMediaView,
    EntryRecord,
    MediaRef
} from './lib/entries/types/entry-list-view';

export { ContentTypeRegistry } from './lib/registry/content-type-registry';
export type {
    SerializedContentType,
    SerializedContentTypeSummary,
    SerializedField
} from './lib/registry/content-type-registry';

// The revision store, exported for `@orthacms/protection-server`: an approval is
// bound to a **revision**, so a plugin recording one has to be able to ask which
// version is currently the head and who wrote it. `content_entry_revisions` is
// host-owned and belongs to content, so the alternative was protection querying
// a table it does not own — which would make its correctness depend on content's
// unpublished column names rather than on a contract. Reads only; the write
// primitives are executor-parameterized for `EntryWriterService`'s own save
// transaction and are no use to anyone else.
export {
    REVISION_STORE,
    InjectRevisionStore
} from './lib/revisions/application/ports/revision-store';
export type {
    RevisionHead,
    RevisionStore
} from './lib/revisions/application/ports/revision-store';

// The snapshot comparison the revision-diff tools answer with. Exported rather
// than reimplemented by a second caller: the rules it encodes (empties collapse,
// link sets compare order-sensitively) are the ones the admin's own diff dialog
// shows, and a second copy would disagree the first time either moved.
export { diffSnapshots } from './lib/copilot/diff-snapshots';
export type { SnapshotFieldChange } from './lib/copilot/diff-snapshots';
export type { RevisionSnapshot } from './lib/revisions/types/revision-view';
export type {
    RevisionListView,
    RevisionSummary
} from './lib/revisions/types/revision-view';

// Filter evaluation over a content type, exported for `@orthacms/alarms-server`:
// an alarm rule IS a records-list filter, so it must be parsed and translated
// by the same surface the list uses rather than by a second implementation.
export { EntryMatchQuery } from './lib/entries/infrastructure/queries/entry-match.query';
export type { EntryMatchOptions } from './lib/entries/infrastructure/queries/entry-match.query';
export { EntryValidationService } from './lib/validation/services/entry-validation.service';
export type {
    ValidationIssue,
    ValidationResult
} from './lib/validation/services/entry-validation.service';

export { CONTENT_TYPE_KIND, ENTRY_STATUS } from './lib/types/content-type';
export type {
    AnyContentType,
    ContentType,
    ContentTypeKind,
    EntryStatus,
    ContentTypeOptions,
    EntryEnvelope,
    InferEntry,
    InferValues,
    SingleOptions
} from './lib/types/content-type';
export { CONTENT_FIELD_TYPE } from './lib/types/fields';
export { MEDIA_KIND_VALUES } from './lib/types/fields';
export type {
    AdminProps,
    AnyFieldSpec,
    BaseFieldOptions,
    FieldSpec,
    FieldType,
    FieldValidation,
    FieldValue,
    MediaAccept,
    MediaFieldOptions,
    MediaKindValue,
    RelationFieldOptions,
    RelationOnDelete,
    RelationSpec
} from './lib/types/fields';

// --- Public content API (`/api/v1/...`) ---
// The token-authenticated read surface. The wire contracts are exported so a
// consumer inside the monorepo (or a generated client) can type against them;
// the guards, so a plugin adding a route to the same surface reuses the exact
// authentication and workspace-resolution rules instead of restating them.
export type {
    PublicEntry,
    PublicEntryListView
} from './lib/public-api/types/public-entry';
export type { PublicContentTypeListView } from './lib/public-api/http/controllers/public-content-types.controller';
export { ApiTokenGuard } from './lib/public-api/http/guards/api-token.guard';
export { ApiTokenWorkspaceGuard } from './lib/public-api/http/guards/api-token-workspace.guard';
export { CurrentApiToken } from './lib/public-api/http/decorators/current-api-token.decorator';
export type {
    ApiTokenRequest,
    PublicApiToken
} from './lib/public-api/http/api-token-request';

// --- The public API's engine, for a second protocol over the same surface ---
// `@orthacms/content-graphql` serves `/v1/graphql` by assembling these exact
// DTOs and calling these exact services, so GraphQL and REST cannot drift on
// what a token may see or write. Everything below is the *implementation* of
// the public API rather than its wire contract: it is exported for that reuse,
// and a change here is a change to both protocols at once.
export { PublicEntriesQuery } from './lib/public-api/infrastructure/public-entries.query';
export type { EntryLocator } from './lib/public-api/infrastructure/public-entries.query';
export { PublicEntryWritesService } from './lib/public-api/infrastructure/public-entry-writes.service';
// `WorkspaceGrantsQuery` is exported above — the grant gate is shared with the
// copilot tool binders, which is the same one-implementation argument.
export { resolveGrantedType } from './lib/public-api/http/controllers/resolve-granted-type';
export type {
    ContentGrantsSource,
    GrantedType
} from './lib/public-api/http/controllers/resolve-granted-type';
export {
    PublicEntryQueryDto,
    PublicListEntriesQueryDto,
    ENTRY_VISIBILITY,
    PREVIEW,
    DEFAULT_EXPANSION_LIMIT
} from './lib/public-api/http/dto/public-list-entries-query.dto';
export type { EntryVisibility } from './lib/public-api/http/dto/public-list-entries-query.dto';
export { PublicSaveEntryDto } from './lib/public-api/http/dto/public-save-entry.dto';
// The batch write contracts, exported for the same reason as the single-entry
// ones: a second protocol adapter over this surface (GraphQL does exactly that
// for the singles) must be able to reach the DTOs and the result shape rather
// than invent its own.
export {
    PublicBulkIdsDto,
    PublicBulkSaveDto,
    PublicBulkSaveItemDto
} from './lib/public-api/http/dto/public-bulk.dto';
export { BULK_SAVE_OP } from './lib/public-api/types/public-bulk';
export type {
    BulkSaveOp,
    PublicBulkError,
    PublicBulkSaveItemResult,
    PublicBulkSaveResult
} from './lib/public-api/types/public-bulk';
export type {
    PublicMediaFieldView,
    PublicMediaRef,
    PublicRelationFieldView
} from './lib/public-api/types/public-expansion';
export {
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    // Exported for the other plugins' batch tools (i18n's bulk translation),
    // so "how many writes may one call start" is one number rather than a
    // second cap that drifts from this one.
    BULK_MAX_SAVE_ITEMS
} from './lib/entries/entries.constants';
export { RELATION_DELTA_ADDRESSING } from './lib/entries/types/entry-list-view';
export type {
    RelationDelta,
    RelationDeltaAddressing
} from './lib/entries/types/entry-list-view';
export {
    toTokenActor,
    toToolEventActor
} from './lib/public-api/infrastructure/token-actor';
