import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import { describeWebhooksApi } from './describe-webhooks-api';

/** The shape the swagger scanner produces before this pass runs. */
function scannedDocument(): OpenApiDocument {
    return {
        paths: {
            '/api/webhooks': {
                get: { responses: { '200': { description: '' } } },
                post: { responses: { '201': { description: '' } } }
            },
            '/api/webhooks/{id}': {
                get: { responses: { '200': { description: '' } } },
                patch: { responses: { '200': { description: '' } } },
                delete: { responses: { '204': { description: '' } } }
            },
            '/api/webhooks/{id}/secret': {
                post: { responses: { '201': { description: '' } } }
            },
            '/api/webhooks/{id}/test': {
                post: { responses: { '200': { description: '' } } }
            },
            '/api/webhooks/{id}/deliveries': {
                get: { responses: { '200': { description: '' } } }
            },
            '/api/webhooks/{id}/deliveries/{deliveryId}': {
                get: { responses: { '200': { description: '' } } }
            },
            '/api/webhooks/{id}/deliveries/{deliveryId}/redeliver': {
                post: { responses: { '201': { description: '' } } }
            },
            '/api/webhook-events': {
                get: { responses: { '200': { description: '' } } }
            }
        }
    };
}

/** The 2xx JSON schema of one operation, or undefined when it has none. */
function successSchema(
    document: OpenApiDocument,
    route: string,
    method: string
): Record<string, unknown> | undefined {
    const operation = document.paths[route]?.[method] as
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

describe('describeWebhooksApi', () => {
    it('describes every operation the plugin owns that has a body', () => {
        const document = scannedDocument();
        describeWebhooksApi(document);

        expect(successSchema(document, '/api/webhooks', 'get')).toEqual({
            type: 'array',
            items: { $ref: '#/components/schemas/WebhookEndpoint' }
        });
        expect(successSchema(document, '/api/webhooks/{id}', 'get')).toEqual({
            $ref: '#/components/schemas/WebhookEndpoint'
        });
        expect(successSchema(document, '/api/webhooks/{id}', 'patch')).toEqual({
            $ref: '#/components/schemas/WebhookEndpoint'
        });
        expect(
            successSchema(document, '/api/webhooks/{id}/test', 'post')
        ).toEqual({ $ref: '#/components/schemas/WebhookTestResult' });
        expect(
            successSchema(document, '/api/webhooks/{id}/deliveries', 'get')
        ).toEqual({ $ref: '#/components/schemas/WebhookDeliveryPage' });
        expect(successSchema(document, '/api/webhook-events', 'get')).toEqual({
            type: 'array',
            items: { $ref: '#/components/schemas/WebhookEventDescriptor' }
        });
    });

    it('gives create and rotate the schema that carries the secret, and no read route it', () => {
        const document = scannedDocument();
        describeWebhooksApi(document);

        const withSecret = {
            $ref: '#/components/schemas/WebhookEndpointWithSecret'
        };
        expect(successSchema(document, '/api/webhooks', 'post')).toEqual(
            withSecret
        );
        expect(
            successSchema(document, '/api/webhooks/{id}/secret', 'post')
        ).toEqual(withSecret);

        // The read shape is a different schema, not the same one with an
        // optional field — and it must not describe a `secret` at all.
        const schemas = document.components?.schemas as Record<
            string,
            { properties?: Record<string, unknown> }
        >;
        expect(schemas['WebhookEndpoint'].properties).not.toHaveProperty(
            'secret'
        );
        expect(schemas['WebhookEndpoint'].properties).toHaveProperty(
            'secretHint'
        );
    });

    it('describes the redelivery with the shape it actually returns', () => {
        const document = scannedDocument();
        describeWebhooksApi(document);

        // Typed `WebhookDeliveryView`, returns `findDetail(...)` — so the body
        // carries `payload` and `responseSnippet` and the document says so.
        expect(
            successSchema(
                document,
                '/api/webhooks/{id}/deliveries/{deliveryId}/redeliver',
                'post'
            )
        ).toEqual({ $ref: '#/components/schemas/WebhookDeliveryDetail' });
    });

    it('leaves a 204 alone rather than inventing a body for it', () => {
        const document = scannedDocument();
        describeWebhooksApi(document);

        const remove = document.paths['/api/webhooks/{id}']['delete'] as {
            responses: Record<string, { content?: unknown }>;
        };
        expect(Object.keys(remove.responses)).toEqual(['204']);
        expect(remove.responses['204'].content).toBeUndefined();
    });

    it('never invents a status code the operation does not answer with', () => {
        const document: OpenApiDocument = {
            paths: {
                // A `@HttpCode(202)` would land here; the pass must write onto
                // whichever 2xx key the scanner emitted, not onto a 200 of its
                // own invention.
                '/api/webhooks/{id}/test': {
                    post: { responses: { '202': { description: '' } } }
                }
            }
        };
        describeWebhooksApi(document);

        const operation = document.paths['/api/webhooks/{id}/test']['post'] as {
            responses: Record<string, { content?: unknown }>;
        };
        expect(Object.keys(operation.responses)).toEqual(['202', '404']);
        expect(operation.responses['202'].content).toBeDefined();
    });

    it('does not claim a nested route that merely ends in the same segment', () => {
        const document: OpenApiDocument = {
            paths: {
                '/api/workspaces/{id}/webhooks': {
                    get: { responses: { '200': { description: '' } } }
                }
            }
        };
        describeWebhooksApi(document);

        expect(
            successSchema(document, '/api/workspaces/{id}/webhooks', 'get')
        ).toBeUndefined();
    });

    it('describes a route under a different global prefix', () => {
        const document: OpenApiDocument = {
            paths: {
                '/v2/webhooks': {
                    get: { responses: { '200': { description: '' } } }
                }
            }
        };
        describeWebhooksApi(document);

        expect(successSchema(document, '/v2/webhooks', 'get')).toEqual({
            type: 'array',
            items: { $ref: '#/components/schemas/WebhookEndpoint' }
        });
    });
});
