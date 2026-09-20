/**
 * The transfer plugin's pass over the host's OpenAPI document.
 *
 * Five operations, and the scanner could describe none of them: three answer
 * framework-free `interface`s from `@orthacms/transfer-domain`, and two stream
 * a file through `@Res()`, which erases the return type entirely.
 *
 * Pure: takes the document and mutates only the five paths this plugin serves.
 *
 * The `typeName` path parameter is deliberately **not** touched here. These
 * routes are mounted under content's `/content/{typeName}` namespace and it is
 * content's registry that decides which names are valid, so
 * `@orthacms/content-server`'s own pass writes the enum onto them — see the
 * `FOREIGN` entries in its route table.
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
    buildTransferSchemas,
    exportDownloadContent,
    EXPORT_PREVIEW_SCHEMA,
    IMPORT_REPORT_SCHEMA
} from './transfer-schemas';

/** What one transfer route answers. */
type Payload =
    /** A JSON body described by a named schema. */
    | { kind: 'json'; schema: string; description: string }
    /** The export stream: several possible content types, one file. */
    | { kind: 'download' }
    /** The import template: one line of CSV. */
    | { kind: 'template' };

/**
 * The routes, keyed by what follows `/content/{typeName}`.
 *
 * Anchored suffixes rather than a prefix match. Content's own pass once matched
 * `/content/{typeName}` loosely enough to claim the `/v1/` spelling as well and
 * published thirteen operations with the wrong shapes; a table keyed on the
 * exact remainder cannot do that, and {@link TRANSFER_ROUTE_RE} anchors on
 * these five suffixes so nothing else is even considered.
 */
const TRANSFER_ROUTES: Record<string, Record<string, Payload>> = {
    '/export/preview': {
        post: {
            kind: 'json',
            schema: EXPORT_PREVIEW_SCHEMA,
            description:
                'Record, relation, file and byte counts for the export this body describes. Nothing is written and nothing is streamed.'
        }
    },
    '/export': { post: { kind: 'download' } },
    '/import/preview': {
        post: {
            kind: 'json',
            schema: IMPORT_REPORT_SCHEMA,
            description:
                'A per-record verdict for the uploaded document. **Nothing is written** — this is the dry run.'
        }
    },
    '/import': {
        post: {
            kind: 'json',
            schema: IMPORT_REPORT_SCHEMA,
            description:
                'What the run actually did, in the same shape the dry run reported. Applied in one transaction, through the ordinary entry writer — so an import cannot outrun validation, the workspace scope, or the caller’s own permissions.'
        }
    },
    '/import/template': { get: { kind: 'template' } }
};

/**
 * Matches `<prefix>/content/{typeName}<one of the five suffixes>`.
 *
 * `(?!.*\/v1\/)` refuses the published spelling outright. There is no public
 * transfer route today, and this is the assertion that a later one would have
 * to be described deliberately rather than inheriting these shapes by accident.
 */
const TRANSFER_ROUTE_RE =
    /^(?!.*\/v1\/).*\/content\/\{typeName\}(\/export(?:\/preview)?|\/import(?:\/preview|\/template)?)$/;

/** Headers both download routes set, worth documenting for a script. */
const DOWNLOAD_HEADERS: Record<string, unknown> = {
    'Content-Disposition': {
        description:
            'Always `attachment`, with a generated filename carrying the root type and a timestamp.',
        schema: { type: 'string' }
    },
    'X-Content-Type-Options': {
        description:
            'Always `nosniff` — nothing downstream may sniff a transfer file into something executable.',
        schema: { type: 'string', enum: ['nosniff'] }
    }
};

/** The export's extra header: how many records the file holds. */
const EXPORT_HEADERS: Record<string, unknown> = {
    ...DOWNLOAD_HEADERS,
    'X-Transfer-Records': {
        description:
            'How many records the file carries, roots and related together — useful to a script that never opens it, and to the admin’s success toast.',
        schema: { type: 'integer', minimum: 0 }
    }
};

/** Writes one route's success response. */
function describe(operation: Operation, payload: Payload): void {
    if (payload.kind === 'json') {
        setSuccessResponse(
            operation,
            { 'application/json': ref(payload.schema) },
            payload.description
        );
        return;
    }
    if (payload.kind === 'download') {
        setSuccessResponse(
            operation,
            exportDownloadContent(),
            'The export, streamed as a file download. Which content type it carries depends on the requested `format` — and a `csv` export that reaches more than one type is promoted to a ZIP of one CSV per type, because the format itself holds a single table.',
            EXPORT_HEADERS
        );
        return;
    }
    const csv: OpenApiSchema = {
        type: 'string',
        description:
            'A one-line CSV: the header row for this content type, in the order the importer expects.'
    };
    setSuccessResponse(
        operation,
        { 'text/csv': csv },
        'An empty CSV carrying this type’s column names.',
        DOWNLOAD_HEADERS
    );
}

/** Adds this plugin's schemas to `document` and describes its five operations. */
export function describeTransferApi(document: OpenApiDocument): void {
    document.components ??= {};
    document.components.schemas ??= {};
    Object.assign(document.components.schemas, buildTransferSchemas());

    for (const [route, item] of Object.entries(document.paths)) {
        const match = TRANSFER_ROUTE_RE.exec(route);
        if (!match) {
            continue;
        }
        const byMethod = TRANSFER_ROUTES[match[1]];
        if (!byMethod) {
            continue;
        }

        for (const [method, operation] of Object.entries(
            item as Record<string, Operation>
        )) {
            const payload = byMethod[method];
            if (!payload || !operation || typeof operation !== 'object') {
                continue;
            }
            describe(operation, payload);
            // Every route resolves `:typeName` through the content registry and
            // throws `NotFoundException` when it is unknown — and
            // `ContentGrantGuard` has already answered the same 404 for a type
            // this workspace was not granted, so neither can be used to learn
            // which types exist elsewhere.
            addErrorResponse(
                operation,
                '404',
                'Unknown content type, or one this workspace was not granted.'
            );
        }
    }
}
