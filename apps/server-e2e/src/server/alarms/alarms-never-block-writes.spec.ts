import request from 'supertest';
import { getPool } from '@orthacms/database';
import { ALARM_SEVERITIES } from '@orthacms/alarms-server';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { drainOutbox } from '../../support/outbox';
import {
    resetDb,
    seedActiveUser,
    seedAllContentGrants,
    seedMembership,
    seedWorkspace
} from '../../support/seed';

const ADMIN_EMAIL = 'alarm-nonblocking-admin@example.com';
const PASSWORD = 'SecurePass123!';

/** The values every fixture article needs in order to publish at all. */
const REQUIRED_VALUES = { text: 'A body', select: 'article' };

/**
 * "This article has no number" — deliberately **status-free**.
 *
 * The lifecycle suite's rule is about *published* articles, so the finding it
 * opens closes itself the moment an edit takes the entry back to draft. Here
 * the condition has to hold across the whole sequence — draft, saved, published
 * — because the assertion is that the alarm was **open at the moment of each
 * write** rather than opened after it. A rule whose finding blinks off during
 * the save would leave nothing for a refusal to have refused, which is exactly
 * the fixture bug that makes this test unable to fail.
 */
const NO_NUMBER_FILTER = {
    and: [{ field: 'number', op: 'null', value: true }]
};

let harness: TestApp;

beforeAll(async () => {
    harness = await createTestApp();
});

afterAll(async () => {
    await closeTestApp(harness);
});

/**
 * **ADR-0015 — an alarm never refuses a write.**
 *
 * The whole reason this plugin can exist beside content's publish gate is that
 * it has no authority: `error` is louder than `warn` and that is all it is. The
 * moment a severity could refuse a publish there would be two competing
 * authorities on whether an entry is valid, and they would disagree.
 *
 * ### What this suite pins, and what it does not
 *
 * The invariant is written as a universal negative — *no path returns a
 * refusal* — and no finite suite proves that outright. What is observable, and
 * asserted here, is the half that would break first and matter most: with the
 * **highest** severity matching an entry and a finding open on it, a save, a
 * publish and a bulk publish all go through, and the **row really changed**.
 * Asserting the status code alone would not do it: a soft refusal that answers
 * 200 and quietly declines to write, or a bulk publish that reports the entry
 * as `skipped`, is the shape this failure would most plausibly take.
 *
 * The remaining half is **structural** and is held by review rather than by an
 * assertion: alarms binds nothing into content's entry-write extension port
 * (the one seam through which a plugin could throw inside a save's
 * transaction), registers no publish-time validator, and its only write-path
 * participation is an `OutboxDispatcher` subscriber that runs *after* the entry
 * has committed. A test can show that the refusal is not there today; only the
 * absence of a seam keeps it from being added tomorrow.
 */
describe('Alarms never refuse a write (ADR-0015)', () => {
    let workspaceId: string;

    beforeEach(async () => {
        await resetDb();
        const admin = await seedActiveUser(harness.app, {
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
        const workspace = await seedWorkspace({
            name: 'Non-blocking',
            slug: 'non-blocking'
        });
        workspaceId = workspace.id;
        await seedMembership(admin.id, workspaceId);
        await seedAllContentGrants(workspaceId);
    });

    /** A logged-in agent carrying the workspace header the routes require. */
    async function api() {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email: ADMIN_EMAIL, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', workspaceId);
        return agent;
    }

    /**
     * A rule at the **highest** severity there is, created *after* the entries
     * exist so its immediate scan opens the finding before any write is
     * attempted. Read off `ALARM_SEVERITIES` rather than hard-coded, so adding
     * a louder severity above `error` turns this into a test of the new top one
     * instead of silently demoting it to a middling case.
     */
    async function createLoudestRule(
        client: Awaited<ReturnType<typeof api>>
    ): Promise<string> {
        const loudest = ALARM_SEVERITIES[0];
        expect(loudest).toBe('error');

        const res = await client
            .post('/api/alarms/rules')
            .send({
                contentType: 'test_article',
                name: 'No number',
                findingTitle: 'This article has no number',
                severity: loudest,
                filter: NO_NUMBER_FILTER
            })
            .expect(201);
        return res.body.rule.id as string;
    }

    /** Create a draft article that the rule matches. */
    async function createDraft(
        client: Awaited<ReturnType<typeof api>>
    ): Promise<string> {
        const created = await client
            .post('/api/content/test_article')
            .send({ values: { ...REQUIRED_VALUES } })
            .expect(201);
        return created.body.id as string;
    }

    /** The columns the write assertions read straight off the row. */
    async function readArticle(entryId: string): Promise<{
        status: string;
        publishedAt: Date | null;
        text: string | null;
        number: number | null;
    }> {
        const { rows } = await getPool().query(
            'SELECT status, published_at, text, "number" FROM content_test_article WHERE id = $1',
            [entryId]
        );
        const row = rows[0] as {
            status: string;
            published_at: Date | null;
            text: string | null;
            number: number | null;
        };
        return {
            status: row.status,
            publishedAt: row.published_at,
            text: row.text,
            number: row.number
        };
    }

    /** One finding's state, or `null` when the rule has none for that entry. */
    async function findingState(
        ruleId: string,
        entryId: string
    ): Promise<string | null> {
        const { rows } = await getPool().query(
            'SELECT state FROM alarm_findings WHERE rule_id = $1 AND entry_id = $2',
            [ruleId, entryId]
        );
        return (rows[0] as { state: string } | undefined)?.state ?? null;
    }

    it('lets a save and a publish through with an error-severity finding open on the entry [alarms:I-01]', async () => {
        const client = await api();
        const entryId = await createDraft(client);

        // The rule scans on creation, so the finding is open *before* a single
        // write is attempted — the ordering is the whole test.
        const ruleId = await createLoudestRule(client);
        expect(await findingState(ruleId, entryId)).toBe('open');
        const before = await client.get('/api/alarms/findings').expect(200);
        expect(before.body.items[0]).toMatchObject({
            entryId,
            severity: 'error',
            state: 'open'
        });

        // --- the save -------------------------------------------------------
        await client
            .patch(`/api/content/test_article/${entryId}`)
            .send({ values: { ...REQUIRED_VALUES, text: 'Edited body' } })
            .expect(200);

        // Not the status code: the row. A refusal that answered 200 and wrote
        // nothing would pass an assertion about the response and fail here.
        const saved = await readArticle(entryId);
        expect(saved.text).toBe('Edited body');
        // Still matching, so the alarm was open across the publish below too.
        expect(saved.number).toBeNull();
        expect(await findingState(ruleId, entryId)).toBe('open');

        // --- the publish ----------------------------------------------------
        await client
            .post(`/api/content/test_article/${entryId}/publish`)
            .expect(201);

        const published = await readArticle(entryId);
        expect(published.status).toBe('published');
        expect(published.publishedAt).not.toBeNull();

        // And the alarm is still there afterwards — it neither blocked the
        // write nor was quietly cleared by it. A finding that resolved on the
        // way through would make the two writes above prove nothing.
        await drainOutbox(harness.app);
        expect(await findingState(ruleId, entryId)).toBe('open');
        const after = await client.get('/api/alarms/findings').expect(200);
        expect(after.body.total).toBe(1);
        expect(after.body.items[0]).toMatchObject({
            entryId,
            severity: 'error',
            state: 'open'
        });
    });

    it('does not skip an entry in a bulk publish because an error alarm is open on it', async () => {
        const client = await api();
        const flagged = await createDraft(client);
        const clean = await client
            .post('/api/content/test_article')
            .send({ values: { ...REQUIRED_VALUES, number: 7 } })
            .expect(201);
        const cleanId = clean.body.id as string;

        const ruleId = await createLoudestRule(client);
        expect(await findingState(ruleId, flagged)).toBe('open');
        expect(await findingState(ruleId, cleanId)).toBeNull();

        // The bulk path answers 200 with a `skipped` list, so a refusal here
        // would not show up as a failed request at all — it would show up as
        // one id quietly missing from `published`, which is precisely why the
        // clean entry is in the batch: it is the control that tells "the alarm
        // skipped it" apart from "the batch did nothing".
        const res = await client
            .post('/api/content/test_article/bulk/publish')
            .send({ ids: [flagged, cleanId] })
            .expect(200);

        expect(res.body.skipped).toEqual([]);
        expect([...res.body.published].sort()).toEqual(
            [flagged, cleanId].sort()
        );
        expect((await readArticle(flagged)).status).toBe('published');
        expect((await readArticle(cleanId)).status).toBe('published');
    });
});
