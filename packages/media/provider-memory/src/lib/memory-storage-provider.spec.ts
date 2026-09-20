import { Readable } from 'node:stream';
import { describeStorageProvider } from '@orthacms/media-provider-testkit';
import {
    createMemoryStorageProvider,
    MemoryStoreFullError,
    type MemoryStorageProvider
} from './memory-storage-provider';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const ASSET = '22222222-2222-4222-8222-222222222222';

/** The shared port contract — the same suite `provider-local` is held to. */
describeStorageProvider('media-provider-memory', {
    create: () => createMemoryStorageProvider(),
    storedKeys: (provider) => (provider as MemoryStorageProvider).keys()
});

describe('createMemoryStorageProvider', () => {
    let provider: MemoryStorageProvider;

    beforeEach(() => {
        provider = createMemoryStorageProvider();
    });

    const put = (
        overrides: Partial<Parameters<MemoryStorageProvider['put']>[0]> = {}
    ) =>
        provider.put({
            workspaceId: WORKSPACE,
            assetId: ASSET,
            fileName: 'logo.png',
            contentType: 'image/png',
            body: Readable.from([Buffer.from('the bytes')]),
            ...overrides
        });

    it('keys blobs the way the filesystem provider does', async () => {
        // Not required by the port — a key is opaque — but a key that reads the
        // same in both providers is what makes a `storage_key` in a dump
        // legible, and what lets an e2e assertion be shared.
        const stored = await put();

        expect(stored.storageKey).toBe(`${WORKSPACE}/${ASSET}/logo.png`);
    });

    it('files a derivative under its own namespace', async () => {
        const variant = await put({ fileName: 'thumb.webp', isVariant: true });

        expect(variant.storageKey).toBe(
            `${WORKSPACE}/${ASSET}/variants/thumb.webp`
        );
    });

    it('sanitizes a name that would otherwise change the key shape', async () => {
        const stored = await put({ fileName: 'a/../b .png' });

        expect(stored.storageKey).toBe(`${WORKSPACE}/${ASSET}/a_.._b_.png`);
    });

    it('keeps the content type — which is why it declares that capability', async () => {
        expect(provider.capabilities.contentTypeMetadata).toBe(true);
    });

    describe('inspection', () => {
        it('reports the keys it holds, sorted', async () => {
            await put({ fileName: 'b.png' });
            await put({ fileName: 'a.png' });

            expect(provider.keys()).toEqual([
                `${WORKSPACE}/${ASSET}/a.png`,
                `${WORKSPACE}/${ASSET}/b.png`
            ]);
        });

        it('reports the bytes it holds', async () => {
            await put();

            expect(provider.totalBytes()).toBe('the bytes'.length);
        });

        it('clears every blob', async () => {
            await put();

            provider.clear();

            expect(provider.keys()).toEqual([]);
            expect(provider.totalBytes()).toBe(0);
        });
    });

    describe('the size limit', () => {
        it('rejects a put that would exceed it, and stores nothing', async () => {
            // A test that uploads more than it meant to should fail as a test,
            // not as an out-of-memory kill that takes the whole run with it.
            const tiny = createMemoryStorageProvider({ maxTotalBytes: 8 });

            await expect(
                tiny.put({
                    workspaceId: WORKSPACE,
                    assetId: ASSET,
                    fileName: 'big.bin',
                    contentType: 'application/octet-stream',
                    body: Readable.from([Buffer.alloc(9)])
                })
            ).rejects.toBeInstanceOf(MemoryStoreFullError);
            expect(tiny.keys()).toEqual([]);
        });

        it('counts what is already stored, not just the incoming blob', async () => {
            const tiny = createMemoryStorageProvider({ maxTotalBytes: 10 });
            const one = (name: string) =>
                tiny.put({
                    workspaceId: WORKSPACE,
                    assetId: ASSET,
                    fileName: name,
                    contentType: 'application/octet-stream',
                    body: Readable.from([Buffer.alloc(6)])
                });

            await one('first.bin');

            await expect(one('second.bin')).rejects.toBeInstanceOf(
                MemoryStoreFullError
            );
        });
    });
});
