import {
    Body,
    Controller,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards
} from '@nestjs/common';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@orthacms/identity-server';
import { WorkspaceMemberGuard } from '../guards/workspace-member.guard';
import { AddMemberUseCase } from '../../application/use-cases/add-member.use-case';
import { AddWorkspaceMemberDto } from '../../application/dto/add-workspace-member.dto';
import { WorkspaceViewQuery } from '../../infrastructure/queries/workspace-view.query';
import type { WorkspaceView } from '../../application/queries/workspace.view';
import {
    MemberNotFoundError,
    WorkspaceNotFoundError
} from '../../domain/errors';

/**
 * `POST /api/workspaces/:id/members` — links an existing user to a workspace;
 * requires `workspaces:update`. Idempotent (re-adding is a no-op). A missing
 * workspace or user maps to 404. Guarded by `OriginGuard` (CSRF).
 *
 * Also guarded by `WorkspaceMemberGuard`: a caller who isn't a member of
 * `:id` gets a flat 403 — indistinguishable from a workspace that doesn't
 * exist — so a permission never reaches another tenant's workspace.
 */
@UseGuards(OriginGuard, PermissionsGuard, WorkspaceMemberGuard)
@RequirePermissions(PERMISSIONS.WORKSPACES_UPDATE)
@Controller('workspaces')
export class AddWorkspaceMemberController {
    constructor(
        private readonly addMember: AddMemberUseCase,
        private readonly views: WorkspaceViewQuery
    ) {}

    @Post(':id/members')
    async add(
        @CurrentUser() actor: PublicUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: AddWorkspaceMemberDto
    ): Promise<WorkspaceView> {
        try {
            await this.addMember.execute(actor, id, body.userId);
            const view = await this.views.byId(id);
            if (!view) {
                throw new NotFoundException();
            }
            return view;
        } catch (error) {
            if (
                error instanceof WorkspaceNotFoundError ||
                error instanceof MemberNotFoundError
            ) {
                throw new NotFoundException();
            }
            throw error;
        }
    }
}
