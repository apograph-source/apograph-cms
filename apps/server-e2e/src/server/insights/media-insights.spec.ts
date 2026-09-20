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
    seedMediaAsset,
    seedMembership,
    seedWorkspace,
    type SeededUser
} from '../../support/seed';

const ADMIN_EMAIL = 'media-insights-admin@example.com';
const PASSWORD = 'SecurePass123!';

const MB = 1024 * 1024;

/**
 * The media Insights read-model (`GET /api/insights/media/…`).
 *
 * The three things a mock cannot check, and all three have bitten real
 * dashboards: that `sum(size)` survives the bigint→string round trip with its
 * value intact, that a blank `alt` is not counted as coverage, and that another
 * workspace's library never leaks into the totals.
 */
describe('Media insights (/api/insights/media)', () => {
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
        const ws = await seedWorkspace({ name: 'Media WS', slug: 'med-ws' });
        workspaceId = ws.id;
        await seedMembership(admin.id, workspaceId);

        const other = await seedWorkspace({ name: 'Other', slug: 'med-oth' });
        otherWorkspaceId = other.id;
        await seedMembership(admin.id, otherWorkspaceId);
    });

    async function login(scopeTo = workspaceId) {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email: ADMIN_EMAIL, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', scopeTo);
        return agent;
    }

    /** Seeds an asset into the workspace under test. */
    function asset(
        over: Parameters<typeof seedMediaAsset>[0] extends never
            ? never
            : Omit<
                  Parameters<typeof seedMediaAsset>[0],
                  'workspaceId' | 'uploadedBy'
              >
    ) {
        return seedMediaAsset({
            workspaceId,
            uploadedBy: admin.id,
            ...over
        });
    }

    describe('GET /storage', () => {
        it('groups assets and bytes by kind, largest by bytes first', async () => {
            const agent = await login();
            await asset({ name: 'a.png', kind: 'image', size: 2 * MB });
            await asset({ name: 'b.png', kind: 'image', size: 3 * MB });
            await asset({ name: 'c.mp4', kind: 'video', size: 50 * MB });

            const res = await agent
                .get('/api/insights/media/storage')
                .expect(200);

            expect(res.body.kinds[0]).toMatchObject({
                kind: 'video',
                count: 1,
                bytes: 50 * MB
            });
            expect(res.body.kinds[1]).toMatchObject({
                kind: 'image',
                count: 2,
                bytes: 5 * MB
            });
            expect(res.body.totalCount).toBe(3);
            expect(res.body.totalBytes).toBe(55 * MB);
        });

        it('returns byte totals as numbers, not strings', async () => {
            // `size` is a bigint, so node-postgres hands `sum()` back as a
            // string. Left unconverted the client's arithmetic silently becomes
            // string concatenation and every bar is wrong.
            const agent = await login();
            await asset({
                name: 'big.mp4',
                kind: 'video',
                size: 4 * 1024 * MB
            });

            const res = await agent
                .get('/api/insights/media/storage')
                .expect(200);

            expect(typeof res.body.totalBytes).toBe('number');
            expect(res.body.totalBytes).toBe(4 * 1024 * MB);
        });

        it('is empty for a workspace with no assets', async () => {
            const agent = await login();
            const res = await agent
                .get('/api/insights/media/storage')
                .expect(200);
            expect(res.body).toEqual({
                kinds: [],
                totalBytes: 0,
                totalCount: 0
            });
        });

        it('counts only the workspace named by the header', async () => {
            const here = await login();
            await asset({ name: 'mine.png', kind: 'image', size: MB });
            await seedMediaAsset({
                workspaceId: otherWorkspaceId,
                uploadedBy: admin.id,
                name: 'theirs.png',
                kind: 'image',
                size: 99 * MB
            });

            const res = await here
                .get('/api/insights/media/storage')
                .expect(200);
            expect(res.body.totalCount).toBe(1);
            expect(res.body.totalBytes).toBe(MB);
        });
    });

    describe('GET /alt', () => {
        it('counts images with real alt text as covered', async () => {
            const agent = await login();
            await asset({ name: 'described.png', kind: 'image', alt: 'A cat' });
            await asset({ name: 'bare.png', kind: 'image' });

            const res = await agent.get('/api/insights/media/alt').expect(200);
            expect(res.body).toEqual({ images: 2, withAlt: 1, missing: 1 });
        });

        it('does not count a blank alt as covered [media:I-25]', async () => {
            // An empty string is the markup for "decorative". Counting it would
            // report accessibility work as done that nobody has done.
            const agent = await login();
            await asset({ name: 'empty.png', kind: 'image', alt: '' });
            await asset({ name: 'spaces.png', kind: 'image', alt: '   ' });

            const res = await agent.get('/api/insights/media/alt').expect(200);
            expect(res.body).toEqual({ images: 2, withAlt: 0, missing: 2 });
        });

        it('ignores non-image assets entirely', async () => {
            const agent = await login();
            await asset({ name: 'doc.pdf', kind: 'document' });
            await asset({ name: 'clip.mp4', kind: 'video' });
            await asset({ name: 'pic.png', kind: 'image' });

            const res = await agent.get('/api/insights/media/alt').expect(200);
            expect(res.body.images).toBe(1);
        });
    });

    describe('GET /uploads', () => {
        it('buckets uploads by when they were added', async () => {
            const agent = await login();
            await asset({ name: 'now-1.png', kind: 'image' });
            await asset({ name: 'now-2.png', kind: 'image' });
            const old = await asset({ name: 'old.png', kind: 'image' });

            await getDatabase().execute(
                sql`update media_asset
                    set created_at = now() - make_interval(days => 10)
                    where id = ${old.id}::uuid`
            );

            const res = await agent
                .get('/api/insights/media/uploads?days=30')
                .expect(200);

            expect(res.body.granularity).toBe('day');
            expect(res.body.total).toBe(3);
            expect(res.body.points.length).toBeGreaterThan(1);
        });

        it('excludes uploads older than the window', async () => {
            const agent = await login();
            const ancient = await asset({ name: 'ancient.png', kind: 'image' });
            await getDatabase().execute(
                sql`update media_asset
                    set created_at = now() - make_interval(days => 200)
                    where id = ${ancient.id}::uuid`
            );

            const res = await agent
                .get('/api/insights/media/uploads?days=30')
                .expect(200);
            expect(res.body.total).toBe(0);
        });

        it('clamps an over-large window rather than rejecting it', async () => {
            // Unlike content's DTO-validated `?days=`, this controller parses
            // by hand and clamps — worth pinning so the two don't silently
            // diverge without anyone deciding they should.
            const agent = await login();
            await agent
                .get('/api/insights/media/uploads?days=9999')
                .expect(200);
            await agent.get('/api/insights/media/uploads?days=abc').expect(200);
        });
    });

    describe('authorization', () => {
        it('401s without a session', async () => {
            for (const route of ['storage', 'uploads', 'alt']) {
                await request(harness.server)
                    .get(`/api/insights/media/${route}`)
                    .set('X-Workspace-Id', workspaceId)
                    .expect(401);
            }
        });

        it('400s without a workspace header', async () => {
            const agent = request.agent(harness.server);
            await agent
                .post('/api/auth/login')
                .send({ email: ADMIN_EMAIL, password: PASSWORD })
                .expect(201);
            await agent.get('/api/insights/media/storage').expect(400);
        });

        it('403s for a workspace the caller is not a member of', async () => {
            const outsider = await seedWorkspace({
                name: 'Not Mine',
                slug: 'med-not-mine'
            });
            const agent = await login(outsider.id);
            await agent.get('/api/insights/media/storage').expect(403);
        });
    });
});
