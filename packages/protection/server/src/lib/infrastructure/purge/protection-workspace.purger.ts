import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import {
    WorkspacePurgeRegistry,
    type WorkspacePurger,
    type WorkspacePurgeOutcome
} from '@orthacms/workspaces-server';
import { protectionRules } from '../schema/protection-rules';
import { reviewApprovals } from '../schema/review-approvals';
import { reviewRequests } from '../schema/review-requests';

/**
 * Removes a deleted workspace's rules, review requests and approvals.
 *
 * All three tables carry a plain `workspace_id` with no foreign key — a
 * cross-plugin FK is exactly what the plugin split exists to avoid — so nothing
 * reaches these rows when the `workspaces` row goes. One purger for the three
 * rather than three purgers: they are deleted by the same predicate in the same
 * transaction, and a workspace that lost its rules but kept its approvals is
 * not a state worth being able to reach.
 *
 * A workspace can only be deleted once it holds no entries, so every surviving
 * approval already points at a revision of an entry that no longer exists. That
 * is not harmless: `review_approvals` is read by the head-revision count, and
 * an id can be reused by nothing but the row that owns it — but the rows are
 * still scoped to a workspace nobody can open, which makes them exactly the
 * kind of residue a live stand found four of last time.
 *
 * Registered with the workspaces package's purge registry, optionally: a host
 * that runs this plugin without `WorkspacesPlugin` is not a real configuration,
 * but it should boot rather than fail on an injection it cannot influence.
 */
@Injectable()
export class ProtectionWorkspacePurger
    implements WorkspacePurger, OnModuleInit
{
    readonly purgeName = 'protection:rules-and-reviews';

    constructor(
        private readonly uow: UnitOfWork,
        @Optional() private readonly registry?: WorkspacePurgeRegistry
    ) {}

    onModuleInit(): void {
        this.registry?.register(this);
    }

    async purge(workspaceId: string): Promise<WorkspacePurgeOutcome> {
        const exec = this.uow.current();

        // Approvals and requests first, rules last. Nothing enforces the order —
        // there is no foreign key between them — but it is the order in which a
        // partial failure leaves the least confusing state: a rule with no votes
        // reads as an untouched rule, while votes with no rule read as a policy
        // that vanished.
        const approvals = await exec
            .delete(reviewApprovals)
            .where(eq(reviewApprovals.workspaceId, workspaceId))
            .returning({ id: reviewApprovals.id });
        const requests = await exec
            .delete(reviewRequests)
            .where(eq(reviewRequests.workspaceId, workspaceId))
            .returning({ id: reviewRequests.id });
        const rules = await exec
            .delete(protectionRules)
            .where(eq(protectionRules.workspaceId, workspaceId))
            .returning({ id: protectionRules.id });

        return {
            rows: approvals.length + requests.length + rules.length
        };
    }
}
