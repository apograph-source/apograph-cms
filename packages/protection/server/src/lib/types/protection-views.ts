import type { ProtectionRule } from '@orthacms/protection-domain';

/**
 * One rule as the settings tab reads it.
 *
 * It is the domain's {@link ProtectionRule} — the six fields the decision is
 * made from — plus the addressing and the audit trail the screen shows around
 * it. Spelling the six out again here would be a second definition to keep in
 * step with the kernel, and the kernel is the one the publish gate consults.
 */
export interface ProtectionRuleView extends ProtectionRule {
    /** Row id. Stable across edits; the address is `(kind, slug)`. */
    id: string;
    /** `collection` or `single`. */
    kind: string;
    /** The code-defined content type name. */
    slug: string;
    /** Who last changed the rule, or `null` when that user is gone. */
    updatedBy: string | null;
    /** ISO-8601. */
    createdAt: string;
    /** ISO-8601. */
    updatedAt: string;
}

/** One recorded approval, as the entry panel renders it. */
export interface ReviewApprovalView {
    /** Who approved. The panel resolves the name; the API stays id-only. */
    userId: string;
    /** The revision they approved. */
    revisionId: string;
    /**
     * Its 1-based version number — what the panel prints beside a struck-through
     * name. Without it "this no longer counts" has nothing to point at.
     */
    revisionNumber: number | null;
    /**
     * Whether the vote is off the head, and therefore struck through.
     *
     * A stale vote is still **shown**: a counter that silently rolls back after
     * a save is unexplainable to the person who just pressed Save, and the
     * struck-through line naming its version is the explanation.
     */
    isStale: boolean;
    /** ISO-8601. */
    createdAt: string;
}

/** The open ask on an entry, when there is one. */
export interface ReviewRequestView {
    id: string;
    requestedBy: string;
    /**
     * The people asked, in the order they were picked. Who was asked never
     * changes whose approval counts — anyone holding `content:approve` may
     * still approve.
     */
    reviewerIds: string[];
    /** The head at the moment of asking — trail only; the ask outlives it. */
    revisionId: string;
    /** ISO-8601. */
    createdAt: string;
}

/**
 * What a publish would meet for a version that is **not** the stored head — the
 * one a save is about to write, or the first one a create writes.
 *
 * It exists because the editor's Publish button saves before it publishes
 * whenever there is anything unsaved, and that save moves the head: the head's
 * approvals stop counting, and the caller becomes the head's author. A button
 * that read only the stored head's verdict would offer an ordinary publish the
 * API then refuses. These numbers come from `evaluateProtection` too, handed a
 * head no vote is bound to and authored by the caller — so they are the
 * kernel's answer to that question rather than a count restated here.
 */
export interface PublishOutlookView {
    /** How many approvals the rule wants. `0` when unprotected. */
    required: number;
    /** How many would still count once the new version is written. */
    given: number;
    /** Whether the publish would be held. Always `false` when unprotected. */
    blocked: boolean;
    /** Whether the caller could publish past the rule. See {@link EntryReviewView.bypassable}. */
    bypassable: boolean;
}

/**
 * What publishing a **new** entry of one content type would meet, for the
 * caller — the create form's answer, where there is no entry to review yet.
 */
export interface NewEntryProtectionView extends PublishOutlookView {
    /** Whether a rule is in force for this type. */
    protected: boolean;
}

/**
 * Everything the entry editor needs to render review, in one read.
 *
 * It is `evaluateProtection`'s decision plus the people behind the numbers. The
 * counts come from the kernel rather than from a second count in SQL — a number
 * computed twice is a button that disagrees with the API refusing it.
 */
export interface EntryReviewView {
    /** Whether a rule is in force for this type. */
    protected: boolean;
    /** How many approvals the rule wants. `0` when unprotected. */
    required: number;
    /** How many count right now. */
    given: number;
    /** How many people's only approval sits on an earlier version. */
    stale: number;
    /** Whether publication is currently held. Always `false` when unprotected. */
    blocked: boolean;
    /**
     * Whether an administrator could publish past the rule.
     *
     * Reported, never applied: taking a bypass is an explicit request on the
     * publish route. It is `false` for everybody but an administrator, and for
     * every rule with `adminBypass` off.
     */
    bypassable: boolean;
    /**
     * The same verdict for the version a save would write now — what the
     * editor's Publish button meets when it has unsaved changes to save first.
     */
    afterSave: PublishOutlookView;
    /** The entry's current version — what an approval would be bound to. */
    headRevisionId: string;
    /** Its 1-based number. */
    headRevisionNumber: number;
    /** Whether the caller wrote the head, and so cannot approve it. */
    callerWroteHead: boolean;
    /** Whether the caller has already approved the head — nothing left to press. */
    callerApprovedHead: boolean;
    /** Every vote on the entry, stale ones included. */
    approvals: ReviewApprovalView[];
    /** The open ask, or `null`. */
    request: ReviewRequestView | null;
}

/** Somebody the caller may ask to review an entry. */
export interface ReviewerCandidateView {
    userId: string;
    /** For a caller with no roster to put a name to the id. */
    email: string;
}

/** `GET /protection/entries/:type/:id/reviewers`. */
export interface ReviewerCandidatesView {
    candidates: ReviewerCandidateView[];
}

/** One line of the reviewer queue. */
export interface ReviewQueueItemView {
    id: string;
    contentType: string;
    entryId: string;
    requestedBy: string;
    /** The people asked — what "Waiting on me" filters by. */
    reviewerIds: string[];
    /** How many approvals the type's rule wants; `0` when unprotected. */
    required: number;
    /** Distinct approvals on the entry's current head. */
    given: number;
    /** ISO-8601 — the age the page sorts and colours by. */
    createdAt: string;
}

/** A page of the reviewer queue. */
export interface ReviewQueueView {
    items: ReviewQueueItemView[];
    total: number;
    /**
     * After how many days an open ask reads as overdue.
     *
     * It travels **with the rows it applies to**, exactly as
     * {@link ProtectionInsightsView} carries it with its figures: the queue page
     * and the Insights card draw the same threshold, and a client holding its
     * own copy is a page that can come to disagree with the number beside it
     * without anything failing.
     */
    overdueAfterDays: number;
}

/**
 * Where one entry stands, as the records column and the agent tools read it.
 *
 * Narrower than {@link EntryReviewView} on purpose: that one carries every vote
 * with its author and staleness, for a panel that lists people. This is a page
 * of rows, so it carries only what a cell can show.
 */
export interface EntryReviewStatusView {
    /** Whether a rule applies to this entry's type at all. */
    protected: boolean;
    /** How many approvals the rule asks for; `0` on an unprotected type. */
    required: number;
    /** How many count toward the head revision right now. */
    given: number;
    /** How many people's only approval sits on an earlier revision. */
    stale: number;
    /** Whether a review has been asked for and not yet resolved. */
    requested: boolean;
    /** Whether publishing is currently held by the rule. */
    blocked: boolean;
}

/** The batched column read, keyed by entry id. */
export interface EntryReviewStatusMapView {
    byEntry: Record<string, EntryReviewStatusView>;
}

/**
 * The Insights card's figures.
 *
 * Two numbers and no time window, for the reason content's `unshipped` takes
 * none: a request that has been open for a fortnight is open whether it was
 * asked this morning or last spring, so windowing it would answer a different
 * question under the same name.
 */
export interface ProtectionInsightsView {
    /** Open review requests across every protected type in the workspace. */
    open: number;
    /** How many of those have been waiting longer than `overdueAfterDays`. */
    overdue: number;
    /** The threshold `overdue` was counted against, so the card can say it. */
    overdueAfterDays: number;
}
