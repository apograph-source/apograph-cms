import request from 'supertest';
import type { Response } from 'supertest';
import { PERMISSION_KEYS } from '@orthacms/identity-server';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    deleteUser,
    expireUserSessions,
    resetDb,
    revokeUserSessions,
    seedActiveUser,
    setUserStatus,
    type SeededUser
} from '../../support/seed';

const EMAIL = 'me-test@example.com';
const PASSWORD = 'SecurePass123!';
const NAME = 'Me Test';

/** Extract the `orthacms_session=value` pair from a login response. */
function sessionCookie(res: Response): string {
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    const cookie = setCookie
        .find((c) => c.startsWith('orthacms_session='))
        ?.split(';')[0];
    if (!cookie) {
        throw new Error('login did not set a session cookie');
    }
    return cookie;
}

/** `GET /api/auth/me` — resolves the current user from the session cookie. */
describe('GET /api/auth/me', () => {
    let harness: TestApp;
    let user: SeededUser;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        user = await seedActiveUser(harness.app, {
            email: EMAIL,
            password: PASSWORD,
            role: 'admin',
            name: NAME
        });
    });

    const get = () => request(harness.server).get('/api/auth/me');

    /** Log in and return the raw session cookie pair. */
    async function login(): Promise<string> {
        const res = await request(harness.server)
            .post('/api/auth/login')
            .send({ email: EMAIL, password: PASSWORD })
            .expect(201);
        return sessionCookie(res);
    }

    describe('unauthenticated (401)', () => {
        it('rejects a request with no cookie', async () => {
            await get().expect(401);
        });

        it('rejects a bogus session token', async () => {
            await get()
                .set('Cookie', 'orthacms_session=not-a-real-token')
                .expect(401);
        });

        it('rejects an empty session cookie value', async () => {
            await get().set('Cookie', 'orthacms_session=').expect(401);
        });

        it('rejects when only unrelated cookies are present', async () => {
            await get().set('Cookie', 'theme=dark; lang=en').expect(401);
        });

        it('rejects a malformed cookie header', async () => {
            await get().set('Cookie', 'garbage-without-equals').expect(401);
        });
    });

    describe('authenticated', () => {
        it('returns the current user after login (cookie flow)', async () => {
            const agent = request.agent(harness.server);
            await agent
                .post('/api/auth/login')
                .send({ email: EMAIL, password: PASSWORD })
                .expect(201);

            const res = await agent.get('/api/auth/me').expect(200);
            expect(res.body).toEqual(
                expect.objectContaining({
                    id: user.id,
                    email: EMAIL,
                    name: NAME,
                    status: 'active'
                })
            );
            expect(typeof res.body.roleId).toBe('string');
        });

        it('exposes only the public fields (no hash/token leak)', async () => {
            const res = await get()
                .set('Cookie', await login())
                .expect(200);
            expect(Object.keys(res.body).sort()).toEqual([
                'email',
                'id',
                'name',
                'permissions',
                'roleId',
                'status'
            ]);
        });

        it('includes exactly the permission keys the user’s role grants', async () => {
            const res = await get()
                .set('Cookie', await login())
                .expect(200);
            // The seeded user is an admin, so they hold the full catalogue —
            // and *only* the catalogue. Asserting the exact set rather than a
            // superset is the point: `seedSystemRoles` was additive-only, so a
            // permission deleted from the code (ADR-0009 removed
            // `copilot:configure`) stayed granted in the database forever and
            // an admin kept being handed a key that no longer exists.
            expect(Array.isArray(res.body.permissions)).toBe(true);
            expect([...res.body.permissions].sort()).toEqual(
                [...PERMISSION_KEYS].sort()
            );
        });

        it('grants a viewer exactly the read-only set', async () => {
            const viewer = await seedActiveUser(harness.app, {
                email: 'me-viewer@example.com',
                password: PASSWORD,
                role: 'viewer'
            });
            const agent = request.agent(harness.server);
            await agent
                .post('/api/auth/login')
                .send({ email: viewer.email, password: PASSWORD })
                .expect(201);

            const res = await agent.get('/api/auth/me').expect(200);
            expect([...res.body.permissions].sort()).toEqual(
                [
                    'workspaces:read',
                    'users:read',
                    'content:read',
                    'media:read',
                    // Findings are rendered inline in the entry editor, so the
                    // read grant goes to every role. Writing rules — and
                    // muting a finding — is `alarms:manage`, admin only.
                    'alarms:read',
                    // Same shape as the alarms grant above: an editor who
                    // cannot see that an entry is restricted will publish one
                    // believing it is public, so `read` goes to every role.
                    // Deciding *who* reads it is `segments:manage`, admin only.
                    'segments:read',
                    'copilot:use'
                ].sort()
            );
        });

        it('grants a contributor exactly the editorial set', async () => {
            const contributor = await seedActiveUser(harness.app, {
                email: 'me-contributor@example.com',
                password: PASSWORD,
                role: 'contributor'
            });
            const agent = request.agent(harness.server);
            await agent
                .post('/api/auth/login')
                .send({ email: contributor.email, password: PASSWORD })
                .expect(201);

            const res = await agent.get('/api/auth/me').expect(200);
            expect([...res.body.permissions].sort()).toEqual(
                [
                    'workspaces:read',
                    'users:read',
                    'content:read',
                    'content:create',
                    'content:update',
                    'content:publish',
                    // Approving is an editorial act — the statement that a
                    // second person read the thing — so it lands on the role
                    // that edits rather than on a new "reviewer" role: a
                    // protection rule blocks everyone equally, and a
                    // deployment wanting a reviewer who cannot write mints a
                    // custom role with this key and without `content:update`.
                    // Viewer does not get it, and no API token scope does
                    // (`protection:I-12`) — a token names nobody, so a vote
                    // from one would satisfy the count while the guarantee it
                    // stands for quietly does not hold.
                    'content:approve',
                    // Removing the draft that should never have existed is the
                    // same editorial act as writing it — a role that can
                    // publish to the world but cannot retract is the more
                    // dangerous of the two.
                    'content:delete',
                    // Bulk egress and bulk ingest are separate capabilities
                    // from read and create, and both are held here: an import
                    // still needs the ordinary write keys for each record it
                    // touches, so it can never do more than this role could by
                    // hand.
                    'content:export',
                    'content:import',
                    'media:read',
                    'media:create',
                    'media:update',
                    'media:delete',
                    // Read-only on both features an editor has to *see* but
                    // does not configure: findings are rendered inline in the
                    // entry editor, and an editor who cannot see that an entry
                    // is restricted would publish one believing it is public.
                    'alarms:read',
                    'segments:read',
                    'copilot:use',
                    // Saving a private view needs no permission; making one a
                    // navigation item for the whole workspace is an editorial
                    // decision, and this is it.
                    'views:share'
                ].sort()
            );
        });

        it('withholds every configuration key from a contributor', async () => {
            // The complement of the list above, spelled out: the exact-set
            // assertion already implies it, but a future key added to both
            // `PERMISSIONS` and contributor's grants would only move one
            // sorted list. These are the keys whose absence is the point —
            // authority over people, credentials, audiences, alarm rules and
            // the prompt text the copilot runs for everyone.
            const contributor = await seedActiveUser(harness.app, {
                email: 'me-contributor-negative@example.com',
                password: PASSWORD,
                role: 'contributor'
            });
            const agent = request.agent(harness.server);
            await agent
                .post('/api/auth/login')
                .send({ email: contributor.email, password: PASSWORD })
                .expect(201);

            const res = await agent.get('/api/auth/me').expect(200);
            const held = new Set<string>(res.body.permissions);
            for (const withheld of [
                'workspaces:create',
                'workspaces:update',
                'workspaces:delete',
                'users:create',
                'users:update',
                'users:delete',
                // Revealing the link of an undelivered invitation hands over a
                // secret that takes over an account — the sharpest example of
                // "authority over people" this list is about.
                'users:manage',
                'activity:read',
                'tokens:read',
                'tokens:create',
                'tokens:delete',
                'alarms:manage',
                'segments:manage',
                'copilot:skills:manage'
            ]) {
                expect(held.has(withheld)).toBe(false);
            }
        });

        it('nests the three system roles: viewer ⊆ contributor ⊆ admin', async () => {
            // Not a restatement of the lists above. The matrix is only
            // coherent if the roles are ordered — a viewer holding something a
            // contributor does not would mean "read-only" and "editor" are two
            // unrelated sets, and no UI that gates on a role could be right.
            const [viewer, contributor] = await Promise.all([
                seedActiveUser(harness.app, {
                    email: 'me-nested-viewer@example.com',
                    password: PASSWORD,
                    role: 'viewer'
                }),
                seedActiveUser(harness.app, {
                    email: 'me-nested-contributor@example.com',
                    password: PASSWORD,
                    role: 'contributor'
                })
            ]);

            const permissionsFor = async (email: string) => {
                const agent = request.agent(harness.server);
                await agent
                    .post('/api/auth/login')
                    .send({ email, password: PASSWORD })
                    .expect(201);
                const res = await agent.get('/api/auth/me').expect(200);
                return new Set<string>(res.body.permissions);
            };

            const viewerKeys = await permissionsFor(viewer.email);
            const contributorKeys = await permissionsFor(contributor.email);
            const adminKeys = new Set<string>(PERMISSION_KEYS);

            for (const key of viewerKeys) {
                expect(contributorKeys.has(key)).toBe(true);
            }
            for (const key of contributorKeys) {
                expect(adminKeys.has(key)).toBe(true);
            }
            expect(contributorKeys.size).toBeGreaterThan(viewerKeys.size);
            expect(adminKeys.size).toBeGreaterThan(contributorKeys.size);
        });

        it('works with an explicitly forwarded session cookie', async () => {
            await get()
                .set('Cookie', await login())
                .expect(200);
        });

        it('finds the session cookie among several cookies', async () => {
            const cookie = await login();
            await get()
                .set('Cookie', `theme=dark; ${cookie}; lang=en`)
                .expect(200);
        });

        it('reflects the user’s assigned role', async () => {
            const res = await get()
                .set('Cookie', await login())
                .expect(200);
            // The seeded user is an admin; roleId must be a real role id.
            expect(res.body.roleId).toEqual(expect.any(String));
        });
    });

    describe('invalidated sessions (401)', () => {
        it('rejects an expired session', async () => {
            const cookie = await login();
            await expireUserSessions(user.id);
            await get().set('Cookie', cookie).expect(401);
        });

        it('rejects a revoked session', async () => {
            const cookie = await login();
            await revokeUserSessions(user.id);
            await get().set('Cookie', cookie).expect(401);
        });

        it('rejects a session whose user was deleted', async () => {
            const cookie = await login();
            await deleteUser(user.id);
            await get().set('Cookie', cookie).expect(401);
        });

        /**
         * Disabling through the API also revokes the member's sessions, so this
         * suspends the account behind the API's back — the state a login racing
         * a disable can leave behind. The cookie is still live; the account is
         * not, and the resolve must refuse it on that alone.
         */
        it('rejects a live session whose account was suspended [identity:I-02]', async () => {
            const cookie = await login();
            await setUserStatus(user.id, 'disabled');
            await get().set('Cookie', cookie).expect(401);
        });

        it('accepts the same session again once the account is reactivated', async () => {
            const cookie = await login();
            await setUserStatus(user.id, 'disabled');
            await get().set('Cookie', cookie).expect(401);

            await setUserStatus(user.id, 'active');
            await get().set('Cookie', cookie).expect(200);
        });

        it('rejects a live session whose account fell back to pending', async () => {
            const cookie = await login();
            await setUserStatus(user.id, 'pending');
            await get().set('Cookie', cookie).expect(401);
        });
    });
});
