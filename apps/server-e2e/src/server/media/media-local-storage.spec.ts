import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rm,
    writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { getPool } from '@orthacms/database';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    clearMediaLibraryOutOfBand,
    resetDb,
    seedActiveUser,
    seedMembership,
    seedWorkspace,
    type SeededUser,
    type SeededWorkspace
} from '../../support/seed';

const PASSWORD = 'SecurePass123!';
const ADMIN = 'media-local-admin@example.com';
const DOC = Buffer.from('the quick brown fox jumps over the lazy dog\n');

/**
 * The media routes against the **real** filesystem provider
 * (`@orthacms/media-provider-local`) rather than the harness's in-memory
 * `Map`, rooted at a throwaway temp directory.
 *
 * Everything here is a claim about the disk that a `Map` cannot answer: where
 * the bytes actually land, what a delete leaves behind, and what happens when
 * the `storage_key` column — the one input to `get`/`remove` that is not minted
 * by the provider — says something the provider should refuse to act on.
 */
describe('media assets on the local filesystem provider', () => {
    let harness: TestApp;
    let root: string;
    let admin: SeededUser;
    let workspace: SeededWorkspace;

    beforeAll(async () => {
        root = await mkdtemp(join(tmpdir(), 'ortha-e2e-media-'));
        // This app boots on the filesystem provider, and the server refuses to
        // start when the library already holds assets written by a different
        // one — which is exactly what a previous spec file's rows are, having
        // been written by the harness's in-memory provider.
        await clearMediaLibraryOutOfBand();
        harness = await createTestApp({ localMediaRoot: root });
    });
    afterAll(async () => {
        await closeTestApp(harness);
        await rm(root, { recursive: true, force: true });
        // And the same on the way out, for the mirror-image reason: `resetDb`
        // runs in `beforeEach`, so this file's last upload is still in the
        // library, and its rows say "local". The next spec file boots on the
        // in-memory provider and would fail that same check in `beforeAll` —
        // a failure reported against a file that never touched media.
        await clearMediaLibraryOutOfBand();
    });
    beforeEach(async () => {
        await resetDb();
        // `resetDb` truncates the rows; the blobs are ours to clear, so each
        // case can assert on an empty root rather than on its predecessors'
        // leftovers.
        await rm(root, { recursive: true, force: true });
        await mkdir(root, { recursive: true });
        admin = await seedActiveUser(harness.app, {
            email: ADMIN,
            password: PASSWORD,
            role: 'admin',
            name: 'Media Admin'
        });
        workspace = await seedWorkspace({ name: 'Files', slug: 'files' });
        await seedMembership(admin.id, workspace.id);
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

    /** Uploads a plain-text document — no `sharp`, so no derivatives. */
    async function upload(
        agent: ReturnType<typeof request.agent>,
        name = 'notes.txt'
    ) {
        const res = await agent
            .post('/api/media/assets')
            .attach('file', DOC, { filename: name, contentType: 'text/plain' })
            .expect(201);
        return res.body;
    }

    async function storageKeyOf(assetId: string): Promise<string> {
        const { rows } = await getPool().query<{ storage_key: string }>(
            'SELECT storage_key FROM media_asset WHERE id = $1',
            [assetId]
        );
        return rows[0].storage_key;
    }

    it('writes the blob to <root>/<workspace>/<asset>/<name> and serves those exact bytes', async () => {
        const agent = await login();

        const asset = await upload(agent);

        const storageKey = await storageKeyOf(asset.id);
        expect(storageKey).toBe(`${workspace.id}/${asset.id}/notes.txt`);
        const onDisk = await readFile(join(root, storageKey));
        expect(onDisk).toEqual(DOC);
        // The size and checksum the row carries are the provider's own count of
        // what it wrote, not the multipart part's claim.
        const { rows } = await getPool().query<{
            size: string;
            checksum: string;
        }>('SELECT size, checksum FROM media_asset WHERE id = $1', [asset.id]);
        expect(Number(rows[0].size)).toBe(DOC.length);
        expect(rows[0].checksum).toBe(
            createHash('sha256').update(DOC).digest('hex')
        );

        const raw = await agent
            .get(`/api/media/assets/${asset.id}/raw`)
            .buffer(true)
            .parse((res, callback) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => callback(null, Buffer.concat(chunks)));
            })
            .expect(200);
        expect(raw.body).toEqual(DOC);
    });

    it('leaves no file and no empty directory behind when the asset is deleted', async () => {
        const agent = await login();
        const asset = await upload(agent);
        const storageKey = await storageKeyOf(asset.id);
        expect(existsSync(join(root, storageKey))).toBe(true);

        await agent
            .delete('/api/media/assets')
            .send({ ids: [asset.id] })
            .expect(200);

        // Reclaim is post-commit and best-effort, so give the provider a tick.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(existsSync(join(root, storageKey))).toBe(false);
        // The asset's own directory used to survive forever — one leaked inode
        // per upload-and-delete cycle, for the life of the deployment.
        expect(existsSync(join(root, workspace.id, asset.id))).toBe(false);
        expect(await readdir(root)).toEqual([]);
    });

    it('refuses to serve a file outside the storage root when the stored key traverses [media:I-18]', async () => {
        const agent = await login();
        const asset = await upload(agent);
        const outside = await mkdtemp(join(tmpdir(), 'ortha-e2e-outside-'));
        await writeFile(join(outside, 'secret.txt'), 'TOP SECRET');
        // The database is the one source of storage keys the provider does not
        // mint itself: a bad migration, an import script, or anything else that
        // can write this column is all it takes.
        await getPool().query(
            'UPDATE media_asset SET storage_key = $1 WHERE id = $2',
            [`../${outside.split('/').pop()}/secret.txt`, asset.id]
        );

        try {
            const res = await agent.get(`/api/media/assets/${asset.id}/raw`);

            // A **deliberate** 500, and the one download failure that is not a
            // 404: a key that walks out of the storage root is a corrupted row,
            // not a caller's mistake, so reporting "not found" would hide it.
            // Contrast the missing-blob case above.
            expect(res.status).toBe(500);
            expect(res.text ?? '').not.toContain('TOP SECRET');
            expect(existsSync(join(outside, 'secret.txt'))).toBe(true);
        } finally {
            await rm(outside, { recursive: true, force: true });
        }
    });

    it('refuses to delete a file outside the storage root when the stored key traverses', async () => {
        const agent = await login();
        const asset = await upload(agent);
        const outside = await mkdtemp(join(tmpdir(), 'ortha-e2e-outside-'));
        await writeFile(join(outside, 'secret.txt'), 'TOP SECRET');
        await getPool().query(
            'UPDATE media_asset SET storage_key = $1 WHERE id = $2',
            [`../${outside.split('/').pop()}/secret.txt`, asset.id]
        );

        try {
            await agent
                .delete('/api/media/assets')
                .send({ ids: [asset.id] })
                .expect(200);

            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(existsSync(join(outside, 'secret.txt'))).toBe(true);
        } finally {
            await rm(outside, { recursive: true, force: true });
        }
    });

    it('answers 404 when the blob is missing from disk [media:I-17]', async () => {
        const agent = await login();
        const asset = await upload(agent);
        // Row kept, bytes gone — a restored database pointed at an empty volume.
        await rm(join(root, await storageKeyOf(asset.id)));

        const res = await agent.get(`/api/media/assets/${asset.id}/raw`);

        // Two things at once. It is not a truncated `200` — the failure used
        // to arrive as a stream error after the headers had already been sent.
        // And it is not a `500`: the provider now rejects with
        // `ObjectNotFoundError`, which `to-http` maps to the **same** 404 this
        // route answers for a missing id and for a non-member. A 500 here was
        // both wrong and a signal, telling a caller the row was real.
        expect(res.status).toBe(404);
    });

    it('does not name the storage key in the 404 body [media:I-17]', async () => {
        const agent = await login();
        const asset = await upload(agent);
        await rm(join(root, await storageKeyOf(asset.id)));

        const res = await agent.get(`/api/media/assets/${asset.id}/raw`);

        // The error carries the key for the operator's log line; a caller gets
        // the bare 404 every other miss gets.
        expect(JSON.stringify(res.body)).not.toContain(asset.id);
        expect(JSON.stringify(res.body)).not.toMatch(/storage key/i);
    });
});
