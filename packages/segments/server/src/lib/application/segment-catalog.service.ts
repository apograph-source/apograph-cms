import {
    Injectable,
    Logger,
    type OnApplicationBootstrap
} from '@nestjs/common';
import { asc } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import { segmentIdsForTags, type Segment } from '@orthacms/segments-domain';
import { segments } from '../schema/segments';

/**
 * Every segment, held in memory.
 *
 * It is cached because the read path needs it **synchronously**: the predicate
 * is assembled inside the query builder and cannot await, so a reader's tags
 * have to become segment ids before the query is built. The set is bounded by
 * how many audiences a business has and changes only when an administrator
 * edits one, so a full reload on write is cheaper than any invalidation scheme
 * worth writing.
 *
 * Loaded in `onApplicationBootstrap`, which runs inside `app.init()`: a
 * catalogue that cannot be read aborts start-up rather than leaving a server
 * that serves restricted content as though nothing were configured.
 */
@Injectable()
export class SegmentCatalogService implements OnApplicationBootstrap {
    private readonly logger = new Logger(SegmentCatalogService.name);
    private cache: readonly Segment[] = [];

    constructor(@InjectDatabase() private readonly db: Database) {}

    /** Load the catalogue before the first request is served. */
    async onApplicationBootstrap(): Promise<void> {
        await this.reload();
        this.logger.log(
            this.cache.length
                ? `Loaded ${this.cache.length} segment(s).`
                : 'No segments defined — every published entry is readable by everyone.'
        );
    }

    /** Re-read the catalogue. Called after every write. */
    async reload(): Promise<void> {
        const rows = await this.db
            .select()
            .from(segments)
            .orderBy(asc(segments.label));
        this.cache = rows.map((row) => ({
            id: row.id,
            key: row.key,
            label: row.label,
            tags: row.tags ?? [],
            workspaceIds: row.workspaceIds ?? []
        }));
    }

    /** Every segment, newest snapshot. */
    all(): readonly Segment[] {
        return this.cache;
    }

    /**
     * Whether anything is configured at all.
     *
     * With no segment the whole feature is inert: no predicate is emitted, and
     * a read costs exactly what it did before the plugin was installed. That is
     * the state every existing installation is in, and the first thing to keep
     * true when changing this.
     */
    get configured(): boolean {
        return this.cache.length > 0;
    }

    /** The segments a reader's tags resolve to. Read synchronously. */
    resolveTags(tags: readonly string[]): Set<string> {
        return segmentIdsForTags(this.cache, tags);
    }
}
