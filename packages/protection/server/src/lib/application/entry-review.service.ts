import { Injectable } from '@nestjs/common';
import {
    attachActor,
    OutboxWriter,
    UnitOfWork,
    type EventActor
} from '@orthacms/database';
import {
    InjectContentRegistry,
    WorkspaceGrantsQuery,
    type ContentTypeRegistry
} from '@orthacms/content-server';
import {
    AccessPolicy,
    PERMISSIONS,
    Permission,
    PermissionsService,
    type PublicUser
} from '@orthacms/identity-server';
import {
    countApprovals,
    evaluateProtection,
    type ProtectionInput
} from '@orthacms/protection-domain';
import {
    ReviewableEntryNotFoundError,
    ReviewerNotEligibleError,
    ReviewRequestNotFoundError,
    ReviewRequestNotYoursError,
    SelfApprovalRefusedError,
    UnknownProtectedContentTypeError
} from '../domain/errors';
import {
    ReviewerCandidatesQuery,
    type ReviewerCandidate
} from '../infrastructure/reviewer-candidates.query';
import {
    HeadRevisionQuery,
    type HeadRevision
} from '../infrastructure/head-revision.query';
import { ProtectionRuleRepository } from '../infrastructure/protection-rule.repository';
import {
    ReviewApprovalRepository,
    type StoredApproval
} from '../infrastructure/review-approval.repository';
import { ReviewRequestRepository } from '../infrastructure/review-request.repository';
import { PROTECTION_EVENT_KINDS, reviewEvent } from '../protection.events';
import type {
    EntryReviewView,
    NewEntryProtectionView,
    PublishOutlookView,
    ReviewApprovalView
} from '../types/protection-views';

/**
 * Who is asking, as every method here needs them.
 *
 * `managesProtection` is the caller holding **`protection:manage`**, not the
 * caller being in the `admin` role. `system-roles.ts` states the rule outright —
 * *"the routes gate on the permission, never on the role"* — and it matters
 * here: an operator who mints a custom role holding `protection:manage` has said
 * that role administers protection in this workspace, and reading the role key
 * instead would silently ignore them.
 *
 * It carries two powers: withdrawing somebody else's request, and being told
 * that a bypass is available. The bypass itself is enforced by the publish
 * guard, which is a later PR; here it is only reported.
 */
export interface ReviewActor {
    id: string;
    email: string | null;
    managesProtection: boolean;
}

/** The entry an operation addresses, once it has been proven reachable. */
interface ResolvedEntry {
    contentType: string;
    kind: string;
    entryId: string;
    workspaceId: string;
    head: HeadRevision;
}

/**
 * Review on one entry: what the state is, who may be asked, and the writes that
 * change it.
 *
 * **The counting is not here.** Every number this service reports comes from
 * `evaluateProtection` in `@orthacms/protection-domain`, handed the rule, the
 * head revision and the votes. That matters more than it looks: the same
 * function decides whether the publish route refuses, so a second count in SQL
 * would be a button that disagrees with the API refusing it — and it would
 * disagree first on the paths nobody exercises, `countStaleApprovals` and the
 * four-eyes exclusion.
 *
 * What this service owns is the half a pure function cannot: proving the entry
 * is reachable from this workspace, finding which revision is currently the
 * head, and committing the vote and its audit event together.
 */
@Injectable()
export class EntryReviewService {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly rules: ProtectionRuleRepository,
        private readonly requests: ReviewRequestRepository,
        private readonly approvals: ReviewApprovalRepository,
        private readonly heads: HeadRevisionQuery,
        private readonly candidates: ReviewerCandidatesQuery,
        private readonly grants: WorkspaceGrantsQuery,
        private readonly permissions: PermissionsService,
        private readonly accessPolicy: AccessPolicy,
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry
    ) {}

    /**
     * The signed-in member as this service's actor, resolving the one
     * permission that changes what they may do here.
     */
    async actorFor(user: PublicUser): Promise<ReviewActor> {
        const granted = await this.permissions.forRole(user.roleId);
        return {
            id: user.id,
            email: user.email ?? null,
            managesProtection: this.accessPolicy.can(
                { userId: user.id, grantedPermissions: new Set(granted) },
                Permission.create(PERMISSIONS.PROTECTION_MANAGE)
            )
        };
    }

    /** The whole review state of one entry, as the editor renders it. */
    async state(
        workspaceId: string,
        contentType: string,
        entryId: string,
        actor: ReviewActor
    ): Promise<EntryReviewView> {
        const entry = await this.resolve(workspaceId, contentType, entryId);
        const rule = await this.ruleFor(entry);
        const votes = await this.approvals.listForEntry(workspaceId, entryId);
        const kernelActor = {
            // A session, so never a token — the token gate is the publish
            // route's business and nothing on this surface can be reached by
            // one.
            userId: actor.id,
            isAdmin: actor.managesProtection,
            isToken: false
        };
        const input = {
            rule: rule ?? undefined,
            headRevisionId: entry.head.id,
            headAuthorId: entry.head.authorId,
            approvals: votes,
            actor: kernelActor
        };
        const decision = evaluateProtection(input);
        const counts = countApprovals(input);
        // The version a save would write now: bound to by no vote yet, and
        // written by the caller — which is what the four-eyes exclusion reads.
        const afterSave = outlook({
            ...input,
            headRevisionId: UNWRITTEN_REVISION,
            headAuthorId: actor.id
        });
        const request = await this.requests.findOpen(workspaceId, entryId);
        const numbers = await this.revisionNumbers(entry, votes);

        return {
            protected: decision.reason !== 'unprotected',
            required: rule?.enabled ? rule.requiredApprovals : 0,
            given: counts.given,
            stale: counts.stale,
            blocked: !decision.allowed,
            bypassable: 'bypassable' in decision ? decision.bypassable : false,
            afterSave,
            headRevisionId: entry.head.id,
            headRevisionNumber: entry.head.number,
            callerWroteHead: entry.head.authorId === actor.id,
            callerApprovedHead: votes.some(
                (vote) =>
                    vote.userId === actor.id &&
                    vote.revisionId === entry.head.id
            ),
            approvals: votes.map((vote) =>
                toApprovalView(vote, entry, numbers)
            ),
            request: request
                ? {
                      id: request.id,
                      requestedBy: request.requestedBy,
                      reviewerIds: request.reviewerIds,
                      revisionId: request.revisionId,
                      createdAt: request.createdAt.toISOString()
                  }
                : null
        };
    }

    /**
     * What publishing a **new** entry of `contentType` would meet, for `actor`
     * — the create form's answer, where there is no entry to read a review of.
     *
     * A new entry has no revision and no votes, so this is the kernel handed
     * exactly that rather than a shortcut reading `rule.enabled`: a rule is
     * free to grow a field that changes the answer for an unreviewed entry,
     * and a second reading of it here would not notice.
     *
     * Unknown and ungranted types answer with the same error, for the reason
     * {@link resolve} gives.
     */
    async forNewEntry(
        workspaceId: string,
        contentType: string,
        actor: ReviewActor
    ): Promise<NewEntryProtectionView> {
        const type = this.registry.get(contentType);
        const granted = await this.grants.grantedSlugs(workspaceId);
        if (!type || !granted.has(contentType)) {
            throw new UnknownProtectedContentTypeError(
                type?.kind ?? 'collection',
                contentType
            );
        }
        const rule =
            (await this.rules.find(workspaceId, type.kind, contentType)) ??
            undefined;
        const view = outlook({
            rule,
            headRevisionId: UNWRITTEN_REVISION,
            headAuthorId: actor.id,
            approvals: [],
            actor: {
                userId: actor.id,
                isAdmin: actor.managesProtection,
                isToken: false
            }
        });
        return { protected: !!rule?.enabled, ...view };
    }

    /**
     * Who the caller may ask to review this entry — the picker's list.
     *
     * Resolving the entry first is the authorization check, as on every route
     * here: an entry this workspace cannot reach has no reviewers to offer.
     */
    async reviewerCandidates(
        workspaceId: string,
        contentType: string,
        entryId: string,
        actor: ReviewActor
    ): Promise<ReviewerCandidate[]> {
        await this.resolve(workspaceId, contentType, entryId);
        return this.candidates.list(workspaceId, actor.id);
    }

    /**
     * Opens the review request naming who is asked, or replaces the reviewers
     * on the one already open.
     *
     * Every reviewer must be somebody {@link reviewerCandidates} offers — a
     * member who can approve, other than the caller — so nobody can be left in
     * a request as a pending reviewer with no way to approve. Asking names
     * people; it never changes whose approval counts.
     *
     * Allowed on an **unprotected** type too. Asking for a second pair of eyes
     * on something nobody protected is a reasonable thing to want, and refusing
     * it would make the queue a function of the settings tab rather than of what
     * people actually asked for. What an unprotected type does not do is block.
     */
    async requestReview(
        workspaceId: string,
        contentType: string,
        entryId: string,
        reviewerIds: readonly string[],
        actor: ReviewActor
    ): Promise<void> {
        const entry = await this.resolve(workspaceId, contentType, entryId);
        const eligible = new Set(
            (await this.candidates.list(workspaceId, actor.id)).map(
                (candidate) => candidate.userId
            )
        );
        const reviewers = [...new Set(reviewerIds)];
        if (!reviewers.length || reviewers.some((id) => !eligible.has(id))) {
            throw new ReviewerNotEligibleError();
        }
        await this.uow.run(async () => {
            const request = await this.requests.open({
                workspaceId,
                contentType: entry.contentType,
                entryId: entry.entryId,
                revisionId: entry.head.id,
                requestedBy: actor.id,
                reviewerIds: reviewers
            });
            await this.emit(
                reviewEvent(
                    PROTECTION_EVENT_KINDS.REVIEW_REQUESTED,
                    entry.entryId,
                    {
                        workspaceId,
                        contentType: entry.contentType,
                        requestId: request.id,
                        revisionNumber: entry.head.number,
                        reviewerIds: reviewers
                    }
                ),
                actor
            );
        });
    }

    /**
     * Withdraws the open request — the **requester's** to withdraw, or an
     * administrator's.
     *
     * A reviewer who thinks the ask was premature declines to approve; letting
     * any contributor clear it would make the queue a shared inbox anybody can
     * empty. Resolved rather than deleted, so the trail keeps that it was asked.
     */
    async withdrawRequest(
        workspaceId: string,
        contentType: string,
        entryId: string,
        actor: ReviewActor
    ): Promise<void> {
        await this.resolve(workspaceId, contentType, entryId);
        const request = await this.requests.findOpen(workspaceId, entryId);
        if (!request) throw new ReviewRequestNotFoundError(entryId);
        if (request.requestedBy !== actor.id && !actor.managesProtection) {
            throw new ReviewRequestNotYoursError(request.id);
        }
        await this.uow.run(() => this.requests.resolve(request.id));
    }

    /**
     * Records this person's approval of the entry's head revision.
     *
     * The four-eyes check happens **here** rather than only at publish time, and
     * it is the one rule this service enforces itself. It has to: the kernel
     * excludes the head author from the *count*, so a stored self-approval would
     * be a row that silently never counts — the reviewer sees their name in the
     * list, the number does not move, and nothing anywhere says why. Refusing
     * the write says it once, at the moment it can be explained.
     */
    async approve(
        workspaceId: string,
        contentType: string,
        entryId: string,
        actor: ReviewActor
    ): Promise<void> {
        const entry = await this.resolve(workspaceId, contentType, entryId);
        const rule = await this.ruleFor(entry);

        if (
            rule?.enabled &&
            rule.requireOtherPerson &&
            entry.head.authorId !== null &&
            entry.head.authorId === actor.id
        ) {
            throw new SelfApprovalRefusedError(entry.head.id);
        }

        await this.uow.run(async () => {
            await this.approvals.cast({
                workspaceId,
                contentType: entry.contentType,
                entryId: entry.entryId,
                revisionId: entry.head.id,
                userId: actor.id
            });
            await this.emit(
                reviewEvent(
                    PROTECTION_EVENT_KINDS.REVIEW_APPROVED,
                    entry.entryId,
                    {
                        workspaceId,
                        contentType: entry.contentType,
                        // The version, not just the id: an audit row read six
                        // months later has no way to resolve a revision uuid to
                        // "version 7", and "approved" with nothing saying what
                        // was approved is not a trail.
                        revisionNumber: entry.head.number,
                        revisionId: entry.head.id
                    }
                ),
                actor
            );
        });
    }

    /**
     * Withdraws the caller's own vote on the head.
     *
     * Idempotent, and it reaches no further back than the head — a vote on an
     * earlier version is already not counting, and removing it would erase the
     * struck-through line that explains why the number moved.
     *
     * No event: a withdrawal on the head that nothing consumed changes no
     * authority, and the approval it retracts has its own row.
     */
    async withdrawVote(
        workspaceId: string,
        contentType: string,
        entryId: string,
        actor: ReviewActor
    ): Promise<void> {
        const entry = await this.resolve(workspaceId, contentType, entryId);
        await this.uow.run(() =>
            this.approvals.withdraw(
                workspaceId,
                entry.entryId,
                entry.head.id,
                actor.id
            )
        );
    }

    /**
     * Proves the entry is one this workspace may review, and finds its head.
     *
     * Two checks that answer with the **same** error: the workspace must hold a
     * grant for the content type, and the entry must have a revision under that
     * type in this workspace. Telling them apart would let a member of one
     * workspace probe another's entry ids, which is content's own
     * `resolveGrantedType` reasoning applied one level down.
     */
    private async resolve(
        workspaceId: string,
        contentType: string,
        entryId: string
    ): Promise<ResolvedEntry> {
        const type = this.registry.get(contentType);
        const granted = await this.grants.grantedSlugs(workspaceId);
        if (!type || !granted.has(contentType)) {
            throw new ReviewableEntryNotFoundError(contentType, entryId);
        }
        const head = await this.heads.find(contentType, entryId, workspaceId);
        if (!head) {
            throw new ReviewableEntryNotFoundError(contentType, entryId);
        }
        return {
            contentType,
            kind: type.kind,
            entryId,
            workspaceId,
            head
        };
    }

    /** The rule for this entry's type, or `null` when the type is unprotected. */
    private ruleFor(entry: ResolvedEntry) {
        return this.rules.find(
            entry.workspaceId,
            entry.kind,
            entry.contentType
        );
    }

    /**
     * Version numbers for the revisions the votes name, so a stale line can say
     * *which* version it was given on.
     *
     * Only the head's number is known cheaply; an older one needs the revision
     * itself. Rather than a query per stale vote, the timeline is read once and
     * the numbers looked up in it — and a vote whose revision has been purged
     * simply reports `null` rather than failing the whole read.
     */
    private async revisionNumbers(
        entry: ResolvedEntry,
        votes: readonly StoredApproval[]
    ): Promise<Map<string, number>> {
        const numbers = new Map<string, number>([
            [entry.head.id, entry.head.number]
        ]);
        const unknown = votes.filter((vote) => !numbers.has(vote.revisionId));
        if (!unknown.length) return numbers;
        for (const summary of await this.heads.timeline(
            entry.contentType,
            entry.entryId,
            entry.workspaceId
        )) {
            numbers.set(summary.id, summary.number);
        }
        return numbers;
    }

    /** Append one event to the outbox from inside the active unit of work. */
    private async emit(
        event: ReturnType<typeof reviewEvent>,
        actor: ReviewActor
    ): Promise<void> {
        const principal: EventActor = { id: actor.id, email: actor.email };
        await this.outbox.append(attachActor([event], principal));
    }
}

/**
 * The head id handed to the kernel for a version that has not been written yet.
 *
 * Every stored vote names a real revision uuid, so no vote can be bound to this
 * — which is the whole of what a not-yet-written version means to the count.
 */
const UNWRITTEN_REVISION = '';

/** The kernel's verdict and counts for one input, as a {@link PublishOutlookView}. */
function outlook(input: ProtectionInput): PublishOutlookView {
    const decision = evaluateProtection(input);
    return {
        required: input.rule?.enabled ? input.rule.requiredApprovals : 0,
        given: countApprovals(input).given,
        blocked: !decision.allowed,
        bypassable: 'bypassable' in decision ? decision.bypassable : false
    };
}

/** One stored vote → the view, with its staleness resolved against the head. */
function toApprovalView(
    vote: StoredApproval,
    entry: ResolvedEntry,
    numbers: Map<string, number>
): ReviewApprovalView {
    return {
        userId: vote.userId,
        revisionId: vote.revisionId,
        revisionNumber: numbers.get(vote.revisionId) ?? null,
        isStale: vote.revisionId !== entry.head.id,
        createdAt: vote.createdAt.toISOString()
    };
}
