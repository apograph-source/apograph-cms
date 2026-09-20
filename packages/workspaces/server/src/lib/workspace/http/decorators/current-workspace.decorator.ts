import {
    createParamDecorator,
    InternalServerErrorException,
    type ExecutionContext
} from '@nestjs/common';
import type { AuthenticatedRequest } from '@orthacms/identity-server';

/**
 * Parameter decorator returning the workspace id that {@link WorkspaceGuard}
 * resolved from the `X-Workspace-Id` header and validated against the caller's
 * memberships. Use it only on routes guarded by `WorkspaceGuard` — without that
 * guard the request carries no workspace, so this throws rather than silently
 * handing a service an `undefined` scope (which would unscope the query).
 */
export const CurrentWorkspace = createParamDecorator(
    (_data: unknown, context: ExecutionContext): string => {
        const request = context
            .switchToHttp()
            .getRequest<AuthenticatedRequest>();
        if (!request.workspaceId) {
            throw new InternalServerErrorException(
                '@CurrentWorkspace() used on a route without WorkspaceGuard.'
            );
        }
        return request.workspaceId;
    }
);
