import { UnitOfWork } from '@orthacms/database';
import type { StorageProvider } from '@orthacms/media-domain';
import { MediaWorkspacePurger } from './media-workspace.purger';

/**
 * What a workspace delete does to media, at the two seams the end-to-end suite
 * cannot see through.
 *
 * `workspace-regressions.spec.ts` asserts the rows are gone. It cannot assert
 * how — and "how" is the whole design here. A workspace can hold tens of
 * thousands of assets, so this is deliberately **set-based**: one `delete` per
 * table, no aggregates loaded, and no `media.asset.deleted` per asset (the
 * `workspace.deleted` audit row is the event that happened). A purger that
 * walked the assets one at a time would pass that e2e and take a large
 * workspace's deletion from a second to an hour.
 *
 * Nor can it see the **blobs**: the rows are gone either way, and nothing the
 * API can be asked afterwards distinguishes bytes freed from bytes stranded in
 * the backend with no row left to find them by.
 */
describe('MediaWorkspacePurger', () => {
    type Row = Record<string, unknown>;

    /**
     * A `UnitOfWork` whose executor records every `delete(table)` and answers
     * each with the next prepared batch of rows.
     */
    function unitOfWork(batches: Row[][]) {
        const deletes: unknown[] = [];
        let call = 0;
        const executor = {
            delete: (table: unknown) => {
                deletes.push(table);
                const rows = batches[call++] ?? [];
                return {
                    where: () => ({ returning: () => Promise.resolve(rows) })
                };
            }
        };
        return {
            deletes,
            uow: { current: () => executor } as unknown as UnitOfWork
        };
    }

    const storage = (id = 'local') => {
        const remove = jest.fn().mockResolvedValue(undefined);
        return {
            provider: { id, remove } as unknown as StorageProvider,
            remove
        };
    };

    const ASSETS: Row[] = [
        {
            storageKey: 'ws-1/hero.png',
            storageProvider: 'local',
            variants: {
                thumb: { key: 'variants/ws-1/hero-thumb.webp' },
                preview: { key: 'variants/ws-1/hero-preview.webp' }
            }
        },
        {
            storageKey: 'ws-1/notes.txt',
            storageProvider: 'local',
            variants: {}
        }
    ];

    // covers: media:I-35
    it('empties both tables with one delete each, and no per-asset event', async () => {
        const { deletes, uow } = unitOfWork([ASSETS, [{ id: 'folder-1' }]]);
        const { provider } = storage();

        const outcome = await new MediaWorkspacePurger(uow, provider).purge(
            'ws-1'
        );

        // Two statements for two tables, whatever the row count — not two per
        // asset, and not one per asset plus one.
        expect(deletes).toHaveLength(2);
        expect(outcome.rows).toBe(3);
        // Nothing to drain: the purger holds no outbox writer and loads no
        // aggregate, so there is no `media.asset.deleted` to emit.
        expect(outcome).not.toHaveProperty('events');
    });

    // covers: media:I-35
    it('frees the original and every derivative, once the delete has committed', async () => {
        const { uow } = unitOfWork([ASSETS, []]);
        const { provider, remove } = storage();

        const outcome = await new MediaWorkspacePurger(uow, provider).purge(
            'ws-1'
        );

        // Post-commit: the reclaim is handed back as a thunk rather than run
        // inside the transaction, so a rolled-back delete destroys no bytes.
        expect(remove).not.toHaveBeenCalled();

        await outcome.reclaim?.();

        expect(remove.mock.calls.map(([key]) => key).sort()).toEqual([
            'variants/ws-1/hero-preview.webp',
            'variants/ws-1/hero-thumb.webp',
            'ws-1/hero.png',
            'ws-1/notes.txt'
        ]);
    });

    // covers: media:I-03
    it('never hands a foreign provider’s key to this deployment’s backend', async () => {
        // Those bytes are in a backend this process is not connected to; the
        // key would name an object here that belongs to something else.
        const { uow } = unitOfWork([
            [
                {
                    storageKey: 's3/hero.png',
                    storageProvider: 's3',
                    variants: {}
                }
            ],
            []
        ]);
        const { provider, remove } = storage('local');

        const outcome = await new MediaWorkspacePurger(uow, provider).purge(
            'ws-1'
        );
        await outcome.reclaim?.();

        expect(remove).not.toHaveBeenCalled();
    });
});
