/**
 * The GraphQL plugin's pass over the host's OpenAPI document.
 *
 * Two operations, and neither is an ordinary REST route — which is the whole
 * reason this file needs a paragraph rather than a table.
 *
 * ## What can honestly be described, and what cannot
 *
 * `POST /v1/graphql` answers **GraphQL's envelope**: `{ data, errors }`. The
 * envelope is fixed and the plugin's own code decides the shape of `errors`, so
 * both are described here exactly. `data` is not: its shape is chosen by the
 * **query in the request body**, field by field, and OpenAPI has no way to say
 * "the response mirrors the selection set". So `data` is described as the open
 * object it is, with a description pointing at the thing that *does* describe it
 * — the GraphQL schema, which `GET /v1/graphql` serves as SDL and which
 * introspection can fetch.
 *
 * Writing a union of the content types here would look more useful and be a
 * lie: the schema is built **per workspace content-grant set**, so there is no
 * single set of types this route returns, and a `Query` selecting three fields
 * returns an object matching none of them anyway.
 *
 * ## The status code is the other thing to get right
 *
 * A failed operation is still an HTTP **200** — `@HttpCode(HttpStatus.OK)` on a
 * `@Post`, and `executeOperation` returns an errors array rather than throwing.
 * That is the single fact a consumer porting from REST has to absorb, so it is
 * said on the 200 itself rather than left to be discovered.
 *
 * `GET /v1/graphql` is simpler and just as easy to describe wrongly: it carries
 * `@Header('Content-Type', 'text/plain; charset=utf-8')` and returns SDL, so
 * its 200 is a `text/plain` string and not JSON.
 */

import type { OpenApiDocument } from '@orthacms/bootstrap-server';

/** A JSON Schema fragment, as it appears in the OpenAPI document. */
type OpenApiSchema = Record<string, unknown>;

/** An operation object, as far as this pass needs to see one. */
interface Operation {
    responses?: Record<string, { description?: string; content?: unknown }>;
}

/** Matches `<prefix>/v1/graphql`, and nothing under it. */
const GRAPHQL_ROUTE_RE = /\/v1\/graphql$/;

/**
 * One entry in the `errors` array.
 *
 * `message` is the only field GraphQL guarantees, and this plugin's own
 * observed responses bear that out: a document rejected by a cost limit carries
 * `message` + `extensions` and no `locations`; one rejected by validation
 * carries `message` + `locations` and no `extensions`; a resolver failure
 * carries all four. So `message` is the only required property.
 */
const GRAPHQL_ERROR: OpenApiSchema = {
    type: 'object',
    description:
        'One error. GraphQL guarantees only `message`; which of the rest appear depends on how far the operation got — a document refused by a cost limit never reached a resolver and so has no `path`.',
    properties: {
        message: {
            type: 'string',
            description:
                'What went wrong, in the words the equivalent REST route would have used. An unexpected server-side failure is replaced with a fixed message — a driver error or a stack trace would turn a token into a reconnaissance tool.'
        },
        locations: {
            type: 'array',
            description:
                'Where in the query document the error arose. Present for parse and validation failures.',
            items: {
                type: 'object',
                properties: {
                    line: { type: 'integer' },
                    column: { type: 'integer' }
                },
                required: ['line', 'column']
            }
        },
        path: {
            type: 'array',
            description:
                'The response-field path to the point of failure — field names and list indices, so entries are strings or integers.',
            items: {
                // `oneOf`, not `anyOf`: a path segment is a field name or a
                // list index and can never be both, so the alternatives really
                // are exclusive here.
                oneOf: [{ type: 'string' }, { type: 'integer' }]
            }
        },
        extensions: {
            type: 'object',
            description:
                'Machine-readable detail. This API sets `code` (a stable string to branch on) and `status` (the HTTP status the REST equivalent would have returned) on errors raised by a resolver, and `code` alone on the limit and parse refusals. Left open because GraphQL allows any producer to add to it.',
            additionalProperties: true,
            properties: {
                code: {
                    type: 'string',
                    description:
                        'A stable code — `BAD_REQUEST`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION_FAILED`, `INTERNAL_SERVER_ERROR`, or one of the pre-execution refusals `GRAPHQL_PARSE_FAILED` / `GRAPHQL_LIMIT_EXCEEDED`. Deliberately not an enum here: `extensions` is open by specification, and closing it in the document would make a future code read as a contract violation.'
                },
                status: {
                    type: 'integer',
                    description:
                        'The HTTP status the equivalent REST call would have answered. **This is where the status lives** — the HTTP status of the response itself is 200 whenever the operation ran at all. Absent on the refusals that never reached a resolver.'
                },
                issues: {
                    type: 'array',
                    description:
                        'The per-field validation failures a REST 422 carries, verbatim. Present on `VALIDATION_FAILED` only.',
                    items: { type: 'object', additionalProperties: true }
                }
            }
        }
    },
    required: ['message']
};

/**
 * The GraphQL response envelope.
 *
 * Both members are optional and both may be present at once: a query whose
 * nullable field threw comes back with the rest of the data *and* an error, and
 * a top-level failure comes back as `data: null` with the error. Describing
 * either as required would reject a legitimate response.
 */
const GRAPHQL_RESPONSE: OpenApiSchema = {
    type: 'object',
    description:
        'GraphQL’s response envelope. `data` and `errors` are independently optional and routinely appear together — a nullable field that failed yields both.',
    properties: {
        data: {
            type: 'object',
            nullable: true,
            additionalProperties: true,
            description:
                'The operation’s result, **shaped by the query rather than by this route** — one property per top-level field the selection set asked for. OpenAPI cannot express that dependency, so no more specific schema is given here: the document that does describe it is the GraphQL schema itself, served as SDL by `GET /v1/graphql` and reachable by introspection. That schema is built per workspace content-grant set, so it describes exactly the content types the resolved workspace was granted and two tokens legitimately see different ones. `null` when the operation failed before or at the top level.'
        },
        errors: {
            type: 'array',
            description:
                'Present only when something went wrong. An empty array is never returned.',
            items: { $ref: '#/components/schemas/GraphqlError' }
        }
    }
};

/** The SDL a `GET` answers with. */
const GRAPHQL_SDL: OpenApiSchema = {
    type: 'string',
    description:
        'The schema in GraphQL SDL, scoped to the resolved workspace’s content grants — an ungranted content type does not appear, the GraphQL equivalent of `/v1/content-types` pruning its list.'
};

/**
 * Writes a success response's schema onto whichever 2xx key the scanner already
 * emitted, at the given media type. Never invents a status code: the `POST` is
 * `@HttpCode(200)` and the `GET` is a plain `200`, and both are read rather
 * than assumed.
 */
function setSuccessResponse(
    operation: Operation,
    schema: OpenApiSchema,
    description: string,
    mediaType: string
): void {
    const responses = operation.responses ?? {};
    const key = Object.keys(responses).find((code) => /^2\d\d$/.test(code));
    if (!key || key === '204') {
        return;
    }
    responses[key] = {
        description,
        content: { [mediaType]: { schema } }
    };
    operation.responses = responses;
}

/** Adds the envelope schemas and attaches them to the two GraphQL operations. */
export function describeGraphqlApi(document: OpenApiDocument): void {
    document.components ??= {};
    document.components.schemas ??= {};
    document.components.schemas['GraphqlError'] = GRAPHQL_ERROR;
    document.components.schemas['GraphqlResponse'] = GRAPHQL_RESPONSE;

    for (const [route, item] of Object.entries(document.paths)) {
        if (!GRAPHQL_ROUTE_RE.test(route)) {
            continue;
        }
        const post = item['post'];
        if (post && typeof post === 'object') {
            setSuccessResponse(
                post as Operation,
                { $ref: '#/components/schemas/GraphqlResponse' },
                'The operation ran. **A 200 does not mean it succeeded** — a parse failure, a refused document, a permission failure and a resolver error are all reported in `errors` with the REST status in `extensions.status`. Only a request that never reached execution (an unauthenticated one, or a workspace outside the token’s bucket) answers a non-2xx status.',
                'application/json'
            );
        }
        const get = item['get'];
        if (get && typeof get === 'object') {
            setSuccessResponse(
                get as Operation,
                GRAPHQL_SDL,
                'The schema this token’s workspace executes against, as SDL.',
                'text/plain'
            );
        }
    }
}
