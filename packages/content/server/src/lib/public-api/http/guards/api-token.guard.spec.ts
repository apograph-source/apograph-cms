import {
    ForbiddenException,
    UnauthorizedException,
    type ExecutionContext
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import {
    AccessPolicy,
    PERMISSIONS,
    PERMISSIONS_KEY,
    tokenActor,
    type Actor,
    type ApiTokenRecord,
    type ApiTokenService,
    type PermissionKey
} from '@orthacms/identity-server';
import { ApiTokenGuard } from './api-token.guard';
import type { ApiTokenRequest } from '../api-token-request';

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';

/** The live secret the fake service resolves; everything else is unknown. */
const GOOD = 'orthacms_good-secret';

/** Stand-in route handler and controller — only their identity is reflected. */
const handler = () => undefined;
class PublicApiController {}

/** A verified record as `ApiTokenService.verify` hands it back. */
function record(over: Partial<ApiTokenRecord> = {}): ApiTokenRecord {
    return {
        id: 'token-1',
        name: 'CI',
        scope: 'read',
        workspaceIds: [WORKSPACE_A],
        tokenHash: 'a'.repeat(64),
        lookupPrefix: 'orthacms_goo',
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
        createdBy: 'user-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        ...over
    } as ApiTokenRecord;
}

interface Options {
    /** The record `verify` resolves the live secret to. */
    token?: ApiTokenRecord;
    /** `@RequirePermissions(...)` on the handler. */
    handlerRequires?: PermissionKey[];
    /** `@RequirePermissions(...)` on the controller class. */
    classRequires?: PermissionKey[];
    /**
     * Replaces the real {@link AccessPolicy}. A stub is how the delegation is
     * proved: if the guard decided for itself, a stub answering the opposite of
     * the scope map would have no effect.
     */
    policy?: { canAll: jest.Mock };
    /** Headers the request carries. */
    headers?: Record<string, string | undefined>;
}

function harness(options: Options = {}) {
    /**
     * `Reflector.getAllAndOverride` as the guard relies on it: the first target
     * in the list that carries the metadata wins, so a handler decorator
     * overrides a class-level one and a class-level one is still found.
     */
    const metadata = new Map<unknown, PermissionKey[]>();
    if (options.handlerRequires) {
        metadata.set(handler, options.handlerRequires);
    }
    if (options.classRequires) {
        metadata.set(PublicApiController, options.classRequires);
    }
    const reflected: { key: string; targets: unknown[] }[] = [];
    const reflector = {
        getAllAndOverride: (key: string, targets: unknown[]) => {
            reflected.push({ key, targets: [...targets] });
            if (key !== PERMISSIONS_KEY) {
                return undefined;
            }
            for (const target of targets) {
                const found = metadata.get(target);
                if (found) {
                    return found;
                }
            }
            return undefined;
        }
    } as unknown as Reflector;

    const verified = options.token ?? record();
    const verify = jest.fn(async (secret: string) =>
        secret === GOOD ? verified : null
    );
    const tokens = { verify } as unknown as ApiTokenService;

    const policy = options.policy ?? new AccessPolicy();
    const canAll = jest.spyOn(
        policy as AccessPolicy,
        'canAll' as never
    ) as unknown as jest.SpyInstance;

    const request = {
        headers: options.headers ?? { authorization: `Bearer ${GOOD}` }
    } as unknown as ApiTokenRequest;
    const context = {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => handler,
        getClass: () => PublicApiController
    } as unknown as ExecutionContext;

    return {
        guard: new ApiTokenGuard(reflector, tokens, policy as AccessPolicy),
        context,
        request,
        verify,
        canAll,
        reflected
    };
}

/** The thrown exception of a `canActivate` that must fail. */
async function refusal(guard: ApiTokenGuard, context: ExecutionContext) {
    try {
        await guard.canActivate(context);
    } catch (error) {
        return error as UnauthorizedException;
    }
    throw new Error('expected canActivate to refuse');
}

/**
 * The whole authentication story for the public content API: these routes are
 * `@Public()`, so the app-wide session guard passes them through untouched and
 * this guard is the only thing between a bearer header and workspace content.
 */
describe('ApiTokenGuard', () => {
    describe('authentication', () => {
        it('collapses unknown, revoked and expired into one identical 401', async () => {
            // `ApiTokenService.verify` returns `null` for all three (pinned in
            // identity's `api-token.service.spec.ts`), and this guard is what
            // turns that single `null` into a single response. The invariant is
            // indistinguishability: told apart, the endpoint becomes an oracle
            // for which tokens exist, which of them were revoked and when they
            // expired. Today it rests on nobody rewording one of the three.
            const bodies = [];
            for (const secret of [
                'orthacms_never-minted',
                'orthacms_revoked-yesterday',
                'orthacms_expired-last-month'
            ]) {
                const { guard, context } = harness({
                    headers: { authorization: `Bearer ${secret}` }
                });
                const error = await refusal(guard, context);
                expect(error).toBeInstanceOf(UnauthorizedException);
                bodies.push({
                    status: error.getStatus(),
                    body: error.getResponse()
                });
            }

            expect(bodies[1]).toEqual(bodies[0]);
            expect(bodies[2]).toEqual(bodies[0]);
            expect(bodies[0].body).toMatchObject({
                statusCode: 401,
                message: 'Invalid API token.'
            });
        });

        it('answers a missing header with its own distinct 401', async () => {
            // Distinct on purpose, and safe: "you sent no credential" says
            // nothing about any token that exists.
            const bare = harness({ headers: {} });
            const missing = await refusal(bare.guard, bare.context);
            const bad = harness({
                headers: { authorization: 'Bearer orthacms_nope' }
            });
            const invalid = await refusal(bad.guard, bad.context);

            expect(missing).toBeInstanceOf(UnauthorizedException);
            expect(missing.getResponse()).toMatchObject({
                message: 'Missing `Authorization: Bearer <token>` header.'
            });
            expect(missing.getResponse()).not.toEqual(invalid.getResponse());
            // Nothing was looked up — a header-shape mistake never costs a read.
            expect(bare.verify).not.toHaveBeenCalled();
        });

        it('treats a foreign scheme exactly like a missing header', async () => {
            // A `Basic` credential is not a token, so it must not be hashed and
            // looked up — and the caller learns nothing about tokens either.
            const { guard, context, verify } = harness({
                headers: { authorization: `Basic ${GOOD}` }
            });

            const error = await refusal(guard, context);

            expect(error.getResponse()).toMatchObject({
                message: 'Missing `Authorization: Bearer <token>` header.'
            });
            expect(verify).not.toHaveBeenCalled();
        });

        it('rejects a bearer with no value at all', async () => {
            const { guard, context, verify } = harness({
                headers: { authorization: 'Bearer   ' }
            });

            await expect(refusal(guard, context)).resolves.toBeInstanceOf(
                UnauthorizedException
            );
            expect(verify).not.toHaveBeenCalled();
        });

        it('accepts the scheme case-insensitively and around extra spaces', async () => {
            // RFC 7235 makes the scheme case-insensitive, and clients do send
            // `bearer`. Refusing it would be a 401 nobody can debug.
            const { guard, context, verify } = harness({
                headers: { authorization: `  bEaReR   ${GOOD} ` }
            });

            await expect(guard.canActivate(context)).resolves.toBe(true);
            expect(verify).toHaveBeenCalledWith(GOOD);
        });

        it('passes a whitespace-carrying credential through as one secret', async () => {
            // Pins current behaviour: `bearerFrom` rejoins everything after the
            // scheme, so `Bearer a b` is looked up as the secret `a b` and 401s
            // because no such token exists. (MCP's copy of this rule refuses the
            // header outright instead — see `mcp-auth.service.spec.ts`.)
            const { guard, context, verify } = harness({
                headers: { authorization: 'Bearer part-one part-two' }
            });

            await expect(refusal(guard, context)).resolves.toBeInstanceOf(
                UnauthorizedException
            );
            expect(verify).toHaveBeenCalledWith('part-one part-two');
        });

        it('attaches the verified token, narrowed to what a route may see', async () => {
            const { guard, context, request } = harness();

            await expect(guard.canActivate(context)).resolves.toBe(true);
            expect(request.apiToken).toEqual({
                id: 'token-1',
                name: 'CI',
                scope: 'read',
                workspaceIds: [WORKSPACE_A],
                createdBy: 'user-1'
            });
            // The stored hash must never ride along on the request object.
            expect(request.apiToken).not.toHaveProperty('tokenHash');
        });

        it('normalises an unknown creator to null rather than undefined', async () => {
            // `uploaded_by` on a media row reads this; `undefined` would land as
            // a missing column instead of an explicit "nobody we still know".
            const { guard, context, request } = harness({
                token: record({ createdBy: null as unknown as string })
            });

            await guard.canActivate(context);

            expect(request.apiToken?.createdBy).toBeNull();
        });
    });

    describe('authorization', () => {
        it('reads the requirement off the handler and the class, in that order', async () => {
            const { guard, context, reflected } = harness({
                handlerRequires: [PERMISSIONS.CONTENT_READ]
            });

            await guard.canActivate(context);

            expect(reflected).toEqual([
                {
                    key: PERMISSIONS_KEY,
                    targets: [handler, PublicApiController]
                }
            ]);
        });

        it('honours a requirement declared only on the controller class', async () => {
            // `@UseGuards`/`@RequirePermissions` are routinely put on the
            // controller for a whole surface; reading only the handler would
            // silently open every route of such a controller.
            const { guard, context } = harness({
                classRequires: [PERMISSIONS.CONTENT_CREATE]
            });

            await expect(refusal(guard, context)).resolves.toBeInstanceOf(
                ForbiddenException
            );
        });

        it('lets a request with no declared requirement through', async () => {
            const { guard, context, canAll } = harness();

            await expect(guard.canActivate(context)).resolves.toBe(true);
            expect(canAll).not.toHaveBeenCalled();
        });

        it('delegates the decision to AccessPolicy instead of deciding itself [identity:I-15]', async () => {
            // The stub answers the *opposite* of the scope map both ways. If the
            // guard consulted `scopePermissions` directly, neither case would
            // change — so these two assertions are the delegation.
            const denyEverything = { canAll: jest.fn(() => false) };
            const denied = harness({
                handlerRequires: [PERMISSIONS.CONTENT_READ],
                policy: denyEverything
            });
            await expect(
                refusal(denied.guard, denied.context)
            ).resolves.toBeInstanceOf(ForbiddenException);

            const allowEverything = { canAll: jest.fn(() => true) };
            const allowed = harness({
                handlerRequires: [PERMISSIONS.CONTENT_DELETE],
                policy: allowEverything
            });
            await expect(
                allowed.guard.canActivate(allowed.context)
            ).resolves.toBe(true);
        });

        it('hands the policy the token as actor and the route keys as permissions [api-tokens:I-15]', async () => {
            const stub = { canAll: jest.fn(() => true) };
            const token = record({ scope: 'full' });
            const { guard, context } = harness({
                token,
                handlerRequires: [
                    PERMISSIONS.CONTENT_CREATE,
                    PERMISSIONS.MEDIA_CREATE
                ],
                policy: stub
            });

            await guard.canActivate(context);

            const [actor, required] = stub.canAll.mock.calls[0] as unknown as [
                Actor,
                { value: string }[]
            ];
            // The actor a token acts as — its own id, its scope's grants, and
            // nothing borrowed from the user who minted it.
            expect(actor).toEqual(tokenActor(token));
            expect(actor.userId).toBe('token-1');
            expect(required.map((permission) => permission.value)).toEqual([
                'content:create',
                'media:create'
            ]);
        });

        it('refuses a read token a write route through the real policy', async () => {
            // The end-to-end shape: the same `AccessPolicy` the session
            // `PermissionsGuard` uses, over the same `@RequirePermissions` keys.
            const { guard, context } = harness({
                handlerRequires: [PERMISSIONS.CONTENT_CREATE]
            });

            const error = await refusal(guard, context);

            expect(error).toBeInstanceOf(ForbiddenException);
            // A 403, never a 401: the caller authenticated fine, and telling
            // them to re-authenticate would send them round a loop.
            expect(error.getStatus()).toBe(403);
        });

        it('admits a full token to that same write route', async () => {
            const { guard, context } = harness({
                token: record({ scope: 'full' }),
                handlerRequires: [PERMISSIONS.CONTENT_CREATE]
            });

            await expect(guard.canActivate(context)).resolves.toBe(true);
        });
    });
});
