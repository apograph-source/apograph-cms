import { Readable } from 'node:stream';
import { ObjectNotFoundError } from '@orthacms/media-domain';
import { describeStorageProvider } from '@orthacms/media-provider-testkit';
import { FakeS3Client } from './fake-s3-client';
import { createS3StorageProvider } from './s3-storage-provider';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const ASSET = '22222222-2222-4222-8222-222222222222';

/** Static, obviously-fake credentials. Signing is local; nothing is contacted. */
const CREDENTIALS = {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
};

/**
 * The shared port contract, against the fake client.
 *
 * This proves the adapter's own logic — keys, metering, error mapping, the
 * abort path — and nothing about S3 itself: a fake agrees with whatever the
 * code does. MinIO and one real bucket are the acceptance step, and are named
 * as required in `AGENTS.md`.
 */
describeStorageProvider('media-provider-s3 (fake client)', {
    create() {
        // One fake per case — `create` runs per case, and the kit asks the same
        // one for `storedKeys` before the next replaces it.
        contractClient = new FakeS3Client();
        return createS3StorageProvider({
            bucket: 'bucket',
            client: contractClient.asClient()
        });
    },
    storedKeys: () => contractClient?.keys() ?? []
});

let contractClient: FakeS3Client | undefined;

describe('createS3StorageProvider', () => {
    let client: FakeS3Client;

    const provider = (
        overrides: Partial<Parameters<typeof createS3StorageProvider>[0]> = {}
    ) =>
        createS3StorageProvider({
            bucket: 'bucket',
            client: client.asClient(),
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
        client = new FakeS3Client();
    });

    it('refuses to construct without a bucket', () => {
        // A blank `MEDIA_S3_BUCKET` used to reach the SDK and fail per request.
        expect(() => createS3StorageProvider({ bucket: '  ' })).toThrow(
            /requires a bucket/
        );
    });

    it('declares what an object store can do', () => {
        expect(provider().capabilities).toEqual({
            directUrl: true,
            contentTypeMetadata: true,
            streamingPut: true
        });
    });

    describe('keys', () => {
        it('are workspace- and asset-partitioned', async () => {
            const stored = await put();

            expect(stored.storageKey).toBe(`${WORKSPACE}/${ASSET}/logo.png`);
        });

        it('put a derivative in its own namespace', async () => {
            const stored = await put(provider(), {
                fileName: 'thumb.webp',
                isVariant: true
            });

            expect(stored.storageKey).toBe(
                `${WORKSPACE}/${ASSET}/variants/thumb.webp`
            );
        });

        it('carry the configured prefix', async () => {
            // How one bucket is shared between environments.
            const stored = await put(provider({ keyPrefix: '/staging/' }));

            expect(stored.storageKey).toBe(
                `staging/${WORKSPACE}/${ASSET}/logo.png`
            );
        });
    });

    describe('put', () => {
        it('measures size and sha256 itself rather than trusting the response', async () => {
            // `ETag` is not a sha256, and for a multipart object it is not even
            // an MD5 — but the core persists both and the reclaim path trusts
            // them.
            const body = Buffer.from('the bytes');

            const stored = await put(provider(), {
                body: Readable.from([body])
            });

            expect(stored.size).toBe(body.byteLength);
            expect(stored.checksum).toMatch(/^[0-9a-f]{64}$/);
        });

        it('sets the object content type', async () => {
            await put();

            expect(
                client.objects.get(`${WORKSPACE}/${ASSET}/logo.png`)
                    ?.contentType
            ).toBe('image/png');
        });

        it('fails rather than hanging when the source errors mid-stream', async () => {
            // The source is piped into a meter that `lib-storage` reads. If the
            // error is not forwarded, `Upload` waits forever on a stream that
            // will never end — a request that never answers, which is worse
            // than a failed upload.
            const body = new Readable({
                read() {
                    this.destroy(new Error('source died'));
                }
            });

            await expect(put(provider(), { body })).rejects.toThrow(
                'source died'
            );
            expect(client.keys()).toEqual([]);
        });
    });

    describe('get', () => {
        it('maps a missing key to the port error', async () => {
            await expect(provider().get('no/such/key')).rejects.toBeInstanceOf(
                ObjectNotFoundError
            );
        });

        it('rethrows anything that is not a missing key', async () => {
            // A permission error dressed as a 404 would hide an outage behind a
            // plausible answer — and tell the caller the object is absent when
            // it is right there.
            const denied = Object.assign(new Error('AccessDenied'), {
                name: 'AccessDenied',
                $metadata: { httpStatusCode: 403 }
            });
            const failing = {
                send: () => Promise.reject(denied)
            } as unknown as ReturnType<FakeS3Client['asClient']>;

            const subject = createS3StorageProvider({
                bucket: 'bucket',
                client: failing
            });

            await expect(subject.get('any/key')).rejects.toThrow(
                'AccessDenied'
            );
            await expect(subject.get('any/key')).rejects.not.toBeInstanceOf(
                ObjectNotFoundError
            );
        });
    });

    describe('remove', () => {
        it('deletes the object', async () => {
            const stored = await put();

            await provider().remove(stored.storageKey);

            expect(client.keys()).toEqual([]);
        });

        it('swallows a 404 from a gateway that answers one', async () => {
            // S3 itself answers 204 for a key that was never there; some
            // compatible gateways answer 404. Reclaim is post-commit and
            // best-effort, so neither may raise.
            const missing = Object.assign(new Error('NoSuchKey'), {
                name: 'NoSuchKey',
                $metadata: { httpStatusCode: 404 }
            });
            const subject = createS3StorageProvider({
                bucket: 'bucket',
                client: {
                    send: () => Promise.reject(missing)
                } as unknown as ReturnType<FakeS3Client['asClient']>
            });

            await expect(subject.remove('gone')).resolves.toBeUndefined();
        });
    });

    describe('directUrl', () => {
        // A real client, because signing is local computation — no network, no
        // valid credentials needed.
        const signing = () =>
            createS3StorageProvider({
                bucket: 'bucket',
                region: 'auto',
                endpoint: 'https://account.r2.cloudflarestorage.com',
                forcePathStyle: true,
                credentials: CREDENTIALS
            });

        it('pins the disposition and content type on the URL', async () => {
            // This is the whole reason the provider may declare the capability.
            // A redirect discards the app's `Content-Disposition`, `nosniff`
            // and CSP, and `mime_type` is the uploader's own claim — an
            // uploaded `.html` served inline from the bucket is stored XSS.
            const url = await signing().directUrl?.('ws/asset/report.html', {
                disposition: 'attachment',
                fileName: 'report.html',
                contentType: 'text/html',
                expiresInSeconds: 60
            });

            expect(url).toContain(
                'response-content-disposition=attachment%3B%20filename%3D%22report.html%22'
            );
            expect(url).toContain('response-content-type=text%2Fhtml');
        });

        it('signs for the requested lifetime', async () => {
            const url = await signing().directUrl?.('ws/asset/logo.png', {
                disposition: 'inline',
                fileName: 'logo.png',
                contentType: 'image/png',
                expiresInSeconds: 120
            });

            expect(url).toContain('X-Amz-Expires=120');
            expect(url).toContain('X-Amz-Signature=');
        });

        it('strips quotes from the file name, which would break the header', async () => {
            const url = await signing().directUrl?.('ws/asset/odd.png', {
                disposition: 'attachment',
                fileName: 'a"b.png',
                contentType: 'image/png',
                expiresInSeconds: 60
            });

            expect(url).toContain('filename%3D%22ab.png%22');
        });
    });

    describe('verify', () => {
        it('heads the bucket', async () => {
            await provider().verify?.();

            expect(client.sent).toEqual(['HeadBucketCommand']);
        });

        it('fails for a bucket that is not there', async () => {
            // At boot, so a wrong bucket stops the server rather than the first
            // upload hours later.
            const subject = createS3StorageProvider({
                bucket: 'typo',
                client: client.asClient()
            });

            await expect(subject.verify?.()).rejects.toThrow(/NotFound/);
        });
    });
});
