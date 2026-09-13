import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { TEST_ALLOWED_ORIGIN } from '../../support/test-config';
import {
    resetDb,
    seedActiveUser,
    seedAllContentGrants,
    seedArticles,
    seedContentGrants,
    seedMembership,
    seedWorkspace,
    type SeededUser
} from '../../support/seed';

const ADMIN_EMAIL = 'alarm-rules-admin@example.com';
const VIEWER_EMAIL = 'alarm-rules-viewer@example.com';
const PASSWORD = 'SecurePass123!';

/** The condition every fixture rule uses: a published article with no text. */
const EMPTY_TEXT_FILTER = {
    and: [
        { field: 'status', op: 'eq', value: 'published' },
        { field: 'text', op: 'null', value: true }
    ]
};

/**
 * ONE app per spec FILE — `closeTestApp` ends the shared pool, which Jest
 * scopes to the module registry.
 */
let harness: TestApp;

beforeAll(async () => {
    harness = await createTestApp();
});

afterAll(async () => {
    await closeTestApp(harness);
});

/**
 * `/api/alarms/rules` — the rule lifecycle.
 *
 * Three things here are only observable end-to-end, because each depends on
 * real SQL against a real schema:
 *
 * - **A new rule scans immediately.** The interesting case is content that
 *   already exists: a rule that only ever saw entries edited after it was
 *   written would report a clean collection on the day it is most likely to be
 *   wrong.
 * - **The filter is validated against the content type at write time.** A
 *   stored rule is replayed by a background subscriber for months; a tree that
 *   fails only at evaluation time fails where nobody is looking.
 * - **An ungranted content type is the same 404 as an unknown one**, so the
 *   rule editor cannot be used to enumerate the deployment's content model.
 */
describe('Alarm rules (/api/alarms/rules)', () => {
    let admin: SeededUser;
    let viewer: SeededUser;
    let workspaceId: string;

    beforeEach(async () => {
        await resetDb();
        admin = await seedActiveUser(harness.app, {
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
        viewer = await seedActiveUser(harness.app, {
            email: VIEWER_EMAIL,
            password: PASSWORD,
            role: 'viewer'
        });
        const workspace = await seedWorkspace({
            name: 'Alarms',
            slug: 'alarms'
        });
        workspaceId = workspace.id;
        await seedMembership(admin.id, workspaceId);
        await seedMembership(viewer.id, workspaceId);
        await seedAllContentGrants(workspaceId);
    });

    /**
     * A logged-in agent carrying the workspace header every alarms route needs
     * (`WorkspaceGuard` reads it, and answers 400 without it).
     */
    async function login(email: string, workspace: string = workspaceId) {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', workspace);
        return agent;
    }

    const asAdmin = () => login(ADMIN_EMAIL);

    const rulePayload = (overrides: Record<string, unknown> = {}) => ({
        contentType: 'test_article',
        name: 'Published with no body',
        findingTitle: 'This is published with an empty body',
        severity: 'warn',
        filter: EMPTY_TEXT_FILTER,
        ...overrides
    });

    describe('creation', () => {
        it('scans the existing collection, so the rule is right on day one', async () => {
            // Two published articles with no body, written BEFORE the rule
            // exists. No event will ever be raised about them again.
            await seedArticles(
                [
                    { text: null, status: 'published' },
                    { text: null, status: 'published' },
                    { text: 'has a body', status: 'published' }
                ],
                workspaceId
            );

            const api = await asAdmin();
            const res = await api
                .post('/api/alarms/rules')
                .send(rulePayload())
                .expect(201);

            // covers: alarms:I-07
            expect(res.body.scan.open).toBe(2);
            expect(res.body.rule.openCount).toBe(2);
        });

        it('rejects a filter the content type cannot answer', async () => {
            const api = await asAdmin();
            await api
                .post('/api/alarms/rules')
                .send(
                    rulePayload({
                        filter: {
                            and: [{ field: 'nonesuch', op: 'eq', value: 'x' }]
                        }
                    })
                )
                .expect(400);
        });

        it('refuses a second rule with the same name in the workspace [alarms:I-14]', async () => {
            const api = await asAdmin();
            await api.post('/api/alarms/rules').send(rulePayload()).expect(201);
            await api.post('/api/alarms/rules').send(rulePayload()).expect(409);
        });

        it('lets a different workspace use the same name [alarms:I-14]', async () => {
            // The other half of the same index. The 409 above is produced just
            // as well by a uniqueness on `name` alone — and that narrower
            // index would then refuse a workspace a name because an unrelated
            // tenant happened to use it first, which surfaces to an editor as
            // a bug in data they cannot see.
            const other = await seedWorkspace({
                name: 'Alarms elsewhere',
                slug: 'alarms-elsewhere'
            });
            await seedMembership(admin.id, other.id);
            await seedAllContentGrants(other.id);

            const here = await asAdmin();
            await here
                .post('/api/alarms/rules')
                .send(rulePayload())
                .expect(201);

            const there = await login(ADMIN_EMAIL, other.id);
            await there
                .post('/api/alarms/rules')
                .send(rulePayload())
                .expect(201);
        });

        it('answers 404 for an ungranted type, exactly as for an unknown one [alarms:I-16]', async () => {
            // Re-grant nothing but a single unrelated type, so `test_article`
            // is registered-but-ungranted.
            await resetDb();
            admin = await seedActiveUser(harness.app, {
                email: ADMIN_EMAIL,
                password: PASSWORD,
                role: 'admin'
            });
            const workspace = await seedWorkspace({
                name: 'Narrow',
                slug: 'narrow'
            });
            workspaceId = workspace.id;
            await seedMembership(admin.id, workspaceId);
            await seedContentGrants(workspaceId, ['test_author']);

            const api = await asAdmin();
            const ungranted = await api
                .post('/api/alarms/rules')
                .send(rulePayload())
                .expect(404);
            const unknown = await api
                .post('/api/alarms/rules')
                .send(rulePayload({ contentType: 'no_such_type' }))
                .expect(404);

            // Same status, and the same sentence with only the caller's own
            // argument substituted in. That is the property that matters:
            // nothing in either answer says whether the type exists, so the
            // rule editor cannot be used to enumerate the content model.
            expect(ungranted.body.message).toBe(
                'Unknown content type "test_article".'
            );
            expect(unknown.body.message).toBe(
                'Unknown content type "no_such_type".'
            );
        });
    });

    describe('preview', () => {
        it('reports matches against the collection total', async () => {
            await seedArticles(
                [
                    { text: null, status: 'published' },
                    { text: 'fine', status: 'published' },
                    { text: 'also fine', status: 'draft' }
                ],
                workspaceId
            );

            const api = await asAdmin();
            const res = await api
                .post('/api/alarms/rules/preview')
                .send({
                    contentType: 'test_article',
                    filter: EMPTY_TEXT_FILTER
                })
                .expect(200);

            expect(res.body).toMatchObject({ matched: 1, total: 3 });
        });
    });

    describe('update', () => {
        it('rescans when the filter changes, so findings never describe the old condition', async () => {
            await seedArticles(
                [
                    { text: null, status: 'published' },
                    { text: 'has a body', status: 'published' }
                ],
                workspaceId
            );

            const api = await asAdmin();
            const created = await api
                .post('/api/alarms/rules')
                .send(rulePayload())
                .expect(201);
            expect(created.body.rule.openCount).toBe(1);

            // Widen the condition to "every published article".
            const updated = await api
                .patch(`/api/alarms/rules/${created.body.rule.id}`)
                .send({
                    filter: {
                        and: [{ field: 'status', op: 'eq', value: 'published' }]
                    }
                })
                .expect(200);

            expect(updated.body.openCount).toBe(2);
        });
    });

    describe('deletion', () => {
        it('takes the rule and its findings with it [alarms:I-13]', async () => {
            await seedArticles(
                [{ text: null, status: 'published' }],
                workspaceId
            );
            const api = await asAdmin();
            const created = await api
                .post('/api/alarms/rules')
                .send(rulePayload())
                .expect(201);

            await api
                .delete(`/api/alarms/rules/${created.body.rule.id}`)
                .expect(204);

            const findings = await api.get('/api/alarms/findings').expect(200);
            expect(findings.body.total).toBe(0);
        });

        it('refuses to delete another workspace’s rule [alarms:I-13]', async () => {
            // A member of both workspaces, holding `alarms:manage` in each.
            // The rule id is a uuid, so a caller has to have been told it —
            // and this is precisely the caller who would have been.
            const other = await seedWorkspace({
                name: 'Neighbour',
                slug: 'neighbour'
            });
            await seedMembership(admin.id, other.id);
            await seedAllContentGrants(other.id);
            await seedArticles([{ text: null, status: 'published' }], other.id);

            const neighbour = await login(ADMIN_EMAIL, other.id);
            const created = await neighbour
                .post('/api/alarms/rules')
                .send(rulePayload())
                .expect(201);
            const foreignRuleId = created.body.rule.id as string;
            expect(created.body.rule.openCount).toBe(1);

            // The same session, presenting *this* workspace's header.
            const api = await asAdmin();
            await api.delete(`/api/alarms/rules/${foreignRuleId}`).expect(404);

            // Nothing was taken with it. Dropping the `workspace_id` clause
            // from the DELETE's `where` makes this a 204 whose FK cascade then
            // removes a neighbour's findings as well — the workspace check is
            // the only thing standing between the two tenants, because the
            // guards upstream only ever saw this caller's own workspace.
            const rules = await neighbour.get('/api/alarms/rules').expect(200);
            expect(rules.body.map((rule: { id: string }) => rule.id)).toEqual([
                foreignRuleId
            ]);
            const surviving = await neighbour
                .get('/api/alarms/findings')
                .expect(200);
            expect(surviving.body.total).toBe(1);
        });
    });

    describe('authorization', () => {
        it('lets a viewer read rules but not write them [alarms:I-17]', async () => {
            const api = await asAdmin();
            await api.post('/api/alarms/rules').send(rulePayload()).expect(201);

            const viewerAgent = await login(VIEWER_EMAIL);
            await viewerAgent
                .get('/api/alarms/rules')
                .set('X-Workspace-Id', workspaceId)
                .expect(200);
            await viewerAgent
                .post('/api/alarms/rules')
                .set('X-Workspace-Id', workspaceId)
                .send(rulePayload({ name: 'Another' }))
                .expect(403);
        });

        it('refuses a caller who is not a member of the workspace [alarms:I-17]', async () => {
            const outsider = await seedActiveUser(harness.app, {
                email: 'outsider@example.com',
                password: PASSWORD,
                role: 'admin'
            });
            expect(outsider.id).toBeDefined();

            const agent = await login('outsider@example.com');
            await agent
                .get('/api/alarms/rules')
                .set('X-Workspace-Id', workspaceId)
                .expect(403);
        });

        /**
         * `OriginGuard` on **all five** writing routes.
         *
         * These routes are cookie-authenticated, so a page on any other origin
         * can make a signed-in administrator's browser issue them — and one of
         * them deletes a rule and every finding under it. The guard is applied
         * per route rather than to the class, which is exactly the shape that
         * loses a route silently: adding a sixth write and forgetting the
         * decorator leaves no trace anywhere else.
         *
         * The allowed-origin repeat at the end is the discriminator: without
         * it, a fixture that had gone wrong somewhere upstream would produce
         * the same five 403s.
         */
        it('refuses every write carrying a foreign Origin [alarms:I-17]', async () => {
            const api = await asAdmin();
            const created = await api
                .post('/api/alarms/rules')
                .send(rulePayload())
                .expect(201);
            const id = created.body.rule.id as string;

            const writes = [
                {
                    route: 'POST /alarms/rules',
                    send: () =>
                        api
                            .post('/api/alarms/rules')
                            .send(rulePayload({ name: 'Second rule' }))
                },
                {
                    route: 'POST /alarms/rules/preview',
                    send: () =>
                        api.post('/api/alarms/rules/preview').send({
                            contentType: 'test_article',
                            filter: EMPTY_TEXT_FILTER
                        })
                },
                {
                    route: 'PATCH /alarms/rules/:id',
                    send: () =>
                        api
                            .patch(`/api/alarms/rules/${id}`)
                            .send({ name: 'Renamed' })
                },
                {
                    route: 'POST /alarms/rules/:id/rescan',
                    send: () => api.post(`/api/alarms/rules/${id}/rescan`)
                },
                {
                    route: 'DELETE /alarms/rules/:id',
                    send: () => api.delete(`/api/alarms/rules/${id}`)
                }
            ];

            for (const write of writes) {
                const res = await write
                    .send()
                    .set('Origin', 'https://evil.example');
                // Named, so a regression says *which* route lost its guard.
                expect([write.route, res.status]).toEqual([write.route, 403]);
            }

            // The rule is untouched — none of those five ran.
            const rules = await api.get('/api/alarms/rules').expect(200);
            expect(rules.body).toHaveLength(1);
            expect(rules.body[0]).toMatchObject({
                id,
                name: 'Published with no body'
            });

            // And from the app's own origin every one of them works.
            await api
                .patch(`/api/alarms/rules/${id}`)
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({ name: 'Renamed' })
                .expect(200);
            await api
                .post(`/api/alarms/rules/${id}/rescan`)
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .expect(200);
            await api
                .post('/api/alarms/rules/preview')
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({
                    contentType: 'test_article',
                    filter: EMPTY_TEXT_FILTER
                })
                .expect(200);
            await api
                .delete(`/api/alarms/rules/${id}`)
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .expect(204);
        });
    });
});
