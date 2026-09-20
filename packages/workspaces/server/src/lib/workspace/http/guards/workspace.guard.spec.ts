import { BadRequestException, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '@orthacms/identity-server';
import type { MembershipCheckQuery } from '../../infrastructure/queries/membership-check.query';
import { WorkspaceGuard, WORKSPACE_HEADER } from './workspace.guard';

const USER = '22222222-2222-4222-8222-222222222222';
const MINE = '11111111-1111-4111-8111-111111111111';
const THEIRS = '33333333-3333-4333-8333-333333333333';

/** A membership probe answering `true` only for `MINE`. */
const members = {
    isMember: async (_userId: string, workspaceId: string) =>
        workspaceId === MINE
} as MembershipCheckQuery;

/** A request with the given headers, and the context wrapping it. */
function contextFor(headers: Record<string, string | string[] | undefined>): {
    request: AuthenticatedRequest;
    context: ExecutionContext;
} {
    const request = {
        user: { id: USER },
        headers,
        params: {}
    } as unknown as AuthenticatedRequest;
    const context = {
        switchToHttp: () => ({ getRequest: () => request })
    } as ExecutionContext;
    return { request, context };
}

/**
 * The header-scoped half of the pair — the guard every *other* plugin's
 * workspace-scoped route carries. It contributes exactly one thing over the
 * shared decision (`workspace-access.spec.ts` covers that): pulling the
 * candidate id out of `X-Workspace-Id`.
 */
describe('WorkspaceGuard', () => {
    const guard = new WorkspaceGuard(members);

    it('reads the workspace from the X-Workspace-Id header', async () => {
        const { request, context } = contextFor({ [WORKSPACE_HEADER]: MINE });

        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(request.workspaceId).toBe(MINE);
    });

    it('takes the first value when the header is sent twice', async () => {
        // Node hands duplicated headers over as an array. Picking the first is
        // what stops a second header being smuggled past a proxy that only
        // inspected one — and `String(['a','b'])` would otherwise produce a
        // comma-joined id that fails the uuid check for the wrong reason.
        const { request, context } = contextFor({
            [WORKSPACE_HEADER]: [MINE, THEIRS]
        });

        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(request.workspaceId).toBe(MINE);
    });

    it('400s with the header-specific message when it is absent', async () => {
        const { context } = contextFor({});

        await expect(guard.canActivate(context)).rejects.toThrow(
            new BadRequestException(
                'Missing or malformed X-Workspace-Id header.'
            )
        );
    });

    it('403s a workspace the caller is not a member of', async () => {
        const { request, context } = contextFor({
            [WORKSPACE_HEADER]: THEIRS
        });

        await expect(guard.canActivate(context)).rejects.toThrow(
            'You are not a member of this workspace.'
        );
        expect(request.workspaceId).toBeUndefined();
    });
});
