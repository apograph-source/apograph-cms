import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import {
    ToolRegistry,
    type ToolContext,
    type ToolDefinition,
    type ToolProvider
} from '@orthacms/tools-server';
import {
    InjectContentRegistry,
    InjectRevisionStore,
    diffSnapshots,
    type ContentTypeRegistry,
    type RevisionStore,
    type SnapshotFieldChange
} from '@orthacms/content-server';
import { PERMISSIONS } from '@orthacms/identity-server';
import { ReviewStatusQuery } from '../application/review-status.query';
import { EntryReviewService } from '../application/entry-review.service';
import { ReviewApprovalRepository } from '../infrastructure/review-approval.repository';
import { ReviewerCandidatesQuery } from '../infrastructure/reviewer-candidates.query';
import { HeadRevisionQuery } from '../infrastructure/head-revision.query';

/** What `protection_review_status` answers with. */
interface ReviewStatusToolView {
    protected: boolean;
    required: number;
    given: number;
    stale: number;
    requested: boolean;
    blocked: boolean;
    headRevisionNumber: number;
}

/** What `protection_review_diff` answers with. */
interface ReviewDiffToolView {
    /** The version the caller last approved, or `null` if they never have. */
    fromRevisionNumber: number | null;
    /** The version live in the editor now. */
    toRevisionNumber: number;
    /** Only the fields that actually differ. */
    changes: SnapshotFieldChange[];
    /** How many fields are identical, so a model can say "and nothing else". */
    unchangedFields: number;
}

/**
 * The agent-facing half of publication protection — what a model may ask and
 * request about a review.
 *
 * **Three tools, and the fourth is absent on purpose.** There is no
 * `protection_approve`, on the copilot or
 * over MCP, now or later. ADR-0017 §6 carries the argument and it is settled;
 * the short form is that with a rule in force the approval *is* the step that
 * unlocks publication, so handing a model `approve` while withholding `publish`
 * hands over the key and keeps the doorknob. Three further reasons, each already
 * written down in this repository:
 *
 * - ADR-0009 deleted the copilot's approval queue because "one sentence and
 *   twelve approvals, nobody reads the twelfth". A tool is that failure without
 *   even the clicks.
 * - ADR-0005 §8: entry bodies are written by users. An entry whose text says
 *   *approve me*, meeting a model holding such a tool, is a self-approving
 *   entry — and unlike an ordinary content write there is no revision to
 *   restore, because the approval **is** the authorization and publication
 *   follows it.
 * - `require_other_person` compares user ids. A copilot run acts as its caller,
 *   so the rule would be satisfied while the guarantee — that a second person
 *   read the thing — quietly would not be. No check can tell those apart.
 *
 * `protection:I-17` says the absence must hold **registry-wide**: a tool with an
 * approve effect must not appear for any role on any surface, wherever it were
 * contributed from. What is actually pinned today is narrower — the spec beside
 * this file scans the catalogue *this provider* returns, so a tool contributed
 * from another package would pass it. The invariant is stated at the altitude it
 * should be enforced at; the assertion that would enforce it belongs in
 * `apps/server-e2e/src/server/tools/tool-registry.spec.ts`, which boots the real
 * registry on both surfaces and does not have one yet.
 *
 * ## What a model does instead
 *
 * It helps somebody read. `protection_review_diff` is the valuable one — "what
 * changed since the version I approved" is a question revisions answer *exactly*
 * rather than by paraphrase, and it is the question a returning reviewer
 * actually has. The other two let a run report where a review stands and ask for
 * one on the author's behalf.
 */
@Injectable()
export class ProtectionToolProvider implements ToolProvider, OnModuleInit {
    constructor(
        private readonly status: ReviewStatusQuery,
        private readonly approvals: ReviewApprovalRepository,
        private readonly review: EntryReviewService,
        private readonly candidates: ReviewerCandidatesQuery,
        private readonly heads: HeadRevisionQuery,
        @InjectRevisionStore() private readonly revisions: RevisionStore,
        @InjectContentRegistry() private readonly types: ContentTypeRegistry,
        // A deployment may run neither consumer, in which case these simply go
        // unregistered — the same `@Optional()` every tool provider takes.
        @Optional() private readonly registry?: ToolRegistry
    ) {}

    onModuleInit(): void {
        this.registry?.register(this);
    }

    tools(): readonly ToolDefinition[] {
        return [this.reviewStatus(), this.reviewDiff(), this.requestReview()];
    }

    /** `protection_review_status` — where a review stands. */
    private reviewStatus(): ToolDefinition {
        return {
            name: 'protection_review_status',
            title: 'Review status',
            description:
                'Report where an entry stands against its content type’s review rule: how ' +
                'many approvals are required, how many count on the current version, how ' +
                'many went stale when the entry was last saved, and whether publishing is ' +
                'held. Returns `protected: false` when no rule applies, which means the ' +
                'entry publishes normally. ' +
                'You cannot approve an entry — an approval is a person’s statement that ' +
                'they read it, and there is no tool for it on any surface. Point the person ' +
                'at the Review section in the entry editor instead.',
            inputSchema: {
                type: 'object',
                properties: {
                    typeName: {
                        type: 'string',
                        description: 'The content type’s machine name.'
                    },
                    entryId: {
                        type: 'string',
                        description: 'The entry to report on.'
                    }
                },
                required: ['typeName', 'entryId'],
                additionalProperties: false
            },
            requires: [PERMISSIONS.CONTENT_READ],
            readOnly: true,
            // Stated explicitly. Omitting `surfaces` in `tools/server` means
            // BOTH consumers, so silence here would hand a tool to MCP by
            // accident rather than by decision.
            surfaces: ['copilot', 'mcp'],
            handler: async (input, ctx) =>
                this.runStatus(
                    String(input['typeName']),
                    String(input['entryId']),
                    ctx
                )
        };
    }

    /** `protection_review_diff` — what changed since the caller last approved. */
    private reviewDiff(): ToolDefinition {
        return {
            name: 'protection_review_diff',
            title: 'What changed since I approved',
            description:
                'Compare an entry’s current version with the last version the calling user ' +
                'approved, and report only the fields that differ. This is exact rather ' +
                'than a summary: every save stores a full snapshot, so the comparison is ' +
                'between two real documents. Use it when a reviewer asks what has changed ' +
                'since they last looked. When the caller has never approved this entry, ' +
                '`fromRevisionNumber` is null and no changes are reported — there is no ' +
                'earlier point of theirs to compare against. ' +
                'You cannot approve; a person does that in the editor.',
            inputSchema: {
                type: 'object',
                properties: {
                    typeName: {
                        type: 'string',
                        description: 'The content type’s machine name.'
                    },
                    entryId: {
                        type: 'string',
                        description: 'The entry to compare.'
                    }
                },
                required: ['typeName', 'entryId'],
                additionalProperties: false
            },
            requires: [PERMISSIONS.CONTENT_READ],
            readOnly: true,
            surfaces: ['copilot', 'mcp'],
            handler: async (input, ctx) =>
                this.runDiff(
                    String(input['typeName']),
                    String(input['entryId']),
                    ctx
                )
        };
    }

    /** `protection_request_review` — ask somebody to look. */
    private requestReview(): ToolDefinition {
        return {
            name: 'protection_request_review',
            title: 'Request review',
            description:
                'Ask named people to review an entry. Name each reviewer by email address ' +
                '(or user id); they must be other members of this workspace who can ' +
                'approve content, and an error lists who can be asked when a name is not ' +
                'one of them. This records a request; it does not approve anything and does ' +
                'not publish, and who is asked does not change whose approval counts. ' +
                'Asking twice replaces the reviewers on the open request rather than ' +
                'creating a second one. Allowed on an unprotected type too — wanting a ' +
                'second pair of eyes does not require a rule.',
            inputSchema: {
                type: 'object',
                properties: {
                    typeName: {
                        type: 'string',
                        description: 'The content type’s machine name.'
                    },
                    entryId: {
                        type: 'string',
                        description: 'The entry to ask about.'
                    },
                    reviewers: {
                        type: 'array',
                        description:
                            'Who to ask: email addresses (or user ids) of workspace members who can approve content.',
                        items: { type: 'string' },
                        minItems: 1,
                        maxItems: 50
                    }
                },
                required: ['typeName', 'entryId', 'reviewers'],
                additionalProperties: false
            },
            requires: [PERMISSIONS.CONTENT_UPDATE],
            readOnly: false,
            // `apply`, so the copilot's run engine parks it for the
            // in-the-moment prompt like any other write (ADR-0009). What it
            // applies is a *request*, never content and never an approval.
            effect: 'apply',
            surfaces: ['copilot', 'mcp'],
            handler: async (input, ctx) =>
                this.runRequest(
                    String(input['typeName']),
                    String(input['entryId']),
                    Array.isArray(input['reviewers'])
                        ? input['reviewers'].map(String)
                        : [],
                    ctx
                )
        };
    }

    /** The status read, shared with the records column's own query. */
    private async runStatus(
        typeName: string,
        entryId: string,
        ctx: ToolContext
    ): Promise<ReviewStatusToolView> {
        const head = await this.assertReachable(typeName, entryId, ctx);
        const byEntry = await this.status.forEntries(
            ctx.workspaceId,
            typeName,
            [entryId]
        );
        const status = byEntry.get(entryId);
        if (!status) throw new Error(NOT_FOUND);
        return { ...status, headRevisionNumber: head.number };
    }

    /** The diff read. */
    private async runDiff(
        typeName: string,
        entryId: string,
        ctx: ToolContext
    ): Promise<ReviewDiffToolView> {
        const head = await this.assertReachable(typeName, entryId, ctx);
        const serialized = this.types.serialize(typeName);
        if (!serialized) throw new Error(NOT_FOUND);

        const votes = await this.approvals.listForEntry(
            ctx.workspaceId,
            entryId
        );
        // The caller's own approvals, newest first. A run acts as its caller, so
        // "the version I approved" is the version this user approved — the same
        // identity `require_other_person` compares, and the reason the tool is
        // useful without being a way to act as somebody else.
        const mine = votes
            .filter((vote) => vote.userId === ctx.actor.userId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const last = mine[0];
        if (!last || last.revisionId === head.id) {
            // Nothing of theirs to compare against, or theirs *is* the head —
            // either way there is no change to report, and inventing a
            // comparison against version 1 would answer a question nobody asked.
            return {
                fromRevisionNumber: last ? head.number : null,
                toRevisionNumber: head.number,
                changes: [],
                unchangedFields: serialized.fields.length
            };
        }

        const timeline = await this.heads.timeline(
            typeName,
            entryId,
            ctx.workspaceId
        );
        const fromNumber = timeline.find(
            (entry) => entry.id === last.revisionId
        )?.number;
        if (fromNumber == null) {
            // Their approval is older than the timeline window. Reporting a
            // diff against an unknown base would be worse than saying so.
            return {
                fromRevisionNumber: null,
                toRevisionNumber: head.number,
                changes: [],
                unchangedFields: serialized.fields.length
            };
        }

        const [from, to] = await Promise.all([
            this.revisions.get(typeName, entryId, ctx.workspaceId, fromNumber),
            this.revisions.get(typeName, entryId, ctx.workspaceId, head.number)
        ]);
        if (!from || !to) throw new Error(NOT_FOUND);
        const { changes, unchangedFields } = diffSnapshots(
            serialized,
            from.snapshot,
            to.snapshot
        );
        return {
            fromRevisionNumber: fromNumber,
            toRevisionNumber: head.number,
            changes,
            unchangedFields
        };
    }

    /**
     * The request write — through `EntryReviewService`, the route's own path,
     * so a run cannot ask somebody the picker would not offer and the request
     * lands in the log like one made in the editor.
     */
    private async runRequest(
        typeName: string,
        entryId: string,
        reviewers: readonly string[],
        ctx: ToolContext
    ): Promise<{ requested: true; headRevisionNumber: number }> {
        const head = await this.assertReachable(typeName, entryId, ctx);
        const userId = ctx.actor.userId;
        if (!userId) {
            // A bearer token names nobody, and a request records who asked.
            throw new Error(
                'Only a signed-in user can request a review — a request records who asked.'
            );
        }
        const candidates = await this.candidates.list(ctx.workspaceId, userId);
        const byName = new Map<string, string>();
        for (const candidate of candidates) {
            byName.set(candidate.userId, candidate.userId);
            byName.set(candidate.email.toLowerCase(), candidate.userId);
        }
        const reviewerIds = reviewers.map((name) =>
            byName.get(name.trim().toLowerCase())
        );
        if (!reviewerIds.length || reviewerIds.some((id) => !id)) {
            // Naming who *can* be asked is what lets a model correct itself in
            // one turn. The caller holds `content:update`, which is all the
            // editor's picker asks of them to see the same list.
            throw new Error(
                'Every reviewer must be another member of this workspace who can approve content. ' +
                    `Who can be asked: ${candidates.map((c) => c.email).join(', ') || 'nobody'}.`
            );
        }
        await this.review.requestReview(
            ctx.workspaceId,
            typeName,
            entryId,
            reviewerIds as string[],
            { id: userId, email: null, managesProtection: false }
        );
        return { requested: true, headRevisionNumber: head.number };
    }

    /**
     * The entry's head, or a uniform failure.
     *
     * Reaching the head through `RevisionStore` is **also** the authorization
     * check: the port scopes every read by content type and workspace, so an
     * entry in another workspace, under another type, or simply absent all
     * answer the same way. One message for all three, so a run in one workspace
     * cannot enumerate another's content.
     */
    private async assertReachable(
        typeName: string,
        entryId: string,
        ctx: ToolContext
    ) {
        const head = await this.heads.find(typeName, entryId, ctx.workspaceId);
        if (!head) throw new Error(NOT_FOUND);
        return head;
    }
}

/** One message for absent, foreign and wrong-type alike. */
const NOT_FOUND = 'No such entry in this workspace.';
