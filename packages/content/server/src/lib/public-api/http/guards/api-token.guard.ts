import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
    AccessPolicy,
    ApiTokenService,
    Permission,
    PERMISSIONS_KEY,
    tokenActor,
    type PermissionKey
} from '@orthacms/identity-server';
import type { ApiTokenRequest } from '../api-token-request';

/** The scheme the `Authorization` header must use, case-insensitively. */
const BEARER = 'bearer';

/**
 * Authenticates a public content-API request from its `Authorization: Bearer`
 * token and authorizes it against the token's scope.
 *
 * These routes are `@Public()`, so the app-wide session `AuthGuard` passes them
 * through untouched — this guard is the whole authentication story for them. It
 * hashes the presented bearer, resolves it via `ApiTokenService.verify` (which
 * rejects unknown, revoked, and expired tokens identically), and attaches the
 * verified token as `request.apiToken`.
 *
 * Authorization then reuses the **same** machinery as the session routes:
 * `scopePermissions` turns the token's scope into a permission set, and the
 * route's `@RequirePermissions(...)` metadata is evaluated against it by the
 * pure {@link AccessPolicy} — so a route's requirement means exactly the same
 * thing whether the caller is a logged-in user or a token, and adding a write
 * route later needs no change here.
 *
 * Every authentication failure — no header, wrong scheme, unknown/revoked/
 * expired token — is one bare 401, so the endpoint can't be used to probe which
 * tokens exist.
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly tokens: ApiTokenService,
        private readonly accessPolicy: AccessPolicy
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<ApiTokenRequest>();
        const secret = bearerFrom(request.headers.authorization);
        if (!secret) {
            throw new UnauthorizedException(
                'Missing `Authorization: Bearer <token>` header.'
            );
        }

        const token = await this.tokens.verify(secret);
        if (!token) {
            // Unknown, revoked, and expired are one flat 401 — no enumeration
            // signal, and no hint about which of the three it was.
            throw new UnauthorizedException('Invalid API token.');
        }

        request.apiToken = {
            id: token.id,
            name: token.name,
            scope: token.scope,
            workspaceIds: token.workspaceIds,
            createdBy: token.createdBy ?? null
        };

        const required = this.reflector.getAllAndOverride<PermissionKey[]>(
            PERMISSIONS_KEY,
            [context.getHandler(), context.getClass()]
        );
        if (required && required.length > 0) {
            // A token acts on its own behalf, not a user's — see `tokenActor`
            // for why the minting user's role grants are never consulted.
            const allowed = this.accessPolicy.canAll(
                tokenActor(token),
                required.map((key) => Permission.create(key))
            );
            if (!allowed) {
                throw new ForbiddenException(
                    'This token’s scope does not allow that operation.'
                );
            }
        }

        return true;
    }
}

/**
 * The raw token out of an `Authorization` header, or `undefined` when the
 * header is absent, uses another scheme, or carries no value.
 */
function bearerFrom(header: string | undefined): string | undefined {
    if (!header) {
        return undefined;
    }
    const [scheme, ...rest] = header.trim().split(/\s+/);
    if (scheme.toLowerCase() !== BEARER) {
        return undefined;
    }
    const value = rest.join(' ');
    return value.length > 0 ? value : undefined;
}
