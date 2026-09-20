import { Readable } from 'node:stream';
import type { AnyContentType } from '@orthacms/content-server';
import type { StorageProvider } from '@orthacms/media-server';
import {
    DEFAULT_TRANSFER_LIMITS,
    TRANSFER_FORMAT,
    TRANSFER_FORMAT_CAPABILITIES,
    type TransferDepth,
    type TransferFormat,
    type TransferTypeSchema
} from '@orthacms/transfer-domain';
import {
    looksLikeZip,
    readZipDirectory,
    readZipEntry
} from '../../archive/zip-reader';
import type { TransferSchemaCatalog } from '../../schema/schema-catalog.service';
import type {
    EntryGraphWalker,
    WalkResult,
    WalkedAsset
} from '../infrastructure/entry-graph.walker';
import { ExportEntriesUseCase } from './export-entries.use-case';

const post: TransferTypeSchema = {
    name: 'post',
    publishable: true,
    paranoid: true,
    i18n: false,
    fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'cover', type: 'media', required: false }
    ]
};

const TYPE = { name: 'post' } as unknown as AnyContentType;

function asset(id: string): WalkedAsset {
    return {
        id,
        name: `${id}.jpg`,
        mimeType: 'image/jpeg',
        size: 9,
        checksum: `sha256:${id}`,
        alt: null,
        storageKey: `ws/${id}/original`,
        path: `assets/${id}/${id}.jpg`
    };
}

/** One record naming both assets, so a hole in the archive is visible from it. */
function walkResult(): WalkResult {
    const assets = new Map([
        ['present', asset('present')],
        ['pruned', asset('pruned')]
    ]);
    return {
        records: [
            {
                $type: 'post',
                $id: 'row-1',
                $key: { title: 'Hello' },
                $depth: 0,
                values: { title: 'Hello' },
                relations: {},
                media: [...assets.values()].map((walked) => ({
                    field: 'cover',
                    $id: walked.id,
                    path: walked.path,
                    name: walked.name,
                    mimeType: walked.mimeType,
                    size: walked.size,
                    checksum: walked.checksum
                }))
            }
        ],
        assets,
        counts: { roots: 1, related: 0, assets: 2, assetBytes: 18 }
    };
}

const DEPTH: TransferDepth = {
    relations: true,
    media: true,
    locales: true,
    relationLocales: false
};

/**
 * Storage that has the bytes for one asset and has lost the other — a blob
 * pruned, moved, or never written, with the row still in the library.
 */
function storageMissing(key: string) {
    const requested: string[] = [];
    const provider = {
        id: 'local',
        async get(storageKey: string): Promise<NodeJS.ReadableStream> {
            requested.push(storageKey);
            if (storageKey === key) throw new Error('NoSuchKey');
            return Readable.from([Buffer.from('jpeg here')]);
        }
    } as unknown as StorageProvider;
    return { provider, requested };
}

function catalog(): TransferSchemaCatalog {
    return {
        schemas: () => ({ post }),
        identityFieldsOf: () => ['title'],
        identityMap: () => ({ post: ['title'] })
    } as unknown as TransferSchemaCatalog;
}

function walker(result: WalkResult = walkResult()): EntryGraphWalker {
    return { walk: async () => result } as unknown as EntryGraphWalker;
}

async function collect(body: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

/** The archive's members as `{ path: bytes }`. */
function membersOf(zip: Buffer): Record<string, Buffer> {
    const out: Record<string, Buffer> = {};
    for (const entry of readZipDirectory(zip, DEFAULT_TRANSFER_LIMITS)) {
        out[entry.path] = readZipEntry(zip, entry, DEFAULT_TRANSFER_LIMITS);
    }
    return out;
}

function run(
    format: TransferFormat,
    storage?: StorageProvider,
    depth: TransferDepth = DEPTH,
    result?: WalkResult
) {
    return new ExportEntriesUseCase(walker(result), catalog(), storage).execute(
        {
            type: TYPE,
            ids: ['row-1'],
            workspaceId: 'ws-1',
            format,
            depth
        }
    );
}

describe('an object missing from storage', () => {
    it('is a hole in the archive, not a failed export [transfer:I-35]', async () => {
        const { provider, requested } = storageMissing('ws/pruned/original');

        const download = await run(TRANSFER_FORMAT.Zip, provider);
        const members = membersOf(await collect(download.body));

        // Both were attempted; only the one with bytes behind it is a member.
        expect(requested.sort()).toEqual([
            'ws/present/original',
            'ws/pruned/original'
        ]);
        expect(Object.keys(members).sort()).toEqual([
            'assets/present/present.jpg',
            'entries/post.ndjson',
            'manifest.json'
        ]);
        expect(members['assets/present/present.jpg'].toString()).toBe(
            'jpeg here'
        );
    });

    it('leaves the record still naming the asset [transfer:I-35]', async () => {
        // The other half, and the reason a hole beats a refusal: the import
        // side reports a missing file against a record that is otherwise
        // whole, rather than nobody getting a download at all.
        const { provider } = storageMissing('ws/pruned/original');

        const download = await run(TRANSFER_FORMAT.Zip, provider);
        const members = membersOf(await collect(download.body));
        const record = JSON.parse(
            members['entries/post.ndjson'].toString().trim()
        ) as { media: { $id: string }[] };

        expect(record.media.map((ref) => ref.$id).sort()).toEqual([
            'present',
            'pruned'
        ]);
    });

    it('still counts it — the manifest describes the walk, not the archive [transfer:I-35]', async () => {
        const { provider } = storageMissing('ws/pruned/original');

        const download = await run(TRANSFER_FORMAT.Zip, provider);
        const members = membersOf(await collect(download.body));

        expect(
            (
                JSON.parse(members['manifest.json'].toString()) as {
                    counts: { assets: number };
                }
            ).counts.assets
        ).toBe(2);
        expect(download.result.counts.assets).toBe(2);
    });

    it('produces an archive a reader still accepts', async () => {
        // A member skipped mid-stream is a chance to write a central directory
        // that disagrees with what was actually emitted.
        const { provider } = storageMissing('ws/pruned/original');

        const zip = await collect(
            (await run(TRANSFER_FORMAT.Zip, provider)).body
        );

        expect(looksLikeZip(zip)).toBe(true);
        expect(readZipDirectory(zip, DEFAULT_TRANSFER_LIMITS)).toHaveLength(3);
    });
});

describe('asset bytes travel only in a ZIP', () => {
    it('is what the capability table says, in one place [transfer:I-33]', () => {
        const carriers = Object.entries(TRANSFER_FORMAT_CAPABILITIES)
            .filter(([, capabilities]) => capabilities.carriesFileBytes)
            .map(([format]) => format);

        expect(carriers).toEqual([TRANSFER_FORMAT.Zip]);
    });

    it.each([TRANSFER_FORMAT.Json, TRANSFER_FORMAT.Ndjson])(
        'opens no storage stream for %s, even with media asked for [transfer:I-33]',
        async (format) => {
            // The export dialog reads the same table to disable the Files
            // toggle. If the server decided by any other route, the interface
            // could promise bytes the download would quietly not contain.
            const { provider, requested } = storageMissing('nothing');

            const download = await run(format, provider);
            const body = await collect(download.body);

            expect(requested).toEqual([]);
            expect(looksLikeZip(body)).toBe(false);
            expect(download.mimeType).toBe(
                TRANSFER_FORMAT_CAPABILITIES[format].mimeType
            );
            expect(download.filename).toMatch(
                new RegExp(
                    `\\.${TRANSFER_FORMAT_CAPABILITIES[format].extension}$`
                )
            );
            // The metadata travels even where the bytes cannot.
            expect(body.toString()).toContain('sha256:present');
        }
    );

    it('carries the bytes for zip [transfer:I-33]', async () => {
        // The control: without it every assertion above would also hold for a
        // build that never carried an asset anywhere.
        const { provider } = storageMissing('nothing');

        const zip = await collect(
            (await run(TRANSFER_FORMAT.Zip, provider)).body
        );

        expect(Object.keys(membersOf(zip))).toEqual(
            expect.arrayContaining([
                'assets/present/present.jpg',
                'assets/pruned/pruned.jpg'
            ])
        );
    });

    it('carries no bytes when the media toggle is off, zip or not [transfer:I-33]', async () => {
        const { provider, requested } = storageMissing('nothing');

        const zip = await collect(
            (
                await run(TRANSFER_FORMAT.Zip, provider, {
                    ...DEPTH,
                    media: false
                })
            ).body
        );

        expect(requested).toEqual([]);
        expect(Object.keys(membersOf(zip)).sort()).toEqual([
            'entries/post.ndjson',
            'manifest.json'
        ]);
    });

    it('carries no bytes with no media plugin registered [transfer:I-33]', async () => {
        // `STORAGE_PROVIDER` is optional: without media the export still runs
        // and the media fields travel as references.
        const zip = await collect((await run(TRANSFER_FORMAT.Zip)).body);

        expect(Object.keys(membersOf(zip)).sort()).toEqual([
            'entries/post.ndjson',
            'manifest.json'
        ]);
    });
});
