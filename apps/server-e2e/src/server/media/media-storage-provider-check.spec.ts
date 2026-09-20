import { Pool } from 'pg';
import { closeDatabase } from '@orthacms/database';
import { closeTestApp, createTestApp } from '../../support/test-app';
import { resolveDatabaseUrl } from '../../support/db-url';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const UPLOADER = '33333333-3333-4333-8333-333333333333';

/** Runs `work` against its own connection, independent of any booted app. */
async function withSidePool<T>(work: (pool: Pool) => Promise<T>): Promise<T> {
    const pool = new Pool({ connectionString: resolveDatabaseUrl() });
    try {
        return await work(pool);
    } finally {
        await pool.end();
    }
}

/** Inserts an asset row claiming to be held by `storageProvider`. */
async function seedForeignAsset(storageProvider: string): Promise<void> {
    await withSidePool(async (pool) => {
        await pool.query(
            'TRUNCATE TABLE media_asset, media_folder RESTART IDENTITY CASCADE'
        );
        // `workspace_id` and `uploaded_by` carry no FK (those tables belong to
        // other plugins), so this needs no seeded user or workspace — the check
        // reads one column and never joins.
        await pool.query(
            `INSERT INTO media_asset
                 (workspace_id, name, kind, mime_type, size, storage_key, storage_provider, uploaded_by)
             VALUES ($1, 'ghost.png', 'image', 'image/png', 9, 'ws/asset/ghost.png', $2, $3)`,
            [WORKSPACE, storageProvider, UPLOADER]
        );
    });
}

/** Leaves the shared database as the next suite expects to find it. */
async function clearAssets(): Promise<void> {
    await withSidePool((pool) =>
        pool.query(
            'TRUNCATE TABLE media_asset, media_folder RESTART IDENTITY CASCADE'
        )
    );
}

/**
 * The boot check that pays for having exactly one storage provider
 * ([ADR-0012](../../../../../docs/adr/0012-one-storage-provider-per-deployment.md)).
 *
 * Swapping the provider in `plugins.ts` makes every asset written by the
 * previous one unreadable — its bytes are in a store this process is no longer
 * connected to. Unchecked, that ships as a library of broken images and a 500
 * per request, with nothing naming the cause. `StorageProviderCheck` turns it
 * into a refusal to start.
 *
 * The unit suite covers the comparison itself
 * (`storage-provider.check.spec.ts`); what is only true end to end is that Nest
 * actually runs it during `app.init()`, so the app really does fail to come up.
 *
 * These boot their own app on purpose — a failed boot is the assertion — and so
 * seed through a side connection rather than `resetDb`, which goes through a
 * pool that does not exist yet.
 */
describe('storage provider boot check', () => {
    afterEach(async () => {
        await clearAssets();
        // The failed boot ran `onPluginInit`, so the connection is open with no
        // app to close it. Left behind, it keeps the worker alive after the
        // suite ends.
        await closeDatabase();
    });

    it('refuses to boot over assets written by another provider', async () => {
        await seedForeignAsset('ghost');

        // The harness boots the in-memory provider (`memory`), so the seeded
        // row is foreign to it.
        await expect(createTestApp()).rejects.toThrow(
            /"ghost" \(1 assets\).*configured with "memory"/s
        );
    });

    it('boots normally once no row names a foreign provider', async () => {
        // The other half of the claim: the check is not simply always failing,
        // and the database it just refused over is otherwise fine.
        await clearAssets();

        const harness = await createTestApp();
        try {
            expect(harness.app).toBeDefined();
        } finally {
            await closeTestApp(harness);
        }
    });
});
