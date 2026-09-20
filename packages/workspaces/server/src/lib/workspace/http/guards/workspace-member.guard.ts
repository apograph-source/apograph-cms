import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '@orthacms/identity-server';
import { MembershipCheckQuery } from '../../infrastructure/queries/membership-check.query';
import { authorizeWorkspaceAccess } from './workspace-access';

/**
 * Authorizes a route whose workspace is named by a **path parameter** (`:id`,
 * or `:workspaceId`) rather than the `X-Workspace-Id` header — i.e. the
 * `/api/workspaces/:id/…` routes this context owns. It 400s a malformed id and
 * 403s unless the authenticated user is a member of that workspace, so holding
 * `workspaces:update` never grants reach into a workspace the caller doesn't
 * belong to. On success the validated id is attached as `request.workspaceId`.
 *
 * Pair it with `PermissionsGuard`: permissions say *what* a user may do, this
 * says *where* they may do it — both must pass. A workspace the caller isn't a
 * member of is indistinguishable from one that doesn't exist (flat 403), so the
 * routes leak no ids.
 *
 * @example
 * ```typescript
 * \@UseGuards(OriginGuard, PermissionsGuard, WorkspaceMemberGuard)
 * \@RequirePermissions(PERMISSIONS.WORKSPACES_UPDATE)
 * \@Controller('workspaces')
 * export class UpdateWorkspaceController { … }
 * ```
 */
@Injectable()
export class WorkspaceMemberGuard implements CanActivate {
    constructor(private readonly members: MembershipCheckQuery) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context
            .switchToHttp()
            .getRequest<AuthenticatedRequest>();

        const params = request.params as Record<string, string | undefined>;
        await authorizeWorkspaceAccess(
            this.members,
            request,
            params.id ?? params.workspaceId,
            'Missing or malformed workspace id.'
        );
        return true;
    }
}
