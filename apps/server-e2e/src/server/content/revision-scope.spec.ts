import request from 'supertest';
import { getDatabase } from '@orthacms/database';
import { and, eq, sql } from 'drizzle-orm';
import { contentEntryRevisions } from '@orthacms/content-server/define';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    resetDb,
    seedActiveUser,
    seedAllContentGrants,
    seedMembership,
    seedUserWithPermissions,
    seedWorkspace,
    type SeededUser
} from '../../support/seed';

const ADMIN_EMAIL = 'rev-scope-admin@example.com';
const CONTRIBUTOR_EMAIL = 'rev-scope-contributor@example.com';
const VIEWER_EMAIL = 'rev-scope-viewer@example.com';
const EDITOR_EMAIL = 'rev-scope-editor@example.com';
const PASSWORD = 'SecurePass123!';
const ORIGIN = 'http://localhost:4200';

const ARTICLE = { text: 'First title', select: 'article' } as const;

/**
 * The revision routes' **scoping and authorization**, complementing
 * `entry-revisions.spec.ts` (which covers the timeline's behaviour).
 *
 * Three things every revision route has to get right and none of which the
 * timeline tests reach:
 *
 * - the `:typeName` in the URL is actually checked — all content types share
 *   one `content_entry_revisions` table, so a lookup keyed on `entry_id` alone
 *   serves any entry's history under any registered type name;
 * - the store ANDs `workspace_id`, so an entry in another workspace has no
 *   readable history;
 * - restore is gated on `content:update` while publish-a-version is gated on
 *   `content:publish` — a deliberate split that was entirely untested by role.
 */
describe('Revision scoping and permissions (/api/content/:type/:id/revisions)', () => {
    let harness: TestApp;
    let admin: SeededUser;
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
        admin = await seedActiveUser(harness.app, {
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
        const ws = await seedWorkspace({ name: 'WS One', slug: 'ws-one' });
        workspaceId = ws.id;
        await seedMembership(admin.id, workspaceId);
        await seedAllContentGrants(workspaceId);

        const other = await seedWorkspace({ name: 'WS Two', slug: 'ws-two' });
        otherWorkspaceId = other.id;
        await seedMembership(admin.id, otherWorkspaceId);
        await seedAllContentGrants(otherWorkspaceId);
    });

    async function login(email: string, scopeTo = workspaceId) {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', scopeTo);
        return agent;
    }

    /** Create an article and return its id. */
    async function createArticle(
        agent: request.Agent,
        text = ARTICLE.text
    ): Promise<string> {
        const res = await agent
            .post('/api/content/test_article')
            .set('Origin', ORIGIN)
            .send({ values: { ...ARTICLE, text } })
            .expect(201);
        return res.body.id as string;
    }

    describe('the :typeName is checked against the revision’s content_type', () => {
        it('does not serve an article’s timeline under another type’s name', async () => {
            const agent = await login(ADMIN_EMAIL);
            const id = await createArticle(agent);

            // The control: under its own type the entry has a version.
            const own = await agent
                .get(`/api/content/test_article/${id}/revisions`)
                .expect(200);
            expect(own.body.total).toBe(1);

            // Same id, a *different* registered type. Every type shares one
            // revisions table, so without the `content_type` predicate this
            // returned the article's real history.
            const foreign = await agent
                .get(`/api/content/test_author/${id}/revisions`)
                .expect(200);
            expect(foreign.body).toEqual({ items: [], total: 0 });
        });

        it('does not serve an article’s snapshot under another type’s name', async () => {
            const agent = await login(ADMIN_EMAIL);
            const id = await createArticle(agent);

            const own = await agent
                .get(`/api/content/test_article/${id}/revisions/1`)
                .expect(200);
            expect(own.body.snapshot.values.text).toBe(ARTICLE.text);

            await agent
                .get(`/api/content/test_author/${id}/revisions/1`)
                .expect(404);
        });

        it('refuses restore and publish of a version under another type’s name', async () => {
            const agent = await login(ADMIN_EMAIL);
            const id = await createArticle(agent);

            await agent
                .post(`/api/content/test_author/${id}/revisions/1/restore`)
                .set('Origin', ORIGIN)
                .expect(404);
            await agent
                .post(`/api/content/test_author/${id}/revisions/1/publish`)
                .set('Origin', ORIGIN)
                .expect(404);

            // …and the article is untouched by either attempt.
            const detail = await agent
                .get(`/api/content/test_article/${id}`)
                .expect(200);
            expect(detail.body.values.text).toBe(ARTICLE.text);
        });
    });

    describe('workspace scoping', () => {
        it('shows no history for an entry that lives in another workspace', async () => {
            const owner = await login(ADMIN_EMAIL);
            const id = await createArticle(owner);

            const outsider = await login(ADMIN_EMAIL, otherWorkspaceId);
            const list = await outsider
                .get(`/api/content/test_article/${id}/revisions`)
                .expect(200);
            expect(list.body).toEqual({ items: [], total: 0 });

            await outsider
                .get(`/api/content/test_article/${id}/revisions/1`)
                .expect(404);
            await outsider
                .post(`/api/content/test_article/${id}/revisions/1/restore`)
                .set('Origin', ORIGIN)
                .expect(404);
        });
    });

    describe('restore is tolerant of a snapshot the type has outgrown', () => {
        it('drops a stored key whose field no longer exists instead of 422ing', async () => {
            const agent = await login(ADMIN_EMAIL);
            // `test_author` is non-publishable, so every save validates — the
            // only path on which an unknown key could ever surface as a 422.
            const created = await agent
                .post('/api/content/test_author')
                .set('Origin', ORIGIN)
                .send({ values: { name: 'Ada Lovelace' } })
                .expect(201);
            const id = created.body.id as string;
            await agent
                .patch(`/api/content/test_author/${id}`)
                .set('Origin', ORIGIN)
                .send({ values: { name: 'Ada L.' } })
                .expect(200);

            // Simulate a field that was removed from the type after v1 was
            // captured: the column is gone, but the old snapshot still carries
            // the key. A stored snapshot is not client input, so restoring it
            // must drop the stale key rather than refuse the whole version and
            // make that history permanently unrestorable.
            await getDatabase()
                .update(contentEntryRevisions)
                .set({
                    snapshot: sql`jsonb_set(${contentEntryRevisions.snapshot}, '{values,retired_field}', '"legacy value"')`
                })
                .where(
                    and(
                        eq(contentEntryRevisions.entryId, id),
                        eq(contentEntryRevisions.revisionNumber, 1)
                    )
                );

            const restored = await agent
                .post(`/api/content/test_author/${id}/revisions/1/restore`)
                .set('Origin', ORIGIN)
                .expect(201);
            expect(restored.body.values.name).toBe('Ada Lovelace');
            expect(restored.body.values.retired_field).toBeUndefined();
        });
    });

    describe('permissions by role', () => {
        beforeEach(async () => {
            const contributor = await seedActiveUser(harness.app, {
                email: CONTRIBUTOR_EMAIL,
                password: PASSWORD,
                role: 'contributor'
            });
            const viewer = await seedActiveUser(harness.app, {
                email: VIEWER_EMAIL,
                password: PASSWORD,
                role: 'viewer'
            });
            await seedMembership(contributor.id, workspaceId);
            await seedMembership(viewer.id, workspaceId);
        });

        it('401s every revision route without a session', async () => {
            const agent = await login(ADMIN_EMAIL);
            const id = await createArticle(agent);
            const anon = request(harness.server);
            await anon
                .get(`/api/content/test_article/${id}/revisions`)
                .set('X-Workspace-Id', workspaceId)
                .expect(401);
            await anon
                .post(`/api/content/test_article/${id}/revisions/1/restore`)
                .set('X-Workspace-Id', workspaceId)
                .set('Origin', ORIGIN)
                .expect(401);
            await anon
                .post(`/api/content/test_article/${id}/revisions/1/publish`)
                .set('X-Workspace-Id', workspaceId)
                .set('Origin', ORIGIN)
                .expect(401);
        });

        it('lets a viewer read the timeline but not restore or publish a version', async () => {
            const owner = await login(ADMIN_EMAIL);
            const id = await createArticle(owner);

            const viewer = await login(VIEWER_EMAIL);
            await viewer
                .get(`/api/content/test_article/${id}/revisions`)
                .expect(200);
            await viewer
                .post(`/api/content/test_article/${id}/revisions/1/restore`)
                .set('Origin', ORIGIN)
                .expect(403);
            await viewer
                .post(`/api/content/test_article/${id}/revisions/1/publish`)
                .set('Origin', ORIGIN)
                .expect(403);
        });

        it('lets a contributor restore a version — restore is an edit (content:update)', async () => {
            const owner = await login(ADMIN_EMAIL);
            const id = await createArticle(owner);
            await owner
                .patch(`/api/content/test_article/${id}`)
                .set('Origin', ORIGIN)
                .send({ values: { ...ARTICLE, text: 'Second title' } })
                .expect(200);

            const contributor = await login(CONTRIBUTOR_EMAIL);
            const restored = await contributor
                .post(`/api/content/test_article/${id}/revisions/1/restore`)
                .set('Origin', ORIGIN)
                .expect(201);
            expect(restored.body.values.text).toBe(ARTICLE.text);
        });

        it('lets a contributor publish a version — the role holds content:publish', async () => {
            const owner = await login(ADMIN_EMAIL);
            const id = await createArticle(owner);

            const contributor = await login(CONTRIBUTOR_EMAIL);
            await contributor
                .post(`/api/content/test_article/${id}/revisions/1/publish`)
                .set('Origin', ORIGIN)
                .expect(201);
        });

        it('separates the two gates: content:update alone restores but cannot publish', async () => {
            // The split the two routes declare is only observable through a
            // principal that holds one permission and not the other — every
            // shipped role holds both or neither.
            const editor = await seedUserWithPermissions(harness.app, {
                email: EDITOR_EMAIL,
                password: PASSWORD,
                roleKey: 'rev-scope-updater',
                permissions: ['content:read', 'content:update']
            });
            await seedMembership(editor.id, workspaceId);

            const owner = await login(ADMIN_EMAIL);
            const id = await createArticle(owner);

            const agent = await login(EDITOR_EMAIL);
            await agent
                .post(`/api/content/test_article/${id}/revisions/1/restore`)
                .set('Origin', ORIGIN)
                .expect(201);
            await agent
                .post(`/api/content/test_article/${id}/revisions/1/publish`)
                .set('Origin', ORIGIN)
                .expect(403);
        });

        it('403s a disallowed Origin on both write routes (CSRF)', async () => {
            const agent = await login(ADMIN_EMAIL);
            const id = await createArticle(agent);
            await agent
                .post(`/api/content/test_article/${id}/revisions/1/restore`)
                .set('Origin', 'http://evil.example')
                .expect(403);
            await agent
                .post(`/api/content/test_article/${id}/revisions/1/publish`)
                .set('Origin', 'http://evil.example')
                .expect(403);
        });
    });
});
