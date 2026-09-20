import {
    BadRequestException,
    ForbiddenException,
    UnauthorizedException
} from '@nestjs/common';
import { PERMISSIONS, type ApiTokenService } from '@orthacms/identity-server';
import { McpAuthService } from './mcp-auth.service';

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';

/** A token service that resolves exactly one secret. */
function tokens(record: Record<string, unknown> | null): ApiTokenService {
    return {
        verify: async (secret: string) =>
            secret === 'good-secret' ? record : null
    } as unknown as ApiTokenService;
}

/** The verified-token shape `verify` returns, as this service consumes it. */
function tokenRecord(overrides: Record<string, unknown> = {}) {
    return {
        id: 'token-1',
        name: 'e2e token',
        scope: 'read',
        workspaceIds: [WORKSPACE_A],
        createdBy: 'user-1',
        ...overrides
    };
}

describe('McpAuthService', () => {
    describe('bearer authentication', () => {
        it('rejects a request with no Authorization header', async () => {
            const auth = new McpAuthService(tokens(tokenRecord()));

            await expect(auth.authenticate({})).rejects.toBeInstanceOf(
                UnauthorizedException
            );
        });

        it('rejects a non-bearer scheme', async () => {
            const auth = new McpAuthService(tokens(tokenRecord()));

            await expect(
                auth.authenticate({ authorization: 'Basic good-secret' })
            ).rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('rejects an empty bearer value', async () => {
            const auth = new McpAuthService(tokens(tokenRecord()));

            await expect(
                auth.authenticate({ authorization: 'Bearer   ' })
            ).rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('accepts the scheme case-insensitively', async () => {
            const auth = new McpAuthService(tokens(tokenRecord()));

            await expect(
                auth.authenticate({ authorization: 'bEaReR good-secret' })
            ).resolves.toMatchObject({ workspaceId: WORKSPACE_A });
        });

        it('tolerates repeated whitespace around the scheme', async () => {
            const auth = new McpAuthService(tokens(tokenRecord()));

            await expect(
                auth.authenticate({ authorization: '  bearer   good-secret ' })
            ).resolves.toMatchObject({ workspaceId: WORKSPACE_A });
        });

        // A credential contains no whitespace, so a header carrying two words
        // is malformed. Rejoining them would invent a secret the caller never
        // sent and then blame them for it.
        it('rejects whitespace inside the credential', async () => {
            const auth = new McpAuthService(tokens(tokenRecord()));

            await expect(
                auth.authenticate({ authorization: 'Bearer good secret' })
            ).rejects.toBeInstanceOf(UnauthorizedException);
        });

        // Unknown, revoked and expired all resolve to null in `verify`, so a
        // flat 401 is what keeps the endpoint from being a token oracle.
        it('rejects an unrecognised token with a bare 401', async () => {
            const auth = new McpAuthService(tokens(tokenRecord()));

            await expect(
                auth.authenticate({ authorization: 'Bearer wrong-secret' })
            ).rejects.toBeInstanceOf(UnauthorizedException);
        });
    });

    describe('actor', () => {
        it('derives permissions from the token scope, not the minting user [mcp:I-07] [tools:I-05]', async () => {
            const auth = new McpAuthService(
                tokens(tokenRecord({ scope: 'read' }))
            );

            const context = await auth.authenticate({
                authorization: 'Bearer good-secret'
            });

            expect(context.can(PERMISSIONS.CONTENT_READ)).toBe(true);
            expect(context.can(PERMISSIONS.CONTENT_CREATE)).toBe(false);
            expect(context.actor.kind).toBe('token');
            // The token acts as itself; `createdBy` is attribution only.
            expect(context.actor.id).toBe('token-1');
            expect(context.actor.userId).toBe('user-1');
        });

        it('gives a full-scope token the write permissions', async () => {
            const auth = new McpAuthService(
                tokens(tokenRecord({ scope: 'full' }))
            );

            const context = await auth.authenticate({
                authorization: 'Bearer good-secret'
            });

            expect(context.can(PERMISSIONS.CONTENT_CREATE)).toBe(true);
            expect(context.can(PERMISSIONS.CONTENT_DELETE)).toBe(true);
            // Withheld from both scopes — deleting library assets is media
            // administration, which nothing on this surface needs.
            expect(context.can(PERMISSIONS.MEDIA_DELETE)).toBe(false);
        });
    });

    describe('workspace resolution', () => {
        it('uses the only workspace when the token covers one', async () => {
            const auth = new McpAuthService(tokens(tokenRecord()));

            const context = await auth.authenticate({
                authorization: 'Bearer good-secret'
            });

            expect(context.workspaceId).toBe(WORKSPACE_A);
        });

        it('requires a choice when the token covers several', async () => {
            const auth = new McpAuthService(
                tokens(
                    tokenRecord({ workspaceIds: [WORKSPACE_A, WORKSPACE_B] })
                )
            );

            await expect(
                auth.authenticate({ authorization: 'Bearer good-secret' })
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('honours the X-Workspace-Id header', async () => {
            const auth = new McpAuthService(
                tokens(
                    tokenRecord({ workspaceIds: [WORKSPACE_A, WORKSPACE_B] })
                )
            );

            const context = await auth.authenticate({
                authorization: 'Bearer good-secret',
                'x-workspace-id': WORKSPACE_B
            });

            expect(context.workspaceId).toBe(WORKSPACE_B);
        });

        // MCP clients are configured with a URL, and several cannot send
        // custom headers — but the bucket check is identical either way.
        it('honours the ?workspaceId= query parameter', async () => {
            const auth = new McpAuthService(
                tokens(
                    tokenRecord({ workspaceIds: [WORKSPACE_A, WORKSPACE_B] })
                )
            );

            const context = await auth.authenticate(
                { authorization: 'Bearer good-secret' },
                WORKSPACE_B
            );

            expect(context.workspaceId).toBe(WORKSPACE_B);
        });

        it('prefers the header over the query parameter [mcp:I-06]', async () => {
            const auth = new McpAuthService(
                tokens(
                    tokenRecord({ workspaceIds: [WORKSPACE_A, WORKSPACE_B] })
                )
            );

            const context = await auth.authenticate(
                {
                    authorization: 'Bearer good-secret',
                    'x-workspace-id': WORKSPACE_A
                },
                WORKSPACE_B
            );

            expect(context.workspaceId).toBe(WORKSPACE_A);
        });

        it('refuses a workspace outside the token bucket', async () => {
            const auth = new McpAuthService(tokens(tokenRecord()));

            await expect(
                auth.authenticate({
                    authorization: 'Bearer good-secret',
                    'x-workspace-id': WORKSPACE_B
                })
            ).rejects.toBeInstanceOf(ForbiddenException);
        });

        it('refuses a workspace outside the bucket named by query too', async () => {
            const auth = new McpAuthService(tokens(tokenRecord()));

            await expect(
                auth.authenticate(
                    { authorization: 'Bearer good-secret' },
                    WORKSPACE_B
                )
            ).rejects.toBeInstanceOf(ForbiddenException);
        });

        it('rejects a malformed workspace id', async () => {
            const auth = new McpAuthService(tokens(tokenRecord()));

            await expect(
                auth.authenticate({
                    authorization: 'Bearer good-secret',
                    'x-workspace-id': 'not-a-uuid'
                })
            ).rejects.toBeInstanceOf(BadRequestException);
        });
    });
});
