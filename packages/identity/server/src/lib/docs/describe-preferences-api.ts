/**
 * The identity plugin's pass over `/api/preferences` in the host's OpenAPI
 * document.
 *
 * `UserPreferences` is a `Pick<>` over a Drizzle row type — a TypeScript type,
 * erased at compile time, with nothing for `@nestjs/swagger` to reflect. The
 * request body has a decorated DTO and is described; the response is not. See
 * `packages/bootstrap/server/AGENTS.md` → "The response-schema gap".
 *
 * Pure: it takes the document and mutates only the two operations this file
 * names.
 */

import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import { THEME_VALUES } from '../preferences/dto/update-preferences.dto';

/** A JSON Schema fragment, as it appears in the OpenAPI document. */
type OpenApiSchema = Record<string, unknown>;

/** An operation object, as far as this pass needs to see one. */
interface Operation {
    responses?: Record<string, { description?: string; content?: unknown }>;
}

/** Component name of the shared read/write shape. */
const PREFERENCES_SCHEMA = 'UserPreferences';

/**
 * The current user's appearance preferences.
 *
 * **One schema for both operations, because the read and the write genuinely
 * answer the same object.** `PreferencesService.save` projects the same
 * `PREFERENCE_COLUMNS` out of its upsert's `RETURNING` that `get` selects, so
 * `PUT` echoes exactly what a following `GET` would return — there is no
 * write-only field, no server-assigned id, and no `updatedAt` on the wire. The
 * `userId` is not here either: a caller only ever reads and writes their own
 * row, so naming whose row it is would be information the request already
 * carried.
 *
 * `theme` is required in both directions: a user who has never saved gets the
 * synthesised default rather than an empty object, so the key is always
 * present.
 */
const PREFERENCES: OpenApiSchema = {
    type: 'object',
    description:
        'The signed-in user’s own appearance preferences. Self-service — there is no permission to gate, because everyone owns theirs.',
    properties: {
        theme: {
            type: 'string',
            enum: [...THEME_VALUES],
            description:
                'Colour theme. `system` follows the OS setting. A user who has never saved reads back the default (`system`) rather than an absent key.'
        }
    },
    required: ['theme']
};

/** Matches `<prefix>/preferences`, the plugin's whole preferences surface. */
const PREFERENCES_ROUTE_RE = /\/preferences$/;

/** The methods this pass describes, with what each 2xx means. */
const OPERATIONS: Record<string, string> = {
    get: 'The caller’s stored preferences, or the defaults if they have never saved any.',
    put: 'The stored preferences after the upsert — the same shape a following read returns.'
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

/** Adds the preferences schema and attaches it to both operations. */
export function describePreferencesApi(document: OpenApiDocument): void {
    document.components ??= {};
    document.components.schemas ??= {};
    document.components.schemas[PREFERENCES_SCHEMA] = PREFERENCES;

    const schema: OpenApiSchema = {
        $ref: `#/components/schemas/${PREFERENCES_SCHEMA}`
    };

    for (const [route, item] of Object.entries(document.paths)) {
        if (!PREFERENCES_ROUTE_RE.test(route)) {
            continue;
        }
        for (const [method, operation] of Object.entries(item)) {
            const description = OPERATIONS[method];
            if (!description || !operation || typeof operation !== 'object') {
                continue;
            }
            setSuccessResponse(operation as Operation, schema, description);
        }
    }
}
