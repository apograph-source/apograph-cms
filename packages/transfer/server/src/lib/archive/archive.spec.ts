import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';
import { DEFAULT_TRANSFER_LIMITS } from '@orthacms/transfer-domain';
import { createZipStream, type ZipMember } from './zip-writer';
import {
    ZipReadError,
    looksLikeZip,
    readZipDirectory,
    readZipEntry
} from './zip-reader';

const limits = DEFAULT_TRANSFER_LIMITS;

async function build(members: ZipMember[]): Promise<Buffer> {
    async function* iterate(): AsyncGenerator<ZipMember> {
        for (const member of members) yield member;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of createZipStream(iterate())) chunks.push(chunk);
    return Buffer.concat(chunks);
}

/** Reads every member back into a `{ path: text }` map. */
function readAll(zip: Buffer): Record<string, string> {
    const out: Record<string, string> = {};
    for (const entry of readZipDirectory(zip, limits)) {
        out[entry.path] = readZipEntry(zip, entry, limits).toString('utf8');
    }
    return out;
}

describe('zip round trip', () => {
    it('reads back what it wrote, buffers and streams alike', async () => {
        const big = 'x'.repeat(200_000);
        const zip = await build([
            { path: 'manifest.json', body: Buffer.from('{"version":1}') },
            {
                path: 'entries/post.ndjson',
                body: Buffer.from('{"a":1}\n{"a":2}\n')
            },
            {
                path: 'assets/abc/photo.bin',
                body: Readable.from([
                    Buffer.from(big.slice(0, 100_000)),
                    Buffer.from(big.slice(100_000))
                ])
            }
        ]);

        expect(looksLikeZip(zip)).toBe(true);
        expect(readAll(zip)).toEqual({
            'manifest.json': '{"version":1}',
            'entries/post.ndjson': '{"a":1}\n{"a":2}\n',
            'assets/abc/photo.bin': big
        });
    });

    it('keeps a non-ASCII member name intact', async () => {
        const zip = await build([
            { path: 'assets/abc/фото файл.txt', body: Buffer.from('ok') }
        ]);

        expect(Object.keys(readAll(zip))).toEqual(['assets/abc/фото файл.txt']);
    });

    it('handles an empty member', async () => {
        const zip = await build([{ path: 'empty.txt', body: Buffer.alloc(0) }]);
        expect(readAll(zip)).toEqual({ 'empty.txt': '' });
    });
});

describe('archives written by other tools', () => {
    // The reader has to read what a person zipped on their own machine, not
    // only what this writer produced — the round-trip test above cannot catch a
    // shared misreading of the spec.
    const zipAvailable = (() => {
        try {
            execFileSync('zip', ['-v'], { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    })();

    (zipAvailable ? it : it.skip)('reads a CLI-produced archive', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ortha-zip-'));
        mkdirSync(join(dir, 'entries'));
        writeFileSync(join(dir, 'manifest.json'), '{"version":1}');
        writeFileSync(
            join(dir, 'entries', 'post.ndjson'),
            `${'{"a":1}\n'.repeat(200)}`
        );
        execFileSync(
            'zip',
            ['-r', '-q', 'out.zip', 'manifest.json', 'entries'],
            {
                cwd: dir
            }
        );

        const zip = readFileSync(join(dir, 'out.zip'));
        const read = readAll(zip);
        expect(read['manifest.json']).toBe('{"version":1}');
        expect(read['entries/post.ndjson']).toBe('{"a":1}\n'.repeat(200));
    });
});

describe('hostile archives', () => {
    /**
     * Hand-builds a one-entry archive so a malicious name or a lying size can be
     * planted — the writer refuses to produce either, which is the point.
     */
    function forge(options: {
        path: string;
        raw: Buffer;
        declaredUncompressed?: number;
        entryCount?: number;
    }): Buffer {
        const name = Buffer.from(options.path, 'utf8');
        const payload = deflateRawSync(options.raw);
        const uncompressed = options.declaredUncompressed ?? options.raw.length;

        const local = Buffer.alloc(30 + name.length);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(8, 8);
        local.writeUInt32LE(0, 14);
        local.writeUInt32LE(payload.length, 18);
        local.writeUInt32LE(uncompressed, 22);
        local.writeUInt16LE(name.length, 26);
        name.copy(local, 30);

        const central = Buffer.alloc(46 + name.length);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt32LE(0, 16);
        central.writeUInt32LE(payload.length, 20);
        central.writeUInt32LE(uncompressed, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(0, 42);
        name.copy(central, 46);

        const count = options.entryCount ?? 1;
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(count, 8);
        end.writeUInt16LE(count, 10);
        end.writeUInt32LE(central.length, 12);
        end.writeUInt32LE(local.length + payload.length, 16);

        return Buffer.concat([local, payload, central, end]);
    }

    it('refuses a path that climbs out of the archive [transfer:I-26]', () => {
        const zip = forge({
            path: '../../etc/passwd',
            raw: Buffer.from('pwned')
        });

        expect(() => readZipDirectory(zip, limits)).toThrow(ZipReadError);
        expect(() => readZipDirectory(zip, limits)).toThrow(
            /points outside the archive/
        );
    });

    it('refuses an absolute path', () => {
        expect(() =>
            readZipDirectory(
                forge({ path: '/etc/passwd', raw: Buffer.from('x') }),
                limits
            )
        ).toThrow(/absolute path/);
    });

    it('refuses a Windows drive-letter path', () => {
        expect(() =>
            readZipDirectory(
                forge({ path: 'C:/windows/system32/x', raw: Buffer.from('x') }),
                limits
            )
        ).toThrow(/absolute path/);
    });

    it('refuses a name carrying a null byte', () => {
        expect(() =>
            readZipDirectory(
                forge({ path: 'ok.txt\0.exe', raw: Buffer.from('x') }),
                limits
            )
        ).toThrow(/null byte/);
    });

    it('refuses an entry declaring more than the per-entry ceiling [transfer:I-25]', () => {
        expect(() =>
            readZipDirectory(
                forge({ path: 'big.txt', raw: Buffer.from('x'.repeat(64)) }),
                { ...limits, maxArchiveEntryBytes: 16 }
            )
        ).toThrow(/over the 16 limit/);
    });

    it('refuses an archive whose compression ratio is not real content [transfer:I-25]', () => {
        // The bomb's trick: small enough to pass an upload limit, enormous once
        // unpacked. The ratio is the signal that arrives before the bytes.
        const zip = forge({
            path: 'bomb.txt',
            raw: Buffer.alloc(4 * 1024 * 1024, 0)
        });

        expect(() => readZipDirectory(zip, limits)).toThrow(
            /compressed far beyond/
        );
    });

    it('refuses more entries than the limit before reading any of them [transfer:I-25]', () => {
        expect(() =>
            readZipDirectory(
                forge({
                    path: 'a.txt',
                    raw: Buffer.from('x'),
                    entryCount: 50
                }),
                { ...limits, maxArchiveEntries: 10 }
            )
        ).toThrow(/over the 10 limit/);
    });

    it('stops an entry that unpacks larger than it declares', () => {
        const zip = forge({
            path: 'liar.txt',
            raw: Buffer.from('x'.repeat(10_000)),
            declaredUncompressed: 10
        });
        const [entry] = readZipDirectory(zip, limits);

        expect(() => readZipEntry(zip, entry, limits)).toThrow(
            /unpacks larger than it declares/
        );
    });

    it('rejects a file that is not an archive at all', () => {
        // Long enough to reach the directory scan rather than the length guard,
        // so this exercises "no end-of-central-directory found".
        expect(() =>
            readZipDirectory(
                Buffer.from('not a zip, just text'.repeat(20)),
                limits
            )
        ).toThrow(/not a ZIP archive/);
        expect(looksLikeZip(Buffer.from('nope'))).toBe(false);
    });

    it('rejects a file too short to be an archive', () => {
        expect(() => readZipDirectory(Buffer.from('tiny'), limits)).toThrow(
            /too small to be a ZIP archive/
        );
    });
});

describe('a deterministic archive', () => {
    /**
     * Two exports of identical content have to be identical files, and three
     * separate decisions in `zip-writer.ts` are what make that true: a fixed
     * DOS timestamp instead of the clock, deflate for the text members, and
     * store for the streamed asset bytes.
     *
     * Byte-equality on its own would **not** pin the timestamp — a DOS stamp
     * has two-second resolution, so two archives built from a real clock inside
     * one test run would usually match anyway. The clock is therefore moved a
     * year forward between the two builds, and the date/time fields are read
     * out of the headers besides.
     *
     * Only `Date` is faked: Node's streams schedule on `process.nextTick` and
     * `setImmediate`, and faking those makes the writer's own `for await` hang
     * forever rather than fail.
     */
    const FAKE_DATE_ONLY: Parameters<typeof jest.useFakeTimers>[0] = {
        doNotFake: [
            'nextTick',
            'setImmediate',
            'clearImmediate',
            'queueMicrotask',
            'performance',
            'hrtime'
        ]
    };

    /** 1980-01-01 00:00, the earliest a DOS timestamp can express. */
    const DOS_TIME = 0;
    const DOS_DATE = 0x0021;

    /**
     * Bytes that do not compress — an already-compressed asset, in effect.
     * Generated from a fixed seed so both builds get the same input.
     */
    function incompressible(size: number): Buffer {
        const out = Buffer.alloc(size);
        let state = 0x2545f491;
        for (let i = 0; i < size; i += 1) {
            state ^= state << 13;
            state ^= state >>> 17;
            state ^= state << 5;
            out[i] = state & 0xff;
        }
        return out;
    }

    const ASSET = incompressible(60_000);

    /** A record file: repetitive, so deflate is a real win on it. */
    const RECORDS = Buffer.from(
        '{"$type":"post","$id":"row","values":{"title":"Hello"}}\n'.repeat(200)
    );

    const MANIFEST = Buffer.from(
        JSON.stringify({
            version: 1,
            exportedAt: '1970-01-01T00:00:00.000Z',
            rootType: 'post',
            counts: {
                roots: 1,
                related: 0,
                assets: 1,
                assetBytes: ASSET.length
            }
        })
    );

    function members(): ZipMember[] {
        return [
            { path: 'manifest.json', body: MANIFEST },
            { path: 'entries/post.ndjson', body: RECORDS },
            {
                path: 'assets/asset-1/photo.jpg',
                // A stream, the way the export opens an asset out of storage.
                body: Readable.from([
                    ASSET.subarray(0, 20_000),
                    ASSET.subarray(20_000)
                ])
            }
        ];
    }

    afterEach(() => {
        jest.useRealTimers();
    });

    it('stores the asset bytes and deflates the text members [transfer:I-36]', async () => {
        const zip = await build(members());
        const byPath = Object.fromEntries(
            readZipDirectory(zip, limits).map((entry) => [entry.path, entry])
        );

        // Store, method 0: those bytes are already compressed, and deflating a
        // streamed asset would undo the streaming the writer exists for.
        expect(byPath['assets/asset-1/photo.jpg'].method).toBe(0);
        expect(byPath['assets/asset-1/photo.jpg'].compressedSize).toBe(
            ASSET.length
        );
        // Stored really does mean verbatim: the payload is findable in the
        // archive as it stands, which a deflated member never would be.
        expect(zip.includes(ASSET)).toBe(true);

        // Deflate, method 8, and it earned its place.
        expect(byPath['entries/post.ndjson'].method).toBe(8);
        expect(byPath['entries/post.ndjson'].compressedSize).toBeLessThan(
            RECORDS.length / 2
        );
    });

    it('stamps a fixed timestamp rather than the clock [transfer:I-36]', async () => {
        jest.useFakeTimers(FAKE_DATE_ONLY).setSystemTime(
            new Date('2026-09-04T11:22:33Z')
        );

        const zip = await build(members());

        for (const entry of readZipDirectory(zip, limits)) {
            expect(zip.readUInt16LE(entry.localOffset + 10)).toBe(DOS_TIME);
            expect(zip.readUInt16LE(entry.localOffset + 12)).toBe(DOS_DATE);
        }
    });

    it('writes the same bytes for the same content a year later [transfer:I-36]', async () => {
        jest.useFakeTimers(FAKE_DATE_ONLY).setSystemTime(
            new Date('2026-09-04T11:22:33Z')
        );
        const first = await build(members());
        jest.setSystemTime(new Date('2027-05-17T04:05:06Z'));
        const second = await build(members());

        // Not `toEqual` on the buffers: a diff of 60 KB is unreadable, and the
        // length is the useful first thing to see when this breaks.
        expect(second.length).toBe(first.length);
        expect(second.equals(first)).toBe(true);
    });
});
