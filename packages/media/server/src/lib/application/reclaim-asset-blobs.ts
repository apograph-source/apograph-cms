import type { Asset } from '../domain/asset';
import type { StorageProvider } from '@orthacms/media-domain';

/**
 * How many assets' blobs are reclaimed at once.
 *
 * The cascade and the bulk delete both used to `Promise.all` over every removed
 * asset, and each of those fans out again over its original + derivatives. A
 * folder holding 10 000 assets therefore opened ~30 000 concurrent provider
 * calls in one tick — thousands of file descriptors locally, or a burst that a
 * remote provider answers with 429s. The work is deletes nobody is waiting on,
 * so a small window costs nothing and bounds the blast radius.
 */
export const RECLAIM_CONCURRENCY = 16;

/**
 * Runs `task` over `items` with at most {@link RECLAIM_CONCURRENCY} in flight,
 * in insertion order. Deliberately tiny and local — a queue library for a
 * for-loop with a semaphore would be the bigger dependency.
 */
async function mapWithConcurrency<T>(
    items: readonly T[],
    task: (item: T) => Promise<void>
): Promise<void> {
    let cursor = 0;
    const workers = Array.from(
        { length: Math.min(RECLAIM_CONCURRENCY, items.length) },
        async () => {
            while (cursor < items.length) {
                const item = items[cursor++] as T;
                await task(item);
            }
        }
    );
    await Promise.all(workers);
}

/**
 * Reclaims the blobs of **many** deleted assets with a bounded number of
 * provider calls in flight. Post-commit and best-effort, exactly like the
 * single-asset {@link reclaimAssetBlobs} it wraps.
 */
export async function reclaimManyAssetBlobs(
    provider: StorageProvider,
    assets: readonly Asset[]
): Promise<void> {
    await mapWithConcurrency(assets, (asset) =>
        reclaimAssetBlobs(provider, asset)
    );
}

/**
 * Removes every blob one deleted asset owns — the original **and** each
 * generated derivative (`Asset.storageKeys`) — through the deployment's
 * provider. Shared by the two paths that delete assets (a bulk delete, and a
 * folder cascade) so neither can forget the derivatives.
 *
 * A row written by a *different* provider is skipped rather than attempted:
 * this backend does not hold those bytes and its keys mean nothing to it, so a
 * remove would either no-op or, worse, address something unrelated. Boot
 * refuses to start in that state (`StorageProviderCheck`), so in practice this
 * guard only covers the window where a row is deleted by the same request that
 * revealed the mismatch.
 *
 * Always called **post-commit** and always best-effort: the row is already gone,
 * so a failed blob delete leaves an orphan for GC rather than an error the
 * caller can do anything about.
 */
export async function reclaimAssetBlobs(
    provider: StorageProvider,
    asset: Asset
): Promise<void> {
    if (asset.storageProvider !== provider.id) return;
    try {
        await Promise.all(asset.storageKeys.map((key) => provider.remove(key)));
    } catch {
        // Orphaned blob; nothing useful to report at this point.
    }
}
