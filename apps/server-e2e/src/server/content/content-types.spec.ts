import request from 'supertest';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@orthacms/database';
import { workspaceContent } from '@orthacms/workspaces-server';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { resetDb, seedActiveUser } from '../../support/seed';

const ADMIN_EMAIL = 'content-types-admin@example.com';
const PASSWORD = 'SecurePass123!';

/**
 * The e2e-owned content types registered with ContentPlugin (see
 * support/content/index.ts), sorted — the assertions compare a `.sort()`ed
 * list. `test_article` wires up the `test_author`/`test_seo`/`test_tag`/
 * `test_comment` reference collections, `test_landing` is the single, and
 * `test_page` is the self-referential tree.
 */
const REGISTRY_NAMES = [
    'test_article',
    'test_author',
    'test_comment',
    'test_landing',
    'test_page',
    'test_seo',
    'test_tag'
];

interface Descriptor {
    name: string;
    kind: 'collection' | 'single';
    label?: string;
    path?: string;
}

/**
 * `GET /api/content-types` + the workspace content-grant flow, after the
 * handover: both resolve against the content plugin's code-defined registry
 * (via the `CONTENT_CATALOG` port), not identity's built-in mock catalogue.
 */
describe('Content catalogue handover (GET /api/content-types + grants)', () => {
    let harness: TestApp;

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
    });

    async function loginAdmin() {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email: ADMIN_EMAIL, password: PASSWORD })
            .expect(201);
        return agent;
    }

    it('401s an unauthenticated request', async () => {
        await request(harness.server).get('/api/content-types').expect(401);
    });

    it('serves the code-defined registry, not the mock catalogue', async () => {
        const agent = await loginAdmin();
        const res = await agent.get('/api/content-types').expect(200);

        const names = (res.body as Descriptor[]).map((d) => d.name).sort();
        expect(names).toEqual(REGISTRY_NAMES);
        // The retired mock's slugs must not leak through.
        expect(names).not.toContain('blog_post');
        expect(names).not.toContain('product');

        const byName = Object.fromEntries(
            (res.body as Descriptor[]).map((d) => [d.name, d])
        );
        expect(byName.test_landing).toMatchObject({
            kind: 'single',
            path: '/'
        });
        expect(byName.test_article).toMatchObject({ kind: 'collection' });
    });

    it('grants a workspace the real registry slugs on content mode "all"', async () => {
        const agent = await loginAdmin();
        const res = await agent
            .post('/api/workspaces')
            .send({
                name: 'Marketing site',
                slug: 'marketing-site',
                description: 'Landing pages and the blog.',
                color: 'violet',
                members: [],
                content: { mode: 'all' }
            })
            .expect(201);

        const rows = await getDatabase()
            .select()
            .from(workspaceContent)
            .where(eq(workspaceContent.workspaceId, res.body.id));

        expect(rows.map((r) => r.slug).sort()).toEqual(REGISTRY_NAMES);
        // test_article is the collection; test_landing is the single.
        const kindBySlug = Object.fromEntries(
            rows.map((r) => [r.slug, r.kind])
        );
        expect(kindBySlug.test_article).toBe('collection');
        expect(kindBySlug.test_landing).toBe('single');
    });
});
