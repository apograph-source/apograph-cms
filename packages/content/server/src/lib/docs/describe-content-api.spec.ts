import { describeContentApi } from './describe-content-api';
import { pascalCase } from './content-schemas';
import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import type { SerializedContentType } from '../registry/content-type-registry';

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
            validation: { maxLength: 200 },
            admin: { label: 'Title' }
        },
        {
            name: 'author',
            type: 'relation',
            required: false,
            validation: {},
            admin: {},
            relation: { to: 'author', many: false, onDelete: 'restrict' }
        },
        {
            name: 'tags',
            type: 'relation',
            required: false,
            validation: {},
            admin: {},
            relation: { to: 'tag', many: true }
        }
    ]
};

const settings: SerializedContentType = {
    name: 'site_settings',
    kind: 'single',
    label: 'Site settings',
    publishable: false,
    paranoid: false,
    i18n: false,
    fields: [
        {
            name: 'siteName',
            type: 'text',
            required: true,
            validation: {},
            admin: {}
        }
    ]
};

/** The shape the swagger scanner produces before this pass runs. */
function scannedDocument(): OpenApiDocument {
    return {
        paths: {
            '/api/content/{typeName}': {
                get: {
                    parameters: [
                        {
                            name: 'typeName',
                            in: 'path',
                            schema: { type: 'string' }
                        }
                    ],
                    responses: { '200': { description: '' } }
                },
                post: {
                    parameters: [
                        {
                            name: 'typeName',
                            in: 'path',
                            schema: { type: 'string' }
                        }
                    ],
                    responses: { '201': { description: '' } }
                }
            },
            '/api/content/{typeName}/{id}': {
                get: { responses: { '200': { description: '' } } },
                delete: { responses: { '204': { description: '' } } }
            },
            '/api/content/{typeName}/bulk/publish': {
                post: { responses: { '201': { description: '' } } }
            },
            '/api/content-schema/{name}': {
                get: { responses: { '200': { description: '' } } }
            },
            '/api/v1/content/{typeName}': {
                get: {
                    parameters: [
                        {
                            name: 'typeName',
                            in: 'path',
                            schema: { type: 'string' }
                        }
                    ],
                    responses: { '200': { description: '' } }
                }
            },
            '/api/v1/content/{typeName}/{id}': {
                get: { responses: { '200': { description: '' } } }
            },
            '/api/v1/content/{typeName}/{id}/media': {
                get: { responses: { '200': { description: '' } } }
            },
            '/api/v1/content/{typeName}/{id}/relations/{field}': {
                get: { responses: { '200': { description: '' } } }
            },
            '/api/v1/content/{typeName}/{id}/translations': {
                get: { responses: { '200': { description: '' } } }
            },
            '/api/v1/content/{typeName}/group/{localeGroupId}': {
                get: { responses: { '200': { description: '' } } },
                patch: { responses: { '200': { description: '' } } },
                delete: { responses: { '204': { description: '' } } }
            },
            '/api/v1/content/{typeName}/group/{localeGroupId}/media': {
                get: { responses: { '200': { description: '' } } }
            },
            '/api/v1/content/{typeName}/group/{localeGroupId}/publish': {
                post: { responses: { '201': { description: '' } } }
            },
            '/api/v1/content-types': {
                get: { responses: { '200': { description: '' } } }
            },
            '/api/v1/content-types/{name}': {
                get: { responses: { '200': { description: '' } } }
            },
            // Two routes other plugins mount under this plugin's `{typeName}`
            // namespaces — transfer's export, segments' access. They are here
            // because the `typeName` enum is content's to write and the
            // response is not.
            '/api/content/{typeName}/export': {
                post: {
                    parameters: [
                        {
                            name: 'typeName',
                            in: 'path',
                            schema: { type: 'string' }
                        }
                    ],
                    responses: { '200': { description: '' } }
                }
            },
            '/api/v1/content/{typeName}/{id}/access': {
                put: {
                    parameters: [
                        {
                            name: 'typeName',
                            in: 'path',
                            schema: { type: 'string' }
                        }
                    ],
                    responses: { '200': { description: '' } }
                }
            },
            '/api/media/assets': {
                get: { responses: { '200': { description: '' } } }
            }
        }
    };
}

/** The schema (or `$ref`) of an operation's success response. */
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

describe('describeContentApi', () => {
    it('adds a Values/Entry/ListPage trio per registered type', () => {
        const document = scannedDocument();
        describeContentApi(document, [article, settings]);

        const schemas = document.components?.schemas ?? {};
        for (const name of ['article', 'site_settings']) {
            const base = pascalCase(name);
            expect(schemas[`${base}Values`]).toBeDefined();
            expect(schemas[`${base}Entry`]).toBeDefined();
            expect(schemas[`${base}ListPage`]).toBeDefined();
        }
    });

    it('pascal-cases snake_case type names', () => {
        expect(pascalCase('site_settings')).toBe('SiteSettings');
    });

    it('describes each value field, dropping the join-backed relations', () => {
        const document = scannedDocument();
        describeContentApi(document, [article]);

        const values = document.components?.schemas?.['ArticleValues'] as {
            properties: Record<string, unknown>;
        };
        expect(Object.keys(values.properties)).toEqual(['title', 'author']);
    });

    it('omits `required` on a publishable type — a draft may be incomplete', () => {
        const document = scannedDocument();
        describeContentApi(document, [article, settings]);

        const schemas = document.components?.schemas ?? {};
        expect(
            (schemas['ArticleValues'] as Record<string, unknown>)['required']
        ).toBeUndefined();
        expect(
            (schemas['SiteSettingsValues'] as Record<string, unknown>)[
                'required'
            ]
        ).toEqual(['siteName']);
    });

    it('gives a publishable type the publish envelope, and others none', () => {
        const document = scannedDocument();
        describeContentApi(document, [article, settings]);

        const schemas = document.components?.schemas ?? {};
        const articleProps = (
            schemas['ArticleEntry'] as { properties: Record<string, unknown> }
        ).properties;
        const settingsProps = (
            schemas['SiteSettingsEntry'] as {
                properties: Record<string, unknown>;
            }
        ).properties;
        expect(articleProps['status']).toBeDefined();
        expect(articleProps['publishedAt']).toBeDefined();
        expect(settingsProps['status']).toBeUndefined();
    });

    it('constrains typeName to the registered names', () => {
        const document = scannedDocument();
        describeContentApi(document, [article, settings]);

        const parameters = (
            document.paths['/api/content/{typeName}']['get'] as {
                parameters: { name: string; schema: Record<string, unknown> }[];
            }
        ).parameters;
        expect(parameters[0].schema['enum']).toEqual([
            'article',
            'site_settings'
        ]);
    });

    it('unions the per-type schemas onto the generic list and read routes', () => {
        const document = scannedDocument();
        describeContentApi(document, [article, settings]);

        // `anyOf`, not `oneOf`. The alternatives overlap — an empty `items`
        // array satisfies every list schema there is — and `oneOf` means
        // exactly one, so it rejected responses the API really returns
        // (measured live on `GET /api/v1/content/home_page`).
        expect(
            successSchema(document, '/api/content/{typeName}', 'get')
        ).toEqual({
            anyOf: [
                { $ref: '#/components/schemas/ArticleListPage' },
                { $ref: '#/components/schemas/SiteSettingsListPage' }
            ]
        });
        expect(
            successSchema(document, '/api/content/{typeName}/{id}', 'get')
        ).toEqual({
            anyOf: [
                { $ref: '#/components/schemas/ArticleEntry' },
                { $ref: '#/components/schemas/SiteSettingsEntry' }
            ]
        });
    });

    it('needs no union for a single registered type', () => {
        const document = scannedDocument();
        describeContentApi(document, [article]);

        expect(
            successSchema(document, '/api/content/{typeName}', 'get')
        ).toEqual({
            $ref: '#/components/schemas/ArticleListPage'
        });
    });

    it('writes onto the status code the scanner emitted, 201 included', () => {
        const document = scannedDocument();
        describeContentApi(document, [article]);

        const post = document.paths['/api/content/{typeName}']['post'] as {
            responses: Record<string, unknown>;
        };
        expect(Object.keys(post.responses)).toContain('201');
        expect(post.responses['200']).toBeUndefined();
    });

    it('leaves a 204 without a body', () => {
        const document = scannedDocument();
        describeContentApi(document, [article]);

        expect(
            successSchema(document, '/api/content/{typeName}/{id}', 'delete')
        ).toBeUndefined();
    });

    it('documents 404 everywhere and 422 only on the validated writes', () => {
        const document = scannedDocument();
        describeContentApi(document, [article]);

        const list = document.paths['/api/content/{typeName}']['get'] as {
            responses: Record<string, unknown>;
        };
        const create = document.paths['/api/content/{typeName}']['post'] as {
            responses: Record<string, unknown>;
        };
        expect(list.responses['404']).toBeDefined();
        expect(list.responses['422']).toBeUndefined();
        expect(create.responses['422']).toBeDefined();
    });

    it('describes the content-schema reads', () => {
        const document = scannedDocument();
        describeContentApi(document, [article]);

        expect(
            successSchema(document, '/api/content-schema/{name}', 'get')
        ).toEqual({ $ref: '#/components/schemas/ContentTypeSchema' });
    });

    it('touches no route it does not own', () => {
        const document = scannedDocument();
        describeContentApi(document, [article]);

        expect(document.paths['/api/media/assets']['get']).toEqual({
            responses: { '200': { description: '' } }
        });
    });

    it('adds no entry schema when nothing is registered', () => {
        const document = scannedDocument();
        describeContentApi(document, []);

        expect(
            successSchema(document, '/api/content/{typeName}', 'get')
        ).toBeUndefined();
        expect(document.components?.schemas?.['RelationRef']).toBeDefined();
    });

    // The published contract. Everything here failed before the public schemas
    // existed — most of it silently, by being described with the ADMIN's
    // shapes, which is worse than being undescribed: an absent schema sends a
    // reader to curl, a wrong one does not.
    describe('the public API (/api/v1) is described as itself', () => {
        it('does NOT describe a public read with the admin entry schema', () => {
            const document = scannedDocument();
            describeContentApi(document, [article, settings]);

            expect(
                successSchema(
                    document,
                    '/api/v1/content/{typeName}/{id}',
                    'get'
                )
            ).toEqual({
                anyOf: [
                    { $ref: '#/components/schemas/PublicArticleEntry' },
                    { $ref: '#/components/schemas/PublicSiteSettingsEntry' }
                ]
            });
            // The admin route keeps the admin's, so this is a split and not a
            // rename.
            expect(
                successSchema(document, '/api/content/{typeName}/{id}', 'get')
            ).toEqual({
                anyOf: [
                    { $ref: '#/components/schemas/ArticleEntry' },
                    { $ref: '#/components/schemas/SiteSettingsEntry' }
                ]
            });
        });

        it('gives the media and relation reads the shapes they actually return', () => {
            const document = scannedDocument();
            describeContentApi(document, [article]);

            // The public media read is keyed to `{ items, total }` per field;
            // the admin's is keyed to a bare array. They were both reported as
            // the admin's.
            expect(
                successSchema(
                    document,
                    '/api/v1/content/{typeName}/{id}/media',
                    'get'
                )
            ).toEqual({ $ref: '#/components/schemas/PublicEntryMedia' });
            expect(
                successSchema(
                    document,
                    '/api/v1/content/{typeName}/{id}/relations/{field}',
                    'get'
                )
            ).toEqual({
                $ref: '#/components/schemas/PublicRelationFieldPage'
            });

            const media = document.components?.schemas?.[
                'PublicEntryMedia'
            ] as {
                properties: { media: { additionalProperties: unknown } };
            };
            expect(media.properties.media.additionalProperties).toEqual({
                $ref: '#/components/schemas/PublicMediaFieldPage'
            });
        });

        it('describes a relation page as whole entries, not refs', () => {
            const document = scannedDocument();
            describeContentApi(document, [article]);

            const page = document.components?.schemas?.[
                'PublicRelationFieldPage'
            ] as { properties: { items: { items: unknown } } };
            expect(page.properties.items.items).toEqual({
                $ref: '#/components/schemas/PublicArticleEntry'
            });
        });

        it('describes the group-addressed twin of every id-addressed read', () => {
            const document = scannedDocument();
            describeContentApi(document, [article]);

            // The two spellings funnel into one handler, so a difference here
            // would be a documentation-only fork.
            for (const [group, byId] of [
                [
                    '/api/v1/content/{typeName}/group/{localeGroupId}',
                    '/api/v1/content/{typeName}/{id}'
                ],
                [
                    '/api/v1/content/{typeName}/group/{localeGroupId}/media',
                    '/api/v1/content/{typeName}/{id}/media'
                ]
            ]) {
                expect(successSchema(document, group, 'get')).toEqual(
                    successSchema(document, byId, 'get')
                );
            }
            expect(
                successSchema(
                    document,
                    '/api/v1/content/{typeName}/group/{localeGroupId}',
                    'patch'
                )
            ).toEqual({ $ref: '#/components/schemas/PublicArticleEntry' });
            expect(
                successSchema(
                    document,
                    '/api/v1/content/{typeName}/group/{localeGroupId}/publish',
                    'post'
                )
            ).toEqual({ $ref: '#/components/schemas/PublicArticleEntry' });
        });

        it('leaves the group DELETE bodiless — it answers 204', () => {
            const document = scannedDocument();
            describeContentApi(document, [article]);

            expect(
                successSchema(
                    document,
                    '/api/v1/content/{typeName}/group/{localeGroupId}',
                    'delete'
                )
            ).toBeUndefined();
        });

        it('describes the discovery routes', () => {
            const document = scannedDocument();
            describeContentApi(document, [article]);

            expect(
                successSchema(document, '/api/v1/content-types', 'get')
            ).toEqual({
                $ref: '#/components/schemas/PublicContentTypeList'
            });
            expect(
                successSchema(document, '/api/v1/content-types/{name}', 'get')
            ).toEqual({ $ref: '#/components/schemas/ContentTypeSchema' });
        });

        it('drops every reference field from the public values bag', () => {
            const document = scannedDocument();
            describeContentApi(document, [article]);

            // The admin's bag keeps the owning single relation's FK; the public
            // read omits it, because nothing here resolves it and a bare uuid
            // is an identifier with no route to follow.
            const admin = document.components?.schemas?.['ArticleValues'] as {
                properties: Record<string, unknown>;
            };
            const published = document.components?.schemas?.[
                'PublicArticleValues'
            ] as { properties: Record<string, unknown> };
            expect(Object.keys(admin.properties)).toEqual(['title', 'author']);
            expect(Object.keys(published.properties)).toEqual(['title']);
        });

        it('carries `translations` only on a localized type', () => {
            const document = scannedDocument();
            describeContentApi(document, [
                article,
                { ...article, name: 'story', label: 'Stories', i18n: true }
            ]);

            const flat = document.components?.schemas?.[
                'PublicArticleEntry'
            ] as { properties: Record<string, unknown> };
            const localized = document.components?.schemas?.[
                'PublicStoryEntry'
            ] as { properties: Record<string, unknown> };
            expect(flat['properties']['translations']).toBeUndefined();
            expect(localized['properties']['translations']).toBeDefined();
            expect(localized['properties']['localeGroupId']).toBeDefined();
        });
    });

    describe('routes another plugin mounts under a `{typeName}` prefix', () => {
        it('constrains the parameter, because only the registry knows the names', () => {
            const document = scannedDocument();
            describeContentApi(document, [article, settings]);

            for (const [route, method] of [
                ['/api/content/{typeName}/export', 'post'],
                ['/api/v1/content/{typeName}/{id}/access', 'put']
            ] as const) {
                const operation = document.paths[route][method] as {
                    parameters: { name: string; schema: { enum?: string[] } }[];
                };
                const parameter = operation.parameters.find(
                    (candidate) => candidate.name === 'typeName'
                );
                expect(parameter?.schema.enum).toEqual([
                    'article',
                    'site_settings'
                ]);
            }
        });

        it('describes neither their bodies nor their failures', () => {
            const document = scannedDocument();
            describeContentApi(document, [article, settings]);

            // The bodies belong to the plugins that serve the routes. So do the
            // failures, and they do not agree: transfer 404s an unknown type,
            // the public access route answers 400 — so writing this plugin's
            // 404 onto both would publish something the API does not do.
            for (const [route, method] of [
                ['/api/content/{typeName}/export', 'post'],
                ['/api/v1/content/{typeName}/{id}/access', 'put']
            ] as const) {
                expect(successSchema(document, route, method)).toBeUndefined();
                const operation = document.paths[route][method] as {
                    responses: Record<string, unknown>;
                };
                expect(Object.keys(operation.responses)).toEqual(['200']);
            }
        });
    });
});
