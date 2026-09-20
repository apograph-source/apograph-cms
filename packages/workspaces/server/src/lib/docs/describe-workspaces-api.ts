/**
 * The workspaces plugin's pass over the host's OpenAPI document.
 *
 * `@nestjs/swagger` reads the request side of these routes from their DTOs, but
 * every *response* is a bare `interface` — `WorkspaceView`, `{ count: number }`
 * — which is erased at compile time and carries no metadata, so the scanner
 * emits `{ '200': { description: '' } }` and a consumer learns nothing. Rather
 * than turn eleven view types into decorated classes, this pass writes the
 * schemas straight onto the finished document
 * (`packages/bootstrap/server/AGENTS.md` → "The response-schema gap").
 *
 * Pure: it takes the document and mutates only the paths this plugin owns.
 */

import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import type { OpenApiSchema } from './workspace-schemas';
import { buildWorkspaceSchemas, ref } from './workspace-schemas';

/** An operation object, as far as this pass needs to see one. */
interface Operation {
    responses?: Record<string, { description?: string; content?: unknown }>;
}

/** What one operation answers with. */
interface OperationSpec {
    /** Component name of the success schema; omitted for a 204. */
    schema?: string;
    /** The success response's description. */
    description: string;
    /** Whether a create can lose the slug race. */
    slugConflict?: boolean;
}

/** `WorkspaceView`, which nine of the eleven described operations return. */
function workspace(description: string): OperationSpec {
    return { schema: 'Workspace', description };
}

/**
 * The routes, keyed by what follows `/workspaces`.
 *
 * The two `204` operations — `DELETE /{id}` and `DELETE /{id}/members/{userId}`
 * — are deliberately absent rather than listed as empty: this pass only ever
 * writes onto a 2xx key the scanner already emitted, and there is nothing to
 * say about a response that has no body.
 */
const ROUTES: Record<string, Record<string, OperationSpec>> = {
    '': {
        post: {
            schema: 'Workspace',
            description:
                'The created workspace, with the caller already a member and the requested content grants flattened into explicit rows.',
            slugConflict: true
        },
        get: {
            schema: 'WorkspaceList',
            description: 'The caller’s workspaces, newest first.'
        }
    },
    '/slug-available': {
        get: {
            schema: 'WorkspaceSlugAvailability',
            description: 'Whether the slug is free.'
        }
    },
    '/{id}': { patch: workspace('The updated workspace.') },
    '/{id}/archive': { post: workspace('The workspace, now `archived`.') },
    '/{id}/unarchive': { post: workspace('The workspace, now `active`.') },
    '/{id}/members': {
        post: workspace('The workspace, with the new member in `members`.')
    },
    '/{id}/content': {
        post: workspace(
            'The workspace, with the granted content type in `content`. Idempotent — granting twice returns the same list.'
        )
    },
    '/{id}/content/{slug}': {
        delete: workspace(
            'The workspace, with the content type gone from `content`. Idempotent — revoking a type that was never granted is a 200, not a 404.'
        )
    },
    '/{id}/content/{slug}/entry-count': {
        get: {
            schema: 'WorkspaceEntryCount',
            description:
                'How many entries of this content type the workspace holds. `0` when no content plugin is registered.'
        }
    },
    '/{id}/entry-count': {
        get: {
            schema: 'WorkspaceEntryCount',
            description:
                'Total entries the workspace holds across every content type. `0` when no content plugin is registered.'
        }
    }
};

/**
 * Matches `<prefix>/workspaces<rest>`.
 *
 * Anchored on the whole path with the rest captured, so `/workspaces` matches
 * with an empty rest and nothing longer sneaks in: only a segment boundary or
 * the end of the path follows. No other operation in the document mentions
 * `workspaces` in its path — the header-scoped routes elsewhere name it in
 * `X-Workspace-Id`, not in the URL — so a single pattern is unambiguous here in
 * a way content's two content surfaces were not.
 */
const WORKSPACES_ROUTE_RE = /\/workspaces(\/.*)?$/;

/**
 * `GET /content-types`, which is this plugin's too — `ListContentTypesController`
 * reads its own `CONTENT_CATALOG` port, which the content plugin binds to its
 * registry and which falls back to a built-in list when no content plugin is
 * installed. It sits outside the `/workspaces` namespace, so it needs its own
 * anchor; a single trailing segment, so a route merely *ending* in the word
 * cannot claim it.
 */
const CONTENT_TYPES_ROUTE_RE = /^\/[^/]+\/content-types$/;

/** Which `{id}`-scoped routes sit behind `WorkspaceMemberGuard`. */
function isMemberScoped(rest: string): boolean {
    return rest.startsWith('/{id}');
}

/**
 * Writes a success response's schema onto whichever 2xx key the scanner already
 * emitted — Nest answers `201` for a `@Post` and `200` elsewhere — so this
 * never invents a status code the API does not return.
 */
function setSuccessResponse(
    operation: Operation,
    schema: OpenApiSchema,
    description: string
): void {
    const responses = operation.responses ?? {};
    const key = Object.keys(responses).find((code) => /^2\d\d$/.test(code));
    if (!key || key === '204') {
        return;
    }
    responses[key] = {
        description,
        content: { 'application/json': { schema } }
    };
    operation.responses = responses;
}

/** Adds a documented failure response, leaving any existing one alone. */
function addErrorResponse(
    operation: Operation,
    code: string,
    description: string
): void {
    const responses = operation.responses ?? {};
    if (responses[code]) {
        return;
    }
    responses[code] = { description };
    operation.responses = responses;
}

/**
 * Adds this plugin's schemas to `document` and describes its own operations.
 */
export function describeWorkspacesApi(document: OpenApiDocument): void {
    document.components ??= {};
    document.components.schemas ??= {};
    Object.assign(document.components.schemas, buildWorkspaceSchemas());

    for (const [route, item] of Object.entries(document.paths)) {
        if (CONTENT_TYPES_ROUTE_RE.test(route)) {
            const get = (item as Record<string, Operation>)['get'];
            if (get && typeof get === 'object') {
                setSuccessResponse(
                    get,
                    ref('ContentTypeCatalogue'),
                    'Every content type a workspace can be granted, in registration order.'
                );
            }
            continue;
        }

        const match = WORKSPACES_ROUTE_RE.exec(route);
        if (!match) {
            continue;
        }
        const rest = match[1] ?? '';
        const byMethod = ROUTES[rest];
        if (!byMethod) {
            continue;
        }

        for (const [method, operation] of Object.entries(
            item as Record<string, Operation>
        )) {
            const spec = byMethod[method];
            if (!spec || !operation || typeof operation !== 'object') {
                continue;
            }

            if (spec.schema) {
                setSuccessResponse(
                    operation,
                    ref(spec.schema),
                    spec.description
                );
            }
            if (isMemberScoped(rest)) {
                // Not a 404: `WorkspaceMemberGuard` answers a flat 403 for a
                // workspace the caller does not belong to *and* for one that
                // does not exist, precisely so the two cannot be told apart.
                // Documenting a 404 here would describe a probe the API
                // deliberately refuses to offer.
                addErrorResponse(
                    operation,
                    '403',
                    'The caller is not a member of this workspace — the same answer as a workspace that does not exist.'
                );
            }
            if (spec.slugConflict) {
                addErrorResponse(
                    operation,
                    '409',
                    'The slug is already taken by another workspace.'
                );
            }
        }
    }
}
