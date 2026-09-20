import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { InjectDatabase, type Database } from '@orthacms/database';
import { InjectContentRegistry } from '../../../content.tokens';
import type { ContentTypeRegistry } from '../../../registry/content-type-registry';
import type { AnyContentType } from '../../../types/content-type';
import { ENTRY_STATUS } from '../../../types/content-type';
import { contentEntryRevisions } from '../../../revisions/infrastructure/persistence/revision-table';
import type {
    ContentPipelineView,
    ContentPunchcardView,
    ContentStaleView,
    ContentTotalsView,
    ContentUnshippedView,
    ContentVelocityView,
    InsightsSeriesPoint
} from '../../types/content-insights-view';

/** A generated content table seen as a bag of columns by property name. */
type ContentTable = Record<string, AnyColumn>;

/** Bucket widths a time series can be grouped into. */
type Granularity = 'day' | 'week' | 'month';

/** Age boundaries (in days) of the staleness breakdown, freshest first. */
const STALE_BOUNDS = [
    { id: 'd30', upTo: 30 },
    { id: 'd90', upTo: 90 },
    { id: 'd180', upTo: 180 },
    { id: 'd365', upTo: 365 }
] as const;

/** Sparkline points on the stat tiles — enough to read a shape, no axis. */
const HISTORY_POINTS = 8;

/** Reads a generated table's columns by property name. */
function columnsOf(type: AnyContentType): ContentTable {
    return type.table as unknown as ContentTable;
}

/**
 * Picks a bucket width for a window.
 *
 * Bounded so a series never returns hundreds of points: a 12-month range grouped
 * by day would be 365 buckets for a sparkline that is 64 pixels wide.
 */
function granularityFor(days: number): Granularity {
    if (days <= 31) return 'day';
    if (days <= 120) return 'week';
    return 'month';
}

/**
 * The bucket unit as a SQL **literal**, never a bound parameter.
 *
 * This looks like a pointless detour and is load-bearing. Drizzle re-renders a
 * reused `sql` fragment at each call site, so `date_trunc(${granularity}, …)`
 * becomes `$1` in the SELECT and `$4` in the GROUP BY — Postgres then sees two
 * different expressions and rejects the query with "column must appear in the
 * GROUP BY clause". Emitting the unit inline makes the two textually identical,
 * which is what lets it match.
 *
 * Safe to inline because it is not caller data: `Granularity` is a closed union
 * produced only by {@link granularityFor} from a bounded number, and the switch
 * below maps it to a fixed literal rather than interpolating the variable.
 */
function truncUnit(granularity: Granularity): SQL {
    switch (granularity) {
        case 'day':
            return sql`'day'`;
        case 'week':
            return sql`'week'`;
        case 'month':
            return sql`'month'`;
    }
}

/** The instant a window of `days` starts, relative to now. */
function windowStart(days: number): Date {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - days);
    return start;
}

/**
 * Live read-model for the content Insights widgets.
 *
 * Every figure is aggregated **on demand** from the collection tables rather
 * than folded into a projection. That is a deliberate trade for this stage: the
 * counts are workspace-scoped and hit the existing
 * `(workspace_id, …)` list indexes, so they are cheap at the scale a single
 * workspace's content reaches, and a projection would add a table, migrations
 * and a rebuild path to maintain before anything proved it was needed. The seam
 * to change later is this class alone — the HTTP contract and the widgets don't
 * know where the numbers come from.
 *
 * Each method queries **per content type** and merges in memory. There is no
 * single table to group over: a collection is its own generated
 * `content_<name>` table, so "entries in this workspace" is inherently a fan-out.
 */
@Injectable()
export class ContentInsightsQuery {
    constructor(
        @InjectDatabase() private readonly db: Database,
        @InjectContentRegistry() private readonly registry: ContentTypeRegistry
    ) {}

    /**
     * Restricts a read to one workspace, and to rows that still exist.
     *
     * The soft-delete clause is why this is shared rather than inlined: a
     * tombstoned entry is still a row, and a count that forgets `deleted_at`
     * silently reports deleted content as live — the kind of wrong number a
     * dashboard is believed on.
     */
    private scope(type: AnyContentType, workspaceId: string): SQL | undefined {
        const columns = columnsOf(type);
        return and(
            eq(columns['workspaceId'], workspaceId),
            type.paranoid ? isNull(columns['deletedAt']) : undefined
        );
    }

    /** Counts rows of one type matching an extra predicate. */
    private async countOf(
        type: AnyContentType,
        workspaceId: string,
        extra?: SQL
    ): Promise<number> {
        const [row] = await this.db
            .select({ n: sql<number>`cast(count(*) as int)` })
            .from(type.table as PgTable)
            .where(and(this.scope(type, workspaceId), extra));
        return row?.n ?? 0;
    }

    /**
     * Counts rows per time bucket over a window, for one type and one
     * timestamp column. Returns raw buckets — the caller decides whether they
     * are a series or the increments of a cumulative total.
     */
    private async bucketed(
        type: AnyContentType,
        workspaceId: string,
        column: AnyColumn,
        days: number,
        granularity: Granularity
    ): Promise<Map<string, number>> {
        const truncated = sql`date_trunc(${truncUnit(granularity)}, ${column})`;
        const rows = await this.db
            .select({
                bucket: sql<string>`to_char(${truncated}, 'YYYY-MM-DD')`,
                n: sql<number>`cast(count(*) as int)`
            })
            .from(type.table as PgTable)
            .where(
                and(
                    this.scope(type, workspaceId),
                    sql`${column} >= ${windowStart(days)}`
                )
            )
            .groupBy(truncated);

        return new Map(rows.map((row) => [row.bucket, row.n]));
    }

    /** Headline counts, deltas and sparkline history for the stat tiles. */
    async totals(
        workspaceId: string,
        days: number
    ): Promise<ContentTotalsView> {
        const types = this.registry.all();
        const granularity = granularityFor(days);

        let entries = 0;
        let published = 0;
        let drafts = 0;
        const createdBuckets = new Map<string, number>();
        const publishedBuckets = new Map<string, number>();

        for (const type of types) {
            const columns = columnsOf(type);

            entries += await this.countOf(type, workspaceId);

            // A non-publishable type has no draft stage at all — every row is
            // live. Counting it as "published" is the honest reading; treating
            // it as neither would make the two tiles fail to add up to the total.
            if (type.publishable) {
                published += await this.countOf(
                    type,
                    workspaceId,
                    eq(columns['status'], ENTRY_STATUS.Published)
                );
                drafts += await this.countOf(
                    type,
                    workspaceId,
                    eq(columns['status'], ENTRY_STATUS.Draft)
                );
                mergeBuckets(
                    publishedBuckets,
                    await this.bucketed(
                        type,
                        workspaceId,
                        columns['publishedAt'],
                        days,
                        granularity
                    )
                );
            } else {
                published += await this.countOf(type, workspaceId);
            }

            mergeBuckets(
                createdBuckets,
                await this.bucketed(
                    type,
                    workspaceId,
                    columns['createdAt'],
                    days,
                    granularity
                )
            );
        }

        const entriesDelta = sumOf(createdBuckets);
        const publishedDelta = sumOf(publishedBuckets);

        return {
            entries,
            published,
            drafts,
            entriesDelta,
            publishedDelta,
            entriesHistory: cumulativeFrom(
                entries - entriesDelta,
                createdBuckets
            ),
            publishedHistory: cumulativeFrom(
                published - publishedDelta,
                publishedBuckets
            )
        };
    }

    /** Published entries grouped by how long ago they were last edited. */
    async stale(workspaceId: string): Promise<ContentStaleView> {
        const counts = new Map<string, number>(
            STALE_BOUNDS.map((bound) => [bound.id, 0])
        );
        counts.set('older', 0);

        for (const type of this.registry.all()) {
            const columns = columnsOf(type);
            const updatedAt = columns['updatedAt'];

            // Only live content can be "stale" — an untouched draft is a draft,
            // not a neglected published page, and mixing them would inflate
            // every bucket with work that was never finished in the first place.
            const liveOnly = type.publishable
                ? eq(columns['status'], ENTRY_STATUS.Published)
                : undefined;

            const [row] = await this.db
                .select({
                    d30: bucketExpression(updatedAt, 0, 30),
                    d90: bucketExpression(updatedAt, 30, 90),
                    d180: bucketExpression(updatedAt, 90, 180),
                    d365: bucketExpression(updatedAt, 180, 365),
                    older: sql<number>`cast(count(*) filter (
                        where ${updatedAt} < now() - make_interval(days => 365)
                    ) as int)`
                })
                .from(type.table as PgTable)
                .where(and(this.scope(type, workspaceId), liveOnly));

            if (!row) continue;
            for (const key of [
                'd30',
                'd90',
                'd180',
                'd365',
                'older'
            ] as const) {
                counts.set(key, (counts.get(key) ?? 0) + (row[key] ?? 0));
            }
        }

        const buckets = [...STALE_BOUNDS.map((b) => b.id), 'older'].map(
            (id) => ({ id, count: counts.get(id) ?? 0 })
        );

        return {
            buckets,
            total: buckets.reduce((sum, bucket) => sum + bucket.count, 0)
        };
    }

    /** Draft/published split per content type. */
    async pipeline(workspaceId: string): Promise<ContentPipelineView> {
        const types: ContentPipelineView['types'] = [];

        for (const type of this.registry.all()) {
            const columns = columnsOf(type);

            const published = type.publishable
                ? await this.countOf(
                      type,
                      workspaceId,
                      eq(columns['status'], ENTRY_STATUS.Published)
                  )
                : await this.countOf(type, workspaceId);
            const drafts = type.publishable
                ? await this.countOf(
                      type,
                      workspaceId,
                      eq(columns['status'], ENTRY_STATUS.Draft)
                  )
                : 0;

            // A type the workspace has never used is noise on a chart about
            // where the workspace's weight sits.
            if (published + drafts === 0) continue;

            types.push({
                name: type.name,
                label: type.label,
                published,
                drafts
            });
        }

        types.sort((a, b) => b.published + b.drafts - (a.published + a.drafts));
        return { types };
    }

    /**
     * Live content carrying unpublished edits, per type and in total.
     *
     * The three figures come out of **one** grouped query per type rather than
     * three `countOf` calls, because they partition the same rows: a scan that
     * has already found a row can decide which of the three it belongs to.
     *
     * A **non-publishable** type contributes nothing at all — not even to
     * `live`. It has no draft stage, so every row is trivially current, and
     * folding those rows into the denominator would make "3 of 900 live records
     * have pending edits" a number about a workspace's always-live singletons
     * rather than about anything an editor can ship.
     */
    async unshipped(workspaceId: string): Promise<ContentUnshippedView> {
        const types: ContentUnshippedView['types'] = [];
        let modified = 0;
        let live = 0;
        let neverPublished = 0;

        for (const type of this.registry.all()) {
            if (!type.publishable) continue;
            const columns = columnsOf(type);
            const status = columns['status'];
            const publishedAt = columns['publishedAt'];

            const [row] = await this.db
                .select({
                    modified: sql<number>`cast(count(*) filter (
                        where ${status} = ${ENTRY_STATUS.Draft}
                          and ${publishedAt} is not null
                    ) as int)`,
                    published: sql<number>`cast(count(*) filter (
                        where ${status} = ${ENTRY_STATUS.Published}
                    ) as int)`,
                    neverPublished: sql<number>`cast(count(*) filter (
                        where ${status} = ${ENTRY_STATUS.Draft}
                          and ${publishedAt} is null
                    ) as int)`
                })
                .from(type.table as PgTable)
                .where(this.scope(type, workspaceId));

            if (!row) continue;
            modified += row.modified;
            live += row.modified + row.published;
            neverPublished += row.neverPublished;

            // A type with nothing pending is not a row on a chart about what is
            // pending — it would be a permanently empty bar diluting the ones
            // that mean something.
            if (row.modified === 0) continue;
            types.push({
                name: type.name,
                label: type.label,
                modified: row.modified,
                published: row.published
            });
        }

        types.sort((a, b) => b.modified - a.modified);
        return { types, modified, live, neverPublished };
    }

    /** Entries published per time bucket across the window. */
    async velocity(
        workspaceId: string,
        days: number
    ): Promise<ContentVelocityView> {
        const granularity = granularityFor(days);
        const merged = new Map<string, number>();

        for (const type of this.registry.all()) {
            if (!type.publishable) continue;
            mergeBuckets(
                merged,
                await this.bucketed(
                    type,
                    workspaceId,
                    columnsOf(type)['publishedAt'],
                    days,
                    granularity
                )
            );
        }

        return { points: toSeries(merged), granularity };
    }

    /**
     * Editing activity by weekday and hour, from the revision store.
     *
     * The one content figure that is a single grouped query rather than a
     * fan-out: `content_entry_revisions` is generic across every type, so the
     * whole workspace's editing history lives in one table.
     *
     * Hours come out in the database session's timezone (UTC in every
     * deployment we run). Rendering them as local time would need each
     * viewer's offset applied to the grouping, not to the labels — shifting
     * the labels alone would silently mislabel the buckets.
     */
    async punchcard(
        workspaceId: string,
        days: number
    ): Promise<ContentPunchcardView> {
        const rows = await this.db
            .select({
                weekday: sql<number>`cast(extract(isodow from ${contentEntryRevisions.createdAt}) as int)`,
                hour: sql<number>`cast(extract(hour from ${contentEntryRevisions.createdAt}) as int)`,
                count: sql<number>`cast(count(*) as int)`
            })
            .from(contentEntryRevisions)
            .where(
                and(
                    eq(contentEntryRevisions.workspaceId, workspaceId),
                    sql`${contentEntryRevisions.createdAt} >= ${windowStart(days)}`
                )
            )
            .groupBy(
                sql`extract(isodow from ${contentEntryRevisions.createdAt})`,
                sql`extract(hour from ${contentEntryRevisions.createdAt})`
            );

        return {
            cells: rows,
            max: rows.reduce((peak, row) => Math.max(peak, row.count), 0),
            total: rows.reduce((sum, row) => sum + row.count, 0)
        };
    }
}

/** Counts rows whose timestamp falls in a half-open age window, in days. */
function bucketExpression(
    column: AnyColumn,
    fromDays: number,
    toDays: number
): SQL<number> {
    return sql<number>`cast(count(*) filter (
        where ${column} <= now() - make_interval(days => ${fromDays})
          and ${column} > now() - make_interval(days => ${toDays})
    ) as int)`;
}

/** Adds one type's bucket counts into a running total across types. */
function mergeBuckets(
    into: Map<string, number>,
    from: Map<string, number>
): void {
    for (const [bucket, value] of from) {
        into.set(bucket, (into.get(bucket) ?? 0) + value);
    }
}

/** Sums every bucket. */
function sumOf(buckets: Map<string, number>): number {
    let total = 0;
    for (const value of buckets.values()) total += value;
    return total;
}

/** Sorts a bucket map into an ascending series. */
function toSeries(buckets: Map<string, number>): InsightsSeriesPoint[] {
    return [...buckets.entries()]
        .map(([bucket, value]) => ({ bucket, value }))
        .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

/**
 * Turns per-bucket increments into a running total, starting from the count as
 * it stood before the window opened.
 *
 * Trimmed to the last {@link HISTORY_POINTS} so a sparkline gets a readable
 * number of points regardless of the selected range.
 */
function cumulativeFrom(
    baseline: number,
    buckets: Map<string, number>
): number[] {
    const series = toSeries(buckets);
    let running = Math.max(0, baseline);
    const history = series.map((point) => {
        running += point.value;
        return running;
    });
    return history.slice(-HISTORY_POINTS);
}
