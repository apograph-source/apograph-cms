import { BadRequestException } from '@nestjs/common';
import {
    DEFAULT_TRANSFER_LIMITS,
    TRANSFER_FORMAT,
    type TransferDocument,
    type TransferTypeSchema
} from '@orthacms/transfer-domain';
import { createZipStream, type ZipMember } from '../../archive/zip-writer';
import { readUpload, type UploadedTransferFile } from './upload-reader';

const post: TransferTypeSchema = {
    name: 'post',
    publishable: true,
    paranoid: true,
    i18n: false,
    fields: [{ name: 'title', type: 'text', required: true }]
};

const context = {
    schemas: { post },
    identityFieldsOf: () => ['title'],
    defaultType: 'post',
    limits: DEFAULT_TRANSFER_LIMITS
};

const DOCUMENT: TransferDocument = {
    manifest: {
        version: 1,
        exportedAt: '2026-01-01T00:00:00.000Z',
        sourceWorkspaceId: 'ws-source',
        rootType: 'post',
        depth: {
            relations: true,
            media: true,
            locales: true,
            relationLocales: false
        },
        identity: { post: ['title'] },
        counts: { roots: 1, related: 0, assets: 0, assetBytes: 0 }
    },
    records: [
        {
            $type: 'post',
            $id: 'row-1',
            $key: { title: 'Hello' },
            $depth: 0,
            values: { title: 'Hello' },
            relations: {},
            media: []
        }
    ]
};

/** An upload as multer hands it over. */
function upload(
    originalname: string,
    buffer: Buffer,
    mimetype = 'application/octet-stream'
): UploadedTransferFile {
    return { originalname, mimetype, buffer, size: buffer.length };
}

async function zip(members: ZipMember[]): Promise<Buffer> {
    async function* iterate(): AsyncGenerator<ZipMember> {
        for (const member of members) yield member;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of createZipStream(iterate())) chunks.push(chunk);
    return Buffer.concat(chunks);
}

/** The archive an export of {@link DOCUMENT} produces, plus one asset member. */
function archiveMembers(): ZipMember[] {
    return [
        {
            path: 'manifest.json',
            body: Buffer.from(JSON.stringify(DOCUMENT.manifest))
        },
        {
            path: 'entries/post.ndjson',
            body: Buffer.from(`${JSON.stringify(DOCUMENT.records[0])}\n`)
        },
        { path: 'assets/asset-1/photo.jpg', body: Buffer.from('jpeg bytes') }
    ];
}

describe('the bytes decide the format', () => {
    it('reads a ZIP named .json as the archive it is [transfer:I-28]', async () => {
        // The case the checklist names: somebody renames an export, or a
        // browser guesses an extension. Trusting the name here would hand
        // binary to `jsonParser` and answer "not valid JSON" about a file that
        // is perfectly readable.
        const read = readUpload(
            upload(
                'export.json',
                await zip(archiveMembers()),
                'application/json'
            ),
            context
        );

        expect(read.format).toBe(TRANSFER_FORMAT.Zip);
        expect(read.document.records).toHaveLength(1);
        expect(read.document.records[0].values).toEqual({ title: 'Hello' });
        // And the asset bytes came out with it, which only the archive path
        // can produce.
        expect([...read.assets.keys()]).toEqual(['assets/asset-1/photo.jpg']);
    });

    it('reads a ZIP with a name of no format at all [transfer:I-28]', async () => {
        const read = readUpload(
            upload('download (3)', await zip(archiveMembers())),
            context
        );

        expect(read.format).toBe(TRANSFER_FORMAT.Zip);
        expect(read.document.records).toHaveLength(1);
    });

    it('calls a ZIP of CSVs a CSV import, from what is inside it [transfer:I-28]', async () => {
        // A multi-type CSV export *is* an archive, so the extension and the
        // signature both say "zip" and only the members say what it holds.
        const read = readUpload(
            upload(
                'posts.zip',
                await zip([
                    {
                        path: 'post.csv',
                        body: Buffer.from('$id,title\r\nrow-1,Hello')
                    }
                ])
            ),
            context
        );

        expect(read.format).toBe(TRANSFER_FORMAT.Csv);
        expect(read.document.records[0].values).toEqual({ title: 'Hello' });
    });

    it('sniffs a text document whose name names no format [transfer:I-28]', () => {
        // A short manifest on purpose: the sniffer reads the first 256 bytes,
        // and NDJSON is recognised by a complete object ending before the
        // first newline. A manifest longer than the window is read as JSON —
        // see the note in the judgments file.
        const ndjson = [
            JSON.stringify({ $manifest: { version: 1, rootType: 'post' } }),
            JSON.stringify(DOCUMENT.records[0])
        ].join('\n');

        const read = readUpload(
            upload('pasted-export', Buffer.from(ndjson)),
            context
        );

        expect(read.format).toBe(TRANSFER_FORMAT.Ndjson);
        expect(read.document.records).toHaveLength(1);
    });

    it('tells a one-object JSON document from an NDJSON one by its bytes [transfer:I-28]', () => {
        const read = readUpload(
            upload(
                'pasted-export',
                Buffer.from(JSON.stringify(DOCUMENT, null, 2))
            ),
            context
        );

        expect(read.format).toBe(TRANSFER_FORMAT.Json);
        expect(read.document.records).toHaveLength(1);
    });

    it('ignores an archive member the format does not define', async () => {
        const read = readUpload(
            upload(
                'export.zip',
                await zip([
                    ...archiveMembers(),
                    { path: 'README.txt', body: Buffer.from('unzip me') }
                ])
            ),
            context
        );

        expect(read.document.records).toHaveLength(1);
    });
});

describe('a file that is not UTF-8', () => {
    /** `Привет` in CP1251 — one byte per letter, none of them valid UTF-8. */
    const CP1251 = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);

    it('is refused rather than imported as replacement characters [transfer:I-29]', () => {
        // `Buffer.toString('utf8')` never throws — it substitutes U+FFFD — so
        // the failure this prevents is silent: a spreadsheet saved in the
        // regional default imports "successfully" and every non-ASCII title
        // becomes a row of question marks that nobody notices until later.
        const file = Buffer.concat([
            Buffer.from('$id,title\r\nrow-1,'),
            CP1251
        ]);
        // What a lenient decode would have produced, and what the row would
        // then have been imported as.
        expect(file.toString('utf8')).toContain('�');

        expect(() => readUpload(upload('post.csv', file), context)).toThrow(
            BadRequestException
        );
        expect(() => readUpload(upload('post.csv', file), context)).toThrow(
            /not valid UTF-8/
        );
    });

    it('refuses it inside an archive too [transfer:I-29]', async () => {
        const bad = await zip([
            {
                path: 'manifest.json',
                body: Buffer.from(JSON.stringify(DOCUMENT.manifest))
            },
            {
                path: 'entries/post.ndjson',
                body: Buffer.concat([
                    Buffer.from('{"$type":"post","values":{"title":"'),
                    CP1251,
                    Buffer.from('"}}\n')
                ])
            }
        ]);

        expect(() => readUpload(upload('export.zip', bad), context)).toThrow(
            /not valid UTF-8/
        );
    });

    it('accepts the same text saved as UTF-8', () => {
        // The control. Without it the two refusals above would also pass on a
        // reader that refused every CSV.
        const file = Buffer.from('$id,title\r\nrow-1,Привет', 'utf8');

        const read = readUpload(upload('post.csv', file), context);

        expect(read.document.records[0].values).toEqual({ title: 'Привет' });
    });
});

describe('the ceilings the reader holds an upload to', () => {
    it('refuses an empty file', () => {
        expect(() =>
            readUpload(upload('export.json', Buffer.alloc(0)), context)
        ).toThrow(/that file is empty/i);
    });

    it('refuses a file over the upload limit, at the same number multer uses', () => {
        const limits = { ...DEFAULT_TRANSFER_LIMITS, maxUploadBytes: 64 };
        const file = upload('export.json', Buffer.alloc(65, 0x20));

        expect(() => readUpload(file, { ...context, limits })).toThrow(
            /over the 64-byte upload limit/
        );
    });
});
