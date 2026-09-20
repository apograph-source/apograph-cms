import { createDomainEvent, type DomainEvent } from '@orthacms/database';

/**
 * The domain events the segments context raises.
 *
 * Nothing here raised anything before, which is the reason this file exists.
 * Segments answer **who may read published content**: creating an audience,
 * changing the tags it resolves to, deleting it, and setting an entry's allow
 * and deny lists are all access-control decisions, and the audit log recorded
 * none of them. An operator could not answer "when did this article stop being
 * public, and who decided that" from anything — the entry's own revisions carry
 * the access as part of a snapshot, but only for entries that were saved
 * afterwards, and a segment's tag list is not in a revision at all.
 *
 * The event kind is the audit kind, as it is for media: there is no
 * pre-existing audit catalogue for segments to stay bug-compatible with, so a
 * second set of names would only be a mapping to remember.
 */
export const SEGMENT_EVENT_KINDS = {
    /** An audience came into existence. */
    CREATED: 'segment.created',
    /**
     * An audience was renamed, re-tagged, or re-scoped.
     *
     * Re-tagging is the one that matters most and is the least visible: an
     * audience keeps its name and its entries while the set of readers it
     * resolves to changes completely, so the row records the tags on both sides.
     */
    UPDATED: 'segment.updated',
    /**
     * An audience was deleted — and with it, its mention on every entry that
     * named it. That second half is a bulk change to stored access nobody sees
     * a screen for, which is exactly what an audit row is for.
     */
    DELETED: 'segment.deleted',
    /**
     * An entry's allow/deny lists were replaced — on every locale of the
     * record, since access travels with the record rather than the translation.
     */
    ENTRY_ACCESS_CHANGED: 'segment.entry_access_changed'
} as const;

/** Builds a segment {@link DomainEvent}, stamping the aggregate type + id. */
export function segmentEvent(
    kind: string,
    segmentId: string,
    payload: Record<string, unknown> = {}
): DomainEvent {
    return createDomainEvent({
        kind,
        aggregateType: 'segment',
        aggregateId: segmentId,
        payload
    });
}

/**
 * Builds the `segment.entry_access_changed` event.
 *
 * The aggregate is the **entry**, not the segment: an access change is a fact
 * about the record, and keying it to the entry is what puts it in that entry's
 * own history beside its edits and publishes — which is where somebody asking
 * "why can nobody read this" will look.
 */
export function entryAccessEvent(
    entryId: string,
    payload: Record<string, unknown>
): DomainEvent {
    return createDomainEvent({
        kind: SEGMENT_EVENT_KINDS.ENTRY_ACCESS_CHANGED,
        aggregateType: 'content_entry',
        aggregateId: entryId,
        payload
    });
}
