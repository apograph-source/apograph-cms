import type { OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import type { StorageProvider } from '@orthacms/media-domain';
import type { Asset } from '../../domain/asset';
import type { AssetRepository } from '../../domain/asset.repository';
import type { Folder } from '../../domain/folder';
import type { FolderRepository } from '../../domain/folder.repository';
import { DeleteAssetsUseCase } from './delete-assets.use-case';
import { DeleteFolderUseCase } from './delete-folder.use-case';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const FOLDER_ID = '33333333-3333-4333-8333-333333333333';
const actor = { id: 'user-1' } as unknown as PublicUser;

/**
 * **When** a deletion frees the bytes, which is a different question from
 * *whether* it frees them.
 *
 * `reclaim-asset-blobs.spec.ts` pins what a reclaim removes — the original and
 * every derivative — and `blob-store-isolation.spec.ts` pins that the store is
 * empty after a delete that succeeded. Neither can see the ordering, and the
 * ordering is the half that loses data: a reclaim moved inside `uow.run` frees
 * the blobs before the transaction commits, so a rollback — a serialization
 * failure, a constraint, a lock timeout, anything at all — leaves the rows
 * alive and their bytes gone. Every asset in that folder then renders as a
 * broken image, and nothing in the database records that it happened.
 *
 * The failure is invisible to an HTTP suite for the same reason: the request
 * that rolled back returns an error either way, and the rows it did not delete
 * are still there to be listed. Only the blob store knows, and only if someone
 * asks it at the right moment.
 *
 * `MediaWorkspacePurger` states the same rule by *shape* — it hands the reclaim
 * back as a thunk it never calls (`media:I-35`). These two use cases have no
 * thunk to inspect: they await the reclaim themselves, so the claim has to be
 * made about the sequence instead.
 */

/** An asset that knows what it owns and records having been deleted. */
function asset(id: string, keys: string[], provider = 'local'): Asset {
    return {
        id,
        storageProvider: provider,
        storageKeys: keys,
        markDeleted: () => undefined,
        pullEvents: () => []
    } as unknown as Asset;
}

/** A folder, as far as the cascade reads one. */
function folder(id: string): Folder {
    return {
        id,
        markDeleted: () => undefined,
        pullEvents: () => []
    } as unknown as Folder;
}

/** What a run of one of the two use cases observed. */
interface Harness {
    /** Keys handed to the provider's `remove`, in order. */
    removed: string[];
    /** How many keys had been removed at the moment the transaction ended. */
    removedAtCommit: number;
    /** Assets the repository was asked to delete. */
    deleted: string[];
}

/**
 * A `UnitOfWork` that behaves like the real one in the respect under test: the
 * callback's work is not durable until `run` resolves, and if `outcome` is
 * `'rollback'` it never becomes durable at all.
 */
function harness(outcome: 'commit' | 'rollback' = 'commit') {
    const state: Harness = { removed: [], removedAtCommit: -1, deleted: [] };

    const uow = {
        run: async <T>(work: () => Promise<T>): Promise<T> => {
            const value = await work();
            // The boundary. Anything the provider was told to remove before
            // this line ran was removed while the transaction was still open.
            state.removedAtCommit = state.removed.length;
            if (outcome === 'rollback') {
                throw new Error('serialization failure');
            }
            return value;
        }
    } as unknown as UnitOfWork;

    const provider = {
        id: 'local',
        remove: (key: string) => {
            state.removed.push(key);
            return Promise.resolve();
        }
    } as unknown as StorageProvider;

    const outbox = {
        append: () => Promise.resolve()
    } as unknown as OutboxWriter;

    return { state, uow, provider, outbox };
}

const ASSETS = [
    asset('asset-1', ['ws/hero.png', 'variants/ws/hero-thumb.webp']),
    asset('asset-2', ['ws/notes.txt'])
];

/** An asset repository over a fixed set, recording what it was told to delete. */
function assetRepository(state: Harness, found: Asset[]): AssetRepository {
    return {
        findManyByIds: () => Promise.resolve(found),
        findManyByFolderIds: () => Promise.resolve(found),
        delete: (each: Asset) => {
            state.deleted.push(String(each.id));
            return Promise.resolve();
        }
    } as unknown as AssetRepository;
}

/** A folder repository holding one folder with one descendant. */
function folderRepository(): FolderRepository {
    return {
        findByIdForUpdate: () => Promise.resolve(folder(FOLDER_ID)),
        findDescendantsForUpdate: () => Promise.resolve([folder('child-1')]),
        delete: () => Promise.resolve()
    } as unknown as FolderRepository;
}

describe('DeleteAssetsUseCase — a rolled-back deletion destroys no bytes [media:I-12]', () => {
    it('frees the blobs only once the rows are committed', async () => {
        const { state, uow, provider, outbox } = harness('commit');
        const subject = new DeleteAssetsUseCase(
            uow,
            outbox,
            assetRepository(state, ASSETS),
            provider
        );

        await expect(
            subject.execute([ASSET_ID], WORKSPACE, actor)
        ).resolves.toBe(2);

        // Nothing had been freed while the transaction was open…
        expect(state.removedAtCommit).toBe(0);
        // …and by the time it returns, the original and every derivative have
        // been. Without this half the assertion above would hold for a use case
        // that had stopped reclaiming at all.
        expect(state.removed.sort()).toEqual([
            'variants/ws/hero-thumb.webp',
            'ws/hero.png',
            'ws/notes.txt'
        ]);
    });

    it('frees nothing when the transaction rolls back', async () => {
        const { state, uow, provider, outbox } = harness('rollback');
        const subject = new DeleteAssetsUseCase(
            uow,
            outbox,
            assetRepository(state, ASSETS),
            provider
        );

        await expect(
            subject.execute([ASSET_ID], WORKSPACE, actor)
        ).rejects.toThrow('serialization failure');

        // The rows survived, so their bytes must too — a surviving row whose
        // blob is gone is a broken asset nothing can repair.
        expect(state.removed).toEqual([]);
        // The aggregates really were walked, so this is a use case that got as
        // far as having something to reclaim, not one that failed early.
        expect(state.deleted).toEqual(['asset-1', 'asset-2']);
    });
});

describe('DeleteFolderUseCase — a rolled-back cascade destroys no bytes [media:I-12]', () => {
    it('frees the subtree’s blobs only once the cascade is committed', async () => {
        const { state, uow, provider, outbox } = harness('commit');
        const subject = new DeleteFolderUseCase(
            uow,
            outbox,
            folderRepository(),
            assetRepository(state, ASSETS),
            provider
        );

        await expect(
            subject.execute(FOLDER_ID, WORKSPACE, actor)
        ).resolves.toEqual({ folders: 2, assets: 2 });

        expect(state.removedAtCommit).toBe(0);
        expect(state.removed).toHaveLength(3);
    });

    it('frees nothing when the cascade rolls back', async () => {
        // The worse of the two: a folder delete is the path that can take
        // thousands of assets with it, so an in-transaction reclaim here is a
        // whole library of broken images behind rows that are all still there.
        const { state, uow, provider, outbox } = harness('rollback');
        const subject = new DeleteFolderUseCase(
            uow,
            outbox,
            folderRepository(),
            assetRepository(state, ASSETS),
            provider
        );

        await expect(
            subject.execute(FOLDER_ID, WORKSPACE, actor)
        ).rejects.toThrow('serialization failure');

        expect(state.removed).toEqual([]);
        expect(state.deleted).toEqual(['asset-1', 'asset-2']);
    });
});
