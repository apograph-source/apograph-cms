import { Injectable } from '@nestjs/common';
import { and, count, eq, isNull, lt, sql } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@ortha/database';
import { reviewRequests } from '../infrastructure/schema/review-requests';
import type { ProtectionInsightsView } from '../types/protection-views';
import { OVERDUE_AFTER_DAYS } from './overdue';

export { OVERDUE_AFTER_DAYS };

/**
 * The Insights card's two figures: how much review is outstanding, and how much
 * of it has been outstanding too long.
 *
 * **One query, not two.** The overdue set is a subset of the open set, so a
 * `filter` aggregate decides both from the same scan — the same reason content's
 * `unshipped` reads its three counts out of one grouped query rather than three
 * `countOf` calls.
 *
 * **No `?days=` window**, deliberately, and for the reason content's `unshipped`
 * takes none: a request that has been waiting a fortnight is waiting whether it
 * was asked this morning or last spring. Windowing it would answer a different
 * question under the same name, and a dashboard figure is believed.
 *
 * The threshold travels **with** the numbers rather than being restated in the
 * admin, so the card's caption cannot come to say "3 days" over a figure counted
 * against something else.
 */
@Injectable()
export class ProtectionInsightsQuery {
    constructor(@InjectDatabase() private readonly db: Database) {}

    /** Open and overdue review requests in one workspace. */
    async summary(workspaceId: string): Promise<ProtectionInsightsView> {
        const cutoff = new Date(
            Date.now() - OVERDUE_AFTER_DAYS * 24 * 60 * 60 * 1000
        );
        const [row] = await this.db
            .select({
                open: count(),
                overdue: sql<number>`count(*) filter (where ${lt(
                    reviewRequests.createdAt,
                    cutoff
                )})::int`
            })
            .from(reviewRequests)
            .where(
                and(
                    eq(reviewRequests.workspaceId, workspaceId),
                    isNull(reviewRequests.resolvedAt)
                )
            );
        return {
            open: Number(row?.open ?? 0),
            overdue: Number(row?.overdue ?? 0),
            overdueAfterDays: OVERDUE_AFTER_DAYS
        };
    }
}
