import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import { IMPORT_REASON } from '@orthacms/transfer-domain';
import { describeTransferApi } from './describe-transfer-api';

/**
 * The document as `@nestjs/swagger` leaves it. Every transfer route carries an
 * explicit `@HttpCode(HttpStatus.OK)`, so the key is `200` even on the `POST`s
 * — writing onto a fabricated `201` is one of the two failures these tests are
 * here to catch.
 */
function scannedDocument(): OpenApiDocument {
    const ok = () => ({ responses: { '200': { description: '' } } });
    return {
        paths: {
            '/api/content/{typeName}/export/preview': { post: ok() },
            '/api/content/{typeName}/export': { post: ok() },
            '/api/content/{typeName}/import/preview': { post: ok() },
            '/api/content/{typeName}/import': { post: ok() },
            '/api/content/{typeName}/import/template': { get: ok() },
            // Not this plugin's. The `/v1/` one is the shape that would be
            // claimed by a prefix match — the exact mistake that published
            // thirteen public content operations with the admin's schemas.
            '/api/v1/content/{typeName}/export': { post: ok() },
            '/api/content/{typeName}/{id}': { get: ok() },
            '/api/content/{typeName}/bulk/delete': { post: ok() }
        }
    };
}

/** An operation's 2xx response, whatever media types it carries. */
function success(
    document: OpenApiDocument,
    route: string,
    method: string
): { content?: Record<string, { schema: Record<string, unknown> }> } {
    const operation = document.paths[route][method] as {
        responses: Record<
            string,
            { content?: Record<string, { schema: Record<string, unknown> }> }
        >;
    };
    const code = Object.keys(operation.responses).find((key) =>
        /^2\d\d$/.test(key)
    );
    return code ? operation.responses[code] : {};
}

describe('describeTransferApi', () => {
    it('describes the two JSON routes and the preview with named schemas', () => {
        const document = scannedDocument();
        describeTransferApi(document);

        expect(
            success(document, '/api/content/{typeName}/export/preview', 'post')
                .content?.['application/json'].schema
        ).toEqual({ $ref: '#/components/schemas/TransferExportPreview' });
        expect(
            success(document, '/api/content/{typeName}/import/preview', 'post')
                .content?.['application/json'].schema
        ).toEqual({ $ref: '#/components/schemas/TransferImportReport' });
    });

    it('gives the apply route the same shape as the dry run', () => {
        const document = scannedDocument();
        describeTransferApi(document);

        // The apply handler's declared return type is the narrower
        // `ImportResult`, but both routes return what the one pipeline
        // produces, so `version` and `hasChanges` are on the wire either way —
        // measured against a live server. Describing the type instead of the
        // API would drop two fields a consumer can rely on.
        const report = document.components?.schemas?.[
            'TransferImportReport'
        ] as { required: string[] };
        expect(report.required).toEqual([
            'version',
            'counts',
            'verdicts',
            'hasChanges'
        ]);
        expect(
            success(document, '/api/content/{typeName}/import', 'post')
                .content?.['application/json'].schema
        ).toEqual({ $ref: '#/components/schemas/TransferImportReport' });
    });

    it('offers the export as a ZIP as well, because a CSV of two types is one', () => {
        const document = scannedDocument();
        describeTransferApi(document);

        const types = Object.keys(
            success(document, '/api/content/{typeName}/export', 'post')
                .content ?? {}
        );
        // Measured: the same `format: "csv"` request answers `text/csv` with
        // relations off and `application/zip` with them on, because the format
        // holds one table and a multi-type export is a ZIP of CSVs. A response
        // describing only the four formats' "own" content types would be wrong
        // for every export that reaches a relation.
        expect(types).toContain('application/zip');
        expect(types).toContain('text/csv');
        expect(types).toContain('application/x-ndjson');
        expect(types).toContain('application/json');
    });

    it('derives the verdict reasons from the domain, not from a retyped list', () => {
        const document = scannedDocument();
        describeTransferApi(document);

        const verdict = document.components?.schemas?.[
            'TransferImportVerdict'
        ] as { properties: { reason: { enum: string[] } } };
        expect(verdict.properties.reason.enum).toEqual(
            Object.values(IMPORT_REASON)
        );
    });

    it('documents the record count the download carries in a header', () => {
        const document = scannedDocument();
        describeTransferApi(document);

        // The only way a script that never opens the file learns how much it
        // got.
        const headers = (
            success(document, '/api/content/{typeName}/export', 'post') as {
                headers?: Record<string, unknown>;
            }
        ).headers;
        expect(Object.keys(headers ?? {})).toContain('X-Transfer-Records');
    });

    it('serves the template as CSV, not as JSON', () => {
        const document = scannedDocument();
        describeTransferApi(document);

        expect(
            Object.keys(
                success(
                    document,
                    '/api/content/{typeName}/import/template',
                    'get'
                ).content ?? {}
            )
        ).toEqual(['text/csv']);
    });

    it('refuses the `/v1/` spelling and every route it does not own', () => {
        const document = scannedDocument();
        describeTransferApi(document);

        expect(
            success(document, '/api/v1/content/{typeName}/export', 'post')
                .content
        ).toBeUndefined();
        expect(
            success(document, '/api/content/{typeName}/{id}', 'get').content
        ).toBeUndefined();
        expect(
            success(document, '/api/content/{typeName}/bulk/delete', 'post')
                .content
        ).toBeUndefined();
    });

    it('leaves the `typeName` parameter to the plugin that owns the registry', () => {
        const document = scannedDocument();
        describeTransferApi(document);

        // Content's pass writes the registered-name enum onto these routes; a
        // second writer here would be a second place to keep in step, and this
        // plugin cannot see the registry at decorate time anyway.
        const operation = document.paths['/api/content/{typeName}/export'][
            'post'
        ] as { parameters?: unknown };
        expect(operation.parameters).toBeUndefined();
    });
});
