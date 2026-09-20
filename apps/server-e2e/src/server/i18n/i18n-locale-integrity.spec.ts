import request from 'supertest';
import { OrphanedLocaleChecker } from '@orthacms/i18n-server';
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
    seedMembership,
    seedWorkspace,
    type SeededUser
} from '../../support/seed';

const ADMIN_EMAIL = 'i18n-integrity-admin@example.com';
const VIEWER_EMAIL = 'i18n-integrity-viewer@example.com';
const OUTSIDER_EMAIL = 'i18n-integrity-outsider@example.com';
const PASSWORD = 'SecurePass123!';

/** A valid `test_article` payload (`text` localized + required `select`). */
const VALID = { text: 'Hello world', select: 'article' } as const;

/**
 * The locale rules that hold **across** the group rather than inside one row —
 * the ones a single-request test cannot see, and the four that were wrong:
 *
 * - **Concurrent saves on two locales of one record must not deadlock.** The
 *   shared-field sync locks the group's siblings `FOR UPDATE`, but the entry
 *   being saved was already locked by the pipeline's own `UPDATE`, so two
 *   savers in one group each held the row the other wanted — a lock-order
 *   inversion Postgres resolved by aborting one with `deadlock detected`
 *   (SQLSTATE 40P01), reaching the client as a 500 on an ordinary save.
 * - **The batched summary is origin-checked** like every other POST, rather
 *   than exempt on the grounds that the handler happens only to read.
 * - **Rows in an unconfigured locale are excluded everywhere**, and their
 *   existence is reported at boot instead of silently orphaning them.
 * - **`localeCount` counts the configured set**, so the records table and the
 *   coverage card cannot describe the same record differently, and the
 *   `hasLocale` operators that negate *inside* the EXISTS are refused rather
 *   than answering a question nobody asked.
 *
 * Plus the wire contract the admin needs to mark up a translation as the
 * language it is (`locale` as a BCP-47 `lang`, `dir` for direction).
 */
describe('i18n locale integrity (/api/content + /api/i18n + /api/insights)', () => {
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

    async function login(email = ADMIN_EMAIL, wsId = workspaceId) {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', wsId);
        return agent;
    }

    type ArticleRow = {
        id: string;
        locale: string;
        localeGroupId: string;
        values: Record<string, unknown>;
    };

    async function createArticle(
        agent: request.Agent,
        body: Record<string, unknown> = {}
    ): Promise<ArticleRow> {
        const res = await agent
            .post('/api/content/test_article')
            .send({ values: VALID, ...body })
            .expect(201);
        return res.body as ArticleRow;
    }

    async function createTranslation(
        agent: request.Agent,
        source: ArticleRow,
        locale: string
    ): Promise<ArticleRow> {
        const res = await agent
            .post('/api/content/test_article')
            .send({
                values: source.values,
                locale,
                localeGroupId: source.localeGroupId
            })
            .expect(201);
        return res.body as ArticleRow;
    }

    /** `?filter=` as the list endpoint takes it. */
    function filterQuery(rule: Record<string, unknown>): string {
        return JSON.stringify({ and: [rule] });
    }

    // ---- BUG-i18n-server-01 — the lock-order inversion --------------------

    describe('concurrent saves across a translation group', () => {
        it('serializes two locales of one record instead of deadlocking [i18n:I-12]', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            const de = await createTranslation(agent, en, 'de');
            await createTranslation(agent, en, 'fr');

            // `number` is unmarked, so it is a **shared** field: every save
            // below propagates to the group and therefore takes the sibling
            // locks that used to invert. Interleaved pairs, not a burst, so
            // each round genuinely overlaps the other locale's transaction.
            const rounds = 12;
            const results: number[] = [];
            for (let i = 1; i <= rounds; i++) {
                const [a, b] = await Promise.all([
                    agent
                        .patch(`/api/content/test_article/${en.id}`)
                        .send({ values: { ...VALID, number: i } }),
                    agent
                        .patch(`/api/content/test_article/${de.id}`)
                        .send({ values: { ...VALID, number: i + 50 } })
                ]);
                results.push(a.status, b.status);
            }

            // Before the group lock this produced a spread of 500s (a
            // `deadlock detected` abort on whichever transaction Postgres chose
            // as the victim). Waiting is the correct outcome for two edits to
            // one record; failing is not.
            expect(results.filter((status) => status !== 200)).toEqual([]);
        });

        it('still lets a save with nothing to propagate through untouched', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            await createTranslation(agent, en, 'de');
            // Only a localized field moves — no shared column, so the sync
            // returns before locking anything and the siblings are unchanged.
            await agent
                .patch(`/api/content/test_article/${en.id}`)
                .send({ values: { ...VALID, text: 'Only mine' } })
                .expect(200);
            const panel = await agent
                .get(`/api/i18n/content/test_article/${en.id}/locales`)
                .expect(200);
            expect(panel.body.items).toHaveLength(3);
        });
    });

    // ---- BUG-i18n-server-02 — the read-shaped POST ------------------------

    describe('POST …/locale-summary is guarded like the POST it is', () => {
        it('rejects a disallowed Origin', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            await agent
                .post('/api/i18n/content/test_article/locale-summary')
                .set('Origin', 'https://evil.example.com')
                .send({ groupIds: [en.localeGroupId] })
                .expect(403);
        });

        it('allows the app origin and a client that sends none, answering 200', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            await agent
                .post('/api/i18n/content/test_article/locale-summary')
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({ groupIds: [en.localeGroupId] })
                .expect(200);
            // No Origin at all: a non-browser client, which the guard passes.
            // 200 rather than a 201 that would claim the read created a thing.
            await agent
                .post('/api/i18n/content/test_article/locale-summary')
                .send({ groupIds: [en.localeGroupId] })
                .expect(200);
        });

        it('echoes back only the keys the caller supplied [i18n:I-26]', async () => {
            const agent = await login();
            const mine = await createArticle(agent);
            // A group that exists, but in a workspace the request does not name.
            const otherAgent = await login(ADMIN_EMAIL, otherWorkspaceId);
            const theirs = await createArticle(otherAgent);
            const unknown = '00000000-0000-4000-8000-000000000000';

            const res = await agent
                .post('/api/i18n/content/test_article/locale-summary')
                .send({
                    groupIds: [
                        mine.localeGroupId,
                        theirs.localeGroupId,
                        unknown
                    ]
                })
                .expect(200);

            expect(Object.keys(res.body.groups).sort()).toEqual(
                [mine.localeGroupId, theirs.localeGroupId, unknown].sort()
            );
            // A foreign group and one that names nothing are indistinguishable.
            expect(res.body.groups[theirs.localeGroupId]).toEqual([]);
            expect(res.body.groups[unknown]).toEqual([]);
            expect(res.body.groups[mine.localeGroupId]).toHaveLength(1);
        });
    });

    // ---- BUG-i18n-server-03 — rows left behind by a removed locale --------

    describe('rows in an unconfigured locale', () => {
        /** Seed a group whose third row is in a slug the config omits. */
        async function seedGroupWithOrphan(agent: request.Agent) {
            const en = await createArticle(agent);
            await createTranslation(agent, en, 'de');
            await createTranslation(agent, en, 'fr');
            await seedArticles(
                [
                    {
                        locale: 'it',
                        localeGroupId: en.localeGroupId,
                        text: 'Ciao mondo',
                        select: 'article'
                    }
                ],
                workspaceId
            );
            return en;
        }

        it('is reported by the boot-time checker, with type, slug and count', async () => {
            const agent = await login();
            await seedGroupWithOrphan(agent);
            const checker = harness.app.get(OrphanedLocaleChecker);
            await expect(checker.findOrphans()).resolves.toEqual([
                { typeName: 'test_article', locale: 'it', rows: 1 }
            ]);
        });

        it('finds nothing when every row is in a configured locale', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            await createTranslation(agent, en, 'de');
            const checker = harness.app.get(OrphanedLocaleChecker);
            await expect(checker.findOrphans()).resolves.toEqual([]);
        });

        it('is excluded from the panel, the summary and the list', async () => {
            const agent = await login();
            const en = await seedGroupWithOrphan(agent);

            const panel = await agent
                .get(`/api/i18n/content/test_article/${en.id}/locales`)
                .expect(200);
            expect(
                (panel.body.items as { locale: string }[]).map((i) => i.locale)
            ).toEqual(['en', 'de', 'fr']);

            // The batched summary used to be the one place an orphan stayed
            // visible — it returned the raw row locale, so the records table's
            // badges contradicted every other view of the same record.
            const summary = await agent
                .post('/api/i18n/content/test_article/locale-summary')
                .send({ groupIds: [en.localeGroupId] })
                .expect(200);
            expect(
                (
                    summary.body.groups[en.localeGroupId] as {
                        locale: string;
                    }[]
                ).map((m) => m.locale)
            ).toEqual(['en', 'de', 'fr']);

            // …and it cannot be listed, because the slug is not resolvable.
            await agent
                .get('/api/content/test_article')
                .query({ locale: 'it' })
                .expect(400);
        });

        it('is filtered out of the coverage aggregate (F26)', async () => {
            const agent = await login();
            await seedGroupWithOrphan(agent);
            const res = await agent
                .get('/api/insights/i18n/coverage')
                .expect(200);
            // One record, complete in all three configured locales — the
            // fourth row is not coverage of anything.
            expect(res.body.records).toBe(1);
            expect(res.body.localized).toBe(1);
            expect(
                (res.body.locales as { locale: string }[]).map((l) => l.locale)
            ).toEqual(['en', 'de', 'fr']);
        });

        it('drops a group made only of unconfigured rows', async () => {
            const agent = await login();
            await createArticle(agent); // one ordinary record
            await seedArticles(
                [{ locale: 'it', text: 'Solo italiano', select: 'article' }],
                workspaceId
            );
            const res = await agent
                .get('/api/insights/i18n/coverage')
                .expect(200);
            expect(res.body.records).toBe(1);
        });
    });

    // ---- BUG-i18n-server-04 — the virtual filters -------------------------

    describe('virtual locale filters', () => {
        it('counts only configured locales, so localeCount agrees with coverage (EC-25) [i18n:I-23]', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            await createTranslation(agent, en, 'de');
            await createTranslation(agent, en, 'fr');
            await seedArticles(
                [
                    {
                        locale: 'it',
                        localeGroupId: en.localeGroupId,
                        text: 'Ciao mondo',
                        select: 'article'
                    }
                ],
                workspaceId
            );

            const coverage = await agent
                .get('/api/insights/i18n/coverage')
                .expect(200);
            expect(coverage.body.localized).toBe(1);

            // The card calls it fully localized across three locales; the
            // filter must agree. It used to answer 4 — the unconfigured row
            // pushed the count past the configured total.
            const three = await agent
                .get('/api/content/test_article')
                .query({
                    filter: filterQuery({
                        field: 'localeCount',
                        op: 'eq',
                        value: 3
                    })
                })
                .expect(200);
            expect(three.body.items).toHaveLength(1);

            const four = await agent
                .get('/api/content/test_article')
                .query({
                    filter: filterQuery({
                        field: 'localeCount',
                        op: 'eq',
                        value: 4
                    })
                })
                .expect(200);
            expect(four.body.items).toHaveLength(0);
        });

        it.each([
            ['ne', 'de'],
            ['nin', ['de']]
        ])(
            // covers: i18n:I-21
            'refuses hasLocale %s, which negates inside the EXISTS (EC-26)',
            async (op, value) => {
                const agent = await login();
                const en = await createArticle(agent);
                await createTranslation(agent, en, 'de');
                const res = await agent
                    .get('/api/content/test_article')
                    .query({
                        filter: filterQuery({
                            field: 'hasLocale',
                            op,
                            value
                        })
                    })
                    .expect(400);
                expect(res.body.message).toContain('hasLocale');
            }
        );

        it('rejects an operator the field does not admit (F19)', async () => {
            const agent = await login();
            const res = await agent
                .get('/api/content/test_article')
                .query({
                    filter: filterQuery({
                        field: 'hasLocale',
                        op: 'gt',
                        value: 'de'
                    })
                })
                .expect(400);
            expect(res.body.message).toBe(
                'Operator "gt" is not supported on "hasLocale".'
            );
        });

        it('reads missingLocale in [...] as missing ALL of them (EC-27) [i18n:I-22]', async () => {
            const agent = await login();
            // `both` lacks de and fr; `partial` lacks only fr.
            await createArticle(agent);
            const partial = await createArticle(agent);
            await createTranslation(agent, partial, 'de');

            const res = await agent
                .get('/api/content/test_article')
                .query({
                    filter: filterQuery({
                        field: 'missingLocale',
                        op: 'in',
                        value: ['de', 'fr']
                    })
                })
                .expect(200);
            // Only the record missing *both* — a `notExists` over the union.
            expect(res.body.items).toHaveLength(1);
            expect(res.body.items[0].localeGroupId).not.toBe(
                partial.localeGroupId
            );
        });

        it('still answers the operators it does admit', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            await createTranslation(agent, en, 'de');
            await createArticle(agent); // en only

            const has = await agent
                .get('/api/content/test_article')
                .query({
                    filter: filterQuery({
                        field: 'hasLocale',
                        op: 'eq',
                        value: 'de'
                    })
                })
                .expect(200);
            expect(has.body.items).toHaveLength(1);

            const missing = await agent
                .get('/api/content/test_article')
                .query({
                    filter: filterQuery({
                        field: 'missingLocale',
                        op: 'eq',
                        value: 'de'
                    })
                })
                .expect(200);
            expect(missing.body.items).toHaveLength(1);
        });
    });

    // ---- Authorization on the two group reads (EC-37 / 38 / 39) -----------

    describe('authorization on the panel and the summary', () => {
        it('lets a viewer read both — they hold content:read (EC-37)', async () => {
            const owner = await login();
            const en = await createArticle(owner);

            const viewer = await seedActiveUser(harness.app, {
                email: VIEWER_EMAIL,
                password: PASSWORD,
                role: 'viewer'
            });
            await seedMembership(viewer.id, workspaceId);
            const agent = await login(VIEWER_EMAIL);

            await agent
                .get(`/api/i18n/content/test_article/${en.id}/locales`)
                .expect(200);
            await agent
                .post('/api/i18n/content/test_article/locale-summary')
                .send({ groupIds: [en.localeGroupId] })
                .expect(200);
        });

        it('rejects a non-member of the named workspace (EC-38)', async () => {
            const owner = await login();
            const en = await createArticle(owner);

            await seedActiveUser(harness.app, {
                email: OUTSIDER_EMAIL,
                password: PASSWORD,
                role: 'admin'
            });
            const agent = request.agent(harness.server);
            await agent
                .post('/api/auth/login')
                .send({ email: OUTSIDER_EMAIL, password: PASSWORD })
                .expect(201);
            agent.set('X-Workspace-Id', workspaceId);

            await agent
                .get(`/api/i18n/content/test_article/${en.id}/locales`)
                .expect(403);
            await agent
                .post('/api/i18n/content/test_article/locale-summary')
                .send({ groupIds: [en.localeGroupId] })
                .expect(403);
        });

        it('404s an entry id from another workspace, with no enumeration signal (EC-39)', async () => {
            const otherAgent = await login(ADMIN_EMAIL, otherWorkspaceId);
            const theirs = await createArticle(otherAgent);

            const agent = await login();
            // 404, the same answer as an id that names nothing at all — not a
            // 403 that would confirm the entry exists elsewhere.
            await agent
                .get(`/api/i18n/content/test_article/${theirs.id}/locales`)
                .expect(404);
            await agent
                .get(
                    `/api/i18n/content/test_article/00000000-0000-4000-8000-000000000000/locales`
                )
                .expect(404);
        });
    });

    // ---- A11Y-i18n-server-01 / -02 — the language wire contract -----------

    describe('language and direction on the wire', () => {
        it('returns a resolved dir for every configured locale [i18n:I-04]', async () => {
            const agent = await login();
            const res = await agent.get('/api/i18n/locales').expect(200);
            const items = res.body.items as {
                slug: string;
                dir: string;
            }[];
            expect(items.map((i) => i.slug)).toEqual(['en', 'de', 'fr']);
            // Every item carries one — the admin never has to decide for
            // itself whether a language is right-to-left.
            expect(items.every((i) => i.dir === 'ltr')).toBe(true);
            expect(Object.keys(items[0]).sort()).toEqual([
                'dir',
                'isDefault',
                'name',
                'slug'
            ]);
        });

        it('carries locale + dir on the entry locale panel', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            const res = await agent
                .get(`/api/i18n/content/test_article/${en.id}/locales`)
                .expect(200);
            for (const item of res.body.items as {
                locale: string;
                dir: string;
            }[]) {
                // `locale` is the BCP-47 tag the editor sets as `lang`, `dir`
                // the direction it sets beside it.
                expect(item.locale).toMatch(/^[a-z]{2,3}(-[a-z0-9]+)*$/);
                expect(['ltr', 'rtl']).toContain(item.dir);
            }
        });

        it('returns the locale on the entry payload the editor reads', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            const res = await agent
                .get(`/api/content/test_article/${en.id}`)
                .expect(200);
            expect(res.body.locale).toBe('en');
        });
    });
});
