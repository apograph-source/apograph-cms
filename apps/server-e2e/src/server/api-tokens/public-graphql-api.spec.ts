import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    expireApiToken,
    resetDb,
    seedActiveUser,
    seedArticleTags,
    seedArticles,
    seedAuthors,
    seedContentGrants,
    seedLanding,
    seedTags,
    seedWorkspace
} from '../../support/seed';

const ADMIN_EMAIL = 'public-graphql-admin@example.com';
const PASSWORD = 'SecurePass123!';

/** The GraphQL-over-HTTP response envelope, as far as these tests read it. */
interface GraphqlBody {
    data?: Record<string, unknown>;
    errors?: {
        message: string;
        extensions?: { code?: string; status?: number; issues?: unknown };
    }[];
}

/**
 * `/api/v1/graphql` — the PUBLIC content API over GraphQL.
 *
 * The suite is organised around the four invariants this protocol had to
 * inherit rather than re-derive: a token authenticates the same way, sees only
 * its workspace's granted content types, never sees a draft without write
 * scope, and gets the same records the REST routes serve. The last one is
 * asserted as literal **parity** — same fixture, both protocols, compared —
 * because that is the claim the whole design rests on.
 */
describe('Public GraphQL API (/api/v1/graphql)', () => {
    let harness: TestApp;
    let workspaceId: string;
    let otherWorkspaceId: string;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        await seedActiveUser(harness.app, {
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
        workspaceId = (await seedWorkspace({ name: 'WS A', slug: 'ws-a' })).id;
        otherWorkspaceId = (await seedWorkspace({ name: 'WS B', slug: 'ws-b' }))
            .id;
        // `test_page` is deliberately left ungranted, so the schema has
        // something to prune.
        await seedContentGrants(workspaceId, [
            'test_article',
            'test_tag',
            'test_author',
            'test_landing'
        ]);
        await seedContentGrants(otherWorkspaceId, ['test_article']);
    });

    /** Logs in as the admin and returns a cookie-bearing agent. */
    async function login() {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email: ADMIN_EMAIL, password: PASSWORD })
            .expect(201);
        return agent;
    }

    /**
     * Mints a token through the real management API, id included — the id is
     * what the revocation case needs, and a secret alone cannot be revoked.
     */
    async function mintTokenRecord(options: {
        workspaceIds: string[];
        scope?: 'read' | 'full';
    }): Promise<{ id: string; secret: string }> {
        const agent = await login();
        const res = await agent
            .post('/api/api-tokens')
            .send({
                name: 'e2e-graphql',
                workspaceIds: options.workspaceIds,
                scope: options.scope ?? 'read'
            })
            .expect(201);
        return { id: res.body.id as string, secret: res.body.secret as string };
    }

    /** Mints a token through the real management API and returns its secret. */
    async function mintToken(options: {
        workspaceIds: string[];
        scope?: 'read' | 'full';
    }): Promise<string> {
        return (await mintTokenRecord(options)).secret;
    }

    /** Runs one operation and returns the GraphQL envelope. */
    async function gql(
        secret: string,
        query: string,
        options: {
            variables?: Record<string, unknown>;
            workspace?: string;
            expect?: number;
        } = {}
    ): Promise<GraphqlBody> {
        const req = request(harness.server)
            .post('/api/v1/graphql')
            .set('Authorization', `Bearer ${secret}`)
            .send({
                query,
                ...(options.variables ? { variables: options.variables } : {})
            });
        if (options.workspace) {
            req.set('X-Workspace-Id', options.workspace);
        }
        const res = await req.expect(options.expect ?? 200);
        return res.body as GraphqlBody;
    }

    /** Seeds one published article and returns its id. */
    async function seedPublished(
        text: string,
        extra: Record<string, unknown> = {},
        ws = workspaceId
    ): Promise<string> {
        const [id] = await seedArticles(
            [
                {
                    text,
                    select: 'article',
                    status: 'published',
                    publishedAt: new Date(),
                    ...extra
                }
            ],
            ws
        );
        return id;
    }

    // ---- authentication ---------------------------------------------------
    //
    // The endpoint carries the SAME guards as every other `/v1` route, so these
    // are less about GraphQL than about proving the reuse is real: if any of
    // them regressed, it would mean a second authentication path had appeared.

    describe('authentication', () => {
        it('401s without an Authorization header', async () => {
            await request(harness.server)
                .post('/api/v1/graphql')
                .send({ query: '{ contentTypes { name } }' })
                .expect(401);
        });

        it('401s on an unknown bearer token', async () => {
            await request(harness.server)
                .post('/api/v1/graphql')
                .set('Authorization', 'Bearer orthacms_not-a-real-token')
                .send({ query: '{ contentTypes { name } }' })
                .expect(401);
        });

        it('does not accept a session cookie in place of a token', async () => {
            const agent = await login();
            await agent
                .post('/api/v1/graphql')
                .send({ query: '{ contentTypes { name } }' })
                .expect(401);
        });

        // Revocation and expiry are meant to kill *every* surface at once — the
        // credential dies at `ApiTokenService.verify`, upstream of any protocol.
        // GraphQL only ever tested the unknown token, which is the one case a
        // second, GraphQL-specific auth path would also have got right.

        it('401s once the token is revoked', async () => {
            const { id, secret } = await mintTokenRecord({
                workspaceIds: [workspaceId]
            });
            expect(
                (await gql(secret, '{ contentTypes { name } }')).errors
            ).toBeUndefined();

            const agent = await login();
            await agent.delete(`/api/api-tokens/${id}`).expect(204);

            await request(harness.server)
                .post('/api/v1/graphql')
                .set('Authorization', `Bearer ${secret}`)
                .send({ query: '{ contentTypes { name } }' })
                .expect(401);
        });

        it('401s once the token has expired', async () => {
            const { id, secret } = await mintTokenRecord({
                workspaceIds: [workspaceId]
            });
            expect(
                (await gql(secret, '{ contentTypes { name } }')).errors
            ).toBeUndefined();

            await expireApiToken(id);

            // A flat HTTP 401, not a GraphQL `errors` envelope with `data: null`
            // — the guard runs before the schema is ever consulted, and a
            // caller must not have to parse a 200 to learn its key is dead.
            await request(harness.server)
                .post('/api/v1/graphql')
                .set('Authorization', `Bearer ${secret}`)
                .send({ query: '{ contentTypes { name } }' })
                .expect(401);
        });

        it('403s on a workspace outside the token’s bucket', async () => {
            const secret = await mintToken({ workspaceIds: [workspaceId] });
            await request(harness.server)
                .post('/api/v1/graphql')
                .set('Authorization', `Bearer ${secret}`)
                .set('X-Workspace-Id', otherWorkspaceId)
                .send({ query: '{ contentTypes { name } }' })
                .expect(403);
        });

        it('400s when a multi-workspace token names no workspace', async () => {
            const secret = await mintToken({
                workspaceIds: [workspaceId, otherWorkspaceId]
            });
            await request(harness.server)
                .post('/api/v1/graphql')
                .set('Authorization', `Bearer ${secret}`)
                .send({ query: '{ contentTypes { name } }' })
                .expect(400);
        });

        it('needs no header when the token covers exactly one workspace', async () => {
            const secret = await mintToken({ workspaceIds: [workspaceId] });
            const body = await gql(secret, '{ contentTypes { name } }');

            expect(body.errors).toBeUndefined();
        });
    });

    // ---- grant pruning ----------------------------------------------------

    describe('grant pruning', () => {
        it('omits an ungranted content type from the schema entirely [content:I-27]', async () => {
            const secret = await mintToken({ workspaceIds: [workspaceId] });
            const sdl = await request(harness.server)
                .get('/api/v1/graphql')
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            expect(sdl.text).toContain('type TestArticle');
            expect(sdl.text).not.toContain('type TestPage');
        });

        it('refuses a query naming an ungranted type before any resolver runs', async () => {
            // Stronger than the REST 404: the field does not exist in this
            // workspace's schema, so the document fails validation.
            const secret = await mintToken({ workspaceIds: [workspaceId] });
            const body = await gql(secret, '{ testPages { total } }');

            expect(body.data).toBeUndefined();
            expect(body.errors?.[0].message).toMatch(/Cannot query field/);
        });

        it('lists exactly the granted types for discovery', async () => {
            const secret = await mintToken({ workspaceIds: [workspaceId] });
            const body = await gql(secret, '{ contentTypes { name i18n } }');
            const names = (
                body.data?.['contentTypes'] as { name: string }[]
            ).map((type) => type.name);

            expect(names).toEqual(
                expect.arrayContaining(['test_article', 'test_tag'])
            );
            expect(names).not.toContain('test_page');
        });

        it('gives two workspaces different schemas [content:I-27]', async () => {
            // Introspection legitimately differs per token — that is what stops
            // a token enumerating content its workspace does not expose.
            const secret = await mintToken({
                workspaceIds: [workspaceId, otherWorkspaceId]
            });
            const first = await request(harness.server)
                .get('/api/v1/graphql')
                .set('Authorization', `Bearer ${secret}`)
                .set('X-Workspace-Id', workspaceId)
                .expect(200);
            const second = await request(harness.server)
                .get('/api/v1/graphql')
                .set('Authorization', `Bearer ${secret}`)
                .set('X-Workspace-Id', otherWorkspaceId)
                .expect(200);

            expect(first.text).toContain('type TestTag');
            expect(second.text).not.toContain('type TestTag');
        });
    });

    // ---- reads ------------------------------------------------------------

    describe('reads', () => {
        it('returns published entries and their values', async () => {
            await seedPublished('Hello world', { number: 7 });
            const secret = await mintToken({ workspaceIds: [workspaceId] });

            const body = await gql(
                secret,
                '{ testArticles { items { text number status } total } }'
            );

            expect(body.errors).toBeUndefined();
            expect(body.data?.['testArticles']).toMatchObject({
                total: 1,
                items: [{ text: 'Hello world', number: 7, status: 'PUBLISHED' }]
            });
        });

        it('hides a draft from a read-only token', async () => {
            await seedArticles(
                [{ text: 'Unpublished', select: 'article', status: 'draft' }],
                workspaceId
            );
            const secret = await mintToken({ workspaceIds: [workspaceId] });

            const body = await gql(secret, '{ testArticles { total } }');

            expect(body.data?.['testArticles']).toMatchObject({ total: 0 });
        });

        it('hides entries from another workspace', async () => {
            await seedPublished('Theirs', {}, otherWorkspaceId);
            const secret = await mintToken({ workspaceIds: [workspaceId] });

            const body = await gql(secret, '{ testArticles { total } }');

            expect(body.data?.['testArticles']).toMatchObject({ total: 0 });
        });

        it('reads one entry by id', async () => {
            const id = await seedPublished('By id');
            const secret = await mintToken({ workspaceIds: [workspaceId] });

            const body = await gql(
                secret,
                'query Q($id: ID!) { testArticle(id: $id) { id text } }',
                { variables: { id } }
            );

            expect(body.data?.['testArticle']).toMatchObject({
                id,
                text: 'By id'
            });
        });

        it('serves a single-kind type as one record, not a list', async () => {
            // Over REST a `single` is served by the list route and every client
            // writes `items[0]`; here the shape says what it is.
            await seedLanding([{ text: 'Welcome' }], workspaceId);
            const secret = await mintToken({ workspaceIds: [workspaceId] });

            const body = await gql(secret, '{ testLanding { text } }');

            expect(body.data?.['testLanding']).toMatchObject({
                text: 'Welcome'
            });
        });

        it('filters with the same tree the REST `?filter=` takes', async () => {
            await seedPublished('Keep', { number: 5 });
            await seedPublished('Drop', { number: 99 });
            const secret = await mintToken({ workspaceIds: [workspaceId] });

            const body = await gql(
                secret,
                `query Q($f: JSON) { testArticles(filter: $f) { items { text } total } }`,
                {
                    variables: {
                        f: { and: [{ field: 'number', op: 'eq', value: 5 }] }
                    }
                }
            );

            expect(body.data?.['testArticles']).toMatchObject({
                total: 1,
                items: [{ text: 'Keep' }]
            });
        });

        it('searches, sorts and paginates', async () => {
            await seedPublished('Alpha');
            await seedPublished('Beta');
            const secret = await mintToken({ workspaceIds: [workspaceId] });

            const body = await gql(
                secret,
                '{ testArticles(search: "Alp", pageSize: 1, sort: "text") { items { text } total } }'
            );

            expect(body.data?.['testArticles']).toMatchObject({
                total: 1,
                items: [{ text: 'Alpha' }]
            });
        });
    });

    // ---- parity with REST -------------------------------------------------

    describe('parity with the REST API', () => {
        it('returns the same record over both protocols', async () => {
            // The load-bearing test: GraphQL is an adapter over the REST read
            // path, so the same fixture must come back the same either way.
            const id = await seedPublished('Parity', {
                number: 3,
                boolean: true,
                select: 'tutorial'
            });
            const secret = await mintToken({ workspaceIds: [workspaceId] });

            const rest = await request(harness.server)
                .get(`/api/v1/content/test_article/${id}`)
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);
            const body = await gql(
                secret,
                `query Q($id: ID!) {
                    testArticle(id: $id) {
                        id createdAt updatedAt publishedAt status locale
                        text number boolean select
                    }
                }`,
                { variables: { id } }
            );
            const graph = body.data?.['testArticle'] as Record<string, unknown>;

            expect(graph['id']).toBe(rest.body.id);
            expect(graph['createdAt']).toBe(rest.body.createdAt);
            expect(graph['updatedAt']).toBe(rest.body.updatedAt);
            expect(graph['publishedAt']).toBe(rest.body.publishedAt);
            expect(graph['locale']).toBe(rest.body.locale);
            // The enum is the one deliberate spelling difference: GraphQL enum
            // names are upper-case by convention, and the value maps back.
            expect(graph['status']).toBe(
                String(rest.body.status).toUpperCase()
            );
            expect(graph['text']).toBe(rest.body.values.text);
            expect(graph['number']).toBe(rest.body.values.number);
            expect(graph['boolean']).toBe(rest.body.values.boolean);
            expect(graph['select']).toBe(rest.body.values.select);
        });

        it('agrees on which entries are visible', async () => {
            await seedPublished('Live');
            await seedArticles(
                [{ text: 'Hidden', select: 'article', status: 'draft' }],
                workspaceId
            );
            const secret = await mintToken({ workspaceIds: [workspaceId] });

            const rest = await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);
            const body = await gql(secret, '{ testArticles { total } }');

            expect(
                (body.data?.['testArticles'] as { total: number }).total
            ).toBe(rest.body.total);
        });
    });

    // ---- relations, media, translations -----------------------------------

    describe('expansions', () => {
        it('expands a many-to-many relation', async () => {
            const articleId = await seedPublished('With tags');
            const tagIds = await seedTags(
                [
                    {
                        name: 'alpha',
                        status: 'published',
                        publishedAt: new Date()
                    },
                    {
                        name: 'beta',
                        status: 'published',
                        publishedAt: new Date()
                    }
                ],
                workspaceId
            );
            await seedArticleTags(articleId, tagIds);
            const secret = await mintToken({ workspaceIds: [workspaceId] });

            const body = await gql(
                secret,
                '{ testArticles { items { text tags { items { name } total } } } }'
            );

            expect(body.errors).toBeUndefined();
            const [article] = (
                body.data?.['testArticles'] as {
                    items: {
                        tags: { items: { name: string }[]; total: number };
                    }[];
                }
            ).items;
            expect(article.tags.total).toBe(2);
            expect(article.tags.items.map((tag) => tag.name).sort()).toEqual([
                'alpha',
                'beta'
            ]);
        });

        it('serves an owning single relation as the target itself', async () => {
            const [authorId] = await seedAuthors(
                [{ name: 'Ada', status: 'published', publishedAt: new Date() }],
                workspaceId
            );
            // The FK's Drizzle property is the field name, not `<field>Id`.
            await seedPublished('By Ada', { author: authorId });
            const secret = await mintToken({ workspaceIds: [workspaceId] });

            const body = await gql(
                secret,
                '{ testArticles { items { text author { name } } } }'
            );
            const [article] = (
                body.data?.['testArticles'] as {
                    items: { author: { name: string } | null }[];
                }
            ).items;

            expect(body.errors).toBeUndefined();
            expect(article.author).toEqual({ name: 'Ada' });
        });

        it('respects a relation page size and still reports the true total', async () => {
            const articleId = await seedPublished('Many tags');
            const tagIds = await seedTags(
                ['a', 'b', 'c'].map((name) => ({
                    name,
                    status: 'published',
                    publishedAt: new Date()
                })),
                workspaceId
            );
            await seedArticleTags(articleId, tagIds);
            const secret = await mintToken({ workspaceIds: [workspaceId] });

            const body = await gql(
                secret,
                '{ testArticles { items { tags(pageSize: 2) { items { name } total } } } }'
            );

            expect(body.errors).toBeUndefined();
            const [article] = (
                body.data?.['testArticles'] as {
                    items: { tags: { items: unknown[]; total: number } }[];
                }
            ).items;

            expect(article.tags.items).toHaveLength(2);
            // A short page is observable rather than passing for the whole set.
            expect(article.tags.total).toBe(3);
        });

        it('attaches sibling translations', async () => {
            const groupId = randomUUID();
            await seedArticles(
                [
                    {
                        text: 'English',
                        select: 'article',
                        locale: 'en',
                        localeGroupId: groupId,
                        status: 'published',
                        publishedAt: new Date()
                    },
                    {
                        text: 'Deutsch',
                        select: 'article',
                        locale: 'de',
                        localeGroupId: groupId,
                        status: 'published',
                        publishedAt: new Date()
                    }
                ],
                workspaceId
            );
            const secret = await mintToken({ workspaceIds: [workspaceId] });

            const body = await gql(
                secret,
                '{ testArticles { items { text locale translations { text locale } } } }'
            );

            expect(body.errors).toBeUndefined();
            const [article] = (
                body.data?.['testArticles'] as {
                    items: {
                        locale: string;
                        translations: { text: string; locale: string }[];
                    }[];
                }
            ).items;
            // The default locale is what a read without `locale:` returns, and
            // the entry is never repeated inside its own translations.
            expect(article.locale).toBe('en');
            expect(article.translations).toEqual([
                { text: 'Deutsch', locale: 'de' }
            ]);
        });

        it('reads a record by its translation group in a chosen locale', async () => {
            // The group id is the stable identity of a story across languages,
            // so a localized front-end varies `locale:` alone.
            const groupId = randomUUID();
            await seedArticles(
                [
                    {
                        text: 'English',
                        select: 'article',
                        locale: 'en',
                        localeGroupId: groupId,
                        status: 'published',
                        publishedAt: new Date()
                    },
                    {
                        text: 'Deutsch',
                        select: 'article',
                        locale: 'de',
                        localeGroupId: groupId,
                        status: 'published',
                        publishedAt: new Date()
                    }
                ],
                workspaceId
            );
            const secret = await mintToken({ workspaceIds: [workspaceId] });

            const body = await gql(
                secret,
                'query Q($g: ID!) { testArticle(localeGroupId: $g, locale: "de") { text locale } }',
                { variables: { g: groupId } }
            );

            expect(body.data?.['testArticle']).toEqual({
                text: 'Deutsch',
                locale: 'de'
            });
        });
    });

    // ---- draft visibility -------------------------------------------------

    describe('draft visibility', () => {
        it('refuses `status: DRAFT` for a read-only token', async () => {
            const secret = await mintToken({
                workspaceIds: [workspaceId],
                scope: 'read'
            });

            const body = await gql(
                secret,
                '{ testArticles(status: DRAFT) { total } }'
            );

            expect(body.errors?.[0].extensions).toMatchObject({
                code: 'FORBIDDEN',
                status: 403
            });
        });

        it('allows it for a write-scoped token', async () => {
            await seedArticles(
                [
                    {
                        text: 'Work in progress',
                        select: 'article',
                        status: 'draft'
                    }
                ],
                workspaceId
            );
            const secret = await mintToken({
                workspaceIds: [workspaceId],
                scope: 'full'
            });

            const body = await gql(
                secret,
                '{ testArticles(status: DRAFT) { items { text } total } }'
            );

            expect(body.errors).toBeUndefined();
            expect(body.data?.['testArticles']).toMatchObject({ total: 1 });
        });
    });

    // ---- mutations --------------------------------------------------------

    describe('mutations', () => {
        it('refuses every write for a read-scoped token', async () => {
            const secret = await mintToken({
                workspaceIds: [workspaceId],
                scope: 'read'
            });

            const body = await gql(
                secret,
                'mutation { createTestArticle(input: { text: "Nope", select: article }) { id } }'
            );

            expect(body.errors?.[0].extensions).toMatchObject({
                code: 'FORBIDDEN',
                status: 403
            });
        });

        it('runs the create → update → publish → delete lifecycle', async () => {
            const secret = await mintToken({
                workspaceIds: [workspaceId],
                scope: 'full'
            });

            const created = await gql(
                secret,
                'mutation { createTestArticle(input: { text: "Fresh draft", select: article }) { id status text } }'
            );
            expect(created.errors).toBeUndefined();
            const article = created.data?.['createTestArticle'] as {
                id: string;
                status: string;
                text: string;
            };
            expect(article).toMatchObject({
                status: 'DRAFT',
                text: 'Fresh draft'
            });

            const updated = await gql(
                secret,
                'mutation M($id: ID!) { updateTestArticle(id: $id, input: { text: "Edited" }) { text select } }',
                { variables: { id: article.id } }
            );
            expect(updated.errors).toBeUndefined();
            expect(updated.data?.['updateTestArticle']).toMatchObject({
                text: 'Edited',
                // The partial update left the field it never mentioned alone —
                // the absent-vs-null distinction, end to end.
                select: 'article'
            });

            const published = await gql(
                secret,
                'mutation M($id: ID!) { publishTestArticle(id: $id) { status } }',
                { variables: { id: article.id } }
            );
            expect(published.data?.['publishTestArticle']).toMatchObject({
                status: 'PUBLISHED'
            });

            const removed = await gql(
                secret,
                'mutation M($id: ID!) { deleteTestArticle(id: $id) }',
                { variables: { id: article.id } }
            );
            expect(removed.data?.['deleteTestArticle']).toBe(true);

            const after = await gql(secret, '{ testArticles { total } }');
            expect(after.data?.['testArticles']).toMatchObject({ total: 0 });
        });

        it('clears a field with an explicit null but not by omission', async () => {
            const secret = await mintToken({
                workspaceIds: [workspaceId],
                scope: 'full'
            });
            const created = await gql(
                secret,
                'mutation { createTestArticle(input: { text: "Keeps richtext", richtext: "body", select: article }) { id } }'
            );
            const id = (created.data?.['createTestArticle'] as { id: string })
                .id;

            const omitted = await gql(
                secret,
                'mutation M($id: ID!) { updateTestArticle(id: $id, input: { text: "Renamed" }) { richtext } }',
                { variables: { id } }
            );
            expect(omitted.data?.['updateTestArticle']).toMatchObject({
                richtext: 'body'
            });

            const cleared = await gql(
                secret,
                'mutation M($id: ID!) { updateTestArticle(id: $id, input: { richtext: null }) { richtext } }',
                { variables: { id } }
            );
            expect(cleared.data?.['updateTestArticle']).toMatchObject({
                richtext: null
            });
        });

        it('reports a failed publish as a 422 with its per-field issues', async () => {
            const secret = await mintToken({
                workspaceIds: [workspaceId],
                scope: 'full'
            });
            // `text` has minLength 3 — legal in a draft, not at publish.
            const created = await gql(
                secret,
                'mutation { createTestArticle(input: { text: "ab", select: article }) { id } }'
            );
            const id = (created.data?.['createTestArticle'] as { id: string })
                .id;

            const published = await gql(
                secret,
                'mutation M($id: ID!) { publishTestArticle(id: $id) { status } }',
                { variables: { id } }
            );

            expect(published.errors?.[0].extensions).toMatchObject({
                code: 'VALIDATION_FAILED',
                status: 422
            });
            expect(published.errors?.[0].extensions?.issues).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ field: 'text' })
                ])
            );
        });

        it('applies a relation delta', async () => {
            const secret = await mintToken({
                workspaceIds: [workspaceId],
                scope: 'full'
            });
            const tagIds = await seedTags(
                [
                    {
                        name: 'linked',
                        status: 'published',
                        publishedAt: new Date()
                    }
                ],
                workspaceId
            );
            const created = await gql(
                secret,
                'mutation { createTestArticle(input: { text: "With a tag", select: article }) { id } }'
            );
            const id = (created.data?.['createTestArticle'] as { id: string })
                .id;

            const linked = await gql(
                secret,
                `mutation M($id: ID!, $tag: ID!) {
                    updateTestArticle(
                        id: $id
                        input: {}
                        relations: { tags: { link: [$tag] } }
                    ) { tags { total } }
                }`,
                { variables: { id, tag: tagIds[0] } }
            );

            expect(linked.errors).toBeUndefined();
            // Asserting the COUNT, not just the absence of an error: a create
            // and an update both hand back a draft, and the nested re-read used
            // to run through the published-only rule — so this answered `0` for
            // links the same call had just written.
            expect(linked.data?.['updateTestArticle']).toEqual({
                tags: { total: 1 }
            });
        });

        it('reads back a relation written by the same create', async () => {
            const secret = await mintToken({
                workspaceIds: [workspaceId],
                scope: 'full'
            });
            const tagIds = await seedTags(
                [
                    {
                        name: 'fresh',
                        status: 'published',
                        publishedAt: new Date()
                    }
                ],
                workspaceId
            );

            const created = await gql(
                secret,
                `mutation M($tag: ID!) {
                    createTestArticle(
                        input: { text: "Fresh", select: article }
                        relations: { tags: { link: [$tag] } }
                    ) { status tags { total items { name } } }
                }`,
                { variables: { tag: tagIds[0] } }
            );

            expect(created.errors).toBeUndefined();
            expect(created.data?.['createTestArticle']).toMatchObject({
                status: 'DRAFT',
                tags: { total: 1, items: [{ name: 'fresh' }] }
            });
        });

        it('does not widen draft visibility for a read-only token', async () => {
            // The counterpart to the two above: the nested re-read carries the
            // visibility of the entry in hand, and a read-only token can never
            // be holding a draft in the first place.
            const full = await mintToken({
                workspaceIds: [workspaceId],
                scope: 'full'
            });
            const created = await gql(
                full,
                'mutation { createTestArticle(input: { text: "Hidden", select: article }) { id } }'
            );
            const id = (created.data?.['createTestArticle'] as { id: string })
                .id;

            const readOnly = await mintToken({ workspaceIds: [workspaceId] });
            const body = await gql(
                readOnly,
                `query Q($id: ID!) { testArticle(id: $id) { id tags { total } } }`,
                { variables: { id } }
            );

            expect(body.data?.['testArticle']).toBeNull();
            expect(body.errors?.[0]?.extensions?.['status']).toBe(404);
        });
    });

    // ---- read-argument parity ---------------------------------------------
    //
    // ADR-0008's premise is that a token cannot reach further over GraphQL than
    // over REST. A REST query string meets the host's global `ValidationPipe`;
    // a GraphQL argument never does, so the read DTO is validated in the
    // resolver — without it `pageSize: -1` reached `.limit(-1)` and came back
    // as an opaque 500 where REST returns a clean 400.

    describe('read arguments are bounded exactly as REST bounds them', () => {
        it.each([
            ['pageSize below the minimum', 'pageSize: -1', 'pageSize=-1'],
            ['a page below the minimum', 'page: 0', 'page=0'],
            ['pageSize past MAX_PAGE_SIZE', 'pageSize: 500', 'pageSize=500']
            // covers: content:I-29
        ])('refuses %s over both protocols', async (_name, arg, query) => {
            const secret = await mintToken({ workspaceIds: [workspaceId] });

            const rest = await request(harness.server)
                .get(`/api/v1/content/test_article?${query}`)
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);
            const graphql = await gql(
                secret,
                `{ testArticles(${arg}) { total } }`
            );

            expect(graphql.errors?.[0]?.extensions?.['status']).toBe(400);
            expect(graphql.errors?.[0]?.extensions?.['code']).toBe(
                'BAD_REQUEST'
            );
            // Same words, from the same decorators — one rule, two protocols.
            expect(graphql.errors?.[0]?.message).toBe(
                (rest.body.message as string[]).join('; ')
            );
        });

        it('caps a search needle passed as a variable', async () => {
            // The document stays short, so `maxQueryLength` never sees it —
            // the DTO's own `@MaxLength` is the only thing standing there.
            const secret = await mintToken({ workspaceIds: [workspaceId] });
            const body = await gql(
                secret,
                'query Q($s: String) { testArticles(search: $s) { total } }',
                { variables: { s: 'x'.repeat(10_000) } }
            );

            expect(body.errors?.[0]?.extensions?.['status']).toBe(400);
            expect(body.errors?.[0]?.message).toMatch(/search must be shorter/);
        });

        it('still accepts the boundary values REST accepts', async () => {
            const secret = await mintToken({ workspaceIds: [workspaceId] });

            expect(
                (
                    await gql(
                        secret,
                        '{ testArticles(page: 1, pageSize: 100) { total } }'
                    )
                ).errors
            ).toBeUndefined();
        });
    });

    // ---- cost limits ------------------------------------------------------
    //
    // Only the limit that needs no tightened config lives here. The rest boot a
    // dedicated app, which ends the shared per-file pool, so they get their own
    // file (`public-graphql-limits.spec.ts`) — the same arrangement as the
    // login-throttle suite.

    describe('cost limits', () => {
        it('refuses a multi-operation document with no operationName', async () => {
            const secret = await mintToken({ workspaceIds: [workspaceId] });
            const body = await gql(
                secret,
                'query A { testArticles { total } } query B { testArticles { total } }'
            );

            expect(body.errors?.[0].message).toMatch(
                /one operation per request/
            );
        });
    });

    // ---- developer tooling ------------------------------------------------

    describe('the GraphiQL playground', () => {
        // This harness boots with `docs.enabled` false — the production
        // default — so it is the right place to assert the page is absent.
        // The served page is covered by `public-graphql-playground.spec.ts`,
        // which boots its own app with tooling on.

        it('is not served when developer tooling is off', async () => {
            // Registration-level: the controller is never registered, so there
            // is no handler to reach rather than one that refuses.
            await request(harness.server)
                .get('/api/v1/graphql/playground')
                .expect(404);
        });

        it('does not take the API down with it', async () => {
            const secret = await mintToken({ workspaceIds: [workspaceId] });
            const body = await gql(secret, '{ contentTypes { name } }');

            expect(body.errors).toBeUndefined();
        });
    });

    // ---- error shape ------------------------------------------------------

    describe('errors', () => {
        it('reports a field error as HTTP 200 with the REST status in extensions', async () => {
            // The one thing a consumer porting from REST has to adjust to.
            const secret = await mintToken({ workspaceIds: [workspaceId] });
            const body = await gql(secret, '{ testArticle { id } }');

            expect(body.errors?.[0].extensions).toMatchObject({
                code: 'BAD_REQUEST',
                status: 400
            });
        });

        it('400s a body that is not a GraphQL request', async () => {
            const secret = await mintToken({ workspaceIds: [workspaceId] });
            await request(harness.server)
                .post('/api/v1/graphql')
                .set('Authorization', `Bearer ${secret}`)
                .send({ notAQuery: true })
                .expect(400);
        });
    });
});
