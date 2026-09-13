import { DynamicModule, Module } from '@nestjs/common';
import { ListMembersController } from './member/http/controllers/list-members.controller';
import { GetMemberController } from './member/http/controllers/get-member.controller';
import { InviteMemberController } from './member/http/controllers/invite-member.controller';
import { UpdateMemberController } from './member/http/controllers/update-member.controller';
import { SetMemberStatusController } from './member/http/controllers/set-member-status.controller';
import { ResendInviteController } from './member/http/controllers/resend-invite.controller';
import { IssuePasswordResetController } from './member/http/controllers/issue-password-reset.controller';
import { RevokeInviteController } from './member/http/controllers/revoke-invite.controller';
import { InviteMemberUseCase } from './member/application/use-cases/invite-member.use-case';
import { UpdateMemberUseCase } from './member/application/use-cases/update-member.use-case';
import { SetMemberStatusUseCase } from './member/application/use-cases/set-member-status.use-case';
import { ResendInviteUseCase } from './member/application/use-cases/resend-invite.use-case';
import { IssuePasswordResetUseCase } from './member/application/use-cases/issue-password-reset.use-case';
import { RevokeInviteUseCase } from './member/application/use-cases/revoke-invite.use-case';
import { MemberViewQuery } from './member/infrastructure/queries/member-view.query';
import { WorkspaceMembersQuery } from './member/infrastructure/queries/workspace-members.query';
import { WorkspaceCopilotToolProvider } from './copilot/workspace-tool.provider';
import { MEMBER_REPOSITORY } from './member/domain/member.repository';
import { SESSION_REVOKER } from './member/application/ports/session-revoker.port';
import { WORKSPACE_LINKER } from './member/application/ports/workspace-linker.port';
import { DrizzleMemberRepository } from './member/infrastructure/persistence/drizzle-member.repository';
import { MemberMapper } from './member/infrastructure/persistence/member.mapper';
import { InviteTokenService } from './member/infrastructure/persistence/invite-token.service';
import { PasswordResetTokenService } from './member/infrastructure/persistence/password-reset-token.service';
import { DrizzleSessionRevoker } from './member/infrastructure/persistence/drizzle-session-revoker';
import { DrizzleWorkspaceLinker } from './member/infrastructure/persistence/drizzle-workspace-linker';

/**
 * NestJS module for the users plugin — the **member** bounded context, layered
 * per ADR-0003 (domain / application / infrastructure / http). See the package
 * `AGENTS.md`. Mounts the member-management routes under `/api/users`.
 *
 * Wires the aggregate's ports to their adapters: {@link MEMBER_REPOSITORY} →
 * {@link DrizzleMemberRepository}, {@link SESSION_REVOKER} →
 * {@link DrizzleSessionRevoker}, {@link WORKSPACE_LINKER} →
 * {@link DrizzleWorkspaceLinker}. The unit-of-work / outbox primitives come from
 * `@apograph/database`'s global module; identity's tables are reached through
 * `@apograph/identity-server`. Auditing is no longer in-band — the member
 * lifecycle facts drain to the outbox, where the activity plugin's subscriber
 * records them.
 *
 * The module is **not** global and exports nothing — every provider is private.
 * It takes no config: the invite TTL and page sizes are deliberate constants,
 * not host knobs.
 */
@Module({})
export class UsersModule {
    /** Creates the dynamic module: use cases, ports, read model, and routes. */
    static forRoot(): DynamicModule {
        return {
            module: UsersModule,
            controllers: [
                ListMembersController,
                GetMemberController,
                InviteMemberController,
                UpdateMemberController,
                SetMemberStatusController,
                ResendInviteController,
                RevokeInviteController,
                IssuePasswordResetController
            ],
            providers: [
                // Application — one use case per state-changing operation.
                InviteMemberUseCase,
                UpdateMemberUseCase,
                SetMemberStatusUseCase,
                ResendInviteUseCase,
                RevokeInviteUseCase,
                IssuePasswordResetUseCase,
                // Read model — thin CQRS query service (bypasses the aggregate).
                MemberViewQuery,
                WorkspaceMembersQuery,
                // The copilot's workspace-scoped member list. Both no-op when
                // no copilot plugin is registered — the registrar injects the
                // registry optionally.
                WorkspaceCopilotToolProvider,
                // Infrastructure — port adapters + persistence.
                {
                    provide: MEMBER_REPOSITORY,
                    useClass: DrizzleMemberRepository
                },
                { provide: SESSION_REVOKER, useClass: DrizzleSessionRevoker },
                { provide: WORKSPACE_LINKER, useClass: DrizzleWorkspaceLinker },
                MemberMapper,
                InviteTokenService,
                PasswordResetTokenService
            ]
        };
    }
}
