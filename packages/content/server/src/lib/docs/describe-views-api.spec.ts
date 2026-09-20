import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import type { SerializedContentType } from '../registry/content-type-registry';
import { describeViewsApi } from './describe-views-api';

const article: SerializedContentType = {
    name: 'article',
    kind: 'collection',
    label: 'Articles',
    publishable: true,
    paranoid: true,
    i18n: false,
    fields: [
        {
            name: 'title',
            type: 'text',
            required: true,
            validation: {},
            admin: {}
        }
    ]
};

const settings: SerializedContentType = {
    ...article,
    name: 'site_settings',
    kind: 'single',
    label: 'Site settings',
    publishable: false,
    paranoid: false
};

/**
 * The document as `@nestjs/swagger` leaves it. The codes are the ones the live
 * controller emits: `201` on create, `200` on list and update, `204` on the
 * three routes that answer nothing.
 */
function scannedDocument(): OpenApiDocument {
    const ok = () => ({ responses: { '200': { description: '' } } });
    const noContent = () => ({ responses: { '204': { description: '' } } });
    return {
        paths: {
            '/api/views': {
                get: ok(),
                post: { responses: { '201': { description: '' } } }
            },
            '/api/views/{id}': { patch: ok(), delete: noContent() },
            '/api/views/{id}/default': {
                put: noContent(),
                delete: noContent()
            },
            // Another plugin's, and shaped so a loosened pattern would claim
            // it.
            '/api/insights/views': { get: ok() }
        }
    };
}

/** The schema of an operation's success response, if it has one. */
function successSchema(
    document: OpenApiDocument,
    route: string,
    method: string
): Record<string, unknown> | undefined {
    const operation = document.paths[route][method] as {
        responses: Record<
            string,
            { content?: Record<string, { schema: Record<string, unknown> }> }
        >;
    };
    const code = Object.keys(operation.responses).find((key) =>
        /^2\d\d$/.test(key)
    );
    return code
        ? operation.responses[code].content?.['application/json']?.schema
        : undefined;
}

describe('describeViewsApi', () => {
    it('answers a list with an array and the writes with one view', () => {
        const document = scannedDocument();
        describeViewsApi(document, [article]);

        expect(successSchema(document, '/api/views', 'get')).toEqual({
            type: 'array',
            items: { $ref: '#/components/schemas/SavedView' }
        });
        expect(successSchema(document, '/api/views', 'post')).toEqual({
            $ref: '#/components/schemas/SavedView'
        });
        expect(successSchema(document, '/api/views/{id}', 'patch')).toEqual({
            $ref: '#/components/schemas/SavedView'
        });
    });

    it('writes onto the 201 the create route answers, inventing no 200', () => {
        const document = scannedDocument();
        describeViewsApi(document, [article]);

        const create = document.paths['/api/views']['post'] as {
            responses: Record<string, unknown>;
        };
        expect(Object.keys(create.responses)).toEqual(['201']);
    });

    it('names no payload for any of the three 204 routes', () => {
        const document = scannedDocument();
        describeViewsApi(document, [article]);

        // This pins the route table, where all three are listed with a `null`
        // payload. The writer's own `204` guard is unreachable from here and is
        // pinned in `openapi-writer.spec.ts`.
        for (const [route, method] of [
            ['/api/views/{id}', 'delete'],
            ['/api/views/{id}/default', 'put'],
            ['/api/views/{id}/default', 'delete']
        ] as const) {
            const operation = document.paths[route][method] as {
                responses: Record<string, { content?: unknown }>;
            };
            expect(Object.keys(operation.responses)).toEqual(['204']);
            expect(operation.responses['204'].content).toBeUndefined();
        }
    });

    it('turns `scope` into the registered lists, not an opaque string', () => {
        const document = scannedDocument();
        describeViewsApi(document, [article, settings]);

        const view = document.components?.schemas?.['SavedView'] as {
            properties: { scope: { enum?: string[] } };
        };
        expect(view.properties.scope.enum).toEqual([
            'content:article',
            'content:site_settings'
        ]);
    });

    it('falls back to a plain string when nothing is registered', () => {
        const document = scannedDocument();
        describeViewsApi(document, []);

        // An empty `enum` is a schema nothing can satisfy — the same class of
        // defect as a `nullable` that does not widen one. A host with no
        // content types has no reachable views; it should not additionally have
        // a response schema that rejects every answer.
        const view = document.components?.schemas?.['SavedView'] as {
            properties: { scope: { type: string; enum?: string[] } };
        };
        expect(view.properties.scope.enum).toBeUndefined();
        expect(view.properties.scope.type).toBe('string');
    });

    it('touches no route it does not own', () => {
        const document = scannedDocument();
        describeViewsApi(document, [article]);

        expect(
            successSchema(document, '/api/insights/views', 'get')
        ).toBeUndefined();
    });
});
