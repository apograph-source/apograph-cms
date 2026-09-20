import { DynamicModule, Module } from '@nestjs/common';
import {
    CONTENT_CATALOG,
    CONTENT_ENTRY_COUNTER,
    type ContentCatalog
} from '@orthacms/workspaces-server';
import { CONTENT_REGISTRY } from './content.tokens';
import type { ContentTypeRegistry } from './registry/content-type-registry';
import { ListContentSchemaController } from './content-types/controllers/list-content-schema.controller';
import { GetContentSchemaController } from './content-types/controllers/get-content-schema.controller';
import { GetFilterFieldsController } from './content-types/controllers/get-filter-fields.controller';
import { WorkspaceGrantsQuery } from './content-types/queries/workspace-grants.query';
import { ContentReadScopeRegistry } from './extension/read-scope';
import { ContentPublishGuardRegistry } from './extension/publish-guard';
import { EntryWriteExtensionRegistry } from './extension/entry-write-extension';
import { EntryFilterProviderRegistry } from './extension/entry-filter-provider';
import { ContentGrantGuard } from './entries/http/guards/content-grant.guard';
import { ListEntriesController } from './entries/http/controllers/list-entries.controller';
import { BulkEntriesController } from './entries/http/controllers/bulk-entries.controller';
import { CreateEntryController } from './entries/http/controllers/create-entry.controller';
import { GetEntryController } from './entries/http/controllers/get-entry.controller';
import { UpdateEntryController } from './entries/http/controllers/update-entry.controller';
import { PublishEntryController } from './entries/http/controllers/publish-entry.controller';
import { DeleteEntryController } from './entries/http/controllers/delete-entry.controller';
import { EntryExtensionBootCheck } from './extension/entry-extension-boot-check';
import { copilotAppliersRegistrar } from '@orthacms/copilot-server';
import { ContentCopilotToolProvider } from './copilot/content-tool.provider';
import { RevisionCopilotToolProvider } from './copilot/revision-tool.provider';
import { EntryProposalToolProvider } from './copilot/entry-proposal.provider';
import {
    BulkSaveEntriesProposalApplier,
    CreateEntryProposalApplier,
    UpdateEntryProposalApplier
} from './copilot/entry-proposal.applier';
import { EntryValidationService } from './validation/services/entry-validation.service';
import { EntriesService } from './entries/infrastructure/queries/entries.service';
import { EntryMatchQuery } from './entries/infrastructure/queries/entry-match.query';
import { MediaRefsQuery } from './entries/infrastructure/queries/media-refs.query';
import { EntryWriterService } from './entries/infrastructure/persistence/entry-writer.service';
import { EntryCounterService } from './entries/infrastructure/persistence/entry-counter.service';
import { RelationLinkService } from './entries/infrastructure/persistence/relation-link.service';
import { BulkPublishPreviewQuery } from './entries/infrastructure/queries/bulk-publish-preview.query';
import { PublishEntryUseCase } from './entries/application/use-cases/publish-entry.use-case';
import { UnpublishEntryUseCase } from './entries/application/use-cases/unpublish-entry.use-case';
import { BulkPublishEntriesUseCase } from './entries/application/use-cases/bulk-publish-entries.use-case';
import { BulkUnpublishEntriesUseCase } from './entries/application/use-cases/bulk-unpublish-entries.use-case';
import { REVISION_STORE } from './revisions/application/ports/revision-store';
import { DrizzleRevisionStore } from './revisions/infrastructure/persistence/drizzle-revision.store';
import { RestoreRevisionUseCase } from './revisions/application/use-cases/restore-revision.use-case';
import { PublishRevisionUseCase } from './revisions/application/use-cases/publish-revision.use-case';
import { RevisionRefsQuery } from './revisions/infrastructure/queries/revision-refs.query';
import { RevisionsWorkspacePurger } from './revisions/infrastructure/purge/revisions-workspace.purger';
import { RevisionsController } from './revisions/http/controllers/revisions.controller';
import { RestoreRevisionController } from './revisions/http/controllers/restore-revision.controller';
import { PublishRevisionController } from './revisions/http/controllers/publish-revision.controller';
import { PublicContentTypesController } from './public-api/http/controllers/public-content-types.controller';
import { PublicEntriesController } from './public-api/http/controllers/public-entries.controller';
import { PublicEntryWritesController } from './public-api/http/controllers/public-entry-writes.controller';
import { ApiTokenGuard } from './public-api/http/guards/api-token.guard';
import { ApiTokenWorkspaceGuard } from './public-api/http/guards/api-token-workspace.guard';
import { PublicEntriesQuery } from './public-api/infrastructure/public-entries.query';
import { PublicEntryWritesService } from './public-api/infrastructure/public-entry-writes.service';
import { DraftVisibilityGuard } from './public-api/http/guards/draft-visibility.guard';
import { PublicExpansionQuery } from './public-api/infrastructure/public-expansion.query';
import { ContentToolProvider } from './mcp/content-tools.provider';
import { ContentInsightsQuery } from './insights/infrastructure/queries/content-insights.query';
import { ContentTotalsController } from './insights/http/controllers/content-totals.controller';
import { ContentStaleController } from './insights/http/controllers/content-stale.controller';
import { ContentPipelineController } from './insights/http/controllers/content-pipeline.controller';
import { ContentVelocityController } from './insights/http/controllers/content-velocity.controller';
import { ContentPunchcardController } from './insights/http/controllers/content-punchcard.controller';
import { ContentUnshippedController } from './insights/http/controllers/content-unshipped.controller';

/**
 * NestJS module for the content plugin. Registered globally so the
 * registry and validation service are injectable from any plugin (the
 * admin BFF, future provenance/audit features, identity's workspace
 * grants) without an explicit import.
 *
 * Owns no database schema of its own in this milestone — the HOST owns
 * the generated collection tables and their migrations; this module owns
 * the registry, its HTTP surface, and value validation.
 *
 * It also binds identity's {@link CONTENT_CATALOG} port to the registry, so
 * identity's `GET /api/content-types` and the workspace-grant flow resolve
 * against the real code-defined types instead of identity's built-in mock.
 */
@Module({})
export class ContentModule {
    /** Creates the global dynamic module around a validated registry. */
    static forRoot(registry: ContentTypeRegistry): DynamicModule {
        return {
            module: ContentModule,
            global: true,
            controllers: [
                ListContentSchemaController,
                // The `:name/filter-fields` route is more specific than
                // `GetContentSchemaController`'s `:name`, so their order is
                // immaterial, but keep the schema routes grouped.
                GetFilterFieldsController,
                GetContentSchemaController,
                // Bulk routes carry a literal `bulk` in the `:id` slot, so they
                // must be registered before the single-item controllers below
                // (`:typeName/:id/...`) to win the match. The list controller is
                // unaffected (`GET :typeName` is one segment shorter).
                BulkEntriesController,
                ListEntriesController,
                CreateEntryController,
                GetEntryController,
                UpdateEntryController,
                PublishEntryController,
                DeleteEntryController,
                // Revisions feature — the version timeline read + restore. Their
                // literal `revisions` segment can't collide with the single-item
                // routes above.
                RevisionsController,
                RestoreRevisionController,
                PublishRevisionController,
                // The public, token-authenticated read API (`/api/v1/...`).
                // Its own `v1` prefix keeps it clear of the admin routes, so
                // registration order relative to them doesn't matter; the
                // `v1/content-types` prefix likewise can't collide with
                // `v1/content/:typeName` (different first segment).
                PublicContentTypesController,
                // The write routes go FIRST: `POST :typeName` (create) would
                // otherwise be shadowed by nothing, but `PATCH`/`DELETE
                // :typeName/group/:gid` and the reads' `GET :typeName/group/:gid`
                // share a shape, and keeping the two controllers' orders
                // consistent means the group-before-id rule holds across both.
                PublicEntryWritesController,
                PublicEntriesController,
                // Insights read-model. Their `insights` first segment can't
                // collide with the `content/:typeName` routes above, and each
                // widget on the Insights page owns one of these endpoints so a
                // slow aggregate degrades a single card.
                ContentTotalsController,
                ContentStaleController,
                ContentPipelineController,
                ContentVelocityController,
                ContentPunchcardController,
                ContentUnshippedController
            ],
            providers: [
                { provide: CONTENT_REGISTRY, useValue: registry },
                {
                    // Adapt the registry to identity's catalogue port. Summaries
                    // are shape-compatible with `ContentTypeDescriptor`.
                    provide: CONTENT_CATALOG,
                    useFactory: (reg: ContentTypeRegistry): ContentCatalog => ({
                        list: () => reg.summaries()
                    }),
                    inject: [CONTENT_REGISTRY]
                },
                // Bind identity's entry-counter port to the registry-backed
                // counter, so the workspace "revoke content only when empty"
                // rule sees the real stored entries. Same inversion as the
                // catalogue above.
                EntryCounterService,
                {
                    provide: CONTENT_ENTRY_COUNTER,
                    useExisting: EntryCounterService
                },
                EntryValidationService,
                WorkspaceGrantsQuery,
                // Holds the read scopes a downstream plugin registers. Provided
                // (and exported) unconditionally: an empty registry is what an
                // installation with no scoping plugin has, and it costs a
                // length check per read.
                ContentReadScopeRegistry,
                ContentPublishGuardRegistry,
                EntryWriteExtensionRegistry,
                EntryFilterProviderRegistry,
                // Every registry-driven `content/:typeName` route is guarded by
                // it, so it is resolved from this module's context.
                ContentGrantGuard,
                EntriesService,
                // Filter evaluation as a reusable question ('which entries match
                // this tree?'), exported for `@orthacms/alarms-server`.
                EntryMatchQuery,
                ContentInsightsQuery,
                // Resolves media field ids → display refs (thumbnails); injected
                // by the entry-media read endpoint and the revision refs query.
                // No-ops when the media plugin binds no resolver.
                MediaRefsQuery,
                // The generic revision store, bound to its Drizzle adapter and
                // injected by EntryWriterService (snapshot-on-save) + the
                // revisions read/restore. Registered before EntryWriterService's
                // provider is resolved — Nest orders by the dependency graph.
                { provide: REVISION_STORE, useClass: DrizzleRevisionStore },
                RestoreRevisionUseCase,
                // Publish a specific version live (restore-if-needed + publish).
                PublishRevisionUseCase,
                // Resolves a previewed revision's relation ids to display refs
                // (the "exact linked records" the diff shows).
                RevisionRefsQuery,
                // Removes a deleted workspace's revision history. Content
                // otherwise refuses rather than purges, but revisions escape
                // that protection in both directions: no FK to `workspaces`,
                // and `countWorkspaceEntries` sums live entry tables only — so
                // a workspace whose entries were all deleted counts as empty,
                // deletes cleanly, and strands its whole version timeline.
                RevisionsWorkspacePurger,
                EntryWriterService,
                RelationLinkService,
                // Entries feature, layered per ADR-0003: the publish-lifecycle
                // use-cases (over the global UnitOfWork/OutboxWriter) + the
                // bulk-publish dry-run query. CRUD writes stay on the
                // persistence engine (EntryWriterService) directly.
                PublishEntryUseCase,
                UnpublishEntryUseCase,
                BulkPublishEntriesUseCase,
                BulkUnpublishEntriesUseCase,
                BulkPublishPreviewQuery,
                // Public API: the bearer guard (which resolves a token through
                // identity's exported `ApiTokenService`), the workspace
                // resolver, and the narrow published-only read.
                ApiTokenGuard,
                ApiTokenWorkspaceGuard,
                // Gates `?status=draft|any` on write scope, so a read-only token
                // can never see unpublished work.
                DraftVisibilityGuard,
                PublicEntriesQuery,
                // The write half — a thin edge over EntryWriterService and the
                // publish use-cases, which own all the write invariants.
                PublicEntryWritesService,
                // Batched relation + media expansion for the public reads.
                PublicExpansionQuery,
                // The agent-facing tools — the same CRUD as the public API,
                // over the same services, for the MCP endpoint and (once its
                // run engine lands) the copilot. Registers itself with
                // `@orthacms/tools-server`'s registry when the MCP plugin is
                // installed, and is inert when it isn't.
                ContentToolProvider,
                // Fails boot when an i18n type has no CONTENT_ENTRY_EXTENSION
                // bound (nothing would stamp the NOT NULL locale column).
                EntryExtensionBootCheck,
                // The copilot's read-only content tools, and the bootstrap hook
                // that registers them. Both no-op when no copilot plugin is
                // registered — the registrar injects the registry optionally.
                ContentCopilotToolProvider,
                RevisionCopilotToolProvider,
                EntryProposalToolProvider,
                // The appliers for the kinds those propose tools produce.
                // Next to the tools on purpose: a missing applier surfaces only
                // when a human clicks Accept.
                CreateEntryProposalApplier,
                UpdateEntryProposalApplier,
                BulkSaveEntriesProposalApplier,
                copilotAppliersRegistrar(
                    'content',
                    CreateEntryProposalApplier,
                    UpdateEntryProposalApplier,
                    BulkSaveEntriesProposalApplier
                )
            ],
            exports: [
                CONTENT_REGISTRY,
                CONTENT_CATALOG,
                CONTENT_ENTRY_COUNTER,
                EntryValidationService,
                // The public API's collaborators, exported so another plugin can
                // put a SECOND PROTOCOL in front of the same surface without
                // re-implementing any of it — `@orthacms/content-graphql` does
                // exactly that. The module is already `global: true`, so
                // exporting is all that is needed for it to inject these.
                // Everything a `/v1` request is authorized and answered by lives
                // in this list, which is what keeps the two protocols honest:
                // there is one visibility rule, one grant gate, one write path.
                //
                // `WorkspaceGrantsQuery` serves a second set of callers too:
                // the plugins that bind their own copilot tools over
                // content-scoped data (i18n, media). A tool's type name arrives
                // from the model, so every one of them has to re-check the
                // workspace's grants — and there must be exactly one
                // implementation of that check, not one per binder.
                WorkspaceGrantsQuery,
                ContentReadScopeRegistry,
                ContentPublishGuardRegistry,
                EntryWriteExtensionRegistry,
                EntryFilterProviderRegistry,
                PublicEntriesQuery,
                PublicEntryWritesService,
                ApiTokenGuard,
                ApiTokenWorkspaceGuard,
                // The write engine, for the proposal appliers those plugins
                // also bind. ADR-0005 §5 requires an applied proposal to run
                // the ordinary use-case, so they must reach *this* service
                // rather than write their own insert.
                EntryWriterService,
                // Relation storage, for the bound CONTENT_ENTRY_EXTENSION: the
                // i18n sync reads and rewrites link sets on locale siblings,
                // and it has to be through the same service the entries
                // pipeline writes with — a second implementation of the join
                // table's ordering and de-duplication is how the two drift.
                RelationLinkService,
                // Filter evaluation, for the alarms plugin: a stored rule is a
                // records-list filter, and it has to keep meaning exactly what
                // the list showed when it was saved. Sharing the query is what
                // makes that structural instead of aspirational.
                EntryMatchQuery,
                // The revision store, for the protection plugin: an approval is
                // bound to a **revision**, so recording one means asking which
                // version is currently the head and who wrote it. The
                // alternative was protection querying `content_entry_revisions`
                // itself — a host-owned table it cannot migrate and has no
                // business knowing the columns of. Reads are what it needs; the
                // write primitives are executor-parameterized for
                // `EntryWriterService`'s own save transaction and are no use to
                // anyone outside it.
                REVISION_STORE
            ]
        };
    }
}
