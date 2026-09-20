import { Readable } from 'node:stream';
import { ObjectNotFoundError } from '@orthacms/media-domain';
import { describeStorageProvider } from '@orthacms/media-provider-testkit';
import { FakeBucket } from './fake-bucket';
import { createGcsStorageProvider } from './gcs-storage-provider';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const ASSET = '22222222-2222-4222-8222-222222222222';

let contractBucket: FakeBucket | undefined;

/** The shared port contract, against the injected bucket handle. */
describeStorageProvider('media-provider-gcs', {
    create() {
        contractBucket = new FakeBucket();
        return createGcsStorageProvider({
            bucket: 'media',
            bucketClient: contractBucket.asBucket()
        });
    },
    storedKeys: () => contractBucket?.keys() ?? []
});

describe('createGcsStorageProvider', () => {
    let bucket: FakeBucket;

    const provider = (
        overrides: Partial<Parameters<typeof createGcsStorageProvider>[0]> = {}
    ) =>
        createGcsStorageProvider({
            bucket: 'media',
            bucketClient: bucket.asBucket(),
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
        bucket = new FakeBucket();
    });

    it('refuses an empty bucket name', () => {
        expect(() => createGcsStorageProvider({ bucket: ' ' })).toThrow(
            /requires a bucket/
        );
    });

    describe('capabilities', () => {
        it('cannot sign under bare Application Default Credentials', () => {
            // ADC can read and write, but it holds no private key. Declaring
            // `directUrl: true` here would let a deployment enable signed-URL
            // serving that fails at request time instead of at boot.
            expect(provider().capabilities.directUrl).toBe(false);
            expect(provider().directUrl).toBeUndefined();
        });

        it('can sign with service-account credentials', () => {
            const subject = provider({
                credentials: {
                    client_email: 'svc@example.iam.gserviceaccount.com',
                    private_key: 'unused-by-the-fake'
                }
            });

            expect(subject.capabilities.directUrl).toBe(true);
        });

        it('can sign when IAM signBlob is opted into', () => {
            // How a Workload Identity deployment signs: no key, IAM signs for
            // it. Opt-in, because it needs `iam.serviceAccounts.signBlob` and
            // assuming it would mint URLs that fail.
            expect(provider({ signWithIam: true }).capabilities.directUrl).toBe(
                true
            );
        });
    });

    describe('put', () => {
        it('keys objects like every other provider', async () => {
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

        it('sets the object content type', async () => {
            await put();

            expect(
                bucket.objects.get(`${WORKSPACE}/${ASSET}/logo.png`)
                    ?.contentType
            ).toBe('image/png');
        });

        it('deletes the object when the upload fails part-way', async () => {
            // A resumable upload that dies leaves an incomplete object the
            // bucket keeps until a lifecycle rule sweeps it — and the key never
            // reached a caller, so nothing else can reclaim it.
            bucket.failNextUpload = true;

            await expect(put()).rejects.toThrow('upload failed');
            expect(bucket.deleted).toEqual([`${WORKSPACE}/${ASSET}/logo.png`]);
            expect(bucket.keys()).toEqual([]);
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
        it('rejects before opening the stream, not on it', async () => {
            // `createReadStream` opens lazily, so a missing object would
            // otherwise surface once the response is already a streaming 200
            // that can no longer become a 404. The metadata read buys that back.
            await expect(
                provider().get('no/such/object')
            ).rejects.toBeInstanceOf(ObjectNotFoundError);
        });

        it('rethrows anything that is not a missing object', async () => {
            const denied = Object.assign(new Error('Forbidden'), { code: 403 });
            const failing = {
                file: () => ({ getMetadata: () => Promise.reject(denied) })
            } as unknown as ReturnType<FakeBucket['asBucket']>;

            await expect(
                createGcsStorageProvider({
                    bucket: 'media',
                    bucketClient: failing
                }).get('any/object')
            ).rejects.toThrow('Forbidden');
        });
    });

    describe('directUrl', () => {
        it('pins the disposition and content type onto the signed URL', async () => {
            const subject = provider({ signWithIam: true });

            await subject.directUrl?.('ws/asset/report.html', {
                disposition: 'attachment',
                fileName: 'report.html',
                contentType: 'text/html',
                expiresInSeconds: 60
            });

            expect(bucket.lastSignedUrlOptions).toMatchObject({
                version: 'v4',
                action: 'read',
                responseDisposition: 'attachment; filename="report.html"',
                responseType: 'text/html'
            });
        });

        it('strips a quote that would close the header early', async () => {
            const subject = provider({ signWithIam: true });

            await subject.directUrl?.('ws/asset/odd.png', {
                disposition: 'attachment',
                fileName: 'a"b.png',
                contentType: 'image/png',
                expiresInSeconds: 60
            });

            expect(bucket.lastSignedUrlOptions).toMatchObject({
                responseDisposition: 'attachment; filename="ab.png"'
            });
        });
    });

    describe('verify', () => {
        it('reads the bucket metadata', async () => {
            await expect(provider().verify?.()).resolves.toBeUndefined();
        });

        it('fails at boot for a bucket that is not there', async () => {
            bucket.exists = false;

            await expect(provider().verify?.()).rejects.toThrow(
                /No such object/
            );
        });
    });
});
