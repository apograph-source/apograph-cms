import { drizzle } from 'drizzle-orm/node-postgres';
import type { Database, EventActor } from '@orthacms/database';
import type { UploadAssetUseCase } from '@orthacms/media-server';
import {
    TransferAssetMap,
    emptyCounts,
    type ImportCounts,
    type TransferAssetRef
} from '@orthacms/transfer-domain';
import {
    ImportMediaService,
    beginMediaRun,
    type ImportMediaRun
} from './import-media.service';

/**
 * The dedup and rollback halves of the media path, exercised over a real
 * Drizzle instance whose driver is a table in memory.
 *
 * The point of the real query builder rather than a stubbed `findByChecksum`:
 * the invariant is that the lookup is scoped **to this workspace**, and a stub
 * that returned whatever it was told would say nothing about the `WHERE`. The
 * fake driver below answers only what the SQL actually asks for — so dropping
 * `eq(mediaAsset.workspaceId, workspaceId)` makes a foreign workspace's asset
 * match, and the test that says it must not, fails.
 */

/** One row of the pretend `media_asset` table. */
interface AssetRow {
    id: string;
    checksum: string | null;
    workspace_id: string;
}

/** The `column = $n` pairs in a statement, resolved against its parameters. */
function whereOf(text: string, params: unknown[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const match of text.matchAll(
        /"media_asset"\."(\w+)"\s*=\s*\$(\d+)/g
    )) {
        out[match[1]] = params[Number(match[2]) - 1];
    }
    return out;
}

/** A `media_asset` table that answers exactly the query it is handed. */
function fakeDatabase(seed: AssetRow[]) {
    const rows = [...seed];
    const statements: string[] = [];

    const client = {
        query: async (
            config: string | { text: string },
            params: unknown[] = []
        ) => {
            const text = typeof config === 'string' ? config : config.text;
            statements.push(text);
            const predicate = whereOf(text, params);
            const matches = (row: AssetRow): boolean =>
                Object.entries(predicate).every(
                    ([column, value]) =>
                        (row as unknown as Record<string, unknown>)[column] ===
                        value
                );

            if (text.startsWith('select')) {
                // `rowMode: 'array'` — what drizzle's node-postgres session asks for.
                return { rows: rows.filter(matches).map((row) => [row.id]) };
            }
            if (text.startsWith('delete')) {
                for (let i = rows.length - 1; i >= 0; i -= 1) {
                    if (matches(rows[i])) rows.splice(i, 1);
                }
                return { rows: [] };
            }
            return { rows: [] };
        }
    };

    return {
        db: drizzle(client as never) as unknown as Database,
        /** The surviving rows, so a rollback can be observed. */
        rows,
        statements
    };
}

/**
 * Records what it was asked to upload, and — the part that matters for the
 * rollback tests — writes the row into the same table the service deletes
 * from, so "the blob is gone" is a claim the table can refute.
 */
function fakeUploader(rows: AssetRow[]) {
    const uploaded: { fileName: string; workspaceId: string }[] = [];
    let next = 0;
    const upload = {
        execute: async (command: {
            fileName: string;
            workspaceId: string;
        }): Promise<string> => {
            uploaded.push({
                fileName: command.fileName,
                workspaceId: command.workspaceId
            });
            next += 1;
            const id = `new-asset-${next}`;
            // Checksum left unset: the real use case derives it from the
            // bytes, and leaving it null here keeps one test's upload from
            // silently becoming the next one's dedup hit.
            rows.push({
                id,
                checksum: null,
                workspace_id: command.workspaceId
            });
            return id;
        }
    };
    return { upload: upload as unknown as UploadAssetUseCase, uploaded };
}

const WS_A = '00000000-0000-0000-0000-00000000000a';
const WS_B = '00000000-0000-0000-0000-00000000000b';

const actor: EventActor = { id: 'user-1', email: 'ada@example.test' };

function ref(overrides: Partial<TransferAssetRef> = {}): TransferAssetRef {
    return {
        field: 'cover',
        $id: 'source-asset-1',
        path: 'assets/source-asset-1/photo.jpg',
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: 10,
        checksum: 'sha256:aaa',
        ...overrides
    };
}

const ARCHIVE = new Map([
    ['assets/source-asset-1/photo.jpg', Buffer.from('jpeg bytes')]
]);

interface Harness {
    service: ImportMediaService;
    counts: ImportCounts;
    seen: TransferAssetMap;
    run: ImportMediaRun;
    uploaded: { fileName: string; workspaceId: string }[];
    rows: AssetRow[];
}

function harness(seed: AssetRow[] = []): Harness {
    const { db, rows } = fakeDatabase(seed);
    const { upload, uploaded } = fakeUploader(rows);
    return {
        service: new ImportMediaService(db, upload),
        counts: emptyCounts(),
        seen: new TransferAssetMap(),
        run: beginMediaRun(),
        uploaded,
        rows
    };
}

describe('an asset is uploaded only when nothing already matches', () => {
    it('uploads when neither the source id nor the checksum is known here [transfer:I-32]', async () => {
        const h = harness();

        const id = await h.service.resolveAsset(
            ref(),
            ARCHIVE,
            h.seen,
            WS_A,
            false,
            actor,
            h.counts,
            h.run
        );

        expect(id).toBe('new-asset-1');
        expect(h.uploaded).toEqual([
            { fileName: 'photo.jpg', workspaceId: WS_A }
        ]);
        expect(h.counts).toMatchObject({ assetsNew: 1, assetsReused: 0 });
    });

    it('reuses an asset this workspace already holds, by checksum [transfer:I-32]', async () => {
        const h = harness([
            { id: 'existing-1', checksum: 'sha256:aaa', workspace_id: WS_A }
        ]);

        const id = await h.service.resolveAsset(
            ref(),
            ARCHIVE,
            h.seen,
            WS_A,
            false,
            actor,
            h.counts,
            h.run
        );

        expect(id).toBe('existing-1');
        expect(h.uploaded).toEqual([]);
        expect(h.counts).toMatchObject({ assetsNew: 0, assetsReused: 1 });
    });

    it('does not reach across workspaces for the same bytes [transfer:I-32]', async () => {
        // Identical files are ordinary — a shared logo, a stock photo. Matching
        // on the checksum alone would link workspace A's record to workspace
        // B's asset, which is a tenancy leak dressed as an optimisation.
        const h = harness([
            { id: 'other-tenant-1', checksum: 'sha256:aaa', workspace_id: WS_B }
        ]);

        const id = await h.service.resolveAsset(
            ref(),
            ARCHIVE,
            h.seen,
            WS_A,
            false,
            actor,
            h.counts,
            h.run
        );

        expect(id).toBe('new-asset-1');
        expect(h.uploaded).toEqual([
            { fileName: 'photo.jpg', workspaceId: WS_A }
        ]);
        expect(h.counts).toMatchObject({ assetsNew: 1, assetsReused: 0 });
    });

    it('answers a source id already resolved in this run without querying at all [transfer:I-32]', async () => {
        const h = harness();
        h.seen.remember('source-asset-1', 'already-1', 'sha256:aaa');

        const id = await h.service.resolveAsset(
            ref(),
            ARCHIVE,
            h.seen,
            WS_A,
            false,
            actor,
            h.counts,
            h.run
        );

        expect(id).toBe('already-1');
        expect(h.uploaded).toEqual([]);
        // Neither counter moves: this is the same asset the run has already
        // accounted for, not a second reuse.
        expect(h.counts).toMatchObject({ assetsNew: 0, assetsReused: 0 });
    });

    it('counts but does not upload during a dry run [transfer:I-32] [transfer:I-08]', async () => {
        const h = harness();

        const id = await h.service.resolveAsset(
            ref(),
            ARCHIVE,
            h.seen,
            WS_A,
            true,
            actor,
            h.counts,
            h.run
        );

        expect(id).toBeUndefined();
        // "Not one row and not one byte": the e2e pins the rows, and this is
        // the byte half — the dry run counts the upload it *would* make and
        // makes none, so nothing lands in the bucket for a rollback to chase.
        expect(h.uploaded).toEqual([]);
        expect(h.counts).toMatchObject({ assetsNew: 1 });
        expect(h.run.uploaded).toEqual([]);
    });

    it('reports an asset with no bytes in the archive as missing, rather than inventing an id', async () => {
        const h = harness();

        const id = await h.service.resolveAsset(
            ref({ path: 'assets/absent/photo.jpg' }),
            ARCHIVE,
            h.seen,
            WS_A,
            false,
            actor,
            h.counts,
            h.run
        );

        expect(id).toBeUndefined();
        expect(h.uploaded).toEqual([]);
    });

    it('creates nothing for a token-authenticated import with no session user', async () => {
        // `uploaded_by` is NOT NULL, and inventing a person to satisfy it would
        // put a name on the audit trail that did nothing.
        const h = harness();

        const id = await h.service.resolveAsset(
            ref(),
            ARCHIVE,
            h.seen,
            WS_A,
            false,
            null,
            h.counts,
            h.run
        );

        expect(id).toBeUndefined();
        expect(h.uploaded).toEqual([]);
    });
});

describe('the rollback belongs to the run, not to the service', () => {
    /**
     * `ImportMediaService` is a singleton and storage cannot join the import's
     * transaction, so the list of blobs to undo has to live somewhere. Parking
     * it on `this` is the version of this code that looks fine and deletes
     * another import's files.
     */
    it('deletes only what its own run wrote [transfer:I-09]', async () => {
        const { db, rows } = fakeDatabase([]);
        const { upload } = fakeUploader(rows);
        // One service — the singleton — and two concurrent imports through it.
        const service = new ImportMediaService(db, upload);

        const first = beginMediaRun();
        const second = beginMediaRun();
        const counts = emptyCounts();

        const firstId = await service.resolveAsset(
            ref({ $id: 'a' }),
            ARCHIVE,
            new TransferAssetMap(),
            WS_A,
            false,
            actor,
            counts,
            first
        );
        const secondId = await service.resolveAsset(
            ref({ $id: 'b' }),
            ARCHIVE,
            new TransferAssetMap(),
            WS_A,
            false,
            actor,
            counts,
            second
        );

        expect(first.uploaded).toEqual([firstId]);
        expect(second.uploaded).toEqual([secondId]);
        expect(rows.map((row) => row.id)).toEqual([firstId, secondId]);

        // The first import fails and rolls back. The second is still running.
        await service.rollbackRun(first);

        // A run list parked on the singleton would have taken both.
        expect(rows.map((row) => row.id)).toEqual([secondId]);
        expect(second.uploaded).toEqual([secondId]);
    });

    it('empties the run so a second rollback deletes nothing twice [transfer:I-09]', async () => {
        const h = harness();
        await h.service.resolveAsset(
            ref(),
            ARCHIVE,
            h.seen,
            WS_A,
            false,
            actor,
            h.counts,
            h.run
        );

        await h.service.rollbackRun(h.run);
        await h.service.rollbackRun(h.run);

        expect(h.run.uploaded).toEqual([]);
    });

    it('does nothing at all for a run that uploaded nothing [transfer:I-09]', async () => {
        const { db, rows, statements } = fakeDatabase([]);
        const { upload } = fakeUploader(rows);

        await new ImportMediaService(db, upload).rollbackRun(beginMediaRun());

        expect(statements).toEqual([]);
    });
});

describe('without the media plugin', () => {
    it('reports the asset as missing rather than refusing the import', async () => {
        const { db } = fakeDatabase([]);
        const service = new ImportMediaService(db, undefined);
        const counts = emptyCounts();
        const run = beginMediaRun();

        const id = await service.resolveAsset(
            ref(),
            ARCHIVE,
            new TransferAssetMap(),
            WS_A,
            false,
            actor,
            counts,
            run
        );

        expect(id).toBeUndefined();
        expect(run.uploaded).toEqual([]);
    });
});
