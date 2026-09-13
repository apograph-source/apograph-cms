import request from 'supertest';
import { getPool } from '@apograph/database';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    resetDb,
    seedActiveUser,
    seedContentGrants,
    seedMembership,
    seedWorkspace,
    type SeededUser,
    type SeededWorkspace
} from '../../support/seed';

const ADMIN = 'revision-actor-admin@example.com';
const PASSWORD = 'SecurePass123!';
const TOKEN_NAME = 'CI pipeline';

/**
 * **The audit trail may name a credential; a version's authorship may not.**
 *
 * The two paths take the same `EventActor` and read it differently.
 * `EntryWriterService.emit` hands the whole principal to the outbox, so
 * `activity_events` can record `actor_type = 'api_token'` and say honestly which
 * credential made the write — before that column existed, every write over the
 * public REST API, GraphQL and MCP was logged as "System". `revisionActorId`
 * takes the same actor and yields a **user id or nothing**, because
 * `content_entry_revisions.created_by` really does mean a `users` row: a token
 * id there would make the version history resolve every entry to a person who
 * does not exist.
 *
 * `revisionActorId` is the entire guard, and nothing exercised it. Deleting it —
 * passing `actor?.id` through to both — is a one-character change that no test
 * noticed, and the damage is silent and permanent: a revision row keeps a
 * dangling uuid forever, and the version history quietly attributes machine
 * writes to a nonexistent editor.
 */
describe('Revision authorship vs audit actor (a token is not a user)', () => {
    let harness: TestApp;
    let admin: SeededUser;
    let workspace: SeededWorkspace;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        admin = await seedActiveUser(harness.app, {
            email: ADMIN,
            password: PASSWORD,
            role: 'admin'
        });
        workspace = await seedWorkspace({ name: 'Press', slug: 'press' });
        await seedMembership(admin.id, workspace.id);
        await seedContentGrants(workspace.id, ['test_article']);
    });

    async function login() {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email: ADMIN, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', workspace.id);
        return agent;
    }

    /** Mint a write-scoped token through the real management API. */
    async function mintToken(): Promise<{ id: string; secret: string }> {
        const agent = await login();
        const res = await agent
            .post('/api/api-tokens')
            .send({
                name: TOKEN_NAME,
                workspaceIds: [workspace.id],
                scope: 'full'
            })
            .expect(201);
        return { id: res.body.id as string, secret: res.body.secret as string };
    }

    /** Every revision written for one entry, oldest first. */
    async function revisionsOf(
        entryId: string
    ): Promise<{ createdBy: string | null; revisionNumber: number }[]> {
        const { rows } = await getPool().query(
            `SELECT created_by AS "createdBy",
                    revision_number AS "revisionNumber"
             FROM content_entry_revisions
             WHERE entry_id = $1
             ORDER BY revision_number`,
            [entryId]
        );
        return rows;
    }

    /** The audit rows recorded for one entry, with the actor columns. */
    async function auditOf(entryId: string): Promise<
        {
            kind: string;
            actorId: string | null;
            actorType: string | null;
            actorEmail: string | null;
        }[]
    > {
        const { rows } = await getPool().query(
            `SELECT kind, actor_id AS "actorId", actor_type AS "actorType",
                    actor_email AS "actorEmail"
             FROM activity_events
             WHERE subject_type = 'content_entry' AND subject_id = $1
             ORDER BY at, id`,
            [entryId]
        );
        return rows;
    }

    it('writes the user’s id to a revision when a person saves [activity:I-32]', async () => {
        // The control. Without it "created_by is null" proves nothing — a writer
        // that never filled the column at all would pass the token case below.
        const agent = await login();
        const created = await agent
            .post('/api/content/test_article')
            .send({ values: { text: 'By a person', select: 'article' } })
            .expect(201);
        const entryId = created.body.id as string;

        const revisions = await revisionsOf(entryId);
        expect(revisions.length).toBeGreaterThan(0);
        for (const revision of revisions) {
            expect(revision.createdBy).toBe(admin.id);
        }

        expect(await auditOf(entryId)).toMatchObject([
            { kind: 'entry.created', actorId: admin.id, actorEmail: ADMIN }
        ]);
    });

    it('leaves a revision unattributed when a token saves, while the log names the token [activity:I-32]', async () => {
        const token = await mintToken();
        expect(token.id).toEqual(expect.any(String));

        const created = await request(harness.server)
            .post('/api/v1/content/test_article')
            .set('Authorization', `Bearer ${token.secret}`)
            .send({ values: { text: 'By a machine', select: 'article' } })
            .expect(201);
        const entryId = created.body.id as string;

        // The version exists — the write really did go through the same writer —
        // and its authorship column is empty rather than holding a uuid that
        // resolves to nothing.
        const revisions = await revisionsOf(entryId);
        expect(revisions.length).toBeGreaterThan(0);
        for (const revision of revisions) {
            expect(revision.createdBy).toBeNull();
        }
        expect(revisions.map((row) => row.createdBy)).not.toContain(token.id);

        // And the same actor, read the other way, does name the credential: the
        // point is the split, not that tokens are anonymous. `actor_type` is what
        // tells a reader the id is a token rather than a person, and the email
        // column carries the token's label because a credential has no address.
        const audit = await auditOf(entryId);
        expect(audit).toMatchObject([
            {
                kind: 'entry.created',
                actorId: token.id,
                actorType: 'api_token',
                actorEmail: TOKEN_NAME
            }
        ]);

        // The minting admin is not the actor: attributing an integration's
        // writes to whoever created its credential names a person for every
        // request a machine makes.
        expect(audit[0].actorId).not.toBe(admin.id);
    });

    it('keeps a token out of created_by on an update as well as a create [activity:I-32]', async () => {
        // Two call sites read `revisionActorId` — the create path and the update
        // path — so a guard restored on one and not the other still corrupts
        // every subsequent version.
        const token = await mintToken();
        const created = await request(harness.server)
            .post('/api/v1/content/test_article')
            .set('Authorization', `Bearer ${token.secret}`)
            .send({ values: { text: 'First', select: 'article' } })
            .expect(201);
        const entryId = created.body.id as string;

        await request(harness.server)
            .patch(`/api/v1/content/test_article/${entryId}`)
            .set('Authorization', `Bearer ${token.secret}`)
            .send({ values: { text: 'Second' } })
            .expect(200);

        const revisions = await revisionsOf(entryId);
        expect(revisions.length).toBeGreaterThan(1);
        for (const revision of revisions) {
            expect(revision.createdBy).toBeNull();
        }
    });
});
