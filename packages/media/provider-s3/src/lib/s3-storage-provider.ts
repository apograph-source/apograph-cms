import { createHash } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    S3Client,
    type S3ClientConfig
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ObjectNotFoundError } from '@orthacms/media-domain';
import type {
    DirectUrlOptions,
    PutObject,
    StorageProvider,
    StoredObject
} from '@orthacms/media-domain';

/**
 * Settings for an **S3-compatible** object store.
 *
 * Written endpoint-first rather than AWS-first on purpose: `endpoint` plus
 * `forcePathStyle` is the whole difference between AWS S3, Cloudflare R2,
 * MinIO, DigitalOcean Spaces, Backblaze B2, Wasabi, Scaleway, Hetzner, Supabase
 * Storage and Tigris. One adapter, ten services — which is why this is one
 * package and not ten.
 */
export interface S3StorageConfig {
    /** Bucket every object lands in. */
    bucket: string;
    /**
     * Region. Required by AWS; most S3-compatible services ignore it but the
     * signer still needs a value, so it defaults to `auto` (what R2 expects).
     */
    region?: string;
    /**
     * Full endpoint URL for a non-AWS service — e.g.
     * `https://<account>.r2.cloudflarestorage.com`, or `http://localhost:9000`
     * for MinIO. Omit for AWS S3 itself.
     */
    endpoint?: string;
    /**
     * Address objects as `<endpoint>/<bucket>/<key>` rather than
     * `<bucket>.<endpoint>/<key>`. Required by MinIO and most self-hosted
     * gateways; harmless for R2.
     */
    forcePathStyle?: boolean;
    /**
     * Explicit credentials. **Omit them** on a deployment with an instance
     * role, IRSA or any other ambient credential source — the SDK's own
     * provider chain is what should resolve those, and passing blanks here
     * would shadow it with credentials that cannot sign.
     */
    credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
    };
    /** Prefix every key with this, e.g. to share a bucket between environments. */
    keyPrefix?: string;
    /**
     * An already-built client, for a deployment that needs custom middleware,
     * a proxy agent or a retry strategy — and for tests, which drive this
     * adapter against a stub rather than a network.
     *
     * When present, every other connection setting here is ignored: the client
     * carries them.
     */
    client?: S3Client;
}

/** How many bytes one multipart part carries. The SDK's own minimum is 5 MB. */
const PART_SIZE = 5 * 1024 * 1024;

/** How many parts are in flight at once for one upload. */
const QUEUE_SIZE = 4;

/** Reduces a file name to one safe key segment. Mirrors the other providers. */
function sanitize(fileName: string): string {
    const cleaned = fileName.replace(/[^A-Za-z0-9_.-]+/g, '_');
    // `.` and `..` survive the character class and are not names. S3 keys are
    // opaque strings so neither would traverse anything — but a key that
    // round-trips differently between two providers is a key the core cannot
    // treat as opaque, and `..` in a key breaks most bucket browsers.
    return cleaned === '.' || cleaned === '..' ? `_${cleaned}` : cleaned;
}

/** True for the several ways this family of services says "no such object". */
function isMissing(error: unknown): boolean {
    const candidate = error as {
        name?: string;
        Code?: string;
        $metadata?: { httpStatusCode?: number };
    };
    return (
        candidate?.name === 'NoSuchKey' ||
        candidate?.name === 'NotFound' ||
        candidate?.Code === 'NoSuchKey' ||
        candidate?.$metadata?.httpStatusCode === 404
    );
}

/**
 * The S3-compatible {@link StorageProvider}.
 *
 * Three things here are load-bearing and easy to lose in a refactor:
 *
 * 1. **`put` is all-or-nothing.** A multipart upload that fails leaves parts
 *    billed and invisible, and the key never reached a caller — so nothing can
 *    reclaim them. The `catch` aborts the upload, which is what removes them.
 * 2. **size and checksum are measured here, not taken from the response.** The
 *    core persists both and the reclaim path trusts them; `ETag` is not a
 *    sha256 and is not even an MD5 for a multipart object.
 * 3. **`get` rejects with `ObjectNotFoundError`**, mapped from the several
 *    shapes this family of services uses. A raw `NoSuchKey` escaping makes a
 *    missing blob a 500 where the route means to answer 404.
 */
export function createS3StorageProvider(
    config: S3StorageConfig
): StorageProvider {
    if (!config.bucket?.trim()) {
        throw new Error(
            'createS3StorageProvider requires a bucket. Set it in the host config, ' +
                'e.g. `storage: { bucket: process.env.MEDIA_S3_BUCKET }`.'
        );
    }

    const clientConfig: S3ClientConfig = {
        region: config.region ?? 'auto',
        ...(config.endpoint ? { endpoint: config.endpoint } : {}),
        ...(config.forcePathStyle ? { forcePathStyle: true } : {}),
        // Absent means "use the SDK's provider chain" — an instance role, IRSA,
        // a shared config file. Passing an object with blank strings instead
        // would shadow all of that with credentials that cannot sign.
        ...(config.credentials ? { credentials: config.credentials } : {})
    };
    const client = config.client ?? new S3Client(clientConfig);
    const bucket = config.bucket;
    const prefix = config.keyPrefix?.replace(/^\/+|\/+$/g, '');

    const keyFor = (object: PutObject): string =>
        [
            prefix,
            object.workspaceId,
            object.assetId,
            object.isVariant ? 'variants' : undefined,
            sanitize(object.fileName)
        ]
            .filter(Boolean)
            .join('/');

    return {
        id: 's3',
        capabilities: {
            directUrl: true,
            contentTypeMetadata: true,
            streamingPut: true
        },

        async put(object: PutObject): Promise<StoredObject> {
            const storageKey = keyFor(object);

            // Metered on the way through rather than buffered: an upload is
            // bounded by `maxUploadBytes`, not by the heap, and `lib-storage`
            // streams it in parts.
            const hash = createHash('sha256');
            let size = 0;
            const meter = new PassThrough();
            meter.on('data', (chunk: Buffer) => {
                hash.update(chunk);
                size += chunk.byteLength;
            });
            object.body.pipe(meter);
            // A source that fails mid-stream must fail the upload, not stall
            // it: `Upload` is waiting on a stream that will never end.
            object.body.on('error', (error) => meter.destroy(error));

            const upload = new Upload({
                client,
                partSize: PART_SIZE,
                queueSize: QUEUE_SIZE,
                params: {
                    Bucket: bucket,
                    Key: storageKey,
                    Body: meter,
                    // The object metadata is what makes `contentTypeMetadata`
                    // true here and false for a filesystem. It is the
                    // uploader's own claim, so the download route still
                    // hardens the response; this only keeps the object
                    // self-describing for anything reading the bucket directly.
                    ContentType: object.contentType
                }
            });

            try {
                await upload.done();
            } catch (error) {
                // Without this the failed multipart upload's parts sit in the
                // bucket, billed, invisible to `ListObjects`, and unreachable:
                // the key was never returned, so nothing can reclaim them.
                await upload.abort().catch(() => undefined);
                throw error;
            }

            return { storageKey, size, checksum: hash.digest('hex') };
        },

        async get(storageKey: string): Promise<Readable> {
            try {
                const response = await client.send(
                    new GetObjectCommand({ Bucket: bucket, Key: storageKey })
                );
                if (!response.Body) {
                    throw new ObjectNotFoundError(storageKey);
                }
                return response.Body as Readable;
            } catch (error) {
                if (isMissing(error)) {
                    throw new ObjectNotFoundError(storageKey, error);
                }
                throw error;
            }
        },

        async remove(storageKey: string): Promise<void> {
            try {
                await client.send(
                    new DeleteObjectCommand({ Bucket: bucket, Key: storageKey })
                );
            } catch (error) {
                // S3 answers 204 for a key that was never there, so this is
                // already idempotent — but a gateway that answers 404 instead
                // must not turn a best-effort, post-commit reclaim into an
                // error nobody can act on.
                if (!isMissing(error)) throw error;
            }
        },

        async directUrl(
            storageKey: string,
            options: DirectUrlOptions
        ): Promise<string> {
            // The disposition and content type are **pinned on the URL**, not
            // left to the object's metadata. A redirect discards the app's own
            // `Content-Disposition`, `nosniff` and CSP, and `mime_type` is the
            // uploader's unverified claim — so an uploaded `.html` served
            // inline from the bucket would be stored XSS. These two response
            // overrides are the whole reason this provider may declare
            // `capabilities.directUrl`.
            const fileName = options.fileName.replace(/"/g, '');
            return getSignedUrl(
                client,
                new GetObjectCommand({
                    Bucket: bucket,
                    Key: storageKey,
                    ResponseContentDisposition: `${options.disposition}; filename="${fileName}"`,
                    ResponseContentType: options.contentType
                }),
                { expiresIn: options.expiresInSeconds }
            );
        },

        async verify(): Promise<void> {
            // One HEAD at boot. A wrong bucket, a dead endpoint or an expired
            // key fails the start instead of the first upload, hours later,
            // with nothing in the message naming the cause.
            await client.send(new HeadBucketCommand({ Bucket: bucket }));
        }
    };
}
