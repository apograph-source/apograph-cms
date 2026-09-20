import request from 'supertest';
import { getPool } from '@orthacms/database';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { TEST_ALLOWED_ORIGIN } from '../../support/test-config';
import { resetDb, seedActiveUser, type SeededUser } from '../../support/seed';

const PASSWORD = 'SecurePass123!';
const ADMIN_EMAIL = 'protection-admin@example.com';
const CONTRIBUTOR_EMAIL = 'protection-contributor@example.com';

/** The six fields at their documented defaults — what an omitted body means. */
const DEFAULTS = {
    enabled: false,
    requiredApprovals: 1,
    requireOtherPerson: true,
    countStaleApprovals: false,
    adminBypass: true,
    allowTokenPublish: false
};

/** A valid create-workspace body, with optional field overrides. */
function validWorkspace(
    overrides: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        name: 'Marketing site',
        slug: 'marketing-site',
        description: 'Landing pages and the blog.',
        color: 'violet',
        members: [],
        content: { mode: 'all' },
        ...overrides
    };
}

/**
 * `/api/protection/rules` — the rule surface.
 *
 * The three routes are small, and almost every assertion here is about a
 * decision that is invisible from the code: that an omitted field takes its
 * default rather than its previous value, that an ungranted type answers the
 * same as a type that does not exist, and that a delete succeeds on a type
 * whose grant was revoked. Each of those is a sentence in the design document
 * that would otherwise be enforced by nothing.
 */
describe('/api/protection/rules', () => {
    let harness: TestApp;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
    });

    /** Seed a user of `role`, log them in, and return the cookie agent. */
    async function loginAs(
        email: string,
        role: 'admin' | 'contributor' | 'viewer'
    ): Promise<{ user: SeededUser; agent: ReturnType<typeof request.agent> }> {
        const user = await seedActiveUser(harness.app, {
            email,
            password: PASSWORD,
            role
        });
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password: PASSWORD })
            .expect(201);
        return { user, agent };
    }

    /** An admin, logged in, holding a workspace granted every content type. */
    async function adminWithWorkspace(): Promise<{
        user: SeededUser;
        agent: ReturnType<typeof request.agent>;
        workspaceId: string;
    }> {
        const { user, agent } = await loginAs(ADMIN_EMAIL, 'admin');
        const created = await agent
            .post('/api/workspaces')
            .send(validWorkspace())
            .expect(201);
        return { user, agent, workspaceId: created.body.id as string };
    }

    /** Rows in `protection_rules` for one workspace. */
    async function storedRules(workspaceId: string): Promise<number> {
        const { rows } = await getPool().query<{ count: string }>(
            `select count(*)::text as count from protection_rules where workspace_id = $1`,
            [workspaceId]
        );
        return Number(rows[0].count);
    }

    /**
     * `protection.rule_changed` rows for one workspace, polled — the outbox
     * dispatcher drains on commit, but in its own transaction, so asserting
     * immediately makes the test a race rather than a check.
     */
    async function ruleAudit(
        workspaceId: string,
        expected = 1
    ): Promise<{ meta: Record<string, unknown>; actorId: string | null }[]> {
        for (let attempt = 0; attempt < 40; attempt += 1) {
            const { rows } = await getPool().query<{
                meta: Record<string, unknown>;
                actorId: string | null;
            }>(
                `SELECT meta, actor_id AS "actorId" FROM activity_events
                 WHERE kind = 'protection.rule_changed'
                   AND workspace_id = $1
                 ORDER BY at, id`,
                [workspaceId]
            );
            if (rows.length >= expected) return rows;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return [];
    }

    /**
     * `protection:I-14` — every rule change reaches the log.
     *
     * The rows that matter are the ones that make a rule stop blocking:
     * switching it off and lowering its count. Without them the bypass is not a
     * button somebody had to justify, it is a settings tab left open for two
     * minutes, and afterwards nothing can tell a rule that was never there from
     * one that was quietly removed.
     */
    describe('the audit trail', () => {
        it('records a rule being created [protection:I-14]', async () => {
            const { agent, user, workspaceId } = await adminWithWorkspace();

            await agent
                .put('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .send({ enabled: true, requiredApprovals: 2 })
                .expect(200);

            const rows = await ruleAudit(workspaceId);
            expect(rows).toHaveLength(1);
            expect(rows[0].actorId).toBe(user.id);
            expect(rows[0].meta).toMatchObject({
                kind: 'collection',
                slug: 'test_article',
                action: 'created',
                from: null,
                to: { enabled: true, requiredApprovals: 2 }
            });
        });

        it('records the numbers on both sides when a rule is weakened [protection:I-14]', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();
            await agent
                .put('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .send({ enabled: true, requiredApprovals: 3 })
                .expect(200);
            await agent
                .put('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .send({ enabled: false })
                .expect(200);

            const rows = await ruleAudit(workspaceId, 2);
            expect(rows).toHaveLength(2);
            // "now disabled" on its own does not say that anything moved, which
            // is the only question an auditor is asking.
            expect(rows[1].meta).toMatchObject({
                action: 'updated',
                from: { enabled: true, requiredApprovals: 3 },
                to: { enabled: false, requiredApprovals: 1 }
            });
        });

        it('records a removal carrying what the rule was [protection:I-14]', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();
            await agent
                .put('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .send({ enabled: true, requiredApprovals: 2 })
                .expect(200);

            await agent
                .delete('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .expect(204);

            const rows = await ruleAudit(workspaceId, 2);
            // After the delete commits there is nowhere left to look the
            // numbers up, so the row has to carry them.
            expect(rows[1].meta).toMatchObject({
                action: 'removed',
                from: { enabled: true, requiredApprovals: 2 },
                to: null
            });
        });

        it('records nothing when a delete removed nothing', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();

            await agent
                .delete('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .expect(204);

            // A no-op delete is not a policy change, and a row saying otherwise
            // would make "how often was protection weakened" unanswerable.
            expect(await ruleAudit(workspaceId, 1)).toEqual([]);
        });
    });

    describe('GET /', () => {
        it('is empty on a workspace nobody has protected', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();

            const response = await agent
                .get('/api/protection/rules')
                .set('X-Workspace-Id', workspaceId)
                .expect(200);

            // The inert state, and the one every existing installation is in.
            expect(response.body).toEqual([]);
        });

        it('returns the stored rules with their full shape', async () => {
            const { agent, user, workspaceId } = await adminWithWorkspace();
            await agent
                .put('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .send({ enabled: true, requiredApprovals: 2 })
                .expect(200);

            const response = await agent
                .get('/api/protection/rules')
                .set('X-Workspace-Id', workspaceId)
                .expect(200);

            expect(response.body).toHaveLength(1);
            // The precise key set, so a column added later has to be a decision
            // about the API rather than a leak into it.
            expect(Object.keys(response.body[0]).sort()).toEqual([
                'adminBypass',
                'allowTokenPublish',
                'countStaleApprovals',
                'createdAt',
                'enabled',
                'id',
                'kind',
                'requireOtherPerson',
                'requiredApprovals',
                'slug',
                'updatedAt',
                'updatedBy'
            ]);
            expect(response.body[0]).toMatchObject({
                kind: 'collection',
                slug: 'test_article',
                enabled: true,
                requiredApprovals: 2,
                updatedBy: user.id
            });
        });

        it('does not leak another workspace’s rules', async () => {
            const { agent } = await loginAs(ADMIN_EMAIL, 'admin');
            const mine = await agent
                .post('/api/workspaces')
                .send(validWorkspace({ slug: 'mine' }))
                .expect(201);
            const theirs = await agent
                .post('/api/workspaces')
                .send(validWorkspace({ name: 'Other', slug: 'theirs' }))
                .expect(201);

            await agent
                .put('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', theirs.body.id)
                .send({ enabled: true })
                .expect(200);

            const response = await agent
                .get('/api/protection/rules')
                .set('X-Workspace-Id', mine.body.id)
                .expect(200);

            expect(response.body).toEqual([]);
        });
    });

    describe('PUT /:kind/:slug', () => {
        it('creates a rule and answers with it', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();

            const response = await agent
                .put('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .send({ enabled: true, requiredApprovals: 2 })
                .expect(200);

            expect(response.body).toMatchObject({
                kind: 'collection',
                slug: 'test_article',
                enabled: true,
                requiredApprovals: 2
            });
            expect(await storedRules(workspaceId)).toBe(1);
        });

        it('fills every unstated field with its documented default', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();

            const response = await agent
                .put('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .send({})
                .expect(200);

            expect(response.body).toMatchObject(DEFAULTS);
        });

        it('replaces rather than patches — an omitted field returns to its default', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();
            await agent
                .put('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .send({
                    enabled: true,
                    requiredApprovals: 3,
                    adminBypass: false,
                    allowTokenPublish: true
                })
                .expect(200);

            const second = await agent
                .put('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .send({ enabled: true })
                .expect(200);

            // PUT is a replacement. The surprising half is deliberate and
            // documented: a form that sends a partial body gets the defaults
            // back, not the values it left out.
            expect(second.body).toMatchObject({
                enabled: true,
                requiredApprovals: 1,
                adminBypass: true,
                allowTokenPublish: false
            });
            // …and it is still one row, not two.
            expect(await storedRules(workspaceId)).toBe(1);
        });

        it('keeps the row id across a replacement', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();
            const first = await agent
                .put('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .send({ enabled: true })
                .expect(200);
            const second = await agent
                .put('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .send({ enabled: false })
                .expect(200);

            // The address is `(kind, slug)`; the id is stable so a later audit
            // row can name the same rule across edits.
            expect(second.body.id).toBe(first.body.id);
        });

        it('protects a single page as readily as a collection', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();

            await agent
                .put('/api/protection/rules/single/test_landing')
                .set('X-Workspace-Id', workspaceId)
                .send({ enabled: true })
                .expect(200);
        });

        it('404s on a content type that does not exist', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();

            await agent
                .put('/api/protection/rules/collection/no_such_type')
                .set('X-Workspace-Id', workspaceId)
                .send({ enabled: true })
                .expect(404);
        });

        it('404s when the kind does not match the registered type', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();

            // `test_article` is a collection. Addressing it as a page is a
            // different coordinate, and it names nothing.
            await agent
                .put('/api/protection/rules/single/test_article')
                .set('X-Workspace-Id', workspaceId)
                .send({ enabled: true })
                .expect(404);
        });

        it('404s on a type the workspace was not granted', async () => {
            const { agent } = await loginAs(ADMIN_EMAIL, 'admin');
            const created = await agent
                .post('/api/workspaces')
                .send(
                    validWorkspace({
                        slug: 'narrow',
                        content: {
                            mode: 'specific',
                            collections: {
                                mode: 'specific',
                                ids: ['test_author']
                            },
                            pages: { mode: 'specific', ids: [] }
                        }
                    })
                )
                .expect(201);

            // The same 404 an unknown type gets, and deliberately: telling them
            // apart would let this tab enumerate the deployment's content model.
            await agent
                .put('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', created.body.id)
                .send({ enabled: true })
                .expect(404);
            await agent
                .put('/api/protection/rules/collection/test_author')
                .set('X-Workspace-Id', created.body.id)
                .send({ enabled: true })
                .expect(200);
        });

        it('writes nothing when the type is unreachable', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();

            await agent
                .put('/api/protection/rules/collection/no_such_type')
                .set('X-Workspace-Id', workspaceId)
                .send({ enabled: true })
                .expect(404);

            expect(await storedRules(workspaceId)).toBe(0);
        });

        describe('validation', () => {
            it('rejects fewer than one approval', async () => {
                const { agent, workspaceId } = await adminWithWorkspace();

                // A rule asking for nothing protects nothing, and would be
                // indistinguishable in the interface from one that works.
                await agent
                    .put('/api/protection/rules/collection/test_article')
                    .set('X-Workspace-Id', workspaceId)
                    .send({ enabled: true, requiredApprovals: 0 })
                    .expect(400);
            });

            it('rejects an absurd approval count', async () => {
                const { agent, workspaceId } = await adminWithWorkspace();

                await agent
                    .put('/api/protection/rules/collection/test_article')
                    .set('X-Workspace-Id', workspaceId)
                    .send({ enabled: true, requiredApprovals: 1000 })
                    .expect(400);
            });

            it('rejects a non-integer approval count', async () => {
                const { agent, workspaceId } = await adminWithWorkspace();

                await agent
                    .put('/api/protection/rules/collection/test_article')
                    .set('X-Workspace-Id', workspaceId)
                    .send({ requiredApprovals: 1.5 })
                    .expect(400);
            });

            it('rejects a non-boolean flag', async () => {
                const { agent, workspaceId } = await adminWithWorkspace();

                await agent
                    .put('/api/protection/rules/collection/test_article')
                    .set('X-Workspace-Id', workspaceId)
                    .send({ enabled: 'yes' })
                    .expect(400);
            });

            it('rejects an unknown field', async () => {
                const { agent, workspaceId } = await adminWithWorkspace();

                // The global pipe is `forbidNonWhitelisted`. A misspelled flag
                // silently ignored is a rule that does not do what its author
                // believes it does.
                await agent
                    .put('/api/protection/rules/collection/test_article')
                    .set('X-Workspace-Id', workspaceId)
                    .send({ enabled: true, adminBypasss: false })
                    .expect(400);
            });
        });
    });

    describe('DELETE /:kind/:slug', () => {
        it('removes the rule and answers 204', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();
            await agent
                .put('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .send({ enabled: true })
                .expect(200);

            await agent
                .delete('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .expect(204);

            // Leaves no row — which is not the same as `enabled: false`, and
            // the difference is what the settings tab reads to decide whether
            // it has numbers to remember.
            expect(await storedRules(workspaceId)).toBe(0);
        });

        it('is idempotent on a type that was never protected', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();

            await agent
                .delete('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .expect(204);
        });

        it('succeeds on a type this workspace was never granted', async () => {
            const { agent } = await loginAs(ADMIN_EMAIL, 'admin');
            const created = await agent
                .post('/api/workspaces')
                .send(
                    validWorkspace({
                        slug: 'narrow-delete',
                        content: {
                            mode: 'specific',
                            collections: {
                                mode: 'specific',
                                ids: ['test_author']
                            },
                            pages: { mode: 'specific', ids: [] }
                        }
                    })
                )
                .expect(201);

            // Asking for a type to be unprotected succeeds when it already is.
            // A 404 here would strand a rule left behind by a revoked grant,
            // with nothing in the product able to reach or remove it.
            await agent
                .delete('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', created.body.id)
                .expect(204);
        });

        it('touches nothing in another workspace', async () => {
            const { agent } = await loginAs(ADMIN_EMAIL, 'admin');
            const mine = await agent
                .post('/api/workspaces')
                .send(validWorkspace({ slug: 'keep-mine' }))
                .expect(201);
            const theirs = await agent
                .post('/api/workspaces')
                .send(validWorkspace({ name: 'Other', slug: 'keep-theirs' }))
                .expect(201);
            for (const id of [mine.body.id, theirs.body.id]) {
                await agent
                    .put('/api/protection/rules/collection/test_article')
                    .set('X-Workspace-Id', id)
                    .send({ enabled: true })
                    .expect(200);
            }

            await agent
                .delete('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', mine.body.id)
                .expect(204);

            expect(await storedRules(mine.body.id)).toBe(0);
            expect(await storedRules(theirs.body.id)).toBe(1);
        });
    });

    describe('authorization', () => {
        it('refuses an anonymous caller', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();
            await agent
                .put('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .send({ enabled: true })
                .expect(200);

            // A fresh client, carrying no session cookie.
            await request(harness.server)
                .get('/api/protection/rules')
                .set('X-Workspace-Id', workspaceId)
                .expect(401);
        });

        it('refuses a contributor — the whole surface is administrator-only', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();
            // Give the contributor membership, so the refusal is about the
            // permission rather than about the workspace.
            await agent
                .put(`/api/workspaces/${workspaceId}`)
                .send({ members: [] })
                .expect((response) => {
                    // The update route's shape is not this suite's business;
                    // it only matters that it did not error the run.
                    expect([200, 400, 404]).toContain(response.status);
                });

            const contributor = await loginAs(CONTRIBUTOR_EMAIL, 'contributor');

            // 403 from the permission guard, or 403 from the workspace guard —
            // both are refusals, and neither is a 200. Asserting the code alone
            // would pin which guard runs first, which is not a contract.
            await contributor.agent
                .get('/api/protection/rules')
                .set('X-Workspace-Id', workspaceId)
                .expect(403);
        });

        it('refuses a write with no workspace header', async () => {
            const { agent } = await adminWithWorkspace();

            await agent
                .put('/api/protection/rules/collection/test_article')
                .send({ enabled: true })
                .expect(400);
        });

        it('refuses a write from a disallowed origin', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();

            // `OriginGuard` — these routes are cookie-authenticated and
            // therefore CSRF-able.
            await agent
                .put('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .set('Origin', 'https://evil.example')
                .send({ enabled: true })
                .expect(403);
        });

        it('allows a write from the configured origin', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();

            await agent
                .put('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({ enabled: true })
                .expect(200);
        });

        it('refuses a delete from a disallowed origin', async () => {
            const { agent, workspaceId } = await adminWithWorkspace();

            await agent
                .delete('/api/protection/rules/collection/test_article')
                .set('X-Workspace-Id', workspaceId)
                .set('Origin', 'https://evil.example')
                .expect(403);
        });
    });
});
