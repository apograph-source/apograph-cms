import { BadRequestException, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '@orthacms/identity-server';
import type { MembershipCheckQuery } from '../../infrastructure/queries/membership-check.query';
import { WorkspaceMemberGuard } from './workspace-member.guard';

const USER = '22222222-2222-4222-8222-222222222222';
const MINE = '11111111-1111-4111-8111-111111111111';
const THEIRS = '33333333-3333-4333-8333-333333333333';

/** A membership probe answering `true` only for `MINE`. */
const members = {
    isMember: async (_userId: string, workspaceId: string) =>
        workspaceId === MINE
} as MembershipCheckQuery;

/** A request with the given route params, and the context wrapping it. */
function contextFor(params: Record<string, string | undefined>): {
    request: AuthenticatedRequest;
    context: ExecutionContext;
} {
    const request = {
        user: { id: USER },
        headers: {},
        params
    } as unknown as AuthenticatedRequest;
    const context = {
        switchToHttp: () => ({ getRequest: () => request })
    } as ExecutionContext;
    return { request, context };
}

/**
 * The path-scoped half of the pair — the guard this context's own
 * `/workspaces/:id/…` routes carry. Like its sibling it adds exactly one thing
 * to the shared decision: reading the candidate id out of the route params,
 * under either of the two names those routes use.
 */
describe('WorkspaceMemberGuard', () => {
    const guard = new WorkspaceMemberGuard(members);

    it('reads :id', async () => {
        const { request, context } = contextFor({ id: MINE });

        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(request.workspaceId).toBe(MINE);
    });

    it('falls back to :workspaceId when there is no :id', async () => {
        const { request, context } = contextFor({ workspaceId: MINE });

        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(request.workspaceId).toBe(MINE);
    });

    it('prefers :id when a route carries both', async () => {
        // Order matters rather than being arbitrary: a nested route naming
        // some other workspace in a second param must not be able to redirect
        // the membership check away from the one in the path being served.
        const { request, context } = contextFor({
            id: MINE,
            workspaceId: THEIRS
        });

        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(request.workspaceId).toBe(MINE);
    });

    it('400s with the path-specific message when neither param is present', async () => {
        const { context } = contextFor({});

        await expect(guard.canActivate(context)).rejects.toThrow(
            new BadRequestException('Missing or malformed workspace id.')
        );
    });

    it('403s a workspace the caller is not a member of', async () => {
        // The reason this guard exists: holding `workspaces:update` says what
        // the caller may do, never where.
        const { request, context } = contextFor({ id: THEIRS });

        await expect(guard.canActivate(context)).rejects.toThrow(
            'You are not a member of this workspace.'
        );
        expect(request.workspaceId).toBeUndefined();
    });
});
