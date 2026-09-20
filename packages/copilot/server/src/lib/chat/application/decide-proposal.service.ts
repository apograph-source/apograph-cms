import { Injectable, Logger } from '@nestjs/common';
import type { ProposalApplier } from '@orthacms/copilot-domain';
import {
    ProposalRepository,
    type ProposalView
} from '../infrastructure/persistence/proposal.repository';
import { ProposalApplierRegistry } from './proposal-applier.registry';

/** Who the change is made by, and where. */
export interface Applicant {
    userId: string;
    /** The actor's email — frozen onto the audit event the write raises. */
    email: string;
    workspaceId: string;
}

/** Why a change could not be carried out. */
export type ApplyRefusal =
    /** Someone already applied it. */
    | 'already-decided'
    /** No plugin claimed this proposal's kind — a wiring bug, not a user error. */
    | 'no-applier'
    /** The applier ran and failed; the proposal stays pending. */
    | 'apply-failed';

/** The outcome of an apply. */
export type ApplyOutcome =
    | { ok: true; proposal: ProposalView }
    | { ok: false; reason: ApplyRefusal; message: string };

/**
 * Applies a proposal through the plugin that owns it.
 *
 * **There is no human step any more**
 * ([ADR-0009](../../../../../../docs/adr/0009-copilot-applies-directly.md)).
 * This used to be the accept boundary — `accept`, `reject`, and a re-resolution
 * of the capability profile deciding whether the clicker could have proposed
 * the change themselves. All three are gone: the engine calls {@link apply} the
 * moment a `propose` tool returns, and the only authority check is the one the
 * offer and the tool call already made against the caller's own grants.
 *
 * What survives, and why each still earns its place:
 *
 * - **Applying runs the ordinary use-case.** This service never writes the
 *   change itself; it hands the proposal to the plugin that owns it. Same
 *   validation, same revision, same activity row, with the human as actor. That
 *   is what makes a copilot change indistinguishable from a hand-made one in
 *   the audit log — and it is what "undoable, never invisible" now rests on
 *   entirely, since nothing pauses to be looked at first.
 * - **The status flips first, and only once.** `decide` updates with a
 *   `status = 'pending'` predicate, so the applier is unreachable twice for the
 *   same row. That still matters with no reviewers in the picture: a model that
 *   re-proposes an identical change, or a retried run, must not write twice.
 * - **A failed apply reopens the row** with the message recorded. Nobody will
 *   retry it, so this is a receipt saying the change did not happen — the run
 *   engine reads it back and tells the model to say so rather than claim
 *   success.
 */
@Injectable()
export class DecideProposalService {
    private readonly logger = new Logger(DecideProposalService.name);

    constructor(
        private readonly proposals: ProposalRepository,
        private readonly appliers: ProposalApplierRegistry
    ) {}

    /**
     * Applies a freshly drafted proposal.
     *
     * No permission check of its own, and that is not an omission: the
     * capability profile offered the tool at the start of the run, and
     * `executeTool` re-authorized it against a freshly resolved session
     * immediately before this proposal existed. Re-resolving a third time in
     * the same millisecond would only add a query.
     */
    async apply(proposal: ProposalView, by: Applicant): Promise<ApplyOutcome> {
        const applier = this.appliers.get(proposal.kind);
        if (!applier) {
            // A deployment wiring bug rather than a user error, so it is logged
            // loudly and the row is left pending — the change is still valid,
            // and it becomes applicable again the moment the binder is fixed.
            this.logger.error(
                `No applier registered for proposal kind "${proposal.kind}"; ` +
                    `proposal ${proposal.id} was not applied.`
            );
            return refuse(
                'no-applier',
                'This kind of change cannot be applied by this deployment.'
            );
        }
        return this.applyThroughOwner(proposal, applier, by);
    }

    /**
     * Flips the status, then hands the change to its owner.
     *
     * The order matters: the `pending` predicate on the update is what makes
     * the apply happen at most once, so it has to win the race *before* the
     * write runs. A failure afterwards returns the row to `pending` with the
     * reason; the alternative — apply first, record after — can apply twice.
     */
    private async applyThroughOwner(
        proposal: ProposalView,
        applier: ProposalApplier,
        by: Applicant
    ): Promise<ApplyOutcome> {
        const claimed = await this.proposals.decide(
            proposal.id,
            by.workspaceId,
            'accepted',
            by.userId
        );
        if (!claimed) {
            return refuse(
                'already-decided',
                'This change was already applied.'
            );
        }

        try {
            const result = await applier.apply(
                { target: proposal.target, patch: proposal.patch },
                {
                    userId: by.userId,
                    actorEmail: by.email,
                    workspaceId: by.workspaceId,
                    runId: proposal.runId,
                    // Provenance, alongside the run: the applier stamps the
                    // pair onto the domain event, so an audit row can say which
                    // change an agent turn actually made rather than only that
                    // one happened.
                    proposalId: proposal.id
                }
            );

            // A second write rather than folding the result into the status
            // transition: that transition only matches a `pending` row, and
            // this one is now `accepted` by design — the claim is what makes
            // the apply happen at most once.
            const finished = await this.proposals.recordResult(
                proposal.id,
                by.workspaceId,
                { ...result }
            );
            return { ok: true, proposal: finished ?? claimed };
        } catch (error) {
            const message =
                error instanceof Error && error.message
                    ? error.message
                    : 'The change could not be applied.';
            this.logger.warn(
                `Applying proposal ${proposal.id} (${proposal.kind}) failed: ${message}`
            );
            await this.proposals.reopen(proposal.id, by.workspaceId, message);
            return refuse('apply-failed', message);
        }
    }
}

/** A refusal, with the message the run engine reports to the model. */
function refuse(reason: ApplyRefusal, message: string): ApplyOutcome {
    return { ok: false, reason, message };
}
