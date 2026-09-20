import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { UnitOfWork, type Database } from '@orthacms/database';
import type { Approval } from '@orthacms/protection-domain';
import { reviewApprovals } from './schema/review-approvals';

/** One stored approval, with the addressing the interface needs around it. */
export interface StoredApproval extends Approval {
    id: string;
    createdAt: Date;
}

/** What an approval is written with. */
export interface CastVoteInput {
    workspaceId: string;
    contentType: string;
    entryId: string;
    revisionId: string;
    userId: string;
}

/**
 * Storage for review votes.
 *
 * Every read here returns **every** vote on the entry, whatever revision it was
 * given on — not just the ones on the head. That is not laziness: the stale
 * ones are what the interface strikes through, and `evaluateProtection` needs
 * them to compute how far the count moved. Filtering to the head in SQL would
 * make the server answer a question the kernel is supposed to answer, and the
 * two would then disagree the first time the rule's `countStaleApprovals`
 * changed.
 */
@Injectable()
export class ReviewApprovalRepository {
    constructor(private readonly uow: UnitOfWork) {}

    /** The ambient transaction when one is open, the base connection otherwise. */
    private get exec(): Database {
        return this.uow.current();
    }

    /** Every vote on one entry, oldest first, across every revision. */
    async listForEntry(
        workspaceId: string,
        entryId: string
    ): Promise<StoredApproval[]> {
        const rows = await this.exec
            .select()
            .from(reviewApprovals)
            .where(
                and(
                    eq(reviewApprovals.workspaceId, workspaceId),
                    eq(reviewApprovals.entryId, entryId)
                )
            )
            .orderBy(reviewApprovals.createdAt);
        return rows.map((row) => ({
            id: row.id,
            revisionId: row.revisionId,
            userId: row.userId,
            createdAt: row.createdAt
        }));
    }

    /**
     * Every vote on **many** entries, keyed by entry id — the batched form of
     * {@link listForEntry}, for a whole records page.
     *
     * One query whatever the page holds. The approvals table carries
     * `entry_id` denormalised for exactly this: the alternative is a join to
     * revisions per row, which is the N+1 the batched read exists to avoid.
     *
     * An entry with no votes is **absent** from the map rather than present
     * with an empty array — the caller reads a missing key as "nobody has
     * voted", which is the same answer and costs no allocation per row.
     */
    async listForEntries(
        workspaceId: string,
        entryIds: readonly string[]
    ): Promise<Map<string, StoredApproval[]>> {
        if (!entryIds.length) return new Map();
        const rows = await this.exec
            .select()
            .from(reviewApprovals)
            .where(
                and(
                    eq(reviewApprovals.workspaceId, workspaceId),
                    inArray(reviewApprovals.entryId, [...entryIds])
                )
            )
            .orderBy(reviewApprovals.createdAt);
        const byEntry = new Map<string, StoredApproval[]>();
        for (const row of rows) {
            const list = byEntry.get(row.entryId) ?? [];
            list.push({
                id: row.id,
                revisionId: row.revisionId,
                userId: row.userId,
                createdAt: row.createdAt
            });
            byEntry.set(row.entryId, list);
        }
        return byEntry;
    }

    /**
     * Records this person's approval of this revision.
     *
     * `onConflictDoUpdate` against `unique (revision_id, user_id)` rather than a
     * read followed by a write: approving twice is harmless and should stay so,
     * and a read-then-write would let two clicks in quick succession collide on
     * the constraint with a 500.
     */
    async cast(input: CastVoteInput): Promise<void> {
        await this.exec
            .insert(reviewApprovals)
            .values({
                workspaceId: input.workspaceId,
                contentType: input.contentType,
                entryId: input.entryId,
                revisionId: input.revisionId,
                userId: input.userId
            })
            .onConflictDoUpdate({
                target: [reviewApprovals.revisionId, reviewApprovals.userId],
                set: { createdAt: new Date() }
            });
    }

    /**
     * Removes this person's vote **on the head revision only**.
     *
     * Withdrawing does not reach back through the history. A vote on an earlier
     * version is already not counting, and deleting it would erase the
     * struck-through line that explains why the number moved after a save —
     * which is the one thing that makes a rolled-back counter comprehensible.
     */
    async withdraw(
        workspaceId: string,
        entryId: string,
        revisionId: string,
        userId: string
    ): Promise<boolean> {
        const removed = await this.exec
            .delete(reviewApprovals)
            .where(
                and(
                    eq(reviewApprovals.workspaceId, workspaceId),
                    eq(reviewApprovals.entryId, entryId),
                    eq(reviewApprovals.revisionId, revisionId),
                    eq(reviewApprovals.userId, userId)
                )
            )
            .returning({ id: reviewApprovals.id });
        return removed.length > 0;
    }

    /**
     * How many **distinct people** approved each of the named revisions, keyed
     * by revision id — the queue's counter, in one query for a whole page.
     *
     * The caller passes each row's *current head*, so this counts what counts
     * today rather than what counted when the review was asked for. Distinct by
     * user for the reason the kernel is: one person is one voice however many
     * versions they approved.
     *
     * It deliberately does **not** apply `requireOtherPerson`. The queue shows a
     * hint beside a title, the entry route gives the number the button obeys,
     * and running the full decision per row would mean one rule lookup and one
     * author comparison per line for a column nothing gates on.
     */
    async approvedCountsOnRevisions(
        workspaceId: string,
        revisionIds: readonly string[]
    ): Promise<Map<string, number>> {
        if (!revisionIds.length) return new Map();
        const rows = await this.exec
            .select({
                revisionId: reviewApprovals.revisionId,
                total: sql<number>`count(distinct ${reviewApprovals.userId})::int`
            })
            .from(reviewApprovals)
            .where(
                and(
                    eq(reviewApprovals.workspaceId, workspaceId),
                    inArray(reviewApprovals.revisionId, [...revisionIds])
                )
            )
            .groupBy(reviewApprovals.revisionId);
        return new Map(rows.map((row) => [row.revisionId, Number(row.total)]));
    }
}
