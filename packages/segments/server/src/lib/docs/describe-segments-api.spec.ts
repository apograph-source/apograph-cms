import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import { describeSegmentsApi } from './describe-segments-api';

/**
 * The document as `@nestjs/swagger` leaves it — every 2xx key present and
 * empty, which is the state this pass exists to fill. The status codes are the
 * ones the live server emits (`201` only on `POST /api/segments`, `204` on the
 * delete), because writing onto the wrong key is the failure mode these tests
 * are here to catch.
 */
function scannedDocument(): OpenApiDocument {
    const ok = () => ({ responses: { '200': { description: '' } } });
    return {
        paths: {
            '/api/segments': {
                get: ok(),
                post: { responses: { '201': { description: '' } } }
            },
            '/api/segments/lookup': { get: ok() },
            '/api/segments/{id}': {
                get: ok(),
                patch: ok(),
                delete: { responses: { '204': { description: '' } } }
            },
            '/api/segments/entries/{entryId}': { get: ok(), put: ok() },
            '/api/v1/content/{typeName}/{id}/access': { get: ok(), put: ok() },
            // Neither of these belongs to this plugin. They are here so a
            // loosened route pattern shows up as a failure rather than as a
            // silently mis-described operation somewhere else in the document.
            '/api/insights/segments/usage': { get: ok() },
            '/api/insights/segments': { get: ok() },
            '/api/content/{typeName}/{id}': { get: ok() }
        }
    };
}

/** The `$ref` an operation's success response carries, if any. */
function successRef(
    document: OpenApiDocument,
    route: string,
    method: string
): string | undefined {
    const operation = document.paths[route][method] as {
        responses: Record<
            string,
            { content?: Record<string, { schema: { $ref?: string } }> }
        >;
    };
    const code = Object.keys(operation.responses).find((key) =>
        /^2\d\d$/.test(key)
    );
    return code
        ? operation.responses[code].content?.['application/json']?.schema.$ref
        : undefined;
}

/** Every 2xx key an operation carries, so a fabricated one is visible. */
function successCodes(
    document: OpenApiDocument,
    route: string,
    method: string
): string[] {
    const operation = document.paths[route][method] as {
        responses: Record<string, unknown>;
    };
    return Object.keys(operation.responses).filter((key) =>
        /^2\d\d$/.test(key)
    );
}

describe('describeSegmentsApi', () => {
    it('describes the directory page, the single segment and the lookup array', () => {
        const document = scannedDocument();
        describeSegmentsApi(document);

        expect(successRef(document, '/api/segments', 'get')).toBe(
            '#/components/schemas/SegmentPage'
        );
        expect(successRef(document, '/api/segments/{id}', 'get')).toBe(
            '#/components/schemas/Segment'
        );

        const lookup = document.paths['/api/segments/lookup']['get'] as {
            responses: Record<
                string,
                {
                    content: Record<
                        string,
                        { schema: { type: string; items: { $ref: string } } }
                    >;
                }
            >;
        };
        const schema =
            lookup.responses['200'].content['application/json'].schema;
        expect(schema.type).toBe('array');
        expect(schema.items.$ref).toBe('#/components/schemas/Segment');
    });

    it('writes onto the 201 the create route actually answers, inventing no 200', () => {
        const document = scannedDocument();
        describeSegmentsApi(document);

        expect(successCodes(document, '/api/segments', 'post')).toEqual([
            '201'
        ]);
        expect(successRef(document, '/api/segments', 'post')).toBe(
            '#/components/schemas/Segment'
        );
    });

    it('names no payload for the 204 delete', () => {
        const document = scannedDocument();
        describeSegmentsApi(document);

        // This pins the route table, not the writer: the delete is simply
        // absent from it. The writer's own `204` guard is unreachable from
        // here — deleting it leaves this green — and is pinned in
        // `openapi-writer.spec.ts` instead.
        const remove = document.paths['/api/segments/{id}']['delete'] as {
            responses: Record<string, { content?: unknown }>;
        };
        expect(Object.keys(remove.responses)).toEqual(['204']);
        expect(remove.responses['204'].content).toBeUndefined();
    });

    it('keeps the two access surfaces apart — they do not answer alike', () => {
        const document = scannedDocument();
        describeSegmentsApi(document);

        // The admin's route answers two lists; the public one adds the entry id
        // and a derived `restricted` flag. Describing both from one table is the
        // bug that put the admin's schemas on thirteen public content
        // operations, and this is the assertion that would catch it here.
        expect(
            successRef(document, '/api/segments/entries/{entryId}', 'get')
        ).toBe('#/components/schemas/EntryAccess');
        expect(
            successRef(
                document,
                '/api/v1/content/{typeName}/{id}/access',
                'get'
            )
        ).toBe('#/components/schemas/PublicEntryAccess');
        expect(
            successRef(
                document,
                '/api/v1/content/{typeName}/{id}/access',
                'put'
            )
        ).toBe('#/components/schemas/PublicEntryAccess');
    });

    it('documents the public access route’s 400, which is not the content routes’ 404', () => {
        const document = scannedDocument();
        describeSegmentsApi(document);

        const operation = document.paths[
            '/api/v1/content/{typeName}/{id}/access'
        ]['get'] as { responses: Record<string, { description: string }> };
        expect(Object.keys(operation.responses)).toContain('400');
        expect(Object.keys(operation.responses)).not.toContain('404');
    });

    it('touches no route it does not own', () => {
        const document = scannedDocument();
        describeSegmentsApi(document);

        expect(
            successRef(document, '/api/insights/segments/usage', 'get')
        ).toBeUndefined();
        // The one a suffix match would claim: same last segment, another
        // plugin's route.
        expect(
            successRef(document, '/api/insights/segments', 'get')
        ).toBeUndefined();
        expect(
            successRef(document, '/api/content/{typeName}/{id}', 'get')
        ).toBeUndefined();
    });

    it('says an empty allow list means everyone, where a reader will look', () => {
        const document = scannedDocument();
        describeSegmentsApi(document);

        // The single most misreadable thing about the feature: empty means
        // *everyone*, not nobody. If it is only in the prose of the controller
        // it is not in the published contract.
        const access = document.components?.schemas?.['PublicEntryAccess'] as {
            properties: { allow: { description: string } };
        };
        expect(access.properties.allow.description).toMatch(/everyone/i);
    });
});
