import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { UnitOfWork, type Database } from '@orthacms/database';
import { reviewRequests } from './schema/review-requests';

/** One open ask, as the entry panel and the queue read it. */
export interface StoredReviewRequest {
    id: string;
    contentType: string;
    entryId: string;
    revisionId: string;
    requestedBy: string;
    /** The people asked to review, in the order they were picked. */
    reviewerIds: string[];
    createdAt: Date;
}

/** What opening a request is written with. */
export interface OpenRequestInput {
    workspaceId: string;
    contentType: string;
    entryId: string;
    revisionId: string;
    requestedBy: string;
    reviewerIds: string[];
}

/** One page of the reviewer queue. */
export interface QueuePage {
    items: StoredReviewRequest[];
    total: number;
}

/** How a queue read is narrowed. */
export interface QueueFilter {
    /** Only requests this person opened. */
    requestedBy?: string;
    limit: number;
    offset: number;
}

/**
 * Storage for review requests.
 *
 * The one thing to know: a request is **resolved, never deleted**. Withdrawing
 * sets `resolved_at`, which frees the partial unique index for the next ask
 * while leaving the row as history — so "this was sent for review last Tuesday
 * and pulled back an hour later" stays answerable, and the audit row that
 * records the ask still points at something.
 */
@Injectable()
export class ReviewRequestRepository {
    constructor(private readonly uow: UnitOfWork) {}

    /** The ambient transaction when one is open, the base connection otherwise. */
    private get exec(): Database {
        return this.uow.current();
    }

    /** The open request on one entry, or `null`. */
    async findOpen(
        workspaceId: string,
        entryId: string
    ): Promise<StoredReviewRequest | null> {
        const [row] = await this.exec
            .select()
            .from(reviewRequests)
            .where(
                and(
                    eq(reviewRequests.workspaceId, workspaceId),
                    eq(reviewRequests.entryId, entryId),
                    isNull(reviewRequests.resolvedAt)
                )
            )
            .limit(1);
        return row ? toRequest(row) : null;
    }

    /**
     * The open request on one entry, found by entry id alone.
     *
     * Every other read here AND-s the workspace in, and that is right: they
     * serve a request that resolved to one. This one serves the outbox
     * subscriber, which is handed an `entry.published` event carrying an entry
     * id and no workspace — and does not need one, because the partial unique
     * index makes at most one request open per entry across the installation.
     * Requiring a workspace here would mean either carrying it on every entry
     * event or looking the entry up in a table this package does not own.
     */
    async findOpenByEntry(
        entryId: string
    ): Promise<StoredReviewRequest | null> {
        const [row] = await this.exec
            .select()
            .from(reviewRequests)
            .where(
                and(
                    eq(reviewRequests.entryId, entryId),
                    isNull(reviewRequests.resolvedAt)
                )
            )
            .limit(1);
        return row ? toRequest(row) : null;
    }

    /**
     * Which of the named entries have an **open** request, keyed by entry id.
     *
     * One query for a whole page, and only the entry ids — the column shows
     * that a review was asked for, not who asked or when. The partial unique
     * index on `entry_id where resolved_at is null` makes at most one row per
     * entry, so the set is a set rather than a count.
     */
    async openByEntries(
        workspaceId: string,
        entryIds: readonly string[]
    ): Promise<Set<string>> {
        if (!entryIds.length) return new Set();
        const rows = await this.exec
            .select({ entryId: reviewRequests.entryId })
            .from(reviewRequests)
            .where(
                and(
                    eq(reviewRequests.workspaceId, workspaceId),
                    inArray(reviewRequests.entryId, [...entryIds]),
                    isNull(reviewRequests.resolvedAt)
                )
            );
        return new Set(rows.map((row) => row.entryId));
    }

    /**
     * Opens the request, or updates the one already open.
     *
     * `onConflictDoUpdate` on the partial unique index rather than
     * find-then-branch: asking twice is an ordinary thing to do — "I forgot to
     * ask Anna too" — and the alternative is a 409 for something nobody
     * would recognise as an error, or a race between two tabs that ends in a
     * 500 on the constraint.
     *
     * `revision_id` is refreshed to the head at the moment of asking. The
     * request itself still survives later saves: an author who fixes a typo
     * after asking has not withdrawn anything, and re-opening on every save
     * would churn the reviewer's queue for reasons nobody watching it cares
     * about. What expires on a save is the **approval**, not the ask.
     */
    async open(input: OpenRequestInput): Promise<StoredReviewRequest> {
        const [row] = await this.exec
            .insert(reviewRequests)
            .values({
                workspaceId: input.workspaceId,
                contentType: input.contentType,
                entryId: input.entryId,
                revisionId: input.revisionId,
                requestedBy: input.requestedBy,
                reviewerIds: input.reviewerIds
            })
            .onConflictDoUpdate({
                target: reviewRequests.entryId,
                targetWhere: isNull(reviewRequests.resolvedAt),
                set: {
                    revisionId: input.revisionId,
                    requestedBy: input.requestedBy,
                    reviewerIds: input.reviewerIds,
                    createdAt: new Date()
                }
            })
            .returning();
        return toRequest(row);
    }

    /** Marks one request resolved. Reports whether it was still open. */
    async resolve(id: string): Promise<boolean> {
        const updated = await this.exec
            .update(reviewRequests)
            .set({ resolvedAt: new Date() })
            .where(
                and(
                    eq(reviewRequests.id, id),
                    isNull(reviewRequests.resolvedAt)
                )
            )
            .returning({ id: reviewRequests.id });
        return updated.length > 0;
    }

    /**
     * One page of the workspace's open requests, newest first.
     *
     * Across every content type, which is the whole reason the reviewer page is
     * a page rather than a saved view of one collection's records list.
     */
    async queue(workspaceId: string, filter: QueueFilter): Promise<QueuePage> {
        const where = and(
            eq(reviewRequests.workspaceId, workspaceId),
            isNull(reviewRequests.resolvedAt),
            ...(filter.requestedBy
                ? [eq(reviewRequests.requestedBy, filter.requestedBy)]
                : [])
        );
        const rows = await this.exec
            .select()
            .from(reviewRequests)
            .where(where)
            .orderBy(desc(reviewRequests.createdAt))
            .limit(filter.limit)
            .offset(filter.offset);
        const [{ total }] = await this.exec
            .select({ total: count() })
            .from(reviewRequests)
            .where(where);
        return { items: rows.map(toRequest), total: Number(total) };
    }
}

/** Row → the shape the services pass around. */
function toRequest(
    row: typeof reviewRequests.$inferSelect
): StoredReviewRequest {
    return {
        id: row.id,
        contentType: row.contentType,
        entryId: row.entryId,
        revisionId: row.revisionId,
        requestedBy: row.requestedBy,
        reviewerIds: row.reviewerIds,
        createdAt: row.createdAt
    };
}
