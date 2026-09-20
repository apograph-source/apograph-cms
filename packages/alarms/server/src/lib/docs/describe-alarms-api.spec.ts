import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import { describeAlarmsApi } from './describe-alarms-api';

/** The shape the swagger scanner produces before this pass runs. */
function scannedDocument(): OpenApiDocument {
    return {
        paths: {
            '/api/alarms/rules': {
                get: { responses: { '200': { description: '' } } },
                post: { responses: { '201': { description: '' } } }
            },
            '/api/alarms/rules/preview': {
                post: { responses: { '200': { description: '' } } }
            },
            '/api/alarms/rules/{id}': {
                patch: { responses: { '200': { description: '' } } },
                delete: { responses: { '204': { description: '' } } }
            },
            '/api/alarms/rules/{id}/rescan': {
                post: { responses: { '200': { description: '' } } }
            },
            '/api/alarms/findings': {
                get: { responses: { '200': { description: '' } } }
            },
            '/api/alarms/findings/by-entry': {
                get: { responses: { '200': { description: '' } } }
            },
            '/api/alarms/findings/summary': {
                get: { responses: { '200': { description: '' } } }
            }
        }
    };
}

/** One operation, as this spec reads it back. */
interface ReadOperation {
    responses?: Record<
        string,
        {
            content?: {
                'application/json'?: { schema?: Record<string, unknown> };
            };
        }
    >;
}

/** The 2xx JSON schema of one operation, or undefined when it has none. */
function successSchema(
    document: OpenApiDocument,
    route: string,
    method: string
): Record<string, unknown> | undefined {
    const operation = document.paths[route]?.[method] as
        | ReadOperation
        | undefined;
    const responses = operation?.responses ?? {};
    const key = Object.keys(responses).find((code) => /^2\d\d$/.test(code));
    return key
        ? responses[key].content?.['application/json']?.schema
        : undefined;
}

describe('describeAlarmsApi', () => {
    it('describes every operation that answers with a body', () => {
        const document = scannedDocument();
        describeAlarmsApi(document);

        expect(successSchema(document, '/api/alarms/rules', 'get')).toEqual({
            type: 'array',
            items: { $ref: '#/components/schemas/AlarmRule' }
        });
        expect(successSchema(document, '/api/alarms/rules', 'post')).toEqual({
            $ref: '#/components/schemas/AlarmRuleCreated'
        });
        expect(
            successSchema(document, '/api/alarms/rules/preview', 'post')
        ).toEqual({ $ref: '#/components/schemas/AlarmRulePreview' });
        expect(
            successSchema(document, '/api/alarms/rules/{id}', 'patch')
        ).toEqual({ $ref: '#/components/schemas/AlarmRule' });
        expect(
            successSchema(document, '/api/alarms/rules/{id}/rescan', 'post')
        ).toEqual({ $ref: '#/components/schemas/AlarmScanResult' });
        expect(successSchema(document, '/api/alarms/findings', 'get')).toEqual({
            $ref: '#/components/schemas/AlarmFindingPage'
        });
        expect(
            successSchema(document, '/api/alarms/findings/by-entry', 'get')
        ).toEqual({ $ref: '#/components/schemas/AlarmFindingsByEntry' });
        expect(
            successSchema(document, '/api/alarms/findings/summary', 'get')
        ).toEqual({ $ref: '#/components/schemas/AlarmSummary' });
    });

    it('describes the stored filter as a recursive node, not a bare object', () => {
        const document = scannedDocument();
        describeAlarmsApi(document);

        const schemas = document.components?.schemas as Record<
            string,
            Record<string, unknown>
        >;
        // The rule points at the node…
        expect(
            (schemas['AlarmRule'].properties as Record<string, unknown>)[
                'filter'
            ]
        ).toEqual({ $ref: '#/components/schemas/AlarmFilterNode' });
        // …the node is a group or a rule…
        expect(schemas['AlarmFilterNode'].anyOf).toEqual([
            { $ref: '#/components/schemas/AlarmFilterGroup' },
            { $ref: '#/components/schemas/AlarmFilterRule' }
        ]);
        // …and a group's children are nodes again, which is the recursion the
        // stored tree actually has.
        const group = schemas['AlarmFilterGroup'].properties as Record<
            string,
            { items?: unknown }
        >;
        expect(group['and'].items).toEqual({
            $ref: '#/components/schemas/AlarmFilterNode'
        });
        expect(group['or'].items).toEqual({
            $ref: '#/components/schemas/AlarmFilterNode'
        });
    });

    it('documents the failures a filter-parsing route can answer with', () => {
        const document = scannedDocument();
        describeAlarmsApi(document);

        const create = document.paths['/api/alarms/rules']['post'] as {
            responses: Record<string, unknown>;
        };
        expect(Object.keys(create.responses).sort()).toEqual([
            '201',
            '400',
            '404',
            '409'
        ]);
    });

    it('leaves a 204 alone rather than inventing a body for it', () => {
        const document = scannedDocument();
        describeAlarmsApi(document);

        const remove = document.paths['/api/alarms/rules/{id}']['delete'] as {
            responses: Record<string, { content?: unknown }>;
        };
        expect(Object.keys(remove.responses)).toEqual(['204']);
        expect(remove.responses['204'].content).toBeUndefined();
    });

    it('never invents a status code the operation does not answer with', () => {
        const document: OpenApiDocument = {
            paths: {
                '/api/alarms/findings': {
                    get: { responses: { '206': { description: '' } } }
                }
            }
        };
        describeAlarmsApi(document);

        const operation = document.paths['/api/alarms/findings']['get'] as {
            responses: Record<string, { content?: unknown }>;
        };
        expect(Object.keys(operation.responses)).toEqual(['206']);
        expect(operation.responses['206'].content).toBeDefined();
    });

    it('does not claim a nested route that merely ends in the same segment', () => {
        const document: OpenApiDocument = {
            paths: {
                '/api/workspaces/{id}/alarms/rules': {
                    get: { responses: { '200': { description: '' } } }
                }
            }
        };
        describeAlarmsApi(document);

        expect(
            successSchema(document, '/api/workspaces/{id}/alarms/rules', 'get')
        ).toBeUndefined();
    });
});
