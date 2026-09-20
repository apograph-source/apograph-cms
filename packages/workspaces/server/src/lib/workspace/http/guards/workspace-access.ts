import {
    BadRequestException,
    ForbiddenException,
    UnauthorizedException
} from '@nestjs/common';
import type { AuthenticatedRequest } from '@orthacms/identity-server';
import type { MembershipCheckQuery } from '../../infrastructure/queries/membership-check.query';

/** RFC 4122 UUID shape — the workspace id format the schema stores. */
export const WORKSPACE_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The single authorization rule both workspace guards enforce: the caller must
 * be authenticated and a member of `workspaceId`. On success it stamps the
 * validated id onto the request for `@CurrentWorkspace()` to read.
 *
 * Shared so `WorkspaceGuard` (header-scoped, used by feature plugins) and
 * {@link WorkspaceMemberGuard} (`:id`-scoped, used by the workspaces routes
 * themselves) can never drift apart on what "has access" means.
 *
 * @param members - the membership probe backing the decision
 * @param request - the request being authorized
 * @param workspaceId - the candidate id, still unvalidated
 * @param malformedMessage - the 400 message when `workspaceId` isn't a UUID
 */
export async function authorizeWorkspaceAccess(
    members: MembershipCheckQuery,
    request: AuthenticatedRequest,
    workspaceId: string | undefined,
    malformedMessage: string
): Promise<void> {
    const user = request.user;
    if (!user) {
        // AuthGuard runs first as the global guard; reaching here without a
        // user means this route was wrongly opted out of authentication.
        throw new UnauthorizedException();
    }

    if (!workspaceId || !WORKSPACE_ID_PATTERN.test(workspaceId)) {
        throw new BadRequestException(malformedMessage);
    }

    if (!(await members.isMember(user.id, workspaceId))) {
        // Don't distinguish "not a member" from "no such workspace" — both are
        // a flat 403 so a non-member can't probe which ids exist.
        throw new ForbiddenException('You are not a member of this workspace.');
    }

    request.workspaceId = workspaceId;
}
