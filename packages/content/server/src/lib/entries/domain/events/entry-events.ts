import { createDomainEvent, type DomainEvent } from '@orthacms/database';

/**
 * The domain-event kinds an entry's lifecycle raises, as dotted names.
 *
 * Two of them — `entry.published` / `entry.unpublished` — are **status
 * transitions** and are raised by the {@link Entry} model, which owns the
 * `draft ↔ published` invariants. The rest are the ordinary editing lifecycle:
 * a row appearing, its values changing, it going to the trash, coming back, or
 * being destroyed. Those carry no invariant of their own — nothing about
 * "created" can be violated — so they are minted by the builders below and
 * raised by the write path directly, rather than by fabricating an aggregate
 * (and a publish status a non-publishable type does not have) around a fact.
 *
 * Until this set existed the audit log could answer "who did what, when" for
 * accounts, workspaces, API tokens, the media library and content **publishes**
 * — and not for the single most frequent action in a CMS. An editor could
 * create, rewrite and delete every entry in the product and the log stayed
 * silent, because there was nothing on the outbox for a subscriber to consume.
 */
export const ENTRY_EVENT_KINDS = {
    CREATED: 'entry.created',
    UPDATED: 'entry.updated',
    PUBLISHED: 'entry.published',
    UNPUBLISHED: 'entry.unpublished',
    DELETED: 'entry.deleted',
    RESTORED: 'entry.restored',
    PURGED: 'entry.purged'
} as const;

/** The aggregate type stamped on every entry domain event. */
const AGGREGATE_TYPE = 'content_entry';

/**
 * What an entry event says about **which entry** it is about, beyond the id.
 *
 * Both extra fields exist because of what an audit row can and cannot recover
 * afterwards:
 *
 * - `workspaceId` is the only way the trail can answer a workspace-shaped
 *   question. `activity_events` grew a nullable `workspace_id` for it, filled
 *   from the event payload, and an entry is the most-produced audited fact in
 *   the product — so an entry event that omitted it would leave the column
 *   mostly empty and the question mostly unanswerable.
 * - `title` is what makes the row **readable**. An audit row keeps no FK and no
 *   denormalised name; its whole handle on the subject is `subject_id`. That is
 *   survivable for an entry that still exists and unrecoverable for one that
 *   does not — and `entry.purged` is precisely the case where this row is the
 *   only remaining record of the thing. A uuid is not an answer to "what did
 *   they delete".
 *
 * Both are optional so a caller that genuinely has neither (a unit test, an
 * event minted outside the write path) is not forced to invent them.
 */
export interface EntrySubject {
    /** The content type's machine name. */
    contentType: string;
    /** The workspace the entry lives in. */
    workspaceId?: string | null;
    /**
     * A human label for the entry **at the time of the event** — a frozen
     * snapshot, like `actor_email`, not a lookup. The point is to survive the
     * subject.
     */
    title?: string | null;
}

/**
 * The subject fields every entry event's payload carries.
 *
 * Exported because the {@link Entry} model raises its two events through the
 * envelope builder directly rather than the per-kind helpers — those two are
 * status transitions the model owns, and it must produce the same payload shape
 * as the five the write path mints.
 */
export function entrySubjectPayload(
    subject: EntrySubject
): Record<string, unknown> {
    return {
        contentType: subject.contentType,
        workspaceId: subject.workspaceId ?? null,
        title: subject.title ?? null
    };
}

/**
 * Builds an entry {@link DomainEvent} of `kind` for `entryId`, carrying
 * `payload`. Keeps the domain model free of the event envelope's plumbing — the
 * model names the fact and its data; this stamps the `aggregateType`/id.
 */
export function entryEvent(
    kind: string,
    entryId: string,
    payload: Record<string, unknown>
): DomainEvent {
    return createDomainEvent({
        kind,
        aggregateType: AGGREGATE_TYPE,
        aggregateId: entryId,
        payload
    });
}

/** A new entry exists. `contentType` is what lets the log name *what* was made. */
export function entryCreated(
    entryId: string,
    subject: EntrySubject
): DomainEvent {
    return entryEvent(
        ENTRY_EVENT_KINDS.CREATED,
        entryId,
        entrySubjectPayload(subject)
    );
}

/**
 * An entry's stored values changed, naming **which fields** did.
 *
 * The field list is the `workspace.updated` precedent (`{ fields }`), and it is
 * what makes a row worth reading: "Ada edited Article X" is a fact, "Ada edited
 * the title and body of Article X" is a review. It is computed by comparing the
 * stored row against the written one, which also answers the volume question
 * this event raises — a save that changes nothing (a re-submit, a reopened
 * editor, a restore of the version already live) produces **no** field names
 * and therefore no event at all, so the log records editorial changes rather
 * than round trips.
 */
export function entryUpdated(
    entryId: string,
    subject: EntrySubject,
    fields: readonly string[]
): DomainEvent {
    return entryEvent(ENTRY_EVENT_KINDS.UPDATED, entryId, {
        ...entrySubjectPayload(subject),
        fields: [...fields]
    });
}

/**
 * An entry was deleted. `soft` distinguishes the two very different facts the
 * one route produces: a **paranoid** type is tombstoned and can be restored,
 * while any other type is gone from the table the moment this commits, and a
 * reviewer reading the log needs to know which happened.
 */
export function entryDeleted(
    entryId: string,
    subject: EntrySubject,
    soft: boolean
): DomainEvent {
    return entryEvent(ENTRY_EVENT_KINDS.DELETED, entryId, {
        ...entrySubjectPayload(subject),
        soft
    });
}

/** A soft-deleted entry's tombstone was cleared. */
export function entryRestored(
    entryId: string,
    subject: EntrySubject
): DomainEvent {
    return entryEvent(
        ENTRY_EVENT_KINDS.RESTORED,
        entryId,
        entrySubjectPayload(subject)
    );
}

/**
 * A tombstoned entry was destroyed permanently.
 *
 * Its own kind rather than a second `entry.deleted`: this is the one content
 * action with nothing left behind to inspect afterwards, so it is exactly the
 * one an audit trail has to record distinctly.
 */
export function entryPurged(
    entryId: string,
    subject: EntrySubject
): DomainEvent {
    return entryEvent(
        ENTRY_EVENT_KINDS.PURGED,
        entryId,
        entrySubjectPayload(subject)
    );
}
