/**
 * What the entry editor knows about review — the wire shapes
 * `GET /api/protection/entries/:type/:id` returns, restated locally because the
 * admin cannot import the server package, plus the two derivations the screen
 * makes from them.
 *
 * **Nothing here counts anything.** The numbers arrive computed: the server
 * reads them from `evaluateProtection` in the kernel, so the panel drawing
 * "1 of 2" and the API refusing the publish are one implementation. A count
 * recomputed here would agree until somebody switched on `countStaleApprovals`,
 * and then quietly stop.
 */

/** One recorded approval, as the panel renders it. */
export type ReviewApproval = {
    /** Who approved. The panel resolves the name from the workspace's members. */
    userId: string;
    /** The revision they approved. */
    revisionId: string;
    /** Its 1-based version number — what a struck-through line points at. */
    revisionNumber: number | null;
    /** Whether the approval sits off the head, and so no longer counts. */
    isStale: boolean;
    createdAt: string;
};

/** The open ask on an entry, when there is one. */
export type ReviewRequest = {
    id: string;
    requestedBy: string;
    /** The people asked, in the order they were picked. */
    reviewerIds: string[];
    revisionId: string;
    createdAt: string;
};

/** Everything the editor needs to render review, in one read. */
/**
 * What a publish would meet for a version that is not the stored head: the one
 * a save is about to write, or a new entry's first. Computed by the server's
 * kernel, never here.
 */
export type PublishOutlook = {
    /** How many approvals the rule wants. `0` when unprotected. */
    required: number;
    /** How many would still count once that version is written. */
    given: number;
    /** Whether the publish would be held. */
    blocked: boolean;
    /** Whether the caller could publish past the rule. */
    bypassable: boolean;
};

/** What publishing a new entry of a type would meet — the create form's read. */
export type NewEntryProtection = PublishOutlook & {
    /** Whether a rule is in force for this type. */
    protected: boolean;
};

export type EntryReview = {
    /** Whether a rule is in force for this type. */
    protected: boolean;
    /** How many approvals the rule wants. `0` when unprotected. */
    required: number;
    /** How many count right now. */
    given: number;
    /** How many people's only approval sits on an earlier version. */
    stale: number;
    /** Whether publication is held. Always `false` when unprotected. */
    blocked: boolean;
    /** Whether an administrator could publish past the rule. */
    bypassable: boolean;
    /**
     * The same verdict for the version a save would write now — what Publish
     * meets when the form has unsaved changes it saves first.
     */
    afterSave: PublishOutlook;
    headRevisionId: string;
    headRevisionNumber: number;
    /** Whether the caller wrote the head, and so cannot approve it. */
    callerWroteHead: boolean;
    /** Whether the caller already approved the head — nothing left to press. */
    callerApprovedHead: boolean;
    /** Every approval on the entry, stale ones included. */
    approvals: ReviewApproval[];
    /** The open ask, or `null`. */
    request: ReviewRequest | null;
};

/**
 * How far along the count is, as a name rather than a colour.
 *
 * The header action mirrors the publish gate's — destructive short of any
 * approval, warning part-way, success once satisfied — and this is where that
 * mapping lives so the chip beside the title and the rail's own heading cannot
 * drift apart. Every consumer pairs it with **text**: a reader who does not see
 * colour still reads "1 of 2".
 */
export type ReviewTone = 'blocked' | 'partial' | 'satisfied';

/** The tone for a review state. */
export function toneOf(review: EntryReview): ReviewTone {
    if (review.given >= review.required) return 'satisfied';
    return review.given === 0 ? 'blocked' : 'partial';
}

/** Somebody who may be asked to review — the request dialog's list. */
export type ReviewerCandidate = {
    userId: string;
    email: string;
};

/**
 * Whether this person may approve the head revision.
 *
 * Two things withhold it, and they are different refusals: not holding
 * `content:approve` is a permission the operator can grant, while having
 * written the head is the four-eyes rule doing exactly its job. The caller
 * renders a different sentence for each, so both are reported rather than
 * folded into one boolean.
 */
export function approvalBlockedReason(
    review: EntryReview,
    canApprove: boolean
): 'no-permission' | 'wrote-head' | null {
    if (!canApprove) return 'no-permission';
    if (review.callerWroteHead) return 'wrote-head';
    return null;
}

/**
 * The six fields a rule holds, as the settings editor edits them.
 *
 * Every one is required here even though the API's body makes them optional:
 * `PUT` is a **replacement**, so a form that submitted a partial rule would
 * reset whatever it did not show to the default. Keeping the type total means
 * a field added to the rule later cannot be forgotten by the editor — it stops
 * compiling instead.
 */
export type ProtectionRule = {
    /** In force. Off behaves exactly as no rule at all, a bearer token included. */
    enabled: boolean;
    /** Approvals needed on the entry's current revision. */
    requiredApprovals: number;
    /** Four eyes: the author of the current revision cannot approve it. */
    requireOtherPerson: boolean;
    /** Count approvals given on earlier revisions. Not recommended. */
    countStaleApprovals: boolean;
    /** An administrator may publish past the rule, after confirming. */
    adminBypass: boolean;
    /** A bearer token may publish this type — still meeting the count. */
    allowTokenPublish: boolean;
};

/** The documented defaults — what a type with no rule row already behaves by. */
export const DEFAULT_PROTECTION_RULE: ProtectionRule = {
    enabled: false,
    requiredApprovals: 1,
    requireOtherPerson: true,
    countStaleApprovals: false,
    adminBypass: true,
    allowTokenPublish: false
};

/** The largest count the API stores; mirrors the server's `REQUIRED_APPROVALS_MAX`. */
export const REQUIRED_APPROVALS_MAX = 100;

/** A stored rule, addressed by the pair `workspace_content` already grants. */
export type ProtectionRuleRecord = ProtectionRule & {
    /** Row id. Stable across edits; the address is `(kind, slug)`. */
    id: string;
    /** `collection` or `single`. */
    kind: string;
    /** The code-defined content type name. */
    slug: string;
};

/**
 * One row of the settings tab: a content type the workspace was granted, with
 * the rule it holds — or none.
 *
 * The list is **the grants**, not the rules. A type the workspace can work with
 * and has not protected has to appear, or the tab would only ever show what
 * somebody had already switched on and there would be no way to switch on the
 * first one.
 */
export type ProtectedTypeRow = {
    /** The code-defined type name — the `slug` half of a rule's address. */
    slug: string;
    /** `collection` or `single` — the `kind` half. */
    kind: string;
    /** Human label; falls back to the slug. */
    label: string;
    /** The stored rule, or `null` when the type carries none. */
    rule: ProtectionRuleRecord | null;
};

/**
 * Whether switching this rule on would leave the workspace unable to publish
 * the type at all.
 *
 * A workspace of one person, with four eyes required, blocks itself: the only
 * member is always the author of the head revision and so is always excluded
 * from the count. ADR-0017 accepts that cost and says the interface has to
 * name it **when the rule is switched on**, not a week later on the first
 * failed publish — which is the whole reason this is a function of the draft
 * rather than a check on save.
 */
export function blocksEveryone(rule: ProtectionRule, memberCount: number) {
    return rule.enabled && rule.requireOtherPerson && memberCount < 2;
}

/** One open ask, as the reviewer queue lists it. */
export type ReviewQueueItem = {
    /** The request row id — the React key, and stable across refetches. */
    id: string;
    /** The code-defined content type name; the queue spans every type. */
    contentType: string;
    /** The entry the ask is about — one row per locale. */
    entryId: string;
    /** Who asked. The page resolves the name; the API stays id-only. */
    requestedBy: string;
    /** The people asked — what "Waiting on me" is filtered by. */
    reviewerIds: string[];
    /** How many approvals the type's rule wants; `0` when unprotected. */
    required: number;
    /** How many count on the entry's current head. */
    given: number;
    /** ISO-8601 — what the age is measured from. */
    createdAt: string;
};

/** A page of the reviewer queue. */
export type ReviewQueue = {
    items: ReviewQueueItem[];
    /** Open requests in the workspace, before the page window. */
    total: number;
    /**
     * After how many days an open ask reads as overdue — the server's own
     * threshold, travelling with the rows it applies to rather than being
     * restated in the client. The Insights card takes it off the wire for the
     * same reason.
     */
    overdueAfterDays: number;
};

/** The queue split into the two questions the page asks. */
export type ReviewQueueTabs = {
    /** Asks that name this person as a reviewer. */
    waitingOnMe: ReviewQueueItem[];
    /** Asks this person sent, and how far each has got. */
    mine: ReviewQueueItem[];
};

/**
 * Splits one page of the queue into the page's two tabs.
 *
 * **"Waiting on me" is every open ask that names this person as a reviewer.** A
 * request names who is asked, so that is the true answer to the question; an
 * ask that names somebody else is not waiting on me, even though anyone holding
 * `content:approve` may still approve it.
 *
 * The narrower reading — *minus the ones I have already approved* — is not
 * available here and is deliberately not faked: the queue line carries the
 * tally but not **who** approved, so a client cannot tell its own approval from
 * a colleague's.
 *
 * It is no longer a partition: an ask I neither sent nor was named on belongs
 * to neither tab. My own ask is only ever mine — asking yourself is refused by
 * the server anyway.
 *
 * Pure, and split from one page rather than two requests: both tabs are views
 * of the same fetched window, so their counts cannot disagree with each other
 * or with the badge.
 */
export function splitQueue(
    items: readonly ReviewQueueItem[],
    callerId: string
): ReviewQueueTabs {
    const waitingOnMe: ReviewQueueItem[] = [];
    const mine: ReviewQueueItem[] = [];
    if (!callerId) return { waitingOnMe, mine };
    for (const item of items) {
        if (item.requestedBy === callerId) mine.push(item);
        else if (item.reviewerIds.includes(callerId)) waitingOnMe.push(item);
    }
    return { waitingOnMe, mine };
}

/**
 * Where one entry stands, as the records column reads it.
 *
 * Narrower than {@link EntryReview}, which carries every vote with its author
 * for a panel that lists people. A cell has room for a number.
 */
export type EntryReviewStatus = {
    /** Whether a rule applies to this entry's type at all. */
    protected: boolean;
    /** How many approvals the rule asks for; `0` when unprotected. */
    required: number;
    /** How many count toward the current version. */
    given: number;
    /** How many people's only approval sits on an earlier version. */
    stale: number;
    /** Whether a review has been asked for and not yet resolved. */
    requested: boolean;
    /** Whether publishing is currently held. */
    blocked: boolean;
};

/** The Insights card's two figures, and the threshold the second was counted against. */
export type ProtectionInsights = {
    open: number;
    overdue: number;
    overdueAfterDays: number;
};
