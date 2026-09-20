/**
 * The content plugin's pass over the host's OpenAPI document.
 *
 * `@nestjs/swagger` reflects static TypeScript, and this plugin's contract is
 * runtime data: one generic controller set serves **every** code-defined
 * content type, so the scanner sees `/content/{typeName}` with an opaque string
 * param and no response shape at all. This pass fills both gaps from the
 * registry — the real type names as an enum, and a typed entry/list schema per
 * type — so a reader of the reference sees `article` and `home_page`, not
 * "some object".
 *
 * Pure: it takes the document and the serialized types, and mutates only the
 * paths this plugin owns.
 *
 * Two surfaces, described separately. `/api/content/...` is the admin's and
 * `/api/v1/content/...` is the published one, and they answer in different
 * shapes where their spellings agree — a public relation preview carries whole
 * entries, the admin's carries refs. Describing both from one table is not a
 * shortcut but a bug, and was one: the public routes were reported with the
 * admin's schemas until {@link PUBLIC_ENTRY_ROUTES} existed.
 */

import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import type { SerializedContentType } from '../registry/content-type-registry';
import type { OpenApiSchema } from './field-schema';
import { buildContentSchemas, ref, schemaNamesOf } from './content-schemas';
import {
    buildPublicApiSchemas,
    publicSchemaNamesOf,
    publicUnionOf
} from './public-api-schemas';
import {
    addErrorResponse,
    setSuccessResponse,
    type Operation
} from './openapi-writer';

/** Which schema a content route's success response carries. */
type ResponseKind =
    | { kind: 'entry' }
    | { kind: 'listPage' }
    | { kind: 'schema'; name: string }
    | { kind: 'empty' };

/** What one operation returns, and whether it can fail field validation. */
interface OperationSpec {
    response: ResponseKind;
    /**
     * The operation runs the values through `EntryValidationService`, so it can
     * answer **422** with per-field issues. Per operation, not per route: a
     * `GET` on the same path validates nothing.
     */
    validated?: boolean;
    /**
     * The route is mounted under this plugin's `{typeName}` namespace by
     * **another** plugin. See {@link FOREIGN}.
     */
    ownedElsewhere?: boolean;
}

/** The entry read/write shorthands, since most operations return one. */
const ENTRY: OperationSpec = { response: { kind: 'entry' } };
const VALIDATED_ENTRY: OperationSpec = {
    response: { kind: 'entry' },
    validated: true
};
const EMPTY: OperationSpec = { response: { kind: 'empty' } };

/**
 * A route another plugin mounts under one of this plugin's `{typeName}`
 * prefixes — transfer's export/import, segments' `/access`.
 *
 * Listed so the `typeName` parameter still gets the registered-name enum: which
 * names are valid there is *this* plugin's contract, and the registry is the
 * only thing that knows them, so leaving the parameter an opaque string would
 * be leaving a gap nothing else can fill.
 *
 * Nothing else is touched. The response body and the failure codes belong to
 * whichever plugin serves the route, and they genuinely differ — transfer 404s
 * an unknown type, the public `/access` route answers 400 — so writing this
 * plugin's usual 404 onto them from here would publish something the API does
 * not do.
 */
const FOREIGN: OperationSpec = {
    response: { kind: 'empty' },
    ownedElsewhere: true
};

/** An operation returning one of the fixed shared schemas. */
function shared(name: string): OperationSpec {
    return { response: { kind: 'schema', name } };
}

/** Entry routes, keyed by what follows `/content/{typeName}`. */
const ENTRY_ROUTES: Record<string, Record<string, OperationSpec>> = {
    '': { get: { response: { kind: 'listPage' } }, post: VALIDATED_ENTRY },
    '/{id}': { get: ENTRY, patch: VALIDATED_ENTRY, delete: EMPTY },
    '/{id}/media': { get: shared('EntryMedia') },
    '/{id}/relations': { get: shared('EntryRelations') },
    '/{id}/relations/{field}': { get: shared('RelationFieldPage') },
    '/{id}/publish': { post: VALIDATED_ENTRY },
    '/{id}/unpublish': { post: ENTRY },
    '/{id}/restore': { post: ENTRY },
    '/{id}/permanent': { delete: EMPTY },
    '/{id}/revisions': { get: shared('RevisionList') },
    '/{id}/revisions/{number}': { get: shared('RevisionDetail') },
    '/{id}/revisions/{number}/restore': { post: VALIDATED_ENTRY },
    '/{id}/revisions/{number}/publish': { post: VALIDATED_ENTRY },
    '/bulk': { post: shared('BulkSaveResult') },
    '/bulk/publish/preview': { post: shared('BulkPublishPreview') },
    '/bulk/publish': {
        post: { response: { kind: 'schema', name: 'BulkPublishResult' } }
    },
    '/bulk/unpublish': { post: shared('BulkActionResult') },
    '/bulk/delete': { post: shared('BulkActionResult') },
    '/bulk/restore': { post: shared('BulkActionResult') },
    '/bulk/purge': { post: shared('BulkActionResult') },
    // Mounted here by `@orthacms/transfer-server`, which describes their
    // bodies; see {@link FOREIGN}.
    '/export': { post: FOREIGN },
    '/export/preview': { post: FOREIGN },
    '/import': { post: FOREIGN },
    '/import/preview': { post: FOREIGN },
    '/import/template': { get: FOREIGN }
};

/** Schema routes, keyed by what follows `/content-schema`. */
const SCHEMA_ROUTES: Record<string, Record<string, OperationSpec>> = {
    '': { get: shared('ContentTypeSummaryList') },
    '/{name}': { get: shared('ContentTypeSchema') },
    '/{name}/filter-fields': { get: shared('FilterFields') }
};

/**
 * Public entry routes, keyed by what follows `/v1/content/{typeName}`.
 *
 * A separate table from {@link ENTRY_ROUTES} rather than an extension of it,
 * because the two surfaces answer in **different shapes** on the paths they
 * spell the same way: a public relation page carries whole entries where the
 * admin's carries `RelationRef`s, and a public media read is keyed to
 * `{ items, total }` where the admin's is keyed to a bare array. One table
 * matching both spellings is what put the admin's answer on the public routes
 * in the first place.
 *
 * Every read exists twice — once under `/{id}`, once under
 * `/group/{localeGroupId}` — because a localized front-end carries the stable
 * group id and a `?locale=`, not a per-locale id map. The two spellings funnel
 * into one handler, so they are listed with one shape apiece and cannot drift.
 */
const PUBLIC_ENTRY_ROUTES: Record<string, Record<string, OperationSpec>> = {
    '': { get: { response: { kind: 'listPage' } }, post: VALIDATED_ENTRY },
    '/{id}': { get: ENTRY, patch: VALIDATED_ENTRY, delete: EMPTY },
    '/{id}/media': { get: shared('PublicEntryMedia') },
    '/{id}/relations/{field}': { get: shared('PublicRelationFieldPage') },
    '/{id}/translations': { get: shared('PublicEntryTranslations') },
    '/{id}/publish': { post: VALIDATED_ENTRY },
    '/{id}/unpublish': { post: ENTRY },
    '/group/{localeGroupId}': {
        get: ENTRY,
        patch: VALIDATED_ENTRY,
        delete: EMPTY
    },
    '/group/{localeGroupId}/media': { get: shared('PublicEntryMedia') },
    '/group/{localeGroupId}/relations/{field}': {
        get: shared('PublicRelationFieldPage')
    },
    '/group/{localeGroupId}/translations': {
        get: shared('PublicEntryTranslations')
    },
    '/group/{localeGroupId}/publish': { post: VALIDATED_ENTRY },
    '/group/{localeGroupId}/unpublish': { post: ENTRY },
    '/bulk': { post: shared('PublicBulkSaveResult') },
    // The batch publish/unpublish/delete run the very same use-cases the
    // admin's do, so they answer in the admin's shapes — deliberately, and
    // documented as such in `types/public-bulk.ts`.
    '/bulk/publish': { post: shared('BulkPublishResult') },
    '/bulk/unpublish': { post: shared('BulkActionResult') },
    '/bulk/delete': { post: shared('BulkActionResult') },
    // Mounted here by `@orthacms/segments-server`, which describes its bodies;
    // see {@link FOREIGN}.
    '/{id}/access': { get: FOREIGN, put: FOREIGN }
};

/** Public discovery routes, keyed by what follows `/v1/content-types`. */
const PUBLIC_TYPES_ROUTES: Record<string, Record<string, OperationSpec>> = {
    '': { get: shared('PublicContentTypeList') },
    '/{name}': { get: shared('ContentTypeSchema') }
};

/**
 * One family of routes and the schemas its success responses take.
 *
 * The admin and the public API are two surfaces over the same content types,
 * spelled almost identically in the document — and they do **not** answer in
 * the same shapes. Pairing each route table with its own unions is what keeps
 * one from being described with the other's schemas.
 */
interface Surface {
    /** The route table, keyed by what follows the surface's prefix. */
    routes: Record<string, Record<string, OperationSpec>>;
    /** Schema for one entry, when this surface serves entries. */
    entryUnion?: OpenApiSchema;
    /** Schema for one page of them. */
    listUnion?: OpenApiSchema;
    /**
     * Whether the routes carry a `typeName` path parameter — and so want the
     * registered-name enum and the shared 404. The discovery routes do not.
     */
    typed: boolean;
}

/** Matches `<prefix>/v1/content/{typeName}<rest>`. */
const PUBLIC_ENTRY_ROUTE_RE = /\/v1\/content\/\{typeName\}(.*)$/;
/** Matches `<prefix>/v1/content-types<rest>`. */
const PUBLIC_TYPES_ROUTE_RE = /\/v1\/content-types(.*)$/;
/**
 * Matches `<prefix>/content/{typeName}<rest>`.
 *
 * It matches the `/v1/` spelling too, which is why the public patterns are
 * tried **first** and win: this pattern silently claiming the public routes is
 * exactly how the admin's schemas ended up on the published contract.
 */
const ENTRY_ROUTE_RE = /\/content\/\{typeName\}(.*)$/;
/** Matches `<prefix>/content-schema<rest>`. */
const SCHEMA_ROUTE_RE = /\/content-schema(.*)$/;

/**
 * Constrains the `typeName` path param to the registered type names.
 *
 * The note about what an unknown name answers is only added for this plugin's
 * own routes: on a {@link FOREIGN} one the owning plugin decides, and two of
 * them do not agree with each other, let alone with this one.
 */
function describeTypeNameParam(
    operation: Operation,
    typeNames: string[],
    ownedElsewhere = false
): void {
    const parameter = operation.parameters?.find(
        (candidate) => candidate.name === 'typeName' && candidate.in === 'path'
    );
    if (!parameter) {
        return;
    }
    parameter.schema = { type: 'string', enum: typeNames };
    parameter.description = ownedElsewhere
        ? 'Machine name of the content type, resolved through the same registry the content routes use.'
        : 'Machine name of the content type. Unknown (or not granted to the workspace) is a 404.';
}

/**
 * The per-type schemas as alternatives — the response shape depends on
 * `typeName`, which OpenAPI cannot express as a dependency, so they are listed.
 * A single registered type needs no union.
 *
 * `anyOf`, **not** `oneOf`: the alternatives are not mutually exclusive. Two
 * content types with compatible envelopes both validate the same page (an empty
 * `items` array matches every list schema there is), and `oneOf` means *exactly
 * one*, so the honest-looking operator turns a correct response into a
 * validation failure. Measured: `GET /api/v1/content/home_page` matched two
 * branches and was therefore rejected by its own document.
 */
function unionOf(names: string[]): OpenApiSchema {
    return names.length === 1
        ? ref(names[0])
        : { anyOf: names.map((name) => ref(name)) };
}

/**
 * Adds this plugin's schemas to `document` and describes its own operations:
 * the `typeName` enum, per-type response schemas, and the documented failures.
 */
export function describeContentApi(
    document: OpenApiDocument,
    types: readonly SerializedContentType[]
): void {
    document.components ??= {};
    document.components.schemas ??= {};
    Object.assign(document.components.schemas, buildContentSchemas(types));
    Object.assign(document.components.schemas, buildPublicApiSchemas(types));

    const typeNames = types.map((type) => type.name);

    /** The admin surface's per-type unions. */
    const admin: Surface = {
        routes: ENTRY_ROUTES,
        entryUnion: unionOf(types.map((type) => schemaNamesOf(type).entry)),
        listUnion: unionOf(types.map((type) => schemaNamesOf(type).listPage)),
        typed: true
    };
    /** The public surface's, which are a different set of schemas entirely. */
    const publicEntries: Surface = {
        routes: PUBLIC_ENTRY_ROUTES,
        entryUnion: publicUnionOf(
            types.map((type) => publicSchemaNamesOf(type).entry)
        ),
        listUnion: publicUnionOf(
            types.map((type) => publicSchemaNamesOf(type).listPage)
        ),
        typed: true
    };
    const adminSchema: Surface = { routes: SCHEMA_ROUTES, typed: false };
    const publicSchema: Surface = { routes: PUBLIC_TYPES_ROUTES, typed: false };

    // Order matters: the public patterns are tried first because
    // `ENTRY_ROUTE_RE` also matches the `/v1/` spelling, and letting it win
    // there is what used to write the admin's relation and media shapes onto
    // the published contract.
    const surfaces: [RegExp, Surface][] = [
        [PUBLIC_ENTRY_ROUTE_RE, publicEntries],
        [PUBLIC_TYPES_ROUTE_RE, publicSchema],
        [ENTRY_ROUTE_RE, admin],
        [SCHEMA_ROUTE_RE, adminSchema]
    ];

    for (const [route, item] of Object.entries(document.paths)) {
        let rest: string | undefined;
        let surface: Surface | undefined;
        for (const [pattern, candidate] of surfaces) {
            const match = pattern.exec(route);
            if (match) {
                rest = match[1];
                surface = candidate;
                break;
            }
        }
        if (rest === undefined || !surface) {
            continue;
        }
        const byMethod = surface.routes[rest];
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

            if (surface.typed) {
                describeTypeNameParam(
                    operation,
                    typeNames,
                    spec.ownedElsewhere
                );
            }
            if (spec.ownedElsewhere) {
                continue;
            }

            if (surface.typed) {
                addErrorResponse(
                    operation,
                    '404',
                    'Unknown content type, or no entry with this id in the workspace.'
                );
                if (spec.validated) {
                    addErrorResponse(
                        operation,
                        '422',
                        'The values failed the content type’s field validation.',
                        {
                            type: 'object',
                            properties: {
                                message: { type: 'string' },
                                issues: {
                                    type: 'array',
                                    items: ref('ValidationIssue')
                                }
                            },
                            required: ['message', 'issues']
                        }
                    );
                }
            }

            // With no registered types there is no entry shape to describe —
            // and every one of these routes 404s anyway.
            const { response } = spec;
            if (
                response.kind === 'entry' &&
                typeNames.length &&
                surface.entryUnion
            ) {
                setSuccessResponse(operation, surface.entryUnion, 'The entry.');
            } else if (
                response.kind === 'listPage' &&
                typeNames.length &&
                surface.listUnion
            ) {
                setSuccessResponse(
                    operation,
                    surface.listUnion,
                    'One page of entries.'
                );
            } else if (response.kind === 'schema') {
                setSuccessResponse(operation, ref(response.name), 'OK.');
            }
        }
    }
}
