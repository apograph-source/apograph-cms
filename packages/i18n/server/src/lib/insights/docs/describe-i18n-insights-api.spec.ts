import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import { describeI18nInsightsApi } from './describe-i18n-insights-api';

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

describe('describeI18nInsightsApi', () => {
    it('describes the coverage route', () => {
        const document: OpenApiDocument = {
            paths: {
                '/api/insights/i18n/coverage': {
                    get: { responses: { '200': { description: '' } } }
                }
            }
        };
        describeI18nInsightsApi(document);

        expect(successSchema(document, '/api/insights/i18n/coverage')).toEqual({
            $ref: '#/components/schemas/InsightsI18nCoverage'
        });
    });

    it('describes the per-type rows with the same four counts as the envelope', () => {
        const document: OpenApiDocument = { paths: {} };
        describeI18nInsightsApi(document);

        const coverage = (
            document.components?.schemas as Record<
                string,
                {
                    properties: Record<
                        string,
                        { items?: { properties: object } }
                    >;
                }
            >
        )['InsightsI18nCoverage'];
        const counts = [
            'records',
            'localized',
            'notLocalized',
            'requiresLocalization'
        ];
        for (const count of counts) {
            expect(coverage.properties).toHaveProperty(count);
        }
        expect(
            Object.keys(coverage.properties['types'].items?.properties ?? {})
        ).toEqual(['name', 'label', ...counts]);
    });

    it('claims neither the locale routes nor another surface’s insights', () => {
        const document: OpenApiDocument = {
            paths: {
                '/api/i18n/locales': {
                    get: { responses: { '200': { description: '' } } }
                },
                '/api/insights/content/totals': {
                    get: { responses: { '200': { description: '' } } }
                },
                '/api/workspaces/{id}/insights/i18n/coverage': {
                    get: { responses: { '200': { description: '' } } }
                }
            }
        };
        describeI18nInsightsApi(document);

        expect(successSchema(document, '/api/i18n/locales')).toBeUndefined();
        expect(
            successSchema(document, '/api/insights/content/totals')
        ).toBeUndefined();
        expect(
            successSchema(
                document,
                '/api/workspaces/{id}/insights/i18n/coverage'
            )
        ).toBeUndefined();
    });

    it('never invents a status code the operation does not answer with', () => {
        const document: OpenApiDocument = {
            paths: {
                '/api/insights/i18n/coverage': {
                    get: { responses: { '203': { description: '' } } }
                }
            }
        };
        describeI18nInsightsApi(document);

        const operation = document.paths['/api/insights/i18n/coverage'][
            'get'
        ] as { responses: Record<string, { content?: unknown }> };
        expect(Object.keys(operation.responses)).toEqual(['203']);
        expect(operation.responses['203'].content).toBeDefined();
    });
});
