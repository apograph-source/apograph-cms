import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    resetDb,
    seedActiveUser,
    seedArticleTags,
    seedArticles,
    seedAuthors,
    seedContentGrants,
    seedMembership,
    seedPages,
    seedTags,
    seedWorkspace,
    softDeleteAuthors,
    type SeededUser
} from '../../support/seed';

const ADMIN_EMAIL = 'rel-filter-admin@example.com';
const PASSWORD = 'SecurePass123!';

/** Shape of one item in the list envelope (only the asserted bits). */
interface EntryItem {
    id: string;
    values: Record<string, unknown>;
}

const textsOf = (res: { body: { items: EntryItem[] } }): string[] =>
    res.body.items.map((item) => String(item.values.text)).sort();

/**
 * ONE app per spec FILE, not per `describe`. `closeTestApp` ends the
 * `@orthacms/database` pool, which Jest scopes to the module registry — i.e.
 * to the file — so a second `describe` booting its own app finds the pool
 * already closed and dies in the system-roles seeder. Both suites below share
 * this harness.
 */
let harness: TestApp;

beforeAll(async () => {
    harness = await createTestApp();
});

afterAll(async () => {
    await closeTestApp(harness);
});

/**
 * `GET /api/content/:typeName` **filtering across relations**. The end-to-end
 * proof of the relation-aware filter surface: a rule on `author.name` (a
 * many-to-one) or `tags.name` (a many-to-many) resolves through an EXISTS
 * subquery, and that subquery is **scoped** — it never traverses a
 * soft-deleted or cross-workspace target.
 *
 * Three hazards here are invisible to a unit test because the wrong SQL is
 * still *valid* SQL, just answering a different question: negation across a
 * to-many relation, "is empty" on a relation id, and the correlation of
 * anything nested under a self-referential hop. Those cases assert on the
 * rows a real Postgres returns, which is the only place the difference shows.
 */
describe('Content relation filtering (GET /api/content/:typeName?filter=)', () => {
    let admin: SeededUser;
    let workspaceId: string;
    let smithId: string;
    let jonesId: string;
    // Article ids by their `text`, captured at seed time for tag wiring.
    let articleId: Record<string, string>;

    beforeEach(async () => {
        await resetDb();
        admin = await seedActiveUser(harness.app, {
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
        const ws = await seedWorkspace({ name: 'WS One', slug: 'ws-one' });
        workspaceId = ws.id;
        await seedMembership(admin.id, workspaceId);
        await seedContentGrants(workspaceId, [
            'test_article',
            'test_author',
            'test_tag',
            'test_page'
        ]);

        // Two authors; three articles — two by Smith, one by Jones.
        [smithId, jonesId] = await seedAuthors(
            [{ name: 'Smith' }, { name: 'Jones' }],
            workspaceId
        );
        const [alpha, bravo, charlie] = await seedArticles(
            [
                { text: 'Alpha', select: 'article', author: smithId },
                { text: 'Bravo', select: 'tutorial', author: smithId },
                { text: 'Charlie', select: 'article', author: jonesId }
            ],
            workspaceId
        );
        articleId = { Alpha: alpha, Bravo: bravo, Charlie: charlie };
    });

    async function login(email: string, workspace: string = workspaceId) {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', workspace);
        return agent;
    }

    /** A single-rule `?filter=` query string for `field op value`. */
    const rule = (field: string, op: string, value: unknown) =>
        JSON.stringify({ field, op, value });

    describe('many-to-one (author.name)', () => {
        it('filters entries by a related record field', async () => {
            const agent = await login(ADMIN_EMAIL);
            const res = await agent
                .get('/api/content/test_article')
                .query({ filter: rule('author.name', 'ilike', '%smith%') })
                .expect(200);

            expect(res.body.total).toBe(2);
            expect(textsOf(res)).toEqual(['Alpha', 'Bravo']);
        });

        it('excludes a soft-deleted target (the relation scope)', async () => {
            const agent = await login(ADMIN_EMAIL);
            const filter = rule('author.name', 'ilike', '%smith%');

            const before = await agent
                .get('/api/content/test_article')
                .query({ filter })
                .expect(200);
            expect(before.body.total).toBe(2);

            // Tombstone the author. Without the soft-delete guard inside the
            // EXISTS, the two articles would still match a now-deleted author.
            await softDeleteAuthors([smithId]);

            const after = await agent
                .get('/api/content/test_article')
                .query({ filter })
                .expect(200);
            expect(after.body.total).toBe(0);
        });

        it('excludes a target in another workspace (the workspace scope)', async () => {
            // A second workspace with its OWN author also named "Smith", and an
            // article in THIS workspace deliberately linked across to it.
            const wsB = await seedWorkspace({ name: 'WS Two', slug: 'ws-two' });
            await seedMembership(admin.id, wsB.id);
            const [smithB] = await seedAuthors([{ name: 'Smith' }], wsB.id);
            await seedArticles(
                [{ text: 'Echo', select: 'article', author: smithB }],
                workspaceId
            );

            const agent = await login(ADMIN_EMAIL);
            const res = await agent
                .get('/api/content/test_article')
                .query({ filter: rule('author.name', 'ilike', '%smith%') })
                .expect(200);

            // Only the two articles whose author lives in THIS workspace; the
            // cross-workspace link to wsB's "Smith" is not matched.
            expect(res.body.total).toBe(2);
            expect(textsOf(res)).toEqual(['Alpha', 'Bravo']);
        });
    });

    describe('many-to-many (tags.*)', () => {
        beforeEach(async () => {
            const [red, blue] = await seedTags(
                [
                    { name: 'red', slug: 'red' },
                    { name: 'blue', slug: 'blue' }
                ],
                workspaceId
            );
            await seedArticleTags(articleId.Alpha, [red, blue]);
            await seedArticleTags(articleId.Charlie, [red]);
        });

        it('filters by a tag field with EXISTS semantics (no row duplication)', async () => {
            const agent = await login(ADMIN_EMAIL);
            // Alpha has {red, blue}, Charlie has {red}. Matching either tag must
            // still return each article exactly once (EXISTS, not a join).
            const res = await agent
                .get('/api/content/test_article')
                .query({ filter: rule('tags.slug', 'in', ['red', 'blue']) })
                .expect(200);

            expect(res.body.total).toBe(2);
            expect(textsOf(res)).toEqual(['Alpha', 'Charlie']);
        });

        it('matches only entries linked to the given tag', async () => {
            const agent = await login(ADMIN_EMAIL);
            const res = await agent
                .get('/api/content/test_article')
                .query({ filter: rule('tags.name', 'eq', 'blue') })
                .expect(200);

            expect(res.body.total).toBe(1);
            expect(textsOf(res)).toEqual(['Alpha']);
        });
    });

    /**
     * Negation across a relation. SQL's obvious translation —
     * `EXISTS(target WHERE NOT p)` — answers a *different question* than the
     * user asked as soon as the relation can hold more than one row, and no
     * error is raised either way. These pin the rows, which is the only place
     * the difference is observable.
     */
    describe('negation (NOT EXISTS semantics)', () => {
        beforeEach(async () => {
            const [red, blue] = await seedTags(
                [
                    { name: 'red', slug: 'red' },
                    { name: 'blue', slug: 'blue' }
                ],
                workspaceId
            );
            // Alpha: {red, blue}. Charlie: {red}. Bravo: no tags.
            await seedArticleTags(articleId.Alpha, [red, blue]);
            await seedArticleTags(articleId.Charlie, [red]);
        });

        it('excludes an entry that has ANY link matching the negated value', async () => {
            const agent = await login(ADMIN_EMAIL);
            const res = await agent
                .get('/api/content/test_article')
                .query({ filter: rule('tags.name', 'nin', ['red']) })
                .expect(200);

            // Alpha is tagged red AND blue. The naive `EXISTS(tag WHERE name
            // NOT IN ('red'))` would match it on its *blue* link — exactly the
            // article the user asked to exclude.
            expect(textsOf(res)).toEqual(['Bravo']);
        });

        it('keeps an entry with no links at all under a negated rule', async () => {
            const agent = await login(ADMIN_EMAIL);
            const res = await agent
                .get('/api/content/test_article')
                .query({ filter: rule('tags.name', 'ne', 'red') })
                .expect(200);

            // Bravo has no tags, so it certainly has no tag named red.
            expect(textsOf(res)).toEqual(['Bravo']);
        });

        it('"is empty" on a relation id means "has no related row"', async () => {
            const agent = await login(ADMIN_EMAIL);
            // Give Bravo no author; Alpha/Charlie keep theirs.
            await agent
                .patch(`/api/content/test_article/${articleId.Bravo}`)
                .send({
                    values: { text: 'Bravo', select: 'tutorial', author: null }
                })
                .expect(200);

            const res = await agent
                .get('/api/content/test_article')
                .query({ filter: rule('author.id', 'null', true) })
                .expect(200);

            // `author.id` is a NOT NULL primary key on the target, so the
            // naive reading (EXISTS … WHERE id IS NULL) can never match.
            expect(textsOf(res)).toEqual(['Bravo']);
        });

        it('"is not empty" on a relation id means "has a related row"', async () => {
            const agent = await login(ADMIN_EMAIL);
            const res = await agent
                .get('/api/content/test_article')
                .query({ filter: rule('author.id', 'null', false) })
                .expect(200);

            expect(textsOf(res)).toEqual(['Alpha', 'Bravo', 'Charlie']);
        });

        it('a negated ROOT column still matches rows where it is NULL', async () => {
            const agent = await login(ADMIN_EMAIL);
            // `number` is optional, so Bravo/Charlie leave it NULL.
            await agent
                .patch(`/api/content/test_article/${articleId.Alpha}`)
                .send({
                    values: {
                        text: 'Alpha',
                        select: 'article',
                        number: 7
                    }
                })
                .expect(200);

            const res = await agent
                .get('/api/content/test_article')
                .query({ filter: rule('number', 'ne', 7) })
                .expect(200);

            // Plain `<>` is NULL for a NULL column, i.e. not matched — which
            // would hide every article that simply has no number yet.
            expect(textsOf(res)).toEqual(['Bravo', 'Charlie']);
        });
    });

    /**
     * A self-referencing hop (`test_page.parent`) aliases the target, because
     * parent and child are the same physical table. Anything traversed
     * *under* that hop must correlate to the ALIAS: bound to the physical
     * table it still produces valid SQL, but silently answers about the root
     * row. Only real rows distinguish the two.
     */
    describe('self-referential (test_page.parent)', () => {
        let pageId: Record<string, string>;

        beforeEach(async () => {
            // Root is owned by Smith; Child by Jones; Grandchild by Smith.
            const [root, child, grandchild] = await seedPages(
                [{ title: 'Root', owner: smithId }],
                workspaceId
            ).then(async ([rootId]) => {
                const [childId] = await seedPages(
                    [{ title: 'Child', parent: rootId, owner: jonesId }],
                    workspaceId
                );
                const [grandchildId] = await seedPages(
                    [
                        {
                            title: 'Grandchild',
                            parent: childId,
                            owner: smithId
                        }
                    ],
                    workspaceId
                );
                return [rootId, childId, grandchildId];
            });
            pageId = { Root: root, Child: child, Grandchild: grandchild };
        });

        const titlesOf = (res: { body: { items: EntryItem[] } }): string[] =>
            res.body.items.map((item) => String(item.values.title)).sort();

        it("filters by the parent's own field", async () => {
            const agent = await login(ADMIN_EMAIL);
            const res = await agent
                .get('/api/content/test_page')
                .query({ filter: rule('parent.title', 'eq', 'Root') })
                .expect(200);

            expect(titlesOf(res)).toEqual(['Child']);
        });

        it('filters through a relation UNDER the self-hop (parent.owner.name)', async () => {
            const agent = await login(ADMIN_EMAIL);
            const res = await agent
                .get('/api/content/test_page')
                .query({ filter: rule('parent.owner.name', 'eq', 'Jones') })
                .expect(200);

            // Only Grandchild's PARENT (Child) is owned by Jones. Correlated
            // to the root row instead, this would return Child — whose own
            // owner is Jones — and miss Grandchild entirely.
            expect(titlesOf(res)).toEqual(['Grandchild']);
        });

        it('filters two self-hops deep (parent.parent.title)', async () => {
            const agent = await login(ADMIN_EMAIL);
            const res = await agent
                .get('/api/content/test_page')
                .query({ filter: rule('parent.parent.title', 'eq', 'Root') })
                .expect(200);

            // Grandparent, not parent: bound to the outer row this collapses
            // into `parent.title = 'Root'` and would return Child.
            expect(titlesOf(res)).toEqual(['Grandchild']);
        });

        it('does not match a page against its own row', async () => {
            const agent = await login(ADMIN_EMAIL);
            // An unaliased self-join degrades to "a row that is its own
            // parent", which would match every page with a parent.
            const res = await agent
                .get('/api/content/test_page')
                .query({ filter: rule('parent.title', 'eq', 'Child') })
                .expect(200);

            expect(titlesOf(res)).toEqual(['Grandchild']);
        });
    });

    describe('composition + bounds', () => {
        it('combines a root field and a relation path under OR', async () => {
            const agent = await login(ADMIN_EMAIL);
            const res = await agent
                .get('/api/content/test_article')
                .query({
                    filter: JSON.stringify({
                        or: [
                            { field: 'select', op: 'eq', value: 'tutorial' },
                            {
                                field: 'author.name',
                                op: 'ilike',
                                value: '%jones%'
                            }
                        ]
                    })
                })
                .expect(200);

            // Bravo (tutorial) ∪ Charlie (by Jones).
            expect(res.body.total).toBe(2);
            expect(textsOf(res)).toEqual(['Bravo', 'Charlie']);
        });

        it('400s an unknown field under a relation', async () => {
            const agent = await login(ADMIN_EMAIL);
            await agent
                .get('/api/content/test_article')
                .query({ filter: rule('author.bogus', 'eq', 'x') })
                .expect(400);
        });

        it('400s a path deeper than the relation-hop budget', async () => {
            const agent = await login(ADMIN_EMAIL);
            await agent
                .get('/api/content/test_article')
                .query({ filter: rule('author.name.deep.deeper', 'eq', 'x') })
                .expect(400);
        });
    });
});

/**
 * `GET /api/content-schema/:name/filter-fields` — the surface the admin's query
 * builder renders. Built by the same traversal as the SQL whitelist, so every
 * path here is one the list endpoint accepts (the unit `drift` test pins the
 * converse); this just proves the route is wired, permissioned, and shaped.
 */
describe('Filter fields (GET /api/content-schema/:name/filter-fields)', () => {
    let admin: SeededUser;
    let workspaceId: string;

    interface WireField {
        path: string;
        label: string;
        type: string;
        enumValues?: string[];
        group: string[];
        relationTarget?: string;
    }

    beforeEach(async () => {
        await resetDb();
        admin = await seedActiveUser(harness.app, {
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
        const ws = await seedWorkspace({ name: 'WS One', slug: 'ws-one' });
        workspaceId = ws.id;
        await seedMembership(admin.id, workspaceId);
        await seedContentGrants(workspaceId, [
            'test_article',
            'test_author',
            'test_tag'
        ]);
    });

    async function login(workspace: string = workspaceId) {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email: ADMIN_EMAIL, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', workspace);
        return agent;
    }

    it('401s an unauthenticated request', async () => {
        await request(harness.server)
            .get('/api/content-schema/test_article/filter-fields')
            .expect(401);
    });

    it('404s an unknown content type', async () => {
        const agent = await login();
        await agent
            .get('/api/content-schema/does-not-exist/filter-fields')
            .expect(404);
    });

    it('404s a real type the workspace was not granted', async () => {
        const agent = await login();
        // `test_landing` IS in the registry, just not in this workspace's
        // grants. It must be indistinguishable from a type that doesn't exist
        // at all — otherwise the endpoint enumerates the content model of
        // every other workspace.
        const unknown = await agent
            .get('/api/content-schema/does-not-exist/filter-fields')
            .expect(404);
        const ungranted = await agent
            .get('/api/content-schema/test_landing/filter-fields')
            .expect(404);

        // Each message echoes the name that was asked for — that's the input,
        // not a disclosure. What matters is that the two responses are the
        // same shape, so only the caller's own input distinguishes them.
        expect(Object.keys(ungranted.body).sort()).toEqual(
            Object.keys(unknown.body).sort()
        );
        expect(ungranted.body.message).toBe(
            unknown.body.message.replace('does-not-exist', 'test_landing')
        );
    });

    it('prunes a relation whose target is not granted', async () => {
        // A second workspace granted the article but NOT the author it points
        // at — the picker must not offer a traversal into a collection this
        // workspace cannot open.
        const other = await seedWorkspace({ name: 'WS Two', slug: 'ws-two' });
        await seedMembership(admin.id, other.id);
        await seedContentGrants(other.id, ['test_article', 'test_tag']);

        const agent = await login(other.id);
        const res = await agent
            .get('/api/content-schema/test_article/filter-fields')
            .expect(200);

        const paths = (res.body.fields as WireField[]).map((f) => f.path);
        expect(paths).not.toContain('author.name');
        expect(paths).not.toContain('author.id');
        // The granted relation is still offered, so this is pruning and not
        // a blanket "relations off".
        expect(paths).toContain('tags.name');
        // Root scalars are never affected by relation pruning.
        expect(paths).toContain('text');
    });

    it('returns the recursive filterable surface', async () => {
        const agent = await login();
        const res = await agent
            .get('/api/content-schema/test_article/filter-fields')
            .expect(200);

        const fields = res.body.fields as WireField[];
        const byPath = new Map(fields.map((f) => [f.path, f]));

        // A root enum field, ungrouped.
        expect(byPath.get('select')).toMatchObject({
            type: 'enum',
            enumValues: ['article', 'tutorial', 'changelog'],
            group: []
        });

        // The publishable status envelope.
        expect(byPath.get('status')?.type).toBe('enum');

        // A many-to-one relation field, grouped under its relation label.
        expect(byPath.get('author.name')).toMatchObject({
            type: 'string',
            group: ['Author']
        });

        // The relation's record-picker entry carries the target type name.
        expect(byPath.get('author.id')).toMatchObject({
            type: 'uuid',
            relationTarget: 'test_author',
            group: ['Author']
        });

        // A many-to-many relation field is offered too.
        expect(byPath.get('tags.name')).toMatchObject({
            type: 'string',
            group: ['Tags']
        });
    });
});
