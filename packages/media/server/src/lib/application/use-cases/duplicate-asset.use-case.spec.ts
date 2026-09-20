import type { OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import type { Asset } from '../../domain/asset';
import type { AssetRepository } from '../../domain/asset.repository';
import type { StorageProvider } from '@orthacms/media-domain';
import { AssetNotFoundError } from '../../domain/errors/asset-not-found.error';
import { DuplicateAssetUseCase } from './duplicate-asset.use-case';

const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const actor = { id: 'user-1' } as unknown as PublicUser;

/** A source asset the guard reads before anything touches storage. */
function source(storageProvider: string): Asset {
    return {
        name: { value: 'logo.png' },
        storageProvider
    } as unknown as Asset;
}

function useCase(found: Asset | null, providerId = 'local') {
    const calls = { get: 0, put: 0 };
    const provider = {
        id: providerId,
        capabilities: {
            directUrl: false,
            contentTypeMetadata: false,
            streamingPut: true
        },
        get: () => {
            calls.get++;
            return Promise.reject(new Error('should not be reached'));
        },
        put: () => {
            calls.put++;
            return Promise.reject(new Error('should not be reached'));
        }
    } as unknown as StorageProvider;
    const assets = {
        findById: () => Promise.resolve(found)
    } as unknown as AssetRepository;
    const uow = {
        run: () => Promise.reject(new Error('should not be reached'))
    } as unknown as UnitOfWork;
    const outbox = {} as unknown as OutboxWriter;

    return {
        calls,
        subject: new DuplicateAssetUseCase(uow, outbox, provider, assets)
    };
}

describe('DuplicateAssetUseCase', () => {
    it('reports a missing source asset', async () => {
        const { subject } = useCase(null);

        await expect(
            subject.execute(ASSET_ID, WORKSPACE, actor)
        ).rejects.toBeInstanceOf(AssetNotFoundError);
    });

    it('refuses a source written by another provider before touching storage', async () => {
        // The copy reads and writes through the same provider, so this would
        // otherwise hand `get` a key that means nothing here — and the failure
        // would land mid-copy, after a blob had already been written.
        const { subject, calls } = useCase(source('s3'), 'local');

        await expect(
            subject.execute(ASSET_ID, WORKSPACE, actor)
        ).rejects.toThrow(/stored by provider "s3".*runs "local"/s);
        expect(calls).toEqual({ get: 0, put: 0 });
    });
});
