import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ObjectNotFoundError } from '@orthacms/media-domain';
import type {
    PutObject,
    StorageProvider,
    StoredObject
} from '@orthacms/media-domain';

/** Local filesystem provider settings. */
export interface LocalStorageConfig {
    /** Directory blobs live under (absolute or project-relative). */
    rootDir: string;
}

/**
 * Raised when a storage key resolves outside the provider's `rootDir`.
 *
 * Keys are provider-owned and every key this provider *mints* is contained by
 * construction — but `get`/`remove` are handed keys read back from
 * `media_asset.storage_key`, which is only as trustworthy as everything that
 * can write that column (a migration, an import script, a future provider that
 * mints structured keys). Without this check `remove('../../x')` deletes an
 * arbitrary file the server user can reach; with it, the traversal is a
 * rejection instead of an action.
 */
export class StorageKeyOutsideRootError extends Error {
    constructor(readonly storageKey: string) {
        super(`Storage key resolves outside the storage root: ${storageKey}`);
        this.name = 'StorageKeyOutsideRootError';
    }
}

/**
 * Longest single path component this provider will produce.
 *
 * 255 bytes is the per-component limit on ext4/APFS/NTFS alike. Exceeding it is
 * an `ENAMETOOLONG` from `fs.open` — a raw node error the caller can only turn
 * into a 500 — so the provider bounds the segment itself rather than letting a
 * long name reach the syscall. Truncation (not rejection) is the right shape
 * here because the key is opaque and provider-owned: the truncated key is what
 * `put` returns and what the caller persists, so the round-trip still matches.
 */
const MAX_SEGMENT_LENGTH = 255;

/** Longest extension worth preserving when a name has to be truncated. */
const MAX_PRESERVED_EXTENSION = 16;

/**
 * Reduces a file name to a safe key segment.
 *
 * Three rules, in order:
 *
 * 1. Every run outside `[A-Za-z0-9_.-]` collapses to a single `_`, so no
 *    separator, control character or NUL can reach the path.
 * 2. `.`, `..` and the empty string (all three reachable once rule 1 has eaten
 *    the rest) are **path tokens, not names**: `join` normalises `W/A/..` to
 *    `W`, so the write lands on the workspace directory itself rather than
 *    inside the asset — creating a *file* named `W` where every other asset in
 *    that workspace needs a *directory*. Prefixing with `_` keeps it an
 *    ordinary leaf name. Three dots or more is just an odd filename and is
 *    left alone.
 * 3. The result is bounded by {@link MAX_SEGMENT_LENGTH}, keeping the extension
 *    when there is a plausible one.
 *
 * After rule 1 the segment is ASCII-only (`\w` is ASCII in a non-unicode
 * regex), so character length and byte length are the same and rule 3 can slice
 * without splitting a code point.
 */
function sanitize(name: string): string {
    const collapsed = name.replace(/[^\w.-]+/g, '_');
    const leaf =
        collapsed === '' || collapsed === '.' || collapsed === '..'
            ? `_${collapsed}`
            : collapsed;
    if (leaf.length <= MAX_SEGMENT_LENGTH) return leaf;

    const dot = leaf.lastIndexOf('.');
    const extension =
        dot > 0 && leaf.length - dot <= MAX_PRESERVED_EXTENSION
            ? leaf.slice(dot)
            : '';
    const stem = dot > 0 ? leaf.slice(0, dot) : leaf;
    return stem.slice(0, MAX_SEGMENT_LENGTH - extension.length) + extension;
}

/**
 * Removes `from` and each parent up to (but never including) `root`, stopping
 * at the first directory that is not empty.
 *
 * Nothing else ever reclaims `<workspaceId>/<assetId>/`, so without this a
 * workspace that uploads and deletes a million files keeps a million empty
 * directories and their inodes forever. Best-effort by design: any error
 * (`ENOTEMPTY`, `ENOENT`, `EACCES`, a concurrent writer) just ends the walk,
 * because `remove` must stay idempotent and must not fail over housekeeping.
 *
 * The walk only ever moves *upwards* from the removed file's own directory, so
 * it can never descend into a directory a concurrent `put` has just created.
 */
async function pruneEmptyDirectories(from: string, root: string) {
    let directory = from;
    while (directory !== root && directory.startsWith(root + sep)) {
        try {
            await rmdir(directory);
        } catch {
            return;
        }
        directory = dirname(directory);
    }
}

/**
 * The default {@link StorageProvider}: streams blobs to a directory on disk,
 * keyed `<workspaceId>/<assetId>/<filename>` so they stay workspace-partitioned
 * and collision-free. Computes size + sha256 as it writes. Bound at the
 * composition root; the media core depends only on the `StorageProvider` port.
 *
 * `put` is **all-or-nothing**, as the port requires: bytes go to a temporary
 * file and are moved into place with a single `rename` only once the whole body
 * has been written. A body that errors mid-stream, a full disk, or a failed
 * rename therefore leave nothing behind — which matters because a rejected
 * `put` never handed its key back, so anything it left would be garbage no
 * caller could ever name, let alone reclaim.
 */
export function createLocalStorageProvider(
    config: LocalStorageConfig
): StorageProvider {
    // Pinned once, at construction. `rootDir` defaults to a *relative* path, so
    // resolving it per call would silently re-home the whole store the moment
    // anything called `process.chdir()` — the same key would then name two
    // different files depending on when it was used.
    const root = resolve(config.rootDir);

    const keyFor = (
        workspaceId: string,
        assetId: string,
        fileName: string,
        isVariant: boolean
    ) => {
        // The ids are minted server-side (`AssetId.generate()` and the current
        // workspace) and are uuids today, which `sanitize` leaves untouched.
        // They are sanitized anyway so that a key this provider mints is
        // contained by construction, whatever the core hands it — the
        // containment check below is the backstop, not the only line.
        const segments = [sanitize(workspaceId), sanitize(assetId)];
        if (isVariant) {
            // Derivatives live in a reserved `variants/` sub-namespace, so
            // they can never collide with the original blob's key.
            segments.push('variants');
        }
        segments.push(sanitize(fileName));
        return segments.join('/');
    };

    const absolute = (storageKey: string) => {
        // `resolve`, not `join`: `join(root, '/etc/passwd')` quietly rebases an
        // absolute key under the root and hides it from a naive prefix check,
        // whereas `resolve` returns `/etc/passwd` and the check below rejects.
        const target = resolve(root, storageKey);
        const inside = relative(root, target);
        if (
            inside === '' ||
            inside === '..' ||
            inside.startsWith(`..${sep}`) ||
            isAbsolute(inside)
        ) {
            throw new StorageKeyOutsideRootError(storageKey);
        }
        return target;
    };

    return {
        id: 'local',
        capabilities: {
            // A filesystem cannot mint a URL the browser may fetch on its own:
            // serving `rootDir` statically would hand every blob to anyone
            // holding a key, and keys are returned in API responses. Downloads
            // stay proxied through the app's own route.
            directUrl: false,
            // Accepted and dropped — a filesystem has nowhere to put it. The
            // authoritative type stays `media_asset.mime_type`.
            contentTypeMetadata: false,
            streamingPut: true
        },

        async put(object: PutObject): Promise<StoredObject> {
            const storageKey = keyFor(
                object.workspaceId,
                object.assetId,
                object.fileName,
                object.isVariant ?? false
            );
            const target = absolute(storageKey);
            const directory = dirname(target);
            await mkdir(directory, { recursive: true });

            // A fixed-length name of its own rather than one derived from the
            // target, so the temporary file can never be the thing that busts
            // the 255-byte component limit. The leading dot and `.part` suffix
            // make a leftover self-evidently machine droppings.
            const temporary = join(
                directory,
                `.${randomBytes(12).toString('hex')}.part`
            );

            const hash = createHash('sha256');
            let size = 0;
            const meter = new PassThrough();
            meter.on('data', (chunk: Buffer) => {
                size += chunk.length;
                hash.update(chunk);
            });

            try {
                await pipeline(
                    object.body,
                    meter,
                    createWriteStream(temporary)
                );
                // Atomic within a filesystem: the key either names the complete
                // object or names nothing. It also makes two concurrent `put`s
                // on one key resolve to one *intact* body rather than a mix.
                await rename(temporary, target);
            } catch (error) {
                await rm(temporary, { force: true }).catch(() => undefined);
                // The directory chain was created for a write that never
                // landed; leave no trace of it either.
                await pruneEmptyDirectories(directory, root);
                throw error;
            }

            return { storageKey, size, checksum: hash.digest('hex') };
        },

        async get(storageKey: string): Promise<Readable> {
            // The port says `get` rejects when the key is gone.
            // `createReadStream` cannot honour that: it opens lazily, so a
            // missing blob resolved fine and then emitted `ENOENT` when the
            // response was already a streaming 200 that could no longer become
            // a 404. Opening the descriptor here moves the failure back in
            // front of the response.
            //
            // The *kind* of rejection is the port's too, not this backend's:
            // a raw `ENOENT` reaching the controller made a missing blob a
            // **500**, where the row exists and the bytes do not — from the
            // caller's side indistinguishable from a missing asset, which the
            // route already answers 404 for. `ObjectNotFoundError` is what
            // `to-http.ts` maps; `provider-s3` raises the same for `NoSuchKey`.
            //
            // Only `ENOENT`/`ENOTDIR` — a permission error or a full descriptor
            // table is an operator's problem, and reporting it as "not found"
            // would hide an outage behind a plausible 404.
            const handle = await open(absolute(storageKey), 'r').catch(
                (error: NodeJS.ErrnoException) => {
                    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
                        throw new ObjectNotFoundError(storageKey, error);
                    }
                    throw error;
                }
            );
            const stats = await handle.stat();
            if (!stats.isFile()) {
                await handle.close();
                throw Object.assign(
                    new Error(
                        `EISDIR: storage key is not a file: ${storageKey}`
                    ),
                    { code: 'EISDIR' }
                );
            }
            // `autoClose` defaults to *false* for a FileHandle stream, which
            // would leak the descriptor on every download.
            return handle.createReadStream({ autoClose: true });
        },

        async remove(storageKey: string): Promise<void> {
            const target = absolute(storageKey);
            await rm(target, { force: true });
            await pruneEmptyDirectories(dirname(target), root);
        }
    };
}
