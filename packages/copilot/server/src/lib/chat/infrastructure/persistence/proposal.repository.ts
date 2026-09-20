import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import type {
    ProposalChange,
    ProposalStatus,
    ProposalTarget
} from '@orthacms/copilot-domain';
import { copilotProposals } from '../schema/proposals';

/** One proposal as the chat panel and the review queue render it. */
export interface ProposalView {
    id: string;
    conversationId: string;
    runId: string;
    toolCallId: string;
    toolName: string;
    kind: string;
    workspaceId: string;
    createdBy: string;
    target: ProposalTarget;
    patch: Readonly<Record<string, unknown>>;
    summary: string;
    changes: readonly ProposalChange[] | null;
    status: ProposalStatus;
    decidedBy: string | null;
    decidedAt: Date | null;
    result: Record<string, unknown> | null;
    error: string | null;
    createdAt: Date;
}

/** What {@link ProposalRepository.create} writes. */
export interface NewProposal {
    conversationId: string;
    runId: string;
    toolCallId: string;
    toolName: string;
    kind: string;
    workspaceId: string;
    createdBy: string;
    target: ProposalTarget;
    patch: Readonly<Record<string, unknown>>;
    summary: string;
    changes?: readonly ProposalChange[];
}

/**
 * Reads and writes `copilot_proposals`.
 *
 * **Every method takes the owning `workspaceId` and filters on it**, for the
 * same reason `ConversationRepository` does: `WorkspaceGuard` proves the caller
 * belongs to the workspace they named, but nothing upstream proves a *proposal
 * id* belongs to that workspace.
 *
 * It deliberately does **not** filter by `createdBy`. A proposal is a review
 * item, not private correspondence: a second editor should be able to accept a
 * change a colleague's copilot drafted, which is the ordinary case for a review
 * queue. What bounds that is the accepting user's own permissions, re-resolved
 * at accept time.
 */
@Injectable()
export class ProposalRepository {
    constructor(@InjectDatabase() private readonly db: Database) {}

    /** Persists a new `pending` proposal and returns it. */
    async create(input: NewProposal): Promise<ProposalView> {
        const [row] = await this.db
            .insert(copilotProposals)
            .values({
                conversationId: input.conversationId,
                runId: input.runId,
                toolCallId: input.toolCallId,
                toolName: input.toolName,
                kind: input.kind,
                workspaceId: input.workspaceId,
                createdBy: input.createdBy,
                target: input.target,
                patch: input.patch,
                summary: input.summary,
                changes: input.changes ?? null,
                status: 'pending'
            })
            .returning();
        return toView(row);
    }

    /** One proposal in this workspace, or null. */
    async find(id: string, workspaceId: string): Promise<ProposalView | null> {
        const [row] = await this.db
            .select()
            .from(copilotProposals)
            .where(
                and(
                    eq(copilotProposals.id, id),
                    eq(copilotProposals.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return row ? toView(row) : null;
    }

    /** This workspace's proposals, newest first, optionally by status. */
    async list(
        workspaceId: string,
        options: { status?: ProposalStatus; conversationId?: string } = {}
    ): Promise<ProposalView[]> {
        const rows = await this.db
            .select()
            .from(copilotProposals)
            .where(
                and(
                    eq(copilotProposals.workspaceId, workspaceId),
                    options.status
                        ? eq(copilotProposals.status, options.status)
                        : undefined,
                    options.conversationId
                        ? eq(
                              copilotProposals.conversationId,
                              options.conversationId
                          )
                        : undefined
                )
            )
            .orderBy(desc(copilotProposals.createdAt));
        return rows.map(toView);
    }

    /**
     * Moves a **pending** proposal to `accepted` or `rejected`, returning the
     * updated row — or `null` when it was already decided.
     *
     * The `status = 'pending'` predicate is the concurrency guard, not a
     * convenience: two reviewers clicking Accept at the same moment would
     * otherwise both apply the change. The loser gets `null` and reports that
     * the proposal was already decided.
     */
    async decide(
        id: string,
        workspaceId: string,
        status: Exclude<ProposalStatus, 'pending'>,
        decidedBy: string,
        result?: Record<string, unknown>
    ): Promise<ProposalView | null> {
        const [row] = await this.db
            .update(copilotProposals)
            .set({
                status,
                decidedBy,
                decidedAt: new Date(),
                result: result ?? null,
                error: null
            })
            .where(
                and(
                    eq(copilotProposals.id, id),
                    eq(copilotProposals.workspaceId, workspaceId),
                    eq(copilotProposals.status, 'pending')
                )
            )
            .returning();
        return row ? toView(row) : null;
    }

    /** Records what the applier reported on an already-accepted proposal. */
    async recordResult(
        id: string,
        workspaceId: string,
        result: Record<string, unknown>
    ): Promise<ProposalView | null> {
        const [row] = await this.db
            .update(copilotProposals)
            .set({ result })
            .where(
                and(
                    eq(copilotProposals.id, id),
                    eq(copilotProposals.workspaceId, workspaceId)
                )
            )
            .returning();
        return row ? toView(row) : null;
    }

    /**
     * Returns a proposal whose apply failed to `pending`, recording why.
     *
     * A failed apply is deliberately **not** a status of its own: it is a
     * proposal that still needs deciding, and a `failed` state would need
     * something to clear it before a retry could work. Clearing `decidedBy` /
     * `decidedAt` too keeps the row honest — nobody decided it.
     */
    async reopen(
        id: string,
        workspaceId: string,
        message: string
    ): Promise<void> {
        await this.db
            .update(copilotProposals)
            .set({
                status: 'pending',
                decidedBy: null,
                decidedAt: null,
                result: null,
                error: message
            })
            .where(
                and(
                    eq(copilotProposals.id, id),
                    eq(copilotProposals.workspaceId, workspaceId)
                )
            );
    }
}

/** Row → view, narrowing the jsonb columns to their declared shapes. */
function toView(row: typeof copilotProposals.$inferSelect): ProposalView {
    return {
        id: row.id,
        conversationId: row.conversationId,
        runId: row.runId,
        toolCallId: row.toolCallId,
        toolName: row.toolName,
        kind: row.kind,
        workspaceId: row.workspaceId,
        createdBy: row.createdBy,
        target: row.target as ProposalTarget,
        patch: row.patch as Record<string, unknown>,
        summary: row.summary,
        changes: (row.changes as ProposalChange[] | null) ?? null,
        status: row.status as ProposalStatus,
        decidedBy: row.decidedBy,
        decidedAt: row.decidedAt,
        result: (row.result as Record<string, unknown> | null) ?? null,
        error: row.error,
        createdAt: row.createdAt
    };
}
