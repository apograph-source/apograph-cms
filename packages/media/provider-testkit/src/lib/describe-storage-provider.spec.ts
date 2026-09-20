import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ObjectNotFoundError } from '@orthacms/media-domain';
import type {
    PutObject,
    StorageProvider,
    StoredObject
} from '@orthacms/media-domain';
import { describeStorageProvider } from './describe-storage-provider';

/**
 * A minimal correct provider — the kit run against its own reference.
 *
 * It is here because a contract suite that no correct implementation passes is
 * worse than none: it would be discovered by whoever writes the next provider,
 * who would reasonably assume the fault is theirs. This is also the shortest
 * readable answer to "what does a provider have to do", which is why it stores
 * bytes in a `Map` and nothing else.
 */
function createReferenceProvider(): StorageProvider {
    const store = new Map<string, Buffer>();
    return {
        id: 'reference',
        capabilities: {
            directUrl: false,
            contentTypeMetadata: false,
            streamingPut: false
        },
        async put(object: PutObject): Promise<StoredObject> {
            const chunks: Buffer[] = [];
            for await (const chunk of object.body) {
                chunks.push(
                    Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
                );
            }
            const bytes = Buffer.concat(chunks);
            // The variant sub-namespace is the load-bearing part: a user's own
            // file can be called `thumb.webp`.
            const storageKey = [
                object.workspaceId,
                object.assetId,
                ...(object.isVariant ? ['variants'] : []),
                object.fileName
            ].join('/');
            // Written only once the whole body has arrived, so a stream that
            // fails mid-flight leaves nothing — the all-or-nothing rule, met
            // here by construction rather than by cleanup.
            store.set(storageKey, bytes);
            return {
                storageKey,
                size: bytes.byteLength,
                checksum: createHash('sha256').update(bytes).digest('hex')
            };
        },
        async get(storageKey: string): Promise<Readable> {
            const bytes = store.get(storageKey);
            if (!bytes) {
                // The port's own error, not a bare `Error`: `to-http.ts` maps
                // this one to a 404, and anything else to a 500.
                throw new ObjectNotFoundError(storageKey);
            }
            return Readable.from(bytes);
        },
        async remove(storageKey: string): Promise<void> {
            store.delete(storageKey);
        }
    };
}

const stores = new Map<StorageProvider, () => string[]>();

describeStorageProvider('reference (in-memory)', {
    create() {
        const provider = createReferenceProvider();
        // Read the keys back through the provider's own surface: the kit only
        // needs to know what survived, and reaching into the `Map` would test
        // the harness rather than the provider.
        const keys = new Set<string>();
        const put = provider.put.bind(provider);
        const wrapped: StorageProvider = {
            ...provider,
            async put(object) {
                const stored = await put(object);
                keys.add(stored.storageKey);
                return stored;
            },
            async remove(storageKey) {
                keys.delete(storageKey);
                return provider.remove(storageKey);
            }
        };
        stores.set(wrapped, () => [...keys].sort());
        return wrapped;
    },
    storedKeys(provider) {
        return stores.get(provider)?.() ?? [];
    }
});
