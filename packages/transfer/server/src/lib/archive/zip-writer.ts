/**
 * A streaming ZIP writer.
 *
 * Written here rather than pulled from npm for the same reason the reader is:
 * this is the code path that carries a workspace's files, and the memory
 * behaviour is the whole point. An export can be hundreds of megabytes of
 * media, so nothing is ever held whole — each asset is piped straight from
 * storage into the response.
 *
 * That streaming is what forces the two format choices below.
 *
 * **Data descriptors.** A local file header has to carry the entry's CRC and
 * sizes, which are not known until the bytes have gone past. General-purpose
 * bit 3 says "the sizes follow the data instead", so the header is written with
 * zeros and a descriptor is appended afterwards. This is the standard streaming
 * arrangement; every mainstream unzip reads it.
 *
 * **Assets are stored, not deflated.** Images, video and PDFs are already
 * compressed — deflating them costs CPU and buys a percent or two — and
 * `deflateRawSync` on a 100 MB file would undo the streaming this file exists
 * for. Text members (the manifest, the record files) *are* deflated: they are
 * small, they are held in memory anyway, and they compress by an order of
 * magnitude.
 */

import { Readable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';
import { Crc32, crc32 } from './crc32';

/** ZIP signatures. */
const LOCAL_HEADER = 0x04034b50;
const DATA_DESCRIPTOR = 0x08074b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

/** Compression methods. */
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/**
 * Bit 3 — sizes follow in a data descriptor. Bit 11 — the name is UTF-8, so a
 * file named in any language survives the trip.
 */
const FLAG_STREAMING_UTF8 = 0x0008 | 0x0800;

/** Version needed to extract: 2.0, which is what deflate + descriptors need. */
const VERSION_NEEDED = 20;

/** One member of the archive. */
export interface ZipMember {
    /** Path inside the archive. Always forward slashes, never absolute. */
    path: string;
    /** In-memory content (deflated), or a byte stream (stored). */
    body: Buffer | NodeJS.ReadableStream;
}

/** What the central directory needs to remember about a finished member. */
interface CentralEntry {
    nameBytes: Buffer;
    method: number;
    crc: number;
    compressedSize: number;
    uncompressedSize: number;
    offset: number;
}

/**
 * DOS date/time, fixed rather than read from the clock.
 *
 * A ZIP records a modification timestamp per entry, and using "now" would make
 * two exports of identical content differ byte for byte — which breaks the
 * round-trip test's ability to compare archives, and makes any future caching
 * of an export useless. 1980-01-01 is the earliest a DOS timestamp can express.
 */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

function localHeader(nameBytes: Buffer, method: number): Buffer {
    const header = Buffer.alloc(30 + nameBytes.length);
    header.writeUInt32LE(LOCAL_HEADER, 0);
    header.writeUInt16LE(VERSION_NEEDED, 4);
    header.writeUInt16LE(FLAG_STREAMING_UTF8, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    // CRC and both sizes are zero here; the data descriptor carries them.
    header.writeUInt32LE(0, 14);
    header.writeUInt32LE(0, 18);
    header.writeUInt32LE(0, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    nameBytes.copy(header, 30);
    return header;
}

function dataDescriptor(
    crc: number,
    compressedSize: number,
    uncompressedSize: number
): Buffer {
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(DATA_DESCRIPTOR, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(compressedSize, 8);
    descriptor.writeUInt32LE(uncompressedSize, 12);
    return descriptor;
}

function centralHeader(entry: CentralEntry): Buffer {
    const header = Buffer.alloc(46 + entry.nameBytes.length);
    header.writeUInt32LE(CENTRAL_HEADER, 0);
    // Version made by: 3.0, "made by Unix".
    header.writeUInt16LE(0x031e, 4);
    header.writeUInt16LE(VERSION_NEEDED, 6);
    header.writeUInt16LE(FLAG_STREAMING_UTF8, 8);
    header.writeUInt16LE(entry.method, 10);
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.compressedSize, 20);
    header.writeUInt32LE(entry.uncompressedSize, 24);
    header.writeUInt16LE(entry.nameBytes.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    // External attributes: 0644, regular file. `>>> 0` because the shift
    // pushes the mode past bit 31, where JS bitwise math would hand back a
    // negative number that `writeUInt32LE` refuses.
    header.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    header.writeUInt32LE(entry.offset, 42);
    entry.nameBytes.copy(header, 46);
    return header;
}

function endOfCentralDirectory(
    count: number,
    size: number,
    offset: number
): Buffer {
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(count, 8);
    end.writeUInt16LE(count, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    return end;
}

/**
 * Normalises a member path.
 *
 * The writer is not the attacker's entry point — the reader is — but an archive
 * this code produces should never *contain* a path the reader would refuse, or
 * a round trip fails on our own output.
 */
function normalizePath(path: string): string {
    return path
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .split('/')
        .filter(
            (segment) => segment !== '' && segment !== '.' && segment !== '..'
        )
        .join('/');
}

/**
 * Builds the archive as a readable byte stream.
 *
 * `members` is an async iterable so the caller can open each asset's stream
 * only when the writer reaches it — a thousand assets do not mean a thousand
 * simultaneously open storage reads.
 */
export function createZipStream(members: AsyncIterable<ZipMember>): Readable {
    return Readable.from(zipChunks(members));
}

async function* zipChunks(
    members: AsyncIterable<ZipMember>
): AsyncGenerator<Buffer> {
    const central: CentralEntry[] = [];
    let offset = 0;

    for await (const member of members) {
        const nameBytes = Buffer.from(normalizePath(member.path), 'utf8');

        if (Buffer.isBuffer(member.body)) {
            const raw = member.body;
            const deflated = deflateRawSync(raw);
            // A tiny or already-compressed buffer can deflate *larger*; storing
            // it then costs less and is still a valid entry.
            const useDeflate = deflated.length < raw.length;
            const payload = useDeflate ? deflated : raw;
            const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;

            const header = localHeader(nameBytes, method);
            yield header;
            yield payload;
            const entry: CentralEntry = {
                nameBytes,
                method,
                crc: crc32(raw),
                compressedSize: payload.length,
                uncompressedSize: raw.length,
                offset
            };
            const descriptor = dataDescriptor(
                entry.crc,
                entry.compressedSize,
                entry.uncompressedSize
            );
            yield descriptor;
            central.push(entry);
            offset += header.length + payload.length + descriptor.length;
            continue;
        }

        // Streamed member: stored, so the bytes pass straight through and the
        // checksum accumulates as they go.
        const header = localHeader(nameBytes, METHOD_STORE);
        yield header;
        const crc = new Crc32();
        let size = 0;
        for await (const chunk of member.body) {
            // A storage provider's stream yields Buffers, but the type admits
            // strings (a stream someone set an encoding on) — take both rather
            // than corrupt the bytes on the one that isn't expected.
            const buffer = Buffer.isBuffer(chunk)
                ? chunk
                : typeof chunk === 'string'
                  ? Buffer.from(chunk, 'utf8')
                  : Buffer.from(chunk as Uint8Array);
            crc.update(buffer);
            size += buffer.length;
            yield buffer;
        }
        const entry: CentralEntry = {
            nameBytes,
            method: METHOD_STORE,
            crc: crc.value,
            compressedSize: size,
            uncompressedSize: size,
            offset
        };
        const descriptor = dataDescriptor(entry.crc, size, size);
        yield descriptor;
        central.push(entry);
        offset += header.length + size + descriptor.length;
    }

    const directoryOffset = offset;
    let directorySize = 0;
    for (const entry of central) {
        const header = centralHeader(entry);
        yield header;
        directorySize += header.length;
    }
    yield endOfCentralDirectory(central.length, directorySize, directoryOffset);
}
