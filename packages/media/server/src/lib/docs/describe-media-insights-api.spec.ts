import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import { describeMediaInsightsApi } from './describe-media-insights-api';

/** The three widget routes, as the swagger scanner leaves them. */
function scannedDocument(): OpenApiDocument {
    const get = () => ({ get: { responses: { '200': { description: '' } } } });
    return {
        paths: {
            '/api/insights/media/storage': get(),
            '/api/insights/media/uploads': get(),
            '/api/insights/media/alt': get()
        }
    };
}

/** The 2xx JSON schema of one operation, or undefined when it has none. */
function successSchema(
    document: OpenApiDocument,
    route: string
): Record<string, unknown> | undefined {
    const operation = document.paths[route]?.['get'] as
        | {
              responses?: Record<
                  string,
                  {
                      content?: {
                          'application/json'?: {
                              schema?: Record<string, unknown>;
                          };
                      };
                  }
              >;
          }
        | undefined;
    const responses = operation?.responses ?? {};
    const key = Object.keys(responses).find((code) => /^2\d\d$/.test(code));
    return key
        ? responses[key].content?.['application/json']?.schema
        : undefined;
}

describe('describeMediaInsightsApi', () => {
    it('gives each of the three aggregates its own schema', () => {
        const document = scannedDocument();
        describeMediaInsightsApi(document);

        expect(successSchema(document, '/api/insights/media/storage')).toEqual({
            $ref: '#/components/schemas/InsightsMediaStorage'
        });
        expect(successSchema(document, '/api/insights/media/uploads')).toEqual({
            $ref: '#/components/schemas/InsightsMediaUploads'
        });
        expect(successSchema(document, '/api/insights/media/alt')).toEqual({
            $ref: '#/components/schemas/InsightsMediaAltCoverage'
        });
    });

    it('takes the kind vocabulary from the column, so it cannot drift', () => {
        const document = scannedDocument();
        describeMediaInsightsApi(document);

        const storage = (
            document.components?.schemas as Record<
                string,
                {
                    properties: {
                        kinds: {
                            items: { properties: { kind: { enum: string[] } } };
                        };
                    };
                }
            >
        )['InsightsMediaStorage'];
        expect(storage.properties.kinds.items.properties.kind.enum).toEqual([
            'image',
            'video',
            'audio',
            'document',
            'archive'
        ]);
    });

    it('does not claim the media resource or another surface’s insights', () => {
        const document: OpenApiDocument = {
            paths: {
                '/api/media/assets': {
                    get: { responses: { '200': { description: '' } } }
                },
                '/api/insights/content/totals': {
                    get: { responses: { '200': { description: '' } } }
                },
                '/api/workspaces/{id}/insights/media/storage': {
                    get: { responses: { '200': { description: '' } } }
                }
            }
        };
        describeMediaInsightsApi(document);

        expect(successSchema(document, '/api/media/assets')).toBeUndefined();
        expect(
            successSchema(document, '/api/insights/content/totals')
        ).toBeUndefined();
        expect(
            successSchema(
                document,
                '/api/workspaces/{id}/insights/media/storage'
            )
        ).toBeUndefined();
    });

    it('never invents a status code the operation does not answer with', () => {
        const document: OpenApiDocument = {
            paths: {
                '/api/insights/media/alt': {
                    get: { responses: { '203': { description: '' } } }
                }
            }
        };
        describeMediaInsightsApi(document);

        const operation = document.paths['/api/insights/media/alt']['get'] as {
            responses: Record<string, { content?: unknown }>;
        };
        expect(Object.keys(operation.responses)).toEqual(['203']);
        expect(operation.responses['203'].content).toBeDefined();
    });
});
