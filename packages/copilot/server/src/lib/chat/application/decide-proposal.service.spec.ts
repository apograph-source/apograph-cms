import type { ProposalApplier, ProposalStatus } from '@orthacms/copilot-domain';
import type {
    ProposalRepository,
    ProposalView
} from '../infrastructure/persistence/proposal.repository';
import {
    DecideProposalService,
    type Applicant
} from './decide-proposal.service';
import type { ProposalApplierRegistry } from './proposal-applier.registry';

const BY: Applicant = {
    userId: 'user-1',
    email: 'editor@example.com',
    workspaceId: 'workspace-1'
};

const PROPOSAL: ProposalView = {
    id: 'proposal-1',
    conversationId: 'conversation-1',
    runId: 'run-1',
    toolCallId: 'call-1',
    toolName: 'content_propose_update',
    kind: 'content.entry.update',
    workspaceId: BY.workspaceId,
    createdBy: BY.userId,
    target: { type: 'entry', id: 'entry-1' } as ProposalView['target'],
    patch: { title: 'New' },
    summary: 'Retitle the entry',
    changes: null,
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    result: null,
    error: null,
    createdAt: new Date('2026-01-01T00:00:00Z')
};

/**
 * A repository double that **honours the `status = 'pending'` predicate** the
 * real `decide` renders into its `UPDATE` (pinned separately in
 * `proposal.repository.spec.ts`): the first claim wins and flips the row, every
 * later one matches nothing and comes back `null`.
 *
 * Modelling the predicate rather than counting calls is what lets this test say
 * something about the *service*: the row is claimed by the database, and the
 * only thing standing between a second claim and a second write is the service
 * treating that `null` as a refusal.
 */
function fakeProposals() {
    let status: ProposalStatus = 'pending';
    const decide = jest.fn(
        async (
            _id: string,
            _workspaceId: string,
            next: Exclude<ProposalStatus, 'pending'>,
            decidedBy: string
        ): Promise<ProposalView | null> => {
            if (status !== 'pending') {
                return null;
            }
            status = next;
            return { ...PROPOSAL, status: next, decidedBy };
        }
    );
    const recordResult = jest.fn(
        async (): Promise<ProposalView | null> => ({
            ...PROPOSAL,
            status,
            result: { entityId: 'entry-1' }
        })
    );
    const reopen = jest.fn(async (): Promise<void> => {
        status = 'pending';
    });
    return { decide, recordResult, reopen };
}

/** A registry holding one applier for the proposal's kind. */
function fakeAppliers(applier: ProposalApplier) {
    return {
        get: (kind: string) => (kind === applier.kind ? applier : undefined)
    } as unknown as ProposalApplierRegistry;
}

describe('DecideProposalService', () => {
    /**
     * The claim is what makes the write happen **at most once**, and this is
     * the case ADR-0009 left it load-bearing for: with no human review step, a
     * model that re-proposes an identical change, or a run that is retried, is
     * the ordinary way one row reaches `apply` twice.
     */
    it('runs the applier once however often one row is applied [copilot:I-14]', async () => {
        const applier: ProposalApplier = {
            kind: 'content.entry.update',
            apply: jest.fn(async () => ({ entityId: 'entry-1' }))
        };
        const proposals = fakeProposals();
        const service = new DecideProposalService(
            proposals as unknown as ProposalRepository,
            fakeAppliers(applier)
        );

        const first = await service.apply(PROPOSAL, BY);
        const second = await service.apply(PROPOSAL, BY);

        expect(first.ok).toBe(true);
        expect(second).toEqual({
            ok: false,
            reason: 'already-decided',
            message: 'This change was already applied.'
        });
        // The whole point: the second attempt reached the database and was
        // turned away there, and the *write* never ran a second time.
        expect(proposals.decide).toHaveBeenCalledTimes(2);
        expect(applier.apply).toHaveBeenCalledTimes(1);
    });

    /**
     * Ordering: the claim wins the race *before* the write runs. A service that
     * applied first and recorded afterwards can apply twice, whatever the
     * predicate says.
     */
    it('claims the row before the write, not after [copilot:I-14]', async () => {
        const order: string[] = [];
        const proposals = fakeProposals();
        proposals.decide.mockImplementation(async (_id, _ws, next, by) => {
            order.push('decide');
            return { ...PROPOSAL, status: next, decidedBy: by };
        });
        const applier: ProposalApplier = {
            kind: 'content.entry.update',
            apply: jest.fn(async () => {
                order.push('apply');
                return {};
            })
        };
        const service = new DecideProposalService(
            proposals as unknown as ProposalRepository,
            fakeAppliers(applier)
        );

        await service.apply(PROPOSAL, BY);

        expect(order).toEqual(['decide', 'apply']);
    });
});
