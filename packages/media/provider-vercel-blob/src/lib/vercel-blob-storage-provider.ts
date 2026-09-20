import { createHash } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BlobNotFoundError, del, head, put } from '@vercel/blob';
import { ObjectNotFoundError } from '@orthacms/media-domain';
import type {
    PutObject,
    StorageProvider,
    StoredObject
} from '@orthacms/media-domain';

/**
 * The three calls this adapter makes, as an injectable seam.
 *
 * `@vercel/blob` exports free functions rather than a client, so there is no
 * object to hand in — this is the shape the tests substitute, and the shape a
 * caller could substitute to route through their own fetch stack.
 */
export interface VercelBlobApi {
    put: typeof put;
    head: typeof head;
    del: typeof del;
}

/** Settings for Vercel Blob. */
export interface VercelBlobStorageConfig {
    /**
     * Read-write token. Omit on Vercel itself, where `BLOB_READ_WRITE_TOKEN` is
     * injected into the environment and the SDK reads it.
     */
    token?: string;
    /** Prefix every pathname with this, e.g. to share a store. */
    keyPrefix?: string;
    /** The SDK functions, for tests or a custom transport. */
    api?: VercelBlobApi;
}

/** Reduces a file name to one safe key segment. Mirrors the other providers. */
function sanitize(fileName: string): string {
    const cleaned = fileName.replace(/[^A-Za-z0-9_.-]+/g, '_');
    return cleaned === '.' || cleaned === '..' ? `_${cleaned}` : cleaned;
}

/** True for the shapes the SDK and its CDN use to say "no such blob". */
function isMissing(error: unknown): boolean {
    const candidate = error as { name?: string; status?: number };
    return (
        error instanceof BlobNotFoundError ||
        candidate?.name === 'BlobNotFoundError' ||
        candidate?.status === 404
    );
}

/**
 * Vercel Blob.
 *
 * **Read this before choosing it: every blob is world-readable.** Vercel Blob
 * has one access mode, `public`, and the URL it returns is a permanent,
 * unguessable, unauthenticated link to the bytes. Anyone who obtains that URL —
 * from a copied `<img src>`, a browser extension, a proxy log, a forwarded
 * email — can fetch the asset forever, with no reference to who they are.
 *
 * The Media Library is otherwise **private by default**: `GET
 * /media/assets/:id/raw` checks workspace membership on every request, and a
 * non-member gets the same 404 as a missing asset. This backend cannot uphold
 * that for anyone holding the underlying URL. The app keeps enforcing its own
 * rules — the API never returns the blob URL, only `/media/assets/:id/raw` —
 * but the second copy of the bytes is public and that cannot be revoked short
 * of deleting the blob.
 *
 * Fine for a marketing site's images. Not fine for a workspace whose media is
 * confidential. That is a deployment decision, not something this adapter can
 * paper over — so it is stated here, in `AGENTS.md`, and in the scaffolder's
 * own hint.
 */
export function createVercelBlobStorageProvider(
    config: VercelBlobStorageConfig = {}
): StorageProvider {
    const api: VercelBlobApi = config.api ?? { put, head, del };
    const prefix = config.keyPrefix?.replace(/^\/+|\/+$/g, '');
    const token = config.token ? { token: config.token } : {};

    /** The public URL behind a stored pathname, via the metadata call. */
    const urlFor = async (storageKey: string): Promise<string> => {
        try {
            const meta = await api.head(storageKey, token);
            return meta.url;
        } catch (error) {
            if (isMissing(error)) {
                throw new ObjectNotFoundError(storageKey, error);
            }
            throw error;
        }
    };

    return {
        id: 'vercel-blob',
        capabilities: {
            // The store's URL is public and **permanent** — it neither expires
            // nor carries a disposition we can pin per request. The port's
            // `directUrl` promises both, so declaring it here would be a lie
            // that hands out an unrevocable link and serves an uploaded `.html`
            // inline from the blob host. Downloads stay proxied, which is also
            // what keeps the app's membership check on the request path.
            directUrl: false,
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
            // `pipeline` so a source that dies destroys the meter too, rather
            // than leaving the upload waiting on a stream that never ends.
            //
            // Awaited **together** with the upload, not after it: whichever
            // fails first, both promises already carry a handler. Awaiting them
            // in sequence meant that when the upload rejected first, the
            // pipeline's own rejection had nobody attached yet — an unhandled
            // rejection, which in Node is a killed process rather than a failed
            // request.
            try {
                await Promise.all([
                    api.put(storageKey, meter, {
                        access: 'public',
                        contentType: object.contentType,
                        // The pathname we computed **is** the storage key. With
                        // the default suffix on, the stored blob would live
                        // somewhere this adapter cannot name, and `get` /
                        // `remove` would miss every object they were handed.
                        addRandomSuffix: false,
                        ...token
                    }),
                    pipeline(object.body, meter)
                ]);
            } catch (error) {
                await api.del(storageKey, token).catch(() => undefined);
                throw error;
            }

            return { storageKey, size, checksum: hash.digest('hex') };
        },

        async get(storageKey: string): Promise<Readable> {
            // Two steps, and the first is the important one: `head` turns a
            // missing blob into a rejection *before* any stream exists, which
            // is what the port promises and what lets the route answer 404
            // rather than a streaming 200 it cannot take back.
            const url = await urlFor(storageKey);
            const response = await fetch(url);
            if (!response.ok || !response.body) {
                if (response.status === 404) {
                    throw new ObjectNotFoundError(storageKey);
                }
                throw new Error(
                    `Vercel Blob refused to serve ${storageKey}: ${response.status} ${response.statusText}`
                );
            }
            return Readable.fromWeb(
                response.body as Parameters<typeof Readable.fromWeb>[0]
            );
        },

        async remove(storageKey: string): Promise<void> {
            try {
                await api.del(storageKey, token);
            } catch (error) {
                // Reclaim is post-commit and best-effort, so a blob that is
                // already gone is a success, not something to report.
                if (!isMissing(error)) throw error;
            }
        },

        async verify(): Promise<void> {
            // There is no store-level metadata call, so this asks about a
            // pathname that will not exist: a missing blob proves the token and
            // the store are good, while a bad token raises something else and
            // fails the boot.
            try {
                await api.head('__ortha_verify__/does-not-exist', token);
            } catch (error) {
                if (isMissing(error)) return;
                throw error;
            }
        }
    };
}
