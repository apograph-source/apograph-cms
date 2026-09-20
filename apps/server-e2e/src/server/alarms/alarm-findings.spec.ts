import request from 'supertest';
import { getPool } from '@orthacms/database';
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
    seedUserWithEmptyRole,
    seedWorkspace,
    type SeededUser
} from '../../support/seed';

const ADMIN_EMAIL = 'alarm-findings-admin@example.com';
const PASSWORD = 'SecurePass123!';

/**
 * Published articles with no `number`.
 *
 * A rule has to be about an **optional** field to be worth writing: `text` and
 * `select` are required, so an article missing one cannot be published in the
 * first place and the publish gate already covers it. `number` is exactly the
 * case alarms exist for — schema-optional, and something a workspace may still
 * want filled in before a piece ships.
 */
const NO_NUMBER_FILTER = {
    and: [
        { field: 'status', op: 'eq', value: 'published' },
        { field: 'number', op: 'null', value: true }
    ]
};

/** The values every fixture article needs in order to publish at all. */
const REQUIRED_VALUES = { text: 'A body', select: 'article' };

let harness: TestApp;

beforeAll(async () => {
    harness = await createTestApp();
});

afterAll(async () => {
    await closeTestApp(harness);
});

/**
 * The finding **lifecycle**, driven by real entry writes.
 *
 * This is the half a unit test cannot reach: findings are produced by an outbox
 * subscriber reacting to `entry.*` events, and the two behaviours that make the
 * feature usable rather than noisy — above all a finding closing itself — is
 * only observable once a real write has gone through the real event path.
 */
describe('Alarm findings lifecycle', () => {
    let admin: SeededUser;
    let workspaceId: string;
    let ruleId: string;

    beforeEach(async () => {
        await resetDb();
        admin = await seedActiveUser(harness.app, {
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
        const workspace = await seedWorkspace({
            name: 'Findings',
            slug: 'findings'
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

    /** Create the fixture rule and remember its id. */
    async function createRule(client: Awaited<ReturnType<typeof api>>) {
        const res = await client
            .post('/api/alarms/rules')
            .send({
                contentType: 'test_article',
                name: 'Published with no number',
                findingTitle: 'This is published without a number',
                severity: 'warn',
                filter: NO_NUMBER_FILTER
            })
            .expect(201);
        ruleId = res.body.rule.id;
        return res.body.rule.id as string;
    }

    /** Create an article through the API and publish it. */
    async function publishArticle(
        client: Awaited<ReturnType<typeof api>>,
        values: Record<string, unknown> = {}
    ): Promise<string> {
        const created = await client
            .post('/api/content/test_article')
            .send({ values: { ...REQUIRED_VALUES, ...values } })
            .expect(201);
        const id = created.body.id as string;
        await client
            .post(`/api/content/test_article/${id}/publish`)
            .expect(201);
        return id;
    }

    /**
     * Rewrite an article's values and publish it again.
     *
     * The admin's `PATCH` **replaces** the values bag, and editing a published
     * entry takes it back to draft — so a fixture change is always
     * "patch the whole document, then publish", never a partial write.
     */
    async function rewriteAndPublish(
        client: Awaited<ReturnType<typeof api>>,
        entryId: string,
        values: Record<string, unknown>
    ): Promise<void> {
        await client
            .patch(`/api/content/test_article/${entryId}`)
            .send({ values: { ...REQUIRED_VALUES, ...values } })
            .expect(200);
        await client
            .post(`/api/content/test_article/${entryId}/publish`)
            .expect(201);
    }

    it('opens a finding when a matching entry is published', async () => {
        const client = await api();
        await createRule(client);

        const entryId = await publishArticle(client);
        await drainOutbox(harness.app);

        const findings = await client.get('/api/alarms/findings').expect(200);
        expect(findings.body.total).toBe(1);
        expect(findings.body.items[0]).toMatchObject({
            ruleId,
            entryId,
            state: 'open',
            severity: 'warn',
            title: 'This is published without a number'
        });
    });

    it('closes the finding by itself once the entry is fixed', async () => {
        const client = await api();
        await createRule(client);
        const entryId = await publishArticle(client);
        await drainOutbox(harness.app);
        expect((await client.get('/api/alarms/findings')).body.total).toBe(1);

        // Fill the number in. Nobody touches the alarms feature; the entry
        // write alone has to close the finding.
        await rewriteAndPublish(client, entryId, { number: 5 });
        await drainOutbox(harness.app);

        const after = await client.get('/api/alarms/findings').expect(200);
        // covers: alarms:I-18
        expect(after.body.total).toBe(0);
    });

    /** One finding, whole, for the "nothing else moved" comparison. */
    async function findingRow(
        entryId: string
    ): Promise<Record<string, unknown> | undefined> {
        const { rows } = await getPool().query(
            'SELECT * FROM alarm_findings WHERE rule_id = $1 AND entry_id = $2',
            [ruleId, entryId]
        );
        return rows[0] as Record<string, unknown> | undefined;
    }

    it('is idempotent under a re-delivered event [alarms:I-05]', async () => {
        const client = await api();
        await createRule(client);
        const entryId = await publishArticle(client);
        await drainOutbox(harness.app);

        const before = await findingRow(entryId);
        expect(before).toBeDefined();

        // A **real** redelivery. Draining twice delivers nothing the second
        // time — the first drain stamps `dispatched_at`, and the claim only
        // takes rows where it is null — so the event has to be put back the
        // way a process that died between running its subscribers and
        // committing leaves it. That is what at-least-once delivery actually
        // produces, and the only state in which the upsert is reached twice.
        const { rowCount } = await getPool().query(
            `UPDATE outbox_events SET dispatched_at = NULL
             WHERE aggregate_id = $1 AND kind LIKE 'entry.%'`,
            [entryId]
        );
        expect(rowCount).toBeGreaterThan(0);
        await drainOutbox(harness.app);

        // Still one row: the upsert on `(rule_id, entry_id)` collapsed it.
        expect((await client.get('/api/alarms/findings')).body.total).toBe(1);

        // And **nothing but `last_seen_at`** moved. `first_seen_at` is the age
        // the whole findings list is read by; an `ON CONFLICT` whose `SET`
        // list reached it would reset every recurring problem to zero on its
        // next redelivery — with the row count unchanged, so a count-only
        // assertion would never see it.
        const after = await findingRow(entryId);
        expect(after).toBeDefined();
        expect({ ...after, last_seen_at: null }).toEqual({
            ...before,
            last_seen_at: null
        });
        expect(after?.last_seen_at).not.toBeNull();
    });

    it('has no mute route left to call [alarms:I-20]', async () => {
        const client = await api();
        await createRule(client);
        const entryId = await publishArticle(client);
        await drainOutbox(harness.app);

        // Muting existed and was withdrawn. Leaving the route behind the
        // removed UI would be a capability nothing exercises and nobody
        // reviews — reachable by anyone who remembers the URL, and the first
        // thing to rot.
        await client
            .put(`/api/alarms/findings/${ruleId}/${entryId}/mute`)
            .send({ reason: 'this one is a stub on purpose' })
            .expect(404);
        await client
            .delete(`/api/alarms/findings/${ruleId}/${entryId}/mute`)
            .expect(404);

        // And `muted` is no longer a state the list will filter by.
        await client.get('/api/alarms/findings?state=muted').expect(400);
    });

    it('serves findings for a batch of entries in one request', async () => {
        const client = await api();
        await createRule(client);
        const first = await publishArticle(client);
        const second = await publishArticle(client, { number: 7 });
        await drainOutbox(harness.app);

        const res = await client
            .get(`/api/alarms/findings/by-entry?entryIds=${first},${second}`)
            .expect(200);

        expect(Object.keys(res.body.byEntry)).toEqual([first]);
        // covers: alarms:I-04
        expect(res.body.byEntry[first]).toHaveLength(1);
    });

    it('keeps a resolved finding out of the per-entry batch [alarms:I-18]', async () => {
        const client = await api();
        await createRule(client);
        const entryId = await publishArticle(client);
        await drainOutbox(harness.app);

        // While it is open the batch reports it — so the absence below is the
        // `state` filter and not an empty fixture.
        const open = await client
            .get(`/api/alarms/findings/by-entry?entryIds=${entryId}`)
            .expect(200);
        expect(open.body.byEntry[entryId]).toHaveLength(1);

        // Fixed. The row survives — resolving is an UPDATE — so the only thing
        // keeping it off the entry editor's Checks block and the records
        // list's column is `byEntryIds`' own `ne(state, 'resolved')`. Every
        // other case in this file asks about entries whose findings are open,
        // where dropping that clause changes nothing.
        await rewriteAndPublish(client, entryId, { number: 5 });
        await drainOutbox(harness.app);

        const { rows } = await getPool().query(
            'SELECT state FROM alarm_findings WHERE entry_id = $1',
            [entryId]
        );
        expect(rows).toEqual([{ state: 'resolved' }]);

        const after = await client
            .get(`/api/alarms/findings/by-entry?entryIds=${entryId}`)
            .expect(200);
        expect(after.body.byEntry).toEqual({});
    });

    /**
     * The findings controller's **own** permission.
     *
     * Every other authorization case in this package is written against
     * `/alarms/rules`, so a findings route that lost its `@RequirePermissions`
     * would be caught by nothing: `PermissionsGuard` lets an undecorated route
     * through, and the caller below is already past the session check and past
     * `WorkspaceGuard` — a member of the workspace, holding no permission at
     * all. Reading a workspace's findings is reading an assessment of its
     * content; membership is not the bar.
     */
    it('refuses a member holding no alarms:read on every findings route [alarms:I-17]', async () => {
        const client = await api();
        await createRule(client);
        const entryId = await publishArticle(client);
        await drainOutbox(harness.app);

        const nobody = await seedUserWithEmptyRole(harness.app, {
            email: 'alarm-findings-nobody@example.com',
            password: PASSWORD,
            roleKey: 'alarm-findings-nobody'
        });
        await seedMembership(nobody.id, workspaceId);

        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({
                email: 'alarm-findings-nobody@example.com',
                password: PASSWORD
            })
            .expect(201);
        agent.set('X-Workspace-Id', workspaceId);

        for (const route of [
            '/api/alarms/findings',
            '/api/alarms/findings/summary',
            `/api/alarms/findings/by-entry?entryIds=${entryId}`
        ]) {
            const res = await agent.get(route);
            expect([route, res.status]).toEqual([route, 403]);
        }

        // The same three routes answer the caller who does hold the
        // permission, so the 403s above are the permission and not the
        // workspace header or the fixture.
        await client.get('/api/alarms/findings').expect(200);
        await client.get('/api/alarms/findings/summary').expect(200);
        await client
            .get(`/api/alarms/findings/by-entry?entryIds=${entryId}`)
            .expect(200);
    });

    it('reports the open counts by severity for the workspace', async () => {
        const client = await api();
        await createRule(client);
        await publishArticle(client);
        await drainOutbox(harness.app);

        const summary = await client
            .get('/api/alarms/findings/summary')
            .expect(200);
        expect(summary.body).toMatchObject({
            openTotal: 1,
            open: { error: 0, warn: 1, info: 0 }
        });
        expect(summary.body).not.toHaveProperty('muted');
    });

    /** One finding's `first_seen_at`, straight off the row. */
    async function findingFirstSeen(entryId: string): Promise<Date | null> {
        const { rows } = await getPool().query(
            'SELECT first_seen_at FROM alarm_findings WHERE rule_id = $1 AND entry_id = $2',
            [ruleId, entryId]
        );
        return (
            (rows[0] as { first_seen_at: Date } | undefined)?.first_seen_at ??
            null
        );
    }

    it('keeps first_seen_at across a finding closing and reopening [alarms:I-06]', async () => {
        const client = await api();
        await createRule(client);
        const entryId = await publishArticle(client);
        await drainOutbox(harness.app);
        const firstSeen = await findingFirstSeen(entryId);
        expect(firstSeen).not.toBeNull();

        // Fixed: the finding closes. The row stays — resolving is an UPDATE,
        // not a delete, and that is what the history hangs off.
        await rewriteAndPublish(client, entryId, { number: 5 });
        await drainOutbox(harness.app);
        expect((await client.get('/api/alarms/findings')).body.total).toBe(0);

        // Broken again: the same `(rule, entry)` row reopens.
        await rewriteAndPublish(client, entryId, {});
        await drainOutbox(harness.app);
        expect((await client.get('/api/alarms/findings')).body.total).toBe(1);

        // "This has been open for three months" has to survive the round trip —
        // an upsert that let `first_seen_at` move would reset the age of every
        // recurring problem to zero each time it came back.
        expect(await findingFirstSeen(entryId)).toEqual(firstSeen);
    });

    /**
     * **A rule whose filter has stopped parsing.**
     *
     * The state is unreachable through the API — a filter is parsed *before* it
     * is stored, and re-parsed on every edit — so the only way to reach the one
     * the code defends against is to write the row directly, which is exactly
     * what a host renaming a field out from under a saved rule does to it.
     *
     * The discriminator is the edit: it fills the number in, so a rule that
     * still evaluated would legitimately close the finding, and a broken one
     * that answered "nothing matched" instead of "I could not check" would
     * close it too. The finding staying **open** is therefore only reachable
     * through `safeMatch` returning `null` — the single line that keeps "we
     * could not check" from silently reading as "everything is fine".
     */
    it('marks a rule broken rather than closing its findings when its filter stops parsing [alarms:I-08] [alarms:I-09]', async () => {
        const client = await api();
        await createRule(client);
        const entryId = await publishArticle(client);
        await drainOutbox(harness.app);
        expect((await client.get('/api/alarms/findings')).body.total).toBe(1);

        // The field the rule names disappears from under it.
        await getPool().query(
            'UPDATE alarm_rules SET filter = $1::jsonb WHERE id = $2',
            [
                JSON.stringify({
                    and: [{ field: 'no_such_field', op: 'eq', value: 'x' }]
                }),
                ruleId
            ]
        );

        // An entry write that a working rule would resolve the finding on.
        await rewriteAndPublish(client, entryId, { number: 5 });
        await drainOutbox(harness.app);

        // I-09: still open. `safeMatch` answered `null`, so nothing was
        // reconciled and nothing was closed.
        const findings = await client.get('/api/alarms/findings').expect(200);
        expect(findings.body.total).toBe(1);
        expect(findings.body.items[0]).toMatchObject({
            entryId,
            state: 'open'
        });

        // I-08: broken, and *shown* to be — a rule that quietly stopped
        // matching would be indistinguishable from a workspace whose content
        // is fine.
        const rules = await client.get('/api/alarms/rules').expect(200);
        const stored = rules.body.find(
            (rule: { id: string }) => rule.id === ruleId
        );
        expect(stored.brokenReason).toEqual(
            expect.stringContaining('no_such_field')
        );
        expect(stored.openCount).toBe(1);

        // The third path — an explicit recompute — reaches the same verdict.
        // It is the recovery path, so it *does* retry a broken rule rather than
        // skipping it; what it must never do is report a clean scan and close
        // everything the rule holds.
        const rescan = await client
            .post(`/api/alarms/rules/${ruleId}/rescan`)
            .expect(200);
        expect(rescan.body).toMatchObject({ opened: 0, resolved: 0, open: 1 });
        expect((await client.get('/api/alarms/findings')).body.total).toBe(1);
    });

    it('closes the findings on an entry when it is deleted [alarms:I-12]', async () => {
        const client = await api();
        await createRule(client);
        const entryId = await publishArticle(client);
        await drainOutbox(harness.app);
        expect((await client.get('/api/alarms/findings')).body.total).toBe(1);

        await client.delete(`/api/content/test_article/${entryId}`).expect(204);
        await drainOutbox(harness.app);

        expect((await client.get('/api/alarms/findings')).body.total).toBe(0);
    });
});
