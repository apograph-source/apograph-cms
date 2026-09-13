/**
 * A ZIP reader, deliberately paranoid.
 *
 * This is the one place in the plugin where bytes arrive that nobody here
 * wrote, so every decision is made in the order that keeps a hostile archive
 * cheap to refuse:
 *
 * 1. **Read the central directory, not the local headers.** The directory is
 *    the archive's own index and carries every entry's declared sizes, so the
 *    entry count, the per-entry size, the total size and the compression ratio
 *    are all checkable *before* a single byte is inflated. A reader that walks
 *    local headers instead learns the size after paying for it, which is
 *    exactly what a zip bomb is built to exploit.
 * 2. **Resolve paths before anything else.** `../` and absolute paths are
 *    refused outright rather than sanitised, because a sanitised path is a
 *    guess about what the author meant and this author is not to be trusted.
 * 3. **Inflate one entry at a time, with a hard output ceiling.** The declared
 *    size is a claim; `maxOutputLength` makes it a limit.
 *
 * The archive is read from a buffer rather than a stream, and that is the
 * point: the upload is already bounded by `maxUploadBytes`, and having the
 * whole file is what makes the directory-first check possible.
 */

import { inflateRawSync } from 'node:zlib';
import type { TransferLimits } from '@apograph/transfer-domain';

/** Signatures. */
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const LOCAL_HEADER = 0x04034b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** Largest possible end-of-central-directory record (22 bytes + 64 KB comment). */
const MAX_EOCD_SCAN = 22 + 0xffff;

/** One entry, as the central directory describes it. */
export interface ZipEntry {
    path: string;
    method: number;
    compressedSize: number;
    uncompressedSize: number;
    localOffset: number;
}

/** Raised when an archive is malformed or refuses a safety check. */
export class ZipReadError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ZipReadError';
    }
}

/** Whether a buffer starts with a local file header — the archive signature. */
export function looksLikeZip(buffer: Buffer): boolean {
    return buffer.length >= 4 && buffer.readUInt32LE(0) === LOCAL_HEADER;
}

/**
 * Rejects a member path that would escape the archive root.
 *
 * Refused rather than repaired: `../../etc/passwd` sanitised to `etc/passwd`
 * is still a path the author chose and we did not.
 */
function assertSafePath(path: string): string {
    if (path.includes('\0')) {
        throw new ZipReadError('An entry name contains a null byte.');
    }
    const normalized = path.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
        throw new ZipReadError(
            `Entry "${path}" has an absolute path. Archives must contain only relative paths.`
        );
    }
    const segments = normalized.split('/');
    if (segments.some((segment) => segment === '..')) {
        throw new ZipReadError(
            `Entry "${path}" points outside the archive. Archives must contain only relative paths.`
        );
    }
    return normalized;
}

/** Finds the end-of-central-directory record, scanning back from the tail. */
function findEndOfCentralDirectory(buffer: Buffer): number {
    const start = Math.max(0, buffer.length - MAX_EOCD_SCAN);
    for (let i = buffer.length - 22; i >= start; i -= 1) {
        if (buffer.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) return i;
    }
    throw new ZipReadError('The file is not a ZIP archive.');
}

/**
 * Reads the central directory and holds every entry to the configured limits.
 *
 * No entry data is touched here — this is the cheap pass that decides whether
 * the expensive one is allowed to happen at all.
 */
export function readZipDirectory(
    buffer: Buffer,
    limits: TransferLimits
): ZipEntry[] {
    if (buffer.length < 22) {
        throw new ZipReadError('The file is too small to be a ZIP archive.');
    }
    const eocd = findEndOfCentralDirectory(buffer);

    // ZIP64 carries its counts elsewhere; rather than half-support it, say so.
    // An archive this large is over `maxArchiveTotalBytes` regardless.
    if (eocd >= 20 && buffer.readUInt32LE(eocd - 20) === ZIP64_LOCATOR) {
        throw new ZipReadError(
            'ZIP64 archives are not supported. Export in smaller batches.'
        );
    }

    const count = buffer.readUInt16LE(eocd + 10);
    if (count > limits.maxArchiveEntries) {
        throw new ZipReadError(
            `The archive holds ${count} files, over the ${limits.maxArchiveEntries} limit.`
        );
    }
    const directorySize = buffer.readUInt32LE(eocd + 12);
    let cursor = buffer.readUInt32LE(eocd + 16);
    if (cursor + directorySize > buffer.length) {
        throw new ZipReadError('The archive directory is truncated.');
    }

    const entries: ZipEntry[] = [];
    let totalUncompressed = 0;
    let totalCompressed = 0;

    for (let i = 0; i < count; i += 1) {
        if (cursor + 46 > buffer.length) {
            throw new ZipReadError('The archive directory is truncated.');
        }
        if (buffer.readUInt32LE(cursor) !== CENTRAL_HEADER) {
            throw new ZipReadError('The archive directory is corrupt.');
        }
        const method = buffer.readUInt16LE(cursor + 10);
        const compressedSize = buffer.readUInt32LE(cursor + 20);
        const uncompressedSize = buffer.readUInt32LE(cursor + 24);
        const nameLength = buffer.readUInt16LE(cursor + 28);
        const extraLength = buffer.readUInt16LE(cursor + 30);
        const commentLength = buffer.readUInt16LE(cursor + 32);
        const localOffset = buffer.readUInt32LE(cursor + 42);
        const path = buffer
            .subarray(cursor + 46, cursor + 46 + nameLength)
            .toString('utf8');

        cursor += 46 + nameLength + extraLength + commentLength;

        // A directory entry carries no data and is not a member we read.
        if (path.endsWith('/')) continue;

        if (uncompressedSize > limits.maxArchiveEntryBytes) {
            throw new ZipReadError(
                `"${path}" unpacks to ${uncompressedSize} bytes, over the ${limits.maxArchiveEntryBytes} limit.`
            );
        }
        totalUncompressed += uncompressedSize;
        totalCompressed += compressedSize;
        if (totalUncompressed > limits.maxArchiveTotalBytes) {
            throw new ZipReadError(
                `The archive unpacks to more than ${limits.maxArchiveTotalBytes} bytes.`
            );
        }

        entries.push({
            path: assertSafePath(path),
            method,
            compressedSize,
            uncompressedSize,
            localOffset
        });
    }

    // The ratio is the signal that arrives before the bytes do: a bomb's whole
    // trick is being small enough to pass an upload limit. Only meaningful once
    // there is enough compressed data for the ratio to mean anything.
    if (
        totalCompressed > 1024 &&
        totalUncompressed / totalCompressed > limits.maxCompressionRatio
    ) {
        throw new ZipReadError(
            'The archive is compressed far beyond what real content compresses to, and was refused.'
        );
    }

    return entries;
}

/**
 * Inflates one entry.
 *
 * The declared size seeds `maxOutputLength`, so a header that lies about how
 * much it unpacks to is stopped by zlib rather than believed.
 */
export function readZipEntry(
    buffer: Buffer,
    entry: ZipEntry,
    limits: TransferLimits
): Buffer {
    const header = entry.localOffset;
    if (header + 30 > buffer.length) {
        throw new ZipReadError(`"${entry.path}" is truncated.`);
    }
    if (buffer.readUInt32LE(header) !== LOCAL_HEADER) {
        throw new ZipReadError(`"${entry.path}" has a corrupt header.`);
    }
    const nameLength = buffer.readUInt16LE(header + 26);
    const extraLength = buffer.readUInt16LE(header + 28);
    const start = header + 30 + nameLength + extraLength;
    const end = start + entry.compressedSize;
    if (end > buffer.length) {
        throw new ZipReadError(`"${entry.path}" is truncated.`);
    }
    const payload = buffer.subarray(start, end);

    if (entry.method === METHOD_STORE) return Buffer.from(payload);
    if (entry.method !== METHOD_DEFLATE) {
        throw new ZipReadError(
            `"${entry.path}" uses an unsupported compression method.`
        );
    }
    try {
        return inflateRawSync(payload, {
            maxOutputLength: Math.min(
                Math.max(entry.uncompressedSize, 1),
                limits.maxArchiveEntryBytes
            )
        });
    } catch {
        throw new ZipReadError(
            `"${entry.path}" could not be decompressed, or unpacks larger than it declares.`
        );
    }
}
