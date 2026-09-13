/**
 * The activity plugin's pass over the host's OpenAPI document.
 *
 * Three read routes, three hand-written `interface`s, and therefore three
 * operations the scanner leaves as `{ '200': { description: '' } }` — see
 * `packages/bootstrap/server/AGENTS.md` → "The response-schema gap". This
 * writes the schemas on the way past, the way `content-server`'s pass does.
 *
 * Pure: it takes the document and mutates only the paths this plugin owns.
 */

import type { OpenApiDocument } from '@apograph/bootstrap-server';
import { ACTIVITY_SCHEMAS, ref, type OpenApiSchema } from './activity-schemas';

/** An operation object, as far as this pass needs to see one. */
interface Operation {
    responses?: Record<string, { description?: string; content?: unknown }>;
}

/** What one operation returns. */
interface OperationSpec {
    /** Component name of the success schema. */
    schema: string;
    /** The success response's description. */
    description: string;
}

/**
 * Matches `<prefix>/activity<rest>`, capturing what follows.
 *
 * The empty capture is the log itself, so the group has to be optional rather
 * than `(.*)`-greedy off a trailing slash the document does not write:
 * `/api/activity` has no trailing slash, and the two sub-routes do.
 */
const ACTIVITY_ROUTE_RE = /\/activity(\/.*)?$/;

/** The plugin's routes, keyed by what follows `/activity`. */
const ROUTES: Record<string, Record<string, OperationSpec>> = {
    '': {
        get: {
            schema: 'ActivityListView',
            description:
                'One page of the deployment-wide audit log, matching the filters.'
        }
    },
    '/entries/{entryId}': {
        get: {
            schema: 'ActivityListView',
            description:
                'One page of this entry’s own history, scoped to the open workspace. An entry id from another workspace reads as an empty page rather than as somebody else’s history.'
        }
    },
    '/dead-letters': {
        get: {
            schema: 'ActivityDeadLetterListView',
            description:
                'The parked events, newest first. `total` ignores `limit`, so a caller can tell "nothing is stuck" from "the first page is full".'
        }
    }
};

/**
 * Writes a success schema onto whichever 2xx key the scanner already emitted,
 * so this never invents a status code the API does not return.
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

/**
 * Adds this plugin's schemas to `document` and attaches them to its own three
 * operations.
 */
export function describeActivityApi(document: OpenApiDocument): void {
    document.components ??= {};
    document.components.schemas ??= {};
    Object.assign(document.components.schemas, ACTIVITY_SCHEMAS);

    for (const [route, item] of Object.entries(document.paths)) {
        const match = ACTIVITY_ROUTE_RE.exec(route);
        if (!match) {
            continue;
        }
        const byMethod = ROUTES[match[1] ?? ''];
        if (!byMethod) {
            continue;
        }
        for (const [method, operation] of Object.entries(item)) {
            const spec = byMethod[method];
            if (!spec || !operation || typeof operation !== 'object') {
                continue;
            }
            setSuccessResponse(
                operation as Operation,
                ref(spec.schema),
                spec.description
            );
        }
    }
}
