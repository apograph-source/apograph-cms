import { createDomainEvent, type DomainEvent } from '@orthacms/database';

/**
 * The domain events the protection context raises.
 *
 * Two families, and they take different subjects on purpose.
 *
 * The **`review.*`** kinds are facts about an *entry* — who asked for it to be
 * looked at, and who said yes. They belong in that entry's own
 * history beside its edits and its publishes, because that is where somebody
 * asking "why has this not gone out" actually looks. `segments` keys its
 * `entry_access_changed` event the same way and for the same reason.
 *
 * **`protection.rule_changed`** is a fact about the *rule*. Switching a rule
 * off, or lowering the number it demands, is the quiet way past it: without a
 * row, the bypass is not a button somebody had to justify but a settings tab
 * left open for two minutes. `alarm.rule.updated` exists for the same reason —
 * a disabled rule looks exactly like a rule that finds nothing.
 *
 * **`entry.publish_bypassed`** is the third shape and the one an auditor opens
 * the log for. It is keyed to the entry like the `review.*` kinds — somebody
 * asking "how did this go out without approval" is looking at the record, not
 * at a log of protection's internals — and it is the only kind here raised by
 * something other than a route: the publish guard returns it, and content
 * commits it with the status change, so the row that excuses a publish cannot
 * outlive or be lost by the publish it excused.
 */
export const PROTECTION_EVENT_KINDS = {
    /** An author asked named people to review their entry. */
    REVIEW_REQUESTED: 'review.requested',
    /**
     * A reviewer approved a version.
     *
     * The payload carries the **revision number**, which is what makes the
     * trail survive later edits: "approved" with nothing saying *what* was
     * approved is not a trail, and the approval row itself stops counting the
     * moment the entry is saved again.
     */
    REVIEW_APPROVED: 'review.approved',
    /**
     * A protection rule was written or removed.
     *
     * One kind rather than created/updated/deleted: what a reviewer of the log
     * needs is the numbers on both sides, and a rule's identity is its
     * `(kind, slug)` address rather than a row id that changes when somebody
     * deletes and re-adds it.
     */
    RULE_CHANGED: 'protection.rule_changed',
    /**
     * An administrator published past a rule, having confirmed they meant to.
     *
     * The payload carries what was demanded and what had actually been given,
     * not just the reason: "bypassed" alone does not tell a reader whether one
     * approval was missing or all three, and that is the difference between a
     * judgement call and a rule nobody is using.
     */
    ENTRY_PUBLISH_BYPASSED: 'entry.publish_bypassed'
} as const;

/**
 * Builds a `review.*` {@link DomainEvent}.
 *
 * The aggregate is the **entry**, not the request or the vote: a review is a
 * fact about the record, and keying it to the entry is what puts the row in
 * that entry's own history rather than in a log of protection's internals that
 * nobody would think to open.
 */
export function reviewEvent(
    kind: string,
    entryId: string,
    payload: Record<string, unknown>
): DomainEvent {
    return createDomainEvent({
        kind,
        aggregateType: 'content_entry',
        aggregateId: entryId,
        payload
    });
}

/**
 * Builds the `protection.rule_changed` {@link DomainEvent}.
 *
 * The aggregate is the rule row. A removed rule has no row left to point at, so
 * the caller passes the id it had — the payload carries the address either way,
 * which is what a reader actually recognises.
 */
export function protectionRuleEvent(
    ruleId: string,
    payload: Record<string, unknown>
): DomainEvent {
    return createDomainEvent({
        kind: PROTECTION_EVENT_KINDS.RULE_CHANGED,
        aggregateType: 'protection_rule',
        aggregateId: ruleId,
        payload
    });
}

/**
 * Builds the `entry.publish_bypassed` {@link DomainEvent}.
 *
 * Keyed to the entry, for the same reason the `review.*` kinds are: this is a
 * fact about how that record went out, and it belongs in that record's history
 * beside the publish it accompanies.
 */
export function bypassEvent(
    entryId: string,
    payload: Record<string, unknown>
): DomainEvent {
    return createDomainEvent({
        kind: PROTECTION_EVENT_KINDS.ENTRY_PUBLISH_BYPASSED,
        aggregateType: 'content_entry',
        aggregateId: entryId,
        payload
    });
}
