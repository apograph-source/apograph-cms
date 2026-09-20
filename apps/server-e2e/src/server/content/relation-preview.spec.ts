import request from 'supertest';
import { getPool } from '@ortha/database';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    resetDb,
    seedActiveUser,
    seedAllContentGrants,
    seedArticleTags,
    seedArticles,
    seedAuthors,
    seedMembership,
    seedTags,
    seedWorkspace,
    type SeededUser
} from '../../support/seed';

const ADMIN_EMAIL = 'relation-preview-admin@example.com';
const PASSWORD = 'SecurePass123!';

/** Mirrors the server's `RELATION_PAGE_SIZE` — the per-field preview cap. */
const RELATION_PAGE_SIZE = 20;

/** One linked record as the preview serves it. */
interface RelationRef {
    id: string;
    title: string;
    slug?: string;
    status?: string;
    /** Set when the id resolved to no visible row — its `title` is the raw id. */
    missing?: boolean;
}

/** One relation field's preview: a capped page plus the true total. */
interface RelationPreview {
    items: RelationRef[];
    total: number;
}

/** Shape of one list item (only the asserted bits). */
interface EntryItem {
    id: string;
    values: Record<string, unknown>;
    relations?: Record<string, RelationPreview>;
}

/**
 * `GET /api/content/:typeName?relations=preview` — the capped relation preview
 * the admin records table renders its relation columns from.
 *
 * Covers the opt-in (absent by default), all three storage forms (owning single
 * FK, owning many-to-many, and the inverse of one), the per-field page cap with
 * a true total, the visible-columns scoping, and — the load-bearing one — that
 * the resolver is **batched**: its query count is flat in the number of rows on
 * the page, so it can never regress into an N+1 over rows.
 */
describe('Content relation preview (GET /api/content/:typeName?relations=preview)', () => {
    let harness: TestApp;
    let admin: SeededUser;
    let workspaceId: string;
    /** The article carrying the seeded author + tag links. */
    let articleId: string;
    let authorId: string;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        admin = await seedActiveUser(harness.app, {
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
        const ws = await seedWorkspace({ name: 'WS Rel', slug: 'ws-rel' });
        workspaceId = ws.id;
        await seedMembership(admin.id, workspaceId);
        await seedAllContentGrants(workspaceId);

        [authorId] = await seedAuthors([{ name: 'Ada Lovelace' }], workspaceId);
        const articleIds = await seedArticles(
            [
                { text: 'Alpha', select: 'article', author: authorId },
                { text: 'Bravo', select: 'tutorial' }
            ],
            workspaceId
        );
        articleId = articleIds[0];
    });

    async function login() {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email: ADMIN_EMAIL, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', workspaceId);
        return agent;
    }

    /** Fetch the article list, optionally opting into a relation preview. */
    async function listArticles(
        query: Record<string, string | number> = {}
    ): Promise<EntryItem[]> {
        const agent = await login();
        const res = await agent
            .get('/api/content/test_article')
            .query({ sort: 'text', ...query })
            .expect(200);
        return res.body.items as EntryItem[];
    }

    describe('opt-in', () => {
        it('omits `relations` entirely when not requested', async () => {
            const items = await listArticles();
            expect(items).toHaveLength(2);
            for (const item of items) {
                expect(item.relations).toBeUndefined();
            }
        });

        it('omits `relations` when `relations=preview` names no fields', async () => {
            const items = await listArticles({ relations: 'preview' });
            for (const item of items) {
                expect(item.relations).toBeUndefined();
            }
        });

        it('previews only the named fields, so a hidden column costs nothing', async () => {
            await seedArticleTags(
                articleId,
                await seedTags([{ name: 'Design' }], workspaceId)
            );
            const [alpha] = await listArticles({
                relations: 'preview',
                relationFields: 'author'
            });
            expect(alpha.relations?.['author']).toBeDefined();
            // `tags` was not requested — it must not be resolved.
            expect(alpha.relations?.['tags']).toBeUndefined();
        });

        it('drops unknown field names instead of failing the request', async () => {
            const [alpha] = await listArticles({
                relations: 'preview',
                relationFields: 'author,not_a_field,text'
            });
            // `not_a_field` is unknown and `text` is not a relation — both are
            // dropped, leaving just the real relation.
            expect(Object.keys(alpha.relations ?? {})).toEqual(['author']);
        });
    });

    describe('storage forms', () => {
        it('resolves an owning single relation (many-to-one) to a titled ref', async () => {
            const [alpha, bravo] = await listArticles({
                relations: 'preview',
                relationFields: 'author'
            });

            expect(alpha.relations?.['author']).toEqual({
                items: [
                    expect.objectContaining({
                        id: authorId,
                        title: 'Ada Lovelace'
                    })
                ],
                total: 1
            });
            // The FK still rides `values` — the preview is additive, and a save
            // submits the id back from there.
            expect(alpha.values['author']).toBe(authorId);
            // An article with no author gets no entry for the field.
            expect(bravo.relations?.['author']).toBeUndefined();
        });

        it('resolves an owning many-to-many, ordered by position', async () => {
            const tagIds = await seedTags(
                [
                    { name: 'Design', slug: 'design' },
                    { name: 'Engineering', slug: 'engineering' }
                ],
                workspaceId
            );
            await seedArticleTags(articleId, tagIds);

            const [alpha] = await listArticles({
                relations: 'preview',
                relationFields: 'tags'
            });
            const preview = alpha.relations?.['tags'];
            expect(preview?.total).toBe(2);
            expect(preview?.items.map((item) => item.title)).toEqual([
                'Design',
                'Engineering'
            ]);
            // The target's slug field surfaces as the ref's `/handle`.
            expect(preview?.items[0].slug).toBe('design');
        });

        it('resolves the inverse side of a many-to-many', async () => {
            const [tagId] = await seedTags(
                [{ name: 'Design', slug: 'design' }],
                workspaceId
            );
            await seedArticleTags(articleId, [tagId]);

            const agent = await login();
            const res = await agent
                .get('/api/content/test_tag')
                .query({ relations: 'preview', relationFields: 'articles' })
                .expect(200);

            const [tag] = res.body.items as EntryItem[];
            const preview = tag.relations?.['articles'];
            expect(preview?.total).toBe(1);
            expect(preview?.items[0]).toEqual(
                expect.objectContaining({ id: articleId, title: 'Alpha' })
            );
        });
    });

    describe('the page cap', () => {
        it('caps items at one page but reports the true total', async () => {
            const overflow = RELATION_PAGE_SIZE + 5;
            const tagIds = await seedTags(
                Array.from({ length: overflow }, (_, index) => ({
                    name: `Tag ${String(index).padStart(2, '0')}`
                })),
                workspaceId
            );
            await seedArticleTags(articleId, tagIds);

            const [alpha] = await listArticles({
                relations: 'preview',
                relationFields: 'tags'
            });
            const preview = alpha.relations?.['tags'];

            // The whole point: a big relation reads ONE page here, and the
            // dropdown pages through the rest via `…/relations/:field`.
            expect(preview?.items).toHaveLength(RELATION_PAGE_SIZE);
            expect(preview?.total).toBe(overflow);
            expect(preview?.items[0].title).toBe('Tag 00');
        });

        it('continues from the preview on the paginated per-field route', async () => {
            const tagIds = await seedTags(
                Array.from({ length: RELATION_PAGE_SIZE + 2 }, (_, index) => ({
                    name: `Tag ${String(index).padStart(2, '0')}`
                })),
                workspaceId
            );
            await seedArticleTags(articleId, tagIds);

            const agent = await login();
            const res = await agent
                .get(`/api/content/test_article/${articleId}/relations/tags`)
                .query({ page: 2, pageSize: RELATION_PAGE_SIZE })
                .expect(200);

            // Page 2 picks up exactly where the preview (page 1) stopped — the
            // preview cap and the route's page size are the same constant.
            expect(res.body.total).toBe(RELATION_PAGE_SIZE + 2);
            expect(
                (res.body.items as RelationRef[]).map((item) => item.title)
            ).toEqual([
                `Tag ${RELATION_PAGE_SIZE}`,
                `Tag ${RELATION_PAGE_SIZE + 1}`
            ]);
        });
    });

    describe('workspace scoping', () => {
        it('never surfaces the title of a target that lives in another workspace', async () => {
            // The link rows are workspace-agnostic — only the target row
            // carries a `workspace_id` — so the preview's own target lookup has
            // to AND it. Two tags, one seeded into a foreign workspace, both
            // linked to the same article (a state the write path refuses to
            // create, but a moved or legacy row can leave behind).
            //
            // The contract is *not* that the link vanishes: `items` and `total`
            // stay consistent, so the foreign id comes back as a `missing` ref
            // whose `title` is only the raw id standing in — no title, no
            // content, and a flag the UI keys off so it never prints it.
            const foreign = await seedWorkspace({
                name: 'WS Foreign',
                slug: 'ws-foreign'
            });
            const [localTag] = await seedTags([{ name: 'Local' }], workspaceId);
            const [foreignTag] = await seedTags(
                [{ name: 'Foreign' }],
                foreign.id
            );
            await seedArticleTags(articleId, [localTag, foreignTag]);

            const items = await listArticles({
                relations: 'preview',
                relationFields: 'tags'
            });
            const alpha = items.find((item) => item.values.text === 'Alpha');
            const refs = alpha?.relations?.tags?.items ?? [];
            expect(refs).toHaveLength(2);

            const local = refs.find((ref) => ref.id === localTag);
            expect(local).toMatchObject({ title: 'Local' });
            expect(local?.missing).toBeUndefined();

            const hidden = refs.find((ref) => ref.id === foreignTag);
            expect(hidden).toMatchObject({ missing: true, title: foreignTag });
            // The foreign tag's own name is nowhere in the response.
            expect(JSON.stringify(refs)).not.toContain('Foreign');
        });
    });

    describe('batching', () => {
        /**
         * The N+1 guard. `previewForEntries` issues a constant number of queries
         * **per relation field** across the whole page, so growing the page must
         * not grow the query count. Building it on the per-entry `readAll`
         * instead would make this scale with rows and fail here.
         */
        it('issues the same number of queries for a 1-row and a 5-row page', async () => {
            // Five articles, each with its own author and two tags — so a
            // per-row implementation would have plenty to fan out over.
            const tagIds = await seedTags(
                [{ name: 'Design' }, { name: 'Engineering' }],
                workspaceId
            );
            const authorIds = await seedAuthors(
                Array.from({ length: 5 }, (_, index) => ({
                    name: `Author ${index}`
                })),
                workspaceId
            );
            const ids = await seedArticles(
                authorIds.map((author, index) => ({
                    text: `Row ${index}`,
                    select: 'article',
                    author
                })),
                workspaceId
            );
            for (const id of ids) await seedArticleTags(id, tagIds);

            const agent = await login();
            const pool = getPool();
            const original = pool.query.bind(pool);
            let queries = 0;
            (pool as { query: unknown }).query = (...args: unknown[]) => {
                queries += 1;
                return (original as (...a: unknown[]) => unknown)(...args);
            };

            try {
                const measure = async (pageSize: number) => {
                    queries = 0;
                    await agent
                        .get('/api/content/test_article')
                        .query({
                            relations: 'preview',
                            relationFields: 'author,tags',
                            pageSize
                        })
                        .expect(200);
                    return queries;
                };

                const onePage = await measure(1);
                const fivePage = await measure(5);
                expect(fivePage).toBe(onePage);
            } finally {
                (pool as { query: unknown }).query = original;
            }
        });
    });
});
