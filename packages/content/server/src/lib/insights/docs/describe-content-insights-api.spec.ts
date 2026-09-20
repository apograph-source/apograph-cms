import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import { describeContentInsightsApi } from './describe-content-insights-api';

/** The six widget routes, as the swagger scanner leaves them. */
function scannedDocument(): OpenApiDocument {
    // A fresh operation per route. Spreading one shared object would give all
    // six paths the *same* operation, and the last schema written would appear
    // to be on every one of them — a green test over an empty document.
    const get = () => ({ get: { responses: { '200': { description: '' } } } });
    return {
        paths: {
            '/api/insights/content/totals': get(),
            '/api/insights/content/pipeline': get(),
            '/api/insights/content/velocity': get(),
            '/api/insights/content/punchcard': get(),
            '/api/insights/content/stale': get(),
            '/api/insights/content/unshipped': get()
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

describe('describeContentInsightsApi', () => {
    it('gives each widget its own schema — they are six unlike payloads', () => {
        const document = scannedDocument();
        describeContentInsightsApi(document);

        const byRoute = {
            totals: 'InsightsContentTotals',
            pipeline: 'InsightsContentPipeline',
            velocity: 'InsightsContentVelocity',
            punchcard: 'InsightsContentPunchcard',
            stale: 'InsightsContentStale',
            unshipped: 'InsightsContentUnshipped'
        };
        for (const [widget, schema] of Object.entries(byRoute)) {
            expect(
                successSchema(document, `/api/insights/content/${widget}`)
            ).toEqual({ $ref: `#/components/schemas/${schema}` });
        }
        // Six routes, six distinct schemas — no family resemblance assumed.
        expect(new Set(Object.values(byRoute)).size).toBe(6);
    });

    it('pins the staleness buckets as the fixed set the query always returns', () => {
        const document = scannedDocument();
        describeContentInsightsApi(document);

        const stale = (
            document.components?.schemas as Record<
                string,
                {
                    properties: {
                        buckets: {
                            items: {
                                properties: { id: { enum: string[] } };
                            };
                        };
                    };
                }
            >
        )['InsightsContentStale'];
        expect(stale.properties.buckets.items.properties.id.enum).toEqual([
            'd30',
            'd90',
            'd180',
            'd365',
            'older'
        ]);
    });

    it('never invents a status code the operation does not answer with', () => {
        const document: OpenApiDocument = {
            paths: {
                '/api/insights/content/totals': {
                    get: { responses: { '203': { description: '' } } }
                }
            }
        };
        describeContentInsightsApi(document);

        const operation = document.paths['/api/insights/content/totals'][
            'get'
        ] as { responses: Record<string, { content?: unknown }> };
        expect(Object.keys(operation.responses)).toEqual(['203']);
        expect(operation.responses['203'].content).toBeDefined();
    });

    it('claims neither the content resource nor another surface’s insights', () => {
        const document: OpenApiDocument = {
            paths: {
                '/api/content/{typeName}': {
                    get: { responses: { '200': { description: '' } } }
                },
                '/api/insights/media/storage': {
                    get: { responses: { '200': { description: '' } } }
                },
                '/api/workspaces/{id}/insights/content/totals': {
                    get: { responses: { '200': { description: '' } } }
                }
            }
        };
        describeContentInsightsApi(document);

        expect(
            successSchema(document, '/api/content/{typeName}')
        ).toBeUndefined();
        expect(
            successSchema(document, '/api/insights/media/storage')
        ).toBeUndefined();
        expect(
            successSchema(
                document,
                '/api/workspaces/{id}/insights/content/totals'
            )
        ).toBeUndefined();
    });
});
