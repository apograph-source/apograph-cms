/**
 * The saved-views plugin's pass over the host's OpenAPI document.
 *
 * A second `decorate` from the same package as {@link describeContentApi},
 * because saved views ship as a second `ServerPlugin` entry
 * (`ContentViewsPlugin`) and a plugin describes what it registers. Keeping them
 * apart also keeps the route tables honest: nothing here can accidentally claim
 * a `/content/...` path, and nothing there can claim a `/views` one.
 *
 * Pure: takes the document and the serialized types, mutates only `/views`.
 */

import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import type { SerializedContentType } from '../registry/content-type-registry';
import { ref } from './content-schemas';
import { buildViewsSchemas, SAVED_VIEW_SCHEMA } from './views-schemas';
import { setSuccessResponse, type Operation } from './openapi-writer';

/**
 * Matches `<prefix>/views<rest>` — anchored at both ends.
 *
 * The tail is one of the three shapes the controller actually serves. The head
 * is `^/<one segment>/`, so `/api/insights/views` — another plugin's route,
 * ending in the same word — is not caught: a suffix match claimed it and gave
 * it this plugin's schemas, which is the same failure that once published
 * thirteen public content operations with the admin's shapes.
 *
 * It assumes the host's global prefix is a single segment, which the default
 * (`api`) is. A longer one leaves these three operations with no response
 * schema rather than the wrong one — the direction to fail in, and the same
 * one an unmatched route already takes.
 */
const VIEWS_ROUTE_RE = /^\/[^/]+\/views((?:\/\{id\})?(?:\/default)?)$/;

/**
 * What each `/views` operation answers, keyed by what follows `/views`.
 *
 * The three `204`s (`DELETE /views/{id}`, `PUT|DELETE /views/{id}/default`) are
 * listed as `null` rather than omitted: they are described — they simply have
 * no body, and saying so here is what keeps a later reader from "fixing" the
 * gap by inventing one.
 */
const VIEW_ROUTES: Record<string, Record<string, string | null>> = {
    '': { get: 'list', post: 'one' },
    '/{id}': { patch: 'one', delete: null },
    '/{id}/default': { put: null, delete: null }
};

/**
 * Adds the saved-view schemas to `document` and points the `/views` operations
 * at them.
 */
export function describeViewsApi(
    document: OpenApiDocument,
    types: readonly SerializedContentType[]
): void {
    document.components ??= {};
    document.components.schemas ??= {};
    Object.assign(document.components.schemas, buildViewsSchemas(types));

    for (const [route, item] of Object.entries(document.paths)) {
        const match = VIEWS_ROUTE_RE.exec(route);
        if (!match) {
            continue;
        }
        const byMethod = VIEW_ROUTES[match[1]];
        if (!byMethod) {
            continue;
        }

        for (const [method, operation] of Object.entries(
            item as Record<string, Operation>
        )) {
            const kind = byMethod[method];
            if (kind == null || !operation || typeof operation !== 'object') {
                continue;
            }
            if (kind === 'list') {
                setSuccessResponse(
                    operation,
                    { type: 'array', items: ref(SAVED_VIEW_SCHEMA) },
                    'The caller’s own views for this scope at any visibility, plus every workspace-shared one, ordered for the switcher.'
                );
            } else {
                setSuccessResponse(
                    operation,
                    ref(SAVED_VIEW_SCHEMA),
                    'The saved view.'
                );
            }
        }
    }
}
