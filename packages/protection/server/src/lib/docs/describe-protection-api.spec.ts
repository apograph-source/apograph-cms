import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import { describeProtectionApi } from './describe-protection-api';
import {
    ENTRY_REVIEW_SCHEMA,
    NEW_ENTRY_PROTECTION_SCHEMA,
    PROTECTION_RULE_SCHEMA,
    REVIEW_QUEUE_SCHEMA
} from './protection-schemas';

/** A document shaped the way the scanner leaves this plugin's routes. */
function scanned(): OpenApiDocument {
    return {
        paths: {
            '/api/protection/rules': {
                get: { responses: { '200': { description: '' } } }
            },
            '/api/protection/rules/{kind}/{slug}': {
                put: { responses: { '200': { description: '' } } },
                delete: { responses: { '204': { description: '' } } }
            },
            '/api/protection/entries/{type}/{id}': {
                get: { responses: { '200': { description: '' } } }
            },
            '/api/protection/entries/{type}/{id}/request': {
                post: { responses: { '201': { description: '' } } },
                delete: { responses: { '204': { description: '' } } }
            },
            '/api/protection/entries/{type}/{id}/approve': {
                post: { responses: { '201': { description: '' } } },
                delete: { responses: { '204': { description: '' } } }
            },
            '/api/protection/queue': {
                get: { responses: { '200': { description: '' } } }
            },
            // Somebody else's route, to prove the pass keeps its hands off it.
            '/api/content/entries': {
                get: { responses: { '200': { description: 'Untouched.' } } }
            }
        }
    };
}

/** The success response of one operation, if it has content. */
function success(
    document: OpenApiDocument,
    path: string,
    method: string,
    code = '200'
): Record<string, unknown> | undefined {
    const operation = document.paths[path]?.[method] as
        | { responses?: Record<string, Record<string, unknown>> }
        | undefined;
    return operation?.responses?.[code];
}

describe('describeProtectionApi', () => {
    it('publishes the rule schema as a component', () => {
        const document = scanned();

        describeProtectionApi(document);

        expect(
            document.components?.schemas?.[PROTECTION_RULE_SCHEMA]
        ).toBeDefined();
    });

    it('describes the list as an array of rules', () => {
        const document = scanned();

        describeProtectionApi(document);

        expect(success(document, '/api/protection/rules', 'get')).toMatchObject(
            {
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                $ref: `#/components/schemas/${PROTECTION_RULE_SCHEMA}`
                            }
                        }
                    }
                }
            }
        );
    });

    it('describes the write as one rule', () => {
        const document = scanned();

        describeProtectionApi(document);

        expect(
            success(document, '/api/protection/rules/{kind}/{slug}', 'put')
        ).toMatchObject({
            content: {
                'application/json': {
                    schema: {
                        $ref: `#/components/schemas/${PROTECTION_RULE_SCHEMA}`
                    }
                }
            }
        });
    });

    /**
     * The 404 is not an incidental failure — it is the whole grant rule, and
     * the reference is where an API consumer meets it.
     */
    it('documents the 404 on a type the workspace cannot reach', () => {
        const document = scanned();

        describeProtectionApi(document);

        expect(
            success(
                document,
                '/api/protection/rules/{kind}/{slug}',
                'put',
                '404'
            )
        ).toBeDefined();
    });

    /** A 204 has no body; attaching one would describe a payload nothing sends. */
    it('gives the delete no response body', () => {
        const document = scanned();

        describeProtectionApi(document);

        const del = success(
            document,
            '/api/protection/rules/{kind}/{slug}',
            'delete',
            '204'
        );
        expect(del).toBeDefined();
        expect(del).not.toHaveProperty('content');
    });

    it('touches no path but its own', () => {
        const document = scanned();
        const before = JSON.stringify(document.paths['/api/content/entries']);

        describeProtectionApi(document);

        expect(JSON.stringify(document.paths['/api/content/entries'])).toBe(
            before
        );
    });

    /**
     * The pass runs against whatever the scanner produced. A route renamed or
     * removed must leave it silent rather than throwing during boot — the
     * document is built at startup, so an exception here is a server that does
     * not come up.
     */
    it('does nothing when the routes are absent', () => {
        const document: OpenApiDocument = { paths: {} };

        expect(() => describeProtectionApi(document)).not.toThrow();
    });

    it('keeps schemas another plugin already published', () => {
        const document = scanned();
        document.components = { schemas: { Something: { type: 'object' } } };

        describeProtectionApi(document);

        expect(document.components?.schemas?.Something).toEqual({
            type: 'object'
        });
    });
    it('publishes the review schemas as components', () => {
        const document = scanned();

        describeProtectionApi(document);

        // Both views are `interface`s, erased at compile time, so without this
        // pass the two reads arrive with a bare 200 and no content at all.
        expect(
            document.components?.schemas?.[ENTRY_REVIEW_SCHEMA]
        ).toBeDefined();
        expect(
            document.components?.schemas?.[REVIEW_QUEUE_SCHEMA]
        ).toBeDefined();
    });

    it('points the new-entry read at its own schema, with the 404', () => {
        const document = scanned();
        document.paths['/api/protection/types/{type}'] = {
            get: { responses: { '200': { description: '' } } }
        };

        describeProtectionApi(document);

        expect(
            success(document, '/api/protection/types/{type}', 'get')
        ).toMatchObject({
            content: {
                'application/json': {
                    schema: {
                        $ref: `#/components/schemas/${NEW_ENTRY_PROTECTION_SCHEMA}`
                    }
                }
            }
        });
        expect(
            success(document, '/api/protection/types/{type}', 'get', '404')
        ).toBeDefined();
    });

    it('points the entry read at the review schema, not the rule one', () => {
        const document = scanned();

        describeProtectionApi(document);

        expect(
            success(document, '/api/protection/entries/{type}/{id}', 'get')
        ).toMatchObject({
            content: {
                'application/json': {
                    schema: {
                        $ref: `#/components/schemas/${ENTRY_REVIEW_SCHEMA}`
                    }
                }
            }
        });
    });

    it('points the queue at its own schema', () => {
        const document = scanned();

        describeProtectionApi(document);

        expect(success(document, '/api/protection/queue', 'get')).toMatchObject(
            {
                content: {
                    'application/json': {
                        schema: {
                            $ref: `#/components/schemas/${REVIEW_QUEUE_SCHEMA}`
                        }
                    }
                }
            }
        );
    });

    /**
     * The refusal a client has to branch on. A 409 rather than a 403 because
     * the caller does hold `content:approve` — and a reference that documents
     * only the 201 leaves them guessing which it is.
     */
    it('documents the self-approval 409', () => {
        const document = scanned();

        describeProtectionApi(document);

        expect(
            success(
                document,
                '/api/protection/entries/{type}/{id}/approve',
                'post',
                '409'
            )?.description
        ).toContain('protection.self_approval_refused');
    });

    /**
     * The one that caught a live bug. `addErrorResponse` returns early when the
     * response code already exists, and the scanner always emits
     * `'204': { description: '' }` — so every 204 description this pass wrote
     * before landed nowhere, including the rule delete's, and the spec did not
     * notice because it only asserted the response existed.
     */
    it('says what each 204 means', () => {
        const document = scanned();

        describeProtectionApi(document);

        for (const path of [
            // The rule delete included: its description is the one that was
            // silently dropped before.
            '/api/protection/rules/{kind}/{slug}',
            '/api/protection/entries/{type}/{id}/request',
            '/api/protection/entries/{type}/{id}/approve'
        ]) {
            const described = success(document, path, 'delete', '204');
            expect(described?.description).toEqual(expect.any(String));
            expect(described?.description).not.toBe('');
        }
    });
});
