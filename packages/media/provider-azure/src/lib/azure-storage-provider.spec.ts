import { Readable } from 'node:stream';
import { ObjectNotFoundError } from '@orthacms/media-domain';
import { describeStorageProvider } from '@orthacms/media-provider-testkit';
import { FakeContainerClient } from './fake-container-client';
import { createAzureStorageProvider } from './azure-storage-provider';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const ASSET = '22222222-2222-4222-8222-222222222222';

/** Azurite's published development key — public, and never a real secret. */
const DEV_KEY =
    'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

let contractContainer: FakeContainerClient | undefined;

/** The shared port contract, against the injected container client. */
describeStorageProvider('media-provider-azure', {
    create() {
        contractContainer = new FakeContainerClient();
        return createAzureStorageProvider({
            container: 'media',
            containerClient: contractContainer.asContainerClient()
        });
    },
    storedKeys: () => contractContainer?.keys() ?? []
});

describe('createAzureStorageProvider', () => {
    let container: FakeContainerClient;

    const provider = (
        overrides: Partial<
            Parameters<typeof createAzureStorageProvider>[0]
        > = {}
    ) =>
        createAzureStorageProvider({
            container: 'media',
            containerClient: container.asContainerClient(),
            ...overrides
        });

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
        container = new FakeContainerClient();
    });

    describe('construction', () => {
        it('refuses an empty container name', () => {
            expect(() =>
                createAzureStorageProvider({ container: ' ' })
            ).toThrow(/requires a container/);
        });

        it('refuses to construct with no credentials at all', () => {
            // Left to the SDK this fails per request, with a message naming
            // neither the setting nor the account.
            expect(() =>
                createAzureStorageProvider({ container: 'media' })
            ).toThrow(/needs credentials/);
        });

        it('accepts an account name and key', () => {
            expect(() =>
                createAzureStorageProvider({
                    container: 'media',
                    accountName: 'devstoreaccount1',
                    accountKey: DEV_KEY
                })
            ).not.toThrow();
        });
    });

    describe('capabilities', () => {
        it('cannot sign without a shared key, and says so', () => {
            // A managed-identity deployment passes its own container client and
            // has no key to sign a SAS with. Declaring `directUrl: true` here
            // would let `MediaServerPlugin` accept `directServe: 'signed-url'`
            // on a deployment that cannot honour it, and the failure would land
            // per request instead of at boot.
            const subject = provider();

            expect(subject.capabilities.directUrl).toBe(false);
            expect(subject.directUrl).toBeUndefined();
        });

        it('can sign when given an account key', () => {
            const subject = createAzureStorageProvider({
                container: 'media',
                accountName: 'devstoreaccount1',
                accountKey: DEV_KEY
            });

            expect(subject.capabilities.directUrl).toBe(true);
            expect(typeof subject.directUrl).toBe('function');
        });

        it('always keeps the content type — a container has somewhere for it', () => {
            expect(provider().capabilities.contentTypeMetadata).toBe(true);
        });
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

        it('sets the blob content type', async () => {
            await put();

            expect(
                container.blobs.get(`${WORKSPACE}/${ASSET}/logo.png`)
                    ?.contentType
            ).toBe('image/png');
        });

        it('deletes the blob when the upload fails, clearing uncommitted blocks', async () => {
            // A failed block upload leaves uncommitted blocks charged to the
            // account and invisible to a listing — and the key never reached a
            // caller, so nothing else can reclaim them.
            container.failNextUpload = true;

            await expect(put()).rejects.toThrow('upload failed');
            expect(container.deleted).toEqual([
                `${WORKSPACE}/${ASSET}/logo.png`
            ]);
            expect(container.keys()).toEqual([]);
        });

        it('fails rather than hanging when the source errors mid-stream', async () => {
            const body = new Readable({
                read() {
                    this.destroy(new Error('source died'));
                }
            });

            await expect(put(provider(), { body })).rejects.toThrow(
                'source died'
            );
        });
    });

    describe('get', () => {
        it('maps a missing blob to the port error', async () => {
            await expect(provider().get('no/such/blob')).rejects.toBeInstanceOf(
                ObjectNotFoundError
            );
        });

        it('rethrows anything that is not a missing blob', async () => {
            // A throttled or unauthorized account is an outage, and dressing it
            // as a 404 would hide it behind a plausible answer.
            const throttled = Object.assign(new Error('ServerBusy'), {
                statusCode: 503
            });
            const failing = {
                containerName: 'media',
                getBlockBlobClient: () => ({
                    download: () => Promise.reject(throttled)
                })
            } as unknown as ReturnType<
                FakeContainerClient['asContainerClient']
            >;

            await expect(
                createAzureStorageProvider({
                    container: 'media',
                    containerClient: failing
                }).get('any/blob')
            ).rejects.toThrow('ServerBusy');
        });
    });

    describe('directUrl', () => {
        const signing = () =>
            createAzureStorageProvider({
                container: 'media',
                accountName: 'devstoreaccount1',
                accountKey: DEV_KEY
            });

        it('pins the disposition and content type into the SAS', async () => {
            // The reason this provider may declare the capability at all.
            const url = await signing().directUrl?.('ws/asset/report.html', {
                disposition: 'attachment',
                fileName: 'report.html',
                contentType: 'text/html',
                expiresInSeconds: 60
            });

            expect(url).toContain('rscd=attachment');
            expect(url).toContain('report.html');
            expect(url).toContain('rsct=text%2Fhtml');
            expect(url).toContain('sig=');
        });

        it('strips quotes that would break the header', async () => {
            const url = await signing().directUrl?.('ws/asset/odd.png', {
                disposition: 'attachment',
                fileName: 'a"b.png',
                contentType: 'image/png',
                expiresInSeconds: 60
            });

            // The surviving `%22` pair is the quoting we add around the file
            // name; what must be gone is the quote that was *inside* it, which
            // would otherwise close the header value early.
            expect(url).toContain('filename%3D%22ab.png%22');
            expect(url).not.toContain('a%22b');
        });
    });

    describe('verify', () => {
        it('reads the container properties', async () => {
            await expect(provider().verify?.()).resolves.toBeUndefined();
        });

        it('fails at boot for a container that is not there', async () => {
            container.exists = false;

            await expect(provider().verify?.()).rejects.toThrow(/BlobNotFound/);
        });
    });
});
