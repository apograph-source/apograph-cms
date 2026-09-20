import { createHash } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Storage, type Bucket } from '@google-cloud/storage';
import { ObjectNotFoundError } from '@orthacms/media-domain';
import type {
    DirectUrlOptions,
    PutObject,
    StorageProvider,
    StoredObject
} from '@orthacms/media-domain';

/**
 * Settings for Google Cloud Storage.
 *
 * **You may not need this package.** GCS speaks the S3 XML API in
 * interoperability mode, so `@orthacms/media-provider-s3` reaches it today with
 * `endpoint: 'https://storage.googleapis.com'` and an HMAC key. This adapter
 * exists for the deployment that cannot use that: HMAC keys are a long-lived
 * secret that many organizations forbid by policy, and they rule out Workload
 * Identity. Native GCS auth is the reason to be here — if you are happy with an
 * HMAC key, the S3 adapter is one less package to keep.
 */
export interface GcsStorageConfig {
    /** Bucket every object lands in. */
    bucket: string;
    /** Project the bucket belongs to. Optional under ADC. */
    projectId?: string;
    /** Path to a service-account key file. */
    keyFilename?: string;
    /** Inline service-account credentials, when a file is not an option. */
    credentials?: { client_email: string; private_key: string };
    /** Prefix every object name with this, e.g. to share a bucket. */
    keyPrefix?: string;
    /**
     * Sign URLs through the IAM `signBlob` API instead of a local private key.
     *
     * This is how a Workload Identity deployment signs: it has no key, and the
     * library asks IAM to sign for it. Opt-in because it needs the
     * `iam.serviceAccounts.signBlob` permission — declaring the capability
     * without it would mean minting URLs that fail at request time.
     */
    signWithIam?: boolean;
    /** An already-built bucket handle — custom auth, or a test stub. */
    bucketClient?: Bucket;
}

/** Reduces a file name to one safe key segment. Mirrors the other providers. */
function sanitize(fileName: string): string {
    const cleaned = fileName.replace(/[^A-Za-z0-9_.-]+/g, '_');
    return cleaned === '.' || cleaned === '..' ? `_${cleaned}` : cleaned;
}

/** True for the shapes GCS uses to say "no such object". */
function isMissing(error: unknown): boolean {
    const candidate = error as { code?: number | string; status?: number };
    return (
        candidate?.code === 404 ||
        candidate?.status === 404 ||
        candidate?.code === 'ENOENT'
    );
}

/**
 * The Google Cloud Storage {@link StorageProvider}.
 *
 * Like the Azure adapter, `capabilities.directUrl` is **computed**: signing
 * needs either a private key or an explicit opt-in to IAM `signBlob`, and a
 * bare Application Default Credentials deployment has neither. A hardcoded
 * `true` would let `MediaServerPlugin` accept `directServe: 'signed-url'` on a
 * deployment that cannot honour it.
 */
export function createGcsStorageProvider(
    config: GcsStorageConfig
): StorageProvider {
    if (!config.bucket?.trim()) {
        throw new Error('createGcsStorageProvider requires a bucket name.');
    }

    const bucket =
        config.bucketClient ??
        new Storage({
            ...(config.projectId ? { projectId: config.projectId } : {}),
            ...(config.keyFilename ? { keyFilename: config.keyFilename } : {}),
            ...(config.credentials ? { credentials: config.credentials } : {})
        }).bucket(config.bucket);

    const prefix = config.keyPrefix?.replace(/^\/+|\/+$/g, '');
    const canSign = Boolean(
        config.keyFilename || config.credentials || config.signWithIam
    );

    return {
        id: 'gcs',
        capabilities: {
            directUrl: canSign,
            contentTypeMetadata: true,
            streamingPut: true
        },

        async put(object: PutObject): Promise<StoredObject> {
            const storageKey = [
                prefix,
                object.workspaceId,
                object.assetId,
                object.isVariant ? 'variants' : undefined,
                sanitize(object.fileName)
            ]
                .filter(Boolean)
                .join('/');

            const hash = createHash('sha256');
            let size = 0;
            const meter = new PassThrough();
            meter.on('data', (chunk: Buffer) => {
                hash.update(chunk);
                size += chunk.byteLength;
            });

            const file = bucket.file(storageKey);
            try {
                // `pipeline` rather than hand-wired events: it propagates a
                // source error into the write stream and destroys both, which
                // is what stops a dead upload hanging on a stream that will
                // never end.
                await pipeline(
                    object.body,
                    meter,
                    file.createWriteStream({
                        resumable: true,
                        contentType: object.contentType
                    })
                );
            } catch (error) {
                // A resumable upload that dies part-way leaves an incomplete
                // object the bucket will keep until its lifecycle rules sweep
                // it — and the key never reached a caller, so nothing else can
                // reclaim it.
                await file
                    .delete({ ignoreNotFound: true })
                    .catch(() => undefined);
                throw error;
            }

            return { storageKey, size, checksum: hash.digest('hex') };
        },

        async get(storageKey: string): Promise<Readable> {
            const file = bucket.file(storageKey);
            // The metadata read is deliberate. `createReadStream` opens lazily,
            // so a missing object surfaces as an error *on the stream* — by
            // which point the response is already a streaming 200 that can no
            // longer become the 404 the route owes the caller. One HEAD-shaped
            // call buys that back.
            try {
                await file.getMetadata();
            } catch (error) {
                if (isMissing(error)) {
                    throw new ObjectNotFoundError(storageKey, error);
                }
                throw error;
            }
            return file.createReadStream() as Readable;
        },

        async remove(storageKey: string): Promise<void> {
            // Idempotent by flag; the catch covers a gateway that answers 404
            // anyway, since reclaim is post-commit and best-effort.
            try {
                await bucket.file(storageKey).delete({ ignoreNotFound: true });
            } catch (error) {
                if (!isMissing(error)) throw error;
            }
        },

        ...(canSign
            ? {
                  async directUrl(
                      storageKey: string,
                      options: DirectUrlOptions
                  ): Promise<string> {
                      // Same rule as every signing provider: the disposition
                      // and content type are pinned onto the URL, because the
                      // redirect discards the app's own headers and the stored
                      // MIME type is the uploader's claim.
                      const fileName = options.fileName.replace(/"/g, '');
                      const [url] = await bucket.file(storageKey).getSignedUrl({
                          version: 'v4',
                          action: 'read',
                          expires: Date.now() + options.expiresInSeconds * 1000,
                          responseDisposition: `${options.disposition}; filename="${fileName}"`,
                          responseType: options.contentType
                      });
                      return url;
                  }
              }
            : {}),

        async verify(): Promise<void> {
            // A wrong bucket or a credential that cannot see it fails the boot
            // rather than the first upload.
            await bucket.getMetadata();
        }
    };
}
