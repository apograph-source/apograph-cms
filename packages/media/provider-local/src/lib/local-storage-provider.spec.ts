import { createHash } from 'node:crypto';
import { chmodSync, existsSync, statSync, symlinkSync } from 'node:fs';
import {
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rm,
    writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { ObjectNotFoundError } from '@ortha/media-domain';
import type { StorageProvider } from '@ortha/media-domain';
import {
    createLocalStorageProvider,
    StorageKeyOutsideRootError
} from './local-storage-provider';

const WORKSPACE = '11111111-1111-1111-1111-111111111111';
const ASSET = '22222222-2222-2222-2222-222222222222';

/**
 * For the one case that manufactures a write failure by taking the write bit
 * off a directory. Root bypasses that check — the kernel grants it the write
 * regardless of the mode — so the provider never sees `EACCES` and the case
 * has nothing to assert. Skip it there rather than let a container that runs
 * as root (CI images and devcontainers routinely do) report a red suite for a
 * property of the *user*, not of the code.
 */
const itUnlessRoot = process.getuid?.() === 0 ? it.skip : it;

/**
 * Every case here runs against a **real temporary directory**. The interesting
 * claims about this package are about bytes, inodes and what survives a
 * failure, and a mocked `fs` can only ever confirm which calls were made.
 */
describe('createLocalStorageProvider', () => {
    let root: string;
    let provider: StorageProvider;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'ortha-local-storage-'));
        provider = createLocalStorageProvider({
            rootDir: root
        });
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    const put = (
        overrides: Partial<Parameters<StorageProvider['put']>[0]> = {}
    ) =>
        provider.put({
            workspaceId: WORKSPACE,
            assetId: ASSET,
            fileName: 'logo.png',
            contentType: 'image/png',
            body: Readable.from(Buffer.from('bytes')),
            ...overrides
        });

    const read = (storageKey: string) => readFile(join(root, storageKey));

    const drain = (stream: Readable) =>
        new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);
        });

    describe('put', () => {
        it('writes the body to <workspace>/<asset>/<name> with a verified size and checksum', async () => {
            const body = Buffer.from('hello world, this is a blob');

            const stored = await put({ body: Readable.from(body) });

            expect(stored.storageKey).toBe(`${WORKSPACE}/${ASSET}/logo.png`);
            expect(stored.size).toBe(body.length);
            expect(stored.checksum).toBe(
                createHash('sha256').update(body).digest('hex')
            );
            expect(await read(stored.storageKey)).toEqual(body);
        });

        it('meters a zero-byte body as the sha256 of nothing', async () => {
            const stored = await put({ body: Readable.from([]) });

            expect(stored.size).toBe(0);
            expect(stored.checksum).toBe(
                'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
            );
            expect(statSync(join(root, stored.storageKey)).size).toBe(0);
        });

        it('creates the whole parent chain on demand', async () => {
            const nested = createLocalStorageProvider({
                rootDir: join(root, 'does/not/exist/yet')
            });

            const stored = await nested.put({
                workspaceId: WORKSPACE,
                assetId: ASSET,
                fileName: 'logo.png',
                contentType: 'image/png',
                body: Readable.from(Buffer.from('x'))
            });

            expect(
                existsSync(join(root, 'does/not/exist/yet', stored.storageKey))
            ).toBe(true);
        });

        it('keys a derivative under the reserved variants/ namespace, so it cannot collide with an original of the same name [media:I-09]', async () => {
            const variant = await put({
                fileName: 'thumb.webp',
                body: Readable.from(Buffer.from('derived')),
                isVariant: true
            });
            const original = await put({
                fileName: 'thumb.webp',
                body: Readable.from(Buffer.from('uploaded'))
            });

            expect(variant.storageKey).toBe(
                `${WORKSPACE}/${ASSET}/variants/thumb.webp`
            );
            expect(original.storageKey).toBe(
                `${WORKSPACE}/${ASSET}/thumb.webp`
            );
            expect((await read(variant.storageKey)).toString()).toBe('derived');
            expect((await read(original.storageKey)).toString()).toBe(
                'uploaded'
            );
        });

        it.each([
            ['my photo (final).PNG', 'my_photo_final_.PNG'],
            ['логотип.png', '_.png'],
            ['a<b>c.png', 'a_b_c.png'],
            ['a\0b.png', 'a_b.png'],
            ['...', '...'],
            // `FileName` rejects these upstream, so they should be unreachable
            // — but "unreachable" is a property of today's callers, and the
            // port is public. A separator must never survive into the path.
            ['../../etc/passwd', '.._.._etc_passwd'],
            ['....//....//etc/passwd', '...._...._etc_passwd'],
            ['a\\b.png', 'a_b.png']
        ])('sanitizes %j to %j', async (fileName, expected) => {
            const stored = await put({ fileName });

            expect(stored.storageKey).toBe(`${WORKSPACE}/${ASSET}/${expected}`);
        });

        // Regression: `sanitize` used to pass `..` and `.` through untouched
        // (both characters are in the keep-set), so `join` normalised the key
        // and the write landed on the *workspace* directory — creating a file
        // named `<workspaceId>` where every other asset needs a directory.
        it.each([
            ['..', '_..'],
            ['.', '_.']
        ])(
            'never lets a dots-only name %j escape its own asset directory',
            async (fileName, expected) => {
                const stored = await put({
                    workspaceId: 'fresh-workspace',
                    fileName
                });

                expect(stored.storageKey).toBe(
                    `fresh-workspace/${ASSET}/${expected}`
                );
                expect(
                    statSync(join(root, 'fresh-workspace')).isDirectory()
                ).toBe(true);
                expect((await read(stored.storageKey)).toString()).toBe(
                    'bytes'
                );
            }
        );

        // Regression: a 260-character name reached `fs.open` as ENAMETOOLONG,
        // an unmapped node error the caller could only turn into a 500.
        it('bounds an over-long name to a writable segment, keeping the extension', async () => {
            const stored = await put({
                fileName: `${'a'.repeat(400)}.png`
            });

            const segment = stored.storageKey.split('/').pop() as string;
            expect(segment.length).toBe(255);
            expect(segment.endsWith('.png')).toBe(true);
            expect(await read(stored.storageKey)).toEqual(Buffer.from('bytes'));
        });

        // Regression (BUG-media-server-04): a failed upload used to leave the
        // partial file on disk under a key `put` never returned, so nothing
        // could ever reclaim it.
        it('leaves nothing behind when the body errors mid-stream [media:I-06]', async () => {
            const body = new PassThrough();
            const pending = put({ workspaceId: 'aborted', body });
            for (let index = 0; index < 20; index++) {
                body.write(Buffer.alloc(64 * 1024, 7));
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
            body.destroy(new Error('client aborted mid-stream'));

            await expect(pending).rejects.toThrow('client aborted mid-stream');
            expect(existsSync(join(root, 'aborted'))).toBe(false);
            expect(await readdir(root)).toEqual([]);
        });

        it('leaves nothing behind when the body errors before a single byte', async () => {
            const body = new Readable({
                read() {
                    this.destroy(new Error('boom'));
                }
            });

            await expect(put({ workspaceId: 'aborted', body })).rejects.toThrow(
                'boom'
            );
            expect(await readdir(root)).toEqual([]);
        });

        // The other half of the failure surface: the *destination* rejects
        // rather than the source. Shape-identical to a full disk (`ENOSPC`),
        // which is the case that actually happens in production and the one a
        // temp directory cannot manufacture.
        itUnlessRoot(
            'leaves nothing behind when the destination refuses the write',
            async () => {
                const assetDirectory = join(root, WORKSPACE, ASSET);
                await mkdir(assetDirectory, { recursive: true });
                chmodSync(assetDirectory, 0o500);
                try {
                    await expect(put()).rejects.toMatchObject({
                        code: 'EACCES'
                    });

                    // Nothing survives — not the temporary file, and not the empty
                    // directories either. Pruning an empty directory the write did
                    // not itself create is deliberate: an empty directory in this
                    // store carries no information, and the next `put` recreates
                    // whatever chain it needs.
                    expect(await readdir(root)).toEqual([]);
                } finally {
                    if (existsSync(assetDirectory)) {
                        chmodSync(assetDirectory, 0o700);
                    }
                }
            }
        );

        it('leaves no temporary file behind on a successful write', async () => {
            const stored = await put();

            expect(await readdir(join(root, WORKSPACE, ASSET))).toEqual([
                'logo.png'
            ]);
            expect(stored.storageKey).toBe(`${WORKSPACE}/${ASSET}/logo.png`);
        });

        it('resolves two concurrent writes of one key to a single intact body', async () => {
            const chunks = (fill: number) =>
                Readable.from(
                    (function* () {
                        for (let index = 0; index < 32; index++) {
                            yield Buffer.alloc(64 * 1024, fill);
                        }
                    })()
                );

            const [first, second] = await Promise.all([
                put({ body: chunks(1) }),
                put({ body: chunks(2) })
            ]);

            const onDisk = await read(first.storageKey);
            expect(onDisk.length).toBe(first.size);
            expect([first.checksum, second.checksum]).toContain(
                createHash('sha256').update(onDisk).digest('hex')
            );
            expect(onDisk.every((byte) => byte === onDisk[0])).toBe(true);
        });

        // Both ids are minted server-side today, so this is containment by
        // construction rather than a live exploit — but a `..` in either used to
        // be a write *outside* the storage root.
        it('cannot be made to write outside the root by an adversarial id', async () => {
            const stored = await put({
                workspaceId: '..',
                assetId: '../..',
                fileName: 'planted.txt'
            });

            expect(stored.storageKey).toBe('_../.._../planted.txt');
            expect(existsSync(join(root, stored.storageKey))).toBe(true);
        });
    });

    describe('get', () => {
        it('streams the stored bytes back', async () => {
            const body = Buffer.from('round trip');
            const stored = await put({ body: Readable.from(body) });

            expect(await drain(await provider.get(stored.storageKey))).toEqual(
                body
            );
        });

        // Regression: `createReadStream` opens lazily, so a missing blob used to
        // resolve and then emit ENOENT once the response was already a
        // streaming 200 that could no longer become a 404.
        it('rejects for a missing key instead of failing mid-stream [media:I-07]', async () => {
            await expect(
                provider.get(`${WORKSPACE}/${ASSET}/gone.png`)
            ).rejects.toBeInstanceOf(ObjectNotFoundError);
        });

        // The *kind* of rejection belongs to the port. A raw `ENOENT` reaching
        // the controller was a 500 for a row whose blob is gone — a database
        // restored against an empty volume, a hand-reclaimed blob, an
        // interrupted migration.
        it('keeps the driver error for the operator, off the caller', async () => {
            // `get` resolves a stream, so the caught value has to be cast at
            // the binding rather than inside the handler — otherwise the type
            // is the union of both outcomes.
            const thrown = (await provider
                .get(`${WORKSPACE}/${ASSET}/gone.png`)
                .catch((error: unknown) => error)) as ObjectNotFoundError;

            expect(thrown.cause).toMatchObject({ code: 'ENOENT' });
            // Never rendered to a caller — `to-http` answers a bare 404 — but
            // an operator reading a log needs the key.
            expect(thrown.message).toContain('gone.png');
        });

        // A missing *directory* is the same condition: the whole asset folder
        // is gone, not just the file inside it.
        it('reports a missing parent directory as a missing object too', async () => {
            await expect(
                provider.get('no-such-workspace/no-such-asset/file.png')
            ).rejects.toBeInstanceOf(ObjectNotFoundError);
        });

        // Deliberately not folded into "not found": only ENOENT/ENOTDIR are.
        // A permission error, an exhausted descriptor table or a key that is
        // not a file is an operator's problem, and dressing one as a 404 hides
        // an outage behind a plausible answer.
        it('does not report a key that is not a file as missing', async () => {
            await put();

            const thrown = await provider
                .get(`${WORKSPACE}/${ASSET}`)
                .catch((error: unknown) => error);

            expect(thrown).not.toBeInstanceOf(ObjectNotFoundError);
            expect(thrown).toMatchObject({ code: 'EISDIR' });
        });

        it('rejects for a key that names a directory', async () => {
            await put();

            await expect(
                provider.get(`${WORKSPACE}/${ASSET}`)
            ).rejects.toMatchObject({ code: 'EISDIR' });
        });

        it('rejects a key that traverses outside the root instead of reading the file', async () => {
            const outside = await mkdtemp(join(tmpdir(), 'ortha-outside-'));
            await writeFile(join(outside, 'secret.txt'), 'TOP SECRET');
            try {
                await expect(
                    provider.get(`../${outside.split('/').pop()}/secret.txt`)
                ).rejects.toBeInstanceOf(StorageKeyOutsideRootError);
                await expect(
                    provider.get('/etc/passwd')
                ).rejects.toBeInstanceOf(StorageKeyOutsideRootError);
                expect(existsSync(join(outside, 'secret.txt'))).toBe(true);
            } finally {
                await rm(outside, { recursive: true, force: true });
            }
        });
    });

    describe('remove', () => {
        it('is idempotent — a missing key is a no-op [media:I-07]', async () => {
            const stored = await put();

            await provider.remove(stored.storageKey);
            await expect(
                provider.remove(stored.storageKey)
            ).resolves.toBeUndefined();
            await expect(
                provider.remove('never/existed/at.all')
            ).resolves.toBeUndefined();
        });

        // Regression: nothing else reclaims `<workspace>/<asset>/`, so an
        // upload-and-delete cycle used to leak one directory (and inode) per
        // asset, forever.
        it('prunes the directories the removed blob leaves empty', async () => {
            const stored = await put();

            await provider.remove(stored.storageKey);

            expect(await readdir(root)).toEqual([]);
        });

        it('stops pruning at the first directory that still holds something', async () => {
            const kept = await put({ fileName: 'keep.png' });
            const removed = await put({ fileName: 'drop.png' });

            await provider.remove(removed.storageKey);

            expect(await readdir(join(root, WORKSPACE, ASSET))).toEqual([
                'keep.png'
            ]);
            expect(existsSync(join(root, kept.storageKey))).toBe(true);
        });

        it('never prunes above the root', async () => {
            const nested = join(root, 'store');
            const scoped = createLocalStorageProvider({
                rootDir: nested
            });
            const stored = await scoped.put({
                workspaceId: WORKSPACE,
                assetId: ASSET,
                fileName: 'logo.png',
                contentType: 'image/png',
                body: Readable.from(Buffer.from('x'))
            });

            await scoped.remove(stored.storageKey);

            expect(existsSync(nested)).toBe(true);
            expect(await readdir(nested)).toEqual([]);
        });

        it('rejects a key that traverses outside the root instead of deleting the file', async () => {
            const outside = await mkdtemp(join(tmpdir(), 'ortha-outside-'));
            await writeFile(join(outside, 'secret.txt'), 'TOP SECRET');
            try {
                await expect(
                    provider.remove(`../${outside.split('/').pop()}/secret.txt`)
                ).rejects.toBeInstanceOf(StorageKeyOutsideRootError);
                expect(existsSync(join(outside, 'secret.txt'))).toBe(true);
            } finally {
                await rm(outside, { recursive: true, force: true });
            }
        });
    });

    describe('containment', () => {
        // The default `rootDir` is relative, so resolving it per call would
        // re-home the whole store the moment anything called `chdir`.
        it('pins a relative rootDir at construction, not per call', async () => {
            const first = join(root, 'first');
            const second = join(root, 'second');
            await mkdir(first, { recursive: true });
            await mkdir(second, { recursive: true });
            const previous = process.cwd();
            process.chdir(first);
            const relative = createLocalStorageProvider({
                rootDir: './store'
            });
            try {
                const stored = await relative.put({
                    workspaceId: WORKSPACE,
                    assetId: ASSET,
                    fileName: 'logo.png',
                    contentType: 'image/png',
                    body: Readable.from(Buffer.from('written in first'))
                });
                process.chdir(second);

                expect(
                    (
                        await drain(await relative.get(stored.storageKey))
                    ).toString()
                ).toBe('written in first');
                expect(existsSync(join(second, 'store'))).toBe(false);
            } finally {
                process.chdir(previous);
            }
        });

        // Pointing `rootDir` at a symlink is the normal way to put blobs on a
        // mounted volume, and the containment check must not read that as an
        // escape — `resolve` is textual, so the link is never followed and the
        // key still lands "inside" the root it was given.
        it('works when rootDir is itself a symlink to another volume', async () => {
            const volume = await mkdtemp(join(tmpdir(), 'ortha-volume-'));
            const link = join(root, 'blobs');
            symlinkSync(volume, link);
            const linked = createLocalStorageProvider({
                rootDir: link
            });
            try {
                const stored = await linked.put({
                    workspaceId: WORKSPACE,
                    assetId: ASSET,
                    fileName: 'logo.png',
                    contentType: 'image/png',
                    body: Readable.from(Buffer.from('on the volume'))
                });

                expect(
                    (
                        await drain(await linked.get(stored.storageKey))
                    ).toString()
                ).toBe('on the volume');
                expect(existsSync(join(volume, stored.storageKey))).toBe(true);
                await expect(
                    linked.remove(stored.storageKey)
                ).resolves.toBeUndefined();
            } finally {
                await rm(volume, { recursive: true, force: true });
            }
        });

        // A symlinked path component is still a write-through primitive; the
        // containment check is textual, not `realpath`-based. Recorded so the
        // limit is a decision rather than a surprise: it assumes `rootDir` is a
        // volume no untrusted process can plant links in.
        it('does not resolve symlinks planted inside the root', async () => {
            const elsewhere = await mkdtemp(
                join(tmpdir(), 'ortha-symlink-')
            );
            await mkdir(join(root, WORKSPACE), { recursive: true });
            symlinkSync(elsewhere, join(root, WORKSPACE, ASSET));
            try {
                const stored = await put({ fileName: 'planted.txt' });

                expect(existsSync(join(elsewhere, 'planted.txt'))).toBe(true);
                expect(stored.storageKey).toBe(
                    `${WORKSPACE}/${ASSET}/planted.txt`
                );
            } finally {
                await rm(elsewhere, { recursive: true, force: true });
            }
        });
    });

    it('declares what a filesystem can and cannot do', () => {
        // `directUrl: false` is the load-bearing one: serving `rootDir`
        // statically would hand every blob to anyone holding a key, and keys
        // are returned in API responses.
        expect(provider.id).toBe('local');
        expect(provider.capabilities).toEqual({
            directUrl: false,
            contentTypeMetadata: false,
            streamingPut: true
        });
        expect(provider.directUrl).toBeUndefined();
    });

    // The sharpest divergence from `provider-s3`, which throws synchronously
    // from every method: a caller written against this adapter's rejections
    // breaks against that one.
    it('rejects rather than throwing synchronously from every method [media:I-08]', async () => {
        const calls = [
            () =>
                provider.put({
                    workspaceId: '\0',
                    assetId: ASSET,
                    fileName: 'x',
                    contentType: 'x',
                    body: Readable.from([])
                }),
            () => provider.get('\0bad'),
            () => provider.remove('\0bad')
        ];

        for (const call of calls) {
            const returned = call();
            expect(returned).toBeInstanceOf(Promise);
            await returned.catch(() => undefined);
        }
    });
});
