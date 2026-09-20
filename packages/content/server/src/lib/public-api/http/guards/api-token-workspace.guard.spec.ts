import {
    BadRequestException,
    ForbiddenException,
    UnauthorizedException,
    type ExecutionContext
} from '@nestjs/common';
import { WORKSPACE_HEADER } from '@orthacms/workspaces-server';
import { ApiTokenWorkspaceGuard } from './api-token-workspace.guard';
import type { ApiTokenRequest, PublicApiToken } from '../api-token-request';

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '33333333-3333-4333-8333-333333333333';

/** A verified token covering `workspaceIds`, as `ApiTokenGuard` attaches it. */
function token(workspaceIds: string[]): PublicApiToken {
    return {
        id: 'token-1',
        name: 'CI',
        scope: 'read',
        workspaceIds,
        createdBy: 'user-1'
    };
}

/** A request carrying `apiToken` (unless omitted) plus `headers`. */
function contextFor(
    apiToken: PublicApiToken | undefined,
    headers: Record<string, string | string[] | undefined> = {}
) {
    const request = { apiToken, headers } as unknown as ApiTokenRequest;
    const context = {
        switchToHttp: () => ({ getRequest: () => request })
    } as ExecutionContext;
    return { request, context };
}

/**
 * The token-authenticated counterpart of workspaces' membership-based
 * `WorkspaceGuard`: it decides which of a token's workspaces a public-API
 * request acts in. Every branch is a security or a usability decision, and
 * three of them are the difference between a helpful error and a wrong answer.
 */
describe('ApiTokenWorkspaceGuard', () => {
    const guard = new ApiTokenWorkspaceGuard();

    it('uses the only workspace when the token covers one', () => {
        // What makes the common case a one-line fetch: a single-workspace token
        // needs no header at all.
        const { request, context } = contextFor(token([WORKSPACE_A]));

        expect(guard.canActivate(context)).toBe(true);
        expect(request.workspaceId).toBe(WORKSPACE_A);
    });

    it('refuses to guess when the token covers several', () => {
        // Picking one silently would answer a question the caller did not ask,
        // and "why is this list empty?" is a far worse failure than a 400.
        const { request, context } = contextFor(
            token([WORKSPACE_A, WORKSPACE_B])
        );

        expect(() => guard.canActivate(context)).toThrow(BadRequestException);
        expect(request.workspaceId).toBeUndefined();
    });

    it('names the real cause when the bucket has been emptied', () => {
        // Reachable, not theoretical: deleting a workspace narrows every
        // token's bucket and deliberately stops short of revoking the
        // credential — that is not the purger's call to make. Asking such a
        // caller to name one of zero workspaces is advice they cannot follow,
        // and it sends them hunting for a header bug that does not exist.
        const { context } = contextFor(token([]));

        expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
        expect(() => guard.canActivate(context)).toThrow(/no workspaces left/);
        // Specifically **not** the "name the one you want" 400 the multi-
        // workspace branch raises.
        expect(() => guard.canActivate(context)).not.toThrow(
            BadRequestException
        );
    });

    it('honours a header naming a workspace inside the bucket', () => {
        const { request, context } = contextFor(
            token([WORKSPACE_A, WORKSPACE_B]),
            { [WORKSPACE_HEADER]: WORKSPACE_B }
        );

        expect(guard.canActivate(context)).toBe(true);
        expect(request.workspaceId).toBe(WORKSPACE_B);
    });

    it('refuses a foreign workspace even when the token covers exactly one', () => {
        // The single-workspace shortcut must not become "whatever the token
        // covers, regardless of what you asked for": a present header is always
        // checked against the bucket, so a token can never read a workspace it
        // was not minted for.
        const { request, context } = contextFor(token([WORKSPACE_A]), {
            [WORKSPACE_HEADER]: FOREIGN
        });

        expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
        expect(request.workspaceId).toBeUndefined();
    });

    it('answers a non-existent workspace the same way as an unauthorised one', () => {
        // Not-in-bucket and no-such-workspace are one 403, so the endpoint
        // cannot be walked to discover which workspace ids exist. The guard
        // never looks a workspace up, which is what makes that automatic.
        const outside = contextFor(token([WORKSPACE_A]), {
            [WORKSPACE_HEADER]: WORKSPACE_B
        });
        const nonsense = contextFor(token([WORKSPACE_A]), {
            [WORKSPACE_HEADER]: FOREIGN
        });

        const first = capture(() => guard.canActivate(outside.context));
        const second = capture(() => guard.canActivate(nonsense.context));

        expect(first.getResponse()).toEqual(second.getResponse());
    });

    it('rejects a malformed header before consulting the bucket', () => {
        const { context } = contextFor(token([WORKSPACE_A]), {
            [WORKSPACE_HEADER]: 'not-a-uuid'
        });

        expect(() => guard.canActivate(context)).toThrow(BadRequestException);
        expect(() => guard.canActivate(context)).toThrow(
            /Malformed X-Workspace-Id/
        );
    });

    it('takes the first value when the header arrives twice', () => {
        // Node hands duplicated headers over as an array. Taking the first is
        // what stops a second header being smuggled past a proxy that inspected
        // only one — and `String([a, b])` would fail the uuid check for the
        // wrong reason.
        const { request, context } = contextFor(
            token([WORKSPACE_A, WORKSPACE_B]),
            { [WORKSPACE_HEADER]: [WORKSPACE_A, WORKSPACE_B] }
        );

        expect(guard.canActivate(context)).toBe(true);
        expect(request.workspaceId).toBe(WORKSPACE_A);
    });

    it('401s when no token was attached at all', () => {
        // Reaching this guard without `ApiTokenGuard` having run is a wiring
        // bug, not an unauthenticated caller — but it must never fall through
        // to a workspace anyway.
        const { context } = contextFor(undefined, {
            [WORKSPACE_HEADER]: WORKSPACE_A
        });

        expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });
});

/** The exception a refusing `canActivate` threw. */
function capture(run: () => unknown): ForbiddenException {
    try {
        run();
    } catch (error) {
        return error as ForbiddenException;
    }
    throw new Error('expected canActivate to refuse');
}
