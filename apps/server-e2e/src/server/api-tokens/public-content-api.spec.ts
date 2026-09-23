import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    apiTokenExists,
    expireApiToken,
    resetDb,
    seedActiveUser,
    seedArticles,
    seedArticleTags,
    seedContentGrants,
    seedLanding,
    seedMediaAsset,
    seedMembership,
    seedPages,
    seedTags,
    seedWorkspace
} from '../../support/seed';

const ADMIN_EMAIL = 'public-api-admin@example.com';
const PASSWORD = 'SecurePass123!';

/** Shape of one item in the public list envelope (only the asserted bits). */
interface PublicItem {
    id: string;
    status?: string;
    publishedAt?: string | null;
    locale?: string;
    localeGroupId?: string;
    values: Record<string, unknown>;
    translations?: PublicItem[];
    relations?: Record<
        string,
        {
            items: {
                id: string;
                createdAt: string;
                values: Record<string, unknown>;
            }[];
            total: number;
        }
    >;
    media?: Record<string, { items: { id: string }[]; total: number }>;
}

/** Shape of one summary in the public content-type list. */
interface TypeSummary {
    name: string;
}

/**
 * `/api/v1/...` — the PUBLIC, token-authenticated content read API. Covers the
 * bearer guard, the workspace bucket (single- vs multi-workspace tokens), the
 * published-only visibility rule, grant pruning, and the schema-discovery
 * routes.
 *
 * These routes are `@Public()`, so the session `AuthGuard` never runs on them —
 * a bearer token is the only way in, and a session cookie is not accepted.
 */
describe('Public content API (/api/v1)', () => {
    let harness: TestApp;
    let workspaceId: string;
    let otherWorkspaceId: string;
    /** The seeded admin — `media_asset.uploaded_by` needs a real user. */
    let adminId: string;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        adminId = (
            await seedActiveUser(harness.app, {
                email: ADMIN_EMAIL,
                password: PASSWORD,
                role: 'admin'
            })
        ).id;
        workspaceId = (await seedWorkspace({ name: 'WS A', slug: 'ws-a' })).id;
        otherWorkspaceId = (await seedWorkspace({ name: 'WS B', slug: 'ws-b' }))
            .id;
        // Both workspaces expose the article collection; `test_page` is
        // deliberately left ungranted so the grant gate has something to hide.
        await seedContentGrants(workspaceId, ['test_article']);
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

    /** Mints a token through the real management API and returns its secret. */
    async function mintToken(options: {
        workspaceIds: string[];
        scope?: 'read' | 'full';
    }): Promise<{ id: string; secret: string }> {
        const agent = await login();
        const res = await agent
            .post('/api/api-tokens')
            .send({
                name: 'e2e',
                workspaceIds: options.workspaceIds,
                scope: options.scope ?? 'read'
            })
            .expect(201);
        return { id: res.body.id, secret: res.body.secret };
    }

    /** Seeds one published article in `workspaceId` and returns its id. */
    async function seedPublished(text: string, ws = workspaceId) {
        const [id] = await seedArticles(
            [
                {
                    text,
                    select: 'article',
                    status: 'published',
                    publishedAt: new Date()
                }
            ],
            ws
        );
        return id;
    }

    describe('authentication', () => {
        it('401s without an Authorization header', async () => {
            await request(harness.server)
                .get('/api/v1/content/test_article')
                .expect(401);
        });

        it('401s on an unknown bearer token', async () => {
            await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', 'Bearer orthacms_not-a-real-token')
                .expect(401);
        });

        it('401s on a non-bearer Authorization scheme', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });
            await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Basic ${secret}`)
                .expect(401);
        });

        it('does not accept a session cookie in place of a token', async () => {
            const agent = await login();
            await agent.get('/api/v1/content/test_article').expect(401);
        });

        it('401s once the token is revoked', async () => {
            const { id, secret } = await mintToken({
                workspaceIds: [workspaceId]
            });
            await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            const agent = await login();
            await agent.delete(`/api/api-tokens/${id}`).expect(204);

            await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .expect(401);
        });

        it('401s once the token has expired', async () => {
            const { id, secret } = await mintToken({
                workspaceIds: [workspaceId]
            });
            // Works right up until it doesn't — asserting the "before" is what
            // makes the "after" about expiry rather than about the setup.
            await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            await expireApiToken(id);

            // Flat 401, indistinguishable from an unknown token: expired,
            // revoked, and never-existed must not be tellable apart.
            await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .expect(401);
        });

        it('answers unknown, revoked and expired with byte-identical 401s [api-tokens:I-17]', async () => {
            // The three refusals above each assert a status code, which is the
            // weaker half of the claim. "Indistinguishable" is a statement
            // about the bytes: any difference — a `message`, a header, a
            // trailing field — is an oracle that turns the public API into a
            // way to sort leaked strings into "was a token here once" and
            // "never existed", which is precisely the question an attacker
            // holding a dump of old CI configs is asking.
            const revoked = await mintToken({ workspaceIds: [workspaceId] });
            const expired = await mintToken({ workspaceIds: [workspaceId] });

            const agent = await login();
            await agent.delete(`/api/api-tokens/${revoked.id}`).expect(204);
            await expireApiToken(expired.id);

            const refusal = (secret: string) =>
                request(harness.server)
                    .get('/api/v1/content/test_article')
                    .set('Authorization', `Bearer ${secret}`)
                    .expect(401);

            const unknown = await refusal('orthacms_not-a-real-token');
            const dead = await refusal(revoked.secret);
            const stale = await refusal(expired.secret);

            expect(dead.text).toBe(unknown.text);
            expect(stale.text).toBe(unknown.text);
        });

        it('does not open the management API to a bearer token [api-tokens:I-14]', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId],
                scope: 'full'
            });
            // The `/api/api-tokens` routes are session-authenticated; a bearer
            // token must never manage tokens, whatever its scope.
            await request(harness.server)
                .get('/api/api-tokens')
                .set('Authorization', `Bearer ${secret}`)
                .expect(401);
        });
    });

    describe('workspace resolution', () => {
        it('defaults to the only workspace of a single-workspace token [api-tokens:I-19]', async () => {
            await seedPublished('Only workspace');
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            expect(res.body.total).toBe(1);
            expect(res.body.items[0].values.text).toBe('Only workspace');
        });

        it('requires X-Workspace-Id when the token covers several [api-tokens:I-19]', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId, otherWorkspaceId]
            });

            await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);
        });

        it('reads each workspace of a multi-workspace token', async () => {
            await seedPublished('In A', workspaceId);
            await seedPublished('In B', otherWorkspaceId);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId, otherWorkspaceId]
            });

            const first = await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .set('X-Workspace-Id', workspaceId)
                .expect(200);
            expect(
                (first.body.items as PublicItem[]).map(
                    (item) => item.values['text']
                )
            ).toEqual(['In A']);

            const second = await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .set('X-Workspace-Id', otherWorkspaceId)
                .expect(200);
            expect(
                (second.body.items as PublicItem[]).map(
                    (item) => item.values['text']
                )
            ).toEqual(['In B']);
        });

        it('403s a workspace outside the token’s bucket', async () => {
            await seedPublished('In B', otherWorkspaceId);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .set('X-Workspace-Id', otherWorkspaceId)
                .expect(403);
        });

        it('403s a foreign X-Workspace-Id even on a single-workspace token [api-tokens:I-18]', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            // The header is optional for a one-workspace token, but it is NOT
            // ignored when sent: a foreign id is checked against the bucket
            // like any other. Otherwise the "convenience" default would be a
            // way to smuggle a workspace past the check.
            await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .set('X-Workspace-Id', otherWorkspaceId)
                .expect(403);

            // Naming its own workspace explicitly is fine.
            await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .set('X-Workspace-Id', workspaceId)
                .expect(200);
        });

        it('403s a token whose every workspace has been deleted [api-tokens:I-05]', async () => {
            // Deleting a workspace purges its `api_token_workspaces` rows and
            // deliberately stops short of revoking the credential — narrowing a
            // token's reach is one call, killing it is another, and the purger
            // has no standing to make the second. A token whose *only*
            // workspace goes that way is left covering nothing.
            //
            // It used to be told "this token covers 0 workspaces — name the one
            // you want with the X-Workspace-Id header": a 400 asking for one of
            // zero options, advice no caller can act on and a diagnosis that
            // sends them looking at their client instead of at the workspace
            // that no longer exists.
            const doomed = await seedWorkspace({
                name: 'Doomed',
                slug: 'doomed'
            });
            await seedContentGrants(doomed.id, ['test_article']);
            const { id, secret } = await mintToken({
                workspaceIds: [doomed.id]
            });

            await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            // Through the real route, because the purge is application-level:
            // `api_token_workspaces` carries no foreign key to `workspaces`
            // (identity must not depend on that package), so deleting the row
            // out of band would leave the bucket behind and prove nothing.
            const agent = await login();
            await seedMembership(adminId, doomed.id);
            await agent.delete(`/api/workspaces/${doomed.id}`).expect(204);

            const res = await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .expect(403);
            expect(res.body.message).toContain('no workspaces left');

            // And the token is emphatically not revoked — the 403 has to be
            // about the empty bucket, or an operator reading it would conclude
            // the credential was killed and go and mint a replacement for the
            // wrong reason.
            expect(await apiTokenExists(id)).toBe(true);
        });

        it('400s a malformed X-Workspace-Id', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .set('X-Workspace-Id', 'not-a-uuid')
                .expect(400);
        });
    });

    describe('entry reads', () => {
        it('serves only published, non-deleted entries [content:I-16]', async () => {
            await seedPublished('Live');
            await seedArticles(
                [{ text: 'Draft', select: 'article' }],
                workspaceId
            );
            await seedArticles(
                [
                    {
                        text: 'Trashed',
                        select: 'article',
                        status: 'published',
                        publishedAt: new Date(),
                        deletedAt: new Date()
                    }
                ],
                workspaceId
            );
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            expect(res.body.total).toBe(1);
            expect(res.body.items[0].values.text).toBe('Live');
        });

        it('returns a flat entry: no relations, no media, no workspace', async () => {
            await seedPublished('Flat');
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            const [item] = res.body.items as PublicItem[];
            expect(item).toHaveProperty('publishedAt');
            // `status` used to be omitted here, on the grounds that a public
            // read could only ever return `published` and a constant is not
            // information. A `full`-scope token can now create drafts and read
            // them back with `?status=`, so it is a real field.
            expect(item.status).toBe('published');
            // The workspace is not: it is how the *token* was scoped, never
            // something a consumer of the content needs to know.
            expect(item).not.toHaveProperty('workspaceId');

            // The entry's own data rides `values` — scalars plus the jsonb
            // bags (`multiselect`, `json`), which are values, not references.
            expect(item.values).toHaveProperty('text');
            expect(item.values).toHaveProperty('multiselect');
            expect(item.values).toHaveProperty('json');

            // Every reference field is omitted: many-to-one (`author`, an FK
            // column that IS on the row), one-to-one (`seo`), many-to-many
            // (`tags`), and media both single and multiple. `test_article`
            // declares no inverse relation, so that cardinality is covered by
            // `public-entry-row.spec.ts` rather than asserted vacuously here.
            for (const omitted of [
                'author',
                'seo',
                'tags',
                'image',
                'heroImage',
                'attachments'
            ]) {
                expect(item.values).not.toHaveProperty(omitted);
            }
        });

        it('reads one entry by id', async () => {
            const id = await seedPublished('By id');
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get(`/api/v1/content/test_article/${id}`)
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            expect(res.body.id).toBe(id);
            expect(res.body.values.text).toBe('By id');
        });

        it('404s a draft entry by id', async () => {
            const [id] = await seedArticles(
                [{ text: 'Draft', select: 'article' }],
                workspaceId
            );
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            await request(harness.server)
                .get(`/api/v1/content/test_article/${id}`)
                .set('Authorization', `Bearer ${secret}`)
                .expect(404);
        });

        it('404s an entry that lives in another workspace [content:I-04]', async () => {
            const id = await seedPublished('In B', otherWorkspaceId);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            await request(harness.server)
                .get(`/api/v1/content/test_article/${id}`)
                .set('Authorization', `Bearer ${secret}`)
                .expect(404);
        });

        it('404s a content type the workspace was not granted', async () => {
            await seedPages([{ title: 'Hidden' }], workspaceId);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            await request(harness.server)
                .get('/api/v1/content/test_page')
                .set('Authorization', `Bearer ${secret}`)
                .expect(404);
        });

        it('404s an unknown content type', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            await request(harness.server)
                .get('/api/v1/content/no_such_type')
                .set('Authorization', `Bearer ${secret}`)
                .expect(404);
        });

        it('serves a single (page) type through the same list route', async () => {
            await seedContentGrants(workspaceId, ['test_landing'], 'single');
            await seedLanding(
                [{ text: 'Home page', select: 'light' }],
                workspaceId
            );
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get('/api/v1/content/test_landing')
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            expect(res.body.total).toBe(1);
            // Non-publishable, so it is always live and carries no publish
            // timestamp.
            expect(res.body.items[0]).not.toHaveProperty('publishedAt');
            expect(res.body.items[0].values.text).toBe('Home page');
        });

        it('paginates', async () => {
            await seedPublished('One');
            await seedPublished('Two');
            await seedPublished('Three');
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ page: 2, pageSize: 2 })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            expect(res.body.total).toBe(3);
            expect(res.body.page).toBe(2);
            expect(res.body.pageSize).toBe(2);
            expect(res.body.items).toHaveLength(1);
        });

        it('sorts by a whitelisted column, ascending and descending', async () => {
            await seedPublished('Beta');
            await seedPublished('Alpha');
            await seedPublished('Gamma');
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const asc = await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ sort: 'text' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);
            expect(
                (asc.body.items as PublicItem[]).map((i) => i.values['text'])
            ).toEqual(['Alpha', 'Beta', 'Gamma']);

            const desc = await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ sort: '-text' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);
            expect(
                (desc.body.items as PublicItem[]).map((i) => i.values['text'])
            ).toEqual(['Gamma', 'Beta', 'Alpha']);
        });

        it('falls back to newest-updated for a sort key it does not allow', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            // Three shapes of "not sortable": a name that is no field at all, a
            // media field (no comparable column), and a join-backed relation
            // (no column on this table at all). Each must fall back, NOT reach
            // `asc(undefined)` and 500 — which is the whole reason the sort
            // whitelist exists.
            for (const sort of ['nope', 'image', 'tags', '-tags']) {
                const res = await request(harness.server)
                    .get('/api/v1/content/test_article')
                    .query({ sort })
                    .set('Authorization', `Bearer ${secret}`)
                    .expect(200);
                expect(Array.isArray(res.body.items)).toBe(true);
            }
        });

        it('rejects a page or pageSize outside its bounds', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            for (const query of [
                { page: 0 },
                { pageSize: 0 },
                { pageSize: 101 },
                { page: 'x' },
                { pageSize: '2.5' }
            ]) {
                await request(harness.server)
                    .get('/api/v1/content/test_article')
                    .query(query)
                    .set('Authorization', `Bearer ${secret}`)
                    .expect(400);
            }

            // The cap itself is allowed — an off-by-one here would silently
            // make the documented maximum unusable.
            await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ pageSize: 100 })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);
        });

        it('searches across the type’s text columns', async () => {
            await seedPublished('Alpha release notes');
            await seedPublished('Beta announcement');
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ search: 'release' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            expect(res.body.total).toBe(1);
            expect((res.body.items as PublicItem[])[0].values['text']).toBe(
                'Alpha release notes'
            );
        });

        it('matches LIKE metacharacters in a search literally', async () => {
            await seedPublished('100% organic');
            await seedPublished('Plain text');
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            // Unescaped, `%` is the ILIKE wildcard and would match BOTH rows —
            // the classic way a search box turns into "return everything".
            const wildcard = await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ search: '%' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);
            expect(wildcard.body.total).toBe(1);
            expect(
                (wildcard.body.items as PublicItem[])[0].values['text']
            ).toBe('100% organic');

            // `_` is the single-character wildcard, same story.
            const underscore = await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ search: 'P_ain' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);
            expect(underscore.body.total).toBe(0);
        });

        it('filters on a scalar field with the query-builder tree', async () => {
            await seedArticles(
                [
                    {
                        text: 'A tutorial',
                        select: 'tutorial',
                        status: 'published',
                        publishedAt: new Date()
                    },
                    {
                        text: 'An article',
                        select: 'article',
                        status: 'published',
                        publishedAt: new Date()
                    }
                ],
                workspaceId
            );
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({
                    filter: JSON.stringify({
                        and: [{ field: 'select', op: 'eq', value: 'tutorial' }]
                    })
                })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            expect(res.body.total).toBe(1);
            expect((res.body.items as PublicItem[])[0].values['text']).toBe(
                'A tutorial'
            );
        });

        it('never lets a filter widen the published-only scope [content:I-16]', async () => {
            await seedPublished('Live');
            await seedArticles(
                [{ text: 'Draft', select: 'article' }],
                workspaceId
            );
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            // `status` is not in the public filter schema — it could only ever
            // be a no-op or match nothing, so it is a clear 400 rather than a
            // confusingly empty page.
            await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({
                    filter: JSON.stringify({
                        and: [{ field: 'status', op: 'eq', value: 'draft' }]
                    })
                })
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);

            // And a filter that matches every row — both entries were created
            // just now, so this is deliberately satisfied by the draft too —
            // still cannot surface it: the filter is AND-ed onto the
            // published-only predicate, so it can only ever narrow.
            const res = await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({
                    filter: JSON.stringify({
                        and: [
                            {
                                field: 'createdAt',
                                op: 'gte',
                                value: '2000-01-01'
                            }
                        ]
                    })
                })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            expect(res.body.total).toBe(1);
            expect(
                (res.body.items as PublicItem[]).map(
                    (item) => item.values['text']
                )
            ).toEqual(['Live']);
        });

        it('400s a malformed filter and an unknown filter field', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ filter: 'not json' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);

            await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({
                    filter: JSON.stringify({
                        and: [{ field: 'nope', op: 'eq', value: 'x' }]
                    })
                })
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);
        });

        it('400s a filter traversing into an ungranted relation', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            // `test_author` is not granted to this workspace, so the surface
            // omits the traversal — a token can't infer relation data it isn't
            // allowed to read by watching which entries match.
            await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({
                    filter: JSON.stringify({
                        and: [{ field: 'author.name', op: 'eq', value: 'Ada' }]
                    })
                })
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);
        });

        it('returns only the selected fields [content:I-24]', async () => {
            await seedPublished('Sparse');
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ fields: 'text,select' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            const [item] = res.body.items as PublicItem[];
            expect(Object.keys(item.values).sort()).toEqual(['select', 'text']);
            // The envelope is never selectable away — `id` is what makes the
            // entry addressable for a follow-up read.
            expect(item.id).toEqual(expect.any(String));
            expect(item).toHaveProperty('publishedAt');
        });

        it('applies a field selection to the single-entry route too', async () => {
            const id = await seedPublished('Sparse by id');
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get(`/api/v1/content/test_article/${id}`)
                .query({ fields: 'text' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            expect(Object.keys(res.body.values)).toEqual(['text']);
            expect(res.body.id).toBe(id);
        });

        it('400s an unknown or unselectable field name [content:I-24]', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            // A typo is a 400, not a silently missing key.
            await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ fields: 'text,nope' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);

            // A real field this API can't return yet gets its own message.
            const relation = await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ fields: 'author' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);
            expect(relation.body.message).toMatch(/cannot be selected/);

            await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ fields: 'image' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);
        });

        it('reads an empty ?fields= as "no preference", not "no fields" [content:I-24]', async () => {
            await seedPublished('Everything');
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const [full, empty] = await Promise.all(
                [undefined, ''].map((fields) =>
                    request(harness.server)
                        .get('/api/v1/content/test_article')
                        .query(fields === undefined ? {} : { fields })
                        .set('Authorization', `Bearer ${secret}`)
                        .expect(200)
                )
            );

            const keysOf = (res: { body: { items: PublicItem[] } }) =>
                Object.keys(res.body.items[0].values).sort();
            // An empty `values` bag is never what a caller meant, so the two
            // must agree — and the assertion is against the FULL key set, not
            // just "non-empty", so a partial regression can't slip through.
            expect(keysOf(empty)).toEqual(keysOf(full));
            expect(keysOf(empty).length).toBeGreaterThan(1);
        });

        it('400s a fields list longer than the cap', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            // Bounded before any name is looked up, so the 400 is about the
            // list's size rather than the first bogus name in it.
            await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({
                    fields: Array.from({ length: 101 }, (_, i) => `f${i}`).join(
                        ','
                    )
                })
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);
        });

        it('still filters and sorts on fields it was not asked to return', async () => {
            await seedArticles(
                [
                    {
                        text: 'Keep',
                        select: 'tutorial',
                        status: 'published',
                        publishedAt: new Date()
                    },
                    {
                        text: 'Drop',
                        select: 'article',
                        status: 'published',
                        publishedAt: new Date()
                    }
                ],
                workspaceId
            );
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            // `select` drives the filter but is absent from the projection —
            // SQL allows a WHERE over unselected columns, so a sparse fieldset
            // never narrows what can be filtered or sorted on.
            const res = await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({
                    fields: 'text',
                    filter: JSON.stringify({
                        and: [{ field: 'select', op: 'eq', value: 'tutorial' }]
                    })
                })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            expect(res.body.total).toBe(1);
            const [item] = res.body.items as PublicItem[];
            expect(item.values).toEqual({ text: 'Keep' });
        });

        it('expands a relation only when asked, and only to published targets', async () => {
            // `test_tag` is publishable, so a draft tag is the case that must
            // stay invisible. Grant it — expansion into an ungranted type is
            // refused (covered below).
            await seedContentGrants(workspaceId, ['test_tag']);
            const tagIds = await seedTags(
                [
                    {
                        name: 'Live tag',
                        status: 'published',
                        publishedAt: new Date()
                    },
                    { name: 'Draft tag' }
                ],
                workspaceId
            );
            const source = await seedPublished('Source');
            await seedArticleTags(source, tagIds);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            // Off by default.
            const plain = await request(harness.server)
                .get('/api/v1/content/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);
            expect(
                (plain.body.items as PublicItem[]).every(
                    (item) => item.relations === undefined
                )
            ).toBe(true);

            const res = await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ relations: 'preview', relationFields: 'tags' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            const item = (res.body.items as PublicItem[]).find(
                (row) => row.id === source
            );
            // The draft link is neither shown nor counted — `total` must not
            // advertise a link the caller can never reach.
            expect(item?.relations?.['tags'].total).toBe(1);
            // A linked entry comes back in the SAME shape as a base record —
            // envelope + `values` — not a bespoke ref object.
            const [linked] = item?.relations?.['tags'].items ?? [];
            expect(linked.values['name']).toBe('Live tag');
            expect(linked.id).toEqual(expect.any(String));
            expect(linked.createdAt).toEqual(expect.any(String));
            // One level only: a linked entry is not itself expanded.
            expect(linked).not.toHaveProperty('relations');
        });

        it('caps preview items with relationLimit, keeping total truthful', async () => {
            await seedContentGrants(workspaceId, ['test_tag']);
            const tagIds = await seedTags(
                Array.from({ length: 5 }, (_, index) => ({
                    name: `Tag ${index}`,
                    status: 'published',
                    publishedAt: new Date()
                })),
                workspaceId
            );
            const source = await seedPublished('Capped source');
            await seedArticleTags(source, tagIds);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({
                    relations: 'preview',
                    relationFields: 'tags',
                    relationLimit: 2
                })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            const item = (res.body.items as PublicItem[]).find(
                (row) => row.id === source
            );
            // Fewer items than links, but `total` still reports all 5 — a low
            // limit must never pass a slice off as the whole set.
            expect(item?.relations?.['tags'].items).toHaveLength(2);
            expect(item?.relations?.['tags'].total).toBe(5);
        });

        it('rejects a relationLimit outside 1…100', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            for (const relationLimit of [0, 500]) {
                await request(harness.server)
                    .get('/api/v1/content/test_article')
                    .query({ relations: 'preview', relationLimit })
                    .set('Authorization', `Bearer ${secret}`)
                    .expect(400);
            }
        });

        it('400s expanding a relation into an ungranted type', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            // `test_author` is not granted to this workspace, so expanding
            // `author` would reach content the workspace doesn't expose.
            await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ relations: 'preview', relationFields: 'author' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);
        });

        it('expands every granted relation field when none are named', async () => {
            await seedContentGrants(workspaceId, ['test_tag']);
            const source = await seedPublished('Unnamed expansion');
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get(`/api/v1/content/test_article/${source}`)
                .query({ relations: 'preview' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            const fields = Object.keys(res.body.relations ?? {});
            expect(fields).toContain('tags');
            // `test_author` is ungranted. Naming it would be a 400, but when
            // the caller named NOTHING there is nothing to correct them about,
            // so it is skipped rather than refused — and it must not appear.
            expect(fields).not.toContain('author');
        });

        it('400s naming more expandable fields than the cap allows', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            // Cost scales with the number of FIELDS (each is its own query
            // pass), so this is the bound that actually protects the endpoint.
            // The names need not exist — the count is checked first.
            const eleven = Array.from({ length: 11 }, (_, i) => `f${i}`).join(
                ','
            );
            await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ relations: 'preview', relationFields: eleven })
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);
            await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ media: 'preview', mediaFields: eleven })
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);
        });

        it('400s a relationFields name that is not a relation', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ relations: 'preview', relationFields: 'text' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);
        });

        it('pages one relation field from the sibling route', async () => {
            await seedContentGrants(workspaceId, ['test_tag']);
            const tagIds = await seedTags(
                [
                    {
                        name: 'Sibling tag',
                        status: 'published',
                        publishedAt: new Date()
                    }
                ],
                workspaceId
            );
            const source = await seedPublished('Sibling source');
            await seedArticleTags(source, tagIds);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const one = await request(harness.server)
                .get(`/api/v1/content/test_article/${source}/relations/tags`)
                .query({ page: 1, pageSize: 1 })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);
            expect(one.body.items).toHaveLength(1);
            expect(one.body.items[0].values.name).toBe('Sibling tag');

            // A non-relation field is a 400, not an empty page.
            await request(harness.server)
                .get(`/api/v1/content/test_article/${source}/relations/text`)
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);
            // …and so is a relation whose target the workspace can't reach.
            await request(harness.server)
                .get(`/api/v1/content/test_article/${source}/relations/author`)
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);

            // There is deliberately no all-fields `/relations` route: it
            // returned exactly what `?relations=preview` already does, so it
            // was removed rather than shipped as a second spelling. Pinned here
            // because "the route is gone" is otherwise invisible to the suite.
            await request(harness.server)
                .get(`/api/v1/content/test_article/${source}/relations`)
                .set('Authorization', `Bearer ${secret}`)
                .expect(404);
        });

        it('404s the relation and media routes for an entry it cannot read', async () => {
            // `test_tag` has to be granted for this to test what it says: the
            // relation route checks the *target type's* grant before it looks
            // the entry up, so without this the 400 for an ungranted target
            // would mask the 404 under test.
            await seedContentGrants(workspaceId, ['test_tag']);
            const [draft] = await seedArticles(
                [{ text: 'Hidden', select: 'article' }],
                workspaceId
            );
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            // The sibling routes must be exactly as invisible as the entry.
            await request(harness.server)
                .get(`/api/v1/content/test_article/${draft}/relations/tags`)
                .set('Authorization', `Bearer ${secret}`)
                .expect(404);
            await request(harness.server)
                .get(`/api/v1/content/test_article/${draft}/media`)
                .set('Authorization', `Bearer ${secret}`)
                .expect(404);
        });

        it('exposes media fields as empty views when nothing is attached', async () => {
            await seedPublished('No media');
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            // No `mediaFields`: `preview` alone expands every media field.
            const res = await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ media: 'preview' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            // The keys are present even with no assets, so a consumer can read
            // `media.image.items` without testing for the map first.
            const [item] = res.body.items as PublicItem[];
            expect(item.media?.['image']).toEqual({ items: [], total: 0 });
            expect(item.media?.['attachments']).toEqual({
                items: [],
                total: 0
            });
        });

        it('resolves attached media to metadata and URLs, capped by mediaLimit', async () => {
            const assets: { id: string }[] = [];
            for (const name of ['a.pdf', 'b.pdf', 'c.pdf']) {
                assets.push(
                    await seedMediaAsset({
                        workspaceId,
                        uploadedBy: adminId,
                        name
                    })
                );
            }
            const [entry] = await seedArticles(
                [
                    {
                        text: 'With media',
                        select: 'article',
                        status: 'published',
                        publishedAt: new Date(),
                        attachments: assets.map((a) => a.id)
                    }
                ],
                workspaceId
            );
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get(`/api/v1/content/test_article/${entry}`)
                .query({
                    media: 'preview',
                    mediaFields: 'attachments',
                    mediaLimit: 2
                })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            const view = res.body.media.attachments;
            // Capped to 2 — but `total` reports all 3, so the limit is visible
            // as `items.length < total` and never passes a slice off as whole.
            expect(view.items).toHaveLength(2);
            expect(view.total).toBe(3);
            // Stored order is preserved; it is what the editor arranged.
            expect(view.items.map((i: { name: string }) => i.name)).toEqual([
                'a.pdf',
                'b.pdf'
            ]);
            expect(view.items[0]).toMatchObject({
                id: assets[0].id,
                name: 'a.pdf',
                kind: 'document',
                mimeType: 'application/pdf',
                alt: null
            });
            // A URL is returned even though a bearer token cannot fetch it —
            // see the caveat on PublicMediaRef. It must at least identify the
            // asset.
            expect(view.items[0].url).toContain(assets[0].id);
        });

        it('omits a media id that names an asset in another workspace', async () => {
            const theirs = await seedMediaAsset({
                workspaceId: otherWorkspaceId,
                uploadedBy: adminId,
                name: 'theirs.pdf'
            });
            const mine = await seedMediaAsset({
                workspaceId,
                uploadedBy: adminId,
                name: 'mine.pdf'
            });
            const [entry] = await seedArticles(
                [
                    {
                        text: 'Mixed media',
                        select: 'article',
                        status: 'published',
                        publishedAt: new Date(),
                        attachments: [theirs.id, mine.id]
                    }
                ],
                workspaceId
            );
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get(`/api/v1/content/test_article/${entry}`)
                .query({ media: 'preview', mediaFields: 'attachments' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            // The cross-workspace id is dropped, not returned as a placeholder,
            // and — the part that matters — is not counted either.
            const view = res.body.media.attachments;
            expect(view.items.map((i: { name: string }) => i.name)).toEqual([
                'mine.pdf'
            ]);
            expect(view.total).toBe(1);
        });

        it('400s a mediaFields name that is not a media field', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ media: 'preview', mediaFields: 'text' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);
        });

        it('rejects an undeclared query parameter', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            // The public surface is deliberately narrow — the admin's
            // `?deleted=only` (the trash view) is not part of it.
            await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ deleted: 'only' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);
        });
    });

    describe('localization', () => {
        /**
         * Seed one translation group: an `en` row plus every extra locale
         * given, all sharing a `localeGroupId`. Returns the ids by locale.
         *
         * `seedArticles` takes raw column values, so the group id is set
         * explicitly here rather than relying on the column default — that
         * default mints a *fresh* group per row, which is exactly what a
         * sibling must not do.
         */
        async function seedGroup(
            rows: { locale: string; text: string; status?: string }[],
            ws = workspaceId
        ): Promise<{ groupId: string; byLocale: Record<string, string> }> {
            const groupId = randomUUID();
            const ids = await seedArticles(
                rows.map((row) => ({
                    text: row.text,
                    select: 'article',
                    locale: row.locale,
                    localeGroupId: groupId,
                    status: row.status ?? 'published',
                    publishedAt:
                        (row.status ?? 'published') === 'published'
                            ? new Date()
                            : null
                })),
                ws
            );
            const byLocale: Record<string, string> = {};
            rows.forEach((row, index) => (byLocale[row.locale] = ids[index]));
            return { groupId, byLocale };
        }

        it('400s an unknown locale on every route that takes one', async () => {
            const { groupId, byLocale } = await seedGroup([
                { locale: 'en', text: 'Story EN' }
            ]);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            // The slug is validated by the localization plugin behind the
            // extension port, so this also pins that the public reads actually
            // route `?locale=` through it rather than trusting the string.
            const paths = [
                '/api/v1/content/test_article',
                `/api/v1/content/test_article/${byLocale['en']}`,
                `/api/v1/content/test_article/${byLocale['en']}/media`,
                `/api/v1/content/test_article/group/${groupId}`
            ];
            for (const path of paths) {
                await request(harness.server)
                    .get(path)
                    .query({ locale: 'zz' })
                    .set('Authorization', `Bearer ${secret}`)
                    .expect(400);
            }
        });

        it('reads a localized entry by id without naming its locale', async () => {
            const { byLocale } = await seedGroup([
                { locale: 'en', text: 'Story EN' },
                { locale: 'de', text: 'Story DE' }
            ]);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            // An entry id names exactly one row, so the locale scope can only
            // ever turn a valid id into a 404. It used to do exactly that — a
            // documented sharp edge — until the write API made it untenable:
            // updating a German article by its own id would have needed
            // `?locale=de` bolted onto a request that already named the row.
            // A GROUP read still needs the locale; that is what picks the row.
            for (const query of [{}, { locale: 'de' }, { locale: 'en' }]) {
                const res = await request(harness.server)
                    .get(`/api/v1/content/test_article/${byLocale['de']}`)
                    .query(query)
                    .set('Authorization', `Bearer ${secret}`)
                    .expect(200);
                expect(res.body.id).toBe(byLocale['de']);
                expect(res.body.locale).toBe('de');
            }
        });

        it('filters a list by localeGroupId, scoped to the requested locale', async () => {
            const { groupId, byLocale } = await seedGroup([
                { locale: 'en', text: 'Story EN' },
                { locale: 'de', text: 'Story DE' }
            ]);
            // A second group, so the filter has something to exclude.
            await seedGroup([{ locale: 'de', text: 'Other DE' }]);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({
                    locale: 'de',
                    filter: JSON.stringify({
                        and: [
                            {
                                field: 'localeGroupId',
                                op: 'eq',
                                value: groupId
                            }
                        ]
                    })
                })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            const items = res.body.items as PublicItem[];
            expect(items).toHaveLength(1);
            expect(items[0].id).toBe(byLocale['de']);
        });

        it('reads a group’s row in the requested locale', async () => {
            const { groupId, byLocale } = await seedGroup([
                { locale: 'en', text: 'Story EN' },
                { locale: 'de', text: 'Story DE' }
            ]);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            // The whole point of the route: same group id, different locale,
            // different row — no per-locale id map on the consumer's side.
            const de = await request(harness.server)
                .get(`/api/v1/content/test_article/group/${groupId}`)
                .query({ locale: 'de' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);
            expect(de.body.id).toBe(byLocale['de']);
            expect(de.body.locale).toBe('de');

            // No `?locale=` falls back to the configured default (`en`).
            const fallback = await request(harness.server)
                .get(`/api/v1/content/test_article/group/${groupId}`)
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);
            expect(fallback.body.id).toBe(byLocale['en']);
        });

        it('404s a group whose row in the requested locale is not published', async () => {
            const { groupId } = await seedGroup([
                { locale: 'en', text: 'Story EN' },
                { locale: 'fr', text: 'Story FR', status: 'draft' }
            ]);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            // A draft translation and a missing one are the same 404 — which of
            // the two it is isn't the caller's to learn.
            await request(harness.server)
                .get(`/api/v1/content/test_article/group/${groupId}`)
                .query({ locale: 'fr' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(404);
            await request(harness.server)
                .get(`/api/v1/content/test_article/group/${randomUUID()}`)
                .set('Authorization', `Bearer ${secret}`)
                .expect(404);
        });

        it('404s a group in another workspace', async () => {
            const { groupId } = await seedGroup(
                [{ locale: 'en', text: 'Theirs' }],
                otherWorkspaceId
            );
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            await request(harness.server)
                .get(`/api/v1/content/test_article/group/${groupId}`)
                .set('Authorization', `Bearer ${secret}`)
                .expect(404);
        });

        it('previews an entry’s sibling translations, published only', async () => {
            const { byLocale } = await seedGroup([
                { locale: 'en', text: 'Story EN' },
                { locale: 'de', text: 'Story DE' },
                { locale: 'fr', text: 'Story FR', status: 'draft' }
            ]);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get(`/api/v1/content/test_article/${byLocale['en']}`)
                .query({ translations: 'preview', fields: 'text' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            const translations = res.body.translations as PublicItem[];
            // The `de` sibling only: `fr` is a draft, and the entry itself is
            // never repeated inside its own translations.
            expect(translations).toHaveLength(1);
            expect(translations[0].id).toBe(byLocale['de']);
            expect(translations[0].locale).toBe('de');
            // Siblings are full entries honouring the root's `?fields=`.
            expect(translations[0].values).toEqual({ text: 'Story DE' });
            expect(translations[0].publishedAt).toBeTruthy();
        });

        it('previews translations across a whole list page', async () => {
            const a = await seedGroup([
                { locale: 'en', text: 'A EN' },
                { locale: 'de', text: 'A DE' }
            ]);
            const b = await seedGroup([{ locale: 'en', text: 'B EN' }]);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get('/api/v1/content/test_article')
                .query({ translations: 'preview' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            const byId = new Map(
                (res.body.items as PublicItem[]).map((item) => [item.id, item])
            );
            expect(
                byId.get(a.byLocale['en'])?.translations?.map((t) => t.id)
            ).toEqual([a.byLocale['de']]);
            // An untranslated group reports `[]`, not a missing key, so "no
            // other locales" stays distinguishable from "you didn't ask".
            expect(byId.get(b.byLocale['en'])?.translations).toEqual([]);
        });

        it('serves the same siblings from the /translations route', async () => {
            const { byLocale } = await seedGroup([
                { locale: 'en', text: 'Story EN' },
                { locale: 'de', text: 'Story DE' }
            ]);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get(
                    `/api/v1/content/test_article/${byLocale['en']}/translations`
                )
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            expect(
                (res.body.translations as PublicItem[]).map((t) => t.id)
            ).toEqual([byLocale['de']]);
        });

        it('orders translations by locale slug', async () => {
            const { byLocale } = await seedGroup([
                { locale: 'en', text: 'EN' },
                { locale: 'fr', text: 'FR' },
                { locale: 'de', text: 'DE' }
            ]);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get(`/api/v1/content/test_article/${byLocale['en']}`)
                .query({ translations: 'preview' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            // Insertion order was en, fr, de — the response must not echo it.
            expect(
                (res.body.translations as PublicItem[]).map((t) => t.locale)
            ).toEqual(['de', 'fr']);
        });

        it('hides a soft-deleted or cross-workspace sibling', async () => {
            const { groupId, byLocale } = await seedGroup([
                { locale: 'en', text: 'Story EN' },
                { locale: 'de', text: 'Story DE' }
            ]);
            // A published-but-soft-deleted `fr` sibling: only the soft-delete
            // guard keeps it out of the answer.
            await seedArticles(
                [
                    {
                        text: 'Deleted FR',
                        select: 'article',
                        locale: 'fr',
                        localeGroupId: groupId,
                        status: 'published',
                        publishedAt: new Date(),
                        deletedAt: new Date()
                    }
                ],
                workspaceId
            );
            // …and a live row carrying the SAME group id in the OTHER
            // workspace. Group ids are opaque uuids, so nothing but the
            // workspace clause keeps this out of the response.
            //
            // It has to be `fr`: the `(locale_group_id, locale)` unique index
            // is partial on `deleted_at IS NULL` but NOT workspace-scoped, so
            // reusing `de` or `en` here would collide with this workspace's own
            // live row. `fr` is free precisely because the row above is deleted.
            await seedArticles(
                [
                    {
                        text: 'Theirs FR',
                        select: 'article',
                        locale: 'fr',
                        localeGroupId: groupId,
                        status: 'published',
                        publishedAt: new Date()
                    }
                ],
                otherWorkspaceId
            );
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get(`/api/v1/content/test_article/${byLocale['en']}`)
                .query({ translations: 'preview' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            expect(
                (res.body.translations as PublicItem[]).map((t) => t.id)
            ).toEqual([byLocale['de']]);
        });

        it('previews translations on the group-addressed entry read', async () => {
            const { groupId, byLocale } = await seedGroup([
                { locale: 'en', text: 'Story EN' },
                { locale: 'de', text: 'Story DE' }
            ]);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get(`/api/v1/content/test_article/group/${groupId}`)
                .query({ locale: 'de', translations: 'preview' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            expect(res.body.id).toBe(byLocale['de']);
            expect(
                (res.body.translations as PublicItem[]).map((t) => t.id)
            ).toEqual([byLocale['en']]);
        });

        it('404s /translations for an entry it cannot read', async () => {
            const { byLocale } = await seedGroup([
                { locale: 'en', text: 'Hidden', status: 'draft' }
            ]);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            await request(harness.server)
                .get(
                    `/api/v1/content/test_article/${byLocale['en']}/translations`
                )
                .set('Authorization', `Bearer ${secret}`)
                .expect(404);
        });

        it('serves every single-entry route by translation group too', async () => {
            await seedContentGrants(workspaceId, ['test_tag']);
            const tagIds = await seedTags(
                [
                    {
                        name: 'Group tag',
                        status: 'published',
                        publishedAt: new Date()
                    }
                ],
                workspaceId
            );
            const { groupId, byLocale } = await seedGroup([
                { locale: 'en', text: 'Story EN' },
                { locale: 'de', text: 'Story DE' }
            ]);
            await seedArticleTags(byLocale['de'], tagIds);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const base = `/api/v1/content/test_article/group/${groupId}`;
            // Every read a caller can do holding `byLocale.de` it can also do
            // holding the group id plus `?locale=de` — the identity a localized
            // front-end actually carries.
            const links = await request(harness.server)
                .get(`${base}/relations/tags`)
                .query({ locale: 'de' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);
            expect(links.body.items[0].values.name).toBe('Group tag');

            const media = await request(harness.server)
                .get(`${base}/media`)
                .query({ locale: 'de' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);
            expect(media.body.media.image).toEqual({ items: [], total: 0 });

            // The group id alone names every language the story is live in.
            const siblings = await request(harness.server)
                .get(`${base}/translations`)
                .query({ locale: 'de' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);
            expect(
                (siblings.body.translations as PublicItem[]).map((t) => t.id)
            ).toEqual([byLocale['en']]);

            // The `en` row has no tags, so the same group in the default locale
            // resolves to a different row — proof the locale, not the group,
            // picks which entry the sibling routes act on.
            const enLinks = await request(harness.server)
                .get(`${base}/relations/tags`)
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);
            expect(enLinks.body.total).toBe(0);
        });

        it('404s the group sibling routes when the locale has no published row', async () => {
            // Granted so `/relations/tags` gets past its own grant check and
            // reaches the row lookup — the thing under test here.
            await seedContentGrants(workspaceId, ['test_tag']);
            const { groupId } = await seedGroup([
                { locale: 'en', text: 'Story EN' },
                { locale: 'fr', text: 'Story FR', status: 'draft' }
            ]);
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const base = `/api/v1/content/test_article/group/${groupId}`;
            // Every route that accepts the group form, so none of them can
            // resolve a row the entry read itself would refuse.
            for (const path of [
                '',
                '/relations/tags',
                '/media',
                '/translations'
            ]) {
                await request(harness.server)
                    .get(`${base}${path}`)
                    .query({ locale: 'fr' })
                    .set('Authorization', `Bearer ${secret}`)
                    .expect(404);
            }
        });

        it('400s every locale feature on a type that is not localized', async () => {
            // `test_tag` is a granted, non-i18n collection — the case where a
            // silent empty list would read as "no other locales" when the truth
            // is "this content has none to have".
            await seedContentGrants(workspaceId, ['test_tag']);
            const [tagId] = await seedTags(
                [
                    {
                        name: 'Flat',
                        status: 'published',
                        publishedAt: new Date()
                    }
                ],
                workspaceId
            );
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            await request(harness.server)
                .get('/api/v1/content/test_tag')
                .query({ translations: 'preview' })
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);
            await request(harness.server)
                .get(`/api/v1/content/test_tag/${tagId}/translations`)
                .set('Authorization', `Bearer ${secret}`)
                .expect(400);
            // Addressing a non-localized type by group is a 400 on every route
            // that accepts the group form, not just the entry read — the caller
            // used an identity the type does not have.
            // `articles` is a real relation on test_tag whose target IS granted,
            // so the request clears the field and grant checks and fails on the
            // addressing form itself rather than incidentally.
            const group = `/api/v1/content/test_tag/group/${randomUUID()}`;
            for (const path of [
                '',
                '/relations/articles',
                '/media',
                '/translations'
            ]) {
                const res = await request(harness.server)
                    .get(`${group}${path}`)
                    .set('Authorization', `Bearer ${secret}`)
                    .expect(400);
                // Assert the REASON, not just the status. `/relations/:field`
                // has field and grant checks that run first and 400 on their
                // own; without this the case could pass while never reaching
                // the addressing check it exists to cover.
                expect(res.body.message).toContain('not a localized');
            }
        });
    });

    describe('schema discovery', () => {
        it('lists only the types the workspace was granted', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get('/api/v1/content-types')
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            expect(
                (res.body.items as TypeSummary[]).map((type) => type.name)
            ).toEqual(['test_article']);
        });

        it('serves one type’s field schema', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            const res = await request(harness.server)
                .get('/api/v1/content-types/test_article')
                .set('Authorization', `Bearer ${secret}`)
                .expect(200);

            expect(res.body.name).toBe('test_article');
            expect(res.body.publishable).toBe(true);
            expect(res.body.i18n).toBe(true);
            expect(
                (res.body.fields as { name: string }[]).map(
                    (field) => field.name
                )
            ).toContain('text');
        });

        it('404s the schema of an ungranted type', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId]
            });

            await request(harness.server)
                .get('/api/v1/content-types/test_page')
                .set('Authorization', `Bearer ${secret}`)
                .expect(404);
        });
    });
});
