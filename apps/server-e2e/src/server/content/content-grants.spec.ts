import request from 'supertest';
import { getDatabase } from '@orthacms/database';
import { count } from 'drizzle-orm';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    resetDb,
    revokeContentGrants,
    seedActiveUser,
    seedContentGrants,
    seedMembership,
    seedWorkspace,
    type SeededUser
} from '../../support/seed';
import { testTags } from '../../support/content';

const ADMIN_EMAIL = 'content-grants-admin@example.com';
const PASSWORD = 'SecurePass123!';
const ORIGIN = 'http://localhost:4200';

/** A valid `test_article` body — the granted type used as the control. */
const ARTICLE = { text: 'Granted', select: 'article' } as const;

/**
 * **Content grants gate the session-side admin content API**
 * (`ContentGrantGuard` + the grant check on `GET /api/content-schema/:name`).
 *
 * A workspace reaches only the content types it was granted
 * (`workspace_content`) — the same rule the public REST API, the GraphQL
 * adapter, the MCP tools and the copilot's tools already applied. Before this,
 * membership alone was access: a member of a workspace granted just
 * `test_article` could list, read, create, edit, publish, delete and read the
 * revision history of `test_tag` entries in it by naming the type in the URL,
 * writing rows the admin never shows (its nav renders from the grants) but
 * which still hold the workspace-delete guard open.
 *
 * The other half of the contract is that an **ungranted** type is
 * indistinguishable from an **unknown** one — same status, same body — so the
 * routes disclose nothing about the content model outside the workspace.
 */
describe('Content grants on the admin API (workspace_content)', () => {
    let harness: TestApp;
    let admin: SeededUser;
    /** Granted `test_article` only. */
    let workspaceId: string;
    /** Granted nothing at all. */
    let barrenWorkspaceId: string;

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
        const ws = await seedWorkspace({ name: 'Granted', slug: 'granted' });
        workspaceId = ws.id;
        await seedMembership(admin.id, workspaceId);
        await seedContentGrants(workspaceId, ['test_article']);

        const barren = await seedWorkspace({ name: 'Barren', slug: 'barren' });
        barrenWorkspaceId = barren.id;
        await seedMembership(admin.id, barrenWorkspaceId);
    });

    async function login(id = workspaceId) {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email: ADMIN_EMAIL, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', id);
        return agent;
    }

    /** How many `test_tag` rows exist at all — the write assertions' oracle. */
    async function countTags(): Promise<number> {
        const [row] = await getDatabase()
            .select({ total: count() })
            .from(testTags);
        return Number(row.total);
    }

    describe('an ungranted type answers exactly as an unknown one', () => {
        it('404s the schema of an ungranted type with the unknown-type body', async () => {
            const agent = await login();
            const ungranted = await agent
                .get('/api/content-schema/test_tag')
                .expect(404);
            const unknown = await agent
                .get('/api/content-schema/no_such_type')
                .expect(404);

            expect(ungranted.body.message).toBe(
                'Unknown content type "test_tag".'
            );
            // Same shape, and neither says "you were not granted this" — the
            // only difference is the name the caller themselves supplied.
            expect(Object.keys(ungranted.body).sort()).toEqual(
                Object.keys(unknown.body).sort()
            );
            expect(ungranted.body.statusCode).toBe(unknown.body.statusCode);
        });

        it('404s the entries list of an ungranted type with the same body [content:I-05]', async () => {
            const agent = await login();
            const ungranted = await agent
                .get('/api/content/test_tag')
                .expect(404);
            const unknown = await agent
                .get('/api/content/no_such_type')
                .expect(404);

            // Identical but for the name the caller themselves supplied — the
            // response must not let them tell "this type exists but is not
            // yours" from "no such type".
            expect(ungranted.body).toEqual({
                ...unknown.body,
                message: 'Unknown content type "test_tag".'
            });
        });

        it('serves the granted type unchanged', async () => {
            const agent = await login();
            const schema = await agent
                .get('/api/content-schema/test_article')
                .expect(200);
            expect(schema.body.name).toBe('test_article');
            await agent.get('/api/content/test_article').expect(200);
        });
    });

    describe('reads', () => {
        it('404s every read route of an ungranted type', async () => {
            const agent = await login();
            const id = '11111111-1111-4111-8111-111111111111';
            for (const path of [
                '/api/content/test_tag',
                `/api/content/test_tag/${id}`,
                `/api/content/test_tag/${id}/relations`,
                `/api/content/test_tag/${id}/media`,
                `/api/content/test_tag/${id}/revisions`,
                `/api/content/test_tag/${id}/revisions/1`,
                '/api/content-schema/test_tag',
                '/api/content-schema/test_tag/filter-fields'
            ]) {
                await agent.get(path).expect(404);
            }
        });

        it('keeps the global /api/content-schema catalogue unscoped', async () => {
            // The ⌘K palette reads it with no workspace open at all, then
            // intersects it per workspace client-side — so it stays a global,
            // code-defined catalogue and carries no WorkspaceGuard.
            const agent = request.agent(harness.server);
            await agent
                .post('/api/auth/login')
                .send({ email: ADMIN_EMAIL, password: PASSWORD })
                .expect(201);
            const res = await agent.get('/api/content-schema').expect(200);
            const names = res.body.map((t: { name: string }) => t.name);
            expect(names).toContain('test_article');
            expect(names).toContain('test_tag');
        });
    });

    describe('writes', () => {
        it('404s a create of an ungranted type and writes no row', async () => {
            const agent = await login();
            const before = await countTags();

            await agent
                .post('/api/content/test_tag')
                .set('Origin', ORIGIN)
                .send({ values: { name: 'Sneaky' } })
                .expect(404);

            // The finding that matters: not the status code, the absent row.
            expect(await countTags()).toBe(before);
        });

        it('404s update / publish / delete / bulk on an ungranted type', async () => {
            const agent = await login();
            const id = '11111111-1111-4111-8111-111111111111';
            await agent
                .patch(`/api/content/test_tag/${id}`)
                .set('Origin', ORIGIN)
                .send({ values: { name: 'x' } })
                .expect(404);
            await agent
                .post(`/api/content/test_tag/${id}/publish`)
                .set('Origin', ORIGIN)
                .expect(404);
            await agent
                .delete(`/api/content/test_tag/${id}`)
                .set('Origin', ORIGIN)
                .expect(404);
            await agent
                .post('/api/content/test_tag/bulk/delete')
                .set('Origin', ORIGIN)
                .send({ ids: [id] })
                .expect(404);
            await agent
                .post(`/api/content/test_tag/${id}/revisions/1/restore`)
                .set('Origin', ORIGIN)
                .expect(404);
            await agent
                .post(`/api/content/test_tag/${id}/revisions/1/publish`)
                .set('Origin', ORIGIN)
                .expect(404);
        });

        it('lets the granted type through unchanged', async () => {
            const agent = await login();
            const created = await agent
                .post('/api/content/test_article')
                .set('Origin', ORIGIN)
                .send({ values: ARTICLE })
                .expect(201);
            await agent
                .patch(`/api/content/test_article/${created.body.id}`)
                .set('Origin', ORIGIN)
                .send({ values: { ...ARTICLE, text: 'Edited' } })
                .expect(200);
        });
    });

    describe('a workspace granted nothing', () => {
        it('404s every type, including ones other workspaces hold', async () => {
            const agent = await login(barrenWorkspaceId);
            await agent.get('/api/content/test_article').expect(404);
            await agent.get('/api/content/test_tag').expect(404);
            await agent.get('/api/content-schema/test_article').expect(404);
            // …while the workspace that *was* granted it still reads fine.
            const granted = await login();
            await granted.get('/api/content/test_article').expect(200);
        });
    });

    describe('a revoked grant', () => {
        it('stops accepting creates as soon as the grant row is gone', async () => {
            const agent = await login();
            await agent
                .post('/api/content/test_article')
                .set('Origin', ORIGIN)
                .send({ values: ARTICLE })
                .expect(201);

            // Revoking is only permitted at zero entries, but nothing stopped a
            // create the instant after — which re-broke "a revoke never orphans
            // records" from the other side.
            await revokeContentGrants(workspaceId);

            await agent
                .post('/api/content/test_article')
                .set('Origin', ORIGIN)
                .send({ values: ARTICLE })
                .expect(404);
        });
    });
});
