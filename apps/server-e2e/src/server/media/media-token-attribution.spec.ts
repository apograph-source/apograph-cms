import request from 'supertest';
import { getPool } from '@orthacms/database';
import { PERMISSIONS } from '@orthacms/identity-server';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
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
const ISSUER = 'media-attribution-issuer@example.com';
const ADMIN = 'media-attribution-admin@example.com';
const PNG = Buffer.from('\x89PNG\r\n\x1a\nfake-png-bytes', 'binary');

/**
 * `POST /api/v1/media/assets` — who a token's upload is attributed to.
 *
 * `media_asset.uploaded_by` is `NOT NULL` and a token is not a user, so the
 * upload is credited to whoever minted the credential. That is the whole of the
 * invariant, and it has a second half that reads like a bug until you know it
 * is deliberate: **that user's own role is never consulted.** The token's scope
 * already decided the call is allowed — re-checking the issuer's grants would
 * mean an unattended import failing the day somebody edits a role, hours after
 * the token was minted and reviewed.
 *
 * The suite already driving this route asserts the *asset* it produced (`kind`,
 * bytes, workspace) and never reads `uploaded_by`, so a route crediting the
 * wrong human passed every media test in the repository.
 *
 * Two users are seeded on purpose. With one, "the row names the token's
 * creator" and "the row names whoever happened to be in `users`" are the same
 * assertion; with two, and a token from each, only the first can pass. And the
 * issuer holds **no media permission at all** — she may mint a credential and
 * nothing else — which separates the invariant's two clauses: the upload
 * succeeds (her role was not consulted) and the row still names her (she is the
 * accountable human).
 */
describe('media upload attribution through an API token', () => {
    let harness: TestApp;
    let issuer: SeededUser;
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
        workspace = await seedWorkspace({ name: 'Imports', slug: 'imports' });
        issuer = await seedUserWithPermissions(harness.app, {
            email: ISSUER,
            password: PASSWORD,
            roleKey: 'token-issuer',
            // Enough to mint a credential, and nothing whatsoever to do with
            // the media library.
            permissions: [
                PERMISSIONS.TOKENS_CREATE,
                PERMISSIONS.WORKSPACES_READ
            ]
        });
        admin = await seedActiveUser(harness.app, {
            email: ADMIN,
            password: PASSWORD,
            role: 'admin',
            name: 'Ada Admin'
        });
        await seedMembership(issuer.id, workspace.id);
        await seedMembership(admin.id, workspace.id);
    });

    async function login(email: string) {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password: PASSWORD })
            .expect(201);
        return agent;
    }

    /** Mints a `full`-scope token as `email`, and returns its plaintext. */
    async function mintToken(email: string, name: string): Promise<string> {
        const agent = await login(email);
        const minted = await agent
            .post('/api/api-tokens')
            .send({
                name,
                workspaceIds: [workspace.id],
                scope: 'full'
            })
            .expect(201);
        return minted.body.secret as string;
    }

    /** Uploads through the public route with `secret`. */
    async function uploadWithToken(secret: string, filename: string) {
        return request(harness.server)
            .post('/api/v1/media/assets')
            .set('Authorization', `Bearer ${secret}`)
            .set('X-Workspace-Id', workspace.id)
            .attach('file', PNG, { filename, contentType: 'image/png' })
            .expect(201);
    }

    /** The stored uploader id — the column the invariant is about. */
    async function uploadedBy(assetId: string): Promise<string> {
        const { rows } = await getPool().query(
            'SELECT uploaded_by FROM media_asset WHERE id = $1',
            [assetId]
        );
        expect(rows).toHaveLength(1);
        return rows[0].uploaded_by as string;
    }

    it('credits the token’s creator, without consulting their role [media:I-27]', async () => {
        // The fixture's whole point, asserted rather than assumed: this account
        // cannot perform the upload itself. If it could, the success below
        // would say nothing about whose authority was used.
        const session = await login(ISSUER);
        await session
            .post('/api/media/assets')
            .set('X-Workspace-Id', workspace.id)
            .attach('file', PNG, {
                filename: 'session.png',
                contentType: 'image/png'
            })
            .expect(403);

        const secret = await mintToken(ISSUER, 'importer');
        const upload = await uploadWithToken(secret, 'imported.png');

        // The row, which is what the invariant is about — and not the admin,
        // who is equally present, equally a member, and the likelier answer for
        // an implementation that reached for "a user" rather than "this token's
        // user".
        await expect(uploadedBy(upload.body.id)).resolves.toBe(issuer.id);
        expect(await uploadedBy(upload.body.id)).not.toBe(admin.id);

        // …and the label the Media Library's "who uploaded" column renders from
        // it. `users.name` is null for this account, so it falls back to the
        // email — either way it names a person, never the token.
        expect(upload.body.uploadedBy).toBe(ISSUER);
    });

    it('follows the token, not a fixed user [media:I-27]', async () => {
        // The same route, the same workspace, the same bytes — a different
        // minter. Together with the case above this is what pins *whose* id
        // lands: an implementation crediting the first admin, the workspace's
        // first member, or any other constant passes one of these two and fails
        // the other.
        const upload = await uploadWithToken(
            await mintToken(ADMIN, 'admins-own'),
            'by-admin.png'
        );

        await expect(uploadedBy(upload.body.id)).resolves.toBe(admin.id);
        expect(upload.body.uploadedBy).toBe('Ada Admin');
    });
});
