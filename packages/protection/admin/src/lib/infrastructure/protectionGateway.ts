import { apiClient, toApiError } from '@ortha/utils-admin';
import type {
    EntryReviewStatus,
    ProtectionInsights,
    EntryReview,
    NewEntryProtection,
    ProtectionRule,
    ProtectionRuleRecord,
    PublishOutlook,
    ReviewApproval,
    ReviewerCandidate,
    ReviewQueue,
    ReviewQueueItem
} from '../domain/types';

/** Addresses one entry's review state. */
export type EntryRef = {
    /** The content type's code-defined name. */
    typeName: string;
    /** The entry row — one per locale, which is why approvals are per-locale. */
    entryId: string;
};

/** Opening the ask for review, or replacing who it names. */
export type RequestReviewInput = EntryRef & {
    /** The people asked — at least one, each from `listReviewerCandidates`. */
    reviewerIds: string[];
};

/**
 * The port over the protection API — the one seam this plugin talks to instead
 * of `apiClient` directly.
 *
 * Everything here is **workspace-scoped** and reaches the server through
 * `apiClient`'s ambient `X-Workspace-Id` header. The cache keys therefore carry
 * the workspace id explicitly: the header is not sent on a cache hit, so
 * without it one workspace would read another's answer.
 *
 * There is no publish here, bypass included. A bypass is an ordinary publish
 * carrying a reason — content-server's own `PublishEntryDto` says so — and the
 * editor's publish is content's to run: it saves the edits on screen first, or
 * creates the record on a create form. The bypass dialog hands its reason to
 * that publish through `ENTRY_PUBLISH_GUARD_SLOT`; what protection owns is the
 * ceremony in front of it.
 */
export type ProtectionGateway = {
    /**
     * One entry's review state — the requirement, the votes with their
     * staleness, and the open ask. Readable by anyone holding `content:read`,
     * because an ordinary contributor has to see "0 of 2" on their own draft.
     */
    getEntryReview(ref: EntryRef): Promise<EntryReview>;
    /**
     * What publishing a **new** entry of a type would meet, for the caller —
     * the create form's read, where there is no entry id to ask about yet.
     * `content:read`, like the entry read.
     */
    getNewEntryProtection(typeName: string): Promise<NewEntryProtection>;
    /**
     * Who the caller may ask to review this entry: the other members holding
     * `content:approve`. The request route accepts exactly these people.
     */
    listReviewerCandidates(ref: EntryRef): Promise<ReviewerCandidate[]>;
    /** Open the ask naming its reviewers, or replace who the open one names. */
    requestReview(input: RequestReviewInput): Promise<void>;
    /** Withdraw it. Only the requester or an administrator. */
    withdrawRequest(ref: EntryRef): Promise<void>;
    /** Approve the head revision. */
    approve(ref: EntryRef): Promise<void>;
    /** Withdraw this person's own approval. */
    withdrawVote(ref: EntryRef): Promise<void>;
    /**
     * One page of the workspace's open review requests, across every content
     * type — what the Reviews page reads. `content:read`, not
     * `content:approve`: the "My requests" tab is an author checking on work
     * they sent, and somebody who cannot approve still has to see whether
     * anyone has looked.
     */
    listQueue(params?: ReviewQueueParams): Promise<ReviewQueue>;
    /**
     * Every rule the open workspace holds, including any addressed at a type it
     * is no longer granted — those are the rows an administrator needs in order
     * to remove them. `protection:manage`, administrator-only.
     */
    listRules(): Promise<ProtectionRuleRecord[]>;
    /**
     * Writes the rule for one content type. A **replacement**: the six fields
     * travel whole, so the stored rule is what the form says and nothing
     * carried over.
     */
    saveRule(address: RuleAddress, rule: ProtectionRule): Promise<void>;
    /**
     * Removes the rule. Not the same as `enabled: false`, which keeps the
     * numbers the workspace had chosen. Idempotent.
     */
    deleteRule(address: RuleAddress): Promise<void>;
    /**
     * Where each entry on a records page stands, keyed by entry id.
     *
     * **One request per page, never one per row.** The records column's
     * `useRowsData` hook is handed the whole page for exactly this, and the
     * server answers it in three queries whatever the page size — an id with no
     * revision in this workspace is simply absent from the answer.
     */
    reviewStatusByEntry(
        typeName: string,
        entryIds: readonly string[]
    ): Promise<Record<string, EntryReviewStatus>>;
    /** Outstanding review requests, for the Insights card. */
    insights(): Promise<ProtectionInsights>;
};

/** Addresses one rule — the pair `workspace_content` already grants. */
export type RuleAddress = {
    /** `collection` or `single`. */
    kind: string;
    /** The code-defined content type name. */
    slug: string;
};

/** The window the queue read asks for. */
export type ReviewQueueParams = {
    /** Page size. The server caps it; omitted, it serves its own default. */
    limit?: number;
    /** How many rows to skip. */
    offset?: number;
};

/** One queue line as the wire returns it. */
type ReviewQueueItemResponse = {
    id: string;
    contentType: string;
    entryId: string;
    requestedBy: string;
    reviewerIds: string[];
    required: number;
    given: number;
    createdAt: string;
};

/** A page of the queue as the wire returns it. */
type ReviewQueueResponse = {
    items: ReviewQueueItemResponse[];
    total: number;
    overdueAfterDays: number;
};

/** One approval as the wire returns it. */
type ApprovalResponse = {
    userId: string;
    revisionId: string;
    revisionNumber: number | null;
    isStale: boolean;
    createdAt: string;
};

/** A verdict for a not-yet-written version, as the wire returns it. */
type PublishOutlookResponse = {
    required: number;
    given: number;
    blocked: boolean;
    bypassable: boolean;
};

/** `GET /protection/types/:type`, as the wire returns it. */
type NewEntryProtectionResponse = PublishOutlookResponse & {
    protected: boolean;
};

/** One entry's review state as the wire returns it. */
type EntryReviewResponse = {
    protected: boolean;
    required: number;
    given: number;
    stale: number;
    blocked: boolean;
    bypassable: boolean;
    afterSave: PublishOutlookResponse;
    headRevisionId: string;
    headRevisionNumber: number;
    callerWroteHead: boolean;
    callerApprovedHead: boolean;
    approvals: ApprovalResponse[];
    request: {
        id: string;
        requestedBy: string;
        reviewerIds: string[];
        revisionId: string;
        createdAt: string;
    } | null;
};

/** Maps one approval from the wire. */
function toApproval(dto: ApprovalResponse): ReviewApproval {
    return {
        userId: dto.userId,
        revisionId: dto.revisionId,
        revisionNumber: dto.revisionNumber,
        isStale: dto.isStale,
        createdAt: dto.createdAt
    };
}

/** Maps a not-yet-written version's verdict from the wire, as given. */
function toOutlook(dto: PublishOutlookResponse): PublishOutlook {
    return {
        required: dto.required,
        given: dto.given,
        blocked: dto.blocked,
        bypassable: dto.bypassable
    };
}

/** Maps one entry's review state from the wire. The counts travel as given. */
function toEntryReview(dto: EntryReviewResponse): EntryReview {
    return {
        protected: dto.protected,
        required: dto.required,
        given: dto.given,
        stale: dto.stale,
        blocked: dto.blocked,
        bypassable: dto.bypassable,
        afterSave: toOutlook(dto.afterSave),
        headRevisionId: dto.headRevisionId,
        headRevisionNumber: dto.headRevisionNumber,
        callerWroteHead: dto.callerWroteHead,
        callerApprovedHead: dto.callerApprovedHead,
        approvals: (dto.approvals ?? []).map(toApproval),
        request: dto.request
    };
}

/** One stored rule as the wire returns it. */
type ProtectionRuleResponse = {
    id: string;
    kind: string;
    slug: string;
    enabled: boolean;
    requiredApprovals: number;
    requireOtherPerson: boolean;
    countStaleApprovals: boolean;
    adminBypass: boolean;
    allowTokenPublish: boolean;
};

/**
 * Maps one rule from the wire.
 *
 * Booleans are coerced rather than defaulted, and the count is taken as given:
 * a mapper that quietly substituted a default here would show a rule the
 * workspace does not have, and the form would then **save** that invention on
 * the next press of Save.
 */
function toRule(dto: ProtectionRuleResponse): ProtectionRuleRecord {
    return {
        id: dto.id,
        kind: dto.kind,
        slug: dto.slug,
        enabled: !!dto.enabled,
        requiredApprovals: dto.requiredApprovals,
        requireOtherPerson: !!dto.requireOtherPerson,
        countStaleApprovals: !!dto.countStaleApprovals,
        adminBypass: !!dto.adminBypass,
        allowTokenPublish: !!dto.allowTokenPublish
    };
}

/** One queue line, wire → view. */
function toQueueItem(dto: ReviewQueueItemResponse): ReviewQueueItem {
    return {
        id: dto.id,
        contentType: dto.contentType,
        entryId: dto.entryId,
        requestedBy: dto.requestedBy,
        reviewerIds: dto.reviewerIds,
        required: dto.required,
        given: dto.given,
        createdAt: dto.createdAt
    };
}

/** `/protection/rules/:kind/:slug`. */
const rulePath = ({ kind, slug }: RuleAddress) =>
    `/protection/rules/${encodeURIComponent(kind)}/${encodeURIComponent(slug)}`;

/** `/protection/entries/:type/:id`, the prefix every entry route shares. */
const entryPath = ({ typeName, entryId }: EntryRef) =>
    `/protection/entries/${encodeURIComponent(typeName)}/${encodeURIComponent(entryId)}`;

/**
 * HTTP implementation of {@link ProtectionGateway} over the shared `apiClient`
 * (axios, same-origin, cookie-authed; paths omit the `/api` dev-proxy prefix).
 * Every failure is normalised with `toApiError`, so callers see `ApiError`
 * rather than axios internals. The single place `apiClient` is used here.
 */
export const httpProtectionGateway: ProtectionGateway = {
    async getEntryReview(ref: EntryRef): Promise<EntryReview> {
        try {
            const { data } = await apiClient.get<EntryReviewResponse>(
                entryPath(ref)
            );
            return toEntryReview(data);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async getNewEntryProtection(typeName: string): Promise<NewEntryProtection> {
        try {
            const { data } = await apiClient.get<NewEntryProtectionResponse>(
                `/protection/types/${encodeURIComponent(typeName)}`
            );
            return { protected: data.protected, ...toOutlook(data) };
        } catch (error) {
            throw toApiError(error);
        }
    },

    async listReviewerCandidates(ref: EntryRef): Promise<ReviewerCandidate[]> {
        try {
            const { data } = await apiClient.get<{
                candidates: ReviewerCandidate[];
            }>(`${entryPath(ref)}/reviewers`);
            return data.candidates.map((candidate) => ({
                userId: candidate.userId,
                email: candidate.email
            }));
        } catch (error) {
            throw toApiError(error);
        }
    },

    async requestReview({
        reviewerIds,
        ...ref
    }: RequestReviewInput): Promise<void> {
        try {
            await apiClient.post(`${entryPath(ref)}/request`, { reviewerIds });
        } catch (error) {
            throw toApiError(error);
        }
    },

    async listQueue(params: ReviewQueueParams = {}): Promise<ReviewQueue> {
        try {
            // No `mine` flag: the page fetches one window and splits it into
            // both tabs, so their counts cannot disagree with each other or
            // with the nav badge. See `splitQueue`.
            const { data } = await apiClient.get<ReviewQueueResponse>(
                '/protection/queue',
                { params }
            );
            return {
                items: data.items.map(toQueueItem),
                total: data.total,
                overdueAfterDays: data.overdueAfterDays
            };
        } catch (error) {
            throw toApiError(error);
        }
    },

    async withdrawRequest(ref: EntryRef): Promise<void> {
        try {
            await apiClient.delete(`${entryPath(ref)}/request`);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async approve(ref: EntryRef): Promise<void> {
        try {
            await apiClient.post(`${entryPath(ref)}/approve`);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async withdrawVote(ref: EntryRef): Promise<void> {
        try {
            await apiClient.delete(`${entryPath(ref)}/approve`);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async listRules(): Promise<ProtectionRuleRecord[]> {
        try {
            const { data } =
                await apiClient.get<ProtectionRuleResponse[]>(
                    '/protection/rules'
                );
            return (data ?? []).map(toRule);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async saveRule(address: RuleAddress, rule: ProtectionRule): Promise<void> {
        try {
            // All six, always — the API replaces rather than patches.
            await apiClient.put(rulePath(address), rule);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async deleteRule(address: RuleAddress): Promise<void> {
        try {
            await apiClient.delete(rulePath(address));
        } catch (error) {
            throw toApiError(error);
        }
    },
    async reviewStatusByEntry(
        typeName: string,
        entryIds: readonly string[]
    ): Promise<Record<string, EntryReviewStatus>> {
        // Asking about nothing is a request worth not making: the records list
        // renders an empty page while a filter is being typed, and the hook runs
        // on every render.
        if (!entryIds.length) return {};
        try {
            const { data } = await apiClient.get<{
                byEntry: Record<string, EntryReviewStatus>;
            }>(`/protection/entries/${encodeURIComponent(typeName)}/status`, {
                params: { ids: entryIds.join(',') }
            });
            return data?.byEntry ?? {};
        } catch (error) {
            throw toApiError(error);
        }
    },

    async insights(): Promise<ProtectionInsights> {
        try {
            const { data } = await apiClient.get<ProtectionInsights>(
                '/insights/protection/reviews'
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    }
};
