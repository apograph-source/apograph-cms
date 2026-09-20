/**
 * Writing a response onto the generated OpenAPI document, with the one rule
 * every `decorate` pass in this repo follows: **never invent a status code.**
 *
 * The scanner has already emitted whichever 2xx key the handler answers with —
 * every route here carries an explicit `@HttpCode(HttpStatus.OK)`, so it is
 * `200` even on the `POST`s — and a schema is written onto *that* key rather
 * than a guessed one.
 *
 * A local copy rather than an import from `@orthacms/content-server`: it is a
 * dozen lines, and making it a cross-package export would turn one plugin's
 * documentation helper into public API that another plugin's release has to
 * keep compatible.
 */

/** A JSON Schema fragment, as it appears in the OpenAPI document. */
export type OpenApiSchema = Record<string, unknown>;

/** An operation object, as far as this pass needs to see one. */
export interface Operation {
    parameters?: {
        name: string;
        in: string;
        schema?: OpenApiSchema;
        description?: string;
    }[];
    responses?: Record<string, { description?: string; content?: unknown }>;
}

/** `#/components/schemas/<name>`. */
export function ref(name: string): OpenApiSchema {
    return { $ref: `#/components/schemas/${name}` };
}

/** The 2xx key the scanner emitted, or `undefined` when there is none to write. */
function successKey(operation: Operation): string | undefined {
    const key = Object.keys(operation.responses ?? {}).find((code) =>
        /^2\d\d$/.test(code)
    );
    // A `204` has no body; attaching one would describe a payload the server
    // never sends.
    return key === '204' ? undefined : key;
}

/**
 * Writes a success response carrying one or more media types.
 *
 * Several, for the export download: the response's content type is chosen from
 * the request body's `format`, and `csv` is additionally promoted to a ZIP of
 * per-type CSVs whenever the export spans more than one type — so the honest
 * description is the set, not one entry from it.
 */
export function setSuccessResponse(
    operation: Operation,
    byMediaType: Record<string, OpenApiSchema>,
    description: string,
    headers?: Record<string, unknown>
): void {
    const key = successKey(operation);
    if (!key) {
        return;
    }
    const responses = operation.responses ?? {};
    responses[key] = {
        description,
        ...(headers ? { headers } : {}),
        content: Object.fromEntries(
            Object.entries(byMediaType).map(([type, schema]) => [
                type,
                { schema }
            ])
        )
    };
    operation.responses = responses;
}

/** Adds a documented failure response, leaving any existing one alone. */
export function addErrorResponse(
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
