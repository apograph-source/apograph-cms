import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    UnauthorizedException
} from '@nestjs/common';
import { ApiTokenService, scopePermissions } from '@orthacms/identity-server';
import {
    WORKSPACE_HEADER,
    WORKSPACE_ID_PATTERN
} from '@orthacms/workspaces-server';
import type { ToolContext } from '@orthacms/tools-server';
import { createToolContext } from '@orthacms/tools-server';

/** The scheme the `Authorization` header must use, case-insensitively. */
const BEARER = 'bearer';

/** The headers this service reads, as Node delivers them. */
export interface McpRequestHeaders {
    authorization?: string;
    [key: string]: string | string[] | undefined;
}

/**
 * Authenticates an MCP request and resolves the workspace it acts in, yielding
 * the {@link ToolContext} every tool call runs under.
 *
 * **The same credential and the same rules as `/api/v1/*`** — deliberately, and
 * to the letter. MCP is a second front door onto the content API, not a second
 * security model: it takes the bearer tokens the admin's API Tokens page
 * already mints, resolves them through the same `ApiTokenService.verify`, and
 * derives permissions through the same `scopePermissions`. An operator revoking
 * a token revokes its MCP access in the same instant, and there is no second
 * credential store to audit.
 *
 * This class is the MCP counterpart of three guards that cannot be reused
 * directly, because Nest gates *routes* and MCP is one route carrying many
 * operations:
 *
 * - `ApiTokenGuard` → {@link authenticate}'s bearer half.
 * - `ApiTokenWorkspaceGuard` → {@link authenticate}'s workspace half, rule for
 *   rule.
 * - The per-route `@RequirePermissions(...)` → `ToolDefinition.requires`,
 *   enforced centrally by `ToolRegistry.call`.
 *
 * A **session cookie is not accepted**, exactly as on `/api/v1/*`. Cookies ride
 * along ambiently, which is what makes cookie-authenticated writes CSRF-able; a
 * bearer token never does. Accepting both here would reintroduce that on an
 * endpoint whose whole purpose is letting an agent write content.
 */
@Injectable()
export class McpAuthService {
    constructor(private readonly tokens: ApiTokenService) {}

    /**
     * Verify the bearer credential and resolve the target workspace.
     *
     * `workspaceQuery` is the optional `?workspaceId=` on the endpoint URL. It
     * exists because MCP clients are configured with a **URL**, and several
     * make custom headers awkward or impossible — while a multi-workspace token
     * has to name one somehow. The header wins when both are present, and both
     * are checked against the token's bucket identically, so the query string
     * is a spelling of the same rule and never a way around it.
     */
    async authenticate(
        headers: McpRequestHeaders,
        workspaceQuery?: string
    ): Promise<ToolContext> {
        const secret = bearerFrom(headers.authorization);
        if (!secret) {
            throw new UnauthorizedException(
                'Missing `Authorization: Bearer <token>` header.'
            );
        }

        const token = await this.tokens.verify(secret);
        if (!token) {
            // Unknown, revoked, and expired are one flat 401 — the endpoint
            // must not be usable to probe which tokens exist.
            throw new UnauthorizedException('Invalid API token.');
        }

        const workspaceId = resolveWorkspace(
            token.workspaceIds,
            headerValue(headers[WORKSPACE_HEADER]) ?? workspaceQuery
        );

        return createToolContext(
            {
                kind: 'token',
                id: token.id,
                displayName: token.name,
                grantedPermissions: new Set(scopePermissions(token.scope)),
                // Attribution only — the minting user's own role grants are
                // never consulted, so revoking the token is always sufficient.
                userId: token.createdBy ?? null
            },
            workspaceId
        );
    }
}

/**
 * Which of the token's workspaces this request targets — the rule
 * `ApiTokenWorkspaceGuard` applies, restated for a non-Nest call site:
 *
 * - named → must be well-formed (400) and in the bucket (403);
 * - unnamed with a single-workspace token → that workspace, so the common case
 *   needs no configuration at all;
 * - unnamed with a multi-workspace token → 400. Picking one silently would
 *   surface as "why is this empty?", which is a far worse failure than an
 *   error that says exactly what to do.
 */
function resolveWorkspace(
    bucket: readonly string[],
    requested: string | undefined
): string {
    if (!requested) {
        if (bucket.length === 1) {
            return bucket[0];
        }
        throw new BadRequestException(
            `This token covers ${bucket.length} workspaces — name the one you want with the ${WORKSPACE_HEADER} header or a ?workspaceId= query parameter on the MCP endpoint URL.`
        );
    }
    if (!WORKSPACE_ID_PATTERN.test(requested)) {
        throw new BadRequestException(`Malformed ${WORKSPACE_HEADER}.`);
    }
    if (!bucket.includes(requested)) {
        // Not-in-bucket and no-such-workspace are the same 403, so a token
        // can't be used to probe which workspace ids exist.
        throw new ForbiddenException(
            'This token does not cover that workspace.'
        );
    }
    return requested;
}

/** First value of a possibly-repeated header. */
function headerValue(raw: string | string[] | undefined): string | undefined {
    return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * The raw token out of an `Authorization` header, or `undefined` when the
 * header is absent, uses another scheme, or carries no value.
 *
 * Surrounding and repeated whitespace around the scheme is tolerated, because
 * RFC 9110 allows it and clients emit it. Whitespace *inside* the value is not:
 * a credential never contains any, so joining the pieces back together would
 * invent a token the caller never sent — and then report the reinvention as
 * `Invalid API token`, which reads as a wrong secret rather than a malformed
 * header. Exactly one value after the scheme, or nothing.
 */
function bearerFrom(header: string | undefined): string | undefined {
    if (!header) {
        return undefined;
    }
    const [scheme, ...rest] = header.trim().split(/\s+/);
    if (scheme.toLowerCase() !== BEARER || rest.length !== 1) {
        return undefined;
    }
    return rest[0].length > 0 ? rest[0] : undefined;
}
