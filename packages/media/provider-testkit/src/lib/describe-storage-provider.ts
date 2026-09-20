import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ObjectNotFoundError } from '@orthacms/media-domain';
import type { StorageProvider } from '@orthacms/media-domain';

/** How the kit builds and tears down the provider under test. */
export interface StorageProviderHarness {
    /**
     * Builds a provider for one test case. Called per case, so a provider that
     * holds state (a directory, a bucket prefix, a `Map`) can hand out a fresh
     * one and cases cannot leak into each other.
     */
    create(): StorageProvider | Promise<StorageProvider>;
    /** Tears down whatever `create` set up. Optional. */
    cleanup?(provider: StorageProvider): void | Promise<void>;
    /**
     * Reports every key the backend physically holds, when it can be inspected
     * from outside (a directory walk, a bucket listing, a `Map`).
     *
     * Supplying it turns the all-or-nothing check from "the promise rejected"
     * into "and it left nothing behind", which is the half that matters: a
     * failed `put` never handed its key back, so anything it leaves is
     * unreachable garbage no caller can ever reclaim.
     */
    storedKeys?(provider: StorageProvider): string[] | Promise<string[]>;
}

/** Collects a stream into one buffer. */
async function collect(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

/** A stream that yields some bytes and then fails, mid-`put`. */
function failingBody(): Readable {
    let sent = false;
    return new Readable({
        read() {
            if (sent) {
                this.destroy(new Error('upload aborted mid-stream'));
                return;
            }
            sent = true;
            this.push(Buffer.alloc(1024, 7));
        }
    });
}

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const ASSET = '22222222-2222-4222-8222-222222222222';

/**
 * The shared contract every `StorageProvider` must satisfy, as a runnable
 * suite. Call it from a provider package's own spec:
 *
 * ```typescript
 * describeStorageProvider('local', {
 *     create: () => createLocalStorageProvider({ rootDir: mkdtempSync(…) })
 * });
 * ```
 *
 * It exists because these rules used to live only in prose. Every one of them
 * is a claim the media core relies on and cannot check: it reclaims blobs by
 * key, streams `get` straight into an HTTP response, and stores derivatives
 * beside originals. A provider written outside this repo has no other way to
 * find out it broke one.
 */
export function describeStorageProvider(
    name: string,
    harness: StorageProviderHarness
): void {
    describe(`StorageProvider contract: ${name}`, () => {
        let provider: StorageProvider;

        beforeEach(async () => {
            provider = await harness.create();
        });

        afterEach(async () => {
            await harness.cleanup?.(provider);
        });

        const put = (
            overrides: Partial<Parameters<StorageProvider['put']>[0]> = {}
        ) =>
            provider.put({
                workspaceId: WORKSPACE,
                assetId: ASSET,
                fileName: 'logo.png',
                contentType: 'image/png',
                body: Readable.from([Buffer.from('the bytes')]),
                ...overrides
            });

        describe('identity', () => {
            it('has a non-empty id — the value recorded on every asset row', () => {
                expect(typeof provider.id).toBe('string');
                expect(provider.id.trim()).not.toBe('');
            });

            it('declares its capabilities', () => {
                expect(provider.capabilities).toEqual({
                    directUrl: expect.any(Boolean),
                    contentTypeMetadata: expect.any(Boolean),
                    streamingPut: expect.any(Boolean)
                });
            });

            it('implements directUrl() exactly when it claims to', () => {
                expect(typeof provider.directUrl === 'function').toBe(
                    provider.capabilities.directUrl
                );
            });
        });

        describe('put', () => {
            it('returns the true size and sha256 of what it wrote', async () => {
                const body = Buffer.from('the bytes');
                const stored = await put({ body: Readable.from([body]) });

                expect(stored.storageKey).toBeTruthy();
                expect(stored.size).toBe(body.byteLength);
                expect(stored.checksum).toBe(
                    createHash('sha256').update(body).digest('hex')
                );
            });

            it('round-trips the bytes through get', async () => {
                const body = Buffer.from('round trip');
                const stored = await put({ body: Readable.from([body]) });

                await expect(
                    collect(await provider.get(stored.storageKey))
                ).resolves.toEqual(body);
            });

            it('gives two assets distinct keys for the same file name', async () => {
                const first = await put();
                const second = await put({
                    assetId: '33333333-3333-4333-8333-333333333333'
                });

                expect(second.storageKey).not.toBe(first.storageKey);
            });

            it('keeps a derivative clear of an original with the same name', async () => {
                // A user's file really can be called `thumb.webp`. If the
                // variant namespace collided with it, generating derivatives
                // would overwrite the upload they were derived from.
                const original = await put({ fileName: 'thumb.webp' });
                const variant = await put({
                    fileName: 'thumb.webp',
                    isVariant: true
                });

                expect(variant.storageKey).not.toBe(original.storageKey);
                await expect(
                    collect(await provider.get(original.storageKey))
                ).resolves.toEqual(Buffer.from('the bytes'));
            });

            it('is all-or-nothing when the body fails mid-stream', async () => {
                // The key exists only inside `put`'s return value, so a
                // rejected write has handed nobody the name of what it made —
                // the core's reclaim loop can never see it.
                const before = (await harness.storedKeys?.(provider)) ?? [];

                await expect(put({ body: failingBody() })).rejects.toThrow();

                if (harness.storedKeys) {
                    // Awaited, not `.resolves`: `storedKeys` may answer
                    // synchronously (a `Map`) or with a promise (a directory
                    // walk, a bucket listing), and the matcher accepts only the
                    // latter.
                    expect(await harness.storedKeys(provider)).toEqual(before);
                }
            });
        });

        describe('get', () => {
            it('rejects with ObjectNotFoundError for a key that was never written', async () => {
                // Two halves, both contractual. Rejecting *before* the stream
                // opens: the download route turns a rejection into a 404, and
                // once bytes are flowing the response is a streaming 200 that
                // can no longer become one. And rejecting with the port's own
                // error: a driver's `ENOENT` or `NoSuchKey` escaping instead
                // makes a missing blob a 500 for every caller.
                await expect(
                    provider.get('no/such/key')
                ).rejects.toBeInstanceOf(ObjectNotFoundError);
            });

            it('rejects with ObjectNotFoundError for a key that has been removed', async () => {
                const stored = await put();
                await provider.remove(stored.storageKey);

                await expect(
                    provider.get(stored.storageKey)
                ).rejects.toBeInstanceOf(ObjectNotFoundError);
            });
        });

        describe('remove', () => {
            it('is idempotent for a key that is already gone', async () => {
                const stored = await put();

                await provider.remove(stored.storageKey);
                await expect(
                    provider.remove(stored.storageKey)
                ).resolves.toBeUndefined();
            });

            it('is a no-op for a key that never existed', async () => {
                // Reclaim is best-effort and post-commit: the row is already
                // gone, so a provider that threw here would only add noise
                // nobody can act on.
                await expect(
                    provider.remove('no/such/key')
                ).resolves.toBeUndefined();
            });
        });

        it('rejects rather than throwing synchronously', async () => {
            // A caller written against a rejecting provider breaks against one
            // that throws before returning a promise — the failure lands
            // outside the `try` that was meant to reclaim the blobs.
            const calls = [
                () => provider.get('no/such/key'),
                () => provider.remove('no/such/key')
            ];

            for (const call of calls) {
                const returned = call();
                expect(returned).toBeInstanceOf(Promise);
                await returned.catch(() => undefined);
            }
        });
    });
}
