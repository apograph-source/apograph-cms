import type { OpenApiDocument } from '@ortha/bootstrap-server';
import { describeWorkspacesApi } from './describe-workspaces-api';

/** One operation, as `@nestjs/swagger` leaves it: a 2xx key with no content. */
function scanned(code: string): Record<string, unknown> {
    return { responses: { [code]: { description: '' } } };
}

/** The document shape the scanner produces before this pass runs. */
function scannedDocument(): OpenApiDocument {
    return {
        paths: {
            '/api/workspaces': { post: scanned('201'), get: scanned('200') },
            '/api/workspaces/slug-available': { get: scanned('200') },
            '/api/workspaces/{id}': {
                patch: scanned('200'),
                delete: scanned('204')
            },
            '/api/workspaces/{id}/archive': { post: scanned('201') },
            '/api/workspaces/{id}/unarchive': { post: scanned('201') },
            '/api/workspaces/{id}/members': { post: scanned('201') },
            '/api/workspaces/{id}/members/{userId}': { delete: scanned('204') },
            '/api/workspaces/{id}/content': { post: scanned('201') },
            '/api/workspaces/{id}/content/{slug}': { delete: scanned('200') },
            '/api/workspaces/{id}/content/{slug}/entry-count': {
                get: scanned('200')
            },
            '/api/workspaces/{id}/entry-count': { get: scanned('200') }
        }
    };
}

/** The JSON schema attached to an operation's success response, if any. */
function successSchema(
    document: OpenApiDocument,
    route: string,
    method: string
): unknown {
    const operation = document.paths[route][method] as {
        responses: Record<
            string,
            { content?: Record<string, { schema: unknown }> }
        >;
    };
    const key = Object.keys(operation.responses).find((code) =>
        /^2\d\d$/.test(code)
    );
    return key
        ? operation.responses[key].content?.['application/json']?.schema
        : undefined;
}

describe('describeWorkspacesApi', () => {
    it('describes every operation that has a body, and none that has not', () => {
        const document = scannedDocument();
        describeWorkspacesApi(document);

        const described: string[] = [];
        const bare: string[] = [];
        for (const [route, item] of Object.entries(document.paths)) {
            for (const method of Object.keys(item)) {
                const target = successSchema(document, route, method)
                    ? described
                    : bare;
                target.push(`${method} ${route}`);
            }
        }
        expect(described).toHaveLength(11);
        // The two deletes answer 204; a body would be a lie, not an omission.
        expect(bare).toEqual([
            'delete /api/workspaces/{id}',
            'delete /api/workspaces/{id}/members/{userId}'
        ]);
    });

    it('writes onto the status code the scanner emitted, never a new one', () => {
        const document = scannedDocument();
        describeWorkspacesApi(document);

        const create = document.paths['/api/workspaces'].post as {
            responses: Record<string, unknown>;
        };
        expect(Object.keys(create.responses).sort()).toEqual(['201', '409']);
        expect(create.responses['200']).toBeUndefined();
    });

    it('leaves a 204 alone rather than inventing a payload for it', () => {
        const document = scannedDocument();
        describeWorkspacesApi(document);

        expect(document.paths['/api/workspaces/{id}'].delete).toEqual({
            responses: { '204': { description: '' } }
        });
    });

    it('answers the id-scoped routes with 403, not 404', () => {
        const document = scannedDocument();
        describeWorkspacesApi(document);

        // `WorkspaceMemberGuard` gives the same 403 for a workspace the caller
        // is not in and for one that does not exist. Documenting a 404 would
        // describe an existence probe the API deliberately refuses to offer.
        const patch = document.paths['/api/workspaces/{id}'].patch as {
            responses: Record<string, unknown>;
        };
        expect(patch.responses['403']).toBeDefined();
        expect(patch.responses['404']).toBeUndefined();

        const list = document.paths['/api/workspaces'].get as {
            responses: Record<string, unknown>;
        };
        expect(list.responses['403']).toBeUndefined();
    });

    it('constrains colour and status to the values the aggregate accepts', () => {
        const document = scannedDocument();
        describeWorkspacesApi(document);

        const workspace = (
            document.components?.schemas as Record<
                string,
                { properties: Record<string, { enum?: string[] }> }
            >
        )['Workspace'];
        expect(workspace.properties['status'].enum).toEqual([
            'active',
            'archived'
        ]);
        expect(workspace.properties['color'].enum).toContain('teal');
    });

    it('touches no route it does not own', () => {
        const document: OpenApiDocument = {
            paths: {
                // Not this plugin's, and none of them may gain a body here.
                '/api/users': { get: scanned('200') },
                '/api/media/assets': { get: scanned('200') },
                '/api/content/{typeName}': { get: scanned('200') }
            }
        };
        const before = JSON.stringify(document.paths);
        describeWorkspacesApi(document);
        expect(JSON.stringify(document.paths)).toBe(before);
    });

    it('is a no-op on a route it owns whose method it does not list', () => {
        const document: OpenApiDocument = {
            paths: { '/api/workspaces': { put: scanned('200') } }
        };
        describeWorkspacesApi(document);
        expect(
            successSchema(document, '/api/workspaces', 'put')
        ).toBeUndefined();
    });

    /**
     * `GET /content-types` is this plugin's — `ListContentTypesController` over
     * its own catalogue port — but it lives outside the `/workspaces` namespace,
     * so it needs its own anchor rather than riding the main one.
     */
    describe('the content-type catalogue', () => {
        it('describes the catalogue it answers with', () => {
            const document: OpenApiDocument = {
                paths: { '/api/content-types': { get: scanned('200') } }
            };

            describeWorkspacesApi(document);

            expect(
                successSchema(document, '/api/content-types', 'get')
            ).toEqual({ $ref: '#/components/schemas/ContentTypeCatalogue' });
        });

        it('leaves a route that merely ends in the word alone', () => {
            // The decoy: an anchored single segment is what stops this pass
            // claiming somebody else's `…/settings/content-types`.
            const document: OpenApiDocument = {
                paths: {
                    '/api/workspaces/{id}/content-types': {
                        get: scanned('200')
                    }
                }
            };

            describeWorkspacesApi(document);

            expect(
                successSchema(
                    document,
                    '/api/workspaces/{id}/content-types',
                    'get'
                )
            ).toBeUndefined();
        });

        it('documents the three registry booleans without requiring them', () => {
            // A deployment with no content plugin answers from the built-in
            // fallback, which carries only the port's own five properties.
            const document = scannedDocument();
            describeWorkspacesApi(document);
            const schema = document.components?.schemas?.[
                'ContentTypeDescriptor'
            ] as { properties: Record<string, unknown>; required: string[] };

            expect(Object.keys(schema.properties)).toEqual(
                expect.arrayContaining(['publishable', 'paranoid', 'i18n'])
            );
            expect(schema.required).toEqual(['name', 'kind']);
        });
    });
});
