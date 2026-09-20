import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { getPool } from '@orthacms/database';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    resetDb,
    seedActiveUser,
    seedApiTokenWorkspaceGrant,
    seedMediaAsset,
    seedMediaFolder,
    seedUser,
    type SeededUser
} from '../../support/seed';

const PASSWORD = 'SecurePass123!';
const ADMIN_EMAIL = 'wsd-admin@example.com';

/**
 * Every table that carries a `workspace_id`, and how its rows are supposed to
 * disappear when the workspace does.
 *
 * The split is the whole point of the suite: two different mechanisms clear
 * these, and a table in the wrong group is invisible until someone deletes a
 * workspace on a live stand and finds the rows still there. Grouping them here
 * means a new workspace-scoped table has exactly one place to be classified.
 */
const CASCADE_TABLES = [
    // These six carry a real foreign key to `workspaces`, so Postgres removes
    // them and no code has to.
    'memberships',
    'workspace_content',
    'saved_views',
    'copilot_conversations',
    'copilot_proposals',
    'copilot_skills'
] as const;

const PURGED_TABLES = [
    // These eleven carry a plain `workspace_id` with no FK — a cross-plugin
    // foreign key is exactly what the plugin split exists to avoid — so a
    // registered `WorkspacePurger` deletes them inside the delete transaction.
    'media_asset',
    'media_folder',
    'api_token_workspaces',
    'alarm_rules',
    'alarm_findings',
    'entry_access',
    'content_entry_revisions',
    'webhook_endpoint_workspaces',
    // Protection's three. `review_approvals.revision_id` points at
    // `content_entry_revisions`, which is host-owned and therefore un-FK-able
    // from a plugin, so these rows survive the entries and the revisions alike
    // and only a purger reaches them. [protection:I-16]
    'protection_rules',
    'review_requests',
    'review_approvals'
] as const;

const ALL_TABLES = [...CASCADE_TABLES, ...PURGED_TABLES];

/** Row counts for one workspace across {@link ALL_TABLES}. */
type Residue = Record<string, number>;

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
 * The delete's **residue**: what is left in the database once a workspace is
 * gone.
 *
 * The feature suites assert what a delete *returns*; this one asserts what it
 * leaves behind, table by table, which is the half a live stand found wanting —
 * `alarm_rules`, `alarm_findings`, `entry_access` and `content_entry_revisions`
 * all survived a delete pointing at a workspace that no longer existed. Each of
 * those was invisible from the API (the workspace no longer opens) and none of
 * them was inert: an orphaned alarm rule is re-read by every sweep, forever.
 *
 * So the shape here is deliberately exhaustive rather than illustrative — one
 * workspace holding a row in **every** workspace-scoped table, deleted, and
 * then every table counted. A new table that nobody classified shows up as a
 * non-zero count instead of as a bug report six months later.
 */
describe('Deleting a workspace leaves no residue', () => {
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

    /** Seed an admin, log them in, and return the user + cookie agent. */
    async function loginAs(
        email: string
    ): Promise<{ user: SeededUser; agent: ReturnType<typeof request.agent> }> {
        const user = await seedActiveUser(harness.app, {
            email,
            password: PASSWORD,
            role: 'admin'
        });
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password: PASSWORD })
            .expect(201);
        return { user, agent };
    }

    /**
     * Rows of `table` scoped to one workspace.
     *
     * A raw `getPool().query` rather than a typed helper per table: the point
     * of this suite is to sweep tables owned by six different plugins, and
     * every one of them names the column `workspace_id`. Importing six schemas
     * to say `count(*)` would make the sweep harder to extend, which is the one
     * property it must keep.
     */
    async function countRows(
        table: string,
        workspaceId: string
    ): Promise<number> {
        const { rows } = await getPool().query<{ count: string }>(
            `select count(*)::text as count from ${table} where workspace_id = $1`,
            [workspaceId]
        );
        return Number(rows[0].count);
    }

    /** Every table's row count for one workspace, keyed by table name. */
    async function residueOf(workspaceId: string): Promise<Residue> {
        const counts = await Promise.all(
            ALL_TABLES.map((table) => countRows(table, workspaceId))
        );
        return Object.fromEntries(
            ALL_TABLES.map((table, index) => [table, counts[index]])
        );
    }

    /** Whether the `workspaces` row itself is still there. */
    async function workspaceExists(workspaceId: string): Promise<boolean> {
        const { rows } = await getPool().query(
            `select 1 from workspaces where id = $1`,
            [workspaceId]
        );
        return rows.length > 0;
    }

    /**
     * Put one row in every workspace-scoped table.
     *
     * Written with SQL rather than through each plugin's API on purpose: half
     * of these tables belong to features (alarms, audiences, revisions) whose
     * own routes would need a granted content type, a live entry and a run
     * transcript to reach — and the state this suite is about is precisely the
     * one *after* the entries are gone. A workspace can only be deleted once it
     * holds no entries, so on a real stand every surviving `entry_access` and
     * `content_entry_revisions` row already points at an entry that no longer
     * exists. That is the state seeded here.
     */
    async function fill(workspaceId: string, userId: string): Promise<void> {
        const pool = getPool();

        // --- cascade side ---------------------------------------------------
        // `memberships` and `workspace_content` are already populated by the
        // create (the creator, plus one grant per content type); add a second
        // member so a cascade that only removed the caller's own row would show.
        const second = await seedUser(harness.app, {
            email: `wsd-second-${workspaceId.slice(0, 8)}@example.com`,
            role: 'viewer',
            status: 'active'
        });
        await pool.query(
            `insert into memberships (user_id, workspace_id) values ($1, $2)`,
            [second.id, workspaceId]
        );
        await pool.query(
            `insert into saved_views (workspace_id, scope, owner_id, name, payload)
             values ($1, 'content:test_article', $2, 'Needs review', '{}'::jsonb)`,
            [workspaceId, userId]
        );
        const { rows: conversations } = await pool.query<{ id: string }>(
            `insert into copilot_conversations (user_id, workspace_id, title)
             values ($1, $2, 'Rewrite the launch post') returning id`,
            [userId, workspaceId]
        );
        await pool.query(
            `insert into copilot_proposals
                 (conversation_id, run_id, tool_call_id, tool_name, kind,
                  workspace_id, created_by, target, patch, summary)
             values ($1, $2, 'call-1', 'content_entry_update',
                     'content.entry.update', $3, $4,
                     '{}'::jsonb, '{}'::jsonb, 'Tighten the headline')`,
            [conversations[0].id, randomUUID(), workspaceId, userId]
        );
        await pool.query(
            `insert into copilot_skills
                 (workspace_id, name, title, description, instructions)
             values ($1, 'house_style', 'House style', 'How we write',
                     'Short sentences.')`,
            [workspaceId]
        );

        // --- purged side ----------------------------------------------------
        const folder = await seedMediaFolder({ workspaceId, name: 'Brand' });
        await seedMediaAsset({
            workspaceId,
            uploadedBy: userId,
            name: 'logo.png',
            folderId: folder.id
        });
        await seedApiTokenWorkspaceGrant({ workspaceId, createdBy: userId });

        const { rows: rules } = await pool.query<{ id: string }>(
            `insert into alarm_rules
                 (workspace_id, content_type, name, finding_title, severity, filter)
             values ($1, 'test_article', 'Published with no body',
                     'This is published with an empty body', 'warn', '{}'::jsonb)
             returning id`,
            [workspaceId]
        );
        await pool.query(
            `insert into alarm_findings
                 (rule_id, entry_id, workspace_id, content_type, state)
             values ($1, $2, $3, 'test_article', 'open')`,
            [rules[0].id, randomUUID(), workspaceId]
        );
        await pool.query(
            `insert into entry_access (entry_id, workspace_id, type_slug)
             values ($1, $2, 'test_article')`,
            [randomUUID(), workspaceId]
        );
        await pool.query(
            `insert into content_entry_revisions
                 (workspace_id, content_type, entry_id, revision_number, status, snapshot)
             values ($1, 'test_article', $2, 1, 'draft', '{}'::jsonb)`,
            [workspaceId, randomUUID()]
        );
        // Protection: a rule on the type, one open review request, and one
        // approval against a revision id that already names nothing — which is
        // the state every one of these rows is in by the time a workspace can
        // be deleted at all, since deletion requires the entries to be gone.
        await pool.query(
            `insert into protection_rules (workspace_id, kind, slug, enabled, required_approvals)
             values ($1, 'collection', 'test_article', true, 2)`,
            [workspaceId]
        );
        await pool.query(
            `insert into review_requests
                 (workspace_id, content_type, entry_id, revision_id, requested_by, reviewer_ids)
             values ($1, 'test_article', $2, $3, $4, array[$4]::uuid[])`,
            [workspaceId, randomUUID(), randomUUID(), userId]
        );
        await pool.query(
            `insert into review_approvals
                 (workspace_id, content_type, entry_id, revision_id, user_id)
             values ($1, 'test_article', $2, $3, $4)`,
            [workspaceId, randomUUID(), randomUUID(), userId]
        );

        // An endpoint subscribed to this workspace *and* another one, so a
        // purge that deleted by endpoint rather than by workspace would take
        // the sibling row with it and the sweep would still read zero here.
        const { rows: endpoints } = await pool.query<{ id: string }>(
            `insert into webhook_endpoints (name, url, secret, secret_hint)
             values ('Rebuild the storefront', 'https://example.test/hook',
                     'whsec_seed', '_seed')
             returning id`
        );
        await pool.query(
            `insert into webhook_endpoint_workspaces (endpoint_id, workspace_id)
             values ($1, $2), ($1, $3)`,
            [endpoints[0].id, workspaceId, randomUUID()]
        );
    }

    it('clears every workspace-scoped table, by cascade or by purge', async () => {
        const { user, agent } = await loginAs(ADMIN_EMAIL);
        const created = await agent
            .post('/api/workspaces')
            .send(validBody({ slug: 'residue' }))
            .expect(201);
        const id = created.body.id as string;

        await fill(id, user.id);

        // Everything is genuinely there first — an assertion that a table is
        // empty afterwards proves nothing unless it was non-empty before, and
        // a mis-typed insert would otherwise pass this suite silently.
        const before = await residueOf(id);
        expect(ALL_TABLES.filter((table) => before[table] === 0)).toEqual([]);

        await agent.delete(`/api/workspaces/${id}`).expect(204);

        expect(await workspaceExists(id)).toBe(false);
        expect(await residueOf(id)).toEqual(
            Object.fromEntries(ALL_TABLES.map((table) => [table, 0]))
        );
    });

    it('touches nothing belonging to another workspace', async () => {
        const { user, agent } = await loginAs(ADMIN_EMAIL);
        const doomed = await agent
            .post('/api/workspaces')
            .send(validBody({ slug: 'doomed-residue' }))
            .expect(201);
        const keeper = await agent
            .post('/api/workspaces')
            .send(validBody({ name: 'Keeper', slug: 'keeper-residue' }))
            .expect(201);
        const doomedId = doomed.body.id as string;
        const keeperId = keeper.body.id as string;

        await fill(doomedId, user.id);
        await fill(keeperId, user.id);
        const keeperBefore = await residueOf(keeperId);

        await agent.delete(`/api/workspaces/${doomedId}`).expect(204);

        // Every purger is a `where workspace_id = …` delete; the whole risk it
        // carries is that one of them isn't.
        expect(await residueOf(keeperId)).toEqual(keeperBefore);
        expect(await workspaceExists(keeperId)).toBe(true);
    });

    it('leaves the dead id in segments.workspace_ids, which is correct', async () => {
        const { user, agent } = await loginAs(ADMIN_EMAIL);
        const doomed = await agent
            .post('/api/workspaces')
            .send(validBody({ slug: 'audience-residue' }))
            .expect(201);
        const keeper = await agent
            .post('/api/workspaces')
            .send(validBody({ name: 'Keeper', slug: 'keeper-audience' }))
            .expect(201);
        const doomedId = doomed.body.id as string;
        const keeperId = keeper.body.id as string;

        await fill(doomedId, user.id);
        // One audience offered in both workspaces. `workspace_ids` is a plain
        // uuid array with no FK, exactly like `entry_access.workspace_id` — but
        // the two get opposite treatment, and deliberately so.
        await getPool().query(
            `insert into segments (key, label, tags, workspace_ids)
             values ('subscribers', 'Subscribers', '{paid}'::text[], $1::uuid[])`,
            [[doomedId, keeperId]]
        );

        await agent.delete(`/api/workspaces/${doomedId}`).expect(204);

        const { rows } = await getPool().query<{ workspaceIds: string[] }>(
            `select workspace_ids as "workspaceIds" from segments where key = 'subscribers'`
        );
        // NOT a gap. An empty `workspace_ids` means "every workspace", so
        // pruning the dead id from a two-workspace audience walks it towards
        // the state that offers it *everywhere* — the purge would widen who may
        // read, which is the one failure this plugin exists to prevent. A
        // dangling id matches nothing and simply narrows the audience, so it is
        // the safe direction to be wrong in and it stays.
        expect(rows[0].workspaceIds).toEqual([doomedId, keeperId]);
        // The per-entry rows, which have no such reading, are gone.
        expect(await countRows('entry_access', doomedId)).toBe(0);
    });

    it('narrows a webhook endpoint to its surviving workspaces, and keeps it [webhooks:I-19]', async () => {
        const { user, agent } = await loginAs(ADMIN_EMAIL);
        const doomed = await agent
            .post('/api/workspaces')
            .send(validBody({ slug: 'webhook-residue' }))
            .expect(201);
        const keeper = await agent
            .post('/api/workspaces')
            .send(validBody({ name: 'Keeper', slug: 'keeper-webhook' }))
            .expect(201);
        const doomedId = doomed.body.id as string;
        const keeperId = keeper.body.id as string;

        const pool = getPool();
        // One endpoint across both workspaces, and one that named only the
        // doomed workspace — the case where the purge empties the set.
        const { rows: both } = await pool.query<{ id: string }>(
            `insert into webhook_endpoints (name, url, secret, secret_hint)
             values ('Both', 'https://example.test/both', 'whsec_both', 'both')
             returning id`
        );
        const { rows: only } = await pool.query<{ id: string }>(
            `insert into webhook_endpoints (name, url, secret, secret_hint)
             values ('Only', 'https://example.test/only', 'whsec_only', 'only')
             returning id`
        );
        await pool.query(
            `insert into webhook_endpoint_workspaces (endpoint_id, workspace_id)
             values ($1, $2), ($1, $3), ($4, $2)`,
            [both[0].id, doomedId, keeperId, only[0].id]
        );

        await agent.delete(`/api/workspaces/${doomedId}`).expect(204);

        // The opposite treatment from `segments.workspace_ids` above, and for
        // a reason that is in the schema rather than in taste: an endpoint's
        // `all_workspaces` is a separate boolean, so an empty set means "none"
        // and pruning can only narrow. An audience has no such flag, so the
        // same prune would widen.
        const subscribed = async (endpointId: string): Promise<string[]> => {
            const { rows } = await pool.query<{ workspaceId: string }>(
                `select workspace_id as "workspaceId"
                   from webhook_endpoint_workspaces where endpoint_id = $1`,
                [endpointId]
            );
            return rows.map((row) => row.workspaceId);
        };
        expect(await subscribed(both[0].id)).toEqual([keeperId]);
        expect(await subscribed(only[0].id)).toEqual([]);

        // Both endpoints survive: they hold a URL and a signing secret a
        // person configured, and neither is about the deleted workspace.
        const { rows: surviving } = await pool.query<{ count: string }>(
            `select count(*)::text as count from webhook_endpoints
              where id in ($1, $2) and enabled`,
            [both[0].id, only[0].id]
        );
        expect(surviving[0].count).toBe('2');
    });
});
