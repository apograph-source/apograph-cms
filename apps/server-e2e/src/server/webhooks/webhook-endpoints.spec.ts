import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { TEST_ALLOWED_ORIGIN } from '../../support/test-config';
import { resetDb, seedActiveUser, seedWorkspace } from '../../support/seed';
import { webhookEndpoints } from '../../support/webhooks';

const ADMIN_EMAIL = 'webhook-endpoints-admin@example.com';
const CONTRIBUTOR_EMAIL = 'webhook-endpoints-contributor@example.com';
const STRICT_ADMIN_EMAIL = 'webhook-strict-admin@example.com';
const PASSWORD = 'SecurePass123!';

let harness: TestApp;

beforeAll(async () => {
    harness = await createTestApp();
});

afterAll(async () => {
    await closeTestApp(harness);
});

/** Signs in and returns an agent carrying the session cookie. */
async function signIn(email: string) {
    const agent = request.agent(harness.server);
    await agent
        .post('/api/auth/login')
        .send({ email, password: PASSWORD })
        .expect(201);
    return agent;
}

describe('Webhook endpoints API', () => {
    let admin: request.Agent;

    beforeEach(async () => {
        await resetDb();
        await seedActiveUser(harness.app, {
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
        admin = await signIn(ADMIN_EMAIL);
    });

    describe('creating one', () => {
        it('returns the endpoint and its secret, once', async () => {
            const { body } = await admin
                .post('/api/webhooks')
                .send({
                    name: 'Storefront',
                    url: 'https://example.com/hooks'
                })
                .expect(201);

            expect(body.secret).toMatch(/^whsec_/);
            expect(body.endpoint).toMatchObject({
                name: 'Storefront',
                url: 'https://example.com/hooks',
                enabled: true,
                // Every filter defaults to "everything", including things that
                // do not exist yet — an omitted filter is unfiltered, not empty.
                eventKinds: [],
                contentTypes: [],
                allWorkspaces: false,
                workspaceIds: [],
                lastDelivery: null
            });
            expect(body.endpoint.secretHint).toBe(body.secret.slice(-4));
        });

        it('never returns the secret again [webhooks:I-09]', async () => {
            const { body: created } = await admin
                .post('/api/webhooks')
                .send({ name: 'S', url: 'https://example.com/hooks' })
                .expect(201);

            const { body: list } = await admin.get('/api/webhooks').expect(200);
            const { body: one } = await admin
                .get(`/api/webhooks/${created.endpoint.id}`)
                .expect(200);

            // Asserted as an exact key set: a secret leaking back through a read
            // route would be invisible to a `toMatchObject`.
            expect(Object.keys(one)).not.toContain('secret');
            expect(JSON.stringify(list)).not.toContain(created.secret);
        });

        it('stores the workspace set it was given', async () => {
            const workspace = await seedWorkspace({
                name: 'Marketing',
                slug: 'marketing'
            });

            const { body } = await admin
                .post('/api/webhooks')
                .send({
                    name: 'Scoped',
                    url: 'https://example.com/hooks',
                    workspaceIds: [workspace.id],
                    eventKinds: ['entry.published'],
                    contentTypes: ['test_article']
                })
                .expect(201);

            expect(body.endpoint).toMatchObject({
                workspaceIds: [workspace.id],
                eventKinds: ['entry.published'],
                contentTypes: ['test_article']
            });
        });

        it('drops a named workspace set when it takes them all', async () => {
            const workspace = await seedWorkspace({
                name: 'Marketing',
                slug: 'marketing'
            });

            const { body } = await admin
                .post('/api/webhooks')
                .send({
                    name: 'Everything',
                    url: 'https://example.com/hooks',
                    allWorkspaces: true,
                    workspaceIds: [workspace.id]
                })
                .expect(201);

            // Keeping both would leave two answers to "which workspaces?" that
            // could drift apart the moment one of them is edited.
            expect(body.endpoint.allWorkspaces).toBe(true);
            expect(body.endpoint.workspaceIds).toEqual([]);
        });
    });

    describe('the URL policy', () => {
        it.each([
            ['https://user:pw@example.com/hooks', 'credentials in the URL'],
            ['ftp://example.com/hooks', 'a scheme that is not HTTP']
        ])('refuses %s (%s) with a message for the form', async (url) => {
            const { body } = await admin
                .post('/api/webhooks')
                .send({ name: 'Bad', url })
                .expect(422);

            expect(body.message).toEqual(expect.any(String));
        });

        it('refuses a reserved header [webhooks:I-11]', async () => {
            await admin
                .post('/api/webhooks')
                .send({
                    name: 'Spoofer',
                    url: 'https://example.com/hooks',
                    // Setting this would let configuration claim a delivery was
                    // something it is not.
                    headers: { 'X-Orthacms-Event': 'entry.published' }
                })
                .expect(422);
        });
    });

    describe('validation', () => {
        const invalid: Array<[string, Record<string, unknown>]> = [
            ['a missing name', { url: 'https://example.com/h' }],
            ['a missing url', { name: 'x' }],
            [
                'an event kind that is not in the catalogue',
                {
                    name: 'x',
                    url: 'https://example.com/h',
                    eventKinds: ['entry.exploded']
                }
            ],
            [
                'a workspace id that is not a uuid',
                {
                    name: 'x',
                    url: 'https://example.com/h',
                    workspaceIds: ['not-a-uuid']
                }
            ],
            [
                // The global pipe is `forbidNonWhitelisted`, so a typo in a
                // field name is a 400 rather than a setting silently ignored.
                'an unknown field',
                { name: 'x', url: 'https://example.com/h', surprise: true }
            ]
        ];

        it.each(invalid)('rejects %s', async (_label, body) => {
            await admin.post('/api/webhooks').send(body).expect(400);
        });
    });

    describe('authorization', () => {
        it('refuses an anonymous caller', async () => {
            await request(harness.server).get('/api/webhooks').expect(401);
        });

        it('refuses a contributor, even for reads [webhooks:I-18]', async () => {
            await seedActiveUser(harness.app, {
                email: CONTRIBUTOR_EMAIL,
                password: PASSWORD,
                role: 'contributor'
            });
            const contributor = await signIn(CONTRIBUTOR_EMAIL);

            // Both keys are admin-only: an endpoint is not scoped to a
            // workspace and holds a signing secret, so even reading the list is
            // withheld — unlike `alarms:read`, which is about content an editor
            // is already working on.
            await contributor.get('/api/webhooks').expect(403);
            await contributor
                .post('/api/webhooks')
                .send({ name: 'x', url: 'https://example.com/h' })
                .expect(403);
        });

        it('refuses a write from a disallowed origin', async () => {
            await admin
                .post('/api/webhooks')
                .set('Origin', 'https://evil.example')
                .send({ name: 'x', url: 'https://example.com/h' })
                .expect(403);

            await admin
                .post('/api/webhooks')
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({ name: 'x', url: 'https://example.com/h' })
                .expect(201);
        });
    });

    describe('updating one', () => {
        let endpointId: string;

        beforeEach(async () => {
            const { body } = await admin
                .post('/api/webhooks')
                .send({ name: 'Original', url: 'https://example.com/hooks' })
                .expect(201);
            endpointId = body.endpoint.id;
        });

        it('replaces the configuration', async () => {
            const { body } = await admin
                .patch(`/api/webhooks/${endpointId}`)
                .send({
                    name: 'Renamed',
                    url: 'https://example.com/other',
                    eventKinds: ['entry.deleted'],
                    enabled: false
                })
                .expect(200);

            expect(body).toMatchObject({
                name: 'Renamed',
                url: 'https://example.com/other',
                eventKinds: ['entry.deleted'],
                enabled: false
            });
        });

        it('rotates the secret and returns the new one once [webhooks:I-09]', async () => {
            const { body: first } = await admin
                .post(`/api/webhooks/${endpointId}/secret`)
                .expect(201);
            const { body: second } = await admin
                .post(`/api/webhooks/${endpointId}/secret`)
                .expect(201);

            expect(first.secret).not.toBe(second.secret);
            expect(second.endpoint.secretHint).toBe(second.secret.slice(-4));
        });

        it('deletes it', async () => {
            await admin.delete(`/api/webhooks/${endpointId}`).expect(204);
            await admin.get(`/api/webhooks/${endpointId}`).expect(404);
        });

        it('answers 404 for an endpoint that does not exist', async () => {
            const missing = '00000000-0000-4000-8000-000000000000';
            await admin.get(`/api/webhooks/${missing}`).expect(404);
            await admin
                .patch(`/api/webhooks/${missing}`)
                .send({ name: 'x', url: 'https://example.com/h' })
                .expect(404);
            await admin.delete(`/api/webhooks/${missing}`).expect(404);
        });
    });

    /**
     * The failure counter, driven through the repository rather than through
     * twenty real dead deliveries.
     *
     * What is being pinned here is a **SQL statement**, not a decision the
     * worker makes: `recordFailure` increments the counter and flips `enabled`
     * in one `UPDATE`, so that two workers finishing failed deliveries at the
     * same instant cannot both read the old count and both conclude the
     * threshold is not reached yet. That race is only reachable by issuing the
     * calls concurrently against a real Postgres, which is what these do.
     */
    describe('the auto-disable counter', () => {
        let endpointId: string;
        let endpoints: ReturnType<typeof webhookEndpoints>;

        /** The endpoint as the API reports it — the shape the UI reads. */
        async function readBack() {
            const { body } = await admin
                .get(`/api/webhooks/${endpointId}`)
                .expect(200);
            return body as {
                enabled: boolean;
                disabledReason: string | null;
                consecutiveFailures: number;
            };
        }

        beforeEach(async () => {
            const { body } = await admin
                .post('/api/webhooks')
                .send({ name: 'Flaky', url: 'https://example.com/hooks' })
                .expect(201);
            endpointId = body.endpoint.id;
            endpoints = webhookEndpoints(harness.app);
        });

        it('cannot be stepped over by two workers at once [webhooks:I-13]', async () => {
            // Three failures arriving together against a threshold of three.
            // A read-then-test-then-write implementation would have all three
            // read `consecutive_failures = 0` before any of them wrote, land on
            // 1, and leave the endpoint switched **on** — which is the whole
            // failure mode the single statement exists to rule out. The row
            // lock serialises them, and each `+ 1` sees its predecessor.
            const flipped = await Promise.all([
                endpoints.recordFailure(endpointId, 3),
                endpoints.recordFailure(endpointId, 3),
                endpoints.recordFailure(endpointId, 3)
            ]);

            const after = await readBack();
            expect(after.consecutiveFailures).toBe(3);
            expect(after.enabled).toBe(false);
            expect(after.disabledReason).toContain('3 consecutive');

            // And exactly one of them is told it did the switching, so the
            // warning is logged once rather than three times or not at all.
            expect(flipped.filter(Boolean)).toHaveLength(1);
        });

        it('leaves the endpoint on until the threshold is actually reached', async () => {
            expect(await endpoints.recordFailure(endpointId, 3)).toBe(false);
            expect(await endpoints.recordFailure(endpointId, 3)).toBe(false);

            const after = await readBack();
            expect(after.enabled).toBe(true);
            expect(after.disabledReason).toBeNull();
            expect(after.consecutiveFailures).toBe(2);
        });

        it('is cleared when the endpoint is switched back on by hand [webhooks:I-14]', async () => {
            await endpoints.recordFailure(endpointId, 2);
            await endpoints.recordFailure(endpointId, 2);

            const disabled = await readBack();
            expect(disabled.enabled).toBe(false);
            expect(disabled.disabledReason).not.toBeNull();
            expect(disabled.consecutiveFailures).toBe(2);

            const { body: reEnabled } = await admin
                .patch(`/api/webhooks/${endpointId}`)
                .send({
                    name: 'Flaky',
                    url: 'https://example.com/hooks',
                    enabled: true
                })
                .expect(200);

            // Both, not just the switch. A reason left behind would go on
            // saying the endpoint was stopped after failures while it is
            // plainly running, and a count left behind would switch it off
            // again on the very next failure.
            expect(reEnabled).toMatchObject({
                enabled: true,
                disabledReason: null,
                consecutiveFailures: 0
            });
        });

        it('is left alone by a save that keeps the endpoint switched off', async () => {
            await endpoints.recordFailure(endpointId, 2);
            await endpoints.recordFailure(endpointId, 2);

            // The control for the test above: the clearing is conditional on
            // being re-enabled, so an implementation that simply zeroed the
            // pair on every write would pass that one and fail this.
            const { body: renamed } = await admin
                .patch(`/api/webhooks/${endpointId}`)
                .send({
                    name: 'Flaky (renamed)',
                    url: 'https://example.com/hooks',
                    enabled: false
                })
                .expect(200);

            expect(renamed).toMatchObject({
                name: 'Flaky (renamed)',
                enabled: false,
                consecutiveFailures: 2
            });
            expect(renamed.disabledReason).toContain('2 consecutive');
        });
    });

    describe('the event catalogue', () => {
        it('is served for the endpoint editor to build its picker from', async () => {
            const { body } = await admin.get('/api/webhook-events').expect(200);

            expect(body).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        kind: 'entry.published',
                        group: 'content',
                        scopedByContentType: true,
                        carriesWorkspace: true
                    })
                ])
            );
        });
    });
});

/**
 * The URL policy as a **deployment actually ships it**.
 *
 * The default harness relaxes both flags so the delivery suite can post to a
 * receiver on loopback — which means it cannot assert the refusals that matter
 * most. This boots a second app with the shipped policy, so what is covered here
 * is the configuration a real install runs.
 */
describe('Webhook endpoints API — the shipped URL policy [webhooks:I-10]', () => {
    let strict: TestApp;
    let admin: request.Agent;

    beforeAll(async () => {
        strict = await createTestApp({
            webhooks: { allowInsecureUrls: false, allowPrivateNetworks: false }
        });
    });

    afterAll(async () => {
        await closeTestApp(strict);
    });

    beforeEach(async () => {
        await resetDb();
        await seedActiveUser(strict.app, {
            email: STRICT_ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
        admin = request.agent(strict.server);
        await admin
            .post('/api/auth/login')
            .send({ email: STRICT_ADMIN_EMAIL, password: PASSWORD })
            .expect(201);
    });

    it.each([
        ['http://example.com/hooks', 'plain HTTP leaks the payload'],
        ['https://127.0.0.1/hooks', 'loopback is not a public host'],
        ['https://10.0.0.5/hooks', 'RFC 1918 is not a public host'],
        [
            'https://169.254.169.254/latest/meta-data/',
            'the cloud metadata endpoint is the SSRF everyone wants'
        ],
        ['https://[::1]/hooks', 'IPv6 loopback is loopback too']
    ])('refuses %s — %s', async (url) => {
        const { body } = await admin
            .post('/api/webhooks')
            .send({ name: 'Bad', url })
            .expect(422);

        expect(body.message).toEqual(expect.any(String));
    });

    it('still accepts an ordinary public https URL', async () => {
        await admin
            .post('/api/webhooks')
            .send({ name: 'Fine', url: 'https://example.com/hooks' })
            .expect(201);
    });
});
