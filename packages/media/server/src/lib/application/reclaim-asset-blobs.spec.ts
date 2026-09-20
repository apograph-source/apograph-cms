import type { Asset } from '../domain/asset';
import type { StorageProvider } from '@orthacms/media-domain';
import {
    RECLAIM_CONCURRENCY,
    reclaimAssetBlobs,
    reclaimManyAssetBlobs
} from './reclaim-asset-blobs';

/** A stand-in aggregate — the reclaim only reads these two members. */
function asset(id: number, variants = 2, storageProvider = 'local'): Asset {
    const keys = [`ws/${id}/original`];
    for (let n = 0; n < variants; n++) keys.push(`ws/${id}/variants/${n}`);
    return { storageProvider, storageKeys: keys } as unknown as Asset;
}

/** Records every removed key and the peak number of concurrent removes. */
function trackingProvider() {
    const removed: string[] = [];
    let inFlight = 0;
    let peak = 0;
    const provider = {
        id: 'local',
        async remove(key: string) {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 1));
            removed.push(key);
            inFlight--;
        }
    } as unknown as StorageProvider;
    return { provider, removed, peak: () => peak };
}

describe('reclaimAssetBlobs', () => {
    it('removes the original and every derivative [media:I-12]', async () => {
        const { provider, removed } = trackingProvider();

        await reclaimAssetBlobs(provider, asset(1));

        expect(removed.sort()).toEqual([
            'ws/1/original',
            'ws/1/variants/0',
            'ws/1/variants/1'
        ]);
    });

    it('swallows a provider failure — the row is already gone', async () => {
        const provider = {
            id: 'local',
            remove: () => Promise.reject(new Error('gone'))
        } as unknown as StorageProvider;

        await expect(
            reclaimAssetBlobs(provider, asset(1))
        ).resolves.toBeUndefined();
    });

    it('skips an asset written by a different provider [media:I-03]', async () => {
        // Those bytes live in a backend this process is not connected to, and
        // its keys mean nothing here — a remove would either no-op or address
        // something unrelated. (The boot check refuses to start in this state;
        // this is the guard for the request that uncovers it.)
        const { provider, removed } = trackingProvider();

        await reclaimAssetBlobs(provider, asset(1, 2, 's3'));

        expect(removed).toEqual([]);
    });
});

describe('reclaimManyAssetBlobs', () => {
    it('reclaims every asset it is given', async () => {
        const { provider, removed } = trackingProvider();
        const assets = Array.from({ length: 50 }, (_, n) => asset(n));

        await reclaimManyAssetBlobs(provider, assets);

        expect(removed).toHaveLength(150);
    });

    it('bounds how many provider calls are in flight at once', async () => {
        // The cascade used to `Promise.all` over every removed asset, and each
        // of those fans out again over its blobs — a folder holding 10 000
        // assets opened ~30 000 concurrent calls in one tick.
        const { provider, peak } = trackingProvider();
        const assets = Array.from({ length: 200 }, (_, n) => asset(n));

        await reclaimManyAssetBlobs(provider, assets);

        // Each asset still fans out over its own 3 keys, so the ceiling is the
        // window times the keys per asset — bounded either way.
        expect(peak()).toBeLessThanOrEqual(RECLAIM_CONCURRENCY * 3);
        expect(peak()).toBeGreaterThan(1);
    });

    it('does nothing for an empty list', async () => {
        const { provider, removed } = trackingProvider();

        await reclaimManyAssetBlobs(provider, []);

        expect(removed).toEqual([]);
    });
});
