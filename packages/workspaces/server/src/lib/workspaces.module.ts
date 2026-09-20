import { DynamicModule, Module } from '@nestjs/common';
import { WORKSPACE_DIRECTORY } from '@orthacms/identity-server';
import { CreateWorkspaceController } from './workspace/http/controllers/create-workspace.controller';
import { ListWorkspacesController } from './workspace/http/controllers/list-workspaces.controller';
import { CheckSlugController } from './workspace/http/controllers/check-slug.controller';
import { UpdateWorkspaceController } from './workspace/http/controllers/update-workspace.controller';
import { SetWorkspaceStatusController } from './workspace/http/controllers/set-workspace-status.controller';
import { DeleteWorkspaceController } from './workspace/http/controllers/delete-workspace.controller';
import { AddWorkspaceMemberController } from './workspace/http/controllers/add-workspace-member.controller';
import { RemoveWorkspaceMemberController } from './workspace/http/controllers/remove-workspace-member.controller';
import { AddWorkspaceContentController } from './workspace/http/controllers/add-workspace-content.controller';
import { RemoveWorkspaceContentController } from './workspace/http/controllers/remove-workspace-content.controller';
import { GetWorkspaceContentCountController } from './workspace/http/controllers/get-workspace-content-count.controller';
import { GetWorkspaceEntryCountController } from './workspace/http/controllers/get-workspace-entry-count.controller';
import { ListContentTypesController } from './workspace/http/controllers/list-content-types.controller';
import { WorkspaceGuard } from './workspace/http/guards/workspace.guard';
import { WorkspaceMemberGuard } from './workspace/http/guards/workspace-member.guard';
import { CreateWorkspaceUseCase } from './workspace/application/use-cases/create-workspace.use-case';
import { UpdateWorkspaceUseCase } from './workspace/application/use-cases/update-workspace.use-case';
import { SetWorkspaceStatusUseCase } from './workspace/application/use-cases/set-workspace-status.use-case';
import { DeleteWorkspaceUseCase } from './workspace/application/use-cases/delete-workspace.use-case';
import { AddMemberUseCase } from './workspace/application/use-cases/add-member.use-case';
import { RemoveMemberUseCase } from './workspace/application/use-cases/remove-member.use-case';
import { GrantContentUseCase } from './workspace/application/use-cases/grant-content.use-case';
import { RevokeContentUseCase } from './workspace/application/use-cases/revoke-content.use-case';
import { ContentCatalogReader } from './workspace/application/content/content-catalog.reader';
import { ContentEntryCounterReader } from './workspace/application/content/content-entry-counter.reader';
import { WorkspacePurgeRegistry } from './workspace/application/workspace-purge.registry';
import { ApiTokenGrantsPurger } from './workspace/infrastructure/purge/api-token-grants.purger';
import { MEMBER_PROVISIONER } from './workspace/application/ports/member-provisioner.port';
import {
    WORKSPACE_REPOSITORY,
    type WorkspaceRepository
} from './workspace/domain/workspace.repository';
import { SlugUniquenessService } from './workspace/domain/slug-uniqueness.service';
import { DrizzleWorkspaceRepository } from './workspace/infrastructure/persistence/drizzle-workspace.repository';
import { DrizzleMemberProvisioner } from './workspace/infrastructure/persistence/drizzle-member-provisioner';
import { WorkspaceMapper } from './workspace/infrastructure/persistence/workspace.mapper';
import { WorkspaceViewQuery } from './workspace/infrastructure/queries/workspace-view.query';
import { SlugAvailabilityQuery } from './workspace/infrastructure/queries/slug-availability.query';
import { MemberLookupQuery } from './workspace/infrastructure/queries/member-lookup.query';
import { MembershipCheckQuery } from './workspace/infrastructure/queries/membership-check.query';
import { WorkspaceExistenceQuery } from './workspace/infrastructure/queries/workspace-existence.query';

/**
 * NestJS module for the workspaces plugin — the tenancy bounded context,
 * layered per ADR-0003 (domain / application / infrastructure / http). See the
 * package `AGENTS.md`. Registered globally so its guard and membership check are
 * injectable from any plugin (content, i18n) that scopes routes with
 * `@UseGuards(WorkspaceGuard)`.
 *
 * Wires the aggregate's ports to their adapters: {@link WORKSPACE_REPOSITORY} →
 * {@link DrizzleWorkspaceRepository}, {@link MEMBER_PROVISIONER} →
 * {@link DrizzleMemberProvisioner}. The unit-of-work / outbox primitives come
 * from `@orthacms/database`'s global module; identity's tables are reached
 * through `@orthacms/identity-server`.
 */
@Module({})
export class WorkspacesModule {
    /** Creates the global dynamic module: use cases, ports, and routes. */
    static forRoot(): DynamicModule {
        return {
            module: WorkspacesModule,
            global: true,
            controllers: [
                CreateWorkspaceController,
                ListWorkspacesController,
                CheckSlugController,
                UpdateWorkspaceController,
                SetWorkspaceStatusController,
                DeleteWorkspaceController,
                AddWorkspaceMemberController,
                RemoveWorkspaceMemberController,
                AddWorkspaceContentController,
                RemoveWorkspaceContentController,
                GetWorkspaceContentCountController,
                GetWorkspaceEntryCountController,
                ListContentTypesController
            ],
            providers: [
                // Application — use cases (one per state-changing operation).
                CreateWorkspaceUseCase,
                UpdateWorkspaceUseCase,
                SetWorkspaceStatusUseCase,
                DeleteWorkspaceUseCase,
                AddMemberUseCase,
                RemoveMemberUseCase,
                GrantContentUseCase,
                RevokeContentUseCase,
                // Application — content-context readers (optional ports inside).
                ContentCatalogReader,
                ContentEntryCounterReader,
                // Application — the cross-plugin delete fan-out. Contributors
                // in other plugins register themselves; see WorkspacePurger.
                WorkspacePurgeRegistry,
                // Infrastructure — the one purger that must live on this side,
                // because identity cannot depend back on this package.
                ApiTokenGrantsPurger,
                // Domain service — plain class, wired over the repository port so
                // it stays free of `@nestjs/*`.
                {
                    provide: SlugUniquenessService,
                    useFactory: (repository: WorkspaceRepository) =>
                        new SlugUniquenessService(repository),
                    inject: [WORKSPACE_REPOSITORY]
                },
                // Infrastructure — port adapters + persistence + read models.
                {
                    provide: WORKSPACE_REPOSITORY,
                    useClass: DrizzleWorkspaceRepository
                },
                {
                    provide: MEMBER_PROVISIONER,
                    useClass: DrizzleMemberProvisioner
                },
                WorkspaceMapper,
                WorkspaceViewQuery,
                SlugAvailabilityQuery,
                MemberLookupQuery,
                MembershipCheckQuery,
                // Binds identity's WORKSPACE_DIRECTORY port, so minting an API
                // token can reject a bucket naming a workspace that does not
                // exist. `api_token_workspaces` carries no cross-plugin FK
                // (identity must not depend on this package), so this inversion
                // is what closes the referential gap — same shape as identity
                // owning ACTIVITY_RECORDER and the activity plugin binding it.
                {
                    provide: WORKSPACE_DIRECTORY,
                    useClass: WorkspaceExistenceQuery
                },
                // Resolved by `@UseGuards(WorkspaceGuard)` on workspace-scoped
                // routes in other plugins; injectable everywhere since this
                // module is global (same pattern as identity's PermissionsGuard).
                WorkspaceGuard,
                // The `:id`-scoped sibling, guarding this context's own
                // `/workspaces/:id/…` routes.
                WorkspaceMemberGuard
            ],
            exports: [
                // Exported so a feature plugin's `@UseGuards(WorkspaceGuard)`
                // (instantiated in the consuming module's injector) can resolve
                // the guard and its `MembershipCheckQuery` dependency.
                MembershipCheckQuery,
                // Exported so a plugin owning workspace-scoped rows can inject
                // it from its own injector and register its purger.
                WorkspacePurgeRegistry,
                // Exported so identity's `ApiTokenService` — constructed in the
                // identity module's injector — resolves the optional port.
                WORKSPACE_DIRECTORY,
                WorkspaceGuard,
                WorkspaceMemberGuard
            ]
        };
    }
}
