import { Readable } from 'node:stream';
import { ObjectNotFoundError } from '@orthacms/media-domain';
import { describeStorageProvider } from '@orthacms/media-provider-testkit';
import { FakeBlobApi } from './fake-blob-api';
import { createVercelBlobStorageProvider } from './vercel-blob-storage-provider';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const ASSET = '22222222-2222-4222-8222-222222222222';

/** The blob store is fetched over HTTP, so the suite owns global fetch. */
const realFetch = globalThis.fetch;

let contractApi: FakeBlobApi | undefined;

describeStorageProvider('media-provider-vercel-blob', {
    create() {
        contractApi = new FakeBlobApi();
        globalThis.fetch = contractApi.fetch as typeof fetch;
        return createVercelBlobStorageProvider({ api: contractApi.api });
    },
    cleanup() {
        globalThis.fetch = realFetch;
    },
    storedKeys: () => contractApi?.keys() ?? []
});

describe('createVercelBlobStorageProvider', () => {
    let blobs: FakeBlobApi;

    const provider = (
        overrides: Partial<
            Parameters<typeof createVercelBlobStorageProvider>[0]
        > = {}
    ) => createVercelBlobStorageProvider({ api: blobs.api, ...overrides });

    const put = (
        subject = provider(),
        overrides: Partial<Parameters<typeof subject.put>[0]> = {}
    ) =>
        subject.put({
            workspaceId: WORKSPACE,
            assetId: ASSET,
            fileName: 'logo.png',
            contentType: 'image/png',
            body: Readable.from([Buffer.from('the bytes')]),
            ...overrides
        });

    beforeEach(() => {
        blobs = new FakeBlobApi();
        globalThis.fetch = blobs.fetch as typeof fetch;
    });
    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    it('never offers a direct URL, because the store has no private one', async () => {
        // Vercel Blob has one access mode: public. Its URL never expires and
        // carries no per-request disposition, so declaring `directUrl` would
        // hand out an unrevocable link and serve an uploaded `.html` inline
        // from the blob host. Proxying also keeps the app's membership check on
        // the request path, which is the library's actual access rule.
        const subject = provider();

        expect(subject.capabilities.directUrl).toBe(false);
        expect(subject.directUrl).toBeUndefined();
    });

    describe('put', () => {
        it('keys blobs like every other provider', async () => {
            const stored = await put();

            expect(stored.storageKey).toBe(`${WORKSPACE}/${ASSET}/logo.png`);
        });

        it('files a derivative in its own namespace', async () => {
            const stored = await put(provider(), {
                fileName: 'thumb.webp',
                isVariant: true
            });

            expect(stored.storageKey).toBe(
                `${WORKSPACE}/${ASSET}/variants/thumb.webp`
            );
        });

        it('carries the configured prefix', async () => {
            const stored = await put(provider({ keyPrefix: '/staging/' }));

            expect(stored.storageKey).toBe(
                `staging/${WORKSPACE}/${ASSET}/logo.png`
            );
        });

        it('stores under the pathname it returns, with no random suffix', async () => {
            // With the SDK's default suffix on, the blob would live somewhere
            // this adapter cannot name — and `get`/`remove` would miss every
            // object they were handed.
            const stored = await put();

            expect(blobs.keys()).toEqual([stored.storageKey]);
        });

        it('sets the content type', async () => {
            await put();

            expect(
                blobs.blobs.get(`${WORKSPACE}/${ASSET}/logo.png`)?.contentType
            ).toBe('image/png');
        });

        it('deletes the pathname when the upload fails', async () => {
            blobs.failNextPut = true;

            await expect(put()).rejects.toThrow('put failed');
            expect(blobs.deleted).toEqual([`${WORKSPACE}/${ASSET}/logo.png`]);
            expect(blobs.keys()).toEqual([]);
        });
    });

    describe('get', () => {
        it('rejects a missing blob before any stream exists', async () => {
            await expect(provider().get('no/such/blob')).rejects.toBeInstanceOf(
                ObjectNotFoundError
            );
        });

        it('rethrows a head failure that is not "missing"', async () => {
            // An expired token is an outage, not a missing file.
            blobs.headError = Object.assign(new Error('token expired'), {
                status: 403
            });

            await expect(provider().get('any/blob')).rejects.toThrow(
                'token expired'
            );
        });

        it('reports a store that answers something other than 200', async () => {
            await put();
            globalThis.fetch = (() =>
                Promise.resolve(
                    new Response(null, { status: 500, statusText: 'Boom' })
                )) as typeof fetch;

            await expect(
                provider().get(`${WORKSPACE}/${ASSET}/logo.png`)
            ).rejects.toThrow(/refused to serve.*500/);
        });
    });

    describe('verify', () => {
        it('passes when a missing pathname comes back missing', async () => {
            // There is no store-level metadata call, so a "not found" is the
            // proof that the token and the store are both good.
            await expect(provider().verify?.()).resolves.toBeUndefined();
        });

        it('fails the boot when the token is bad', async () => {
            blobs.headError = Object.assign(new Error('invalid token'), {
                status: 403
            });

            await expect(provider().verify?.()).rejects.toThrow(
                'invalid token'
            );
        });
    });
});
