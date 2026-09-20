import type { DomainEvent } from '@orthacms/database';
import {
    ENTRY_STATUS,
    assertTransition,
    type EntryStatus,
    type ValidationIssue
} from '@orthacms/content-domain';
import {
    ENTRY_EVENT_KINDS,
    entryEvent,
    entrySubjectPayload,
    type EntrySubject
} from './events/entry-events';
import { EntryPublishBlockedError } from './entry-publish-blocked.error';

/** State the persistence layer hands {@link Entry.rehydrate} to reconstruct one. */
export interface EntryState {
    /** Entry id. */
    id: string;
    /** The content-type machine name — carried only for the event payload. */
    contentType: string;
    /** Current publish status of the stored row. */
    status: EntryStatus;
    /** The workspace the row lives in — carried only for the event payload. */
    workspaceId?: string | null;
    /**
     * A human label for the entry, carried only for the event payload so the
     * audit row names something a reader recognises instead of a uuid.
     */
    title?: string | null;
}

/**
 * The outcome of the publish precondition, computed by the use-case from the
 * kernel's value validation plus the persistence layer's required-link check
 * (which needs the DB). The model decides what to do with it.
 */
export interface PublishGate {
    /** Whether the entry may publish. */
    valid: boolean;
    /** The blocking issues when `valid` is false. */
    issues: ValidationIssue[];
}

/**
 * The **focused domain model** for an entry's publish lifecycle. The entries
 * engine is generic and registry-driven — one service backs every content type,
 * with no per-aggregate table or fixed field set — so a full row⇄aggregate
 * aggregate would fight the metamodel (ADR-0003: DDD where it pays). This models
 * only the part with real invariants: the `draft ↔ published` state machine and
 * the publish gate. It owns no columns; the application loads its status,
 * applies a transition here (raising the domain event), and the infrastructure
 * persists the new status.
 *
 * Framework-free: imports only `@orthacms/content-domain` (the pure kernel) and
 * `@orthacms/database`'s framework-free `createDomainEvent`/`DomainEvent` —
 * nothing from `@nestjs/*`, `drizzle-orm`, `class-validator`, or the
 * infrastructure layer (ADR-0003's one hard rule).
 */
export class Entry {
    private readonly events: DomainEvent[] = [];

    private constructor(
        private readonly _id: string,
        private readonly _subject: EntrySubject,
        private _status: EntryStatus
    ) {}

    /** Reconstructs an entry from its persisted lifecycle state. */
    static rehydrate(state: EntryState): Entry {
        return new Entry(
            state.id,
            {
                contentType: state.contentType,
                workspaceId: state.workspaceId ?? null,
                title: state.title ?? null
            },
            state.status
        );
    }

    /**
     * Publish the entry. Rejects with {@link EntryPublishBlockedError} when the
     * gate fails (mapped to 422 by the use-case) — checked first, so an
     * already-published row whose stored values went invalid is still blocked,
     * matching the original service. A `draft` transitions to `published` via
     * {@link assertTransition} and raises `entry.published`; an already-published
     * row is an idempotent re-publish that raises no event (the use-case still
     * re-stamps `published_at`).
     */
    publish(gate: PublishGate): void {
        if (!gate.valid) {
            throw new EntryPublishBlockedError(gate.issues);
        }
        if (this._status === ENTRY_STATUS.Published) {
            return; // idempotent re-publish
        }
        assertTransition(this._status, ENTRY_STATUS.Published);
        this._status = ENTRY_STATUS.Published;
        this.raise(ENTRY_EVENT_KINDS.PUBLISHED);
    }

    /**
     * Revert the entry to draft. A `published` row transitions to `draft` via
     * {@link assertTransition} and raises `entry.unpublished`; an already-draft
     * row is an idempotent no-op that raises no event (the use-case still
     * performs the write, preserving the original unconditional behavior).
     */
    unpublish(): void {
        if (this._status === ENTRY_STATUS.Draft) {
            return; // idempotent
        }
        assertTransition(this._status, ENTRY_STATUS.Draft);
        this._status = ENTRY_STATUS.Draft;
        this.raise(ENTRY_EVENT_KINDS.UNPUBLISHED);
    }

    /** The entry id. */
    get id(): string {
        return this._id;
    }

    /** The current publish status. */
    get status(): EntryStatus {
        return this._status;
    }

    /** Drains and returns the events raised since the last pull. */
    pullEvents(): DomainEvent[] {
        return this.events.splice(0, this.events.length);
    }

    private raise(kind: string): void {
        this.events.push(
            entryEvent(kind, this._id, entrySubjectPayload(this._subject))
        );
    }
}
