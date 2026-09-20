import request from 'supertest';
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
    seedWorkspace
} from '../../support/seed';

const EMAIL = 'i18n-single-locale@example.com';
const PASSWORD = 'SecurePass123!';

/** A valid `test_article` payload (`text` localized + required `select`). */
const VALID = { text: 'Hello world', select: 'article' } as const;

/**
 * The coverage rule that only exists when there is nowhere to translate to.
 *
 * `notLocalized` counts records present in exactly one locale — but with a
 * **single** configured locale that is every record, and the card would report
 * each of them as both fully localized and not localized at all. The query
 * forces the figure to `0` instead, and no seeded data can exercise that while
 * three locales are configured.
 *
 * Its **own spec file**, not a second `describe` beside the rest of the i18n
 * suites: the `@orthacms/database` pool is a per-file singleton and
 * `closeTestApp` ends it, so two apps in one file leave the second booting
 * against a closed pool. One app per file is the harness's rule.
 */
describe('i18n coverage with one configured locale (/api/insights/i18n)', () => {
    let harness: TestApp;
    let workspaceId: string;

    beforeAll(async () => {
        harness = await createTestApp({
            locales: [{ slug: 'en', name: 'English', isDefault: true }]
        });
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        const admin = await seedActiveUser(harness.app, {
            email: EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
        const ws = await seedWorkspace({ name: 'WS Solo', slug: 'ws-solo' });
        workspaceId = ws.id;
        await seedMembership(admin.id, workspaceId);
        await seedAllContentGrants(workspaceId);
    });

    it('forces notLocalized to 0 — there is nowhere to translate to (F27) [i18n:I-25]', async () => {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email: EMAIL, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', workspaceId);

        await agent
            .post('/api/content/test_article')
            .send({ values: VALID })
            .expect(201);

        const res = await agent.get('/api/insights/i18n/coverage').expect(200);
        expect(res.body.records).toBe(1);
        // Complete, because the one configured locale is present…
        expect(res.body.localized).toBe(1);
        expect(res.body.requiresLocalization).toBe(0);
        // …and NOT also "not localized", which is what the raw
        // "in exactly one locale" test would otherwise have said.
        expect(res.body.notLocalized).toBe(0);
    });

    it('lists only the one configured locale', async () => {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email: EMAIL, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', workspaceId);

        const res = await agent.get('/api/i18n/locales').expect(200);
        expect(res.body.items).toEqual([
            { slug: 'en', name: 'English', isDefault: true, dir: 'ltr' }
        ]);
    });
});
