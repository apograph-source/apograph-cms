import {
    BadRequestException,
    ForbiddenException,
    UnauthorizedException
} from '@nestjs/common';
import type { AuthenticatedRequest } from '@orthacms/identity-server';
import type { MembershipCheckQuery } from '../../infrastructure/queries/membership-check.query';
import {
    authorizeWorkspaceAccess,
    WORKSPACE_ID_PATTERN
} from './workspace-access';

const USER = '22222222-2222-4222-8222-222222222222';
const MINE = '11111111-1111-4111-8111-111111111111';
const THEIRS = '33333333-3333-4333-8333-333333333333';
const NOWHERE = '44444444-4444-4444-8444-444444444444';

const MALFORMED = 'Missing or malformed workspace id.';

/** A membership probe answering `true` only for the ids it was given. */
function members(...memberOf: string[]): {
    query: MembershipCheckQuery;
    calls: string[];
} {
    const calls: string[] = [];
    const query = {
        isMember: async (userId: string, workspaceId: string) => {
            calls.push(`${userId}@${workspaceId}`);
            return memberOf.includes(workspaceId);
        }
    } as MembershipCheckQuery;
    return { query, calls };
}

/** A bare request carrying an authenticated user. */
function request(): AuthenticatedRequest {
    return {
        user: { id: USER },
        headers: {},
        params: {}
    } as unknown as AuthenticatedRequest;
}

/** The same request with no `user` — what a route opted out of auth would send. */
function anonymousRequest(): AuthenticatedRequest {
    return { headers: {}, params: {} } as unknown as AuthenticatedRequest;
}

/** The status + body the refusal would put on the wire; fails if none came. */
async function wireResponse(
    attempt: Promise<void>
): Promise<{ status: number; body: unknown }> {
    try {
        await attempt;
    } catch (error) {
        const exception = error as ForbiddenException;
        return {
            status: exception.getStatus(),
            body: exception.getResponse()
        };
    }
    throw new Error('expected the call to be refused');
}

/**
 * The one authorization decision both workspace guards delegate to. Splitting
 * it out is what stops the header-scoped guard and the `:id`-scoped one from
 * drifting on what "has access" means; testing it here is what stops the rule
 * itself from drifting.
 *
 * The load-bearing case is the 403. "You are not a member" and "there is no
 * such workspace" must be **byte-identical** responses: any difference — a
 * different status, a different message, even a different key order — turns
 * the route into an oracle that answers "does workspace X exist?" for a caller
 * with no standing to ask, one id at a time. Nothing else in the codebase
 * asserts that string, so nothing else would notice it being made "more
 * helpful".
 */
describe('authorizeWorkspaceAccess', () => {
    it('401s when no user is attached', async () => {
        const { query, calls } = members(MINE);

        await expect(
            authorizeWorkspaceAccess(query, anonymousRequest(), MINE, MALFORMED)
        ).rejects.toThrow(UnauthorizedException);

        // The app-wide AuthGuard runs first, so reaching here without a user
        // means the route was wrongly opted out of authentication — never a
        // membership question.
        expect(calls).toEqual([]);
    });

    it('401s before 400 — an anonymous caller learns nothing about the id', async () => {
        const { query } = members(MINE);

        await expect(
            authorizeWorkspaceAccess(
                query,
                anonymousRequest(),
                'not-a-uuid',
                MALFORMED
            )
        ).rejects.toThrow(UnauthorizedException);
    });

    it.each([
        ['a non-uuid', 'workspace-1'],
        ['an empty string', ''],
        ['a padded uuid', ` ${MINE} `],
        ['a truncated uuid', '11111111-1111-4111-8111'],
        ['a uuid without separators', '11111111111141118111111111111111'],
        ['undefined', undefined]
    ])('400s on %s and never probes membership', async (_label, candidate) => {
        const { query, calls } = members(MINE);

        await expect(
            authorizeWorkspaceAccess(query, request(), candidate, MALFORMED)
        ).rejects.toThrow(new BadRequestException(MALFORMED));
        expect(calls).toEqual([]);
    });

    it('accepts an uppercase uuid — Postgres compares them equal', async () => {
        const upper = MINE.toUpperCase();
        const { query } = members(upper);
        const req = request();

        await authorizeWorkspaceAccess(query, req, upper, MALFORMED);

        expect(WORKSPACE_ID_PATTERN.test(upper)).toBe(true);
        expect(req.workspaceId).toBe(upper);
    });

    it('403s a non-member with the exact tenant-boundary message', async () => {
        const { query } = members(MINE);

        await expect(
            authorizeWorkspaceAccess(query, request(), THEIRS, MALFORMED)
        ).rejects.toThrow(
            new ForbiddenException('You are not a member of this workspace.')
        );
    });

    it('answers "not a member" and "no such workspace" identically', async () => {
        // The whole point of the flat 403: if these two diverged in status,
        // message, or shape, a signed-in caller could enumerate which
        // workspace ids exist by reading the difference.
        const { query } = members(MINE);

        const notMine = await wireResponse(
            authorizeWorkspaceAccess(query, request(), THEIRS, MALFORMED)
        );
        const noSuchThing = await wireResponse(
            authorizeWorkspaceAccess(query, request(), NOWHERE, MALFORMED)
        );

        expect(notMine).toEqual(noSuchThing);
        expect(notMine).toEqual({
            status: 403,
            body: {
                statusCode: 403,
                message: 'You are not a member of this workspace.',
                error: 'Forbidden'
            }
        });
    });

    it('never says 404 — an unknown id is not distinguishable from a private one', async () => {
        const { query } = members();

        const { status } = await wireResponse(
            authorizeWorkspaceAccess(query, request(), NOWHERE, MALFORMED)
        );

        expect(status).not.toBe(404);
        expect(status).toBe(403);
    });

    it('stamps the validated id on the request for @CurrentWorkspace()', async () => {
        const { query, calls } = members(MINE);
        const req = request();

        await expect(
            authorizeWorkspaceAccess(query, req, MINE, MALFORMED)
        ).resolves.toBeUndefined();

        expect(req.workspaceId).toBe(MINE);
        expect(calls).toEqual([`${USER}@${MINE}`]);
    });

    it('leaves the request unstamped on every refusal', async () => {
        const { query } = members(MINE);
        const req = request();

        await expect(
            authorizeWorkspaceAccess(query, req, THEIRS, MALFORMED)
        ).rejects.toThrow(ForbiddenException);

        // A handler downstream reads `request.workspaceId` as the scope of its
        // queries; a value left behind by a refused request would unscope them.
        expect(req.workspaceId).toBeUndefined();
    });

    it('carries the caller-supplied 400 message, so each guard names its own input', async () => {
        const { query } = members(MINE);

        await expect(
            authorizeWorkspaceAccess(
                query,
                request(),
                'nope',
                'Missing or malformed X-Workspace-Id header.'
            )
        ).rejects.toThrow('Missing or malformed X-Workspace-Id header.');
    });
});
