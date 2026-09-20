import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@orthacms/database';
import { workspaceContent } from '@orthacms/workspaces-server';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    countUsers,
    getWorkspaceIdsForUser,
    resetDb,
    seedActiveUser,
    type SeededUser,
    type SystemRoleKey
} from '../../support/seed';
import { TEST_ALLOWED_ORIGIN } from '../../support/test-config';

const PASSWORD = 'SecurePass123!';
const ADMIN_EMAIL = 'ws-admin@example.com';

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
 * `POST /api/workspaces` — creates a workspace. Requires authentication
 * (app-wide `AuthGuard`), the `workspaces:create` permission
 * (`PermissionsGuard`), and a same-origin request (`OriginGuard`).
 */
describe('POST /api/workspaces', () => {
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

    /** Seed a user of `role`, log them in, and return the user + cookie agent. */
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

    describe('authenticated admin (holds workspaces:create)', () => {
        it('creates a workspace and seeds the creator as its sole member', async () => {
            const { user, agent } = await loginAs('admin', ADMIN_EMAIL);

            const res = await agent
                .post('/api/workspaces')
                .send(validBody())
                .expect(201);

            expect(Object.keys(res.body).sort()).toEqual([
                'color',
                'content',
                'description',
                'id',
                'members',
                'name',
                'slug',
                'status'
            ]);
            expect(res.body).toEqual(
                expect.objectContaining({
                    name: 'Marketing site',
                    slug: 'marketing-site',
                    description: 'Landing pages and the blog.',
                    color: 'violet',
                    status: 'active'
                })
            );
            // The creator comes from the session, not the body, and is the only
            // member when none are supplied.
            expect(res.body.members).toHaveLength(1);
            expect(res.body.members[0]).toEqual(
                expect.objectContaining({
                    id: user.id,
                    email: ADMIN_EMAIL
                })
            );
            expect(Object.keys(res.body.members[0]).sort()).toEqual([
                'email',
                'id',
                'name'
            ]);
        });

        it('rejects a duplicate slug with 409', async () => {
            const { agent } = await loginAs('admin', ADMIN_EMAIL);
            await agent.post('/api/workspaces').send(validBody()).expect(201);
            await agent.post('/api/workspaces').send(validBody()).expect(409);
        });
    });

    describe('authorization', () => {
        it('rejects an unauthenticated request with 401', async () => {
            await request(harness.server)
                .post('/api/workspaces')
                .send(validBody())
                .expect(401);
        });

        it('forbids a contributor (lacks workspaces:create) with 403', async () => {
            const { agent } = await loginAs(
                'contributor',
                'ws-contributor@example.com'
            );
            await agent.post('/api/workspaces').send(validBody()).expect(403);
        });

        it('forbids a viewer (lacks workspaces:create) with 403', async () => {
            const { agent } = await loginAs('viewer', 'ws-viewer@example.com');
            await agent.post('/api/workspaces').send(validBody()).expect(403);
        });
    });

    describe('validation (400)', () => {
        it('rejects a missing name', async () => {
            const { agent } = await loginAs('admin', ADMIN_EMAIL);
            const body = validBody();
            delete body.name;
            await agent.post('/api/workspaces').send(body).expect(400);
        });

        it('rejects a slug with illegal characters', async () => {
            const { agent } = await loginAs('admin', ADMIN_EMAIL);
            await agent
                .post('/api/workspaces')
                .send(validBody({ slug: 'Not A Slug' }))
                .expect(400);
        });

        it('rejects an unknown extra field', async () => {
            const { agent } = await loginAs('admin', ADMIN_EMAIL);
            await agent
                .post('/api/workspaces')
                .send(validBody({ rogue: true }))
                .expect(400);
        });

        it('rejects a missing content block', async () => {
            const { agent } = await loginAs('admin', ADMIN_EMAIL);
            const body = validBody();
            delete body.content;
            await agent.post('/api/workspaces').send(body).expect(400);
        });

        it('rejects a color outside the seven-key palette [workspaces:I-12]', async () => {
            const { agent } = await loginAs('admin', ADMIN_EMAIL);
            // The palette is a closed set (`WORKSPACE_COLORS`) because the
            // admin casts the stored value straight to an `AvatarColor`; a
            // `#bada55` that reached the column would render as nothing.
            await agent
                .post('/api/workspaces')
                .send(validBody({ color: 'chartreuse' }))
                .expect(400);
            await agent
                .post('/api/workspaces')
                .send(validBody({ color: '#bada55' }))
                .expect(400);
        });

        it.each([
            ['a slug of 121 characters', { slug: 'a'.repeat(121) }],
            ['a name of 121 characters', { name: 'n'.repeat(121) }],
            [
                'a description of 2001 characters',
                { description: 'd'.repeat(2001) }
            ]
        ])('rejects %s', async (_label, overrides) => {
            const { agent } = await loginAs('admin', ADMIN_EMAIL);
            // The bounds are the column widths, so a body one character over
            // has to fail in the pipe rather than at the driver — where it
            // would be a 500, not a 400.
            await agent
                .post('/api/workspaces')
                .send(validBody(overrides))
                .expect(400);
        });

        it('accepts the boundary lengths themselves', async () => {
            const { agent } = await loginAs('admin', ADMIN_EMAIL);
            // The other half of the bound: 120 is legal, so the rejections
            // above are about the limit and not about long strings generally.
            await agent
                .post('/api/workspaces')
                .send(
                    validBody({
                        slug: 'a'.repeat(120),
                        name: 'n'.repeat(120),
                        description: 'd'.repeat(2000)
                    })
                )
                .expect(201);
        });
    });

    describe('member resolution', () => {
        it('provisions one account and one membership for an address invited twice [workspaces:I-25]', async () => {
            const { agent } = await loginAs('admin', ADMIN_EMAIL);

            // The wizard can put the same address in the list twice (typed
            // once, picked once). Both entries key on the same normalized
            // email, so they must collapse: two accounts would split one
            // person's future logins, and two membership rows would violate
            // `memberships_user_workspace_unique` and 500 the whole create.
            const res = await agent
                .post('/api/workspaces')
                .send(
                    validBody({
                        members: [
                            {
                                id: 'grace@example.com',
                                name: 'Grace',
                                email: 'grace@example.com',
                                invited: true
                            },
                            {
                                id: 'Grace@Example.com',
                                name: 'Grace',
                                email: 'Grace@Example.com',
                                invited: true
                            }
                        ]
                    })
                )
                .expect(201);

            const members = res.body.members as { id: string; email: string }[];
            expect(members).toHaveLength(2); // the creator + Grace, once
            const [grace] = members.filter(
                (m) => m.email === 'grace@example.com'
            );
            expect(grace).toBeDefined();
            // One directory row for the pair, and one link to this workspace.
            expect(await countUsers()).toBe(2);
            expect(await getWorkspaceIdsForUser(grace.id)).toEqual([
                res.body.id
            ]);
        });

        it('drops a member id that resolves to no user, and still creates [workspaces:I-26]', async () => {
            const { agent } = await loginAs('admin', ADMIN_EMAIL);

            // A stale id out of a directory picker — the user was deleted
            // between opening the wizard and submitting it. It is dropped
            // rather than allowed to abort the create on an FK violation:
            // nothing about the workspace depends on that one row.
            const res = await agent
                .post('/api/workspaces')
                .send(
                    validBody({
                        members: [
                            {
                                id: randomUUID(),
                                name: 'Ghost',
                                email: 'ghost@example.com',
                                invited: false
                            }
                        ]
                    })
                )
                .expect(201);

            expect(res.body.members).toHaveLength(1);
            expect(res.body.members[0].email).toBe(ADMIN_EMAIL);
            // No account was conjured for it — that is the invited path, and
            // this member was not invited.
            expect(await countUsers()).toBe(1);
        });

        it('links the creator once even when they are listed again', async () => {
            const { user, agent } = await loginAs('admin', ADMIN_EMAIL);

            // The creator is implied, but the admin UI cannot stop a client
            // from listing them too. `memberships` is unique on
            // (user, workspace), so a second link would be a 500 rather than a
            // duplicate row — the aggregate dedupes before either happens.
            const res = await agent
                .post('/api/workspaces')
                .send(
                    validBody({
                        members: [
                            {
                                id: user.id,
                                name: 'The creator',
                                email: ADMIN_EMAIL,
                                invited: false
                            }
                        ]
                    })
                )
                .expect(201);

            expect(res.body.members).toHaveLength(1);
            expect(await getWorkspaceIdsForUser(user.id)).toEqual([
                res.body.id
            ]);
        });
    });

    describe('content selection', () => {
        /** The `(kind, slug)` grants the create flattened into the join table. */
        async function grantsOf(
            workspaceId: string
        ): Promise<{ kind: string; slug: string }[]> {
            const rows = await getDatabase()
                .select({
                    kind: workspaceContent.kind,
                    slug: workspaceContent.slug
                })
                .from(workspaceContent)
                .where(eq(workspaceContent.workspaceId, workspaceId));
            return rows.sort((a, b) => a.slug.localeCompare(b.slug));
        }

        it('honours excludedIds under a per-kind "all"', async () => {
            const { agent } = await loginAs('admin', ADMIN_EMAIL);
            const res = await agent
                .post('/api/workspaces')
                .send(
                    validBody({
                        content: {
                            mode: 'specific',
                            collections: {
                                mode: 'all',
                                excludedIds: ['test_tag', 'test_seo']
                            }
                        }
                    })
                )
                .expect(201);

            // "All of this kind, minus these" is resolved server-side against
            // the catalogue, so the excluded slugs are simply never written —
            // there is no negative grant to interpret later.
            const slugs = (await grantsOf(res.body.id)).map((row) => row.slug);
            expect(slugs).toEqual([
                'test_article',
                'test_author',
                'test_comment',
                'test_page'
            ]);
            // `pages` was absent, so the single is not granted either.
            expect(slugs).not.toContain('test_landing');
        });

        it('drops an unknown slug under "specific" rather than granting nothing to it', async () => {
            const { agent } = await loginAs('admin', ADMIN_EMAIL);
            const res = await agent
                .post('/api/workspaces')
                .send(
                    validBody({
                        content: {
                            mode: 'specific',
                            collections: {
                                mode: 'specific',
                                ids: ['test_article', 'ghost_collection']
                            },
                            pages: {
                                mode: 'specific',
                                ids: ['test_landing', 'ghost_page']
                            }
                        }
                    })
                )
                .expect(201);

            // The selection is intersected with the catalogue, not trusted:
            // a grant naming a type that does not exist would be a row every
            // later guard has to reason about, and the single-grant route
            // already 400s the same slug.
            expect(await grantsOf(res.body.id)).toEqual([
                { kind: 'collection', slug: 'test_article' },
                { kind: 'single', slug: 'test_landing' }
            ]);
        });
    });

    describe('OriginGuard (CSRF)', () => {
        it('rejects a disallowed Origin with 403', async () => {
            const { agent } = await loginAs('admin', ADMIN_EMAIL);
            await agent
                .post('/api/workspaces')
                .set('Origin', 'https://evil.example')
                .send(validBody())
                .expect(403);
        });

        it('allows the configured app origin', async () => {
            const { agent } = await loginAs('admin', ADMIN_EMAIL);
            await agent
                .post('/api/workspaces')
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send(validBody())
                .expect(201);
        });

        it('allows a request with no Origin (non-browser client)', async () => {
            const { agent } = await loginAs('admin', ADMIN_EMAIL);
            await agent.post('/api/workspaces').send(validBody()).expect(201);
        });
    });
});
