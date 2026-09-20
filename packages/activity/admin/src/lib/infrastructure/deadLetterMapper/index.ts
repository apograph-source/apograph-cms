import type { DeadLetter, RetriedDeadLetter } from '../../types/deadLetter';

// The wire→view anti-corruption layer for a parked outbox event. The admin
// can't import the server package, so these wire types mirror
// `@orthacms/activity-server`'s `DeadLetterListView` and `DeadLetterRetryView`
// (the latter an alias of `@orthacms/database`'s `RetriedDeadLetter`). The HTTP
// gateway maps everything it fetches through here, so the rest of the plugin
// only ever sees the admin's view models.

/** One parked event as `GET /api/activity/dead-letters` returns it. */
export type DeadLetterResponse = {
    id: string;
    kind: string;
    aggregateType: string;
    aggregateId: string;
    /** ISO-8601 on the wire. */
    occurredAt: string;
    attempts: number;
    lastError: string | null;
};

/** The paginated-ish envelope `GET /api/activity/dead-letters` returns. */
export type DeadLetterListResponse = {
    total: number;
    items: DeadLetterResponse[];
};

/**
 * What `POST /api/activity/dead-letters/:id/retry` answers with: the row that
 * was already there, reset in place. `attempts` is `0` and `nextAttemptAt` is
 * `null` after a successful retry; `lastError` is **preserved**, because it is
 * the only remaining record of why the event parked.
 */
export type RetriedDeadLetterResponse = DeadLetterResponse & {
    nextAttemptAt: string | null;
};

/**
 * Maps a parked event from the wire to the admin's model.
 *
 * `occurredAt` becomes a `Date` and is **not** coerced when the wire value
 * doesn't parse — the same rule `toActivityEvent` follows for `at`, and for the
 * same reason: substituting an instant for a timestamp the audit trail got
 * wrong is a mapper fallback that silently rewrites the record. `lastError` is
 * passed through as-is rather than defaulted to `''`, so "the server sent no
 * message" and "the server sent an empty one" stay distinguishable.
 */
export function toDeadLetter(dto: DeadLetterResponse): DeadLetter {
    return {
        id: dto.id,
        kind: dto.kind,
        aggregateType: dto.aggregateType,
        aggregateId: dto.aggregateId,
        occurredAt: new Date(dto.occurredAt),
        attempts: dto.attempts,
        lastError: dto.lastError
    };
}

/** Maps the retry route's answer, schedule included. */
export function toRetriedDeadLetter(
    dto: RetriedDeadLetterResponse
): RetriedDeadLetter {
    return {
        ...toDeadLetter(dto),
        nextAttemptAt: dto.nextAttemptAt ? new Date(dto.nextAttemptAt) : null
    };
}
