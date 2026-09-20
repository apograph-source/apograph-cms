import request from 'supertest';
import { PERMISSIONS, PERMISSION_KEYS } from '@orthacms/identity-server';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { TEST_ALLOWED_ORIGIN } from '../../support/test-config';
import {
    resetDb,
    seedActiveUser,
    seedMembership,
    seedUserWithPermissions,
    seedWorkspace,
    type SeededUser,
    type SeededWorkspace
} from '../../support/seed';

const PASSWORD = 'SecurePass123!';
const ADMIN = 'media-access-admin@example.com';
const EVIL_ORIGIN = 'https://evil.example';
const PNG = Buffer.from('\x89PNG\r\n\x1a\nfake-png-bytes', 'binary');

/** A logged-in supertest agent. */
type Agent = ReturnType<typeof request.agent>;

/** The per-test fixtures a route needs a handle on. */
interface Fixture {
    /** An asset the caller may read, patch, duplicate. */
    assetId: string;
    /** A second asset, so a bulk delete has something of its own to consume. */
    spareAssetId: string;
    /** A folder the caller may rename or delete. */
    folderId: string;
}

/** One mounted media route, and everything the sweep needs to drive it. */
interface MediaRoute {
    /** `PATCH /media/assets/:id` — the label a failure names. */
    key: string;
    /** The one permission the route requires. */
    permission: string;
    /** Whether it changes state, and so must carry `OriginGuard`. */
    stateChanging: boolean;
    /** Whether it takes its workspace from `X-Workspace-Id`. */
    headerScoped: boolean;
    /** The status a permitted caller gets. */
    ok: number;
    /** The bare request — headers are applied by {@link send}. */
    call: (agent: Agent, fixture: Fixture) => request.Test;
}

/**
 * Every session route the media plugin mounts, and the gate each one is under.
 *
 * `packages/media/server`'s `route-guards.spec.ts` asserts that this list is the
 * whole list — it reads the module's own `controllers` array, so a sixteenth
 * route cannot appear without that spec going red. What it cannot see is
 * whether the decorators it finds actually *refuse* anybody, which is what this
 * file is for. The two token routes are gated by the token's scope rather than
 * a role and are pinned by `public-content-writes.spec.ts` (`media:I-26`).
 */
const ROUTES: MediaRoute[] = [
    {
        key: 'GET /media/assets',
        permission: PERMISSIONS.MEDIA_READ,
        stateChanging: false,
        headerScoped: true,
        ok: 200,
        call: (agent) => agent.get('/api/media/assets')
    },
    {
        key: 'GET /media/folders',
        permission: PERMISSIONS.MEDIA_READ,
        stateChanging: false,
        headerScoped: true,
        ok: 200,
        call: (agent) => agent.get('/api/media/folders')
    },
    {
        key: 'GET /media/assets/:id/raw',
        permission: PERMISSIONS.MEDIA_READ,
        stateChanging: false,
        // The one exception: the workspace comes from the asset's row, so
        // there is no header to authorize. See `media:I-16`.
        headerScoped: false,
        ok: 200,
        call: (agent, fixture) =>
            agent.get(`/api/media/assets/${fixture.assetId}/raw`)
    },
    {
        key: 'GET /insights/media/storage',
        permission: PERMISSIONS.MEDIA_READ,
        stateChanging: false,
        headerScoped: true,
        ok: 200,
        call: (agent) => agent.get('/api/insights/media/storage')
    },
    {
        key: 'GET /insights/media/uploads',
        permission: PERMISSIONS.MEDIA_READ,
        stateChanging: false,
        headerScoped: true,
        ok: 200,
        call: (agent) => agent.get('/api/insights/media/uploads')
    },
    {
        key: 'GET /insights/media/alt',
        permission: PERMISSIONS.MEDIA_READ,
        stateChanging: false,
        headerScoped: true,
        ok: 200,
        call: (agent) => agent.get('/api/insights/media/alt')
    },
    {
        key: 'POST /media/folders',
        permission: PERMISSIONS.MEDIA_CREATE,
        stateChanging: true,
        headerScoped: true,
        ok: 201,
        call: (agent) =>
            agent.post('/api/media/folders').send({ name: 'Swept' })
    },
    {
        key: 'POST /media/assets',
        permission: PERMISSIONS.MEDIA_CREATE,
        stateChanging: true,
        headerScoped: true,
        ok: 201,
        call: (agent) =>
            agent.post('/api/media/assets').attach('file', PNG, {
                filename: 'swept.png',
                contentType: 'image/png'
            })
    },
    {
        key: 'POST /media/assets/:id/duplicate',
        permission: PERMISSIONS.MEDIA_CREATE,
        stateChanging: true,
        headerScoped: true,
        ok: 201,
        call: (agent, fixture) =>
            agent.post(`/api/media/assets/${fixture.assetId}/duplicate`)
    },
    {
        key: 'PATCH /media/assets/:id',
        permission: PERMISSIONS.MEDIA_UPDATE,
        stateChanging: true,
        headerScoped: true,
        ok: 200,
        call: (agent, fixture) =>
            agent
                .patch(`/api/media/assets/${fixture.assetId}`)
                .send({ name: 'renamed.png' })
    },
    {
        key: 'PATCH /media/folders/:id',
        permission: PERMISSIONS.MEDIA_UPDATE,
        stateChanging: true,
        headerScoped: true,
        ok: 200,
        call: (agent, fixture) =>
            agent
                .patch(`/api/media/folders/${fixture.folderId}`)
                .send({ name: 'Renamed' })
    },
    {
        key: 'DELETE /media/assets',
        permission: PERMISSIONS.MEDIA_DELETE,
        stateChanging: true,
        headerScoped: true,
        ok: 200,
        call: (agent, fixture) =>
            agent
                .delete('/api/media/assets')
                .send({ ids: [fixture.spareAssetId] })
    },
    {
        key: 'DELETE /media/folders/:id',
        permission: PERMISSIONS.MEDIA_DELETE,
        stateChanging: true,
        headerScoped: true,
        ok: 204,
        call: (agent, fixture) =>
            agent.delete(`/api/media/folders/${fixture.folderId}`)
    }
];

const ROUTE_CASES = ROUTES.map((route) => [route.key, route] as const);
const STATE_CHANGING = ROUTE_CASES.filter(([, route]) => route.stateChanging);
const HEADER_SCOPED = ROUTE_CASES.filter(([, route]) => route.headerScoped);

/**
 * The media plugin's guards, exercised over **every** route rather than the
 * three that happened to get a test.
 *
 * The package shipped `OriginGuard` coverage for exactly one route
 * (`POST /media/folders`) and a viewer-403 for two, which left eleven routes
 * whose decorators nothing had ever watched fire — including the two deletes.
 * `packages/users/server`'s `origin-guard.spec.ts` is the model, and it exists
 * because that package shipped without the guard on **any** route while the
 * decorator stack looked complete. The lesson generalises: a guard is one
 * identifier in a list, dropping it changes no signature, and every happy-path
 * test stays green.
 *
 * Each route is driven by a principal holding **every permission but the one it
 * requires** — sharper than a viewer, who is missing three of the four and so
 * could not tell `media:update` from `media:delete` on a route gated by the
 * wrong one.
 */
describe('media route authorization', () => {
    let harness: TestApp;
    let admin: SeededUser;
    let workspace: SeededWorkspace;
    /** A workspace nobody in this suite is a member of. */
    let foreign: SeededWorkspace;
    let adminAgent: Agent;
    /** One logged-in agent per media permission, deprived of exactly that one. */
    const deprived = new Map<string, Agent>();

    beforeAll(async () => {
        harness = await createTestApp();
        // Once, not per test: five bcrypt hashes and five logins at cost 12 is
        // the whole runtime of this file otherwise, and nothing below depends
        // on a pristine database — every test makes the fixtures it consumes.
        await resetDb();

        admin = await seedActiveUser(harness.app, {
            email: ADMIN,
            password: PASSWORD,
            role: 'admin',
            name: 'Media Admin'
        });
        workspace = await seedWorkspace({ name: 'Sweep', slug: 'sweep' });
        foreign = await seedWorkspace({ name: 'Foreign', slug: 'foreign' });
        await seedMembership(admin.id, workspace.id);
        adminAgent = await login(ADMIN);

        for (const permission of [
            PERMISSIONS.MEDIA_READ,
            PERMISSIONS.MEDIA_CREATE,
            PERMISSIONS.MEDIA_UPDATE,
            PERMISSIONS.MEDIA_DELETE
        ]) {
            const email = `media-access-no-${permission.split(':')[1]}@example.com`;
            const user = await seedUserWithPermissions(harness.app, {
                email,
                password: PASSWORD,
                roleKey: `media-sweep-no-${permission.split(':')[1]}`,
                // Everything else, so a 403 can only be about this key. A
                // member, too — `WorkspaceGuard` would otherwise be free to
                // produce the same 403 and the assertion would prove nothing.
                permissions: PERMISSION_KEYS.filter((key) => key !== permission)
            });
            await seedMembership(user.id, workspace.id);
            deprived.set(permission, await login(email));
        }
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    async function login(email: string): Promise<Agent> {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password: PASSWORD })
            .expect(201);
        return agent;
    }

    /** Fresh fixtures, so a destructive route always has its own to consume. */
    async function makeFixture(): Promise<Fixture> {
        const folder = await adminAgent
            .post('/api/media/folders')
            .set('X-Workspace-Id', workspace.id)
            .send({ name: `Folder ${Date.now()}-${Math.random()}` })
            .expect(201);
        const upload = async (name: string) => {
            const res = await adminAgent
                .post('/api/media/assets')
                .set('X-Workspace-Id', workspace.id)
                .attach('file', PNG, {
                    filename: name,
                    contentType: 'image/png'
                })
                .expect(201);
            return res.body.id as string;
        };
        return {
            folderId: folder.body.id,
            assetId: await upload('subject.png'),
            spareAssetId: await upload('spare.png')
        };
    }

    /** Drives `route` with the headers a particular assertion wants. */
    function send(
        route: MediaRoute,
        agent: Agent,
        fixture: Fixture,
        options: { workspaceId?: string; origin?: string } = {}
    ): request.Test {
        let test = route.call(agent, fixture);
        if (options.workspaceId) {
            test = test.set('X-Workspace-Id', options.workspaceId);
        }
        if (options.origin) {
            test = test.set('Origin', options.origin);
        }
        return test;
    }

    describe('permissions — every route refuses the caller who lacks its key [media:I-15]', () => {
        it.each(ROUTE_CASES)('%s', async (_key, route) => {
            const fixture = await makeFixture();
            const agent = deprived.get(route.permission);
            expect(agent).toBeDefined();

            // Refused first, so the refusal cannot be an artefact of the
            // fixture having already been consumed by the success below.
            await send(route, agent as Agent, fixture, {
                workspaceId: workspace.id
            }).expect(403);

            // …and the request is otherwise well-formed: the same call, from a
            // caller who holds the key, goes through. Without this a route that
            // 403s everybody — or a fixture that was never valid — would pass.
            await send(route, adminAgent, fixture, {
                workspaceId: workspace.id
            }).expect(route.ok);
        });
    });

    describe('CSRF — every state-changing route carries OriginGuard [media:I-15]', () => {
        it.each(STATE_CHANGING)('%s', async (_key, route) => {
            // A hostile Origin, i.e. a page the signed-in editor is visiting
            // spending their cookie.
            await send(route, adminAgent, await makeFixture(), {
                workspaceId: workspace.id,
                origin: EVIL_ORIGIN
            }).expect(403);

            // The admin app itself.
            await send(route, adminAgent, await makeFixture(), {
                workspaceId: workspace.id,
                origin: TEST_ALLOWED_ORIGIN
            }).expect(route.ok);

            // And no Origin at all — a non-browser client must keep working,
            // or the guard has been over-tightened into breaking curl.
            await send(route, adminAgent, await makeFixture(), {
                workspaceId: workspace.id
            }).expect(route.ok);
        });

        it('leaves the subtree in place when a forged delete is refused', async () => {
            // The most destructive of the family, checked for effect rather
            // than status: a 403 that had already cascaded would be worse than
            // a 200.
            const fixture = await makeFixture();
            await adminAgent
                .patch(`/api/media/assets/${fixture.assetId}`)
                .set('X-Workspace-Id', workspace.id)
                .send({ folderId: fixture.folderId })
                .expect(200);

            await adminAgent
                .delete(`/api/media/folders/${fixture.folderId}`)
                .set('X-Workspace-Id', workspace.id)
                .set('Origin', EVIL_ORIGIN)
                .expect(403);

            const folders = await adminAgent
                .get('/api/media/folders')
                .set('X-Workspace-Id', workspace.id)
                .expect(200);
            expect(
                (folders.body.folders as { id: string }[]).map(
                    (folder) => folder.id
                )
            ).toContain(fixture.folderId);
            await adminAgent
                .get(`/api/media/assets/${fixture.assetId}/raw`)
                .expect(200);
        });
    });

    describe('tenancy — every header-scoped route carries WorkspaceGuard [media:I-16]', () => {
        it.each(HEADER_SCOPED)('%s', async (_key, route) => {
            const fixture = await makeFixture();

            // A workspace the caller is not a member of. The route's own
            // handler would happily have used the id: the guard is the only
            // thing between a valid session and another tenant's library.
            await send(route, adminAgent, fixture, {
                workspaceId: foreign.id
            }).expect(403);

            // No header at all is a 400, not a fall-through to some default
            // workspace.
            await send(route, adminAgent, fixture, {}).expect(400);
        });

        it('exempts the raw route, which takes its workspace from the row', async () => {
            // The other side of the "every route but one" claim, from this
            // file's own fixtures: the header is not merely unnecessary here,
            // it is ignored — membership of the *owning* workspace decides.
            const fixture = await makeFixture();
            await adminAgent
                .get(`/api/media/assets/${fixture.assetId}/raw`)
                .set('X-Workspace-Id', foreign.id)
                .expect(200);
        });
    });
});
