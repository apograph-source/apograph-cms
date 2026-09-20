import request from 'supertest';
import { sql } from 'drizzle-orm';
import { getDatabase } from '@orthacms/database';
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
    seedWorkspace,
    type SeededUser
} from '../../support/seed';

const ADMIN_EMAIL = 'i18n-admin@example.com';
const PASSWORD = 'SecurePass123!';

/** A valid `article` payload (`text` localized + required `select`). */
const VALID = { text: 'Hello world', select: 'article' } as const;

/**
 * Content localization end to end. The host's reference `article` collection is
 * `i18n: true` (locales en [default] / de / fr), so these drive the real
 * pipeline: locale stamping on create, strict active-locale scoping with the
 * default fallback, translation creation (copy + 409 on duplicate),
 * shared-field sync across a group with published-sibling re-validation, the
 * hasLocale/missingLocale/localeCount filters, the per-entry locale panel, the
 * batched summary, and the non-i18n regression.
 */
describe('Content i18n (/api/content/:type + /api/i18n)', () => {
    let harness: TestApp;
    let admin: SeededUser;
    let workspaceId: string;

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
    });

    async function login(email = ADMIN_EMAIL) {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', workspaceId);
        return agent;
    }

    /** The shape of an article row as the create/read endpoints return it. */
    type ArticleRow = {
        id: string;
        locale: string;
        localeGroupId: string;
        status: string;
        values: Record<string, unknown>;
    };

    /** Create an article, optionally in a given locale; return the row. */
    async function createArticle(
        agent: request.Agent,
        body: Record<string, unknown> = {}
    ): Promise<ArticleRow> {
        const res = await agent
            .post('/api/content/test_article')
            .send({ values: VALID, ...body });
        if (res.status !== 201) {
            await dumpDiag('createArticle', res.status, res.body);
        }
        expect(res.status).toBe(201);
        return res.body as ArticleRow;
    }

    /** TEMP DIAGNOSTIC — dumps who is missing when a content write is refused. */
    async function dumpDiag(
        where: string,
        status: number,
        body: unknown
    ): Promise<void> {
        const db = getDatabase();
        const probe = await db.execute(sql`
            select
              (select count(*) from users where email = ${ADMIN_EMAIL}) as admin_rows,
              (select count(*) from workspaces where id = ${workspaceId}::uuid) as ws_rows,
              (select count(*) from memberships m join users u on u.id = m.user_id
                 where u.email = ${ADMIN_EMAIL} and m.workspace_id = ${workspaceId}::uuid) as membership_rows,
              (select count(*) from workspace_content where workspace_id = ${workspaceId}::uuid) as grant_rows,
              (select count(*) from workspace_content) as grant_rows_total,
              (select count(*) from workspaces) as ws_total,
              (select count(*) from sessions) as session_total
        `);
        const acts = await db.execute(sql`
            select pid, state, xact_start, left(query, 160) as query
              from pg_stat_activity
             where datname = current_database() and pid <> pg_backend_pid()
               and state is distinct from 'idle'
        `);
        console.error(
            '[diag]',
            where,
            '->',
            status,
            JSON.stringify(body),
            'workspaceId=',
            workspaceId,
            'probe=',
            JSON.stringify((probe as unknown as { rows: unknown[] }).rows),
            'activity=',
            JSON.stringify((acts as unknown as { rows: unknown[] }).rows)
        );
    }

    /**
     * Create a sibling translation of `source` via the **normal create**
     * endpoint (`POST /content` + `localeGroupId`) — copying the source's
     * values into the target locale within its group. Asserts `expectStatus`
     * (201 by default) and returns the response.
     */
    async function createTranslation(
        agent: request.Agent,
        source: ArticleRow,
        locale: string,
        expectStatus = 201
    ) {
        return agent
            .post('/api/content/test_article')
            .send({
                values: source.values,
                locale,
                localeGroupId: source.localeGroupId
            })
            .expect(expectStatus);
    }

    describe('locales endpoint', () => {
        it('serves the configured locales with exactly one default', async () => {
            const agent = await login();
            const res = await agent.get('/api/i18n/locales').expect(200);
            const slugs = (res.body.items as { slug: string }[]).map(
                (item) => item.slug
            );
            expect(slugs).toEqual(expect.arrayContaining(['en', 'de', 'fr']));
            const defaults = (
                res.body.items as { isDefault: boolean }[]
            ).filter((item) => item.isDefault);
            expect(defaults).toHaveLength(1);
        });
    });

    describe('create stamps the locale', () => {
        it('defaults to the default locale (en) when none is sent', async () => {
            const agent = await login();
            const row = await createArticle(agent);
            expect(row.locale).toBe('en');
            expect(row.localeGroupId).toBeTruthy();
        });

        it('stamps an explicit locale', async () => {
            const agent = await login();
            const row = await createArticle(agent, { locale: 'de' });
            expect(row.locale).toBe('de');
        });

        it('400s an unknown locale', async () => {
            const agent = await login();
            await agent
                .post('/api/content/test_article')
                .send({ values: VALID, locale: 'zz' })
                .expect(400);
        });

        it('gives a plain create its own fresh translation group [i18n:I-11]', async () => {
            const agent = await login();
            const a = await createArticle(agent);
            const b = await createArticle(agent);
            expect(a.localeGroupId).not.toBe(b.localeGroupId);
        });
    });

    describe('strict list scoping + default fallback', () => {
        it('lists only the default locale when no ?locale= is sent [i18n:I-06]', async () => {
            const agent = await login();
            await createArticle(agent); // en
            const de = await createArticle(agent, { locale: 'de' });
            const res = await agent
                .get('/api/content/test_article')
                .expect(200);
            const ids = (res.body.items as { id: string }[]).map((i) => i.id);
            expect(ids).not.toContain(de.id);
            expect(
                (res.body.items as { locale: string }[]).every(
                    (i) => i.locale === 'en'
                )
            ).toBe(true);
        });

        it('lists only the requested locale with ?locale=de (strict)', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            const de = await createArticle(agent, { locale: 'de' });
            const res = await agent
                .get('/api/content/test_article?locale=de')
                .expect(200);
            const ids = (res.body.items as { id: string }[]).map((i) => i.id);
            expect(ids).toContain(de.id);
            expect(ids).not.toContain(en.id);
        });

        it('400s a list scoped to an unknown locale [i18n:I-05]', async () => {
            const agent = await login();
            await agent.get('/api/content/test_article?locale=zz').expect(400);
        });

        it('falls back to the default row where the requested locale is missing', async () => {
            const agent = await login();
            // An en-only group (no de translation).
            const en = await createArticle(agent);
            const res = await agent
                .get(
                    '/api/content/test_article?locale=de&localeFallback=default'
                )
                .expect(200);
            const ids = (res.body.items as { id: string }[]).map((i) => i.id);
            // The en row stands in for the missing de translation.
            expect(ids).toContain(en.id);
        });
    });

    // Sibling translations are created through the normal create endpoint:
    // `POST /content` with a `localeGroupId` joins that group.
    describe('create translation (POST /content + localeGroupId)', () => {
        it('creates a new draft sibling sharing the group', async () => {
            const agent = await login();
            const en = await createArticle(agent, {
                values: { text: 'Winter boots', select: 'article' }
            });
            const res = await createTranslation(agent, en, 'de');
            expect(res.body.locale).toBe('de');
            expect(res.body.localeGroupId).toBe(en.localeGroupId);
            expect(res.body.status).toBe('draft');
            // The client carried the source's values into the new locale.
            expect(res.body.values.text).toBe('Winter boots');
        });

        it('409s a duplicate locale in the group [i18n:I-09]', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            await createTranslation(agent, en, 'de');
            await createTranslation(agent, en, 'de', 409);
        });

        it('400s a sibling in an unknown target locale', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            await createTranslation(agent, en, 'zz', 400);
        });

        it('404s a localeGroupId that names no group in the workspace [i18n:I-10]', async () => {
            const agent = await login();
            await agent
                .post('/api/content/test_article')
                .send({
                    values: VALID,
                    locale: 'de',
                    localeGroupId: '00000000-0000-4000-8000-000000000000'
                })
                .expect(404);
        });
    });

    describe('shared-field sync', () => {
        it('propagates a non-localized field to siblings but leaves localized fields alone', async () => {
            const agent = await login();
            const en = await createArticle(agent, {
                values: { text: 'EN title', select: 'article' }
            });
            const de = (await createTranslation(agent, en, 'de')).body as {
                id: string;
            };
            // Give the de row its own localized text.
            await agent
                .patch(`/api/content/test_article/${de.id}`)
                .send({ values: { text: 'DE title', select: 'article' } })
                .expect(200);

            // Edit a SHARED field (`number`) on the en row — it must sync to de.
            await agent
                .patch(`/api/content/test_article/${en.id}`)
                .send({
                    values: { text: 'EN title', select: 'article', number: 42 }
                })
                .expect(200);

            const deAfter = await agent
                .get(`/api/content/test_article/${de.id}`)
                .expect(200);
            // Shared field synced...
            expect(deAfter.body.values.number).toBe(42);
            // ...localized field untouched.
            expect(deAfter.body.values.text).toBe('DE title');
        });

        it('syncs an array-valued shared field (jsonb) without tripping the change predicate', async () => {
            const agent = await login();
            // `multiselect` and `json` are jsonb columns, and they are shared.
            // The sync's "did it actually change?" predicate binds each value
            // as a parameter; interpolating an array bare expands it into a
            // parameter *list*, which Postgres reads as a record and rejects
            // (`operator does not exist: jsonb = record`) — failing every save
            // of an i18n type that carried one, not just the sync.
            const en = await createArticle(agent, {
                values: {
                    text: 'EN title',
                    select: 'article',
                    multiselect: ['draft', 'featured'],
                    json: { a: 1 }
                }
            });
            const de = (await createTranslation(agent, en, 'de')).body as {
                id: string;
            };

            await agent
                .patch(`/api/content/test_article/${en.id}`)
                .send({
                    values: {
                        text: 'EN title',
                        select: 'article',
                        multiselect: ['featured', 'pinned', 'archived'],
                        json: { a: 2 }
                    }
                })
                .expect(200);

            const deAfter = await agent
                .get(`/api/content/test_article/${de.id}`)
                .expect(200);
            expect(deAfter.body.values.multiselect).toEqual([
                'featured',
                'pinned',
                'archived'
            ]);
            expect(deAfter.body.values.json).toEqual({ a: 2 });
        });

        it('leaves siblings alone when an array-valued shared field is resent unchanged [i18n:I-14]', async () => {
            const agent = await login();
            const en = await createArticle(agent, {
                values: {
                    text: 'EN title',
                    select: 'article',
                    multiselect: ['draft', 'featured']
                }
            });
            const de = (await createTranslation(agent, en, 'de')).body as {
                id: string;
            };

            const revisionCount = async (id: string) =>
                (
                    (
                        await agent
                            .get(`/api/content/test_article/${id}/revisions`)
                            .expect(200)
                    ).body as { total: number }
                ).total;

            const beforeDe = await revisionCount(de.id);

            // Same array, same order, resent with a localized edit: the jsonb
            // comparison has to see it as equal, or every save re-versions the
            // whole group.
            await agent
                .patch(`/api/content/test_article/${en.id}`)
                .send({
                    values: {
                        text: 'EN retitled',
                        select: 'article',
                        multiselect: ['draft', 'featured']
                    }
                })
                .expect(200);

            expect(await revisionCount(de.id)).toBe(beforeDe);
        });

        it('appends a revision to each sibling the sync rewrote [content:I-15] [i18n:I-20]', async () => {
            const agent = await login();
            const en = await createArticle(agent, {
                values: { text: 'EN title', select: 'article' }
            });
            const de = (await createTranslation(agent, en, 'de')).body as {
                id: string;
            };

            const revisionCount = async (id: string) =>
                (
                    (
                        await agent
                            .get(`/api/content/test_article/${id}/revisions`)
                            .expect(200)
                    ).body as { total: number }
                ).total;

            const beforeDe = await revisionCount(de.id);

            // A SHARED field changes on en, so de's stored values change too —
            // its history has to record that, or a later restore of an older
            // de version silently undoes a change de never shows.
            await agent
                .patch(`/api/content/test_article/${en.id}`)
                .send({
                    values: { text: 'EN title', select: 'article', number: 7 }
                })
                .expect(200);

            expect(await revisionCount(de.id)).toBe(beforeDe + 1);
        });

        it('leaves sibling history alone when only a localized field changes', async () => {
            const agent = await login();
            const en = await createArticle(agent, {
                values: { text: 'EN title', select: 'article', number: 5 }
            });
            const de = (await createTranslation(agent, en, 'de')).body as {
                id: string;
            };

            const revisionCount = async (id: string) =>
                (
                    (
                        await agent
                            .get(`/api/content/test_article/${id}/revisions`)
                            .expect(200)
                    ).body as { total: number }
                ).total;

            const beforeDe = await revisionCount(de.id);

            // Only `text` (localized) changes; the shared `number` is resent
            // unchanged. The save's values bag always carries every field, so
            // the sync must compare rather than rewrite — otherwise every
            // sibling gains a bogus version on every save.
            await agent
                .patch(`/api/content/test_article/${en.id}`)
                .send({
                    values: {
                        text: 'EN retitled',
                        select: 'article',
                        number: 5
                    }
                })
                .expect(200);

            expect(await revisionCount(de.id)).toBe(beforeDe);
        });

        it('nulls a mirrored relation the source moved out of reach [i18n:I-17]', async () => {
            const agent = await login();
            // `test_author` is localized, so `article.author` is **mirrored**:
            // each sibling links that author's row in its own language.
            const createAuthor = async (
                name: string,
                extra: Record<string, unknown> = {}
            ) =>
                (
                    await agent
                        .post('/api/content/test_author')
                        .send({ values: { name }, ...extra })
                        .expect(201)
                ).body as { id: string; localeGroupId: string };

            // Ada is translated into German; Grace is English-only.
            const adaEn = await createAuthor('Ada');
            const adaDe = await createAuthor('Ada (DE)', {
                locale: 'de',
                localeGroupId: adaEn.localeGroupId
            });
            const graceEn = await createAuthor('Grace');

            const en = await createArticle(agent, {
                values: {
                    text: 'EN title',
                    select: 'article',
                    number: 1,
                    author: adaEn.id
                }
            });
            // The create body omits `author` — a mirrored relation serializes
            // as `localized`, so the translation prefill drops it and the
            // server resolves it. That is the precondition this test needs:
            // the German sibling starts **holding** the German Ada. Starting
            // it at `null` (as this test used to) cannot tell "null it" from
            // "skip it", because both leave `null` behind.
            const de = (
                await agent
                    .post('/api/content/test_article')
                    .send({
                        values: {
                            text: 'DE title',
                            select: 'article',
                            number: 1
                        },
                        locale: 'de',
                        localeGroupId: en.localeGroupId
                    })
                    .expect(201)
            ).body as { id: string; values: Record<string, unknown> };
            expect(de.values.author).toBe(adaDe.id);

            // Reassign the English article to Grace, who has no German row, and
            // move a shared field in the same save. The German sibling's author
            // is now unresolvable.
            await agent
                .patch(`/api/content/test_article/${en.id}`)
                .send({
                    values: {
                        text: 'EN title',
                        select: 'article',
                        number: 99,
                        author: graceEn.id
                    }
                })
                .expect(200);

            const deAfter = (
                await agent
                    .get(`/api/content/test_article/${de.id}`)
                    .expect(200)
            ).body as { values: Record<string, unknown> };
            expect(deAfter.values.number).toBe(99); // shared field synced
            // Nulled, not left: leaving `adaDe` would have the German article
            // credit the PREVIOUS author, which reads as fact and is not one.
            // And never `graceEn` — an English row in a German entry is a
            // cross-locale link, which the writer rejects outright.
            expect(deAfter.values.author).toBeNull();
        });

        it('syncs shared fields when a sibling is created into the group', async () => {
            const agent = await login();
            const en = await createArticle(agent, {
                values: { text: 'EN title', select: 'article', number: 1 }
            });
            // Create the de sibling with a DIFFERENT shared `number`.
            await agent
                .post('/api/content/test_article')
                .send({
                    values: { text: 'DE title', select: 'article', number: 5 },
                    locale: 'de',
                    localeGroupId: en.localeGroupId
                })
                .expect(201);

            const enAfter = (
                await agent
                    .get(`/api/content/test_article/${en.id}`)
                    .expect(200)
            ).body as { values: Record<string, unknown> };
            // The shared field propagates to the pre-existing en row on create...
            expect(enAfter.values.number).toBe(5);
            // ...while the localized text stays per-locale.
            expect(enAfter.values.text).toBe('EN title');
        });

        it('422s and rolls back when the sync would invalidate a published sibling [i18n:I-16]', async () => {
            const agent = await login();
            const en = await createArticle(agent, {
                values: { text: 'EN title', select: 'article' }
            });
            const de = (await createTranslation(agent, en, 'de')).body as {
                id: string;
            };
            // Publish the de sibling so it must stay valid.
            await agent
                .post(`/api/content/test_article/${de.id}/publish`)
                .expect(201);

            // `select` is shared (not localized). Clearing it on en would blank
            // the published de row's required select → the sync must 422 and
            // roll the whole save back.
            await agent
                .patch(`/api/content/test_article/${en.id}`)
                .send({ values: { text: 'EN title', select: '' } })
                .expect(422);

            // The en row is unchanged (the transaction rolled back).
            const enAfter = await agent
                .get(`/api/content/test_article/${en.id}`)
                .expect(200);
            expect(enAfter.body.values.select).toBe('article');
        });

        // A shared edit is pending everywhere until it is published. Leaving a
        // rewritten sibling `published` made the same value live in the
        // untouched locales while still pending in the edited one.
        it('moves a rewritten published sibling back to draft, keeping publishedAt [i18n:I-15]', async () => {
            const agent = await login();
            const en = await createArticle(agent, {
                values: { text: 'EN title', select: 'article' }
            });
            const de = (await createTranslation(agent, en, 'de')).body as {
                id: string;
            };
            await agent
                .post(`/api/content/test_article/${en.id}/publish`)
                .expect(201);
            await agent
                .post(`/api/content/test_article/${de.id}/publish`)
                .expect(201);

            // `select` is shared — editing it on en rewrites the de row too.
            await agent
                .patch(`/api/content/test_article/${en.id}`)
                .send({ values: { text: 'EN title', select: 'tutorial' } })
                .expect(200);

            const deAfter = await agent
                .get(`/api/content/test_article/${de.id}`)
                .expect(200);
            expect(deAfter.body.values.select).toBe('tutorial');
            // Draft **with** a publishedAt — the admin's "Modified", not a
            // never-published draft.
            expect(deAfter.body.status).toBe('draft');
            expect(deAfter.body.publishedAt).toEqual(expect.any(String));

            // Its previously-published version stays live in history under the
            // new draft one.
            const revs = await agent
                .get(`/api/content/test_article/${de.id}/revisions`)
                .expect(200);
            expect(
                revs.body.items.filter(
                    (r: { isPublished: boolean }) => r.isPublished
                )
            ).toHaveLength(1);
            expect(revs.body.items[0]).toMatchObject({
                isLatest: true,
                status: 'draft'
            });

            // The locale panel serves the pair the admin classifies from.
            const panel = await agent
                .get(`/api/i18n/content/test_article/${en.id}/locales`)
                .expect(200);
            const byLocale = Object.fromEntries(
                panel.body.items.map((i: { locale: string }) => [i.locale, i])
            );
            expect(byLocale['en'].entry).toMatchObject({
                status: 'draft',
                publishedAt: expect.any(String)
            });
            expect(byLocale['de'].entry).toMatchObject({
                status: 'draft',
                publishedAt: expect.any(String)
            });
        });

        it('leaves a draft sibling — and its publishedAt — alone', async () => {
            const agent = await login();
            const en = await createArticle(agent, {
                values: { text: 'EN title', select: 'article' }
            });
            const de = (await createTranslation(agent, en, 'de')).body as {
                id: string;
            };

            await agent
                .patch(`/api/content/test_article/${en.id}`)
                .send({ values: { text: 'EN title', select: 'tutorial' } })
                .expect(200);

            const deAfter = await agent
                .get(`/api/content/test_article/${de.id}`)
                .expect(200);
            expect(deAfter.body.status).toBe('draft');
            // Never published → still null, so it reads as a plain Draft.
            expect(deAfter.body.publishedAt).toBeNull();
        });
    });

    describe('relation locale sync', () => {
        /** A tag — a NON-localized target, so `article.tags` is **shared**. */
        async function createTag(agent: request.Agent, name: string) {
            const res = await agent
                .post('/api/content/test_tag')
                .send({ values: { name, slug: name.toLowerCase() } })
                .expect(201);
            return res.body as { id: string };
        }

        /**
         * An author — a LOCALIZED target, so `article.author` /
         * `article.contributors` are **mirrored**. Pass `groupOf` to create the
         * translation of an existing author rather than a new person.
         */
        async function createAuthor(
            agent: request.Agent,
            name: string,
            locale?: string,
            groupOf?: { localeGroupId: string }
        ) {
            const res = await agent
                .post('/api/content/test_author')
                .send({
                    values: { name },
                    ...(locale ? { locale } : {}),
                    ...(groupOf ? { localeGroupId: groupOf.localeGroupId } : {})
                })
                .expect(201);
            return res.body as { id: string; localeGroupId: string };
        }

        /** The ordered link ids of one relation field on one entry. */
        async function linkIds(
            agent: request.Agent,
            entryId: string,
            fieldName: string
        ): Promise<string[]> {
            const res = await agent
                .get(
                    `/api/content/test_article/${entryId}/relations/${fieldName}?page=1&pageSize=50`
                )
                .expect(200);
            return (res.body as { items: { id: string }[] }).items.map(
                (item) => item.id
            );
        }

        /** Link ids into a relation field of an article. */
        async function link(
            agent: request.Agent,
            entryId: string,
            fieldName: string,
            ids: string[]
        ) {
            return agent
                .patch(`/api/content/test_article/${entryId}`)
                .send({
                    values: VALID,
                    relations: { [fieldName]: { link: ids } }
                })
                .expect(200);
        }

        it('syncs a shared many-relation to every sibling', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            const de = (await createTranslation(agent, en, 'de')).body as {
                id: string;
            };
            const design = await createTag(agent, 'Design');
            const build = await createTag(agent, 'Build');

            await link(agent, en.id, 'tags', [design.id, build.id]);

            // A tag has no locales, so one row is the tag for every language:
            // the German article holds the very same ids, in the same order.
            expect(await linkIds(agent, de.id, 'tags')).toEqual([
                design.id,
                build.id
            ]);
        });

        it('unlinks across the group too, not just links', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            const de = (await createTranslation(agent, en, 'de')).body as {
                id: string;
            };
            const design = await createTag(agent, 'Design');
            const build = await createTag(agent, 'Build');
            await link(agent, en.id, 'tags', [design.id, build.id]);

            await agent
                .patch(`/api/content/test_article/${en.id}`)
                .send({
                    values: VALID,
                    relations: { tags: { unlink: [build.id] } }
                })
                .expect(200);

            expect(await linkIds(agent, de.id, 'tags')).toEqual([design.id]);
        });

        it('gives a new translation the links the group already had [i18n:I-19]', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            const design = await createTag(agent, 'Design');
            await link(agent, en.id, 'tags', [design.id]);

            // A create body carries no relation links at all, so without the
            // inward half of the sync a translation would be born with none —
            // exactly the manual re-linking this feature removes.
            const de = (await createTranslation(agent, en, 'de')).body as {
                id: string;
            };
            expect(await linkIds(agent, de.id, 'tags')).toEqual([design.id]);
        });

        it('does not let a new translation wipe the links it arrives without', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            const design = await createTag(agent, 'Design');
            await link(agent, en.id, 'tags', [design.id]);

            await createTranslation(agent, en, 'de');

            // The regression this guards: treating the new (link-less) row as
            // the authority and propagating its emptiness outward.
            expect(await linkIds(agent, en.id, 'tags')).toEqual([design.id]);
        });

        it('mirrors a localized many-relation into each sibling locale', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            const de = (await createTranslation(agent, en, 'de')).body as {
                id: string;
            };
            const adaEn = await createAuthor(agent, 'Ada');
            const adaDe = await createAuthor(agent, 'Ada (DE)', 'de', adaEn);

            await link(agent, en.id, 'contributors', [adaEn.id]);

            // The flagship case: the English article links the English Ada, so
            // the German article links the GERMAN Ada — same person, resolved
            // through the translation group.
            expect(await linkIds(agent, de.id, 'contributors')).toEqual([
                adaDe.id
            ]);
        });

        it('mirrors a localized single relation into each sibling locale', async () => {
            const agent = await login();
            const adaEn = await createAuthor(agent, 'Ada');
            const adaDe = await createAuthor(agent, 'Ada (DE)', 'de', adaEn);
            const en = await createArticle(agent, {
                values: { ...VALID, author: adaEn.id }
            });
            // The create body deliberately omits `author`. A mirrored relation
            // serializes as `localized`, so the admin's translation prefill
            // drops it — and it has to: sending the English author id into a
            // German row is a cross-locale link, which the writer rejects with
            // a 422. Resolving it is the server's job, not the client's.
            const de = (
                await agent
                    .post('/api/content/test_article')
                    .send({
                        values: VALID,
                        locale: 'de',
                        localeGroupId: en.localeGroupId
                    })
                    .expect(201)
            ).body as { id: string; values: Record<string, unknown> };

            // Resolved during the create, so the translation opens already
            // pointing at the right row — and it is in the response, not only
            // in the database, because the first revision snapshots it.
            expect(de.values.author).toBe(adaDe.id);

            const deAfter = (
                await agent
                    .get(`/api/content/test_article/${de.id}`)
                    .expect(200)
            ).body as { values: Record<string, unknown> };
            expect(deAfter.values.author).toBe(adaDe.id);
        });

        it('drops a mirrored link whose target is untranslated, and still saves [i18n:I-18]', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            const de = (await createTranslation(agent, en, 'de')).body as {
                id: string;
            };
            const adaEn = await createAuthor(agent, 'Ada');
            const grace = await createAuthor(agent, 'Grace');
            const graceDe = await createAuthor(
                agent,
                'Grace (DE)',
                'de',
                grace
            );

            // Ada has no German row; Grace does. The save succeeds either way.
            await link(agent, en.id, 'contributors', [adaEn.id, grace.id]);

            expect(await linkIds(agent, en.id, 'contributors')).toEqual([
                adaEn.id,
                grace.id
            ]);
            // Only the resolvable one crosses, and never an English row.
            expect(await linkIds(agent, de.id, 'contributors')).toEqual([
                graceDe.id
            ]);
        });

        it('keeps an unsynced relation independent per locale', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            const de = (await createTranslation(agent, en, 'de')).body as {
                id: string;
            };
            const pinned = await createTag(agent, 'Pinned');

            await agent
                .patch(`/api/content/test_article/${en.id}`)
                .send({ values: { ...VALID, pinnedTag: pinned.id } })
                .expect(200);

            // `pinnedTag` sets syncAcrossLocales: false, so the German sibling
            // keeps its own — the same target type as `tags`, which DOES sync,
            // so the flag is the only thing telling them apart.
            const deAfter = (
                await agent
                    .get(`/api/content/test_article/${de.id}`)
                    .expect(200)
            ).body as { values: Record<string, unknown> };
            expect(deAfter.values.pinnedTag ?? null).toBeNull();
        });

        it('lets one record share a one-to-one target across its locales', async () => {
            const agent = await login();
            const seo = (
                await agent
                    .post('/api/content/test_seo')
                    .send({ values: { metaTitle: 'Shared meta' } })
                    .expect(201)
            ).body as { id: string };
            const en = await createArticle(agent, {
                values: { ...VALID, seo: seo.id }
            });

            // The whole point of the per-locale UNIQUE: before it, creating the
            // second language of a record that owned an SEO entry was a flat
            // constraint violation, because every locale row carried the same
            // `seo_id` against a column-wide UNIQUE.
            const de = (await createTranslation(agent, en, 'de')).body as {
                id: string;
                values: Record<string, unknown>;
            };
            expect(de.values.seo).toBe(seo.id);
        });

        it('refuses a one-to-one target already claimed in the same locale', async () => {
            const agent = await login();
            const seo = (
                await agent
                    .post('/api/content/test_seo')
                    .send({ values: { metaTitle: 'Taken' } })
                    .expect(201)
            ).body as { id: string };
            await createArticle(agent, { values: { ...VALID, seo: seo.id } });

            // A *different* record, same locale — still one-to-one, and the
            // caller is told which field, not handed a raw constraint name.
            const res = await agent
                .post('/api/content/test_article')
                .send({ values: { ...VALID, seo: seo.id } })
                .expect(422);
            expect(res.body.issues).toEqual([
                expect.objectContaining({ field: 'seo' })
            ]);
        });

        it('leaves siblings — and their history — alone when links are resent unchanged', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            const de = (await createTranslation(agent, en, 'de')).body as {
                id: string;
            };
            const design = await createTag(agent, 'Design');
            await link(agent, en.id, 'tags', [design.id]);

            const revisionCount = async (id: string) =>
                (
                    (
                        await agent
                            .get(`/api/content/test_article/${id}/revisions`)
                            .expect(200)
                    ).body as { total: number }
                ).total;
            const before = await revisionCount(de.id);

            // Re-link the same tag. The link set does not move, so the sibling
            // must not be rewritten — otherwise every save re-versions the
            // whole translation group.
            await link(agent, en.id, 'tags', [design.id]);

            expect(await revisionCount(de.id)).toBe(before);
        });

        it('versions a sibling and moves it to Modified when only its links change', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            const de = (await createTranslation(agent, en, 'de')).body as {
                id: string;
            };
            await agent
                .post(`/api/content/test_article/${de.id}/publish`)
                .send({})
                .expect(201);

            const revisionCount = async (id: string) =>
                (
                    (
                        await agent
                            .get(`/api/content/test_article/${id}/revisions`)
                            .expect(200)
                    ).body as { total: number }
                ).total;
            const before = await revisionCount(de.id);

            const design = await createTag(agent, 'Design');
            await link(agent, en.id, 'tags', [design.id]);

            const deAfter = (
                await agent
                    .get(`/api/content/test_article/${de.id}`)
                    .expect(200)
            ).body as { status: string; publishedAt: string | null };
            // A links-only change is still a change: the sibling earns a
            // version, drops back to draft, and keeps `publishedAt` — the
            // admin's **Modified** state (live content, unpublished edits).
            expect(await revisionCount(de.id)).toBe(before + 1);
            expect(deAfter.status).toBe('draft');
            expect(deAfter.publishedAt).not.toBeNull();
        });

        it('frees a one-to-one target once the holder is soft-deleted', async () => {
            const agent = await login();
            const seo = (
                await agent
                    .post('/api/content/test_seo')
                    .send({ values: { metaTitle: 'Recycled' } })
                    .expect(201)
            ).body as { id: string };
            const first = await createArticle(agent, {
                values: { ...VALID, seo: seo.id }
            });
            await agent
                .delete(`/api/content/test_article/${first.id}`)
                .expect(204);

            // The index is partial (`WHERE deleted_at IS NULL`), like the
            // (group, locale) pair — a trashed row must not hold a target
            // hostage forever.
            await agent
                .post('/api/content/test_article')
                .send({ values: { ...VALID, seo: seo.id } })
                .expect(201);
        });

        it('says nothing about locales when the type has none', async () => {
            const agent = await login();
            const seo = (
                await agent
                    .post('/api/content/test_seo')
                    .send({ values: { metaTitle: 'Page meta' } })
                    .expect(201)
            ).body as { id: string };
            await agent
                .post('/api/content/test_page')
                .send({ values: { title: 'First', seo: seo.id } })
                .expect(201);

            // `test_page` is NOT localized, so its one-to-one keeps the plain
            // column-wide UNIQUE and the message must not mention a locale the
            // type does not have.
            const res = await agent
                .post('/api/content/test_page')
                .send({ values: { title: 'Second', seo: seo.id } })
                .expect(422);
            expect(res.body.issues).toEqual([
                { field: 'seo', message: 'is already linked to another entry' }
            ]);
        });

        it('reports the sync mode on the schema so the editor can explain itself', async () => {
            const agent = await login();
            const res = await agent
                .get('/api/content-schema/test_article')
                .expect(200);
            const fields = (
                res.body as {
                    fields: {
                        name: string;
                        localized?: boolean;
                        relation?: { localeSync?: string };
                    }[];
                }
            ).fields;
            const byName = (name: string) =>
                fields.find((entry) => entry.name === name);

            expect(byName('tags')?.relation?.localeSync).toBe('shared');
            expect(byName('contributors')?.relation?.localeSync).toBe(
                'mirrored'
            );
            // `seo` is one-to-one and still shared: on a localized type the
            // UNIQUE is scoped to the locale, so the record's language rows may
            // all point at it.
            expect(byName('seo')?.relation?.localeSync).toBe('shared');
            expect(byName('pinnedTag')?.relation?.localeSync).toBe('none');
            // A shared relation holds the same id in every locale, so it is not
            // a per-locale value; a mirrored or unsynced one is.
            expect(byName('tags')?.localized).toBeUndefined();
            expect(byName('seo')?.localized).toBeUndefined();
            expect(byName('contributors')?.localized).toBe(true);
            expect(byName('pinnedTag')?.localized).toBe(true);
        });
    });

    describe('locale aggregate filters', () => {
        /** The `?filter=` JSON for one rule (`op`, matching the engine). */
        const rule = (field: string, op: string, value: unknown) =>
            JSON.stringify({ field, op, value });

        it('hasLocale / missingLocale select by group membership', async () => {
            const agent = await login();
            // Group A: en + de. Group B: en only.
            const a = await createArticle(agent);
            await createTranslation(agent, a, 'de');
            const b = await createArticle(agent);

            // hasLocale=de → only group A's en row (strict default-locale list).
            const has = await agent
                .get('/api/content/test_article')
                .query({ filter: rule('hasLocale', 'eq', 'de') })
                .expect(200);
            const hasIds = (has.body.items as { id: string }[]).map(
                (i) => i.id
            );
            expect(hasIds).toContain(a.id);
            expect(hasIds).not.toContain(b.id);

            // missingLocale=de → only group B.
            const missing = await agent
                .get('/api/content/test_article')
                .query({ filter: rule('missingLocale', 'eq', 'de') })
                .expect(200);
            const missingIds = (missing.body.items as { id: string }[]).map(
                (i) => i.id
            );
            expect(missingIds).toContain(b.id);
            expect(missingIds).not.toContain(a.id);
        });

        it('localeCount filters by number of translations', async () => {
            const agent = await login();
            const a = await createArticle(agent); // count 1
            await createTranslation(agent, a, 'de'); // count 2
            const b = await createArticle(agent); // count 1

            const res = await agent
                .get('/api/content/test_article')
                .query({ filter: rule('localeCount', 'lt', 2) })
                .expect(200);
            const ids = (res.body.items as { id: string }[]).map((i) => i.id);
            expect(ids).toContain(b.id);
            expect(ids).not.toContain(a.id);
        });
    });

    describe('locale panel + summary', () => {
        it('returns one item per configured locale, present or null', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            await createTranslation(agent, en, 'de');

            const res = await agent
                .get(`/api/i18n/content/test_article/${en.id}/locales`)
                .expect(200);
            expect(res.body.localeGroupId).toBe(en.localeGroupId);
            const byLocale = Object.fromEntries(
                (res.body.items as { locale: string; entry: unknown }[]).map(
                    (item) => [item.locale, item.entry]
                )
            );
            expect(byLocale['en']).not.toBeNull();
            expect(byLocale['de']).not.toBeNull();
            expect(byLocale['fr']).toBeNull();
        });

        it('batches group summaries for a page of rows', async () => {
            const agent = await login();
            const en = await createArticle(agent);
            await createTranslation(agent, en, 'de');

            const res = await agent
                .post('/api/i18n/content/test_article/locale-summary')
                .send({ groupIds: [en.localeGroupId] })
                // 200, not 201: a POST because a page of uuids outgrows a
                // query string, but a read, so it claims nothing was created.
                .expect(200);
            const members = res.body.groups[en.localeGroupId] as {
                locale: string;
            }[];
            expect(members.map((m) => m.locale).sort()).toEqual(['de', 'en']);
        });

        it('400s the locale endpoints on a non-i18n type', async () => {
            const agent = await login();
            // `seo_meta` is not localized (author is now an i18n type).
            const seoId = (
                await agent
                    .post('/api/content/test_seo')
                    .send({ values: { metaTitle: 'Home' } })
                    .expect(201)
            ).body.id as string;
            await agent
                .get(`/api/i18n/content/test_seo/${seoId}/locales`)
                .expect(400);
        });
    });

    describe('non-i18n regression', () => {
        it('ignores ?locale= on a non-localized type [i18n:I-08]', async () => {
            const agent = await login();
            await agent
                .post('/api/content/test_seo')
                .send({ values: { metaTitle: 'Home' } })
                .expect(201);
            // The seo_meta list ignores the locale param entirely.
            const res = await agent
                .get('/api/content/test_seo?locale=de')
                .expect(200);
            expect(res.body.total).toBe(1);
        });
    });
});
