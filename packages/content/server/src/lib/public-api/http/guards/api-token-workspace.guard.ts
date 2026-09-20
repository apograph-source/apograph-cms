import {
    BadRequestException,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException
} from '@nestjs/common';
import {
    WORKSPACE_HEADER,
    WORKSPACE_ID_PATTERN
} from '@orthacms/workspaces-server';
import type { ApiTokenRequest } from '../api-token-request';

/**
 * Resolves which of a token's workspaces a public-API request targets, and
 * stamps it on the request for `@CurrentWorkspace()` — the token-authenticated
 * counterpart of workspaces' membership-based `WorkspaceGuard`.
 *
 * The rule:
 *
 * - `X-Workspace-Id` present → it must be well-formed (400) **and** in the
 *   token's bucket (403). A token can never read a workspace it wasn't minted
 *   for, whatever the header says.
 * - Header absent, token covers exactly one workspace → that workspace. A
 *   single-workspace token needs no header at all, which is what makes the
 *   common case a one-line fetch.
 * - Header absent, token covers several → 400. Guessing would silently pick a
 *   workspace for the caller, and "why is this empty?" is a much worse failure
 *   than an explicit error.
 *
 * Runs **after** {@link ApiTokenGuard} (which attaches `request.apiToken`);
 * reaching it without a token is a wiring bug, not an unauthenticated caller.
 */
@Injectable()
export class ApiTokenWorkspaceGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<ApiTokenRequest>();
        const token = request.apiToken;
        if (!token) {
            throw new UnauthorizedException();
        }

        const header = request.headers[WORKSPACE_HEADER];
        const requested = Array.isArray(header) ? header[0] : header;

        if (!requested) {
            if (token.workspaceIds.length === 1) {
                request.workspaceId = token.workspaceIds[0];
                return true;
            }
            // A token can end up covering *nothing*: deleting a workspace
            // narrows every token's bucket and deliberately stops short of
            // revoking the credential, which is not the purger's call to make.
            // Asking that caller to name one of zero workspaces is advice they
            // cannot follow, so say what is actually true instead.
            if (token.workspaceIds.length === 0) {
                throw new ForbiddenException(
                    'This token has no workspaces left — every workspace it covered has been deleted. Issue a new token.'
                );
            }
            throw new BadRequestException(
                `This token covers ${token.workspaceIds.length} workspaces — name the one you want with the X-Workspace-Id header.`
            );
        }

        if (!WORKSPACE_ID_PATTERN.test(requested)) {
            throw new BadRequestException('Malformed X-Workspace-Id header.');
        }

        if (!token.workspaceIds.includes(requested)) {
            // Not-in-bucket and no-such-workspace are the same 403, so a token
            // can't be used to probe which workspace ids exist.
            throw new ForbiddenException(
                'This token does not cover that workspace.'
            );
        }

        request.workspaceId = requested;
        return true;
    }
}
