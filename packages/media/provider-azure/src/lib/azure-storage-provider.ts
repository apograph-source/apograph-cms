import { createHash } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import {
    BlobSASPermissions,
    BlobServiceClient,
    generateBlobSASQueryParameters,
    StorageSharedKeyCredential,
    type BlockBlobClient,
    type ContainerClient
} from '@azure/storage-blob';
import { ObjectNotFoundError } from '@orthacms/media-domain';
import type {
    DirectUrlOptions,
    PutObject,
    StorageProvider,
    StoredObject
} from '@orthacms/media-domain';

/**
 * Settings for Azure Blob Storage.
 *
 * Azure is the one major object store with **no S3 compatibility at all** —
 * different protocol, different signature, containers instead of buckets — so
 * it needs its own adapter rather than an endpoint in `provider-s3`.
 *
 * Three ways to connect, in the order most deployments reach for them:
 *
 * 1. `connectionString` — what the portal hands you, and what Azurite prints.
 * 2. `accountName` + `accountKey`.
 * 3. `containerClient` — an already-built client. This is the escape hatch for
 *    **managed identity**: build a client with `DefaultAzureCredential` from
 *    `@azure/identity` and pass it, and this package stays free of that
 *    dependency. It is also what the tests inject.
 */
export interface AzureStorageConfig {
    /** Container every blob lands in. */
    container: string;
    /** Full connection string, including the key. */
    connectionString?: string;
    /** Account name, when connecting with an explicit key. */
    accountName?: string;
    /** Account key, paired with `accountName`. */
    accountKey?: string;
    /** Prefix every blob name with this, e.g. to share a container. */
    keyPrefix?: string;
    /** An already-built container client — managed identity, or a test stub. */
    containerClient?: ContainerClient;
}

/** How much of the stream is buffered per block while uploading. */
const UPLOAD_BUFFER_BYTES = 4 * 1024 * 1024;

/** How many blocks are in flight at once. */
const UPLOAD_CONCURRENCY = 4;

/** Reduces a file name to one safe key segment. Mirrors the other providers. */
function sanitize(fileName: string): string {
    const cleaned = fileName.replace(/[^A-Za-z0-9_.-]+/g, '_');
    return cleaned === '.' || cleaned === '..' ? `_${cleaned}` : cleaned;
}

/** True for the shapes Azure uses to say "no such blob". */
function isMissing(error: unknown): boolean {
    const candidate = error as {
        statusCode?: number;
        code?: string;
        details?: { errorCode?: string };
    };
    return (
        candidate?.statusCode === 404 ||
        candidate?.code === 'BlobNotFound' ||
        candidate?.details?.errorCode === 'BlobNotFound' ||
        candidate?.details?.errorCode === 'ContainerNotFound'
    );
}

/** Builds the container client from whichever credentials were supplied. */
function resolveContainer(config: AzureStorageConfig): {
    container: ContainerClient;
    sharedKey?: StorageSharedKeyCredential;
} {
    if (config.containerClient) {
        // A caller-built client may carry any credential — including a managed
        // identity, which cannot sign a plain SAS. Signing is therefore off
        // unless the caller also handed us an explicit key.
        return { container: config.containerClient };
    }
    if (config.connectionString) {
        const service = BlobServiceClient.fromConnectionString(
            config.connectionString
        );
        return {
            container: service.getContainerClient(config.container),
            ...(sharedKeyFrom(config.connectionString)
                ? { sharedKey: sharedKeyFrom(config.connectionString) }
                : {})
        };
    }
    if (config.accountName && config.accountKey) {
        const sharedKey = new StorageSharedKeyCredential(
            config.accountName,
            config.accountKey
        );
        const service = new BlobServiceClient(
            `https://${config.accountName}.blob.core.windows.net`,
            sharedKey
        );
        return {
            container: service.getContainerClient(config.container),
            sharedKey
        };
    }
    throw new Error(
        'createAzureStorageProvider needs credentials: a `connectionString`, an ' +
            '`accountName` + `accountKey` pair, or a pre-built `containerClient` ' +
            '(which is how you use a managed identity without this package depending on @azure/identity).'
    );
}

/** Pulls the account name/key out of a connection string, when it has them. */
function sharedKeyFrom(
    connectionString: string
): StorageSharedKeyCredential | undefined {
    const parts = new Map(
        connectionString
            .split(';')
            .map((pair) => pair.split(/=(.*)/s))
            .filter((pair): pair is [string, string] => pair.length >= 2)
            .map(([key, value]) => [key.trim(), value.trim()])
    );
    const name = parts.get('AccountName');
    const key = parts.get('AccountKey');
    // A SAS-based connection string carries no key, and that is a legitimate
    // way to connect — it just cannot mint further SAS tokens.
    return name && key ? new StorageSharedKeyCredential(name, key) : undefined;
}

/**
 * The Azure Blob Storage {@link StorageProvider}.
 *
 * `capabilities.directUrl` is **computed, not hardcoded**: a SAS token needs a
 * shared key to sign, so a deployment on managed identity gets `false` and its
 * downloads are proxied. Declaring `true` unconditionally would make
 * `MediaServerPlugin` accept `directServe: 'signed-url'` on a deployment that
 * cannot honour it, and the failure would land per-request instead of at boot.
 */
export function createAzureStorageProvider(
    config: AzureStorageConfig
): StorageProvider {
    if (!config.container?.trim()) {
        throw new Error(
            'createAzureStorageProvider requires a container name.'
        );
    }
    const { container, sharedKey } = resolveContainer(config);
    const prefix = config.keyPrefix?.replace(/^\/+|\/+$/g, '');

    const blobFor = (storageKey: string): BlockBlobClient =>
        container.getBlockBlobClient(storageKey);

    return {
        id: 'azure',
        capabilities: {
            directUrl: Boolean(sharedKey),
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
            object.body.pipe(meter);
            // Without forwarding this, an upload whose source dies waits
            // forever on a stream that will never end.
            object.body.on('error', (error) => meter.destroy(error));

            const blob = blobFor(storageKey);
            try {
                await blob.uploadStream(
                    meter,
                    UPLOAD_BUFFER_BYTES,
                    UPLOAD_CONCURRENCY,
                    {
                        blobHTTPHeaders: {
                            blobContentType: object.contentType
                        }
                    }
                );
            } catch (error) {
                // A failed block upload leaves uncommitted blocks charged
                // against the account and invisible to a blob listing — and the
                // key never reached a caller, so nothing can reclaim them.
                // Deleting the (uncommitted) blob is what clears them.
                await blob.deleteIfExists().catch(() => undefined);
                throw error;
            }

            return { storageKey, size, checksum: hash.digest('hex') };
        },

        async get(storageKey: string): Promise<Readable> {
            try {
                const response = await blobFor(storageKey).download();
                const body = response.readableStreamBody;
                if (!body) {
                    // Node always populates it; a browser bundle would not, and
                    // an empty body here is not something to stream.
                    throw new ObjectNotFoundError(storageKey);
                }
                return body as Readable;
            } catch (error) {
                if (isMissing(error)) {
                    throw new ObjectNotFoundError(storageKey, error);
                }
                throw error;
            }
        },

        async remove(storageKey: string): Promise<void> {
            // `deleteIfExists` is idempotent by name; the catch covers a
            // gateway that answers 404 anyway, since reclaim is post-commit and
            // best-effort.
            try {
                await blobFor(storageKey).deleteIfExists();
            } catch (error) {
                if (!isMissing(error)) throw error;
            }
        },

        ...(sharedKey
            ? {
                  async directUrl(
                      storageKey: string,
                      options: DirectUrlOptions
                  ): Promise<string> {
                      // The SAS pins the response headers, exactly as the S3
                      // adapter pins them on its query string: a redirect
                      // discards the app's own `Content-Disposition`, `nosniff`
                      // and CSP, and the stored MIME type is the uploader's
                      // claim. Without these two, an uploaded `.html` renders
                      // on the storage account's origin.
                      const fileName = options.fileName.replace(/"/g, '');
                      const expiresOn = new Date(
                          Date.now() + options.expiresInSeconds * 1000
                      );
                      const sas = generateBlobSASQueryParameters(
                          {
                              containerName: container.containerName,
                              blobName: storageKey,
                              permissions: BlobSASPermissions.parse('r'),
                              expiresOn,
                              contentDisposition: `${options.disposition}; filename="${fileName}"`,
                              contentType: options.contentType
                          },
                          sharedKey
                      ).toString();
                      return `${blobFor(storageKey).url}?${sas}`;
                  }
              }
            : {}),

        async verify(): Promise<void> {
            // One properties call at boot: a wrong container, a dead account or
            // an expired key fails the start rather than the first upload.
            await container.getProperties();
        }
    };
}
