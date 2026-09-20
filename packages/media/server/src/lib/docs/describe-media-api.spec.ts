import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import { describeMediaApi } from './describe-media-api';

/** One operation, as `@nestjs/swagger` leaves it: a 2xx key with no content. */
function scanned(code: string): Record<string, unknown> {
    return { responses: { [code]: { description: '' } } };
}

/** The document shape the scanner produces before this pass runs. */
function scannedDocument(): OpenApiDocument {
    return {
        paths: {
            '/api/media/folders': { get: scanned('200'), post: scanned('201') },
            '/api/media/folders/{id}': {
                patch: scanned('200'),
                delete: scanned('204')
            },
            '/api/media/assets': {
                post: scanned('201'),
                get: scanned('200'),
                delete: scanned('200')
            },
            '/api/media/assets/{id}': { patch: scanned('200') },
            '/api/media/assets/{id}/raw': { get: scanned('200') },
            '/api/media/assets/{id}/duplicate': { post: scanned('201') },
            '/api/v1/media/assets': { post: scanned('201') },
            '/api/v1/media/assets/{id}/raw': { get: scanned('200') },
            // Not this plugin's routes, however much they look like them.
            '/api/insights/media/storage': { get: scanned('200') },
            '/api/insights/media/uploads': { get: scanned('200') },
            '/api/content/{typeName}/{id}/media': { get: scanned('200') }
        }
    };
}

/** The success response's `content` object, if the pass wrote one. */
function successContent(
    document: OpenApiDocument,
    route: string,
    method: string
): Record<string, { schema: Record<string, unknown> }> | undefined {
    const operation = document.paths[route][method] as {
        responses: Record<
            string,
            { content?: Record<string, { schema: Record<string, unknown> }> }
        >;
    };
    const key = Object.keys(operation.responses).find((code) =>
        /^2\d\d$/.test(code)
    );
    return key ? operation.responses[key].content : undefined;
}

describe('describeMediaApi', () => {
    it('describes every operation that has a body, and none that has not', () => {
        const document = scannedDocument();
        describeMediaApi(document);

        const described: string[] = [];
        for (const [route, item] of Object.entries(document.paths)) {
            for (const method of Object.keys(item)) {
                if (successContent(document, route, method)) {
                    described.push(`${method} ${route}`);
                }
            }
        }
        expect(described.sort()).toEqual(
            [
                'delete /api/media/assets',
                'get /api/media/assets',
                'get /api/media/assets/{id}/raw',
                'get /api/media/folders',
                'get /api/v1/media/assets/{id}/raw',
                'patch /api/media/assets/{id}',
                'patch /api/media/folders/{id}',
                'post /api/media/assets',
                'post /api/media/assets/{id}/duplicate',
                'post /api/media/folders',
                'post /api/v1/media/assets'
            ].sort()
        );
    });

    it('leaves the folder delete at a bare 204', () => {
        const document = scannedDocument();
        describeMediaApi(document);

        expect(document.paths['/api/media/folders/{id}'].delete).toEqual({
            responses: { '204': { description: '' } }
        });
    });

    it('describes the raw routes as bytes, not JSON', () => {
        const document = scannedDocument();
        describeMediaApi(document);

        for (const route of [
            '/api/media/assets/{id}/raw',
            '/api/v1/media/assets/{id}/raw'
        ]) {
            const content = successContent(document, route, 'get');
            // A wildcard media type, because the Content-Type is the asset's
            // own stored MIME type — per row, and not enumerable here.
            expect(Object.keys(content ?? {})).toEqual(['*/*']);
            expect(content?.['*/*'].schema).toEqual({
                type: 'string',
                format: 'binary'
            });
            expect(content?.['application/json']).toBeUndefined();
        }
    });

    it('does not claim a route that merely has "media" in its path', () => {
        const document = scannedDocument();
        describeMediaApi(document);

        // `/insights/media/...` is another plugin's page and
        // `/content/{typeName}/{id}/media` is content's per-entry read. A
        // pattern loose enough to match either is the bug that put the admin's
        // schemas onto the published content contract.
        for (const route of [
            '/api/insights/media/storage',
            '/api/insights/media/uploads',
            '/api/content/{typeName}/{id}/media'
        ]) {
            expect(successContent(document, route, 'get')).toBeUndefined();
        }
    });

    it('describes the folders listing as {folders, rootAssetCount}', () => {
        const document = scannedDocument();
        describeMediaApi(document);

        const schemas = document.components?.schemas as Record<
            string,
            { required?: string[] }
        >;
        // Measured against the running API. The admin's own mock had this as
        // `{ items }` for months, so the type name is not the evidence.
        expect(schemas['MediaFolderTree'].required).toEqual([
            'folders',
            'rootAssetCount'
        ]);
    });

    it('gives the public upload its own entry rather than reusing the admin table', () => {
        // A pattern that matches both spellings must not describe the `/v1/`
        // one from the admin table; only the routes the public surface
        // actually serves are described.
        const document: OpenApiDocument = {
            paths: {
                '/api/v1/media/folders': { get: scanned('200') },
                '/api/v1/media/assets': { post: scanned('201') }
            }
        };
        describeMediaApi(document);

        expect(
            successContent(document, '/api/v1/media/folders', 'get')
        ).toBeUndefined();
        expect(
            successContent(document, '/api/v1/media/assets', 'post')
        ).toBeDefined();
    });

    it('writes onto the status code the scanner emitted, never a new one', () => {
        const document = scannedDocument();
        describeMediaApi(document);

        const duplicate = document.paths['/api/media/assets/{id}/duplicate']
            .post as { responses: Record<string, unknown> };
        expect(Object.keys(duplicate.responses).sort()).toEqual(['201', '404']);
        expect(duplicate.responses['200']).toBeUndefined();
    });
});
