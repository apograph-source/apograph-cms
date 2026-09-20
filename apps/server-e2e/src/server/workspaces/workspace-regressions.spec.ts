import request from 'supertest';
import {
    WorkspacePurgeRegistry,
    type WorkspacePurgeOutcome
} from '@orthacms/workspaces-server';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    drainOutbox,
    getOutboxRows,
    suspendOutboxDispatch
} from '../../support/outbox';
import {
    apiTokenExists,
    countApiTokenGrants,
    countMediaAssets,
    countMediaFolders,
    getActivityRows,
    resetDb,
    seedActiveUser,
    seedApiTokenWorkspaceGrant,
    seedArticles,
    seedMediaAsset,
    seedMediaFolder,
    seedUser,
    type SeededUser,
    type SystemRoleKey
} from '../../support/seed';

const PASSWORD = 'SecurePass123!';

/** A valid create-workspace body, with optional field overrides. */
function validBody(
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
 * Regression suite for the defects the ORT-53 QA pass confirmed against a live
 * stack. Every case here fails on the pre-fix build, so it pins the behaviour
 * rather than merely describing it.
 *
 * They are grouped in one file because they share a property the feature suites
 * don't reach: each is a *failure* or *race* path — the last member, a
 * simultaneous duplicate slug, an address that isn't one, a route that answered
 * anybody who asked.
 */
describe('Workspaces regressions', () => {
    let harness: TestApp;

    /**
     * How the harness-registered purger behaves on the next delete.
     *
     * One purger, scripted per test, rather than one registration per case:
     * `WorkspacePurgeRegistry` refuses a duplicate `purgeName` and offers no
     * way to withdraw a contributor, so registering inside a test would poison
     * every test after it in this file. Registered once with `'noop'` as the
     * default, it is inert for every case that doesn't script it.
     */
    const scriptedPurger = {
        mode: 'noop' as 'noop' | 'throw' | 'fail-reclaim'
    };

    beforeAll(async () => {
        harness = await createTestApp();
        harness.app.get(WorkspacePurgeRegistry).register({
            purgeName: 'e2e:scripted',
            purge: async (): Promise<WorkspacePurgeOutcome> => {
                if (scriptedPurger.mode === 'throw') {
                    throw new Error('scripted purger refused the delete');
                }
                return {
                    rows: 0,
                    reclaim:
                        scriptedPurger.mode === 'fail-reclaim'
                            ? async () => {
                                  throw new Error(
                                      'scripted reclaim could not reach its store'
                                  );
                              }
                            : undefined
                };
            }
        });
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        scriptedPurger.mode = 'noop';
    });

    async function loginAs(
        role: SystemRoleKey,
        email: string
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

    describe('removing the last member', () => {
        it('is refused, leaving the workspace reachable [workspaces:I-08]', async () => {
            const { user, agent } = await loginAs(
                'admin',
                'wsr-last@example.com'
            );
            const created = await agent
                .post('/api/workspaces')
                .send(validBody())
                .expect(201);
            const id = created.body.id as string;

            // Access is membership-scoped, so removing the sole member used to
            // leave a row nobody — not even a global admin — could reach.
            await agent
                .delete(`/api/workspaces/${id}/members/${user.id}`)
                .expect(409);

            const list = await agent.get('/api/workspaces').expect(200);
            expect((list.body as { id: string }[]).map((w) => w.id)).toContain(
                id
            );
            await agent
                .patch(`/api/workspaces/${id}`)
                .send({ name: 'Still mine' })
                .expect(200);
        });

        it('still allows leaving while another member remains', async () => {
            const { user, agent } = await loginAs(
                'admin',
                'wsr-leave@example.com'
            );
            const other = await seedUser(harness.app, {
                email: 'wsr-other@example.com',
                role: 'viewer',
                status: 'active'
            });
            const created = await agent
                .post('/api/workspaces')
                .send(validBody({ slug: 'leavable' }))
                .expect(201);
            const id = created.body.id as string;

            await agent
                .post(`/api/workspaces/${id}/members`)
                .send({ userId: other.id })
                .expect(201);
            await agent
                .delete(`/api/workspaces/${id}/members/${user.id}`)
                .expect(204);
        });
    });

    describe('concurrent creates with the same slug', () => {
        it('yields exactly one 201 and 409s the losers, never a 500 [workspaces:I-10]', async () => {
            const { agent } = await loginAs('admin', 'wsr-race@example.com');

            // The availability pre-check is a read-then-write: every request
            // reads "free" before any of them inserts. The unique index is the
            // only real arbiter, so its rejection has to surface as the same
            // 409 the pre-check raises.
            const responses = await Promise.all(
                Array.from({ length: 4 }, () =>
                    agent.post('/api/workspaces').send(validBody())
                )
            );
            const codes = responses.map((res) => res.status).sort();

            expect(codes.filter((code) => code === 201)).toHaveLength(1);
            expect(codes.filter((code) => code === 409)).toHaveLength(3);
            expect(codes).not.toContain(500);

            const list = await agent.get('/api/workspaces').expect(200);
            expect(list.body).toHaveLength(1);
        });
    });

    describe('invited member emails', () => {
        it.each([
            ['whitespace only', '   '],
            ['not an address', 'not-an-email']
        ])(
            'rejects %s instead of provisioning a user',
            async (_label, email) => {
                const { agent } = await loginAs(
                    'admin',
                    'wsr-email@example.com'
                );

                // An invited member is provisioned as a real account keyed on this
                // value; a blank one used to normalise to '' and become a single
                // ghost user that every later blank invite reused.
                await agent
                    .post('/api/workspaces')
                    .send(
                        validBody({
                            members: [
                                { id: email, name: email, email, invited: true }
                            ]
                        })
                    )
                    .expect(400);
            }
        );

        it('still provisions a pending account for a real address', async () => {
            const { agent } = await loginAs('admin', 'wsr-invite@example.com');
            const created = await agent
                .post('/api/workspaces')
                .send(
                    validBody({
                        members: [
                            {
                                id: 'grace@example.com',
                                name: 'Grace',
                                email: 'Grace@Example.com',
                                invited: true
                            }
                        ]
                    })
                )
                .expect(201);

            const emails = (created.body.members as { email: string }[]).map(
                (member) => member.email
            );
            expect(emails).toContain('grace@example.com');
        });
    });

    describe('members array size', () => {
        it('refuses an array past the cap', async () => {
            const { agent } = await loginAs('admin', 'wsr-cap@example.com');

            // Provisioning happens inside the create transaction, so the array
            // length sets how long that transaction is held open.
            const members = Array.from({ length: 201 }, (_unused, i) => ({
                id: `cap${i}@example.com`,
                name: `cap${i}`,
                email: `cap${i}@example.com`,
                invited: true
            }));
            await agent
                .post('/api/workspaces')
                .send(validBody({ members }))
                .expect(400);
        });
    });

    describe('read routes that fed the create/grant decision', () => {
        it('403s the slug probe for a role that cannot create [workspaces:I-29]', async () => {
            const { agent } = await loginAs('viewer', 'wsr-probe@example.com');

            // It answers "does this slug exist" — an enumeration of the tenancy
            // for anyone who is merely signed in.
            await agent
                .get('/api/workspaces/slug-available?slug=marketing-site')
                .expect(403);
        });

        it('403s the content-type catalogue for a role that can neither create nor update', async () => {
            const { agent } = await loginAs('viewer', 'wsr-cat@example.com');
            await agent.get('/api/content-types').expect(403);
        });

        it('still serves both to a role that can create', async () => {
            const { agent } = await loginAs('admin', 'wsr-admin@example.com');
            await agent
                .get('/api/workspaces/slug-available?slug=free-slug')
                .expect(200);
            await agent.get('/api/content-types').expect(200);
        });
    });

    describe('deleting a workspace purges its cross-plugin rows', () => {
        it('removes media and token-bucket rows that no foreign key reaches [media:I-35]', async () => {
            const { user, agent } = await loginAs(
                'admin',
                'wsr-purge@example.com'
            );
            const created = await agent
                .post('/api/workspaces')
                .send(validBody({ slug: 'purgeable' }))
                .expect(201);
            const id = created.body.id as string;

            // Only `memberships`, `workspace_content` and copilot's tables
            // carry an FK to `workspaces`. These three do not — media's rows
            // because media is a separate plugin, the token bucket because
            // identity must not depend on the workspaces package — so before
            // the purge they simply outlived the workspace.
            const folder = await seedMediaFolder({
                workspaceId: id,
                name: 'Brand'
            });
            await seedMediaAsset({
                workspaceId: id,
                uploadedBy: user.id,
                name: 'logo.png',
                folderId: folder.id
            });
            await seedMediaAsset({
                workspaceId: id,
                uploadedBy: user.id,
                name: 'loose.pdf'
            });
            await seedApiTokenWorkspaceGrant({
                workspaceId: id,
                createdBy: user.id
            });

            expect(await countMediaAssets(id)).toBe(2);
            expect(await countMediaFolders(id)).toBe(1);
            expect(await countApiTokenGrants(id)).toBe(1);

            await agent.delete(`/api/workspaces/${id}`).expect(204);

            expect(await countMediaAssets(id)).toBe(0);
            expect(await countMediaFolders(id)).toBe(0);
            expect(await countApiTokenGrants(id)).toBe(0);
        });

        it('drops the workspace from a token bucket without revoking the token [workspaces:I-28]', async () => {
            const { user, agent } = await loginAs(
                'admin',
                'wsr-token@example.com'
            );
            const doomed = await agent
                .post('/api/workspaces')
                .send(validBody({ slug: 'doomed' }))
                .expect(201);
            const survivor = await agent
                .post('/api/workspaces')
                .send(validBody({ name: 'Kept', slug: 'kept' }))
                .expect(201);
            const doomedId = doomed.body.id as string;
            const survivorId = survivor.body.id as string;

            const { tokenId } = await seedApiTokenWorkspaceGrant({
                workspaceId: doomedId,
                createdBy: user.id
            });
            await seedApiTokenWorkspaceGrant({
                workspaceId: survivorId,
                createdBy: user.id,
                name: 'second-bucket'
            });

            await agent.delete(`/api/workspaces/${doomedId}`).expect(204);

            // Purging a bucket row narrows a credential's reach; it is not a
            // revocation, which would be a policy call this has no standing
            // to make. The token keeps working in the workspaces that remain.
            expect(await apiTokenExists(tokenId)).toBe(true);
            expect(await countApiTokenGrants(doomedId)).toBe(0);
            expect(await countApiTokenGrants(survivorId)).toBe(1);
        });

        it('leaves another workspace’s rows untouched', async () => {
            const { user, agent } = await loginAs(
                'admin',
                'wsr-scope@example.com'
            );
            const doomed = await agent
                .post('/api/workspaces')
                .send(validBody({ slug: 'doomed-two' }))
                .expect(201);
            const keeper = await agent
                .post('/api/workspaces')
                .send(validBody({ name: 'Keeper', slug: 'keeper' }))
                .expect(201);
            const doomedId = doomed.body.id as string;
            const keeperId = keeper.body.id as string;

            await seedMediaFolder({ workspaceId: doomedId, name: 'Going' });
            await seedMediaAsset({
                workspaceId: doomedId,
                uploadedBy: user.id,
                name: 'going.pdf'
            });
            await seedMediaFolder({ workspaceId: keeperId, name: 'Staying' });
            await seedMediaAsset({
                workspaceId: keeperId,
                uploadedBy: user.id,
                name: 'staying.pdf'
            });

            await agent.delete(`/api/workspaces/${doomedId}`).expect(204);

            // The purge is a `where workspace_id = …` delete; the whole point
            // is that it cannot be a `delete from media_asset`.
            expect(await countMediaAssets(keeperId)).toBe(1);
            expect(await countMediaFolders(keeperId)).toBe(1);
        });

        it('purges nothing when the delete is refused', async () => {
            const { user, agent } = await loginAs(
                'admin',
                'wsr-refused@example.com'
            );
            const created = await agent
                .post('/api/workspaces')
                .send(validBody({ slug: 'has-content' }))
                .expect(201);
            const id = created.body.id as string;

            await seedMediaFolder({ workspaceId: id, name: 'Kept' });
            await seedMediaAsset({
                workspaceId: id,
                uploadedBy: user.id,
                name: 'kept.pdf'
            });
            // One content entry makes the "no orphaned content" rule bite, so
            // the delete is refused after the purge would already have run.
            await seedArticles([{ text: 'blocking', select: 'a' }], id);

            await agent.delete(`/api/workspaces/${id}`).expect(409);

            // The purge runs inside the transaction, before the workspace row
            // goes — a refused delete must roll it back with everything else.
            expect(await countMediaAssets(id)).toBe(1);
            expect(await countMediaFolders(id)).toBe(1);
        });

        it('rolls everything back when one purger throws [workspaces:I-17]', async () => {
            const { user, agent } = await loginAs(
                'admin',
                'wsr-purger@example.com'
            );
            const created = await agent
                .post('/api/workspaces')
                .send(validBody({ slug: 'purger-throws' }))
                .expect(201);
            const id = created.body.id as string;

            await seedMediaFolder({ workspaceId: id, name: 'Kept' });
            await seedMediaAsset({
                workspaceId: id,
                uploadedBy: user.id,
                name: 'kept.pdf'
            });
            await seedApiTokenWorkspaceGrant({
                workspaceId: id,
                createdBy: user.id
            });

            // The scripted purger registers last, so the shipped ones have
            // already deleted their rows when it throws. "Most of the workspace
            // was deleted" is precisely the orphaning the registry exists to
            // prevent, so the failure has to take all of it back — including
            // the parts a different plugin removed.
            scriptedPurger.mode = 'throw';
            await agent.delete(`/api/workspaces/${id}`).expect(500);

            expect(await countMediaAssets(id)).toBe(1);
            expect(await countMediaFolders(id)).toBe(1);
            expect(await countApiTokenGrants(id)).toBe(1);
            const list = await agent.get('/api/workspaces').expect(200);
            expect((list.body as { id: string }[]).map((w) => w.id)).toContain(
                id
            );
            // No event either: the outbox write shares the transaction, so a
            // rolled-back delete cannot be audited as one that happened.
            expect(
                (await getActivityRows()).filter(
                    (row) => row.kind === 'workspace.deleted'
                )
            ).toHaveLength(0);
        });

        it('still answers 204 when a post-commit reclaim fails', async () => {
            const { user, agent } = await loginAs(
                'admin',
                'wsr-reclaim@example.com'
            );
            const created = await agent
                .post('/api/workspaces')
                .send(validBody({ slug: 'reclaim-fails' }))
                .expect(201);
            const id = created.body.id as string;

            await seedMediaFolder({ workspaceId: id, name: 'Going' });
            await seedMediaAsset({
                workspaceId: id,
                uploadedBy: user.id,
                name: 'going.pdf'
            });

            // Reclaim runs *after* the commit, because bytes in object storage
            // cannot join a transaction. By the time it fails the rows are gone
            // for good, so reporting a failed delete would be a lie the caller
            // has nothing to do about; what is left behind is unreferenced
            // bytes, which is a garbage-collection problem and a log line.
            scriptedPurger.mode = 'fail-reclaim';
            await agent.delete(`/api/workspaces/${id}`).expect(204);

            expect(await countMediaAssets(id)).toBe(0);
            expect(await countMediaFolders(id)).toBe(0);
            const list = await agent.get('/api/workspaces').expect(200);
            expect(
                (list.body as { id: string }[]).map((w) => w.id)
            ).not.toContain(id);
            expect(
                (await getActivityRows()).filter(
                    (row) => row.kind === 'workspace.deleted'
                )
            ).toHaveLength(1);
        });
    });

    describe('an entry create racing an emptiness guard', () => {
        /** A workspace granted every content type, owned by `agent`. */
        async function workspaceWithContent(
            agent: ReturnType<typeof request.agent>,
            slug: string
        ): Promise<string> {
            const created = await agent
                .post('/api/workspaces')
                .send(validBody({ slug }))
                .expect(201);
            return created.body.id as string;
        }

        /** How many entries the workspace holds, across every type. */
        async function entryCount(
            agent: ReturnType<typeof request.agent>,
            id: string
        ): Promise<number> {
            const res = await agent
                .get(`/api/workspaces/${id}/entry-count`)
                .expect(200);
            return res.body.count as number;
        }

        it('serialises against a content revoke, so the entry still holds the workspace', async () => {
            const { agent } = await loginAs('admin', 'wsr-revoke@example.com');
            const id = await workspaceWithContent(agent, 'revoke-race');

            // Revoke takes the workspace's content lock exclusively, create
            // takes it shared, so the two cannot interleave between the
            // emptiness count and the mutation. Either order is legal; what is
            // not legal is a revoke that reported "empty" while an entry it
            // could not see was already committed.
            const [entry, revoke] = await Promise.all([
                agent
                    .post('/api/content/test_article')
                    .set('X-Workspace-Id', id)
                    .send({
                        values: { text: 'Hello world', select: 'article' }
                    }),
                agent.delete(`/api/workspaces/${id}/content/test_article`)
            ]);

            // A create that lost the race can also be refused outright — the
            // grant guard runs before the write and 404s a type the workspace
            // no longer holds.
            expect([201, 404]).toContain(entry.status);
            expect([200, 409]).toContain(revoke.status);

            const entries = entry.status === 201 ? 1 : 0;
            // The delete guard counts every type's rows, granted or not, so an
            // entry written a moment after its grant went is still *counted* —
            // it holds the workspace open rather than becoming a row nothing
            // knows about.
            expect(await entryCount(agent, id)).toBe(entries);
            await agent
                .delete(`/api/workspaces/${id}`)
                .expect(entries === 1 ? 409 : 204);
        });

        it('serialises against a workspace delete', async () => {
            const { agent } = await loginAs('admin', 'wsr-delete@example.com');
            const id = await workspaceWithContent(agent, 'delete-race');

            const [entry, remove] = await Promise.all([
                agent
                    .post('/api/content/test_article')
                    .set('X-Workspace-Id', id)
                    .send({
                        values: { text: 'Hello world', select: 'article' }
                    }),
                agent.delete(`/api/workspaces/${id}`)
            ]);

            expect([204, 409]).toContain(remove.status);
            const list = await agent.get('/api/workspaces').expect(200);
            const stillListed = (list.body as { id: string }[]).some(
                (w) => w.id === id
            );

            if (remove.status === 409) {
                // The create won the lock: its entry is committed, and it is
                // what refused the delete. No half-state — the workspace is
                // whole, with its content.
                expect(entry.status).toBe(201);
                expect(stillListed).toBe(true);
                expect(await entryCount(agent, id)).toBe(1);
            } else {
                // The delete won the lock. The workspace is gone in full, and
                // the create — whose guards ran while it still existed — either
                // completes behind it or is refused by a guard that has since
                // seen the membership cascade away. The lock cannot narrow that
                // window any further: it orders the two transactions, it does
                // not un-authorize a request already past its guards.
                expect(stillListed).toBe(false);
                expect([201, 403, 404]).toContain(entry.status);
            }
        });
    });

    describe('the outbox survives a dispatcher outage', () => {
        it('commits the change, holds the event, and audits it on recovery [workspaces:I-22]', async () => {
            const { agent } = await loginAs('admin', 'wsr-outbox@example.com');
            const restore = suspendOutboxDispatch(harness.app);

            try {
                // The mutation must not care that delivery is broken: the
                // outbox write shares its transaction, and `UnitOfWork.run`
                // swallows a failed post-commit drain by design.
                const created = await agent
                    .post('/api/workspaces')
                    .send(validBody({ slug: 'outbox-outage' }))
                    .expect(201);
                const id = created.body.id as string;

                // State change: durable.
                const list = await agent.get('/api/workspaces').expect(200);
                expect(
                    (list.body as { id: string }[]).map((w) => w.id)
                ).toContain(id);

                // Event: recorded, undelivered — not lost, which is the one
                // outcome an outbox exists to rule out.
                const pending = await getOutboxRows(id);
                expect(pending.map((row) => row.kind)).toEqual([
                    'workspace.created'
                ]);
                expect(pending[0].dispatchedAt).toBeNull();

                // Audit: nothing for *this* event yet, because the subscriber
                // never ran. Scoped by kind rather than counting the whole
                // table — logging in already wrote its own row, before the
                // dispatcher was suspended.
                const before = await getActivityRows();
                expect(
                    before.filter((row) => row.kind === 'workspace.created')
                ).toHaveLength(0);

                restore();
                await drainOutbox(harness.app);

                // Recovery delivers exactly once and stamps the row.
                const audited = await getActivityRows();
                expect(
                    audited.filter((row) => row.kind === 'workspace.created')
                ).toHaveLength(1);

                const settled = await getOutboxRows(id);
                expect(settled[0].dispatchedAt).not.toBeNull();
            } finally {
                restore();
            }
        });
    });
});
