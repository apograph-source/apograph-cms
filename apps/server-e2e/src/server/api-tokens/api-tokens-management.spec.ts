import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    drainOutbox,
    getOutboxRows,
    suspendOutboxDispatch
} from '../../support/outbox';
import { TEST_ALLOWED_ORIGIN } from '../../support/test-config';
import {
    archiveWorkspace,
    expireApiToken,
    getActivityRows,
    getApiTokenHash,
    resetDb,
    seedActiveUser,
    seedUserWithEmptyRole,
    seedUserWithPermissions,
    seedWorkspace
} from '../../support/seed';

const ADMIN_EMAIL = 'token-admin@example.com';
const NORIGHTS_EMAIL = 'token-norights@example.com';
const PASSWORD = 'SecurePass123!';

/**
 * `/api/api-tokens` — the SESSION-authenticated management API for external-API
 * bearer tokens. Covers minting (plaintext returned once), the multi-workspace
 * bucket, listing (never the secret), revoking, and the `tokens:*` permission
 * gate.
 */
describe('API token management (/api/api-tokens)', () => {
    let harness: TestApp;
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
        await seedActiveUser(harness.app, {
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
        workspaceId = (await seedWorkspace({ name: 'WS A', slug: 'ws-a' })).id;
        otherWorkspaceId = (await seedWorkspace({ name: 'WS B', slug: 'ws-b' }))
            .id;
    });

    /** Logs in and returns a cookie-bearing agent. */
    async function login(email: string) {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password: PASSWORD })
            .expect(201);
        return agent;
    }

    it('mints a token and returns the plaintext exactly once [api-tokens:I-01] [identity:I-10]', async () => {
        const agent = await login(ADMIN_EMAIL);
        const res = await agent
            .post('/api/api-tokens')
            .send({ name: 'CI', workspaceIds: [workspaceId], scope: 'read' })
            .expect(201);

        expect(res.body.secret).toEqual(expect.any(String));
        expect(res.body.secret.startsWith('orthacms_')).toBe(true);
        expect(res.body.scope).toBe('read');
        expect(res.body.workspaceIds).toEqual([workspaceId]);

        // The list never carries the secret — only the display prefix.
        const list = await agent.get('/api/api-tokens').expect(200);
        expect(list.body.total).toBe(1);
        const [item] = list.body.items;
        expect(item).not.toHaveProperty('secret');
        expect(item).not.toHaveProperty('tokenHash');
        expect(item.lookupPrefix).toEqual(expect.any(String));
    });

    it('mints a token spanning several workspaces', async () => {
        const agent = await login(ADMIN_EMAIL);
        const res = await agent
            .post('/api/api-tokens')
            .send({
                name: 'multi',
                workspaceIds: [workspaceId, otherWorkspaceId],
                scope: 'read'
            })
            .expect(201);

        expect(res.body.workspaceIds.sort()).toEqual(
            [workspaceId, otherWorkspaceId].sort()
        );

        const list = await agent.get('/api/api-tokens').expect(200);
        expect(list.body.items[0].workspaceIds.sort()).toEqual(
            [workspaceId, otherWorkspaceId].sort()
        );
    });

    it('collapses duplicate workspace ids [api-tokens:I-06]', async () => {
        const agent = await login(ADMIN_EMAIL);
        const res = await agent
            .post('/api/api-tokens')
            .send({
                name: 'dupes',
                workspaceIds: [workspaceId, workspaceId],
                scope: 'read'
            })
            .expect(201);

        expect(res.body.workspaceIds).toEqual([workspaceId]);
    });

    it('rejects an empty workspace bucket [api-tokens:I-05] [identity:I-18]', async () => {
        const agent = await login(ADMIN_EMAIL);
        await agent
            .post('/api/api-tokens')
            .send({ name: 'nowhere', workspaceIds: [], scope: 'read' })
            .expect(400);
    });

    it('rejects a bucket naming a workspace that does not exist [api-tokens:I-07] [identity:I-18]', async () => {
        // BUG-identity-server-06. `api_token_workspaces` carries no
        // cross-plugin foreign key, so a typo used to mint happily and leave a
        // row pointing at nothing — a token that reads as configured, grants
        // access to no content, and survives forever because no cascade will
        // ever reach it.
        const agent = await login(ADMIN_EMAIL);
        const phantom = '11111111-1111-4111-8111-111111111111';

        const res = await agent
            .post('/api/api-tokens')
            .send({
                name: 'phantom',
                workspaceIds: [phantom],
                scope: 'read'
            })
            .expect(400);
        expect(res.body.message).toContain(phantom);

        // Nothing was written — not the token, not the bucket row.
        expect(
            (await agent.get('/api/api-tokens').expect(200)).body.total
        ).toBe(0);
    });

    it('rejects a bucket that mixes real and phantom workspaces', async () => {
        // Partial validity is still invalid: minting the "real" half would
        // silently narrow a bucket the admin believed they had granted.
        const agent = await login(ADMIN_EMAIL);
        const phantom = '22222222-2222-4222-8222-222222222222';

        await agent
            .post('/api/api-tokens')
            .send({
                name: 'half-real',
                workspaceIds: [workspaceId, phantom],
                scope: 'read'
            })
            .expect(400);

        expect(
            (await agent.get('/api/api-tokens').expect(200)).body.total
        ).toBe(0);
    });

    it('still accepts an archived workspace — existence, not status [api-tokens:I-08]', async () => {
        const agent = await login(ADMIN_EMAIL);
        await archiveWorkspace(workspaceId);

        await agent
            .post('/api/api-tokens')
            .send({
                name: 'archived-ok',
                workspaceIds: [workspaceId],
                scope: 'read'
            })
            .expect(201);
    });

    it('lists a multi-workspace token under each of its workspaces [api-tokens:I-20]', async () => {
        const agent = await login(ADMIN_EMAIL);
        await agent
            .post('/api/api-tokens')
            .send({
                name: 'multi',
                workspaceIds: [workspaceId, otherWorkspaceId],
                scope: 'read'
            })
            .expect(201);
        await agent
            .post('/api/api-tokens')
            .send({ name: 'solo', workspaceIds: [workspaceId], scope: 'read' })
            .expect(201);

        // Filtering by a workspace is a bucket-membership test — the
        // multi-workspace token appears under both, exactly once each.
        const first = await agent
            .get('/api/api-tokens')
            .query({ workspaceId })
            .expect(200);
        expect(first.body.total).toBe(2);

        const second = await agent
            .get('/api/api-tokens')
            .query({ workspaceId: otherWorkspaceId })
            .expect(200);
        expect(second.body.total).toBe(1);
        expect(second.body.items[0].name).toBe('multi');
    });

    it('revokes a token', async () => {
        const agent = await login(ADMIN_EMAIL);
        const created = await agent
            .post('/api/api-tokens')
            .send({ name: 'temp', workspaceIds: [workspaceId], scope: 'full' })
            .expect(201);

        await agent.delete(`/api/api-tokens/${created.body.id}`).expect(204);

        const list = await agent.get('/api/api-tokens').expect(200);
        const [item] = list.body.items;
        // `revokedAt` is the wire signal; the admin derives its
        // active/expired/revoked badge from it (the view carries no `status`).
        expect(item.revokedAt).not.toBeNull();
    });

    it('gates management on the tokens permissions [api-tokens:I-14] [identity:I-19]', async () => {
        await seedUserWithEmptyRole(harness.app, {
            email: NORIGHTS_EMAIL,
            password: PASSWORD,
            roleKey: 'token-mgmt-norights'
        });
        const agent = await login(NORIGHTS_EMAIL);

        await agent.get('/api/api-tokens').expect(403);
        await agent
            .post('/api/api-tokens')
            .send({ name: 'nope', workspaceIds: [workspaceId], scope: 'read' })
            .expect(403);
    });

    it('requires authentication', async () => {
        await request(harness.server).get('/api/api-tokens').expect(401);
    });

    describe('list pagination', () => {
        /** Mints `count` tokens so the page arithmetic has something to slice. */
        async function mint(agent: request.Agent, count: number) {
            for (let i = 0; i < count; i++) {
                await agent
                    .post('/api/api-tokens')
                    .send({
                        name: `token-${i}`,
                        workspaceIds: [workspaceId],
                        scope: 'read'
                    })
                    .expect(201);
            }
        }

        it('returns an empty first page with a real total when there is nothing', async () => {
            const agent = await login(ADMIN_EMAIL);
            const res = await agent.get('/api/api-tokens').expect(200);
            expect(res.body).toMatchObject({
                items: [],
                total: 0,
                page: 1,
                pageSize: 25
            });
        });

        it('returns an empty page past the last one, still with the real total', async () => {
            // Not a 404: the page is simply beyond the data, and the caller
            // needs `total` to work out where the data ended.
            const agent = await login(ADMIN_EMAIL);
            await mint(agent, 3);

            const res = await agent
                .get('/api/api-tokens')
                .query({ page: 99999 })
                .expect(200);
            expect(res.body.items).toEqual([]);
            expect(res.body.total).toBe(3);
        });

        it('accepts the maximum page size and rejects one past it', async () => {
            const agent = await login(ADMIN_EMAIL);
            await agent
                .get('/api/api-tokens')
                .query({ pageSize: 100 })
                .expect(200);
            await agent
                .get('/api/api-tokens')
                .query({ pageSize: 101 })
                .expect(400);
        });

        it('rejects a zero or negative page', async () => {
            const agent = await login(ADMIN_EMAIL);
            await agent.get('/api/api-tokens').query({ page: 0 }).expect(400);
            await agent.get('/api/api-tokens').query({ page: -1 }).expect(400);
        });

        it('rejects a non-uuid workspace filter', async () => {
            const agent = await login(ADMIN_EMAIL);
            await agent
                .get('/api/api-tokens')
                .query({ workspaceId: 'not-a-uuid' })
                .expect(400);
        });

        it('pages without dropping or repeating a token', async () => {
            const agent = await login(ADMIN_EMAIL);
            await mint(agent, 5);

            const first = await agent
                .get('/api/api-tokens')
                .query({ page: 1, pageSize: 2 })
                .expect(200);
            const second = await agent
                .get('/api/api-tokens')
                .query({ page: 2, pageSize: 2 })
                .expect(200);
            const third = await agent
                .get('/api/api-tokens')
                .query({ page: 3, pageSize: 2 })
                .expect(200);

            const ids = [
                ...first.body.items,
                ...second.body.items,
                ...third.body.items
            ].map((item: { id: string }) => item.id);
            expect(ids).toHaveLength(5);
            expect(new Set(ids).size).toBe(5);
            expect(first.body.total).toBe(5);
        });
    });

    describe('secrets at rest', () => {
        it('stores the SHA-256 of the secret, never the secret [api-tokens:I-02] [identity:I-09]', async () => {
            const agent = await login(ADMIN_EMAIL);
            const created = await agent
                .post('/api/api-tokens')
                .send({
                    name: 'CI',
                    workspaceIds: [workspaceId],
                    scope: 'read'
                })
                .expect(201);

            const stored = await getApiTokenHash(created.body.id);
            expect(stored).toBe(
                createHash('sha256').update(created.body.secret).digest('hex')
            );
            expect(stored).not.toBe(created.body.secret);
            expect(stored).toMatch(/^[0-9a-f]{64}$/);
            // The display prefix is the non-secret handle, and it is only a
            // prefix — it must not be enough to reconstruct the token.
            expect(
                created.body.secret.startsWith(created.body.lookupPrefix)
            ).toBe(true);
            expect(created.body.lookupPrefix.length).toBeLessThan(
                created.body.secret.length
            );
        });

        it('round-trips a name with RTL and multibyte characters intact', async () => {
            const agent = await login(ADMIN_EMAIL);
            const name = 'مرحبا é 🔑';
            const created = await agent
                .post('/api/api-tokens')
                .send({ name, workspaceIds: [workspaceId], scope: 'read' })
                .expect(201);
            expect(created.body.name).toBe(name);

            const list = await agent.get('/api/api-tokens').expect(200);
            expect(list.body.items[0].name).toBe(name);
        });
    });

    describe('audit trail', () => {
        /** Every `token.*` audit row currently in the log. */
        async function tokenAudit() {
            const rows = await getActivityRows();
            return rows.filter((row) => row.kind.startsWith('token.'));
        }

        it('records token.created when a token is minted [api-tokens:I-13]', async () => {
            // BUG-identity-server-01: minting and revoking wrote nothing at
            // all, so the log could not answer "who issued this credential,
            // when, and scoped to what" — for a long-lived key to workspace
            // content.
            const agent = await login(ADMIN_EMAIL);
            const created = await agent
                .post('/api/api-tokens')
                .send({
                    name: 'CI',
                    workspaceIds: [workspaceId, otherWorkspaceId],
                    scope: 'read'
                })
                .expect(201);

            const rows = await tokenAudit();
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                kind: 'token.created',
                subjectType: 'api_token',
                subjectId: created.body.id,
                actorEmail: ADMIN_EMAIL
            });
            expect(rows[0].meta).toMatchObject({
                name: 'CI',
                scope: 'read',
                lookupPrefix: created.body.lookupPrefix
            });
            expect(
                (rows[0].meta as { workspaceIds: string[] }).workspaceIds.sort()
            ).toEqual([workspaceId, otherWorkspaceId].sort());
        });

        it('never writes the secret or its hash into the log [api-tokens:I-01] [api-tokens:I-13] [identity:I-10]', async () => {
            const agent = await login(ADMIN_EMAIL);
            const created = await agent
                .post('/api/api-tokens')
                .send({
                    name: 'CI',
                    workspaceIds: [workspaceId],
                    scope: 'full'
                })
                .expect(201);

            // `api_tokens` stores only a SHA-256 so a read of the table yields
            // nothing usable; the audit log must not become the second copy.
            const serialised = JSON.stringify(await tokenAudit());
            expect(serialised).not.toContain(created.body.secret);
            expect(serialised).not.toContain(
                createHash('sha256').update(created.body.secret).digest('hex')
            );
        });

        it('records token.revoked when a token is killed', async () => {
            const agent = await login(ADMIN_EMAIL);
            const created = await agent
                .post('/api/api-tokens')
                .send({
                    name: 'temp',
                    workspaceIds: [workspaceId],
                    scope: 'full'
                })
                .expect(201);

            await agent
                .delete(`/api/api-tokens/${created.body.id}`)
                .expect(204);

            const revoked = (await tokenAudit()).filter(
                (row) => row.kind === 'token.revoked'
            );
            expect(revoked).toHaveLength(1);
            expect(revoked[0]).toMatchObject({
                kind: 'token.revoked',
                subjectType: 'api_token',
                subjectId: created.body.id,
                actorEmail: ADMIN_EMAIL
            });
            expect(revoked[0].meta).toMatchObject({ name: 'temp' });
        });

        it('audits a replayed revoke once, not once per call [api-tokens:I-11]', async () => {
            // The route is idempotent — a second DELETE still 204s — but only
            // the call that actually revoked a live token is an event.
            const agent = await login(ADMIN_EMAIL);
            const created = await agent
                .post('/api/api-tokens')
                .send({
                    name: 'temp',
                    workspaceIds: [workspaceId],
                    scope: 'read'
                })
                .expect(201);

            await agent
                .delete(`/api/api-tokens/${created.body.id}`)
                .expect(204);
            await agent
                .delete(`/api/api-tokens/${created.body.id}`)
                .expect(204);

            expect(
                (await tokenAudit()).filter(
                    (row) => row.kind === 'token.revoked'
                )
            ).toHaveLength(1);
        });

        it('writes nothing when the revoked id is unknown', async () => {
            const agent = await login(ADMIN_EMAIL);
            await agent
                .delete('/api/api-tokens/11111111-1111-4111-8111-111111111111')
                .expect(204);

            expect(await tokenAudit()).toEqual([]);
        });

        it('writes no audit row when the mint is rejected [api-tokens:I-12]', async () => {
            // The event commits with the token or not at all: a rejected mint
            // must leave the log as clean as it leaves `api_tokens`.
            const agent = await login(ADMIN_EMAIL);
            await agent
                .post('/api/api-tokens')
                .send({ name: 'nowhere', workspaceIds: [], scope: 'read' })
                .expect(400);

            expect(await tokenAudit()).toEqual([]);
            expect(
                (await agent.get('/api/api-tokens').expect(200)).body.total
            ).toBe(0);
        });
    });

    /**
     * Every spelling of "when does this expire", pinned together — because the
     * bug was not in any one of them but in the gap between two.
     *
     * `expiresAt: null` used to be a 400 telling the caller to pick a future
     * date, while omitting the field minted a never-expiring token.
     * `@IsOptional()` skips the rest of the chain for `null` as well as
     * `undefined`, so an explicit `null` reached the controller's `parseExpiry`,
     * whose `=== undefined` guard let it fall through to `new Date(null)` — the
     * epoch, which is comfortably in the past. The admin UI never sends it, so
     * nothing here caught it; the field is `ApiPropertyOptional` in the
     * published OpenAPI, so an integrator serialising their whole form did.
     */
    describe('expiry', () => {
        it('treats an omitted and an explicitly null expiry the same [api-tokens:I-09]', async () => {
            const agent = await login(ADMIN_EMAIL);

            const omitted = await agent
                .post('/api/api-tokens')
                .send({
                    name: 'omitted',
                    workspaceIds: [workspaceId],
                    scope: 'read'
                })
                .expect(201);
            expect(omitted.body.expiresAt).toBeNull();

            const explicit = await agent
                .post('/api/api-tokens')
                .send({
                    name: 'explicit-null',
                    workspaceIds: [workspaceId],
                    scope: 'read',
                    expiresAt: null
                })
                .expect(201);
            expect(explicit.body.expiresAt).toBeNull();

            // Both are live, never-expiring tokens — the response field is not
            // just cosmetically null.
            const list = await agent.get('/api/api-tokens').expect(200);
            expect(list.body.total).toBe(2);
            expect(
                (list.body.items as { expiresAt: string | null }[]).map(
                    (item) => item.expiresAt
                )
            ).toEqual([null, null]);
        });

        it('rejects an expiry in the past [api-tokens:I-09]', async () => {
            const agent = await login(ADMIN_EMAIL);
            await agent
                .post('/api/api-tokens')
                .send({
                    name: 'stale',
                    workspaceIds: [workspaceId],
                    scope: 'read',
                    expiresAt: new Date(Date.now() - 60_000).toISOString()
                })
                .expect(400);
        });

        it('rejects an expiry that is not a timestamp [api-tokens:I-09]', async () => {
            // The DTO's `@IsISO8601` has to hold the line: `parseExpiry` only
            // compares against `Date.now()`, and `new Date('whenever')` is
            // `NaN`, which is neither greater nor less than anything — so a
            // string that slipped past validation would mint a token whose
            // expiry can never arrive.
            const agent = await login(ADMIN_EMAIL);
            await agent
                .post('/api/api-tokens')
                .send({
                    name: 'gibberish',
                    workspaceIds: [workspaceId],
                    scope: 'read',
                    expiresAt: 'whenever'
                })
                .expect(400);

            expect(
                (await agent.get('/api/api-tokens').expect(200)).body.total
            ).toBe(0);
        });

        it('accepts an expiry in the future and echoes it back', async () => {
            const agent = await login(ADMIN_EMAIL);
            const expiresAt = new Date(Date.now() + 86_400_000).toISOString();

            const created = await agent
                .post('/api/api-tokens')
                .send({
                    name: 'expiring',
                    workspaceIds: [workspaceId],
                    scope: 'read',
                    expiresAt
                })
                .expect(201);
            expect(new Date(created.body.expiresAt).toISOString()).toBe(
                expiresAt
            );

            // And it survives the round-trip through the column, which is the
            // half the create response cannot prove on its own.
            const list = await agent.get('/api/api-tokens').expect(200);
            expect(new Date(list.body.items[0].expiresAt).toISOString()).toBe(
                expiresAt
            );
        });
    });

    /**
     * The `OriginGuard` on the two mutating routes. Both are state-changing
     * admin routes reached with an ambient session cookie, which is exactly the
     * shape a cross-site POST exploits: a page on another origin can make the
     * browser send the request, cookie attached, and only the `Origin` header
     * tells the two apart.
     */
    describe('origin guard', () => {
        const HOSTILE_ORIGIN = 'https://evil.example.com';

        it('403s a create from a disallowed origin, and mints nothing', async () => {
            const agent = await login(ADMIN_EMAIL);
            await agent
                .post('/api/api-tokens')
                .set('Origin', HOSTILE_ORIGIN)
                .send({
                    name: 'csrf',
                    workspaceIds: [workspaceId],
                    scope: 'full'
                })
                .expect(403);

            expect(
                (await agent.get('/api/api-tokens').expect(200)).body.total
            ).toBe(0);
        });

        it('403s a revoke from a disallowed origin, and the token stays live', async () => {
            const agent = await login(ADMIN_EMAIL);
            const created = await agent
                .post('/api/api-tokens')
                .send({
                    name: 'victim',
                    workspaceIds: [workspaceId],
                    scope: 'read'
                })
                .expect(201);

            await agent
                .delete(`/api/api-tokens/${created.body.id}`)
                .set('Origin', HOSTILE_ORIGIN)
                .expect(403);

            // Refusing the request is only half of it: a revoke that half
            // happened would be an outage nobody asked for.
            const list = await agent.get('/api/api-tokens').expect(200);
            expect(list.body.items[0].revokedAt).toBeNull();
        });

        it('accepts both mutations from the allow-listed origin', async () => {
            // The control: the guard is refusing the origin, not the browser
            // header's mere presence.
            const agent = await login(ADMIN_EMAIL);
            const created = await agent
                .post('/api/api-tokens')
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({
                    name: 'from-the-admin',
                    workspaceIds: [workspaceId],
                    scope: 'read'
                })
                .expect(201);

            await agent
                .delete(`/api/api-tokens/${created.body.id}`)
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .expect(204);
        });
    });

    /**
     * The create DTO against the host's strict `ValidationPipe`
     * (`whitelist` + `forbidNonWhitelisted`). Each case breaks exactly one
     * field of an otherwise valid body, so a failure names the constraint that
     * moved rather than "the body is wrong somehow".
     */
    describe('create validation', () => {
        /** A valid create body, with the one field a case is about replaced. */
        function body(overrides: Record<string, unknown> = {}) {
            return {
                name: 'valid',
                workspaceIds: [workspaceId],
                scope: 'read',
                ...overrides
            };
        }

        it('rejects an unknown extra field', async () => {
            // `forbidNonWhitelisted` is what stops a client believing it set
            // something the server silently dropped — `scopes`, say, next to
            // `scope`.
            const agent = await login(ADMIN_EMAIL);
            await agent
                .post('/api/api-tokens')
                .send(body({ permissions: ['tokens:create'] }))
                .expect(400);

            expect(
                (await agent.get('/api/api-tokens').expect(200)).body.total
            ).toBe(0);
        });

        it('rejects a name past the 120-character cap but accepts one at it', async () => {
            const agent = await login(ADMIN_EMAIL);
            await agent
                .post('/api/api-tokens')
                .send(body({ name: 'x'.repeat(121) }))
                .expect(400);

            // The boundary itself is legal — an off-by-one in the cap would
            // otherwise read as "the rejection works".
            await agent
                .post('/api/api-tokens')
                .send(body({ name: 'x'.repeat(120) }))
                .expect(201);
        });

        it('rejects an empty name', async () => {
            const agent = await login(ADMIN_EMAIL);
            await agent
                .post('/api/api-tokens')
                .send(body({ name: '' }))
                .expect(400);
        });

        it('rejects a scope outside the two that exist', async () => {
            // `write` is the plausible wrong guess, and the one that must not
            // be silently coerced into anything.
            const agent = await login(ADMIN_EMAIL);
            await agent
                .post('/api/api-tokens')
                .send(body({ scope: 'write' }))
                .expect(400);
        });

        it('rejects a non-uuid inside the workspace bucket', async () => {
            const agent = await login(ADMIN_EMAIL);
            await agent
                .post('/api/api-tokens')
                .send(body({ workspaceIds: [workspaceId, 'not-a-uuid'] }))
                .expect(400);

            expect(
                (await agent.get('/api/api-tokens').expect(200)).body.total
            ).toBe(0);
        });

        it('rejects a bucket past the 100-workspace cap', async () => {
            // The cap bounds the insert one request can provoke. Random uuids,
            // so the rejection is the `ArrayMaxSize` and not the existence
            // check further in — the pipe runs first and must be what answers.
            const agent = await login(ADMIN_EMAIL);
            await agent
                .post('/api/api-tokens')
                .send({
                    name: 'too-wide',
                    workspaceIds: Array.from({ length: 101 }, () =>
                        randomUUID()
                    ),
                    scope: 'read'
                })
                .expect(400);
        });
    });

    /** The route surface either side of the handler: the pipe, and the guard. */
    describe('route surface', () => {
        it('rejects a non-uuid id on revoke', async () => {
            // `ParseUUIDPipe`, not the repository: revoke is idempotent and
            // answers 204 for an id it has never seen, so a malformed id that
            // reached the query would be indistinguishable from success.
            const agent = await login(ADMIN_EMAIL);
            await agent.delete('/api/api-tokens/not-a-uuid').expect(400);
        });

        it('401s an unauthenticated create, and mints nothing', async () => {
            await request(harness.server)
                .post('/api/api-tokens')
                .send({
                    name: 'anonymous',
                    workspaceIds: [workspaceId],
                    scope: 'full'
                })
                .expect(401);

            const agent = await login(ADMIN_EMAIL);
            expect(
                (await agent.get('/api/api-tokens').expect(200)).body.total
            ).toBe(0);
        });

        it('401s an unauthenticated revoke, and the token stays live', async () => {
            const agent = await login(ADMIN_EMAIL);
            const created = await agent
                .post('/api/api-tokens')
                .send({
                    name: 'victim',
                    workspaceIds: [workspaceId],
                    scope: 'read'
                })
                .expect(201);

            await request(harness.server)
                .delete(`/api/api-tokens/${created.body.id}`)
                .expect(401);

            const list = await agent.get('/api/api-tokens').expect(200);
            expect(list.body.items[0].revokedAt).toBeNull();
        });
    });

    /**
     * The three `tokens:*` permissions held apart.
     *
     * They exist as three because they are three different powers — seeing that
     * a credential exists, issuing one, and killing one — and a role granted
     * only the first must reach neither of the others. The existing gate test
     * uses a role with *no* permissions, which cannot tell "the guard reads the
     * required permission" from "the guard refuses everyone but an admin".
     */
    describe('permission separation', () => {
        const READER_EMAIL = 'token-reader@example.com';

        /** Seeds a non-admin holding exactly `permissions`, and logs them in. */
        async function loginAs(permissions: string[], roleKey: string) {
            await seedUserWithPermissions(harness.app, {
                email: READER_EMAIL,
                password: PASSWORD,
                roleKey,
                permissions
            });
            return login(READER_EMAIL);
        }

        /** Mints a token as the admin, for a lesser role to fail to revoke. */
        async function adminMintedToken() {
            const admin = await login(ADMIN_EMAIL);
            const created = await admin
                .post('/api/api-tokens')
                .send({
                    name: 'admin-minted',
                    workspaceIds: [workspaceId],
                    scope: 'read'
                })
                .expect(201);
            return { admin, id: created.body.id as string };
        }

        it('lets tokens:read list, and refuses it the mint', async () => {
            const agent = await loginAs(['tokens:read'], 'tokens-read-only');

            await agent.get('/api/api-tokens').expect(200);
            await agent
                .post('/api/api-tokens')
                .send({
                    name: 'escalated',
                    workspaceIds: [workspaceId],
                    scope: 'full'
                })
                .expect(403);
        });

        it('refuses the revoke to tokens:read alone', async () => {
            const { admin, id } = await adminMintedToken();
            const agent = await loginAs(
                ['tokens:read'],
                'tokens-read-no-delete'
            );

            await agent.delete(`/api/api-tokens/${id}`).expect(403);

            // Seeing a credential is not being able to kill it.
            const list = await admin.get('/api/api-tokens').expect(200);
            expect(list.body.items[0].revokedAt).toBeNull();
        });

        it('refuses the revoke to a role holding no tokens permission', async () => {
            const { admin, id } = await adminMintedToken();
            await seedUserWithEmptyRole(harness.app, {
                email: NORIGHTS_EMAIL,
                password: PASSWORD,
                roleKey: 'token-delete-norights'
            });
            const agent = await login(NORIGHTS_EMAIL);

            await agent.delete(`/api/api-tokens/${id}`).expect(403);

            const list = await admin.get('/api/api-tokens').expect(200);
            expect(list.body.items[0].revokedAt).toBeNull();
        });
    });

    /**
     * Revocation against expiry — the two ways a token dies, and what happens
     * when both apply. Revocation is the operator's lever after a leak, so it
     * has to be the one that wins and the one that always lands.
     */
    describe('revocation and expiry together', () => {
        it('keeps a revoked token dead despite an expiry still in the future [api-tokens:I-10]', async () => {
            const agent = await login(ADMIN_EMAIL);
            const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
            const created = await agent
                .post('/api/api-tokens')
                .send({
                    name: 'leaked',
                    workspaceIds: [workspaceId],
                    scope: 'read',
                    expiresAt
                })
                .expect(201);

            // Live first, so the refusal below is the revocation and not the
            // setup.
            await request(harness.server)
                .get('/api/v1/content-types')
                .set('Authorization', `Bearer ${created.body.secret}`)
                .expect(200);

            await agent
                .delete(`/api/api-tokens/${created.body.id}`)
                .expect(204);

            // `verify` checks `revoked_at` before it looks at `expires_at`, and
            // that order is the whole point: a token revoked at 04:12 must not
            // keep working until the expiry its owner chose.
            await request(harness.server)
                .get('/api/v1/content-types')
                .set('Authorization', `Bearer ${created.body.secret}`)
                .expect(401);

            const list = await agent.get('/api/api-tokens').expect(200);
            expect(list.body.items[0].revokedAt).not.toBeNull();
            expect(
                new Date(list.body.items[0].expiresAt).getTime()
            ).toBeGreaterThan(Date.now());
        });

        it('revokes an already-expired token, and records it', async () => {
            // An expired token is still a row an operator may want explicitly
            // killed — after a leak, "it would have expired anyway" is not an
            // answer, and the audit line is what says the key was dealt with.
            const agent = await login(ADMIN_EMAIL);
            const created = await agent
                .post('/api/api-tokens')
                .send({
                    name: 'stale',
                    workspaceIds: [workspaceId],
                    scope: 'read'
                })
                .expect(201);
            await expireApiToken(created.body.id);

            await agent
                .delete(`/api/api-tokens/${created.body.id}`)
                .expect(204);

            const list = await agent.get('/api/api-tokens').expect(200);
            expect(list.body.items[0].revokedAt).not.toBeNull();

            const revoked = (await getActivityRows()).filter(
                (row) => row.kind === 'token.revoked'
            );
            expect(revoked).toHaveLength(1);
            expect(revoked[0].subjectId).toBe(created.body.id);
        });

        it('leaves revoked_at where it was when the revoke is replayed [api-tokens:I-11]', async () => {
            // The audit count already proves the second call raises no event.
            // This is the column itself: the update is guarded on
            // `revoked_at IS NULL`, so a replay must not restamp the row — the
            // timestamp is the answer to "when did this credential die", and a
            // moving one would make it the answer to "when was it last asked
            // about".
            const agent = await login(ADMIN_EMAIL);
            const created = await agent
                .post('/api/api-tokens')
                .send({
                    name: 'temp',
                    workspaceIds: [workspaceId],
                    scope: 'read'
                })
                .expect(201);

            await agent
                .delete(`/api/api-tokens/${created.body.id}`)
                .expect(204);
            const first = (await agent.get('/api/api-tokens').expect(200)).body
                .items[0].revokedAt;
            expect(first).not.toBeNull();

            await agent
                .delete(`/api/api-tokens/${created.body.id}`)
                .expect(204);
            const second = (await agent.get('/api/api-tokens').expect(200)).body
                .items[0].revokedAt;

            expect(second).toBe(first);
        });
    });

    /**
     * The token row and its audit event are one atomic fact.
     *
     * A credential that exists while its `token.created` row does not is exactly
     * the key nobody can account for — so the insert and the outbox append share
     * a transaction, and a subscriber being down may delay delivery but must
     * never lose it.
     */
    describe('durability of the mint', () => {
        it('commits the token and its event together, and survives a dead dispatcher [api-tokens:I-12] [database:I-13]', async () => {
            const agent = await login(ADMIN_EMAIL);
            // Logged in *before* the suspension so the session's own events are
            // already delivered and the assertions below are about the mint.
            const restore = suspendOutboxDispatch(harness.app);

            try {
                const created = await agent
                    .post('/api/api-tokens')
                    .send({
                        name: 'outbox-outage',
                        workspaceIds: [workspaceId, otherWorkspaceId],
                        scope: 'read'
                    })
                    .expect(201);
                const id = created.body.id as string;

                // State change: durable. `UnitOfWork.run` swallows a failed
                // post-commit drain by design, so a broken subscriber must not
                // cost the caller their token.
                const list = await agent.get('/api/api-tokens').expect(200);
                expect(list.body.total).toBe(1);
                expect(list.body.items[0].id).toBe(id);

                // Event: recorded, undelivered — not lost, which is the one
                // outcome an outbox exists to rule out.
                const pending = await getOutboxRows(id);
                expect(pending.map((row) => row.kind)).toEqual([
                    'api_token.created'
                ]);
                expect(pending[0].dispatchedAt).toBeNull();

                // Audit: nothing yet, because the subscriber never ran. Scoped
                // by kind — logging in wrote its own row before the suspension.
                expect(
                    (await getActivityRows()).filter(
                        (row) => row.kind === 'token.created'
                    )
                ).toHaveLength(0);

                restore();
                await drainOutbox(harness.app);

                // Recovery delivers exactly once and stamps the row.
                const audited = (await getActivityRows()).filter(
                    (row) => row.kind === 'token.created'
                );
                expect(audited).toHaveLength(1);
                expect(audited[0].subjectId).toBe(id);

                const settled = await getOutboxRows(id);
                expect(settled[0].dispatchedAt).not.toBeNull();
            } finally {
                restore();
            }
        });
    });
});
