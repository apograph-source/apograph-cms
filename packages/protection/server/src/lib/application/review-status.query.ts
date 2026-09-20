import { Injectable } from '@nestjs/common';
import {
    InjectRevisionStore,
    type RevisionStore
} from '@orthacms/content-server';
import { countApprovals } from '@orthacms/protection-domain';
import { ReviewApprovalRepository } from '../infrastructure/review-approval.repository';
import { ReviewRequestRepository } from '../infrastructure/review-request.repository';
import { ProtectionRuleRepository } from '../infrastructure/protection-rule.repository';
import type { EntryReviewStatusView } from '../types/protection-views';

/**
 * Where each of a page's entries stands, in **four queries whatever the page
 * holds**.
 *
 * This is the read behind the records column, and the shape of it is the whole
 * point: a column asking the single-entry review route per row would be an N+1
 * over a page of twenty-five, and the page size is the user's to choose. The
 * four reads are the head revisions (one, through content's batched
 * `RevisionStore.heads`), every vote on those entries (one, over the
 * denormalised `entry_id`), the open requests over those same ids (one, for the
 * `requested` flag), and the workspace's rules (one, and the rule set is one row
 * per protected type — small enough to read whole rather than per row).
 *
 * `review-status.spec.ts`'s "issues the same number of queries for 1 entry and
 * 10" pins the count **flat**, and it is that test rather than this comment that
 * keeps it true. Note what it does not pin: it compares one page against
 * another rather than asserting a number, so this paragraph's "four" is
 * documentation, not an assertion — it said "three" for as long as the open-
 * requests read has existed, and nothing failed.
 *
 * **It counts through the kernel.** `countApprovals` is the same function
 * `evaluateProtection` calls, so the number in the column is the number the
 * publish gate obeys. Counting here instead would agree until somebody switched
 * on `countStaleApprovals` or the four-eyes exclusion bit — the second
 * implementation #257 was amended to remove, and the reason #260's panel reads
 * the server rather than tallying votes itself.
 */
@Injectable()
export class ReviewStatusQuery {
    constructor(
        @InjectRevisionStore() private readonly revisions: RevisionStore,
        private readonly approvals: ReviewApprovalRepository,
        private readonly requests: ReviewRequestRepository,
        private readonly rules: ProtectionRuleRepository
    ) {}

    /**
     * One status per entry the caller named, keyed by entry id.
     *
     * An entry with no head revision is **absent** from the map: it is not
     * reachable from this workspace under this content type, and the caller —
     * a records column rendering rows it has already read — simply shows
     * nothing for it rather than inventing a state.
     *
     * On an **unprotected** type every entry reports `protected: false` with the
     * votes it happens to carry, because asking for review is allowed there and
     * the votes are real; what an unprotected type does not do is block.
     */
    async forEntries(
        workspaceId: string,
        contentType: string,
        entryIds: readonly string[]
    ): Promise<Map<string, EntryReviewStatusView>> {
        const result = new Map<string, EntryReviewStatusView>();
        if (!entryIds.length) return result;

        const [heads, votesByEntry, openRequests, rules] = await Promise.all([
            this.revisions.heads(contentType, entryIds, workspaceId),
            this.approvals.listForEntries(workspaceId, entryIds),
            this.requests.openByEntries(workspaceId, entryIds),
            this.rules.list(workspaceId)
        ]);

        // Keyed by slug alone: a content type's name is unique across both kinds
        // in the registry, so a row's kind never has to be resolved to find its
        // rule — the same shortcut the queue takes.
        const rule = rules.find(
            (candidate) => candidate.slug === contentType && candidate.enabled
        );

        for (const head of heads) {
            const votes = votesByEntry.get(head.entryId) ?? [];
            const { given, stale } = countApprovals({
                rule,
                headRevisionId: head.id,
                headAuthorId: head.authorId,
                approvals: votes,
                // The count does not read the actor, and a column is rendered
                // for whoever is looking — so there is no caller to name here.
                // The publish gate asks the actor question separately.
                actor: { userId: null, isAdmin: false, isToken: false }
            });
            const required = rule ? rule.requiredApprovals : 0;
            result.set(head.entryId, {
                protected: !!rule,
                required,
                given,
                stale,
                requested: openRequests.has(head.entryId),
                blocked: !!rule && given < required
            });
        }
        return result;
    }
}
