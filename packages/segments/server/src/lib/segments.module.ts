import {
    Module,
    type DynamicModule,
    type MiddlewareConsumer,
    type NestModule
} from '@nestjs/common';
import {
    contentReadScopeRegistrar,
    entryFilterProviderRegistrar,
    entryWriteExtensionRegistrar
} from '@orthacms/content-server';
import { SEGMENTS_CONFIG } from './segments.tokens';
import type { SegmentsPluginConfig } from './types/segments-config';
import { SegmentCatalogService } from './application/segment-catalog.service';
import { SegmentsService } from './application/segments.service';
import { EntryAccessService } from './application/entry-access.service';
import { EntryAccessWorkspacePurger } from './infrastructure/purge/entry-access-workspace.purger';
import { ReaderStore } from './application/reader.store';
import { PrincipalStore } from './application/principal.store';
import { SegmentReadScope } from './infrastructure/segment-read-scope';
import { EntryAccessWriteExtension } from './infrastructure/entry-access-write-extension';
import { AccessFilterProvider } from './infrastructure/access-filter.provider';
import { ReaderMiddleware } from './http/reader.middleware';
import { PrincipalMiddleware } from './http/principal.middleware';
import { copilotAppliersRegistrar } from '@orthacms/copilot-server';
import { SegmentsController } from './http/segments.controller';
import { EntryAccessController } from './http/entry-access.controller';
import { PublicEntryAccessController } from './http/public-entry-access.controller';
import { SegmentsToolProvider } from './tools/segments-tool.provider';
import { EntryAccessProposalProvider } from './copilot/entry-access-proposal.provider';
import { EntryAccessProposalApplier } from './copilot/entry-access-proposal.applier';

/**
 * The segmentation plugin's module — two tables, two controllers, one
 * predicate.
 *
 * Global, because {@link SegmentReadScope} has to reach content-server's read
 * path from wherever the query is built.
 *
 * Registered **after** `ContentPlugin`: the read-scope binding is only
 * meaningful once content's port exists to bind to.
 */
@Module({})
export class SegmentsModule implements NestModule {
    /** Creates the global dynamic module. */
    static forRoot(config: SegmentsPluginConfig): DynamicModule {
        return {
            module: SegmentsModule,
            global: true,
            controllers: [
                SegmentsController,
                EntryAccessController,
                // The same decision over a bearer token, at the public API's own
                // `/v1/content/:typeName/:id/access`. The admin route above
                // stays session-guarded; this one is scope-guarded.
                PublicEntryAccessController
            ],
            providers: [
                { provide: SEGMENTS_CONFIG, useValue: config },
                SegmentCatalogService,
                SegmentsService,
                EntryAccessService,
                // Removes this workspace's per-entry audience rows on delete;
                // `entry_access.workspace_id` carries no FK and the other
                // deletes are per-entry and per-segment, so nothing reached
                // them. `segments.workspace_ids` is deliberately left alone —
                // a dangling id there narrows an audience, and dropping it
                // would silently widen who may read.
                EntryAccessWorkspacePurger,
                ReaderStore,
                PrincipalStore,
                SegmentReadScope,
                // A runtime registration rather than a DI binding: Nest has no
                // multi-provider, so two plugins binding one token would leave
                // the second silently replacing the first — and for a
                // visibility rule that means content quietly becoming visible.
                contentReadScopeRegistrar('segments', SegmentReadScope),
                EntryAccessWriteExtension,
                // The other half, and registered the same way for the same
                // reason: an entry's audiences are written inside the entry's
                // own save transaction and captured by its version, so a save
                // cannot land with its restriction missing and a restore puts
                // back the audiences the restored version had.
                entryWriteExtensionRegistrar(
                    'segments',
                    EntryAccessWriteExtension
                ),
                AccessFilterProvider,
                // The third registration, and the same reason as the other two:
                // `CONTENT_ENTRY_EXTENSION` is a single binding held by i18n, so
                // virtual filter fields go through content's registry. These are
                // the records list's "can be seen by" / "cannot be seen by" /
                // "restricted" — the editor's questions, not a visibility rule.
                entryFilterProviderRegistrar('segments', AccessFilterProvider),
                // The agent-facing catalogue: two reads on both surfaces, one
                // MCP write, and — because a copilot write acts for a person —
                // one propose tool with the applier for the kind it produces.
                // Every one of them no-ops when neither consumer is installed:
                // the registries are injected optionally.
                SegmentsToolProvider,
                EntryAccessProposalProvider,
                EntryAccessProposalApplier,
                copilotAppliersRegistrar(
                    'segments',
                    EntryAccessProposalApplier
                ),
                ReaderMiddleware,
                PrincipalMiddleware
            ],
            exports: [
                SEGMENTS_CONFIG,
                SegmentCatalogService,
                EntryAccessService,
                ReaderStore,
                PrincipalStore
            ]
        };
    }

    /**
     * Resolve the reader on every request.
     *
     * Every route, not a list: who is reading is a property of the request, not
     * of one controller, and a path filter here would be a second place to keep
     * in step each time a protocol is added. The middleware itself decides
     * there is nothing to do — with no segment defined it calls `next()`
     * immediately.
     *
     * The pattern is `{*splat}` rather than the historical `*`: Express 5 uses
     * path-to-regexp 8, where a bare `*` is a parse error rather than a
     * wildcard — a mistake no typecheck catches and that would leave the plugin
     * silently never running.
     */
    configure(consumer: MiddlewareConsumer): void {
        // Both wrap the whole request in an `AsyncLocalStorage` scope, so both
        // have to be middleware. The principal one never short-circuits: the
        // reader resolution is skippable when no segment exists, but a
        // permission check that silently stopped running would be the failure
        // nobody notices.
        consumer
            .apply(PrincipalMiddleware, ReaderMiddleware)
            .forRoutes('{*splat}');
    }
}
