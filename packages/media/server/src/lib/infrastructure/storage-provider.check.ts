import {
    Inject,
    Injectable,
    Logger,
    type OnApplicationBootstrap
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@ortha/database';
import { STORAGE_PROVIDER, type StorageProvider } from '@ortha/media-domain';
import { mediaAsset } from './schema/media-asset';

/**
 * Two boot-time checks on the storage seam, both of which exist because the
 * failure they prevent is otherwise invisible until a user hits it.
 *
 * 1. **The backend answers.** `provider.verify()` — a wrong bucket or an
 *    expired key fails the boot instead of surfacing as a 500 on the first
 *    upload, hours later, with nothing in the message naming the cause.
 *
 * 2. **No row names another backend.** A deployment runs exactly one provider,
 *    and every asset row records the `id` of the one that wrote it. Swapping
 *    the provider in `plugins.ts` therefore makes every existing asset
 *    unreadable — its bytes are in a store nothing is connected to any more.
 *    Left alone that is a library of broken images and a 500 per request; here
 *    it is a refusal to start, naming the stale id and how many rows carry it,
 *    so the operator either restores the old provider or moves the blobs
 *    deliberately.
 */
@Injectable()
export class StorageProviderCheck implements OnApplicationBootstrap {
    private readonly logger = new Logger(StorageProviderCheck.name);

    constructor(
        @InjectDatabase() private readonly db: Database,
        @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider
    ) {}

    /** Runs both checks. Throws — and so aborts the boot — on either failure. */
    async onApplicationBootstrap(): Promise<void> {
        await this.provider.verify?.();
        await this.assertNoForeignRows();
    }

    /**
     * Fails when `media_asset` holds a `storage_provider` other than the
     * configured one.
     *
     * A missing table is **not** a failure: migrations are applied by a
     * separate step (`nx run server:db:migrate`), so a fresh database boots the
     * app before `media_asset` exists. Failing there would make the check the
     * reason a clean install cannot start, which is the opposite of its job.
     */
    private async assertNoForeignRows(): Promise<void> {
        let rows: { storageProvider: string; count: number }[];
        try {
            rows = await this.db
                .select({
                    storageProvider: mediaAsset.storageProvider,
                    count: sql<number>`count(*)::int`
                })
                .from(mediaAsset)
                .groupBy(mediaAsset.storageProvider);
        } catch {
            this.logger.debug(
                'Skipped the storage-provider check: `media_asset` is not queryable yet (migrations pending).'
            );
            return;
        }

        const foreign = rows.filter(
            (row) => row.storageProvider !== this.provider.id
        );
        if (foreign.length === 0) return;

        const held = foreign
            .map((row) => `"${row.storageProvider}" (${row.count} assets)`)
            .join(', ');
        throw new Error(
            `The media library holds assets written by a different storage provider: ${held}. ` +
                `This deployment is configured with "${this.provider.id}", which cannot read them — ` +
                'their bytes live in the other backend. Restore the previous provider in `plugins.ts`, ' +
                'or move those blobs before switching.'
        );
    }
}
