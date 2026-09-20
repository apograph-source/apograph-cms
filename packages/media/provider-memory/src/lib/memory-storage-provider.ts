import { createHash } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ObjectNotFoundError } from '@orthacms/media-domain';
import type {
    PutObject,
    StorageProvider,
    StoredObject
} from '@orthacms/media-domain';

/** One blob, as this provider holds it. */
interface StoredBlob {
    bytes: Buffer;
    /**
     * Kept because a `Map` can keep it — which is why this provider declares
     * `contentTypeMetadata: true` where the filesystem declares `false`.
     */
    contentType: string;
}

/** Settings. There is nothing to connect to, so there is nothing to set. */
export interface MemoryStorageConfig {
    /**
     * Bytes this store will hold before `put` starts rejecting. A test that
     * uploads more than it means to should fail as a test, not as an
     * out-of-memory kill that takes the whole run with it.
     *
     * Defaults to 256 MB — far above any fixture, far below a heap.
     */
    maxTotalBytes?: number;
}

/**
 * A {@link StorageProvider} that keeps blobs in a `Map`, plus the two
 * inspection methods a caller needs to make that useful.
 */
export interface MemoryStorageProvider extends StorageProvider {
    /** Every key currently held, sorted — the assertion surface for a delete. */
    keys(): string[];
    /** Bytes currently held across every blob. */
    totalBytes(): number;
    /** Drops every blob, so a store cannot outlive the rows that named it. */
    clear(): void;
}

/** Raised when a `put` would push the store past `maxTotalBytes`. */
export class MemoryStoreFullError extends Error {
    constructor(
        readonly attemptedBytes: number,
        readonly limitBytes: number
    ) {
        super(
            `In-memory storage is full: ${attemptedBytes} bytes would exceed the ${limitBytes}-byte limit. ` +
                'This provider is for tests and offline development — a real upload belongs on a real backend.'
        );
        this.name = 'MemoryStoreFullError';
    }
}

const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

/** Reduces a file name to one safe key segment. Mirrors `provider-local`. */
function sanitize(fileName: string): string {
    const cleaned = fileName.replace(/[^A-Za-z0-9_.-]+/g, '_');
    // `.` and `..` survive the character class and are not names. They are
    // harmless in a `Map`, but a key that round-trips differently between two
    // providers is a key the core cannot treat as opaque.
    return cleaned === '.' || cleaned === '..' ? `_${cleaned}` : cleaned;
}

/**
 * The in-memory storage backend — **shipped, not test scaffolding.**
 *
 * The copilot ships `provider-fake` for the same reason (ADR-0004 §3): a run
 * loop that cannot be driven without a key and a network is one nobody
 * exercises. Storage needed it more. Before this package, `apps/server-e2e`
 * stood up its own `Map`-backed provider inline — a second implementation of
 * the port that no rule held to the contract, and which drifted from it (it
 * rejected a missing key with a bare `Error`, so the route that maps
 * `ObjectNotFoundError` to a 404 was never exercised by the harness at all).
 *
 * What it is for: the e2e harness, a contributor running the admin offline, and
 * anyone writing a provider who wants a known-good one to compare against. What
 * it is not for: a deployment. Blobs die with the process, and
 * `StorageProviderCheck` will refuse to boot a database whose rows were written
 * by anything else — including a previous run of this one.
 */
export function createMemoryStorageProvider(
    config: MemoryStorageConfig = {}
): MemoryStorageProvider {
    const store = new Map<string, StoredBlob>();
    const limit = config.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;

    const totalBytes = () => {
        let total = 0;
        for (const blob of store.values()) total += blob.bytes.byteLength;
        return total;
    };

    return {
        id: 'memory',
        capabilities: {
            // Nothing outside this process can fetch a `Map`.
            directUrl: false,
            // Unlike a filesystem, this store has somewhere to put it.
            contentTypeMetadata: true,
            // `put` buffers: the whole point is that a test's fixture is small
            // and the store is a `Map`. Declared honestly so nobody plans a
            // large upload around it.
            streamingPut: false
        },

        async put(object: PutObject): Promise<StoredObject> {
            const key = [
                object.workspaceId,
                object.assetId,
                ...(object.isVariant ? ['variants'] : []),
                sanitize(object.fileName)
            ].join('/');

            // Metered through a `PassThrough` rather than collected by hand, so
            // a body that fails mid-stream rejects here — and, because nothing
            // is written to the `Map` until the whole body has arrived, leaves
            // the store exactly as it was. That is the port's all-or-nothing
            // rule, met by construction.
            const chunks: Buffer[] = [];
            const hash = createHash('sha256');
            let size = 0;
            const meter = new PassThrough();
            meter.on('data', (chunk: Buffer) => {
                hash.update(chunk);
                size += chunk.byteLength;
                chunks.push(chunk);
            });
            await pipeline(object.body, meter);

            if (totalBytes() + size > limit) {
                throw new MemoryStoreFullError(totalBytes() + size, limit);
            }

            store.set(key, {
                bytes: Buffer.concat(chunks),
                contentType: object.contentType
            });
            return { storageKey: key, size, checksum: hash.digest('hex') };
        },

        async get(storageKey: string): Promise<Readable> {
            const blob = store.get(storageKey);
            if (!blob) {
                // The port's own error, not a bare `Error`: `to-http.ts` maps
                // this to a 404, and anything else to a 500. The harness's old
                // inline provider got this wrong, which is why every e2e run
                // agreed with a route behaviour no real provider had.
                throw new ObjectNotFoundError(storageKey);
            }
            return Readable.from(blob.bytes);
        },

        async remove(storageKey: string): Promise<void> {
            store.delete(storageKey);
        },

        keys(): string[] {
            return [...store.keys()].sort();
        },

        totalBytes,

        clear(): void {
            store.clear();
        }
    };
}
