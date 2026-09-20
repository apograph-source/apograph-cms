import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '@orthacms/identity-server';
import { MembershipCheckQuery } from '../../infrastructure/queries/membership-check.query';
import { authorizeWorkspaceAccess } from './workspace-access';

/** The header the admin sends to name the workspace a request is scoped to. */
export const WORKSPACE_HEADER = 'x-workspace-id';

/**
 * Authorizes a workspace-scoped request. Reads the `X-Workspace-Id` header,
 * rejects a missing/malformed id with 400, and 403s unless the authenticated
 * user is a member of that workspace. On success it attaches the validated id
 * as `request.workspaceId` for `@CurrentWorkspace()` to read.
 *
 * Runs after the app-wide `AuthGuard` (which has already attached `request.user`
 * or 401'd), so a missing user here is a wiring bug, not an unauthenticated
 * caller. Apply it on every route that reads or writes workspace-owned data so a
 * valid session for workspace A can never touch workspace B's content.
 *
 * For routes that name their workspace in the path instead of the header, use
 * {@link WorkspaceMemberGuard} — both share one membership rule
 * ({@link authorizeWorkspaceAccess}).
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
    constructor(private readonly members: MembershipCheckQuery) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context
            .switchToHttp()
            .getRequest<AuthenticatedRequest>();

        const header = request.headers[WORKSPACE_HEADER];
        await authorizeWorkspaceAccess(
            this.members,
            request,
            Array.isArray(header) ? header[0] : header,
            'Missing or malformed X-Workspace-Id header.'
        );
        return true;
    }
}
