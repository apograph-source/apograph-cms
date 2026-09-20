import request from 'supertest';
import { getPool } from '@orthacms/database';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { TEST_ALLOWED_ORIGIN } from '../../support/test-config';
import { drainOutbox, getOutboxRows } from '../../support/outbox';
import {
    getActivityRows,
    resetDb,
    seedActiveUser,
    seedAllContentGrants,
    seedMembership,
    seedWorkspace,
    type SeededUser,
    type SeededWorkspace
} from '../../support/seed';

const PASSWORD = 'SecurePass123!';
const ADMIN = 'activity-coverage-admin@example.com';

/**
 * **Which write paths reach the audit log** — the property an audit trail is
 * worth nothing without, and the one nothing asserted.
 *
 * An event kind with no entry in `FACET_MAPPERS` fails completely silently: the
 * dispatcher finds no subscriber, stamps the outbox row `dispatched_at`, and
 * the action is never recorded. Every assertion here is the pair — the mutation
 * raised an event **and** a row landed — because either half alone passes while
 * the log is empty.
 *
 * Also covers the two integrity properties the same mechanism rests on:
 * idempotency under redelivery (delivery is at-least-once, so this is the only
 * thing between a redelivery and a duplicated trail), and a mapper's refusal to
 * write a row whose subject it cannot name.
 */
describe('activity coverage — which write paths produce an audit row', () => {
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
            role: 'admin',
            name: 'Coverage Admin'
        });
        workspace = await seedWorkspace({
            name: 'Coverage',
            slug: 'coverage'
        });
        await seedMembership(admin.id, workspace.id);
        await seedAllContentGrants(workspace.id);
    });

    async function login(email = ADMIN) {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', workspace.id);
        return agent;
    }

    /** The audit rows of one kind, ignoring the `user.signed_in` login noise. */
    async function rowsOfKind(kind: string) {
        return (await getActivityRows()).filter((row) => row.kind === kind);
    }

    describe('media library', () => {
        it('audits a folder create, rename and delete', async () => {
            const agent = await login();

            const created = await agent
                .post('/api/media/folders')
                .send({ name: 'Campaign' })
                .expect(201);
            const folderId = created.body.id as string;

            await agent
                .patch(`/api/media/folders/${folderId}`)
                .send({ name: 'Campaign 2026' })
                .expect(200);
            await agent.delete(`/api/media/folders/${folderId}`).expect(204);

            // `toMatchObject`, not `toEqual`: the audit `meta` also carries the
            // producing workspace since the audit-trail rework, and this test is
            // about *which write paths produce a row* — pinning the whole meta
            // shape here duplicates `audit-event-mapping.spec.ts`, which owns it,
            // and goes stale the moment a producer adds a field.
            expect(await rowsOfKind('media.folder.created')).toMatchObject([
                {
                    kind: 'media.folder.created',
                    subjectType: 'media_folder',
                    subjectId: folderId,
                    actorId: admin.id,
                    actorEmail: ADMIN,
                    meta: { name: 'Campaign', parentId: null }
                }
            ]);
            expect(await rowsOfKind('media.folder.renamed')).toMatchObject([
                { subjectId: folderId, meta: { name: 'Campaign 2026' } }
            ]);
            expect(await rowsOfKind('media.folder.deleted')).toMatchObject([
                { subjectType: 'media_folder', subjectId: folderId }
            ]);
        });

        it('audits an asset upload, edit, move and delete', async () => {
            const agent = await login();

            const folder = await agent
                .post('/api/media/folders')
                .send({ name: 'Shelf' })
                .expect(201);
            const folderId = folder.body.id as string;

            const uploaded = await agent
                .post('/api/media/assets')
                .attach('file', Buffer.from('hello'), {
                    filename: 'note.txt',
                    contentType: 'text/plain'
                })
                .expect(201);
            const assetId = uploaded.body.id as string;

            await agent
                .patch(`/api/media/assets/${assetId}`)
                .send({ alt: 'A note' })
                .expect(200);
            await agent
                .patch(`/api/media/assets/${assetId}`)
                .send({ folderId })
                .expect(200);
            await agent
                .delete('/api/media/assets')
                .send({ ids: [assetId] })
                .expect(200);

            expect(await rowsOfKind('media.asset.uploaded')).toMatchObject([
                {
                    subjectType: 'media_asset',
                    subjectId: assetId,
                    actorId: admin.id,
                    actorEmail: ADMIN,
                    meta: { name: 'note.txt' }
                }
            ]);
            expect(await rowsOfKind('media.asset.updated')).toMatchObject([
                { subjectId: assetId, meta: { alt: 'A note' } }
            ]);
            expect(await rowsOfKind('media.asset.moved')).toMatchObject([
                { subjectId: assetId, meta: { folderId } }
            ]);
            expect(await rowsOfKind('media.asset.deleted')).toMatchObject([
                { subjectType: 'media_asset', subjectId: assetId }
            ]);
        });

        it('never repeats the actor inside meta — it has two columns of its own', async () => {
            const agent = await login();
            await agent
                .post('/api/media/folders')
                .send({ name: 'Plain' })
                .expect(201);

            const [row] = await rowsOfKind('media.folder.created');
            expect(row.meta).not.toHaveProperty('actor');
            expect(row.actorId).toBe(admin.id);
        });
    });

    describe('content entries', () => {
        /** Create a draft `test_article` and return its id. */
        async function createArticle(agent: request.Agent): Promise<string> {
            const res = await agent
                .post('/api/content/test_article')
                .send({ values: { text: 'Draft one', select: 'article' } })
                .expect(201);
            return res.body.id as string;
        }

        it('audits a create, an edit, a soft delete and a restore', async () => {
            // Publishing was the ONLY content action that reached the log:
            // create, update, delete and restore raised no domain event at all,
            // so an editor could create, rewrite and trash every entry in the
            // product and the record of record stayed silent about the single
            // most frequent action in a CMS.
            const agent = await login();

            const id = await createArticle(agent);
            await agent
                .patch(`/api/content/test_article/${id}`)
                .send({ values: { text: 'Draft two', select: 'article' } })
                .expect(200);
            await agent.delete(`/api/content/test_article/${id}`).expect(204);
            await agent
                .post(`/api/content/test_article/${id}/restore`)
                .expect(201);

            // `toMatchObject` for the same reason as the media row above: the
            // entry's meta also carries its title now, and this suite asks which
            // paths audit, not what each producer packs into `meta`.
            expect(await rowsOfKind('entry.created')).toMatchObject([
                {
                    kind: 'entry.created',
                    subjectType: 'content_entry',
                    subjectId: id,
                    actorId: admin.id,
                    actorEmail: ADMIN,
                    meta: { contentType: 'test_article' }
                }
            ]);
            // The changed field names, not merely "something was saved" — the
            // `workspace.updated` shape, and what makes the row reviewable.
            expect(await rowsOfKind('entry.updated')).toMatchObject([
                {
                    subjectId: id,
                    actorId: admin.id,
                    meta: { contentType: 'test_article', fields: ['text'] }
                }
            ]);
            // `soft: true` — `test_article` is paranoid, so this one is a
            // tombstone the trash can undo rather than a row leaving the table.
            expect(await rowsOfKind('entry.deleted')).toMatchObject([
                {
                    subjectId: id,
                    meta: { contentType: 'test_article', soft: true }
                }
            ]);
            expect(await rowsOfKind('entry.restored')).toMatchObject([
                { subjectId: id, meta: { contentType: 'test_article' } }
            ]);
        });

        it('records a permanent delete under its own kind', async () => {
            // The one content action with nothing left behind to inspect
            // afterwards, so the audit row is the only remaining record of it.
            const agent = await login();
            const id = await createArticle(agent);
            await agent.delete(`/api/content/test_article/${id}`).expect(204);
            await agent
                .delete(`/api/content/test_article/${id}/permanent`)
                .expect(204);

            expect(await rowsOfKind('entry.purged')).toMatchObject([
                { subjectType: 'content_entry', subjectId: id }
            ]);
        });

        it('says nothing when a save changed no value [content:I-14]', async () => {
            // A re-submitted editor is a round trip, not an editorial change,
            // and the log is read by people. This is also what bounds the
            // volume of `entry.updated` without inventing a coalescing window.
            const agent = await login();
            const id = await createArticle(agent);
            await agent
                .patch(`/api/content/test_article/${id}`)
                .send({ values: { text: 'Draft one', select: 'article' } })
                .expect(200);

            expect(await rowsOfKind('entry.updated')).toEqual([]);
        });

        it('audits a bulk delete once per row it actually removed', async () => {
            // Batching is a way of asking, not a second set of rules — and the
            // count follows the rows, not the ids the caller listed.
            const agent = await login();
            const first = await createArticle(agent);
            const second = await createArticle(agent);

            await agent
                .post('/api/content/test_article/bulk/delete')
                .send({ ids: [first, second] })
                .expect(200);

            const deleted = await rowsOfKind('entry.deleted');
            expect(deleted.map((row) => row.subjectId).sort()).toEqual(
                [first, second].sort()
            );
            expect(deleted.every((row) => row.actorId === admin.id)).toBe(true);
        });

        it('writes the event in the same transaction as the entry [content:I-13]', async () => {
            // The rule the whole outbox exists for: a rejected write leaves no
            // event behind claiming it happened.
            //
            // The rejection has to be one that reaches *inside* the write
            // transaction, which rules out a bad `values` bag: `test_article`
            // is publishable, so a create is a draft and a draft is not
            // validated at all (`content-entries-write` pins that — required
            // means required *to publish*). The unique (group, locale) index
            // is such a rejection: a second `de` sibling fails on the INSERT
            // itself, so the whole transaction — row, revision and outbox row
            // alike — rolls back.
            const agent = await login();
            const source = await agent
                .post('/api/content/test_article')
                .send({ values: { text: 'Draft one', select: 'article' } })
                .expect(201);

            const sibling = {
                values: { text: 'Entwurf eins', select: 'article' },
                locale: 'de',
                localeGroupId: source.body.localeGroupId as string
            };
            await agent
                .post('/api/content/test_article')
                .send(sibling)
                .expect(201);

            const before = await rowsOfKind('entry.created');
            await agent
                .post('/api/content/test_article')
                .send(sibling)
                .expect(409);

            expect(await rowsOfKind('entry.created')).toEqual(before);
        });
    });

    describe('invite acceptance', () => {
        it('records the activation as well as the sign-in', async () => {
            const agent = await login();
            const invited = await agent
                .post('/api/users/invites')
                .send({
                    email: 'coverage-invitee@example.com',
                    name: 'Invitee',
                    role: 'contributor'
                })
                .expect(201);

            await request(harness.server)
                .post('/api/auth/invite/accept')
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({
                    token: invited.body.inviteToken,
                    password: PASSWORD,
                    confirmPassword: PASSWORD
                })
                .expect(201);

            // Both events ride one `outbox.append`, so a subscriber that maps
            // only the sign-in leaves the account's own state change unaudited.
            const kinds = (await getOutboxRows(invited.body.id)).map(
                (row) => row.kind
            );
            expect(kinds).toEqual(
                expect.arrayContaining(['user.activated', 'auth.signed_in'])
            );

            expect(await rowsOfKind('user.activated')).toMatchObject([
                {
                    subjectType: 'user',
                    subjectId: invited.body.id,
                    actorId: invited.body.id,
                    actorEmail: 'coverage-invitee@example.com',
                    meta: null
                }
            ]);
            expect(await rowsOfKind('user.signed_in')).toHaveLength(2);
        });
    });

    describe('idempotency under redelivery', () => {
        it('a re-delivered event does not double-record [activity:I-03]', async () => {
            const agent = await login();
            const invited = await agent
                .post('/api/users/invites')
                .send({
                    email: 'coverage-idem@example.com',
                    name: 'Idem',
                    role: 'viewer'
                })
                .expect(201);

            expect(await rowsOfKind('user.invited')).toHaveLength(1);

            // Delivery is at-least-once, so this is the contract, not a corner
            // case. Un-stamp the row and let the dispatcher hand it over again.
            await getPool().query(
                `UPDATE outbox_events SET dispatched_at = NULL
                 WHERE aggregate_id = $1 AND kind = 'member.invited'`,
                [invited.body.id]
            );
            await drainOutbox(harness.app);
            await drainOutbox(harness.app);

            expect(await rowsOfKind('user.invited')).toHaveLength(1);
            const [outboxRow] = (await getOutboxRows(invited.body.id)).filter(
                (row) => row.kind === 'member.invited'
            );
            // Redelivery succeeded, so it is stamped again and never retried.
            expect(outboxRow.dispatchedAt).not.toBeNull();
            expect(outboxRow.attempts).toBe(0);
        });
    });

    describe('a kind no mapper claims', () => {
        /**
         * **The silent half of `FACET_MAPPERS`.**
         *
         * Every other case in this file asserts the pair "a mutation raised an
         * event and a row landed". This is the opposite pair, and it is the one
         * that decides whether an unmapped kind is *ignored* or *stuck*: the
         * dispatcher finds no subscriber for it, stamps the row delivered and
         * moves on. Get that wrong — a subscriber that threw on an unknown
         * kind, or a `subscribesTo` that claimed everything — and the row is
         * retried fifteen times and parked instead. Because the claim is
         * `ORDER BY occurred_at LIMIT 100`, a batch of such rows then sits at
         * the head of the queue and no *later* event is ever delivered again:
         * one unmapped kind takes the whole audit trail down behind it.
         *
         * A real deployment reaches this state the ordinary way — a plugin
         * publishing an event kind the activity plugin has never heard of — so
         * the row is written by hand because that is the only way to have a
         * kind that is genuinely unmapped today.
         */
        it('stamps an unmapped kind delivered and records nothing [activity:I-10]', async () => {
            const before = await getActivityRows();
            const eventId = '66666666-6666-4666-8666-666666666666';
            await getPool().query(
                `INSERT INTO outbox_events
                    (id, kind, aggregate_type, aggregate_id, payload,
                     occurred_at, dispatched_at, attempts)
                 VALUES ($1, 'sprocket.reticulated', 'sprocket', $2, $3,
                         now(), NULL, 0)`,
                [
                    eventId,
                    workspace.id,
                    JSON.stringify({
                        actor: { id: admin.id, email: ADMIN },
                        splines: 12
                    })
                ]
            );

            // The real dispatcher, with the real subscriber set behind it —
            // not a hand-rolled loop, which would be a second implementation
            // of the very dispatch rule under test.
            await drainOutbox(harness.app);

            const [row] = (await getOutboxRows(workspace.id)).filter(
                (each) => each.id === eventId
            );
            expect(row.dispatchedAt).not.toBeNull();
            expect(row.attempts).toBe(0);

            // And nothing reached the log. Not "no row of that kind" — no row
            // at all beyond what was already there, so a mapper that fell back
            // to writing the raw kind through would fail here too.
            expect(await getActivityRows()).toEqual(before);
        });
    });

    describe('a subject the mapper cannot name', () => {
        it('parks the event instead of writing an empty-string subject [activity:I-06]', async () => {
            const eventId = '77777777-7777-4777-8777-777777777777';
            // A membership event whose subject is the affected user, with no
            // `userId`. `subject_id` is `text NOT NULL`, so `''` would insert
            // cleanly and produce a row no client can attribute to anyone.
            await getPool().query(
                `INSERT INTO outbox_events
                    (id, kind, aggregate_type, aggregate_id, payload,
                     occurred_at, dispatched_at, attempts)
                 VALUES ($1, 'workspace.member_added', 'workspace', $2, $3,
                         now(), NULL, 0)`,
                [
                    eventId,
                    workspace.id,
                    JSON.stringify({
                        email: 'ghost@example.com',
                        actor: { id: admin.id, email: ADMIN }
                    })
                ]
            );

            await drainOutbox(harness.app);

            expect(await rowsOfKind('workspace.member_added')).toEqual([]);
            const [row] = (await getOutboxRows(workspace.id)).filter(
                (each) => each.id === eventId
            );
            // Undispatched with a bumped attempt count: retried with backoff,
            // then parked for the dead-letter query. Loud, not silent.
            expect(row.dispatchedAt).toBeNull();
            expect(row.attempts).toBe(1);
        });

        it('still records a membership event that does name its subject', async () => {
            const agent = await login();
            const member = await seedActiveUser(harness.app, {
                email: 'coverage-member@example.com',
                password: PASSWORD,
                role: 'contributor'
            });

            await agent
                .post(`/api/workspaces/${workspace.id}/members`)
                .send({ userId: member.id })
                .expect(201);

            expect(await rowsOfKind('workspace.member_added')).toMatchObject([
                { subjectType: 'user', subjectId: member.id }
            ]);
        });
    });

    describe('the log has no write surface', () => {
        it('rejects every verb but GET on /api/activity [activity:I-01]', async () => {
            const agent = await login();
            for (const verb of ['post', 'put', 'patch', 'delete'] as const) {
                const res = await agent[verb]('/api/activity').set(
                    'Origin',
                    TEST_ALLOWED_ORIGIN
                );
                // Nothing in the app routes a write here, so the router 404s.
                expect(res.status).toBe(404);
            }
            await agent.get('/api/activity').expect(200);
        });
    });
});
