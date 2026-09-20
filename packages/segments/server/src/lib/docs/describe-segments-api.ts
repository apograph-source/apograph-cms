/**
 * The segments plugin's pass over the host's OpenAPI document.
 *
 * Nine operations across three controllers, and the scanner could describe none
 * of them: every one answers a framework-free `interface`, which is erased at
 * compile time and carries no metadata for `@nestjs/swagger` to read.
 *
 * Pure: takes the document and mutates only the paths this plugin serves.
 *
 * **Two surfaces, two tables**, for the reason content's pass learned the hard
 * way: `/api/segments/entries/{entryId}` and
 * `/api/v1/content/{typeName}/{id}/access` are the same decision, and they do
 * **not** answer in the same shape — the public one carries the entry id and a
 * derived `restricted` flag. One table matching both would put one surface's
 * contract on the other, which is exactly how thirteen public content
 * operations came to be published with the admin's schemas.
 */

import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import {
    addErrorResponse,
    ref,
    setSuccessResponse,
    type Operation,
    type OpenApiSchema
} from './openapi-writer';
import {
    buildSegmentsSchemas,
    ENTRY_ACCESS_SCHEMA,
    PUBLIC_ENTRY_ACCESS_SCHEMA,
    SEGMENT_PAGE_SCHEMA,
    SEGMENT_SCHEMA
} from './segments-schemas';

/** What one operation answers, and the sentence describing it. */
interface Payload {
    schema: OpenApiSchema;
    description: string;
}

/** A named schema. */
function one(name: string, description: string): Payload {
    return { schema: ref(name), description };
}

/** An array of a named schema. */
function many(name: string, description: string): Payload {
    return { schema: { type: 'array', items: ref(name) }, description };
}

/**
 * The directory and the admin's entry-access routes, keyed by what follows
 * `/segments`.
 *
 * `DELETE /segments/{id}` is absent on purpose rather than by oversight: it
 * answers `204`, and the writer would refuse to give it a body anyway.
 */
const SEGMENT_ROUTES: Record<string, Record<string, Payload>> = {
    '': {
        get: one(
            SEGMENT_PAGE_SCHEMA,
            'One page of the audience directory, with how many entries name each row.'
        ),
        post: one(SEGMENT_SCHEMA, 'The created segment.')
    },
    '/lookup': {
        get: many(
            SEGMENT_SCHEMA,
            'The named segments, in no guaranteed order. **Unknown ids are skipped, not refused** — so the result may be shorter than the request, and a caller resolving a deleted audience gets a short list rather than a 404.'
        )
    },
    '/{id}': {
        get: one(SEGMENT_SCHEMA, 'The segment.'),
        patch: one(SEGMENT_SCHEMA, 'The updated segment.')
    },
    '/entries/{entryId}': {
        get: one(
            ENTRY_ACCESS_SCHEMA,
            'The entry’s two lists. An entry nobody restricted reads as two empty ones.'
        ),
        put: one(
            ENTRY_ACCESS_SCHEMA,
            'The lists as they now stand — the whole state, because this replaces rather than merges. On a localized type it was written to every locale of the record. The change is live when this answers.'
        )
    }
};

/** The public surface, keyed by method. */
const PUBLIC_ACCESS_ROUTE: Record<string, Payload> = {
    get: one(
        PUBLIC_ENTRY_ACCESS_SCHEMA,
        'Who may read the entry. An empty `allow` list means **everyone**, not nobody.'
    ),
    put: one(
        PUBLIC_ENTRY_ACCESS_SCHEMA,
        'The audiences as they now stand. Both lists are replaced, so this echoes the whole state rather than a change to it.'
    )
};

/**
 * Matches `<prefix>/segments<rest>`, anchored at both ends: the tail is one of
 * the four shapes the two admin controllers serve, and the head is
 * `^/<one segment>/`, so another plugin's `/api/<something>/segments` cannot be
 * caught by it.
 *
 * It assumes the host's global prefix is a single segment, which the default
 * (`api`) is. A longer one leaves these operations with no response schema
 * rather than the wrong one — the direction to fail in.
 */
const SEGMENT_ROUTE_RE =
    /^\/[^/]+\/segments((?:\/lookup)|(?:\/\{id\})|(?:\/entries\/\{entryId\}))?$/;

/** Matches the public `<prefix>/v1/content/{typeName}/{id}/access`. */
const PUBLIC_ACCESS_ROUTE_RE = /\/v1\/content\/\{typeName\}\/\{id\}\/access$/;

/** Applies one table entry to one operation. */
function describe(operation: Operation, payload: Payload): void {
    setSuccessResponse(operation, payload.schema, payload.description);
}

/** Adds this plugin's schemas to `document` and describes its own operations. */
export function describeSegmentsApi(document: OpenApiDocument): void {
    document.components ??= {};
    document.components.schemas ??= {};
    Object.assign(document.components.schemas, buildSegmentsSchemas());

    for (const [route, item] of Object.entries(document.paths)) {
        const operations = item as Record<string, Operation>;

        if (PUBLIC_ACCESS_ROUTE_RE.test(route)) {
            for (const [method, operation] of Object.entries(operations)) {
                const payload = PUBLIC_ACCESS_ROUTE[method];
                if (!payload || !operation || typeof operation !== 'object') {
                    continue;
                }
                describe(operation, payload);
                // A type this workspace was not granted answers exactly as an
                // unknown one does, so a client cannot learn the installation's
                // type list by probing. It is a **400** here, not the 404 the
                // content routes give — which is why content's pass writes the
                // `typeName` enum onto this route but not its own error.
                addErrorResponse(
                    operation,
                    '400',
                    'Unknown content type, or one this workspace was not granted.'
                );
            }
            continue;
        }

        const match = SEGMENT_ROUTE_RE.exec(route);
        if (!match) {
            continue;
        }
        const byMethod = SEGMENT_ROUTES[match[1] ?? ''];
        if (!byMethod) {
            continue;
        }
        for (const [method, operation] of Object.entries(operations)) {
            const payload = byMethod[method];
            if (!payload || !operation || typeof operation !== 'object') {
                continue;
            }
            describe(operation, payload);
        }
    }
}
