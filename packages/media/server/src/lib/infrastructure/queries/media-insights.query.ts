import { Injectable } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import { mediaAsset } from '../schema/media-asset';
import type {
    MediaAltCoverageView,
    MediaStorageView,
    MediaUploadsView
} from '../../types/media-insights-view';

/** Bucket widths a time series can be grouped into. */
type Granularity = 'day' | 'week' | 'month';

/**
 * Picks a bucket width for a window. Bounded so a 12-month range doesn't return
 * 365 points for a chart a few hundred pixels wide.
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
 * Live read-model for the media Insights widgets.
 *
 * Unlike content, this is a single table, so every figure is one grouped query
 * over `media_asset` scoped to the workspace — no fan-out, and nothing that
 * warrants a projection.
 */
@Injectable()
export class MediaInsightsQuery {
    constructor(@InjectDatabase() private readonly db: Database) {}

    /** Assets and bytes per kind, plus the workspace totals. */
    async storage(workspaceId: string): Promise<MediaStorageView> {
        const rows = await this.db
            .select({
                kind: mediaAsset.kind,
                count: sql<number>`cast(count(*) as int)`,
                // `size` is a bigint: summing it comes back as a numeric, which
                // node-postgres hands over as a *string* to avoid precision
                // loss. Casting to bigint keeps that behaviour explicit, and
                // the Number() below is safe because a workspace's total bytes
                // is nowhere near 2^53.
                bytes: sql<string>`cast(coalesce(sum(${mediaAsset.size}), 0) as bigint)`
            })
            .from(mediaAsset)
            .where(eq(mediaAsset.workspaceId, workspaceId))
            .groupBy(mediaAsset.kind);

        const kinds = rows
            .map((row) => ({
                kind: row.kind,
                count: row.count,
                bytes: Number(row.bytes)
            }))
            .sort((a, b) => b.bytes - a.bytes);

        return {
            kinds,
            totalBytes: kinds.reduce((sum, kind) => sum + kind.bytes, 0),
            totalCount: kinds.reduce((sum, kind) => sum + kind.count, 0)
        };
    }

    /** Assets uploaded per time bucket across the window. */
    async uploads(
        workspaceId: string,
        days: number
    ): Promise<MediaUploadsView> {
        const granularity = granularityFor(days);
        const truncated = sql`date_trunc(${truncUnit(granularity)}, ${mediaAsset.createdAt})`;

        const rows = await this.db
            .select({
                bucket: sql<string>`to_char(${truncated}, 'YYYY-MM-DD')`,
                value: sql<number>`cast(count(*) as int)`
            })
            .from(mediaAsset)
            .where(
                and(
                    eq(mediaAsset.workspaceId, workspaceId),
                    sql`${mediaAsset.createdAt} >= ${windowStart(days)}`
                )
            )
            .groupBy(truncated)
            .orderBy(truncated);

        return {
            points: rows,
            granularity,
            total: rows.reduce((sum, row) => sum + row.value, 0)
        };
    }

    /** Alt-text coverage across the workspace's images. */
    async altCoverage(workspaceId: string): Promise<MediaAltCoverageView> {
        const [row] = await this.db
            .select({
                images: sql<number>`cast(count(*) as int)`,
                // A present-but-blank alt is not alt text — an empty string is
                // the markup for "decorative", and counting it as covered would
                // report accessibility work as done that nobody has done.
                withAlt: sql<number>`cast(count(*) filter (
                    where ${mediaAsset.alt} is not null
                      and length(trim(${mediaAsset.alt})) > 0
                ) as int)`
            })
            .from(mediaAsset)
            .where(
                and(
                    eq(mediaAsset.workspaceId, workspaceId),
                    eq(mediaAsset.kind, 'image')
                )
            );

        const images = row?.images ?? 0;
        const withAlt = row?.withAlt ?? 0;
        return { images, withAlt, missing: images - withAlt };
    }
}
